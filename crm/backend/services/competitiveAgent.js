// ---------------------------------------------------------------------------
// Competitive Intelligence Agent.
//
// Runs on-demand or on a schedule. It:
//   1. GATHERS evidence — competitor mentions in call transcripts, campaign
//      metrics (lost/converted leads), and competitor profile pages.
//   2. REASONS — for each rival performing better than Aditya, lists where they
//      beat us (our gaps) and where we beat them (our strengths), each tied to a
//      source + confidence. Uses an LLM when configured; a deterministic
//      comparison otherwise (so it always works).
//   3. RANKS competitors by threat, and outputs prioritized improvements.
//
// Output is saved as a CompetitiveReport with status='draft' — a human reviews
// it before any action is taken.
// ---------------------------------------------------------------------------
const Call = require('../models/Call')
const Lead = require('../models/Lead')
const Competitor = require('../models/Competitor')
const CompetitiveReport = require('../models/CompetitiveReport')
const CompetitiveSignal = require('../models/CompetitiveSignal')
const { completeJson, hasLlm } = require('./llm')
const scraper = require('./scraper')

// ── CI agent identity + hard rules (from aditya-university-ci-agent-prompt.md) ─
// Prepended to every LLM call the agent makes, so reasoning, playbooks and briefs
// all follow the same discipline.
const CI_IDENTITY =
  'You are the Competitive Intelligence Agent for Aditya University, a private university ' +
  '(formerly Aditya Engineering College) at Surampalem, Kakinada District, Andhra Pradesh — ' +
  'NAAC A++ accredited. You monitor competitor institutions and convert raw signals into ' +
  'intelligence admissions leadership can act on. ' +
  'Context: admission channels are AP EAPCET counselling, management/spot quota, ECET, ' +
  'GATE/AP PGECET, AP ICET and Polycet. Key programs to defend: B.Tech CSE, AI & ML, ' +
  'CSE (Data Science), ECE, EEE, Mechanical, Civil, Agricultural, Mining, Petroleum, ' +
  'industry-associated tracks (SAP, Google Cloud, Microsoft), MBA, MCA, M.Tech, Pharmacy. ' +
  'Catchment: East Godavari / Kakinada / Rajahmundry belt and coastal AP; parents decide, ' +
  'students shortlist. Competitor tiers: 1 = direct local rival, 2 = government benchmark ' +
  '(JNTUK — cutoffs and seat matrix matter, not marketing), 3 = regional private university. ' +
  'Every signal is routed by department (CSE, AIML, DS, ECE, EEE, MECH, CIVIL, AGRI, MINING, ' +
  'PETRO, MBA, MCA, PHARMACY, SCIENCE, or UNIVERSITY_WIDE for institution-level items) so ' +
  'intelligence reaches the HOD who can act on it; an HOD never sees other departments\' items.'

const CI_HARD_RULES =
  'HARD RULES: Facts only — every claim must tie to a source; unverifiable claims get ' +
  'confidence "low" and never enter the playbook. Distinguish precisely between what a ' +
  'competitor CLAIMS and what is independently CONFIRMED — use those words. Quote fragments ' +
  'must stay under 15 words; paraphrase everything else. Never fabricate a competitor move ' +
  'to fill an empty report — "no significant changes" is a valid and useful finding. When ' +
  'sources conflict, report the conflict and treat the competitor\'s official website as ' +
  'primary. Never include rumors, unverified complaints, or disparaging language. Output STRICT JSON.'

// Live web-scraping is ON by default; set COMPETITIVE_SCRAPE=off to disable.
const SCRAPE = String(process.env.COMPETITIVE_SCRAPE || 'on').toLowerCase() !== 'off'
const ADITYA_URL = process.env.ADITYA_URL || 'https://www.adityauniversity.in'
const ADITYA_PLACEMENTS_URL = process.env.ADITYA_PLACEMENTS_URL || 'https://www.adityauniversity.in/placements'

// Our own institution's facts (from the knowledge base) — the baseline everything
// is compared against. Edit here (or later pull from the KB) as the profile changes.
const ADITYA_PROFILE = {
  name: 'Aditya University',
  naac: 'A++ (highest grade in India)',
  nirf: 'NIRF 2025 band 151–200 (University); THE Impact Top-50 India; QS I-Gauge Diamond',
  placementHighestLpa: 27,
  placementAvgLpa: 6,
  topRecruiters: ['Walmart', 'Amazon', 'TCS', 'Infosys', 'Deloitte'],
  annualFeeLpa: 2.0,
  scholarships: 'Merit scholarships up to 100% via ASAT/JEE/EAPCET slabs',
  hostel: 'AC & non-AC hostels, laundry + medical insurance included',
  strengths: [
    'NAAC A++ — the highest accreditation grade in India',
    'Industry-collaborated B.Tech with SAP, Google Cloud and Microsoft',
    'Business School is the only one in India tied up with all Big 4 (Deloitte, PwC, EY, KPMG)',
    'International collaborations (SUNY, Georgia Tech, RWTH Aachen, University of Hull…)',
    'NBA Tier-1 accreditation for engineering; 250-acre smart campus',
  ],
  programs: ['B.Tech CSE/AIML/Data Science (+ SAP/Google/Microsoft tracks)', 'MBA', 'B.Pharmacy', 'Sciences'],
}

// Pull a short excerpt of the transcript around the first mention of `needle`.
function excerptAround(text, needle, span = 90) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return ''
  const start = Math.max(0, i - span)
  const end = Math.min(text.length, i + needle.length + span)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}

// ── Scrape enrichment — pull KEY FEATURES from live websites ─────────────────
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

// Turn a stored profile object into key-feature points (used when a scrape fails).
function profileToKeyFeatures(p = {}, sourceType, url) {
  const kf = []
  const add = (point, category, conf = 'medium') => point && kf.push({ point, category, source: { type: sourceType, ref: url || 'stored_profile', excerpt: '' }, confidence: conf })
  if (p.naac) add(`NAAC ${String(p.naac).replace(/\s*\(.*\)$/, '')}`, 'ranking', 'high')
  if (p.nirf) add(String(p.nirf).slice(0, 120), 'ranking', 'medium')
  else if (p.nirfRank) add(`NIRF rank ${p.nirfRank}`, 'ranking', 'medium')
  if (num(p.placementHighestLpa) != null) add(`Highest package ₹${p.placementHighestLpa}L`, 'placements', 'high')
  if (num(p.placementAvgLpa) != null) add(`Average package ₹${p.placementAvgLpa}L`, 'placements', 'medium')
  if (num(p.annualFeeLpa) != null) add(`Annual fee ₹${p.annualFeeLpa}L`, 'fees', 'medium')
  if ((p.topRecruiters || []).length) add(`Recruiters: ${p.topRecruiters.slice(0, 6).join(', ')}`, 'placements', 'medium')
  if (p.scholarships) add(String(p.scholarships).slice(0, 140), 'scholarships', 'medium')
  if ((p.programs || []).length) add(`Programs: ${p.programs.slice(0, 5).join(', ')}`, 'programs', 'low')
  ;(p.strengths || []).slice(0, 4).forEach(s => add(s, 'other', 'medium'))
  return kf
}

