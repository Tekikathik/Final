// ---------------------------------------------------------------------------
// Outbound-call launcher — the ONE place a Priya voice call is started from.
//
// Used by BOTH entry points:
//   • POST /api/priya/trigger-call   (Priya dashboard — single number)
//   • POST /api/calls/trigger        (CRM Trigger Campaign — via telephony.dispatchCall)
//
// It creates the live session (sessionStore), dials via LiveKit (or Twilio),
// and — when no voice engine is reachable — runs the built-in mock conversation
// so the full pipeline (transcript → collected → summary → report) still works.
// Post-call: analyzeAndStore() turns the transcript into a summary/disposition
// and mirrors everything onto the CRM Call doc (matched by sessionId).
// ---------------------------------------------------------------------------
const { v4: uuidv4 } = require('uuid')
const sessionStore    = require('./sessionStore')
const twilioOutbound  = require('./twilioOutbound')
const livekitOutbound = require('./livekitOutbound')
const priyaService    = require('./priya')
const { analyzeCall } = require('./callAnalysis')
const Call = require('../models/Call')

// 'livekit' (default) routes through the LiveKit Priya agent over SIP;
// 'twilio' keeps the legacy in-Node Sarvam/Groq media-stream pipeline.
const VOICE_ENGINE = (process.env.VOICE_ENGINE || 'livekit').toLowerCase()

// ---------------------------------------------------------------------------
// Mock simulation — runs in the background when no voice engine is configured.
// Calls Priya API with realistic student responses so the dashboard shows a
// live conversation without needing a real phone call.
// ---------------------------------------------------------------------------
const MOCK_STUDENT_REPLIES = [
  'My name is Rahul Sharma',
  'I got 85 percent in 10th',
  'Inter marks are 78 percent',
  'I am interested in B.Tech Computer Science',
  'What are the fee details?',
  'Have I appeared in JEE? Yes, I got 120 marks',
  'Is there any scholarship available?',
  'I am from Hyderabad',
  'Do you have bus facility from Ameerpet?',
  'No more questions, thank you',
]

// Fallback script used when the Priya LLM API is unreachable (503 / offline).
// Each entry: [priya_reply, step_name, step_index, collected_patch]
const FALLBACK_SCRIPT = [
  ['Namaste! I am Priya from Aditya University admissions. May I know your good name please?',
    'name', 0, {}],
  ['Thank you! Could you please share your 10th class percentage?',
    '10th', 1, { name: 'Rahul Sharma' }],
  ['That\'s great! And what percentage did you score in Intermediate / 12th?',
    'inter', 2, { marks_10: '85' }],
  ['Excellent! Which course are you interested in at our university?',
    'course', 3, { marks_inter: '78' }],
  ['Good choice! Our B.Tech CSE program is excellent. Shall I share the fee details?',
    'fee', 4, { interest: 'B.Tech Computer Science' }],
  ['The annual tuition fee is ₹1.2 Lakhs with hostel at ₹80K. Have you appeared in any entrance exam?',
    'exam', 5, {}],
  ['Good score! Based on your JEE rank you may qualify for a merit scholarship. Shall I check?',
    'scholarship', 6, {}],
  ['You may be eligible for up to 30% scholarship. Where are you currently located?',
    'location', 7, {}],
  ['We have bus facility from Hyderabad, Vijayawada and Rajahmundry. Do you need transport?',
    'transport', 8, { location: 'Hyderabad' }],
  ['Transport pass is available at ₹18K per year. Do you have any other questions?',
    'queries', 9, {}],
  ['I\'ll send the complete brochure and fee structure to your WhatsApp. Our team will follow up in 24 hours. Thank you!',
    'end', 11, {}],
]

