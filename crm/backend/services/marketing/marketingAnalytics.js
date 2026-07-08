// ---------------------------------------------------------------------------
// Marketing Analytics Agent.
//
//   attributeCampaign() — stitches downstream CRM events back onto each sent
//     CampaignMessage: a response, a resulting Priya call, an appointment, an
//     enrollment (last-touch within an attribution window). This is what turns
//     raw sends into the message → response → call → appointment → enrollment
//     funnel.
//   recomputeMetrics() — rolls the message rows up into Campaign.metrics.
//   campaignFunnel() — the funnel + simple ROI for one campaign.
//   weeklyBrief() — an admin brief mirroring the CI Monday-brief pattern
//     (LLM-written when available, deterministic otherwise).
// ---------------------------------------------------------------------------
const Campaign = require('../../models/Campaign')
const CampaignMessage = require('../../models/CampaignMessage')
const Lead = require('../../models/Lead')
const Call = require('../../models/Call')
const Appointment = require('../../models/Appointment')
const { completeJson, hasLlm } = require('../llm')

const DAY = 86400000
const WON = ['Interested', 'AppointmentBooked', 'Visited', 'Enrolled']

// Stitch events onto this campaign's sent messages (idempotent — only fills gaps).
async function attributeCampaign(campaign, { windowDays = 30, now = new Date() } = {}) {
  const msgs = await CampaignMessage.find({
    campaignId: campaign._id, status: { $in: ['sent', 'delivered'] },
    $or: [{ respondedAt: null }, { enrolled: false }],
  }).select('leadId sentAt deliveredAt respondedAt callId appointmentId enrolled').limit(5000).lean()
  if (!msgs.length) return { attributed: 0 }

  const leadIds = [...new Set(msgs.map(m => String(m.leadId)))]
  const [leads, calls, appts] = await Promise.all([
    Lead.find({ _id: { $in: leadIds } }).select('status updatedAt').lean().then(r => Object.fromEntries(r.map(l => [String(l._id), l]))),
    Call.find({ leadId: { $in: leadIds } }).select('leadId startedAt connected').lean().then(r => groupBy(r, 'leadId')),
    Appointment.find({ leadId: { $in: leadIds } }).select('leadId createdAt').lean().then(r => groupBy(r, 'leadId')),
  ])

  let attributed = 0
  for (const m of msgs) {
    const from = new Date(m.sentAt || m.deliveredAt || now)
    const until = new Date(+from + windowDays * DAY)
    const inWindow = (d) => d && new Date(d) >= from && new Date(d) <= until
    const set = {}

    const call = (calls[String(m.leadId)] || []).find(c => inWindow(c.startedAt))
    if (!m.callId && call) set.callId = call._id
    const appt = (appts[String(m.leadId)] || []).find(a => inWindow(a.createdAt))
    if (!m.appointmentId && appt) set.appointmentId = appt._id

    const lead = leads[String(m.leadId)]
    // A response = any forward progress or a connected call/appointment after the touch.
    if (!m.respondedAt && (appt || (call && call.connected) || (lead && WON.includes(lead.status)))) {
      set.respondedAt = appt?.createdAt || call?.startedAt || lead?.updatedAt || now
    }
    if (!m.enrolled && lead && lead.status === 'Enrolled') { set.enrolled = true; set.enrolledAt = lead.updatedAt || now }

    if (Object.keys(set).length) { await CampaignMessage.updateOne({ _id: m._id }, { $set: set }); attributed++ }
  }
  return { attributed }
}

// Roll message rows up into Campaign.metrics.
async function recomputeMetrics(campaignId) {
  const [agg] = await CampaignMessage.aggregate([
    { $match: { campaignId: typeof campaignId === 'string' ? require('mongoose').Types.ObjectId.createFromHexString(campaignId) : campaignId } },
    { $group: {
      _id: null,
      queued:       { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } },
      sent:         { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
      delivered:    { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
      skipped:      { $sum: { $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0] } },
      responded:    { $sum: { $cond: [{ $ne: ['$respondedAt', null] }, 1, 0] } },
      calls:        { $sum: { $cond: [{ $ne: ['$callId', null] }, 1, 0] } },
      appointments: { $sum: { $cond: [{ $ne: ['$appointmentId', null] }, 1, 0] } },
      enrollments:  { $sum: { $cond: ['$enrolled', 1, 0] } },
      total:        { $sum: 1 },
    } },
  ])
  const m = agg || {}
  await Campaign.updateOne({ _id: campaignId }, { $set: {
    'metrics.targeted': m.total || 0, 'metrics.queued': m.queued || 0, 'metrics.sent': m.sent || 0,
    'metrics.delivered': m.delivered || 0, 'metrics.skipped': m.skipped || 0, 'metrics.responded': m.responded || 0,
    'metrics.calls': m.calls || 0, 'metrics.appointments': m.appointments || 0, 'metrics.enrollments': m.enrollments || 0,
    'metrics.lastComputedAt': new Date(),
  } })
  return m
}

