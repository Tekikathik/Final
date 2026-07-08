// TriggerCall — left panel of the Priya Admin Dashboard.
// Lets the admin choose voice settings and fire an outbound call.
import { useState } from 'react'
import { Phone, PhoneCall, Loader } from 'lucide-react'

const STATUS_STYLE = {
  idle:        { bg: '#F4F4F2', color: '#7A7A7A', label: 'Idle' },
  calling:     { bg: '#EDF4EC', color: '#4F664A', label: 'Calling…' },
  'in-progress':{ bg: '#E8F0FF', color: '#2451B7', label: 'In Progress' },
  completed:   { bg: '#E0E9DA', color: '#2D6A2D', label: 'Completed' },
  failed:      { bg: '#FBEDED', color: '#9B2C2C', label: 'Failed' },
}

export default function TriggerCall({ onCallStarted, status = 'idle', sessionId }) {
  const [phone,    setPhone]    = useState('')
  const [name,     setName]     = useState('')
  const [language,   setLanguage]   = useState('Auto detect')
  const [style,      setStyle]      = useState('Modern Colloquial')
  const [audience,   setAudience]   = useState('International')
  const [gender,     setGender]     = useState('Female')
  const [smartMode,  setSmartMode]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')

  const badge = STATUS_STYLE[status] || STATUS_STYLE.idle
  const busy  = status === 'calling' || status === 'in-progress'

  async function handleTrigger() {
    const cleaned = phone.trim().replace(/\s+/g, '')
    if (!cleaned) { setError('Phone number is required'); return }

    // Always send E.164 format: strip any leading 0/+91, then add +91
    const digits = cleaned.replace(/^\+?91/, '').replace(/^0/, '')
    const fullPhone = `+91${digits}`

    setError('')
    setLoading(true)
    try {
      await onCallStarted({ phone: fullPhone, name, language, style, audience, gender, smart_mode: smartMode })
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to start call')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, background: '#F1F5EE', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PhoneCall size={18} color="#4F664A" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#2C2C2C' }}>Trigger Call</div>
            <div style={{ fontSize: 12, color: '#7A7A7A' }}>Start a Priya session</div>
          </div>
        </div>
        {/* Status badge */}
        <span style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.color}33`, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {(status === 'calling' || status === 'in-progress') && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: badge.color, animation: 'priyaPulse 1.5s ease infinite' }} />
          )}
          {badge.label}
        </span>
      </div>

      {/* Phone number */}
      <label style={labelStyle}>Student Phone Number</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <div style={{ background: '#F1F5EE', border: '1px solid #E8E8E8', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#4F664A', fontWeight: 600, whiteSpace: 'nowrap' }}>
          +91
        </div>
        <input
          className="input-dark"
          style={{ flex: 1 }}
          type="tel"
          placeholder="98765 43210"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          disabled={busy || loading}
        />
      </div>

      {/* Student name */}
      <label style={labelStyle}>Student Name <span style={{ color: '#A0A0A0', fontWeight: 400 }}>(optional)</span></label>
      <input
        className="input-dark"
        style={{ marginBottom: 14 }}
        type="text"
        placeholder="e.g. Rahul Sharma"
        value={name}
        onChange={e => setName(e.target.value)}
        disabled={busy || loading}
      />

      {/* Language */}
      <label style={labelStyle}>Language Preference</label>
      <select className="input-dark" style={{ marginBottom: 14 }} value={language} onChange={e => setLanguage(e.target.value)} disabled={busy || loading}>
        <option>Auto detect</option>
        <option>English</option>
        <option>Telugu</option>
        <option>Hindi</option>
      </select>

      {/* Voice Style */}
      <label style={labelStyle}>Voice Style</label>
      <select className="input-dark" style={{ marginBottom: 14 }} value={style} onChange={e => setStyle(e.target.value)} disabled={busy || loading}>
        <option>Modern Colloquial</option>
        <option>Formal</option>
        <option>Classic</option>
      </select>

      {/* Audience + Gender — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Audience</label>
          <select className="input-dark" value={audience} onChange={e => setAudience(e.target.value)} disabled={busy || loading}>
            <option>International</option>
            <option>Domestic</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Gender</label>
          <select className="input-dark" value={gender} onChange={e => setGender(e.target.value)} disabled={busy || loading}>
            <option>Female</option>
            <option>Male</option>
          </select>
        </div>
      </div>

      {/* Smart Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: smartMode ? '#F1F5EE' : '#F9F9F9', border: `1px solid ${smartMode ? '#4F664A33' : '#E8E8E8'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, cursor: busy || loading ? 'not-allowed' : 'pointer' }}
        onClick={() => { if (!busy && !loading) setSmartMode(v => !v) }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2C' }}>Smart Mode</div>
          <div style={{ fontSize: 11, color: '#7A7A7A', marginTop: 2 }}>Better prosody · natural pauses · premium voice</div>
        </div>
        <div style={{ width: 40, height: 22, borderRadius: 11, background: smartMode ? '#4F664A' : '#D0D0D0', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: smartMode ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
        </div>
      </div>

      {error && (
        <div style={{ background: '#FBEDED', border: '1px solid #F2C8C8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#9B2C2C', marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* Trigger button */}
      <button
        className="btn-primary"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={handleTrigger}
        disabled={busy || loading}
      >
        {loading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Phone size={16} />}
        {loading ? 'Starting Call…' : 'Trigger Call'}
      </button>

      {/* Session ID display */}
      {sessionId && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: '#F1F5EE', borderRadius: 8, fontSize: 12, color: '#4F664A' }}>
          <span style={{ fontWeight: 600 }}>Session: </span>
          <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{sessionId}</span>
        </div>
      )}

      <style>{`
        @keyframes priyaPulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#5A5A5A',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}
