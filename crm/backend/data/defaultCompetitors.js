// ---------------------------------------------------------------------------
// Monitored competitor roster for Aditya University, from
// aditya-university-ci-agent-prompt.md. Seed via POST /api/competitive/competitors/seed-defaults.
//
// Tiers: 1 = direct local rival (same catchment, same rank band)
//        2 = government benchmark (monitor cutoffs/seat matrix, not marketing)
//        3 = regional private university pulling students out of the catchment
//
// Entries marked "verify" in brandNotes should be confirmed with the official
// pages / admissions team before relying on them — they know who they actually
// lose students to. Websites left blank were not specified in the prompt.
// ---------------------------------------------------------------------------
module.exports = [
  // ── Tier 1 — direct local rivals ────────────────────────────────────────────
  { name: 'Pragati Engineering College', tier: 1, aliases: ['Pragati', 'PEC Surampalem'],
    location: 'Surampalem, AP', website: 'https://www.pragati.ac.in',
    profile: { brandNotes: 'Immediate neighbor — the most direct competitor.' } },
  { name: 'Godavari Global University', tier: 1, aliases: ['GIET', 'GIET University', 'Godavari Global'],
    location: 'Rajahmundry, AP', website: 'https://www.giet.ac.in',
    profile: { brandNotes: 'VERIFY current name and URL — GIET has university status.' } },
  { name: 'Kakinada Institute of Engineering & Technology', tier: 1, aliases: ['KIET', 'KIET Korangi', 'KIET Group'],
    location: 'Korangi, Kakinada, AP', website: 'https://www.kietgroup.com',
    profile: { brandNotes: '' } },
  { name: 'Ideal Institute of Technology', tier: 1, aliases: ['Ideal Tech', 'IIT Kakinada (Ideal)'],
    location: 'Kakinada, AP', website: '',
    profile: { brandNotes: '' } },
  { name: 'BVC Engineering College', tier: 1, aliases: ['BVC', 'BVC Odalarevu'],
    location: 'Odalarevu, AP', website: '',
    profile: { brandNotes: 'CONFIRM with admissions team whether we actually lose students here.' } },

  // ── Tier 2 — government benchmark ───────────────────────────────────────────
  { name: 'JNTUK University College of Engineering', tier: 2, aliases: ['JNTUK', 'JNTU Kakinada', 'UCEK'],
    location: 'Kakinada, AP', website: 'https://www.jntucek.ac.in',
    profile: { brandNotes: 'Students with top ranks default here — monitor cutoffs and seat matrix, not marketing.' } },

  // ── Tier 3 — regional private universities ──────────────────────────────────
  { name: 'Vishnu Institute of Technology', tier: 3, aliases: ['Vishnu', 'VIT Bhimavaram'],
    location: 'Bhimavaram, AP', website: 'https://www.vishnu.edu.in',
    profile: { brandNotes: '' } },
  { name: 'SRKR Engineering College', tier: 3, aliases: ['SRKR', 'SRKREC'],
    location: 'Bhimavaram, AP', website: 'https://srkrec.edu.in',
    profile: { brandNotes: '' } },
  { name: 'GITAM', tier: 3, aliases: ['GITAM University', 'Gandhi Institute', 'Gitam Vizag'],
    location: 'Visakhapatnam, AP', website: 'https://www.gitam.edu',
    profile: { brandNotes: 'Deemed university; legacy pull in north-coastal AP.' } },
  { name: 'KL University', tier: 3, aliases: ['KLU', 'KLEF', 'Koneru Lakshmaiah', 'KL Univ'],
    location: 'Vaddeswaram, Guntur, AP', website: 'https://www.kluniversity.in',
    profile: { brandNotes: 'Advertises heavily in coastal AP during counselling season.' } },
  { name: 'Vignan University', tier: 3, aliases: ['Vignan', "Vignan's University", 'Vignan Guntur'],
    location: 'Guntur, AP', website: 'https://vignan.ac.in',
    profile: { brandNotes: '' } },
  { name: 'VIT-AP', tier: 3, aliases: ['VIT AP', 'VIT Amaravati', 'Vellore Institute'],
    location: 'Amaravati, AP', website: 'https://vitap.ac.in',
    profile: { brandNotes: '' } },
  { name: 'SRM University AP', tier: 3, aliases: ['SRM AP', 'SRM Amaravati'],
    location: 'Amaravati, AP', website: 'https://srmap.edu.in',
    profile: { brandNotes: '' } },
  { name: 'Centurion University', tier: 3, aliases: ['CUTM', 'Centurion Vizianagaram'],
    location: 'Vizianagaram, AP', website: 'https://cutmap.ac.in',
    profile: { brandNotes: 'VERIFY AP-campus URL.' } },
]
