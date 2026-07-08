// ---------------------------------------------------------------------------
// Agentic tool definitions + dispatcher for the Priya agentic LLM path.
//
// The agent (Groq tool-calling) proposes field values and actions; this
// module validates and applies them. Nothing here trusts the LLM — every
// save_detail call is range/enum/length checked before it lands in
// session.collected.
// ---------------------------------------------------------------------------
const vectorStore = require('./vectorStore')

// ── Field spec ──────────────────────────────────────────────────────────────

const ALLOWED_FIELDS = [
  'caller_type', 'parent_name', 'relation', 'student_name',
  'marks_10', 'marks_inter', 'interest', 'department',
  'entrance_exam', 'entrance_score',
  'location', 'transport_need', 'visit_appointment',
]

const has = (v) => typeof v === 'string' ? v.trim().length > 0 : v != null

// Pull the first plausible marks value out of vague / filler-laden phrasing such
// as "around 71", "like 65 percent", "71 ish", "71%", or "7.8 cgpa". Returns a
// normalised string ("71%" for percentages, bare "8.5" for CGPA ≤ 10) or null if
// no in-range number is present. A leading minus is preserved so "-1" is rejected
// upstream by the 0-100 bound rather than silently matching "1".
function extractMarksValue(rawValue) {
  // Strip ordinals ("10th", "12th") and class words so "my 10th class is 99.5"
  // yields 99.5, not 10.
  const cleaned = String(rawValue ?? '')
    .replace(/\b\d{1,2}\s*(st|nd|rd|th)\b/gi, ' ')
    .replace(/\b(class|grade|standard|std|inter|intermediate)\b/gi, ' ')
  const nums = cleaned.match(/-?\d{1,3}(?:\.\d+)?/g)
  if (!nums) return null
  // A leading 10/11/12 is usually the class reference, not the score
  // ("my 10% is like 78" → 78). If a later number exists, prefer it.
  let pick = nums[0]
  if (nums.length > 1 && [10, 11, 12].includes(parseInt(nums[0], 10))) pick = nums[1]
  const n = parseFloat(pick)
  if (isNaN(n) || n < 0 || n > 100) return null
  // > 10 ⇒ unambiguously a percentage; ≤ 10 ⇒ treat as CGPA and keep it bare.
  return n > 10 ? `${n}%` : String(n)
}

