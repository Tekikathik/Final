// ---------------------------------------------------------------------------
// Lead management API — the CRM core.
//   POST   /api/leads/import            upload/paste numbers → validate+dedupe+DND
//   GET    /api/leads                   list (branch-isolated, filterable)
//   GET    /api/leads/:id               lead detail + timeline
//   PATCH  /api/leads/:id/assign        assign to an officer
//   PATCH  /api/leads/:id/status        move pipeline stage
//   POST   /api/leads/:id/disposition   record a call outcome
//   POST   /api/leads/:id/dnd           flag do-not-call (+ DND registry)
//   GET    /api/leads/meta/pipeline     stage counts for the caller's scope
// ---------------------------------------------------------------------------
const router = require('express').Router()
const { v4: uuidv4 } = require('uuid')
const Lead = require('../models/Lead')
const DNDEntry = require('../models/DNDEntry')
const User = require('../models/User')
const Call = require('../models/Call')
const { authenticate, requireRole } = require('../middleware/auth')
const { audit, branchScopeFilter } = require('../middleware/audit')
const { importLeads, parseLeadBlob } = require('../services/leadImport')
const sessionStore = require('../services/sessionStore')
const livekitOutbound = require('../services/livekitOutbound')

router.use(authenticate)

// Resolve the branch a write should target. Officers are pinned to their own
// branch; admins/college_admins may pass a branchId (defaults to their first).
function resolveBranch(req, explicit) {
  const u = req.user
  if (u.role === 'officer') return u.branchId
  return explicit || u.branchId || (u.collegeIds || [])[0] || null
}

// ── Import ──────────────────────────────────────────────────────────────────
router.post('/import', requireRole('admin', 'college_admin', 'officer'), async (req, res) => {
  try {
    const { text, rows: jsonRows, branchId, assignedOfficerId } = req.body
    const branch = resolveBranch(req, branchId)
    if (!branch) return res.status(400).json({ message: 'No branch to import into (set branchId)' })

    const rows = Array.isArray(jsonRows) && jsonRows.length ? jsonRows : parseLeadBlob(text)
    if (!rows.length) return res.status(400).json({ message: 'No rows found. Provide `text` (CSV/list) or `rows`.' })

    const summary = await importLeads(rows, {
      orgId: req.user.orgId,
      branchId: branch,
      assignedOfficerId: assignedOfficerId || (req.user.role === 'officer' ? req.user.userId : null),
      source: 'import',
      createdBy: req.user.userId,
    })

    audit(req, { action: 'lead.import', entity: 'Lead', branchId: branch,
      meta: { batchId: summary.batchId, ...summary.counts, total: summary.total } })

    res.status(201).json(summary)
  } catch (err) {
    console.error('[leads.import]', err)
    res.status(500).json({ message: err.message })
  }
})

