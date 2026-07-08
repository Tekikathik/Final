import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import * as crm from '../../lib/crmApi'

export default function AuditLog() {
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => { crm.listAudit({ limit: 100 }).then(d => setItems(d.items || [])).catch(e => setErr(e.response?.data?.message || 'Failed to load audit log')) }, [])

  const th = { padding: '9px 14px', fontWeight: 600, textAlign: 'left', color: '#7A7A7A', fontSize: 12 }
  const td = { padding: '9px 14px', fontSize: 13, color: '#2C2C2C', borderTop: '1px solid #F0F0F0' }

  return (
    <DashboardLayout>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Audit Log</h1>
      <p style={{ color: '#7A7A7A', fontSize: 13, margin: '0 0 20px' }}>Who did what — accountability across roles.</p>
      {err && <div style={{ background: '#FBEDED', border: '1px solid #E8C5C5', color: '#9B2C2C', borderRadius: 12, padding: 14, marginBottom: 14 }}>{err}</div>}
      <div style={{ background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#FAFAFA' }}><th style={th}>When</th><th style={th}>Actor</th><th style={th}>Role</th><th style={th}>Action</th><th style={th}>Entity</th><th style={th}>Details</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td style={{ ...td, color: '#A0A0A0' }} colSpan={6}>No audit entries yet.</td></tr>}
            {items.map(a => (
              <tr key={a._id}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: '#7A7A7A' }}>{new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={td}>{a.actorId?.name || '—'}</td>
                <td style={{ ...td, textTransform: 'capitalize', color: '#5A5A5A' }}>{a.actorRole}</td>
                <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#2451B7' }}>{a.action}</span></td>
                <td style={{ ...td, color: '#5A5A5A' }}>{a.entity || '—'}</td>
                <td style={{ ...td, color: '#7A7A7A', fontSize: 12 }}>{a.meta ? JSON.stringify(a.meta).slice(0, 80) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}
