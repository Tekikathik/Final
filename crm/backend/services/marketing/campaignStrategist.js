// ---------------------------------------------------------------------------
// Campaign Strategist Agent.
//
// Reads the Competitive Intelligence output (alert-worthy CompetitiveSignals),
// the CRM lead funnel, and the live segment sizes (LeadScore), then proposes
// targeted campaigns — segment, channel mix, messaging angle, and counter-offers
// versus specific rivals. Proposals are saved as Campaign(status='pending_review')
// for the human approval gate — the agent NEVER activates a campaign itself.
// LLM-backed with a deterministic fallback.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose')
const Campaign = require('../../models/Campaign')
const Lead = require('../../models/Lead')
const LeadScore = require('../../models/LeadScore')
const CompetitiveSignal = require('../../models/CompetitiveSignal')
const { completeJson, hasLlm } = require('../llm')

// aggregate $match needs real ObjectIds (unlike .find(), which auto-casts strings).
const oid = (id) => (id instanceof mongoose.Types.ObjectId ? id : mongoose.Types.ObjectId.createFromHexString(String(id)))

const SYSTEM = [
  'You are the Campaign Strategist for Aditya University admissions marketing.',
  'You turn competitive signals and CRM funnel data into a few sharp, targeted outreach campaigns.',
  'Aditya facts you may lean on: NAAC A++, industry-associated B.Tech (SAP/Google/Microsoft), Big-4 tie-ups, strong placements, scholarships via entrance scores.',
  'Each campaign must name: the SEGMENT to target (hot|warm|cold|re_engage), an optional program/city narrowing, a CHANNEL MIX ordered over time (whatsapp, sms, email, priya_call — a Priya call is expensive, reserve it for hot/warm), a MESSAGING ANGLE, and COUNTER-OFFERS versus a specific rival when a signal warrants it.',
  'Ground every campaign in the evidence given; tie each rationale point to a source (competitive_signal|funnel|segment). Propose at most 3. Prefer fewer, well-aimed campaigns.',
  'Never invent competitor facts or Aditya numbers. Output STRICT JSON.',
].join(' ')

const asArr = (v) => (Array.isArray(v) ? v : [])
const clip = (v, n = 300) => String(v ?? '').slice(0, n)
const CHANNELS = new Set(Campaign.CHANNELS)
const SEGMENTS = new Set(['hot', 'warm', 'cold', 're_engage', 'custom'])

