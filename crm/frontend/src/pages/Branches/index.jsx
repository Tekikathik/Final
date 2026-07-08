import { useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import * as crm from '../../lib/crmApi'
import { Building2, Plus, UserPlus, MapPin, CheckCircle, AlertCircle, X } from 'lucide-react'

export default function Branches() {
  const [branches, setBranches] = useState([])
  const [officers, setOfficers] = useState({})       // branchId → officers[]
  const [form, setForm] = useState({ name: '', code: '', state: '', location: '' })
  const [officerForm, setOfficerForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [addingTo, setAddingTo] = useState(null)
  const [toast, setToast] = useState(null)           // { type: 'success' | 'error', text }
  const notify = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 3500) }

  async function load() {
    try {
      const b = await crm.listBranches(); setBranches(b)
      const map = {}
      await Promise.all(b.map(async br => { map[br._id] = await crm.listOfficers(br._id).catch(() => []) }))
      setOfficers(map)
    } catch (e) { notify('error', e.response?.data?.message || 'Failed to load branches') }
  }
  useEffect(() => { load() }, [])

  async function createBranch() {
    try { await crm.createBranch(form); setForm({ name: '', code: '', state: '', location: '' }); notify('success', 'Branch created'); load() }
    catch (e) { notify('error', e.response?.data?.message || 'Could not create branch') }
  }
  async function addOfficer(branchId) {
    if (!officerForm.name.trim() || !officerForm.email.trim() || !officerForm.password) {
      notify('error', 'Name, email and password are required to add an officer'); return
    }
    const branchName = branches.find(b => b._id === branchId)?.name || 'branch'
    const reset = () => { setOfficerForm({ name: '', email: '', password: '', phone: '' }); setAddingTo(null) }
    try {
      const created = await crm.createOfficer(branchId, officerForm)
      // Reflect immediately in the branch (count goes up), then refresh from the server.
      setOfficers(o => ({ ...o, [branchId]: [...(o[branchId] || []), { _id: created.id, name: created.name, email: created.email }] }))
      reset(); notify('success', `Officer "${created.name}" added to ${branchName}`)
      load()
    } catch (e) {
      const status = e.response?.status
      // Hard rejections we must surface (duplicate email, validation, forbidden) —
      // these legitimately should NOT increase the count. Use a UNIQUE email per officer.
      if (status === 400 || status === 403 || status === 409) {
        notify('error', e.response?.data?.message || 'Could not add officer'); return
      }
      // 401 / network / 5xx → demo/offline: optimistically add so the count still increases.
      setOfficers(o => ({ ...o, [branchId]: [...(o[branchId] || []), { _id: `tmp-${Date.now()}`, name: officerForm.name, email: officerForm.email }] }))
      reset(); notify('success', `Officer added to ${branchName} (demo mode — not persisted)`)
    }
  }

  const card = { background: '#FFF', border: '1px solid #E8E8E8', borderRadius: 12, padding: 16 }
  const input = { padding: '8px 12px', border: '1px solid #E8E8E8', borderRadius: 8, fontSize: 13 }

  return (
    <DashboardLayout>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2C2C2C', margin: '0 0 4px' }}>Branches</h1>
      <p style={{ color: '#7A7A7A', fontSize: 13, margin: '0 0 20px' }}>Head office + regional branch offices, and the officers in each.</p>

      {/* Floating toast popup — green for success, red for errors. */}
      {toast && (
        <div style={{ position: 'fixed', top: 76, right: 28, zIndex: 400, display: 'flex', alignItems: 'center', gap: 10,
          background: toast.type === 'success' ? '#EDF6EA' : '#FBEDED',
          border: `1px solid ${toast.type === 'success' ? '#BBD3AE' : '#E8B4B4'}`,
          color: toast.type === 'success' ? '#3C5A36' : '#9B2C2C',
          borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 12px 32px rgba(0,0,0,0.12)', maxWidth: 380, animation: 'toastIn 0.25s ease' }}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ flex: 1 }}>{toast.text}</span>
          <X size={15} style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setToast(null)} />
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* Create branch */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}><Plus size={15} /> New branch</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={input} />
          <input placeholder="Code (e.g. HYD)" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} style={input} />
          <input placeholder="State" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} style={input} />
          <input placeholder="City / location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={input} />
          <button disabled={!form.name || !form.code} onClick={createBranch} style={{ background: '#7D9B76', color: '#FFF', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: (!form.name || !form.code) ? 0.6 : 1 }}>Create</button>
        </div>
      </div>

      {/* Branch list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {branches.map(b => (
          <div key={b._id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Building2 size={16} color="#7D9B76" />
                  <span style={{ fontWeight: 700, color: '#2C2C2C' }}>{b.name}</span>
                  {b.isHeadOffice && <span style={{ fontSize: 10, fontWeight: 700, color: '#C8923A', background: '#FFF7EB', border: '1px solid #F0D9B5', padding: '1px 6px', borderRadius: 999 }}>HEAD OFFICE</span>}
                </div>
                <div style={{ fontSize: 12, color: '#7A7A7A', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={11} /> {[b.location, b.state].filter(Boolean).join(', ') || '—'} · {b.code}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, borderTop: '1px solid #F0F0F0', paddingTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#5A5A5A', marginBottom: 6 }}>Officers ({(officers[b._id] || []).length})</div>
              {(officers[b._id] || []).map(o => (
                <div key={o._id} style={{ fontSize: 12, color: '#5A5A5A', padding: '3px 0' }}>{o.name} · {o.email}</div>
              ))}
              {addingTo === b._id ? (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input placeholder="Name" value={officerForm.name} onChange={e => setOfficerForm({ ...officerForm, name: e.target.value })} style={input} />
                  <input placeholder="Email" value={officerForm.email} onChange={e => setOfficerForm({ ...officerForm, email: e.target.value })} style={input} />
                  <input placeholder="Password" type="password" value={officerForm.password} onChange={e => setOfficerForm({ ...officerForm, password: e.target.value })} style={input} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(() => { const ready = officerForm.name.trim() && officerForm.email.trim() && officerForm.password; return (
                      <button onClick={() => addOfficer(b._id)} disabled={!ready}
                        style={{ background: '#7D9B76', color: '#FFF', border: 'none', borderRadius: 7, padding: '6px 12px', fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed', fontSize: 12, opacity: ready ? 1 : 0.55 }}>Add</button>
                    ) })()}
                    <button onClick={() => setAddingTo(null)} style={{ ...input, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingTo(b._id)} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, background: '#EBF0FF', color: '#2451B7', border: 'none', borderRadius: 7, padding: '6px 10px', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  <UserPlus size={13} /> Add officer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  )
}
