const mongoose = require('mongoose')

// A marketing campaign. The Campaign Strategist agent proposes it (status
// 'pending_review'); a human approves it (→ 'approved'); the Outreach agent
// activates and executes it (→ 'active' … 'completed'). Mirrors the CI report
// human-review gate. Bulk activation is the gated action.
const STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'active', 'paused', 'completed']
const CHANNELS = ['whatsapp', 'sms', 'email', 'priya_call']

// One evidence point behind the proposal (rival move, funnel gap) — CI-agent style.
const rationaleSchema = new mongoose.Schema({
  point:      { type: String, required: true },
  source:     { type: String, default: 'analysis' },  // competitive_signal | funnel | segment
  ref:        { type: String, default: '' },
  confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
}, { _id: false })

const channelStepSchema = new mongoose.Schema({
  channel:        { type: String, enum: CHANNELS, required: true },
  order:          { type: Number, default: 1 },          // sequence within the campaign
  contentAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentAsset', default: null },
  delayHours:     { type: Number, default: 0 },          // wait after the previous step
}, { _id: false })

const campaignSchema = new mongoose.Schema({
  orgId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  // null branchId = org-wide (admin only). Officer campaigns are pinned to their branch.
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', default: null, index: true },

  name:      { type: String, required: true },
  objective: { type: String, default: '' },              // e.g. 'Convert warm CSE leads before KLU deadline'
  status:    { type: String, enum: STATUSES, default: 'draft', index: true },

  // WHO — a saved segment query. `segmentKey` matches LeadScore.segment when set;
  // `filter` is an extra Lead-field narrowing (program/city) captured at proposal time.
  segmentKey:   { type: String, default: 'warm' },       // hot | warm | cold | re_engage | custom
  filter:       { type: mongoose.Schema.Types.Mixed, default: {} },  // { program?, city?, status? }
  audienceSize: { type: Number, default: 0 },            // estimate at proposal time

  // WHAT — channel mix + messaging.
  channelMix:      [channelStepSchema],
  messagingAngle:  { type: String, default: '' },
  counterOffers:   [{ type: String }],                   // vs specific rivals, from CI
  sourceSignals:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'CompetitiveSignal' }],
  rationale:       [rationaleSchema],

  // WHEN / HOW MUCH — pacing + compliance guardrails.
  schedule: {
    startAt:      { type: Date, default: null },
    endAt:        { type: Date, default: null },
    sendFromHour: { type: Number, default: 9 },          // local send window (TRAI-friendly)
    sendToHour:   { type: Number, default: 20 },
    dailyCap:     { type: Number, default: 500 },        // max messages/day
    throttlePerMin: { type: Number, default: 30 },
  },
  requireConsent: { type: Boolean, default: false },     // true = only consented leads

  // Review gate.
  generatedBy: { type: String, enum: ['agent', 'user'], default: 'agent' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:  { type: Date, default: null },
  reviewNotes: { type: String, default: '' },
  activatedAt: { type: Date, default: null },
  usedLlm:     { type: Boolean, default: false },

  // Denormalized attribution counters (kept fresh by the Analytics agent) so the
  // campaign card renders without an aggregate on every load.
  metrics: {
    targeted:     { type: Number, default: 0 },
    queued:       { type: Number, default: 0 },
    sent:         { type: Number, default: 0 },
    delivered:    { type: Number, default: 0 },
    responded:    { type: Number, default: 0 },
    calls:        { type: Number, default: 0 },
    appointments: { type: Number, default: 0 },
    enrollments:  { type: Number, default: 0 },
    skipped:      { type: Number, default: 0 },
    lastComputedAt: { type: Date, default: null },
  },
}, { timestamps: true })

campaignSchema.index({ orgId: 1, status: 1, createdAt: -1 })
campaignSchema.statics.STATUSES = STATUSES
campaignSchema.statics.CHANNELS = CHANNELS

module.exports = mongoose.model('Campaign', campaignSchema)
