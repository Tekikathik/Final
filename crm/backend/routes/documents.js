// ---------------------------------------------------------------------------
// Document management routes for RAG — /api/priya/documents
//
//  POST   /api/priya/documents        — upload a .txt, .md, or .pdf file
//  GET    /api/priya/documents        — list all indexed documents
//  DELETE /api/priya/documents/:name  — remove a document and re-index
// ---------------------------------------------------------------------------
const router   = require('express').Router()
const multer   = require('multer')
const path     = require('path')
const fs       = require('fs')
const ragStore = require('../services/ragStore')
const ingest   = require('../services/ingest')

// Save uploads directly into the RAG data directory
const storage = multer.diskStorage({
  destination: ragStore.DATA_DIR,
  filename: (_req, file, cb) => cb(null, file.originalname),
})

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.txt', '.md', '.pdf'].includes(ext)) return cb(null, true)
    cb(new Error('Only .txt, .md, and .pdf files are accepted'))
  },
  limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB
})

// ── POST /api/priya/documents ─────────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file provided' })

  const filePath = path.join(ragStore.DATA_DIR, req.file.originalname)
  const ext      = path.extname(req.file.originalname).toLowerCase()

  try {
    let text = ''
    let indexedAs = req.file.originalname

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse')
      const buf = fs.readFileSync(filePath)
      const pdf = await pdfParse(buf)
      text = pdf.text

      // Persist as .txt so future server restarts auto-load it
      indexedAs = req.file.originalname.replace(/\.pdf$/i, '.txt')
      fs.writeFileSync(path.join(ragStore.DATA_DIR, indexedAs), text)
      fs.unlinkSync(filePath)  // remove original PDF
    } else {
      text = fs.readFileSync(filePath, 'utf8')
    }

    const chunkCount = ragStore.addDocument(indexedAs, text)
    res.json({ success: true, name: indexedAs, chunkCount })
  } catch (err) {
    // Clean up partial upload on error
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    res.status(500).json({ message: err.message })
  }
})

// ── POST /api/priya/documents/upload ──────────────────────────────────────────
// PDF brochure ingestion straight into the embedding vector store (does not
// touch the BM25 ragStore index — separate from the / route above).
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file provided' })

  const filePath = path.join(ragStore.DATA_DIR, req.file.originalname)
  const ext      = path.extname(req.file.originalname).toLowerCase()

  if (ext !== '.pdf') {
    fs.unlinkSync(filePath)
    return res.status(400).json({ message: 'Only .pdf files are accepted on /upload' })
  }

  try {
    const chunkCount = await ingest.ingestPdf(filePath)
    res.json({ success: true, name: req.file.originalname, chunkCount })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/priya/documents ──────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json(ragStore.listDocuments())
})

// ── DELETE /api/priya/documents/:name ────────────────────────────────────────
router.delete('/:name', (req, res) => {
  const name     = req.params.name
  const filePath = path.join(ragStore.DATA_DIR, name)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  ragStore.loadDirectory()
  res.json({ success: true, remaining: ragStore.listDocuments() })
})

module.exports = router
