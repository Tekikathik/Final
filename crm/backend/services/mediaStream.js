// ---------------------------------------------------------------------------
// Twilio Media Streams — Real-Time Voice Pipeline
//
// STT:  Twilio μ-law 8kHz → PCM16 WAV → Sarvam STT (auto lang detect)
// LLM:  Sarvam translate-in → Groq llama-3.1-8b-instant (English only)
// TTS:  Twilio calls.update() → <Say voice="Polly.Aditi"> (instant, same
//       Indian-English voice as the greeting — zero Sarvam TTS latency)
// ---------------------------------------------------------------------------
const WebSocket    = require('ws')
const fs           = require('fs')
const path         = require('path')
const twilio       = require('twilio')
const sessionStore = require('./sessionStore')
const sarvam       = require('./sarvam')
const { SarvamSttStream } = require('./sarvamStream')
const priyaService = require('./priya')
const flow         = require('./flowController')

// Opt-in: stream audio to Sarvam STT during the utterance (lower latency) instead
// of batch-transcribing after end-of-speech. Falls back to batch automatically.
const STT_STREAMING = process.env.STT_STREAMING === 'true'

// Opt-in: stream TTS audio chunks to Twilio as they synthesize (Priya starts
// talking in ~600ms instead of waiting for the full clip). Batch fallback per turn.
const TTS_STREAMING = process.env.TTS_STREAMING === 'true'

// Opt-in: native-multilingual mode. The LLM understands the caller's own language
// and replies DIRECTLY in it (natural code-mixed) — so we skip BOTH Sarvam
// translate-in and translate-out, removing ~1s/turn. A/B against the translate path.
const LLM_NATIVE_LANG = process.env.LLM_NATIVE_LANG === 'true'

// Translate-in: convert the caller's speech to English before the LLM. The local
// multilingual model reads Telugu/Hindi/etc. natively, AND Sarvam's te-IN→en-IN
// translate returns a 500 on real Telugu text (mayura:v1 quirk) — wasting ~1s/turn
// on the failed call. So default OFF: feed the raw transcript straight to the LLM.
// Set TRANSLATE_IN=true to restore it (e.g. if you swap to an English-only model).
const TRANSLATE_IN = process.env.TRANSLATE_IN === 'true'

// Stream the LLM's reply token-by-token and pipe each finished sentence straight into
// the Sarvam TTS socket, so audio starts on the first clause while the model is still
// writing (getmio-style overlap). Only active in native mode + a Sarvam (non-Polly)
// language, where the LLM emits the spoken language directly with no translate-out in
// the way. Falls back to the buffered path automatically. Toggle with LLM_STREAMING=false.
const LLM_STREAMING = process.env.LLM_STREAMING !== 'false'

// Bilingual, per-turn language. STT auto-detects each turn and Priya replies in
// that language — so a Telugu turn gets a Telugu reply and an English turn gets an
// English reply. ALLOWED_LANGS is the set this deployment will actually speak; any
// detected language outside it is coerced to FALLBACK_LANG (so a mis-detect like
// Bengali on a short clip doesn't make Priya answer in the wrong language).
const ALLOWED_LANGS = new Set(
  (process.env.ALLOWED_LANGUAGES || 'te-IN,en-IN,hi-IN').split(',').map(s => s.trim()).filter(Boolean)
)
const FALLBACK_LANG = process.env.PRIYA_DEFAULT_LANGUAGE || 'en-IN'
// Optional: force ONE language for the whole call (single-language campaign),
// disabling per-turn auto-detect. Leave blank for bilingual adaptive behaviour.
const FORCE_LANG = process.env.PRIYA_FORCE_LANGUAGE || null

