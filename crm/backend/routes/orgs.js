const router = require('express').Router()
const bcrypt = require('bcryptjs')
const Organization = require('../models/Organization')
const User = require('../models/User')
const { authenticate, requireRole } = require('../middleware/auth')

// GET /api/orgs/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id)
    if (!org) return res.status(404).json({ message: 'Organisation not found' })
    res.json(org)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PUT /api/orgs/:id
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    res.json(org)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/orgs/:id/users
router.get('/:id/users', authenticate, async (req, res) => {
  try {
    const users = await User.find({ orgId: req.params.id, isActive: true }).select('-passwordHash -refreshToken')
    res.json(users)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /api/orgs/:id/users
router.post('/:id/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, role, phone, password } = req.body
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' })
    if (!email?.trim()) return res.status(400).json({ message: 'Email is required' })

    // Normalise email to lowercase to match what the User model stores
    const normalizedEmail = email.toLowerCase().trim()
    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ message: 'Email already exists' })
    }

    // Use orgId from the authenticated JWT rather than from the URL — prevents
    // CastError when the frontend is running in demo mode (org.id is not a
    // valid ObjectId) and guards against cross-organisation user injection.
    const user = await User.create({
      orgId: req.user.orgId,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: password || 'changeme123',
      role: role || 'viewer',
      phone,
    })
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role })
  } catch (err) {
    // Catch MongoDB duplicate-key race (two simultaneous creates with same email)
    if (err.code === 11000) return res.status(409).json({ message: 'Email already exists' })
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/orgs/:id/users/:userId
router.put('/:id/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { role: req.body.role, isActive: req.body.isActive }, { new: true }).select('-passwordHash -refreshToken')
    res.json(user)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// DELETE /api/orgs/:id/users/:userId
router.delete('/:id/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, { isActive: false })
    res.json({ message: 'User removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
