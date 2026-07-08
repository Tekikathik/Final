// ---------------------------------------------------------------------------
// Priya LiveKit outbound service — the LiveKit equivalent of twilioOutbound.js.
//
// Instead of asking Twilio to run a TwiML <Stream> pipeline, this:
//   1. dispatches the "priya" LiveKit agent (priya-livekit/agent.py) into a room,
//      passing the session id + a report URL + per-call voice settings as metadata
//   2. dials the student into that room over the LiveKit SIP outbound trunk
//
// The Python agent then streams live transcript / collected fields / status back
// to  POST /api/priya/agent-event,  so the existing dashboard polling is unchanged.
//
// Prereqs (same as priya-livekit/make_call.py):
//   • LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET in .env
//   • OUTBOUND_TRUNK_ID — a LiveKit outbound trunk (see create_outbound_trunk.py)
//   • the agent worker running:  python agent.py dev
// When these are missing, makeOutboundCall throws — and trigger-call falls back
// to mock mode exactly like it did for Twilio.
// ---------------------------------------------------------------------------
const { AgentDispatchClient, SipClient } = require('livekit-server-sdk')

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME || 'priya'

// The server SDK speaks http(s); the agent/.env URL is usually ws(s)://…
function livekitHost() {
  const url = process.env.LIVEKIT_URL
  if (!url) throw new Error('LIVEKIT_URL not set in .env')
  return url.replace(/^ws/, 'http')
}

function assertConfigured() {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    throw new Error('LiveKit credentials not configured (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET)')
  }
  if (!process.env.OUTBOUND_TRUNK_ID) {
    throw new Error('OUTBOUND_TRUNK_ID not set — create a LiveKit outbound trunk first '
      + '(see priya-livekit/create_outbound_trunk.py)')
  }
}

/**
 * Dispatch Priya + dial `to` for the given session.
 * Returns a Twilio-call-like shape ({ sid }) so trigger-call can treat the room
 * name as the call id and map it back to the session.
 */
async function makeOutboundCall({ to, sessionId, name, language, style, audience, gender }) {
  assertConfigured()

  const host   = livekitHost()
  const key    = process.env.LIVEKIT_API_KEY
  const secret = process.env.LIVEKIT_API_SECRET
  const trunk  = process.env.OUTBOUND_TRUNK_ID

  // Unique room per call; doubles as the call id for session ↔ call mapping.
  const room = `priya-${sessionId}`

  // Where the agent POSTs live transcript / collected / status back to.
  const reportUrl = (process.env.PRIYA_AGENT_REPORT_URL || process.env.SERVER_URL || 'http://localhost:5000')
    .replace(/\/$/, '')

  const metadata = JSON.stringify({
    session_id:         sessionId,
    report_url:         reportUrl,
    name:               name || '',
    preferred_language: language || null,   // null = auto-detect
    style:              style    || 'modern_colloquial',
    audience:           audience || 'international',
    gender:             gender   || 'Female',
  })

  console.log('[LiveKit] >>> dispatching', AGENT_NAME, 'to room', room, '| calling', to)

  // 1) Put Priya in the room first, so she's ready the instant they answer.
  const dispatchClient = new AgentDispatchClient(host, key, secret)
  await dispatchClient.createDispatch(room, AGENT_NAME, { metadata })

  // 2) Dial the number into that room through the LiveKit (Twilio) outbound trunk.
  //    waitUntilAnswered=false → return immediately; the dashboard polls and the
  //    agent reports status (in-progress / completed) as the call progresses.
  const sipClient = new SipClient(host, key, secret)
  await sipClient.createSipParticipant(trunk, to, room, {
    participantIdentity: 'phone_user',
    participantName:     name || 'Prospect',
    waitUntilAnswered:   false,
  })

  console.log('[LiveKit] Call dispatched | room:', room, '| to:', to)
  return { sid: room, room }
}

module.exports = { makeOutboundCall }
