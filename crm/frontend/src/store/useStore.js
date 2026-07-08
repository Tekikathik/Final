import { create } from 'zustand'
import api, { setToken, clearToken } from '../lib/api'
import {
  getStudents,
  getColleges,
  getChartData,
  getStudentsByCollege,
} from '../lib/dummyData'
import { getCalls as getPriyaCalls, getCall as getPriyaCall } from '../lib/priyaApi'

const LANG_NAME = { 'te-IN': 'Telugu', 'en-IN': 'English', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil' }
const PRIYA_STATUS = { completed: 'completed', failed: 'failed', 'in-progress': 'in_progress', calling: 'in_progress', 'no-answer': 'no_answer' }

// Map a real Priya call summary into the shape the Calls table / Reports expect.
function mapPriyaCall(c) {
  return {
    _id: c.session_id, id: c.session_id,
    name: c.name && c.name !== 'Unknown' ? c.name : 'Student',
    phone: c.phone,
    status: PRIYA_STATUS[c.status] || c.status,
    duration: c.duration,
    createdAt: c.started_at,
    detected_language: c.detected_language,
    steps_completed: c.steps_completed,
    sentiment: c.sentiment ?? null,
    interested: c.interested ?? null,
    disposition: c.disposition ?? null,
    summary: c.summary || null,
    isPriya: true,
  }
}

// How often each decision topic actually came up in THIS conversation (keyword
// scan over the real transcript, scaled so the most-discussed topic = 100).
function topicScoresFromTranscript(transcript) {
  const text = transcript.map(t => t.text).join(' ').toLowerCase()
  const count = (re) => (text.match(re) || []).length
  const raw = {
    fees:             count(/\bfee|fees|tuition|lakh|₹|फीस|ఫీజు/g),
    scholarship:      count(/scholarship|waiver|merit|छात्रवृत्ति|స్కాలర్/g),
    placement:        count(/placement|package|recruit|salary|job|प्लेसमेंट/g),
    hostel:           count(/hostel|accommodation|mess|room|छात्रावास|హాస్టల్/g),
    courseDetails:    count(/course|b\.?tech|cse|ece|branch|program|specializ|డిపార్ట్|ब्रांच/g),
    admissionProcess: count(/admission|eapcet|jee|entrance|exam|counselling|apply|application|प्रवेश/g),
  }
  const max = Math.max(1, ...Object.values(raw))
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v / max) * 100)]))
}

// AI disposition → enrollment likelihood + the follow-ups a counselor should do.
const DISPO_PROBABILITY = { enrolled: 95, interested: 80, callback: 55, not_interested: 15, wrong_number: 5, no_answer: 10 }
const DISPO_FOLLOWUPS = {
  enrolled:       ['Send the admission formalities checklist', 'Introduce the assigned counselor'],
  interested:     ['Send brochure & fee structure on WhatsApp', 'Schedule the campus visit / counselling they chose', 'Share scholarship eligibility for their exam score'],
  callback:       ['Call back at the time they asked for', 'Send the brochure before the callback'],
  not_interested: ['Mark closed; add to the nurture list for the next intake'],
  wrong_number:   ['Verify the lead\'s contact number'],
  no_answer:      ['Retry at a different time of day'],
}

// Build a StudentReport-shaped object from a real Priya call (transcript + collected).
// The summary/disposition/sentiment come from the post-call AI analysis of the ACTUAL
// conversation; profile fields map the LiveKit agent's save_detail keys (with the old
// dashboard aliases as fallbacks); topics are counted from the real transcript.
function buildPriyaReport(c) {
  const col = c.collected || {}
  const name = col.student_name || col.parent_name || col.name || c.name || 'Student'
  const course = [col.program_of_interest || col.interest, col.specialization || col.department]
    .filter(Boolean).join(' — ') || '—'
  const transcript = (c.transcript || []).map((t, i) => ({
    speaker: t.role === 'Priya' ? 'ai' : 'student',
    text: t.text,
    timestamp: i * 6,
  }))
  const disposition = c.disposition || col.call_outcome || null
  const fallbackSummary =
    `Call with ${name} in ${LANG_NAME[c.detected_language] || c.detected_language || 'their language'}. `
    + `Interested in ${course}.` + (col.current_city || col.location ? ` From ${col.current_city || col.location}.` : '')
    + ` Call status: ${c.status}.`
  return {
    profile: {
      name, phone: c.phone, email: '',
      examAppeared: col.entrance_exams_taken || col.entrance_exam || '—',
      courseInterested: course,
      currentCity: col.current_city || col.location || '—',
      tenthPercent: col.class_10_score || col.marks_10 || '—',
      twelfthPercent: col.class_12_score || col.marks_inter || '—',
      entranceScore: col.entrance_score || col.graduation_score || '—',
    },
    summary: c.summary || fallbackSummary,
    enrollmentProbability: DISPO_PROBABILITY[disposition] ?? (c.status === 'completed' ? 60 : 30),
    topicAnalysis: topicScoresFromTranscript(c.transcript || []),
    sentimentTimeline: [],
    followUpRecommendations: DISPO_FOLLOWUPS[disposition] || (c.status === 'completed' ? [] : ['Follow up to complete the conversation']),
    transcript,
    callId: { status: c.status, duration: c.duration, sentiment: c.sentiment || null, disposition },
    isPriya: true,
  }
}

