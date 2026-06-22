// ---------------------------------------------------------------------------
// Groq LLM service — replaces the Ollama backend for Priya.
//
// Why Groq:
//   - Sub-second inference on Llama 3.3 70B keeps us well inside Twilio's 15s
//     webhook budget (our 13s hard limit).
//   - No local GPU required; single API key in .env.
//
// Each turn:
//   1. Regex-extract student data (name, marks, course, etc.)
//   2. Smart-advance the step (skip already-answered steps)
//   3. BM25-search RAG store for relevant university info
//   4. Build system prompt (step goal + collected data + RAG context)
//   5. Send last 8 transcript turns + current student text to Groq
//   6. Return { reply, step, step_index, collected }
// ---------------------------------------------------------------------------

const Groq         = require('groq-sdk')
const sessionStore = require('./sessionStore')
const ragStore     = require('./ragStore')      // BM25 fallback while vectors build
const vectorStore  = require('./vectorStore')
const flow         = require('./flowController')
const agentTools   = require('./agentTools')

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null

// llama-3.1-8b-instant: ~100-300ms on Groq vs 2-7s for 70B — sufficient for
// 1-sentence admission responses; 70B available via GROQ_MODEL env override
const MODEL      = process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
const MAX_TOKENS = 60   // 60 tokens: enough for a 1-sentence answer + the step question

// ── Agentic path config ──────────────────────────────────────────────────
const AGENTIC_MAX_TOKENS     = parseInt(process.env.AGENTIC_MAX_TOKENS || '85', 10)   // ~1 short spoken sentence; smaller = shorter audio + faster synthesis (was 120 → 23s Telugu audio on info turns)
const AGENTIC_MAX_ITERATIONS = 6
const AGENTIC_CALL_TIMEOUT   = 12_000  // per provider call, ms (saw 10-15s spikes)
const AGENT_HISTORY_LIMIT    = 30      // max agent_messages entries replayed each turn

// ── Agentic LLM providers (OpenAI-compatible) with automatic failover ────────
// The agentic loop tries providers in order; on 429 / timeout / 5xx it falls over
// to the next one, so a call never dies just because one provider's quota is spent.
// Both Groq and Cerebras serve llama-3.3-70b (Cerebras has no reasoning overhead
// and a larger free tier; Groq is fast too). Configure via .env:
//   AGENTIC_PROVIDERS=groq,cerebras   (order = priority; default groq,cerebras)
//   GROQ_API_KEY / GROQ_AGENTIC_MODEL=llama-3.3-70b-versatile
//   CEREBRAS_API_KEY / CEREBRAS_AGENTIC_MODEL=llama-3.3-70b
const PROVIDER_DEFS = {
  groq: {
    baseURL: process.env.GROQ_BASE_URL     || 'https://api.groq.com/openai/v1',
    apiKey:  process.env.GROQ_API_KEY,
    model:   process.env.GROQ_AGENTIC_MODEL || 'llama-3.3-70b-versatile',
  },
  cerebras: {
    baseURL: process.env.CEREBRAS_BASE_URL     || 'https://api.cerebras.ai/v1',
    apiKey:  process.env.CEREBRAS_API_KEY,
    model:   process.env.CEREBRAS_AGENTIC_MODEL || 'zai-glm-4.7',
  },
  // Local model via Ollama/LM Studio (OpenAI-compatible). apiKey is ignored by
  // Ollama but must be truthy for the provider to be enabled.
  local: {
    baseURL: process.env.LOCAL_BASE_URL     || 'http://localhost:11434/v1',
    apiKey:  process.env.LOCAL_API_KEY      || 'ollama',
    model:   process.env.LOCAL_AGENTIC_MODEL || 'qwen2.5:3b',
  },
}

