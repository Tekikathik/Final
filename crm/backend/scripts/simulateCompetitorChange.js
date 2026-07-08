// ---------------------------------------------------------------------------
// TEST HELPER — fake an "old" snapshot for one competitor so the next CI run
// detects changes and fires alerts. Rewrites lastSnapshot with worse numbers
// than whatever the live scrape will find, so diffSnapshot emits:
//   fee_change (reduction → ALERT), scholarship (new → ALERT),
//   placement_claim (contradiction → ALERT), new_program (if CSE/AIML found → ALERT).
//
// Usage:  node scripts/simulateCompetitorChange.js "GITAM"
//         (name matches case-insensitively; defaults to the first competitor)
// Then:   POST /api/competitive/generate and check signalStats / GET /signals.
// ---------------------------------------------------------------------------
require('dotenv').config()
const mongoose = require('mongoose')
const Competitor = require('../models/Competitor')

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/admitai')
  const nameArg = process.argv[2]
  const q = nameArg ? { name: new RegExp(`^${nameArg}$`, 'i') } : {}
  const comp = await Competitor.findOne(q).sort({ name: 1 })
  if (!comp) { console.error(`Competitor ${nameArg ? `'${nameArg}' ` : ''}not found.`); process.exit(1) }

  // "Old" baseline chosen so almost any successful fresh scrape differs from it.
  comp.lastSnapshot = {
    profile: {
      annualFeeLpa: 9.9,                 // fresh fee will be lower → fee_change ALERT
      scholarships: '',                  // any scraped scholarship text → scholarship ALERT
      placementHighestLpa: 1,           // any real claim differs >15% → placement_claim ALERT
      placementAvgLpa: 1,
      programs: ['Diploma in Basket Weaving'],  // real programs appear "new" → new_program
      naac: 'B',                         // real grade differs → accreditation signal (no alert)
      nirfRank: '999',
    },
    capturedAt: new Date(),
  }
  await comp.save()
  console.log(`Rewrote lastSnapshot for "${comp.name}" (tier ${comp.tier}).`)
  console.log('Now run POST /api/competitive/generate — the diff vs this fake baseline should produce signals + alerts.')
  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