// Detect an explicit "switch language" request inside a turn (in ANY language), so
// a caller can say — even while speaking English — "can you speak in Telugu?" and
// have EVERY following reply come in Telugu (not just turns they happen to speak in
// Telugu). Returns a language code to lock onto, or null. A regional language that
// is mentioned WITH intent and NOT negated wins; an explicit English request (e.g.
// switching back) is honoured only if no un-negated regional language is requested.
function requestedLanguage(text) {
  const t = String(text || '')
  // Treat it as a language choice if it either (a) has an intent word ("speak in
  // Telugu"), OR (b) is a short answer that's essentially just a language name — which
  // is how callers answer the greeting's "which language?" (e.g. "हिंदी", "Telugu").
  const hasIntent = /(speak|talk|say|want|prefer|switch|continue|please|\bin\b|లో|మాట్లాడ|చెప్ప|కావాల|बात|बोल|बता)/i.test(t)
  const isShort   = t.trim().split(/\s+/).length <= 3
  if (!hasIntent && !isShort) return null
  const teluguMentioned  = /(telugu|తెలుగు)/i.test(t)
  const hindiMentioned   = /(hindi|हिंदी|హిందీ)/i.test(t)
  const englishMentioned = /(english|ఇంగ్లీష్|ఇంగ్లిష్|इंग्लिश)/i.test(t)
  // Negation directly attached to a regional language ("తెలుగు వద్దు", "no telugu",
  // "telugu కాదు"). A comma/words in between (e.g. "Telugu, not English") does NOT count.
  const teluguNegated = /(no|not|don'?t|వద్దు|కాదు|नहीं|nahi)\s*(telugu|తెలుగు)|(telugu|తెలుగు)\s*(వద్దు|కాదు|not|nahi)/i.test(t)
  const hindiNegated  = /(no|not|don'?t|వద్దు|కాదు|नहीं|nahi)\s*(hindi|हिंदी|హిందీ)|(hindi|हिंदी|హిందీ)\s*(వద్దు|కాదు|not|nahi)/i.test(t)
  if (teluguMentioned && !teluguNegated) return 'te-IN'
  if (hindiMentioned  && !hindiNegated)  return 'hi-IN'
  if (englishMentioned) return 'en-IN'   // explicit switch back to English
  return null
}

function serverUrl() {
  return (process.env.SERVER_URL || 'http://localhost:5000').replace(/\/$/, '')
}

function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
}

// ── μ-law codec — correct ITU-T G.711 (Sun Microsystems reference) ───────────
// Previous implementation used bias=33; correct value is BIAS=132 (0x84).
// Wrong bias caused distorted/garbled audio on both send and receive paths.

const MULAW_BIAS = 0x84   // 132
const MULAW_CLIP = 32635

// Encode exponent lookup (maps (pcm+bias)>>7 → exponent 0-7)
const ENC_EXP = new Uint8Array([
  0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
])

// Decode exponent base table (maps exponent → starting PCM magnitude)
const DEC_BASE = new Int32Array([0, 132, 396, 924, 1980, 4092, 8316, 16764])

function mulawEncode(pcm) {
  const sign = pcm < 0 ? 0x80 : 0
  if (pcm < 0) pcm = -pcm
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP
  pcm += MULAW_BIAS
  const exp      = ENC_EXP[(pcm >> 7) & 0xFF]
  const mantissa = (pcm >> (exp + 3)) & 0x0F
  return (~(sign | (exp << 4) | mantissa)) & 0xFF
}

function mulawDecode(ulaw) {
  ulaw = (~ulaw) & 0xFF
  const sign     = ulaw & 0x80
  const exp      = (ulaw >> 4) & 0x07
  const mantissa = ulaw & 0x0F
  const sample   = DEC_BASE[exp] + (mantissa << (exp + 3))
  return sign ? -sample : sample
}

// base64 μ-law chunk → Int16Array PCM
function decodeMulaw(b64) {
  const bytes = Buffer.from(b64, 'base64')
  const pcm   = new Int16Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) pcm[i] = mulawDecode(bytes[i])
  return pcm
}

// Int16Array PCM → μ-law Buffer
function encodeMulaw(pcm) {
  const buf = Buffer.alloc(pcm.length)
  for (let i = 0; i < pcm.length; i++) buf[i] = mulawEncode(pcm[i])
  return buf
}

// ── WAV helpers ───────────────────────────────────────────────────────────

function buildWav(pcmBuf, sampleRate = 8000) {
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0);  hdr.writeUInt32LE(36 + pcmBuf.length, 4)
  hdr.write('WAVE', 8);  hdr.write('fmt ', 12)
  hdr.writeUInt32LE(16, 16);   hdr.writeUInt16LE(1, 20)  // PCM
  hdr.writeUInt16LE(1, 22);    hdr.writeUInt32LE(sampleRate, 24)
  hdr.writeUInt32LE(sampleRate * 2, 28); hdr.writeUInt16LE(2, 32)
  hdr.writeUInt16LE(16, 34);   hdr.write('data', 36)
  hdr.writeUInt32LE(pcmBuf.length, 40)
  return Buffer.concat([hdr, pcmBuf])
}

// Parse a WAV buffer — returns { sampleRate, pcm: Int16Array }
// Walks RIFF chunks; uses readInt16LE to avoid Buffer alignment bugs.
function parseWav(buf) {
  let offset = 12  // skip RIFF/size/WAVE
  let sampleRate = 8000, dataOffset = 44, dataLen = buf.length - 44
  while (offset + 8 <= buf.length) {
    const id  = buf.toString('ascii', offset, offset + 4)
    const len = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') sampleRate = buf.readUInt32LE(offset + 12)
    if (id === 'data') { dataOffset = offset + 8; dataLen = len; break }
    offset += 8 + len
  }
  // Safe Int16 extraction — avoids Buffer byteOffset alignment issues
  const sampleCount = Math.floor(dataLen / 2)
  const pcm = new Int16Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = buf.readInt16LE(dataOffset + i * 2)
  }
  return { sampleRate, pcm }
}

// Linear-interpolation resample
function resample(pcm, srcRate, dstRate) {
  if (srcRate === dstRate) return pcm
  const ratio  = srcRate / dstRate
  const outLen = Math.floor(pcm.length / ratio)
  const out    = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const t   = pos - idx
    out[i] = Math.round((pcm[idx] || 0) * (1 - t) + (pcm[Math.min(idx + 1, pcm.length - 1)] || 0) * t)
  }
  return out
}

// Int16Array → Buffer (little-endian)
function pcmToBuffer(pcm) {
  const buf = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], i * 2)
  return buf
}

// RMS energy of a PCM chunk
function rms(pcm) {
  let s = 0
  for (const v of pcm) s += v * v
  return Math.sqrt(s / pcm.length)
}

// ── Per-connection state machine ─────────────────────────────────────────

