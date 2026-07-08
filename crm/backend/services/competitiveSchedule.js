// Scheduled Competitive Intelligence runs (cadence per aditya-university-ci-agent-prompt.md):
//   • Weekly brief — every Monday 09:00 (all 5 sections). Override with COMPETITIVE_CRON.
//   • Mini-brief  — Thursday 09:00 during counselling season (May–September): sections 1–2
//     only, when AP EAPCET results→spot admissions make the landscape move fastest.
//     Override with COMPETITIVE_MINI_CRON, or disable everything with COMPETITIVE_SCHEDULE=off.
const cron = require('node-cron')
const Organization = require('../models/Organization')
const { generateReport } = require('./competitiveAgent')

// May (4) … September (8), zero-based months.
const inCounsellingSeason = () => { const m = new Date().getMonth(); return m >= 4 && m <= 8 }

async function runForAllOrgs(briefType) {
  const orgs = await Organization.find({ isActive: true }).select('_id name').lean()
  for (const org of orgs) {
    try {
      const r = await generateReport({ orgId: org._id, trigger: 'scheduled', briefType })
      console.log(`[competitive] scheduled ${briefType} report for ${org.name}: ` +
        `${r.competitors.length} rivals, ${r.signalStats.total} signals (${r.signalStats.alerts} alerts), ${r.recommendations.length} recs`)
    } catch (e) { console.error(`[competitive] ${org.name} failed:`, e.message) }
  }
}

function startCompetitiveSchedule() {
  if (String(process.env.COMPETITIVE_SCHEDULE || '').toLowerCase() === 'off') return

  const weekly = process.env.COMPETITIVE_CRON || '0 9 * * 1'         // Monday 09:00
  if (!cron.validate(weekly)) { console.warn(`[competitive] invalid COMPETITIVE_CRON '${weekly}'`); return }
  cron.schedule(weekly, () => runForAllOrgs('weekly').catch(e => console.error('[competitive] weekly sweep failed:', e.message)))

  const mini = process.env.COMPETITIVE_MINI_CRON || '0 9 * * 4'      // Thursday 09:00
  if (cron.validate(mini)) {
    cron.schedule(mini, () => {
      if (!inCounsellingSeason()) return                             // only May–September
      runForAllOrgs('mini').catch(e => console.error('[competitive] mini sweep failed:', e.message))
    })
  } else console.warn(`[competitive] invalid COMPETITIVE_MINI_CRON '${mini}' — mini-brief disabled`)

  console.log(`[competitive] scheduled agent: weekly '${weekly}', counselling-season mini '${mini}'`)
}

module.exports = { startCompetitiveSchedule }
