const router = require('express').Router()
const Report = require('../models/Report')
const Call = require('../models/Call')
const { authenticate } = require('../middleware/auth')

// ── Report synthesized live from a Call doc ──────────────────────────────────
// LiveKit/Priya calls don't create a stored Report — their conversation lives on
// the Call itself (transcript + collected details + AI summary, mirrored there
// by the agent events). When no Report doc exists we build the same shape from
// the Call, so the report page works for campaign-triggered numbers too.
const DISPO_PROBABILITY = { enrolled: 95, interested: 80, callback: 55, not_interested: 15, wrong_number: 5, no_answer: 10 }
const DISPO_FOLLOWUPS = {
  enrolled:       ['Send the admission formalities checklist', 'Introduce the assigned counselor'],
  interested:     ['Send brochure & fee structure on WhatsApp', 'Schedule the campus visit / counselling they chose', 'Share scholarship eligibility for their exam score'],
  callback:       ['Call back at the time they asked for', 'Send the brochure before the callback'],
  not_interested: ['Mark closed; add to the nurture list for the next intake'],
  wrong_number:   ["Verify the lead's contact number"],
  no_answer:      ['Retry at a different time of day'],
}

// How often each decision topic came up in THIS conversation (keyword scan,
// scaled so the most-discussed topic = 100) — feeds the report's radar chart.
function topicScores(transcript) {
  const text = transcript.map(t => t.text).join(' ').toLowerCase()
  const count = (re) => (text.match(re) || []).length
  const raw = {
    fees:             count(/\bfee|fees|tuition|lakh|₹/g),
    scholarship:      count(/scholarship|waiver|merit/g),
    placement:        count(/placement|package|recruit|salary|job/g),
    hostel:           count(/hostel|accommodation|mess|room/g),
    courseDetails:    count(/course|b\.?tech|cse|ece|branch|program|specializ/g),
    admissionProcess: count(/admission|eapcet|jee|entrance|exam|counselling|apply|application/g),
  }
  const max = Math.max(1, ...Object.values(raw))
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v / max) * 100)]))
}

function reportFromCall(call) {
  const col = call.collected || {}
  const disposition = call.disposition || col.call_outcome || null
  const course = [col.program_of_interest || col.interest, col.specialization]
    .filter(Boolean).join(' — ') || '—'
  return {
    callId: call.toObject(),
    collegeId: call.collegeId,
    orgId: call.orgId,
    profile: {
      name: col.student_name || col.name || call.name || 'Unknown',
      phone: call.phone,
      email: '',
      examAppeared: col.entrance_exams_taken || col.entrance_exam || '—',
      courseInterested: course,
      currentCity: col.current_city || col.location || '—',
      tenthPercent: col.class_10_score || col.marks_10 || null,
      twelfthPercent: col.class_12_score || col.marks_inter || null,
      entranceScore: col.entrance_score || col.graduation_score || '—',
    },
    summary: call.summary || '',
    enrollmentProbability: DISPO_PROBABILITY[disposition] ?? (call.status === 'completed' ? 60 : 30),
    topicAnalysis: topicScores(call.transcript || []),
    sentimentTimeline: [],
    followUpRecommendations: DISPO_FOLLOWUPS[disposition] || [],
    transcript: (call.transcript || []).map((t, i) => ({
      speaker: /priya|^ai$|assistant/i.test(String(t.role)) ? 'ai' : 'student',
      text: t.text,
      timestamp: i * 6,
    })),
    synthesized: true,   // built live from the Call, not a stored Report doc
  }
}

// GET /api/reports — paginated list
router.get('/', authenticate, async (req, res) => {
  try {
    const { collegeId, minProbability, maxProbability, interested, page = 1, limit = 20 } = req.query
    const filter = { orgId: req.user.orgId }
    if (collegeId) filter.collegeId = collegeId
    if (minProbability || maxProbability) {
      filter.enrollmentProbability = {}
      if (minProbability) filter.enrollmentProbability.$gte = Number(minProbability)
      if (maxProbability) filter.enrollmentProbability.$lte = Number(maxProbability)
    }
    if (interested === 'true') filter['profile.courseInterested'] = { $ne: '' }

    const [reports, total] = await Promise.all([
      Report.find(filter).populate('callId', 'status duration sentiment').sort({ enrollmentProbability: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Report.countDocuments(filter),
    ])
    res.json({ reports, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/reports/:callId — stored Report if one exists, else synthesized
// live from the Call's own conversation (LiveKit/Priya campaign calls).
router.get('/:callId', authenticate, async (req, res) => {
  try {
    const report = await Report.findOne({ callId: req.params.callId }).populate('callId')
    if (report) return res.json(report)

    const call = await Call.findById(req.params.callId)
    if (!call || !(call.transcript || []).length) {
      return res.status(404).json({ message: 'Report not found' })
    }
    if (String(call.orgId) !== String(req.user.orgId)) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    res.json(reportFromCall(call))
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/reports/export/:callId
router.get('/export/:callId', authenticate, async (req, res) => {
  try {
    const report = await Report.findOne({ callId: req.params.callId }).populate('callId')
    if (!report) return res.status(404).json({ message: 'Report not found' })
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.callId}.json"`)
    res.json(report)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
