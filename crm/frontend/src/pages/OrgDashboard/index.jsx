import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { gsap } from 'gsap'
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { Building2, Phone, TrendingUp, Users, Plus, Eye, MoreVertical, Search, RefreshCw, BarChart3, Copy } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

const stagger = (i) => ({ delay: i * 0.1 })

function AnimatedCounter({ target, duration = 1.5, prefix = '', suffix = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !target) return
    gsap.fromTo({ val: 0 }, { val: target }, {
      duration, ease: 'power2.out',
      onUpdate: function () { if (ref.current) ref.current.textContent = prefix + Math.round(this.targets()[0].val).toLocaleString() + suffix }
    })
  }, [target])
  return <span ref={ref}>{prefix}0{suffix}</span>
}

function StatCard({ icon: Icon, label, value, change, color, delay = 0 }) {
  return (
    <motion.div className="stat-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} whileHover={{ y: -3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}1A`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={color} />
        </div>
        {change !== undefined && <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600 }}>↑ {change}%</span>}
      </div>
      <div style={{ fontSize: 32, fontWeight: 600, color: INK, letterSpacing: -1, lineHeight: 1 }}>
        <AnimatedCounter target={value} />
      </div>
      <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 6 }}>{label}</div>
    </motion.div>
  )
}

