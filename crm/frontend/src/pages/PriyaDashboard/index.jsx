// ---------------------------------------------------------------------------
// Priya Admin Dashboard  — /dashboard/live
//
// Layout:
//   ┌──────────────┬──────────────────────────────────────────────────────┐
//   │  TriggerCall │  Step progress + ConversationStats + TranscriptViewer│
//   └──────────────┴──────────────────────────────────────────────────────┘
//   ┌────────────────────────────────────────────────────────────────────┐
//   │                      CallHistory table                              │
//   └────────────────────────────────────────────────────────────────────┘
//
// Real-time: polls GET /api/priya/sessions/:id every 2 s while active.
// ---------------------------------------------------------------------------
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'

import DashboardLayout from '../../components/DashboardLayout'
import TriggerCall       from './TriggerCall'
import StepProgressBar   from './StepProgressBar'
import ConversationStats from './ConversationStats'
import TranscriptViewer  from './TranscriptViewer'
import CallHistory        from './CallHistory'
import { triggerCall, getSession, getCalls } from '../../lib/priyaApi'

const POLL_INTERVAL = 2000   // ms — matches spec

export default function PriyaDashboard() {
  // ── Session tracking ──────────────────────────────────────────────────
  const [sessionId,  setSessionId]  = useState(null)
  const [session,    setSession]    = useState(null)
  const [callStatus, setCallStatus] = useState('idle')

  // ── Call history ──────────────────────────────────────────────────────
  const [calls,         setCalls]        = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const pollRef  = useRef(null)  // holds the setInterval id
  const activeRef = useRef(false) // track if polling should continue
  const endPollsRef = useRef(0)   // polls done AFTER the call ended (waiting for the AI summary)
  const [summaryWaiting, setSummaryWaiting] = useState(false)

  // ── Fetch call history ────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await getCalls()
      setCalls(Array.isArray(data) ? data : [])
    } catch (err) {
      console.warn('Failed to fetch call history:', err.message)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // ── Polling ───────────────────────────────────────────────────────────
  const startPolling = useCallback((sid) => {
    if (pollRef.current) clearInterval(pollRef.current)
    activeRef.current = true
    endPollsRef.current = 0
    setSummaryWaiting(false)

    pollRef.current = setInterval(async () => {
      if (!activeRef.current) return
      try {
        const data = await getSession(sid)
        setSession(data)
        setCallStatus(data.status)

        // The AI summary is generated a few seconds AFTER the call ends — keep
        // polling briefly until it arrives (give up after ~30 s), THEN stop.
        if (data.status === 'completed' || data.status === 'failed') {
          endPollsRef.current += 1
          const gotSummary = Boolean(data.summary)
          const gaveUp     = endPollsRef.current > 15
          setSummaryWaiting(!gotSummary && !gaveUp)
          if (gotSummary || gaveUp) {
            activeRef.current = false
            clearInterval(pollRef.current)
            fetchHistory()  // refresh history once call is done
          }
        }
      } catch (err) {
        console.warn('Session poll error:', err.message)
      }
    }, POLL_INTERVAL)
  }, [fetchHistory])

  // Clean up on unmount
  useEffect(() => () => {
    activeRef.current = false
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  // ── Trigger a call ────────────────────────────────────────────────────
  async function handleCallStarted(params) {
    // Reset previous session UI
    setSession(null)
    setCallStatus('calling')

    const { session_id } = await triggerCall(params)
    setSessionId(session_id)
    setCallStatus('calling')
    startPolling(session_id)
  }

  // Derive display values (fall back to safe defaults while loading)
  const transcript      = session?.transcript      || []
  const stepIndex       = session?.step_index      ?? 0
  const step            = session?.step            || 'greeting'
  const collected       = session?.collected       || {}
  const detectedLang    = session?.detected_language
  const duration        = session?.duration        ?? 0
  const isWaiting       = callStatus === 'calling' || callStatus === 'in-progress'
  const callEnded       = callStatus === 'completed' || callStatus === 'failed'
  const summary         = session?.summary
  const disposition     = session?.disposition
  const sentiment       = session?.sentiment

  const DISPO_CHIP = {
    interested:     { bg: '#E0E9DA', color: '#2D6A2D', border: '#C7D5BD' },
    enrolled:       { bg: '#E0E9DA', color: '#2D6A2D', border: '#C7D5BD' },
    callback:       { bg: '#FBF5EA', color: '#855F22', border: '#ECD3A0' },
    not_interested: { bg: '#FBEDED', color: '#9B2C2C', border: '#F2C8C8' },
    wrong_number:   { bg: '#F4F4F2', color: '#7A7A7A', border: '#E8E8E8' },
    no_answer:      { bg: '#F4F4F2', color: '#7A7A7A', border: '#E8E8E8' },
  }
  const SENTI_CHIP = {
    positive: { bg: '#E0E9DA', color: '#2D6A2D', border: '#C7D5BD' },
    neutral:  { bg: '#F4F4F2', color: '#7A7A7A', border: '#E8E8E8' },
    negative: { bg: '#FBEDED', color: '#9B2C2C', border: '#F2C8C8' },
  }
  const chip = (label, s) => (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {label.replace(/_/g, ' ')}
    </span>
  )

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* ── Page header ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, background: '#F1F5EE', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={20} color="#4F664A" />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2C2C2C', letterSpacing: -0.4 }}>Priya — Admission AI</h1>
                <p style={{ color: '#7A7A7A', fontSize: 13, marginTop: 2 }}>Outbound calling dashboard · real-time conversation monitoring</p>
              </div>
            </div>
          </div>
          {/* Call status — live during the call, and a clear outcome after it ends */}
          {callStatus !== 'idle' && (() => {
            const map = {
              calling:       { bg: '#FBF5EA', border: '#ECD3A0', color: '#855F22', label: 'Calling…',          live: true  },
              'in-progress': { bg: '#F1F5EE', border: '#C7D5BD', color: '#4F664A', label: 'Live Call Active',  live: true  },
              completed:     { bg: '#E0E9DA', border: '#C7D5BD', color: '#2D6A2D', label: '✓ Call Completed',   live: false },
              failed:        { bg: '#FBEDED', border: '#F2C8C8', color: '#9B2C2C', label: 'Call Ended',         live: false },
            }
            const s = map[callStatus] || map['in-progress']
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: s.bg, padding: '8px 16px', borderRadius: 20, border: `1px solid ${s.border}` }}>
                {s.live && <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, animation: 'priyaLiveDot 1.5s ease infinite', display: 'inline-block' }} />}
                <span style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.label}</span>
                {!s.live && duration > 0 && (
                  <span style={{ fontSize: 12, color: s.color, opacity: 0.8 }}>· {Math.floor(duration/60)}:{String(duration%60).padStart(2,'0')}</span>
                )}
              </div>
            )
          })()}
        </div>

        {/* ── Two-column main area ─────────────────────────────────────── */}
        <motion.div
          className="priya-main-grid"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ display: 'grid', gap: 20, marginBottom: 20, alignItems: 'start' }}
        >
          {/* LEFT — trigger call panel */}
          <TriggerCall
            onCallStarted={handleCallStarted}
            status={callStatus}
            sessionId={sessionId}
          />

          {/* RIGHT — live session info */}
          <div style={{ minWidth: 0, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
            {/* Step progress */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#7A7A7A', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Conversation Progress
              </div>
              <StepProgressBar stepIndex={stepIndex} status={callStatus} />
            </div>

            <div style={{ height: 1, background: '#E8E8E8', marginBottom: 20 }} />

            {/* ── Post-call AI summary — appears once the call ends ────────── */}
            {callEnded && (
              <div style={{ marginBottom: 20, background: '#F8FAF6', border: '1px solid #C7D5BD', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: summary || summaryWaiting ? 8 : 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#4F664A', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Call Summary
                  </span>
                  {disposition && chip(disposition, DISPO_CHIP[disposition] || DISPO_CHIP.no_answer)}
                  {sentiment && chip(sentiment, SENTI_CHIP[sentiment] || SENTI_CHIP.neutral)}
                </div>
                {summary ? (
                  <p style={{ fontSize: 13.5, color: '#2C2C2C', lineHeight: 1.6, margin: 0 }}>{summary}</p>
                ) : summaryWaiting ? (
                  <p style={{ fontSize: 13, color: '#7A7A7A', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7D9B76', animation: 'priyaLiveDot 1.5s ease infinite', display: 'inline-block' }} />
                    Generating AI summary…
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: '#A0A0A0', margin: 0 }}>Summary unavailable for this call.</p>
                )}
              </div>
            )}

            {/* Stats + transcript — side by side on large screens */}
            <div className="priya-session-grid" style={{ display: 'grid', gap: 20 }}>
              <ConversationStats
                collected={collected}
                detectedLanguage={detectedLang}
                duration={duration}
                step={step}
                status={callStatus}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#7A7A7A', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Live Transcript
                </div>
                <TranscriptViewer
                  transcript={transcript}
                  isWaiting={isWaiting && transcript.length > 0 && transcript[transcript.length - 1]?.role === 'Student'}
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Bottom — call history ────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <CallHistory
            calls={calls}
            onRefresh={fetchHistory}
            loading={historyLoading}
          />
        </motion.div>
      </div>

      <style>{`
        @keyframes priyaLiveDot {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%       { transform: scale(1.4); opacity: 0.6; }
        }
        /* minmax(0, 1fr) lets the flexible column shrink below its content's
           intrinsic width instead of blowing past the container (overflow). */
        .priya-main-grid    { grid-template-columns: 320px minmax(0, 1fr); }
        .priya-session-grid { grid-template-columns: 240px minmax(0, 1fr); }
        @media (max-width: 1100px) {
          .priya-session-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 880px) {
          .priya-main-grid { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>
    </DashboardLayout>
  )
}
