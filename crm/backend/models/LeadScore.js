const mongoose = require('mongoose')

// Dynamic lead score + segment, one row per Lead (upserted by the Segmentation &
// Lead-Scoring agent). Kept as its own collection (not fields on Lead) so scoring
// can be re-run/versioned without churning the Lead doc, and segments can be
// queried/indexed independently for the segment explorer + outreach targeting.
const SEGMENTS = ['hot', 'warm', 'cold', 're_engage', 'excluded']

const factorSchema = new mongoose.Schema({
  factor: { type: String, required: true },   // e.g. 'disposition:interested'
  points: { type: Number, required: true },   // signed contribution to the score
  detail: { type: String, default: '' },
}, { _id: false })

const leadScoreSchema = new mongoose.Schema({
  orgId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true, index: true },
  leadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
  phone:    { type: String, required: true, index: true },

  score:   { type: Number, default: 0, min: 0, max: 100, index: true },
  segment: { type: String, enum: SEGMENTS, default: 'cold', index: true },
  factors: [factorSchema],                    // explainability — why this score

  // Snapshot of the inputs used, so the UI can show "scored on" facts without
  // re-reading the Lead/Call docs.
  signals: {
    disposition:      { type: String, default: null },
    callCount:        { type: Number, default: 0 },
    status:           { type: String, default: 'New' },
    program:          { type: String, default: '' },
    marks12:          { type: Number, default: null },
    city:             { type: String, default: '' },
    daysSinceContact: { type: Number, default: null },
    engagementScore:  { type: Number, default: 0 },   // responses to marketing touches
  },

  computedAt: { type: Date, default: Date.now },
  version:    { type: Number, default: 1 },
}, { timestamps: true })

leadScoreSchema.index({ orgId: 1, segment: 1, score: -1 })
leadScoreSchema.statics.SEGMENTS = SEGMENTS

module.exports = mongoose.model('LeadScore', leadScoreSchema)
