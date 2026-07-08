// ---------------------------------------------------------------------------
// Flow controller for the Priya admission call.
//
// Responsibilities:
//   1. extractDataFromText()  — regex extraction of student facts from speech
//   2. smartAdvance()         — determine next step based on collected data
//   3. buildSystemPrompt()    — construct the Groq system prompt for this turn
// ---------------------------------------------------------------------------

const STEPS = [
  { name: 'greeting',    index: 0,  field: null,           goal: 'Greet the student warmly and ask for their full name.' },
  { name: 'name',        index: 1,  field: 'name',         goal: 'Collect the student\'s full name.' },
  { name: '10th',        index: 2,  field: 'marks_10',     goal: 'Ask about their 10th class / SSC percentage.' },
  { name: 'inter',       index: 3,  field: 'marks_inter',  goal: 'Ask about their Intermediate / 12th class percentage.' },
  { name: 'course',      index: 4,  field: 'interest',     goal: 'Find out which course or program they are interested in.' },
  { name: 'fee',         index: 5,  field: null,           goal: 'Share fee details for their interested course using university information.' },
  { name: 'exam',        index: 6,  field: 'entrance_exam',goal: 'Ask if they appeared in JEE / EAMCET and their score or rank.' },
  { name: 'scholarship', index: 7,  field: null,           goal: 'Explain scholarship options based on their marks and entrance score.' },
  { name: 'location',    index: 8,  field: 'location',     goal: 'Ask which city or area they are from.' },
  { name: 'transport',   index: 9,  field: null,           goal: 'Explain bus and hostel facilities relevant to their location.' },
  { name: 'queries',     index: 10, field: null,           goal: 'Invite any remaining questions and answer them using university information.' },
  { name: 'end',         index: 11, field: null,           goal: 'Thank the student, promise to send the brochure and fee structure, and say goodbye.' },
]

const STEP_BY_NAME = Object.fromEntries(STEPS.map(s => [s.name, s]))

// ── 0. Spoken-number normalisation ───────────────────────────────────────────
// Converts English number-words (as output by Sarvam STT/translate) to digits
// BEFORE regex extraction runs. Scoped to percentage-context only to avoid
// false positives like "one B.Tech" → "1 B.Tech".
function normalizeSpokenNumbers(text) {
  const ones = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
    eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
    fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18,
    nineteen:19
  }
  const tens = {
    twenty:20, thirty:30, forty:40, fifty:50,
    sixty:60, seventy:70, eighty:80, ninety:90
  }

  // Match "seventy five percent", "seventy-five percent", "eighty three point two percent"
  let normalized = text.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]?(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)?\s*(?:point\s*(\d+))?\s*(?:percent|%)/gi,
    (match, tensWord, onesWord, decimal) => {
      let val = tens[tensWord.toLowerCase()]
      if (onesWord) val += ones[onesWord.toLowerCase()]
      return decimal ? `${val}.${decimal} %` : `${val} %`
    }
  )

  // Also handle pure tens: "sixty percent", "eighty percent"
  normalized = normalized.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:percent|%)/gi,
    (match, tensWord) => `${tens[tensWord.toLowerCase()]} %`
  )

  return normalized
}

// ── 1. Data extraction ────────────────────────────────────────────────────────

