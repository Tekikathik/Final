const fs   = require('fs')
const path = require('path')

const DATA_DIR  = path.join(__dirname, '..', 'data')
const CHUNK_MAX = 500  // characters per chunk

let chunks = []  // [{ id, source, text, tokens }]
let df     = {}  // document frequency: term → number of chunks containing it

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

// Common English stopwords — excluded from BM25 matching so domain terms score higher
const STOPWORDS = new Set([
  'the','and','for','are','has','have','from','with','this','that',
  'will','been','were','was','can','all','also','its','their','they',
  'our','your','any','one','may','per','two','each','but','not','use',
  'who','than','more','into','through','which','some','you','she','his',
  'her','him','out','about','over','such','both','these','those','after',
  'only','well','then','them','very','just','how','what','when','where',
  'offered','available','include','includes','program','programs',
])

// ── Text helpers ──────────────────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function chunkText(text, source) {
  const result = []
  let id = 0

  // Split on double newlines first (paragraph boundaries)
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)

  for (const para of paragraphs) {
    if (para.length <= CHUNK_MAX) {
      result.push({ id: `${source}:${id++}`, source, text: para, tokens: tokenize(para) })
    } else {
      // Break long paragraph at sentence boundaries
      const sentences = para.split(/(?<=[.?!])\s+/)
      let buf = ''
      for (const s of sentences) {
        if (buf && (buf + ' ' + s).length > CHUNK_MAX) {
          result.push({ id: `${source}:${id++}`, source, text: buf.trim(), tokens: tokenize(buf) })
          buf = s
        } else {
          buf = buf ? buf + ' ' + s : s
        }
      }
      if (buf.trim()) result.push({ id: `${source}:${id++}`, source, text: buf.trim(), tokens: tokenize(buf) })
    }
  }
  return result
}

// ── BM25 scoring ─────────────────────────────────────────────────────────────

const K1 = 1.5
const B  = 0.75

// Recompute document frequency table after any change to chunks
function computeDF() {
  df = {}
  for (const chunk of chunks) {
    const seen = new Set(chunk.tokens)
    for (const t of seen) df[t] = (df[t] || 0) + 1
  }
}

function avgTokenLen() {
  if (!chunks.length) return 60
  return Math.round(chunks.reduce((s, c) => s + c.tokens.length, 0) / chunks.length)
}

// Standard BM25 with true IDF (rare terms score higher than common ones)
function bm25(queryTokens, chunk, N, avgLen) {
  if (!queryTokens.length) return 0
  const tf = {}
  for (const t of chunk.tokens) tf[t] = (tf[t] || 0) + 1
  let score = 0
  for (const qt of queryTokens) {
    if (!tf[qt]) continue
    const dfq = df[qt] || 0.5
    const idf  = Math.log((N - dfq + 0.5) / (dfq + 0.5) + 1)
    score += idf * (tf[qt] * (K1 + 1)) / (tf[qt] + K1 * (1 - B + B * chunk.tokens.length / avgLen))
  }
  return score
}

// ── Public API ────────────────────────────────────────────────────────────────

function search(query, topK = 3) {
  if (!chunks.length) return []
  const qt  = tokenize(query)
  const N   = chunks.length
  const avg = avgTokenLen()
  return chunks
    .map(c => ({ source: c.source, text: c.text, score: bm25(qt, c, N, avg) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

function addDocument(name, text) {
  chunks = chunks.filter(c => c.source !== name)
  const fresh = chunkText(text, name)
  chunks.push(...fresh)
  computeDF()
  console.log(`[RAG] "${name}" → ${fresh.length} chunks  (total: ${chunks.length})`)
  return fresh.length
}

function loadDirectory() {
  chunks = []
  if (!fs.existsSync(DATA_DIR)) return
  const files = fs.readdirSync(DATA_DIR).filter(f => /\.(txt|md)$/i.test(f))
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8')
      const fresh = chunkText(text, file)
      chunks.push(...fresh)
      console.log(`[RAG] Loaded "${file}" → ${fresh.length} chunks`)
    } catch (err) {
      console.error(`[RAG] Failed to load "${file}":`, err.message)
    }
  }
  computeDF()
  console.log(`[RAG] Ready — ${chunks.length} total chunks from ${files.length} document(s)`)
}

function listDocuments() {
  const map = {}
  for (const c of chunks) map[c.source] = (map[c.source] || 0) + 1
  return Object.entries(map).map(([name, chunkCount]) => ({ name, chunkCount }))
}

// Load documents on startup
loadDirectory()

module.exports = { search, addDocument, loadDirectory, listDocuments, chunkText, DATA_DIR }
