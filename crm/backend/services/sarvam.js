// ---------------------------------------------------------------------------
// Sarvam AI  —  Speech-to-Text (STT) + Text-to-Speech (TTS) + Translate
//
// STT:       POST https://api.sarvam.ai/speech-to-text     (multipart/form-data)
// TTS:       POST https://api.sarvam.ai/text-to-speech     (JSON, returns base64)
// Translate: POST https://api.sarvam.ai/translate           (JSON)
//
// Audio files are saved to  backend/audio/  and served as static files by
// Express so that Twilio's <Play> tag can download them via HTTP.
// ---------------------------------------------------------------------------
const axios     = require('axios')
const FormData  = require('form-data')
const fs        = require('fs')
const path      = require('path')
const WebSocket = require('ws')

const SARVAM_KEY = () => process.env.SARVAM_API_KEY
const AUDIO_DIR  = path.join(__dirname, '..', 'audio')

function ensureAudioDir() {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true })
}

// ---------------------------------------------------------------------------
// STT — convert raw audio bytes to text + detected language_code
// Returns: { transcript: string, language_code: string }
// ---------------------------------------------------------------------------
// languageHint: 'te-IN' | 'hi-IN' | 'en-IN' | null
// When set (admin explicitly chose a language), pass it to Sarvam so it doesn't
// misidentify Telugu as Hindi. When null, omit the field for auto-detection.
async function transcribe(audioBuffer, languageHint = null) {
  if (!SARVAM_KEY()) throw new Error('SARVAM_API_KEY is not set')

  const form = new FormData()
  form.append('file',  audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' })
  form.append('model', 'saarika:v2.5')
  if (languageHint) form.append('language_code', languageHint)
  // Omit language_code when null — saarika:v2.5 auto-detects

  let res
  try {
    res = await axios.post('https://api.sarvam.ai/speech-to-text', form, {
      headers: {
        ...form.getHeaders(),
        'api-subscription-key': SARVAM_KEY(),
      },
      timeout: 30_000,
    })
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message
    throw new Error(`Sarvam STT ${err.response?.status || ''}: ${detail}`)
  }

  return {
    transcript:    res.data.transcript    || '',
    language_code: res.data.language_code || 'en-IN',
  }
}

// ---------------------------------------------------------------------------
// TTS voice configuration tables
// ---------------------------------------------------------------------------

// Speaker names by gender (bulbul:v3 voices). 'ritu' is a warm female voice.
const SPEAKERS = { Female: 'ritu', Male: 'karun' }

// Style → pace + enable_preprocessing
// pace 1.0 = normal speed; >1 = faster, <1 = slower. Default bumped to a slightly
// snappier 1.15; tune with TTS_PACE (e.g. 1.1 gentle, 1.25 quite fast) — no code edit.
const TTS_PACE = parseFloat(process.env.TTS_PACE || '1.15')
const STYLE_CONFIG = {
  modern_colloquial: { pace: TTS_PACE, enable_preprocessing: true  },
  formal:            { pace: 0.95,     enable_preprocessing: false },
  classic:           { pace: 0.9,      enable_preprocessing: false },
}

// Audience → eng_interpolation_wt
// International: English words inside regional text pronounced in English (0.5)
// Domestic: all words pronounced in the target language style (0.0)
const AUDIENCE_CONFIG = { international: 0.5, domestic: 0.0 }

// ---------------------------------------------------------------------------
// TTS — convert text to audio, save to /audio/<filename>, return filename.
// The caller serves the file via  GET /audio/:filename.
// All voice params come from the per-session config set at call-trigger.
// ---------------------------------------------------------------------------
async function synthesize(text, session, sessionId) {
  if (!SARVAM_KEY()) throw new Error('SARVAM_API_KEY is not set')
  ensureAudioDir()

  // Resolve all voice params from session (with safe defaults).
  // preferred_language (the locked output language) wins over detected_language —
  // on the turn where the caller picks a language they may still be speaking
  // English, but we must already speak the reply back in their chosen language.
  const targetLang = session.preferred_language || session.detected_language || 'en-IN'
  const speaker    = SPEAKERS[session.gender]  || SPEAKERS.Female
  const style      = STYLE_CONFIG[session.style]     || STYLE_CONFIG.modern_colloquial
  const engWeight  = AUDIENCE_CONFIG[session.audience] ?? AUDIENCE_CONFIG.international
  const model      = session.smart_mode ? 'saaras:v2' : 'bulbul:v3'

  let data
  try {
    const res = await axios.post('https://api.sarvam.ai/text-to-speech', {
      inputs:                [text],
      target_language_code:  targetLang,
      speaker,
      model,
      pace:                  style.pace,
      speech_sample_rate:    8000,   // match Twilio's 8kHz — no resampling needed
      // (bulbul:v3 does not support the pitch / loudness params)
      enable_preprocessing:  style.enable_preprocessing,
      eng_interpolation_wt:  engWeight,
    }, {
      headers: {
        'api-subscription-key': SARVAM_KEY(),
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    })
    data = res.data
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message
    throw new Error(`Sarvam TTS ${err.response?.status || ''}: ${detail}`)
  }

  const base64 = data.audios[0]
  if (!base64) throw new Error('Sarvam TTS returned empty audio')

  const filename = `audio_${sessionId}_${Date.now()}.wav`
  const filePath = path.join(AUDIO_DIR, filename)
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))

  return filename
}

