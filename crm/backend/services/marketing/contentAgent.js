// ---------------------------------------------------------------------------
// Content Generation Agent.
//
// Produces campaign copy (WhatsApp/SMS/email/social/brochure) in the SAME
// code-mixed multilingual style Priya speaks (Telugu/Hindi/English), grounded in
// the Aditya RAG knowledge base for any factual claim. Drafts are saved as
// ContentAsset for approval; anything with a fee/scholarship/number claim is
// force-routed to human review (compliance). LLM-backed with a deterministic
// template fallback so it always yields something usable.
// ---------------------------------------------------------------------------
const ContentAsset = require('../../models/ContentAsset')
const { completeJson, hasLlm } = require('../llm')
let vectorStore
try { vectorStore = require('../vectorStore') } catch { vectorStore = require('../ragStore') }

// Channel length/format guidance handed to the model.
const KIND_RULES = {
  whatsapp: 'WhatsApp: warm, 1-2 short lines + a clear CTA, at most one emoji. Under 320 chars.',
  sms:      'SMS: plain text, single sentence, under 140 chars, no emoji, include a short CTA.',
  email:    'Email: a subject line + 3-5 short sentences, friendly and specific, one CTA link.',
  social:   'Social caption: punchy hook, 2-3 lines, 2-3 hashtags, one emoji.',
  brochure: 'Brochure paragraph: confident and factual, 3-4 sentences, no emoji.',
}
const LANG_RULES = {
  english: 'Write in clear Indian English.',
  telugu:  'Write in natural Telugu–English code-mix ("Teluglish"), Telugu in native script, English terms as-is.',
  hindi:   'Write in natural Hindi–English code-mix ("Hinglish"), Hindi in native script, English terms as-is.',
  mixed:   'Write in light, natural code-mix (mostly English with a warm Telugu/Hindi phrase), the way a Kakinada counsellor texts.',
}

// SYSTEM PROMPT — Content Generation agent.
const SYSTEM = [
  'You are the Content Generation agent for the Aditya University admissions marketing team.',
  'You write short, warm, honest outreach copy that gets a prospective student (or their parent) to take ONE next step.',
  'STYLE: code-mixed and human, never corporate spam. Match the requested language.',
  'PERSONALISATION: use placeholder tokens exactly as {name}, {program}, {branch} where natural — do not invent others.',
  'HARD RULES: Use ONLY facts present in the provided knowledgeBase snippets. Never invent a fee, scholarship, package, ranking, or percentage.',
  'If you state any number/fee/scholarship, list it under "claims" with the snippet it came from. If the knowledgeBase has no number, do not state one.',
  'No guarantees of admission or jobs. One clear call-to-action. Output STRICT JSON.',
].join(' ')

// Any of these in the body means the copy asserts a number/offer → force review.
const FEE_CLAIM_RE = /(₹|\brs\.?\b|\blpa\b|lakh|crore|\bfee\b|scholarship|waiver|package|\bctc\b|\d+\s*%|stipend)/i
const detectFeeClaim = (text) => FEE_CLAIM_RE.test(String(text || ''))

async function ground(purpose, angle) {
  try {
    const hits = await vectorStore.search(`${purpose} ${angle}`.trim(), 4)
    return (hits || []).map(h => ({ source: h.source || h.id || 'kb', text: String(h.text || '').slice(0, 400) }))
  } catch { return [] }
}

function deterministicCopy({ kind, language, purpose }) {
  // Safe, claim-free fallback copy (no numbers → no review needed).
  const cta = kind === 'email' ? 'Reply to this email or call us to know more.' : 'Reply YES and our team will call you.'
  const body = kind === 'sms'
    ? `Hi {name}, Aditya University admissions for {program} are open. ${cta}`
    : `Hi {name}! 🎓 Interested in {program} at Aditya University ({branch})? ${purpose || 'We can guide you through admissions, campus and scholarships.'} ${cta}`
  return { title: `${kind} — ${purpose || 'admissions outreach'}`.slice(0, 80), subject: kind === 'email' ? 'Your Aditya University admission — next step' : '', body, variables: ['name', 'program', 'branch'], claims: [] }
}

/**
 * Generate one ContentAsset draft.
 * @returns the saved ContentAsset document.
 */
async function generateContent({ orgId, branchId = null, kind = 'whatsapp', language = 'mixed', purpose = '', angle = '', generatedBy = 'agent', authoredBy = null }) {
  const snippets = await ground(purpose, angle)
  let out = null, usedLlm = false

  if (hasLlm()) {
    const user = JSON.stringify({
      task: 'Write ONE piece of outreach copy.',
      channel: kind, channelRule: KIND_RULES[kind] || KIND_RULES.whatsapp,
      language, languageRule: LANG_RULES[language] || LANG_RULES.mixed,
      purpose, angle,
      knowledgeBase: snippets.map(s => s.text),
      returnShape: { title: 'string', subject: 'string (email only, else empty)', body: 'string with {name}/{program}/{branch} tokens', variables: ['string'], claims: [{ claim: 'string', source: 'string (which snippet)' }] },
    })
    const res = await completeJson({ system: SYSTEM, user, maxTokens: 900, timeoutMs: 30000 })
    if (res && res.body) { out = res; usedLlm = true }
  }
  if (!out) out = deterministicCopy({ kind, language, purpose })

  const body = String(out.body || '').slice(0, 2000)
  const containsFeeClaim = detectFeeClaim(body) || (Array.isArray(out.claims) && out.claims.length > 0)
  const grounding = (Array.isArray(out.claims) ? out.claims : []).map(c => ({ claim: String(c.claim || '').slice(0, 300), source: String(c.source || '').slice(0, 200) }))

  return ContentAsset.create({
    orgId, branchId, kind, language,
    title: String(out.title || `${kind} copy`).slice(0, 120),
    purpose, subject: String(out.subject || '').slice(0, 200), body,
    variables: Array.isArray(out.variables) && out.variables.length ? out.variables.slice(0, 8) : ['name', 'program', 'branch'],
    containsFeeClaim, grounding,
    // Compliance gate: fee/number claims can't skip review; clean copy starts as draft.
    status: containsFeeClaim ? 'pending_review' : 'draft',
    generatedBy, authoredBy, usedLlm,
  })
}

module.exports = { generateContent, detectFeeClaim, SYSTEM }