const SPEECH_RMS_THRESHOLD = 200   // energy above this = voice
// End-of-speech: how much silence before we treat the caller as done and reply.
// Lower = snappier reply after they stop; too low risks cutting them off mid-pause.
// Tune via SILENCE_END_MS (default 500ms). Each chunk = 20ms.
const SILENCE_END_MS       = parseInt(process.env.SILENCE_END_MS || '500', 10)
const SILENCE_CHUNKS_END   = Math.max(8, Math.round(SILENCE_END_MS / 20))
// Smart endpointing: when the live transcript looks like a COMPLETE thought (ends in
// punctuation, or ≥4 words and not on a connector), commit after a SHORTER silence —
// so we fire sooner. Short/trailing utterances keep the full SILENCE_END_MS window so
// we don't cut people off mid-pause. Tune the snappy threshold via SILENCE_FAST_MS.
const SILENCE_FAST_MS      = parseInt(process.env.SILENCE_FAST_MS || '260', 10)
const SILENCE_CHUNKS_FAST  = Math.max(6, Math.round(SILENCE_FAST_MS / 20))
// Words that usually mean "I'm still talking" — don't fast-commit right after one.
const CONTINUATION_RE = /\b(and|but|so|or|because|then|um|uh|like|మరియు|లేదా|కానీ|और|तो|या|कि|लेकिन)\s*$/i
function utteranceLooksComplete(t) {
  const s = String(t || '').trim()
  if (!s) return false
  if (CONTINUATION_RE.test(s)) return false               // trailing connector → likely continuing
  if (/[.?!।]\s*$/.test(s)) return true                    // ended on sentence punctuation
  return s.split(/\s+/).length >= 4                        // a substantial phrase
}
const MIN_SPEECH_CHUNKS    = 10    // need at least 200ms of voice before sending to STT
const MAX_SPEECH_CHUNKS    = 500   // 10s max recording — enough for a full sentence with a number/score

// Per-step timeouts (ms) — keep total pipeline under 13s
const T_STT          = 7_000
const T_TRANSLATE    = 4_000
const T_GROQ         = 5_000   // 8b-instant is sub-300ms so 5s is a generous ceiling
// Agentic path runs a multi-iteration tool-calling loop on a larger model —
// give it a longer ceiling. Override via T_GROQ_AGENTIC env var.
const T_GROQ_AGENTIC = parseInt(process.env.T_GROQ_AGENTIC || '12000', 10)
// TTS ceiling has headroom so a slightly-long reply finishes streaming (the
// caller is already hearing it) instead of fatal-resetting mid-sentence. The
// real fix for long audio is the ~25-word reply cap in the prompt + max_tokens.
const T_TTS          = parseInt(process.env.T_TTS || '11000', 10)
const T_PIPELINE     = parseInt(process.env.T_PIPELINE || '18000', 10)  // hard ceiling — reset to listening if exceeded

const race = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)),
])

// Detect a language the caller names in their greeting answer ("I'm comfortable
// with Telugu") → Sarvam language code. Used to lock the call's output language.
const LANGUAGE_CHOICES = [
  { rx: /\btelugu\b/i,              code: 'te-IN' },
  { rx: /\b(hindi|हिंदी)\b/i,        code: 'hi-IN' },
  { rx: /\benglish\b/i,            code: 'en-IN' },
  { rx: /\btamil\b/i,              code: 'ta-IN' },
  { rx: /\bkannada\b/i,            code: 'kn-IN' },
  { rx: /\bmalayalam\b/i,          code: 'ml-IN' },
  { rx: /\bmarathi\b/i,            code: 'mr-IN' },
  { rx: /\b(bengali|bangla)\b/i,   code: 'bn-IN' },
  { rx: /\bgujarati\b/i,           code: 'gu-IN' },
  { rx: /\b(punjabi|panjabi)\b/i,  code: 'pa-IN' },
  { rx: /\b(odia|oriya)\b/i,       code: 'od-IN' },
]
function detectLanguageChoice(text) {
  for (const { rx, code } of LANGUAGE_CHOICES) if (rx.test(text || '')) return code
  return null
}

// STT sometimes loops on noisy/long audio and emits a word repeated dozens of
// times ("అటు అటు అటు …") or an absurdly long string. Detect that garbage so we
// ignore the turn (re-listen) instead of paying the STT→translate→LLM latency and
// confusing the agent into escalating.
function isDegenerateTranscript(text) {
  const t = (text || '').trim()
  if (t.length > 600) return true   // no real phone turn is this long
  const words = t.split(/\s+/)
  if (words.length < 8) return false
  let maxRun = 1, run = 1
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) { run++; if (run > maxRun) maxRun = run } else run = 1
  }
  if (maxRun >= 5) return true       // same word ≥5× in a row = loop
  const freq = {}
  let top = 0
  for (const w of words) { freq[w] = (freq[w] || 0) + 1; if (freq[w] > top) top = freq[w] }
  return words.length >= 12 && top / words.length > 0.4   // one word dominates a long turn
}

class MediaSession {
  constructor(ws, sessionId) {
    this.ws                   = ws
    this.sessionId            = sessionId
    this.callSid              = null
    this.streamSid            = null
    this.state                = 'greeting'
    this.chunks               = []
    this.speechCnt            = 0
    this.silenceCnt           = 0
    this.cooldownUntil = 0   // ignore audio until this timestamp (prevents Polly echo)
    this.sttStream     = null // live Sarvam streaming-STT session (STT_STREAMING only)
    this._ttsPrewarm   = null // Sarvam TTS socket opened early so its handshake overlaps the LLM
    // STT failure count is stored in sessionStore (survives per-Polly WebSocket reconnects)
  }

