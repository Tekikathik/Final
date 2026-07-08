// ---------------------------------------------------------------------------
// Marketing Agent Suite API.  All routes require auth; data is branch-scoped for
// officers (branchScopeFilter) and org-wide for admins. The bulk-send and
// fee-content gates require an explicit human approve/reject (CI review pattern).
//
//   RBAC summary
//   ─ score / segments / content-draft / campaign-propose : admin + officer
//   ─ content review (fee gate)  : admin only
//   ─ campaign review + ACTIVATE : admin (any) · officer (own branch only)
//   ─ weekly brief               : admin only
// ---------------------------------------------------------------------------
const router = require('express').Router()
const mongoose = require('mongoose')
const Campaign = require('../models/Campaign')
const CampaignMessage = require('../models/CampaignMessage')
const ContentAsset = require('../models/ContentAsset')
const LeadScore = require('../models/LeadScore')
const Lead = require('../models/Lead')
const { authenticate, requireRole } = require('../middleware/auth')
const { audit, branchScopeFilter } = require('../middleware/audit')

const leadScoring = require('../services/marketing/leadScoring')
const strategist  = require('../services/marketing/campaignStrategist')
const contentAgent = require('../services/marketing/contentAgent')
const outreach    = require('../services/marketing/outreach')
const analytics   = require('../services/marketing/marketingAnalytics')
const { seedMarketingDemo } = require('../services/marketing/seedMarketing')

router.use(authenticate, requireRole('admin', 'officer', 'college_admin'))

// Can this user manage (approve/activate/edit) this branch-owned doc?
// Admin: anything in the org. Officer/college_admin: only their own branch (never org-wide).
function canManage(req, doc) {
  if (req.user.role === 'admin') return true
  if (!doc.branchId) return false                                  // org-wide is admin-only
  if (req.user.role === 'officer') return String(doc.branchId) === String(req.user.branchId)
  if (req.user.role === 'college_admin') return (req.user.collegeIds || []).map(String).includes(String(doc.branchId))
  return false
}
// The branchId a non-admin is allowed to create under (forced to their own).
function creationBranch(req, requested) {
  if (req.user.role === 'admin') return requested || null          // null = org-wide
  return req.user.branchId || (req.user.collegeIds || [])[0] || null
}
const oid = (id) => mongoose.Types.ObjectId.createFromHexString(String(id))
// branchScopeFilter returns JWT string ids — fine for .find() (auto-casts) but
// aggregate $match needs real ObjectIds. Cast the scope for aggregate use.
function aggScope(req, extra = {}) {
  const f = branchScopeFilter(req, extra)
  const out = { ...f, orgId: oid(f.orgId) }
  if (f.branchId) out.branchId = f.branchId.$in ? { $in: f.branchId.$in.map(oid) } : oid(f.branchId)
  return out
}

