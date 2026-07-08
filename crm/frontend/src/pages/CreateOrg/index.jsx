import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, User, Mail, Phone, MapPin, Globe, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react'
import { useStore } from '../../store/useStore'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

const STEPS = ['Organisation', 'Administrator', 'Confirm']

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
}

export default function CreateOrg() {
  const navigate = useNavigate()
  const { register, loading } = useStore()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [org, setOrg] = useState({ name: '', type: 'Engineering', location: '', website: '', description: '' })
  const [admin, setAdmin] = useState({ name: '', email: '', phone: '', password: '' })
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')

  const go = (d) => {
    if (d === 1 && step === 0) {
      const e = {}
      if (!org.name.trim()) e.name = 'Required'
      if (!org.location.trim()) e.location = 'Required'
      if (Object.keys(e).length) { setErrors(e); return }
    }
    if (d === 1 && step === 1) {
      const e = {}
      if (!admin.name.trim()) e.aname = 'Required'
      if (!admin.email.includes('@')) e.email = 'Valid email required'
      if (admin.password.length < 6) e.password = 'Min 6 characters'
      if (Object.keys(e).length) { setErrors(e); return }
    }
    setErrors({})
    setDir(d)
    setStep((s) => s + d)
  }

  const submit = async () => {
    setApiError('')
    const result = await register({
      orgName: org.name, orgType: org.type, location: org.location, website: org.website, description: org.description,
      name: admin.name, email: admin.email, password: admin.password, phone: admin.phone,
    })
    if (result.ok) navigate('/dashboard')
    else setApiError(result.message)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative' }}>
      <div className="orb orb-blue"   style={{ width: 520, height: 520, top: -100, left: -100, opacity: 0.7 }} />
      <div className="orb orb-purple" style={{ width: 420, height: 420, bottom: -100, right: -50, opacity: 0.6 }} />

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40, cursor: 'pointer' }} onClick={() => navigate('/')}>
        <div style={{ width: 38, height: 38, background: SAGE, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Phone size={18} color="white" />
        </div>
        <span style={{ fontWeight: 600, fontSize: 20, color: INK, letterSpacing: -0.3 }}>AdmitAI</span>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 25 }}
        className="glass-card" style={{ width: '100%', maxWidth: 580, borderRadius: 24, padding: 44, position: 'relative', zIndex: 2 }}>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 36 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'unset' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <motion.div
                  animate={{ scale: i === step ? 1.08 : 1 }}
                  style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, background: i <= step ? SAGE : '#F4F4F2', color: i <= step ? '#FFFFFF' : INK_MUTED, border: i <= step ? 'none' : '1px solid #E8E8E8', transition: 'all 0.3s' }}>
                  {i < step ? <CheckCircle size={15} /> : i + 1}
                </motion.div>
                <span style={{ fontSize: 11, color: i === step ? SAGE_DARK : INK_MUTED, fontWeight: i === step ? 600 : 500 }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < step ? SAGE : '#E8E8E8', margin: '0 12px', marginBottom: 20, transition: 'background 0.3s' }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ overflow: 'hidden', minHeight: 320 }}>
          <AnimatePresence custom={dir} mode="wait">
            {step === 0 && (
              <motion.div key="s0" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }}>
                <h2 style={{ fontSize: 24, fontWeight: 600, color: INK, marginBottom: 6 }}>Create Your Organisation</h2>
                <p style={{ color: INK_MUTED, fontSize: 14, marginBottom: 24 }}>Tell us about your educational institution.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Organisation Name *</label>
                    <div style={{ position: 'relative' }}>
                      <Building2 size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                      <input className="input-dark" style={{ paddingLeft: 38 }} placeholder="e.g. Aditya Educational Institutions" value={org.name} onChange={e => setOrg(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    {errors.name && <span style={{ fontSize: 12, color: '#9B2C2C', marginTop: 4, display: 'block' }}>{errors.name}</span>}
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Institution Type</label>
                    <select className="input-dark" value={org.type} onChange={e => setOrg(p => ({ ...p, type: e.target.value }))}>
                      {['Engineering', 'Management', 'Medical', 'Arts & Science', 'Law', 'Pharmacy', 'Architecture', 'University'].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>City / Location *</label>
                    <div style={{ position: 'relative' }}>
                      <MapPin size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                      <input className="input-dark" style={{ paddingLeft: 38 }} placeholder="e.g. Bangalore, Karnataka" value={org.location} onChange={e => setOrg(p => ({ ...p, location: e.target.value }))} />
                    </div>
                    {errors.location && <span style={{ fontSize: 12, color: '#9B2C2C', marginTop: 4, display: 'block' }}>{errors.location}</span>}
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Website</label>
                    <div style={{ position: 'relative' }}>
                      <Globe size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                      <input className="input-dark" style={{ paddingLeft: 38 }} placeholder="https://www.yourcollege.edu.in" value={org.website} onChange={e => setOrg(p => ({ ...p, website: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Description</label>
                    <textarea className="input-dark" rows={3} placeholder="Brief description of your institution..." style={{ resize: 'vertical', fontFamily: 'inherit' }} value={org.description} onChange={e => setOrg(p => ({ ...p, description: e.target.value }))} />
                  </div>
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="s1" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }}>
                <h2 style={{ fontSize: 24, fontWeight: 600, color: INK, marginBottom: 6 }}>Administrator Account</h2>
                <p style={{ color: INK_MUTED, fontSize: 14, marginBottom: 24 }}>Primary admin for <strong style={{ color: SAGE_DARK }}>{org.name}</strong></p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: 'Full Name *', field: 'name', key: 'aname', icon: User, placeholder: 'Dr. Rajesh Kumar', type: 'text', state: admin.name, onChange: v => setAdmin(p => ({ ...p, name: v })) },
                    { label: 'Email Address *', field: 'email', key: 'email', icon: Mail, placeholder: 'admin@yourcollege.edu.in', type: 'email', state: admin.email, onChange: v => setAdmin(p => ({ ...p, email: v })) },
                    { label: 'Phone Number', field: 'phone', key: null, icon: Phone, placeholder: '+91 98765 43210', type: 'tel', state: admin.phone, onChange: v => setAdmin(p => ({ ...p, phone: v })) },
                  ].map(({ label, key, icon: Icon, placeholder, type, state, onChange }) => (
                    <div key={label}>
                      <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>{label}</label>
                      <div style={{ position: 'relative' }}>
                        <Icon size={15} color={INK_MUTED} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                        <input className="input-dark" style={{ paddingLeft: 38 }} type={type} placeholder={placeholder} value={state} onChange={e => onChange(e.target.value)} />
                      </div>
                      {key && errors[key] && <span style={{ fontSize: 12, color: '#9B2C2C', marginTop: 4, display: 'block' }}>{errors[key]}</span>}
                    </div>
                  ))}
                  <div>
                    <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Password *</label>
                    <input className="input-dark" type="password" placeholder="Minimum 6 characters" value={admin.password} onChange={e => setAdmin(p => ({ ...p, password: e.target.value }))} />
                    {errors.password && <span style={{ fontSize: 12, color: '#9B2C2C', marginTop: 4, display: 'block' }}>{errors.password}</span>}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} style={{ textAlign: 'center', padding: '20px 0' }}>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.1 }}>
                  <div style={{ width: 76, height: 76, background: '#F1F5EE', border: `2px solid ${SAGE}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                    <CheckCircle size={34} color={SAGE_DARK} />
                  </div>
                </motion.div>
                <h2 style={{ fontSize: 24, fontWeight: 600, color: INK, marginBottom: 8 }}>Ready to Launch!</h2>
                <p style={{ color: INK_MUTED, fontSize: 14, marginBottom: 28 }}>Confirm your details to create the organisation.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                  {[['Organisation', org.name], ['Type', org.type], ['Location', org.location], ['Administrator', admin.name], ['Email', admin.email]].map(([k, v], i) => v && (
                    <motion.div key={k}
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#F1F5EE', borderRadius: 10, border: '1px solid #E0E9DA' }}>
                      <span style={{ fontSize: 13, color: INK_MUTED, fontWeight: 500 }}>{k}</span>
                      <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{v}</span>
                    </motion.div>
                  ))}
                </div>
                {apiError && (
                  <div style={{ marginTop: 16, padding: '10px 14px', background: '#FBEDED', border: '1px solid #F2C8C8', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{apiError}</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          {step > 0
            ? <button className="btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => go(-1)}><ArrowLeft size={15} /> Back</button>
            : <button className="btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/')}>Cancel</button>
          }
          {step < 2
            ? <motion.button whileTap={{ scale: 0.97 }} className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => go(1)}>Continue <ArrowRight size={15} /></motion.button>
            : <motion.button className="btn-primary" style={{ flex: 1, opacity: loading ? 0.7 : 1 }} whileTap={{ scale: 0.97 }} onClick={submit} disabled={loading}>
                {loading ? 'Creating...' : 'Create Organisation'}
              </motion.button>
          }
        </div>
      </motion.div>

      <p style={{ marginTop: 24, fontSize: 13, color: INK_MUTED }}>
        Already have an account?{' '}
        <span style={{ color: SAGE_DARK, cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate('/login')}>Sign in</span>
      </p>
    </div>
  )
}