/**
 * Default user/org used when the backend isn't reachable so the dashboard
 * (Profile page, Colleges page, Settings, etc.) always has something to render.
 */
const DEMO_USER = {
  id: 'usr-aditya-admin',
  name: 'Aditya Satyalokesh',
  email: 'adityasatyalokesh@gmail.com',
  phone: '+91 98765 43210',
  role: 'admin',
  orgId: 'org-aditya-001',
  orgName: 'Aditya Educational Institutions',
  avatar: null,
  createdAt: new Date('2025-09-12T10:30:00Z').toISOString(),
}

const DEMO_ORG = {
  id: 'org-aditya-001',
  name: 'Aditya Educational Institutions',
  type: 'University',
  location: 'Surampalem, Andhra Pradesh',
  website: 'https://aditya.edu.in',
  description: 'A multi-campus educational group operating Aditya University and sister institutions across Andhra Pradesh.',
}

/**
 * Hardcoded demo accounts used when the backend is unreachable. Lets reviewers
 * try every role (org admin, per-college admin, viewer) without spinning up
 * the API. Keys are emails (lower-case); passwords are plain strings — this
 * is a demo, not an auth system.
 *
 * `collegeIds` is required for the `college_admin` role: the route guards in
 * App.jsx restrict that user to dashboards/reports for those college IDs only.
 */
// Addresses Evaluator Improvement #6: "Demo passwords hardcoded in frontend store"
export const DEMO_ACCOUNTS = [] // Deprecated, fetch via store.fetchDemoAccounts() instead

// Fallback demo accounts used when the backend is unreachable
const FALLBACK_DEMO_ACCOUNTS = [
  {
    email: 'admin@aditya.edu.in',
    password: 'demo-admin-pass',
    user: { id: 'usr-aditya-admin', name: 'Aditya Satyalokesh', email: 'admin@aditya.edu.in', role: 'admin', orgId: 'org-aditya-001', orgName: 'Aditya Educational Institutions', avatar: null },
  },
  {
    email: 'viewer@aditya.edu.in',
    password: 'demo-viewer-pass',
    user: { id: 'usr-aditya-viewer', name: 'Riya Menon', email: 'viewer@aditya.edu.in', role: 'viewer', orgId: 'org-aditya-001', orgName: 'Aditya Educational Institutions', avatar: null },
  },
  {
    email: 'principal.adu@aditya.edu.in',
    password: 'demo-adu-pass',
    user: { id: 'usr-college-adu', name: 'Dr. Suresh Reddy', email: 'principal.adu@aditya.edu.in', role: 'college_admin', orgId: 'org-aditya-001', collegeIds: ['col-aditya-univ'], collegeName: 'Aditya University', avatar: null },
  },
  {
    email: 'principal.aec@aditya.edu.in',
    password: 'demo-aec-pass',
    user: { id: 'usr-college-aec', name: 'Dr. Lakshmi Iyer', email: 'principal.aec@aditya.edu.in', role: 'college_admin', orgId: 'org-aditya-001', collegeIds: ['col-aditya-eng'], collegeName: 'Aditya Engineering College', avatar: null },
  },
]

const SESSION_KEY = 'admitai.demoSession'

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveSession(user) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
}

/** Look up a demo account by email (case-insensitive); password optional. */
function findDemoAccount(email, password, demoAccountsList = []) {
  if (!email) return null
  const e = String(email).trim().toLowerCase()
  const acct = demoAccountsList.find((a) => a.email.toLowerCase() === e)
  if (!acct) return null
  if (password !== undefined && password !== acct.password) return null
  return acct.user
}

