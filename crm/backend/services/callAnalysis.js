// ---------------------------------------------------------------------------
// AI call analysis — turn a finished call's transcript into a SUMMARY + an
// auto DISPOSITION + sentiment, so officers don't have to fill it in by hand.
//
// Reuses the same OpenAI-compatible providers as the agent (Groq → Cerebras),
// so it keeps working even if Gemini is rate-limited. Returns strict JSON.
// ---------------------------------------------------------------------------

// Must match the Call model's `disposition` enum.
const DISPOSITIONS = ['interested', 'callback', 'wrong_number', 'not_interested', 'no_answer', 'enrolled']
const SENTIMENTS    = ['positive', 'neutral', 'negative']

// Provider priority (only those with an API key are used). Cerebras default is
// gpt-oss-120b (the model available on the project's key); reasoning_effort:low
// keeps it from spending its token budget "thinking" and returning empty.
const PROVIDERS = [
  {
    name: 'groq',
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey:  process.env.GROQ_API_KEY,
    model:   process.env.GROQ_ANALYSIS_MODEL || process.env.GROQ_AGENTIC_MODEL || 'llama-3.3-70b-versatile',
  },
  {
    name: 'cerebras',
    baseURL: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
    apiKey:  process.env.CEREBRAS_API_KEY,
    model:   process.env.CEREBRAS_ANALYSIS_MODEL || 'gpt-oss-120b',
  },
].filter(p => p.apiKey)

// Reasoning models (gpt-oss/glm/qwen3/deepseek) must be told to think minimally,
// else they emit empty content. Plain llama gets no extra params.
const reasoningParams = (model) =>
  /gpt-oss|glm|qwen3|deepseek|reasoning/i.test(model) ? { reasoning_effort: 'low' } : {}

// Normalise either transcript shape — {role,text} (LiveKit/Twilio Priya) or
// {speaker,text} (provider webhook) — into "Speaker: text" lines.
function transcriptToText(transcript = []) {
  return transcript
    .map((t) => {
      const who = String(t.role || t.speaker || '').toLowerCase()
      const label = /priya|^ai$|assistant/.test(who) ? 'Priya' : 'Student'
      return `${label}: ${t.text}`
    })
    .filter((l) => l.endsWith(':') === false)
    .join('\n')
}

const PROMPT = `You analyze a transcript of an admissions phone call between Priya (an AI counsellor) and a prospective student or parent.
Return ONLY a single JSON object, no prose:
{
  "summary": "2-3 sentence neutral summary of what was discussed and how it ended",
  "disposition": one of ["interested","callback","wrong_number","not_interested","no_answer","enrolled"],
  "sentiment": one of ["positive","neutral","negative"],
  "interested": true or false
}
Disposition guide:
- interested: wants to proceed, asked for details, positive engagement
- callback: asked to be called later / was busy / "call me back"
- wrong_number: not the right person, or the number is wrong
- not_interested: clearly declined
- no_answer: no real conversation happened / silence / could not transcribe
- enrolled: confirmed they will enroll / already enrolling
Base every field ONLY on the transcript. Do not invent facts.`

async function complete(p, transcriptText) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(`${p.baseURL}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user',   content: `TRANSCRIPT:\n${transcriptText}` },
        ],
        max_tokens: 400,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        ...reasoningParams(p.model),
      }),
    })
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    return j.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Analyze a call transcript.
 * @returns {{summary:string, disposition:string|null, sentiment:string|null,
 *            interested:boolean|null, analyzed:boolean, provider?:string}}
 */
async function analyzeCall({ transcript = [] }) {
  const text = transcriptToText(transcript).trim()
  const empty = { summary: '', disposition: null, sentiment: null, interested: null, analyzed: false }
  if (!text || !PROVIDERS.length) return empty

  let lastErr
  for (const p of PROVIDERS) {
    try {
      const raw    = await complete(p, text)
      const json   = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
      const parsed = JSON.parse(json)
      const disposition = DISPOSITIONS.includes(parsed.disposition) ? parsed.disposition : null
      const sentiment   = SENTIMENTS.includes(parsed.sentiment) ? parsed.sentiment : null
      return {
        summary: String(parsed.summary || '').trim(),
        disposition,
        sentiment,
        interested: typeof parsed.interested === 'boolean'
          ? parsed.interested
          : (disposition === 'interested' || disposition === 'enrolled'),
        analyzed: true,
        provider: p.name,
      }
    } catch (err) {
      lastErr = err
      console.warn(`[callAnalysis] ${p.name} failed: ${err.message}`)
    }
  }
  console.error('[callAnalysis] all providers failed:', lastErr?.message)
  return empty
}

module.exports = { analyzeCall, DISPOSITIONS }