function extractDataFromText(rawText) {
  const text = normalizeSpokenNumbers(rawText)   // normalise spoken numbers first
  const extracted = {}

  // Full name: "My name is Rajesh Kumar", "I am Priya", "This is Arun"
  const nameRx = text.match(/(?:my name is|i am|this is|i'm|name is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i)
  if (nameRx) extracted.name = nameRx[1].trim()

  // 10th / SSC marks — handles BOTH orders:
  //   "10th marks are 85%"  (keyword before number)
  //   "85% in 10th class"   (number before keyword)
  const tenth1 = text.match(/(?:10th|tenth|ssc|class\s*10)[^\d]*(\d{2,3}(?:\.\d{1,2})?)\s*(?:%|percent|marks?)?/i)
  const tenth2 = text.match(/(\d{2,3}(?:\.\d{1,2})?)\s*%?\s*(?:in|for|at|marks?|scored?|got)?\s*(?:10th|tenth|ssc|class\s*10)/i)
  if (tenth1) extracted.marks_10 = tenth1[1]
  else if (tenth2) extracted.marks_10 = tenth2[1]

  // 12th / Intermediate marks — handles BOTH orders:
  //   "12th marks are 71%"  (keyword before number)
  //   "71% in 12th class"   (number before keyword)
  const inter1 = text.match(/(?:12th|inter(?:mediate)?|hsc|plus\s*two|class\s*12)[^\d]*(\d{2,3}(?:\.\d{1,2})?)\s*(?:%|percent|marks?)?/i)
  const inter2 = text.match(/(\d{2,3}(?:\.\d{1,2})?)\s*%?\s*(?:in|for|at|marks?|scored?|got)?\s*(?:12th|inter(?:mediate)?|hsc|plus\s*two)/i)
  if (inter1) extracted.marks_inter = inter1[1]
  else if (inter2) extracted.marks_inter = inter2[1]

  // Generic "X %" fallback — only when no keyword context was found
  if (!extracted.marks_10 && !extracted.marks_inter) {
    const pctRx = text.match(/(\d{2,3}(?:\.\d{1,2})?)\s*(?:%|percent)/i)
    if (pctRx) extracted._pct = pctRx[1]
  }

  // Course / program interest
  // "IT" is checked separately and case-SENSITIVE — the case-insensitive /i flag
  // would otherwise match "it" inside common words like "It's"/"it is", wrongly
  // marking the course as collected and skipping the course step.
  const courseRx = text.match(
    /\b(B\.?\s*Tech|M\.?\s*Tech|MBA|BBA|BCA|MCA|B\.?\s*Sc|M\.?\s*Sc|B\.E\.?|M\.E\.?|Ph\.D\.?|CSE|ECE|EEE|civil\s*engineering|mechanical\s*engineering|electrical\s*engineering|computer\s*science(?:\s*engineering)?|data\s*science|artificial\s*intelligence|cyber\s*security)\b/i
  ) || text.match(/\bIT\b/)
  if (courseRx) extracted.interest = courseRx[0].replace(/\s+/g, ' ').trim()

  // Entrance exam name
  const examRx = text.match(/\b(JEE(?:\s*(?:Main|Advanced|Mains))?|EAMCET|TS\s*EAMCET|AP\s*EAMCET|KCET|BITSAT|VITEEE|COMEDK)\b/i)
  if (examRx) extracted.entrance_exam = examRx[1]

  // Entrance score / rank
  const rankRx = text.match(/(?:rank|AIR|score|got|marks?|percentile)[^\d]*(\d+)/i)
  if (rankRx) extracted.entrance_score = rankRx[1]

  // City / location
  const cityRx = text.match(/(?:from|live in|living in|based in|located in|staying in|at)\s+([A-Z][a-z]{2,20}(?:\s+[A-Z][a-z]{2,20})?)/i)
  if (cityRx) extracted.location = cityRx[1].trim()

  return extracted
}

// ── 2. Question detection ─────────────────────────────────────────────────────

function isQuestion(text) {
  const t = text.toLowerCase()
  return t.includes('?') ||
    /\b(what|how|when|where|why|tell me|can you|could you|do you|is there|are there|which|explain|about|details|more info|inform)\b/.test(t)
}

// ── 3. Smart step advancement ─────────────────────────────────────────────────
// studentAskedQuestion: when true and we are in the optional phase (index >= 5),
// hold the step so the LLM can answer the question before moving on.

function smartAdvance(session, extracted, studentAskedQuestion = false) {
  // Merge extracted into collected
  const c           = { ...session.collected }
  const currentStep = session.step || 'greeting'
  for (const [k, v] of Object.entries(extracted)) {
    if (k === '_pct') continue
    // Name is only accepted at greeting/name steps — prevents a stray "I am [name]"
    // phrase later in the call from overwriting the already-collected student name.
    if (k === 'name' && !['greeting', 'name'].includes(currentStep)) continue
    c[k] = v
  }

  // _pct fallback — only assign during marks-collection steps to avoid
  // stray percentages (e.g. from fee/scholarship context) polluting marks fields.
  // When the current step is 'inter', the student is answering about 12th marks,
  // so assign _pct to marks_inter first rather than marks_10.
  if (extracted._pct) {
    const marksSteps = ['greeting', 'name', '10th', 'inter']
    if (marksSteps.includes(currentStep)) {
      if (currentStep === 'inter' && !c.marks_inter) {
        c.marks_inter = extracted._pct
      } else if (!c.marks_10) {
        c.marks_10    = extracted._pct
      } else if (!c.marks_inter) {
        c.marks_inter = extracted._pct
      }
    }
  }

  // ── Required-field gate ──────────────────────────────────────────────────
  // All four fields must be genuine non-empty strings — guards against
  // translation artifacts setting interest to an empty / whitespace value
  // and causing the flow to skip the course step entirely.
  const has = (v) => typeof v === 'string' && v.trim().length > 0

  if (!has(c.name))        return { step: 'name',   step_index: 1, collected: c }
  if (!has(c.marks_10))    return { step: '10th',   step_index: 2, collected: c }
  if (!has(c.marks_inter)) return { step: 'inter',  step_index: 3, collected: c }
  if (!has(c.interest))    return { step: 'course', step_index: 4, collected: c }
  // ────────────────────────────────────────────────────────────────────────

  // Optional phase: hold step if student asked a question so Priya can answer it.
  // Min is 4 (course) so the fee step (5) is the first optional step reached,
  // not 6 (exam) — previously 5 caused course→exam, skipping fee entirely.
  const idx = Math.max(session.step_index || 0, 4)

  // Only hold at idx >= 5 (fee/exam/scholarship/...). At idx === 4 (course),
  // the required-field gate above guarantees c.interest is already set —
  // holding here would force the course question to repeat even though the
  // interest was just collected (e.g. "MTech, is it available?").
  const hold = studentAskedQuestion && idx >= 5
  const next = hold ? idx : Math.min(idx + 1, 11)
  const step = STEPS[next]?.name || 'end'
  return { step, step_index: next, collected: c }
}

// ── 4. System prompt builder ──────────────────────────────────────────────────

// Exact question Priya MUST ask at each step — step name = data we are COLLECTING.
// Each entry must contain at most ONE question mark so the enforcement logic can
// cleanly strip and re-append without creating duplicate questions.
const STEP_QUESTIONS = {
  greeting:    'May I know your good name please?',
  name:        'May I know your good name please?',
  '10th':      'Could you please share your 10th class or SSC percentage?',
  inter:       'And what was your percentage in Intermediate or 12th?',
  course:      'Which course are you looking at — B.Tech, MBA, or something else?',
  fee:         'Would you like to know the fee structure for your chosen course?',
  exam:        'Have you appeared in JEE or EAMCET, and if yes, what was your score or rank?',
  scholarship: 'Based on your marks you may be eligible for a scholarship — shall I check your eligibility?',
  location:    'Which city or area are you currently from?',
  transport:   'Do you have any other questions about our hostel or transport facilities?',
  queries:     'Is there anything else you would like to know about Aditya University?',
  end:         "Thank you for your time! We will WhatsApp you the brochure shortly. Goodbye!",
}

function buildSystemPrompt(session, ragResults, prevStep = null) {
  const c         = session.collected || {}
  const step      = session.step || 'greeting'
  const nextQ     = STEP_QUESTIONS[step] || STEP_QUESTIONS.greeting

  const profile = [
    c.name          && `name: ${c.name}`,
    c.marks_10      && `10th: ${c.marks_10}%`,
    c.marks_inter   && `12th: ${c.marks_inter}%`,
    c.interest      && `course: ${c.interest}`,
    c.entrance_exam && `exam: ${c.entrance_exam}${c.entrance_score ? ' score ' + c.entrance_score : ''}`,
    c.location      && `location: ${c.location}`,
  ].filter(Boolean).join(', ') || 'none yet'

  const facts = ragResults?.length
    ? ragResults.map(r => r.text.substring(0, 200)).join(' | ')
    : ''

  const earlyStep  = ['greeting', 'name', '10th', 'inter', 'course'].includes(step)
  const noFacts    = earlyStep
    ? '\nDO NOT share any university information, course details, fees, scholarships, or promotional content right now. Only acknowledge what the student just said and ask the question.'
    : ''
  // When transitioning from the fee step, the student just agreed to hear fee details.
  // Instruct the LLM to share fee info FIRST, then pivot to the next question.
  const feeDelivery = prevStep === 'fee'
    ? '\nThe student just agreed to hear fee details. Start your reply by sharing the fee structure from FACTS, then ask the mandatory question.'
    : ''

  return `You are Priya, an enthusiastic admission counsellor at Aditya University calling a prospective student. This is a phone call — speak naturally and warmly, like a real person.
Reply in 1-2 short sentences maximum.

YOUR GOAL: gently convince this student that Aditya University is a great choice for them and encourage them toward admission — be positive, confident, and encouraging without sounding scripted or pushy.

YOUR REPLY MUST ALWAYS END WITH THIS EXACT QUESTION (copy it word for word):
"${nextQ}"

HOW TO RESPOND:
- Student gave information → acknowledge what they JUST said with a warm, specific, encouraging reaction (e.g. "That's great, 65 percent in 10th — that's a solid foundation!" or "Wonderful, B.Tech is an excellent choice, we have great placements in that field!"). Then ask the question above.
- Student asked a question → answer in one sentence using FACTS below, framing it positively to highlight why Aditya University is a great fit, then ask the question above.
- Student is confused or off-topic → gently redirect in one sentence, then ask the question above.
- NEVER say "you've already shared" or treat anything as previously known — always react to what the student just said.
- NEVER invent information not in FACTS or the student's own words.${noFacts}${feeDelivery}

STUDENT PROFILE (for context only — do not reference it in your reply): ${profile}
${facts ? `FACTS: ${facts}` : ''}`
}

module.exports = { extractDataFromText, smartAdvance, buildSystemPrompt, isQuestion, STEPS, STEP_QUESTIONS }