// ── Segmentation & scoring ──────────────────────────────────────────────────
router.post('/score', async (req, res) => {
  try {
    const branchId = req.user.role === 'admin' ? (req.body.branchId || null) : creationBranch(req)
    const r = await leadScoring.scoreOrg(req.user.orgId, { branchId })
    audit(req, { action: 'marketing.score', entity: 'LeadScore', meta: { branchId, ...r } })
    res.json(r)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/segments', async (req, res) => {
  try {
    const match = aggScope(req)   // ObjectId-cast for aggregate
    const counts = await LeadScore.aggregate([{ $match: match }, { $group: { _id: '$segment', n: { $sum: 1 }, avgScore: { $avg: '$score' } } }])
    res.json({ segments: counts.map(c => ({ segment: c._id, count: c.n, avgScore: Math.round(c.avgScore || 0) })) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/segments/:key/leads', async (req, res) => {
  try {
    const match = branchScopeFilter(req, { segment: req.params.key })
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const scores = await LeadScore.find(match).sort({ score: -1 }).limit(limit).lean()
    const leads = Object.fromEntries((await Lead.find({ _id: { $in: scores.map(s => s.leadId) } }).select('name phone status').lean()).map(l => [String(l._id), l]))
    res.json(scores.map(s => ({ ...s, lead: leads[String(s.leadId)] || null })))
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Content library ─────────────────────────────────────────────────────────
router.get('/content', async (req, res) => {
  try {
    const q = req.user.role === 'admin' ? { orgId: req.user.orgId } : branchScopeFilter(req)
    if (req.query.status) q.status = req.query.status
    res.json(await ContentAsset.find(q).sort({ createdAt: -1 }).limit(100).lean())
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/content/generate', async (req, res) => {
  try {
    const { kind, language, purpose, angle } = req.body
    const branchId = creationBranch(req, req.body.branchId)
    const asset = await contentAgent.generateContent({ orgId: req.user.orgId, branchId, kind, language, purpose, angle, generatedBy: 'agent', authoredBy: req.user.userId })
    audit(req, { action: 'marketing.content.generate', entity: 'ContentAsset', entityId: asset._id, meta: { kind, containsFeeClaim: asset.containsFeeClaim } })
    res.status(201).json(asset)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/content', async (req, res) => {
  try {
    const { kind, language = 'mixed', title, subject = '', body, variables } = req.body
    if (!kind || !title || !body) return res.status(400).json({ message: 'kind, title, body are required' })
    const containsFeeClaim = contentAgent.detectFeeClaim(body)
    const asset = await ContentAsset.create({
      orgId: req.user.orgId, branchId: creationBranch(req, req.body.branchId), kind, language, title, subject, body,
      variables: Array.isArray(variables) ? variables : ['name', 'program', 'branch'],
      containsFeeClaim, status: containsFeeClaim ? 'pending_review' : 'draft', generatedBy: 'user', authoredBy: req.user.userId,
    })
    audit(req, { action: 'marketing.content.create', entity: 'ContentAsset', entityId: asset._id })
    res.status(201).json(asset)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// Fee/compliance content approval — ADMIN ONLY.
router.patch('/content/:id/review', requireRole('admin'), async (req, res) => {
  try {
    const { status, reviewNotes = '' } = req.body
    if (!['approved', 'rejected', 'draft', 'archived'].includes(status)) return res.status(400).json({ message: 'bad status' })
    const a = await ContentAsset.findOneAndUpdate({ _id: req.params.id, orgId: req.user.orgId },
      { status, reviewNotes, reviewedBy: req.user.userId, reviewedAt: new Date() }, { new: true })
    if (!a) return res.status(404).json({ message: 'Not found' })
    audit(req, { action: 'marketing.content.review', entity: 'ContentAsset', entityId: a._id, meta: { status } })
    res.json({ ok: true, status: a.status })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Campaigns ───────────────────────────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  try {
    const q = req.user.role === 'admin' ? { orgId: req.user.orgId } : { orgId: req.user.orgId, branchId: creationBranch(req) }
    if (req.query.status) q.status = req.query.status
    res.json(await Campaign.find(q).sort({ createdAt: -1 }).limit(100).lean())
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/campaigns/:id', async (req, res) => {
  try {
    const c = await Campaign.findOne({ _id: req.params.id, orgId: req.user.orgId })
      .populate('sourceSignals', 'competitor signal_type summary').populate('createdBy reviewedBy', 'name email').lean()
    if (!c) return res.status(404).json({ message: 'Not found' })
    res.json(c)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/campaigns/propose', async (req, res) => {
  try {
    const branchId = req.user.role === 'admin' ? (req.body.branchId || null) : creationBranch(req)
    const { proposed, usedLlm } = await strategist.proposeCampaigns({ orgId: req.user.orgId, branchId, generatedBy: req.user.userId })
    audit(req, { action: 'marketing.campaign.propose', entity: 'Campaign', meta: { count: proposed.length, usedLlm } })
    res.status(201).json({ proposed, usedLlm })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/campaigns', async (req, res) => {
  try {
    const b = req.body
    if (!b.name) return res.status(400).json({ message: 'name is required' })
    const c = await Campaign.create({
      orgId: req.user.orgId, branchId: creationBranch(req, b.branchId), name: b.name, objective: b.objective || '',
      segmentKey: b.segmentKey || 'warm', filter: b.filter || {}, channelMix: b.channelMix || [{ channel: 'whatsapp', order: 1, delayHours: 0 }],
      messagingAngle: b.messagingAngle || '', counterOffers: b.counterOffers || [], schedule: b.schedule || {},
      requireConsent: Boolean(b.requireConsent), status: 'draft', generatedBy: 'user', createdBy: req.user.userId,
    })
    audit(req, { action: 'marketing.campaign.create', entity: 'Campaign', entityId: c._id })
    res.status(201).json(c)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.patch('/campaigns/:id', async (req, res) => {
  try {
    const c = await Campaign.findOne({ _id: req.params.id, orgId: req.user.orgId })
    if (!c) return res.status(404).json({ message: 'Not found' })
    if (!canManage(req, c)) return res.status(403).json({ message: 'Not your campaign' })
    if (!['draft', 'pending_review'].includes(c.status)) return res.status(409).json({ message: 'Only draft/pending campaigns are editable' })
    const editable = ['name', 'objective', 'segmentKey', 'filter', 'channelMix', 'messagingAngle', 'counterOffers', 'schedule', 'requireConsent']
    for (const k of editable) if (k in req.body) c[k] = req.body[k]
    await c.save()
    audit(req, { action: 'marketing.campaign.update', entity: 'Campaign', entityId: c._id })
    res.json(c)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// Human review gate (approve/reject). Admin: any. Officer: own branch only.
router.patch('/campaigns/:id/review', async (req, res) => {
  try {
    const { status, reviewNotes = '' } = req.body
    if (!['approved', 'rejected', 'draft'].includes(status)) return res.status(400).json({ message: 'bad status' })
    const c = await Campaign.findOne({ _id: req.params.id, orgId: req.user.orgId })
    if (!c) return res.status(404).json({ message: 'Not found' })
    if (!canManage(req, c)) return res.status(403).json({ message: 'You cannot review this campaign' })
    c.status = status; c.reviewNotes = reviewNotes; c.reviewedBy = req.user.userId; c.reviewedAt = new Date()
    await c.save()
    audit(req, { action: 'marketing.campaign.review', entity: 'Campaign', entityId: c._id, meta: { status } })
    res.json({ ok: true, status: c.status })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// BULK-SEND GATE — activate an approved campaign: build the queue + go live.
router.post('/campaigns/:id/activate', async (req, res) => {
  try {
    const c = await Campaign.findOne({ _id: req.params.id, orgId: req.user.orgId })
    if (!c) return res.status(404).json({ message: 'Not found' })
    if (!canManage(req, c)) return res.status(403).json({ message: 'You cannot activate this campaign' })
    if (c.status !== 'approved') return res.status(409).json({ message: 'Campaign must be approved before activation' })

    // Compliance: any fee-claim content in the mix must itself be approved.
    const assetIds = (c.channelMix || []).map(s => s.contentAssetId).filter(Boolean)
    if (assetIds.length) {
      const blocked = await ContentAsset.findOne({ _id: { $in: assetIds }, containsFeeClaim: true, status: { $ne: 'approved' } }).lean()
      if (blocked) return res.status(409).json({ message: `Content "${blocked.title}" has a fee claim and needs approval first` })
    }
    c.status = 'active'; c.activatedAt = new Date()
    if (!c.schedule?.startAt) { c.schedule = { ...c.schedule, startAt: new Date() } }
    await c.save()
    const enq = await outreach.enqueueCampaign(c)
    audit(req, { action: 'marketing.campaign.activate', entity: 'Campaign', entityId: c._id, meta: enq })
    res.json({ ok: true, status: c.status, ...enq })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const c = await Campaign.findOne({ _id: req.params.id, orgId: req.user.orgId })
    if (!c) return res.status(404).json({ message: 'Not found' })
    if (!canManage(req, c)) return res.status(403).json({ message: 'Not your campaign' })
    c.status = req.body.resume ? 'active' : 'paused'; await c.save()
    audit(req, { action: 'marketing.campaign.pause', entity: 'Campaign', entityId: c._id, meta: { status: c.status } })
    res.json({ ok: true, status: c.status })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/campaigns/:id/funnel', async (req, res) => {
  try {
    const c = await Campaign.findOne({ _id: req.params.id, orgId: req.user.orgId }).select('_id').lean()
    if (!c) return res.status(404).json({ message: 'Not found' })
    await analytics.attributeCampaign({ _id: oid(req.params.id) })
    res.json(await analytics.campaignFunnel(oid(req.params.id)))
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/campaigns/:id/messages', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100))
    const q = { campaignId: oid(req.params.id), orgId: req.user.orgId }
    if (req.query.status) q.status = req.query.status
    res.json(await CampaignMessage.find(q).sort({ scheduledFor: -1 }).limit(limit).lean())
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Analytics ─────────────────────────────────────────────────────────────
router.get('/analytics/overview', async (req, res) => {
  try {
    const q = req.user.role === 'admin' ? { orgId: req.user.orgId } : { orgId: req.user.orgId, branchId: creationBranch(req) }
    const campaigns = await Campaign.find(q).select('name status metrics segmentKey').sort({ createdAt: -1 }).limit(50).lean()
    const totals = campaigns.reduce((a, c) => {
      for (const k of ['sent', 'responded', 'appointments', 'enrollments', 'skipped']) a[k] += c.metrics?.[k] || 0
      return a
    }, { sent: 0, responded: 0, appointments: 0, enrollments: 0, skipped: 0 })
    res.json({ totals, campaigns })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// Weekly brief — ADMIN only.
router.get('/brief', requireRole('admin'), async (req, res) => {
  try { res.json(await analytics.weeklyBrief(req.user.orgId)) }
  catch (err) { res.status(500).json({ message: err.message }) }
})

// Populate a clean demo dataset (scored leads + approved content + ready campaigns).
router.post('/seed-demo', requireRole('admin'), async (req, res) => {
  try {
    const r = await seedMarketingDemo(req.user.orgId, req.user.userId)
    audit(req, { action: 'marketing.seed-demo', entity: 'Campaign', meta: r })
    res.status(201).json(r)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
