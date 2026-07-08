import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, BarChart, Bar
} from 'recharts'
import {
  User, Phone, BookOpen, MapPin, Brain,
  MessageSquare, Lightbulb, Download, Share2,
  CheckCircle, ChevronRight
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'
import { analyzeCall } from '../../lib/crmApi'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'
const TOOLTIP = { background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, color: INK, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }

const MOCK_REPORT = {
  profile: { name: 'Rahul Sharma', phone: '+91 98765 43210', email: 'rahul@gmail.com', examAppeared: 'JEE Mains 2026', courseInterested: 'B.Tech Computer Science', currentCity: 'Chennai', tenthPercent: 92, twelfthPercent: 88, entranceScore: 'JEE: 87.4 percentile' },
  summary: 'Rahul engaged enthusiastically with the AI throughout the 4-minute call. He expressed strong interest in the B.Tech CSE programme, asking detailed questions about the AI/ML specialisation track. His primary concern was the annual fee structure, which the AI addressed by highlighting the merit scholarship he qualifies for (covering 40% of tuition). He also enquired about placement statistics and was impressed by the 95% placement record shared by the AI. He agreed to receive the campus tour brochure and asked for a callback from an admission counsellor.',
  enrollmentProbability: 87,
  topicAnalysis: { fees: 75, scholarship: 85, placement: 70, hostel: 30, courseDetails: 90, admissionProcess: 60 },
  sentimentTimeline: [
    { timestamp: 0, label: 'neutral', score: 0 }, { timestamp: 30, label: 'neutral', score: 0.1 },
    { timestamp: 60, label: 'positive', score: 0.4 }, { timestamp: 90, label: 'positive', score: 0.6 },
    { timestamp: 120, label: 'positive', score: 0.8 }, { timestamp: 150, label: 'neutral', score: 0.2 },
    { timestamp: 180, label: 'positive', score: 0.7 }, { timestamp: 210, label: 'positive', score: 0.9 },
    { timestamp: 240, label: 'positive', score: 0.75 }, { timestamp: 272, label: 'positive', score: 0.85 },
  ],
  followUpRecommendations: ['Schedule campus visit within 48 hours', 'Send scholarship eligibility letter by email', 'Assign senior admission counsellor for callback', 'Share AI/ML specialisation brochure'],
  transcript: [
    { speaker: 'ai', text: "Hello, am I speaking with Rahul Sharma?", timestamp: 0 },
    { speaker: 'student', text: "Yes, speaking. Who's this?", timestamp: 4 },
    { speaker: 'ai', text: "Hi Rahul! I'm calling from Aditya University Admissions. You had enquired about our B.Tech programmes. Is this a good time to chat?", timestamp: 6 },
    { speaker: 'student', text: "Yeah sure, go ahead.", timestamp: 14 },
    { speaker: 'ai', text: "Great! I'd love to tell you about our B.Tech Computer Science programme with an AI/ML specialisation. We have some exciting scholarship opportunities for JEE qualifiers like yourself.", timestamp: 17 },
    { speaker: 'student', text: "Oh interesting! What's the fee structure like?", timestamp: 28 },
    { speaker: 'ai', text: "The annual tuition is ₹1.8 lakhs, but based on your JEE percentile of 87.4, you'd qualify for our merit scholarship covering 40% of that — bringing it down to about ₹1.08 lakhs per year.", timestamp: 34 },
    { speaker: 'student', text: "That's actually much better than I expected. What about placements?", timestamp: 50 },
    { speaker: 'ai', text: "We have a 95% placement rate with an average package of ₹7.2 LPA. Top recruiters include Infosys, TCS, and several AI startups. Our CSE batch had 3 students placed at over ₹20 LPA last year.", timestamp: 56 },
    { speaker: 'student', text: "Wow, that's impressive. Can I get the campus tour brochure?", timestamp: 72 },
    { speaker: 'ai', text: "Absolutely! I'll have it sent to your registered email right away. Would you also like our admission counsellor to give you a call for a personalised discussion?", timestamp: 78 },
    { speaker: 'student', text: "Yes please, that would be great!", timestamp: 90 },
  ],
  callId: { status: 'completed', duration: 272, sentiment: 'positive' },
}

function ProbabilityGauge({ value }) {
  const color = value >= 70 ? SAGE_DARK : value >= 40 ? AMBER : '#9B2C2C'
  const gaugeData = [{ name: 'Probability', value, fill: color }]
  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <ResponsiveContainer width="100%" height={210}>
        <RadialBarChart cx="50%" cy="70%" innerRadius="55%" outerRadius="80%" startAngle={180} endAngle={0} data={gaugeData}>
          <RadialBar dataKey="value" cornerRadius={6} max={100} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{ fontSize: 46, fontWeight: 600, color, letterSpacing: -2, lineHeight: 1 }}>{value}%</div>
        <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 4 }}>Enrollment Probability</div>
      </div>
    </div>
  )
}