// Scraped (non-null) values win; the stored profile fills any gaps.
function mergeProfiles(base = {}, scraped = {}) {
  const out = { ...base }
  for (const [k, v] of Object.entries(scraped)) {
    if (v == null || v === '') continue
    if (Array.isArray(v)) { if (v.length) out[k] = v }
    else out[k] = v
  }
  return out
}

// Scrape OUR own site → merged profile + key features (falls back to static facts).
async function scrapeOurProfile() {
  if (SCRAPE) {
    // Start from the homepage (+ optional placements hint); the crawler discovers the rest.
    const info = await scraper.scrapeInstitution({ name: 'Aditya University', urls: [ADITYA_URL, ADITYA_PLACEMENTS_URL].filter(Boolean), sourceType: 'our_page' })
    const sources = info.sources.map(s => ({ ...s, name: 'Aditya University' }))
    if (info.ok) {
      const sourceUrl = (sources.find(s => s.ok) || {}).url || ADITYA_URL
      return { profile: mergeProfiles(ADITYA_PROFILE, info.profile), keyFeatures: info.keyFeatures, sources, sourceUrl, scraped: true }
    }
    return { profile: ADITYA_PROFILE, keyFeatures: profileToKeyFeatures(ADITYA_PROFILE, 'our_page', ADITYA_URL), sources, sourceUrl: ADITYA_URL, scraped: false }
  }
  return { profile: ADITYA_PROFILE, keyFeatures: profileToKeyFeatures(ADITYA_PROFILE, 'our_page', ADITYA_URL), sources: [], sourceUrl: ADITYA_URL, scraped: false }
}

// Scrape each rival's site → attach scrapedProfile + keyFeatures onto its evidence obj.
// Processed in small batches so per-institution LLM extraction doesn't burst the
// provider's tokens-per-minute limit (which would 429 the final reasoning call).
async function enrichCompetitors(rivals) {
  const allSources = []
  const enrichOne = async (e) => {
    const c = e.competitor
    const fallbackUrl = c.website || c.sourceUrl || ''
    if (!SCRAPE) {
      e.scrapedProfile = c.profile || {}
      e.keyFeatures = profileToKeyFeatures(c.profile, 'competitor_page', fallbackUrl)
      e.sourceUrl = fallbackUrl; e.scraped = false
      return
    }
    // Crawl from the homepage AND the stored sourceUrl (usually their placements/fees
    // page). JS-heavy sites often expose nothing useful from homepage nav links alone —
    // a direct content URL is the only way in for those.
    const info = await scraper.scrapeInstitution({ name: c.name, urls: [c.website, c.sourceUrl].filter(Boolean), sourceType: 'competitor_page' })
    info.sources.forEach(s => allSources.push({ ...s, name: c.name }))
    e.scrapedProfile = info.ok ? mergeProfiles(c.profile || {}, info.profile) : (c.profile || {})
    e.keyFeatures = info.ok && info.keyFeatures.length ? info.keyFeatures : profileToKeyFeatures(c.profile, 'competitor_page', fallbackUrl)
    e.sourceUrl = (info.sources.find(s => s.ok) || {}).url || fallbackUrl
    e.scraped = info.ok
  }
  const LIMIT = 2
  for (let i = 0; i < rivals.length; i += LIMIT) {
    await Promise.all(rivals.slice(i, i + LIMIT).map(enrichOne))
  }
  return allSources
}

// ── Change detection → signals (the core discipline of the CI prompt) ────────
// Diff each rival's FRESH scrape against its previous snapshot and emit one
// CompetitiveSignal per meaningful change. Report ONLY what changed or is new —
// unchanged fee tables / programs / claims never become signals. The first run
// records a baseline and stays silent. Scrapes read the competitor's OWN site,
// so confidence is "high" per the prompt's rule.
const KEY_PROGRAM_RE = /(cse|computer\s*science|artificial\s*intelligence|ai\s*&?\s*ml|machine\s*learning|data\s*science)/i

function today() { return new Date().toISOString().slice(0, 10) }

// ── Department tagging — every signal must be routed to the HOD who can act ──
// Keyword → department code (order matters: AIML/DS before the broader CSE match).
const DEPT_PATTERNS = [
  ['AIML',     /artificial\s*intelligence|ai\s*&?\s*ml|\baiml\b|machine\s*learning/i],
  ['DS',       /data\s*science|\bcse\s*\(?ds\)?\b/i],
  ['CSE',      /\bcse\b|computer\s*science|\bit\b|information\s*technology|software/i],
  ['ECE',      /\bece\b|electronics\s*(and|&)?\s*communication/i],
  ['EEE',      /\beee\b|electrical/i],
  ['MECH',     /\bmech(anical)?\b/i],
  ['CIVIL',    /\bcivil\b/i],
  ['AGRI',     /agricultur/i],
  ['MINING',   /\bmining\b/i],
  ['PETRO',    /petroleum|\bpetro\b/i],
  ['MBA',      /\bmba\b|business\s*administration|management\b/i],
  ['MCA',      /\bmca\b|computer\s*applications/i],
  ['PHARMACY', /pharm/i],
  ['SCIENCE',  /\bb\.?\s*sc\b|\bm\.?\s*sc\b|\bscience\s*degree/i],
]

// All departments a text affects (e.g. "B.Tech CSE and AIML fee waiver" → both).
// Empty result = unclassifiable → caller uses UNIVERSITY_WIDE.
function inferDepartments(text) {
  const t = String(text || '')
  const hits = DEPT_PATTERNS.filter(([, re]) => re.test(t)).map(([d]) => d)
  // AIML/DS keywords also match the broad CSE pattern via "computer science" — keep
  // CSE only when it matched on its own tokens, not as a side effect. Simplest
  // reliable rule: dedupe exact hits; the ordered patterns already ensure the
  // specific branches (AIML, DS) are captured before CSE.
  return [...new Set(hits)]
}

