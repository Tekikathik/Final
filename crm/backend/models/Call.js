const mongoose = require('mongoose')

const callSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },   // branch
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  // CRM linkage: which lead this call belongs to and which officer triggered it.
  leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
  officerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  // Maps to the Priya/LiveKit session so transcript/status can be reconciled.
  sessionId: { type: String, default: null, index: true },
  campaignId: { type: String, index: true },
  // Set on re-engagement calls: the earlier "interested" call this one follows up.
  followUpOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null, index: true },
  phone: { type: String, required: true },
  name: { type: String, default: 'Unknown' },
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'failed', 'no_answer'],
    default: 'scheduled',
  },
  // Whether the call actually connected (for connect-rate analytics).
  connected: { type: Boolean, default: null },
  // Officer/agent-captured outcome — feeds analytics & follow-up.
  disposition: { type: String, enum: ['interested', 'callback', 'wrong_number', 'not_interested', 'no_answer', 'dnd', 'enrolled', null], default: null },
  duration: { type: Number, default: null },
  sentiment: { type: String, enum: ['positive', 'neutral', 'negative', null], default: null },
  interested: { type: Boolean, default: null },
  // AI-generated 2-3 sentence summary of the call + whether AI auto-analysis has run.
  summary: { type: String, default: null },
  aiAnalyzed: { type: Boolean, default: false },
  // Quality audit: voice-agent recording + transcript per call.
  recordingUrl: { type: String, default: null },
  transcript: [{ role: String, text: String, timestamp: Date }],
  // Details the agent captured with save_detail (student_name, class_10_score,
  // program_of_interest, current_city, …) — feeds the report's student profile.
  collected: { type: mongoose.Schema.Types.Mixed, default: {} },
  detectedLanguage: { type: String, default: null },
  scheduledAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
}, { timestamps: true })

module.exports = mongoose.model('Call', callSchema)