function TranscriptBubble({ turn, idx }) {
  const isAI = turn.speaker === 'ai'
  return (
    <motion.div initial={{ opacity: 0, x: isAI ? -10 : 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}
      style={{ display: 'flex', flexDirection: isAI ? 'row' : 'row-reverse', gap: 10, marginBottom: 12 }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: isAI ? SAGE : '#F4F4F2', border: isAI ? 'none' : '1px solid #E8E8E8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: isAI ? 'white' : INK_BODY, flexShrink: 0 }}>
        {isAI ? 'AI' : 'S'}
      </div>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ padding: '11px 15px', background: isAI ? '#F1F5EE' : '#FFFFFF', border: `1px solid ${isAI ? '#E0E9DA' : '#E8E8E8'}`, borderRadius: isAI ? '4px 14px 14px 14px' : '14px 4px 14px 14px', fontSize: 13, color: INK, lineHeight: 1.6 }}>
          {turn.text}
        </div>
        <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 4, textAlign: isAI ? 'left' : 'right' }}>
          {Math.floor(turn.timestamp / 60)}:{String(turn.timestamp % 60).padStart(2, '0')}
        </div>
      </div>
    </motion.div>
  )
}

function fmt(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function StudentReport() {
  const { collegeId, callId } = useParams()
  const navigate = useNavigate()
  const { fetchReport } = useStore()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [shareToast, setShareToast] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  // AI auto-analysis: re-run summary + disposition on this call's transcript.
  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      const { call } = await analyzeCall(callId)
      setReport(prev => ({
        ...(prev || MOCK_REPORT),
        summary: call.summary || prev?.summary,
        callId: { ...(prev?.callId || {}), disposition: call.disposition, sentiment: call.sentiment, status: call.status },
      }))
      setShareToast('AI re-analyzed this call ✓')
    } catch (err) {
      setShareToast(err?.response?.data?.message || 'Could not analyze — no transcript or LLM busy')
    } finally {
      setAnalyzing(false)
      setTimeout(() => setShareToast(null), 2800)
    }
  }

  const handleShare = async () => {
    const url = window.location.href
    const title = `${report?.profile?.name || 'Student'} — AdmitAI Report`
    const text = `AdmitAI call report for ${report?.profile?.name || 'student'} (${report?.profile?.courseInterested || ''})`
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        setShareToast('Shared successfully')
      } else {
        await navigator.clipboard?.writeText(url)
        setShareToast('Link copied to clipboard')
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setShareToast('Could not share — link copied instead')
      try { await navigator.clipboard?.writeText(url) } catch {}
    }
    setTimeout(() => setShareToast(null), 2500)
  }

  useEffect(() => {
    setLoading(true)
    fetchReport(callId)
      .then(setReport)
      .catch(() => setReport(MOCK_REPORT))
      .finally(() => setLoading(false))
  }, [callId])

  if (loading) {
    return (
      <DashboardLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div style={{ width: 38, height: 38, border: '3px solid #E0E9DA', borderTopColor: SAGE, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      </DashboardLayout>
    )
  }

  const r = report || MOCK_REPORT
  const prob = r.enrollmentProbability
  const probLabel = prob >= 70 ? 'High' : prob >= 40 ? 'Medium' : 'Low'

  const radarData = [
    { topic: 'Fees',        value: r.topicAnalysis?.fees             || 0 },
    { topic: 'Scholarship', value: r.topicAnalysis?.scholarship      || 0 },
    { topic: 'Placement',   value: r.topicAnalysis?.placement        || 0 },
    { topic: 'Hostel',      value: r.topicAnalysis?.hostel           || 0 },
    { topic: 'Course',      value: r.topicAnalysis?.courseDetails    || 0 },
    { topic: 'Admission',   value: r.topicAnalysis?.admissionProcess || 0 },
  ]

  const sentimentData = (r.sentimentTimeline || []).map(p => ({
    time: fmt(p.timestamp), score: p.score, label: p.label,
  }))

  const topicBarData = Object.entries(r.topicAnalysis || {}).map(([k, v]) => ({
    topic: k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
    value: v,
  })).sort((a, b) => b.value - a.value)

  const topicPalette = [SAGE, AMBER, SAGE_DARK, AMBER_DARK, SAGE_LIGHT, '#9B2C2C']

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13, color: INK_MUTED }}>
          <span style={{ cursor: 'pointer', color: SAGE_DARK, fontWeight: 500 }} onClick={() => navigate('/dashboard')}>Dashboard</span>
          <ChevronRight size={13} />
          <span style={{ cursor: 'pointer', color: SAGE_DARK, fontWeight: 500 }} onClick={() => navigate(collegeId ? `/dashboard/college/${collegeId}` : '/dashboard/live')}>
            {collegeId ? 'College' : 'Live Calls'}
          </span>
          <ChevronRight size={13} />
          <span>Student Report</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 56, height: 56, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={26} color={SAGE_DARK} />
            </div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>{r.profile?.name}</h1>
              <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} />{r.profile?.phone}</span>
                <span style={{ fontSize: 13, color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />{r.profile?.currentCity}</span>
                <span style={{ fontSize: 13, color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}><BookOpen size={12} />{r.profile?.courseInterested}</span>
                <span className={prob >= 70 ? 'chip-high' : 'chip-medium'}>{probLabel} Interest</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="pill-outline" onClick={handleShare}>
              <Share2 size={14} /> Share
            </button>
            <button className="pill-confirm" onClick={() => window.open(`http://localhost:5000/api/reports/export/${callId}`)}>
              <Download size={14} /> Export Report
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 22 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>Enrollment Score</div>
            <div style={{ fontSize: 12, color: INK_MUTED, marginBottom: 8 }}>AI-computed probability</div>
            <ProbabilityGauge value={prob} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {[
                { label: 'Call Duration', value: fmt(r.callId?.duration || 272) },
                { label: 'Sentiment',     value: r.callId?.sentiment || 'positive' },
                { label: 'Disposition',   value: (r.callId?.disposition || '—').replace(/_/g, ' ') },
                { label: 'Status',        value: r.callId?.status    || 'completed' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: INK_MUTED }}>{label}</span>
                  <span style={{ color: INK, fontWeight: 600, textTransform: 'capitalize' }}>{value}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 16 }}>Student Profile</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Full Name',       value: r.profile?.name },
                { label: 'Phone',           value: r.profile?.phone },
                { label: 'Email',           value: r.profile?.email || '—' },
                { label: 'City',            value: r.profile?.currentCity || '—' },
                { label: 'Exam',            value: r.profile?.examAppeared || '—' },
                { label: 'Score',           value: r.profile?.entranceScore || '—' },
                { label: '10th %',          value: r.profile?.tenthPercent  ? `${r.profile.tenthPercent}%`  : '—' },
                { label: '12th %',          value: r.profile?.twelfthPercent ? `${r.profile.twelfthPercent}%` : '—' },
                { label: 'Course Interest', value: r.profile?.courseInterested || '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: '10px 12px', background: '#FBFBFA', border: '1px solid #F4F4F2', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: INK_MUTED, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13, color: INK, fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={16} color={AMBER_DARK} />
                <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>AI Call Summary</span>
              </div>
              <button onClick={handleAnalyze} disabled={analyzing}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
                  padding: '5px 10px', borderRadius: 8, cursor: analyzing ? 'default' : 'pointer',
                  color: AMBER_DARK, background: '#FFF8EE', border: '1px solid #F0E2C8', opacity: analyzing ? 0.6 : 1 }}>
                {analyzing ? 'Analyzing…' : '🤖 Re-analyze'}
              </button>
            </div>
            <p style={{ fontSize: 13, color: INK_BODY, lineHeight: 1.8 }}>{r.summary}</p>

            <div style={{ marginTop: 18, borderTop: '1px solid #F4F4F2', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Lightbulb size={14} color={AMBER} />
                <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Follow-up Actions</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(r.followUpRecommendations || []).map((rec, i) => (
                  <motion.div key={i}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: INK_BODY }}>
                    <CheckCircle size={13} color={SAGE_DARK} style={{ marginTop: 2, flexShrink: 0 }} />
                    {rec}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16, marginBottom: 16 }}>
          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>Topic Engagement Radar</div>
            <div style={{ fontSize: 12, color: INK_MUTED, marginBottom: 12 }}>Topics raised during the call (0-100)</div>
            <ResponsiveContainer width="100%" height={270}>
              <RadarChart data={radarData} outerRadius={95}>
                <PolarGrid stroke="#E8E8E8" />
                <PolarAngleAxis dataKey="topic" tick={{ fill: INK_BODY, fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: INK_MUTED, fontSize: 9 }} />
                <Radar name="Engagement" dataKey="value" stroke={SAGE} fill={SAGE} fillOpacity={0.25} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>Sentiment Timeline</div>
            <div style={{ fontSize: 12, color: INK_MUTED, marginBottom: 16 }}>Emotional arc through the conversation</div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={sentimentData}>
                <defs>
                  <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={SAGE_DARK} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={SAGE_DARK} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                <XAxis dataKey="time" stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis domain={[-1, 1]} stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 10 }} tickFormatter={v => v.toFixed(1)} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => [v.toFixed(2), 'Sentiment Score']} />
                <Area type="monotone" dataKey="score" stroke={SAGE_DARK} fill="url(#sentGrad)" strokeWidth={2} dot={{ r: 4, fill: SAGE_DARK, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>Topic Interest Breakdown</div>
            <div style={{ fontSize: 12, color: INK_MUTED, marginBottom: 16 }}>Depth of discussion per topic</div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={topicBarData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="#C7C7C7" tick={{ fill: INK_MUTED, fontSize: 11 }} />
                <YAxis dataKey="topic" type="category" stroke="#C7C7C7" tick={{ fill: INK_BODY, fontSize: 11 }} width={90} />
                <Tooltip contentStyle={TOOLTIP} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={SAGE} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div className="glass-card" style={{ borderRadius: 16, padding: 26 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <MessageSquare size={16} color={SAGE_DARK} />
              <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>Conversation Transcript</span>
              <span style={{ fontSize: 11, color: INK_MUTED, marginLeft: 'auto' }}>{(r.transcript || []).length} turns</span>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
              {(r.transcript || []).map((turn, i) => (
                <TranscriptBubble key={i} turn={turn} idx={i} />
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {shareToast && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', bottom: 24, right: 24, padding: '12px 18px', background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 12, color: INK, fontSize: 13, zIndex: 1100, boxShadow: '0 12px 32px rgba(0,0,0,0.10)' }}>
          {shareToast}
        </motion.div>
      )}
    </DashboardLayout>
  )
}
