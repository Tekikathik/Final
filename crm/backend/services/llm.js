// ---------------------------------------------------------------------------
// Minimal generic LLM helper for the competitive agent's reasoning step.
// Calls the first configured OpenAI-compatible provider and returns parsed JSON.
// Returns null if no provider is configured or the call fails — callers then fall
// back to deterministic analysis, so the feature always works without a key.
// ---------------------------------------------------------------------------

// Provider order = fallback order. Groq first (fast), then Cerebras (the agent's
// own provider, generous limits), then Gemini last (often misconfigured / 404s).
function providers() {
  const list = []
  if (process.env.GROQ_API_KEY) list.push({
    name: 'groq', baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_AGENTIC_MODEL || 'llama-3.3-70b-versatile',
  })
  if (process.env.CEREBRAS_API_KEY) list.push({
    name: 'cerebras', baseURL: 'https://api.cerebras.ai/v1',
    apiKey: process.env.CEREBRAS_API_KEY, model: process.env.CEREBRAS_AGENTIC_MODEL || 'gpt-oss-120b',
  })
  if (process.env.GEMINI_API_KEY) list.push({
    name: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  })
  return list
}

const hasLlm = () => providers().length > 0
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * Ask an LLM for a JSON object. Tries each provider in order; on a 429 (rate limit)
 * it honours Retry-After and retries the same provider once before moving on.
 * Returns the parsed object, or null on any failure (caller falls back).
 */
async function completeJson({ system, user, maxTokens = 2200, timeoutMs = 45_000 }) {
  for (const p of providers()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(`${p.baseURL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: p.model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            max_tokens: maxTokens,
            temperature: 0.4,
            response_format: { type: 'json_object' },
          }),
        })
        if (res.status === 429 && attempt === 0) {
          const ra = Number(res.headers.get('retry-after'))
          const waitMs = Math.min((Number.isFinite(ra) && ra > 0 ? ra : 3) * 1000, 30_000)
          console.warn(`[llm] ${p.name} 429 — retrying in ${(waitMs / 1000).toFixed(0)}s`)
          await sleep(waitMs)
          continue                                   // retry same provider
        }
        if (!res.ok) { console.warn(`[llm] ${p.name} ${res.status}`); break }  // next provider
        const data = await res.json()
        const text = data?.choices?.[0]?.message?.content || ''
        const json = extractJson(text)
        if (json) { console.log(`[llm] completion via ${p.name}`); return json }
        break                                        // parsed nothing usable → next provider
      } catch (err) {
        console.warn(`[llm] ${p.name} failed: ${err.message}`)
        break                                        // next provider
      } finally {
        clearTimeout(timer)
      }
    }
  }
  return null
}

// Parse a JSON object out of the model text (handles ```json fences / stray prose).
function extractJson(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { /* try to salvage */ }
  const m = text.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* give up */ } }
  return null
}

module.exports = { completeJson, hasLlm }
