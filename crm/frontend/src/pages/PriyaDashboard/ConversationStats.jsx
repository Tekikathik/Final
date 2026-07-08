// ConversationStats — right-side panel showing collected data, language,
// call duration, and current step.
import { User, BookOpen, MapPin, GraduationCap, Globe } from 'lucide-react'

const LANG_LABELS = {
  'en-IN': { label: 'EN', full: 'English',  color: '#2451B7', bg: '#EBF0FF' },
  'te-IN': { label: 'TE', full: 'Telugu',   color: '#7D1FA0', bg: '#F5EBFF' },
  'hi-IN': { label: 'HI', full: 'Hindi',    color: '#B45309', bg: '#FFF7EB' },
}

function formatDuration(secs) {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function InfoCard({ icon: Icon, label, value, accent = '#7D9B76', style }) {
  return (
    <div style={{
      background:    '#FAFAFA',
      border:        '1px solid #E8E8E8',
      borderRadius:  10,
      padding:       '10px 12px',
      display:       'flex',
      alignItems:    'center',
      gap:           10,
      minWidth:      0,
      ...style,
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${accent}18`, border: `1px solid ${accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={15} color={accent} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#A0A0A0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: value ? '#2C2C2C' : '#C7C7C7', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value || '—'}
        </div>
      </div>
    </div>
  )
}

export default function ConversationStats({ collected = {}, detectedLanguage, duration = 0, step, status }) {
  const lang = LANG_LABELS[detectedLanguage]
  const isActive = status === 'calling' || status === 'in-progress'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Duration + Language row */}
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Duration */}
        <div style={{
          flex:          1,
          background:    '#FFFFFF',
          border:        '1px solid #E8E8E8',
          borderRadius:  10,
          padding:       '10px 14px',
          display:       'flex',
          alignItems:    'center',
          gap:           10,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? '#4F664A' : '#C7C7C7', animation: isActive ? 'liveDot 1.5s ease infinite' : 'none', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 10, color: '#A0A0A0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Duration</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2C2C2C', fontFamily: 'monospace', letterSpacing: 1 }}>{formatDuration(duration)}</div>
          </div>
        </div>

        {/* Detected language */}
        <div style={{
          background:    lang ? lang.bg : '#F4F4F2',
          border:        `1px solid ${lang ? lang.color + '33' : '#E8E8E8'}`,
          borderRadius:  10,
          padding:       '10px 14px',
          display:       'flex',
          alignItems:    'center',
          gap:            6,
          minWidth:       90,
          justifyContent: 'center',
        }}>
          <Globe size={14} color={lang ? lang.color : '#A0A0A0'} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#A0A0A0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Language</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: lang ? lang.color : '#C7C7C7' }}>
              {lang ? lang.label : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Current step */}
      {step && step !== 'greeting' && (
        <div style={{ background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: '#4F664A', fontWeight: 600 }}>
          Current step: <span style={{ textTransform: 'capitalize', color: '#2C2C2C' }}>{step?.replace(/_/g, ' ')}</span>
        </div>
      )}

      {/* Collected info cards — 2-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <InfoCard icon={User}         label="Student Name" value={collected.name}        accent="#7D9B76" />
        <InfoCard icon={GraduationCap} label="10th %"      value={collected.marks_10 ? `${collected.marks_10}%` : null}    accent="#C8923A" />
        <InfoCard icon={GraduationCap} label="Inter %"     value={collected.marks_inter ? `${collected.marks_inter}%` : null} accent="#C8923A" />
        <InfoCard icon={BookOpen}     label="Course"       value={collected.interest}    accent="#2451B7" />
        <InfoCard icon={MapPin}       label="Location"     value={collected.location}    accent="#7D9B76" style={{ gridColumn: '1 / -1' }} />
      </div>

      <style>{`
        @keyframes liveDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.4); opacity: 0.6; }
        }
      `}</style>
    </div>
  )
}
