const mongoose = require('mongoose')

const reportSchema = new mongoose.Schema({
  callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', required: true, unique: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },

  profile: {
    name: { type: String, default: 'Unknown' },
    phone: String,
    email: String,
    examAppeared: String,
    courseInterested: String,
    currentCity: String,
    tenthPercent: Number,
    twelfthPercent: Number,
    entranceScore: String,
  },

  summary: { type: String, default: '' },
  enrollmentProbability: { type: Number, min: 0, max: 100, default: 0 },

  topicAnalysis: {
    fees: { type: Number, default: 0, min: 0, max: 100 },
    scholarship: { type: Number, default: 0, min: 0, max: 100 },
    placement: { type: Number, default: 0, min: 0, max: 100 },
    hostel: { type: Number, default: 0, min: 0, max: 100 },
    courseDetails: { type: Number, default: 0, min: 0, max: 100 },
    admissionProcess: { type: Number, default: 0, min: 0, max: 100 },
  },

  sentimentTimeline: [{
    timestamp: Number,
    label: { type: String, enum: ['positive', 'neutral', 'negative'] },
    score: { type: Number, min: -1, max: 1 },
  }],

  followUpRecommendations: [String],

  transcript: [{
    speaker: { type: String, enum: ['ai', 'student'] },
    text: String,
    timestamp: Number,
  }],

  rawWebhookPayload: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true })

module.exports = mongoose.model('Report', reportSchema)
