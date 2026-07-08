// India-focused phone normalisation + validation, shared by lead import and calling.

/**
 * Normalise to E.164 (+91XXXXXXXXXX) for Indian mobiles.
 * Returns { ok, phone, reason }. ok=false → reason describes why it's invalid.
 */
function normalizeIndianPhone(raw) {
  if (raw == null) return { ok: false, reason: 'empty' }
  let d = String(raw).trim()
  if (!d) return { ok: false, reason: 'empty' }

  // Strip spaces, dashes, brackets, dots; keep a leading +.
  d = d.replace(/[\s\-().]/g, '')
  d = d.replace(/^\+/, '')        // drop leading + for digit work
  d = d.replace(/^0+/, '')        // drop trunk 0 / leading zeros
  d = d.replace(/^91/, '')        // drop country code if present

  if (!/^\d+$/.test(d)) return { ok: false, reason: 'non_numeric' }
  if (d.length !== 10)  return { ok: false, reason: 'wrong_length' }
  // Indian mobiles start 6-9.
  if (!/^[6-9]/.test(d)) return { ok: false, reason: 'invalid_prefix' }

  return { ok: true, phone: `+91${d}` }
}

/**
 * Parse a pasted/CSV blob into rows. Accepts CSV with optional header
 * (name,phone[,email]) OR a plain newline/comma-separated list of numbers.
 * Returns an array of { name, phone, email }.
 */
function parseLeadBlob(text) {
  const rows = []
  if (!text) return rows
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Detect a header row like "name,phone" / "phone,name,email".
  let headerCols = null
  if (lines.length && /[a-z]/i.test(lines[0]) && lines[0].includes(',') &&
      /name|phone|mobile|email/i.test(lines[0])) {
    headerCols = lines.shift().split(',').map(c => c.trim().toLowerCase())
  }

  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim())
    if (headerCols) {
      const get = (names) => {
        for (const n of names) { const i = headerCols.indexOf(n); if (i >= 0 && parts[i]) return parts[i] }
        return ''
      }
      rows.push({
        name:  get(['name', 'fullname', 'student']) || 'Unknown',
        phone: get(['phone', 'mobile', 'number', 'contact']),
        email: get(['email', 'mail']),
      })
    } else {
      // No header: first comma-field that looks like a number is the phone.
      const phone = parts.find(p => /\d/.test(p)) || parts[0]
      const name  = parts.find(p => p && p !== phone && /[a-z]/i.test(p)) || 'Unknown'
      rows.push({ name, phone, email: '' })
    }
  }
  return rows
}

module.exports = { normalizeIndianPhone, parseLeadBlob }
