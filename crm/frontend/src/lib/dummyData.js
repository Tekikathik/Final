/**
 * Dummy data generator for AdmitAI.
 *
 * Produces a deterministic-ish (seedable) set of 1000 student call records
 * spread across multiple colleges, plus aggregated chart data and college
 * stats. The shape of every record matches the backend Mongo schemas
 * (see backend/models/Call.js and backend/models/Report.js) so the existing
 * dashboards, tables, and charts can consume the data without modification.
 */

// ---------- Source data pools (kept deliberately varied) -------------------

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna',
  'Ishaan', 'Rohan', 'Karthik', 'Rahul', 'Siddharth', 'Anirudh', 'Manav',
  'Aanya', 'Diya', 'Saanvi', 'Ananya', 'Pari', 'Kavya', 'Aadhya', 'Riya',
  'Ishita', 'Tanvi', 'Priya', 'Neha', 'Sneha', 'Pooja', 'Meera', 'Anjali',
  'Vikram', 'Rohit', 'Amit', 'Sanjay', 'Rajesh', 'Suresh', 'Akash', 'Nikhil',
  'Harsh', 'Dev', 'Yash', 'Kabir', 'Aryan', 'Veer', 'Shaurya',
  'Sara', 'Zara', 'Mira', 'Tara', 'Aisha', 'Mehul', 'Tanmay', 'Kunal',
  'Shreya', 'Sakshi', 'Bhavna', 'Lakshmi', 'Divya', 'Nisha', 'Pallavi',
]

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Kumar', 'Singh', 'Reddy', 'Iyer', 'Menon',
  'Khan', 'Joshi', 'Gupta', 'Mehta', 'Shah', 'Agarwal', 'Bansal', 'Chopra',
  'Kapoor', 'Rao', 'Pillai', 'Nair', 'Das', 'Banerjee', 'Mukherjee',
  'Chatterjee', 'Bose', 'Sen', 'Mishra', 'Pandey', 'Tiwari', 'Yadav',
  'Saxena', 'Bhat', 'Rana', 'Thakur', 'Malhotra', 'Sinha', 'Dutta',
]

// Cities skewed toward Aditya's catchment area in Andhra Pradesh / Telangana
// while still including major metros that send applicants nationally.
const CITIES = [
  'Visakhapatnam', 'Vijayawada', 'Kakinada', 'Rajahmundry', 'Guntur', 'Tirupati',
  'Nellore', 'Ongole', 'Anantapur', 'Kurnool', 'Eluru', 'Srikakulam', 'Vizianagaram',
  'Hyderabad', 'Warangal', 'Karimnagar', 'Khammam',
  'Chennai', 'Bangalore', 'Mumbai', 'Pune', 'Kolkata', 'Delhi', 'Bhubaneswar',
]

const EXAMS = [
  'JEE Mains 2026', 'JEE Advanced 2026', 'NEET 2026', 'CUET 2026',
  'BITSAT 2026', 'VITEEE 2026', 'COMEDK 2026', 'KCET 2026', 'MHT-CET 2026',
  'EAMCET 2026', 'GUJCET 2026',
]

const COURSES = [
  'B.Tech Computer Science', 'B.Tech AI & ML', 'B.Tech Data Science',
  'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil',
  'B.Tech Information Technology', 'B.Tech Biotechnology',
  'BBA', 'BBA Marketing', 'BBA Finance',
  'B.Sc Physics', 'B.Sc Chemistry', 'B.Sc Mathematics', 'B.Sc Computer Science',
  'B.Com', 'B.Com Honours',
  'MBBS', 'BDS', 'B.Pharm', 'BPT',
  'B.Arch', 'BA Economics', 'BA Psychology',
]

const STATUSES = ['completed', 'completed', 'completed', 'completed',
  'in_progress', 'failed', 'no_answer', 'scheduled']

const SENTIMENTS = ['positive', 'positive', 'neutral', 'negative']

