const mongoose = require('mongoose')

// One outreach touch to one lead within a campaign — the ATTRIBUTION SPINE.
// Every downstream event (delivery, response, resulting Priya call, appointment,
// enrollment) is stitched back onto this row, so the Analytics agent can build the
// message → response → call → appointment → enrollment funnel per campaign/branch.
const CHANNELS = ['whatsapp', 'sms', 'email', 'priya_call']
const STATUSES = ['queued', 'sent', 'delivered', 'responded', 'failed', 'skipped']

const messageSchema = new mongoose.Schema({
  orgId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  branchId:   { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true, index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  phone:      { type: String, required: true },

  channel:        { type: String, enum: CHANNELS, required: true },
  step:           { type: Number, default: 1 },          // which channelMix step this is
  contentAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentAsset', default: null },
  language:       { type: String, default: 'mixed' },
  renderedBody:   { type: String, default: '' },         // final personalized text sent

  status:      { type: String, enum: STATUSES, default: 'queued', index: true },
  skipReason:  { type: String, default: '' },            // dnd | no_consent | out_of_window | duplicate | no_contact
  providerRef: { type: String, default: '' },            // Twilio message SID
  error:       { type: String, default: '' },

  scheduledFor: { type: Date, default: Date.now, index: true },
  sentAt:       { type: Date, default: null },
  deliveredAt:  { type: Date, default: null },

  // ── Attribution: filled as the lead progresses AFTER this touch ──────────────
  respondedAt:   { type: Date, default: null },
  callId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },        // Priya follow-up
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
  enrolled:      { type: Boolean, default: false },
  enrolledAt:    { type: Date, default: null },
}, { timestamps: true })

// Idempotency: one message per (campaign, lead, step) — the hard backstop against
// a re-run or crash-retry double-sending to the same person.
messageSchema.index({ campaignId: 1, leadId: 1, step: 1 }, { unique: true })
messageSchema.index({ orgId: 1, status: 1, scheduledFor: 1 })   // the send queue

messageSchema.statics.CHANNELS = CHANNELS
messageSchema.statics.STATUSES = STATUSES

module.exports = mongoose.model('CampaignMessage', messageSchema)
