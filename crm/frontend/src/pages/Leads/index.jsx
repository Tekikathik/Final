import { useEffect, useState } from 'react'
import { FunnelChart, Funnel, LabelList, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'
import * as crm from '../../lib/crmApi'
import { Upload, Phone, PhoneOff, UserCheck, RefreshCw, Search } from 'lucide-react'

// Soft pastel fills for the chart bars; the matching darker INK is used for text
// so labels/badges stay readable on the light fills.
const STATUS_LIGHT = {
  New: '#D6DBE2', Contacted: '#CFE0FF', Interested: '#ECD4F5', AppointmentBooked: '#FBE6BE',
  Visited: '#C6E4EB', Enrolled: '#D6E5C6', NotInterested: '#F6D2D2', Invalid: '#E6E6E6',
}
const STATUS_INK = {
  New: '#5B6472', Contacted: '#2451B7', Interested: '#7D1FA0', AppointmentBooked: '#B07A1E',
  Visited: '#0E7490', Enrolled: '#4F664A', NotInterested: '#9B2C2C', Invalid: '#8A8A8A',
}
const SHORT = { New: 'New', Contacted: 'Contacted', Interested: 'Interested', AppointmentBooked: 'Appt', Visited: 'Visited', Enrolled: 'Enrolled', NotInterested: 'Not Int.', Invalid: 'Invalid' }
const DISPOSITIONS = ['interested', 'callback', 'wrong_number', 'not_interested', 'no_answer', 'enrolled', 'dnd']
const TOOLTIP = { background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 10, fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }

function Badge({ status }) {
  const ink = STATUS_INK[status] || '#5B6472'
  const bg = STATUS_LIGHT[status] || '#EEE'
  return <span style={{ fontSize: 11, fontWeight: 600, color: ink, background: bg, border: `1px solid ${ink}22`, padding: '2px 8px', borderRadius: 999 }}>{status}</span>
}

export default function Leads() {
  const user = useStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'college_admin'
  const [tab, setTab] = useState('all')          // all | followups
  const [leads, setLeads] = useState([])
  const [pipeline, setPipeline] = useState({ counts: {}, stages: [] })
  const [branches, setBranches] = useState([])
  const [officers, setOfficers] = useState([])
  const [filters, setFilters] = useState({ status: '', q: '', branchId: '' })
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importRows, setImportRows] = useState(null)   // parsed rows from a .json file
  const [fileName, setFileName] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    setBusy(true)
    try {
      if (tab === 'followups') {
        const q = await crm.followUpQueue(72)
        setLeads(q.items || [])
      } else {
        const params = {}
        if (filters.status) params.status = filters.status
        if (filters.q) params.q = filters.q
        if (filters.branchId) params.branchId = filters.branchId
        const res = await crm.listLeads(params)
        setLeads(res.items || [])
      }
      const pc = await crm.pipelineCounts(); setPipeline(pc)
    } catch (e) { setMsg(e.response?.data?.message || 'Failed to load leads (is the backend running and seeded?)') }
    finally { setBusy(false) }
  }

  useEffect(() => { load() }, [tab, filters.status, filters.branchId])
  useEffect(() => {
    if (isAdmin) crm.listBranches().then(setBranches).catch(() => {})
  }, [isAdmin])
  useEffect(() => {
    const bid = user?.branchId || branches[0]?._id
    if (bid) crm.listOfficers(bid).then(setOfficers).catch(() => setOfficers([]))
  }, [branches.length])

  // Read an uploaded .csv/.txt (→ text) or .json (→ rows) file.
  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result || '')
      if (/\.json$/i.test(file.name)) {
        try {
          const data = JSON.parse(content)
          // Accept: array of {name,phone,email} | array of phone strings | { leads:[...] } | { rows:[...] }
          let arr = Array.isArray(data) ? data : (data.leads || data.rows || [])
          const rows = arr.map(r => typeof r === 'string'
            ? { name: '', phone: r, email: '' }
            : { name: r.name || r.fullname || '', phone: r.phone || r.mobile || r.number || r.contact || '', email: r.email || '' })
            .filter(r => r.phone)
          if (!rows.length) { setMsg('No phone numbers found in the JSON file'); return }
          setImportRows(rows); setImportText(''); setMsg('')
        } catch { setMsg('Invalid JSON file') }
      } else {
        // CSV / TXT → drop into the textarea (flows through the existing text path).
        setImportText(content); setImportRows(null); setMsg('')
      }
    }
    reader.readAsText(file)
    e.target.value = ''   // allow re-selecting the same file
  }

  function clearFile() { setImportRows(null); setFileName('') }

  async function doImport() {
    setBusy(true); setImportResult(null)
    try {
      // JSON file → send rows; otherwise send the pasted/CSV text.
      const payload = importRows?.length ? { rows: importRows } : { text: importText }
      if (isAdmin && filters.branchId) payload.branchId = filters.branchId
      const res = await crm.importLeads(payload)
      setImportResult(res); setImportText(''); setImportRows(null); setFileName(''); load()
    } catch (e) { setMsg(e.response?.data?.message || 'Import failed') }
    finally { setBusy(false) }
  }

  async function act(fn, successMsg) {
    try { await fn(); setMsg(successMsg); load() }
    catch (e) { setMsg(e.response?.data?.message || 'Action failed') }
    setTimeout(() => setMsg(''), 3000)
  }

  // Funnel = how many leads progressed AT LEAST to each stage (cumulative down the
  // conversion path), so the chart always narrows like a real funnel. Off-ramp
  // statuses (NotInterested/Invalid) sit outside the path and are shown separately.
  const FUNNEL_PATH = ['New', 'Contacted', 'Interested', 'AppointmentBooked', 'Visited', 'Enrolled']
  const c = pipeline.counts || {}
  const funnelData = FUNNEL_PATH.map((s, i) => ({
    stage: s,
    label: `${SHORT[s]}`,
    value: FUNNEL_PATH.slice(i).reduce((sum, st) => sum + (c[st] || 0), 0),
    fill: STATUS_LIGHT[s] || '#DDD',
    ink: STATUS_INK[s] || '#5B6472',
  }))
  const topOfFunnel = funnelData[0]?.value || 0
  const enrolled = c.Enrolled || 0
  const convRate = topOfFunnel ? Math.round((enrolled / topOfFunnel) * 100) : 0
  const offRamps = [
    { key: 'NotInterested', label: 'Not interested', value: c.NotInterested || 0 },
    { key: 'Invalid', label: 'Invalid / wrong no.', value: c.Invalid || 0 },
  ]

  const card = { background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 12, padding: 16 }
  const input = { padding: '8px 12px', border: '1px solid #E8E8E8', borderRadius: 8, fontSize: 13, background: '#FFF' }

  return (
    <DashboardLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2C2C2C', margin: 0 }}>Leads</h1>
          <p style={{ color: '#7A7A7A', fontSize: 13, margin: '4px 0 0' }}>
            {isAdmin ? 'All branches' : 'Your branch'} · lead pipeline & calling
          </p>
        </div>
        <button onClick={() => setImportOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#7D9B76', color: '#FFF', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          <Upload size={15} /> Import numbers
        </button>
      </div>

      {/* Pipeline funnel — leads that progressed at least to each stage */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ ...card, padding: '16px 16px 4px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#2C2C2C', marginBottom: 2 }}>Conversion funnel</div>
          <div style={{ fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Leads reaching at least each stage</div>
          <ResponsiveContainer width="100%" height={230}>
            <FunnelChart>
              <Tooltip contentStyle={TOOLTIP} formatter={(v, _n, p) => [v, p?.payload?.stage]} />
              <Funnel dataKey="value" data={funnelData} isAnimationActive lastShapeType="rectangle" stroke="#FFF" strokeWidth={2}>
                <LabelList position="right" dataKey="label" stroke="none" style={{ fill: '#5A5A5A', fontSize: 12, fontWeight: 600 }} />
                <LabelList position="center" dataKey="value" stroke="none" style={{ fill: '#3A3A3A', fontSize: 13, fontWeight: 700 }} />
                {funnelData.map((d) => <Cell key={d.stage} fill={d.fill} />)}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>

        {/* Right: conversion KPI + off-ramp breakdown */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#7A7A7A', fontWeight: 600 }}>New → Enrolled conversion</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: '#4F664A' }}>{convRate}%</span>
              <span style={{ fontSize: 12, color: '#A0A0A0' }}>{enrolled} of {topOfFunnel} leads</span>
            </div>
            <div style={{ height: 8, background: '#F1F1EF', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}>
              <div style={{ width: `${convRate}%`, height: '100%', background: '#A9C29B', borderRadius: 999 }} />
            </div>
          </div>
          <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: '#7A7A7A', fontWeight: 600, marginBottom: 8 }}>Off the pipeline</div>
            {offRamps.map(o => (
              <div key={o.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5A5A5A' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: STATUS_LIGHT[o.key], border: `1px solid ${STATUS_INK[o.key]}33` }} />
                  {o.label}
                </span>
                <span style={{ fontWeight: 700, color: STATUS_INK[o.key] }}>{o.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'followups'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ ...input, cursor: 'pointer', fontWeight: 600, background: tab === t ? '#F1F5EE' : '#FFF', color: tab === t ? '#4F664A' : '#5A5A5A', borderColor: tab === t ? '#C7D5BD' : '#E8E8E8' }}>
              {t === 'all' ? 'All leads' : 'Follow-up queue'}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#A0A0A0' }} />
          <input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && load()} placeholder="Search name / phone…"
            style={{ ...input, paddingLeft: 30, width: '100%' }} />
        </div>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={input}>
          <option value="">All stages</option>
          {(pipeline.stages || []).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {isAdmin && (
          <select value={filters.branchId} onChange={e => setFilters(f => ({ ...f, branchId: e.target.value }))} style={input}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        )}
        <button onClick={load} style={{ ...input, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}><RefreshCw size={14} /> Refresh</button>
      </div>

      {msg && <div style={{ ...card, padding: '10px 14px', marginBottom: 12, background: '#F1F5EE', borderColor: '#C7D5BD', color: '#4F664A', fontSize: 13 }}>{msg}</div>}

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', textAlign: 'left', color: '#7A7A7A' }}>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Phone</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
              {isAdmin && <th style={{ padding: '10px 14px', fontWeight: 600 }}>Branch</th>}
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Officer</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Outcome</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#A0A0A0' }}>{busy ? 'Loading…' : 'No leads. Import some numbers to get started.'}</td></tr>
            )}
            {leads.map(l => (
              <tr key={l._id} style={{ borderTop: '1px solid #F0F0F0' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#2C2C2C' }}>{l.name}{l.dnd && <span title="Do Not Call" style={{ color: '#9B2C2C', marginLeft: 6, fontSize: 11 }}>DND</span>}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{l.phone}</td>
                <td style={{ padding: '10px 14px' }}><Badge status={l.status} /></td>
                {isAdmin && <td style={{ padding: '10px 14px', color: '#5A5A5A' }}>{l.branchId?.name || '—'}</td>}
                <td style={{ padding: '10px 14px', color: '#5A5A5A' }}>{l.assignedOfficerId?.name || '—'}</td>
                <td style={{ padding: '10px 14px', color: '#7A7A7A' }}>{l.lastDisposition || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button disabled={l.dnd} onClick={() => act(() => crm.callLead(l._id), `Calling ${l.name}…`)}
                      title={l.dnd ? 'On Do-Not-Call' : 'Trigger call'}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: l.dnd ? '#F0F0F0' : '#EBF0FF', color: l.dnd ? '#A0A0A0' : '#2451B7', border: 'none', borderRadius: 7, padding: '5px 9px', cursor: l.dnd ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600 }}>
                      <Phone size={12} /> Call
                    </button>
                    <select defaultValue="" onChange={e => { if (e.target.value) { act(() => crm.setDisposition(l._id, e.target.value), 'Outcome saved'); e.target.value = '' } }}
                      style={{ fontSize: 12, padding: '5px 6px', border: '1px solid #E8E8E8', borderRadius: 7, color: '#5A5A5A' }}>
                      <option value="">Outcome…</option>
                      {DISPOSITIONS.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
                    </select>
                    {isAdmin && officers.length > 0 && (
                      <select defaultValue={l.assignedOfficerId?._id || ''} onChange={e => act(() => crm.assignLead(l._id, e.target.value), 'Assigned')}
                        title="Assign officer" style={{ fontSize: 12, padding: '5px 6px', border: '1px solid #E8E8E8', borderRadius: 7, color: '#5A5A5A' }}>
                        <option value="">Unassigned</option>
                        {officers.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                      </select>
                    )}
                    {!l.dnd && <button onClick={() => act(() => crm.flagDnd(l._id), 'Marked DND')} title="Mark Do-Not-Call"
                      style={{ display: 'flex', alignItems: 'center', background: '#FBEDED', color: '#9B2C2C', border: 'none', borderRadius: 7, padding: '5px 7px', cursor: 'pointer' }}><PhoneOff size={12} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Import modal */}
      {importOpen && (
        <div onClick={() => setImportOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 16, padding: 24, width: 520, maxWidth: '90vw' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Import numbers</h2>
            <p style={{ fontSize: 13, color: '#7A7A7A', margin: '0 0 12px' }}>
              Upload a <strong>.csv</strong> or <strong>.json</strong> file, or paste below. Duplicates, invalid formats and DND numbers are caught automatically.
            </p>
            {isAdmin && (
              <select value={filters.branchId} onChange={e => setFilters(f => ({ ...f, branchId: e.target.value }))} style={{ ...input, marginBottom: 10, width: '100%' }}>
                <option value="">Select branch to import into…</option>
                {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            )}

            {/* File upload (CSV / JSON) */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', border: '1.5px dashed #C7D5BD', background: '#F7FAF5', borderRadius: 10, padding: '12px', cursor: 'pointer', color: '#4F664A', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              <Upload size={15} /> Choose a CSV or JSON file
              <input type="file" accept=".csv,.txt,.json,application/json,text/csv" onChange={handleFile} style={{ display: 'none' }} />
            </label>

            {importRows?.length ? (
              // A JSON file is loaded — show a summary card instead of the textarea.
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #C7D5BD', background: '#F1F5EE', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#4F664A' }}>
                <span><strong>{fileName}</strong> — {importRows.length} rows ready to import</span>
                <button onClick={clearFile} style={{ background: 'none', border: 'none', color: '#9B2C2C', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Clear</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#A0A0A0', marginBottom: 4 }}>{fileName ? `Loaded ${fileName}` : 'Or paste CSV / one number per line:'}</div>
                <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={7}
                  placeholder={"name,phone\nRahul Sharma,9876543210\nSneha,9876500011"}
                  style={{ width: '100%', border: '1px solid #E8E8E8', borderRadius: 10, padding: 12, fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }} />
              </>
            )}
            {importResult && (
              <div style={{ marginTop: 12, padding: 12, background: '#F1F5EE', borderRadius: 10, fontSize: 13 }}>
                <strong>{importResult.counts.imported}</strong> imported ·{' '}
                <strong>{importResult.counts.duplicate}</strong> duplicates ·{' '}
                <strong>{importResult.counts.invalid}</strong> invalid ·{' '}
                <strong>{importResult.counts.dnd}</strong> on DND
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setImportOpen(false)} style={{ ...input, cursor: 'pointer' }}>Close</button>
              {(() => {
                const hasData = importRows?.length || importText.trim()
                const blocked = busy || !hasData || (isAdmin && !filters.branchId)
                return (
                  <button disabled={blocked} onClick={doImport}
                    style={{ background: '#7D9B76', color: '#FFF', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.6 : 1 }}>
                    {busy ? 'Importing…' : 'Import'}
                  </button>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
