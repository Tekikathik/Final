/* Seed demo CRM data: one org, head office + branches, admin/officers/student, leads.
   Run:  node scripts/seedCrm.js   (uses MONGO_URI from .env)
   Idempotent-ish: wipes the demo org's data first so re-runs are clean. */
require('dotenv').config()
const mongoose = require('mongoose')
const Organization = require('../models/Organization')
const College = require('../models/College')
const User = require('../models/User')
const Lead = require('../models/Lead')
const Call = require('../models/Call')
const Appointment = require('../models/Appointment')
const AuditLog = require('../models/AuditLog')
const DNDEntry = require('../models/DNDEntry')
const Competitor = require('../models/Competitor')
const CompetitiveReport = require('../models/CompetitiveReport')
const { importLeads } = require('../services/leadImport')

const PASSWORD = process.env.SEED_PASSWORD || 'password123'

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('connected:', mongoose.connection.host)

  const ORG = 'Aditya University'
  let org = await Organization.findOne({ name: ORG })
  if (org) {
    // wipe prior demo data for a clean reseed
    const branches = await College.find({ orgId: org._id }).select('_id')
    const bIds = branches.map(b => b._id)
    await Promise.all([
      Lead.deleteMany({ orgId: org._id }), Call.deleteMany({ orgId: org._id }),
      Appointment.deleteMany({ orgId: org._id }), AuditLog.deleteMany({ orgId: org._id }),
      DNDEntry.deleteMany({ orgId: org._id }), User.deleteMany({ orgId: org._id }),
      Competitor.deleteMany({ orgId: org._id }), CompetitiveReport.deleteMany({ orgId: org._id }),
      College.deleteMany({ _id: { $in: bIds } }),
    ])
  } else {
    org = await Organization.create({ name: ORG, location: 'Surampalem, Andhra Pradesh', type: 'University' })
  }

  const hq  = await College.create({ orgId: org._id, name: 'Head Office', code: 'HQ', state: 'Andhra Pradesh', location: 'Surampalem', isHeadOffice: true })
  const hyd = await College.create({ orgId: org._id, name: 'Hyderabad Branch', code: 'HYD', state: 'Telangana', location: 'Hyderabad' })
  const maa = await College.create({ orgId: org._id, name: 'Chennai Branch', code: 'MAA', state: 'Tamil Nadu', location: 'Chennai' })

  const admin = await User.create({ orgId: org._id, name: 'Main Admin', email: 'admin@aditya.edu', passwordHash: PASSWORD, role: 'admin', branchId: hq._id, phone: '9000000000' })
  const offHyd = await User.create({ orgId: org._id, name: 'Ravi (Hyderabad)', email: 'ravi@aditya.edu', passwordHash: PASSWORD, role: 'officer', branchId: hyd._id, phone: '9000000001' })
  const offMaa = await User.create({ orgId: org._id, name: 'Meena (Chennai)', email: 'meena@aditya.edu', passwordHash: PASSWORD, role: 'officer', branchId: maa._id, phone: '9000000002' })
  const student = await User.create({ orgId: org._id, name: 'Student Demo', email: 'student@aditya.edu', passwordHash: PASSWORD, role: 'student', branchId: hyd._id, phone: '9123456780' })

  // Leads per branch (valid Indian mobiles).
  const hydNames = ['Rahul Sharma', 'Sneha Reddy', 'Arjun Rao', 'Divya Nair', 'Vikram Singh', 'Ananya Gupta', 'Kiran Kumar', 'Pooja Desai', 'Manoj Verma', 'Lakshmi Menon', 'Aditya Joshi', 'Nisha Patel']
  const maaNames = ['Karthik V', 'Priya Iyer', 'Suresh M', 'Deepa Raj', 'Ganesh B', 'Revathi S', 'Vignesh K', 'Anitha R']
  const hydRows = hydNames.map((name, i) => ({ name, phone: `98765${String(10000 + i * 137).slice(-5)}` }))
  hydRows.push({ name: 'Bad Number', phone: '12345' })   // invalid → rejected on import
  const maaRows = maaNames.map((name, i) => ({ name, phone: `94445${String(20000 + i * 211).slice(-5)}` }))

  const r1 = await importLeads(hydRows, { orgId: org._id, branchId: hyd._id, assignedOfficerId: offHyd._id, createdBy: offHyd._id })
  const r2 = await importLeads(maaRows, { orgId: org._id, branchId: maa._id, assignedOfficerId: offMaa._id, createdBy: offMaa._id })

  // ── Generate realistic activity so every dashboard is populated ────────────
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
  const daysAgo = (d) => new Date(Date.now() - d * 86400000)

  // Outcome "scripts": [disposition, resulting lead status, connected]
  const PATHS = [
    ['interested', 'Interested', true], ['interested', 'AppointmentBooked', true],
    ['callback', 'Contacted', true], ['not_interested', 'NotInterested', true],
    ['no_answer', 'Contacted', false], ['wrong_number', 'Invalid', true],
    ['enrolled', 'Enrolled', true], ['interested', 'Visited', true],
  ]

  async function generate(branch, officer) {
    const leads = await Lead.find({ branchId: branch._id })
    let calls = 0, appts = 0
    for (const lead of leads) {
      if (lead.dnd) continue
      const [disp, status, connected] = pick(PATHS)
      const nCalls = rint(1, 3)
      for (let k = 0; k < nCalls; k++) {
        const conn = k === nCalls - 1 ? connected : Math.random() > 0.4
        await Call.create({
          orgId: org._id, collegeId: branch._id, leadId: lead._id, officerId: officer._id,
          phone: lead.phone, name: lead.name,
          status: conn ? 'completed' : pick(['no_answer', 'failed']),
          connected: conn, disposition: k === nCalls - 1 ? disp : null,
          duration: conn ? rint(25, 220) : null,
          sentiment: pick(['positive', 'neutral', 'negative']),
          startedAt: daysAgo(rint(0, 14)), endedAt: daysAgo(rint(0, 14)),
        })
        calls++
      }
      lead.status = status
      lead.lastDisposition = disp
      lead.callCount = nCalls
      lead.lastCalledAt = daysAgo(rint(0, 14))
      if (disp === 'callback') lead.nextFollowUpAt = new Date(Date.now() + rint(1, 48) * 3600000)
      lead.statusHistory.push({ status, by: officer._id, note: `disposition: ${disp}` })
      await lead.save()

      // Appointments for booked/visited leads.
      if (status === 'AppointmentBooked' || status === 'Visited') {
        await Appointment.create({
          orgId: org._id, branchId: branch._id, leadId: lead._id,
          studentName: lead.name, studentPhone: lead.phone,
          scheduledFor: status === 'Visited' ? daysAgo(rint(1, 7)) : new Date(Date.now() + rint(1, 10) * 86400000),
          status: status === 'Visited' ? 'visited' : 'booked',
          createdBy: officer._id, createdByRole: 'officer',
        })
        appts++
      }

      await AuditLog.create({ orgId: org._id, branchId: branch._id, actorId: officer._id, actorRole: 'officer',
        action: 'lead.disposition', entity: 'Lead', entityId: lead._id, meta: { disposition: disp, statusTo: status } })
    }
    return { calls, appts }
  }

  // Flag a couple of leads as DND for the compliance demo.
  const dndLeads = await Lead.find({ branchId: hyd._id }).limit(2)
  for (const l of dndLeads) { l.dnd = true; await l.save(); await DNDEntry.updateOne({ orgId: org._id, phone: l.phone }, { $setOnInsert: { reason: 'opt_out', addedBy: offHyd._id } }, { upsert: true }) }

  const aHyd = await generate(hyd, offHyd)
  const aMaa = await generate(maa, offMaa)

  // ── Competitors we track (rivals with their known facts) ───────────────────
  const COMPETITORS = [
    { name: 'KL University', tier: 3, aliases: ['KLU', 'KLEF', 'Koneru Lakshmaiah', 'KL Univ'],
      location: 'Vijayawada, AP', website: 'https://www.kluniversity.in', sourceUrl: 'https://www.kluniversity.in/placements',
      profile: { naac: 'A++', nirfRank: '50', placementHighestLpa: 52, placementAvgLpa: 7.5, annualFeeLpa: 2.2,
        topRecruiters: ['Amazon', 'Microsoft', 'Deloitte', 'Cognizant'], scholarships: 'KLSAT-based up to 100%', hostel: 'AC / non-AC',
        programs: ['B.Tech CSE/AIML', 'MBA', 'Law'],
        strengths: ['Very high peak placement (₹52L)', 'Strong NIRF rank (~50)', 'Aggressive scholarship marketing'],
        weaknesses: ['Higher fees than regional peers'], brandNotes: 'Strong recall across the Krishna/Guntur belt' } },
    { name: 'VIT-AP', tier: 3, aliases: ['VIT AP', 'VIT University', 'Vellore Institute', 'VIT Amaravati'],
      location: 'Amaravati, AP', website: 'https://vitap.ac.in', sourceUrl: 'https://vitap.ac.in/placements',
      profile: { naac: 'A++', nirfRank: null, placementHighestLpa: 44, placementAvgLpa: 9, annualFeeLpa: 3.0,
        topRecruiters: ['Amazon', 'Microsoft', 'PayPal'], scholarships: 'VITEEE rank-based waivers', hostel: 'AC / non-AC',
        programs: ['B.Tech CSE', 'M.Tech Integrated'],
        strengths: ['Strong VIT brand pull', 'High average package (₹9L)'],
        weaknesses: ['Highest fees in the region', 'No NAAC edge over Aditya'], brandNotes: 'Parents recognise the Vellore brand' } },
    { name: 'SRM University AP', tier: 3, aliases: ['SRM AP', 'SRM Amaravati', 'SRM University'],
      location: 'Amaravati, AP', website: 'https://srmap.edu.in', sourceUrl: 'https://srmap.edu.in/placements',
      profile: { naac: null, nirfRank: null, placementHighestLpa: 50, placementAvgLpa: 8, annualFeeLpa: 2.5,
        topRecruiters: ['Amazon', 'Bosch', 'TCS'], scholarships: 'SRMJEEE merit waivers', hostel: 'AC / non-AC',
        programs: ['B.Tech CSE/ECE', 'MBA'],
        strengths: ['High peak placement (₹50L)', 'Research funding push'],
        weaknesses: ['No NAAC A++ grade', 'Newer campus, thinner alumni base'], brandNotes: 'Rising in the Amaravati corridor' } },
    { name: 'GITAM', tier: 3, aliases: ['GITAM University', 'Gandhi Institute', 'Gitam Vizag'],
      location: 'Visakhapatnam, AP', website: 'https://www.gitam.edu', sourceUrl: 'https://www.gitam.edu/placements',
      profile: { naac: 'A++', nirfRank: '100', placementHighestLpa: 30, placementAvgLpa: 5.5, annualFeeLpa: 2.8,
        topRecruiters: ['TCS', 'Infosys', 'Wipro'], scholarships: 'GAT-based waivers', hostel: 'AC / non-AC',
        programs: ['B.Tech', 'Pharmacy', 'Management'],
        strengths: ['Established Visakhapatnam brand', 'Stronger NIRF band (~100)'],
        weaknesses: ['Peak package close to Aditya', 'Fees higher than Aditya'], brandNotes: 'Legacy pull in north-coastal AP' } },
    { name: 'Vignan University', tier: 3, aliases: ['Vignan', "Vignan's University", 'Vignan Guntur'],
      location: 'Guntur, AP', website: 'https://vignan.ac.in', sourceUrl: 'https://vignan.ac.in/placements',
      profile: { naac: 'A+', nirfRank: null, placementHighestLpa: 20, placementAvgLpa: 4.5, annualFeeLpa: 1.6,
        topRecruiters: ['TCS', 'Infosys', 'Cognizant'], scholarships: 'V-SAT merit slabs', hostel: 'AC / non-AC',
        programs: ['B.Tech', 'Agriculture', 'Pharmacy'],
        strengths: ['Lower annual fee (₹1.6L)'],
        weaknesses: ['Lower peak placements than Aditya', 'Only NAAC A+ vs our A++'], brandNotes: 'Price-led choice in Guntur belt' } },
  ]
  const comps = await Competitor.insertMany(COMPETITORS.map(c => ({ ...c, orgId: org._id })))
  const compByName = Object.fromEntries(comps.map(c => [c.name, c]))

  // ── Competitor mentions inside call transcripts (the agent's core evidence) ─
  // Each script: which rival is named, whether the student went with them (lost),
  // and a short code-mixed counselling transcript.
  const T = (role, text) => ({ role, text, timestamp: daysAgo(rint(0, 20)) })
  const MENTIONS = [
    { comp: 'KL University', lost: true, turns: [
      ['assistant', 'Namaste! Aditya University nunchi Priya matladutunna. B.Tech admission gurinchi meeru em anukuntunnaru andi?'],
      ['user', 'Actually KL University lo naaku already seat vachindi, valla highest placement 52 lakhs ani cheppuru.'],
      ['assistant', 'Manaki kuda NAAC A++ tho industry programs unnayi andi, top recruiters kuda vastaru.'],
      ['user', 'Ledandi, KLU brand baguntundi, nenu akkade join avuthanu.'] ] },
    { comp: 'KL University', lost: true, turns: [
      ['assistant', 'Aditya University counselling gurinchi call chesanu andi.'],
      ['user', 'Maa friend KL University lo cheranu antundi, scholarship 100% icharu ani, so KLU vaipu chusthunna.'] ] },
    { comp: 'KL University', lost: false, turns: [
      ['assistant', 'Mee B.Tech preference gurinchi telusukovacha andi?'],
      ['user', 'KL University tho compare chesthunna, kani Aditya lo Big 4 tie-up baguntundi ani vinnanu.'],
      ['assistant', 'Avunu andi, maa Business School India lo only one with all Big 4.'] ] },
    { comp: 'VIT-AP', lost: true, turns: [
      ['assistant', 'Aditya University nunchi Priya andi, B.Tech gurinchi maatladatha?'],
      ['user', 'VIT-AP lo counselling ki vellamu, Vellore brand kabatti akkade decide chesukunnamu.'] ] },
    { comp: 'VIT-AP', lost: false, turns: [
      ['assistant', 'Mee admission decision lo em important andi?'],
      ['user', 'VIT University fees chala ekkuva anpisthundi, Aditya lo fee takkuva unte better.'],
      ['assistant', 'Avunu andi, maa dagara merit scholarships kuda unnayi.'] ] },
    { comp: 'VIT-AP', lost: false, turns: [
      ['assistant', 'B.Tech CSE lo interest unda andi?'],
      ['user', 'VIT AP average package 9 lakhs antunnaru, Aditya lo enta untundi?'] ] },
    { comp: 'SRM University AP', lost: true, turns: [
      ['assistant', 'Aditya University counselling andi, oka rendu nimishaalu maatladatha?'],
      ['user', 'SRM AP lo seat confirm chesukunna, valla placement 50 lakhs highest ani.'] ] },
    { comp: 'SRM University AP', lost: false, turns: [
      ['assistant', 'Mee preferred campus enti andi?'],
      ['user', 'SRM University chusanu kani akkada NAAC A++ ledu, Aditya ki undi kada?'],
      ['assistant', 'Avunu andi, maku NAAC A++ — India lo highest grade.'] ] },
    { comp: 'GITAM', lost: false, turns: [
      ['assistant', 'Aditya University nunchi call andi, B.Tech gurinchi.'],
      ['user', 'GITAM Vizag lo already apply chesanu, kani Aditya lo industry programs baguntayi ani vinnanu.'] ] },
    { comp: 'GITAM', lost: false, turns: [
      ['assistant', 'Mee ranking preference gurinchi cheppandi andi.'],
      ['user', 'GITAM University NIRF lo mundu untundi kada, so confuse authunna.'],
      ['assistant', 'Aditya ki NAAC A++ tho NBA Tier-1 undi andi, placements kuda strong.'] ] },
    { comp: 'Vignan University', lost: true, turns: [
      ['assistant', 'Aditya University counselling andi, oka nimisham maatladatha?'],
      ['user', 'Vignan University fee chala takkuva, budget reasons valla akkade join avuthunna.'] ] },
    { comp: 'Vignan University', lost: false, turns: [
      ['assistant', 'B.Tech admission gurinchi mee doubts em unnayi andi?'],
      ['user', 'Vignan lo fee takkuva kani placement takkuva antunnaru, Aditya lo highest 27 lakhs kada?'],
      ['assistant', 'Avunu andi, maa peak package ₹27L, average ₹6L.'] ] },
  ]

  const leadPool = await Lead.find({ orgId: org._id, dnd: { $ne: true } })
  let mentionCalls = 0
  for (let i = 0; i < MENTIONS.length; i++) {
    const m = MENTIONS[i]
    const lead = leadPool[i % leadPool.length]
    const officer = String(lead.branchId) === String(hyd._id) ? offHyd : offMaa
    await Call.create({
      orgId: org._id, collegeId: lead.branchId, leadId: lead._id, officerId: officer._id,
      phone: lead.phone, name: lead.name, status: 'completed', connected: true,
      disposition: m.lost ? 'not_interested' : 'interested',
      duration: rint(60, 260), sentiment: m.lost ? 'negative' : pick(['positive', 'neutral']),
      startedAt: daysAgo(rint(0, 20)), endedAt: daysAgo(rint(0, 20)),
      transcript: m.turns.map(([role, text]) => T(role, text)),
    })
    mentionCalls++
    if (m.lost) {   // student went with the rival → mark the lead lost so "chosenOverUs" counts
      lead.status = 'NotInterested'
      lead.lastDisposition = 'not_interested'
      lead.statusHistory.push({ status: 'NotInterested', by: officer._id, note: `chose ${m.comp}` })
      await lead.save()
    }
  }

  // Generate one competitive report so the dashboard has something to show.
  let compReport = null
  try {
    const { generateReport } = require('../services/competitiveAgent')
    compReport = await generateReport({ orgId: org._id, windowDays: 90, trigger: 'scheduled', generatedBy: admin._id })
  } catch (e) { console.warn('  (competitive report skipped:', e.message + ')') }

  // A student appointment too.
  await Appointment.create({ orgId: org._id, branchId: hyd._id, studentUserId: student._id,
    studentName: student.name, studentPhone: student.phone, studentEmail: student.email,
    scheduledFor: new Date(Date.now() + 3 * 86400000), status: 'booked', createdBy: student._id, createdByRole: 'student' })

  console.log('\nSeed complete:')
  console.log(`  Org: ${org.name}`)
  console.log(`  Branches: ${hq.name}, ${hyd.name}, ${maa.name}`)
  console.log(`  Leads imported: Hyderabad=${r1.counts.imported} (invalid ${r1.counts.invalid}), Chennai=${r2.counts.imported}`)
  console.log(`  Activity: Hyderabad ${aHyd.calls} calls / ${aHyd.appts} appts · Chennai ${aMaa.calls} calls / ${aMaa.appts} appts`)
  console.log(`  Competitors: ${comps.length} rivals · ${mentionCalls} calls with competitor mentions`)
  if (compReport) console.log(`  Competitive report: ${compReport.competitors.length} rivals ranked, top threat "${compReport.competitors[0]?.name}" (${compReport.competitors[0]?.threatScore})`)
  console.log('\nLogins (password: ' + PASSWORD + '):')
  console.log('  Main admin    → admin@aditya.edu')
  console.log('  Branch officer→ ravi@aditya.edu (Hyderabad) / meena@aditya.edu (Chennai)')
  console.log('  Student       → student@aditya.edu')

  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
