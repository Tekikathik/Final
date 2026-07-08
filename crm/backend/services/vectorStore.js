// ---------------------------------------------------------------------------
// Vector Store — semantic search over the knowledge base
//
//   - Primary mode: real Gemini embeddings (embeddings.embed), cosine similarity
//   - Fallback mode: TF-IDF cosine similarity, used only if GEMINI_API_KEY is
//     missing or the embedding call fails at boot — so the app always starts
//   - Saved to backend/db/vectors.json (fast reload on restart)
//
// Public contract (unchanged): search(query, topK) → [{ source, text, score }]
// ---------------------------------------------------------------------------
const fs         = require('fs')
const path       = require('path')
const embeddings = require('./embeddings')

const CACHE_PATH    = path.join(__dirname, '..', 'db', 'vectors.json')
const CACHE_VERSION = 4

let vocab         = []           // TF-IDF fallback only: sorted list of all unique terms
let idf           = {}           // TF-IDF fallback only: term → IDF score
let docs          = []           // [{ id, text, metadata, vector: Float32Array }]
let ready         = false
let embeddingMode = false        // true once docs hold real Sarvam embeddings

// ── TF-IDF fallback ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','and','for','are','has','have','from','with','this','that','will',
  'been','were','was','can','all','also','its','their','they','our','your',
  'any','one','may','per','two','each','but','not','use','who','than','more',
  'into','which','some','you','she','his','her','him','out','over','both',
  'after','only','well','then','them','very','just','how','what','when',
  'where','offered','available','include','program','programs','course',
])

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
}

function buildVocab(allTokens) {
  const set = new Set()
  for (const tokens of allTokens) tokens.forEach(t => set.add(t))
  return Array.from(set).sort()
}

function computeIDF(allTokens) {
  const N  = allTokens.length
  const df = {}
  for (const tokens of allTokens) {
    new Set(tokens).forEach(t => { df[t] = (df[t] || 0) + 1 })
  }
  const result = {}
  for (const t of Object.keys(df)) {
    result[t] = Math.log((N + 1) / (df[t] + 1)) + 1  // smoothed IDF
  }
  return result
}

function toVectorTfidf(tokens) {
  // TF (log-normalised) × IDF
  const tf = {}
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1

  const vec = new Float32Array(vocab.length)
  let   norm = 0
  vocab.forEach((t, i) => {
    if (!tf[t] || !idf[t]) return
    const w  = (1 + Math.log(tf[t])) * idf[t]
    vec[i]   = w
    norm    += w * w
  })
  if (norm > 0) {
    const inv = 1 / Math.sqrt(norm)
    for (let i = 0; i < vec.length; i++) vec[i] *= inv
  }
  return vec
}

function buildTfidf(knowledgeDocs) {
  console.log(`[VectorStore] Building TF-IDF index for ${knowledgeDocs.length} documents...`)

  const allTokens = knowledgeDocs.map(d => tokenize(d.text))

  vocab = buildVocab(allTokens)
  idf   = computeIDF(allTokens)

  docs = knowledgeDocs.map((d, i) => ({
    id:       d.id,
    text:     d.text,
    metadata: d.metadata || {},
    vector:   toVectorTfidf(allTokens[i]),
  }))

  embeddingMode = false
  ready = true
  saveCache()
  console.log(`[VectorStore] Ready (TF-IDF) — ${docs.length} vectors, vocab size ${vocab.length}`)
}

// ── Shared helpers ────────────────────────────────────────────────────────

function l2normalize(vec) {
  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  if (norm > 0) {
    const inv = 1 / Math.sqrt(norm)
    for (let i = 0; i < vec.length; i++) vec[i] *= inv
  }
  return vec
}

function cosine(a, b) {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// ── Cache I/O ─────────────────────────────────────────────────────────────

function saveCache() {
  const dir = path.dirname(CACHE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const serialised = docs.map(d => ({
    id: d.id, text: d.text, metadata: d.metadata,
    vector: Array.from(d.vector),
  }))
  fs.writeFileSync(CACHE_PATH, JSON.stringify({
    version: CACHE_VERSION, embeddingMode, vocab, idf, documents: serialised,
  }, null, 2))
  console.log(`[VectorStore] Saved ${docs.length} vectors to cache (embeddingMode=${embeddingMode})`)
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return false
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    if (data.version !== CACHE_VERSION) return false
    if (!data.documents || data.documents.length === 0) return false
    vocab         = data.vocab || []
    idf           = data.idf   || {}
    embeddingMode = !!data.embeddingMode
    docs  = data.documents.map(d => ({
      ...d, vector: new Float32Array(d.vector),
    }))
    ready = true
    console.log(`[VectorStore] Loaded ${docs.length} vectors from cache (embeddingMode=${embeddingMode})`)
    return true
  } catch {
    return false
  }
}

// ── Build ─────────────────────────────────────────────────────────────────

async function build(knowledgeDocs) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[VectorStore] GEMINI_API_KEY not set — falling back to TF-IDF index')
    return buildTfidf(knowledgeDocs)
  }

  console.log(`[VectorStore] Building Gemini embedding index for ${knowledgeDocs.length} documents...`)
  try {
    const vectors = await embeddings.embed(knowledgeDocs.map(d => d.text))
    docs = knowledgeDocs.map((d, i) => ({
      id:       d.id,
      text:     d.text,
      metadata: d.metadata || {},
      vector:   l2normalize(Float32Array.from(vectors[i])),
    }))
    embeddingMode = true
    ready = true
    saveCache()
    console.log(`[VectorStore] Ready (Gemini embeddings) — ${docs.length} vectors`)
  } catch (err) {
    console.warn('[VectorStore] Gemini embedding failed, falling back to TF-IDF:', err.message)
    buildTfidf(knowledgeDocs)
  }
}

// ── Search ────────────────────────────────────────────────────────────────

async function search(query, topK = 3) {
  if (!ready || !docs.length) return []

  let qVec
  if (embeddingMode) {
    try {
      const [vec] = await embeddings.embed([query])
      qVec = l2normalize(Float32Array.from(vec))
    } catch (err) {
      console.warn('[VectorStore] Query embedding failed, returning no results for this turn:', err.message)
      return []
    }
  } else {
    qVec = toVectorTfidf(tokenize(query))
  }

  return docs
    .map(d  => ({ source: d.id, text: d.text, score: cosine(qVec, d.vector) }))
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// ── Incremental upsert (used by PDF ingestion) ──────────────────────────────

async function upsertChunks(newDocs) {
  if (!embeddingMode) {
    throw new Error('[VectorStore] Cannot upsert chunks while running in TF-IDF fallback mode (GEMINI_API_KEY required)')
  }
  const vectors = await embeddings.embed(newDocs.map(d => d.text))
  const upserted = newDocs.map((d, i) => ({
    id:       d.id,
    text:     d.text,
    metadata: d.metadata || {},
    vector:   l2normalize(Float32Array.from(vectors[i])),
  }))

  const ids = new Set(upserted.map(d => d.id))
  docs = docs.filter(d => !ids.has(d.id)).concat(upserted)
  saveCache()
  return upserted.length
}

// ── Startup ───────────────────────────────────────────────────────────────

async function initialize() {
  if (loadCache()) return  // fast path — use cache

  const knowledgeBase = require('../data/knowledgeBase')
  await build(knowledgeBase)
}

async function rebuild() {
  const knowledgeBase = require('../data/knowledgeBase')
  await build(knowledgeBase)
}

// Auto-initialise when module is loaded
const readyPromise = initialize()

module.exports = {
  search,
  rebuild,
  upsertChunks,
  readyPromise,
  get ready() { return ready },
}
