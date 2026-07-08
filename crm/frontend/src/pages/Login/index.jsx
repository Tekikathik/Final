import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Phone, Mail, Lock, Eye, EyeOff, Shield, Building2, Eye as EyeIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useStore, DEMO_ACCOUNTS } from '../../store/useStore'

const ROLE_META = {
  admin:         { label: 'Org Admin',       color: '#4F664A', bg: '#F1F5EE', border: '#C7D5BD', icon: Shield },
  college_admin: { label: 'College Admin',   color: '#A87A2C', bg: '#FBF5EA', border: '#E8D2A6', icon: Building2 },
  viewer:        { label: 'Viewer',          color: '#5A5A5A', bg: '#F4F4F2', border: '#E8E8E8', icon: EyeIcon },
}

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

export default function Login() {
  const navigate = useNavigate()
  const { login, loading, demoAccounts, fetchDemoAccounts } = useStore()

  useEffect(() => {
    fetchDemoAccounts()
  }, [fetchDemoAccounts])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    if (!email || !password) { setError('Please enter email and password'); return }
    setError('')
    const result = await login({ email, password })
    if (result.ok) {
      const u = result.user
      if (u?.role === 'college_admin' && u.collegeIds?.[0]) {
        navigate(`/dashboard/college/${u.collegeIds[0]}`)
      } else {
        navigate('/dashboard')
      }
    } else {
      setError(result.message || 'Login failed')
    }
  }

  const fillCreds = (acct) => {
    setEmail(acct.email)
    setPassword(acct.password)
    setError('')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', display: 'flex', position: 'relative' }}>
      <div className="orb orb-blue"   style={{ width: 520, height: 520, top: -100, left: -100, opacity: 0.7 }} />
      <div className="orb orb-purple" style={{ width: 420, height: 420, bottom: -50, right: -50, opacity: 0.6 }} />

      {/* Left branding panel */}
      <div className="grid-bg" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 80px', position: 'relative', zIndex: 2 }}>
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 25 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 60, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <div style={{ width: 38, height: 38, background: SAGE, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Phone size={18} color="white" />
            </div>
            <span style={{ fontWeight: 600, fontSize: 20, color: INK, letterSpacing: -0.3 }}>AdmitAI</span>
          </div>

          <h1 style={{ fontSize: 44, fontWeight: 600, color: INK, letterSpacing: -1.5, marginBottom: 16, lineHeight: 1.1 }}>
            Welcome<br /><span className="gradient-text">Back</span>
          </h1>
          <p style={{ color: INK_BODY, fontSize: 15, lineHeight: 1.7, maxWidth: 340 }}>
            Access your admission dashboard and manage AI-powered student outreach campaigns.
          </p>

          <div style={{ marginTop: 36, padding: '14px 16px', background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: SAGE_DARK, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Role-based demo accounts</p>
              <span style={{ fontSize: 10, color: INK_MUTED }}>click to fill</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
              {demoAccounts.map((acct, i) => {
                const meta = ROLE_META[acct.user.role] || ROLE_META.admin
                const Icon = meta.icon
                return (
                  <motion.button
                    key={acct.email}
                    type="button"
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.04 }}
                    whileHover={{ scale: 1.01 }}
                    onClick={() => fillCreds(acct)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', background: '#FFFFFF', border: '1px solid #E0E9DA',
                      borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, background: meta.bg,
                      border: `1px solid ${meta.border}`, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Icon size={14} color={meta.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {acct.user.name}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: meta.color,
                          background: meta.bg, border: `1px solid ${meta.border}`,
                          padding: '1px 6px', borderRadius: 999, letterSpacing: 0.3, textTransform: 'uppercase', flexShrink: 0,
                        }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: INK_MUTED, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {acct.email} · {acct.password}
                      </div>
                      {acct.user.collegeName && (
                        <div style={{ fontSize: 10, color: SAGE_DARK, marginTop: 2, fontWeight: 500 }}>
                          → {acct.user.collegeName}
                        </div>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>
            <p style={{ fontSize: 10, color: INK_MUTED, marginTop: 10, lineHeight: 1.5 }}>
              College admins are sandboxed to their assigned college dashboard.
              Org admin sees everything. Or create a new organisation →
            </p>
          </div>
        </motion.div>
      </div>

      {/* Right login form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, position: 'relative', zIndex: 2 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 25 }}
          className="glass-card" style={{ width: '100%', maxWidth: 460, borderRadius: 24, padding: 44 }}>

          <h2 style={{ fontSize: 24, fontWeight: 600, color: INK, marginBottom: 6 }}>Sign In</h2>
          <p style={{ color: INK_MUTED, fontSize: 13, marginBottom: 28 }}>Enter your credentials to continue</p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} color={INK_MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
              <input className="input-dark" style={{ paddingLeft: 40 }} type="email" placeholder="admin@example.com"
                value={email} onChange={e => { setEmail(e.target.value); setError('') }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 13, color: INK_BODY, marginBottom: 6, display: 'block', fontWeight: 500 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} color={INK_MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
              <input className="input-dark" style={{ paddingLeft: 40, paddingRight: 40 }} type={showPass ? 'text' : 'password'} placeholder="••••••••"
                value={password} onChange={e => { setPassword(e.target.value); setError('') }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              <button onClick={() => setShowPass(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: INK_MUTED }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ marginBottom: 16, padding: '10px 14px', background: '#FBEDED', border: '1px solid #F2C8C8', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>
              {error}
            </motion.div>
          )}

          <motion.button className="btn-primary" style={{ width: '100%', padding: 14, marginBottom: 12, opacity: loading ? 0.7 : 1 }}
            whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }} onClick={handleLogin} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In to Dashboard'}
          </motion.button>

          <button className="btn-secondary" style={{ width: '100%', padding: 13, fontSize: 13 }} onClick={() => {
            const list = demoAccounts.length > 0 ? demoAccounts : [{ email: 'admin@aditya.edu.in', password: 'demo-admin-pass' }]
            fillCreds(list[0])
          }}>
            Use Org Admin Demo Credentials
          </button>

          <p style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: INK_MUTED }}>
            New here?{' '}
            <span style={{ color: SAGE_DARK, cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate('/create-org')}>Create Organisation</span>
          </p>
        </motion.div>
      </div>
    </div>
  )
}