// All colleges belong to "Aditya Educational Institutions". Aditya University
// is the flagship — it gets the largest share of records — and the rest are
// sister institutions in the Aditya group. Together they total ~1000 records
// so the dummy dataset matches what the backend seed produces.
const COLLEGES_SEED = [
  { id: 'col-aditya-univ',  name: 'Aditya University',            code: 'ADU',  location: 'Surampalem, Andhra Pradesh', weight: 0.50 },
  { id: 'col-aditya-eng',   name: 'Aditya Engineering College',   code: 'AEC',  location: 'Surampalem, Andhra Pradesh', weight: 0.20 },
  { id: 'col-aditya-eng2',  name: 'Aditya College of Engineering', code: 'ACE', location: 'Kakinada, Andhra Pradesh',   weight: 0.12 },
  { id: 'col-aditya-pharm', name: 'Aditya Pharmacy College',      code: 'APC',  location: 'Surampalem, Andhra Pradesh', weight: 0.09 },
  { id: 'col-aditya-mgmt',  name: 'Aditya School of Management',  code: 'ASM',  location: 'Kakinada, Andhra Pradesh',   weight: 0.09 },
]

// ---------- Tiny seeded RNG so charts and stats stay stable across reloads --

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

/** Pick an item from `arr` using each item's `weight` field as a probability. */
function weightedPick(arr) {
  const total = arr.reduce((s, x) => s + (x.weight || 1), 0)
  let r = rand() * total
  for (const item of arr) {
    r -= (item.weight || 1)
    if (r <= 0) return item
  }
  return arr[arr.length - 1]
}

/**
 * Each college in the Aditya group has its own course catalogue. Limiting the
 * pool per college makes the "Top Course Interests" charts meaningful (e.g.
 * Pharmacy College only shows pharmacy-related courses).
 */