// ---------------------------------------------------------------------------
// Streaming TTS — synthesize over a WebSocket and emit 8kHz linear16 PCM chunks
// as they're generated, so playback can begin within ~600ms instead of waiting
// for the whole clip. onChunk(Int16Array) is called per chunk; resolves when done,
// rejects on error/timeout (caller falls back to batch synthesize()).
// Verified config: model bulbul:v3, output_audio_codec 'linear16', sample_rate 8000.
// ---------------------------------------------------------------------------
const TTS_WS_URL = process.env.SARVAM_TTS_WS_URL || 'wss://api.sarvam.ai/text-to-speech/ws'

// Open the streaming-TTS socket and send `config` immediately, WITHOUT the text.
// This lets the caller pay the WebSocket handshake + config round-trip up front
// (e.g. concurrently with the LLM/translate steps) so that when the text is finally
// ready, .speak() only sends `text`+`flush` on an already-connected socket — audio
// comes back ~0.5-0.8s sooner. Returns a handle, or null if no API key.
//   handle.alive()              → socket still usable (CONNECTING/OPEN, not errored)
//   handle.onChunk = fn         → set the audio sink (Int16Array PCM per chunk)
//   handle.feed(text)           → stream a chunk of text in (no flush) — call repeatedly
//   handle.finish([onChunk])    → Promise; flush + resolve when synthesis completes
//   handle.speak(text, onChunk) → Promise; one-shot feed(text)+finish() (back-compat)
//   handle.close()              → discard an unused prewarmed socket
function openSynthStream(session, langOverride) {
  if (!SARVAM_KEY()) return null
  const targetLang = langOverride || session.preferred_language || session.detected_language || 'en-IN'
  const speaker    = SPEAKERS[session.gender]  || SPEAKERS.Female
  const style      = STYLE_CONFIG[session.style] || STYLE_CONFIG.modern_colloquial
  const model      = 'bulbul:v3'

  let ws
  try {
    ws = new WebSocket(`${TTS_WS_URL}?model=${encodeURIComponent(model)}&send_completion_event=true`,
      { headers: { 'api-subscription-key': SARVAM_KEY() } })
  } catch { return null }

  // queue: text fed before the socket opened; flushed: whether finish() was called.
  const h = { ws, opened: false, dead: false, gotAudio: false, onChunk: null, settle: null, pendingErr: null, timer: null, queue: [], flushed: false }

  const configMsg = JSON.stringify({ type: 'config', data: {
    target_language_code: targetLang, speaker, speech_sample_rate: 8000,
    output_audio_codec: 'linear16', pace: style.pace, enable_preprocessing: style.enable_preprocessing, model } })

  const end = (err) => {
    if (h.dead) return
    h.dead = true
    clearTimeout(h.timer)
    try { ws.close() } catch { /* already closed */ }
    if (!h.settle) { h.pendingErr = err || h.pendingErr; return }   // ended before finish() — it rejects
    if (err) h.settle.reject(err)
    else if (!h.gotAudio) h.settle.reject(new Error('Sarvam TTS stream: no audio'))
    else h.settle.resolve()
  }

  ws.on('open', () => {
    h.opened = true
    try {
      ws.send(configMsg)
      for (const t of h.queue) ws.send(JSON.stringify({ type: 'text', data: { text: t } }))
      h.queue = []
      if (h.flushed) ws.send(JSON.stringify({ type: 'flush' }))
    } catch (e) { end(e) }
  })
  ws.on('message', (d) => {
    let m
    try { m = JSON.parse(d.toString()) } catch { return }
    if (m.type === 'audio' && m.data?.audio) {
      const buf = Buffer.from(m.data.audio, 'base64')
      const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)  // align for Int16Array
      h.gotAudio = true
      if (h.onChunk) { try { h.onChunk(new Int16Array(ab)) } catch { /* downstream send error */ } }
    } else if (m.type === 'error') {
      end(new Error('Sarvam TTS stream: ' + (m.data?.message || 'error')))
    } else if (m.type === 'event' && m.data?.event_type === 'final') {
      end()
    }
  })
  ws.on('error', (e) => end(e))
  ws.on('close',  () => end())

  h.alive = () => !h.dead && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
  h.close = () => end()
  // Stream a chunk of text in (no flush). Safe before 'open' (queued) and after.
  h.feed = (text) => {
    if (h.dead || !text) return
    if (h.opened) { try { ws.send(JSON.stringify({ type: 'text', data: { text } })) } catch (e) { end(e) } }
    else h.queue.push(text)
  }
  // Flush and resolve when synthesis finishes. Audio arrives via h.onChunk meanwhile.
  h.finish = (onChunk) => new Promise((resolve, reject) => {
    if (onChunk) h.onChunk = onChunk
    h.settle  = { resolve, reject }
    if (h.dead) return reject(h.pendingErr || new Error('Sarvam TTS stream closed'))
    h.flushed = true
    if (h.opened) { try { ws.send(JSON.stringify({ type: 'flush' })) } catch (e) { end(e) } }
    h.timer = setTimeout(() => end(new Error('Sarvam TTS stream timeout')), 15000)
  })
  // One-shot: feed the whole text then flush (original behaviour).
  h.speak = (text, onChunk) => { h.onChunk = onChunk; h.feed(text); return h.finish(onChunk) }
  return h
}

