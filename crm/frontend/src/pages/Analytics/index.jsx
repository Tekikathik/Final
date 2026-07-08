import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area, Legend, Line,
} from 'recharts'
import { TrendingUp, Phone, Users, BarChart3, MapPin, Award, Target, Bot } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import api from '../../lib/api'
import { useStore } from '../../store/useStore'
import { getCalls as getPriyaCalls } from '../../lib/priyaApi'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED } from '../../theme'
const TOOLTIP = { background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }

const COLORS = [SAGE, AMBER, SAGE_DARK, AMBER_DARK, SAGE_LIGHT]
const DAYS_OPTIONS = [7, 30, 90]

const MOCK_FUNNEL = [
  { stage: 'Called',           value: 749, fill: SAGE },
  { stage: 'Connected',        value: 524, fill: AMBER },
  { stage: 'Interested',       value: 253, fill: SAGE_DARK },
  { stage: 'High Probability', value: 118, fill: AMBER_DARK },
]

const MOCK_SENTIMENT = [
  { day: '04-28', positive: 22, neutral: 14, negative: 6 },
  { day: '04-29', positive: 18, neutral: 19, negative: 8 },
  { day: '04-30', positive: 31, neutral: 12, negative: 4 },
  { day: '05-01', positive: 27, neutral: 16, negative: 5 },
  { day: '05-02', positive: 35, neutral: 10, negative: 3 },
  { day: '05-03', positive: 41, neutral: 14, negative: 7 },
  { day: '05-04', positive: 38, neutral: 11, negative: 4 },
]

