import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  Phone, Plus, Upload, Play, Square, Download,
  Search, ArrowLeft, TrendingUp, CheckCircle, XCircle, BarChart3, Eye, FileText, RefreshCw
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'
import { exportRowsToCsv } from '../../lib/csv'
import { triggerCall as priyaTriggerCall } from '../../lib/priyaApi'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'
const TOOLTIP = { background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }

const statusConfig = {
  completed: { label: 'Completed', badge: 'badge-success' },
  in_progress: { label: 'In Progress', badge: 'badge-info' },
  failed: { label: 'Failed', badge: 'badge-error' },
  scheduled: { label: 'Scheduled', badge: 'badge-warning' },
  no_answer: { label: 'No Answer', badge: 'badge-warning' },
}

const WAVE_HEIGHTS = [12, 30, 50, 22, 42, 65, 28, 48, 18, 55, 35, 48, 25, 60, 38]
function WaveBars({ active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {WAVE_HEIGHTS.map((h, i) => (
        <div key={i} className={active ? 'wave-bar' : ''}
          style={{ width: 2, height: active ? h : h * 0.3, background: `linear-gradient(180deg, ${SAGE}, ${AMBER})`, borderRadius: 2, animationDelay: `${i * 0.07}s` }} />
      ))}
    </div>
  )
}

const mockHourly = [
  { hour: '8am', calls: 8, connected: 5 }, { hour: '9am', calls: 14, connected: 10 },
  { hour: '10am', calls: 22, connected: 17 }, { hour: '11am', calls: 19, connected: 14 },
  { hour: '12pm', calls: 11, connected: 7 }, { hour: '2pm', calls: 24, connected: 19 },
  { hour: '3pm', calls: 28, connected: 22 }, { hour: '4pm', calls: 18, connected: 14 },
]

