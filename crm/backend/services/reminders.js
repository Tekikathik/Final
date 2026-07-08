// ---------------------------------------------------------------------------
// Pluggable reminder providers — WhatsApp (priority), SMS, email.
//
// Each provider is "configured?" + "send()". When credentials are absent the
// provider no-ops and returns { status:'skipped' }, so appointment reminders
// (and the whole flow) work end-to-end in development; drop in real keys to go
// live. Channel selection: WhatsApp → SMS → email, first configured wins,
// unless a specific channel is requested.
// ---------------------------------------------------------------------------
let twilioClient = null
function getTwilio() {
  if (twilioClient) return twilioClient
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token || sid.startsWith('AC__')) return null
  twilioClient = require('twilio')(sid, token)
  return twilioClient
}

const providers = {
  whatsapp: {
    configured: () => Boolean(getTwilio() && process.env.TWILIO_WHATSAPP_FROM),
    async send(to, message) {
      const client = getTwilio()
      const msg = await client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
        to:   `whatsapp:${to}`,
        body: message,
      })
      return { status: 'sent', detail: msg.sid }
    },
  },
  sms: {
    configured: () => Boolean(getTwilio() && process.env.TWILIO_PHONE_NUMBER),
    async send(to, message) {
      const client = getTwilio()
      const msg = await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER, to, body: message,
      })
      return { status: 'sent', detail: msg.sid }
    },
  },
  email: {
    configured: () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
    async send(to, message, subject = 'Reminder') {
      // nodemailer is optional; only used if SMTP is configured AND the dep exists.
      let nodemailer
      try { nodemailer = require('nodemailer') } catch { return { status: 'skipped', detail: 'nodemailer not installed' } }
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
      const info = await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: message })
      return { status: 'sent', detail: info.messageId }
    },
  },
}

const PRIORITY = ['whatsapp', 'sms', 'email']

/**
 * Send a message on a channel. If channel omitted, uses the first configured
 * provider by priority. Never throws — returns { channel, status, detail }.
 */
async function send({ channel, to, email, message, subject }) {
  const order = channel ? [channel] : PRIORITY
  for (const ch of order) {
    const p = providers[ch]
    if (!p) continue
    const dest = ch === 'email' ? email : to
    if (!p.configured()) {
      // No creds → log so the flow is observable in dev, and report skipped.
      if (channel) { console.log(`[reminder:${ch}] (no creds) → ${dest}: ${message}`); return { channel: ch, status: 'skipped', detail: 'provider not configured' } }
      continue
    }
    if (!dest) return { channel: ch, status: 'skipped', detail: 'no destination' }
    try {
      const r = await p.send(dest, message, subject)
      return { channel: ch, ...r }
    } catch (err) {
      console.warn(`[reminder:${ch}] failed:`, err.message)
      return { channel: ch, status: 'failed', detail: err.message }
    }
  }
  // Nothing configured at all → log-only no-op so dev still "works".
  console.log(`[reminder] (no provider configured) → ${to || email}: ${message}`)
  return { channel: 'none', status: 'skipped', detail: 'no provider configured' }
}

/** Build + send a campus-visit reminder for an appointment. */
async function sendAppointmentReminder(appt, { branchName = 'our campus' } = {}) {
  const when = new Date(appt.scheduledFor).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  const message = `Hi ${appt.studentName || 'there'}, this is a reminder for your campus visit to ${branchName} on ${when}. Reply to reschedule. We look forward to seeing you!`
  return send({ to: appt.studentPhone, email: appt.studentEmail, message, subject: 'Your campus visit reminder' })
}

module.exports = { send, sendAppointmentReminder, providers, PRIORITY }