function diffSnapshot(c, oldP, newP, sourceUrl) {
  const signals = []
  const base = {
    competitor: c.name, tier: c.tier || 3, platform: 'website', language: 'english',
    source_url: sourceUrl || c.website || '', observed_date: today(), confidence: 'high',
  }
  // Emit the signal once per affected department (spec: each department's view must
  // be complete on its own). departments [] / omitted → single UNIVERSITY_WIDE record.
  const sig = (o, departments) => {
    const depts = departments && departments.length ? departments : ['UNIVERSITY_WIDE']
    for (const department of depts) signals.push({ ...base, department, ...o })
  }
  const numOr = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)

  // Fee changes — a reduction by a Tier 1/3 rival is an immediate alert.
  const oldFee = numOr(oldP.annualFeeLpa), newFee = numOr(newP.annualFeeLpa)
  if (newFee != null && oldFee != null && newFee !== oldFee) {
    const drop = newFee < oldFee
    sig({ signal_type: 'fee_change', sentiment: drop ? 'positive' : 'negative',
      summary: `${c.name} annual B.Tech fee ${drop ? 'reduced' : 'increased'} from ₹${oldFee}L to ₹${newFee}L.`,
      details: `Annual fee ₹${oldFee}L → ₹${newFee}L (their website).`,
      admissions_relevance: 5, requires_alert: drop && c.tier !== 2 })
  } else if (newFee != null && oldFee == null) {
    sig({ signal_type: 'fee_change', sentiment: 'neutral',
      summary: `${c.name} now publishes an annual fee of ₹${newFee}L.`,
      details: `Newly observed annual fee ₹${newFee}L.`, admissions_relevance: 4, requires_alert: false })
  }

  // Scholarship changes — new scholarship / rank-based waiver is an alert. Routed to
  // the branches the offer names (one record each); unnamed → UNIVERSITY_WIDE.
  const oldSch = String(oldP.scholarships || '').trim(), newSch = String(newP.scholarships || '').trim()
  if (newSch && newSch !== oldSch) {
    sig({ signal_type: 'scholarship', sentiment: 'positive',
      summary: `${c.name} ${oldSch ? 'changed its scholarship offer' : 'is advertising a scholarship'}.`,
      details: `Their site states (claims): "${newSch.slice(0, 90)}"${oldSch ? ` — previously: "${oldSch.slice(0, 60)}"` : ''}`,
      admissions_relevance: 4, requires_alert: c.tier !== 2 }, inferDepartments(newSch))
  }

  // Placement claims — a changed number contradicting earlier recorded data is an alert.
  for (const [field, label] of [['placementHighestLpa', 'highest package'], ['placementAvgLpa', 'average package']]) {
    const o = numOr(oldP[field]), n = numOr(newP[field])
    if (n != null && o != null && n !== o) {
      const contradicts = Math.abs(n - o) / o > 0.15
      sig({ signal_type: 'placement_claim', sentiment: n > o ? 'positive' : 'negative',
        summary: `${c.name} now claims a ${label} of ₹${n}L (previously recorded ₹${o}L).`,
        details: `${label} claim ₹${o}L → ₹${n}L. ${contradicts ? 'Contradicts earlier recorded data — verify before counters use it.' : ''}`.trim(),
        admissions_relevance: contradicts ? 4 : 3, requires_alert: contradicts })
    }
  }

  // New programs — ONE record per program routed to its department (spec: never lump
  // branches into one record). A CSE / AI & ML / Data Science hit alerts — that's
  // where the fight is fiercest.
  const oldProgs = new Set((oldP.programs || []).map(p => String(p).toLowerCase()))
  const added = (newP.programs || []).filter(p => p && !oldProgs.has(String(p).toLowerCase()))
  if (oldProgs.size) {
    for (const prog of added.slice(0, 6)) {
      const hot = KEY_PROGRAM_RE.test(String(prog))
      sig({ signal_type: 'new_program', sentiment: 'neutral',
        summary: `${c.name} lists a program not previously recorded: ${prog}.`,
        details: `New on their site: ${prog}.`,
        admissions_relevance: hot ? 5 : 3, requires_alert: hot }, inferDepartments(prog))
    }
  }

  // Accreditation / ranking changes — leadership context, not an immediate alert.
  const oldNaac = String(oldP.naac || '').trim(), newNaac = String(newP.naac || '').trim()
  if (newNaac && oldNaac && newNaac !== oldNaac) {
    sig({ signal_type: 'accreditation', sentiment: 'neutral',
      summary: `${c.name} NAAC grade recorded as ${newNaac} (was ${oldNaac}).`,
      details: `NAAC ${oldNaac} → ${newNaac}.`, admissions_relevance: 4, requires_alert: false })
  }
  const oldNirf = String(oldP.nirfRank || '').trim(), newNirf = String(newP.nirfRank || '').trim()
  if (newNirf && oldNirf && newNirf !== oldNirf) {
    sig({ signal_type: 'accreditation', sentiment: 'neutral',
      summary: `${c.name} NIRF position recorded as ${newNirf} (was ${oldNirf}).`,
      details: `NIRF ${oldNirf} → ${newNirf}.`, admissions_relevance: 3, requires_alert: false })
  }

  return signals
}

// Run change detection over the enriched rivals, persist the signals, and move
// each successfully-scraped rival's snapshot forward. Returns the saved signals.
async function detectSignals(orgId, rivals) {
  const out = []
  for (const e of rivals) {
    const c = e.competitor
    if (!e.scraped) continue                       // no fresh facts → keep old baseline
    const fresh = e.scrapedProfile || {}
    const old = c.lastSnapshot && c.lastSnapshot.profile
    if (old) out.push(...diffSnapshot(c, old, fresh, e.sourceUrl))
    // Baseline moves forward only on a successful scrape (first run = baseline, no signals).
    await Competitor.updateOne({ _id: c._id },
      { $set: { lastSnapshot: { profile: fresh, capturedAt: new Date() } } }).catch(() => {})
  }
  if (!out.length) return []
  try {
    return await CompetitiveSignal.insertMany(out.map(s => ({ ...s, orgId })))
  } catch (err) {
    console.warn('[competitive] failed to persist signals:', err.message)
    return out.map(s => ({ ...s, orgId }))          // still usable for the brief
  }
}

// ── 1. Evidence gathering ────────────────────────────────────────────────────
async function gatherEvidence(orgId, windowDays) {
  const since = new Date(Date.now() - windowDays * 86400000)
  const [competitors, calls] = await Promise.all([
    Competitor.find({ orgId, isActive: true }).lean(),
    Call.find({ orgId, createdAt: { $gte: since } })
      .select('transcript disposition leadId createdAt').lean(),
  ])

  // Which leads ended as "lost" (not interested / invalid), to detect "chosen over us".
  const lostLeadIds = new Set(
    (await Lead.find({ orgId, status: { $in: ['NotInterested', 'Invalid'] } }).select('_id').lean())
      .map(l => String(l._id)))

  const perCompetitor = new Map()
  for (const c of competitors) {
    perCompetitor.set(String(c._id), { competitor: c, mentions: 0, chosenOverUs: 0, excerpts: [] })
  }

  let transcriptsWithMentions = 0
  for (const call of calls) {
    const text = (call.transcript || []).map(t => t.text).join(' ')
    if (!text) continue
    const low = text.toLowerCase()
    let mentionedHere = false
    for (const c of competitors) {
      const names = [c.name, ...(c.aliases || [])].filter(Boolean)
      const hit = names.find(n => low.includes(n.toLowerCase()))
      if (!hit) continue
      mentionedHere = true
      const e = perCompetitor.get(String(c._id))
      e.mentions += 1
      const lost = call.disposition === 'not_interested' ||
                   (call.leadId && lostLeadIds.has(String(call.leadId)))
      if (lost) e.chosenOverUs += 1
      if (e.excerpts.length < 5) {
        const ex = excerptAround(text, hit)
        if (ex) e.excerpts.push({ callId: String(call._id), excerpt: ex })
      }
    }
    if (mentionedHere) transcriptsWithMentions += 1
  }

  return {
    competitorsEvidence: [...perCompetitor.values()],
    stats: {
      callsAnalyzed: calls.length,
      transcriptsWithMentions,
      totalMentions: [...perCompetitor.values()].reduce((s, e) => s + e.mentions, 0),
    },
  }
}