async function callPriyaWithFallback(sessionId, message, fallbackIndex) {
  try {
    const data = await priyaService.callPriyaAPI(sessionId, message)
    if (data && data.reply) return { ...data, usedFallback: false }
  } catch (err) {
    console.warn(`[MockSim] Priya API unavailable (${err.message}), using fallback script`)
  }
  const [reply, step, step_index, collected] = FALLBACK_SCRIPT[Math.min(fallbackIndex, FALLBACK_SCRIPT.length - 1)]
  return { reply, step, step_index, collected, usedFallback: true }
}

// ---------------------------------------------------------------------------
// Post-call AI analysis — summary + disposition + sentiment from the transcript,
// stored on the session AND the persisted history, then mirrored onto the CRM
// Call doc (same fields the manual POST /api/calls/:id/analyze sets).
// ---------------------------------------------------------------------------
async function analyzeAndStore(sessionId) {
  const session = sessionStore.get(sessionId)
  if (!session || session.summary) return                  // gone or already analyzed
  if ((session.transcript || []).length < 2) return        // no real conversation to analyze
  const out = await analyzeCall({ transcript: session.transcript })
  if (!out.analyzed) return                                // all LLM providers down — leave blank
  sessionStore.update(sessionId, {
    summary:     out.summary,
    disposition: out.disposition,
    sentiment:   out.sentiment,
    interested:  out.interested,
  })
  sessionStore.saveToHistory(sessionStore.get(sessionId))  // re-persist WITH the analysis
  console.log(`[Priya] post-call analysis (${out.provider}): ${out.disposition || 'n/a'} — ${out.summary.slice(0, 80)}`)

  try {
    const call = await Call.findOne({ sessionId })
    if (call) {
      if (out.summary)          call.summary     = out.summary
      if (out.disposition)      call.disposition = out.disposition
      if (out.sentiment)        call.sentiment   = out.sentiment
      if (out.interested != null) call.interested = out.interested
      call.aiAnalyzed = true
      await call.save()
    }
  } catch (e) { console.warn('[Priya] CRM analysis mirror failed:', e.message) }
}

// Mirror a finished session's full state onto its CRM Call doc. The LiveKit path
// streams this live via /api/priya/agent-event, but the MOCK simulation writes only
// to the in-memory session — this sync makes campaign calls report-able either way.
async function syncSessionToCall(sessionId) {
  const s = sessionStore.get(sessionId)
  if (!s) return
  try {
    const call = await Call.findOne({ sessionId })
    if (!call) return
    call.transcript = (s.transcript || []).map(t => ({ role: t.role, text: t.text, timestamp: new Date(t.timestamp) }))
    call.collected = { ...(s.collected || {}) }
    call.markModified('collected')
    call.status = s.status === 'completed' ? 'completed' : call.status
    if (s.duration != null) call.duration = s.duration
    call.endedAt = call.endedAt || new Date()
    call.connected = true
    if (s.detected_language) call.detectedLanguage = s.detected_language
    if (s.summary) {
      call.summary = s.summary
      call.disposition = s.disposition || call.disposition
      call.sentiment = s.sentiment || call.sentiment
      if (s.interested != null) call.interested = s.interested
      call.aiAnalyzed = true
    }
    await call.save()
  } catch (e) { console.warn('[callLauncher] session→Call sync failed:', e.message) }
}

