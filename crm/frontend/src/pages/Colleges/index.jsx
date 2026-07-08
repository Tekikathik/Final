import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Building2, Search, MapPin, Phone, Users, TrendingUp,
  Filter, ArrowUpRight,
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useStore } from '../../store/useStore'

import { SAGE, SAGE_DARK, SAGE_LIGHT, AMBER, AMBER_DARK, INK, INK_BODY, INK_MUTED, COLORS } from '../../theme'

function CollegeTile({ college, onOpen, delay = 0 }) {
  const leadRate = college.calls > 0 ? Math.round((college.leads / college.calls) * 100) : 0
  const enrolledRate = college.calls > 0 ? Math.round((college.enrolled / college.calls) * 100) : 0

  return (
    <motion.div
      className="glass-card"
      style={{ borderRadius: 14, padding: 22, cursor: 'pointer' }}
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
      whileHover={{ y: -3 }}
      onClick={() => onOpen(college)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 46, height: 46, background: '#F1F5EE', border: '1px solid #E0E9DA', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Building2 size={20} color={SAGE_DARK} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{college.name}</div>
            <div style={{ fontSize: 12, color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <MapPin size={11} /> {college.location || '—'} {college.code ? `· ${college.code}` : ''}
            </div>
          </div>
        </div>
        <ArrowUpRight size={16} color={INK_MUTED} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Calls',    value: college.calls    || 0, color: SAGE },
          { label: 'Leads',    value: college.leads    || 0, color: AMBER },
          { label: 'Enrolled', value: college.enrolled || 0, color: SAGE_DARK },
        ].map(m => (
          <div key={m.label} style={{ textAlign: 'center', padding: '10px 4px', background: '#FBFBFA', borderRadius: 8, border: '1px solid #F4F4F2' }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: m.color }}>{m.value}</div>
            <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 12, color: INK_MUTED }}>Lead Rate</span>
          <span style={{ fontSize: 12, color: SAGE_DARK, fontWeight: 600 }}>{leadRate}%</span>
        </div>
        <div style={{ height: 5, background: '#F1F5EE', borderRadius: 3, marginBottom: 10 }}>
          <motion.div initial={{ width: 0 }} animate={{ width: `${leadRate}%` }} transition={{ duration: 0.9 }}
            style={{ height: '100%', background: `linear-gradient(90deg, ${SAGE}, ${AMBER})`, borderRadius: 3 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 12, color: INK_MUTED }}>Enrollment Rate</span>
          <span style={{ fontSize: 12, color: AMBER_DARK, fontWeight: 600 }}>{enrolledRate}%</span>
        </div>
        <div style={{ height: 5, background: '#FBF5EA', borderRadius: 3 }}>
          <motion.div initial={{ width: 0 }} animate={{ width: `${enrolledRate}%` }} transition={{ duration: 0.9, delay: 0.15 }}
            style={{ height: '100%', background: AMBER, borderRadius: 3 }} />
        </div>
      </div>
    </motion.div>
  )
}

export default function Colleges() {
  const navigate = useNavigate()
  const { colleges, fetchColleges, students, loadDummyData } = useStore()

  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState('leadRate')

  useEffect(() => {
    fetchColleges()
    if (!students || students.length === 0) loadDummyData()
  }, [])

  const filteredColleges = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = colleges.filter(c =>
      !q ||
      c.name?.toLowerCase().includes(q) ||
      c.location?.toLowerCase().includes(q) ||
      c.code?.toLowerCase().includes(q)
    )
    if (sort === 'leadRate') {
      list = [...list].sort((a, b) => {
        const ra = a.calls ? a.leads / a.calls : 0
        const rb = b.calls ? b.leads / b.calls : 0
        return rb - ra
      })
    } else if (sort === 'calls')  list = [...list].sort((a, b) => (b.calls || 0)  - (a.calls || 0))
    else if (sort === 'leads')    list = [...list].sort((a, b) => (b.leads || 0)  - (a.leads || 0))
    else if (sort === 'name')     list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [colleges, search, sort])

  const totals = colleges.reduce(
    (acc, c) => ({
      calls:    acc.calls    + (c.calls    || 0),
      leads:    acc.leads    + (c.leads    || 0),
      enrolled: acc.enrolled + (c.enrolled || 0),
    }),
    { calls: 0, leads: 0, enrolled: 0 }
  )

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.7 }}>Colleges</h1>
            <p style={{ color: INK_MUTED, fontSize: 14, marginTop: 4 }}>Browse and analyse every college in your organisation</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[
            { icon: Building2,  label: 'Total Colleges',    value: colleges.length, color: SAGE },
            { icon: Phone,      label: 'Total Calls',       value: totals.calls,    color: AMBER },
            { icon: TrendingUp, label: 'Total Leads',       value: totals.leads,    color: SAGE_DARK },
            { icon: Users,      label: 'Enrolled Students', value: totals.enrolled, color: AMBER_DARK },
          ].map((s, i) => (
            <motion.div key={s.label} className="stat-card"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
              whileHover={{ y: -3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: `${s.color}1A`, border: `1px solid ${s.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <s.icon size={18} color={s.color} />
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -1 }}>{s.value.toLocaleString()}</div>
              <div style={{ fontSize: 13, color: INK_MUTED, marginTop: 4 }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
            <Search size={15} color={INK_MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              className="input-dark"
              style={{ paddingLeft: 40 }}
              placeholder="Search by college name, code, or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, padding: '4px 10px 4px 14px' }}>
            <Filter size={14} color={INK_MUTED} />
            <span style={{ fontSize: 12, color: INK_MUTED }}>Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: INK, fontSize: 13, padding: '8px 6px', cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}
            >
              <option value="leadRate">Lead Rate</option>
              <option value="calls">Total Calls</option>
              <option value="leads">Total Leads</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: INK }}>
              {filteredColleges.length} {filteredColleges.length === 1 ? 'college' : 'colleges'}
              {search && <span style={{ color: INK_MUTED, fontWeight: 400 }}> matching "{search}"</span>}
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
            {filteredColleges.map((college, i) => (
              <CollegeTile
                key={college._id || college.id}
                college={college} delay={i * 0.05}
                onOpen={(c) => navigate(`/dashboard/colleges/${c._id || c.id}`)}
              />
            ))}
            {filteredColleges.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: INK_MUTED }}>
                <Building2 size={42} color="#C7C7C7" style={{ margin: '0 auto 12px' }} />
                <p>No colleges match your search.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
