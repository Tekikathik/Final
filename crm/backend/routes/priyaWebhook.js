// ---------------------------------------------------------------------------
// Twilio Webhook Routes — Priya Calling System
//
// KEY DESIGN:
//   call-start  → responds INSTANTLY with <Say> + <Record> (no external calls)
//   call-respond → downloads Twilio recording → Sarvam STT (auto lang detect)
//                  → translate to EN → Groq → translate back → Sarvam TTS
// ---------------------------------------------------------------------------
const router       = require('express').Router()
const axios        = require('axios')
const sessionStore = require('../services/sessionStore')
const sarvam       = require('../services/sarvam')
const priyaService = require('../services/priya')

// Download a Twilio recording as a WAV buffer using basic auth.
async function downloadRecording(recordingUrl) {
  const url = recordingUrl.endsWith('.wav') ? recordingUrl : `${recordingUrl}.wav`
  const res = await axios.get(url, {
    auth:         { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    responseType: 'arraybuffer',
    timeout:      6_000,
  })
  return Buffer.from(res.data)
}

// ---------------------------------------------------------------------------
// TwiML builders
// ---------------------------------------------------------------------------

function serverUrl() {
  return (process.env.SERVER_URL || 'http://localhost:5000').replace(/\/$/, '')
}

function sayAndGather(text, actionUrl) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${safe}</Say>
  <Gather input="speech" action="${actionUrl}" speechTimeout="3"></Gather>
</Response>`
}

// Play Priya's audio then record student response.
// maxLength="8": 8s is enough for any conversational reply; shorter recordings = faster STT.
// timeout="2": stop recording after 2s of silence instead of 3 — saves 1s every turn.
function playAndRecord(audioUrl, actionUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Record action="${actionUrl}" maxLength="8" timeout="2" playBeep="false" trim="trim-silence"/>
</Response>`
}

// Fallback when TTS fails — say text then record
function sayAndRecord(text, actionUrl) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${safe}</Say>
  <Record action="${actionUrl}" maxLength="8" timeout="2" playBeep="false" trim="trim-silence"/>
</Response>`
}

function sayAndHangup(text) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${safe}</Say><Hangup/></Response>`
}

function playAndHangup(audioUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${audioUrl}</Play><Hangup/></Response>`
}

// Try Sarvam TTS; fall back to <Say> text if it fails/times out.
// ttsTimeoutMs is derived from the shared 13s deadline so total never exceeds it.
async function ttsOrSay(text, session, sessionId, isEnd, ttsTimeoutMs = 5_000) {
  const action = `${serverUrl()}/webhook/call-respond`
  try {
    const filename = await Promise.race([
      sarvam.synthesize(text, session, sessionId),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TTS timeout')), ttsTimeoutMs)),
    ])
    const url = `${serverUrl()}/audio/${filename}`
    console.log('[Webhook] TTS audio:', url)
    return isEnd ? playAndHangup(url) : playAndRecord(url, action)
  } catch (err) {
    console.warn('[Webhook] TTS failed, using <Say>:', err.message)
    return isEnd ? sayAndHangup(text) : sayAndRecord(text, action)
  }
}

function detectLang(text) {
  if (/[ఀ-౿]/.test(text)) return 'te-IN'
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN'
  return 'en-IN'
}

// ---------------------------------------------------------------------------
// GET /webhook/test — confirm tunnel is reachable
// ---------------------------------------------------------------------------
router.get('/test', (_req, res) => {
  res.json({ ok: true, server: serverUrl(), time: new Date().toISOString() })
})

// ---------------------------------------------------------------------------
// POST /webhook/call-start
// Opens a Twilio Media Stream WebSocket — ALL audio flows over that socket.
// Greeting TTS + the full conversation pipeline runs inside mediaStream.js,
// eliminating the <Record> silence timeout (~2s) and the WAV download (~1s).
// ---------------------------------------------------------------------------
router.post('/call-start', (req, res) => {
  res.setHeader('Content-Type', 'text/xml')

  const sessionId = req.query.session_id
  const callSid   = req.body.CallSid

  console.log('[Webhook] call-start (stream mode) | session:', sessionId, '| CallSid:', callSid)

  try {
    const session = sessionStore.get(sessionId)
    if (session) {
      if (callSid) sessionStore.mapCallSid(callSid, sessionId)
      // Status + transcript will be updated by mediaStream.js when greeting plays
    } else {
      console.warn('[Webhook] call-start: session not found:', sessionId)
    }
  } catch (err) {
    console.error('[Webhook] call-start session update error (non-fatal):', err.message)
  }

  // <Say> speaks the greeting INSTANTLY (Twilio's own TTS, zero Sarvam latency).
  // <Connect><Stream> then starts the WebSocket so all subsequent turns use
  // Sarvam STT/TTS with the full pipeline. greet() in mediaStream.js only
  // updates session state — it does NOT call Sarvam TTS for the greeting.
  const wsUrl = serverUrl().replace(/^http/, 'ws') + '/ws/media-stream'
  const greeting = "Hi! I am Priya from Aditya University. Which language are you comfortable speaking in — Telugu, English, Hindi, or any other?"
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">${greeting}</Say>
  <Connect>
    <Stream url="${wsUrl}"/>
  </Connect>
</Response>`)
  console.log('[Webhook] call-start → greeting + streaming to', wsUrl)
})

