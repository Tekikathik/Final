// ---------------------------------------------------------------------------
// PDF ingestion — extract text from a PDF brochure, chunk it the same way
// ragStore chunks .txt/.md files, embed the chunks, and upsert them into the
// live vector store so they become searchable immediately.
// ---------------------------------------------------------------------------
const fs       = require('fs')
const path     = require('path')
const pdfParse = require('pdf-parse')
const ragStore = require('./ragStore')
const vectorStore = require('./vectorStore')

async function ingestPdf(filePath) {
  const buf  = fs.readFileSync(filePath)
  const { text } = await pdfParse(buf)

  const source = path.basename(filePath)
  const chunks = ragStore.chunkText(text, source)

  if (!chunks.length) return 0

  await vectorStore.upsertChunks(
    chunks.map(c => ({ id: c.id, text: c.text, metadata: { section: 'pdf', source } }))
  )
  return chunks.length
}

module.exports = { ingestPdf }