// The funnel + conversion rates for one campaign.
async function campaignFunnel(campaignId) {
  const m = await recomputeMetrics(campaignId)
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
  const sent = m.sent || 0
  return {
    funnel: {
      targeted: m.total || 0, sent, responded: m.responded || 0,
      calls: m.calls || 0, appointments: m.appointments || 0, enrollments: m.enrollments || 0, skipped: m.skipped || 0,
    },
    rates: {
      responseRate: pct(m.responded, sent), appointmentRate: pct(m.appointments, sent),
      enrollmentRate: pct(m.enrollments, sent), skipRate: pct(m.skipped, m.total),
    },
  }
}

// Run attribution + metrics for all recently-active campaigns of an org.
async function runAttribution(orgId) {
  const campaigns = await Campaign.find({ orgId, status: { $in: ['active', 'paused', 'completed'] } }).lean()
  for (const c of campaigns) { await attributeCampaign(c); await recomputeMetrics(c._id) }
  return { campaigns: campaigns.length }
}

function groupBy(rows, key) {
  const out = {}; for (const r of rows) { const k = String(r[key]); (out[k] = out[k] || []).push(r) } return out
}

// ── Weekly brief (admin) — mirrors the CI Monday brief ──────────────────────
async function weeklyBrief(orgId, { now = new Date() } = {}) {
  await runAttribution(orgId)
  const since = new Date(now - 7 * DAY)
  const campaigns = await Campaign.find({ orgId, updatedAt: { $gte: since } }).lean()
  const roll = campaigns.reduce((a, c) => {
    for (const k of ['sent', 'responded', 'appointments', 'enrollments']) a[k] += c.metrics?.[k] || 0
    return a
  }, { sent: 0, responded: 0, appointments: 0, enrollments: 0 })
  const top = campaigns.slice().sort((a, b) => (b.metrics?.enrollments || 0) - (a.metrics?.enrollments || 0)).slice(0, 3)

  const facts = {
    weekOf: since.toISOString().slice(0, 10),
    totals: roll,
    activeCampaigns: campaigns.filter(c => c.status === 'active').length,
    topCampaigns: top.map(c => ({ name: c.name, sent: c.metrics?.sent || 0, appts: c.metrics?.appointments || 0, enrolled: c.metrics?.enrollments || 0 })),
  }

  let text = deterministicBrief(facts), usedLlm = false
  if (hasLlm()) {
    const res = await completeJson({
      system: 'You are the Marketing Analytics agent for Aditya University. Write a <150-word weekly brief for the admissions director: what worked, what to double down on, one risk. Facts only, from the data given. Output JSON {brief:"markdown"}.',
      user: JSON.stringify(facts), maxTokens: 500, timeoutMs: 25000,
    })
    if (res && res.brief) { text = String(res.brief); usedLlm = true }
  }
  return { brief: text, facts, usedLlm }
}

function deterministicBrief(f) {
  const lines = [`# Marketing weekly brief — week of ${f.weekOf}`,
    `Sent ${f.totals.sent}, responses ${f.totals.responded}, appointments ${f.totals.appointments}, enrollments ${f.totals.enrollments} across ${f.activeCampaigns} active campaign(s).`]
  if (f.topCampaigns.length) { lines.push('## Top campaigns'); f.topCampaigns.forEach(c => lines.push(`- ${c.name}: ${c.sent} sent → ${c.appts} appts → ${c.enrolled} enrolled`)) }
  return lines.join('\n')
}

module.exports = { attributeCampaign, recomputeMetrics, campaignFunnel, runAttribution, weeklyBrief }
