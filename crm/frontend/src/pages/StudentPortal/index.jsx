import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import * as crm from '../../lib/crmApi'
import { CalendarCheck, MapPin } from 'lucide-react'

const STATUS_COLORS = { booked: '#2451B7', reminded: '#C8923A', visited: '#4F664A', no_show: '#9B2C2C', cancelled: '#A0A0A0' }

export default function StudentPortal() {
  const [appts, setAppts] = useState([])
  const [branches, setBranches] = useState([])
  const [form, setForm] = useState({ scheduledFor: '', mode: 'campus_visit', notes: '' })
  const [msg, setMsg] = useState('')

  async function load() {
    try { setAppts(await crm.listAppointments()) } catch (e) { setMsg(e.response?.data?.message || 'Failed to load') }
  }
  useEffect(() => { load(); crm.listBranches().then(setBranches).catch(() => {}) }, [])

  async function book() {
    try { await crm.bookAppointment({ scheduledFor: form.scheduledFor, mode: form.mode, notes: form.notes }); setForm({ scheduledFor: '', mode: 'campus_visit', notes: '' }); setMsg('Appointment booked! We will remind you before your visit.'); load() }
    catch (e) { setMsg(e.response?.data?.message || 'Could not book') }
    setTimeout(() => setMsg(''), 4000)
  }

  const card = { background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 12, padding: 18 }
  const input = { padding: '9px 12px', border: '1px solid #E8E8E8', borderRadius: 8, fontSize: 13, width: '100%' }

  return (
    <DashboardLayout>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Book a Campus Visit</h1>
      <p style={{ color: '#7A7A7A', fontSize: 13, margin: '0 0 20px' }}>Pick a time to visit {branches[0]?.name || 'our campus'} and meet our counsellors.</p>
      {msg && <div style={{ ...card, padding: '12px 16px', marginBottom: 16, background: '#F1F5EE', borderColor: '#C7D5BD', color: '#4F664A', fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18, alignItems: 'start' }}>
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><CalendarCheck size={16} color="#7D9B76" /> New booking</div>
          <label style={{ fontSize: 12, color: '#7A7A7A', fontWeight: 600 }}>Date & time</label>
          <input type="datetime-local" value={form.scheduledFor} onChange={e => setForm({ ...form, scheduledFor: e.target.value })} style={{ ...input, margin: '6px 0 12px' }} />
          <label style={{ fontSize: 12, color: '#7A7A7A', fontWeight: 600 }}>Mode</label>
          <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} style={{ ...input, margin: '6px 0 12px' }}>
            <option value="campus_visit">Campus visit</option>
            <option value="virtual_tour">Virtual tour</option>
            <option value="counselling">Counselling session</option>
          </select>
          <label style={{ fontSize: 12, color: '#7A7A7A', fontWeight: 600 }}>Notes (optional)</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...input, margin: '6px 0 14px', resize: 'vertical' }} />
          <button disabled={!form.scheduledFor} onClick={book} style={{ width: '100%', background: '#7D9B76', color: '#FFF', border: 'none', borderRadius: 9, padding: '11px', fontWeight: 700, cursor: 'pointer', opacity: form.scheduledFor ? 1 : 0.6 }}>Book visit</button>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>My appointments</div>
          {appts.length === 0 && <div style={{ ...card, color: '#A0A0A0', textAlign: 'center' }}>No appointments yet — book your first campus visit.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {appts.map(a => (
              <div key={a._id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#2C2C2C' }}>{new Date(a.scheduledFor).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  <div style={{ fontSize: 12, color: '#7A7A7A', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, textTransform: 'capitalize' }}>
                    <MapPin size={11} /> {a.branchId?.name || 'Campus'} · {a.mode.replace('_', ' ')}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: STATUS_COLORS[a.status], background: `${STATUS_COLORS[a.status]}18`, border: `1px solid ${STATUS_COLORS[a.status]}33`, padding: '3px 10px', borderRadius: 999 }}>{a.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