// ── 2b. Deterministic comparison (fallback when no LLM) ──────────────────────
function deterministicCompare(ev, aditya = ADITYA_PROFILE) {
  const c = ev.competitor
  const p = ev.scrapedProfile || c.profile || {}      // prefer live-scraped facts
  const better = [], weaker = []
  const src = (excerpt = '') => ({ type: 'competitor_page', ref: ev.sourceUrl || c.website || c.sourceUrl || c.name, excerpt })
  const ourHigh = num(aditya.placementHighestLpa), ourFee = num(aditya.annualFeeLpa)

  // Where THEY beat US (our gaps).
  if (num(p.placementHighestLpa) != null && ourHigh != null && p.placementHighestLpa > ourHigh)
    better.push({ point: `Higher peak placement (₹${p.placementHighestLpa}L vs our ₹${ourHigh}L)`, category: 'placements', source: src(), confidence: 'high' })
  if (num(p.annualFeeLpa) != null && ourFee != null && p.annualFeeLpa < ourFee)
    better.push({ point: `Lower annual fee (₹${p.annualFeeLpa}L vs our ₹${ourFee}L)`, category: 'fees', source: src(), confidence: 'medium' })
  if (p.nirfRank && /\b(1|2|3|4|5|6|7|8|9|[1-9]\d|1[0-4]\d)\b/.test(String(p.nirfRank)) && !/151|200/.test(String(p.nirfRank)))
    better.push({ point: `Stronger NIRF rank (${p.nirfRank})`, category: 'ranking', source: src(), confidence: 'medium' })
  ;(p.strengths || []).slice(0, 3).forEach(s =>
    better.push({ point: s, category: 'other', source: src(), confidence: 'medium' }))
  ev.excerpts.slice(0, 2).forEach(x =>
    better.push({ point: `Students cited them: "${x.excerpt}"`, category: 'brand', source: { type: 'call_transcript', ref: x.callId, excerpt: x.excerpt }, confidence: 'high' }))

  // Where WE beat THEM (our strengths / their weaknesses).
  ;(aditya.strengths || ADITYA_PROFILE.strengths).forEach(s =>
    weaker.push({ point: s, category: 'other', source: { type: 'our_page', ref: 'aditya_profile', excerpt: s }, confidence: 'high' }))
  if (!p.naac || !/A\+\+/.test(p.naac))
    weaker.push({ point: `We hold NAAC ${aditya.naac}; they ${p.naac ? `hold ${p.naac}` : 'lack an A++ grade'}`, category: 'ranking', source: src(), confidence: 'high' })
  ;(p.weaknesses || []).slice(0, 2).forEach(w =>
    weaker.push({ point: `Their gap: ${w}`, category: 'other', source: src(), confidence: 'medium' }))

  const threatScore = Math.min(100, ev.mentions * 12 + ev.chosenOverUs * 20 + better.length * 6)
  return {
    threatScore,
    summary: `${c.name} raised in ${ev.mentions} call(s), ${ev.chosenOverUs} lost to them. ${better.length} advantages over us, ${weaker.length} where we lead.`,
    betterThanUs: better, weakerThanUs: weaker,
  }
}

function deterministicRecommendations(competitors) {
  const recs = []
  const cats = {}
  competitors.forEach(c => c.betterThanUs.forEach(b => { cats[b.category] = (cats[b.category] || 0) + 1 }))
  const templates = {
    placements: { title: 'Close the placement-package gap', detail: 'Run a placement-boost drive: expand the top-recruiter pool, add interview-prep bootcamps, and publish verified highest/average packages prominently.', rationale: 'Rivals are winning students on peak package — a headline number and verified proof directly counters it.' },
    fees: { title: 'Sharpen fee & scholarship positioning', detail: 'Introduce clearer merit-scholarship slabs and a total-cost-of-attendance comparison so the effective fee beats cheaper rivals.', rationale: 'Cheaper rivals win on sticker price; effective-cost framing plus scholarships neutralises it.' },
    ranking: { title: 'Amplify accreditation & ranking story', detail: 'Lead every counselling call and page with NAAC A++ and NBA Tier-1; pursue NIRF band improvement initiatives.', rationale: 'Ranking is a top decision factor students cite; our A++ is a differentiator that is under-communicated.' },
    programs: { title: 'Promote industry-collaborated programs', detail: 'Feature the SAP / Google Cloud / Microsoft B.Tech tracks and Big-4 business tie-ups as flagship differentiators in calls and ads.', rationale: 'These are genuine strengths rivals lack — amplifying them widens our differentiation.' },
    brand: { title: 'Counter competitor brand pull with proof', detail: 'Arm counsellors with a one-pager of wins (recruiters, international collaborations, alumni outcomes) to rebut competitor mentions on calls.', rationale: 'Students name rivals by brand; concrete proof-points shift the perception on the call itself.' },
    facilities: { title: 'Showcase campus & facilities', detail: 'Feature the 250-acre smart campus, hostels and labs with a short video/gallery counsellors can share during calls.', rationale: 'Facilities sway on-the-fence students; visual proof neutralises rivals who lead on infrastructure perception.' },
    scholarships: { title: 'Sharpen fee & scholarship positioning', detail: 'Publish clear merit-scholarship slabs and an effective-cost comparison so our net fee beats rivals.', rationale: 'Scholarship clarity converts price-sensitive students who would otherwise pick a cheaper rival.' },
    other: { title: 'Match rival strengths counsellors hear', detail: 'Turn the specific advantages students cite about rivals into rebuttal talking-points and, where real, into roadmap items for the academic team.', rationale: 'Directly answering the exact strength a student raises about a rival is what shifts the decision on the call.' },
  }
  const seen = new Set()
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => {
    const t = templates[cat] || templates.other
    if (seen.has(t.title)) return           // avoid duplicate recommendations
    seen.add(t.title)
    recs.push({ priority: recs.length + 1, ...t, addressesCompetitors: [], confidence: 'medium',
      evidence: [{ point: `${n} competitor advantage(s) in '${cat}'`, category: cat, source: { type: 'analysis', ref: 'gap_tally' }, confidence: 'medium' }] })
  })
  return recs.slice(0, 6)
}

