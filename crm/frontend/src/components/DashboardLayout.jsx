import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store/useStore'
import {
  Phone, LayoutDashboard, Building2, BarChart3, Users,
  Settings, LogOut, Bell, ChevronDown, Menu, User as UserIcon,
  TrendingUp, AlertCircle, CheckCircle, FileText, Activity,
  ClipboardList, CalendarCheck, ShieldCheck, Target, Megaphone
} from 'lucide-react'

// Main-branch admin: full org + CRM management.
const NAV_ORG = [
  { path: '/dashboard',              label: 'Overview',      icon: LayoutDashboard },
  { path: '/dashboard/leads',        label: 'Leads',         icon: ClipboardList },
  { path: '/dashboard/branches',     label: 'Branches',      icon: Building2 },
  { path: '/dashboard/crm-analytics', label: 'CRM Analytics', icon: BarChart3 },
  { path: '/dashboard/marketing',    label: 'Marketing',     icon: Megaphone },
  { path: '/dashboard/competitive',  label: 'Competitive Intel', icon: Target },
  { path: '/dashboard/live',         label: 'Priya AI',      icon: Activity },
  { path: '/dashboard/audit',        label: 'Audit Log',     icon: ShieldCheck },
  { path: '/dashboard/profile',      label: 'Profile',       icon: UserIcon },
  { path: '/dashboard/settings',     label: 'Settings',      icon: Settings },
]

// Branch officer: their leads + their branch's audit.
const NAV_OFFICER = [
  { path: '/dashboard/leads',     label: 'My Leads',  icon: ClipboardList },
  { path: '/dashboard/marketing', label: 'Marketing', icon: Megaphone },
  { path: '/dashboard/audit',     label: 'Activity',  icon: ShieldCheck },
  { path: '/dashboard/profile', label: 'Profile',   icon: UserIcon },
  { path: '/dashboard/settings', label: 'Settings', icon: Settings },
]

// Student: book + view campus visits.
const NAV_STUDENT = [
  { path: '/dashboard/student',  label: 'My Visits', icon: CalendarCheck },
  { path: '/dashboard/profile',  label: 'Profile',   icon: UserIcon },
  { path: '/dashboard/settings', label: 'Settings',  icon: Settings },
]

/**
 * college_admin sees a trimmed nav: their single college's workspace plus
 * the personal pages. The org-wide views (Overview, Colleges grid, Analytics,
 * Team) are hidden because the route guards in App.jsx would just redirect
 * them away anyway — surfacing the links would be misleading.
 */
function buildNav(user) {
  if (user?.role === 'student') return NAV_STUDENT
  if (user?.role === 'officer') return NAV_OFFICER
  if (user?.role === 'college_admin') {
    return [
      { path: '/dashboard/leads',         label: 'Leads',         icon: ClipboardList },
      { path: '/dashboard/crm-analytics', label: 'CRM Analytics', icon: BarChart3 },
      { path: '/dashboard/audit',         label: 'Audit Log',     icon: ShieldCheck },
      { path: '/dashboard/profile',       label: 'Profile',       icon: UserIcon },
      { path: '/dashboard/settings',      label: 'Settings',      icon: Settings },
    ]
  }
  return NAV_ORG
}

const NOTIFICATIONS = [
  { icon: CheckCircle, color: '#7D9B76', title: 'Campaign completed', meta: 'Aditya University · 481 calls processed', time: '12 min ago' },
  { icon: TrendingUp,  color: '#7D9B76', title: 'Lead conversion up 24%', meta: 'Last 7 days vs previous week',          time: '2 hours ago' },
  { icon: FileText,    color: '#C8923A', title: 'New student report ready', meta: 'Naveen Reddy · MBA Marketing',         time: '5 hours ago' },
  { icon: AlertCircle, color: '#C8923A', title: 'Low connect rate detected', meta: 'Aditya Pharmacy College · 38%',       time: 'Yesterday' },
]

