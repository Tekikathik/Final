import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import Landing from './pages/Landing'
import CreateOrg from './pages/CreateOrg'
import Login from './pages/Login'
import OrgDashboard from './pages/OrgDashboard'
import CollegeDashboard from './pages/CollegeDashboard'
import StudentReport from './pages/StudentReport'
import Analytics from './pages/Analytics'
import Team from './pages/Team'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Colleges from './pages/Colleges'
import CollegeDetail from './pages/CollegeDetail'
import PriyaDashboard from './pages/PriyaDashboard'
import Leads from './pages/Leads'
import Branches from './pages/Branches'
import CrmAnalytics from './pages/CrmAnalytics'
import AuditLog from './pages/AuditLog'
import CompetitiveIntel from './pages/CompetitiveIntel'
import Marketing from './pages/Marketing'
import StudentPortal from './pages/StudentPortal'
import { useStore } from './store/useStore'

/**
 * Lightweight auth guard. The store's rehydrate() always falls back to a
 * demo user so this only redirects in the rare case where logout() has
 * cleared user state explicitly.
 */
function ProtectedRoute({ children }) {
  const user = useStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return children
}

/**
 * Org-scope guard. Routes that show data across the whole organisation
 * (the main dashboard, the all-colleges grid, org-wide analytics, the team
 * page, etc.) are off-limits to a college_admin — they're sandboxed to
 * their assigned college(s). We bounce them straight to that college.
 */
function OrgOnlyRoute({ children }) {
  const user = useStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  // Branch officers and students never see org-wide views — send them home.
  if (user.role === 'student') return <Navigate to="/dashboard/student" replace />
  if (user.role === 'officer')  return <Navigate to="/dashboard/leads" replace />
  if (user.role === 'college_admin') {
    return <Navigate to="/dashboard/leads" replace />
  }
  return children
}

/**
 * Per-college guard. A college_admin can only open dashboards/reports for a
 * college in their `collegeIds` allowlist. Anyone else (admin/officer/viewer)
 * passes through unchanged.
 *
 * collegeIdParam lets us reuse the same guard for both the /college/:id and
 * /college/:collegeId/report/:callId routes, which use different param names.
 */
function CollegeScopedRoute({ children, collegeIdParam = 'id' }) {
  const user = useStore((s) => s.user)
  const params = useParams()
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'college_admin') {
    const owned = (user.collegeIds || []).map(String)
    const requested = String(params[collegeIdParam] || '')
    if (!owned.includes(requested)) {
      // Send them to their own college rather than a hard 403 — keeps the
      // UX gentle if they bookmarked or pasted the wrong URL.
      const homeId = owned[0]
      return <Navigate to={homeId ? `/dashboard/college/${homeId}` : '/login'} replace />
    }
  }
  return children
}

/**
 * Role gate for the CRM sections. Students are bounced to their portal; anyone
 * whose role isn't allowed is redirected to a sensible home for their role.
 */
function RoleRoute({ children, allow }) {
  const user = useStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!allow.includes(user.role)) {
    if (user.role === 'student') return <Navigate to="/dashboard/student" replace />
    if (user.role === 'officer') return <Navigate to="/dashboard/leads" replace />
    return <Navigate to="/dashboard" replace />
  }
  return children
}

export default function App() {
  const { user, rehydrate } = useStore()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    rehydrate().finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #E0E9DA', borderTopColor: '#7D9B76', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: '#7A7A7A', fontSize: 14, fontWeight: 500 }}>Loading AdmitAI...</p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create-org" element={<CreateOrg />} />
        <Route path="/login" element={<Login />} />

        {/* Org-wide views — admin / officer / viewer only */}
        <Route path="/dashboard"             element={<OrgOnlyRoute><OrgDashboard /></OrgOnlyRoute>} />
        <Route path="/dashboard/colleges"    element={<OrgOnlyRoute><Colleges /></OrgOnlyRoute>} />
        <Route path="/dashboard/colleges/:id" element={<OrgOnlyRoute><CollegeDetail /></OrgOnlyRoute>} />
        <Route path="/dashboard/analytics"   element={<OrgOnlyRoute><Analytics /></OrgOnlyRoute>} />
        <Route path="/dashboard/live"        element={<OrgOnlyRoute><PriyaDashboard /></OrgOnlyRoute>} />
        {/* Org-level call report — opened from the Priya dashboard's call history
            (no college context; the report is built from the Priya session). */}
        <Route path="/dashboard/report/:callId" element={<OrgOnlyRoute><StudentReport /></OrgOnlyRoute>} />
        <Route path="/dashboard/team"        element={<OrgOnlyRoute><Team /></OrgOnlyRoute>} />

        {/* Per-college views — college_admin restricted to their own */}
        <Route path="/dashboard/college/:id" element={
          <CollegeScopedRoute><CollegeDashboard /></CollegeScopedRoute>
        } />
        <Route path="/dashboard/college/:collegeId/report/:callId" element={
          <CollegeScopedRoute collegeIdParam="collegeId"><StudentReport /></CollegeScopedRoute>
        } />

        {/* CRM — leads (admin + officer), branch/analytics/audit (admin only) */}
        <Route path="/dashboard/leads"         element={<RoleRoute allow={['admin', 'college_admin', 'officer']}><Leads /></RoleRoute>} />
        <Route path="/dashboard/branches"      element={<RoleRoute allow={['admin']}><Branches /></RoleRoute>} />
        <Route path="/dashboard/crm-analytics" element={<RoleRoute allow={['admin', 'college_admin']}><CrmAnalytics /></RoleRoute>} />
        <Route path="/dashboard/audit"         element={<RoleRoute allow={['admin', 'college_admin', 'officer']}><AuditLog /></RoleRoute>} />

        {/* Competitive Intelligence — main office (admin) only */}
        <Route path="/dashboard/competitive"   element={<RoleRoute allow={['admin']}><CompetitiveIntel /></RoleRoute>} />

        {/* Marketing Agent Suite — admin + officer (branch-scoped) */}
        <Route path="/dashboard/marketing"     element={<RoleRoute allow={['admin', 'officer', 'college_admin']}><Marketing /></RoleRoute>} />

        {/* Student portal */}
        <Route path="/dashboard/student" element={<RoleRoute allow={['student']}><StudentPortal /></RoleRoute>} />

        {/* Personal — every signed-in user */}
        <Route path="/dashboard/profile"  element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/dashboard/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