// ── Pros & cons per functional department ─────────────────────────────────────
// For each office (Admissions, Placement cell, …): where Aditya LEADS (pros) and
// where rivals beat us (cons), each point tied to a source. Rival numbers from
// their own sites are marked "claims" — they are not independently confirmed.
const FUNCTIONAL_AREAS = ['ADMISSIONS', 'PLACEMENTS', 'FEES_SCHOLARSHIPS',
  'INFRASTRUCTURE_HOSTEL', 'ACCREDITATION_RANKINGS']

function deterministicFunctionalAnalysis(withData, aditya = ADITYA_PROFILE) {
  const ourSrc = { type: 'our_page', ref: 'aditya_profile', excerpt: '' }
  const rivalSrc = (e) => ({ type: 'competitor_page', ref: e.sourceUrl || e.competitor.website || e.competitor.name, excerpt: '' })
  const P = (point, category, source, confidence = 'medium') => ({ point, category, source, confidence })
  const rivals = withData.map(e => ({ e, p: e.scrapedProfile || e.competitor.profile || {} }))
  const n = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
  const ourHigh = n(aditya.placementHighestLpa), ourAvg = n(aditya.placementAvgLpa), ourFee = n(aditya.annualFeeLpa)

  const admissions = { area: 'ADMISSIONS', pros: [], cons: [] }
  if (aditya.scholarships) admissions.pros.push(P(`Our offer: ${aditya.scholarships}`, 'scholarships', ourSrc, 'high'))
  admissions.pros.push(P('Multiple entry channels: EAPCET counselling, management/spot quota, ECET lateral entry, and our own ASAT exam', 'programs', ourSrc, 'high'))
  rivals.forEach(({ e, p }) => {
    if (p.scholarships) admissions.cons.push(P(`${e.competitor.name} claims: ${String(p.scholarships).slice(0, 100)}`, 'scholarships', rivalSrc(e)))
  })

  const placements = { area: 'PLACEMENTS', pros: [], cons: [] }
  if (ourHigh != null) placements.pros.push(P(`Our verified packages: highest ₹${ourHigh}L, average ₹${ourAvg ?? '—'}L`, 'placements', ourSrc, 'high'))
  if ((aditya.topRecruiters || []).length) placements.pros.push(P(`Recruiters include ${aditya.topRecruiters.slice(0, 5).join(', ')}`, 'placements', ourSrc, 'high'))
  rivals.forEach(({ e, p }) => {
    if (n(p.placementHighestLpa) != null && ourHigh != null && p.placementHighestLpa > ourHigh)
      placements.cons.push(P(`${e.competitor.name} claims a higher peak package (₹${p.placementHighestLpa}L vs our ₹${ourHigh}L)`, 'placements', rivalSrc(e)))
    if (n(p.placementAvgLpa) != null && ourAvg != null && p.placementAvgLpa > ourAvg)
      placements.cons.push(P(`${e.competitor.name} claims a higher average package (₹${p.placementAvgLpa}L vs our ₹${ourAvg}L)`, 'placements', rivalSrc(e)))
  })

  const fees = { area: 'FEES_SCHOLARSHIPS', pros: [], cons: [] }
  rivals.forEach(({ e, p }) => {
    const f = n(p.annualFeeLpa)
    if (f == null || ourFee == null) return
    if (f > ourFee) fees.pros.push(P(`More affordable than ${e.competitor.name} (our ₹${ourFee}L vs their ₹${f}L annual fee)`, 'fees', rivalSrc(e)))
    else if (f < ourFee) fees.cons.push(P(`${e.competitor.name} is cheaper (₹${f}L vs our ₹${ourFee}L annual fee)`, 'fees', rivalSrc(e)))
  })

  const infra = { area: 'INFRASTRUCTURE_HOSTEL', pros: [], cons: [] }
  if (aditya.hostel) infra.pros.push(P(aditya.hostel, 'facilities', ourSrc, 'high'))
  ;(aditya.strengths || []).filter(s => /campus|hostel|labs?|laborator|infrastruct/i.test(s))
    .forEach(s => infra.pros.push(P(s, 'facilities', ourSrc, 'high')))
  rivals.forEach(({ e, p }) => {
    ;(p.strengths || []).filter(s => /campus|hostel|labs?|laborator|infrastruct/i.test(String(s))).slice(0, 1)
      .forEach(s => infra.cons.push(P(`${e.competitor.name}: ${String(s).slice(0, 90)}`, 'facilities', rivalSrc(e), 'low')))
  })

  const accr = { area: 'ACCREDITATION_RANKINGS', pros: [], cons: [] }
  if (aditya.naac) accr.pros.push(P(`NAAC ${aditya.naac}`, 'ranking', ourSrc, 'high'))
  if (aditya.nirf) accr.pros.push(P(String(aditya.nirf), 'ranking', ourSrc, 'medium'))
  rivals.forEach(({ e, p }) => {
    const r = parseInt((String(p.nirfRank || '').match(/\d+/) || [])[0], 10)
    if (Number.isFinite(r) && r < 151) accr.cons.push(P(`${e.competitor.name} holds a stronger NIRF position (${p.nirfRank})`, 'ranking', rivalSrc(e)))
    if (p.naac && /A\+\+/.test(String(p.naac))) accr.cons.push(P(`${e.competitor.name} also holds NAAC A++ — our grade is not a differentiator against them`, 'ranking', rivalSrc(e)))
  })

  return [admissions, placements, fees, infra, accr]
}

// Playbook without an LLM: built strictly from stored/scraped facts, claims marked.
function deterministicPlaybook(e, aditya = ADITYA_PROFILE) {
  const c = e.competitor
  const p = e.scrapedProfile || c.profile || {}
  const pitch = []
  if (p.placementHighestLpa != null) pitch.push(`claims highest package ₹${p.placementHighestLpa}L`)
  if (p.annualFeeLpa != null) pitch.push(`annual fee ₹${p.annualFeeLpa}L`)
  if (p.scholarships) pitch.push(String(p.scholarships).slice(0, 80))
  const facts = []
  if (p.naac) facts.push(`NAAC ${p.naac} (their site)`)
  if (p.placementAvgLpa != null) facts.push(`Average package claimed: ₹${p.placementAvgLpa}L — confirm whether internships are counted`)
  const counter = `Acknowledge their strengths, then ground ours: NAAC ${aditya.naac.split(' ')[0]}, ` +
    'university status (own degrees and curriculum flexibility vs affiliated colleges), ' +
    'SAP/Google Cloud/Microsoft industry tracks, and our verified placement record. Quote only tool-verified figures.'
  const concede = c.tier === 2
    ? 'A top-EAPCET-rank student who secures a government-quota JNTUK seat — respect the choice, stay helpful for siblings/referrals.'
    : 'If the family is relocating near their campus or the student won a full waiver we cannot match, be honest about fit.'
  return { currentPitch: pitch.join('; '), verifiedFacts: facts, honestCounter: counter, whenToConcede: concede }
}

