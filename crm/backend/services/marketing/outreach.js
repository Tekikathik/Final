// ---------------------------------------------------------------------------
// Outreach Orchestration Agent.
//
// Executes an APPROVED campaign safely:
//   1. Resolves the audience (segment + filter) inside the campaign's branch scope.
//   2. Enqueues one CampaignMessage per lead per channel step (idempotent — the
//      unique (campaign,lead,step) index prevents double-send on re-run/crash).
//   3. A drain pass sends due, queued messages through the EXISTING Twilio
//      reminder service (WhatsApp→SMS→email) or queues a Priya call via
//      callLauncher — respecting DND, consent, the send window, daily cap, and a
//      per-minute throttle.
//
// COMPLIANCE is enforced here, not trusted to the caller: every send re-checks the
// live DNDEntry registry + the lead's dnd/consent flags at send time.
// ---------------------------------------------------------------------------
const Campaign = require('../../models/Campaign')
const CampaignMessage = require('../../models/CampaignMessage')
const ContentAsset = require('../../models/ContentAsset')
const Lead = require('../../models/Lead')
const LeadScore = require('../../models/LeadScore')
const DNDEntry = require('../../models/DNDEntry')
const Call = require('../../models/Call')
const reminders = require('../reminders')
const { launchOutboundCall } = require('../callLauncher')

const HOUR = 3600000

// ── Audience resolution (branch-scoped) ─────────────────────────────────────
// Segment + program/city narrowing are resolved via LeadScore (where the
// Priya-collected program/city are mirrored in `signals`), then intersected with
// live Lead guards (DND / terminal status). A 'custom' segment with no filter
// falls back to every eligible lead in scope.
async function resolveAudience(campaign) {
  const f = campaign.filter || {}
  const useScore = (campaign.segmentKey && campaign.segmentKey !== 'custom') || f.program || f.city
  let leadIds = null
  if (useScore) {
    const scoreQ = { orgId: campaign.orgId }
    if (campaign.branchId) scoreQ.branchId = campaign.branchId
    if (campaign.segmentKey && campaign.segmentKey !== 'custom') scoreQ.segment = campaign.segmentKey
    if (f.program) scoreQ['signals.program'] = new RegExp(f.program, 'i')
    if (f.city)    scoreQ['signals.city'] = new RegExp(f.city, 'i')
    leadIds = (await LeadScore.find(scoreQ).select('leadId').lean()).map(s => s.leadId)
    if (!leadIds.length) return []
  }

  const q = { orgId: campaign.orgId, status: { $nin: ['Invalid'] }, dnd: { $ne: true } }
  if (campaign.branchId) q.branchId = campaign.branchId          // branch isolation
  if (leadIds) q._id = { $in: leadIds }
  return Lead.find(q).select('_id branchId phone name status consent').lean()
}

// ── Enqueue: create queued CampaignMessage rows for step 1 (idempotent) ─────
async function enqueueCampaign(campaign) {
  const audience = await resolveAudience(campaign)
  const step1 = (campaign.channelMix || []).slice().sort((a, b) => a.order - b.order)[0]
  if (!step1) return { queued: 0, targeted: audience.length }

  const startAt = campaign.schedule?.startAt ? new Date(campaign.schedule.startAt) : new Date()
  const ops = audience.map(lead => ({
    updateOne: {
      filter: { campaignId: campaign._id, leadId: lead._id, step: 1 },
      update: {
        $setOnInsert: {
          orgId: campaign.orgId, branchId: lead.branchId, campaignId: campaign._id, leadId: lead._id,
          phone: lead.phone, channel: step1.channel, step: 1, contentAssetId: step1.contentAssetId || null,
          status: 'queued', scheduledFor: startAt,
        },
      },
      upsert: true,
    },
  }))
  if (ops.length) await CampaignMessage.bulkWrite(ops, { ordered: false })
  await Campaign.updateOne({ _id: campaign._id }, { $set: { 'metrics.targeted': audience.length, 'metrics.queued': ops.length } })
  return { queued: ops.length, targeted: audience.length }
}

// Fill {name}/{program}/{branch} tokens for one lead.
function renderBody(asset, lead) {
  const body = asset?.body || 'Hi {name}, this is Aditya University admissions. Reply to know more.'
  return body
    .replace(/\{name\}/gi, (lead.name && lead.name !== 'Unknown') ? lead.name : 'there')
    .replace(/\{program\}/gi, lead._program || 'your program')
    .replace(/\{branch\}/gi, lead._branchName || 'Aditya University')
}

const withinWindow = (sched, now = new Date()) => {
  const h = now.getHours()
  return h >= (sched?.sendFromHour ?? 9) && h < (sched?.sendToHour ?? 20)
}

// Is this phone blocked right now? (live DND registry + lead flag)
async function isBlocked(orgId, phone) {
  return Boolean(await DNDEntry.exists({ orgId, phone }))
}

