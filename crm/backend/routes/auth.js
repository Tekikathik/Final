const router = require('express').Router()
const { body, validationResult } = require('express-validator')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const Organization = require('../models/Organization')
const { signAccess, signRefresh, verifyRefresh, setRefreshCookie } = require('../utils/tokenUtils')
const { authenticate } = require('../middleware/auth')

function tokenPayload(user) {
  // collegeIds is included so RBAC checks don't need a DB round-trip per
  // request. It's a small array (a college admin owns 1-5 colleges typically).
  return {
    userId: user._id,
    orgId: user.orgId,
    role: user.role,
    collegeIds: (user.collegeIds || []).map(String),
    // Branch (home office) for officers/students — RBAC branch isolation keys off this.
    branchId: user.branchId ? String(user.branchId) : null,
  }
}

// POST /api/auth/register
router.post('/register',
  body('orgName').trim().notEmpty(),
  body('location').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req)
    // Return a single human-readable message so the frontend can display it directly
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg })

    const { orgName, orgType, location, website, description, name, email, password, phone } = req.body
    try {
      // Normalise email case before duplicate-check (normalizeEmail() lowercased it above)
      if (await User.findOne({ email })) return res.status(409).json({ message: 'Email already registered' })

      const org = await Organization.create({ name: orgName, type: orgType, location, website, description })
      const user = await User.create({ orgId: org._id, name, email, passwordHash: password, role: 'admin', phone })

      const payload = tokenPayload(user)
      const accessToken = signAccess(payload)
      const refreshToken = signRefresh(payload)
      user.refreshToken = refreshToken
      await user.save()
      setRefreshCookie(res, refreshToken)

      res.status(201).json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role }, org: { id: org._id, name: org.name } })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const user = await User.findOne({ email: req.body.email, isActive: true })
      if (!user || !(await user.comparePassword(req.body.password))) {
        return res.status(401).json({ message: 'Invalid email or password' })
      }

      const org = await Organization.findById(user.orgId)
      const payload = tokenPayload(user)
      const accessToken = signAccess(payload)
      const refreshToken = signRefresh(payload)
      user.refreshToken = refreshToken
      await user.save()
      setRefreshCookie(res, refreshToken)

      res.json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role }, org: { id: org?._id, name: org?.name } })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// POST /api/auth/student-register — public student sign-up into a branch.
// Students provide the branch they're interested in; orgId is derived from it.
router.post('/student-register',
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('branchId').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg })
    try {
      const College = require('../models/College')
      const branch = await College.findById(req.body.branchId).lean()
      if (!branch) return res.status(400).json({ message: 'Invalid branch' })
      if (await User.findOne({ email: req.body.email })) return res.status(409).json({ message: 'Email already registered' })

      const user = await User.create({
        orgId: branch.orgId, name: req.body.name, email: req.body.email,
        passwordHash: req.body.password, role: 'student',
        branchId: branch._id, phone: req.body.phone,
      })
      const payload = tokenPayload(user)
      const accessToken = signAccess(payload)
      const refreshToken = signRefresh(payload)
      user.refreshToken = refreshToken
      await user.save()
      setRefreshCookie(res, refreshToken)
      res.status(201).json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role } })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// GET /api/auth/public/branches?org=<id|name> — branches a student can pick at signup.
router.get('/public/branches', async (req, res) => {
  try {
    const College = require('../models/College')
    const Organization = require('../models/Organization')
    const filter = { isActive: true }
    if (req.query.org) {
      const org = await Organization.findOne({ $or: [{ _id: /^[0-9a-f]{24}$/i.test(req.query.org) ? req.query.org : undefined }, { name: new RegExp(`^${req.query.org}$`, 'i') }] }).lean()
      if (org) filter.orgId = org._id
    }
    const branches = await College.find(filter).select('name code state orgId isHeadOffice').lean()
    res.json(branches)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken
  if (!token) return res.status(401).json({ message: 'No refresh token' })
  try {
    const decoded = verifyRefresh(token)
    const user = await User.findById(decoded.userId)
    if (!user || user.refreshToken !== token) return res.status(401).json({ message: 'Invalid refresh token' })

    const payload = tokenPayload(user)
    const accessToken = signAccess(payload)
    const newRefresh = signRefresh(payload)
    user.refreshToken = newRefresh
    await user.save()
    setRefreshCookie(res, newRefresh)
    res.json({ accessToken })
  } catch {
    res.status(401).json({ message: 'Invalid or expired refresh token' })
  }
})

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.userId, { refreshToken: null })
    res.clearCookie('refreshToken')
    res.json({ message: 'Logged out' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-passwordHash -refreshToken')
    const org = await Organization.findById(user.orgId)
    res.json({ user, org })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/auth/me/password
router.put('/me/password', authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
    try {
      const user = await User.findById(req.user.userId)
      if (!(await user.comparePassword(req.body.currentPassword))) {
        return res.status(400).json({ message: 'Current password is incorrect' })
      }
      user.passwordHash = req.body.newPassword
      await user.save()
      res.json({ message: 'Password updated' })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// GET /api/auth/demo-accounts (dev-only endpoint to serve demo credentials)
router.get('/demo-accounts', (req, res) => {
  // Passwords can be overridden via environment variables
  const accounts = [
    {
      email: 'admin@aditya.edu.in',
      password: process.env.DEMO_PASSWORD_ADMIN || 'demo-admin-pass',
      user: {
        id: 'usr-aditya-admin',
        name: 'Aditya Satyalokesh',
        email: 'admin@aditya.edu.in',
        phone: '+91 98765 43210',
        role: 'admin',
        orgId: 'org-aditya-001',
        orgName: 'Aditya Educational Institutions',
        avatar: null,
        createdAt: '2025-09-12T10:30:00.000Z',
      },
    },
    {
      email: 'viewer@aditya.edu.in',
      password: process.env.DEMO_PASSWORD_VIEWER || 'demo-viewer-pass',
      user: {
        id: 'usr-aditya-viewer',
        name: 'Riya Menon',
        email: 'viewer@aditya.edu.in',
        phone: '+91 90000 12345',
        role: 'viewer',
        orgId: 'org-aditya-001',
        orgName: 'Aditya Educational Institutions',
        avatar: null,
        createdAt: '2025-10-04T09:00:00.000Z',
      },
    },
    {
      email: 'principal.adu@aditya.edu.in',
      password: process.env.DEMO_PASSWORD_ADU || 'demo-adu-pass',
      user: {
        id: 'usr-college-adu',
        name: 'Dr. Suresh Reddy',
        email: 'principal.adu@aditya.edu.in',
        phone: '+91 98480 11122',
        role: 'college_admin',
        orgId: 'org-aditya-001',
        orgName: 'Aditya Educational Institutions',
        collegeIds: ['col-aditya-univ'],
        collegeName: 'Aditya University',
        avatar: null,
        createdAt: '2025-09-15T08:00:00.000Z',
      },
    },
    {
      email: 'principal.aec@aditya.edu.in',
      password: process.env.DEMO_PASSWORD_AEC || 'demo-aec-pass',
      user: {
        id: 'usr-college-aec',
        name: 'Dr. Lakshmi Iyer',
        email: 'principal.aec@aditya.edu.in',
        phone: '+91 98480 22233',
        role: 'college_admin',
        orgId: 'org-aditya-001',
        orgName: 'Aditya Educational Institutions',
        collegeIds: ['col-aditya-eng'],
        collegeName: 'Aditya Engineering College',
        avatar: null,
        createdAt: '2025-09-18T08:00:00.000Z',
      },
    },
  ];
  res.json(accounts);
})

module.exports = router
