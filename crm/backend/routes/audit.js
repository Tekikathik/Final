// ---------------------------------------------------------------------------
// Audit log viewer — accountability across roles.
//   GET /api/audit   admin: org-wide; officer: their own branch
// ---------------------------------------------------------------------------
const router = require('express').Router()
const AuditLog = require('../models/AuditLog')
const { authenticate, requireRole } = require('../middleware/auth')

router.use(authenticate)

router.get('/', requireRole('admin', 'college_admin', 'officer'), async (req, res) => {
  try {
    const { action, actorId, entity, branchId, page = 1, limit = 50 } = req.query
    const filter = { orgId: req.user.orgId }

    // Branch isolation: officers only see their branch; college_admins their branches.
    if (req.user.role === 'officer') filter.branchId = req.user.branchId
    else if (req.user.role === 'college_admin') filter.branchId = { $in: req.user.collegeIds || [] }
    else if (branchId) filter.branchId = branchId

    if (action) filter.action = action
    if (actorId) filter.actorId = actorId
    if (entity) filter.entity = entity

    const lim = Math.min(200, parseInt(limit, 10) || 50)
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim)
        .populate('actorId', 'name email role').lean(),
      AuditLog.countDocuments(filter),
    ])
    res.json({ items, total, page: Number(page), limit: lim })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
