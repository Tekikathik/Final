import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'
import * as crm from '../../lib/crmApi'
import {
  Megaphone, Sparkles, RefreshCw, CheckCircle2, XCircle, Clock, Play, Pause,
  Users, FileText, TrendingUp, Send, AlertTriangle, ChevronDown, Flame,
  Plus, Trash2,
} from 'lucide-react'

// palette (shared with Competitive Intel)
const C = { green: '#7D9B76', softGreen: '#F1F5EE', gold: '#C8923A', softGold: '#FBF3E4',
  red: '#9B2C2C', softRed: '#FBEDED', ink: '#2C2C2C', mut: '#7A7A7A', line: '#E8E8E8' }
const card = { background: '#FFF', border: `1px solid ${C.line}`, borderRadius: 12 }
const chip = (fg, bg) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: fg, background: bg, padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' })
const btn = (bg, fg = '#fff') => ({ background: bg, color: fg, border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 })
const inp = { border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', minWidth: 0 }

const STATUS = {
  draft:          { fg: C.mut, bg: '#F0F0F0', I: Clock, t: 'Draft' },
  pending_review: { fg: C.gold, bg: C.softGold, I: Clock, t: 'Pending review' },
  approved:       { fg: '#2451B7', bg: '#EAF0FB', I: CheckCircle2, t: 'Approved' },
  active:         { fg: C.green, bg: '#EEF3EB', I: Play, t: 'Active' },
  paused:         { fg: C.gold, bg: C.softGold, I: Pause, t: 'Paused' },
  completed:      { fg: C.mut, bg: '#F0F0F0', I: CheckCircle2, t: 'Completed' },
  rejected:       { fg: C.red, bg: C.softRed, I: XCircle, t: 'Rejected' },
}
const Badge = ({ status }) => { const s = STATUS[status] || STATUS.draft; return <span style={chip(s.fg, s.bg)}><s.I size={12} /> {s.t}</span> }
const SEG_STYLE = { hot: { fg: C.red, bg: C.softRed, I: Flame }, warm: { fg: C.gold, bg: C.softGold, I: TrendingUp },
  cold: { fg: '#2451B7', bg: '#EAF0FB', I: Users }, re_engage: { fg: C.green, bg: C.softGreen, I: RefreshCw }, excluded: { fg: C.mut, bg: '#F0F0F0', I: XCircle } }

function Metric({ label, value }) {
  return <div style={{ textAlign: 'center', padding: '8px 6px', background: '#FBFBFA', borderRadius: 8, border: '1px solid #F4F4F2', minWidth: 62 }}>
    <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{value ?? 0}</div>
    <div style={{ fontSize: 10.5, color: C.mut, marginTop: 1 }}>{label}</div>
  </div>
}

// ── Campaigns tab ───────────────────────────────────────────────────────────
function CampaignCard({ c, isAdmin, onChange }) {
  const [open, setOpen] = useState(false)
  const [funnel, setFunnel] = useState(null)
  const [busy, setBusy] = useState('')
  const act = async (fn, key) => { setBusy(key); try { await fn(); await onChange() } catch (e) { alert(e.response?.data?.message || e.message) } finally { setBusy('') } }
  const expand = async () => {
    const nx = !open; setOpen(nx)
    if (nx && !funnel) { try { setFunnel(await crm.mktCampaignFunnel(c._id)) } catch {} }
  }
  const m = c.metrics || {}
  return (
    <div style={{ ...card, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{c.name}</span>
          <Badge status={c.status} />
          <span style={chip(C.mut, '#F4F4F2')}>{c.segmentKey}</span>
          {c.branchId ? null : <span style={chip('#2451B7', '#EAF0FB')}>org-wide</span>}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.mut }}>{(c.channelMix || []).map(s => s.channel).join(' → ')}</span>
        </div>
        {c.objective && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#5A5A5A' }}>{c.objective}</p>}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <Metric label="targeted" value={m.targeted} /><Metric label="sent" value={m.sent} />
          <Metric label="replied" value={m.responded} /><Metric label="appts" value={m.appointments} />
          <Metric label="enrolled" value={m.enrollments} /><Metric label="skipped" value={m.skipped} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {(c.status === 'pending_review' || c.status === 'draft') && <>
            <button disabled={busy} style={btn(C.green)} onClick={() => act(() => crm.mktReviewCampaign(c._id, 'approved'), 'a')}><CheckCircle2 size={14} /> Approve</button>
            <button disabled={busy} style={btn(C.red)} onClick={() => act(() => crm.mktReviewCampaign(c._id, 'rejected'), 'r')}><XCircle size={14} /> Reject</button>
          </>}
          {c.status === 'approved' && <button disabled={busy} style={btn(C.green)} onClick={() => act(() => crm.mktActivateCampaign(c._id), 'go')}><Send size={14} /> Activate &amp; send</button>}
          {c.status === 'active' && <button disabled={busy} style={btn(C.gold)} onClick={() => act(() => crm.mktPauseCampaign(c._id), 'p')}><Pause size={14} /> Pause</button>}
          {c.status === 'paused' && <button disabled={busy} style={btn(C.green)} onClick={() => act(() => crm.mktPauseCampaign(c._id, true), 'res')}><Play size={14} /> Resume</button>}
          <button style={btn('#F0F0F0', C.ink)} onClick={expand}>Funnel <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></button>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${C.line}`, padding: 14, background: '#FCFCFB' }}>
          {(c.rationale || []).length > 0 && <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, marginBottom: 4 }}>WHY THIS CAMPAIGN</div>
            {c.rationale.map((r, i) => <div key={i} style={{ fontSize: 12.5, color: C.ink, padding: '2px 0' }}>• {r.point} <span style={chip(C.mut, '#F4F4F2')}>{r.source}</span></div>)}
          </div>}
          {(c.counterOffers || []).length > 0 && <div style={{ marginBottom: 10, fontSize: 12.5 }}><b>Counter-offers:</b> {c.counterOffers.join(' · ')}</div>}
          {funnel && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(funnel.funnel).map(([k, v]) => <Metric key={k} label={k} value={v} />)}
            <div style={{ ...card, padding: '8px 12px', fontSize: 12, color: C.mut }}>
              response {funnel.rates.responseRate}% · appt {funnel.rates.appointmentRate}% · enroll {funnel.rates.enrollmentRate}%
            </div>
          </div>}
        </div>
      )}
    </div>
  )
}

function CampaignsTab({ isAdmin }) {
  const [list, setList] = useState([]); const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [build, setBuild] = useState(false)
  const load = () => crm.mktListCampaigns().then(setList).catch(e => setErr(e.response?.data?.message || 'Failed to load'))
  useEffect(() => { load() }, [])
  const propose = async () => { setBusy('p'); setErr(''); try { const r = await crm.mktProposeCampaigns(); await load(); if (!r.proposed.length) setErr('No proposals — score leads / add competitive signals first.') } catch (e) { setErr(e.response?.data?.message || 'Propose failed') } finally { setBusy('') } }
  const seed = async () => { setBusy('s'); setErr(''); try { await crm.mktSeedDemo(); await load() } catch (e) { setErr(e.response?.data?.message || 'Seed failed') } finally { setBusy('') } }
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy} style={btn(C.green)} onClick={() => setBuild(true)}><Plus size={14} /> New campaign</button>
        <button disabled={busy} style={btn('#F0F0F0', C.ink)} onClick={propose}>{busy === 'p' ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} Propose (agent)</button>
        {isAdmin && <button disabled={busy} style={btn('#F0F0F0', C.ink)} onClick={seed}>{busy === 's' ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} Seed demo data</button>}
        <button style={btn('#F0F0F0', C.ink)} onClick={load}><RefreshCw size={14} /> Refresh</button>
        <style>{`.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
      {err && <div style={{ ...card, background: C.softRed, borderColor: '#E8C5C5', color: C.red, padding: 12, marginBottom: 12 }}>{err}</div>}
      {list.length === 0 && <div style={{ ...card, padding: 30, textAlign: 'center', color: C.mut }}>No campaigns yet — build one, let the agent propose, or seed demo data.</div>}
      {list.map(c => <CampaignCard key={c._id} c={c} isAdmin={isAdmin} onChange={load} />)}
      {build && <CampaignBuilder onClose={() => setBuild(false)} onCreated={() => { setBuild(false); load() }} />}
    </>
  )
}

// ── Campaign builder (create a campaign with content attached per channel) ────
const CHANNELS = ['whatsapp', 'sms', 'email', 'priya_call']
function CampaignBuilder({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', objective: '', segmentKey: 'warm', program: '', city: '',
    sendFromHour: 9, sendToHour: 20, dailyCap: 300, throttlePerMin: 30, requireConsent: false })
  const [steps, setSteps] = useState([{ channel: 'whatsapp', contentAssetId: '', delayHours: 0 }])
  const [content, setContent] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { crm.mktListContent('approved').then(setContent).catch(() => {}) }, [])

  const setStep = (i, patch) => setSteps(s => s.map((x, j) => j === i ? { ...x, ...patch } : x))
  const addStep = () => setSteps(s => [...s, { channel: 'email', contentAssetId: '', delayHours: 24 }])
  const rmStep = (i) => setSteps(s => s.filter((_, j) => j !== i))
  const assetsFor = (channel) => content.filter(a => channel === 'priya_call' ? false : (a.kind === channel || (channel === 'whatsapp' && a.kind === 'social')))

  const submit = async () => {
    if (!f.name.trim()) { setErr('Name is required'); return }
    setBusy(true); setErr('')
    try {
      await crm.mktCreateCampaign({
        name: f.name, objective: f.objective, segmentKey: f.segmentKey,
        filter: { ...(f.program ? { program: f.program } : {}), ...(f.city ? { city: f.city } : {}) },
        channelMix: steps.map((s, i) => ({ channel: s.channel, order: i + 1, delayHours: Number(s.delayHours) || 0, contentAssetId: s.contentAssetId || null })),
        schedule: { sendFromHour: Number(f.sendFromHour), sendToHour: Number(f.sendToHour), dailyCap: Number(f.dailyCap), throttlePerMin: Number(f.throttlePerMin) },
        requireConsent: f.requireConsent,
      })
      onCreated()
    } catch (e) { setErr(e.response?.data?.message || 'Create failed') } finally { setBusy(false) }
  }

  const lbl = { fontSize: 11.5, fontWeight: 600, color: C.mut, display: 'block', marginBottom: 4 }
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(44,44,44,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 24, overflowY: 'auto' }}>
      <div style={{ ...card, width: '100%', maxWidth: 620, padding: 22 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>New campaign</div>
        {err && <div style={{ ...card, background: C.softRed, borderColor: '#E8C5C5', color: C.red, padding: 10, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Campaign name *</label><input style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Warm CSE — NAAC A++ nudge" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Objective</label><input style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.objective} onChange={e => setF({ ...f, objective: e.target.value })} /></div>
          <div><label style={lbl}>Segment</label><select style={{ ...inp, width: '100%' }} value={f.segmentKey} onChange={e => setF({ ...f, segmentKey: e.target.value })}>{['hot', 'warm', 'cold', 're_engage', 'custom'].map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label style={lbl}>Program filter (optional)</label><input style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.program} onChange={e => setF({ ...f, program: e.target.value })} placeholder="e.g. CSE" /></div>
        </div>

        <label style={lbl}>Channel sequence (each step waits “delay” hours after the previous)</label>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={chip(C.mut, '#F4F4F2')}>{i + 1}</span>
            <select style={inp} value={s.channel} onChange={e => setStep(i, { channel: e.target.value, contentAssetId: '' })}>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select>
            {s.channel !== 'priya_call' && (
              <select style={{ ...inp, flex: 1, minWidth: 160 }} value={s.contentAssetId} onChange={e => setStep(i, { contentAssetId: e.target.value })}>
                <option value="">— content —</option>
                {assetsFor(s.channel).map(a => <option key={a._id} value={a._id}>{a.title}</option>)}
              </select>
            )}
            {i > 0 && <span style={{ fontSize: 11.5, color: C.mut }}>after <input type="number" style={{ ...inp, width: 60 }} value={s.delayHours} onChange={e => setStep(i, { delayHours: e.target.value })} />h</span>}
            {steps.length > 1 && <button style={{ ...btn('#F0F0F0', C.red), padding: '6px 8px' }} onClick={() => rmStep(i)}><Trash2 size={13} /></button>}
          </div>
        ))}
        <button style={{ ...btn('#F0F0F0', C.ink), marginBottom: 14 }} onClick={addStep}><Plus size={13} /> Add step</button>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          <div><label style={lbl}>Send from (hr)</label><input type="number" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.sendFromHour} onChange={e => setF({ ...f, sendFromHour: e.target.value })} /></div>
          <div><label style={lbl}>Send to (hr)</label><input type="number" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.sendToHour} onChange={e => setF({ ...f, sendToHour: e.target.value })} /></div>
          <div><label style={lbl}>Daily cap</label><input type="number" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.dailyCap} onChange={e => setF({ ...f, dailyCap: e.target.value })} /></div>
          <div><label style={lbl}>Per-minute</label><input type="number" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} value={f.throttlePerMin} onChange={e => setF({ ...f, throttlePerMin: e.target.value })} /></div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 }}>
          <input type="checkbox" checked={f.requireConsent} onChange={e => setF({ ...f, requireConsent: e.target.checked })} /> Only message leads who gave consent
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={btn('#F0F0F0', C.ink)} onClick={onClose}>Cancel</button>
          <button disabled={busy} style={btn(C.green)} onClick={submit}>{busy ? <RefreshCw size={14} className="spin" /> : <CheckCircle2 size={14} />} Create (draft)</button>
        </div>
      </div>
    </div>
  )
}