/**
 * Drain due queued messages for one active campaign. Bounded by dailyCap +
 * throttlePerMin so a single pass can't blast the whole list. Returns a tally.
 * Called repeatedly by the scheduler; safe to run concurrently (per-message
 * status flip guards against double-send).
 */
async function drainCampaign(campaign, { now = new Date() } = {}) {
  const tally = { sent: 0, skipped: 0, failed: 0, calls: 0 }
  if (campaign.status !== 'active') return tally
  if (!withinWindow(campaign.schedule, now)) return tally

  // Daily cap: how many already sent today for this campaign.
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
  const sentToday = await CampaignMessage.countDocuments({ campaignId: campaign._id, sentAt: { $gte: dayStart } })
  const budget = Math.max(0, Math.min(
    (campaign.schedule?.dailyCap ?? 500) - sentToday,
    campaign.schedule?.throttlePerMin ?? 30,          // this pass' slice
  ))
  if (budget <= 0) return tally

  const due = await CampaignMessage.find({ campaignId: campaign._id, status: 'queued', scheduledFor: { $lte: now } })
    .sort({ scheduledFor: 1 }).limit(budget).lean()
  if (!due.length) return tally

  // Resolve each message's OWN step content (steps can carry different assets),
  // cached so we hit Mongo once per distinct asset in this pass.
  const assetCache = new Map()
  const assetFor = async (id) => {
    if (!id) return null
    const k = String(id)
    if (!assetCache.has(k)) assetCache.set(k, await ContentAsset.findById(id).lean())
    return assetCache.get(k)
  }
  const used = new Set()

  for (const msg of due) {
    const asset = await assetFor(msg.contentAssetId)
    // Atomically claim the row so a concurrent drain can't grab it too.
    const claimed = await CampaignMessage.findOneAndUpdate(
      { _id: msg._id, status: 'queued' }, { $set: { status: 'sent', sentAt: now } }, { new: true })
    if (!claimed) continue

    const lead = await Lead.findById(msg.leadId).lean()
    const skip = async (reason) => {
      await CampaignMessage.updateOne({ _id: msg._id }, { $set: { status: 'skipped', skipReason: reason, sentAt: null } })
      tally.skipped++
    }
    if (!lead || !lead.phone) { await skip('no_contact'); continue }
    if (lead.dnd || await isBlocked(campaign.orgId, lead.phone)) { await skip('dnd'); continue }
    if (campaign.requireConsent && !lead.consent) { await skip('no_consent'); continue }

    try {
      if (msg.channel === 'priya_call') {
        // High-intent path: queue a real Priya outbound call and link it for attribution.
        const { sessionId } = await launchOutboundCall({ phone: lead.phone, name: lead.name })
        const call = await Call.findOne({ sessionId }).select('_id').lean()
        await CampaignMessage.updateOne({ _id: msg._id }, { $set: { status: 'sent', deliveredAt: now, callId: call?._id || null, renderedBody: '(Priya call queued)' } })
        tally.calls++
      } else {
        const body = renderBody(asset, lead)
        const r = await reminders.send({ channel: msg.channel, to: lead.phone, message: body, subject: asset?.subject || 'Aditya University' })
        const status = r.status === 'sent' ? 'sent' : r.status === 'skipped' ? 'skipped' : 'failed'
        await CampaignMessage.updateOne({ _id: msg._id }, { $set: { status, channel: r.channel || msg.channel, renderedBody: body, providerRef: r.detail || '', deliveredAt: status === 'sent' ? now : null, skipReason: status === 'skipped' ? (r.detail || 'provider') : '' } })
        if (status === 'sent') tally.sent++; else if (status === 'skipped') tally.skipped++; else { tally.failed++; }
        if (status === 'sent' && asset) used.add(String(asset._id))
      }
    } catch (e) {
      await CampaignMessage.updateOne({ _id: msg._id }, { $set: { status: 'failed', error: String(e.message).slice(0, 300), sentAt: null } })
      tally.failed++
    }
  }
  for (const id of used) await ContentAsset.updateOne({ _id: id }, { $inc: { usageCount: 1 } })
  return tally
}

// Scheduler entry: drain every active campaign one throttled slice.
async function drainActive() {
  const active = await Campaign.find({ status: 'active' }).lean()
  const totals = { campaigns: active.length, sent: 0, skipped: 0, failed: 0, calls: 0 }
  for (const c of active) {
    const t = await drainCampaign(c)
    totals.sent += t.sent; totals.skipped += t.skipped; totals.failed += t.failed; totals.calls += t.calls
    // Auto-complete a campaign whose queue is empty and past end date.
    const remaining = await CampaignMessage.countDocuments({ campaignId: c._id, status: 'queued' })
    if (!remaining && c.schedule?.endAt && new Date(c.schedule.endAt) < new Date()) {
      await Campaign.updateOne({ _id: c._id }, { $set: { status: 'completed' } })
    }
  }
  return totals
}

module.exports = { enqueueCampaign, drainCampaign, drainActive, resolveAudience }