// Reasoning-model params, per provider. These models (qwen, gpt-oss, glm…) burn
// hidden chain-of-thought tokens that otherwise eat the whole max_tokens budget
// (→ empty reply) and add latency, so we force minimal reasoning. The param names
// differ by provider, so gate accordingly; plain llama returns {} (no reasoning).
function reasoningParams(p) {
  // Only the cloud reasoning models need these; gate by provider so a local
  // qwen2.5 (NOT a reasoning model) and plain llama get no extra params.
  if (p.name === 'groq' && /qwen3|deepseek|reasoning/i.test(p.model)) return { reasoning_format: 'hidden', reasoning_effort: 'none' }
  if (p.name === 'cerebras' && /qwen3|deepseek|reasoning|gpt-oss|glm/i.test(p.model)) return { reasoning_effort: 'low' }
  return {}   // groq llama, local, anything else
}

const AGENTIC_PROVIDERS = (process.env.AGENTIC_PROVIDERS || 'groq,cerebras')
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(name => ({ name, ...PROVIDER_DEFS[name] }))
  .filter(p => p.baseURL && p.apiKey)   // only providers that actually have a key

if (AGENTIC_PROVIDERS.length) {
  console.log(`[GroqAgentic] providers: ${AGENTIC_PROVIDERS.map(p => `${p.name}(${p.model})`).join(' → ')}`)
}

