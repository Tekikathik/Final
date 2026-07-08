import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import * as crm from '../../lib/crmApi'
import {
  Target, RefreshCw, CheckCircle2, XCircle, Clock, Plus, Trash2,
  TrendingUp, ShieldCheck, AlertTriangle, Quote, Sparkles, ChevronDown,
  Globe, Link2, Building2, Search, LayoutGrid, Scale,
} from 'lucide-react'

// ── palette / helpers ───────────────────────────────────────────────────────
const C = { green: '#7D9B76', softGreen: '#F1F5EE', gold: '#C8923A', softGold: '#FBF3E4',
  red: '#9B2C2C', softRed: '#FBEDED', ink: '#2C2C2C', mut: '#7A7A7A', line: '#E8E8E8' }

const confColor = (c) => c === 'high' ? { fg: C.green, bg: '#EEF3EB' }
  : c === 'low' ? { fg: C.mut, bg: '#F0F0F0' } : { fg: C.gold, bg: C.softGold }
const threatColor = (s) => s >= 70 ? C.red : s >= 40 ? C.gold : C.green
const SRC_LABEL = { call_transcript: 'Call transcript', transcript: 'Call transcript',
  competitor_page: 'Competitor page', profile: 'Competitor profile', competitor_profile: 'Competitor profile',
  campaign_metric: 'Campaign metric', gap_tally: 'Gap analysis', aditya_profile: 'Our profile', analysis: 'Analysis' }
const srcLabel = (t) => SRC_LABEL[t] || (t || 'Analysis')
const fmtDate = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

const card = { background: '#FFF', border: `1px solid ${C.line}`, borderRadius: 12 }
const chip = (fg, bg) => ({ display: 'inline-block', fontSize: 11, fontWeight: 600, color: fg, background: bg, padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' })
const btn = (bg, fg = '#fff') => ({ background: bg, color: fg, border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 })

function StatusBadge({ status }) {
  const map = { approved: { fg: C.green, bg: '#EEF3EB', I: CheckCircle2, t: 'Approved' },
    rejected: { fg: C.red, bg: C.softRed, I: XCircle, t: 'Rejected' },
    draft: { fg: C.gold, bg: C.softGold, I: Clock, t: 'Pending review' } }
  const s = map[status] || map.draft
  return <span style={{ ...chip(s.fg, s.bg), display: 'inline-flex', alignItems: 'center', gap: 5 }}><s.I size={12} /> {s.t}</span>
}

// A single evidence point (used for better/weaker/recommendation evidence).
function Point({ p, tone }) {
  const cc = confColor(p.confidence)
  return (
    <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: tone, marginTop: 6, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.45 }}>{p.point}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            <span style={chip(C.mut, '#F4F4F2')}>{p.category}</span>
            <span style={chip(cc.fg, cc.bg)}>{p.confidence} confidence</span>
            <span style={{ ...chip('#2451B7', '#EAF0FB'), textTransform: 'none' }}>{srcLabel(p.source?.type)}</span>
          </div>
          {p.source?.excerpt && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 12, color: C.mut, fontStyle: 'italic', lineHeight: 1.4 }}>
              <Quote size={12} style={{ flexShrink: 0, marginTop: 3 }} /> {p.source.excerpt}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Minimal markdown renderer for agent-written briefs/scorecards (#/## headings,
// "- " bullets, plain paragraphs; ** markers stripped).
function Md({ text }) {
  const lines = String(text || '').split('\n')
  return (
    <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.55 }}>
      {lines.map((l, i) => {
        const t = l.trim()
        if (!t) return <div key={i} style={{ height: 8 }} />
        if (t.startsWith('## ')) return <div key={i} style={{ fontWeight: 700, fontSize: 13.5, marginTop: i ? 12 : 0, marginBottom: 4 }}>{t.slice(3)}</div>
        if (t.startsWith('# '))  return <div key={i} style={{ fontWeight: 700, fontSize: 14.5, marginTop: i ? 12 : 0, marginBottom: 4 }}>{t.slice(2)}</div>
        if (t.startsWith('- ')) return (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, marginTop: 7, flexShrink: 0 }} />
            <span>{t.slice(2).replace(/\*\*/g, '')}</span>
          </div>
        )
        return <p key={i} style={{ margin: '2px 0' }}>{t.replace(/\*\*/g, '')}</p>
      })}
    </div>
  )
}

