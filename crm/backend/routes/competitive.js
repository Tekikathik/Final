// ---------------------------------------------------------------------------
// Competitive Intelligence API — ADMIN (main branch) ONLY.
//   POST  /api/competitive/generate            run the agent on-demand
//   GET   /api/competitive/reports             list past reports
//   GET   /api/competitive/reports/:id         one full report
//   PATCH /api/competitive/reports/:id/review  human review (approve/reject)
//   GET/POST/PATCH/DELETE /competitors         manage tracked rivals
// ---------------------------------------------------------------------------
const router = require('express').Router()
const Competitor = require('../models/Competitor')
const CompetitiveReport = require('../models/CompetitiveReport')
const CompetitiveSignal = require('../models/CompetitiveSignal')
const DEFAULT_COMPETITORS = require('../data/defaultCompetitors')
const { authenticate, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')
const agent = require('../services/competitiveAgent')
const scraper = require('../services/scraper')

// Every route here is admin-only — the report is for the main branch officer.
router.use(authenticate, requireRole('admin'))

// ── Run the agent ─────────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const windowDays = Math.min(365, Math.max(7, parseInt(req.body.windowDays, 10) || 90))
    const briefType = req.body.briefType === 'mini' ? 'mini' : 'weekly'
    const report = await agent.generateReport({
      orgId: req.user.orgId, windowDays, trigger: 'manual', generatedBy: req.user.userId, briefType,
    })
    audit(req, { action: 'competitive.generate', entity: 'CompetitiveReport', entityId: report._id,
      meta: { windowDays, competitors: report.competitors.length, usedLlm: report.usedLlm } })
    res.status(201).json(report)
  } catch (err) {
    console.error('[competitive.generate]', err)
    res.status(500).json({ message: err.message })
  }
})

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', async (req, res) => {
  try {
    const items = await CompetitiveReport.find({ orgId: req.user.orgId })
      .select('generatedAt trigger status usedLlm windowDays summary evidenceStats competitors.name competitors.threatScore recommendations')
      .sort({ generatedAt: -1 }).limit(50).lean()
    res.json(items)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/reports/:id', async (req, res) => {
  try {
    const report = await CompetitiveReport.findOne({ _id: req.params.id, orgId: req.user.orgId })
      .populate('generatedBy reviewedBy', 'name email').lean()
    if (!report) return res.status(404).json({ message: 'Report not found' })
    res.json(report)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.patch('/reports/:id/review', async (req, res) => {
  try {
    const { status, reviewNotes = '' } = req.body
    if (!['approved', 'rejected', 'draft'].includes(status)) {
      return res.status(400).json({ message: 'status must be approved | rejected | draft' })
    }
    const report = await CompetitiveReport.findOneAndUpdate(
      { _id: req.params.id, orgId: req.user.orgId },
      { status, reviewNotes, reviewedBy: req.user.userId, reviewedAt: new Date() },
      { new: true })
    if (!report) return res.status(404).json({ message: 'Report not found' })
    audit(req, { action: 'competitive.review', entity: 'CompetitiveReport', entityId: report._id, meta: { status } })
    res.json({ ok: true, status: report.status })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Change signals (the CI agent's change-detection output) ────────────────────
//   GET /signals?alertsOnly=true&competitorId=…&department=CSE&days=30&limit=100
// `department` is the HOD routing filter: a department's view returns ONLY its own
// signals (spec: an HOD never receives alerts about other departments). Pass
// department=UNIVERSITY_WIDE for the institution-level (leadership) stream.
router.get('/signals', async (req, res) => {
  try {
    const q = { orgId: req.user.orgId }
    if (req.query.competitorId) q.competitorId = req.query.competitorId
    if (req.query.department) {
      const dept = String(req.query.department).toUpperCase()
      if (!CompetitiveSignal.DEPARTMENTS.includes(dept)) {
        return res.status(400).json({ message: `department must be one of ${CompetitiveSignal.DEPARTMENTS.join(', ')}` })
      }
      q.department = dept
    }
    if (String(req.query.alertsOnly) === 'true') q.requires_alert = true
    const days = parseInt(req.query.days, 10)
    if (Number.isFinite(days) && days > 0) q.createdAt = { $gte: new Date(Date.now() - days * 86400000) }
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100))
    res.json(await CompetitiveSignal.find(q).sort({ createdAt: -1 }).limit(limit).lean())
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.patch('/signals/:id/ack', async (req, res) => {
  try {
    const s = await CompetitiveSignal.findOneAndUpdate(
      { _id: req.params.id, orgId: req.user.orgId }, { acknowledged: true }, { new: true })
    if (!s) return res.status(404).json({ message: 'Signal not found' })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Seed the monitored-competitor roster (aditya-university-ci-agent-prompt.md) ─
// Inserts any of the 14 tiered institutions not already tracked; never overwrites
// existing competitors (the admissions team may have enriched their profiles).
router.post('/competitors/seed-defaults', async (req, res) => {
  try {
    const existing = new Set((await Competitor.find({ orgId: req.user.orgId }).select('name').lean())
      .map(c => c.name.toLowerCase()))
    const toAdd = DEFAULT_COMPETITORS.filter(c => !existing.has(c.name.toLowerCase()))
    const created = toAdd.length
      ? await Competitor.insertMany(toAdd.map(c => ({ ...c, orgId: req.user.orgId })))
      : []
    audit(req, { action: 'competitor.seed-defaults', entity: 'Competitor', meta: { added: created.length } })
    res.status(201).json({ added: created.length, skipped: DEFAULT_COMPETITORS.length - created.length, competitors: created })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Live-scrape preview — test a URL before adding a competitor ────────────────
router.post('/scrape-preview', async (req, res) => {
  try {
    const { url, name = 'Preview' } = req.body
    if (!url) return res.status(400).json({ message: 'url is required' })
    const info = await scraper.scrapeInstitution({ name, urls: [url], sourceType: 'competitor_page' })
    res.json({ ok: info.ok, usedLlm: info.usedLlm, sources: info.sources, profile: info.profile, keyFeatures: info.keyFeatures })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Competitors (the rivals we track + their known facts) ─────────────────────
router.get('/competitors', async (req, res) => {
  try {
    res.json(await Competitor.find({ orgId: req.user.orgId }).sort({ name: 1 }).lean())
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/competitors', async (req, res) => {
  try {
    const { name, aliases, location, website, sourceUrl, profile } = req.body
    if (!name) return res.status(400).json({ message: 'name is required' })
    const c = await Competitor.create({ orgId: req.user.orgId, name, aliases, location, website, sourceUrl, profile })
    audit(req, { action: 'competitor.create', entity: 'Competitor', entityId: c._id, meta: { name } })
    res.status(201).json(c)
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Competitor already exists' })
    res.status(500).json({ message: err.message })
  }
})

router.patch('/competitors/:id', async (req, res) => {
  try {
    const c = await Competitor.findOneAndUpdate({ _id: req.params.id, orgId: req.user.orgId }, req.body, { new: true })
    if (!c) return res.status(404).json({ message: 'Competitor not found' })
    audit(req, { action: 'competitor.update', entity: 'Competitor', entityId: c._id })
    res.json(c)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.delete('/competitors/:id', async (req, res) => {
  try {
    const c = await Competitor.findOneAndDelete({ _id: req.params.id, orgId: req.user.orgId })
    if (!c) return res.status(404).json({ message: 'Competitor not found' })
    audit(req, { action: 'competitor.delete', entity: 'Competitor', entityId: req.params.id })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
