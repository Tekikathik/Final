import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Phone, Building2, Shield, Lock, Camera, Edit2, Save,
  CheckCircle, AlertCircle, Activity, Bell,
  LogIn, FileText, Settings as SettingsIcon, Eye, EyeOff,
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

function Section({ icon: Icon, title, subtitle, action, children, delay = 0 }) {
  return (
    <motion.div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <div style={{ padding: '16px 26px', borderBottom: '1px solid #E8E8E8', display: 'flex', alignItems: 'center', gap: 12 }}>
        {Icon && (
          <div style={{ width: 32, height: 32, borderRadius: 9, background: '#F1F5EE', border: '1px solid #C7D5BD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={16} color={SAGE_DARK} />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      <div style={{ padding: 26 }}>{children}</div>
    </motion.div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: INK_MUTED, marginTop: 4 }}>{hint}</p>}
    </div>
  )
}

function ActivityRow({ icon: Icon, color, title, time, meta, idx }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
      style={{ display: 'flex', gap: 12, padding: '14px 0', borderBottom: '1px solid #F4F4F2' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}1A`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={15} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: INK, fontWeight: 500 }}>{title}</div>
        {meta && <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }}>{meta}</div>}
      </div>
      <div style={{ fontSize: 11, color: INK_MUTED, whiteSpace: 'nowrap' }}>{time}</div>
    </motion.div>
  )
}

const ACTIVITY = [
  { icon: LogIn,        color: SAGE,       title: 'Signed in from Hyderabad, IN',  meta: 'Chrome 138 · Windows 11',                          time: '2 min ago' },
  { icon: Edit2,        color: AMBER,      title: 'Updated organisation profile',   meta: 'Changed location, website',                        time: '3 hours ago' },
  { icon: FileText,     color: SAGE_DARK,  title: 'Exported student report',        meta: 'Aditya University · 12 records',                  time: 'Yesterday' },
  { icon: Activity,     color: AMBER_DARK, title: 'Launched calling campaign',      meta: '218 contacts · Aditya Engineering College',       time: '2 days ago' },
  { icon: SettingsIcon, color: '#9B2C2C',  title: 'Updated AI voice model',         meta: 'AdmitBot v3 → Hindi/English',                     time: '5 days ago' },
]

export default function Profile() {
  const { user, org, updateProfile, changePassword } = useStore()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: user?.name || '', email: user?.email || '', phone: user?.phone || '',
  })
  const [profileMsg, setProfileMsg] = useState(null)

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false })
  const [pwMsg, setPwMsg] = useState(null)
  const [savingPw, setSavingPw] = useState(false)

  const [prefs, setPrefs] = useState({
    emailDaily: true, emailCampaigns: true, smsAlerts: false, desktopNotifs: true,
  })

  const fileInputRef = useRef(null)
  const handleAvatarPick = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProfileMsg({ ok: false, text: 'Please choose an image file.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileMsg({ ok: false, text: 'Image must be under 2MB.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      updateProfile({ avatar: reader.result })
      setProfileMsg({ ok: true, text: 'Avatar updated.' })
      setTimeout(() => setProfileMsg(null), 2500)
    }
    reader.readAsDataURL(file)
  }

  const handleSaveProfile = () => {
    if (!form.name.trim()) { setProfileMsg({ ok: false, text: 'Name is required.' }); return }
    if (!form.email.includes('@')) { setProfileMsg({ ok: false, text: 'Enter a valid email.' }); return }
    updateProfile(form)
    setEditing(false)
    setProfileMsg({ ok: true, text: 'Profile updated successfully.' })
    setTimeout(() => setProfileMsg(null), 3000)
  }

  const handleSavePassword = async () => {
    setPwMsg(null)
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return }
    setSavingPw(true)
    const result = await changePassword({ currentPassword: pw.current, newPassword: pw.next })
    setSavingPw(false)
    if (result.ok) {
      setPwMsg({ ok: true, text: 'Password updated successfully.' })
      setPw({ current: '', next: '', confirm: '' })
      setTimeout(() => setPwMsg(null), 3500)
    } else {
      setPwMsg({ ok: false, text: result.message })
    }
  }

  const joined = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  const messageBox = (msg) => msg && (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      style={{
        marginBottom: 12, padding: '10px 14px',
        background: msg.ok ? '#F1F5EE' : '#FBEDED',
        border: `1px solid ${msg.ok ? '#C7D5BD' : '#F2C8C8'}`,
        borderRadius: 10, fontSize: 13, color: msg.ok ? SAGE_DARK : '#9B2C2C',
        display: 'flex', alignItems: 'center', gap: 8, maxWidth: 660,
      }}>
      {msg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />} {msg.text}
    </motion.div>
  )

  const readonlyChip = (icon, value) => (
    <div style={{ padding: '11px 14px', background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10, fontSize: 13, color: INK, display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon}{value}
    </div>
  )

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1140, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>My Profile</h1>
          <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 4 }}>Manage your personal info, security, and preferences</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26, textAlign: 'center', marginBottom: 20 }}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ position: 'relative', width: 116, height: 116, margin: '0 auto 16px' }}>
                <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: user?.avatar ? `url(${user.avatar}) center/cover` : SAGE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, fontWeight: 600, color: 'white', boxShadow: '0 8px 28px rgba(125,155,118,0.25)' }}>
                  {!user?.avatar && (user?.name?.[0]?.toUpperCase() || 'U')}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarPick} style={{ display: 'none' }} />
                <button title="Change photo" onClick={() => fileInputRef.current?.click()}
                  style={{ position: 'absolute', bottom: 0, right: 0, width: 34, height: 34, borderRadius: '50%', border: '3px solid #FFFFFF', background: AMBER, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                  <Camera size={14} color="white" />
                </button>
              </div>
              <div style={{ fontSize: 19, fontWeight: 600, color: INK }}>{user?.name}</div>
              <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 2 }}>{user?.email}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '5px 14px', background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 999, fontSize: 12, color: SAGE_DARK, fontWeight: 600, textTransform: 'capitalize' }}>
                <Shield size={12} /> {(user?.role || 'member').replace('_', ' ')}
              </div>
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #F4F4F2', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: INK_MUTED }}>Member since</span>
                  <span style={{ color: INK, fontWeight: 500 }}>{joined}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: INK_MUTED }}>Status</span>
                  <span style={{ color: SAGE_DARK, fontWeight: 500 }}>● Active</span>
                </div>
              </div>
            </motion.div>

            <motion.div className="glass-card" style={{ borderRadius: 16, padding: 22 }}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 14 }}>Account Stats</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: 'Campaigns Launched', value: 14,    color: SAGE },
                  { label: 'Reports Generated',  value: 47,    color: AMBER },
                  { label: 'Hours Saved',        value: '128h', color: SAGE_DARK },
                ].map((s) => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: INK_MUTED }}>{s.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 600, color: s.color }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          <div>
            <Section
              icon={User}
              title="Personal Details"
              subtitle="Your contact info shown across the platform"
              delay={0.05}
              action={
                editing ? (
                  <button className="pill-confirm" style={{ padding: '7px 16px', fontSize: 12 }} onClick={handleSaveProfile}>
                    <Save size={13} /> Save
                  </button>
                ) : (
                  <button className="pill-outline" style={{ padding: '6px 16px', fontSize: 12 }} onClick={() => setEditing(true)}>
                    <Edit2 size={13} /> Edit
                  </button>
                )
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Full Name">
                  {editing
                    ? <input className="input-dark" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                    : readonlyChip(null, user?.name || '—')}
                </Field>
                <Field label="Email Address">
                  {editing
                    ? <input className="input-dark" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                    : readonlyChip(<Mail size={13} color={INK_MUTED} />, user?.email || '—')}
                </Field>
                <Field label="Phone Number">
                  {editing
                    ? <input className="input-dark" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 ..." />
                    : readonlyChip(<Phone size={13} color={INK_MUTED} />, user?.phone || '—')}
                </Field>
                <Field label="Role">
                  <div style={{ padding: '11px 14px', background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10, fontSize: 13, color: INK, display: 'flex', alignItems: 'center', gap: 8, textTransform: 'capitalize' }}>
                    <Shield size={13} color={INK_MUTED} />{(user?.role || '—').replace('_', ' ')}
                  </div>
                </Field>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field label="Organisation">
                    <div style={{ padding: '11px 14px', background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10, fontSize: 13, color: INK, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Building2 size={13} color={INK_MUTED} />{org?.name || user?.orgName || '—'}
                      {org?.location && <span style={{ marginLeft: 'auto', color: INK_MUTED, fontSize: 12 }}>{org.location}</span>}
                    </div>
                  </Field>
                </div>
                {user?.role === 'college_admin' && user?.collegeName && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Assigned College">
                      <div style={{ padding: '11px 14px', background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 10, fontSize: 13, color: SAGE_DARK, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                        <Building2 size={13} />{user.collegeName}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: INK_MUTED, fontFamily: 'monospace' }}>{user.collegeIds?.[0]}</span>
                      </div>
                    </Field>
                  </div>
                )}
              </div>

              <AnimatePresence>{messageBox(profileMsg)}</AnimatePresence>
            </Section>

            <Section icon={Lock} title="Reset Password" subtitle="Use a strong password (min 6 chars)" delay={0.1}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 660 }}>
                {[
                  { key: 'current', label: 'Current Password' },
                  { key: 'next',    label: 'New Password' },
                  { key: 'confirm', label: 'Confirm New Password' },
                ].map(({ key, label }, i) => (
                  <div key={key} style={{ gridColumn: i === 0 ? '1 / -1' : 'auto' }}>
                    <Field label={label}>
                      <div style={{ position: 'relative' }}>
                        <Lock size={14} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                          className="input-dark"
                          style={{ paddingLeft: 38, paddingRight: 38 }}
                          type={showPw[key] ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={pw[key]}
                          onChange={e => setPw(p => ({ ...p, [key]: e.target.value }))}
                        />
                        <button onClick={() => setShowPw(p => ({ ...p, [key]: !p[key] }))}
                          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: INK_MUTED }}>
                          {showPw[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </Field>
                  </div>
                ))}
              </div>

              <AnimatePresence>{messageBox(pwMsg)}</AnimatePresence>

              <button className="btn-primary" style={{ padding: '10px 26px', opacity: savingPw ? 0.7 : 1 }} disabled={savingPw} onClick={handleSavePassword}>
                {savingPw ? 'Updating...' : 'Update Password'}
              </button>
            </Section>

            <Section icon={Bell} title="Notification Preferences" subtitle="Pick how we should keep you informed" delay={0.15}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { key: 'emailDaily',     label: 'Daily email digest',         hint: 'A summary of yesterday\'s campaigns at 9 AM.' },
                  { key: 'emailCampaigns', label: 'Campaign completion emails', hint: 'Get notified the moment a campaign finishes.' },
                  { key: 'smsAlerts',      label: 'SMS alerts',                 hint: 'High-priority alerts via SMS to your phone.' },
                  { key: 'desktopNotifs',  label: 'Desktop notifications',      hint: 'Browser notifications for live campaign events.' },
                ].map((p) => (
                  <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', cursor: 'pointer', borderBottom: '1px solid #F4F4F2' }}>
                    <input
                      type="checkbox"
                      checked={prefs[p.key]}
                      onChange={e => setPrefs(prev => ({ ...prev, [p.key]: e.target.checked }))}
                      style={{ width: 16, height: 16, accentColor: SAGE, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: INK, fontWeight: 500 }}>{p.label}</div>
                      <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 2 }}>{p.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </Section>

            <Section icon={Activity} title="Recent Activity" subtitle="Your last actions across the platform" delay={0.2}>
              <div>
                {ACTIVITY.map((a, i) => <ActivityRow key={i} {...a} idx={i} />)}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
