// ---------------------------------------------------------------------------
// CRM analytics & reporting.
//   GET /api/crm-analytics/overview     headline call metrics + outcome breakdown
//   GET /api/crm-analytics/by-branch    metrics grouped by branch (admin)
//   GET /api/crm-analytics/by-officer   officer performance leaderboard
//   GET /api/crm-analytics/pipeline     lead funnel counts
// All scoped: officers see only their branch; admins see the whole org.
// ---------------------------------------------------------------------------
const router = require('express').Router()
const mongoose = require('mongoose')
const Call = require('../models/Call')
const Lead = require('../models/Lead')
const Appointment = require('../models/Appointment')
const User = require('../models/User')
const { authenticate } = require('../middleware/auth')

router.use(authenticate)

const oid = (v) => new mongoose.Types.ObjectId(String(v))

// ObjectId-safe scope for Lead/Appointment aggregations (they use `branchId`).
// `.aggregate()` does not auto-cast strings to ObjectId, so we cast here.
function leadApptScope(req, branchField = 'branchId') {
  const u = req.user
  const m = { orgId: oid(u.orgId) }
  if (u.role === 'officer') m[branchField] = oid(u.branchId)
  else if (u.role === 'college_admin' && (u.collegeIds || []).length) m[branchField] = { $in: u.collegeIds.map(oid) }
  return m
}

// Call records use `collegeId` as the branch key (Leads/Appointments use `branchId`).
function callScope(req, extra = {}) {
  const u = req.user
  const base = { orgId: oid(u.orgId), ...extra }
  if (u.role === 'officer') base.collegeId = oid(u.branchId)
  else if (u.role === 'college_admin' && (u.collegeIds || []).length) base.collegeId = { $in: u.collegeIds.map(oid) }
  else if (extra.branchId) { base.collegeId = oid(extra.branchId); delete base.branchId }
  return base
}

function dateRange(req) {
  const { from, to } = req.query
  const r = {}
  if (from) r.$gte = new Date(from)
  if (to) r.$lte = new Date(to)
  return Object.keys(r).length ? r : null
}

// ── Overview ──────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const match = callScope(req)
    if (req.query.branchId && (req.user.role === 'admin' || req.user.role === 'college_admin')) match.collegeId = oid(req.query.branchId)
    if (req.query.officerId) match.officerId = oid(req.query.officerId)
    const dr = dateRange(req)
    if (dr) match.createdAt = dr

    const [agg] = await Call.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        connected:  { $sum: { $cond: [{ $eq: ['$connected', true] }, 1, 0] } },
        unanswered: { $sum: { $cond: [{ $in: ['$status', ['no_answer', 'failed']] }, 1, 0] } },
        completed:  { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        interested: { $sum: { $cond: [{ $in: ['$disposition', ['interested', 'enrolled']] }, 1, 0] } },
        totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
      } },
    ])

    const outcomes = await Call.aggregate([
      { $match: { ...match, disposition: { $ne: null } } },
      { $group: { _id: '$disposition', count: { $sum: 1 } } },
    ])

    const m = agg || { totalCalls: 0, connected: 0, unanswered: 0, completed: 0, interested: 0, totalDuration: 0 }
    res.json({
      totalCalls: m.totalCalls,
      connected: m.connected,
      unanswered: m.unanswered,
      completed: m.completed,
      connectRate: m.totalCalls ? +(m.connected / m.totalCalls * 100).toFixed(1) : 0,
      successRate: m.totalCalls ? +(m.interested / m.totalCalls * 100).toFixed(1) : 0,
      avgDurationSec: m.connected ? Math.round(m.totalDuration / m.connected) : 0,
      outcomes: Object.fromEntries(outcomes.map(o => [o._id, o.count])),
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── By branch (admin / college_admin) ─────────────────────────────────────────
router.get('/by-branch', async (req, res) => {
  try {
    const match = callScope(req)
    const rows = await Call.aggregate([
      { $match: match },
      { $group: {
        _id: '$collegeId',
        totalCalls: { $sum: 1 },
        connected:  { $sum: { $cond: [{ $eq: ['$connected', true] }, 1, 0] } },
        interested: { $sum: { $cond: [{ $in: ['$disposition', ['interested', 'enrolled']] }, 1, 0] } },
      } },
      { $lookup: { from: 'colleges', localField: '_id', foreignField: '_id', as: 'branch' } },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      { $project: {
        branchId: '$_id', branchName: '$branch.name', state: '$branch.state',
        totalCalls: 1, connected: 1, interested: 1,
        connectRate: { $cond: [{ $gt: ['$totalCalls', 0] }, { $round: [{ $multiply: [{ $divide: ['$connected', '$totalCalls'] }, 100] }, 1] }, 0] },
      } },
      { $sort: { totalCalls: -1 } },
    ])
    res.json(rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Officer performance leaderboard ───────────────────────────────────────────
router.get('/by-officer', async (req, res) => {
  try {
    const match = callScope(req, { officerId: { $ne: null } })
    const callRows = await Call.aggregate([
      { $match: match },
      { $group: {
        _id: '$officerId',
        callsMade: { $sum: 1 },
        connected: { $sum: { $cond: [{ $eq: ['$connected', true] }, 1, 0] } },
        interested: { $sum: { $cond: [{ $in: ['$disposition', ['interested', 'enrolled']] }, 1, 0] } },
      } },
    ])

    // Appointments booked + visited per officer (the real conversion signal).
    const apptRows = await Appointment.aggregate([
      { $match: { ...leadApptScope(req), createdBy: { $ne: null } } },
      { $group: {
        _id: '$createdBy',
        appointments: { $sum: 1 },
        visited: { $sum: { $cond: [{ $eq: ['$status', 'visited'] }, 1, 0] } },
      } },
    ])
    const apptMap = Object.fromEntries(apptRows.map(r => [String(r._id), r]))

    const officerIds = callRows.map(r => r._id).filter(Boolean)
    const officers = await User.find({ _id: { $in: officerIds } }).select('name email branchId').lean()
    const nameMap = Object.fromEntries(officers.map(o => [String(o._id), o]))

    const rows = callRows.map(r => {
      const a = apptMap[String(r._id)] || { appointments: 0, visited: 0 }
      const u = nameMap[String(r._id)] || {}
      return {
        officerId: r._id, name: u.name || 'Unknown', email: u.email || '',
        callsMade: r.callsMade, connected: r.connected,
        connectRate: r.callsMade ? +(r.connected / r.callsMade * 100).toFixed(1) : 0,
        interested: r.interested,
        appointmentsBooked: a.appointments, visited: a.visited,
        conversionRate: r.callsMade ? +(a.visited / r.callsMade * 100).toFixed(1) : 0,
      }
    }).sort((x, y) => y.appointmentsBooked - x.appointmentsBooked || y.callsMade - x.callsMade)

    res.json(rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Lead pipeline funnel ──────────────────────────────────────────────────────
router.get('/pipeline', async (req, res) => {
  try {
    const match = leadApptScope(req)
    const rows = await Lead.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const counts = Object.fromEntries(Lead.STATUSES.map(s => [s, 0]))
    rows.forEach(r => { counts[r._id] = r.count })
    res.json({ stages: Lead.STATUSES, counts })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