function CollegeCard({ college, onView, onOpenAnalytics, onCopyId, delay = 0 }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pct = college.calls > 0 ? Math.round((college.leads / college.calls) * 100) : 0
  return (
    <motion.div className="glass-card" style={{ borderRadius: 14, padding: 22, position: 'relative' }}
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
      whileHover={{ y: -3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Building2 size={19} color={SAGE_DARK} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{college.name}</div>
            <div style={{ fontSize: 12, color: INK_MUTED }}>{college.location} {college.code ? `• ${college.code}` : ''}</div>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            aria-label="College actions"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: INK_MUTED, transition: 'background 0.2s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#F4F4F2'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <MoreVertical size={16} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  style={{ position: 'absolute', right: 0, top: 28, minWidth: 210, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.10)', zIndex: 50, overflow: 'hidden' }}>
                  {[
                    { icon: Eye,        label: 'Open campaign view', fn: () => onView(college) },
                    { icon: BarChart3,  label: 'View analytics',     fn: () => onOpenAnalytics(college) },
                    { icon: Copy,       label: 'Copy college ID',    fn: () => onCopyId(college) },
                  ].map(({ icon: I, label, fn }) => (
                    <button key={label} onClick={() => { setMenuOpen(false); fn() }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'transparent', border: 'none', color: INK_BODY, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#F1F5EE'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <I size={14} color={SAGE} /> {label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Calls',    value: college.calls    || 0, color: SAGE },
          { label: 'Leads',    value: college.leads    || 0, color: AMBER },
          { label: 'Enrolled', value: college.enrolled || 0, color: SAGE_DARK },
        ].map(m => (
          <div key={m.label} style={{ textAlign: 'center', padding: '10px 4px', background: '#FBFBFA', borderRadius: 8, border: '1px solid #F4F4F2' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: m.color }}>{m.value}</div>
            <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: INK_MUTED }}>Lead Rate</span>
          <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600 }}>{pct}%</span>
        </div>
        <div style={{ height: 5, background: '#F1F5EE', borderRadius: 3 }}>
          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, delay: 0.3 }}
            style={{ height: '100%', background: `linear-gradient(90deg, ${SAGE}, ${AMBER})`, borderRadius: 3 }} />
        </div>
      </div>
      <button className="pill-preview" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onView(college)}>
        <Eye size={14} /> View Dashboard
      </button>
    </motion.div>
  )
}

export default function OrgDashboard() {
  const navigate = useNavigate()
  const { colleges, chartData, fetchColleges, fetchChartData, addCollege } = useStore()
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCollege, setNewCollege] = useState({ name: '', code: '', location: '' })
  const [addError, setAddError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState(null)

  const flashToast = useCallback((text) => {
    setToast(text)
    setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    fetchColleges()
    fetchChartData()
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchColleges(), fetchChartData()])
    setRefreshing(false)
  }

  const filtered = colleges.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.location?.toLowerCase().includes(search.toLowerCase())
  )

  const totalCalls    = colleges.reduce((s, c) => s + (c.calls    || 0), 0)
  const totalLeads    = colleges.reduce((s, c) => s + (c.leads    || 0), 0)
  const totalEnrolled = colleges.reduce((s, c) => s + (c.enrolled || 0), 0)

  // Call-outcome funnel (breaks down ALL calls, so the slices sum to Total Calls):
  //   Enrolled ⊂ Interested-lead ⊂ Total calls.  "Not interested" = calls that
  //   never became a lead (totalCalls − totalLeads). Earlier this slice was
  //   mislabeled a "lead funnel", which made 708 look larger than Total Leads.
  const interestedLeads = Math.max(0, totalLeads - totalEnrolled)
  const notInterested   = Math.max(0, totalCalls - totalLeads)
  const pieData = [
    { name: 'Enrolled',        value: totalEnrolled },
    { name: 'Interested lead', value: interestedLeads },
    { name: 'Not interested',  value: notInterested },
  ]
  const pieTotal   = pieData.reduce((s, d) => s + d.value, 0)
  const pieDisplay = pieTotal > 0 ? pieData : [{ name: 'No calls yet', value: 1 }]

  const handleAddCollege = async () => {
    if (!newCollege.name.trim() || !newCollege.code.trim()) { setAddError('Name and code are required'); return }
    setAddError('')
    const result = await addCollege(newCollege)
    if (result?.ok) { setNewCollege({ name: '', code: '', location: '' }); setShowAddModal(false) }
    else setAddError(result?.message || 'Failed to add college')
  }

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>Organisation Overview</h1>
            <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 4 }}>Monitor all colleges and campaigns</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', fontSize: 13 }} onClick={refresh}>
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh
            </button>
            <motion.button whileTap={{ scale: 0.97 }} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px' }} onClick={() => setShowAddModal(true)}>
              <Plus size={16} /> Add College
            </motion.button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
          <StatCard icon={Building2}  label="Total Colleges"     value={colleges.length} change={12} color={SAGE}      delay={0} />
          <StatCard icon={Phone}      label="Total Calls"        value={totalCalls}      change={18} color={AMBER}     delay={0.1} />
          <StatCard icon={TrendingUp} label="Total Leads"        value={totalLeads}      change={24} color={SAGE_DARK} delay={0.2} />
          <StatCard icon={Users}      label="Enrolled Students"  value={totalEnrolled}   change={31} color={AMBER_DARK} delay={0.3} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 28 }}>
          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 24 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Weekly Performance</div>
              <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 2 }}>Calls, leads, and enrollments</div>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SAGE} stopOpacity={0.35} /><stop offset="95%" stopColor={SAGE} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={AMBER} stopOpacity={0.35} /><stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="day" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 12 }} />
                <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 12 }} />
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }} />
                <Legend wrapperStyle={{ fontSize: 13, color: INK_BODY }} />
                <Area type="monotone" dataKey="calls" stroke={SAGE}  fill="url(#gCalls)" strokeWidth={2} name="Calls" />
                <Area type="monotone" dataKey="leads" stroke={AMBER} fill="url(#gLeads)" strokeWidth={2} name="Leads" />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 24 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Call Outcomes</div>
              <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 2 }}>How all {totalCalls.toLocaleString()} calls converted</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieDisplay} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {pieDisplay.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pieDisplay.map((d, i) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: INK_BODY, flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{d.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: INK }}>Colleges ({filtered.length})</h2>
            <div style={{ position: 'relative' }}>
              <Search size={14} color={INK_MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input className="input-dark" style={{ paddingLeft: 34, width: 280, padding: '9px 12px 9px 34px' }} placeholder="Search colleges..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {filtered.map((college, i) => (
              <CollegeCard key={college._id || college.id} college={college} delay={i * 0.06}
                onView={c => navigate(`/dashboard/college/${c._id || c.id}`)}
                onOpenAnalytics={c => navigate(`/dashboard/colleges/${c._id || c.id}`)}
                onCopyId={c => {
                  const id = c._id || c.id
                  navigator.clipboard?.writeText(id).catch(() => {})
                  flashToast(`Copied college ID: ${id}`)
                }} />
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: INK_MUTED }}>
                <Building2 size={42} color="#C7C7C7" style={{ margin: '0 auto 12px' }} />
                <p>No colleges found. Add your first college to get started.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(44,44,44,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24, backdropFilter: 'blur(2px)' }}
            onClick={e => e.target === e.currentTarget && setShowAddModal(false)}>
            <motion.div initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="glass-card" style={{ width: '100%', maxWidth: 460, borderRadius: 22, padding: 36 }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, color: INK, marginBottom: 6 }}>Add New College</h3>
              <p style={{ fontSize: 13, color: INK_MUTED, marginBottom: 24 }}>Add a college to start managing admissions.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>College Name *</label>
                  <input className="input-dark" placeholder="e.g. St. Xavier Engineering College" value={newCollege.name} onChange={e => setNewCollege(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Short Code *</label>
                  <input className="input-dark" placeholder="e.g. SXEC" style={{ textTransform: 'uppercase' }} value={newCollege.code} onChange={e => setNewCollege(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Location</label>
                  <input className="input-dark" placeholder="e.g. Mumbai, Maharashtra" value={newCollege.location} onChange={e => setNewCollege(p => ({ ...p, location: e.target.value }))} />
                </div>
                {addError && <div style={{ padding: '10px 12px', background: '#FBEDED', border: '1px solid #F2C8C8', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{addError}</div>}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>Cancel</button>
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleAddCollege}>Add College</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            style={{ position: 'fixed', bottom: 24, right: 24, padding: '12px 18px', background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 12, color: INK, fontSize: 13, zIndex: 1100, boxShadow: '0 12px 32px rgba(0,0,0,0.10)' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}