export default function DashboardLayout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, org, logout } = useStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [notifOpen, setNotifOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [unread, setUnread] = useState(NOTIFICATIONS.length)
  const notifRef = useRef(null)
  const userMenuRef = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target))   setNotifOpen(false)
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const handleLogout = () => { logout(); navigate('/') }
  const goToProfile = () => navigate('/dashboard/profile')

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#FBFBFA', overflow: 'hidden' }}>
      {/* ============================ SIDEBAR ============================ */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            style={{ width: 240, background: '#FFFFFF', borderRight: '1px solid #E8E8E8', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>

            <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #E8E8E8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => navigate('/')}>
                <div style={{ width: 32, height: 32, background: '#7D9B76', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Phone size={15} color="white" />
                </div>
                <span style={{ fontWeight: 600, fontSize: 16, color: '#2C2C2C' }}>AdmitAI</span>
              </div>
              {(user?.orgName || org?.name) && (
                <div style={{ marginTop: 12, padding: '8px 10px', background: '#F1F5EE', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#7A7A7A', marginBottom: 2, fontWeight: 500 }}>
                    {user?.role === 'college_admin' ? 'College' : 'Organisation'}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.role === 'college_admin' ? (user.collegeName || user.orgName) : (user?.orgName || org?.name)}
                  </div>
                  {user?.role === 'college_admin' && user?.orgName && (
                    <div style={{ fontSize: 10, color: '#7A7A7A', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      part of {user.orgName}
                    </div>
                  )}
                </div>
              )}
            </div>

            <nav style={{ padding: '12px 8px', flex: 1 }}>
              <div style={{ fontSize: 11, color: '#A0A0A0', fontWeight: 600, padding: '6px 8px', letterSpacing: 0.6, textTransform: 'uppercase' }}>Navigation</div>
              {buildNav(user).map(({ path, label, icon: Icon }, i) => {
                const isActive = path === '/dashboard'
                  ? location.pathname === '/dashboard'
                  : location.pathname === path || location.pathname.startsWith(path + '/')
                return (
                  <motion.div
                    key={path}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`sidebar-item ${isActive ? 'active' : ''}`}
                    onClick={() => navigate(path)} style={{ marginBottom: 2 }}>
                    <Icon size={16} />
                    {label}
                  </motion.div>
                )
              })}
            </nav>

            <div style={{ padding: '12px 8px', borderTop: '1px solid #E8E8E8' }}>
              <div onClick={goToProfile}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', transition: 'background 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#F1F5EE'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                title="View profile">
                <div style={{ width: 32, height: 32, background: user?.avatar ? `url(${user.avatar}) center/cover` : '#7D9B76', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'white', flexShrink: 0 }}>
                  {!user?.avatar && (user?.name?.[0]?.toUpperCase() || 'U')}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
                  <div style={{ fontSize: 11, color: '#7A7A7A', textTransform: 'capitalize' }}>{(user?.role || '').replace('_', ' ')}</div>
                </div>
              </div>
              <div className="sidebar-item" onClick={handleLogout} style={{ color: '#9B2C2C', marginTop: 4 }}>
                <LogOut size={16} /> Logout
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ============================ MAIN ============================ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ height: 60, background: '#FFFFFF', borderBottom: '1px solid #E8E8E8', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(p => !p)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5A5A5A', padding: 4, borderRadius: 6, transition: 'background 0.2s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#F1F5EE'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Menu size={20} />
          </button>
          <div style={{ flex: 1 }} />

          <div ref={notifRef} style={{ position: 'relative' }}>
            <button onClick={() => { setNotifOpen(o => !o); setUnread(0) }}
              aria-label="Notifications"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, position: 'relative', color: '#5A5A5A', borderRadius: 8, transition: 'background 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#F1F5EE'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Bell size={18} />
              {unread > 0 && (
                <div style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, background: '#C8923A', borderRadius: '50%', fontSize: 10, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, padding: '0 4px' }}>
                  {unread}
                </div>
              )}
            </button>
            <AnimatePresence>
              {notifOpen && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  style={{ position: 'absolute', right: 0, top: 38, width: 340, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 14, boxShadow: '0 12px 32px rgba(0,0,0,0.10)', zIndex: 200, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #E8E8E8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2C' }}>Notifications</span>
                    <span style={{ fontSize: 11, color: '#7A7A7A' }}>{NOTIFICATIONS.length} recent</span>
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {NOTIFICATIONS.map((n, i) => (
                      <motion.div key={i}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid #F4F4F2' }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: `${n.color}1A`, border: `1px solid ${n.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <n.icon size={14} color={n.color} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#2C2C2C', fontWeight: 500 }}>{n.title}</div>
                          <div style={{ fontSize: 11, color: '#7A7A7A', marginTop: 2 }}>{n.meta}</div>
                        </div>
                        <div style={{ fontSize: 10, color: '#A0A0A0', whiteSpace: 'nowrap' }}>{n.time}</div>
                      </motion.div>
                    ))}
                  </div>
                  <button onClick={() => { setNotifOpen(false); navigate('/dashboard/profile') }}
                    style={{ width: '100%', padding: '11px 16px', background: '#F1F5EE', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4F664A', fontWeight: 600 }}>
                    View activity log →
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div style={{ width: 1, height: 24, background: '#E8E8E8' }} />

          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <div onClick={() => setUserMenuOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 10px 4px 4px', borderRadius: 999, transition: 'background 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#F1F5EE'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <div style={{ width: 30, height: 30, background: user?.avatar ? `url(${user.avatar}) center/cover` : '#7D9B76', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'white' }}>
                {!user?.avatar && (user?.name?.[0]?.toUpperCase() || 'U')}
              </div>
              <span style={{ fontSize: 13, color: '#2C2C2C', fontWeight: 500 }}>{user?.name}</span>
              <ChevronDown size={14} color="#7A7A7A" style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            <AnimatePresence>
              {userMenuOpen && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  style={{ position: 'absolute', right: 0, top: 46, width: 220, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 14, boxShadow: '0 12px 32px rgba(0,0,0,0.10)', zIndex: 200, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #E8E8E8' }}>
                    <div style={{ fontSize: 13, color: '#2C2C2C', fontWeight: 600 }}>{user?.name}</div>
                    <div style={{ fontSize: 11, color: '#7A7A7A', marginTop: 2 }}>{user?.email}</div>
                  </div>
                  {[
                    { icon: UserIcon, label: 'My Profile',   fn: () => navigate('/dashboard/profile') },
                    { icon: Settings, label: 'Settings',     fn: () => navigate('/dashboard/settings') },
                    { icon: Building2, label: 'Organisation', fn: () => navigate('/dashboard/settings') },
                  ].map(({ icon: I, label, fn }) => (
                    <button key={label} onClick={() => { setUserMenuOpen(false); fn() }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', color: '#5A5A5A', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#F1F5EE'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <I size={14} color="#7D9B76" /> {label}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid #E8E8E8' }}>
                    <button onClick={() => { setUserMenuOpen(false); handleLogout() }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', color: '#9B2C2C', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#FBEDED'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <LogOut size={14} /> Logout
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          style={{ flex: 1, overflowY: 'auto', padding: '28px', background: '#FBFBFA' }}>
          {children}
        </motion.main>
      </div>
    </div>
  )
}
