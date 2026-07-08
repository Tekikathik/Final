// Scheduled Marketing Agent Suite jobs — registered alongside the CI scheduler.
// All jobs are org-wide sweeps, guarded so one org's failure can't stop the rest.
// Disable everything with MARKETING_SCHEDULE=off.
//
//   • Outreach drain  — every minute: send due, queued, in-window messages
//     (throttled per-campaign, so "every minute" is safe at season volume).
//   • Sequence advance — every 15 min: promote non-responders to the next step.
//   • Lead scoring     — nightly 02:30: re-score every org's leads → segments.
//   • Re-engagement    — daily 10:15: revive stalled/quiet leads.
//   • Attribution      — hourly: stitch events → Campaign.metrics.
//   • Weekly brief     — Monday 08:30 (after the CI 07/09 briefs): admin summary.
const cron = require('node-cron')
const Organization = require('../../models/Organization')
const { drainActive } = require('./outreach')
const { advanceSequences, reengageStalled } = require('./nurture')
const { scoreOrg } = require('./leadScoring')
const { runAttribution, weeklyBrief } = require('./marketingAnalytics')

let running = false   // coarse guard so a slow drain can't overlap itself

async function forEachOrg(fn, label) {
  const orgs = await Organization.find({ isActive: true }).select('_id name').lean()
  for (const org of orgs) {
    try { await fn(org) } catch (e) { console.error(`[marketing:${label}] ${org.name} failed:`, e.message) }
  }
}

function startMarketingSchedule() {
  if (String(process.env.MARKETING_SCHEDULE || '').toLowerCase() === 'off') return
  const on = (expr, label, job) => {
    if (!cron.validate(expr)) return console.warn(`[marketing] invalid cron '${expr}' for ${label}`)
    cron.schedule(expr, () => job().catch(e => console.error(`[marketing:${label}] sweep failed:`, e.message)))
  }

  // Outreach drain — bounded per campaign by dailyCap + throttlePerMin.
  on(process.env.MARKETING_DRAIN_CRON || '* * * * *', 'drain', async () => {
    if (running) return
    running = true
    try { const t = await drainActive(); if (t.sent || t.calls || t.failed) console.log(`[marketing:drain] sent=${t.sent} calls=${t.calls} skipped=${t.skipped} failed=${t.failed}`) }
    finally { running = false }
  })

  on('*/15 * * * *', 'advance', async () => { const t = await advanceSequences(); if (t.advanced) console.log(`[marketing:advance] +${t.advanced} next-step touches`) })
  on(process.env.MARKETING_SCORE_CRON || '30 2 * * *', 'score', () => forEachOrg(async o => {
    const r = await scoreOrg(o._id); console.log(`[marketing:score] ${o.name}: ${r.scored} leads`, r.counts)
  }, 'score'))
  on('15 10 * * *', 'reengage', () => forEachOrg(o => reengageStalled(o._id), 'reengage'))
  on('0 * * * *', 'attribution', () => forEachOrg(o => runAttribution(o._id), 'attribution'))
  on(process.env.MARKETING_BRIEF_CRON || '30 8 * * 1', 'brief', () => forEachOrg(async o => {
    const b = await weeklyBrief(o._id); console.log(`[marketing:brief] ${o.name}: ${b.facts.totals.enrollments} enrolled this week`)
  }, 'brief'))

  console.log('[marketing] scheduled: drain(1m) advance(15m) score(02:30) reengage(10:15) attribution(hourly) brief(Mon 08:30)')
}

module.exports = { startMarketingSchedule }