// ── List (branch-isolated) ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, q, assignedOfficerId, branchId, dnd, callable, page = 1, limit = 50 } = req.query
    const filter = branchScopeFilter(req)

    if (status) filter.status = status
    if (assignedOfficerId) filter.assignedOfficerId = assignedOfficerId
    // Admins may narrow to one branch; officers are already pinned by the scope filter.
    if (branchId && (req.user.role === 'admin' || req.user.role === 'college_admin')) filter.branchId = branchId
    if (dnd === 'true') filter.dnd = true
    if (callable === 'true') filter.dnd = false
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }]
    }

    const lim = Math.min(200, parseInt(limit, 10) || 50)
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim
    const [items, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim)
        .populate('assignedOfficerId', 'name email')
        .populate('branchId', 'name code state').lean(),
      Lead.countDocuments(filter),
    ])
    res.json({ items, total, page: Number(page), limit: lim })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── Pipeline stage counts (for the caller's scope) ───────────────────────────
router.get('/meta/pipeline', async (req, res) => {
  try {
    const match = branchScopeFilter(req)
    const rows = await Lead.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const counts = Object.fromEntries(Lead.STATUSES.map(s => [s, 0]))
    rows.forEach(r => { counts[r._id] = r.count })
    res.json({ stages: Lead.STATUSES, counts })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Fetch a lead within the caller's scope or 404.
async function findScoped(req) {
  const filter = branchScopeFilter(req, { _id: req.params.id })
  return Lead.findOne(filter)
}

// ── Detail ────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findOne(branchScopeFilter(req, { _id: req.params.id }))
      .populate('assignedOfficerId', 'name email')
      .populate('branchId', 'name code state')
      .populate('statusHistory.by', 'name role')
      .lean()
    if (!lead) return res.status(404).json({ message: 'Lead not found' })
    res.json(lead)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── Assign to officer ─────────────────────────────────────────────────────────
router.patch('/:id/assign', requireRole('admin', 'college_admin', 'officer'), async (req, res) => {
  try {
    const { officerId } = req.body
    const lead = await findScoped(req)
    if (!lead) return res.status(404).json({ message: 'Lead not found' })

    // The officer must belong to the same org and the lead's branch.
    if (officerId) {
      const officer = await User.findOne({ _id: officerId, orgId: req.user.orgId }).select('branchId role').lean()
      if (!officer) return res.status(400).json({ message: 'Officer not found in this organisation' })
      if (officer.branchId && String(officer.branchId) !== String(lead.branchId)) {
        return res.status(400).json({ message: "Officer belongs to a different branch" })
      }
    }
    const prev = lead.assignedOfficerId
    lead.assignedOfficerId = officerId || null
    await lead.save()
    audit(req, { action: 'lead.assign', entity: 'Lead', entityId: lead._id, branchId: lead.branchId,
      meta: { from: prev, to: officerId || null } })
    res.json({ ok: true, assignedOfficerId: lead.assignedOfficerId })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── Change pipeline status ────────────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, note = '' } = req.body
    if (!Lead.STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid status. One of: ${Lead.STATUSES.join(', ')}` })
    }
    const lead = await findScoped(req)
    if (!lead) return res.status(404).json({ message: 'Lead not found' })

    const prev = lead.status
    lead.status = status
    lead.statusHistory.push({ status, by: req.user.userId, note })
    await lead.save()
    audit(req, { action: 'lead.status_change', entity: 'Lead', entityId: lead._id, branchId: lead.branchId,
      meta: { from: prev, to: status, note } })
    res.json({ ok: true, status: lead.status })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── Capture a call disposition / outcome ──────────────────────────────────────
// Maps a disposition to side effects: status hints, callback scheduling, DND.
router.post('/:id/disposition', async (req, res) => {
  try {
    const { disposition, note = '', callbackAt } = req.body
    if (!Lead.DISPOSITIONS.includes(disposition)) {
      return res.status(400).json({ message: `Invalid disposition. One of: ${Lead.DISPOSITIONS.join(', ')}` })
    }
    const lead = await findScoped(req)
    if (!lead) return res.status(404).json({ message: 'Lead not found' })

    lead.lastDisposition = disposition
    const prevStatus = lead.status
    switch (disposition) {
      case 'interested':
        if (['New', 'Contacted'].includes(lead.status)) lead.status = 'Interested'
        break
      case 'not_interested':
        lead.status = 'NotInterested'; break
      case 'wrong_number':
        lead.status = 'Invalid'; break
      case 'enrolled':
        lead.status = 'Enrolled'; break
      case 'callback':
        lead.callbackRequestedAt = new Date()
        lead.nextFollowUpAt = callbackAt ? new Date(callbackAt) : new Date(Date.now() + 24 * 3600 * 1000)
        if (lead.status === 'New') lead.status = 'Contacted'
        break
      case 'dnd':
        lead.dnd = true
        await DNDEntry.updateOne(
          { orgId: lead.orgId, phone: lead.phone },
          { $setOnInsert: { reason: 'opt_out', addedBy: req.user.userId } },
          { upsert: true })
        break
      case 'no_answer':
        // leave status; nudge into the follow-up queue
        lead.nextFollowUpAt = new Date(Date.now() + 4 * 3600 * 1000)
        if (lead.status === 'New') lead.status = 'Contacted'
        break
    }
    if (prevStatus !== lead.status) lead.statusHistory.push({ status: lead.status, by: req.user.userId, note: `disposition: ${disposition}` })
    await lead.save()

    audit(req, { action: 'lead.disposition', entity: 'Lead', entityId: lead._id, branchId: lead.branchId,
      meta: { disposition, note, statusFrom: prevStatus, statusTo: lead.status } })
    res.json({ ok: true, status: lead.status, lastDisposition: lead.lastDisposition, nextFollowUpAt: lead.nextFollowUpAt })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── Trigger a voice-agent call to this lead (via LiveKit Priya) ───────────────
router.post('/:id/call', requireRole('admin', 'college_admin', 'officer'), async (req, res) => {
  try {
    const lead = await findScoped(req)
    if (!lead) return res.status(404).json({ message: 'Lead not found' })
    if (lead.dnd) return res.status(403).json({ message: 'Lead is on the Do-Not-Call list — calling is blocked' })

    const sessionId = uuidv4()
    // CRM call record (the durable, query-able history row).
    const call = await Call.create({
      orgId: req.user.orgId, collegeId: lead.branchId, leadId: lead._id,
      officerId: req.user.userId, sessionId, phone: lead.phone, name: lead.name,
      status: 'scheduled',
    })
    // Live session for the realtime dashboard (reuses the Priya sessionStore + agent-event).
    sessionStore.create(sessionId, { phone: lead.phone, name: lead.name, preferred_language: null })

    let callSid = null, mock = false
    try {
      const out = await livekitOutbound.makeOutboundCall({ to: lead.phone, sessionId, name: lead.name })
      callSid = out.sid
      sessionStore.mapCallSid(callSid, sessionId)
    } catch (err) {
      console.warn('[leads.call] LiveKit unavailable — mock mode:', err.message)
      mock = true; callSid = `mock-${Date.now()}`
      sessionStore.update(sessionId, { call_sid: callSid, status: 'calling' })
    }

    lead.callCount += 1
    lead.lastCalledAt = new Date()
    if (lead.status === 'New') {
      lead.status = 'Contacted'
      lead.statusHistory.push({ status: 'Contacted', by: req.user.userId, note: 'call triggered' })
    }
    await lead.save()

    audit(req, { action: 'call.trigger', entity: 'Call', entityId: call._id, branchId: lead.branchId,
      meta: { phone: lead.phone, sessionId, mock } })
    res.status(201).json({ ok: true, callId: call._id, session_id: sessionId, call_sid: callSid, mock })
  } catch (err) {
    console.error('[leads.call]', err)
    res.status(500).json({ message: err.message })
  }
})

// ── Follow-up / callback queue (due leads for the caller's scope) ─────────────
router.get('/queue/followups', async (req, res) => {
  try {
    const filter = branchScopeFilter(req, {
      dnd: false,
      nextFollowUpAt: { $ne: null, $lte: new Date(Date.now() + (Number(req.query.lookaheadHours || 0) * 3600 * 1000)) },
      status: { $nin: ['Enrolled', 'NotInterested', 'Invalid', 'Visited'] },
    })
    const items = await Lead.find(filter).sort({ nextFollowUpAt: 1 }).limit(200)
      .populate('assignedOfficerId', 'name').populate('branchId', 'name code').lean()
    res.json({ items, total: items.length })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Flag do-not-call ──────────────────────────────────────────────────────────
router.post('/:id/dnd', async (req, res) => {
  try {
    const lead = await findScoped(req)
    if (!lead) return res.status(404).json({ message: 'Lead not found' })
    lead.dnd = true
    await lead.save()
    await DNDEntry.updateOne(
      { orgId: lead.orgId, phone: lead.phone },
      { $setOnInsert: { reason: req.body.reason || 'manual', addedBy: req.user.userId } },
      { upsert: true })
    audit(req, { action: 'lead.dnd', entity: 'Lead', entityId: lead._id, branchId: lead.branchId, meta: { phone: lead.phone } })
    res.json({ ok: true, dnd: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