// Single-shot streaming TTS (opens socket, sends text immediately). Unchanged API
// for callers that don't prewarm; now a thin wrapper over openSynthStream.
function synthesizeStream(text, session, onChunk) {
  const h = openSynthStream(session)
  if (!h) return Promise.reject(new Error('SARVAM_API_KEY is not set'))
  return h.speak(text, onChunk)
}

// ---------------------------------------------------------------------------
// Translate — convert text between Indian languages and English.
// sourceLang / targetLang: 'en-IN' | 'te-IN' | 'hi-IN' etc.
//
// options.mode     : Sarvam translate style — controls how natural/formal the
//                    translated output sounds (maps directly to our voice style).
//                    'modern-colloquial' | 'formal' | 'classical-colloquial' | 'code-mixed'
// options.speaker_gender : 'Female' | 'Male' — affects gendered grammar in Indian languages
// options.numerals : 'international' (1,2,3) | 'native' (১,২,৩ / ౧,౨,౩)
//
// Returns the translated string; returns original text on failure.
// ---------------------------------------------------------------------------

// Map our session style keys to Sarvam translate API mode values
const TRANSLATE_MODE = {
  modern_colloquial: 'modern-colloquial',
  formal:            'formal',
  classic:           'classical-colloquial',
}

async function translate(text, sourceLang, targetLang, options = {}) {
  if (!SARVAM_KEY()) throw new Error('SARVAM_API_KEY is not set')
  if (!text || sourceLang === targetLang) return text

  // Sarvam's colloquial modes only apply when the TARGET is an Indian language.
  // Translating INTO English (translate-in) with 'modern-colloquial' returns a
  // 500, so force 'formal' for English targets.
  const isEnglishTarget = /^en(-|$)/i.test(targetLang)
  const mode     = isEnglishTarget ? 'formal' : (TRANSLATE_MODE[options.style] || options.mode || 'modern-colloquial')
  const gender   = options.speaker_gender || 'Female'
  const numerals = options.numerals       || 'international'

  const { data } = await axios.post('https://api.sarvam.ai/translate', {
    input:                text,
    source_language_code: sourceLang,
    target_language_code: targetLang,
    speaker_gender:       gender,
    mode,
    numerals,
    model:                'mayura:v1',
    enable_preprocessing: false,
  }, {
    headers: {
      'api-subscription-key': SARVAM_KEY(),
      'Content-Type': 'application/json',
    },
    timeout: 10_000,
  })

  return data.translated_text || text
}

module.exports = { transcribe, synthesize, synthesizeStream, openSynthStream, translate }
