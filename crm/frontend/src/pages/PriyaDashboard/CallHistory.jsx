// CallHistory — bottom panel showing last 20 completed calls.
// Click a row to open the full call report (summary, transcript, collected data).
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Phone } from 'lucide-react'

const STEPS_TOTAL = 12

const STATUS_CHIP = {
  completed:    { bg: '#E0E9DA', color: '#2D6A2D', border: '#C7D5BD', label: 'Completed' },
  failed:       { bg: '#FBEDED', color: '#9B2C2C', border: '#F2C8C8', label: 'Failed' },
  'in-progress':{ bg: '#EBF0FF', color: '#2451B7', border: '#B3C6FF', label: 'In Progress' },
  calling:      { bg: '#FBF5EA', color: '#855F22', border: '#ECD3A0', label: 'Calling' },
  'no-answer':  { bg: '#FBF5EA', color: '#855F22', border: '#ECD3A0', label: 'No Answer' },
}

const LANG_SHORT = { 'en-IN': 'EN', 'te-IN': 'TE', 'hi-IN': 'HI' }

// AI-analyzed call disposition → chip style. Hover a row to read the AI summary.
const DISPO_CHIP = {
  interested:     { background: '#E0E9DA', color: '#2D6A2D', border: '1px solid #C7D5BD' },
  enrolled:       { background: '#E0E9DA', color: '#2D6A2D', border: '1px solid #C7D5BD' },
  callback:       { background: '#FBF5EA', color: '#855F22', border: '1px solid #ECD3A0' },
  not_interested: { background: '#FBEDED', color: '#9B2C2C', border: '1px solid #F2C8C8' },
  wrong_number:   { background: '#F4F4F2', color: '#7A7A7A', border: '1px solid #E8E8E8' },
  no_answer:      { background: '#F4F4F2', color: '#7A7A7A', border: '1px solid #E8E8E8' },
}

function formatDuration(secs) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function StatusChip({ status }) {
  const s = STATUS_CHIP[status] || { bg: '#F4F4F2', color: '#7A7A7A', border: '#E8E8E8', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

export default function CallHistory({ calls = [], onRefresh, loading }) {
  const navigate = useNavigate()
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #E8E8E8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Phone size={16} color="#4F664A" />
          <span style={{ fontWeight: 700, fontSize: 14, color: '#2C2C2C' }}>Call History</span>
          <span style={{ background: '#F1F5EE', color: '#4F664A', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
            {calls.length}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{ background: 'none', border: '1px solid #E8E8E8', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5A5A5A', transition: 'background 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.background = '#F1F5EE'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Table */}
      {calls.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#A0A0A0', fontSize: 13 }}>
          <Phone size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div>No calls yet. Trigger a call to get started.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E8E8E8' }}>
                {['Phone', 'Name', 'Date / Time', 'Duration', 'Steps', 'Lang', 'Status', 'Disposition'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#7A7A7A', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map((call, i) => (
                <tr
                  key={call.session_id || i}
                  title={call.summary || 'Open call report'}
                  style={{ borderBottom: '1px solid #F4F4F2', transition: 'background 0.15s', cursor: call.session_id ? 'pointer' : 'default' }}
                  onClick={() => call.session_id && navigate(`/dashboard/report/${call.session_id}`)}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAFAFA'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={td}>{call.phone || '—'}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#2C2C2C' }}>{call.name || 'Unknown'}</td>
                  <td style={td}>{formatDate(call.started_at)}</td>
                  <td style={td}>{formatDuration(call.duration)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 60, height: 5, background: '#E8E8E8', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#7D9B76', width: `${Math.round((call.steps_completed / STEPS_TOTAL) * 100)}%`, borderRadius: 3 }} />
                      </div>
                      <span style={{ color: '#7A7A7A', fontSize: 11 }}>{call.steps_completed}/{STEPS_TOTAL}</span>
                    </div>
                  </td>
                  <td style={td}>
                    {call.detected_language ? (
                      <span style={{ background: '#F1F5EE', color: '#4F664A', border: '1px solid #C7D5BD', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>
                        {LANG_SHORT[call.detected_language] || call.detected_language}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={td}><StatusChip status={call.status} /></td>
                  <td style={td}>
                    {call.disposition ? (
                      <span style={{ ...( DISPO_CHIP[call.disposition] || DISPO_CHIP.no_answer ), borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                        {call.disposition.replace(/_/g, ' ')}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const td = {
  padding:    '12px 16px',
  color:      '#5A5A5A',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
}
