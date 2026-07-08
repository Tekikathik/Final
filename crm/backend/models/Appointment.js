const mongoose = require('mongoose')

const APPT_STATUSES = ['booked', 'reminded', 'visited', 'no_show', 'cancelled']

// A campus-visit appointment. Booked by a student (self-service) or by an officer
// after a call. Linked back to the lead/call/branch so the CRM closes the loop
// between "Appointment Booked" → "Visited".
const appointmentSchema = new mongoose.Schema({
  orgId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true, index: true },
  leadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
  callId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },
  studentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  studentName:  { type: String, default: '' },
  studentPhone: { type: String, default: '' },
  studentEmail: { type: String, default: '' },

  scheduledFor: { type: Date, required: true, index: true },
  mode:   { type: String, default: 'campus_visit' },   // campus_visit | virtual_tour | counselling
  status: { type: String, enum: APPT_STATUSES, default: 'booked', index: true },
  notes:  { type: String, default: '' },

  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByRole: { type: String, default: '' },

  // Reminder dispatch log (WhatsApp/SMS/email), written by the reminder service.
  reminders: [{
    channel: { type: String },                 // whatsapp | sms | email
    sentAt:  { type: Date, default: Date.now },
    status:  { type: String, default: 'sent' },// sent | failed | skipped
    detail:  { type: String, default: '' },
  }],
  reminderSent: { type: Boolean, default: false },
}, { timestamps: true })

appointmentSchema.statics.STATUSES = APPT_STATUSES

module.exports = mongoose.model('Appointment', appointmentSchema)
