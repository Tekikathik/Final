// ---------------------------------------------------------------------------
// Weekly re-engagement calling — the nurture loop.
//
// Students whose call ended INTERESTED but who then went silent get a warm
// follow-up call automatically: after REENGAGE_AFTER_DAYS with no newer contact,
// Priya calls again — this time she already KNOWS them (name, program, scores,
// city, last call's AI summary travel in the dispatch metadata), so she reconnects
// as a friendly mentor: finds what's holding them back, offers the scholarship
// check for their exam score, lets them explore other branches if they're unsure,
// and nudges toward a campus visit — never re-collecting what we already have.
//
// Safety rails:
//   • max REENGAGE_MAX follow-ups per student, then we stop (no pestering)
//   • anyone whose latest disposition is not_interested / dnd is never re-called
//   • DND-flagged leads are skipped
//   • a newer call to the same phone (any direction/outcome) resets the clock
//   • runs once a day at a civil hour; only calls due students
//
// Env: REENGAGE_ENABLED=off to disable · REENGAGE_CRON (default 11:00 daily)
//      REENGAGE_AFTER_DAYS (default 7) · REENGAGE_MAX (default 2)
// ---------------------------------------------------------------------------
const cron = require('node-cron')
const { v4: uuidv4 } = require('uuid')
const Call = require('../models/Call')
const Lead = require('../models/Lead')
const { launchOutboundCall } = require('./callLauncher')

const ENABLED    = String(process.env.REENGAGE_ENABLED || 'on').toLowerCase() !== 'off'
const AFTER_DAYS = Number(process.env.REENGAGE_AFTER_DAYS || 7)
const MAX_TRIES  = Number(process.env.REENGAGE_MAX || 2)
const CRON       = process.env.REENGAGE_CRON || '0 11 * * *'   // daily 11:00 — civil calling hour

// Collected fields worth carrying into the follow-up call (what Priya "remembers").
const CARRY_FIELDS = ['student_name', 'name', 'program_of_interest', 'specialization',
  'entrance_exams_taken', 'entrance_score', 'class_10_score', 'class_12_score', 'marks_10',
  'marks_inter', 'current_city', 'location', 'engagement_choice', 'counselling_mode',
  'visit_datetime', 'questions_asked']

function carryCollected(collected = {}) {
  const out = {}
  for (const k of CARRY_FIELDS) if (collected[k]) out[k] = collected[k]
  return out
}

/**
 * Find students due a re-engagement call: latest completed call per phone is
 * 'interested', older than AFTER_DAYS, under the attempt cap, not DND.
 */
