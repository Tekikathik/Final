/**
 * Campaign-call dispatch.
 *
 * DEFAULT (VOICE_ENGINE=livekit/twilio): calls go through the SAME Priya
 * pipeline as the dashboard's trigger-call — services/callLauncher.js dials via
 * LiveKit SIP (or Twilio), the agent's live events flow back through
 * /api/priya/agent-event, and everything (transcript, collected details,
 * AI summary) is mirrored onto the Call doc via its sessionId. That's what
 * makes the per-call report work for campaign-triggered numbers.
 *
 * LEGACY (VOICE_ENGINE=legacy): the original external AI-calling REST provider
 * (Vapi/Bland/Retell-style), kept for backwards compatibility.
 */
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const Call = require('../models/Call')

const VOICE_ENGINE = (process.env.VOICE_ENGINE || 'livekit').toLowerCase()

// Reusable axios instance — keeps connection pool warm across many calls
// in a campaign and centralises auth + base URL.
const client = axios.create({
  baseURL: process.env.TELEPHONY_API_URL,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${process.env.TELEPHONY_API_KEY}`,
    'Content-Type': 'application/json',
  },
})

/**
 * Dispatch a single call to the external AI calling provider.
 * Returns the provider's call reference id so we can correlate webhooks
 * back to the Mongo Call document if the upstream id arrives later.
 */
async function dispatchCall({ call, college, settings = {} }) {
  // ── Priya pipeline (default) ─────────────────────────────────────────────
  if (VOICE_ENGINE !== 'legacy') {
    // Lazy require avoids any module-load ordering issues.
    const { launchOutboundCall } = require('./callLauncher')
    // Link the session BEFORE dialing so agent events arriving seconds later
    // always find the Call doc by sessionId (no race).
    const sessionId = uuidv4()
    await Call.updateOne({ _id: call._id }, { $set: { sessionId } })
    const out = await launchOutboundCall({
      phone: call.phone,
      name: call.name && call.name !== 'Unknown' ? call.name : '',
      preferredLanguage: settings.language || null,     // null = auto-detect
      sessionId,
    })
    console.log(`[telephony] campaign call ${call._id} → Priya session ${sessionId}${out.mock ? ' (mock)' : ''}`)
    return { providerCallId: out.callSid, sessionId, mock: out.mock }
  }

  // ── Legacy external provider ─────────────────────────────────────────────
  // Webhook URL is passed per-call so the provider knows exactly where to
  // POST the transcript. We tag callId in the URL to avoid relying on the
  // provider to echo our metadata cleanly.
  const webhookUrl = `${process.env.PUBLIC_BACKEND_URL}/api/calls/webhook?callId=${call._id}`

  // In dev / when no provider key is set we no-op and pretend the call was
  // accepted. This lets the rest of the pipeline (cron → status updates →
  // webhook processing) be exercised without external dependencies.
  if (!process.env.TELEPHONY_API_URL || !process.env.TELEPHONY_API_KEY) {
    console.warn('[telephony] No TELEPHONY_API_URL/KEY set — running in mock mode')
    return { providerCallId: `mock-${call._id}`, mock: true }
  }

  const payload = {
    to: call.phone,
    from: process.env.TELEPHONY_FROM_NUMBER,
    voice: settings.voice || 'admitbot-v3',
    language: settings.language || 'en-IN',
    metadata: {
      callId: String(call._id),
      campaignId: call.campaignId,
      collegeId: String(call.collegeId),
      collegeName: college?.name,
    },
    // First-message script template — provider substitutes student name.
    firstMessage: `Hi {{name}}, this is the admission desk from ${college?.name || 'AdmitAI'}. Do you have a minute to talk about ${settings.course || 'our programs'}?`,
    webhookUrl,
  }

  const { data } = await client.post('/calls', payload)
  return { providerCallId: data.id || data.callId, raw: data }
}

module.exports = { dispatchCall }
