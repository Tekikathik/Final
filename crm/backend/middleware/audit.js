const AuditLog = require('../models/AuditLog')

/**
 * Fire-and-forget audit writer. Never throws into the request path — a failed
 * audit write must not fail the user's action, so errors are only logged.
 *
 *   audit(req, { action: 'lead.assign', entity: 'Lead', entityId, meta:{...} })
 */
function audit(req, { action, entity = '', entityId = null, branchId = null, meta = {} }) {
  try {
    const u = req.user || {}
    AuditLog.create({
      orgId:    u.orgId,
      branchId: branchId || u.branchId || null,
      actorId:  u.userId || null,
      actorRole: u.role || '',
      action, entity, entityId, meta,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
    }).catch(err => console.warn('[audit] write failed:', err.message))
  } catch (err) {
    console.warn('[audit] error:', err.message)
  }
}

/**
 * Build a Mongo filter that enforces branch data isolation for the caller.
 *   - admin / college_admin (org-wide) → only orgId (see the whole org)
 *   - college_admin (scoped)           → orgId + branch in their collegeIds
 *   - officer                          → orgId + their own branch
 *   - student                          → orgId + only their own records (by phone/user)
 * Pass extra filters to merge in.
 */
function branchScopeFilter(req, extra = {}) {
  const u = req.user || {}
  const base = { orgId: u.orgId, ...extra }
  if (u.role === 'admin') return base
  if (u.role === 'college_admin') {
    const ids = (u.collegeIds || [])
    return ids.length ? { ...base, branchId: { $in: ids } } : base
  }
  if (u.role === 'officer') {
    return { ...base, branchId: u.branchId }
  }
  // students are handled per-route (scoped to their own phone/userId), default deny-wide
  return { ...base, branchId: u.branchId || null }
}

module.exports = { audit, branchScopeFilter }