// ---------------------------------------------------------------------------
// POST /webhook/call-respond
// Fired by Twilio after <Record> stops. Downloads the WAV, runs Sarvam STT
// (auto language detect), translates if needed, calls Groq, translates reply,
// synthesises TTS audio, responds with <Play> + <Record> for next turn.
//
// Time budget: 14s hard limit (Twilio kills at 15s, 1s network headroom).
//   download     : 5s max  (Twilio recordings available in 1-3s typically)
//   STT          : 6s max  (8s recording → ~2s Sarvam processing)
//   translate-in : 3s max  (non-English only)
//   Groq         : dynamic headroom (100 max tokens → sub-second)
//   translate-out: 3s max  (non-English only)
//   TTS          : whatever remains (min 1.5s)
// ---------------------------------------------------------------------------
router.post('/call-respond', async (req, res) => {
  res.setHeader('Content-Type', 'text/xml')

  const t0               = Date.now()
  const ms               = () => `+${Date.now() - t0}ms`
  const callSid          = req.body.CallSid
  const recordingUrl     = req.body.RecordingUrl || ''
  const recordingDuration = parseInt(req.body.RecordingDuration || '0', 10)
  const deadline         = t0 + 14_000

  console.log(`\n[LATENCY] ── call-respond START ── recDuration:${recordingDuration}s`)

  const session = sessionStore.getByCallSid(callSid)
  if (!session) {
    console.error('[Webhook] call-respond: no session for CallSid:', callSid)
    return res.send(sayAndHangup('Sorry, session not found. Goodbye.'))
  }

  const sessionId = session.session_id

  try {
    const preferredLang  = session.preferred_language || null
    let detectedLanguage = preferredLang || session.detected_language || 'en-IN'
    let studentText      = '(silence)'

    // ── 1. DOWNLOAD ──────────────────────────────────────────────────────────
    if (recordingUrl && recordingDuration >= 1) {
      try {
        const t1 = Date.now()
        const audioBuffer = await Promise.race([
          downloadRecording(recordingUrl),
          new Promise((_, rej) => setTimeout(() => rej(new Error('download timeout')), 5_000)),
        ])
        console.log(`[LATENCY] 1. Download     ${Date.now()-t1}ms  (${ms()} total)`)

        // ── 2. STT ───────────────────────────────────────────────────────────
        const t2 = Date.now()
        const sttResult = await Promise.race([
          sarvam.transcribe(audioBuffer, preferredLang),
          new Promise((_, rej) => setTimeout(() => rej(new Error('STT timeout')), 6_000)),
        ])
        console.log(`[LATENCY] 2. STT          ${Date.now()-t2}ms  (${ms()} total) lang:${sttResult.language_code}`)
        studentText = sttResult.transcript || '(silence)'
        if (!preferredLang) detectedLanguage = sttResult.language_code || detectedLanguage

      } catch (err) {
        console.warn(`[LATENCY] Download/STT FAILED (${ms()}):`, err.message)
        studentText = '(could not transcribe)'
      }
    }

    if (studentText === '(silence)' || studentText === '(could not transcribe)') {
      const action = `${serverUrl()}/webhook/call-respond`
      return res.send(sayAndRecord('Sorry, I could not hear you. Could you please repeat?', action))
    }

    sessionStore.update(sessionId, { detected_language: detectedLanguage })
    const s1 = sessionStore.get(sessionId)
    sessionStore.update(sessionId, {
      transcript: [...s1.transcript, { role: 'Student', text: studentText, timestamp: new Date().toISOString() }],
    })

    // ── 3. TRANSLATE-IN (non-English only) ───────────────────────────────────
    const needsTranslation = detectedLanguage !== 'en-IN'
    const translateOpts = {
      style:          session.style    || 'modern_colloquial',
      speaker_gender: session.gender   || 'Female',
      numerals:       session.audience === 'domestic' ? 'native' : 'international',
    }
    let englishText = studentText
    if (needsTranslation) {
      try {
        const t3 = Date.now()
        englishText = await Promise.race([
          sarvam.translate(studentText, detectedLanguage, 'en-IN', { ...translateOpts, style: 'modern_colloquial' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('translate-in timeout')), 3_000)),
        ])
        console.log(`[LATENCY] 3. Translate-in ${Date.now()-t3}ms  (${ms()} total)`)
      } catch (err) {
        console.warn(`[LATENCY] Translate-in FAILED (${ms()}):`, err.message)
      }
    } else {
      console.log(`[LATENCY] 3. Translate-in SKIPPED (English)  (${ms()} total)`)
    }

    // ── 4. GROQ LLM ──────────────────────────────────────────────────────────
    let reply, step, step_index, collected
    try {
      const t4      = Date.now()
      const priyaMs = Math.min(5_000, Math.max(1_000, deadline - Date.now() - 2_000))
      const result  = await Promise.race([
        priyaService.callPriyaAPI(sessionId, englishText),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Priya timeout')), priyaMs)),
      ])
      console.log(`[LATENCY] 4. Groq LLM     ${Date.now()-t4}ms  (${ms()} total)`)
      reply      = result.reply      || 'Thank you. Could you please tell me more?'
      step       = result.step       || s1.step
      step_index = result.step_index ?? s1.step_index
      collected  = result.collected  || {}
    } catch (err) {
      console.warn(`[LATENCY] Groq FAILED (${ms()}):`, err.message)
      reply      = 'Thank you for that. Please go on.'
      step       = s1.step
      step_index = s1.step_index
      collected  = {}
    }

    const ttsReply = reply  // Groq replies in student's language — no translate-out needed

    const s2 = sessionStore.get(sessionId)
    sessionStore.update(sessionId, {
      step, step_index,
      collected:  { ...s2.collected, ...collected },
      transcript: [...s2.transcript, { role: 'Priya', text: reply, timestamp: new Date().toISOString() }],
    })

    // ── 5. TTS ───────────────────────────────────────────────────────────────
    const t5      = Date.now()
    const isEnd   = step === 'end' || step_index >= 11
    const finalSess = sessionStore.get(sessionId)
    const ttsMs   = Math.max(2_000, deadline - Date.now() - 500)
    const twiml   = await ttsOrSay(ttsReply, finalSess, sessionId, isEnd, ttsMs)
    console.log(`[LATENCY] 5. TTS          ${Date.now()-t5}ms  (${ms()} total)`)

    res.send(twiml)
    console.log(`[LATENCY] ── DONE  total=${ms()}  step:${step}  msLeft:${deadline-Date.now()} ──\n`)

  } catch (err) {
    console.error(`[LATENCY] FATAL (${ms()}):`, err.message)
    const action = `${serverUrl()}/webhook/call-respond`
    res.send(sayAndRecord('Sorry, something went wrong. Could you please repeat?', action))
  }
})

// ---------------------------------------------------------------------------
// POST /webhook/call-status
// ---------------------------------------------------------------------------
router.post('/call-status', (req, res) => {
  const sessionId    = req.query.session_id
  const callStatus   = req.body.CallStatus || ''
  const callDuration = parseInt(req.body.CallDuration || '0', 10)

  console.log('[Webhook] call-status:', callStatus, '| duration:', callDuration)

  try {
    const session = sessionStore.get(sessionId)
    if (session) {
      const map = { completed:'completed', failed:'failed', busy:'failed', 'no-answer':'failed', canceled:'failed' }
      sessionStore.update(sessionId, { status: map[callStatus] || session.status, duration: callDuration })
      sessionStore.saveToHistory(sessionStore.get(sessionId))
    }
  } catch (err) {
    console.error('[Webhook] call-status error:', err.message)
  }

  res.sendStatus(200)
})

module.exports = router
