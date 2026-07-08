const mongoose = require('mongoose')

// One point of comparison, always tied to a source + confidence.
const pointSchema = new mongoose.Schema({
  point:      { type: String, required: true },   // "Higher placement package (₹42L vs our ₹27L)"
  category:   { type: String, default: 'other' }, // placements | fees | scholarships | ranking | programs | facilities | brand | other
  source: {
    type:    { type: String, default: 'analysis' },  // call_transcript | campaign_metric | competitor_page | analysis
    ref:     { type: String, default: '' },          // e.g. callId, competitor website, metric name
    excerpt: { type: String, default: '' },          // the quoted evidence
  },
  confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
}, { _id: false })

// One scraped source URL + whether the fetch succeeded (transparency for reviewers).
const sourceStatSchema = new mongoose.Schema({
  name:   { type: String, default: '' },   // institution the page belongs to
  url:    { type: String, default: '' },
  ok:     { type: Boolean, default: false },
  status: { type: Number, default: null },
  error:  { type: String, default: '' },
}, { _id: false })

const recommendationSchema = new mongoose.Schema({
  priority:  { type: Number, default: 3 },   // 1 = highest
  title:     { type: String, required: true },
  detail:    { type: String, default: '' },
  rationale: { type: String, default: '' },  // why this closes a gap / amplifies a strength
  addressesCompetitors: [{ type: String }],
  evidence:  [pointSchema],
  confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
}, { _id: false })

// The generated, human-reviewed "Competitive Comparison & Improvement Report".
const reportSchema = new mongoose.Schema({
  orgId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  generatedAt: { type: Date, default: Date.now },
  trigger:     { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  usedLlm:     { type: Boolean, default: false },   // false = deterministic fallback (no LLM key)

  // Human-in-the-loop review before any action.
  status:      { type: String, enum: ['draft', 'approved', 'rejected'], default: 'draft', index: true },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:  { type: Date, default: null },
  reviewNotes: { type: String, default: '' },

  windowDays:  { type: Number, default: 90 },
  evidenceStats: {
    callsAnalyzed:          { type: Number, default: 0 },
    transcriptsWithMentions: { type: Number, default: 0 },
    totalMentions:          { type: Number, default: 0 },
  },
  summary: { type: String, default: '' },

  // Two-level reporting (aditya-university-ci-agent-prompt.md):
  //   Level 1 — master brief for admissions leadership (<500 words, phone-readable):
  //   top 3 moves, department heatmap, marketing pressure, university-wide sentiment.
  //   Level 2 — one scorecard per department that had signals this run (<400 words),
  //   for that HOD + admissions head. 'mini' = counselling-season Thursday brief:
  //   master sections 1–2 + scorecards for 🔴 departments only.
  briefType:   { type: String, enum: ['weekly', 'mini'], default: 'weekly' },
  weeklyBrief: { type: String, default: '' },            // the Level-1 master brief
  heatmap: [{
    _id: false,
    department: { type: String, required: true },
    status:     { type: String, enum: ['red', 'yellow', 'green'], default: 'green' },
  }],
  departmentScorecards: [{
    _id: false,
    department: { type: String, required: true },
    content:    { type: String, default: '' },           // markdown, <400 words
  }],

  // Pros & cons per functional department (Admissions office, Placement cell,
  // Fees & Scholarships, Infrastructure & Hostel, Accreditation & Rankings):
  // where Aditya leads (pros) and where rivals beat us (cons), evidence-tied.
  functionalAnalysis: [{
    _id: false,
    area: { type: String, required: true },
    pros: [pointSchema],
    cons: [pointSchema],
  }],

  // Change-detection outcome of this run (signals live in CompetitiveSignal).
  signalStats: {
    total:  { type: Number, default: 0 },
    alerts: { type: Number, default: 0 },
  },

  // Live-scraped key features of OUR institution (Aditya) + the pages we read.
  scrapeEnabled:  { type: Boolean, default: false },
  ourKeyFeatures: [pointSchema],
  ourSourceUrl:   { type: String, default: '' },
  sources:        [sourceStatSchema],

  // Rivals performing BETTER than us, ranked most-threatening first.
  competitors: [{
    competitorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor', default: null },
    name:             { type: String, required: true },
    tier:             { type: Number, enum: [1, 2, 3], default: 3 },
    threatScore:      { type: Number, default: 0 },    // 0-100
    mentions:         { type: Number, default: 0 },    // times students raised them
    chosenOverUs:     { type: Number, default: 0 },    // lost leads that cited them
    keyFeatures:      [pointSchema],                   // scraped key features of this rival
    sourceUrl:        { type: String, default: '' },   // page the features came from
    scraped:          { type: Boolean, default: false },// true = from live scrape, false = stored profile
    betterThanUs:     [pointSchema],                   // their advantages / our gaps
    weakerThanUs:     [pointSchema],                   // our advantages / their weaknesses
    summary:          { type: String, default: '' },
    // Counter-offer playbook entry for this rival (also persisted on Competitor).
    playbook: {
      currentPitch:  { type: String, default: '' },
      verifiedFacts: [{ type: String }],
      honestCounter: { type: String, default: '' },
      whenToConcede: { type: String, default: '' },
    },
  }],

  recommendations: [recommendationSchema],
}, { timestamps: true })

module.exports = mongoose.model('CompetitiveReport', reportSchema)