export default function Analytics() {
  const { colleges, chartData, fetchChartData, students, loadDummyData } = useStore()
  const [days, setDays] = useState(7)
  const [overview, setOverview] = useState(null)
  const [funnel, setFunnel] = useState(MOCK_FUNNEL)
  const [sentimentTrend, setSentimentTrend] = useState(MOCK_SENTIMENT)
  const [priyaCalls, setPriyaCalls] = useState([])

  useEffect(() => {
    if (!students || students.length === 0) loadDummyData()
    getPriyaCalls().then(d => setPriyaCalls(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const cityData = useMemo(() => {
    const counts = {}
    ;(students || []).forEach(s => {
      const c = s.currentCity || 'Unknown'
      counts[c] = (counts[c] || 0) + 1
    })
    return Object.entries(counts)
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [students])

  const probabilityDist = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${i * 10 + 9}`, count: 0,
    }))
    ;(students || []).forEach(s => {
      const idx = Math.min(9, Math.floor((s.enrollmentProbability || 0) / 10))
      buckets[idx].count += 1
    })
    return buckets
  }, [students])

  const durationBySentiment = useMemo(() => {
    const totals = { positive: { sum: 0, n: 0 }, neutral: { sum: 0, n: 0 }, negative: { sum: 0, n: 0 } }
    ;(students || []).forEach(s => {
      if (!s.duration || !s.sentiment) return
      totals[s.sentiment].sum += s.duration
      totals[s.sentiment].n += 1
    })
    return Object.entries(totals).map(([label, { sum, n }]) => ({
      sentiment: label.charAt(0).toUpperCase() + label.slice(1),
      avg: n ? Math.round(sum / n) : 0,
    }))
  }, [students])

  useEffect(() => {
    fetchChartData(days)
    api.get('/analytics/overview', { params: { days } })
      .then(r => setOverview(r.data)).catch(() => {})
    api.get('/analytics/funnel')
      .then(r => r.data?.length ? setFunnel(r.data.map((d, i) => ({ ...d, fill: COLORS[i] }))) : null)
      .catch(() => {})
    api.get('/analytics/sentiment-trend', { params: { days } })
      .then(r => r.data?.length ? setSentimentTrend(r.data) : null)
      .catch(() => {})
  }, [days])

  const overviewLocal = useMemo(() => {
    if (overview && overview.total) return overview
    const list = students || []
    return {
      total:      list.length,
      completed:  list.filter(s => s.status === 'completed').length,
      interested: list.filter(s => s.interested === true).length,
      enrolled:   list.filter(s => s.interested && s.enrollmentProbability >= 75).length,
    }
  }, [overview, students])

  const funnelLocal = useMemo(() => {
    if (funnel && funnel !== MOCK_FUNNEL) return funnel
    const list = students || []
    if (!list.length) return funnel
    const called = list.length
    const connected = list.filter(s => s.status === 'completed' || s.status === 'in_progress').length
    const interested = list.filter(s => s.interested === true).length
    const high = list.filter(s => s.interested && s.enrollmentProbability >= 75).length
    return [
      { stage: 'Called',           value: called,    fill: SAGE },
      { stage: 'Connected',        value: connected, fill: AMBER },
      { stage: 'Interested',       value: interested, fill: SAGE_DARK },
      { stage: 'High Probability', value: high,      fill: AMBER_DARK },
    ]
  }, [funnel, students])

  const collegeCompare = colleges.map(c => ({
    name:     c.code || c.name?.split(' ')[0],
    calls:    c.calls    || 0,
    leads:    c.leads    || 0,
    enrolled: c.enrolled || 0,
    rate:     c.calls > 0 ? Math.round((c.leads / c.calls) * 100) : 0,
  }))

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>Analytics</h1>
            <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 4 }}>Deep performance insights across all campaigns</p>
          </div>
          <div style={{ display: 'flex', gap: 4, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 999, padding: 4 }}>
            {DAYS_OPTIONS.map(d => (
              <button key={d} onClick={() => setDays(d)}
                style={{ padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: days === d ? SAGE : 'transparent', color: days === d ? '#FFFFFF' : INK_BODY, transition: 'all 0.2s' }}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[
            { icon: Phone,      label: 'Total Calls',       value: overviewLocal.total,      color: SAGE,      change: 18 },
            { icon: TrendingUp, label: 'Connected',         value: overviewLocal.completed,  color: AMBER,     change: 12 },
            { icon: Users,      label: 'Interested Leads',  value: overviewLocal.interested, color: SAGE_DARK, change: 24 },
            { icon: BarChart3,  label: 'High Probability',  value: overviewLocal.enrolled,   color: AMBER_DARK, change: 31 },
          ].map(({ icon: Icon, label, value, color, change }, i) => (
            <motion.div key={label} className="stat-card"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              whileHover={{ y: -3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: `${color}1A`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} color={color} />
                </div>
                <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600 }}>↑ {change}%</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 600, color: INK, letterSpacing: -1 }}>{value}</div>
              <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 4 }}>{label}</div>
            </motion.div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Daily Trend</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Calls, leads and enrollment over {days} days</div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={SAGE} stopOpacity={0.35} /><stop offset="95%" stopColor={SAGE} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gL2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={AMBER} stopOpacity={0.35} /><stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="day" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12, color: INK_BODY }} />
                <Area type="monotone" dataKey="calls" stroke={SAGE}  fill="url(#gC)" strokeWidth={2} name="Calls" />
                <Area type="monotone" dataKey="leads" stroke={AMBER} fill="url(#gL2)" strokeWidth={2} name="Leads" />
                <Line type="monotone" dataKey="enrolled" stroke={SAGE_DARK} strokeWidth={2} dot={false} name="Enrolled" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Lead Funnel</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 20 }}>Conversion at each stage</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {funnelLocal.map((f, i) => {
                const maxVal = funnelLocal[0]?.value || 1
                const pct = Math.round((f.value / maxVal) * 100)
                return (
                  <div key={f.stage}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                      <span style={{ color: INK_BODY }}>{f.stage}</span>
                      <span style={{ color: f.fill, fontWeight: 700 }}>{f.value}</span>
                    </div>
                    <div style={{ height: 30, background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 8, overflow: 'hidden' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, delay: i * 0.15 }}
                        style={{ height: '100%', background: f.fill, borderRadius: 8, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
                        <span style={{ fontSize: 11, color: 'white', fontWeight: 600 }}>{pct}%</span>
                      </motion.div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Sentiment Trend</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Daily sentiment distribution</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sentimentTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="day" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12, color: INK_BODY }} />
                <Bar dataKey="positive" stackId="s" fill={SAGE_DARK} name="Positive" />
                <Bar dataKey="neutral"  stackId="s" fill={AMBER} name="Neutral" />
                <Bar dataKey="negative" stackId="s" fill="#9B2C2C" radius={[4, 4, 0, 0]} name="Negative" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>College Comparison</div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Performance across colleges</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={collegeCompare}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="name" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12, color: INK_BODY }} />
                <Bar dataKey="calls" fill={SAGE}  radius={[4, 4, 0, 0]} name="Calls" />
                <Bar dataKey="leads" fill={AMBER} radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Target size={15} color={AMBER_DARK} />
              <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>Lead Score Distribution</span>
            </div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>How students cluster across enrollment probability</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={probabilityDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="range" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 10 }} />
                <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {probabilityDist.map((d, i) => {
                    const color = i < 4 ? '#9B2C2C' : i < 7 ? AMBER : SAGE_DARK
                    return <Cell key={i} fill={color} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Award size={15} color={SAGE_DARK} />
              <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>Avg Duration · Sentiment</span>
            </div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Are positive calls longer?</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={durationBySentiment} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" horizontal={false} />
                <XAxis type="number" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} unit="s" />
                <YAxis dataKey="sentiment" type="category" stroke="#C7C7C7" tick={{ fill: INK_BODY, fontSize: 11 }} width={70} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => [`${v}s`, 'Avg duration']} />
                <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                  {durationBySentiment.map((d, i) => {
                    const palette = { Positive: SAGE_DARK, Neutral: AMBER, Negative: '#9B2C2C' }
                    return <Cell key={i} fill={palette[d.sentiment] || SAGE} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <MapPin size={15} color={SAGE} />
              <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>Top Source Cities</span>
            </div>
            <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Where students are calling from</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 230, overflowY: 'auto' }}>
              {cityData.map((c, i) => {
                const max = cityData[0]?.count || 1
                const pct = Math.round((c.count / max) * 100)
                return (
                  <div key={c.city} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: INK_BODY, minWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.city}</span>
                    <div style={{ flex: 1, height: 8, background: '#F1F5EE', borderRadius: 4, overflow: 'hidden' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: i * 0.04 }}
                        style={{ height: '100%', background: `linear-gradient(90deg, ${SAGE}, ${AMBER})`, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, color: INK, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>{c.count}</span>
                  </div>
                )
              })}
              {cityData.length === 0 && (
                <div style={{ fontSize: 12, color: INK_MUTED, textAlign: 'center', padding: 20 }}>No city data yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Priya AI Call Analytics */}
        {priyaCalls.length > 0 && (() => {
          const completed  = priyaCalls.filter(c => c.status === 'completed').length
          const withDur    = priyaCalls.filter(c => c.duration > 0)
          const avgDur     = withDur.length ? Math.round(withDur.reduce((s, c) => s + c.duration, 0) / withDur.length) : 0
          const avgSteps   = Math.round(priyaCalls.reduce((s, c) => s + (c.steps_completed || 0), 0) / priyaCalls.length)
          const langCounts = priyaCalls.reduce((acc, c) => { const l = c.detected_language || 'unknown'; acc[l] = (acc[l] || 0) + 1; return acc }, {})
          const langData   = Object.entries(langCounts).map(([lang, count]) => ({ lang: lang === 'en-IN' ? 'English' : lang === 'te-IN' ? 'Telugu' : lang === 'hi-IN' ? 'Hindi' : lang, count }))
          const stepDist   = Array.from({ length: 12 }, (_, i) => ({ step: i, count: priyaCalls.filter(c => (c.steps_completed || 0) === i).length }))
          const STEP_NAMES = ['Greeting','Name','10th','Inter','Course','Fee','Exam','Scholar','Location','Transport','Queries','End']
          return (
            <div style={{ marginTop: 24, marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ width: 36, height: 36, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot size={18} color={SAGE_DARK} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: INK }}>Priya AI Call Performance</div>
                  <div style={{ fontSize: 13, color: INK_MUTED }}>Live data from Priya outbound calling system</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
                {[
                  { label: 'Total Priya Calls', value: priyaCalls.length, color: SAGE },
                  { label: 'Completed',          value: completed,         color: SAGE_DARK },
                  { label: 'Avg Duration',       value: `${avgDur}s`,      color: AMBER },
                  { label: 'Avg Steps Done',     value: avgSteps,          color: AMBER_DARK },
                ].map(({ label, value, color }) => (
                  <motion.div key={label} className="stat-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -3 }}>
                    <div style={{ width: 4, height: 28, background: color, borderRadius: 2, marginBottom: 12 }} />
                    <div style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -1 }}>{value}</div>
                    <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 4 }}>{label}</div>
                  </motion.div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginBottom: 4 }}>Step Completion Distribution</div>
                  <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>How far each call progresses through Priya's script</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stepDist}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                      <XAxis dataKey="step" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 10 }} tickFormatter={i => STEP_NAMES[i] || i} />
                      <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP} labelFormatter={i => STEP_NAMES[i] || `Step ${i}`} />
                      <Bar dataKey="count" radius={[4,4,0,0]}>
                        {stepDist.map((_, i) => <Cell key={i} fill={i >= 10 ? SAGE_DARK : i >= 6 ? SAGE : AMBER} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginBottom: 4 }}>Language Distribution</div>
                  <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Detected language in Priya calls</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {langData.map((l, i) => {
                      const pct = Math.round((l.count / priyaCalls.length) * 100)
                      return (
                        <div key={l.lang}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                            <span style={{ color: INK_BODY, fontWeight: 500 }}>{l.lang}</span>
                            <span style={{ color: SAGE_DARK, fontWeight: 700 }}>{l.count} ({pct}%)</span>
                          </div>
                          <div style={{ height: 28, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 8, overflow: 'hidden' }}>
                            <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: i * 0.1 }}
                              style={{ height: '100%', background: COLORS[i % COLORS.length], borderRadius: 8 }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #F4F4F2' }}>
                    <div style={{ fontSize: 12, color: INK_MUTED, marginBottom: 8 }}>Recent Priya Calls</div>
                    {priyaCalls.slice(0, 3).map(c => (
                      <div key={c.session_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F4F4F2', fontSize: 12 }}>
                        <span style={{ color: INK, fontWeight: 500 }}>{c.name || c.phone}</span>
                        <span style={{ color: c.status === 'completed' ? SAGE_DARK : c.status === 'failed' ? '#9B2C2C' : AMBER_DARK, fontWeight: 600, textTransform: 'capitalize' }}>{c.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '18px 26px', borderBottom: '1px solid #E8E8E8' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>College Leaderboard</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FBFBFA' }}>
                {['Rank', 'College', 'Calls', 'Leads', 'Lead Rate', 'Enrolled'].map(h => (
                  <th key={h} style={{ padding: '12px 22px', textAlign: 'left', fontSize: 12, color: INK_MUTED, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collegeCompare.sort((a, b) => b.rate - a.rate).map((c, i) => (
                <motion.tr key={c.name}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  style={{ borderBottom: '1px solid #F4F4F2' }}>
                  <td style={{ padding: '14px 22px', fontSize: 13, color: i === 0 ? AMBER_DARK : INK_MUTED, fontWeight: 700 }}>#{i + 1}</td>
                  <td style={{ padding: '14px 22px', fontSize: 13, color: INK, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '14px 22px', fontSize: 13, color: INK_BODY }}>{c.calls}</td>
                  <td style={{ padding: '14px 22px', fontSize: 13, color: INK_BODY }}>{c.leads}</td>
                  <td style={{ padding: '14px 22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: '#F1F5EE', borderRadius: 3 }}>
                        <div style={{ width: `${c.rate}%`, height: '100%', background: `linear-gradient(90deg, ${SAGE}, ${AMBER})`, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600, minWidth: 36 }}>{c.rate}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 22px', fontSize: 13, color: SAGE_DARK, fontWeight: 600 }}>{c.enrolled}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}
