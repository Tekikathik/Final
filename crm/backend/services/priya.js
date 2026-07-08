// ---------------------------------------------------------------------------
// Priya LLM — powered by Groq (replaces the previous Ollama backend).
//
// Delegates entirely to groqService which handles:
//   • data extraction from student speech
//   • smart step advancement (skips already-answered steps)
//   • RAG context retrieval from university documents
//   • Groq API call with full conversation history
//
// The exported interface (callPriyaAPI) is unchanged so the webhook route
// and mock simulation in routes/priya.js need no modification.
// ---------------------------------------------------------------------------

const groqService = require('./groqService')

async function callPriyaAPI(sessionId, message) {
  return groqService.callPriyaAPI(sessionId, message)
}

module.exports = { callPriyaAPI }
