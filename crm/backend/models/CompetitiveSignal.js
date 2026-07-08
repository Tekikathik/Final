const mongoose = require('mongoose')

// Departments a signal can be routed to (one record per affected department, so
// each HOD's view is complete on its own). UNIVERSITY_WIDE = institution-level.
const DEPARTMENTS = ['CSE', 'AIML', 'DS', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AGRI', 'MINING',
  'PETRO', 'MBA', 'MCA', 'PHARMACY', 'SCIENCE', 'UNIVERSITY_WIDE']

// One detected competitor change — the CI agent's unit of intelligence.
// Schema mirrors aditya-university-ci-agent-prompt.md ("What to extract from
// every signal"). Signals are produced by CHANGE DETECTION: each run compares
// the fresh scrape against the competitor's previous snapshot and records only
// what changed or is new. Unchanged facts never become signals.
const signalSchema = new mongoose.Schema({
  orgId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  competitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor', default: null, index: true },
  reportId:     { type: mongoose.Schema.Types.ObjectId, ref: 'CompetitiveReport', default: null },

  competitor:  { type: String, required: true },          // institution name
  tier:        { type: Number, enum: [1, 2, 3], default: 3 },
  department:  { type: String, enum: DEPARTMENTS, default: 'UNIVERSITY_WIDE', index: true },
  platform:    { type: String, enum: ['website', 'meta_ads', 'youtube', 'linkedin', 'google_reviews', 'portal', 'forum', 'news', 'call_transcript'], default: 'website' },
  signal_type: { type: String, enum: ['fee_change', 'scholarship', 'deadline', 'cutoff', 'new_program', 'placement_claim', 'ad_campaign', 'sentiment', 'accreditation', 'infrastructure', 'event', 'other'], default: 'other' },
  summary:     { type: String, required: true },           // one factual sentence
  details:     { type: String, default: '' },              // amounts in INR, dates, rank bands, names; quotes < 15 words
  language:    { type: String, enum: ['english', 'telugu', 'mixed'], default: 'english' },
  source_url:  { type: String, default: '' },
  observed_date: { type: String, default: '' },            // YYYY-MM-DD
  sentiment:   { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },  // toward the COMPETITOR
  confidence:  { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },  // high only if from an official competitor source
  admissions_relevance: { type: Number, min: 1, max: 5, default: 3 },
  requires_alert: { type: Boolean, default: false, index: true },

  acknowledged: { type: Boolean, default: false },         // reviewer has seen the alert
}, { timestamps: true })

signalSchema.index({ orgId: 1, createdAt: -1 })

const CompetitiveSignal = mongoose.model('CompetitiveSignal', signalSchema)
CompetitiveSignal.DEPARTMENTS = DEPARTMENTS
module.exports = CompetitiveSignal
