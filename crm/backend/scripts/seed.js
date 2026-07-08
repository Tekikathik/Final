/**
 * Seeds MongoDB with the Aditya Educational Institutions dataset.
 *
 * Wipes the existing database and creates:
 *   - 1 organisation: Aditya Educational Institutions
 *   - 5 colleges (Aditya University is the flagship)
 *   - 1 admin user: admin@aditya.edu.in / admin123
 *   - ~1000 call records distributed by college weight
 *   - Reports for every "completed" call
 *
 * Run from the backend directory: `node scripts/seed.js`
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose = require('mongoose')

const TARGET_TOTAL = 1000

// ---------- Source pools -----------------------------------------------------

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna',
  'Ishaan', 'Rohan', 'Karthik', 'Rahul', 'Siddharth', 'Anirudh', 'Manav',
  'Aanya', 'Diya', 'Saanvi', 'Ananya', 'Pari', 'Kavya', 'Aadhya', 'Riya',
  'Ishita', 'Tanvi', 'Priya', 'Neha', 'Sneha', 'Pooja', 'Meera', 'Anjali',
  'Vikram', 'Rohit', 'Amit', 'Sanjay', 'Rajesh', 'Suresh', 'Akash', 'Nikhil',
  'Harsh', 'Dev', 'Yash', 'Kabir', 'Aryan', 'Veer', 'Shaurya',
  'Sara', 'Zara', 'Mira', 'Tara', 'Aisha', 'Mehul', 'Tanmay', 'Kunal',
  'Shreya', 'Sakshi', 'Bhavna', 'Lakshmi', 'Divya', 'Nisha', 'Pallavi',
  'Naveen', 'Kiran', 'Bharath', 'Chandrika', 'Ramya', 'Swathi', 'Hema',
  'Pavan', 'Srinivas', 'Sandeep', 'Sridhar', 'Madhavi', 'Uma',
]

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Kumar', 'Singh', 'Reddy', 'Iyer', 'Menon',
  'Khan', 'Joshi', 'Gupta', 'Mehta', 'Shah', 'Agarwal', 'Bansal', 'Chopra',
  'Kapoor', 'Rao', 'Pillai', 'Nair', 'Das', 'Banerjee', 'Mukherjee',
  'Chatterjee', 'Bose', 'Sen', 'Mishra', 'Pandey', 'Tiwari', 'Yadav',
  'Saxena', 'Bhat', 'Rana', 'Thakur', 'Malhotra', 'Sinha', 'Dutta',
  'Naidu', 'Chowdary', 'Varma', 'Prasad', 'Sastry', 'Murthy', 'Bhaskar',
  'Sundaram', 'Krishnan', 'Subramanian',
]

const CITIES = [
  'Visakhapatnam', 'Vijayawada', 'Kakinada', 'Rajahmundry', 'Guntur', 'Tirupati',
  'Nellore', 'Ongole', 'Anantapur', 'Kurnool', 'Eluru', 'Srikakulam', 'Vizianagaram',
  'Hyderabad', 'Warangal', 'Karimnagar', 'Khammam',
  'Chennai', 'Bangalore', 'Mumbai', 'Pune', 'Kolkata', 'Delhi', 'Bhubaneswar',
]

const EXAMS = [
  'JEE Mains 2026', 'JEE Advanced 2026', 'NEET 2026', 'CUET 2026',
  'BITSAT 2026', 'VITEEE 2026', 'COMEDK 2026', 'KCET 2026',
  'EAMCET 2026', 'AP EAPCET 2026', 'TS EAMCET 2026', 'GPAT 2026', 'CMAT 2026',
]

const COLLEGES_DATA = [
  {
    code: 'ADU',
    name: 'Aditya University',
    location: 'Surampalem, Andhra Pradesh',
    weight: 0.50,
    courses: ['B.Tech Computer Science', 'B.Tech AI & ML', 'B.Tech Data Science', 'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Information Technology', 'B.Tech Biotechnology', 'BBA', 'B.Sc Computer Science', 'B.Com Honours', 'BA Economics'],
  },
  {
    code: 'AEC',
    name: 'Aditya Engineering College',
    location: 'Surampalem, Andhra Pradesh',
    weight: 0.20,
    courses: ['B.Tech Computer Science', 'B.Tech AI & ML', 'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Information Technology', 'M.Tech CSE', 'M.Tech VLSI'],
  },
  {
    code: 'ACE',
    name: 'Aditya College of Engineering',
    location: 'Kakinada, Andhra Pradesh',
    weight: 0.12,
    courses: ['B.Tech Computer Science', 'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Information Technology', 'B.Tech AI & ML'],
  },
  {
    code: 'APC',
    name: 'Aditya Pharmacy College',
    location: 'Surampalem, Andhra Pradesh',
    weight: 0.09,
    courses: ['B.Pharm', 'M.Pharm Pharmaceutics', 'M.Pharm Pharmacology', 'Pharm.D', 'D.Pharm'],
  },
  {
    code: 'ASM',
    name: 'Aditya School of Management',
    location: 'Kakinada, Andhra Pradesh',
    weight: 0.09,
    courses: ['MBA Marketing', 'MBA Finance', 'MBA HR', 'MBA Operations', 'MBA Business Analytics', 'PGDM'],
  },
]

const STATUSES = ['completed', 'completed', 'completed', 'completed',
  'in_progress', 'failed', 'no_answer', 'scheduled']

const SENTIMENTS = ['positive', 'positive', 'neutral', 'negative']

// ---------- Seeded RNG so re-runs produce identical-looking dataset ----------

function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t = (t + 0x6D2B79F5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260506)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const range = (min, max) => Math.floor(rand() * (max - min + 1)) + min

function weightedPick(arr) {
  const total = arr.reduce((s, x) => s + (x.weight || 1), 0)
  let r = rand() * total
  for (const item of arr) {
    r -= (item.weight || 1)
    if (r <= 0) return item
  }
  return arr[arr.length - 1]
}

function makePhone() {
  const a = range(70, 99)
  const b = range(100, 999)
  const c = String(range(10000, 99999)).padStart(5, '0')
  return `+91 ${a}${b} ${c}`
}

function makeEmail(first, last) {
  const slug = `${first}.${last}`.toLowerCase()
  const tail = ['gmail.com', 'outlook.com', 'yahoo.com', 'student.aditya.edu.in']
  return `${slug}${range(10, 999)}@${pick(tail)}`
}

function dateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(range(8, 19), range(0, 59), range(0, 59), 0)
  return d
}

// ---------- Transcript / report builders ------------------------------------

function buildTranscript({ name, course, sentiment, interested, college }) {
  const t = []
  let ts = 0
  const push = (speaker, text, gap) => { t.push({ speaker, text, timestamp: ts }); ts += gap }

  push('ai', `Hello, am I speaking with ${name}?`, range(3, 5))
  push('student', interested === false ? "Yes, who's calling?" : "Yes, speaking.", range(3, 6))
  push('ai', `Hi ${name.split(' ')[0]}! I'm calling from ${college.name} Admissions about your enquiry for ${course}. Is now a good time?`, range(6, 9))

  if (interested === false) {
    push('student', "Actually I've already taken admission elsewhere. Sorry.", range(4, 7))
    push('ai', "No problem, thanks for letting us know. We'll keep your details for future programmes.", range(4, 6))
    return t
  }

  push('student', sentiment === 'positive' ? "Sure, please go ahead." : "Okay, briefly.", range(3, 5))
  push('ai', `Great. Based on your profile you may qualify for our merit scholarship covering up to 40% tuition. Our placement rate last year was 92% with average package of ₹6.8 LPA.`, range(8, 11))

  if (sentiment === 'positive') {
    push('student', "That sounds excellent. What about the fee structure and hostel?", range(5, 8))
    push('ai', `Annual tuition for ${course} is around ₹1.6L; with the scholarship it drops to about ₹96k. Hostel is ₹75k a year — fully AC blocks available.`, range(8, 11))
    push('student', "Definitely interested. Can you send me the brochure and arrange a campus visit?", range(5, 8))
    push('ai', "Absolutely — I'll email the brochure right away and our counsellor will call to schedule the visit. Thank you!", range(6, 9))
  } else if (sentiment === 'neutral') {
    push('student', "Hmm, I need to compare with other colleges.", range(4, 7))
    push('ai', "Of course. I'll send our comparison brochure. Would you like a counsellor follow-up next week?", range(6, 8))
    push('student', "Sure, that works.", range(3, 5))
  } else {
    push('student', "The fees seem too high for me honestly.", range(4, 6))
    push('ai', "I understand. We have several need-based options too — let me email the details so you can review.", range(6, 9))
  }
  return t
}

function summaryFor({ name, course, sentiment, interested, college }) {
  const first = name.split(' ')[0]
  if (interested === false) {
    return `${first} has already secured admission elsewhere and is not pursuing ${college.name}. Mark for future programme outreach.`
  }
  if (sentiment === 'positive') {
    return `${first} showed strong interest in ${course} at ${college.name}. Engaged on fees, scholarship, placement and hostel. High conversion probability — recommend immediate campus visit and counsellor follow-up.`
  }
  if (sentiment === 'neutral') {
    return `${first} is comparing ${college.name} with other colleges for ${course}. Moderate interest. Send comparison brochure and schedule a follow-up call in 7 days.`
  }
  return `${first} raised affordability concerns about ${course} at ${college.name}. Sentiment was negative on fees. Suggest scholarship or fee-waiver options before re-engaging.`
}

function detectTopicScore(text, keywords) {
  let count = 0
  keywords.forEach(kw => { if (text.includes(kw)) count++ })
  return Math.min(100, Math.round((count / keywords.length) * 100))
}

function topicAnalysisOf(transcript) {
  const text = transcript.map(t => t.text).join(' ').toLowerCase()
  return {
    fees:             detectTopicScore(text, ['fee', 'tuition', 'cost', 'price', 'charges']),
    scholarship:      detectTopicScore(text, ['scholarship', 'merit', 'waiver', 'discount']),
    placement:        detectTopicScore(text, ['placement', 'package', 'recruit', 'company', 'lpa']),
    hostel:           detectTopicScore(text, ['hostel', 'accommodation', 'ac block', 'room']),
    courseDetails:    detectTopicScore(text, ['course', 'curriculum', 'syllabus', 'specialisation', 'btech', 'mba', 'pharm']),
    admissionProcess: detectTopicScore(text, ['admission', 'apply', 'process', 'document', 'deadline', 'brochure']),
  }
}

function sentimentTimelineOf(transcript) {
  const out = []
  let ts = 0
  for (const turn of transcript) {
    ts = turn.timestamp
    const text = turn.text.toLowerCase()
    let score = 0
    ;['great', 'interested', 'yes', 'definitely', 'sure', 'good', 'excellent', 'thank', 'scholarship', 'excited'].forEach(w => { if (text.includes(w)) score += 0.25 })
    ;['no', "don't", 'not', 'expensive', 'high', 'busy', 'later', 'sorry', 'concern'].forEach(w => { if (text.includes(w)) score -= 0.25 })
    score = Math.max(-1, Math.min(1, score))
    out.push({ timestamp: ts, label: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral', score: parseFloat(score.toFixed(2)) })
  }
  return out
}

function followUpsOf({ interested, sentiment, topicAnalysis }) {
  const recs = []
  if (interested === true) {
    recs.push('Schedule campus visit within 48 hours')
    recs.push('Assign senior admission counsellor for direct call')
  }
  if (topicAnalysis.fees > 50) recs.push('Share detailed fee structure and EMI options')
  if (topicAnalysis.scholarship > 40) recs.push('Send scholarship eligibility form')
  if (topicAnalysis.placement > 50) recs.push('Share latest placement brochure with company list')
  if (topicAnalysis.hostel > 30) recs.push('Email hostel photos and amenities')
  if (sentiment === 'negative') recs.push('Escalate to senior counsellor for affordability discussion')
  if (interested === false) recs.push('Mark for re-contact after 30 days for upcoming programmes')
  if (recs.length === 0) recs.push('Standard follow-up in 7 days')
  return recs
}

function probabilityOf({ interested, sentiment, duration, topicAnalysis }) {
  if (interested === false) return range(5, 18)
  let s = 30
  if (interested === true) s += 30
  if (sentiment === 'positive') s += 20
  else if (sentiment === 'neutral') s += 10
  if (duration > 120) s += 10
  if (duration > 300) s += 5
  s += Math.round((Object.values(topicAnalysis).reduce((a, b) => a + b, 0) / 6) * 0.15)
  return Math.min(97, Math.max(5, s))
}

// ---------- Main seeding -----------------------------------------------------

async function seed() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to MongoDB:', process.env.MONGO_URI)

  const Organization = require('../models/Organization')
  const User         = require('../models/User')
  const College      = require('../models/College')
  const Call         = require('../models/Call')
  const Report       = require('../models/Report')

  console.log('Wiping existing data…')
  await Promise.all([
    Organization.deleteMany({}),
    User.deleteMany({}),
    College.deleteMany({}),
    Call.deleteMany({}),
    Report.deleteMany({}),
  ])

  console.log('Creating organisation: Aditya Educational Institutions')
  const org = await Organization.create({
    name: 'Aditya Educational Institutions',
    type: 'University',
    location: 'Surampalem, Andhra Pradesh',
    website: 'https://aditya.edu.in',
    description: 'Multi-campus educational group operating Aditya University and sister institutions across Andhra Pradesh.',
    plan: 'enterprise',
  })

  console.log('Creating admin user: admin@aditya.edu.in / admin123')
  await User.create({
    orgId: org._id,
    name: 'Aditya Admin',
    email: 'admin@aditya.edu.in',
    passwordHash: 'admin123',          // pre-save hook hashes
    phone: '+91 98765 43210',
    role: 'admin',
  })

  console.log(`Creating ${COLLEGES_DATA.length} colleges`)
  const colleges = await College.insertMany(COLLEGES_DATA.map(c => ({
    orgId: org._id,
    name: c.name,
    code: c.code,
    location: c.location,
    courses: c.courses.slice(0, 4).map(cn => ({ name: cn, fee: range(80000, 220000), seats: range(60, 240), duration: cn.startsWith('M') ? '2 years' : '4 years' })),
  })))
  const codeToCollege = Object.fromEntries(colleges.map(c => [c.code, c]))

  console.log(`Generating ${TARGET_TOTAL} calls…`)
  const callDocs = []
  for (let i = 0; i < TARGET_TOTAL; i++) {
    const meta = weightedPick(COLLEGES_DATA)
    const college = codeToCollege[meta.code]
    const first = pick(FIRST_NAMES)
    const last  = pick(LAST_NAMES)
    const name  = `${first} ${last}`
    const status = pick(STATUSES)
    const isCompleted = status === 'completed'
    const sentiment  = isCompleted ? pick(SENTIMENTS) : null
    const interested = isCompleted ? (sentiment === 'positive' || (sentiment === 'neutral' && rand() < 0.4)) : null
    const duration   = isCompleted ? range(45, 420) : (status === 'in_progress' ? range(10, 60) : null)
    const startedAt  = dateNDaysAgo(range(0, 29))
    const endedAt    = duration ? new Date(startedAt.getTime() + duration * 1000) : null
    const course = pick(meta.courses)

    callDocs.push({
      collegeId: college._id,
      orgId: org._id,
      campaignId: `campaign-${meta.code.toLowerCase()}-${Math.floor(i / 50)}`,
      phone: makePhone(),
      name,
      status,
      duration,
      sentiment,
      interested,
      scheduledAt: startedAt,
      startedAt,
      endedAt,
      // Carry these through so the report builder doesn't have to re-roll them
      _course: course,
      _first: first,
      _last: last,
      _meta: meta,
    })
  }

  // Strip helper fields before inserting; keep them on a parallel array
  const helperByIndex = callDocs.map(c => ({
    course: c._course, first: c._first, last: c._last, meta: c._meta,
  }))
  callDocs.forEach(c => { delete c._course; delete c._first; delete c._last; delete c._meta })

  const insertedCalls = await Call.insertMany(callDocs)
  console.log(`Inserted ${insertedCalls.length} calls`)

  console.log('Generating reports for completed calls…')
  const reportDocs = []
  for (let i = 0; i < insertedCalls.length; i++) {
    const call = insertedCalls[i]
    if (call.status !== 'completed') continue
    const helper = helperByIndex[i]
    const transcript = buildTranscript({
      name: call.name,
      course: helper.course,
      sentiment: call.sentiment,
      interested: call.interested,
      college: helper.meta,
    })
    const topicAnalysis = topicAnalysisOf(transcript)
    const enrollmentProbability = probabilityOf({
      interested: call.interested,
      sentiment: call.sentiment,
      duration: call.duration || 0,
      topicAnalysis,
    })

    reportDocs.push({
      callId: call._id,
      collegeId: call.collegeId,
      orgId: call.orgId,
      profile: {
        name: call.name,
        phone: call.phone,
        email: makeEmail(helper.first, helper.last),
        examAppeared: pick(EXAMS),
        courseInterested: helper.course,
        currentCity: pick(CITIES),
        tenthPercent: range(60, 99),
        twelfthPercent: range(55, 99),
        entranceScore: `${pick(['JEE', 'EAMCET', 'NEET'])}: ${(rand() * 99 + 1).toFixed(1)} percentile`,
      },
      summary: summaryFor({
        name: call.name, course: helper.course, sentiment: call.sentiment,
        interested: call.interested, college: helper.meta,
      }),
      enrollmentProbability,
      topicAnalysis,
      sentimentTimeline: sentimentTimelineOf(transcript),
      followUpRecommendations: followUpsOf({ interested: call.interested, sentiment: call.sentiment, topicAnalysis }),
      transcript,
    })
  }

  // Insert in chunks so we don't hit BSON size limits on a 700+ doc payload
  const CHUNK = 200
  for (let i = 0; i < reportDocs.length; i += CHUNK) {
    await Report.insertMany(reportDocs.slice(i, i + CHUNK))
  }
  console.log(`Inserted ${reportDocs.length} reports`)

  // ---------- Summary ----------
  const breakdown = {}
  insertedCalls.forEach(c => {
    const code = colleges.find(col => String(col._id) === String(c.collegeId)).code
    breakdown[code] = (breakdown[code] || 0) + 1
  })
  console.log('\n✅ Seed complete')
  console.log(`   Org:      ${org.name}`)
  console.log(`   Admin:    admin@aditya.edu.in / admin123`)
  console.log(`   Colleges: ${colleges.length}`)
  for (const c of colleges) {
    console.log(`     - ${c.name.padEnd(40)} ${String(breakdown[c.code] || 0).padStart(4)} calls`)
  }
  console.log(`   Calls:    ${insertedCalls.length}`)
  console.log(`   Reports:  ${reportDocs.length}\n`)

  await mongoose.disconnect()
}

seed().catch(err => { console.error(err); process.exit(1) })