  // Called for every inbound 20ms audio chunk from Twilio
  onChunk(b64payload) {
    if (this.state === 'processing' || this.state === 'speaking' || this.state === 'greeting') return
    // Cooldown: discard audio immediately after WebSocket reconnects to prevent
    // picking up the last echo of Polly.Aditi's voice as student speech
    if (Date.now() < this.cooldownUntil) return

    const pcm    = decodeMulaw(b64payload)
    const energy = rms(pcm)

    if (this.state === 'listening') {
      if (energy > SPEECH_RMS_THRESHOLD) {
        this.state      = 'recording'
        this.speechCnt  = 1
        this.silenceCnt = 0
        this.chunks     = [pcm]
        if (STT_STREAMING) {
          // 'unknown' = let Sarvam auto-detect the language each turn (bilingual).
          this.sttStream = new SarvamSttStream({ languageCode: FORCE_LANG || 'unknown' })
          this.sttStream.sendPcm(pcm)
        }
      }
    } else if (this.state === 'recording') {
      this.chunks.push(pcm)
      this.sttStream?.sendPcm(pcm)
      if (energy > SPEECH_RMS_THRESHOLD) {
        this.speechCnt++
        this.silenceCnt = 0
      } else {
        this.silenceCnt++
        // Adaptive: if the live transcript already looks like a complete thought, commit
        // after the short window; otherwise wait the full window (don't cut them off).
        const endThreshold = utteranceLooksComplete(this.sttStream?.transcript)
          ? SILENCE_CHUNKS_FAST
          : SILENCE_CHUNKS_END
        if (this.silenceCnt >= endThreshold && this.speechCnt >= MIN_SPEECH_CHUNKS) {
          this._onEndOfSpeech()
        }
      }
      if (this.chunks.length >= MAX_SPEECH_CHUNKS) this._onEndOfSpeech()
    }
  }

  _onEndOfSpeech() {
    if (this.state !== 'recording') return
    this.state = 'processing'
    const chunks = this.chunks.splice(0)
    const stream = this.sttStream; this.sttStream = null
    this.speechCnt  = 0
    this.silenceCnt = 0
    this._pipeline(chunks, stream).catch(err => {
      console.error('[WS] Pipeline error:', err.message)
      stream?.abort()
      this.state = 'listening'
    })
  }

  async _pipeline(chunks, stream) {
    const t0 = Date.now()
    const ms = () => `+${Date.now() - t0}ms`

    // Hard ceiling — if the whole pipeline exceeds T_PIPELINE, reset
    const pipelineTimer = setTimeout(() => {
      console.warn(`[WS] Pipeline exceeded ${T_PIPELINE}ms — resetting to listening`)
      stream?.abort()
      this.state = 'listening'
    }, T_PIPELINE)

    try {
      await this._runPipeline(chunks, t0, ms, stream)
    } catch (err) {
      console.error(`[WS] Pipeline fatal (${ms()}):`, err.message)
      this.state = 'listening'
    } finally {
      clearTimeout(pipelineTimer)
      // Don't leak a prewarmed TTS socket if the turn aborted before it was used.
      if (this._ttsPrewarm) { try { this._ttsPrewarm.close() } catch {} this._ttsPrewarm = null }
    }
  }

