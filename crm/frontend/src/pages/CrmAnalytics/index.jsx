import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, PieChart, Pie, Cell, LabelList,
} from 'recharts'
import DashboardLayout from '../../components/DashboardLayout'
import * as crm from '../../lib/crmApi'
import { SAGE, SAGE_DARK, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED } from '../../theme'
import { PhoneCall, PhoneOff, TrendingUp, Clock } from 'lucide-react'

const TOOLTIP = { background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', fontSize: 12 }

// Soft pastel palette for the charts (light fills, dark labels stay readable).
const LIGHT = { sage: '#C8DBBE', blue: '#CFE0FF', amber: '#FBE6BE', teal: '#C6E4EB', rose: '#F6D2D2', lilac: '#ECD4F5', slate: '#D6DBE2', mist: '#E6E6E6' }
// Per-stage colours for the pipeline bars.
const STAGE_COLOR = {
  New: LIGHT.slate, Contacted: LIGHT.blue, Interested: LIGHT.lilac, AppointmentBooked: LIGHT.amber,
  Visited: LIGHT.teal, Enrolled: LIGHT.sage, NotInterested: LIGHT.rose, Invalid: LIGHT.mist,
}
// Outcome donut palette.
const OUTCOME_COLOR = {
  interested: LIGHT.sage, callback: LIGHT.blue, enrolled: LIGHT.teal,
  not_interested: LIGHT.rose, wrong_number: LIGHT.mist, no_answer: LIGHT.amber, dnd: LIGHT.lilac,
}

function Stat({ icon: Icon, label, value, sub, color = SAGE }) {
  return (
    <div style={{ background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 12, padding: 16, flex: 1, minWidth: 150 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}18`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Icon size={16} color={color} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: INK }}>{value}</div>
      <div style={{ fontSize: 12, color: INK_MUTED, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#A0A0A0', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const Card = ({ title, subtitle, children }) => (
  <div style={{ background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 16, padding: 20 }}>
    <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{title}</div>
    {subtitle && <div style={{ fontSize: 12, color: INK_MUTED, margin: '2px 0 14px' }}>{subtitle}</div>}
    {children}
  </div>
)

export default function CrmAnalytics() {
  const [ov, setOv] = useState(null)
  const [byBranch, setByBranch] = useState([])
  const [byOfficer, setByOfficer] = useState([])
  const [pipeline, setPipeline] = useState({ counts: {}, stages: [] })
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([crm.crmOverview(), crm.crmByBranch(), crm.crmByOfficer(), crm.crmPipeline()])
      .then(([o, b, of, p]) => { setOv(o); setByBranch(b); setByOfficer(of); setPipeline(p) })
      .catch(e => setErr(e.response?.data?.message || 'Failed to load analytics'))
  }, [])

  // ── Shape data for the charts ──
  const funnelData = (pipeline.stages || []).map(s => ({ stage: s, count: pipeline.counts?.[s] ?? 0, fill: STAGE_COLOR[s] || SAGE }))
  const outcomeData = Object.entries(ov?.outcomes || {}).map(([k, v]) => ({ name: k.replace('_', ' '), key: k, value: v }))
  const branchData = byBranch.map(b => ({ name: b.branchName || '—', Calls: b.totalCalls, Connected: b.connected, Interested: b.interested }))
  const officerData = byOfficer.map(o => ({ name: o.name?.split(' ')[0] || o.name, Calls: o.callsMade, Appointments: o.appointmentsBooked, Visited: o.visited }))

  const td = { padding: '9px 14px', fontSize: 13, color: INK, borderTop: '1px solid #F0F0F0' }
  const th = { padding: '9px 14px', fontWeight: 600, textAlign: 'left', color: INK_MUTED, fontSize: 12 }

  return (
    <DashboardLayout>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: INK }}>CRM Analytics</h1>
      <p style={{ color: INK_MUTED, fontSize: 13, margin: '0 0 20px' }}>Calls, outcomes, branch & officer performance.</p>
      {err && <div style={{ background: '#FBEDED', border: '1px solid #E8C5C5', color: '#9B2C2C', borderRadius: 12, padding: 14, marginBottom: 16 }}>{err}</div>}

      {/* Headline stats */}
      {ov && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <Stat icon={PhoneCall} label="Total calls" value={ov.totalCalls} />
          <Stat icon={TrendingUp} label="Connect rate" value={`${ov.connectRate}%`} sub={`${ov.connected} connected`} color="#2451B7" />
          <Stat icon={PhoneOff} label="Unanswered" value={ov.unanswered} color="#9B2C2C" />
          <Stat icon={TrendingUp} label="Success rate" value={`${ov.successRate}%`} sub="interested + enrolled" color={SAGE_DARK} />
          <Stat icon={Clock} label="Avg duration" value={`${ov.avgDurationSec}s`} color={AMBER_DARK} />
        </div>
      )}

      {/* Row 1: funnel + outcomes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Lead pipeline" subtitle="Leads at each stage of the funnel">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 30, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEE" horizontal={false} />
              <XAxis type="number" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" stroke="#C7C7C7" tick={{ fill: INK_BODY, fontSize: 11 }} width={120} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: '#F4F4F2' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} name="Leads">
                {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                <LabelList dataKey="count" position="right" style={{ fill: INK_BODY, fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Call outcomes" subtitle="Disposition breakdown">
          {outcomeData.length === 0 ? (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A0A0A0', fontSize: 13 }}>No outcomes recorded yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={outcomeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {outcomeData.map((d, i) => <Cell key={i} fill={OUTCOME_COLOR[d.key] || SAGE} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 11, color: INK_BODY }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Row 2: by branch + by officer */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Calls by branch" subtitle="Volume, connected & interested per branch">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={branchData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEE" />
              <XAxis dataKey="name" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
              <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: '#F4F4F2' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: INK_BODY }} />
              <Bar dataKey="Calls" fill={LIGHT.sage} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Connected" fill={LIGHT.blue} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Interested" fill={LIGHT.amber} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Officer performance" subtitle="Calls vs appointments booked & visited">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={officerData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEE" />
              <XAxis dataKey="name" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
              <YAxis stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: '#F4F4F2' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: INK_BODY }} />
              <Bar dataKey="Calls" fill={LIGHT.sage} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Appointments" fill={LIGHT.amber} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Visited" fill={LIGHT.teal} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Officer detail table (exact numbers) */}
      <div style={{ background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, fontSize: 15, padding: '16px 16px 12px', color: INK }}>Officer leaderboard</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#FAFAFA' }}><th style={th}>Officer</th><th style={th}>Calls</th><th style={th}>Connect %</th><th style={th}>Interested</th><th style={th}>Appts booked</th><th style={th}>Visited</th><th style={th}>Conversion %</th></tr></thead>
          <tbody>
            {byOfficer.length === 0 && <tr><td style={{ ...td, color: '#A0A0A0' }} colSpan={7}>No officer activity yet.</td></tr>}
            {byOfficer.map(o => (
              <tr key={o.officerId}>
                <td style={{ ...td, fontWeight: 600 }}>{o.name}</td>
                <td style={td}>{o.callsMade}</td><td style={td}>{o.connectRate}%</td><td style={td}>{o.interested}</td>
                <td style={td}>{o.appointmentsBooked}</td><td style={td}>{o.visited}</td><td style={td}>{o.conversionRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}
