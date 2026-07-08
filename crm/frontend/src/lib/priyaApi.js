// ---------------------------------------------------------------------------
// Priya Calling System — frontend API client
// All calls go to /api/priya/* on the same backend as the rest of AdmitAI.
// ---------------------------------------------------------------------------
import axios from 'axios'

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '')

const client = axios.create({
  baseURL: `${BASE}/priya`,
  timeout: 30_000,
})

/** Start an outbound call session. */
export async function triggerCall({ phone, name, language, style, audience, gender }) {
  const { data } = await client.post('/trigger-call', { phone, name, language, style, audience, gender })
  return data  // { success, session_id, call_sid }
}

/** Poll session state — call every 2 s while status is calling/in-progress. */
export async function getSession(sessionId) {
  const { data } = await client.get(`/sessions/${sessionId}`)
  return data  // { session_id, step, step_index, collected, transcript, duration, status, detected_language }
}

/** Load call history (recent calls). */
export async function getCalls() {
  const { data } = await client.get('/calls')
  return data  // array of call summary objects
}

/** Full record for one call — transcript + collected — for the report view. */
export async function getCall(sessionId) {
  const { data } = await client.get(`/calls/${sessionId}`)
  return data
}
