// ---------------------------------------------------------------------------
// Lightweight web scraper for the competitive agent.
//   fetch → strip HTML to text → extract the institution's KEY FEATURES
//           (LLM extraction over the cleaned text when a key is configured,
//            deterministic regex otherwise).
// University sites vary wildly (many are JS SPAs that return almost no HTML),
// so every step is best-effort: a failed/empty scrape returns ok:false and the
// caller falls back to the stored profile. Nothing here ever throws.
// ---------------------------------------------------------------------------
const { completeJson, hasLlm } = require('./llm')

// A real browser UA — many college sites' WAFs return 403 to obvious bot agents.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const cache = new Map()          // url → raw fetch result (dedupe within a run)
const MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES || 6)   // pages crawled per institution
// Per-page timeout. 25s, not 12: real pages in this catchment are slow AND heavy —
// e.g. srmap.edu.in/admission/ is ~2.8MB and takes ~13s on a clean fetch, so it
// always missed a 12s cutoff. Override with SCRAPE_TIMEOUT_MS.
const FETCH_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS || 25000)
// Subpages fetched at once per institution. Kept low on purpose: the agent already
// scrapes 2 institutions in parallel, and a dozen concurrent multi-MB downloads on a
// thin uplink starve each other into timeouts. Override with SCRAPE_FETCH_CONCURRENCY.
const FETCH_CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_FETCH_CONCURRENCY || 2))

function normalizeUrl(u) {
  if (!u) return ''
  u = String(u).trim()
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '')
  return u
}

// Strip tags/scripts/comments and decode the common entities → plain text.
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/--&gt;|--\>|&lt;!--/g, ' ')      // leftover comment fragments
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#0?39;|&apos;|&rsquo;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/₹|&#8377;|&#x20b9;/gi, '₹')
    .replace(/\s+/g, ' ')
    .trim()
}

const TRANSIENT = new Set([429, 500, 502, 503, 504])   // worth one retry; 403/404 are not

async function doFetch(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-IN,en;q=0.9' } })
    const ct = res.headers.get('content-type') || ''
    const isBinary = /(image\/|\/pdf|zip|octet-stream|\/json|javascript|text\/css|video\/|audio\/|font\/)/i.test(ct)
    if (!res.ok || isBinary) return { ok: false, url, finalUrl: res.url || url, status: res.status, html: '' }
    return { ok: true, url, finalUrl: res.url || url, status: res.status, html: (await res.text()).slice(0, 500000) }
  } catch (e) {
    return { ok: false, url, finalUrl: url, error: e.name === 'AbortError' ? 'timeout' : e.message, html: '' }
  } finally { clearTimeout(timer) }
}

// Fetch one page → raw HTML (kept for link discovery). Retries once on a
// transient failure: 429/5xx, timeout, or ANY network error ("fetch failed" =
// a connection reset, which a single retry usually survives). WAF 403s and
// 404s are real answers and fall through without a retry.
async function fetchOne(url, timeoutMs = FETCH_TIMEOUT_MS) {
  if (cache.has(url)) return cache.get(url)
  let out = await doFetch(url, timeoutMs)
  if (!out.ok && (TRANSIENT.has(out.status) || out.error)) {
    await new Promise(r => setTimeout(r, 1500))
    out = await doFetch(url, timeoutMs)
  }
  cache.set(url, out)
  return out
}

// Pull same-site links + their anchor text out of raw HTML.
function extractLinks(html, baseUrl) {
  const out = []
  let base
  try { base = new URL(baseUrl) } catch { return out }
  const host = base.hostname.replace(/^www\./, '')
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html)) && out.length < 600) {
    let href = m[1].trim()
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue
    let abs
    try { abs = new URL(href, base) } catch { continue }
    if (abs.hostname.replace(/^www\./, '') !== host) continue     // same site only
    abs.hash = ''
    out.push({ url: abs.toString(), anchor: htmlToText(m[2]).slice(0, 80) })
  }
  return out
}

// Rank discovered links by how likely they carry decision-relevant facts.
const LINK_KEYWORDS = [['training-and-placement', 6], ['placement', 5], ['recruit', 5], ['career', 4],
  ['nirf', 4], ['naac', 4], ['accredit', 4], ['ranking', 4], ['about', 3], ['admission', 3],
  ['fee', 3], ['scholarship', 3], ['why-', 2], ['academic', 2], ['program', 2], ['course', 2],
  ['campus', 2], ['infrastructure', 2], ['facilit', 2]]