async function runMockSimulation(sessionId) {
  const delay = ms => new Promise(r => setTimeout(r, ms))

  try {
    await delay(2000)                                       // simulate ring delay
    sessionStore.update(sessionId, { status: 'in-progress', detected_language: 'en-IN' })

    // Turn 0 — opening greeting
    let fallbackIdx = 0
    let priyaRes = await callPriyaWithFallback(sessionId, 'Hello', fallbackIdx)
    let { reply, step, step_index, collected } = priyaRes
    let session = sessionStore.get(sessionId)

    sessionStore.update(sessionId, {
      step, step_index,
      collected: { ...session.collected, ...collected },
      transcript: [
        ...session.transcript,
        { role: 'Priya', text: reply, timestamp: new Date().toISOString() },
      ],
    })

    // Walk through mock student replies turn by turn
    for (const studentText of MOCK_STUDENT_REPLIES) {
      await delay(3500)
      session = sessionStore.get(sessionId)
      if (!session || session.status !== 'in-progress') break

      sessionStore.update(sessionId, {
        transcript: [
          ...sessionStore.get(sessionId).transcript,
          { role: 'Student', text: studentText, timestamp: new Date().toISOString() },
        ],
      })

      await delay(1200)
      session = sessionStore.get(sessionId)
      if (!session || session.status !== 'in-progress') break

      fallbackIdx++
      priyaRes = await callPriyaWithFallback(sessionId, studentText, fallbackIdx)
      ;({ reply, step, step_index, collected } = priyaRes)

      const s = sessionStore.get(sessionId)
      sessionStore.update(sessionId, {
        step, step_index,
        collected: { ...s.collected, ...collected },
        transcript: [
          ...s.transcript,
          { role: 'Priya', text: reply, timestamp: new Date().toISOString() },
        ],
      })

      if (step === 'end' || step_index >= 11) break
    }

    // Finalise: complete the session, analyze it, and sync everything onto the
    // CRM Call doc so the report view has the real conversation.
    await delay(2000)
    const final = sessionStore.get(sessionId)
    if (final) {
      const duration = Math.floor((Date.now() - new Date(final.start_time).getTime()) / 1000)
      sessionStore.update(sessionId, { status: 'completed', duration })
      sessionStore.saveToHistory(sessionStore.get(sessionId))
      console.log(`[MockSim] Session ${sessionId} completed (${duration}s)`)
      try { await analyzeAndStore(sessionId) }
      catch (e) { console.warn('[MockSim] post-call analysis failed:', e.message) }
      await syncSessionToCall(sessionId)
    }
  } catch (err) {
    console.error('[MockSim] Fatal error:', err.message)
    sessionStore.update(sessionId, { status: 'failed' })
    await syncSessionToCall(sessionId)
  }
}

// ---------------------------------------------------------------------------
// launchOutboundCall — create the session, dial (LiveKit/Twilio), fall back to
// the mock simulation when no engine is reachable. Returns { sessionId, callSid,
// mock, phone }. Pass `sessionId` to pre-link it (e.g. saved on a Call doc first).
// ---------------------------------------------------------------------------
async function launchOutboundCall({
  phone, name = '', preferredLanguage = null,
  style = 'modern_colloquial', audience = 'international',
  gender = 'Female', smartMode = false, sessionId = null,
}) {
  // Normalise to E.164 +91XXXXXXXXXX format
  const digits = String(phone).trim().replace(/\s+/g, '').replace(/^\+?91/, '').replace(/^0/, '')
  const normalizedPhone = `+91${digits}`

  const sid = sessionId || uuidv4()
  sessionStore.create(sid, {
    phone: normalizedPhone,
    name:               name || null,
    preferred_language: preferredLanguage,                  // null = auto-detect
    detected_language:  preferredLanguage || 'en-IN',
    style, audience, gender,
    smart_mode: Boolean(smartMode),
  })

  let callSid = null
  let mock = false
  try {
    const outbound = VOICE_ENGINE === 'twilio' ? twilioOutbound : livekitOutbound
    const call = await outbound.makeOutboundCall({
      to: normalizedPhone, sessionId: sid, name: name || null,
      language: preferredLanguage, style, audience, gender,
    })
    callSid = call.sid
    sessionStore.mapCallSid(callSid, sid)
  } catch (err) {
    console.warn(`[callLauncher] ${VOICE_ENGINE} not available — running in mock mode:`, err.message)
    callSid = `mock-${Date.now()}`
    mock = true
    sessionStore.update(sid, { call_sid: callSid, status: 'calling' })
    runMockSimulation(sid)          // fire-and-forget: full fake conversation
  }
  return { sessionId: sid, callSid, mock, phone: normalizedPhone }
}

module.exports = { launchOutboundCall, runMockSimulation, analyzeAndStore, syncSessionToCall }
