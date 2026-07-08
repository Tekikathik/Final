const mongoose = require('mongoose')

// Accountability trail: who did what, to which entity, in which branch.
// Written by the audit() helper (middleware/audit.js) from any route.
const auditSchema = new mongoose.Schema({
  orgId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', default: null, index: true },
  actorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorRole: { type: String, default: '' },
  // e.g. 'lead.import', 'lead.assign', 'lead.status_change', 'call.trigger',
  // 'appointment.book', 'user.create', 'lead.disposition'
  action:   { type: String, required: true, index: true },
  entity:   { type: String, default: '' },     // 'Lead' | 'Call' | 'Appointment' | 'User' | ...
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Free-form before/after or metadata (counts, old→new status, phone, etc.)
  meta:     { type: mongoose.Schema.Types.Mixed, default: {} },
  ip:       { type: String, default: '' },
}, { timestamps: true })

module.exports = mongoose.model('AuditLog', auditSchema)
