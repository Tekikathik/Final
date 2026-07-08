import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useScroll, useTransform, AnimatePresence, useMotionValue, useSpring } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Phone, Brain, BarChart3, Users, Star, ArrowRight,
  Play, Pause, CheckCircle, Zap, Shield, Globe,
  TrendingUp, MessageSquare, ChevronDown, Building2
} from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

const WAVE_HEIGHTS = [20, 45, 65, 30, 55, 80, 35, 60, 25, 70, 40, 55, 30, 75, 45, 60, 35, 80, 20, 50]

function WaveformVisualizer({ active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 60 }}>
      {WAVE_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className={active ? 'wave-bar' : ''}
          style={{
            width: 3,
            height: active ? h : h * 0.3,
            background: `linear-gradient(180deg, ${SAGE}, ${AMBER})`,
            borderRadius: 3,
            transition: 'height 0.3s ease',
            animationDelay: active ? `${i * 0.06}s` : '0s',
          }}
        />
      ))}
    </div>
  )
}

const testimonials = [
  { name: 'Dr. Rajesh Kumar', role: 'Principal, NIT Pune', text: 'AdmitAI transformed our admission process. We went from 20% call response to 78% in just one semester.', rating: 5, college: 'NIT Pune' },
  { name: 'Priya Mehta', role: 'Admission Director, XLRI', text: 'The AI voice bot handles queries better than our human callers. Students actually prefer talking to it!', rating: 5, college: 'XLRI Jamshedpur' },
  { name: 'Anand Sharma', role: 'Head of Admissions, IIM', text: 'Real-time analytics dashboard gives us insights we never had before. Enrollment up by 42% this year.', rating: 5, college: 'IIM Ahmedabad' },
]

const features = [
  { icon: Brain,       title: 'AI-Powered Conversations', desc: 'Natural language processing that understands context, handles objections, and adapts tone in real-time.', color: SAGE },
  { icon: BarChart3,   title: 'Real-Time Analytics',      desc: 'Live dashboards showing call metrics, lead funnel, sentiment analysis, and enrollment predictions.', color: AMBER },
  { icon: Phone,       title: 'Automated Calling',        desc: 'Schedule and trigger thousands of calls simultaneously. Never miss a prospective student again.', color: SAGE_DARK },
  { icon: Shield,      title: 'DPDP Compliant',           desc: 'Fully compliant with India\'s Digital Personal Data Protection Act. Student data is always secure.', color: AMBER_DARK },
  { icon: Globe,       title: 'Multi-Language Support',   desc: 'Communicate in Hindi, English, Tamil, Telugu, and 12 more regional languages.', color: SAGE },
  { icon: TrendingUp,  title: 'Lead Scoring',             desc: 'AI assigns conversion probability to each lead so your team focuses on the highest-potential students.', color: AMBER },
]

const stats = [
  { value: '2.4M+', label: 'Calls Made',         icon: Phone },
  { value: '340+',  label: 'Colleges',           icon: Building2 },
  { value: '78%',   label: 'Avg Connect Rate',   icon: TrendingUp },
  { value: '42%',   label: 'Enrollment Boost',   icon: Users },
]

