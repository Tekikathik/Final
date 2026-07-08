// ---------------------------------------------------------------------------
// Rebuild the embedding vector index from data/knowledgeBase.js, then ingest
// any PDF brochures found in data/.
//
// Usage: npm run reindex
// ---------------------------------------------------------------------------
require('dotenv').config()

const fs   = require('fs')
const path = require('path')

const vectorStore  = require('../services/vectorStore')
const knowledgeBase = require('../data/knowledgeBase')
const ingest = require('../services/ingest')
const ragStore = require('../services/ragStore')

;(async () => {
  await vectorStore.rebuild()
  console.log(`[Reindex] Rebuilt index from ${knowledgeBase.length} knowledge base documents`)

  const dataDir = ragStore.DATA_DIR
  const pdfs = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.pdf'))
    : []

  for (const pdf of pdfs) {
    const chunkCount = await ingest.ingestPdf(path.join(dataDir, pdf))
    console.log(`[Reindex] Ingested "${pdf}" → ${chunkCount} chunks`)
  }

  console.log(`[Reindex] Done — ${knowledgeBase.length} KB documents + ${pdfs.length} PDF(s)`)
})()