// ── Two-level reporting (spec: "Weekly reporting — two levels") ───────────────
// Level 1: master brief for admissions leadership — top 3 moves, department
// heatmap (🔴 under attack / 🟡 watch / 🟢 quiet), marketing pressure,
// university-wide sentiment. <500 words.
// Level 2: one scorecard per department that had signals this run, for that HOD
// + the admissions head. <400 words each. Quiet departments get a one-line note
// via the heatmap, not an empty report.
const HEATMAP_DEPARTMENTS = ['CSE', 'AIML', 'DS', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AGRI',
  'MINING', 'PETRO', 'MBA', 'MCA', 'PHARMACY', 'SCIENCE']

// Department pressure from THIS run's signals: red = an alert hit the department,
// yellow = non-alert signals only, green = quiet. (UNIVERSITY_WIDE signals are
// leadership-level and reported in the master brief's sections 1 and 4 instead.)
function computeHeatmap(signals) {
  return HEATMAP_DEPARTMENTS.map(department => {
    const ds = signals.filter(s => s.department === department)
    return { department, status: ds.some(s => s.requires_alert) ? 'red' : ds.length ? 'yellow' : 'green' }
  })
}

const HEAT_ICON = { red: '🔴 under attack', yellow: '🟡 watch', green: '🟢 quiet' }

function heatmapLines(heatmap) {
  return heatmap.map(h => `- ${h.department}: ${HEAT_ICON[h.status]}`).join('\n')
}

function deterministicMaster({ signals, heatmap, mini }) {
  const lines = []
  lines.push('## 1. Top 3 moves this week')
  if (!signals.length) lines.push('Quiet week — no significant competitor changes detected.')
  else signals.slice().sort((a, b) => (b.admissions_relevance - a.admissions_relevance)).slice(0, 3)
    .forEach(s => lines.push(`- [${s.department}] ${s.summary} → Review and brief counselors.`))
  lines.push('', '## 2. Department heatmap', heatmapLines(heatmap))
  if (!mini) {
    lines.push('', '## 3. Marketing pressure')
    lines.push('No ad-library source connected — ad spend signals unavailable this run.')
    lines.push('', '## 4. University-wide sentiment')
    const uw = signals.filter(s => s.department === 'UNIVERSITY_WIDE')
    lines.push(uw.length ? uw.map(s => `- ${s.summary}`).join('\n')
      : 'No institution-level shifts detected this run.')
  }
  const alerts = signals.filter(s => s.requires_alert)
  if (alerts.length) lines.push('', `**${alerts.length} alert(s) require attention.**`)
  return lines.join('\n')
}

function deterministicScorecard(department, deptSignals, competitors) {
  const lines = [`# ${department} — competitive scorecard`]
  lines.push('', '## 1. What competitors did in your space this week')
  deptSignals.forEach(s => lines.push(`- ${s.summary} (${s.source_url || 'stored profile'})`))
  lines.push('', '## 2. Where we stand')
  const rivals = [...new Set(deptSignals.map(s => s.competitor))]
  competitors.filter(c => rivals.includes(c.name)).forEach(c => {
    const facts = (c.keyFeatures || []).slice(0, 3).map(k => k.point).join(' · ')
    lines.push(`- ${c.name} (T${c.tier}): ${facts || 'no scraped facts this run'}`)
  })
  lines.push('(No EAPCET-cutoff or portal-rating feed connected — comparison limited to scraped fees/placements.)')
  lines.push('', '## 3. Where we lag')
  lines.push('Insufficient verified per-department data this run to state gaps — see signals above.')
  lines.push('', '## 4. What students/parents are saying')
  lines.push('No department-specific sentiment sources connected this run.')
  lines.push('', '## 5. Suggested fixes')
  lines.push(`- [MARKETING] Answer the moves above in counselling scripts and ads for ${department}.`)
  return lines.join('\n')
}

async function composeReports({ ourProfile, competitors, recommendations, signals, stats, mini }) {
  const heatmap = computeHeatmap(signals)
  // Scorecards only for departments with ≥1 new signal; mini-brief (Thursday,
  // counselling season) narrows further to 🔴 departments.
  const activeDepts = heatmap.filter(h => (mini ? h.status === 'red' : h.status !== 'green'))
    .map(h => h.department)
  const deptSignals = (d) => signals.filter(s => s.department === d)

  if (!hasLlm()) {
    return {
      masterBrief: deterministicMaster({ signals, heatmap, mini }),
      heatmap,
      scorecards: activeDepts.map(d => ({ department: d, content: deterministicScorecard(d, deptSignals(d), competitors) })),
    }
  }

  const system = `${CI_IDENTITY} You are writing the ${mini ? 'counselling-season Thursday MINI-brief (master sections 1–2 plus scorecards for red departments only)' : 'Monday 9:00 AM two-level report'}: a master brief for admissions leadership and one scorecard per active department for its HOD. ${CI_HARD_RULES}`
  const user = JSON.stringify({
    signalsThisRun: signals.map(s => ({ competitor: s.competitor, tier: s.tier, department: s.department, type: s.signal_type, summary: s.summary, details: s.details, alert: s.requires_alert, source: s.source_url })),
    departmentHeatmap: heatmap,
    activeDepartments: activeDepts,
    competitors: competitors.map(c => ({ name: c.name, tier: c.tier, threatScore: c.threatScore, mentions: c.mentions, lostToThem: c.chosenOverUs, keyFacts: (c.keyFeatures || []).slice(0, 6).map(k => k.point), summary: c.summary })),
    ourKeyFacts: { fees: ourProfile.annualFeeLpa, naac: ourProfile.naac, placementHighest: ourProfile.placementHighestLpa, placementAvg: ourProfile.placementAvgLpa, scholarships: ourProfile.scholarships },
    topRecommendations: recommendations.slice(0, 3).map(r => r.title),
    callStats: stats,
    dataLimitations: 'Sources this run: competitor websites + our call transcripts ONLY. No Meta Ad Library, review portals, forums, or EAPCET cutoff feed connected — state that plainly in affected sections; NEVER invent such data.',
    format: {
      master: mini
        ? 'Markdown, sections: "## 1. Top 3 moves this week" (one-line recommended response each) and "## 2. Department heatmap" (one line per department: 🔴 under attack / 🟡 watch / 🟢 quiet — use departmentHeatmap as given). Under 250 words.'
        : 'Markdown, exactly: "## 1. Top 3 moves this week" (one-line recommended response each); "## 2. Department heatmap" (one line per department with 🔴/🟡/🟢 — use departmentHeatmap as given); "## 3. Marketing pressure"; "## 4. University-wide sentiment" (Aditya trend + institution-level competitor shifts). Under 500 words, phone-readable. "Quiet week — no significant changes" is a valid section.',
      scorecards: 'One per department in activeDepartments (never any other), markdown, exactly these sections: "## 1. What competitors did in your space this week" (dept-tagged signals with source); "## 2. Where we stand" (comparison for THIS department only, from given facts); "## 3. Where we lag" (1–3 blunt, evidence-backed gaps — only if supported by the given data, never invented); "## 4. What students/parents are saying" (only from given data, else one honest line); "## 5. Suggested fixes" (1–3, each tagged [MARKETING] days / [OFFER] management / [SUBSTANCE] semesters). Under 400 words each.',
    },
    returnShape: { master: 'string', scorecards: [{ department: 'CSE', content: 'string' }] },
  })
  const out = await completeJson({ system, user, maxTokens: 3000 })
  const masterBrief = out && typeof out.master === 'string' && out.master.trim()
    ? out.master.trim()
    : deterministicMaster({ signals, heatmap, mini })
  const seen = new Set()
  const scorecards = (out && Array.isArray(out.scorecards) ? out.scorecards : [])
    .filter(s => s && activeDepts.includes(s.department) && typeof s.content === 'string' && s.content.trim() && !seen.has(s.department) && seen.add(s.department))
    .map(s => ({ department: s.department, content: s.content.trim().slice(0, 4000) }))
  // Any active department the LLM skipped still gets its deterministic scorecard.
  for (const d of activeDepts) {
    if (!seen.has(d)) scorecards.push({ department: d, content: deterministicScorecard(d, deptSignals(d), competitors) })
  }
  return { masterBrief, heatmap, scorecards }
}

