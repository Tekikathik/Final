// ---------------------------------------------------------------------------
// vectorStore — Gemini embedding search with TF-IDF fallback.
//
// Mocks embeddings.embed() with a deterministic keyword-presence vector so
// result ranking is predictable, and mocks fs writes so tests never touch
// the real db/vectors.json cache.
// ---------------------------------------------------------------------------

// Deterministic fake embedding: one dimension per keyword + a small constant
// dimension so empty-keyword texts still produce a non-zero vector.
const KEYWORDS = ['fee', 'scholarship', 'hostel', 'placement', 'admission']
function fakeEmbed(text) {
  const t = text.toLowerCase()
  return KEYWORDS.map(k => (t.includes(k) ? 1 : 0)).concat([0.01])
}

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync:   jest.fn(() => false),
  writeFileSync: jest.fn(),
  mkdirSync:    jest.fn(),
}))

describe('vectorStore', () => {
  const ORIGINAL_KEY = process.env.GEMINI_API_KEY

  beforeEach(() => {
    jest.resetModules()
  })

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = ORIGINAL_KEY
  })

  it('searches with Gemini embeddings and returns ranked {source, text, score}', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    jest.doMock('../services/embeddings', () => ({
      embed: jest.fn(async texts => texts.map(fakeEmbed)),
    }))

    const vectorStore = require('../services/vectorStore')
    await vectorStore.readyPromise

    const results = await vectorStore.search('fee structure', 3)

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(3)

    for (const r of results) {
      expect(r).toHaveProperty('source')
      expect(r).toHaveProperty('text')
      expect(r).toHaveProperty('score')
      expect(typeof r.score).toBe('number')
    }

    // Sorted descending by score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }

    // Top result should be about fees, since the query embeds to the "fee" dimension
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('falls back to TF-IDF without crashing when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY
    jest.doMock('../services/embeddings', () => ({
      embed: jest.fn(),
    }))

    const vectorStore = require('../services/vectorStore')
    await vectorStore.readyPromise

    const results = await vectorStore.search('fee structure for B.Tech', 3)

    expect(Array.isArray(results)).toBe(true)
    for (const r of results) {
      expect(r).toHaveProperty('source')
      expect(r).toHaveProperty('text')
      expect(r).toHaveProperty('score')
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })
})
