const { verifyAccess } = require('../utils/tokenUtils')

/**
 * Verify JWT and attach req.user = { userId, orgId, role, collegeIds }.
 * collegeIds is only populated for the college_admin role.
 */
function authenticate(req, res, next) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }
  try {
    req.user = verifyAccess(auth.slice(7))
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

/**
 * Coarse role gate. Use for routes only certain roles can hit at all
 * (e.g. POST /api/colleges → admin only).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' })
    }
    next()
  }
}

/**
 * Fine-grained college-scope gate. Pulls a collegeId out of either
 * req.params.<key>, req.body.<key>, or req.query.<key> using a dotted path
 * like "body.collegeId", and rejects if the caller is a college_admin who
 * doesn't own that college.
 *
 * Admins (org-level) and officers pass through unchanged. We keep this
 * separate from requireRole because most routes are accessible to both
 * roles but the *data scope* differs.
 */
function scopeToCollege(path) {
  return (req, res, next) => {
    if (req.user?.role !== 'college_admin') return next()
    const [bucket, key] = path.split('.')
    const collegeId = req[bucket]?.[key]
    if (!collegeId) return next() // nothing to scope; downstream handler decides
    const owned = (req.user.collegeIds || []).map(String)
    if (!owned.includes(String(collegeId))) {
      return res.status(403).json({ message: 'You do not have access to this college' })
    }
    next()
  }
}

module.exports = { authenticate, requireRole, scopeToCollege }