// Scorecard heat tint: red = a rival moved against the department, yellow = early signals.
const HEAT_STYLE = {
  red:    { fg: C.red,   bg: C.softRed,   label: 'under attack' },
  yellow: { fg: C.gold,  bg: C.softGold,  label: 'watch' },
  green:  { fg: C.green, bg: C.softGreen, label: 'quiet' },
}

// Level-2 scorecard (one per department that had signals) — collapsible.
function ScorecardCard({ sc, status }) {
  const [open, setOpen] = useState(status === 'red')
  const s = HEAT_STYLE[status] || HEAT_STYLE.yellow
  return (
    <div style={{ ...card, marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer' }}>
        <span style={chip(s.fg, s.bg)}>{sc.department}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Department scorecard</span>
        <span style={{ fontSize: 11.5, color: C.mut }}>for the {sc.department} HOD + admissions head</span>
        <ChevronDown size={15} style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: C.mut }} />
      </div>
      {open && <div style={{ padding: '4px 14px 14px', borderTop: `1px solid ${C.line}` }}><Md text={sc.content} /></div>}
    </div>
  )
}

// Pros & cons for one functional department (Admissions, Placements, …).
const AREA_LABEL = {
  ADMISSIONS: 'Admissions Department',
  PLACEMENTS: 'Placement Department',
  FEES_SCHOLARSHIPS: 'Fees & Scholarships',
  INFRASTRUCTURE_HOSTEL: 'Infrastructure & Hostel',
  ACCREDITATION_RANKINGS: 'Accreditation & Rankings',
}
// Pros & cons split BY DEPARTMENT — an accordion. Each department is a clickable
// header row (with its pros/cons counts); clicking it reveals that department's
// pros and cons. Everything starts collapsed, so the section is compact until you
// pick a department.
function FunctionalAnalysis({ areas }) {
  const [open, setOpen] = useState(null)   // the department area currently shown
  return (
    <div>
      {areas.map(fa => {
        const isOpen = open === fa.area
        return (
          <div key={fa.area} style={{ ...card, marginBottom: 10, overflow: 'hidden' }}>
            <div onClick={() => setOpen(isOpen ? null : fa.area)}
              style={{ padding: '12px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer',
                background: isOpen ? C.softGreen : '#FFF' }}>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{AREA_LABEL[fa.area] || fa.area}</span>
              <span style={chip(C.green, '#EEF3EB')}>{fa.pros?.length || 0} pros</span>
              <span style={chip(C.red, C.softRed)}>{fa.cons?.length || 0} cons</span>
              <ChevronDown size={16} style={{ marginLeft: 'auto', color: C.mut, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {isOpen && (
              <div className="ci-proscons" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${C.line}` }}>
                <div style={{ borderRight: `1px solid ${C.line}` }}>
                  <div style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: C.green, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShieldCheck size={13} /> Pros — where we lead
                  </div>
                  {(fa.pros || []).length === 0 && <div style={{ padding: 12, fontSize: 12, color: C.mut, borderTop: `1px solid ${C.line}` }}>No verified advantage this run.</div>}
                  {(fa.pros || []).map((p, i) => <Point key={i} p={p} tone={C.green} />)}
                </div>
                <div>
                  <div style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: C.red, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={13} /> Cons — where rivals beat us
                  </div>
                  {(fa.cons || []).length === 0 && <div style={{ padding: 12, fontSize: 12, color: C.mut, borderTop: `1px solid ${C.line}` }}>No verified gap this run. 🎉</div>}
                  {(fa.cons || []).map((p, i) => <Point key={i} p={p} tone={C.red} />)}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Scraped key features (ours or a rival's), shown as chips with a scrape badge.
function KeyFeatures({ items, sourceUrl, scraped, title = 'Key features' }) {
  if (!items || !items.length) return null
  return (
    <div style={{ ...card, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '10px 12px', background: '#F7FAF5', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Globe size={14} color={C.green} />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: C.ink }}>{title}</span>
        <span style={chip(scraped ? C.green : C.mut, scraped ? '#EEF3EB' : '#F0F0F0')}>{scraped ? 'Live-scraped' : 'Stored profile'}</span>
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11.5, color: '#2451B7', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Link2 size={11} /> {sourceUrl.replace(/^https?:\/\//, '').slice(0, 42)}</a>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
        {items.map((f, i) => {
          const cc = confColor(f.confidence)
          return (
            <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: '7px 10px', fontSize: 12.5, color: C.ink, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: cc.fg, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.point}</span>
              <span style={chip(C.mut, '#F4F4F2')}>{f.category}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewBar({ report, onReviewed }) {
  const [notes, setNotes] = useState(report.reviewNotes || '')
  const [busy, setBusy] = useState('')
  const act = async (status) => {
    setBusy(status)
    try { await crm.reviewCompetitiveReport(report._id, status, notes); onReviewed(status) }
    finally { setBusy('') }
  }
  const reviewer = report.reviewedBy?.name
  return (
    <div style={{ ...card, padding: 14, marginBottom: 16, background: report.status === 'draft' ? C.softGold : '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: report.status === 'draft' ? 10 : 0, flexWrap: 'wrap' }}>
        <StatusBadge status={report.status} />
        <span style={{ fontSize: 12.5, color: C.mut }}>
          {report.status === 'draft'
            ? 'A human must review this report before any action is taken.'
            : `Reviewed${reviewer ? ` by ${reviewer}` : ''}${report.reviewedAt ? ` · ${fmtDate(report.reviewedAt)}` : ''}`}
        </span>
        {report.status !== 'draft' && (
          <button onClick={() => act('draft')} disabled={busy} style={{ ...btn('#F0F0F0', C.ink), marginLeft: 'auto', padding: '6px 12px' }}>Reopen</button>
        )}
      </div>
      {report.status === 'draft' && (
        <>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Review notes (optional)…"
            style={{ width: '100%', minHeight: 54, resize: 'vertical', border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button onClick={() => act('approved')} disabled={busy} style={btn(C.green)}><CheckCircle2 size={15} /> Approve</button>
            <button onClick={() => act('rejected')} disabled={busy} style={btn(C.red)}><XCircle size={15} /> Reject</button>
          </div>
        </>
      )}
      {report.status !== 'draft' && report.reviewNotes && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#5A5A5A' }}><b>Notes:</b> {report.reviewNotes}</div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ ...card, padding: '12px 14px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.mut, marginTop: 2 }}>{label}</div>
    </div>
  )
}

// ── Competitors management tab ───────────────────────────────────────────────
function CompetitorsTab() {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ name: '', location: '', website: '', naac: '', nirfRank: '', placementHighestLpa: '', annualFeeLpa: '' })
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const load = () => crm.listCompetitors().then(setRows).catch(e => setErr(e.response?.data?.message || 'Failed to load'))
  useEffect(() => { load() }, [])

  const doPreview = async () => {
    if (!form.website.trim()) { setErr('Enter a website to preview'); return }
    setPreviewing(true); setErr(''); setPreview(null)
    try { setPreview(await crm.scrapePreview(form.website, form.name || 'Preview')) }
    catch (e) { setErr(e.response?.data?.message || 'Preview failed') } finally { setPreviewing(false) }
  }

  const add = async () => {
    if (!form.name.trim()) return
    setBusy(true); setErr('')
    try {
      await crm.createCompetitor({ name: form.name, location: form.location, website: form.website,
        profile: { naac: form.naac, nirfRank: form.nirfRank,
          placementHighestLpa: form.placementHighestLpa ? Number(form.placementHighestLpa) : null,
          annualFeeLpa: form.annualFeeLpa ? Number(form.annualFeeLpa) : null } })
      setForm({ name: '', location: '', website: '', naac: '', nirfRank: '', placementHighestLpa: '', annualFeeLpa: '' })
      load()
    } catch (e) { setErr(e.response?.data?.message || 'Failed to add') } finally { setBusy(false) }
  }
  const remove = async (id) => { if (!confirm('Remove this competitor?')) return; await crm.deleteCompetitor(id); load() }

  const inp = { border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', minWidth: 0 }
  return (
    <>
      {err && <div style={{ ...card, borderColor: '#E8C5C5', background: C.softRed, color: C.red, padding: 12, marginBottom: 14 }}>{err}</div>}
      <div style={{ ...card, padding: 16, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}><Plus size={15} color={C.green} /> Track a new rival</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          <input style={inp} placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input style={inp} placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          <input style={inp} placeholder="Website" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
          <input style={inp} placeholder="NAAC (e.g. A++)" value={form.naac} onChange={e => setForm({ ...form, naac: e.target.value })} />
          <input style={inp} placeholder="NIRF rank" value={form.nirfRank} onChange={e => setForm({ ...form, nirfRank: e.target.value })} />
          <input style={inp} placeholder="Highest pkg (LPA)" value={form.placementHighestLpa} onChange={e => setForm({ ...form, placementHighestLpa: e.target.value })} />
          <input style={inp} placeholder="Annual fee (LPA)" value={form.annualFeeLpa} onChange={e => setForm({ ...form, annualFeeLpa: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={add} disabled={busy} style={btn(C.green)}><Plus size={15} /> Add competitor</button>
          <button onClick={doPreview} disabled={previewing} style={btn('#F0F0F0', C.ink)}>
            {previewing ? <RefreshCw size={14} className="spin" /> : <Search size={14} />} {previewing ? 'Scraping…' : 'Preview scrape'}
          </button>
          <style>{`.spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
        {preview && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12.5, color: C.mut, marginBottom: 8 }}>
              {preview.ok ? `Found ${preview.keyFeatures.length} key feature(s)${preview.usedLlm ? ' (AI-extracted)' : ''}:` : 'Could not extract features from this page (it may be a JavaScript-rendered site). You can still add it — the stored profile fields will be used.'}
            </div>
            {preview.ok && <KeyFeatures items={preview.keyFeatures} sourceUrl={(preview.sources.find(s => s.ok) || {}).url} scraped title="Preview" />}
          </div>
        )}
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#FAFAFA' }}>
            {['Rival', 'Location', 'NAAC', 'NIRF', 'Highest LPA', 'Fee LPA', ''].map((h, i) =>
              <th key={i} style={{ padding: '9px 14px', fontWeight: 600, textAlign: 'left', color: C.mut, fontSize: 12 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} style={{ padding: 16, color: '#A0A0A0', fontSize: 13 }}>No competitors tracked yet.</td></tr>}
            {rows.map(r => (
              <tr key={r._id}>
                <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.ink, borderTop: `1px solid #F0F0F0` }}>
                  {r.name}{r.website && <a href={r.website} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 11, color: '#2451B7', fontWeight: 400 }}>{r.website.replace(/^https?:\/\//, '')}</a>}
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#5A5A5A', borderTop: `1px solid #F0F0F0` }}>{r.location || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#5A5A5A', borderTop: `1px solid #F0F0F0` }}>{r.profile?.naac || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#5A5A5A', borderTop: `1px solid #F0F0F0` }}>{r.profile?.nirfRank || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#5A5A5A', borderTop: `1px solid #F0F0F0` }}>{r.profile?.placementHighestLpa ? `₹${r.profile.placementHighestLpa}L` : '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#5A5A5A', borderTop: `1px solid #F0F0F0` }}>{r.profile?.annualFeeLpa != null ? `₹${r.profile.annualFeeLpa}L` : '—'}</td>
                <td style={{ padding: '10px 14px', borderTop: `1px solid #F0F0F0` }}>
                  <button onClick={() => remove(r._id)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red }}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Reports tab ──────────────────────────────────────────────────────────────
function ReportsTab() {
  const [list, setList] = useState([])
  const [sel, setSel] = useState(null)      // full report
  const [selId, setSelId] = useState(null)
  const [windowDays, setWindowDays] = useState(90)
  const [gen, setGen] = useState(false)
  const [err, setErr] = useState('')

  const loadList = async (pickFirst = false) => {
    const items = await crm.listCompetitiveReports()
    setList(items)
    if (pickFirst && items[0]) openReport(items[0]._id)
  }
  const openReport = async (id) => { setSelId(id); setSel(null); try { setSel(await crm.getCompetitiveReport(id)) } catch (e) { setErr(e.response?.data?.message || 'Failed to load report') } }
  useEffect(() => { loadList(true).catch(e => setErr(e.response?.data?.message || 'Failed to load')) }, [])

  const generate = async () => {
    setGen(true); setErr('')
    try { const r = await crm.runCompetitive(windowDays); await loadList(); openReport(r._id) }
    catch (e) { setErr(e.response?.data?.message || 'Failed to generate') } finally { setGen(false) }
  }

  const sub = { border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, background: '#fff', cursor: 'pointer' }
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: C.mut }}>Evidence window</label>
        <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))} style={sub}>
          <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option><option value={365}>Last 365 days</option>
        </select>
        <button onClick={generate} disabled={gen} style={btn(C.green)}>
          {gen ? <RefreshCw size={15} className="spin" /> : <Sparkles size={15} />} {gen ? 'Analysing…' : 'Generate report'}
        </button>

        {/* Past reports — pick one from this dropdown to load its data. */}
        <label style={{ fontSize: 13, color: C.mut, marginLeft: 'auto' }}>Report</label>
        <select value={selId || ''} onChange={e => e.target.value && openReport(e.target.value)} style={{ ...sub, maxWidth: 320 }}>
          <option value="">{list.length ? `Select a report… (${list.length})` : 'No reports yet'}</option>
          {list.map(r => (
            <option key={r._id} value={r._id}>
              {fmtDate(r.generatedAt).split(',')[0]} · {r.trigger === 'scheduled' ? 'Scheduled' : 'Manual'} · {r.competitors?.length || 0} rivals · {r.status}
            </option>
          ))}
        </select>
        <button onClick={() => loadList()} style={{ ...btn('#F0F0F0', C.ink) }}><RefreshCw size={14} /> Refresh</button>
        <style>{`.spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>

      {err && <div style={{ ...card, borderColor: '#E8C5C5', background: C.softRed, color: C.red, padding: 12, marginBottom: 14 }}>{err}</div>}

      {/* selected report — full width */}
      {!sel && <div style={{ ...card, padding: 40, textAlign: 'center', color: C.mut }}>
        {selId ? 'Loading report…' : list.length ? 'Pick a report from the dropdown above, or generate a new one.' : 'No reports yet. Generate your first one.'}
      </div>}
      {sel && <ReportDetail report={sel} onReviewed={(status) => { setSel({ ...sel, status }); loadList() }} />}
    </>
  )
}

function ReportDetail({ report, onReviewed }) {
  const s = report.evidenceStats || {}
  return (
    <div>
      <ReviewBar report={report} onReviewed={onReviewed} />

      <div style={{ ...card, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, color: C.mut }}>{fmtDate(report.generatedAt)} · {report.windowDays}-day window</span>
          <span style={{ ...chip(report.usedLlm ? C.green : C.mut, report.usedLlm ? '#EEF3EB' : '#F0F0F0'), marginLeft: 'auto' }}>
            {report.usedLlm ? 'AI reasoning' : 'Rule-based'}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.ink, lineHeight: 1.55 }}>{report.summary}</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="Calls analysed" value={s.callsAnalyzed || 0} />
        <Stat label="Competitor mentions" value={s.totalMentions || 0} />
        <Stat label="Web pages scraped" value={(report.sources || []).filter(x => x.ok).length} />
        <Stat label="Change signals" value={report.signalStats?.total || 0} />
        <Stat label="Alerts" value={report.signalStats?.alerts || 0} />
      </div>

      {/* 1 ── Pros & cons by department (the headline of the report) ─────────── */}
      {(report.functionalAnalysis || []).length > 0 && (
        <>
          <SectionTitle icon={Scale} title="Pros & cons by department"
            sub="Where Aditya leads and lags per office. Rival numbers from their own sites are marked “claims”." />
          <FunctionalAnalysis areas={report.functionalAnalysis} />
          <div style={{ height: 20 }} />
        </>
      )}

      {/* 2 ── Department scorecards (per-HOD detail) ────────────────────────── */}
      {(report.departmentScorecards || []).length > 0 && (
        <>
          <SectionTitle icon={LayoutGrid} title="Department scorecards"
            sub="One per department with competitor movement this run — for that HOD and the admissions head." />
          {report.departmentScorecards.map(sc => (
            <ScorecardCard key={sc.department} sc={sc}
              status={(report.heatmap || []).find(h => h.department === sc.department)?.status || 'yellow'} />
          ))}
          <div style={{ height: 20 }} />
        </>
      )}

      {/* 4 ── Recommended actions ───────────────────────────────────────────── */}
      <SectionTitle icon={TrendingUp} title="Recommended actions" sub="Evidence-backed steps to close gaps and amplify our strengths." />
      {(report.recommendations || []).map((r, i) => <RecommendationCard key={i} r={r} />)}
      {(report.recommendations || []).length === 0 && <div style={{ ...card, padding: 16, color: C.mut, fontSize: 13 }}>No recommendations generated.</div>}
      <div style={{ height: 20 }} />

      {/* 5 ── Our key features ──────────────────────────────────────────────── */}
      {(report.ourKeyFeatures || []).length > 0 && (
        <>
          <SectionTitle icon={Building2} title="Our key features" sub="Scraped live from Aditya University's own website (falls back to our stored profile)." />
          <KeyFeatures items={report.ourKeyFeatures} sourceUrl={report.ourSourceUrl}
            scraped={(report.sources || []).some(x => x.name === 'Aditya University' && x.ok)}
            title="Aditya University" />
          <div style={{ height: 20 }} />
        </>
      )}

      {/* 6 ── Evidence sources ──────────────────────────────────────────────── */}
      {(report.sources || []).length > 0 && (
        <div>
          <SectionTitle icon={Link2} title="Evidence sources" sub="Web pages the agent fetched to compile this report." />
          <div style={{ ...card, overflow: 'hidden' }}>
            {report.sources.map((src, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid #F4F4F2' : 'none', fontSize: 12.5 }}>
                <span style={chip(src.ok ? C.green : C.red, src.ok ? '#EEF3EB' : C.softRed)}>{src.ok ? 'OK' : 'FAIL'}</span>
                <span style={{ color: C.ink, fontWeight: 600 }}>{src.name}</span>
                <a href={src.url} target="_blank" rel="noreferrer" style={{ color: '#2451B7', marginLeft: 'auto', fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{src.url.replace(/^https?:\/\//, '')}</a>
                {!src.ok && src.error && <span style={{ color: C.mut, fontSize: 11, flexShrink: 0 }}>{src.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ icon: I, title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <I size={17} color={C.green} /><h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: C.ink }}>{title}</h2>
      </div>
      {sub && <p style={{ margin: '3px 0 0 25px', fontSize: 12.5, color: C.mut }}>{sub}</p>}
    </div>
  )
}

function RecommendationCard({ r }) {
  const cc = confColor(r.confidence)
  return (
    <div style={{ ...card, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: 14, display: 'flex', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: C.softGold, color: C.gold, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>P{r.priority}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink }}>{r.title}</span>
            <span style={chip(cc.fg, cc.bg)}>{r.confidence} confidence</span>
          </div>
          {r.detail && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#4A4A4A', lineHeight: 1.5 }}>{r.detail}</p>}
          {r.rationale && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.mut, lineHeight: 1.5 }}><b>Why:</b> {r.rationale}</p>}
          {(r.addressesCompetitors || []).length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: C.mut }}>Addresses:</span>
              {r.addressesCompetitors.map((n, i) => <span key={i} style={chip(C.red, C.softRed)}>{n}</span>)}
            </div>
          )}
        </div>
      </div>
      {(r.evidence || []).length > 0 && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: '#FCFCFB' }}>
          {r.evidence.map((p, i) => <Point key={i} p={p} tone={C.gold} />)}
        </div>
      )}
    </div>
  )
}

// ── Page shell ───────────────────────────────────────────────────────────────
export default function CompetitiveIntel() {
  const [tab, setTab] = useState('reports')
  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', fontSize: 14,
      fontWeight: 600, color: tab === id ? C.ink : C.mut,
      borderBottom: `2px solid ${tab === id ? C.green : 'transparent'}` }}>{label}</button>
  )
  return (
    <DashboardLayout>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Target size={22} color={C.green} />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Competitive Intelligence</h1>
      </div>
      <p style={{ color: C.mut, fontSize: 13, margin: '4px 0 18px' }}>
        On-demand & scheduled analysis of rival colleges vs Aditya University — evidence-backed, human-reviewed. Main office only.
      </p>
      <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${C.line}`, marginBottom: 20 }}>
        {tabBtn('reports', 'Reports')}
        {tabBtn('competitors', 'Competitors')}
      </div>
      {tab === 'reports' ? <ReportsTab /> : <CompetitorsTab />}
    </DashboardLayout>
  )
}
