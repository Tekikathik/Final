// ---------------------------------------------------------------------------
// Delete ALL Competitive Intelligence history — every generated report and every
// detected change-signal, across all orgs. Tracked competitors and their
// definitions are KEPT (they're configuration, not history); their lastSnapshot
// is cleared so the next run rebaselines cleanly instead of emitting stale diffs.
//
// Usage:  node scripts/clearCompetitiveHistory.js
// ---------------------------------------------------------------------------
require('dotenv').config()
const mongoose = require('mongoose')
const CompetitiveReport = require('../models/CompetitiveReport')
const CompetitiveSignal = require('../models/CompetitiveSignal')
const Competitor = require('../models/Competitor')

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/admitai'
  await mongoose.connect(uri)
  const reports = await CompetitiveReport.deleteMany({})
  const signals = await CompetitiveSignal.deleteMany({})
  const snaps = await Competitor.updateMany({}, { $set: { lastSnapshot: { profile: null, capturedAt: null } } })
  console.log(`Deleted ${reports.deletedCount} report(s) and ${signals.deletedCount} signal(s).`)
  console.log(`Reset change-detection baseline on ${snaps.modifiedCount} competitor(s).`)
  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
