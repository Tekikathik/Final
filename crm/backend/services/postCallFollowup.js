// ---------------------------------------------------------------------------
// Post-call follow-up message — fires when a triggered Priya call COMPLETES.
// Sends the caller a WhatsApp (or SMS fallback) greeting with their name and
// the visit/counselling time they booked on the call.
//
// Channel priority comes from services/reminders.js (WhatsApp → SMS → email);
// force one with FOLLOWUP_CHANNEL=whatsapp|sms. Disable with FOLLOWUP_MESSAGE=off.
// Never throws — a messaging failure must never break the agent's status report.
// ---------------------------------------------------------------------------
const { send } = require('./reminders')

const ENABLED = String(process.env.FOLLOWUP_MESSAGE || 'on').toLowerCase() !== 'off'
const CHANNEL = ['whatsapp', 'sms', 'email'].includes(String(process.env.FOLLOWUP_CHANNEL || '').toLowerCase())
  ? String(process.env.FOLLOWUP_CHANNEL).toLowerCase()
  : undefined                       // undefined → reminders.js priority (WhatsApp first)

// "9876543210" / "98765 43210" / "919876543210" → "+919876543210" (Twilio needs E.164).
function toE164(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '')
  if (!digits) return null
  if (digits.startsWith('+')) return digits
  if (/^91\d{10}$/.test(digits)) return `+${digits}`
  if (/^\d{10}$/.test(digits)) return `+91${digits}`
  return `+${digits}`
}

const ENGAGEMENT_LABEL = {
  campus_visit: 'campus visit',
  virtual_tour: 'virtual tour',
  counselling:  'counselling session',
}

// ── Placement proof — the hook that attracts the student to join ─────────────
// Verified 2026 numbers from the university knowledge base (data/knowledgeBase.js).
// Update here when the placement season's figures are refreshed.
const PLACEMENT_PROOF = {
  header: '🏆 *Why students choose Aditya — 2026 placements:*',
  common: [
    '✅ 3,832+ students placed (and counting)',
    '💰 Highest package: ₹27 LPA — Walmart (6 offers)',
    '🌏 International offers up to ₹39.6 LPA (Japan)',
  ],
  // Extra proof line when the program is tech (CSE/AIML/DS/IT) — the fiercest segment.
  tech: '💻 Infosys: 181 offers · Internships at Google & Amazon (₹1L+/month stipends)',
  generic: '🤝 500+ partner companies · Career Development Centre with mock interviews & training',
}

function placementProofLines(collected = {}) {
  const program = String(collected.program_of_interest || collected.interest || '')
  const isTech = /cse|computer|ai|ml|data|it|software/i.test(program)
  return [PLACEMENT_PROOF.header, ...PLACEMENT_PROOF.common, isTech ? PLACEMENT_PROOF.tech : PLACEMENT_PROOF.generic]
}

// Compose the greeting. With a booked slot → confirmation; without → warm thank-you.
// Always ends with the placement proof block + an invitation (the attractor).
function composeMessage(collected = {}, fallbackName = '') {
  const name = collected.student_name || collected.name || fallbackName || 'there'
  const slot = collected.visit_datetime || collected.booked_time || ''
  let what = ENGAGEMENT_LABEL[collected.engagement_choice] || ''
  if (collected.engagement_choice === 'counselling' && collected.counselling_mode) {
    what = `${String(collected.counselling_mode).replace(/_/g, '-')} counselling session`
  }

  const lines = [`Hi ${name}! 🎓 Thank you for speaking with Priya from Aditya University today.`]
  if (slot && what)      lines.push(`Your ${what} is booked for ${slot}. We look forward to seeing you!`)
  else if (slot)         lines.push(`Your visit is booked for ${slot}. We look forward to seeing you!`)
  else if (what)         lines.push(`We've noted your interest in a ${what} — our admissions team will reach out shortly to fix a convenient time.`)
  else                   lines.push(`Our admissions team is here whenever you're ready with the next step.`)
  if (collected.program_of_interest) lines.push(`Program of interest: ${collected.program_of_interest}.`)
  lines.push('', ...placementProofLines(collected), '')
  lines.push(`Come see the campus for yourself — reply here or call us anytime. 🎯`)
  lines.push(`— Aditya University Admissions`)
  return lines.join('\n')
}

/**
 * Send the follow-up for a completed call session (from services/sessionStore).
 * Skipped for: disabled flag, missing phone, or a caller who opted out
 * (call_outcome = not_interested — don't message people who said no).
 * Returns { status, channel, detail } (status 'skipped' when not sent).
 */
async function sendPostCallFollowUp(session) {
  if (!ENABLED) return { status: 'skipped', detail: 'FOLLOWUP_MESSAGE=off' }
  const collected = session?.collected || {}
  if (collected.call_outcome === 'not_interested') {
    return { status: 'skipped', detail: 'caller not interested — no message sent' }
  }
  const to = toE164(session?.phone)
  if (!to) return { status: 'skipped', detail: 'no phone on session' }

  const message = composeMessage(collected, session?.name)
  // Optional placement-proof poster attached to the WhatsApp (set a public image
  // URL in PLACEMENT_PROOF_MEDIA_URL; ignored on SMS/email).
  const result = await send({
    channel: CHANNEL, to, message, subject: 'Your Aditya University booking',
    mediaUrl: process.env.PLACEMENT_PROOF_MEDIA_URL || undefined,
  })
  console.log(`[followup] ${result.channel}/${result.status} → ${to}${result.detail ? ` (${result.detail})` : ''}`)
  return result
}

module.exports = { sendPostCallFollowUp, composeMessage, toE164 }
