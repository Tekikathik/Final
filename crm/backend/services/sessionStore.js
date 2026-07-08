const fs   = require('fs')
const path = require('path')

// ---------------------------------------------------------------------------
// In-memory session store.  sessions[session_id] = full session object.
// callSidMap[CallSid] = session_id for reverse-lookup when Twilio webhooks
// arrive with only the CallSid.
// ---------------------------------------------------------------------------
const sessions   = {}
const callSidMap = {}

const DB_PATH = path.join(__dirname, '..', 'db', 'priya-calls.json')

function ensureDb() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir))  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]')
}

function loadHistory() {
  ensureDb()
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) }
  catch { return [] }
}

// ---------------------------------------------------------------------------
// Create a new session.  All voice-style settings come from the trigger-call
// request; collected data starts empty.
// ---------------------------------------------------------------------------
function create(sessionId, data) {
  sessions[sessionId] = {
    session_id:        sessionId,
    call_sid:          null,
    phone:             data.phone,
    name:              data.name  || null,
    status:            'calling',
    preferred_language: data.preferred_language ?? null,   // locked admin choice; null = auto
    detected_language:  data.detected_language  || 'en-IN',
    style:             data.style      || 'modern_colloquial',
    audience:          data.audience   || 'international',
    gender:            data.gender     || 'Female',
    smart_mode:        data.smart_mode || false,
    step:              'greeting',
    step_index:        0,
    collected: {
      name:       data.name || null,
      marks_10:   null,
      marks_inter:null,
      interest:   null,
      location:   null,
    },
    transcript:  [],
    // Full tool-call context for the agentic path (PRIYA_AGENTIC=true) — user
    // messages, assistant tool_calls messages, and tool results. Memory-only,
    // capped at ~30 entries by groqService, not written to saveToHistory.
    agent_messages: [],
    start_time:  new Date().toISOString(),
    duration:    0,
  }
  return sessions[sessionId]
}

function get(sessionId) {
  return sessions[sessionId] || null
}

function getByCallSid(callSid) {
  const id = callSidMap[callSid]
  return id ? sessions[id] : null
}

function mapCallSid(callSid, sessionId) {
  callSidMap[callSid] = sessionId
  if (sessions[sessionId]) sessions[sessionId].call_sid = callSid
}

function update(sessionId, patch) {
  if (sessions[sessionId]) {
    sessions[sessionId] = { ...sessions[sessionId], ...patch }
  }
}

// Persist a finished/updated session to the JSON file for call history.
function saveToHistory(session) {
  ensureDb()
  const history = loadHistory()
  const filtered = history.filter(c => c.session_id !== session.session_id)
  filtered.unshift({
    session_id:       session.session_id,
    phone:            session.phone,
    name:             session.collected?.student_name || session.collected?.parent_name || session.collected?.name || session.name || 'Unknown',
    started_at:       session.start_time,
    duration:         session.duration || 0,
    steps_completed:  session.step_index || 0,
    status:           session.status,
    detected_language: session.detected_language,
    collected:        session.collected || {},
    transcript:       session.transcript || [],
    // Post-call AI analysis (routes/priya.js runs it automatically on completion).
    summary:          session.summary     || null,
    disposition:      session.disposition || null,
    sentiment:        session.sentiment   || null,
    interested:       session.interested ?? null,
  })
  // Keep the most recent 100 calls
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(filtered.slice(0, 100), null, 2))
  } catch (err) {
    console.error('[SessionStore] Failed to write call history:', err.message)
  }
}

function getRecentCalls(limit = 20) {
  return loadHistory().slice(0, limit)
}

// Full record for one call — the live in-memory session (freshest transcript) if
// it's still around, else the persisted history record (survives restarts).
function getCallById(sessionId) {
  return sessions[sessionId] || loadHistory().find(c => c.session_id === sessionId) || null
}

module.exports = { create, get, getByCallSid, mapCallSid, update, saveToHistory, getRecentCalls, getCallById }