function scoreLink({ url, anchor }) {
  const hay = (url + ' ' + anchor).toLowerCase()
  let s = 0
  for (const [kw, w] of LINK_KEYWORDS) if (hay.includes(kw)) s += w
  if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4)(\?|$)/i.test(url)) s -= 20
  if (/(news|event|blog|gallery|login|privacy|terms|sitemap|contact|alumni-login)/i.test(hay)) s -= 3
  // Governance/staff pages carry zero admissions facts but match generic positives
  // ("about", "academic") — they were crowding real fee/placement pages out of the
  // crawl budget (e.g. SRM's chancellor + academic-council-members pages).
  if (/(chancellor|council|committee|governance|governing|senate|tender|rti|grievance|iqac|member|statute|leadership|advisor|registrar|dean)/i.test(hay)) s -= 6
  return s
}
function pickRelevantLinks(links, max) {
  const seen = new Set(), picked = []
  links.map(l => ({ ...l, score: scoreLink(l) })).filter(l => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach(l => { if (picked.length < max && !seen.has(l.url)) { seen.add(l.url); picked.push(l.url) } })
  return picked
}

// Crawl an institution's site: fetch the start page(s), discover the most
// relevant internal pages, fetch those too, and combine all the text.
async function scrapeSite(startUrls, maxPages = MAX_PAGES) {
  const starts = [...new Set(startUrls.map(normalizeUrl).filter(Boolean))]
  const sources = [], texts = [], seen = new Set()
  let candidates = []

  for (const u of starts) {
    if (seen.has(u)) continue
    seen.add(u)
    const r = await fetchOne(u)
    sources.push({ url: u, ok: r.ok, status: r.status, error: r.error })
    if (r.ok && r.html) { texts.push(htmlToText(r.html)); candidates.push(...extractLinks(r.html, r.finalUrl)) }
  }

  // Fetch discovered subpages in SMALL batches, not all at once — parallel multi-MB
  // downloads on a shared uplink slow each other past the timeout (SRM's 5 subpages
  // all "timing out" was exactly this).
  const picks = pickRelevantLinks(candidates, Math.max(0, maxPages - sources.length))
    .filter(u => !seen.has(u))
  for (let i = 0; i < picks.length; i += FETCH_CONCURRENCY) {
    const batch = picks.slice(i, i + FETCH_CONCURRENCY)
    const fetched = await Promise.all(batch.map(async (u) => {
      seen.add(u)
      return { u, r: await fetchOne(u) }
    }))
    fetched.forEach(({ u, r }) => {
      sources.push({ url: u, ok: r.ok, status: r.status, error: r.error })
      if (r.ok && r.html) texts.push(htmlToText(r.html))
    })
  }

  const text = texts.join('\n\n').replace(/\s+/g, ' ').slice(0, 20000)
  return { text, sources }
}

const COMPANIES = ['Amazon', 'Microsoft', 'Google', 'Deloitte', 'TCS', 'Infosys', 'Wipro', 'Cognizant', 'Accenture', 'Capgemini', 'IBM', 'Oracle', 'SAP', 'Bosch', 'PayPal', 'Walmart', 'HCL', 'Tech Mahindra', 'PwC', 'EY', 'KPMG', 'Cisco', 'Adobe', 'Qualcomm', 'Samsung', 'Nvidia', 'Salesforce', 'ZScaler', 'Cognifyx']
const PROGRAMS = ['B.Tech', 'M.Tech', 'MBA', 'MCA', 'B.Pharm', 'Pharm.D', 'BBA', 'B.Sc', 'M.Sc', 'B.Com', 'Ph.D', 'B.Arch', 'Law', 'BCA']

function snippet(text, idx, span = 90) {
  const s = Math.max(0, idx - span), e = Math.min(text.length, idx + span)
  return (s > 0 ? '…' : '') + text.slice(s, e).trim() + (e < text.length ? '…' : '')
}
const kfPoint = (point, category, url, sourceType, confidence, excerpt = '') =>
  ({ point, category, source: { type: sourceType, ref: url, excerpt }, confidence })

// Deterministic best-effort feature extraction (fallback when no LLM).
function extractDeterministic(text, url, sourceType) {
  const profile = {}, keyFeatures = []
  const T = text

  const naac = T.match(/NAAC[^.]{0,60}?\b(A\s?\+\s?\+|A\s?\+|A|B\s?\+\s?\+|B\s?\+)\b/i)
  if (naac) { profile.naac = naac[1].replace(/\s+/g, ''); keyFeatures.push(kfPoint(`NAAC ${profile.naac} accredited`, 'ranking', url, sourceType, 'medium', snippet(T, naac.index))) }

  const nirf = T.match(/NIRF[^.]{0,80}?\b(?:rank(?:ed)?|band|position)?\s*[:#-]?\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/i)
  if (nirf && Number(nirf[1]) <= 300) { profile.nirfRank = nirf[2] ? `${nirf[1]}–${nirf[2]}` : nirf[1]; keyFeatures.push(kfPoint(`NIRF rank ${profile.nirfRank}`, 'ranking', url, sourceType, 'low', snippet(T, nirf.index))) }

  const pkg = (label) => {
    const re = new RegExp(`(${label})[^.]{0,45}?(?:package|salary|ctc|placement)[^.\\d₹]{0,25}(?:₹|rs\\.?|inr)?\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*(lpa|lakhs?|lacs?|cr|crores?)`, 'i')
    const m = T.match(re); if (!m) return null
    let v = parseFloat(m[2]); if (/cr/i.test(m[3])) v *= 100
    if (!(v > 0)) return null            // "₹0L" is a regex mismatch, not a package
    return { v, idx: m.index }
  }
  const hi = pkg('highest|top|max(?:imum)?')
  if (hi) { profile.placementHighestLpa = hi.v; keyFeatures.push(kfPoint(`Highest package ₹${hi.v}L`, 'placements', url, sourceType, 'medium', snippet(T, hi.idx))) }
  const avg = pkg('average|avg|median')
  if (avg) { profile.placementAvgLpa = avg.v; keyFeatures.push(kfPoint(`Average package ₹${avg.v}L`, 'placements', url, sourceType, 'medium', snippet(T, avg.idx))) }

  const recruiters = COMPANIES.filter(c => new RegExp(`\\b${c.replace('.', '\\.')}\\b`, 'i').test(T))
  if (recruiters.length >= 2) { profile.topRecruiters = recruiters.slice(0, 8); keyFeatures.push(kfPoint(`Recruiters include ${profile.topRecruiters.slice(0, 5).join(', ')}`, 'placements', url, sourceType, 'medium')) }

  const programs = PROGRAMS.filter(p => new RegExp(p.replace('.', '\\.'), 'i').test(T))
  if (programs.length) { profile.programs = programs; keyFeatures.push(kfPoint(`Programs: ${programs.slice(0, 6).join(', ')}`, 'programs', url, sourceType, 'low')) }

  if (/scholarship/i.test(T)) { profile.scholarships = 'Scholarships mentioned on site'; keyFeatures.push(kfPoint('Offers scholarships (details on site)', 'scholarships', url, sourceType, 'low')) }
  if (/hostel|accommodation/i.test(T)) { profile.hostel = 'Hostel/accommodation available'; keyFeatures.push(kfPoint('On-campus hostel/accommodation', 'facilities', url, sourceType, 'low')) }

  return { profile, keyFeatures }
}

// LLM extraction — reads the (messy) page text and returns structured facts.
async function extractFeaturesLlm(name, text, url, sourceType) {
  const system = 'You extract verifiable facts about a college from the raw text of its own website. Output STRICT JSON only. Use null when a fact is NOT clearly stated. NEVER invent numbers, rankings, or recruiters.'
  const user = JSON.stringify({
    institution: name, pageUrl: url, websiteText: text.slice(0, 8000),
    returnShape: {
      profile: { naac: 'string|null', nirfRank: 'string|null', placementHighestLpa: 'number LPA|null', placementAvgLpa: 'number LPA|null', annualFeeLpa: 'number LPA|null', topRecruiters: ['string'], programs: ['string'], scholarships: 'string|null', hostel: 'string|null' },
      keyFeatures: [{ point: 'short human-readable feature, e.g. "NAAC A++ accredited" or "Highest package ₹52L"', category: 'placements|fees|scholarships|ranking|programs|facilities|brand|other', confidence: 'high|medium|low' }],
    },
    rules: 'Return 4-10 keyFeatures capturing the most important, decision-relevant facts a prospective student cares about. Only include facts actually present in websiteText.',
  })
  const out = await completeJson({ system, user, maxTokens: 900, timeoutMs: 30000 })
  if (!out || !out.profile) return null
  const kf = (Array.isArray(out.keyFeatures) ? out.keyFeatures : [])
    .filter(f => f && f.point)
    .map(f => kfPoint(String(f.point).slice(0, 200), String(f.category || 'other'), url, sourceType, ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'medium'))
  return { profile: out.profile, keyFeatures: kf }
}

/**
 * Scrape an institution and return its key features.
 * @returns {ok, sources:[{url,ok,status,error}], profile, keyFeatures, usedLlm}
 */
async function scrapeInstitution({ name, urls, sourceType = 'competitor_page' }) {
  const { text, sources } = await scrapeSite(urls)
  if (!text || text.length < 300) return { ok: false, sources, profile: {}, keyFeatures: [], usedLlm: false }
  const primaryUrl = (sources.find(s => s.ok) || {}).url || normalizeUrl(urls[0])

  if (hasLlm()) {
    try {
      const feat = await extractFeaturesLlm(name, text, primaryUrl, sourceType)
      if (feat && feat.keyFeatures.length) return { ok: true, sources, profile: feat.profile || {}, keyFeatures: feat.keyFeatures, usedLlm: true }
    } catch (e) { console.warn(`[scraper] LLM extract failed for ${name}: ${e.message}`) }
  }
  const det = extractDeterministic(text, primaryUrl, sourceType)
  return { ok: det.keyFeatures.length > 0, sources, profile: det.profile, keyFeatures: det.keyFeatures, usedLlm: false }
}

module.exports = { scrapeInstitution, scrapeSite, htmlToText, normalizeUrl }
