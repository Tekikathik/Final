// ---------------------------------------------------------------------------
// Nurture & Re-engagement Agent (cron-driven).
//
//   advanceSequences() — drives multi-step campaigns: once a lead's current step
//     has been sent and `delayHours` has elapsed WITHOUT a response/conversion,
//     it enqueues the next channel step (message → message → Priya call). A lead
//     who responded or converted is dropped from the sequence (no more touches).
//
//   reengageStalled() — finds leads that stalled mid-funnel (an Interested/booked
//     lead whose follow-up date passed, or a warm lead gone quiet) and picks the
//     right next touch: a gentle message, or — for high scores — flags an officer
//     task via the audit trail so a human takes over. Never messages DND leads.
//
// It only enqueues CampaignMessage rows; the Outreach agent's drain does the
// actual, compliance-checked sending.
// ---------------------------------------------------------------------------
const Campaign = require('../../models/Campaign')
const CampaignMessage = require('../../models/CampaignMessage')
const Lead = require('../../models/Lead')
const LeadScore = require('../../models/LeadScore')
const AuditLog = require('../../models/AuditLog')

const HOUR = 3600000

// Advance every active, multi-step campaign one step where due.
async function advanceSequences({ now = new Date() } = {}) {
  const campaigns = await Campaign.find({ status: 'active', 'channelMix.1': { $exists: true } }).lean()
  let advanced = 0
  for (const c of campaigns) {
    const steps = (c.channelMix || []).slice().sort((a, b) => a.order - b.order)
    // For each transition step N → N+1
    for (let i = 0; i < steps.length - 1; i++) {
      const cur = i + 1, next = i + 2
      const nextStep = steps[i + 1]
      const cutoff = new Date(now - (nextStep.delayHours || 0) * HOUR)

      // Leads whose step `cur` was delivered/sent before the cutoff and who have
      // NOT responded, and don't already have a `next` row.
      const done = await CampaignMessage.find({
        campaignId: c._id, step: cur, status: { $in: ['sent', 'delivered'] },
        respondedAt: null, enrolled: false, sentAt: { $lte: cutoff },
      }).select('leadId branchId phone').limit(1000).lean()
      if (!done.length) continue

      const existing = new Set(
        (await CampaignMessage.find({ campaignId: c._id, step: next, leadId: { $in: done.map(d => d.leadId) } }).select('leadId').lean())
          .map(r => String(r.leadId)))

      const ops = done.filter(d => !existing.has(String(d.leadId))).map(d => ({
        insertOne: {
          document: {
            orgId: c.orgId, branchId: d.branchId, campaignId: c._id, leadId: d.leadId, phone: d.phone,
            channel: nextStep.channel, step: next, contentAssetId: nextStep.contentAssetId || null,
            status: 'queued', scheduledFor: now,
          },
        },
      }))
      if (ops.length) { await CampaignMessage.bulkWrite(ops, { ordered: false }); advanced += ops.length }
    }
  }
  return { advanced, campaigns: campaigns.length }
}

/**
 * Find stalled leads across an org and route the next touch. Returns a tally.
 * Deterministic + compliance-safe: DND/terminal leads are never touched.
 */
async function reengageStalled(orgId, { now = new Date(), staleDays = 7 } = {}) {
  const staleBefore = new Date(now - staleDays * 86400000)
  const tally = { messaged: 0, officerTasks: 0 }

  // 1) Interested / booked leads whose follow-up date has passed → officer task.
  const overdue = await Lead.find({
    orgId, status: { $in: ['Interested', 'AppointmentBooked'] },
    nextFollowUpAt: { $ne: null, $lte: now }, dnd: { $ne: true },
  }).select('_id branchId assignedOfficerId name status').limit(500).lean()
  for (const lead of overdue) {
    await AuditLog.create({
      orgId, branchId: lead.branchId, actorId: null, actorRole: 'agent',
      action: 'nurture.officer_task', entity: 'Lead', entityId: lead._id,
      meta: { reason: 'follow-up overdue', status: lead.status, assignedTo: lead.assignedOfficerId },
    })
    tally.officerTasks++
  }

  // 2) Warm leads gone quiet (no contact for staleDays) → auto re-engage campaign touch.
  const warm = await LeadScore.find({ orgId, segment: { $in: ['warm', 're_engage'] } })
    .select('leadId branchId phone score').limit(2000).lean()
  const quiet = []
  for (const s of warm) {
    const lead = await Lead.findOne({ _id: s.leadId, dnd: { $ne: true } })
      .select('lastCalledAt updatedAt status').lean()
    if (!lead || ['Enrolled', 'NotInterested', 'Invalid'].includes(lead.status)) continue
    const last = lead.lastCalledAt || lead.updatedAt
    if (last && new Date(last) < staleBefore) quiet.push(s)
  }
  if (quiet.length) {
    // One standing "Auto re-engage" campaign per org holds these drip touches.
    const camp = await ensureReengageCampaign(orgId)
    const existing = new Set(
      (await CampaignMessage.find({ campaignId: camp._id, leadId: { $in: quiet.map(q => q.leadId) }, step: 1 }).select('leadId').lean())
        .map(r => String(r.leadId)))
    const ops = quiet.filter(q => !existing.has(String(q.leadId))).map(q => ({
      insertOne: { document: {
        orgId, branchId: q.branchId, campaignId: camp._id, leadId: q.leadId, phone: q.phone,
        channel: 'whatsapp', step: 1, contentAssetId: camp.channelMix?.[0]?.contentAssetId || null,
        status: 'queued', scheduledFor: now,
      } },
    }))
    if (ops.length) { await CampaignMessage.bulkWrite(ops, { ordered: false }); tally.messaged += ops.length }
  }
  return tally
}

// A single always-on, pre-approved re-engage campaign per org (created on demand).
async function ensureReengageCampaign(orgId) {
  let camp = await Campaign.findOne({ orgId, name: 'Auto re-engage (standing)' })
  if (!camp) {
    camp = await Campaign.create({
      orgId, branchId: null, name: 'Auto re-engage (standing)',
      objective: 'Standing drip to revive quiet warm/re-engage leads',
      status: 'active', segmentKey: 're_engage', generatedBy: 'agent',
      channelMix: [{ channel: 'whatsapp', order: 1, delayHours: 0 }],
      messagingAngle: 'Low-pressure check-in with a fresh reason to reconsider.',
      schedule: { dailyCap: 300, throttlePerMin: 20, sendFromHour: 10, sendToHour: 19 },
    })
  }
  return camp
}

module.exports = { advanceSequences, reengageStalled, ensureReengageCampaign }
