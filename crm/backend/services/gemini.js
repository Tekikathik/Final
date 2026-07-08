/**
 * Gemini 1.5 Flash transcript parser.
 *
 * After every completed AI call the telephony provider posts the raw
 * transcript to /api/calls/webhook. We feed that transcript to Gemini Flash
 * with a strict JSON schema instruction so we get back structured data that
 * maps 1:1 onto our Report mongoose model — profile, summary, enrolment
 * probability, topic interest scores, sentiment timeline, follow-ups.
 *
 * Why Flash specifically:
 *   - call transcripts are small (a few KB), so we don't need 1.5 Pro
 *   - Flash latency is sub-second which keeps the webhook handler fast
 *   - cost per extraction is fractions of a cent, important at campaign scale
 *
 * Robustness notes:
 *   - The model occasionally wraps JSON in markdown fences. We strip them.
 *   - If parsing fails we fall back to the heuristic generator so the report
 *     is never empty (the call still gets a row in the dashboard).
 */
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { generateReport } = require('../utils/reportGenerator')

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null

// Must match the Call model's `disposition` enum (invalid values become null).
const VALID_DISPOSITIONS = ['interested', 'callback', 'wrong_number', 'not_interested', 'no_answer', 'enrolled']

// Single shared model handle. responseMimeType: application/json forces the
// model to emit valid JSON without us having to clean markdown fences.
const model = genAI?.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.2, // factual extraction — no creativity
  },
})

const SYSTEM_PROMPT = `You are an extraction engine for AdmitAI, an automated college admission outreach platform.
You will be given the full transcript of a phone call between an AI admission counsellor and a prospective student (or parent).

Return a SINGLE JSON object — no prose, no markdown — that matches this exact schema:
{
  "profile": {
    "name": string,
    "phone": string,
    "email": string,
    "examAppeared": string,        // e.g. "JEE Main 2025", "EAMCET 2025", "" if not mentioned
    "courseInterested": string,    // e.g. "B.Tech CSE", "MBA", "" if not mentioned
    "currentCity": string,
    "tenthPercent": number|null,
    "twelfthPercent": number|null,
    "entranceScore": string        // raw score/rank as said, e.g. "AIR 4521"
  },
  "summary": string,               // 2-3 sentence neutral summary of the conversation
  "enrollmentProbability": number, // 0-100 — your estimate of likelihood to enrol
  "interested": boolean,           // true if the student showed clear interest in admission
  "sentiment": "positive" | "neutral" | "negative",  // overall sentiment
  "disposition": "interested" | "callback" | "wrong_number" | "not_interested" | "no_answer" | "enrolled",
  // ^ the call outcome: interested=wants to proceed; callback=asked to be called later;
  //   wrong_number=not the right person; not_interested=declined; no_answer=no real talk;
  //   enrolled=confirmed enrolment.
  "topicAnalysis": {
    "fees": number,            // 0-100, how strongly this topic was discussed/of interest
    "scholarship": number,
    "placement": number,
    "hostel": number,
    "courseDetails": number,
    "admissionProcess": number
  },
  "sentimentTimeline": [
    { "timestamp": number, "label": "positive"|"neutral"|"negative", "score": number /* -1..1 */ }
  ],
  "followUpRecommendations": [string]  // 2-5 concrete next-step actions for the admission officer
}

Rules:
- If a field isn't mentioned, use "" for strings, null for numbers (except topicAnalysis which defaults to 0).
- enrollmentProbability must be a sober estimate, not optimistic.
- followUpRecommendations should be specific and actionable, not generic.`

/**
 * Parse a transcript and return a Report-shaped object ready for save().
 * @param {object} args
 * @param {object} args.call           - the Call mongoose document
 * @param {Array}  args.transcript     - [{ speaker: 'ai'|'student', text, timestamp }]
 * @param {object} args.webhookPayload - the raw provider webhook (kept for audit)
 */
async function parseTranscript({ call, transcript = [], webhookPayload = {} }) {
  // No API key, or empty transcript: fall through to the heuristic generator.
  // This keeps dev environments and test seeds working without a Gemini key.
  if (!model || transcript.length === 0) {
    return generateReport({ call, webhookPayload })
  }

  const conversation = transcript
    .map(t => `${t.speaker === 'ai' ? 'AI' : 'Student'}: ${t.text}`)
    .join('\n')

  try {
    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `\n\nTRANSCRIPT:\n${conversation}` },
    ])
    const raw = result.response.text()
    const parsed = JSON.parse(raw)

    // Map Gemini's JSON onto our Mongo Report shape. We add the foreign keys
    // (callId, collegeId, orgId) here since Gemini has no business knowing
    // them, and we keep the raw payload + transcript for traceability.
    return {
      callId: call._id,
      collegeId: call.collegeId,
      orgId: call.orgId,
      profile: {
        name: parsed.profile?.name || call.name || 'Unknown',
        phone: parsed.profile?.phone || call.phone,
        email: parsed.profile?.email || '',
        examAppeared: parsed.profile?.examAppeared || '',
        courseInterested: parsed.profile?.courseInterested || '',
        currentCity: parsed.profile?.currentCity || '',
        tenthPercent: parsed.profile?.tenthPercent ?? null,
        twelfthPercent: parsed.profile?.twelfthPercent ?? null,
        entranceScore: parsed.profile?.entranceScore || '',
      },
      summary: parsed.summary || '',
      enrollmentProbability: clamp(parsed.enrollmentProbability, 0, 100),
      topicAnalysis: {
        fees:             clamp(parsed.topicAnalysis?.fees, 0, 100),
        scholarship:      clamp(parsed.topicAnalysis?.scholarship, 0, 100),
        placement:        clamp(parsed.topicAnalysis?.placement, 0, 100),
        hostel:           clamp(parsed.topicAnalysis?.hostel, 0, 100),
        courseDetails:    clamp(parsed.topicAnalysis?.courseDetails, 0, 100),
        admissionProcess: clamp(parsed.topicAnalysis?.admissionProcess, 0, 100),
      },
      sentimentTimeline: Array.isArray(parsed.sentimentTimeline) ? parsed.sentimentTimeline : [],
      followUpRecommendations: Array.isArray(parsed.followUpRecommendations)
        ? parsed.followUpRecommendations.slice(0, 6)
        : [],
      transcript,
      rawWebhookPayload: webhookPayload,
      // Side-effects for the Call doc are returned alongside so the route
      // can update both Call and Report from a single Gemini call.
      _callPatch: {
        sentiment: parsed.sentiment || null,
        interested: typeof parsed.interested === 'boolean' ? parsed.interested : null,
        disposition: VALID_DISPOSITIONS.includes(parsed.disposition) ? parsed.disposition : null,
      },
    }
  } catch (err) {
    console.error('[gemini] extraction failed, falling back to heuristics:', err.message)
    return generateReport({ call, webhookPayload })
  }
}

function clamp(n, min, max) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

module.exports = { parseTranscript }
