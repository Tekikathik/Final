// ---------------------------------------------------------------------------
// Priya Admin API Routes
//
//  POST /api/priya/trigger-call   — start a new session + Twilio outbound call
//  GET  /api/priya/sessions/:id   — poll session state (step, transcript, etc.)
//  GET  /api/priya/calls          — last 20 completed calls (call history)
// ---------------------------------------------------------------------------
const router       = require('express').Router()
const sessionStore = require('../services/sessionStore')
// Shared launcher — the same code path the CRM Trigger Campaign uses
// (services/telephony.js), so both entry points behave identically.
const { launchOutboundCall, analyzeAndStore } = require('../services/callLauncher')
const { sendPostCallFollowUp } = require('../services/postCallFollowup')

// Map UI dropdown labels → API values
// 'Auto detect' maps to null so STT can detect freely; explicit selections are "locked"
const LANGUAGE_MAP = {
  English:       'en-IN',
  Telugu:        'te-IN',
  Hindi:         'hi-IN',
  'Auto detect': null,
}
const STYLE_MAP = {
  'Modern Colloquial': 'modern_colloquial',
  Formal:              'formal',
  Classic:             'classic',
}
const AUDIENCE_MAP = {
  International: 'international',
  Domestic:      'domestic',
}

// ---------------------------------------------------------------------------
// POST /api/priya/trigger-call — delegates to the shared launcher (LiveKit /
// Twilio / mock-simulation fallback all live in services/callLauncher.js).
// ---------------------------------------------------------------------------
router.post('/trigger-call', async (req, res) => {
  try {
    const {
      phone,
      name       = '',
      language   = 'Auto detect',
      style      = 'Modern Colloquial',
      audience   = 'International',
      gender     = 'Female',
      smart_mode = false,
    } = req.body

    if (!phone) return res.status(400).json({ message: 'phone is required' })

    const { sessionId, callSid, mock } = await launchOutboundCall({
      phone,
      name,
      preferredLanguage: LANGUAGE_MAP[language] ?? null,   // null = auto-detect
      style:    STYLE_MAP[style]       || 'modern_colloquial',
      audience: AUDIENCE_MAP[audience] || 'international',
      gender,
      smartMode: Boolean(smart_mode),
    })
    res.json({ success: true, session_id: sessionId, call_sid: callSid, mock })
  } catch (err) {
    console.error('[Priya] trigger-call error:', err)
    res.status(500).json({ message: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/priya/agent-event
// Live updates pushed by the LiveKit Priya agent (priya-livekit/agent.py) as a
// call progresses. Mirrors what priyaWebhook.js does for the Twilio pipeline, so
// the dashboard's session polling shows the LiveKit call live with no UI change.
//
// Body: { session_id, type, ... }
//   type 'transcript' : { role:'user'|'assistant', text, detected_language? }
//   type 'detail'     : { field, value }            // a save_detail from the agent
//   type 'status'     : { status, duration?, detected_language? }
// ---------------------------------------------------------------------------

// LiveKit save_detail field → the dashboard's collected key (ConversationStats panel)
const LK_FIELD_TO_COLLECTED = {
  student_name:        'name',
  class_10_score:      'marks_10',
  class_12_score:      'marks_inter',
  program_of_interest: 'interest',
  current_city:        'location',
  visit_datetime:      'booked_time',   // slot booked on the call → post-call WhatsApp/SMS
}
// LiveKit flow field → [dashboard step label, step_index] for the StepProgressBar
const LK_FIELD_TO_STEP = {
  student_name:         ['name', 1],
  class_10_score:       ['10th', 2],
  class_12_score:       ['inter', 3],
  program_of_interest:  ['course', 4],
  entrance_exams_taken: ['exam', 6],
  current_city:         ['location', 8],
  questions_asked:      ['queries', 10],
  call_outcome:         ['end', 11],
}

router.post('/agent-event', async (req, res) => {
  const { session_id, type } = req.body || {}
  const session = sessionStore.get(session_id)
  if (!session) return res.status(404).json({ message: 'Session not found' })

  try {
    if (type === 'transcript') {
      const role = (req.body.role === 'user' || req.body.role === 'Student') ? 'Student' : 'Priya'
      const text = String(req.body.text || '').trim()
      const patch = {}
      // First spoken turn flips a 'calling' session to 'in-progress'.
      if (session.status === 'calling') patch.status = 'in-progress'
      if (req.body.detected_language) patch.detected_language = req.body.detected_language
      if (text) {
        patch.transcript = [...session.transcript,
          { role, text, timestamp: new Date().toISOString() }]
      }
      sessionStore.update(session_id, patch)

    } else if (type === 'detail') {
      const field = req.body.field
      const value = req.body.value
      const collected = { ...session.collected, [field]: value }
      const mapped = LK_FIELD_TO_COLLECTED[field]
      if (mapped) collected[mapped] = value
      const patch = { collected }
      const stepInfo = LK_FIELD_TO_STEP[field]
      if (stepInfo && stepInfo[1] > (session.step_index || 0)) {
        patch.step       = stepInfo[0]
        patch.step_index = stepInfo[1]
      }
      sessionStore.update(session_id, patch)

    } else if (type === 'status') {
      const status = req.body.status      // in-progress | completed | failed
      const patch  = {}
      if (status) patch.status = status
      if (req.body.duration != null)        patch.duration          = req.body.duration
      if (req.body.detected_language)        patch.detected_language = req.body.detected_language
      sessionStore.update(session_id, patch)
      if (status === 'completed' || status === 'failed') {
        sessionStore.saveToHistory(sessionStore.get(session_id))
        // Post-call summary — generated in the BACKGROUND so the agent's report is
        // acked instantly; the dashboard keeps polling briefly after the call ends
        // and shows the summary the moment it lands.
        analyzeAndStore(session_id)
          .catch(e => console.warn('[Priya] post-call analysis failed:', e.message))
      }
      // Completed call → WhatsApp/SMS follow-up with the caller's name + booked
      // time (background, deduped so a repeated status event can't double-send).
      if (status === 'completed' && !session.followup) {
        sessionStore.update(session_id, { followup: { status: 'sending' } })
        sendPostCallFollowUp(sessionStore.get(session_id))
          .then(r => sessionStore.update(session_id, { followup: r }))
          .catch(e => {
            console.warn('[Priya] follow-up message failed:', e.message)
            sessionStore.update(session_id, { followup: { status: 'failed', detail: e.message } })
          })
      }
    }

    // Mirror onto the durable CRM Call/Lead records. Awaited so the write is
    // persisted before we ack; a mirror failure must not fail the agent's report.
    try { await mirrorToCrm(session_id, type, req.body) }
    catch (e) { console.warn('[Priya] CRM mirror failed:', e.message) }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Priya] agent-event error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// Reconcile a live agent event onto the Call doc (and Lead on completion), so the
// CRM has durable per-call transcript/outcome/duration beyond the in-memory store.
const Call = require('../models/Call')
const Lead = require('../models/Lead')
async function mirrorToCrm(sessionId, type, body) {
  const call = await Call.findOne({ sessionId })
  if (!call) return  // not a CRM-triggered call (e.g. legacy Priya dashboard call)

  if (type === 'transcript') {
    const role = (body.role === 'user' || body.role === 'Student') ? 'Student' : 'Priya'
    const text = String(body.text || '').trim()
    if (text) call.transcript.push({ role, text, timestamp: new Date() })
    if (body.detected_language) call.detectedLanguage = body.detected_language
    if (call.status === 'scheduled') { call.status = 'in_progress'; call.startedAt = new Date(); call.connected = true }
    await call.save()

  } else if (type === 'detail') {
    // save_detail from the agent → persist on the Call so the report's student
    // profile (marks, program, city…) survives beyond the in-memory session.
    if (body.field) {
      call.collected = { ...(call.collected || {}), [body.field]: body.value }
      call.markModified('collected')
      await call.save()
    }

  } else if (type === 'status') {
    const s = body.status
    if (s === 'in-progress') { call.status = 'in_progress'; call.startedAt = call.startedAt || new Date(); call.connected = true }
    else if (s === 'completed' || s === 'failed') {
      call.status = s === 'completed' ? 'completed' : 'failed'
      call.endedAt = new Date()
      if (body.duration != null) call.duration = body.duration
      if (call.connected == null) call.connected = s === 'completed'
    }
    if (body.detected_language) call.detectedLanguage = body.detected_language
    await call.save()
  }
}

// ---------------------------------------------------------------------------
// POST /api/priya/reengage-sweep — run the re-engagement sweep NOW (testing /
// manual trigger). Same logic the daily cron runs: interested-but-silent
// students overdue by REENGAGE_AFTER_DAYS get a warm follow-up call.
// ---------------------------------------------------------------------------
router.post('/reengage-sweep', async (_req, res) => {
  try {
    const { runReEngagementSweep } = require('../services/reEngagement')
    const placed = await runReEngagementSweep()
    res.json({ ok: true, placed })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ---------------------------------------------------------------------------
// POST /api/priya/reengage-one  { phone } — re-engage ONE number RIGHT NOW,
// ignoring the 7-day gate. For "call this student back now" + testing on your
// own mobile. Uses that number's most recent call for the known data.
// ---------------------------------------------------------------------------
router.post('/reengage-one', async (req, res) => {
  try {
    const { reEngagePhone } = require('../services/reEngagement')
    const r = await reEngagePhone(req.body?.phone)
    res.status(r.ok ? 200 : 404).json(r)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ---------------------------------------------------------------------------
// GET /api/priya/sessions/:session_id
// ---------------------------------------------------------------------------
router.get('/sessions/:session_id', (req, res) => {
  const session = sessionStore.get(req.params.session_id)
  if (!session) return res.status(404).json({ message: 'Session not found' })

  const isActive = session.status === 'calling' || session.status === 'in-progress'
  const duration = isActive
    ? Math.floor((Date.now() - new Date(session.start_time).getTime()) / 1000)
    : session.duration

  res.json({
    session_id:        session.session_id,
    call_sid:          session.call_sid,
    step:              session.step,
    step_index:        session.step_index,
    collected:         session.collected,
    transcript:        session.transcript,
    duration,
    status:            session.status,
    detected_language: session.detected_language,
    // Post-call analysis — null until analyzeAndStore finishes (a few seconds
    // after completion); the dashboard keeps polling briefly to pick these up.
    summary:           session.summary     || null,
    disposition:       session.disposition || null,
    sentiment:         session.sentiment   || null,
  })
})

// ---------------------------------------------------------------------------
// GET /api/priya/calls  — call history (last 50)
// ---------------------------------------------------------------------------
router.get('/calls', (_req, res) => {
  try {
    res.json(sessionStore.getRecentCalls(50))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/priya/calls/:id  — full record for one call (transcript + collected),
// for the call report view.
// ---------------------------------------------------------------------------
router.get('/calls/:id', (req, res) => {
  try {
    const call = sessionStore.getCallById(req.params.id)
    if (!call) return res.status(404).json({ message: 'Call not found' })
    res.json({
      session_id:        call.session_id,
      name:              call.collected?.student_name || call.collected?.parent_name || call.name || 'Unknown',
      phone:             call.phone,
      status:            call.status,
      duration:          call.duration || 0,
      started_at:        call.started_at || call.start_time,
      detected_language: call.detected_language,
      collected:         call.collected || {},
      transcript:        call.transcript || [],
      summary:           call.summary     || null,
      disposition:       call.disposition || null,
      sentiment:         call.sentiment   || null,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
