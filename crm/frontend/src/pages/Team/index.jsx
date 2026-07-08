import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Plus, Shield, Eye, UserCog, Trash2, CheckCircle, Building2 } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore, DEMO_ACCOUNTS } from '../../store/useStore'
import api from '../../lib/api'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

const ROLE_CONFIG = {
  admin:         { label: 'Admin',             color: SAGE_DARK,  icon: Shield },
  college_admin: { label: 'College Admin',     color: AMBER_DARK, icon: Building2 },
  officer:       { label: 'Admission Officer', color: AMBER_DARK, icon: UserCog },
  viewer:        { label: 'Viewer',            color: SAGE,       icon: Eye },
}

/**
 * Build the demo team roster from DEMO_ACCOUNTS so the page is populated when
 * the backend is unreachable. Each demo account becomes a "member" — the org
 * admin, the per-college principals, and the read-only viewer all appear,
 * which is what reviewers expect to see after we expanded the role-based
 * login to seven seeded users.
 */
function demoMembers() {
  return DEMO_ACCOUNTS.map((a) => ({
    _id: a.user.id,
    name: a.user.name,
    email: a.user.email,
    phone: a.user.phone,
    role: a.user.role,
    collegeName: a.user.collegeName,
    collegeIds: a.user.collegeIds,
    isDemo: true,
  }))
}

export default function Team() {
  const { user, org, accessToken: storeToken } = useStore()
  const [members, setMembers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'officer', password: '' })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')

  const load = () => {
    // Always start from the demo roster so the page is never empty in the
    // marketing demo. If the backend responds with real users, swap them in;
    // otherwise the demo list stays as the visible team.
    setMembers(demoMembers())
    if (!org?.id) return
    api.get(`/orgs/${org.id}/users`)
      .then(r => { if (Array.isArray(r.data) && r.data.length) setMembers(r.data) })
      .catch(() => {})
  }

  useEffect(() => { load() }, [org?.id])

  const invite = async () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Required'
    if (!form.email.includes('@')) e.email = 'Valid email required'
    if (form.password && form.password.length < 6) e.password = 'Min 6 chars'
    if (Object.keys(e).length) { setErrors(e); return }

    // Demo mode: no real backend session, so API calls won't work
    if (storeToken === 'demo' || !org?.id) {
      setErrors({ api: 'Please log in with a real account to manage team members.' })
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/orgs/${org.id}/users`, form)
      setSuccess('Team member added!')
      setShowModal(false)
      setForm({ name: '', email: '', phone: '', role: 'officer', password: '' })
      load()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      const msg = err.response?.data?.message
        || (err.response ? `Server error ${err.response.status}` : 'Could not reach the server. Is the backend running?')
      setErrors({ api: msg })
    } finally { setSubmitting(false) }
  }

  const remove = async (userId) => {
    if (!confirm('Remove this team member?')) return
    await api.delete(`/orgs/${org.id}/users/${userId}`).catch(() => {})
    load()
  }

  const changeRole = async (userId, role) => {
    await api.put(`/orgs/${org.id}/users/${userId}`, { role }).catch(() => {})
    load()
  }

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>Team Management</h1>
            <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 4 }}>Manage users and their roles in your organisation</p>
          </div>
          {user?.role === 'admin' && (
            <motion.button whileTap={{ scale: 0.97 }} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setShowModal(true)}>
              <Plus size={16} /> Add Member
            </motion.button>
          )}
        </div>

        {success && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 16, padding: '12px 16px', background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: SAGE_DARK }}>
            <CheckCircle size={16} /> {success}
          </motion.div>
        )}

        <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
          {members.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: INK_MUTED }}>
              <Users size={42} color="#C7C7C7" style={{ margin: '0 auto 12px' }} />
              <p>No team members yet. Add your first team member above.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FBFBFA', borderBottom: '1px solid #E8E8E8' }}>
                  {['Member', 'Role', 'Email', 'Phone', ...(user?.role === 'admin' ? ['Actions'] : [])].map(h => (
                    <th key={h} style={{ padding: '13px 22px', textAlign: 'left', fontSize: 12, color: INK_MUTED, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => {
                  const rc = ROLE_CONFIG[m.role] || ROLE_CONFIG.viewer
                  return (
                    <motion.tr key={m._id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      style={{ borderBottom: '1px solid #F4F4F2' }}>
                      <td style={{ padding: '14px 22px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, background: SAGE, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'white' }}>
                            {m.name?.[0]?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{m.name}</div>
                            {m._id === user?.id && <div style={{ fontSize: 11, color: SAGE_DARK, fontWeight: 500 }}>You</div>}
                            {m.role === 'college_admin' && m.collegeName && (
                              <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Building2 size={10} /> {m.collegeName}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 22px' }}>
                        {user?.role === 'admin' && m._id !== user?.id ? (
                          <select style={{ background: `${rc.color}1A`, border: `1px solid ${rc.color}40`, borderRadius: 999, padding: '5px 10px', fontSize: 12, color: rc.color, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                            value={m.role} onChange={e => changeRole(m._id, e.target.value)}>
                            {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: 12, color: rc.color, fontWeight: 600, background: `${rc.color}1A`, border: `1px solid ${rc.color}40`, borderRadius: 999, padding: '4px 12px' }}>{rc.label}</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 22px', fontSize: 13, color: INK_BODY }}>{m.email}</td>
                      <td style={{ padding: '14px 22px', fontSize: 13, color: INK_MUTED }}>{m.phone || '—'}</td>
                      {user?.role === 'admin' && (
                        <td style={{ padding: '14px 22px' }}>
                          {m._id !== user?.id && (
                            <button onClick={() => remove(m._id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B2C2C', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit' }}>
                              <Trash2 size={14} /> Remove
                            </button>
                          )}
                        </td>
                      )}
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(44,44,44,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24, backdropFilter: 'blur(2px)' }}
            onClick={e => e.target === e.currentTarget && setShowModal(false)}>
            <motion.div initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="glass-card" style={{ width: '100%', maxWidth: 460, borderRadius: 22, padding: 36 }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, color: INK, marginBottom: 6 }}>Add Team Member</h3>
              <p style={{ fontSize: 13, color: INK_MUTED, marginBottom: 24 }}>They'll receive an email to set their password.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Full Name *',         key: 'name',     type: 'text',     placeholder: 'Dr. Priya Sharma' },
                  { label: 'Email *',             key: 'email',    type: 'email',    placeholder: 'officer@college.edu.in' },
                  { label: 'Phone',               key: 'phone',    type: 'tel',      placeholder: '+91 98765 43210' },
                  { label: 'Temporary Password',  key: 'password', type: 'password', placeholder: 'Min 6 characters' },
                ].map(({ label, key, type, placeholder }) => (
                  <div key={key}>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>{label}</label>
                    <input className="input-dark" type={type} placeholder={placeholder} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
                    {errors[key] && <span style={{ fontSize: 12, color: '#9B2C2C', marginTop: 4, display: 'block' }}>{errors[key]}</span>}
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Role</label>
                  <select className="input-dark" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                    {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                {errors.api && <div style={{ padding: '10px 12px', background: '#FBEDED', border: '1px solid #F2C8C8', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{errors.api}</div>}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn-primary" style={{ flex: 1, opacity: submitting ? 0.7 : 1 }} onClick={invite} disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}
