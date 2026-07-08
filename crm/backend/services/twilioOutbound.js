// ---------------------------------------------------------------------------
// Priya-specific Twilio service — only used for outbound calls triggered
// from the Admin dashboard.  The existing telephony.js handles campaign
// calls; this file handles single-student Priya sessions.
// ---------------------------------------------------------------------------
const twilio = require('twilio')

function getClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token || sid.startsWith('AC__')) {
    throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
  }
  return twilio(sid, token)
}

/**
 * Initiate an outbound call to `to` for the given Priya session.
 * Twilio will POST to  /webhook/call-start?session_id=<id>  when the call
 * connects, and POST to /webhook/call-status?session_id=<id> for status updates.
 */
async function makeOutboundCall({ to, sessionId }) {
  const serverUrl = process.env.SERVER_URL
  if (!serverUrl) throw new Error('SERVER_URL not set in .env')

  const webhookUrl = `${serverUrl}/webhook/call-start?session_id=${sessionId}`
  console.log('[Twilio] >>> Calling', to, 'with webhook:', webhookUrl)

  const client = getClient()
  const call = await client.calls.create({
    to,
    from:                  process.env.TWILIO_PHONE_NUMBER,
    url:                   webhookUrl,
    statusCallback:        `${serverUrl}/webhook/call-status?session_id=${sessionId}`,
    statusCallbackMethod:  'POST',
    statusCallbackEvent:   ['completed', 'failed', 'busy', 'no-answer'],
  })

  console.log('[Twilio] Call created:', call.sid, '| to:', to)
  return call
}

module.exports = { makeOutboundCall }