async function findDueStudents() {
  const cutoff = new Date(Date.now() - AFTER_DAYS * 86400000)

  // Latest call per phone (any status) — the decision is based on the MOST RECENT
  // contact, so a later "not interested" or a fresh call correctly blocks a re-call.
  const latest = await Call.aggregate([
    { $match: { phone: { $ne: null } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$phone', callId: { $first: '$_id' } } },
  ])
  const calls = await Call.find({ _id: { $in: latest.map(l => l.callId) } }).lean()

  const due = []
  for (const call of calls) {
    if (call.status !== 'completed') continue
    if (call.disposition !== 'interested') continue          // the ask: interested but silent
    if ((call.endedAt || call.createdAt) > cutoff) continue  // too recent — give them time
    // Attempt cap: how many follow-ups has this phone already had?
    const attempts = await Call.countDocuments({ phone: call.phone, followUpOf: { $ne: null } })
    if (attempts >= MAX_TRIES) continue
    // Respect DND on the lead record.
    const lead = await Lead.findOne({ phone: call.phone }).select('dnd status').lean()
    if (lead && lead.dnd) continue
    due.push(call)
  }
  return due
}

/** Place one re-engagement call based on a previous interested call. */
async function reEngageOne(prev) {
  const collected = carryCollected(prev.collected || {})
  const name = collected.student_name || collected.name || (prev.name !== 'Unknown' ? prev.name : '')

  const followUpCall = await Call.create({
    collegeId: prev.collegeId,
    orgId: prev.orgId,
    leadId: prev.leadId,
    campaignId: `reengage-${new Date().toISOString().slice(0, 10)}`,
    followUpOf: prev._id,
    phone: prev.phone,
    name: name || prev.name,
    status: 'in_progress',
    startedAt: new Date(),
  })

  // Link session BEFORE dialing so agent events always find this Call doc.
  const sessionId = uuidv4()
  await Call.updateOne({ _id: followUpCall._id }, { $set: { sessionId } })

  const out = await launchOutboundCall({
    phone: prev.phone,
    name,
    sessionId,
    followUp: {
      collected,
      lastSummary: prev.summary || '',
    },
  })
  console.log(`[re-engage] follow-up ${followUpCall._id} → ${prev.phone} (${name || 'no name'})` +
    ` re: ${collected.program_of_interest || 'their enquiry'}${out.mock ? ' [mock]' : ''}`)
  return followUpCall
}

/** The daily sweep. Returns how many follow-up calls were placed. */
async function runReEngagementSweep() {
  const due = await findDueStudents()
  if (!due.length) { console.log('[re-engage] sweep: no students due'); return 0 }
  console.log(`[re-engage] sweep: ${due.length} interested-but-silent student(s) due for a follow-up`)
  let placed = 0
  for (const call of due) {
    try { await reEngageOne(call); placed += 1 }
    catch (e) { console.error(`[re-engage] failed for ${call.phone}:`, e.message) }
    // Small gap between dials so we never burst the trunk / providers.
    await new Promise(r => setTimeout(r, 15000))
  }
  return placed
}

/**
 * Re-engage ONE specific phone number immediately — ignores the 7-day gate and the "due" rules.
 * For admin "call this student back now" and for testing on your own mobile. Uses the number's
 * most recent call for the known data (Mongo Call first; falls back to the JSON call history,
 * so a call placed via make_call.py / the dashboard that wasn't mirrored still works).
 */
async function reEngagePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '').replace(/^91/, '').replace(/^0/, '')
  if (!digits) return { ok: false, message: 'A valid phone number is required' }
  const phone = `+91${digits}`

  const prev = await Call.findOne({ phone }).sort({ createdAt: -1 }).lean()
  if (prev) {
    const call = await reEngageOne(prev)
    return { ok: true, phone, callId: String(call._id), via: 'call-record' }
  }

  // Fallback: the JSON call history (make_call.py / dashboard calls not mirrored to a Call doc).
  const sessionStore = require('./sessionStore')
  const hist = (sessionStore.getRecentCalls(300) || [])
    .find(c => String(c.phone || '').replace(/\s/g, '') === phone)
  if (!hist) return { ok: false, message: `No prior call found for ${phone} — call them once first, then re-engage.` }
  const collected = carryCollected(hist.collected || {})
  const name = collected.student_name || collected.name || (hist.name && hist.name !== 'Unknown' ? hist.name : '')
  const out = await launchOutboundCall({
    phone, name, followUp: { collected, lastSummary: hist.summary || '' },
  })
  console.log(`[re-engage] manual follow-up → ${phone} (${name || 'no name'})${out.mock ? ' [mock]' : ''}`)
  return { ok: true, phone, sessionId: out.sessionId, via: 'history', mock: out.mock }
}

function startReEngagementSchedule() {
  if (!ENABLED) { console.log('[re-engage] disabled via REENGAGE_ENABLED=off'); return }
  if (!cron.validate(CRON)) { console.warn(`[re-engage] invalid REENGAGE_CRON '${CRON}'`); return }
  cron.schedule(CRON, () => runReEngagementSweep()
    .catch(e => console.error('[re-engage] sweep failed:', e.message)))
  console.log(`[re-engage] scheduled: '${CRON}' — follow up interested students after ${AFTER_DAYS} days (max ${MAX_TRIES} tries)`)
}

module.exports = { startReEngagementSchedule, runReEngagementSweep, findDueStudents, reEngagePhone }
