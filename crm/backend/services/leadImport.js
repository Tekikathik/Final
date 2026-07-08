const { v4: uuidv4 } = require('uuid')
const Lead = require('../models/Lead')
const DNDEntry = require('../models/DNDEntry')
const { normalizeIndianPhone, parseLeadBlob } = require('../utils/phone')

/**
 * Validate + dedupe + DND-check a batch of rows, then insert new leads.
 *
 * @param rows   array of { name, phone, email } (from parseLeadBlob or JSON)
 * @param ctx    { orgId, branchId, assignedOfficerId?, source?, createdBy? }
 * @returns summary { batchId, total, imported, results, counts }
 *          results[] = { phone, name, outcome, reason? }
 *          outcome ∈ imported | duplicate | invalid | dnd
 */
async function importLeads(rows, ctx) {
  const batchId = uuidv4()
  const results = []
  const counts = { imported: 0, duplicate: 0, invalid: 0, dnd: 0 }

  // Normalise + validate, tracking in-batch duplicates too.
  const seenInBatch = new Set()
  const candidates = []
  for (const row of rows) {
    const norm = normalizeIndianPhone(row.phone)
    if (!norm.ok) {
      counts.invalid++
      results.push({ phone: row.phone, name: row.name || '', outcome: 'invalid', reason: norm.reason })
      continue
    }
    if (seenInBatch.has(norm.phone)) {
      counts.duplicate++
      results.push({ phone: norm.phone, name: row.name || '', outcome: 'duplicate', reason: 'duplicate_in_file' })
      continue
    }
    seenInBatch.add(norm.phone)
    candidates.push({ ...row, phone: norm.phone })
  }

  if (candidates.length) {
    const phones = candidates.map(c => c.phone)

    // Existing leads in this org (cross-branch dedupe) and DND blocklist.
    const [existing, dnd] = await Promise.all([
      Lead.find({ orgId: ctx.orgId, phone: { $in: phones } }).select('phone').lean(),
      DNDEntry.find({ orgId: ctx.orgId, phone: { $in: phones } }).select('phone').lean(),
    ])
    const existingSet = new Set(existing.map(e => e.phone))
    const dndSet = new Set(dnd.map(d => d.phone))

    const toInsert = []
    for (const c of candidates) {
      if (existingSet.has(c.phone)) {
        counts.duplicate++
        results.push({ phone: c.phone, name: c.name, outcome: 'duplicate', reason: 'already_contacted' })
        continue
      }
      const onDnd = dndSet.has(c.phone)
      if (onDnd) counts.dnd++
      toInsert.push({
        orgId:    ctx.orgId,
        branchId: ctx.branchId,
        assignedOfficerId: ctx.assignedOfficerId || null,
        name:  c.name || 'Unknown',
        email: c.email || '',
        phone: c.phone,
        phoneRaw: c.phoneRaw || c.phone,
        status: 'New',
        dnd: onDnd,
        source: ctx.source || 'import',
        importBatchId: batchId,
        statusHistory: [{ status: 'New', by: ctx.createdBy || null, note: 'imported' }],
        // DND leads are imported but flagged — they won't be called.
        _outcome: onDnd ? 'dnd' : 'imported',
      })
    }

    // insertMany with ordered:false so one race-dup doesn't abort the batch.
    if (toInsert.length) {
      const docs = toInsert.map(({ _outcome, ...d }) => d)
      let inserted = []
      try {
        inserted = await Lead.insertMany(docs, { ordered: false })
      } catch (err) {
        // Partial success: collect what did insert (E11000 dup races land here).
        inserted = err.insertedDocs || []
      }
      const insertedSet = new Set(inserted.map(d => d.phone))
      for (const d of toInsert) {
        if (insertedSet.has(d.phone)) {
          if (d._outcome === 'dnd') results.push({ phone: d.phone, name: d.name, outcome: 'dnd', reason: 'on_dnd_list' })
          else { counts.imported++; results.push({ phone: d.phone, name: d.name, outcome: 'imported' }) }
        } else {
          counts.duplicate++
          results.push({ phone: d.phone, name: d.name, outcome: 'duplicate', reason: 'race_duplicate' })
        }
      }
    }
  }

  return { batchId, total: rows.length, imported: counts.imported, counts, results }
}

module.exports = { importLeads, parseLeadBlob }