// ── Normalisers — coerce (possibly messy) LLM JSON into the report schema ────
const CONF = new Set(['high', 'medium', 'low'])
const asConf = (v) => (CONF.has(v) ? v : 'medium')
const asNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const clip = (v, n = 500) => String(v ?? '').slice(0, n)
const arr = (v) => (Array.isArray(v) ? v : [])

function normPoint(p = {}) {
  const s = p.source || {}
  return {
    point: clip(p.point) || 'Unspecified',
    category: clip(p.category || 'other', 40),
    source: { type: clip(s.type || 'analysis', 40), ref: clip(s.ref, 200), excerpt: clip(s.excerpt) },
    confidence: asConf(p.confidence),
  }
}

// Counter-offer playbook entry (see the CI prompt): what they pitch, what we can
// prove, the honest counselor counter, and when to concede on fit.
function normPlaybook(p = {}) {
  return {
    currentPitch: clip(p.currentPitch, 500),
    verifiedFacts: arr(p.verifiedFacts).map(x => clip(x, 250)).slice(0, 8),
    honestCounter: clip(p.honestCounter, 900),
    whenToConcede: clip(p.whenToConcede, 500),
  }
}

function normArea(a = {}) {
  const area = FUNCTIONAL_AREAS.includes(a.area) ? a.area : 'ADMISSIONS'
  return { area, pros: arr(a.pros).map(normPoint).slice(0, 8), cons: arr(a.cons).map(normPoint).slice(0, 8) }
}

function normCompetitor(c = {}) {
  return {
    competitorId: c.competitorId || null,
    name: clip(c.name || 'Unknown', 120),
    tier: [1, 2, 3].includes(c.tier) ? c.tier : 3,
    threatScore: Math.max(0, Math.min(100, Math.round(asNum(c.threatScore)))),
    mentions: asNum(c.mentions),
    chosenOverUs: asNum(c.chosenOverUs),
    keyFeatures: arr(c.keyFeatures).map(normPoint),
    sourceUrl: clip(c.sourceUrl, 300),
    scraped: !!c.scraped,
    betterThanUs: arr(c.betterThanUs).map(normPoint),
    weakerThanUs: arr(c.weakerThanUs).map(normPoint),
    summary: clip(c.summary, 600),
    playbook: normPlaybook(c.playbook),
  }
}

function normRec(r = {}, i = 0) {
  let priority = asNum(r.priority, 0)
  if (!priority || priority < 1) priority = ({ high: 1, medium: 2, low: 3 })[r.priority] || i + 1
  return {
    priority: Math.round(priority),
    title: clip(r.title || 'Improvement', 300),
    detail: clip(r.detail, 1500),
    rationale: clip(r.rationale, 1500),
    addressesCompetitors: arr(r.addressesCompetitors).map(x => clip(x, 120)),
    evidence: arr(r.evidence).map(normPoint),
    confidence: asConf(r.confidence),
  }
}

