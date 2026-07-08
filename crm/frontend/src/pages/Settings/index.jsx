import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Building2, Globe, MapPin, Lock, CheckCircle, AlertCircle } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'
import api from '../../lib/api'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

function Section({ title, children, delay = 0 }) {
  return (
    <motion.div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <div style={{ padding: '16px 26px', borderBottom: '1px solid #E8E8E8', fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
      <div style={{ padding: 26 }}>{children}</div>
    </motion.div>
  )
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 12, color: INK_MUTED, marginTop: 4 }}>{hint}</p>}
    </div>
  )
}

export default function Settings() {
  const { user, org } = useStore()
  const [orgForm, setOrgForm] = useState({ name: '', type: '', location: '', website: '', description: '' })
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [orgMsg, setOrgMsg] = useState(null)
  const [pwMsg, setPwMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    if (org) setOrgForm({ name: org.name || '', type: org.type || 'Engineering', location: org.location || '', website: org.website || '', description: org.description || '' })
  }, [org])

  const saveOrg = async () => {
    setSaving(true); setOrgMsg(null)
    try {
      await api.put(`/orgs/${org.id}`, orgForm)
      setOrgMsg({ ok: true, text: 'Organisation settings saved!' })
    } catch (err) {
      setOrgMsg({ ok: false, text: err.response?.data?.message || 'Save failed' })
    } finally { setSaving(false) }
  }

  const savePassword = async () => {
    if (pwForm.newPassword !== pwForm.confirm) { setPwMsg({ ok: false, text: 'Passwords do not match' }); return }
    if (pwForm.newPassword.length < 6) { setPwMsg({ ok: false, text: 'Password must be at least 6 characters' }); return }
    setSavingPw(true); setPwMsg(null)
    try {
      await api.put('/auth/me/password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword })
      setPwMsg({ ok: true, text: 'Password updated successfully!' })
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      setPwMsg({ ok: false, text: err.response?.data?.message || 'Password change failed' })
    } finally { setSavingPw(false) }
  }

  const messageBox = (msg) => msg && (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{
        marginBottom: 14, padding: '10px 14px',
        background: msg.ok ? '#F1F5EE' : '#FBEDED',
        border: `1px solid ${msg.ok ? '#C7D5BD' : '#F2C8C8'}`,
        borderRadius: 10, fontSize: 13, color: msg.ok ? SAGE_DARK : '#9B2C2C',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
      {msg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />} {msg.text}
    </motion.div>
  )

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>Settings</h1>
          <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 4 }}>Manage your organisation and account preferences</p>
        </div>

        <Section title="Organisation Profile" delay={0.05}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Organisation Name">
                <div style={{ position: 'relative' }}>
                  <Building2 size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                  <input className="input-dark" style={{ paddingLeft: 38 }} value={orgForm.name} onChange={e => setOrgForm(p => ({ ...p, name: e.target.value }))} />
                </div>
              </Field>
            </div>
            <Field label="Institution Type">
              <select className="input-dark" value={orgForm.type} onChange={e => setOrgForm(p => ({ ...p, type: e.target.value }))}>
                {['Engineering', 'Management', 'Medical', 'Arts & Science', 'Law', 'Pharmacy', 'Architecture', 'University'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <div style={{ position: 'relative' }}>
                <MapPin size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                <input className="input-dark" style={{ paddingLeft: 38 }} value={orgForm.location} onChange={e => setOrgForm(p => ({ ...p, location: e.target.value }))} />
              </div>
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Website">
                <div style={{ position: 'relative' }}>
                  <Globe size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                  <input className="input-dark" style={{ paddingLeft: 38 }} placeholder="https://..." value={orgForm.website} onChange={e => setOrgForm(p => ({ ...p, website: e.target.value }))} />
                </div>
              </Field>
              <Field label="Description">
                <textarea className="input-dark" rows={3} style={{ resize: 'vertical', fontFamily: 'inherit' }} value={orgForm.description} onChange={e => setOrgForm(p => ({ ...p, description: e.target.value }))} />
              </Field>
            </div>
          </div>

          {messageBox(orgMsg)}

          <button className="btn-primary" style={{ padding: '10px 26px', opacity: saving ? 0.7 : 1 }} onClick={saveOrg} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </Section>

        <Section title="Account Info" delay={0.1}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[['Name', user?.name], ['Email', user?.email], ['Role', user?.role], ['Organisation', org?.name]].map(([k, v]) => (
              <div key={k} style={{ padding: '12px 16px', background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: INK_MUTED, marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 13, color: INK, fontWeight: 600, textTransform: 'capitalize' }}>{v}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Change Password" delay={0.15}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
            {[
              { label: 'Current Password',     key: 'currentPassword' },
              { label: 'New Password',         key: 'newPassword' },
              { label: 'Confirm New Password', key: 'confirm' },
            ].map(({ label, key }) => (
              <Field key={key} label={label}>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                  <input className="input-dark" style={{ paddingLeft: 38 }} type="password" placeholder="••••••••" value={pwForm[key]} onChange={e => setPwForm(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              </Field>
            ))}
          </div>
          {messageBox(pwMsg)}
          <button className="btn-primary" style={{ padding: '10px 26px', opacity: savingPw ? 0.7 : 1 }} onClick={savePassword} disabled={savingPw}>
            {savingPw ? 'Updating...' : 'Update Password'}
          </button>
        </Section>

        <Section title="AI Telephony API" delay={0.2}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Webhook Endpoint (send to your AI system)" hint="Your AI system should POST conversation data to this URL after each call.">
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input-dark" readOnly value="http://localhost:5000/api/calls/webhook" style={{ flex: 1, color: SAGE_DARK, fontFamily: 'monospace', fontSize: 13 }} />
                <button className="btn-secondary" style={{ padding: '10px 16px', fontSize: 13, flexShrink: 0 }} onClick={() => navigator.clipboard?.writeText('http://localhost:5000/api/calls/webhook')}>Copy</button>
              </div>
            </Field>
            <Field label="API Documentation">
              <div style={{ padding: 16, background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10, fontFamily: 'monospace', fontSize: 12, color: INK_BODY, lineHeight: 1.8 }}>
                POST /api/calls/webhook<br />
                {'{'}<br />
                &nbsp;&nbsp;"phone": "+91 98765 43210",<br />
                &nbsp;&nbsp;"campaignId": "uuid",<br />
                &nbsp;&nbsp;"status": "completed",<br />
                &nbsp;&nbsp;"duration": 272,<br />
                &nbsp;&nbsp;"sentiment": "positive",<br />
                &nbsp;&nbsp;"interested": true,<br />
                &nbsp;&nbsp;"summary": "Student expressed...",<br />
                &nbsp;&nbsp;"profile": {'{'} "name": "...", "examAppeared": "JEE", ... {'}'},<br />
                &nbsp;&nbsp;"transcript": [ {'{'} "speaker": "ai", "text": "...", "timestamp": 0 {'}'}, ... ]<br />
                {'}'}
              </div>
            </Field>
          </div>
        </Section>
      </div>
    </DashboardLayout>
  )
}
