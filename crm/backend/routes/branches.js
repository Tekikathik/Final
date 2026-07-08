// ---------------------------------------------------------------------------
// Branch offices (stored as College docs) + officer management.
//   GET   /api/branches                 list branches in the org (scoped)
//   POST  /api/branches                 admin: create a branch office
//   PATCH /api/branches/:id             admin: update a branch
//   GET   /api/branches/:id/officers    list officers in a branch
//   POST  /api/branches/:id/officers    admin: create an officer in a branch
// ---------------------------------------------------------------------------
const router = require('express').Router()
const College = require('../models/College')
const User = require('../models/User')
const { authenticate, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

router.use(authenticate)

// List branches — admins see the whole org; officers/students see their own branch.
router.get('/', async (req, res) => {
  try {
    const filter = { orgId: req.user.orgId, isActive: true }
    if (req.user.role === 'officer' || req.user.role === 'student') filter._id = req.user.branchId
    else if (req.user.role === 'college_admin') filter._id = { $in: req.user.collegeIds || [] }
    const branches = await College.find(filter).sort({ isHeadOffice: -1, name: 1 }).lean()
    res.json(branches)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, code, location, state, isHeadOffice, phone, address } = req.body
    if (!name || !code) return res.status(400).json({ message: 'name and code are required' })
    const branch = await College.create({
      orgId: req.user.orgId, name, code, location, state,
      isHeadOffice: Boolean(isHeadOffice), phone, address,
    })
    audit(req, { action: 'branch.create', entity: 'College', entityId: branch._id, meta: { name, code, state } })
    res.status(201).json(branch)
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Branch code already exists' })
    res.status(500).json({ message: err.message })
  }
})

router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const allowed = (({ name, location, state, isHeadOffice, phone, address, isActive }) =>
      ({ name, location, state, isHeadOffice, phone, address, isActive }))(req.body)
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k])
    const branch = await College.findOneAndUpdate(
      { _id: req.params.id, orgId: req.user.orgId }, allowed, { new: true })
    if (!branch) return res.status(404).json({ message: 'Branch not found' })
    audit(req, { action: 'branch.update', entity: 'College', entityId: branch._id, meta: allowed })
    res.json(branch)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// Officers within a branch (admins, or an officer of that branch).
router.get('/:id/officers', async (req, res) => {
  try {
    if (req.user.role === 'officer' && String(req.user.branchId) !== String(req.params.id)) {
      return res.status(403).json({ message: 'Not your branch' })
    }
    const officers = await User.find({
      orgId: req.user.orgId, branchId: req.params.id, role: 'officer', isActive: true,
    }).select('name email phone createdAt').lean()
    res.json(officers)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// Admin creates an officer assigned to a branch.
router.post('/:id/officers', requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, phone } = req.body
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email, password required' })
    const branch = await College.findOne({ _id: req.params.id, orgId: req.user.orgId }).lean()
    if (!branch) return res.status(404).json({ message: 'Branch not found' })
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ message: 'Email already registered' })

    const officer = await User.create({
      orgId: req.user.orgId, name, email, passwordHash: password, role: 'officer',
      branchId: branch._id, phone,
    })
    audit(req, { action: 'user.create', entity: 'User', entityId: officer._id, branchId: branch._id,
      meta: { role: 'officer', email } })
    res.status(201).json({ id: officer._id, name: officer.name, email: officer.email, branchId: branch._id })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