  async _runPipeline(chunks, t0, ms, stream) {
    const session = sessionStore.get(this.sessionId)
    if (!session) { stream?.abort(); return }

    // Assemble WAV from accumulated 8kHz PCM chunks
    const totalLen = chunks.reduce((s, c) => s + c.length, 0)
    const combined = new Int16Array(totalLen)
    let off = 0
    for (const c of chunks) { combined.set(c, off); off += c.length }

    // Skip clips too short for Sarvam STT
    const durationMs = (totalLen / 8000) * 1000
    if (durationMs < 500) {
      console.log(`[WS] Audio too short (${Math.round(durationMs)}ms) — skipping`)
      this.state = 'listening'
      return
    }

    const wavBuffer = buildWav(pcmToBuffer(combined), 8000)

    // ── 1. STT (7s timeout) ───────────────────────────────────────────────
    const t1 = Date.now()
    // null = auto-detect the language each turn (FORCE_LANG pins it if configured).
    const sttHint = FORCE_LANG || null
    let sttResult = null
    let sttVia = 'batch'

    // Streaming STT (opt-in): audio was sent to Sarvam during the utterance, so the
    // transcript is essentially ready — finalize it. Falls through to batch on
    // empty/error, so the working batch path is always the safety net.
    if (stream) {
      try {
        const r = await race(stream.finalize(), T_STT, 'STT-stream')
        if (r?.transcript) {
          sttResult = { transcript: r.transcript, language_code: r.language || FORCE_LANG || 'en-IN' }
          sttVia = 'stream'
          sessionStore.update(this.sessionId, { sttFailCount: 0 })
        }
      } catch (err) {
        console.warn(`[WS] streaming STT failed (${ms()}) — batch fallback:`, err.message)
      } finally {
        stream.abort()
      }
    }

    if (!sttResult) {
      try {
        sttResult = await race(sarvam.transcribe(wavBuffer, sttHint), T_STT, 'STT')
        // Reset persisted counter on any successful STT (survives reconnects)
        sessionStore.update(this.sessionId, { sttFailCount: 0 })
      } catch (err) {
        // Persist the failure count in the session so it survives WebSocket reconnects
        // (each Polly <Say> disconnects and reconnects, creating a new MediaSession)
        const failCount = ((sessionStore.get(this.sessionId)?.sttFailCount) || 0) + 1
        sessionStore.update(this.sessionId, { sttFailCount: failCount })
        console.warn(`[WS] STT failed (${ms()}) [${failCount}/3]:`, err.message)
        if (failCount >= 3) {
          console.warn('[WS] 3 consecutive STT failures — ending call')
          sessionStore.update(this.sessionId, { sttFailCount: 0 })
          await this._sayPolly(
            "I'm sorry, I'm having difficulty hearing you. Please try calling again. Goodbye!",
            'en-IN'
          )
          sessionStore.update(this.sessionId, { status: 'failed' })
          return
        }
        this.state = 'listening'
        return
      }
    }
    const studentText  = sttResult.transcript || ''
    // Per-turn language: trust the detection, but coerce anything outside the
    // deployment's allowed set to the fallback (guards against mis-detects).
    const rawLang      = FORCE_LANG || sttResult.language_code || ''
    const detectedLang = ALLOWED_LANGS.has(rawLang) ? rawLang : FALLBACK_LANG
    console.log(`[WS] 1.STT(${sttVia}) ${Date.now()-t1}ms (${ms()}) "${studentText.substring(0,60)}" lang:${detectedLang}${rawLang !== detectedLang ? ` (raw ${rawLang})` : ''}`)

    if (!studentText) { this.state = 'listening'; return }

    // Drop garbled STT (repetition loops / absurd length) — don't translate, call
    // the LLM, or escalate on noise; just keep listening.
    if (isDegenerateTranscript(studentText)) {
      console.warn(`[WS] Ignoring garbled STT (repetition/length): "${studentText.slice(0, 40)}…"`)
      this.state = 'listening'
      return
    }

    sessionStore.update(this.sessionId, { detected_language: detectedLang })
    const s1 = sessionStore.get(this.sessionId)
    sessionStore.update(this.sessionId, {
      transcript: [...s1.transcript, { role: 'Student', text: studentText, timestamp: new Date().toISOString() }],
    })

    // ── 2. Translate-in — 4s timeout (non-English only) ──────────────────
    const needsTranslation = detectedLang !== 'en-IN'
    const translateOpts    = {
      style:          session.style    || 'modern_colloquial',
      speaker_gender: session.gender   || 'Female',
      numerals:       session.audience === 'domestic' ? 'native' : 'international',
    }
    // Native mode (or TRANSLATE_IN off): feed the caller's own-language text straight
    // to the multilingual LLM. Otherwise convert to English first.
    let englishText = studentText
    if (needsTranslation && !LLM_NATIVE_LANG && TRANSLATE_IN) {
      const t2 = Date.now()
      try {
        englishText = await race(
          sarvam.translate(studentText, detectedLang, 'en-IN', { ...translateOpts, style: 'modern_colloquial' }),
          T_TRANSLATE, 'Translate-in'
        )
        console.log(`[WS] 2.Translate-in ${Date.now()-t2}ms (${ms()})`)
      } catch (err) {
        console.warn(`[WS] Translate-in failed (${ms()}):`, err.message)
        // Use original text — Groq handles mixed language reasonably
      }
    }

    // Language lock: if the caller asked to switch language (even while speaking
    // another language), pin it for the rest of the call so EVERY reply uses it —
    // until they ask to switch again. Otherwise reply in the language of this turn.
    const reqLang = requestedLanguage(studentText)
    if (reqLang && ALLOWED_LANGS.has(reqLang)) {
      sessionStore.update(this.sessionId, { forced_output_lang: reqLang })
      console.log(`[WS] Language lock → ${reqLang} (caller requested)`)
    }
    const lockedLang = FORCE_LANG || sessionStore.get(this.sessionId).forced_output_lang
    const outLang = lockedLang || detectedLang

    // Prewarm the Sarvam TTS socket NOW — concurrently with the LLM + translate-out
    // below — so the WebSocket handshake + config is already done when the reply text
    // is ready. Cuts ~0.5-0.8s off time-to-first-audio. Only for Sarvam languages
    // (en-IN / hi-IN speak via Polly); if the reply ends up on Polly, _say() discards it.
    if (this._ttsPrewarm) { try { this._ttsPrewarm.close() } catch {} this._ttsPrewarm = null }
    if (TTS_STREAMING && outLang !== 'en-IN' && outLang !== 'hi-IN') {
      this._ttsPrewarm = sarvam.openSynthStream(sessionStore.get(this.sessionId), outLang)
    }

    // ── 3. LLM (+ optional streamed TTS) ────────────────────────────────────
    // Agentic path runs a multi-iteration tool-calling loop on a larger model,
    // so it gets a longer ceiling (T_GROQ_AGENTIC) than the deterministic path.
    const agentic = process.env.PRIYA_AGENTIC === 'true'
    const t3 = Date.now()

    // Streaming reply: when a Sarvam language + a live prewarmed socket, pipe each
    // finished sentence into TTS as the model writes it (audio starts on the first
    // clause). Native mode feeds the sentence straight in; translate mode translates
    // each sentence to outLang first (streamed translate-out) and feeds it IN ORDER.
    const sock = this._ttsPrewarm
    const STREAM = LLM_STREAMING && sock && sock.alive() &&
                   outLang !== 'en-IN' && outLang !== 'hi-IN'
    let streamSent = false
    let streamTail = Promise.resolve()   // serializes per-sentence translate→feed (order-preserving)
    const llmOpts = LLM_NATIVE_LANG ? { replyLanguage: outLang } : {}
    if (STREAM) {
      sock.onChunk = (pcm) => {
        if (this.ws.readyState !== WebSocket.OPEN) return
        const mulaw = encodeMulaw(pcm)
        for (let i = 0; i < mulaw.length; i += 160) {
          if (this.ws.readyState !== WebSocket.OPEN) break
          this.ws.send(JSON.stringify({ event: 'media', streamSid: this.streamSid,
            media: { payload: mulaw.slice(i, i + 160).toString('base64') } }))
          streamSent = true
        }
      }
      this.state = 'speaking'
      llmOpts.onSentence = LLM_NATIVE_LANG
        ? (s) => sock.feed(s)
        : (s) => {   // translate-out, streamed: translate each English sentence, feed in order
            streamTail = streamTail.then(async () => {
              try {
                const tl = await race(sarvam.translate(s, 'en-IN', outLang, translateOpts), T_TRANSLATE, 'TL-stream')
                sock.feed(tl)
              } catch (e) { console.warn(`[WS] stream translate-out failed: ${e.message}`); sock.feed(s) }
            })
          }
    }

    let reply, step, step_index, collected, provider, streamed
    try {
      ;({ reply, step, step_index, collected, provider, streamed } = await race(
        priyaService.callPriyaAPI(this.sessionId, englishText, llmOpts),
        agentic ? T_GROQ_AGENTIC : T_GROQ, 'Groq'
      ))
      console.log(`[WS] 3.LLM[${provider || '?'}]${streamed ? '(stream)' : ''} ${Date.now()-t3}ms (${ms()}) step:${step}`)
    } catch (err) {
      console.warn(`[WS] Groq failed (${ms()}):`, err.message)
      const s = sessionStore.get(this.sessionId)
      step = s.step; step_index = s.step_index; collected = {}
      // Re-ask the current step question rather than a confusing generic "repeat that"
      reply = flow.STEP_QUESTIONS[step] || 'I am sorry, could you please say that again?'
    }

    // Agentic escalation: the agent decided this call needs a human. Override
    // the reply with a fixed handoff message and force the end-of-call path so
    // existing step==='end' / step_index>=11 logic closes the call below.
    if (collected?._escalate) {
      reply      = 'I understand. Let me connect you with one of our admission counsellors who can help further. Thank you for calling Aditya University — goodbye!'
      step       = 'end'
      step_index = 11
    }

    const s2 = sessionStore.get(this.sessionId)
    sessionStore.update(this.sessionId, {
      step, step_index,
      collected:  { ...s2.collected, ...collected },
      transcript: [...s2.transcript, { role: 'Priya', text: reply, timestamp: new Date().toISOString() }],
    })

    // ── 4. TTS ────────────────────────────────────────────────────────────
    const t4 = Date.now()
    if (STREAM && streamed) {
      // The reply was streamed into the socket sentence-by-sentence as the model wrote
      // it — wait for any in-flight per-sentence translations to be fed, then flush.
      this._ttsPrewarm = null   // consumed
      try {
        await streamTail        // all translate-out sentences fed (no-op in native mode)
        await race(sock.finish(), T_TTS, 'TTS')
        console.log(`[WS] 4.TTS(stream) ${Date.now()-t4}ms (${ms()}) ← TOTAL`)
      } catch (e) {
        console.warn(`[WS] streamed TTS failed (${ms()}): ${e.message}`)
        try { sock.close() } catch {}
        if (!streamSent) await race(this._say(reply, outLang, sessionStore.get(this.sessionId)), T_TTS, 'TTS')
      }
      this.state = 'listening'
    } else {
      // Buffered path (English/Polly, or streaming didn't fire). Discard any unused
      // prewarmed socket, then translate-out (skipped in native mode) + speak.
      if (STREAM) { try { sock.close() } catch {} this._ttsPrewarm = null }
      const needsTransOut = outLang !== 'en-IN' && !LLM_NATIVE_LANG
      let ttsText = reply
      if (needsTransOut) {
        // Agentic path: translate the agent's full (already short) reply. Deterministic
        // path: translate only the mandatory step question (full regional replies balloon).
        const toTranslate = agentic ? reply : (flow.STEP_QUESTIONS[step] || reply)
        const tTo = Date.now()
        try {
          ttsText = await race(
            sarvam.translate(toTranslate, 'en-IN', outLang, translateOpts),
            T_TRANSLATE, 'Translate-out'
          )
          console.log(`[WS] 3b.Translate-out ${Date.now()-tTo}ms → ${outLang}: "${ttsText.substring(0, 50)}"`)
        } catch (err) {
          console.warn(`[WS] Translate-out failed (${ms()}):`, err.message)
          ttsText = toTranslate  // fall back to English step question
        }
      }
      const finalSess = sessionStore.get(this.sessionId)
      await race(this._say(ttsText, outLang, finalSess), T_TTS, 'TTS')
      console.log(`[WS] 4.TTS ${Date.now()-t4}ms (${ms()}) ← TOTAL`)
    }

    if (step === 'end' || step_index >= 11) {
      sessionStore.update(this.sessionId, { status: 'completed' })
      sessionStore.saveToHistory(sessionStore.get(this.sessionId))
      setTimeout(() => { try { this.ws.close() } catch {} }, 2000)
    } else {
      this.state = 'listening'
    }
  }

