const router = require('express').Router()
const mongoose = require('mongoose')
const Call = require('../models/Call')
const Report = require('../models/Report')
const College = require('../models/College')
const { authenticate } = require('../middleware/auth')

const oid = (v) => mongoose.Types.ObjectId.createFromHexString(v)

// Use startedAt when present (the actual call timestamp), otherwise fall back
// to createdAt. Bulk-seeded data has identical createdAt values, so grouping
// by it would collapse everything into a single day.
const callTime = { $ifNull: ['$startedAt', '$createdAt'] }

// GET /api/analytics/overview?days=7
router.get('/overview', authenticate, async (req, res) => {
  try {
    const days = Number(req.query.days) || 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const orgId = req.user.orgId
    const orgObjId = oid(orgId)

    // Match against the call's actual time (startedAt|createdAt). Aggregation
    // is the cleanest way to evaluate the $ifNull expression in $match.
    const baseMatch = [
      { $match: { orgId: orgObjId } },
      { $addFields: { _t: callTime } },
      { $match: { _t: { $gte: since } } },
    ]

    const [counts, dailyAgg, highProb] = await Promise.all([
      Call.aggregate([
        ...baseMatch,
        { $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          interested: { $sum: { $cond: [{ $eq: ['$interested', true] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'no_answer']] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
        }},
      ]),
      Call.aggregate([
        ...baseMatch,
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$_t' } },
          calls:    { $sum: 1 },
          leads:    { $sum: { $cond: ['$interested', 1, 0] } },
          enrolled: { $sum: { $cond: [{ $and: ['$interested', { $eq: ['$status', 'completed'] }] }, 1, 0] } },
        }},
        { $sort: { _id: 1 } },
      ]),
      Report.countDocuments({ orgId: orgObjId, enrollmentProbability: { $gte: 75 } }),
    ])

    const c = counts[0] || { total: 0, completed: 0, interested: 0, failed: 0, inProgress: 0 }
    res.json({
      total: c.total,
      completed: c.completed,
      interested: c.interested,
      failed: c.failed,
      inProgress: c.inProgress,
      enrolled: highProb,
      daily: dailyAgg,
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/analytics/college/:id?days=7
router.get('/college/:id', authenticate, async (req, res) => {
  try {
    const collegeId = req.params.id
    const days = Number(req.query.days) || 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const baseMatch = [
      { $match: { collegeId: oid(collegeId) } },
      { $addFields: { _t: callTime } },
      { $match: { _t: { $gte: since } } },
    ]

    const hourlyAgg = await Call.aggregate([
      ...baseMatch,
      { $group: {
        _id: { $hour: '$_t' },
        calls:     { $sum: 1 },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
    ])

    const sentimentDist = await Call.aggregate([
      { $match: { collegeId: oid(collegeId), sentiment: { $ne: null } } },
      { $group: { _id: '$sentiment', count: { $sum: 1 } } },
    ])

    const topicAgg = await Report.aggregate([
      { $match: { collegeId: oid(collegeId) } },
      { $group: {
        _id: null,
        fees:             { $avg: '$topicAnalysis.fees' },
        scholarship:      { $avg: '$topicAnalysis.scholarship' },
        placement:        { $avg: '$topicAnalysis.placement' },
        hostel:           { $avg: '$topicAnalysis.hostel' },
        courseDetails:    { $avg: '$topicAnalysis.courseDetails' },
        admissionProcess: { $avg: '$topicAnalysis.admissionProcess' },
      }},
    ])

    res.json({ hourly: hourlyAgg, sentimentDist, topicAvg: topicAgg[0] || {} })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/analytics/funnel
router.get('/funnel', authenticate, async (req, res) => {
  try {
    const orgId = oid(req.user.orgId)
    const [total, connected, interested, enrolled] = await Promise.all([
      Call.countDocuments({ orgId }),
      Call.countDocuments({ orgId, status: { $in: ['completed', 'in_progress'] } }),
      Call.countDocuments({ orgId, interested: true }),
      Report.countDocuments({ orgId, enrollmentProbability: { $gte: 70 } }),
    ])
    res.json([
      { stage: 'Called',           value: total },
      { stage: 'Connected',        value: connected },
      { stage: 'Interested',       value: interested },
      { stage: 'High Probability', value: enrolled },
    ])
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/analytics/sentiment-trend?collegeId=xxx&days=30
// Returns a flat row-per-day shape: [{ day, positive, neutral, negative }]
// — that's what the Analytics dashboard's stacked bar chart expects.
router.get('/sentiment-trend', authenticate, async (req, res) => {
  try {
    const { collegeId, days = 7 } = req.query
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000)
    const match = { orgId: oid(req.user.orgId), sentiment: { $ne: null } }
    if (collegeId) match.collegeId = oid(collegeId)

    const agg = await Call.aggregate([
      { $match: match },
      { $addFields: { _t: callTime } },
      { $match: { _t: { $gte: since } } },
      { $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$_t' } },
          sentiment: '$sentiment',
        },
        count: { $sum: 1 },
      }},
      { $sort: { '_id.day': 1 } },
    ])

    // Pivot the (day, sentiment) rows into one row per day
    const byDay = {}
    for (const row of agg) {
      const day = row._id.day
      byDay[day] = byDay[day] || { day: day.slice(5), positive: 0, neutral: 0, negative: 0 }
      byDay[day][row._id.sentiment] = row.count
    }
    res.json(Object.keys(byDay).sort().map(k => byDay[k]))
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
