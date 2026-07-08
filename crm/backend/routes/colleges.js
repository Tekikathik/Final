const router = require('express').Router()
const College = require('../models/College')
const Call = require('../models/Call')
const { authenticate, requireRole } = require('../middleware/auth')

// GET /api/colleges
router.get('/', authenticate, async (req, res) => {
  try {
    const filter = { orgId: req.user.orgId, isActive: true }
    // College admins see only the colleges they're assigned to. The org
    // admin / officer / viewer roles see everything in the org.
    if (req.user.role === 'college_admin' && req.user.collegeIds?.length) {
      filter._id = { $in: req.user.collegeIds }
    }
    const colleges = await College.find(filter)
    // Attach stats
    const withStats = await Promise.all(colleges.map(async (c) => {
      const [total, completed, interested, enrolled] = await Promise.all([
        Call.countDocuments({ collegeId: c._id }),
        Call.countDocuments({ collegeId: c._id, status: 'completed' }),
        Call.countDocuments({ collegeId: c._id, interested: true }),
        Call.countDocuments({ collegeId: c._id, interested: true, status: 'completed' }),
      ])
      return { ...c.toObject(), calls: total, leads: interested, enrolled: Math.round(enrolled * 0.4) }
    }))
    res.json(withStats)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /api/colleges
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const college = await College.create({ ...req.body, orgId: req.user.orgId })
    res.status(201).json(college)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/colleges/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    // College admins must own this college.
    if (req.user.role === 'college_admin' &&
        !(req.user.collegeIds || []).map(String).includes(req.params.id)) {
      return res.status(403).json({ message: 'You do not have access to this college' })
    }
    const college = await College.findOne({ _id: req.params.id, orgId: req.user.orgId })
    if (!college) return res.status(404).json({ message: 'College not found' })
    const [calls, leads, completed, failed] = await Promise.all([
      Call.countDocuments({ collegeId: college._id }),
      Call.countDocuments({ collegeId: college._id, interested: true }),
      Call.countDocuments({ collegeId: college._id, status: 'completed' }),
      Call.countDocuments({ collegeId: college._id, status: 'failed' }),
    ])
    res.json({ ...college.toObject(), stats: { calls, leads, completed, failed, enrolled: Math.round(leads * 0.4) } })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PUT /api/colleges/:id
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const college = await College.findOneAndUpdate({ _id: req.params.id, orgId: req.user.orgId }, req.body, { new: true })
    res.json(college)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// DELETE /api/colleges/:id
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await College.findOneAndUpdate({ _id: req.params.id, orgId: req.user.orgId }, { isActive: false })
    res.json({ message: 'College deleted' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