  // Hybrid TTS router:
  //   en-IN / hi-IN → Polly.Aditi via calls.update() (instant, Indian accent)
  //   te-IN / ta-IN / and all others → Sarvam TTS streamed over WebSocket
  // When Polly fails, the failure count is persisted in the session. After 2
  // consecutive failures we skip Polly entirely for the rest of the call,
  // avoiding the 5s TCP-timeout penalty on every subsequent turn.
  async _say(text, detectedLang, session) {
    // Route by the reply's ACTUAL script, not the caller's detected language.
    // In native mode the 3B often answers a Telugu turn in plain English; sending
    // that Latin text to the Sarvam Telugu voice can't render it and cost ~15s +
    // a fatal timeout (the caller heard nothing). Plain-Latin replies → fast Polly.
    if (!/[ऀ-ൿ]/.test(text)) detectedLang = 'en-IN'   // no Indic script ⇒ English ⇒ Polly
    const pollyLangs = new Set(['en-IN', 'hi-IN'])
    if (pollyLangs.has(detectedLang || 'en-IN')) {
      const pollyFailCount = session?.pollyFailCount || 0
      if (pollyFailCount < 2) {
        const ok = await this._sayPolly(text, detectedLang)
        if (ok) {
          // Spoke via Polly — discard the prewarmed Sarvam socket we won't use.
          if (this._ttsPrewarm) { try { this._ttsPrewarm.close() } catch {} this._ttsPrewarm = null }
          // calls.update() makes Twilio drop this WebSocket and open a fresh one
          // momentarily — flag it so ws.on('close') doesn't mistake this for a hangup.
          sessionStore.update(this.sessionId, { pollyFailCount: 0, pendingReconnect: true })
          return
        }
        const newCount = pollyFailCount + 1
        sessionStore.update(this.sessionId, { pollyFailCount: newCount })
        console.warn(`[WS] Polly unavailable (fail ${newCount}/2) — falling back to Sarvam TTS`)
      } else {
        console.warn('[WS] Polly disabled for this call (2+ failures) — using Sarvam TTS')
      }
    }
    return this._sayWithSarvam(text, sessionStore.get(this.sessionId))
  }

