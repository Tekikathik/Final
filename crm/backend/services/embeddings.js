// ---------------------------------------------------------------------------
// Gemini text embeddings — used by vectorStore.js for semantic search.
//
// Sarvam AI has no embeddings endpoint (chat/translate/STT/TTS only), so we
// reuse the existing GEMINI_API_KEY (already used for post-call transcript
// extraction in services/gemini.js) with Google's text-embedding-004 model.
// ---------------------------------------------------------------------------
const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001'
const BATCH = 32   // batchEmbedContents handles up to 100, but keep batches small

// ---------------------------------------------------------------------------
// embed(texts) → number[][] — one vector per input text, same order as input.
// Retries each batch once on failure, matching the resilience pattern used
// elsewhere in the codebase for external API calls.
// ---------------------------------------------------------------------------
async function embed(texts) {
  if (!genAI) throw new Error('GEMINI_API_KEY is not set')
  if (!texts.length) return []

  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
  const vectors = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch    = texts.slice(i, i + BATCH)
    const requests = batch.map(text => ({ content: { role: 'user', parts: [{ text }] } }))

    let res
    try {
      res = await model.batchEmbedContents({ requests })
    } catch (err) {
      try {
        res = await model.batchEmbedContents({ requests })  // retry once
      } catch (err2) {
        throw new Error(`Gemini Embeddings: ${err2.message}`)
      }
    }
    vectors.push(...res.embeddings.map(e => e.values))
  }

  return vectors
}

module.exports = { embed }
