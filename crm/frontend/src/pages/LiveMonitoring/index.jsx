import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, Phone, Clock, User, PhoneCall, AlertCircle } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { SAGE, SAGE_DARK, AMBER, INK, INK_MUTED, INK_BODY } from '../../theme'

const MOCK_CALLS = [
  { id: '1', phone: '+91 98765 43210', student: 'Rahul S.', duration: 125, status: 'in-progress', sentiment: 'positive' },
  { id: '2', phone: '+91 91234 56789', student: 'Priya M.', duration: 45, status: 'in-progress', sentiment: 'neutral' },
  { id: '3', phone: '+91 99887 76655', student: 'Amit K.', duration: 210, status: 'wrapping-up', sentiment: 'positive' },
  { id: '4', phone: '+91 98888 77777', student: 'Neha J.', duration: 15, status: 'ringing', sentiment: 'neutral' },
]

export default function LiveMonitoring() {
  const [activeCalls, setActiveCalls] = useState(MOCK_CALLS)

  useEffect(() => {
    // Simulate live updates
    const interval = setInterval(() => {
      setActiveCalls(calls => calls.map(c => {
        if (c.status === 'ringing' && Math.random() > 0.5) return { ...c, status: 'in-progress' }
        if (c.status !== 'ringing') return { ...c, duration: c.duration + 1 }
        return c
      }))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Activity color={SAGE_DARK} size={28} />
              <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>Live Monitoring</h1>
            </div>
            <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 6 }}>Real-time active campaigns and call streams (Phase 2)</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F1F5EE', padding: '8px 16px', borderRadius: 20 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: SAGE_DARK, animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: SAGE_DARK }}>Live Connection Active</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {activeCalls.map(call => (
            <motion.div key={call.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="glass-card" style={{ padding: 24, borderRadius: 16, borderLeft: `4px solid ${call.status === 'in-progress' ? SAGE : AMBER}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: INK, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <User size={16} color={INK_MUTED} /> {call.student}
                  </div>
                  <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={12} /> {call.phone}
                  </div>
                </div>
                <span className={`chip-${call.status === 'in-progress' ? 'high' : 'medium'}`} style={{ textTransform: 'capitalize' }}>
                  {call.status.replace('-', ' ')}
                </span>
              </div>
              
              <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
                <div style={{ flex: 1, background: '#FBFBFA', padding: 12, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={16} color={SAGE_DARK} />
                  <div>
                    <div style={{ fontSize: 11, color: INK_MUTED }}>Duration</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{Math.floor(call.duration/60)}:{(call.duration%60).toString().padStart(2, '0')}</div>
                  </div>
                </div>
                <div style={{ flex: 1, background: '#FBFBFA', padding: 12, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={16} color={call.sentiment === 'positive' ? SAGE_DARK : INK_MUTED} />
                  <div>
                    <div style={{ fontSize: 11, color: INK_MUTED }}>Sentiment</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: INK, textTransform: 'capitalize' }}>{call.sentiment}</div>
                  </div>
                </div>
              </div>
              
              <button className="btn-secondary" style={{ width: '100%', marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <PhoneCall size={14} /> Listen In
              </button>
            </motion.div>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(79, 102, 74, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(79, 102, 74, 0); }
          100% { box-shadow: 0 0 0 0 rgba(79, 102, 74, 0); }
        }
      `}</style>
    </DashboardLayout>
  )
}
