/**
 * Builds a Report document from the AI webhook payload.
 * The AI system sends conversation data; this function normalises and enriches it.
 */

function detectTopicScore(transcript, keywords) {
  const text = transcript.map(t => t.text).join(' ').toLowerCase()
  let count = 0
  keywords.forEach(kw => { if (text.includes(kw)) count++ })
  return Math.min(100, Math.round((count / keywords.length) * 100))
}

function computeEnrollmentProbability({ interested, sentiment, duration, topicAnalysis }) {
  if (interested === false) return Math.floor(Math.random() * 15) + 5
  let score = 30
  if (interested === true) score += 30
  if (sentiment === 'positive') score += 20
  else if (sentiment === 'neutral') score += 10
  if (duration > 120) score += 10
  if (duration > 300) score += 5
  const topicEngagement = Object.values(topicAnalysis).reduce((a, b) => a + b, 0) / 6
  score += Math.round(topicEngagement * 0.15)
  return Math.min(97, Math.max(5, score))
}

function buildSentimentTimeline(transcript) {
  const timeline = []
  let ts = 0
  transcript.forEach((turn) => {
    const words = turn.text.split(' ').length
    ts += Math.round(words * 0.4)
    const positive = ['great', 'interested', 'yes', 'definitely', 'sure', 'good', 'excellent', 'thank', 'scholarship', 'excited']
    const negative = ['no', "don't", 'not', 'expensive', 'busy', 'later', 'cancel', 'wrong', 'expensive']
    const text = turn.text.toLowerCase()
    let score = 0
    positive.forEach(w => { if (text.includes(w)) score += 0.25 })
    negative.forEach(w => { if (text.includes(w)) score -= 0.25 })
    score = Math.max(-1, Math.min(1, score))
    timeline.push({ timestamp: ts, label: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral', score: parseFloat(score.toFixed(2)) })
  })
  return timeline
}

function buildFollowUps({ interested, topicAnalysis, sentiment, profile }) {
  const recs = []
  if (interested) {
    recs.push('Schedule campus visit within 48 hours')
    recs.push(`Assign personal admission officer to ${profile?.name || 'this student'}`)
  }
  if (topicAnalysis.fees > 50) recs.push('Share detailed fee structure and EMI options')
  if (topicAnalysis.scholarship > 40) recs.push('Send scholarship eligibility form')
  if (topicAnalysis.placement > 50) recs.push('Share placement brochure and recent statistics')
  if (topicAnalysis.hostel > 30) recs.push('Provide hostel accommodation details and photos')
  if (sentiment === 'negative' && interested !== false) recs.push('Escalate to senior admission counsellor')
  if (!interested) recs.push('Mark for re-contact after 30 days')
  if (recs.length === 0) recs.push('Standard follow-up in 7 days')
  return recs
}

function generateReport({ call, webhookPayload }) {
  const {
    transcript = [],
    profile = {},
    summary = '',
    sentiment = 'neutral',
    interested = null,
  } = webhookPayload

  const topicAnalysis = {
    fees: detectTopicScore(transcript, ['fee', 'fees', 'cost', 'payment', 'tuition', 'price', 'charges']),
    scholarship: detectTopicScore(transcript, ['scholarship', 'merit', 'discount', 'waiver', 'stipend', 'free']),
    placement: detectTopicScore(transcript, ['placement', 'job', 'package', 'recruit', 'company', 'salary', 'career']),
    hostel: detectTopicScore(transcript, ['hostel', 'accommodation', 'stay', 'dorm', 'room', 'boarding']),
    courseDetails: detectTopicScore(transcript, ['course', 'subject', 'curriculum', 'syllabus', 'branch', 'program', 'btech', 'mba']),
    admissionProcess: detectTopicScore(transcript, ['admission', 'process', 'document', 'date', 'deadline', 'form', 'apply', 'entrance']),
  }

  const enrollmentProbability = computeEnrollmentProbability({
    interested,
    sentiment,
    duration: call.duration || 0,
    topicAnalysis,
  })

  const sentimentTimeline = buildSentimentTimeline(transcript)
  const followUpRecommendations = buildFollowUps({ interested, topicAnalysis, sentiment, profile })

  return {
    callId: call._id,
    collegeId: call.collegeId,
    orgId: call.orgId,
    profile: {
      name: profile.name || call.name || 'Unknown',
      phone: profile.phone || call.phone,
      email: profile.email || '',
      examAppeared: profile.examAppeared || '',
      courseInterested: profile.courseInterested || '',
      currentCity: profile.currentCity || '',
      tenthPercent: profile.tenthPercent || null,
      twelfthPercent: profile.twelfthPercent || null,
      entranceScore: profile.entranceScore || '',
    },
    summary,
    enrollmentProbability,
    topicAnalysis,
    sentimentTimeline,
    followUpRecommendations,
    transcript,
    rawWebhookPayload: webhookPayload,
  }
}

module.exports = { generateReport }