// Lightly clean a spoken answer into a storable value for a text field — strip
// lead-in fillers ("yes", "like", "I am from the", "it's") without mangling the
// substance. Returns null if nothing usable remains.
function cleanTextValue(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return null
  s = s.replace(/^(yes|yeah|yep|ok|okay|sure|so|well|like|um|uh|actually)[,\s]+/i, '')
  s = s.replace(/^(i\s*am|i'?m|i)\s+(interested\s+in|from|located\s+(?:in|at|from)?|in|studying)\s+/i, '')
  s = s.replace(/^(my\s+(?:name|city|location|place)\s+is|it'?s|that'?s)\s+/i, '')
  // Translate-in off: raw Telugu/Hindi hits this directly, so strip the in-language
  // "my name is" lead-in to save just the name. Telugu: optional "నా/మా/నీ" + "పేరు"
  // + optional connector "వచ్చి/అని" (so "పేరు వచ్చి రాహుల్" → "రాహుల్", "నా పేరు
  // కార్తీక్" → "కార్తీక్"); Hindi: "मेरा/मेरी नाम [है]". Trailing "అని"/"है" too.
  s = s.replace(/^(నా|మా|నీ|మై)?\s*(పేరు|నేమ్)\s*(వచ్చి|అని)?\s*/u, '')
  s = s.replace(/^(मेरा|मेरी)?\s*(नाम|नेम)\s*(है)?\s*/u, '')
  s = s.replace(/\s*(అని|है)\s*$/u, '')
  s = s.replace(/^the\s+/i, '')
  s = s.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
  return s.length ? s : null
}

// Filler/lead-in tokens the STT scatters around a spoken name. "my full name is X"
// comes through as English, or garbled across scripts depending on the mis-detect:
// "నా పేరు X", "ना फुल ले मुझसे X", "ନା ଫୁଲ୍ ନେମ୍ ଅଛି X". We strip these from anywhere
// and keep the real name (the remaining word/s — usually the last one or two).
const NAME_FILLER = new Set([
  'my', 'full', 'name', 'is', 'the', 'a', 'this', 'side',
  'నా', 'మా', 'నీ', 'మై', 'పేరు', 'నేమ్', 'వచ్చి', 'అని', 'ఫుల్', 'నేమ',
  'ना', 'मेरा', 'मेरी', 'मैं', 'नाम', 'नेम', 'है', 'फुल', 'फूल', 'ले', 'मुझे', 'मुझसे', 'से', 'नेम्',
  'ନା', 'ଫୁଲ୍', 'ନେମ୍', 'ଅଛି', 'ନାମ', 'ମୋ', 'ମୋର',
])
function extractName(message) {
  const v = cleanTextValue(message)
  if (!v) return null
  const norm = (t) => t.toLowerCase().replace(/[.,!?।]/g, '')
  const toks = v.split(/\s+/).filter(t => t && !NAME_FILLER.has(norm(t)))
  // What's left after dropping filler is the name; if it was ALL filler, keep the last word.
  const picked = (toks.length ? toks : v.split(/\s+/)).slice(-2).join(' ').trim()
  return picked.length >= 2 ? picked : null
}

// Best-effort value for the field currently being collected, from a spoken turn.
// Used by the save-guard so the agent never drops an answer and re-asks — AND so
// simple data-collection turns resolve in a single Groq call instead of two (a
// save_detail round-trip + a reply round-trip), which roughly halves turn latency.
// Numeric marks use extractMarksValue; names/location are lightly cleaned;
// caller_type is keyword-matched. interest/department are left to the model (it
// normalises e.g. "CSC" → "CSE"); relation/transport_need enums are left too.
function valueForPendingField(field, message) {
  if (field === 'marks_10' || field === 'marks_inter') return extractMarksValue(message)
  if (field === 'location') {
    const v = cleanTextValue(message)
    return v && v.length >= 2 ? v : null
  }
  if (field === 'student_name' || field === 'parent_name') {
    const v = extractName(message)
    if (!v || v.length < 2) return null
    // "I am a student/parent" is a caller_type answer, not a name — don't save it.
    if (/\b(student|parent|father|mother|mom|dad|guardian)\b/i.test(v) ||
        /^(స్టూడెంట్|విద్యార్థి|పేరెంట్|छात्र|स्टूडेंट)$/u.test(v)) return null
    return v
  }
  if (field === 'caller_type') {
    // English + Telugu/Hindi. Translate-in is off, so the STT hands us native script;
    // it transliterates spoken English too ("student" → "స్టూడెంట్", "parent" →
    // "పేరెంట్"), and callers also use native words (విద్యార్థి, తల్లి, తండ్రి…).
    if (/\b(parent|father|mother|mom|dad|guardian)\b/i.test(message) ||
        /పేరెంట్|తల్లి|తండ్రి|అమ్మ|నాన్న|సంరక్షకు|पैरंट|अभिभावक|माता|पिता|माँ|पापा/u.test(message)) return 'parent'
    if (/\b(student|myself)\b/i.test(message) || /\bi'?m the student\b/i.test(message) ||
        /స్టూడెంట్|స్టుడెంట్|విద్యార్థి|छात्र|स्टूडेंट|विद्यार्थी/u.test(message)) return 'student'
    return null
  }
  return null
}

function validateField(field, rawValue) {
  const value = String(rawValue ?? '').trim()

  switch (field) {
    case 'caller_type':
      if (!['student', 'parent'].includes(value.toLowerCase())) {
        return { ok: false, error: 'caller_type must be "student" or "parent"' }
      }
      return { ok: true, value: value.toLowerCase() }

    case 'relation':
      if (!['father', 'mother', 'guardian'].includes(value.toLowerCase())) {
        return { ok: false, error: 'relation must be one of: father, mother, guardian' }
      }
      return { ok: true, value: value.toLowerCase() }

    case 'transport_need':
      if (!['college_bus', 'hostel', 'own_transport'].includes(value.toLowerCase())) {
        return { ok: false, error: 'transport_need must be one of: college_bus, hostel, own_transport' }
      }
      return { ok: true, value: value.toLowerCase() }

    case 'marks_10':
    case 'marks_inter': {
      // Tolerate vague phrasing ("around 71", "like 65 percent", "71 ish") by
      // extracting the number before validating — the bound stays 0-100.
      const norm = extractMarksValue(value)
      if (norm === null) {
        return { ok: false, error: `${field} must be a number between 0 and 100 (percentage) or 0 and 10 (CGPA)` }
      }
      return { ok: true, value: norm }
    }

    case 'entrance_score': {
      const n = parseFloat(value)
      if (isNaN(n) || n < 0) {
        return { ok: false, error: 'entrance_score must be a non-negative number' }
      }
      return { ok: true, value: String(n) }
    }

    case 'student_name':
    case 'parent_name':
      if (value.length < 2 || value.length > 50) {
        return { ok: false, error: `${field} must be between 2 and 50 characters` }
      }
      return { ok: true, value }

    case 'interest':
    case 'department':
    case 'location':
    case 'entrance_exam':
    case 'visit_appointment':
      if (!value.length || value.length > 100) {
        return { ok: false, error: `${field} must be a non-empty string up to 100 characters` }
      }
      return { ok: true, value }

    default:
      return { ok: false, error: `Unknown field "${field}"` }
  }
}

// ── Dynamic required-fields logic ────────────────────────────────────────────

function getRequiredFields(collected = {}) {
  const fields = ['caller_type']

  if (collected.caller_type === 'parent') {
    fields.push('parent_name', 'relation', 'student_name', 'marks_10', 'marks_inter', 'interest', 'department')
  } else {
    fields.push('student_name', 'marks_10', 'marks_inter', 'interest', 'department')
  }

  fields.push('location', 'transport_need', 'visit_appointment')
  return fields
}

function getMissingFields(session) {
  const c = session?.collected || {}
  return getRequiredFields(c).filter(f => !has(c[f]))
}

// Short, warm fallback question per field — used when a weak model dumps the whole
// collection list instead of asking one thing (see looksLikeFieldDump). Keeps the
// call moving with a single clear question for whatever's next.
const FIELD_QUESTIONS = {
  caller_type:       'Am I speaking with the student, or a parent?',
  parent_name:       'May I know your name, please?',
  relation:          'Are you the father, mother, or guardian?',
  student_name:      "And the student's name, please?",
  marks_10:          'What was your 10th class percentage?',
  marks_inter:       'And your 12th or Intermediate percentage?',
  interest:          'Which course are you interested in — like B.Tech, MBA or Degree?',
  department:        'Which branch would you like — for example CSE or ECE?',
  location:          'Which city are you reaching out from?',
  transport_need:    'Would you prefer the college bus, the hostel, or your own transport?',
  visit_appointment: 'Would you like to book a campus visit?',
}
function defaultQuestionFor(session) {
  const f = getMissingFields(session)[0]
  return FIELD_QUESTIONS[f] || 'Could you tell me a little more about what you need?'
}

// Detect a model that regurgitated the whole field list instead of asking ONE thing
// (a frequent small-model failure): "provide the following details", 3+ bullets, or
// several field names crammed into one reply.
function looksLikeFieldDump(text) {
  const t = String(text || '')
  if (/provide the following|following details|following information/i.test(t)) return true
  if (((t.match(/(?:^|[\s])[-•*]\s/g) || []).length) >= 3) return true
  const fields = (t.match(/caller type|student'?s name|10th|12th|ssc|hsc|course of interest|department\/branch|branch of interest|transportation needs|campus visit/gi) || []).length
  return fields >= 3
}

// Detect code/markup the model leaked instead of speech — a weak-model failure where
// it emits a fake function/HTML/JSON "response" (e.g. _pb3_HtmlResponse({"html":"<p>…").
// These must never reach TTS; the caller would hear gibberish.
function looksLikeCodeLeak(text) {
  const t = String(text || '')
  if (!t.trim()) return true
  if (/<\/?[a-z!][^>]*>/i.test(t)) return true             // HTML/XML tags: <p>, </div>, <!--
  if (/[_a-z][\w.]*\s*\(\s*[{[]/i.test(t)) return true     // funcName({ …  or  funcName([ …
  if (/\{\s*"[\w-]+"\s*:/.test(t)) return true             // JSON object: {"key":
  if (/_pb\d|HtmlResponse|console\.|function\s*\(|=>|\bjson\b/i.test(t)) return true
  return false
}

// ── deriveStep — map collected progress onto the existing 12-step UI ────────

function deriveStep(session) {
  const c = session?.collected || {}

  // Forced terminal states
  if (c._escalate || c._endCall) return { step: 'end', step_index: 11 }

  if (!has(c.caller_type)) return { step: 'greeting', step_index: 0 }

  const nameDone = c.caller_type === 'parent'
    ? has(c.parent_name) && has(c.relation) && has(c.student_name)
    : has(c.student_name)
  if (!nameDone) return { step: 'name', step_index: 1 }

  if (!has(c.marks_10))    return { step: '10th',  step_index: 2 }
  if (!has(c.marks_inter)) return { step: 'inter', step_index: 3 }
  if (!has(c.interest) || !has(c.department)) return { step: 'course', step_index: 4 }

  // index 5 (fee) and 7 (scholarship) gate on facts having been shared;
  // index 6 (exam) is intentionally skipped — the agentic flow has no
  // entrance-exam field, so progress jumps 5 → 7.
  if (!c._packageShared)    return { step: 'fee',         step_index: 5 }
  if (!c._scholarshipShared) return { step: 'scholarship', step_index: 7 }

  if (!has(c.location))       return { step: 'location',  step_index: 8 }
  if (!has(c.transport_need)) return { step: 'transport',  step_index: 9 }
  if (!has(c.visit_appointment)) return { step: 'queries', step_index: 10 }

  return { step: 'end', step_index: 11 }
}

// ── Tool definitions (Groq / OpenAI-compatible function-calling schema) ─────

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'save_detail',
      description: 'Save a single piece of information the caller has just provided. Call this as soon as you hear a relevant fact, even mid-sentence.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ALLOWED_FIELDS, description: 'Which field this value belongs to.' },
          value: { type: 'string', description: 'The value to save, as a string.' },
        },
        required: ['field', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_missing_fields',
      description: 'Check which required fields are still missing for this caller (student vs parent requirements differ).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_course_package',
      description: 'Retrieve real fee/package information for a course and department from the university knowledge base. Only state facts returned by this tool.',
      parameters: {
        type: 'object',
        properties: {
          course:     { type: 'string', description: 'The course the student is interested in, e.g. "B.Tech".' },
          department: { type: 'string', description: 'The department/specialization, e.g. "Computer Science".' },
        },
        required: ['course', 'department'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scholarships',
      description: 'Retrieve real scholarship eligibility information from the university knowledge base based on the student\'s marks and entrance score. Only state facts returned by this tool.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transport_info',
      description: 'Retrieve real hostel and bus/transport information from the university knowledge base. Only state facts returned by this tool.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_campus_visit',
      description: 'Book a campus visit once the caller has agreed on a day and time.',
      parameters: {
        type: 'object',
        properties: {
          day:  { type: 'string', description: 'The day for the visit, e.g. "Saturday" or "2026-06-20".' },
          time: { type: 'string', description: 'The time for the visit, e.g. "11 AM".' },
        },
        required: ['day', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the call politely once all necessary information has been collected and confirmed.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief reason the call is ending.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description: 'Escalate to a human admission counsellor — use if the caller explicitly asks for a human, is upset, or you cannot help with their request.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief reason for escalation.' },
        },
      },
    },
  },
]

// ── RAG result compaction ───────────────────────────────────────────────────
// KB chunks are large multi-program tables. Dumping 3 of them whole (several KB)
// into the synthesis call blows the latency budget. Compact aggressively: from
// each of the top chunks keep the sentences most relevant to `focus` (the
// student's course/department/etc.), ranked by how many focus terms they hit, and
// cap each chunk so the whole payload stays well under ~1KB while still carrying
// the specific figure the agent needs to quote.
function compactFacts(results, focus = [], perChunk = 300, maxChunks = 3) {
  // Most specific terms first (e.g. department before course) so the window
  // centres on the student's row. Use a contiguous slice — never sentence
  // fragments — so figures like "Rs. 2,75,000 per year" are never orphaned.
  const keys = focus.filter(Boolean).map(s => String(s).toLowerCase()).filter(s => s.length > 1)

  const pick = (text) => {
    if (keys.length) {
      const lower = text.toLowerCase()
      let idx = -1
      for (const k of keys) { const j = lower.indexOf(k); if (j >= 0) { idx = j; break } }
      if (idx >= 0) {
        const start = Math.max(0, idx - 30)
        const end   = Math.min(text.length, start + perChunk)
        return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
      }
    }
    return text.length > perChunk ? text.slice(0, perChunk).trim() + '…' : text.trim()
  }

  return results.slice(0, maxChunks).map(r => pick(r.text)).filter(Boolean).join(' | ')
}

// ── Tool execution ────────────────────────────────────────────────────────

async function executeTool(sessionId, toolName, args = {}, collected = {}) {
  switch (toolName) {

    case 'save_detail': {
      const { field, value } = args
      if (!ALLOWED_FIELDS.includes(field)) {
        return { result: `Error: unknown field "${field}". Allowed fields: ${ALLOWED_FIELDS.join(', ')}`, collectedPatch: {} }
      }
      const v = validateField(field, value)
      if (!v.ok) return { result: `Error: ${v.error}`, collectedPatch: {} }
      return { result: `Saved ${field} = ${v.value}`, collectedPatch: { [field]: v.value } }
    }

    case 'get_missing_fields': {
      const missing = getMissingFields({ collected })
      return {
        result: missing.length ? `Missing fields: ${missing.join(', ')}` : 'All required fields have been collected.',
        collectedPatch: {},
      }
    }

    case 'get_course_package': {
      // Prefer the student's actual course/department (from collected) so the
      // search ranks their specific row, not the whole program table.
      const course     = String(args.course     || collected.interest   || '').trim()
      const department = String(args.department || collected.department || '').trim()
      const query   = [course, department, 'fee structure tuition'].filter(Boolean).join(' ')
      const results = await vectorStore.search(query, 3)
      const facts   = compactFacts(results, [department, course], 300, 3)
      return {
        result: facts || 'No specific package information found in the knowledge base — give only general, non-specific encouragement and do not state any fee figures.',
        collectedPatch: { _packageShared: true },
      }
    }

    case 'get_scholarships': {
      const query   = ['scholarship eligibility', collected.department, collected.interest,
                       collected.marks_10, collected.marks_inter, collected.entrance_score]
        .filter(Boolean).join(' ') || 'scholarship'
      const results = await vectorStore.search(query, 3)
      const facts   = compactFacts(results, [collected.department, collected.interest], 280, 2)
      return {
        result: facts || 'No specific scholarship information found in the knowledge base — do not state any scholarship figures.',
        collectedPatch: { _scholarshipShared: true },
      }
    }

    case 'get_transport_info': {
      const query   = ['hostel bus transport facilities', collected.location].filter(Boolean).join(' ')
      const results = await vectorStore.search(query, 3)
      const facts   = compactFacts(results, [collected.location], 300, 3)
      return {
        result: facts || 'No specific transport/hostel information found in the knowledge base.',
        collectedPatch: {},
      }
    }

    case 'book_campus_visit': {
      const day  = String(args.day  || '').trim()
      const time = String(args.time || '').trim()
      if (!day || !time) {
        return { result: 'Error: both day and time are required to book a campus visit', collectedPatch: {} }
      }
      const appointment = `${day} at ${time}`
      return {
        result: `Campus visit booked for ${appointment}. (TODO: sync to calendar)`,
        collectedPatch: { visit_appointment: appointment },
      }
    }

    case 'end_call': {
      const reason = String(args.reason || 'conversation complete')
      return { result: `Ending call: ${reason}`, collectedPatch: { _endCall: true } }
    }

    case 'escalate_to_human': {
      const reason = String(args.reason || 'requested by caller')
      return { result: `Escalating to a human counsellor: ${reason}`, collectedPatch: { _escalate: true } }
    }

    default:
      return { result: `Error: unknown tool "${toolName}"`, collectedPatch: {} }
  }
}

// ── System prompt ─────────────────────────────────────────────────────────

const LANG_NAMES = { 'te-IN': 'Telugu', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil', 'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'mr-IN': 'Marathi', 'bn-IN': 'Bengali', 'en-IN': 'English' }

function buildAgenticSystemPrompt(session, opts = {}) {
  const c = session?.collected || {}
  const profile = Object.entries(c)
    .filter(([k, v]) => !k.startsWith('_') && has(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'none yet'

  const pendingField = getMissingFields(session)[0] || null

  // Reply-language instruction. Default: reply in English (Sarvam translates after).
  // Native mode (opts.replyLanguage set): reply DIRECTLY in the caller's language,
  // in natural code-mixed phone style — no translation step downstream.
  const lang = opts.replyLanguage && opts.replyLanguage !== 'en-IN' ? opts.replyLanguage : null
  const langName = lang ? (LANG_NAMES[lang] || lang) : null
  const replyInstruction = lang
    ? `Reply directly in ${langName}, the way people actually talk on the phone — natural, modern, freely CODE-MIXED. Write the ${langName} words in real ${langName} SCRIPT (actual ${langName} characters), NEVER romanized/Latin spelling — e.g. write "నాకు" not "naaku", "మీ" not "mee". Keep common English words in English (fee, scholarship, course, B.Tech, CSE, percentage, marks, campus, hostel, branch, university) and keep numbers as plain digits (e.g. 2,75,000 — never native-script digits). NEVER translate proper nouns, acronyms or programme names — "Aditya University", "B.Tech", "CSE", "SAP", "Google Cloud" stay EXACTLY as written; never invent a native-language word for them. Do NOT use pure/formal ${langName}; mix English naturally like a real bilingual ${langName} speaker. Do not write any English-only sentence — your reply is spoken aloud directly with no translation.`
    : `Always reply in English — translation to the caller's language happens automatically after you respond.`

  return `You are Priya, a warm, persuasive admission counsellor at Aditya University, on a phone call with a prospective student or parent.

LANGUAGE: You speak Telugu, Hindi and English fluently. If the caller asks you to switch language, agree warmly and keep helping — NEVER say you can't. ${replyInstruction}

STYLE:
- Warm and human, like a caring family friend — not a form-filler. Use the caller's name naturally.
- Reply in ONE short sentence: a quick acknowledgement + AT MOST one question (~15 words, hard max 25).
- Ask ONE detail at a time. NEVER list fields or ask for several things at once.
- When sharing fee/scholarships/details, give only the single most relevant fact + a short check-in ("How does that sound?"). Never enumerate or read a paragraph.
- Be persuasive: highlight real strengths (placements, industry tie-ups, the scholarship they qualify for) and build excitement toward the next step — never pressure.
- Never narrate tools and never repeat a question.

PLAYBOOK (one field at a time, in order):
1. Language was asked at greeting — acknowledge their choice, never re-ask.
2. caller_type — student or parent?
3. PARENT: parent_name → relation (father/mother/guardian) → student_name. STUDENT: just student_name. All later questions are about the STUDENT.
4. marks_10 (10th %/CGPA), then marks_inter (12th %).
5. interest (course: B.Tech, MBA, Degree).
6. department (branch: CSE, ECE…) — as a separate question.
7. get_course_package → warmly present the fee, then check in and wait for their reaction.
8. get_scholarships → reassure with the scholarships the student qualifies for.
9. location, then transport_need (college_bus/hostel/own_transport) — use get_transport_info for facts.
10. Offer a campus visit; if they agree on a day + time, book_campus_visit.
11. Confirm the key details in one sentence, then end_call.

TOOLS: save_detail(field,value) — save info the moment you hear it. get_course_package(course,department), get_scholarships(), get_transport_info() — quote ONLY what they return. book_campus_visit(day,time). end_call(reason). escalate_to_human(reason) — if the caller wants a human or you can't help.

RULES:
- Quote ONLY tool facts — never fabricate fees, scholarships, rankings, or facilities.
- Save each answer with save_detail before the next question; never ask the same thing twice. If they didn't actually answer (trailed off / garbled), gently ask once more — don't skip ahead.
- If the input is empty, garbled, or mis-transcribed, warmly ask them to repeat — never guess or move on.
- Ask for exactly the field in CURRENTLY COLLECTING; don't skip ahead. Only say "child's name" if they confirmed they're a parent.

CURRENTLY COLLECTING: ${pendingField || '(all required details collected)'}
CALLER PROFILE SO FAR: ${profile}`
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  validateField,
  extractMarksValue,
  valueForPendingField,
  getRequiredFields,
  getMissingFields,
  defaultQuestionFor,
  looksLikeFieldDump,
  looksLikeCodeLeak,
  deriveStep,
  buildAgenticSystemPrompt,
  ALLOWED_FIELDS,
}