const COURSES_BY_CODE = {
  ADU:  ['B.Tech Computer Science', 'B.Tech AI & ML', 'B.Tech Data Science', 'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Information Technology', 'B.Tech Biotechnology', 'BBA', 'B.Sc Computer Science', 'B.Com Honours', 'BA Economics'],
  AEC:  ['B.Tech Computer Science', 'B.Tech AI & ML', 'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Information Technology', 'M.Tech CSE', 'M.Tech VLSI'],
  ACE:  ['B.Tech Computer Science', 'B.Tech Electronics', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Information Technology', 'B.Tech AI & ML'],
  APC:  ['B.Pharm', 'M.Pharm Pharmaceutics', 'M.Pharm Pharmacology', 'Pharm.D', 'D.Pharm'],
  ASM:  ['MBA Marketing', 'MBA Finance', 'MBA HR', 'MBA Operations', 'MBA Business Analytics', 'PGDM'],
}

// ---------- Generators ------------------------------------------------------

function makePhone() {
  // Indian-style phone numbers, formatted for display
  const a = range(70, 99)
  const b = range(10000, 99999)
  const c = range(10000, 99999).toString().padStart(5, '0')
  return `+91 ${a}${String(b).slice(0, 3)} ${c}`.replace(/\s+/g, ' ')
}

function makeEmail(name) {
  const slug = name.toLowerCase().replace(/[^a-z]/g, '.')
  const tail = ['gmail.com', 'outlook.com', 'yahoo.com', 'rediffmail.com', 'student.edu.in']
  return `${slug}${range(10, 999)}@${pick(tail)}`
}

function dateNDaysAgo(n) {
  // Returns ISO string for "n" days ago at a random hour
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(range(8, 19), range(0, 59), range(0, 59), 0)
  return d.toISOString()
}

/**
 * Build the canonical list of dummy students (calls). One record per student.
 *
 * Returned shape matches what existing tables/charts expect:
 *   _id, id, collegeId, name, phone, email, status, duration, sentiment,
 *   interested, course, examAppeared, currentCity, tenthPercent, twelfthPercent,
 *   entranceScore, enrollmentProbability, createdAt
 */
export function generateStudents(count = 1000) {
  const out = []
  for (let i = 0; i < count; i++) {
    const first = pick(FIRST_NAMES)
    const last  = pick(LAST_NAMES)
    const name  = `${first} ${last}`
    // Weighted so Aditya University owns the largest slice of the dataset.
    const college = weightedPick(COLLEGES_SEED)
    const courseList = COURSES_BY_CODE[college.code] || COURSES
    const status = pick(STATUSES)
    const isCompleted = status === 'completed'

    // Sentiment / interest are only meaningful for completed calls
    const sentiment   = isCompleted ? pick(SENTIMENTS) : null
    const interested  = isCompleted ? sentiment === 'positive' || (sentiment === 'neutral' && rand() < 0.4) : null
    const duration    = isCompleted ? range(45, 420) : (status === 'in_progress' ? range(10, 60) : null)
    const probability = isCompleted ? (interested ? range(55, 95) : range(5, 40)) : range(0, 30)

    const tenth   = range(60, 99)
    const twelfth = range(55, 99)
    const created = dateNDaysAgo(range(0, 29))

    out.push({
      _id: `stu-${String(i + 1).padStart(4, '0')}`,
      id:  `stu-${String(i + 1).padStart(4, '0')}`,
      collegeId: college.id,
      collegeName: college.name,
      collegeCode: college.code,

      name,
      phone: makePhone(),
      email: makeEmail(`${first}.${last}`),

      status,
      duration,
      sentiment,
      interested,

      // Profile-style fields used by reports / dashboards
      examAppeared: pick(EXAMS),
      courseInterested: pick(courseList),
      course: pick(courseList),
      currentCity: pick(CITIES),
      tenthPercent: tenth,
      twelfthPercent: twelfth,
      entranceScore: `${pick(['JEE', 'NEET', 'CUET'])}: ${(rand() * 99 + 1).toFixed(1)} percentile`,

      enrollmentProbability: probability,
      createdAt: created,
      date: created,
    })
  }
  return out
}

/**
 * Build the colleges list with stats derived from the student dataset so
 * every visualization stays internally consistent (calls = students assigned).
 */
export function generateColleges(students) {
  return COLLEGES_SEED.map((c) => {
    const myStudents = students.filter((s) => s.collegeId === c.id)
    const calls = myStudents.length
    const completed = myStudents.filter((s) => s.status === 'completed').length
    const leads = myStudents.filter((s) => s.interested === true).length
    // "Enrolled" ≈ leads with high probability — gives a believable funnel
    const enrolled = myStudents.filter((s) => s.interested && s.enrollmentProbability >= 75).length

    return {
      _id: c.id,
      id:  c.id,
      name: c.name,
      code: c.code,
      location: c.location,
      calls,
      completed,
      leads,
      enrolled,
      isActive: true,
    }
  })
}

/**
 * Aggregate the student dataset into "calls / leads / enrolled" per day for
 * the trend charts. Returns the most recent `days` days, oldest → newest.
 */
export function generateChartData(students, days = 7) {
  const buckets = {}
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    buckets[key] = { day: key.slice(5), calls: 0, leads: 0, enrolled: 0 }
  }
  for (const s of students) {
    const key = (s.createdAt || '').slice(0, 10)
    if (!buckets[key]) continue
    buckets[key].calls += 1
    if (s.interested) buckets[key].leads += 1
    if (s.interested && s.enrollmentProbability >= 75) buckets[key].enrolled += 1
  }
  return Object.keys(buckets).sort().map((k) => buckets[k])
}

// ---------- Singleton dataset (cheap to compute once per session) ----------

let _students = null
let _colleges = null

/** The full 1000-student dummy dataset. Cached to keep IDs stable per session. */
export function getStudents() {
  if (!_students) _students = generateStudents(1000)
  return _students
}

/** Colleges list with stats wired into the student dataset. */
export function getColleges() {
  if (!_colleges) _colleges = generateColleges(getStudents())
  return _colleges
}

/** Chart data for "last N days" trend visualizations. */
export function getChartData(days = 7) {
  return generateChartData(getStudents(), days)
}

/** Convenience: students belonging to a given college, mapped to the call shape. */
export function getStudentsByCollege(collegeId) {
  return getStudents().filter((s) => s.collegeId === collegeId)
}
