const mongoose = require('mongoose')

// Pipeline stages — a lead moves New → Contacted → Interested → AppointmentBooked
// → Visited → Enrolled. NotInterested / Invalid are terminal off-ramps.
const LEAD_STATUSES = [
  'New', 'Contacted', 'Interested', 'AppointmentBooked', 'Visited', 'Enrolled',
  'NotInterested', 'Invalid',
]

// Call disposition / outcome captured after each call.
const DISPOSITIONS = [
  'interested', 'callback', 'wrong_number', 'not_interested', 'no_answer', 'dnd', 'enrolled',
]

const leadSchema = new mongoose.Schema({
  orgId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true, index: true },
  // Officer who owns this lead. Branch isolation + per-officer assignment both key off this.
  assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  name:  { type: String, default: 'Unknown', trim: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  // Normalised E.164 (+91XXXXXXXXXX) — the dedupe key. phoneRaw keeps what was uploaded.
  phone:    { type: String, required: true, index: true },
  phoneRaw: { type: String, default: '' },

  status: { type: String, enum: LEAD_STATUSES, default: 'New', index: true },
  // Lightweight pipeline history for the lead-detail timeline.
  statusHistory: [{
    status: { type: String, enum: LEAD_STATUSES },
    at:     { type: Date, default: Date.now },
    by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note:   { type: String, default: '' },
  }],

  lastDisposition: { type: String, enum: [...DISPOSITIONS, null], default: null },

  // Consent & DND compliance (India TRAI/DND). dnd=true blocks all calling.
  dnd:           { type: Boolean, default: false, index: true },
  consent:       { type: Boolean, default: false },
  consentAt:     { type: Date, default: null },
  consentSource: { type: String, default: '' },   // e.g. 'web_form', 'import', 'verbal'

  // Calling bookkeeping for analytics + the follow-up/callback queue.
  callCount:        { type: Number, default: 0 },
  lastCalledAt:     { type: Date, default: null },
  callbackRequestedAt: { type: Date, default: null },
  nextFollowUpAt:   { type: Date, default: null, index: true },

  source:        { type: String, default: 'import' },  // import | manual | web
  importBatchId: { type: String, default: null, index: true },
  notes:         { type: String, default: '' },
}, { timestamps: true })

// Deduplication: one lead per phone number per organisation. Upload logic checks
// this first; the unique index is the hard backstop against races/double-imports.
leadSchema.index({ orgId: 1, phone: 1 }, { unique: true })

leadSchema.statics.STATUSES = LEAD_STATUSES
leadSchema.statics.DISPOSITIONS = DISPOSITIONS

module.exports = mongoose.model('Lead', leadSchema)
