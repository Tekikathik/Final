// TranscriptViewer — auto-scrolling chat window for the live conversation.
// Priya's messages appear on the left (sage bubble); student on the right (gray).
import { useEffect, useRef } from 'react'
import { Mic, Bot } from 'lucide-react'

function formatTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return '' }
}

export default function TranscriptViewer({ transcript = [], isWaiting = false }) {
  const bottomRef = useRef(null)

  // Scroll to bottom on every new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript.length, isWaiting])

  return (
    <div style={{
      background:   '#FAFAFA',
      border:       '1px solid #E8E8E8',
      borderRadius: 12,
      padding:      16,
      height:       340,
      overflowY:    'auto',
      display:      'flex',
      flexDirection:'column',
      gap:          10,
    }}>
      {transcript.length === 0 && !isWaiting && (
        <div style={{ margin: 'auto', textAlign: 'center', color: '#A0A0A0', fontSize: 13 }}>
          <Bot size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>Transcript will appear here once the call starts.</div>
        </div>
      )}

      {transcript.map((msg, i) => {
        const isPriya = msg.role === 'Priya'
        return (
          <div key={i} style={{
            display:       'flex',
            flexDirection: isPriya ? 'row' : 'row-reverse',
            alignItems:    'flex-end',
            gap:           8,
          }}>
            {/* Avatar */}
            <div style={{
              width:          30,
              height:         30,
              borderRadius:   '50%',
              background:     isPriya ? '#7D9B76' : '#E8E8E8',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              flexShrink:     0,
              fontSize:        11,
              fontWeight:      700,
              color:           isPriya ? '#fff' : '#5A5A5A',
            }}>
              {isPriya ? 'P' : <Mic size={13} />}
            </div>

            {/* Bubble */}
            <div style={{
              maxWidth:      '72%',
              background:    isPriya ? '#EDF4EC' : '#FFFFFF',
              border:        `1px solid ${isPriya ? '#C7D5BD' : '#E8E8E8'}`,
              borderRadius:  isPriya ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
              padding:       '8px 12px',
              boxShadow:     '0 1px 4px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: isPriya ? '#4F664A' : '#7A7A7A', marginBottom: 3 }}>
                {msg.role}
              </div>
              <div style={{ fontSize: 13, color: '#2C2C2C', lineHeight: 1.5, overflowWrap: 'break-word', wordBreak: 'break-word' }}>{msg.text}</div>
              <div style={{ fontSize: 10, color: '#A0A0A0', marginTop: 4, textAlign: 'right' }}>
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        )
      })}

      {/* Typing indicator */}
      {isWaiting && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#7D9B76', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>P</div>
          <div style={{ background: '#EDF4EC', border: '1px solid #C7D5BD', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', display: 'flex', gap: 4, alignItems: 'center' }}>
            {[0, 150, 300].map(d => (
              <span key={d} style={{
                width: 6, height: 6, borderRadius: '50%', background: '#7D9B76',
                animation: `typingDot 1.2s ease ${d}ms infinite`,
                display: 'inline-block',
              }} />
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} />

      <style>{`
        @keyframes typingDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  )
}