async function gatherEvidence(orgId, branchId) {
  const scope = { orgId: oid(orgId) }               // ObjectId for aggregate $match
  if (branchId) scope.branchId = oid(branchId)
  const since = new Date(Date.now() - 30 * 86400000)

  const [alerts, segCounts, funnel] = await Promise.all([
    CompetitiveSignal.find({ orgId, requires_alert: true, createdAt: { $gte: since } })
      .sort({ admissions_relevance: -1, createdAt: -1 }).limit(8).lean(),
    LeadScore.aggregate([{ $match: scope }, { $group: { _id: '$segment', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  return {
    alerts,
    segments: Object.fromEntries(segCounts.map(s => [s._id, s.n])),
    funnel: Object.fromEntries(funnel.map(f => [f._id, f.n])),
  }
}

// Normalise one LLM campaign object to the Campaign schema shape.
function normalize(c, evidence) {
  const segmentKey = SEGMENTS.has(c.segmentKey) ? c.segmentKey : 'warm'
  const mix = asArr(c.channelMix)
    .filter(s => CHANNELS.has(s.channel))
    .map((s, i) => ({ channel: s.channel, order: Number(s.order) || i + 1, delayHours: Math.max(0, Number(s.delayHours) || 0), contentAssetId: null }))
  // Link rival signals the proposal references, by competitor name mention.
  const text = `${c.messagingAngle || ''} ${asArr(c.counterOffers).join(' ')}`.toLowerCase()
  const sourceSignals = evidence.alerts.filter(a => text.includes((a.competitor || '').toLowerCase())).map(a => a._id)
  return {
    name: clip(c.name || 'Untitled campaign', 120),
    objective: clip(c.objective, 400),
    segmentKey,
    filter: (c.filter && typeof c.filter === 'object') ? {
      ...(c.filter.program ? { program: clip(c.filter.program, 80) } : {}),
      ...(c.filter.city ? { city: clip(c.filter.city, 80) } : {}),
    } : {},
    channelMix: mix.length ? mix : [{ channel: 'whatsapp', order: 1, delayHours: 0, contentAssetId: null }],
    messagingAngle: clip(c.messagingAngle, 600),
    counterOffers: asArr(c.counterOffers).map(x => clip(x, 200)).slice(0, 5),
    sourceSignals,
    rationale: asArr(c.rationale).map(r => ({
      point: clip(r.point, 300), source: clip(r.source || 'analysis', 40), ref: clip(r.ref, 120),
      confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'medium',
    })),
  }
}

function deterministic(evidence) {
  const out = []
  const warm = evidence.segments.warm || 0
  const reeng = evidence.segments.re_engage || 0
  if (warm) out.push({
    name: 'Warm-lead conversion push', objective: 'Move warm leads to a campus visit / counselling booking', segmentKey: 'warm',
    channelMix: [{ channel: 'whatsapp', order: 1, delayHours: 0 }, { channel: 'priya_call', order: 2, delayHours: 48 }],
    messagingAngle: 'Personal, helpful nudge highlighting NAAC A++ and industry-associated programs; offer a slot this week.',
    counterOffers: [], rationale: [{ point: `${warm} warm leads in pipeline`, source: 'segment', confidence: 'high' }],
  })
  const topAlert = evidence.alerts[0]
  if (topAlert) out.push({
    name: `Counter ${topAlert.competitor}`, objective: `Blunt ${topAlert.competitor}'s ${topAlert.signal_type} with a fact-based counter`, segmentKey: 'hot',
    channelMix: [{ channel: 'whatsapp', order: 1, delayHours: 0 }],
    messagingAngle: 'Reassure with verified Aditya strengths on the same dimension the rival is pushing.',
    counterOffers: [clip(topAlert.summary, 200)],
    rationale: [{ point: clip(topAlert.summary, 200), source: 'competitive_signal', ref: String(topAlert._id), confidence: topAlert.confidence }],
  })
  if (reeng) out.push({
    name: 'Re-engage dormant leads', objective: 'Win back leads that went cold after 2+ touches', segmentKey: 're_engage',
    channelMix: [{ channel: 'whatsapp', order: 1, delayHours: 0 }, { channel: 'sms', order: 2, delayHours: 72 }],
    messagingAngle: 'Light, low-pressure check-in with a new reason to reconsider (scholarship deadline / new batch).',
    counterOffers: [], rationale: [{ point: `${reeng} dormant leads`, source: 'segment', confidence: 'medium' }],
  })
  return out
}

/**
 * Propose campaigns for an org/branch. Saves each as Campaign(pending_review).
 * @returns { proposed: Campaign[], usedLlm: boolean, evidence }
 */
async function proposeCampaigns({ orgId, branchId = null, generatedBy = null, max = 3 }) {
  const evidence = await gatherEvidence(orgId, branchId)
  let raw = [], usedLlm = false

  if (hasLlm()) {
    const user = JSON.stringify({
      instruction: 'Propose up to 3 targeted campaigns from this evidence.',
      segmentSizes: evidence.segments,
      leadFunnel: evidence.funnel,
      competitorAlerts: evidence.alerts.map(a => ({ id: String(a._id), competitor: a.competitor, type: a.signal_type, summary: a.summary, relevance: a.admissions_relevance, confidence: a.confidence })),
      returnShape: { campaigns: [{ name: '', objective: '', segmentKey: 'hot|warm|cold|re_engage', filter: { program: '', city: '' }, channelMix: [{ channel: 'whatsapp|sms|email|priya_call', order: 1, delayHours: 0 }], messagingAngle: '', counterOffers: [''], rationale: [{ point: '', source: 'competitive_signal|funnel|segment', ref: '', confidence: 'high|medium|low' }] }] },
    })
    const res = await completeJson({ system: SYSTEM, user, maxTokens: 2000, timeoutMs: 40000 })
    if (res && Array.isArray(res.campaigns)) { raw = res.campaigns; usedLlm = true }
  }
  if (!raw.length) raw = deterministic(evidence)

  const proposed = []
  for (const c of raw.slice(0, max)) {
    const doc = normalize(c, evidence)
    proposed.push(await Campaign.create({
      orgId, branchId, ...doc, status: 'pending_review', generatedBy: 'agent', createdBy: generatedBy, usedLlm,
      metrics: {},
    }))
  }
  return { proposed, usedLlm, evidence }
}

module.exports = { proposeCampaigns, gatherEvidence, SYSTEM }