// ── Segments tab ────────────────────────────────────────────────────────────
function SegmentsTab() {
  const [segs, setSegs] = useState(null); const [busy, setBusy] = useState(false); const [sel, setSel] = useState(null); const [leads, setLeads] = useState([]); const [err, setErr] = useState('')
  const load = () => crm.mktSegments().then(d => { setSegs(d.segments || []); setErr('') }).catch(e => { setSegs([]); setErr(e.response?.data?.message || 'Could not load segments — are you logged in as this org’s admin/officer?') })
  useEffect(() => { load() }, [])
  const rescore = async () => { setBusy(true); setErr(''); try { await crm.mktScore(); await load() } catch (e) { setErr(e.response?.data?.message || 'Re-score failed') } finally { setBusy(false) } }
  const openSeg = async (k) => { setSel(k); setLeads([]); try { setLeads(await crm.mktSegmentLeads(k)) } catch {} }
  const total = (segs || []).reduce((s, x) => s + x.count, 0)
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <button disabled={busy} style={btn(C.green)} onClick={rescore}><RefreshCw size={14} className={busy ? 'spin' : ''} /> Re-score all leads</button>
        <span style={{ fontSize: 12.5, color: C.mut }}>Scores every lead into segments. Run this once to populate the buckets.</span>
      </div>
      {err && <div style={{ ...card, background: C.softRed, borderColor: '#E8C5C5', color: C.red, padding: 12, marginBottom: 12 }}>{err}</div>}
      {segs === null && <div style={{ ...card, padding: 24, textAlign: 'center', color: C.mut }}>Loading…</div>}
      {segs && total === 0 && !err && <div style={{ ...card, padding: 30, textAlign: 'center', color: C.mut }}>No scored leads yet. Click <b>Re-score all leads</b> to populate segments from your lead list.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {(segs || []).map(s => { const st = SEG_STYLE[s.segment] || SEG_STYLE.cold; return (
          <div key={s.segment} onClick={() => openSeg(s.segment)} style={{ ...card, padding: 14, cursor: 'pointer', borderColor: sel === s.segment ? st.fg : C.line }}>
            <span style={chip(st.fg, st.bg)}><st.I size={12} /> {s.segment.replace('_', '-')}</span>
            <div style={{ fontSize: 26, fontWeight: 700, color: C.ink, marginTop: 8 }}>{s.count}</div>
            <div style={{ fontSize: 11.5, color: C.mut }}>avg score {s.avgScore}</div>
          </div>
        )})}
      </div>
      {sel && <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.line}`, fontWeight: 700, fontSize: 13 }}>{sel.replace('_', '-')} leads (top {leads.length})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#FAFAFA' }}>{['Lead', 'Phone', 'Status', 'Score', 'Top factor'].map(h => <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11.5, color: C.mut }}>{h}</th>)}</tr></thead>
          <tbody>{leads.map(s => <tr key={s._id}>
            <td style={{ padding: '8px 12px', fontSize: 13, borderTop: '1px solid #F0F0F0' }}>{s.lead?.name || '—'}</td>
            <td style={{ padding: '8px 12px', fontSize: 12.5, color: C.mut, borderTop: '1px solid #F0F0F0' }}>{s.phone}</td>
            <td style={{ padding: '8px 12px', fontSize: 12.5, borderTop: '1px solid #F0F0F0' }}>{s.signals?.status}</td>
            <td style={{ padding: '8px 12px', fontWeight: 700, color: C.green, borderTop: '1px solid #F0F0F0' }}>{s.score}</td>
            <td style={{ padding: '8px 12px', fontSize: 12, color: C.mut, borderTop: '1px solid #F0F0F0' }}>{(s.factors || [])[0]?.factor || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </>
  )
}

// ── Content tab ─────────────────────────────────────────────────────────────
function ContentTab({ isAdmin }) {
  const [list, setList] = useState([]); const [form, setForm] = useState({ kind: 'whatsapp', language: 'mixed', purpose: '' }); const [busy, setBusy] = useState(false)
  const load = () => crm.mktListContent().then(setList).catch(() => {})
  useEffect(() => { load() }, [])
  const gen = async () => { setBusy(true); try { await crm.mktGenerateContent(form); setForm({ ...form, purpose: '' }); await load() } catch (e) { alert(e.response?.data?.message || e.message) } finally { setBusy(false) } }
  const review = async (id, status) => { try { await crm.mktReviewContent(id, status); await load() } catch (e) { alert(e.response?.data?.message || e.message) } }
  return (
    <>
      <div style={{ ...card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={15} color={C.green} /> Generate copy (agent, RAG-grounded)</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={inp} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{['whatsapp', 'sms', 'email', 'social', 'brochure'].map(k => <option key={k}>{k}</option>)}</select>
          <select style={inp} value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>{['mixed', 'english', 'telugu', 'hindi'].map(k => <option key={k}>{k}</option>)}</select>
          <input style={{ ...inp, flex: 1, minWidth: 220 }} placeholder="Purpose / angle — e.g. 'CSE scholarship deadline vs KLU'" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} />
          <button disabled={busy || !form.purpose} style={btn(C.green)} onClick={gen}>{busy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} Generate</button>
        </div>
      </div>
      {list.map(a => (
        <div key={a._id} style={{ ...card, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>{a.title}</span>
            <span style={chip(C.mut, '#F4F4F2')}>{a.kind}</span><span style={chip(C.mut, '#F4F4F2')}>{a.language}</span>
            <Badge status={a.status} />
            {a.containsFeeClaim && <span style={chip(C.red, C.softRed)}><AlertTriangle size={11} /> fee claim</span>}
          </div>
          {a.subject && <div style={{ fontSize: 12.5, color: C.mut }}>Subject: {a.subject}</div>}
          <div style={{ fontSize: 13, color: C.ink, whiteSpace: 'pre-wrap', marginTop: 4 }}>{a.body}</div>
          {(a.grounding || []).length > 0 && <div style={{ marginTop: 6, fontSize: 11.5, color: C.mut }}>Grounded: {a.grounding.map(g => g.claim).join(' · ')}</div>}
          {isAdmin && a.status === 'pending_review' && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={btn(C.green)} onClick={() => review(a._id, 'approved')}><CheckCircle2 size={14} /> Approve</button>
            <button style={btn(C.red)} onClick={() => review(a._id, 'rejected')}><XCircle size={14} /> Reject</button>
          </div>}
        </div>
      ))}
      {list.length === 0 && <div style={{ ...card, padding: 24, textAlign: 'center', color: C.mut }}>No content yet.</div>}
    </>
  )
}

export default function Marketing() {
  const user = useStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState('campaigns')
  const tabBtn = (id, label) => <button onClick={() => setTab(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', fontSize: 14, fontWeight: 600, color: tab === id ? C.ink : C.mut, borderBottom: `2px solid ${tab === id ? C.green : 'transparent'}` }}>{label}</button>
  return (
    <DashboardLayout>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Megaphone size={22} color={C.green} /><h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Marketing</h1>
      </div>
      <p style={{ color: C.mut, fontSize: 13, margin: '4px 0 18px' }}>Agent-run campaigns — segment, draft, approve, send, and attribute. {isAdmin ? 'Org-wide.' : 'Your branch.'}</p>
      <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${C.line}`, marginBottom: 20 }}>
        {tabBtn('campaigns', 'Campaigns')}{tabBtn('segments', 'Segments')}{tabBtn('content', 'Content')}
      </div>
      {tab === 'campaigns' && <CampaignsTab isAdmin={isAdmin} />}
      {tab === 'segments' && <SegmentsTab />}
      {tab === 'content' && <ContentTab isAdmin={isAdmin} />}
    </DashboardLayout>
  )
}
