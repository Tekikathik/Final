/**
 * Cron-based call scheduler.
 *
 * Two responsibilities:
 *   1. Sweep — every minute, find Call docs with status='scheduled' whose
 *      scheduledAt has passed and dispatch them via the telephony service.
 *   2. Per-call jobs — when an admin schedules a single contact at a custom
 *      future time (e.g. "tomorrow 10:00"), we register a one-shot cron job
 *      keyed by callId so we don't have to wait up to 60s for the sweep.
 *
 * Why both? The sweep guarantees nothing falls through the cracks if the
 * server restarts (one-shot jobs are in-memory). The one-shot jobs keep
 * scheduled-time precision tight for user-facing demos.
 */
const cron = require('node-cron')
const Call = require('../models/Call')
const College = require('../models/College')
const { dispatchCall } = require('./telephony')

// Active per-call timers keyed by callId. Re-scheduling the same callId
// cancels the previous timer to avoid duplicate dispatches.
const oneShotJobs = new Map()

// Concurrency cap so we don't blast the telephony provider with thousands
// of HTTP requests at once. Process scheduled calls in small batches.
const SWEEP_BATCH = Number(process.env.SCHEDULER_SWEEP_BATCH || 25)

async function dispatchOne(call) {
  try {
    // Optimistic status flip first — prevents double-dispatch if the sweep
    // runs again while we're still awaiting the provider.
    await Call.updateOne(
      { _id: call._id, status: 'scheduled' },
      { $set: { status: 'in_progress', startedAt: new Date() } }
    )
    const college = await College.findById(call.collegeId).lean()
    await dispatchCall({ call, college })
  } catch (err) {
    console.error(`[scheduler] dispatch failed for call ${call._id}:`, err.message)
    // Roll back the status so the next sweep can retry.
    await Call.updateOne({ _id: call._id, status: 'in_progress' }, { $set: { status: 'scheduled' } })
  }
}

/**
 * The minute-by-minute sweep. Picks up:
 *   - calls whose scheduledAt has passed
 *   - calls that were stuck in_progress > 10 min (the provider likely failed
 *     silently — flag them as failed so they show up in the dashboard)
 */
async function sweep() {
  const now = new Date()
  const due = await Call.find({
    status: 'scheduled',
    scheduledAt: { $lte: now },
  }).limit(SWEEP_BATCH).lean()

  if (due.length) console.log(`[scheduler] dispatching ${due.length} due calls`)
  await Promise.allSettled(due.map(dispatchOne))

  // Stuck-call cleanup. 10 minutes is generous — most calls finish in <5min.
  const stuckCutoff = new Date(now.getTime() - 10 * 60 * 1000)
  await Call.updateMany(
    { status: 'in_progress', startedAt: { $lt: stuckCutoff } },
    { $set: { status: 'failed', endedAt: now } }
  )
}

/**
 * Schedule a single call at a precise future time. Used by the trigger route
 * when settings.scheduleAt is in the future. Falls back to the sweep if the
 * time is already past or within the next 30s.
 */
function scheduleOne(call) {
  const when = new Date(call.scheduledAt)
  const ms = when.getTime() - Date.now()
  if (ms <= 30_000) return // sweep will handle it shortly

  // Cancel any prior one-shot for this call (e.g. user re-scheduled).
  const existing = oneShotJobs.get(String(call._id))
  if (existing) clearTimeout(existing)

  const timer = setTimeout(async () => {
    oneShotJobs.delete(String(call._id))
    const fresh = await Call.findById(call._id).lean()
    if (fresh && fresh.status === 'scheduled') await dispatchOne(fresh)
  }, ms)
  oneShotJobs.set(String(call._id), timer)
}

/**
 * Boot the scheduler. Called once from server.js after the DB connects.
 * We run the sweep on a 1-minute cron and once on startup so calls scheduled
 * during a server downtime fire as soon as we're back up.
 */
function startScheduler() {
  if (process.env.SCHEDULER_ENABLED === 'false') {
    console.log('[scheduler] disabled via SCHEDULER_ENABLED=false')
    return
  }
  cron.schedule('* * * * *', sweep)
  // Don't await — we want the HTTP server to bind even if the first sweep is slow.
  sweep().catch(err => console.error('[scheduler] initial sweep error:', err.message))
  console.log('[scheduler] started — sweeping for due calls every minute')
}

module.exports = { startScheduler, scheduleOne, dispatchOne }