export default function Landing() {
  const navigate = useNavigate()
  const heroRef = useRef(null)
  const statsRef = useRef(null)
  const featuresRef = useRef(null)
  const [demoActive, setDemoActive] = useState(false)
  const [demoState, setDemoState] = useState('idle')
  const [demoText, setDemoText] = useState('')
  const [testimonialIdx, setTestimonialIdx] = useState(0)
  const { scrollYProgress } = useScroll()
  const heroY = useTransform(scrollYProgress, [0, 0.3], [0, -80])

  // 3D headline tilt — the letters lean in 3D space toward the cursor.
  const tiltMX = useMotionValue(0)
  const tiltMY = useMotionValue(0)
  const tiltX = useSpring(tiltMX, { stiffness: 90, damping: 14 })
  const tiltY = useSpring(tiltMY, { stiffness: 90, damping: 14 })
  const handleHeroMove = (e) => {
    const r = heroRef.current?.getBoundingClientRect()
    if (!r) return
    tiltMY.set(((e.clientX - r.left) / r.width - 0.5) * 16)    // rotateY
    tiltMX.set(-((e.clientY - r.top) / r.height - 0.5) * 12)   // rotateX
  }
  const handleHeroLeave = () => { tiltMX.set(0); tiltMY.set(0) }

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.hero-badge', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.2 })
      // .hero-title is now animated by framer-motion (3D flip-in + tilt), not GSAP.
      gsap.fromTo('.hero-sub',   { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, delay: 0.6 })
      gsap.fromTo('.hero-cta',   { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.8, stagger: 0.15 })

      gsap.fromTo('.stat-item', { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.6, stagger: 0.1,
        scrollTrigger: { trigger: statsRef.current, start: 'top 80%' }
      })

      gsap.fromTo('.feature-card', { opacity: 0, y: 40 }, {
        opacity: 1, y: 0, duration: 0.6, stagger: 0.1,
        scrollTrigger: { trigger: featuresRef.current, start: 'top 80%' }
      })
    })
    return () => ctx.revert()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setTestimonialIdx((i) => (i + 1) % testimonials.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const runDemo = () => {
    if (demoActive) { setDemoActive(false); setDemoState('idle'); setDemoText(''); return }
    setDemoActive(true)
    setDemoState('calling')
    setDemoText('Initiating call to +91 98765 43210...')
    setTimeout(() => { setDemoState('speaking'); setDemoText('AI: "Hello Rahul! I am calling from Aditya University regarding your admission enquiry. Is this a good time to speak?"') }, 2000)
    setTimeout(() => { setDemoText('Student: "Yes, please go ahead."') }, 5000)
    setTimeout(() => { setDemoText('AI: "Great! We have a special early-bird scholarship that covers 40% of your tuition. Based on your profile, you qualify. Would you like more details?"') }, 7000)
    setTimeout(() => { setDemoText('Student: "Yes! That sounds amazing, tell me more..."') }, 11000)
    setTimeout(() => { setDemoState('completed'); setDemoText('Call completed. Lead Status: HIGH INTEREST. Sentiment: Positive. Recommended Action: Schedule campus visit.') }, 14000)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', color: INK }}>
      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, padding: '0 40px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #E8E8E8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{ width: 34, height: 34, background: SAGE, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Phone size={16} color="white" />
          </div>
          <span style={{ fontWeight: 600, fontSize: 18, color: INK, letterSpacing: -0.3 }}>AdmitAI</span>
        </div>
        <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {[
            { label: 'Features', target: featuresRef },
            { label: 'Live Demo', target: 'demo' },
            { label: 'Customers', target: 'testimonials' },
          ].map(item => (
            <span key={item.label}
              style={{ color: INK_BODY, cursor: 'pointer', fontSize: 14, fontWeight: 500, transition: 'color 0.2s', position: 'relative' }}
              onMouseEnter={e => e.currentTarget.style.color = SAGE_DARK}
              onMouseLeave={e => e.currentTarget.style.color = INK_BODY}
              onClick={() => {
                if (item.target?.current) item.target.current.scrollIntoView({ behavior: 'smooth' })
                else document.getElementById(item.target)?.scrollIntoView({ behavior: 'smooth' })
              }}>
              {item.label}
            </span>
          ))}
          <motion.button whileTap={{ scale: 0.97 }} className="btn-secondary" style={{ padding: '8px 20px', fontSize: 13 }} onClick={() => navigate('/login')}>Login</motion.button>
          <motion.button whileTap={{ scale: 0.97 }} className="btn-primary" style={{ padding: '9px 22px', fontSize: 13 }} onClick={() => navigate('/create-org')}>Get Started</motion.button>
        </div>
      </nav>

      {/* Hero */}
      <section ref={heroRef} onMouseMove={handleHeroMove} onMouseLeave={handleHeroLeave} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 60, position: 'relative', overflow: 'hidden' }}>
        <div className="orb orb-blue"   style={{ width: 600, height: 600, top: -100, left: -200, opacity: 0.7 }} />
        <div className="orb orb-purple" style={{ width: 500, height: 500, bottom: -100, right: -150, opacity: 0.6 }} />

        <motion.div style={{ y: heroY, textAlign: 'center', maxWidth: 820, padding: '0 20px', position: 'relative', zIndex: 2 }}>
          <div className="hero-badge" style={{ opacity: 0, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F1F5EE', border: '1px solid #C7D5BD', borderRadius: 999, padding: '6px 16px', fontSize: 13, color: SAGE_DARK, marginBottom: 28, fontWeight: 500 }}>
            <Zap size={12} /> Powered by Advanced Conversational AI
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30, rotateX: -55 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 900, transformStyle: 'preserve-3d', marginBottom: 24 }}>
            <motion.h1
              style={{
                rotateX: tiltX, rotateY: tiltY, transformPerspective: 900, transformStyle: 'preserve-3d',
                fontSize: 'clamp(38px, 6vw, 76px)', fontWeight: 600, lineHeight: 1.05, letterSpacing: -2, color: INK, margin: 0,
              }}>
              <span className="text-3d">AI Voice Agents That</span><br />
              <span className="gradient-text" style={{ filter: 'drop-shadow(0 8px 14px rgba(125,155,118,0.35))' }}>Fill Your College Seats</span>
            </motion.h1>
          </motion.div>

          <p className="hero-sub" style={{ opacity: 0, fontSize: 18, color: INK_BODY, lineHeight: 1.7, marginBottom: 40, maxWidth: 600, margin: '0 auto 40px', fontWeight: 400 }}>
            Automate student outreach with intelligent voice AI. Make thousands of personalised calls, qualify leads, and boost enrollment — all while you sleep.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <motion.button whileTap={{ scale: 0.97 }} className="hero-cta btn-primary" style={{ opacity: 0, padding: '14px 32px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => navigate('/create-org')}>
              Start Free Trial <ArrowRight size={16} />
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }} className="hero-cta btn-secondary" style={{ opacity: 0, padding: '14px 32px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }} onClick={runDemo}>
              <Play size={16} /> Watch Live Demo
            </motion.button>
          </div>

          {/* Demo Terminal */}
          <AnimatePresence>
            {demoActive && (
              <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                style={{ marginTop: 48, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 16, padding: 24, textAlign: 'left', maxWidth: 620, margin: '48px auto 0', boxShadow: '0 20px 50px rgba(0,0,0,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['#E5A5A5', '#ECD3A0', '#C7D5BD'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
                  </div>
                  <span style={{ fontSize: 12, color: INK_MUTED, fontFamily: 'monospace' }}>AdmitAI — Live Call Demo</span>
                  <span className={`badge-${demoState === 'completed' ? 'success' : demoState === 'speaking' ? 'info' : 'warning'}`} style={{ marginLeft: 'auto' }}>
                    {demoState === 'calling' ? 'Connecting...' : demoState === 'speaking' ? 'In Call' : 'Completed'}
                  </span>
                </div>
                {demoState === 'speaking' && <WaveformVisualizer active />}
                <p style={{ fontSize: 14, color: INK, lineHeight: 1.7, marginTop: 12, fontFamily: 'monospace' }}>{demoText}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <div style={{ position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)' }}>
          <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
            <ChevronDown size={24} color={INK_MUTED} />
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section ref={statsRef} style={{ padding: '60px 40px', position: 'relative', background: '#FBFBFA' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          {stats.map(({ value, label, icon: Icon }) => (
            <div key={label} className="stat-item" style={{ opacity: 0 }}>
              <div className="stat-card" style={{ textAlign: 'center' }}>
                <Icon size={26} color={SAGE} style={{ margin: '0 auto 12px' }} />
                <div style={{ fontSize: 38, fontWeight: 600, color: INK, letterSpacing: -1 }}>{value}</div>
                <div style={{ fontSize: 14, color: INK_MUTED, marginTop: 4 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section ref={featuresRef} style={{ padding: '90px 40px', position: 'relative' }}>
        <div style={{ maxWidth: 1140, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ fontSize: 42, fontWeight: 600, color: INK, letterSpacing: -1, marginBottom: 16 }}>Everything You Need</h2>
            <p style={{ color: INK_BODY, fontSize: 16, maxWidth: 560, margin: '0 auto' }}>From first call to enrolled student — AdmitAI handles the entire admission pipeline.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {features.map(({ icon: Icon, title, desc, color }) => (
              <motion.div key={title} className="feature-card glass-card" style={{ opacity: 0, borderRadius: 16, padding: 26 }}
                whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: `${color}1F`, border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                  <Icon size={22} color={color} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: INK, marginBottom: 8 }}>{title}</h3>
                <p style={{ fontSize: 14, color: INK_BODY, lineHeight: 1.7 }}>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Try Section */}
      <section id="demo" style={{ padding: '90px 40px', position: 'relative', background: '#FBFBFA' }}>
        <div className="orb orb-teal" style={{ width: 400, height: 400, top: 0, left: '30%', opacity: 0.5 }} />
        <div style={{ maxWidth: 920, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <h2 style={{ fontSize: 38, fontWeight: 600, color: INK, marginBottom: 16, letterSpacing: -1 }}>Try It Without Signing Up</h2>
          <p style={{ color: INK_BODY, marginBottom: 40, fontSize: 16 }}>Experience a live AI admission call simulation — no registration required.</p>
          <motion.div className="glass-card" style={{ borderRadius: 22, padding: 40, position: 'relative' }}
            whileHover={{ y: -2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, color: INK_MUTED, marginBottom: 4 }}>Simulated call to</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: INK }}>+91 98765 43210</div>
                <div style={{ fontSize: 13, color: INK_MUTED }}>Rahul Sharma — Engineering Prospect</div>
              </div>
              <motion.button
                className={demoActive ? 'btn-secondary' : 'btn-primary'}
                style={{ padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 8 }}
                whileTap={{ scale: 0.97 }}
                onClick={runDemo}>
                {demoActive ? <><Pause size={16} /> Stop Demo</> : <><Play size={16} /> Start Live Demo</>}
              </motion.button>
            </div>
            <WaveformVisualizer active={demoState === 'speaking'} />
            {demoText && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ marginTop: 20, padding: 18, background: '#F1F5EE', borderRadius: 12, textAlign: 'left', fontSize: 14, color: INK, lineHeight: 1.7, fontFamily: 'monospace', border: '1px solid #E0E9DA' }}>
                {demoText}
              </motion.div>
            )}
            {demoState === 'completed' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'Lead Score',  value: '92/100',       color: SAGE_DARK,  bg: '#F1F5EE' },
                  { label: 'Sentiment',   value: 'Positive',     color: SAGE_DARK,  bg: '#F1F5EE' },
                  { label: 'Next Action', value: 'Campus Visit', color: AMBER_DARK, bg: '#FBF5EA' },
                ].map(m => (
                  <div key={m.label} style={{ flex: 1, minWidth: 130, background: m.bg, border: '1px solid #E8E8E8', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: INK_MUTED, marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </motion.div>
            )}
          </motion.div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" style={{ padding: '90px 40px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 38, fontWeight: 600, color: INK, marginBottom: 48, letterSpacing: -1 }}>Trusted by Top Institutions</h2>
          <AnimatePresence mode="wait">
            <motion.div key={testimonialIdx} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.4 }}
              className="glass-card" style={{ borderRadius: 22, padding: 44 }}>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 20 }}>
                {Array.from({ length: testimonials[testimonialIdx].rating }).map((_, i) => (
                  <Star key={i} size={16} fill={AMBER} color={AMBER} />
                ))}
              </div>
              <p style={{ fontSize: 18, color: INK, lineHeight: 1.8, marginBottom: 24, fontWeight: 400, fontStyle: 'italic' }}>"{testimonials[testimonialIdx].text}"</p>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{testimonials[testimonialIdx].name}</div>
                <div style={{ fontSize: 13, color: INK_MUTED }}>{testimonials[testimonialIdx].role}</div>
              </div>
            </motion.div>
          </AnimatePresence>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
            {testimonials.map((_, i) => (
              <button key={i} onClick={() => setTestimonialIdx(i)} style={{ width: i === testimonialIdx ? 26 : 8, height: 8, borderRadius: 4, background: i === testimonialIdx ? SAGE : '#E8E8E8', border: 'none', cursor: 'pointer', transition: 'all 0.3s' }} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section style={{ padding: '90px 40px' }}>
        <motion.div initial={{ opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}
          style={{ maxWidth: 860, margin: '0 auto', background: 'linear-gradient(135deg, #F1F5EE 0%, #FBF5EA 100%)', border: '1px solid #E0E9DA', borderRadius: 24, padding: '64px 44px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 38, fontWeight: 600, color: INK, marginBottom: 16, letterSpacing: -1 }}>Ready to Fill More Seats?</h2>
          <p style={{ color: INK_BODY, fontSize: 16, marginBottom: 32 }}>Join 340+ colleges already using AdmitAI to automate admissions.</p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" style={{ padding: '14px 36px', fontSize: 15 }} onClick={() => navigate('/create-org')}>
              Create Your Organisation
            </button>
            <button className="btn-secondary" style={{ padding: '14px 36px', fontSize: 15 }} onClick={() => navigate('/login')}>
              Login to Dashboard
            </button>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '36px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, background: '#FFFFFF', borderTop: '1px solid #E8E8E8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: SAGE, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Phone size={14} color="white" />
          </div>
          <span style={{ fontWeight: 600, color: INK }}>AdmitAI</span>
        </div>
        <div style={{ fontSize: 13, color: INK_MUTED }}>© 2026 AdmitAI. All rights reserved.</div>
        <div style={{ display: 'flex', gap: 24 }}>
          {[
            { label: 'Privacy', href: 'mailto:privacy@aditya.edu.in?subject=AdmitAI%20privacy%20enquiry' },
            { label: 'Terms',   href: 'mailto:legal@aditya.edu.in?subject=AdmitAI%20terms%20enquiry' },
            { label: 'Support', href: 'mailto:support@aditya.edu.in?subject=AdmitAI%20support' },
          ].map(({ label, href }) => (
            <a key={label} href={href} style={{ fontSize: 13, color: INK_MUTED, cursor: 'pointer', textDecoration: 'none', transition: 'color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.color = SAGE_DARK}
              onMouseLeave={e => e.currentTarget.style.color = INK_MUTED}>{label}</a>
          ))}
        </div>
      </footer>
    </div>
  )
}