export default function CollegeDashboard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { colleges, calls, fetchCalls, triggerCampaign, pollCampaign, chartData } = useStore()

  const college = colleges.find(c => (c._id || c.id) === id) || colleges[0]
  const [tab, setTab] = useState('overview')
  const [callingActive, setCallingActive] = useState(false)
  const [campaignId, setCampaignId] = useState(null)
  const [triggerStatus, setTriggerStatus] = useState(null)
  const [newNumber, setNewNumber] = useState('')
  const [numbers, setNumbers] = useState([
    { phone: '+91 98765 43210', name: 'Rahul Sharma' },
    { phone: '+91 87654 32109', name: 'Priya Patel' },
    { phone: '+91 76543 21098', name: 'Amit Kumar' },
  ])
  const [search, setSearch] = useState('')
  const fileRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (id) fetchCalls(id)
  }, [id])

  const filteredCalls = calls.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  )

  const stats = {
    total: calls.length,
    completed: calls.filter(c => c.status === 'completed').length,
    interested: calls.filter(c => c.interested === true).length,
    failed: calls.filter(c => c.status === 'failed' || c.status === 'no_answer').length,
  }

  const triggerCalls = async () => {
    if (!numbers.length) return
    setCallingActive(true)
    const BATCH = 5
    let done = 0
    setTriggerStatus(`Triggering ${numbers.length} Priya AI calls (${BATCH} at a time)…`)

    for (let i = 0; i < numbers.length; i += BATCH) {
      const batch = numbers.slice(i, i + BATCH)
      await Promise.allSettled(batch.map(n => {
        const digits = String(n.phone || '').replace(/\s+/g, '').replace(/^\+?91/, '').replace(/^0/, '')
        const phone  = digits ? `+91${digits}` : n.phone
        return priyaTriggerCall({ phone, name: n.name || 'Student' })
          .catch(err => console.warn('[BulkTrigger] failed:', phone, err.message))
      }))
      done += batch.length
      setTriggerStatus(`Calls triggered: ${Math.min(done, numbers.length)} / ${numbers.length}`)
    }

    setTriggerStatus(`✓ All ${numbers.length} Priya AI calls triggered! Calls will appear below as they complete.`)
    // Refresh the calls list periodically so completed calls (and their reports)
    // show up here without a manual refresh.
    fetchCalls(id)
    let ticks = 0
    const iv = setInterval(() => { fetchCalls(id); if (++ticks >= 18) clearInterval(iv) }, 10000)  // ~3 min
    setTimeout(() => { setCallingActive(false); setTriggerStatus(null) }, 5000)
  }

  const stopCampaign = () => {
    clearInterval(pollRef.current)
    setCallingActive(false)
    setTriggerStatus(null)
  }

  const handleCSV = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const rows = ev.target.result.split('\n').filter(Boolean)
      // Support header row (skip if first cell looks like a label)
      const firstRow = rows[0]?.split(',')[0]?.trim().toLowerCase()
      const dataRows = /^(phone|mobile|number|no)/.test(firstRow) ? rows.slice(1) : rows
      const parsed = dataRows.map(row => {
        const cols = row.split(',')
        return { phone: cols[0]?.trim(), name: cols[1]?.trim() || 'Unknown' }
      }).filter(r => r.phone && r.phone.length >= 7)
      setNumbers(prev => [...prev, ...parsed])
    }
    reader.readAsText(file)
    // Reset input so same file can be re-imported
    e.target.value = ''
  }

  /**
   * Export the calls table as CSV. We export what the user is *currently
   * looking at* — i.e. the search-filtered rows — rather than the raw
   * server dataset. That matches user expectation ("export this view") and
   * works in demo mode where there's no backend.
   *
   * Filename is suffixed with the college code + ISO date so multiple
   * exports don't overwrite each other in the Downloads folder.
   */
  const exportCSV = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const code = (college?.code || college?.name || 'calls').replace(/\s+/g, '-').toLowerCase()
    exportRowsToCsv(
      `admitai-${code}-calls-${stamp}.csv`,
      filteredCalls,
      [
        { key: 'name',       label: 'Name' },
        { key: 'phone',      label: 'Phone' },
        { key: 'status',     label: 'Status' },
        { key: 'duration',   label: 'Duration (s)', format: v => v ?? '' },
        { key: 'sentiment',  label: 'Sentiment',    format: v => v || '' },
        { key: 'interested', label: 'Interested',   format: v => v === true ? 'Yes' : v === false ? 'No' : '' },
        { key: 'createdAt',  label: 'Date',         format: (v, r) => new Date(v || r.date || Date.now()).toISOString() },
        { key: 'campaignId', label: 'Campaign ID',  format: v => v || '' },
      ]
    )
  }

  const TABS = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'calls', label: `Calls (${calls.length})`, icon: Phone },
    { id: 'trigger', label: 'Trigger Campaign', icon: Play },
    { id: 'reports', label: 'Reports', icon: FileText },
  ]

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ marginBottom: 22 }}>
          <button onClick={() => navigate('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 14, padding: 0, fontFamily: 'inherit' }}>
            <ArrowLeft size={14} /> Back to Organisation
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ width: 52, height: 52, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Phone size={24} color={SAGE_DARK} />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 600, color: INK, letterSpacing: -0.5 }}>{college?.name || 'College Dashboard'}</h1>
              <p style={{ color: INK_MUTED, fontSize: 13, marginTop: 2 }}>{college?.location} {college?.code ? `• ${college.code}` : ''} • Admission Officer</p>
            </div>
            {callingActive && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 999, padding: '8px 18px' }}>
                <WaveBars active />
                <span style={{ fontSize: 13, color: SAGE_DARK, fontWeight: 600 }}>Campaign Active</span>
              </motion.div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 12, padding: 4, width: 'fit-content' }}>
          {TABS.map(({ id: tid, label, icon: Icon }) => (
            <button key={tid} onClick={() => setTab(tid)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: tab === tid ? '#F1F5EE' : 'transparent', color: tab === tid ? SAGE_DARK : INK_MUTED, transition: 'all 0.2s' }}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                {[
                  { icon: Phone, label: 'Total Calls', value: stats.total, color: SAGE },
                  { icon: CheckCircle, label: 'Completed', value: stats.completed, color: SAGE_DARK },
                  { icon: TrendingUp, label: 'Interested Leads', value: stats.interested, color: AMBER },
                  { icon: XCircle, label: 'Failed / No Answer', value: stats.failed, color: '#9B2C2C' },
                ].map(({ icon: Icon, label, value, color }, i) => (
                  <motion.div key={label} className="stat-card"
                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                    whileHover={{ y: -3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 11, background: `${color}1A`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={19} color={color} />
                      </div>
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 600, color: INK, letterSpacing: -1 }}>{value}</div>
                    <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 4 }}>{label}</div>
                  </motion.div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Calls by Hour</div>
                  <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Today's activity</div>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={mockHourly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                      <XAxis dataKey="hour" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                      <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                      <Tooltip contentStyle={TOOLTIP} />
                      <Bar dataKey="calls" fill={SAGE} radius={[4, 4, 0, 0]} name="Calls" />
                      <Bar dataKey="connected" fill={AMBER} radius={[4, 4, 0, 0]} name="Connected" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Weekly Lead Trend</div>
                  <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Lead generation this week</div>
                  <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gL" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={SAGE_DARK} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={SAGE_DARK} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                      <XAxis dataKey="day" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                      <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                      <Tooltip contentStyle={TOOLTIP} />
                      <Area type="monotone" dataKey="leads" stroke={SAGE_DARK} fill="url(#gL)" strokeWidth={2} name="Leads" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'calls' && (
            <motion.div key="calls" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <Search size={14} color={INK_MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input className="input-dark" style={{ paddingLeft: 34, padding: '10px 12px 10px 34px' }} placeholder="Search by name or phone..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', fontSize: 13 }} onClick={() => fetchCalls(id)}>
                  <RefreshCw size={14} /> Refresh
                </button>
                <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', fontSize: 13 }} onClick={exportCSV}>
                  <Download size={14} /> Export CSV
                </button>
              </div>
              <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#FBFBFA', borderBottom: '1px solid #E8E8E8' }}>
                        {['Contact', 'Status', 'Duration', 'Sentiment', 'Interest', 'Date', 'Actions'].map(h => (
                          <th key={h} style={{ padding: '13px 16px', textAlign: 'left', fontSize: 12, color: INK_MUTED, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCalls.map((call, i) => {
                        const sc = statusConfig[call.status] || statusConfig.scheduled
                        const dur = call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}` : '—'
                        const callId = call._id || call.id
                        return (
                          <motion.tr key={callId}
                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                            style={{ borderBottom: '1px solid #F4F4F2' }}>
                            <td style={{ padding: '13px 16px' }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: INK }}>{call.name}</div>
                              <div style={{ fontSize: 12, color: INK_MUTED }}>{call.phone}</div>
                            </td>
                            <td style={{ padding: '13px 16px' }}><span className={sc.badge}>{sc.label}</span></td>
                            <td style={{ padding: '13px 16px', fontSize: 13, color: INK_BODY }}>{dur}</td>
                            <td style={{
                              padding: '13px 16px', fontSize: 13, fontWeight: 600,
                              color: call.sentiment === 'positive' ? SAGE_DARK : call.sentiment === 'negative' ? '#9B2C2C' : AMBER_DARK,
                              textTransform: 'capitalize'
                            }}>
                              {call.sentiment || '—'}
                            </td>
                            <td style={{ padding: '13px 16px' }}>
                              {call.interested === true
                                ? <span className="chip-high">High Interest</span>
                                : call.interested === false ? <span style={{ fontSize: 12, color: INK_MUTED }}>Not interested</span>
                                  : <span style={{ color: '#C7C7C7', fontSize: 12 }}>—</span>}
                            </td>
                            <td style={{ padding: '13px 16px', fontSize: 12, color: INK_MUTED }}>
                              {new Date(call.createdAt || call.date).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '13px 16px' }}>
                              <button onClick={() => navigate(`/dashboard/college/${id}/report/${callId}`)} className="pill-outline">
                                <Eye size={13} /> Report
                              </button>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filteredCalls.length === 0 && (
                    <div style={{ padding: 40, textAlign: 'center', color: INK_MUTED, fontSize: 14 }}>
                      No calls yet. Go to "Trigger Campaign" to start calling students.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'trigger' && (
            <motion.div key="trigger" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Student Numbers</div>
                      <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 2 }}>{numbers.length} contacts ready</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="file" ref={fileRef} accept=".csv" style={{ display: 'none' }} onChange={handleCSV} />
                      <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12 }} onClick={() => fileRef.current?.click()}>
                        <Upload size={13} /> Import CSV
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <input className="input-dark" style={{ padding: '10px 12px' }} placeholder="+91 98765 43210 — Name"
                      value={newNumber} onChange={e => setNewNumber(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && newNumber.trim()) { const [phone, ...rest] = newNumber.split('—'); setNumbers(p => [...p, { phone: phone.trim(), name: rest.join('').trim() || 'New Contact' }]); setNewNumber('') } }} />
                    <button className="btn-primary" style={{ padding: '10px 16px', flexShrink: 0 }}
                      onClick={() => { if (newNumber.trim()) { const [phone, ...rest] = newNumber.split('—'); setNumbers(p => [...p, { phone: phone.trim(), name: rest.join('').trim() || 'New Contact' }]); setNewNumber('') } }}>
                      <Plus size={16} />
                    </button>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <AnimatePresence>
                      {numbers.map((n, i) => (
                        <motion.div key={i}
                          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', background: '#FBFBFA', borderRadius: 10, border: '1px solid #F4F4F2' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{n.name}</div>
                            <div style={{ fontSize: 12, color: INK_MUTED }}>{n.phone}</div>
                          </div>
                          <button onClick={() => setNumbers(p => p.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B2C2C', padding: 4 }}>
                            <XCircle size={14} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                  <div style={{ borderTop: '1px solid #E8E8E8', marginTop: 14, paddingTop: 12, fontSize: 12, color: INK_MUTED }}>
                    CSV format: phone,name (header optional)
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="glass-card" style={{ borderRadius: 16, padding: 26 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>Campaign Settings</div>
                    <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 16 }}>Configure AI calling parameters</div>
                    {[
                      { label: 'AI Voice Model', opts: ['AdmitBot v3 (Hindi/English)', 'AdmitBot v3 (English Only)', 'AdmitBot v2 (Tamil/English)'] },
                      { label: 'Call Schedule', opts: ['Immediate', 'Today 2:00 PM', 'Tomorrow 10:00 AM'] },
                      { label: 'Max Concurrent Calls', opts: ['5', '10', '20', '50'] },
                    ].map(({ label, opts }) => (
                      <div key={label} style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 12, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>{label}</label>
                        <select className="input-dark">
                          {opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="glass-card" style={{ borderRadius: 16, padding: 26, textAlign: 'center' }}>
                    {triggerStatus && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        style={{ marginBottom: 16, padding: '12px 14px', background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 12, fontSize: 13, color: SAGE_DARK, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <WaveBars active={callingActive} />
                        <span style={{ textAlign: 'left', flex: 1 }}>{triggerStatus}</span>
                      </motion.div>
                    )}
                    {campaignId && (
                      <div style={{ marginBottom: 12, fontSize: 11, color: INK_MUTED, fontFamily: 'monospace' }}>
                        Campaign ID: {campaignId}
                      </div>
                    )}
                    <div style={{ fontSize: 36, fontWeight: 600, color: INK, marginBottom: 4, letterSpacing: -1 }}>{numbers.length}</div>
                    <div style={{ fontSize: 14, color: INK_MUTED, marginBottom: 24 }}>contacts ready to call</div>
                    <motion.button
                      className={callingActive ? 'btn-secondary' : 'pill-confirm'}
                      style={{ width: '100%', padding: 14, fontSize: 15, justifyContent: 'center' }}
                      whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.02 }}
                      onClick={callingActive ? stopCampaign : triggerCalls}
                      disabled={numbers.length === 0}>
                      {callingActive ? <><Square size={16} /> Stop</> : <><Play size={16} /> Launch Priya AI Calls (5 at a time)</>}
                    </motion.button>
                    <p style={{ fontSize: 12, color: INK_MUTED, marginTop: 10 }}>Triggers Priya outbound calls · 5 concurrent per batch</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
                {calls.filter(c => c.status === 'completed').length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: INK_MUTED }}>
                    <FileText size={42} color="#C7C7C7" style={{ margin: '0 auto 12px' }} />
                    <p>No completed calls yet. Reports appear after calls are processed.</p>
                  </div>
                )}
                {calls.filter(c => c.status === 'completed').map((call, i) => {
                  const callId = call._id || call.id
                  return (
                    <motion.div key={callId} className="glass-card" style={{ borderRadius: 14, padding: 22 }}
                      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      whileHover={{ y: -3 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{call.name}</div>
                          <div style={{ fontSize: 12, color: INK_MUTED }}>{call.phone}</div>
                        </div>
                        <span className={call.interested ? 'chip-high' : 'chip-medium'}>{call.interested ? 'High Interest' : 'Medium'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                        {[
                          { label: 'Duration', value: call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}` : '—', color: INK },
                          { label: 'Sentiment', value: call.sentiment || '—', color: call.sentiment === 'positive' ? SAGE_DARK : AMBER_DARK },
                        ].map(({ label, value, color }) => (
                          <div key={label} style={{ flex: 1, padding: '10px', background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10, textAlign: 'center' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color, textTransform: 'capitalize' }}>{value}</div>
                            <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 2 }}>{label}</div>
                          </div>
                        ))}
                      </div>
                      <button className="pill-outline" style={{ width: '100%', justifyContent: 'center' }}
                        onClick={() => navigate(`/dashboard/college/${id}/report/${callId}`)}>
                        <Eye size={13} /> View Full Report
                      </button>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  )
}
