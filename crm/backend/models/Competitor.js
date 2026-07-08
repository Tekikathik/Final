const mongoose = require('mongoose')

// A rival institution we track. Its `profile` holds the known facts (admin-entered
// or pulled from the competitor's page) that the agent compares against Aditya.
const competitorSchema = new mongoose.Schema({
  orgId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name:    { type: String, required: true, trim: true },
  aliases: [{ type: String }],           // other spellings students use ("KL Univ", "KLU")
  location: { type: String, default: '' },
  website:  { type: String, default: '' },
  sourceUrl: { type: String, default: '' },  // competitor page the facts came from

  // Threat tier (see aditya-university-ci-agent-prompt.md):
  //   1 = direct local rival (same catchment, same rank band — Surampalem/Kakinada belt)
  //   2 = government benchmark (JNTUK — monitor cutoffs/seat matrix, not marketing)
  //   3 = regional private university pulling students out of the catchment
  tier: { type: Number, enum: [1, 2, 3], default: 3 },

  // Known facts — the evidence for "where they're better / weaker".
  profile: {
    naac:               { type: String, default: '' },
    nirfRank:           { type: String, default: '' },
    placementHighestLpa: { type: Number, default: null },
    placementAvgLpa:     { type: Number, default: null },
    topRecruiters:      [{ type: String }],
    annualFeeLpa:       { type: Number, default: null },
    scholarships:       { type: String, default: '' },
    hostel:             { type: String, default: '' },
    programs:           [{ type: String }],
    strengths:          [{ type: String }],  // what they're known to be good at
    weaknesses:         [{ type: String }],  // known gaps
    brandNotes:         { type: String, default: '' },
  },
  // Counter-offer playbook — updated by the CI agent whenever a signal changes the
  // competitive picture. Counselors use this when a family cites the competitor.
  playbook: {
    currentPitch:   { type: String, default: '' },   // what they are actually offering right now
    verifiedFacts:  [{ type: String }],              // provable from their own official sources
    honestCounter:  { type: String, default: '' },   // factual, respectful; survives fact-checking
    whenToConcede:  { type: String, default: '' },   // student profiles for whom they ARE better
    updatedAt:      { type: Date, default: null },
  },

  // Previous scrape snapshot — the baseline for change detection. Each CI run diffs
  // the fresh scrape against this and emits CompetitiveSignals for what CHANGED.
  lastSnapshot: {
    profile:    { type: mongoose.Schema.Types.Mixed, default: null },
    capturedAt: { type: Date, default: null },
  },

  isActive: { type: Boolean, default: true },
}, { timestamps: true })

competitorSchema.index({ orgId: 1, name: 1 }, { unique: true })

module.exports = mongoose.model('Competitor', competitorSchema)
