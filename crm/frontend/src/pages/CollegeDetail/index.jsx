import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  ArrowLeft, Building2, MapPin, Phone, TrendingUp, Users,
  CheckCircle, XCircle, BarChart3, Eye, ChevronRight,
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'
import { getStudentsByCollege } from '../../lib/dummyData'

// Heuristic: Mongo ObjectIds are 24 hex characters. Dummy seed IDs look like
// "col-aditya-univ". Use this to decide whether to ask the backend for the
// college's calls or just slice the static dummy dataset.
const isMongoId = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s)

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

const PIE_COLORS = [SAGE, AMBER, SAGE_LIGHT, AMBER_DARK, SAGE_DARK]
const TOOLTIP = { background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }

export default function CollegeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { colleges, fetchColleges, calls, fetchCalls } = useStore()

  useEffect(() => {
    if (!colleges || colleges.length === 0) fetchColleges()
  }, [])

  // Pull this college's calls into the store. fetchCalls already handles the
  // backend → dummy fallback, so we just consume `calls` below.
  useEffect(() => {
    if (id) fetchCalls(id)
  }, [id])

  const college = colleges.find(c => (c._id || c.id) === id)

  // Backend-sourced colleges arrive with Mongo ObjectIds, which never match
  // the dummy seed IDs (e.g. "col-aditya-univ"). For those we trust the store
  // (populated by fetchCalls). For the dummy seed IDs the synchronous slice
  // is fine and avoids a flash of empty state on first render.
  // When fetchCalls switches colleges the store briefly holds the previous
  // college's calls — filter so the page never shows another college's data.
  const matchingCalls = useMemo(() => {
    return (calls || []).filter((c) => {
      const cid = c?.collegeId && typeof c.collegeId === 'object'
        ? (c.collegeId._id || c.collegeId.id)
        : c?.collegeId
      return cid === id
    })
  }, [id, calls])

  const students = useMemo(() => {
    if (isMongoId(id)) return matchingCalls
    const seeded = getStudentsByCollege(id)
    return seeded.length ? seeded : matchingCalls
  }, [id, matchingCalls])

  const stats = useMemo(() => {
    const total      = students.length
    const completed  = students.filter(s => s.status === 'completed').length
    const interested = students.filter(s => s.interested === true).length
    const enrolled   = students.filter(s => s.interested && s.enrollmentProbability >= 75).length
    const failed     = students.filter(s => s.status === 'failed' || s.status === 'no_answer').length
    return { total, completed, interested, enrolled, failed }
  }, [students])

  const statusData = useMemo(() => {
    const counts = {}
    students.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1 })
    return Object.entries(counts).map(([k, v]) => ({ name: k.replace('_', ' '), value: v }))
  }, [students])

  const sentimentData = useMemo(() => {
    const completed = students.filter(s => s.sentiment)
    const counts = { positive: 0, neutral: 0, negative: 0 }
    completed.forEach(s => { counts[s.sentiment] = (counts[s.sentiment] || 0) + 1 })
    return [
      { name: 'Positive', value: counts.positive, color: SAGE_DARK },
      { name: 'Neutral',  value: counts.neutral,  color: AMBER },
      { name: 'Negative', value: counts.negative, color: '#9B2C2C' },
    ]
  }, [students])

  const courseData = useMemo(() => {
    const counts = {}
    students.forEach(s => {
      const c = s.courseInterested || 'Unknown'
      counts[c] = (counts[c] || 0) + 1
    })
    return Object.entries(counts)
      .map(([course, count]) => ({ course: course.length > 22 ? course.slice(0, 20) + '…' : course, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [students])

  const trendData = useMemo(() => {
    const days = 14
    const buckets = {}
    for (let i = 0; i < days; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      buckets[key] = { day: key.slice(5), calls: 0, leads: 0 }
    }
    for (const s of students) {
      const key = (s.createdAt || '').slice(0, 10)
      if (!buckets[key]) continue
      buckets[key].calls += 1
      if (s.interested) buckets[key].leads += 1
    }
    return Object.keys(buckets).sort().map(k => buckets[k])
  }, [students])

  const passFail = useMemo(() => {
    const reached = students.filter(s => s.status === 'completed').length || 1
    const passed  = students.filter(s => s.interested === true).length
    const failed  = reached - passed
    return [
      { name: 'Converted',     value: passed, color: SAGE_DARK },
      { name: 'Not Converted', value: failed, color: '#C7C7C7' },
    ]
  }, [students])

  if (!college) {
    return (
      <DashboardLayout>
        <div style={{ maxWidth: 1100, margin: '60px auto', textAlign: 'center', color: INK_MUTED }}>
          <Building2 size={48} color="#C7C7C7" style={{ marginBottom: 16 }} />
          <p>College not found.</p>
          <button className="btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/dashboard/colleges')}>Back to Colleges</button>
        </div>
      </DashboardLayout>
    )
  }

  const leadRate = stats.total ? Math.round((stats.interested / stats.total) * 100) : 0
  const enrollmentRate = stats.total ? Math.round((stats.enrolled / stats.total) * 100) : 0

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: INK_MUTED }}>
          <span style={{ cursor: 'pointer', color: SAGE_DARK, fontWeight: 500 }} onClick={() => navigate('/dashboard')}>Dashboard</span>
          <ChevronRight size={13} />
          <span style={{ cursor: 'pointer', color: SAGE_DARK, fontWeight: 500 }} onClick={() => navigate('/dashboard/colleges')}>Colleges</span>
          <ChevronRight size={13} />
          <span>{college.name}</span>
        </div>

        <button onClick={() => navigate('/dashboard/colleges')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16, padding: 0, fontFamily: 'inherit' }}>
          <ArrowLeft size={14} /> Back to all colleges
        </button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div style={{ width: 60, height: 60, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Building2 size={28} color={SAGE_DARK} />
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>{college.name}</h1>
            <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} /> {college.location || '—'}
              </span>
              {college.code && (
                <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600, background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 999, padding: '3px 12px' }}>{college.code}</span>
              )}
              <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>● Active</span>
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13 }}
              onClick={() => navigate(`/dashboard/college/${id}`)}>
              <BarChart3 size={14} /> Open Full Dashboard
            </button>
          </div>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[
            { icon: Users,       label: 'Total Students',     value: stats.total,      color: SAGE },
            { icon: Phone,       label: 'Calls Completed',    value: stats.completed,  color: AMBER },
            { icon: TrendingUp,  label: 'Interested Leads',   value: stats.interested, color: SAGE_DARK },
            { icon: CheckCircle, label: 'Enrolled',           value: stats.enrolled,   color: AMBER_DARK },
            { icon: XCircle,     label: 'Failed / No Answer', value: stats.failed,     color: '#9B2C2C' },
          ].map((s, i) => (
            <motion.div key={s.label} className="stat-card"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              whileHover={{ y: -3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: `${s.color}1A`, border: `1px solid ${s.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <s.icon size={18} color={s.color} />
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -1 }}>{s.value}</div>
              <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 4 }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {[
            { label: 'Lead Conversion Rate',       pct: leadRate,       color: SAGE,  sub: `${stats.interested} of ${stats.total} students interested` },
            { label: 'Enrollment Conversion Rate', pct: enrollmentRate, color: AMBER, sub: `${stats.enrolled} of ${stats.total} enrolled` },
          ].map((card, i) => (
            <motion.div key={card.label} className="glass-card" style={{ borderRadius: 16, padding: 26 }}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.1 }}>
              <div style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, fontWeight: 500 }}>{card.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 40, fontWeight: 600, color: card.color, letterSpacing: -1.5 }}>{card.pct}%</span>
              </div>
              <div style={{ height: 8, background: '#F1F5EE', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${card.pct}%` }} transition={{ duration: 1 }}
                  style={{ height: '100%', background: card.color, borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 12, color: INK_MUTED }}>{card.sub}</div>
            </motion.div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>14-Day Activity</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Calls and leads over the last two weeks</div>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="cdCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={SAGE}  stopOpacity={0.35} />
                    <stop offset="95%" stopColor={SAGE}  stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cdLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={AMBER} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="day" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12, color: INK_BODY }} />
                <Area type="monotone" dataKey="calls" stroke={SAGE}  fill="url(#cdCalls)" strokeWidth={2} name="Calls" />
                <Area type="monotone" dataKey="leads" stroke={AMBER} fill="url(#cdLeads)" strokeWidth={2} name="Leads" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Call Status Mix</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Distribution by status</div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                  {statusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {statusData.map((d, i) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span style={{ fontSize: 12, color: INK_BODY, flex: 1, textTransform: 'capitalize' }}>{d.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Top Course Interests</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>What students are asking about most</div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={courseData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" horizontal={false} />
                <XAxis type="number" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis dataKey="course" type="category" stroke="#C7C7C7" tick={{ fill: INK_BODY, fontSize: 11 }} width={150} />
                <Tooltip contentStyle={TOOLTIP} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} fill={SAGE} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Sentiment</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Across completed calls</div>
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={sentimentData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                  {sentimentData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sentimentData.map((d) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                  <span style={{ fontSize: 12, color: INK_BODY, flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Pass / Fail</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Lead conversion outcome</div>
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={passFail} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                  {passFail.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {passFail.map((d) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                  <span style={{ fontSize: 12, color: INK_BODY, flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '18px 24px', borderBottom: '1px solid #E8E8E8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Recent Students</div>
              <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }}>Latest 10 contacts for this college</div>
            </div>
            <button className="pill-outline" onClick={() => navigate(`/dashboard/college/${id}`)}>
              <Eye size={13} /> View All
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FBFBFA' }}>
                  {['Student', 'Course Interest', 'Status', 'Sentiment', 'Probability'].map(h => (
                    <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 12, color: INK_MUTED, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...students]
                  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                  .slice(0, 10)
                  .map((s, i) => (
                    <motion.tr key={s._id}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      style={{ borderBottom: '1px solid #F4F4F2' }}>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: INK_MUTED }}>{s.phone}</div>
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 12, color: INK_BODY }}>{s.courseInterested}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span className={
                          s.status === 'completed' ? 'badge-success'
                          : s.status === 'failed' || s.status === 'no_answer' ? 'badge-error'
                          : s.status === 'in_progress' ? 'badge-info'
                          : 'badge-warning'
                        }>{s.status.replace('_', ' ')}</span>
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                        color: s.sentiment === 'positive' ? SAGE_DARK : s.sentiment === 'negative' ? '#9B2C2C' : AMBER_DARK }}>
                        {s.sentiment || '—'}
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 5, maxWidth: 100, background: '#F1F5EE', borderRadius: 3 }}>
                            <div style={{ width: `${s.enrollmentProbability}%`, height: '100%',
                              background: s.enrollmentProbability >= 70 ? SAGE_DARK : s.enrollmentProbability >= 40 ? AMBER : '#9B2C2C',
                              borderRadius: 3 }} />
                          </div>
                          <span style={{ color: INK_BODY, fontWeight: 600, minWidth: 32 }}>{s.enrollmentProbability}%</span>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
              </tbody>
            </table>
            {students.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: INK_MUTED, fontSize: 14 }}>
                No students yet for this college.
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