  // Polly.Aditi via Twilio calls.update() — WebSocket reconnects after <Say>.
  // Returns true on success, false on any failure (timeout or network error).
  // 5s internal timeout prevents TCP ETIMEDOUT (~30s) from blocking the pipeline.
  async _sayPolly(text, lang = 'en-IN') {
    if (!this.callSid) { console.warn('[WS] _sayPolly: no callSid'); return false }
    const safe  = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const wsUrl = serverUrl().replace(/^http/, 'ws') + '/ws/media-stream'
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi" language="${lang}">${safe}</Say>
  <Connect><Stream url="${wsUrl}"/></Connect>
</Response>`
    try {
      await Promise.race([
        getTwilioClient().calls(this.callSid).update({ twiml }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('calls.update timeout')), 5_000)),
      ])
      console.log(`[WS] Polly.Aditi (${lang}): "${text.substring(0, 60)}"`)
      return true
      // WebSocket closes here; new connection resumes at current step via greet()
    } catch (err) {
      console.warn('[WS] calls.update failed:', err.message)
      return false
    }
  }

  // Sarvam TTS streamed over current WebSocket (for Telugu, Tamil, Kannada etc.)
  async _sayWithSarvam(text, session) {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.log('[WS] WebSocket closed — skipping Sarvam TTS')
      return
    }
    // Streaming TTS first (audio starts in ~600ms); only fall back to batch if it
    // produced nothing (a partial-then-error stream is kept — already playing).
    if (TTS_STREAMING) {
      try { return await this._sayWithSarvamStream(text, session) }
      catch (err) { console.warn('[WS] streaming TTS failed — batch fallback:', err.message) }
    }
    this.state = 'speaking'
    try {
      let filename
      try {
        filename = await sarvam.synthesize(text, session, this.sessionId)
      } catch (err) {
        if (err.message.includes('ECONNRESET') || err.message.includes('ECONNREFUSED')) {
          console.warn('[WS] Sarvam TTS ECONNRESET — retrying...')
          await new Promise(r => setTimeout(r, 600))
          filename = await sarvam.synthesize(text, session, this.sessionId)
        } else throw err
      }
      const wavPath    = path.join(__dirname, '..', 'audio', filename)
      const wavBuf     = fs.readFileSync(wavPath)
      const { sampleRate, pcm } = parseWav(wavBuf)
      const pcm8k      = sampleRate === 8000 ? pcm : resample(pcm, sampleRate, 8000)
      const mulawData  = encodeMulaw(pcm8k)
      const durMs      = Math.round(pcm8k.length / 8000 * 1000)
      console.log(`[WS] Sarvam TTS: ${durMs}ms "${text.substring(0, 40)}"`)
      const CHUNK = 160
      for (let i = 0; i < mulawData.length; i += CHUNK) {
        if (this.ws.readyState !== WebSocket.OPEN) break
        this.ws.send(JSON.stringify({
          event: 'media', streamSid: this.streamSid,
          media: { payload: mulawData.slice(i, i + CHUNK).toString('base64') },
        }))
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: 'done' } }))
      }
      try { fs.unlinkSync(wavPath) } catch {}
    } catch (err) {
      console.warn('[WS] Sarvam TTS failed:', err.message)
    } finally {
      this.state = 'listening'
    }
  }

  // Streaming Sarvam TTS: μ-law-encode and forward each 8kHz PCM chunk to Twilio as
  // it synthesizes, so playback begins in ~600ms. Throws (→ batch fallback) only if
  // no audio was produced; a partial-then-error stream is kept since it's already
  // playing on the caller's side.
  async _sayWithSarvamStream(text, session) {
    this.state = 'speaking'
    const t0 = Date.now()
    let sent = false
    let samples = 0
    // Use the socket prewarmed at the LLM step if it's still alive (handshake
    // already paid); otherwise open a fresh one now.
    const prewarm = (this._ttsPrewarm && this._ttsPrewarm.alive()) ? this._ttsPrewarm : null
    if (this._ttsPrewarm && !prewarm) { try { this._ttsPrewarm.close() } catch {} }
    this._ttsPrewarm = null
    const onChunk = (pcm) => {
      if (this.ws.readyState !== WebSocket.OPEN) return
      samples += pcm.length
      const mulaw = encodeMulaw(pcm)
      for (let i = 0; i < mulaw.length; i += 160) {
        if (this.ws.readyState !== WebSocket.OPEN) break
        this.ws.send(JSON.stringify({
          event: 'media', streamSid: this.streamSid,
          media: { payload: mulaw.slice(i, i + 160).toString('base64') },
        }))
        sent = true
      }
    }
    try {
      if (prewarm) { console.log('[WS] TTS: using prewarmed socket'); await prewarm.speak(text, onChunk) }
      else await sarvam.synthesizeStream(text, session, onChunk)
    } catch (err) {
      if (!sent) { this.state = 'listening'; throw err }   // nothing played → caller falls back to batch
      console.warn('[WS] streaming TTS errored mid-stream (partial audio sent):', err.message)
    }
    if (!sent) { this.state = 'listening'; throw new Error('streaming TTS produced no audio') }
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: 'done' } }))
    }
    console.log(`[WS] Sarvam TTS(stream): ${Math.round(samples / 8000 * 1000)}ms audio, first-to-last ${Date.now()-t0}ms "${text.substring(0, 40)}"`)
    this.state = 'listening'
  }

  // Called every time a new WebSocket stream starts (including mid-call reconnects
  // triggered by calls.update() after each Polly <Say>).
  greet() {
    const session = sessionStore.get(this.sessionId)
    if (!session) return

    // Mid-call reconnect after Polly <Say>: wait 900ms before listening so the
    // last echo of Polly's voice doesn't trigger VAD and produce an empty STT call
    if (session.step_index > 0) {
      this.cooldownUntil = Date.now() + 900
      this.state = 'listening'
      console.log('[WS] Stream reconnected — cooldown 900ms then listening at step:', session.step)
      return
    }

    // First connection: greeting was spoken by <Say> in call-start TwiML
    const greeting = 'Hi! I am Priya from Aditya University. Which language are you comfortable speaking in — Telugu, English, Hindi, or any other?'
    sessionStore.update(this.sessionId, {
      status:     'in-progress',
      step:       'greeting',
      step_index: 0,
      transcript: [{ role: 'Priya', text: greeting, timestamp: new Date().toISOString() }],
    })
    this.state = 'listening'
    console.log('[WS] Greeting done via <Say> — now listening')
  }
}

// ── WebSocket server setup ────────────────────────────────────────────────
// Session lookup is deferred to the Twilio 'start' message which carries
// callSid — this is reliable even when ngrok/Twilio strip URL query strings.

function setup(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws/media-stream' })

  wss.on('connection', (ws) => {
    console.log('[WS] Connection received — waiting for Twilio start event...')

    let mss = null  // created once callSid arrives in 'start' message

    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }

      switch (msg.event) {

        case 'start': {
          const callSid   = msg.start?.callSid
          const streamSid = msg.start?.streamSid

          // Resolve session from callSid — mapped in call-start webhook
          const session = sessionStore.getByCallSid(callSid)
          if (!session) {
            console.warn('[WS] No session found for callSid:', callSid, '— closing')
            ws.close()
            return
          }

          mss           = new MediaSession(ws, session.session_id)
          mss.streamSid = streamSid
          mss.callSid   = callSid
          console.log('[WS] Stream started | session:', session.session_id, '| callSid:', callSid)
          mss.greet()
          break
        }

        case 'media':
          // Twilio sends track:"inbound" for student audio
          if (mss && msg.media?.track === 'inbound') mss.onChunk(msg.media.payload)
          break

        case 'stop':
          console.log('[WS] Stream stopped | session:', mss?.sessionId)
          break
      }
    })

    ws.on('close', () => {
      console.log('[WS] Disconnected | session:', mss?.sessionId || 'unknown')
      mss?.sttStream?.abort()   // don't leak a streaming-STT socket on disconnect
      if (mss?.sessionId) {
        const s = sessionStore.get(mss.sessionId)

        // Expected disconnect from calls.update() <Say> — a new WebSocket
        // connection resumes the call within ~1s. Clear the flag and keep polling.
        if (s?.pendingReconnect) {
          sessionStore.update(mss.sessionId, { pendingReconnect: false })
          return
        }

        // Real hangup mid-call (before the 'end' step): session status is still
        // 'in-progress'. Update it to 'completed' here so the frontend polling
        // detects it on the next cycle — the Twilio call-status webhook will
        // arrive shortly and overwrite with its own duration.
        if (s && (s.status === 'in-progress' || s.status === 'calling')) {
          const duration = Math.floor((Date.now() - new Date(s.start_time).getTime()) / 1000)
          sessionStore.update(mss.sessionId, { status: 'completed', duration })
          sessionStore.saveToHistory(sessionStore.get(mss.sessionId))
        }
      }
    })
    ws.on('error', err => console.error('[WS] Error:', err.message))
  })

  console.log('[WS] Media-stream WebSocket ready at /ws/media-stream')
  return wss
}

module.exports = { setup }
