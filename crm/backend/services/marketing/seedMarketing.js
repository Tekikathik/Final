// ---------------------------------------------------------------------------
// Populate the Marketing module with a clean, ready-to-demo dataset for an org:
//   • scores every lead (fills the segment buckets)
//   • three APPROVED, claim-free content assets
//   • one 'pending_review' campaign (shows the approval flow) with content attached
//   • one 'active' campaign already enqueued (so the funnel shows real numbers)
// Idempotent: only removes its own '[Demo]' rows on re-run, never real campaigns.
// ---------------------------------------------------------------------------
const Campaign = require('../../models/Campaign')
const CampaignMessage = require('../../models/CampaignMessage')
const ContentAsset = require('../../models/ContentAsset')
const { scoreOrg } = require('./leadScoring')
const { enqueueCampaign } = require('./outreach')

const TAG = '[Demo]'

async function seedMarketingDemo(orgId, userId = null) {
  // Wipe prior demo rows (by tag) so re-seeding is clean.
  const demoCamps = await Campaign.find({ orgId, name: new RegExp(`^\\${TAG}`) }).select('_id').lean()
  await Promise.all([
    CampaignMessage.deleteMany({ campaignId: { $in: demoCamps.map(c => c._id) } }),
    Campaign.deleteMany({ orgId, name: new RegExp(`^\\${TAG}`) }),
    ContentAsset.deleteMany({ orgId, title: new RegExp(`^\\${TAG}`) }),
  ])

  const scored = await scoreOrg(orgId)

  // Three approved, claim-free assets (no numbers → no compliance block).
  const [waWarm, emailWarm, waHot] = await ContentAsset.insertMany([
    { orgId, kind: 'whatsapp', language: 'mixed', title: `${TAG} Warm — NAAC A++ nudge`, purpose: 'Awareness of NAAC A++ + industry programs',
      body: 'Hi {name}! 🎓 {program} at Aditya University — NAAC A++ tho industry-associated programs (SAP, Google, Microsoft). Oka campus visit slot book cheddama? Reply YES.',
      variables: ['name', 'program'], status: 'approved', generatedBy: 'agent', authoredBy: userId },
    { orgId, kind: 'email', language: 'english', title: `${TAG} Warm — NAAC A++ email`, purpose: 'Follow-up email for warm leads',
      subject: 'Your next step at Aditya University', body: 'Hi {name},\n\nAditya University is NAAC A++ accredited with industry-associated B.Tech programs and strong placements. We would love to show you around {branch}.\n\nReply to this email and our team will arrange a visit.\n\n— Aditya University Admissions',
      variables: ['name', 'branch'], status: 'approved', generatedBy: 'agent', authoredBy: userId },
    { orgId, kind: 'whatsapp', language: 'mixed', title: `${TAG} Hot — Placement push`, purpose: 'Drive hot leads to counselling',
      body: 'Hi {name}! Aditya University lo {program} placements chala strong. Ee week counselling book cheddama? Reply YES ani.',
      variables: ['name', 'program'], status: 'approved', generatedBy: 'agent', authoredBy: userId },
  ])

  // Pending-review campaign (demonstrates the approval gate).
  const pending = await Campaign.create({
    orgId, branchId: null, name: `${TAG} Warm — NAAC A++ nudge`, objective: 'Move warm leads to a campus visit with the NAAC A++ / industry-programs angle',
    status: 'pending_review', segmentKey: 'warm', generatedBy: 'agent', createdBy: userId,
    channelMix: [
      { channel: 'whatsapp', order: 1, delayHours: 0, contentAssetId: waWarm._id },
      { channel: 'email', order: 2, delayHours: 48, contentAssetId: emailWarm._id },
    ],
    messagingAngle: 'Warm, helpful nudge leading with NAAC A++ and industry-associated programs.',
    rationale: [{ point: 'Warm segment has interested-but-undecided leads', source: 'segment', confidence: 'high' }],
    schedule: { sendFromHour: 9, sendToHour: 20, dailyCap: 300, throttlePerMin: 30 },
  })

  // Active campaign, already enqueued (funnel shows targeted/queued immediately).
  const active = await Campaign.create({
    orgId, branchId: null, name: `${TAG} Hot — Placement push`, objective: 'Convert hot leads to counselling this week',
    status: 'active', segmentKey: 'hot', generatedBy: 'agent', createdBy: userId, activatedAt: new Date(),
    channelMix: [{ channel: 'whatsapp', order: 1, delayHours: 0, contentAssetId: waHot._id }],
    messagingAngle: 'Confident placement-led message with a this-week counselling CTA.',
    rationale: [{ point: 'Hot segment = highest-intent leads', source: 'segment', confidence: 'high' }],
    schedule: { startAt: new Date(), sendFromHour: 9, sendToHour: 20, dailyCap: 300, throttlePerMin: 30 },
  })
  const enq = await enqueueCampaign(active)

  return {
    segments: scored.counts,
    content: 3,
    campaigns: [{ name: pending.name, status: pending.status }, { name: active.name, status: active.status, ...enq }],
  }
}

module.exports = { seedMarketingDemo }