// Pre-load the local model at boot so the FIRST call turn doesn't pay the ~20s
// cold-start (loading 3B weights into VRAM) — that load alone blows past the
// 15s pipeline budget and times the turn out. keep_alive:-1 pins it in memory
// so it stays hot between turns/calls. Uses Ollama's native /api/chat (the
// OpenAI endpoint ignores keep_alive). No-op if Ollama isn't reachable.
const _localProvider = AGENTIC_PROVIDERS.find(p => p.name === 'local')
if (_localProvider) {
  const nativeBase = _localProvider.baseURL.replace(/\/v1\/?$/, '')
  fetch(`${nativeBase}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: _localProvider.model, messages: [{ role: 'user', content: 'hi' }], stream: false, keep_alive: -1 }),
  })
    .then(() => console.log(`[GroqAgentic] local "${_localProvider.model}" warmed & pinned in memory (no cold-start)`))
    .catch(e => console.warn(`[GroqAgentic] local warmup failed (${e.message}) — is Ollama running? first turn may be slow`))
}

// ── Provider circuit breaker ────────────────────────────────────────────────
// When a provider rate-limits us (429), skip it for a cooldown window instead of
// wasting a failed round-trip on every turn. The cooldown honours the provider's
// own "try again in …" hint when present (Groq's daily limit says ~20m; Cerebras's
// per-minute limit resets in <60s). Module-level so it persists across turns/calls.
const providerCooldown = {}   // provider name → epoch ms until which to skip it

const isRateLimited = (err) =>
  err?.status === 429 || /rate.?limit|too[ _]?many|quota|\b429\b/i.test(err?.message || '')

function cooldownMsFromError(err) {
  const m = /try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i.exec(err?.message || '')
  if (m) {
    const secs = parseInt(m[1] || '0', 10) * 60 + parseFloat(m[2] || '0')
    return Math.min(secs * 1000 + 1000, 20 * 60 * 1000)   // cap at 20 min
  }
  return 60_000   // default: 60s (matches per-minute limits)
}

// One chat-completion against an OpenAI-compatible provider via raw fetch (so the
// exact URL is {baseURL}/chat/completions — no SDK path quirks across providers).
// Aborts at AGENTIC_CALL_TIMEOUT; non-2xx throws an Error carrying .status/.error
// so errBody() and the tool_use_failed recovery keep working.
async function providerComplete(p, messages) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AGENTIC_CALL_TIMEOUT)
  try {
    const res = await fetch(`${p.baseURL}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:       p.model,
        messages,
        max_tokens:  AGENTIC_MAX_TOKENS,
        temperature: 0.65,
        tools:       agentTools.TOOL_DEFINITIONS,
        tool_choice: 'auto',
        ...reasoningParams(p),
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      const err  = new Error(`${res.status} ${text}`.slice(0, 300))
      err.status = res.status
      try { err.error = JSON.parse(text).error } catch { /* leave as message */ }
      throw err
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Streaming variant: same request with stream:true, parses the SSE token deltas and
// calls onContentDelta(text) as the reply text arrives (so TTS can start on the first
// clause while the model is still writing). Assembles and returns the SAME shape as
// providerComplete ({choices:[{message:{content,tool_calls}}]}) so the agentic loop is
// unchanged — tool-call turns just produce no content deltas (nothing to speak yet).
async function providerCompleteStream(p, messages, onContentDelta) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AGENTIC_CALL_TIMEOUT)
  try {
    const res = await fetch(`${p.baseURL}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model: p.model, messages, max_tokens: AGENTIC_MAX_TOKENS, temperature: 0.65,
        tools: agentTools.TOOL_DEFINITIONS, tool_choice: 'auto', stream: true,
        ...reasoningParams(p),
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      const err  = new Error(`${res.status} ${text}`.slice(0, 300))
      err.status = res.status
      try { err.error = JSON.parse(text).error } catch { /* leave as message */ }
      throw err
    }
    let content = ''
    const toolCalls = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let j; try { j = JSON.parse(data) } catch { continue }
        const delta = j.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) { content += delta.content; try { onContentDelta(delta.content) } catch { /* sink error */ } }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0
            toolCalls[i] = toolCalls[i] || { id: tc.id || `call_${i}`, type: 'function', function: { name: '', arguments: '' } }
            if (tc.id) toolCalls[i].id = tc.id
            if (tc.function?.name)      toolCalls[i].function.name = tc.function.name
            if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments
          }
        }
      }
    }
    const message = { role: 'assistant', content: content || null }
    const tc = toolCalls.filter(Boolean)
    if (tc.length) message.tool_calls = tc
    return { choices: [{ message }] }
  } finally {
    clearTimeout(timer)
  }
}

// Pull complete sentences out of a growing text buffer. Returns [sentences[], rest].
// Splits on . ? ! and the Telugu/Devanagari danda — so each clause can be sent to TTS
// the moment it's done while the model keeps writing the rest.
function splitSentences(buf) {
  const out = []
  const re = /[^.?!।\n]*[.?!।\n]+/g
  let m, last = 0
  while ((m = re.exec(buf))) { out.push(m[0]); last = re.lastIndex }
  return [out, buf.slice(last)]
}

const race = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)),
])

// Heuristic: does the caller's turn look like a question rather than an answer?
// Used by the bare-marks save guard so we don't bind a stray number from a
// question ("what about the 70-seat batch?") to a pending marks field.
const isQuestionLike = (t) =>
  /\?/.test(t) ||
  /^\s*(what|whats|what's|how|which|when|where|why|who|can|could|would|do|does|is|are|tell me)\b/i.test(t || '')

// Pull the structured error body out of a groq-sdk error. The SDK exposes it as
// err.error, but falls back to parsing the "{...}" tail of err.message.
function errBody(err) {
  if (err?.error?.code || err?.error?.message) return err.error
  const s = String(err?.message || '')
  const i = s.indexOf('{')
  if (i >= 0) { try { return JSON.parse(s.slice(i)).error } catch { /* not JSON */ } }
  return null
}

// Some models (llama, qwen) occasionally emit a tool call as TEXT instead of a
// structured tool_call, which Groq rejects with 400 tool_use_failed and echoes
// back in `failed_generation`. Recover the intended call(s) so the turn survives.
//   llama:  <function=save_detail {"field":"x","value":"y"}></function>
//   qwen:   <tool_call>{"name":"save_detail","arguments":{...}}</tool_call>
function parseMalformedToolCalls(text) {
  const calls = []
  if (!text) return calls
  let m
  // Tolerate all the shapes llama produces: `<function=NAME {json}>`,
  // `<function=NAME{json}</function>`, `<function=NAME>{json}</function>`.
  const fnRe = /<function=([a-zA-Z_]+)\s*>?\s*({[\s\S]*?})/g
  while ((m = fnRe.exec(text))) {
    try { calls.push({ name: m[1], args: JSON.parse(m[2]) }) } catch { /* skip */ }
  }
  const tcRe = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g
  while ((m = tcRe.exec(text))) {
    try {
      const o = JSON.parse(m[1])
      if (o.name) calls.push({ name: o.name, args: o.arguments || o.parameters || {} })
    } catch { /* skip */ }
  }
  return calls
}

// Reasoning models (cerebras glm / gpt-oss) return an assistant message with a
// `reasoning` field. If we store and replay that, BOTH Groq and Cerebras reject it
// with 400 "reasoning is not supported". Keep only the standard chat fields so the
// stored history is portable across providers.
function cleanMsg(m) {
  const out = { role: m.role || 'assistant' }
  if (m.content != null) out.content = m.content
  if (m.tool_calls?.length) out.tool_calls = m.tool_calls
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id
  return out
}

// Replayed history must satisfy the providers' strict tool-call pairing: every
// assistant message with tool_calls must be immediately followed by a tool message
// for EACH tool_call_id, and every tool message must follow such an assistant.
// Slicing/partial saves can violate this (→ 400 "tool_calls must be followed by
// tool messages" / "tool must follow tool_calls"). Rebuild a valid sequence: keep
// an assistant-tool_calls block only if all its responses are present; drop orphans.
function sanitizeHistory(msgs) {
  const out = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const need = new Set(m.tool_calls.map(tc => tc.id))
      const responses = []
      let j = i + 1
      while (j < msgs.length && msgs[j].role === 'tool' && need.has(msgs[j].tool_call_id)) {
        responses.push(msgs[j]); need.delete(msgs[j].tool_call_id); j++
      }
      if (need.size === 0) { out.push(m, ...responses); i = j - 1 }   // complete block → keep
      else { i = j - 1 }                                              // incomplete → drop assistant + partials
    } else if (m.role !== 'tool') {
      out.push(m)   // plain user/assistant message
    }
    // a stray `tool` message not consumed above is an orphan → dropped
  }
  return out
}

// ---------------------------------------------------------------------------
// Dispatcher — PRIYA_AGENTIC=true routes to the agentic tool-calling path,
// otherwise the original deterministic flow-controller path runs unchanged.
// Both return the same shape: { reply, step, step_index, collected }
// ---------------------------------------------------------------------------
async function callPriyaAPI(sessionId, message, opts = {}) {
  return process.env.PRIYA_AGENTIC === 'true'
    ? callPriyaAgentic(sessionId, message, opts)
    : callPriyaDeterministic(sessionId, message)
}

// ---------------------------------------------------------------------------
// Agentic path — Groq tool-calling loop. The model proposes save_detail /
// get_course_package / etc. calls; agentTools.executeTool validates and
// applies them. step/step_index are derived from collected progress so
// StepProgressBar.jsx keeps working unchanged.
// ---------------------------------------------------------------------------
async function callPriyaAgentic(sessionId, message, opts = {}) {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('Session not found: ' + sessionId)
  if (!AGENTIC_PROVIDERS.length) throw new Error('No agentic LLM provider configured (set GROQ_API_KEY or CEREBRAS_API_KEY)')

  const history   = sanitizeHistory((session.agent_messages || []).slice(-AGENT_HISTORY_LIMIT))
  let   collected = { ...session.collected }
  const turnLog   = [{ role: 'user', content: message }]
  const guardMsgs = []

  // ── Pending-field save guard ───────────────────────────────────────────────
  // If the caller just answered the field we're collecting but the value would
  // otherwise be dropped — a vague number ("around 71") or a text answer the model
  // tends to skip saving (city/location) — save it deterministically here and bind
  // it to the pending field. This stops the agent from acknowledging an answer in
  // prose without saving it and then re-asking the same question forever. We seed
  // the saved value into the message list so the model sees it's done and moves on.
  const pendingField = agentTools.getMissingFields({ collected })[0]
  if (pendingField && !isQuestionLike(message)) {
    const value = agentTools.valueForPendingField(pendingField, message)
    if (value != null) {
      const { result, collectedPatch } =
        await agentTools.executeTool(sessionId, 'save_detail', { field: pendingField, value }, collected)
      if (Object.keys(collectedPatch).length) {
        collected = { ...collected, ...collectedPatch }
        const callId  = `guard_${Date.now()}`
        const asstMsg = { role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name: 'save_detail', arguments: JSON.stringify({ field: pendingField, value }) } }] }
        const toolMsg = { role: 'tool', tool_call_id: callId, content: result }
        guardMsgs.push(asstMsg, toolMsg)
        turnLog.push(asstMsg, toolMsg)
        console.log(`[GroqAgentic] save-guard: bound "${message}" → save_detail(${pendingField}, "${value}")`)
      }
    }
  }

  // Deterministic "student or parent?" turn. This is a FIXED early step where the weak
  // local model most often garbles (code leaks / field dumps), so ask it directly — no
  // LLM call: reliable, instant, and translated to the caller's language downstream.
  // Skipped if the caller's turn actually answered it (save-guard above set caller_type)
  // or if they asked a question (let the model handle that).
  if (agentTools.getMissingFields({ collected })[0] === 'caller_type' && !isQuestionLike(message)) {
    const reply = 'Am I speaking with the student, or a parent?'
    const updatedHistory = [...(session.agent_messages || []), { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-AGENT_HISTORY_LIMIT)
    sessionStore.update(sessionId, { agent_messages: updatedHistory, collected })
    const { step, step_index } = agentTools.deriveStep({ collected })
    console.log('[GroqAgentic] deterministic caller_type question (no LLM)')
    return { reply, step, step_index, collected }
  }

  // Build the system prompt AFTER the guard so CURRENTLY COLLECTING reflects the save.
  let systemPrompt = agentTools.buildAgenticSystemPrompt({ ...session, collected }, opts)
  // Qwen3 is a reasoning model: without this it emits <think>…</think> that eats the
  // small max_tokens budget (→ empty reply) and adds latency. "/no_think" disables it.
  // Harmless to non-Qwen3 providers (llama/glm ignore it) if the call fails over.
  if (/qwen3/i.test(process.env.LOCAL_AGENTIC_MODEL || '') && AGENTIC_PROVIDERS.some(p => p.name === 'local')) {
    systemPrompt += '\n\n/no_think'
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
    ...guardMsgs,
  ]
  let finalContent = null
  let usedProvider = null   // which provider actually answered (for honest logging)

  // ── Streaming reply (opts.onSentence) ──────────────────────────────────────
  // Stream the primary provider's tokens and emit each finished sentence so TTS can
  // start mid-generation (getmio-style). Tool-call turns produce no content deltas,
  // so nothing is spoken until the model writes the actual reply.
  let streamedSomething = false
  let questionDone = false   // stop after the first question (mirrors duplicate-question collapse)
  let sentenceBuf = ''
  const stripForSpeech = (s) => s
    .replace(/<[^>]*>/g, '')                 // any tag (<think>, <function=…>)
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')     // markdown
    .replace(/\s{2,}/g, ' ').trim()
  const emitSentence = (s) => {
    if (questionDone) return
    const clean = stripForSpeech(s)
    if (clean.length < 2) return
    if (/[{}]|"(?:function|reason|name|arguments|field|value)"/i.test(s)) return  // leaked tool JSON — skip
    if (agentTools.looksLikeFieldDump(clean) || agentTools.looksLikeCodeLeak(clean)) return  // dump/code leak — let the buffered guard fix it
    streamedSomething = true
    try { opts.onSentence(clean) } catch { /* sink error */ }
    if (clean.includes('?')) questionDone = true   // a phone reply ends at the question
  }
  const onContentDelta = opts.onSentence ? (piece) => {
    sentenceBuf += piece
    const [sents, rest] = splitSentences(sentenceBuf)
    sentenceBuf = rest
    for (const s of sents) emitSentence(s)
  } : null
  // Stream the primary (non-cooling) provider; no per-call failover (failing over
  // mid-stream would re-speak). On failure the loop's catch retries via callOnce.
  const streamOnce = async () => {
    const now = Date.now()
    const pool = AGENTIC_PROVIDERS.filter(p => !(providerCooldown[p.name] > now))
    if (!pool.length) { const e = new Error('all providers cooling'); e.allCooling = true; throw e }
    usedProvider = pool[0].name
    return providerCompleteStream(pool[0], messages, onContentDelta)
  }

  // One agentic completion, with provider failover. Tries each configured
  // provider in priority order; a 429 / timeout / 5xx / network error falls
  // over to the next so the call survives one provider's quota running out.
  // A 400 tool_use_failed is rethrown (it's the model's fault, not the
  // provider's) so the loop below can recover the malformed tool call.
  const callOnce = async () => {
    const now = Date.now()
    // Skip providers in a rate-limit cooldown. If EVERY provider is cooling down,
    // fail fast — hammering them just 429s again and wastes seconds per turn.
    const pool = AGENTIC_PROVIDERS.filter(p => !(providerCooldown[p.name] > now))
    if (!pool.length) {
      const e = new Error('all agentic providers are rate-limited (cooling down)')
      e.allCooling = true
      throw e
    }
    let lastErr
    for (const p of pool) {
      try {
        const completion = await providerComplete(p, messages)
        usedProvider = p.name
        return completion
      } catch (err) {
        if (errBody(err)?.code === 'tool_use_failed') throw err   // recoverable — don't fail over
        lastErr = err
        if (isRateLimited(err)) {
          const ms = cooldownMsFromError(err)
          providerCooldown[p.name] = Date.now() + ms
          console.warn(`[GroqAgentic] ${p.name} rate-limited — skipping it for ${Math.round(ms / 1000)}s`)
        } else if (pool.length > 1) {
          console.warn(`[GroqAgentic] provider ${p.name} failed (${(err.message || '').slice(0, 80)}) — trying next`)
        }
      }
    }
    throw lastErr || new Error('All agentic providers failed')
  }

  // Apply a tool call (structured or recovered-from-malformed) and log it.
  const applyToolCall = async (id, name, args) => {
    const { result, collectedPatch } = await agentTools.executeTool(sessionId, name, args, collected)
    collected = { ...collected, ...collectedPatch }
    const asst = { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
    const tool = { role: 'tool', tool_call_id: id, content: result }
    messages.push(asst, tool)
    turnLog.push(asst, tool)
  }

  const fetchCompletion = onContentDelta ? streamOnce : callOnce

  for (let i = 0; i < AGENTIC_MAX_ITERATIONS; i++) {
    let completion
    try {
      completion = await fetchCompletion()
    } catch (err) {
      // All providers rate-limited — stop immediately instead of spinning through
      // iterations/retries (that's what wasted ~13s before the generic fallback).
      if (err.allCooling) { console.warn('[GroqAgentic] all providers rate-limited — bailing to fallback'); break }
      // Streaming already spoke part of the reply — don't regenerate (would double it).
      if (streamedSomething) { console.warn('[GroqAgentic] stream errored after partial reply — keeping it'); break }
      const body = errBody(err)
      // Recover a tool call the model emitted as text (400 tool_use_failed).
      const recovered = body?.code === 'tool_use_failed'
        ? parseMalformedToolCalls(body.failed_generation)
        : []
      if (recovered.length) {
        console.warn(`[GroqAgentic] iter ${i}: recovered ${recovered.length} malformed tool call(s)`)
        for (const { name, args } of recovered) {
          await applyToolCall(`recover_${Date.now()}_${name}`, name, args)
        }
        continue  // let the model see the results and produce a reply
      }
      // Timeout / transient — retry this iteration once before giving up.
      try {
        completion = await callOnce()
      } catch (err2) {
        console.warn(`[GroqAgentic] iteration ${i} failed (after retry):`, err2.message)
        break
      }
    }

    const msg = completion.choices?.[0]?.message
    if (!msg) break

    // Store a provider-portable copy (drops `reasoning` etc. that break replay).
    const stored = cleanMsg(msg)
    messages.push(stored)
    turnLog.push(stored)

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args = {}
        try { args = JSON.parse(tc.function?.arguments || '{}') } catch { /* malformed args from model */ }

        const { result, collectedPatch } = await agentTools.executeTool(sessionId, tc.function?.name, args, collected)
        collected = { ...collected, ...collectedPatch }

        const toolMsg = { role: 'tool', tool_call_id: tc.id, content: result }
        messages.push(toolMsg)
        turnLog.push(toolMsg)
      }
      continue  // let the model see tool results before producing a final reply
    }

    if (msg.content) {
      finalContent = msg.content
      break
    }

    // No tool call and no content — nudge the model to actually speak rather than
    // ending the turn empty (which would trigger the generic fallback). The nudge
    // is transient: it goes into messages, not turnLog, so it isn't persisted.
    messages.push({ role: 'user', content: '(Please reply to the caller now in 1-2 short sentences.)' })
  }

  // Flush any trailing clause (text after the last sentence terminator) to TTS.
  if (onContentDelta && sentenceBuf.trim()) emitSentence(sentenceBuf)

  // Strip anything that must never reach TTS: hidden reasoning, and tool calls the
  // model leaked into the reply TEXT instead of emitting as a structured call
  // (e.g. "<function=save_detail>{...}</function>", "<tool_call>{...}</tool_call>",
  // or a bare JSON blob like {"reason":"..."} / {"function":...} from end_call etc.),
  // plus markdown emphasis asterisks that TTS would read aloud.
  let reply = (finalContent || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<function=[\s\S]*?<\/function>/gi, '')
    .replace(/<function=[a-zA-Z_]+\s*>?\s*\{[\s\S]*?\}\s*>?/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  // Strip leaked tool-call JSON blobs, innermost-first, until none remain (handles
  // nested objects like {"function":...,"arguments":{"reason":...}}).
  const toolJson = /\{[^{}]*"(?:function|reason|name|arguments|field|value)"\s*:[^{}]*\}/gi
  let prev
  do { prev = reply; reply = reply.replace(toolJson, '') } while (reply !== prev)
  reply = reply
    .replace(/\*\*([^*]+)\*\*/g, '$1')   // markdown bold → plain
    .replace(/\*([^*]+)\*/g, '$1')       // markdown italic → plain
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Drop any planning/reasoning the model leaked as prose (gpt-oss does this:
  // "We need to call get_scholarships.", "We need to get department.") and any
  // sentence naming a tool, then collapse repeated question drafts by keeping
  // only the text through the FIRST question mark.
  reply = reply
    .split(/(?<=[.?!])\s+/)
    .filter(s => !/\bget_(scholarships|course_package|transport_info|missing_fields|detail)\b/i.test(s))
    .filter(s => !/^\s*(we|i)\s+(need|needs|must|have|will|should|gotta|got)\s+(to\s+)?(call|get|invoke|use)\b/i.test(s))
    .join(' ')
    .trim()
  const firstQ = reply.indexOf('?')
  if (firstQ !== -1) reply = reply.slice(0, firstQ + 1).trim()   // collapse duplicate questions

  if (!reply) reply = 'Thank you for sharing that — could you tell me a little more?'

  // Weak-model guards: if the model dumped the whole field list, or leaked code/HTML
  // garbage (e.g. _pb3_HtmlResponse({"html":"<p>…")), replace it with a single clean
  // question for whatever's still missing — the caller must never hear gibberish.
  if (agentTools.looksLikeFieldDump(reply) || agentTools.looksLikeCodeLeak(reply)) {
    const q = agentTools.defaultQuestionFor({ collected })
    console.warn(`[GroqAgentic] bad reply ("${reply.slice(0, 40)}…") — replacing with: "${q}"`)
    reply = q
  }

  const updatedHistory = [...(session.agent_messages || []), ...turnLog].slice(-AGENT_HISTORY_LIMIT)
  sessionStore.update(sessionId, { agent_messages: updatedHistory, collected })

  const { step, step_index } = agentTools.deriveStep({ collected })
  return { reply, step, step_index, collected, provider: usedProvider, streamed: streamedSomething }
}

// ---------------------------------------------------------------------------
// Deterministic path — original 12-step flow controller. Logic unchanged.
// ---------------------------------------------------------------------------
async function callPriyaDeterministic(sessionId, message) {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('Session not found: ' + sessionId)

  if (!groq) throw new Error('GROQ_API_KEY is not set')

  // ── Step 1: extract data from student speech ──────────────────────────────
  const extracted = flow.extractDataFromText(message)

  // ── Step 2: detect if student asked a question ────────────────────────────
  let studentAskedQuestion = flow.isQuestion(message)

  // Fee step: "tell me / could you tell / yes / sure" are AFFIRMATIVES to the
  // "Would you like to know the fee structure?" question — not new questions.
  // Without this override, every affirmative holds the step indefinitely.
  if (session.step === 'fee') {
    const affirmRx = /\b(yes|yeah|yep|yup|sure|ok|okay|please|tell me|i want|could you|go ahead|definitely|of course|inform me)\b/i
    if (affirmRx.test(message)) studentAskedQuestion = false
  }

  // ── Step 3: determine next step based on collected + extracted ────────────
  const { step, step_index, collected } = flow.smartAdvance(session, extracted, studentAskedQuestion)

  // Persist step + collected immediately so the session reflects current state
  sessionStore.update(sessionId, { step, step_index, collected })
  const updatedSession = sessionStore.get(sessionId)

  // ── Step 4: Semantic RAG retrieval ───────────────────────────────────────────
  // RAG is suppressed for early data-collection steps (greeting→course). These
  // steps only need a short acknowledgement + the mandatory question. Injecting
  // university facts here causes the LLM to volunteer fee/scholarship info at
  // the wrong moment, breaking the conversation flow.
  const DATA_COLLECTION_STEPS = new Set(['greeting', 'name', '10th', 'inter', 'course'])
  const ragTopK    = DATA_COLLECTION_STEPS.has(step) ? 0
                   : studentAskedQuestion             ? 3
                   :                                   2
  const ragQuery   = [message, collected.interest || '', step].filter(Boolean).join(' ')
  const ragResults = ragTopK > 0 ? await vectorStore.search(ragQuery, ragTopK) : []

  // ── Step 4: build system prompt ───────────────────────────────────────────
  // Pass the previous step so buildSystemPrompt can detect the fee→exam
  // transition and instruct the LLM to share fee details before the exam Q.
  const systemPrompt = flow.buildSystemPrompt(updatedSession, ragResults, session.step)

  // ── Step 5: build messages array — 2 turns max keeps total tokens low
  const messages = [{ role: 'system', content: systemPrompt }]
  const recentTurns = (session.transcript || []).slice(-2)
  for (const t of recentTurns) {
    if (t.role === 'Student')    messages.push({ role: 'user',      content: t.text })
    else if (t.role === 'Priya') messages.push({ role: 'assistant', content: t.text })
  }
  messages.push({ role: 'user', content: message })

  // ── Step 6: call Groq ─────────────────────────────────────────────────────
  const completion = await groq.chat.completions.create({
    model:      MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.65,
  })

  let reply = completion.choices[0]?.message?.content?.trim()
    || 'Thank you for that. Could you please tell me more?'

  // Enforce the correct step question — small LLMs are biased by conversation
  // history and often ask the wrong question. Strategy:
  //   1. If the reply already ends with the exact step question, leave it alone.
  //   2. Otherwise strip any trailing question the LLM generated.
  //   3. Keep the LLM's acknowledgement only if it ends with clean punctuation
  //      (prevents "Welcome to [truncated] <step question>" broken sentences).
  //   4. Append the exact step question.
  const stepQ = flow.STEP_QUESTIONS[step]
  if (stepQ && step !== 'end') {
    if (!reply.trimEnd().endsWith(stepQ)) {
      const withoutTrailingQ = reply.replace(/\s+[A-Z][^?]*\?[\s]*$/, '').trim()
      // Only keep the acknowledgement if it is a complete sentence
      const base = /[.!,]$/.test(withoutTrailingQ) ? withoutTrailingQ : ''
      reply = base ? `${base} ${stepQ}` : stepQ
    }
  }

  return { reply, step, step_index, collected }
}

module.exports = { callPriyaAPI, callPriyaDeterministic, callPriyaAgentic }