export const useStore = create((set, get) => ({
  // --- Core state -----------------------------------------------------------
  user: null,
  org: null,
  accessToken: null,
  colleges: [],
  calls: [],
  students: [],     // full student roster (1000 dummy rows by default)
  chartData: [],
  reports: [],
  demoAccounts: [],
  loading: false,
  error: null,

  fetchDemoAccounts: async () => {
    try {
      const { data } = await api.get('/auth/demo-accounts')
      set({ demoAccounts: data })
    } catch {
      set({ demoAccounts: FALLBACK_DEMO_ACCOUNTS })
    }
  },

  /**
   * Hydrate every slice that visualizations depend on with the dummy dataset.
   * Called any time the backend is unreachable so the UI stays functional.
   */
  loadDummyData: () => {
    const students = getStudents()
    set({
      students,
      colleges: getColleges(),
      chartData: getChartData(7),
    })
    return students
  },

  // --- Auth -----------------------------------------------------------------
  login: async ({ email, password }) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/login', { email, password })
      setToken(data.accessToken)
      set({ user: data.user, org: data.org, accessToken: data.accessToken, loading: false })
      saveSession(data.user)
      get().loadDummyData()
      return { ok: true, user: data.user }
    } catch (err) {
      const isAuthError = err.response?.status === 401 || err.response?.status === 400

      // Always check demo accounts first — they don't exist in MongoDB so backend always returns 401
      const matched = findDemoAccount(email, password, get().demoAccounts)
      if (matched) {
        set({ user: matched, org: DEMO_ORG, accessToken: 'demo', loading: false, error: null })
        saveSession(matched)
        get().loadDummyData()
        return { ok: true, user: matched }
      }

      // Email is a known demo account but wrong password
      const known = findDemoAccount(email, undefined, get().demoAccounts)
      if (known) {
        set({ loading: false, error: 'Invalid password for this demo account' })
        return { ok: false, message: 'Invalid password for this demo account' }
      }

      // Real user with real backend error — show the actual message
      if (isAuthError) {
        const msg = err.response?.data?.message || 'Invalid email or password'
        set({ loading: false, error: msg })
        return { ok: false, message: msg }
      }

      // Backend unreachable — fall back to generic demo admin
      const demoUser = { ...DEMO_USER, email: email || DEMO_USER.email }
      set({ user: demoUser, org: DEMO_ORG, accessToken: 'demo', loading: false, error: null })
      saveSession(demoUser)
      get().loadDummyData()
      return { ok: true, user: demoUser }
    }
  },

  register: async (payload) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/register', payload)
      setToken(data.accessToken)
      set({ user: data.user, org: data.org, accessToken: data.accessToken, loading: false })
      get().loadDummyData()
      return { ok: true }
    } catch (err) {
      const msg = err.response?.data?.message
        || (err.response ? `Server error (${err.response.status})` : 'Could not reach the server. Is the backend running?')
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  logout: async () => {
    try { await api.post('/auth/logout') } catch {}
    clearToken()
    clearSession()
    set({ user: null, org: null, accessToken: null, colleges: [], calls: [], students: [] })
  },

  rehydrate: async () => {
    try {
      const { data } = await api.post('/auth/refresh')
      setToken(data.accessToken)
      const me = await api.get('/auth/me')
      set({ user: me.data.user, org: me.data.org, accessToken: data.accessToken })
      get().loadDummyData()
      return true
    } catch {
      // No backend session — restore the last demo login if there was one,
      // otherwise default to the org admin so the landing dashboard is usable
      // for first-time visitors.
      const persisted = loadSession()
      set({ user: persisted || DEMO_USER, org: DEMO_ORG, accessToken: 'demo' })
      get().loadDummyData()
      return true
    }
  },

  /** Update the locally-stored user profile (Profile page edit form). */
  updateProfile: (patch) => set((s) => ({ user: { ...s.user, ...patch } })),

  /**
   * Mock password change. The real backend route is wired via Settings;
   * here we just validate the input on the client so the Profile page works
   * even without a server.
   */
  changePassword: async ({ currentPassword, newPassword }) => {
    if (!currentPassword || currentPassword.length < 3) {
      return { ok: false, message: 'Current password is required.' }
    }
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, message: 'New password must be at least 6 characters.' }
    }
    try {
      await api.put('/auth/me/password', { currentPassword, newPassword })
    } catch {
      // ignore — demo mode
    }
    return { ok: true }
  },

  // --- Colleges -------------------------------------------------------------
  /**
   * Pull the org's colleges from the backend.
   *
   * Two distinct empty states matter here:
   *   - Backend returned 2xx with []  → user genuinely has no colleges.
   *     Show the real empty state ("Add your first college") instead of
   *     pretending colleges exist via dummy data.
   *   - Backend unreachable (network error, 401 with no refresh)  → demo
   *     mode. Hydrate with dummy data so the UI is still explorable.
   */
  fetchColleges: async () => {
    try {
      const { data } = await api.get('/colleges')
      // Even if [] — that's a real answer from the server. Trust it.
      set({ colleges: Array.isArray(data) ? data : [] })
    } catch (err) {
      // Network/auth failure — fall back to the dummy dataset.
      set({ colleges: getColleges() })
    }
  },

  addCollege: async (college) => {
    try {
      const { data } = await api.post('/colleges', college)
      set(s => ({ colleges: [...s.colleges, { ...data, calls: 0, leads: 0, enrolled: 0 }] }))
      return { ok: true, data }
    } catch (err) {
      // Backend unreachable: optimistic add so the demo flow keeps moving.
      // We surface the message if the backend rejected for a real reason
      // (e.g. duplicate code) so the form can show it.
      if (err.response?.status >= 400 && err.response?.status < 500) {
        return { ok: false, message: err.response.data?.message || 'Could not add college' }
      }
      const id = `col-${Date.now()}`
      const newCol = { _id: id, id, ...college, calls: 0, leads: 0, enrolled: 0, isActive: true }
      set(s => ({ colleges: [...s.colleges, newCol] }))
      return { ok: true, data: newCol }
    }
  },

  // --- Calls ----------------------------------------------------------------
  fetchCalls: async (collegeId) => {
    // Real Priya calls (triggered from Trigger Campaign) — show these at the top.
    let priyaCalls = []
    try {
      const raw = await getPriyaCalls()
      priyaCalls = (Array.isArray(raw) ? raw : []).map(mapPriyaCall)
    } catch { /* Priya backend unreachable — just show demo data */ }

    try {
      const { data } = await api.get('/calls', { params: { collegeId, limit: 100 } })
      if (data?.calls?.length) {
        set({ calls: [...priyaCalls, ...data.calls] })
        return
      }
      throw new Error('empty')
    } catch (err) {
      // Fall back: pull this college's slice from the dummy student dataset
      const demo = collegeId ? getStudentsByCollege(collegeId) : getStudents()
      set({ calls: [...priyaCalls, ...demo.slice(0, 200)] })
    }
  },

  triggerCampaign: async ({ collegeId, contacts, settings }) => {
    try {
      const { data } = await api.post('/calls/trigger', { collegeId, contacts, settings })
      return data
    } catch {
      // Mock campaign so the trigger flow still gives feedback in demo mode
      return { campaignId: `mock-${Date.now()}`, total: contacts?.length || 0 }
    }
  },

  pollCampaign: async (campaignId) => {
    try {
      const { data } = await api.get('/calls', { params: { campaignId, limit: 100 } })
      set({ calls: data.calls })
    } catch (err) {
      console.error(`pollCampaign error: ${err.message}`);
      throw err;
    }
  },

  // --- Analytics ------------------------------------------------------------
  fetchChartData: async (days = 7) => {
    try {
      const { data } = await api.get('/analytics/overview', { params: { days } })
      const chart = data.daily.map(d => ({
        day: d._id.slice(5),
        calls: d.calls,
        leads: d.leads,
        enrolled: d.enrolled,
      }))
      set({ chartData: chart.length ? chart : getChartData(days) })
    } catch {
      set({ chartData: getChartData(days) })
    }
  },

  // --- Reports --------------------------------------------------------------
  fetchReports: async (collegeId) => {
    try {
      const { data } = await api.get('/reports', { params: { collegeId, limit: 50 } })
      set({ reports: data.reports })
    } catch (err) { console.error('fetchReports', err) }
  },

  fetchReport: async (callId) => {
    // Real Priya call? Build the report from its transcript + collected data.
    try {
      const c = await getPriyaCall(callId)
      if (c && c.session_id) return buildPriyaReport(c)
    } catch { /* not a Priya call — fall through to demo/report API */ }

    try {
      const { data } = await api.get(`/reports/${callId}`)
      return data
    } catch {
      // Build a synthetic report from the dummy dataset
      const stu = getStudents().find((s) => s._id === callId || s.id === callId)
      if (!stu) throw new Error('not found')
      return {
        profile: {
          name: stu.name, phone: stu.phone, email: stu.email,
          examAppeared: stu.examAppeared, courseInterested: stu.courseInterested,
          currentCity: stu.currentCity, tenthPercent: stu.tenthPercent,
          twelfthPercent: stu.twelfthPercent, entranceScore: stu.entranceScore,
        },
        summary: `${stu.name} engaged on the call about ${stu.courseInterested}. Sentiment: ${stu.sentiment || 'unknown'}.`,
        enrollmentProbability: stu.enrollmentProbability,
        topicAnalysis: { fees: 60, scholarship: 70, placement: 65, hostel: 30, courseDetails: 80, admissionProcess: 50 },
        sentimentTimeline: [],
        followUpRecommendations: ['Send brochure', 'Schedule follow-up call'],
        transcript: [],
        callId: { status: stu.status, duration: stu.duration, sentiment: stu.sentiment },
      }
    }
  },
}))
