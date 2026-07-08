// ---------------------------------------------------------------------------
// Segmentation & Lead-Scoring Agent.
//
// Scores every Lead 0-100 from CRM signals (disposition, call history, Priya-
// collected fields, marketing engagement) and buckets it into a dynamic segment:
//   hot | warm | cold | re_engage | excluded (DND / terminal-lost / no consent-needed)
//
// Fully DETERMINISTIC — no LLM. It's a scoring function, so it must be explainable
// (every point is attributed in `factors`) and cheap enough to re-run org-wide on a
// schedule. Upserts one LeadScore row per Lead.
// ---------------------------------------------------------------------------
const Lead = require('../../models/Lead')
const Call = require('../../models/Call')
const CampaignMessage = require('../../models/CampaignMessage')
const LeadScore = require('../../models/LeadScore')

const DAY = 86400000
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

// Points by current pipeline status — how far down the funnel they already are.
const STATUS_POINTS = {
  AppointmentBooked: 45, Visited: 55, Interested: 35, Contacted: 15,
  New: 5, Enrolled: 100, NotInterested: -100, Invalid: -100,
}
// Points by last call disposition — the freshest intent signal.
const DISPOSITION_POINTS = {
  interested: 30, callback: 20, enrolled: 100, no_answer: -2,
  not_interested: -60, wrong_number: -100, dnd: -100,
}

// Compute score + factors for one lead given its calls and marketing engagement.
function scoreLead(lead, { calls = [], responded = 0, touched = 0 } = {}) {
  const factors = []
  const add = (factor, points, detail = '') => { if (points) factors.push({ factor, points, detail }) }

  add(`status:${lead.status}`, STATUS_POINTS[lead.status] ?? 0)
  if (lead.lastDisposition) add(`disposition:${lead.lastDisposition}`, DISPOSITION_POINTS[lead.lastDisposition] ?? 0)

  // Engagement: connected calls + responses to marketing touches show real interest.
  const connected = calls.filter(c => c.connected).length
  add('calls:connected', Math.min(15, connected * 5), `${connected} connected`)
  if (touched) add('marketing:responded', Math.min(20, responded * 10), `${responded}/${touched} replied`)

  // Data completeness — a lead who gave program + marks is a warmer prospect.
  const collected = lastCollected(calls)
  if (collected.program_of_interest) add('data:program', 6, collected.program_of_interest)
  const marks12 = num(collected.class_12_score)
  if (marks12 != null) add('data:marks12', marks12 >= 75 ? 10 : marks12 >= 60 ? 5 : 2, `${marks12}%`)
  if (collected.current_city) add('data:city', 3)
  if (collected.visit_datetime) add('data:booked_slot', 12, collected.visit_datetime)

  // Recency decay — intent goes stale. Penalize long silence, but never for the freshly imported.
  const days = lead.lastCalledAt ? Math.floor((Date.now() - new Date(lead.lastCalledAt)) / DAY) : null
  if (days != null) add('recency', days > 30 ? -12 : days > 14 ? -6 : days <= 2 ? 4 : 0, `${days}d since contact`)

  const score = clamp(factors.reduce((s, f) => s + f.points, 0))
  return { score, factors, collected, connected, days, marks12 }
}

// Segment from score + hard rules (compliance/terminal states override the number).
function segmentOf(lead, score) {
  if (lead.dnd || lead.status === 'Invalid') return 'excluded'
  if (lead.status === 'Enrolled') return 'excluded'                  // already won — not a marketing target
  if (lead.status === 'NotInterested') return score > 25 ? 're_engage' : 'excluded'
  if (score >= 65) return 'hot'
  if (score >= 35) return 'warm'
  if (score <= 12 && (lead.callCount || 0) >= 2) return 're_engage'  // worked but flat → win-back track
  return 'cold'
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
function lastCollected(calls) {
  // Merge collected maps newest-last so latest values win.
  return calls.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .reduce((acc, c) => Object.assign(acc, c.collected || {}), {})
}

/**
 * Recompute scores for an org (or a single branch). Returns per-segment counts.
 * @param {ObjectId} orgId
 * @param {{ branchId?: ObjectId, leadIds?: ObjectId[] }} opts
 */
async function scoreOrg(orgId, { branchId = null, leadIds = null } = {}) {
  const q = { orgId }
  if (branchId) q.branchId = branchId
  if (leadIds) q._id = { $in: leadIds }
  const leads = await Lead.find(q).lean()
  if (!leads.length) return { scored: 0, counts: {} }

  const ids = leads.map(l => l._id)
  // Pull calls + marketing-touch aggregates for these leads in two grouped queries.
  const [callsByLead, touchesByLead] = await Promise.all([
    Call.find({ leadId: { $in: ids } }).select('leadId connected collected createdAt').lean()
      .then(rows => groupBy(rows, 'leadId')),
    CampaignMessage.aggregate([
      { $match: { leadId: { $in: ids } } },
      { $group: { _id: '$leadId', touched: { $sum: 1 }, responded: { $sum: { $cond: [{ $ne: ['$respondedAt', null] }, 1, 0] } } } },
    ]).then(rows => Object.fromEntries(rows.map(r => [String(r._id), r]))),
  ])

  const counts = { hot: 0, warm: 0, cold: 0, re_engage: 0, excluded: 0 }
  const ops = leads.map(lead => {
    const calls = callsByLead[String(lead._id)] || []
    const t = touchesByLead[String(lead._id)] || { touched: 0, responded: 0 }
    const { score, factors, collected, connected, days, marks12 } = scoreLead(lead, { calls, responded: t.responded, touched: t.touched })
    const segment = segmentOf(lead, score)
    counts[segment] = (counts[segment] || 0) + 1
    return {
      updateOne: {
        filter: { leadId: lead._id },
        update: {
          $set: {
            orgId, branchId: lead.branchId, phone: lead.phone, score, segment, factors,
            signals: {
              disposition: lead.lastDisposition || null, callCount: lead.callCount || 0, status: lead.status,
              program: collected.program_of_interest || '', marks12, city: collected.current_city || '',
              daysSinceContact: days, engagementScore: t.responded,
            },
            computedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        upsert: true,
      },
    }
  })
  await LeadScore.bulkWrite(ops, { ordered: false })
  return { scored: leads.length, counts }
}

function groupBy(rows, key) {
  const out = {}
  for (const r of rows) { const k = String(r[key]); (out[k] = out[k] || []).push(r) }
  return out
}

module.exports = { scoreOrg, scoreLead, segmentOf }
