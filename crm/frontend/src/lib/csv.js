/**
 * Tiny zero-dependency CSV exporter.
 *
 * Why not a library: csv-stringify et al. add ~50KB to the bundle for what
 * is essentially escape-and-join. The full RFC-4180 surface area (newlines
 * inside fields, BOM for Excel, etc.) is handled below in <30 lines.
 */

function escapeCell(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // RFC 4180: wrap in quotes if the cell contains a comma, quote, or newline.
  // Embedded quotes are doubled.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Convert an array of objects into a CSV string.
 * @param {Array<object>} rows
 * @param {Array<{key:string,label:string,format?:(val,row)=>any}>} columns
 */
export function rowsToCsv(rows, columns) {
  const header = columns.map(c => escapeCell(c.label)).join(',')
  const body = rows.map(row =>
    columns.map(c => {
      const raw = row[c.key]
      const formatted = c.format ? c.format(raw, row) : raw
      return escapeCell(formatted)
    }).join(',')
  ).join('\n')
  return header + '\n' + body
}

/**
 * Trigger a browser download of a CSV string. We prepend a UTF-8 BOM so
 * Excel opens non-ASCII characters (Hindi/Tamil names, ₹ symbols) correctly.
 */
export function downloadCsv(filename, csvString) {
  const BOM = '﻿'
  const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Free the object URL on the next tick — the click() above is synchronous
  // but the browser-initiated download starts asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Convenience: build + download in one call.
 */
export function exportRowsToCsv(filename, rows, columns) {
  downloadCsv(filename, rowsToCsv(rows, columns))
}