// ── 2. Reasoning (LLM if available, else deterministic) ──────────────────────
async function reason(competitorsEvidence, aditya = ADITYA_PROFILE, ourKeyFeatures = []) {
  const withData = competitorsEvidence.filter(e => e.competitor)
  let usedLlm = false

  if (hasLlm() && withData.length) {
    const system = `${CI_IDENTITY} Compare each rival to Aditya using ONLY the facts and evidence given (much of it freshly scraped from the institutions' own websites). Every point MUST tie to a source. ${CI_HARD_RULES}`
    const user = JSON.stringify({
      aditya: { profile: aditya, keyFeatures: ourKeyFeatures.map(k => k.point) },
      rivals: withData.map(e => ({
        name: e.competitor.name,
        tier: e.competitor.tier || 3,
        profile: e.scrapedProfile || e.competitor.profile,
        scrapedKeyFeatures: (e.keyFeatures || []).map(k => k.point),
        fromLiveScrape: !!e.scraped, sourceUrl: e.sourceUrl,
        studentMentions: e.mentions, lostToThem: e.chosenOverUs,
        transcriptExcerpts: e.excerpts.map(x => x.excerpt),
      })),
      instructions: 'Base every comparison on the scraped key features / profiles. For each rival return {name, threatScore (0-100 by how often students choose/mention them and how far ahead), summary, betterThanUs:[{point,category,source:{type,ref,excerpt},confidence}], weakerThanUs:[{...}], playbook:{currentPitch, verifiedFacts:[strings], honestCounter, whenToConcede}}. ALSO return top-level functionalAnalysis: one entry per area in [ADMISSIONS, PLACEMENTS, FEES_SCHOLARSHIPS, INFRASTRUCTURE_HOSTEL, ACCREDITATION_RANKINGS] as {area, pros:[point objects — where Aditya LEADS in that office\'s domain, from the given facts], cons:[point objects — where rivals beat us, blunt and evidence-tied, rival numbers marked "claims"]}. Pros/cons must come ONLY from the given data — never invented; 2-6 points each side where the data supports it. Playbook rules: currentPitch = what they actually offer right now per their scraped facts (mark unverified numbers with "claims"); verifiedFacts = ONLY facts provable from their own official pages, including any gap between claims and reality; honestCounter = how a counselor responds when a family cites this rival — ground it in Aditya\'s verifiable strengths (NAAC A++, university status with own degrees vs JNTUK-affiliated colleges, SAP/Google/Microsoft tracks, placement record, campus), factual and respectful, it must survive the family independently fact-checking it; whenToConcede = the specific student profile for whom this rival is genuinely the better choice (e.g. a top-500 EAPCET ranker choosing JNTUK) — honesty here wins sibling admissions and referrals. Set source.type to "competitor_page" (use the rival sourceUrl as ref) for scraped facts, "call_transcript" for student quotes, "our_page" for our own facts. category ∈ placements|fees|scholarships|ranking|programs|facilities|brand|other. confidence ∈ high|medium|low. Then top-level recommendations:[{priority,title,detail,rationale,addressesCompetitors,confidence,evidence:[point objects]}] — prioritized, evidence-backed improvements that close gaps where rivals beat us and amplify where we beat them. Return {competitors:[...], recommendations:[...]}.',
    })
    const out = await completeJson({ system, user, maxTokens: 4000 })
    if (out && Array.isArray(out.competitors)) {
      usedLlm = true
      // Merge back the facts the LLM must not invent (counts, key features, source).
      const byName = new Map(withData.map(e => [e.competitor.name.toLowerCase(), e]))
      out.competitors.forEach(c => {
        const e = byName.get((c.name || '').toLowerCase())
        c.mentions = e?.mentions || 0
        c.chosenOverUs = e?.chosenOverUs || 0
        c.competitorId = e?.competitor?._id || null
        c.tier = e?.competitor?.tier || 3
        c.keyFeatures = e?.keyFeatures || []
        c.sourceUrl = e?.sourceUrl || ''
        c.scraped = !!e?.scraped
      })
      // Pros/cons per functional office — LLM's version when present, else deterministic.
      const functionalAnalysis = Array.isArray(out.functionalAnalysis) && out.functionalAnalysis.length
        ? out.functionalAnalysis.map(normArea)
        : deterministicFunctionalAnalysis(withData, aditya).map(normArea)
      return {
        competitors: out.competitors.map(normCompetitor),
        recommendations: (out.recommendations || []).map(normRec),
        functionalAnalysis,
        usedLlm,
      }
    }
  }

  // Deterministic fallback.
  const competitors = withData.map(e => {
    const r = deterministicCompare(e, aditya)
    return normCompetitor({ competitorId: e.competitor._id, name: e.competitor.name, tier: e.competitor.tier,
      mentions: e.mentions, chosenOverUs: e.chosenOverUs, keyFeatures: e.keyFeatures, sourceUrl: e.sourceUrl,
      scraped: e.scraped, playbook: deterministicPlaybook(e, aditya), ...r })
  })
  return {
    competitors,
    recommendations: deterministicRecommendations(competitors),
    functionalAnalysis: deterministicFunctionalAnalysis(withData, aditya).map(normArea),
    usedLlm,
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────
async function generateReport({ orgId, windowDays = 90, trigger = 'manual', generatedBy = null, briefType = 'weekly' }) {
  const { competitorsEvidence, stats } = await gatherEvidence(orgId, windowDays)
  const rivals = competitorsEvidence.filter(e => e.competitor)

  // Scrape OUR site and every rival's site (in parallel) to pull live key features.
  const [our, rivalSources] = await Promise.all([scrapeOurProfile(), enrichCompetitors(rivals)])
  const sources = [...our.sources, ...rivalSources]

  // Change detection: diff fresh scrapes vs each rival's last snapshot → signals.
  // (First run per rival just records the baseline and emits nothing.)
  const signals = await detectSignals(orgId, rivals)

  const { competitors, recommendations, functionalAnalysis, usedLlm } = await reason(competitorsEvidence, our.profile, our.keyFeatures)

  // Keep only rivals that actually perform better somewhere, ranked by threat.
  competitors.sort((a, b) => (b.threatScore || 0) - (a.threatScore || 0))

  // Persist each rival's refreshed counter-offer playbook onto its Competitor doc,
  // so counselors always read the latest entry (not just the latest report).
  for (const c of competitors) {
    if (!c.competitorId || !c.playbook) continue
    const hasContent = c.playbook.currentPitch || c.playbook.honestCounter
    if (!hasContent) continue
    await Competitor.updateOne({ _id: c.competitorId },
      { $set: { playbook: { ...c.playbook, updatedAt: new Date() } } }).catch(() => {})
  }

  // Two-level reporting: Level-1 master brief (leadership) + Level-2 department
  // scorecards (each HOD + admissions head). Mini = Thursday counselling-season
  // brief: master sections 1–2 + scorecards for 🔴 departments only.
  const { masterBrief, heatmap, scorecards } = await composeReports({
    ourProfile: our.profile, competitors, recommendations, signals, stats,
    mini: briefType === 'mini',
  })

  const alertCount = signals.filter(s => s.requires_alert).length
  const scrapedCount = sources.filter(s => s.ok).length
  const topThreat = competitors[0]
  const summary = competitors.length
    ? `${competitors.length} rival(s) analysed from ${stats.callsAnalyzed} calls and ${scrapedCount} live web page(s). ` +
      `${signals.length} change signal(s) detected${alertCount ? ` (${alertCount} alert${alertCount > 1 ? 's' : ''})` : ''}. ` +
      `Top threat: ${topThreat.name} (score ${topThreat.threatScore}). ${recommendations.length} prioritized improvements.`
    : `No competitors configured yet — add rivals to compare. Analysed ${stats.callsAnalyzed} calls.`

  const report = await CompetitiveReport.create({
    orgId, trigger, generatedBy, usedLlm, windowDays,
    evidenceStats: stats, summary, competitors, recommendations,
    briefType, weeklyBrief: masterBrief, heatmap, departmentScorecards: scorecards,
    functionalAnalysis,
    signalStats: { total: signals.length, alerts: alertCount },
    scrapeEnabled: SCRAPE,
    ourKeyFeatures: our.keyFeatures.map(normPoint),
    ourSourceUrl: our.sourceUrl,
    sources,
    status: 'draft',
  })

  // Link this run's signals to the report for traceability.
  const signalIds = signals.map(s => s._id).filter(Boolean)
  if (signalIds.length) {
    await CompetitiveSignal.updateMany({ _id: { $in: signalIds } }, { $set: { reportId: report._id } }).catch(() => {})
  }
  return report
}

module.exports = { generateReport, gatherEvidence, scrapeOurProfile, detectSignals, diffSnapshot, composeReports, deterministicFunctionalAnalysis, ADITYA_PROFILE }
