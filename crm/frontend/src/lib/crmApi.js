// ---------------------------------------------------------------------------
// CRM API client — leads, branches, appointments, analytics, audit.
// Thin wrappers over the shared axios instance (auth header handled there).
// ---------------------------------------------------------------------------
import api from './api'

// ── Leads ─────────────────────────────────────────────────────────────────
export const importLeads = (payload) => api.post('/leads/import', payload).then(r => r.data)
export const listLeads = (params) => api.get('/leads', { params }).then(r => r.data)
export const getLead = (id) => api.get(`/leads/${id}`).then(r => r.data)
export const pipelineCounts = () => api.get('/leads/meta/pipeline').then(r => r.data)
export const assignLead = (id, officerId) => api.patch(`/leads/${id}/assign`, { officerId }).then(r => r.data)
export const setLeadStatus = (id, status, note) => api.patch(`/leads/${id}/status`, { status, note }).then(r => r.data)
export const setDisposition = (id, disposition, extra = {}) => api.post(`/leads/${id}/disposition`, { disposition, ...extra }).then(r => r.data)
export const flagDnd = (id, reason) => api.post(`/leads/${id}/dnd`, { reason }).then(r => r.data)
export const callLead = (id) => api.post(`/leads/${id}/call`).then(r => r.data)
export const followUpQueue = (lookaheadHours = 0) => api.get('/leads/queue/followups', { params: { lookaheadHours } }).then(r => r.data)

// ── Branches + officers ───────────────────────────────────────────────────
export const listBranches = () => api.get('/branches').then(r => r.data)
export const createBranch = (payload) => api.post('/branches', payload).then(r => r.data)
export const updateBranch = (id, patch) => api.patch(`/branches/${id}`, patch).then(r => r.data)
export const listOfficers = (branchId) => api.get(`/branches/${branchId}/officers`).then(r => r.data)
export const createOfficer = (branchId, payload) => api.post(`/branches/${branchId}/officers`, payload).then(r => r.data)

// ── Appointments ──────────────────────────────────────────────────────────
export const listAppointments = (params) => api.get('/appointments', { params }).then(r => r.data)
export const bookAppointment = (payload) => api.post('/appointments', payload).then(r => r.data)
export const setAppointmentStatus = (id, status) => api.patch(`/appointments/${id}/status`, { status }).then(r => r.data)
export const remindAppointment = (id) => api.post(`/appointments/${id}/remind`).then(r => r.data)

// ── Analytics ─────────────────────────────────────────────────────────────
export const crmOverview = (params) => api.get('/crm-analytics/overview', { params }).then(r => r.data)
export const crmByBranch = () => api.get('/crm-analytics/by-branch').then(r => r.data)
export const crmByOfficer = () => api.get('/crm-analytics/by-officer').then(r => r.data)
export const crmPipeline = () => api.get('/crm-analytics/pipeline').then(r => r.data)

// ── Calls (AI auto-analysis) ───────────────────────────────────────────────
// Re-run AI analysis on a call: auto summary + auto disposition + sentiment.
export const analyzeCall = (id) => api.post(`/calls/${id}/analyze`).then(r => r.data)

// ── Competitive Intelligence (admin / main office only) ────────────────────
export const runCompetitive = (windowDays = 90) => api.post('/competitive/generate', { windowDays }).then(r => r.data)
export const listCompetitiveReports = () => api.get('/competitive/reports').then(r => r.data)
export const getCompetitiveReport = (id) => api.get(`/competitive/reports/${id}`).then(r => r.data)
export const reviewCompetitiveReport = (id, status, reviewNotes = '') => api.patch(`/competitive/reports/${id}/review`, { status, reviewNotes }).then(r => r.data)
export const listCompetitors = () => api.get('/competitive/competitors').then(r => r.data)
export const scrapePreview = (url, name) => api.post('/competitive/scrape-preview', { url, name }).then(r => r.data)
export const createCompetitor = (payload) => api.post('/competitive/competitors', payload).then(r => r.data)
export const updateCompetitor = (id, patch) => api.patch(`/competitive/competitors/${id}`, patch).then(r => r.data)
export const deleteCompetitor = (id) => api.delete(`/competitive/competitors/${id}`).then(r => r.data)

// ── Marketing Agent Suite ──────────────────────────────────────────────────
export const mktScore = (branchId) => api.post('/marketing/score', { branchId }).then(r => r.data)
export const mktSegments = () => api.get('/marketing/segments').then(r => r.data)
export const mktSegmentLeads = (key, limit = 50) => api.get(`/marketing/segments/${key}/leads`, { params: { limit } }).then(r => r.data)
export const mktListContent = (status) => api.get('/marketing/content', { params: status ? { status } : {} }).then(r => r.data)
export const mktGenerateContent = (payload) => api.post('/marketing/content/generate', payload).then(r => r.data)
export const mktCreateContent = (payload) => api.post('/marketing/content', payload).then(r => r.data)
export const mktReviewContent = (id, status, reviewNotes = '') => api.patch(`/marketing/content/${id}/review`, { status, reviewNotes }).then(r => r.data)
export const mktListCampaigns = (status) => api.get('/marketing/campaigns', { params: status ? { status } : {} }).then(r => r.data)
export const mktGetCampaign = (id) => api.get(`/marketing/campaigns/${id}`).then(r => r.data)
export const mktProposeCampaigns = (branchId) => api.post('/marketing/campaigns/propose', { branchId }).then(r => r.data)
export const mktCreateCampaign = (payload) => api.post('/marketing/campaigns', payload).then(r => r.data)
export const mktUpdateCampaign = (id, patch) => api.patch(`/marketing/campaigns/${id}`, patch).then(r => r.data)
export const mktReviewCampaign = (id, status, reviewNotes = '') => api.patch(`/marketing/campaigns/${id}/review`, { status, reviewNotes }).then(r => r.data)
export const mktActivateCampaign = (id) => api.post(`/marketing/campaigns/${id}/activate`).then(r => r.data)
export const mktPauseCampaign = (id, resume = false) => api.post(`/marketing/campaigns/${id}/pause`, { resume }).then(r => r.data)
export const mktCampaignFunnel = (id) => api.get(`/marketing/campaigns/${id}/funnel`).then(r => r.data)
export const mktCampaignMessages = (id, params) => api.get(`/marketing/campaigns/${id}/messages`, { params }).then(r => r.data)
export const mktOverview = () => api.get('/marketing/analytics/overview').then(r => r.data)
export const mktBrief = () => api.get('/marketing/brief').then(r => r.data)
export const mktSeedDemo = () => api.post('/marketing/seed-demo').then(r => r.data)

// ── Audit ─────────────────────────────────────────────────────────────────
export const listAudit = (params) => api.get('/audit', { params }).then(r => r.data)

// ── Public (student signup) ───────────────────────────────────────────────
export const publicBranches = (org) => api.get('/auth/public/branches', { params: org ? { org } : {} }).then(r => r.data)
export const studentRegister = (payload) => api.post('/auth/student-register', payload).then(r => r.data)
