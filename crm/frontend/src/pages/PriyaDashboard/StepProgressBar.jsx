// StepProgressBar — 12-step horizontal progress indicator.
// Completed steps turn green with a checkmark; the current step pulses blue;
// pending steps are gray.
import { Check } from 'lucide-react'

const STEPS = [
  'Greeting', 'Name', '10th Marks', 'Inter Marks', 'Course',
  'Fee', 'Exam', 'Scholarship', 'Location', 'Transport', 'Queries', 'End',
]

export default function StepProgressBar({ stepIndex = 0, status }) {
  const effectiveIndex = status === 'completed' ? STEPS.length : stepIndex

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
        {STEPS.map((label, i) => {
          const isDone    = i < effectiveIndex
          const isCurrent = i === effectiveIndex && status !== 'completed'
          const isPending = !isDone && !isCurrent

          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {/* Connector line */}
              {i > 0 && (
                <div style={{
                  width: 16,
                  height: 2,
                  background: isDone ? '#7D9B76' : '#E8E8E8',
                  flexShrink: 0,
                }} />
              )}

              {/* Step pill */}
              <div
                title={label}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:             4,
                  padding:        '4px 10px',
                  borderRadius:   999,
                  fontSize:        11,
                  fontWeight:      600,
                  whiteSpace:     'nowrap',
                  cursor:         'default',
                  transition:     'all 0.3s ease',
                  // State colours
                  background: isDone    ? '#E0E9DA'
                            : isCurrent ? '#EBF0FF'
                            : '#F4F4F2',
                  color:      isDone    ? '#4F664A'
                            : isCurrent ? '#2451B7'
                            : '#A0A0A0',
                  border: `1.5px solid ${
                    isDone    ? '#C7D5BD'
                  : isCurrent ? '#B3C6FF'
                  : '#E8E8E8'
                  }`,
                  animation: isCurrent ? 'stepPulse 2s ease infinite' : 'none',
                  boxShadow: isCurrent ? '0 0 0 3px rgba(36,81,183,0.12)' : 'none',
                }}>
                {isDone && <Check size={10} strokeWidth={3} />}
                {label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress fraction */}
      <div style={{ marginTop: 8, fontSize: 12, color: '#7A7A7A' }}>
        Step <strong style={{ color: '#2C2C2C' }}>{Math.min(effectiveIndex + 1, STEPS.length)}</strong> of {STEPS.length}
        {status === 'completed' && <span style={{ color: '#4F664A', marginLeft: 8, fontWeight: 600 }}>✓ Complete</span>}
      </div>

      <style>{`
        @keyframes stepPulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(36,81,183,0.12); }
          50%       { box-shadow: 0 0 0 6px rgba(36,81,183,0.06); }
        }
      `}</style>
    </div>
  )
}
