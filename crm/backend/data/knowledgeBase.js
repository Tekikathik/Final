// ---------------------------------------------------------------------------
// Aditya University — Semantic Knowledge Base
// Source: Aditya_University_Extracted_Data.txt (official documents)
// Each entry becomes one vector in the semantic search store.
// ---------------------------------------------------------------------------

module.exports = [

  // ── UNIVERSITY ─────────────────────────────────────────────────────────

  {
    id: 'university_overview',
    text: `Aditya University is located at Aditya Nagar, ADB Road, Surampalem - 533437, Kakinada District, Andhra Pradesh, India. The campus spans 250 acres and is a smart campus. The university was established in 2024 as Aditya University, continuing the legacy of Aditya Engineering College which was founded in 2001. Contact numbers: +91 70360 76661, +91 70950 76663, +91 70950 76664, +91 70360 36664, +91 74167 39666, +91 99498 76662, +91 99897 76661. Website: www.adityauniversity.in. Students from 20 or more countries study here.`,
    metadata: { section: 'university' },
  },

  {
    id: 'university_rankings',
    text: `Aditya University holds NAAC A++ Grade — the highest accreditation awarded in India. It has QS I-Gauge Diamond Rating. NIRF 2025 Rank Band is 151 to 200 in the University category. Times Higher Education Impact Rankings: 1001 to 1500 Global Band, Top 50 in India. Ranked Number 1 in Quality Education (SDG 4) in Andhra Pradesh by THE Impact Rankings. Recognized as Best Business School for Entrepreneurship Development by Elets 2024. NBA Tier 1 Accreditation is held for its engineering departments. Aditya University is a member of AIMA (All India Management Association) and CII (Confederation of Indian Industry).`,
    metadata: { section: 'university' },
  },

  {
    id: 'university_collaborations',
    text: `Aditya University has international academic collaborations with University of Hull, SUNY (State University of New York), Upstate University of South Carolina, Georgia Institute of Technology, University of Salford Manchester, University of Bedfordshire, University of Wisconsin Madison, RWTH Aachen University, South University, HUTECH University of Technology, UEA University of East Anglia, and University of Memphis. The School of Business is the first business school in India to have collaborations with all four Big 4 firms: Deloitte, PwC, EY, and KPMG.`,
    metadata: { section: 'university' },
  },

  // ── COURSES ─────────────────────────────────────────────────────────────

  {
    id: 'courses_btech_core',
    text: `Aditya University offers the following B.Tech undergraduate programs, each requiring minimum 60 percent marks in 12th or Intermediate with PCM (Physics, Chemistry, Mathematics). Accepted entrance exams are ASAT (compulsory), JEE Main, EAPCET (AP and TS), BIE (AP and TS), and CBSE. Courses offered: B.Tech in Computer Science and Engineering (CSE), B.Tech in Artificial Intelligence and Machine Learning (AIML), B.Tech in CSE with Data Science, B.Tech in Electronics and Communication Engineering (ECE), B.Tech in Electrical and Electronics Engineering (EEE), B.Tech in Civil Engineering (CE), B.Tech in Mechanical Engineering (ME), B.Tech in Petroleum Technology, B.Tech in Agricultural Engineering, B.Tech in Mining Engineering.`,
    metadata: { section: 'courses', type: 'btech' },
  },

  {
    id: 'courses_btech_industry',
    text: `Aditya University offers B.Tech Industry Collaborated Programs in association with leading technology companies. These include: B.Tech CSE in association with SAP, B.Tech CSE in association with Google Cloud, B.Tech AIML in association with Microsoft, B.Tech AIML in association with Google Cloud, B.Tech CSE Data Science in association with Google Cloud. Features of these programs: industry-relevant and customized curriculum, classes and mentorship by industry experts, globally recognised certifications, internship and career opportunities, and exclusive curated learning resources. Eligibility: minimum 60 percent in 12th PCM. ASAT is compulsory.`,
    metadata: { section: 'courses', type: 'btech_industry' },
  },

  {
    id: 'courses_mtech',
    text: `Aditya University offers M.Tech postgraduate programs in the following specializations: Structural Engineering, Power Electronics and Drives, Energy Science and Technology, VLSI Design, CSE with AI and ML, Computer Science and Engineering, and Artificial Intelligence and Data Science. M.Tech programs are 2 years duration. Annual tuition fee is Rs. 75,000 per year for all M.Tech programs.`,
    metadata: { section: 'courses', type: 'mtech' },
  },

  {
    id: 'courses_bca_mca',
    text: `Aditya University offers BCA (Bachelor of Computer Applications) and MCA (Master of Computer Applications). BCA is an undergraduate program and ASAT is compulsory for admission. MCA is a postgraduate program. Annual tuition fee for both BCA and MCA is Rs. 1,00,000 per year.`,
    metadata: { section: 'courses', type: 'bca_mca' },
  },

  {
    id: 'courses_bba',
    text: `Aditya University School of Business offers BBA (Hons.) programs in association with the Big 4 firms. Minimum eligibility is 55 percent in 12th in any stream. ASAT is compulsory. Programs available: BBA in association with Deloitte (annual fee Rs. 1.40 L), BBA in Business Analytics powered by KPMG (annual fee Rs. 1.65 L), BBA in Global Finance powered by PwC (annual fee Rs. 1.65 L), BBA in FinTech powered by EY (annual fee Rs. 1.65 L), BBA in Health Care Management in association with Red Varsity (annual fee Rs. 1.65 L). Features include Harvard-style case study methodology, courses co-developed with corporates, Big 4 certifications, live projects, industry mentorship, and full-semester instruction by senior executives.`,
    metadata: { section: 'courses', type: 'bba' },
  },

  {
    id: 'courses_mba',
    text: `Aditya University School of Business offers MBA programs in association with the Big 4 firms. Accepted entrance exams: CAT, NMAT, CMAT, XMAT, MAT. Programs available: MBA in association with Deloitte (annual fee Rs. 1.65 L) with six major specializations (Finance, HRM, Marketing, Digital Marketing, Digital Transformation, Logistics and Supply Chain) and five minor tracks, MBA in Business Analytics powered by KPMG (annual fee Rs. 2.50 L), MBA in Global Finance powered by PwC (annual fee Rs. 2.50 L), MBA in FinTech powered by EY (annual fee Rs. 2.50 L), MBA in Health Care Management in association with Red Varsity (annual fee Rs. 2.50 L). Features include Advanced NSE Simulation Lab, Global CXO Masterclasses, live industry projects, innovation bootcamps, Harvard-style case-based method, and Big 4 certifications.`,
    metadata: { section: 'courses', type: 'mba' },
  },

  {
    id: 'courses_executive_mba',
    text: `Aditya University offers MBA for Working Professionals (Executive MBA) which is a 2-year program delivered 100 percent online with weekend classes on Saturday and Sunday. Annual fee is Rs. 1.75 L per year. It is offered in collaboration with SUNY (State University of New York) as a dual credential program: MBA from Aditya University plus Post Graduate Diploma in AI from SUNY. Specializations: Finance, Marketing, HR, Business Analytics, Logistics and Supply Chain. Minimum eligibility: bachelor degree minimum 3 years with at least 50 percent marks, and minimum 2 years full-time work experience. Self-paced modules available. Also available: Executive MBA Management Development Programme (MDP) as 1-day, 3-day, or 5-day intensive modules for corporates.`,
    metadata: { section: 'courses', type: 'executive_mba' },
  },

  {
    id: 'courses_pharmacy_science',
    text: `Aditya University School of Pharmacy offers B.Pharmacy (annual fee Rs. 1.80 L per year), Pharma D (annual fee Rs. 2.50 L per year), M.Pharmacy in Pharmaceutics (annual fee Rs. 75,000 per year), and M.Pharmacy in Pharmaceutical Analysis (annual fee Rs. 75,000 per year). Accepted entrance exams for pharmacy: ASAT, EAPCET (AP and TS), and NEET. School of Sciences offers B.Sc. in Forensic Science and B.Sc. in Cyber Security and Digital Forensics (annual fee Rs. 1.00 L per year each, minimum 55 percent in 12th). M.Sc. in Forensic Science, M.Sc. in Cyber Security and Digital Forensics, and M.Sc. in Real Estate Valuation are also offered (annual fee Rs. 75,000 per year each). Ph.D. programs are available in all disciplines.`,
    metadata: { section: 'courses', type: 'pharmacy_science' },
  },

  // ── FEES ────────────────────────────────────────────────────────────────

  {
    id: 'fees_btech_engineering',
    text: `Annual tuition fees for B.Tech programs at Aditya University for academic year 2026-27: B.Tech CSE (Computer Science and Engineering) is Rs. 2,75,000 per year. B.Tech AIML (Artificial Intelligence and Machine Learning) is Rs. 2,50,000 per year. B.Tech CSE Data Science is Rs. 2,00,000 per year. B.Tech ECE (Electronics and Communication Engineering) is Rs. 2,00,000 per year. B.Tech EEE (Electrical and Electronics Engineering) is Rs. 1,00,000 per year. B.Tech Civil Engineering is Rs. 1,00,000 per year. B.Tech Mechanical Engineering is Rs. 1,00,000 per year. B.Tech Petroleum Technology is Rs. 1,00,000 per year. B.Tech Agricultural Engineering is Rs. 1,00,000 per year. B.Tech Mining Engineering is Rs. 1,00,000 per year.`,
    metadata: { section: 'fees', type: 'btech' },
  },

  {
    id: 'fees_btech_industry',
    text: `Annual tuition fees for B.Tech Industry Collaborated Programs at Aditya University: B.Tech CSE in association with SAP is Rs. 2,75,000 plus Rs. 60,000 per year for the industry program. B.Tech CSE in association with Google Cloud is Rs. 2,75,000 plus Rs. 50,000 per year. B.Tech AIML in association with Microsoft is Rs. 2,50,000 plus Rs. 60,000 per year. B.Tech AIML in association with Google Cloud is Rs. 2,50,000 plus Rs. 50,000 per year. B.Tech CSE Data Science in association with Google Cloud is Rs. 2,00,000 plus Rs. 50,000 per year.`,
    metadata: { section: 'fees', type: 'btech_industry' },
  },

  {
    id: 'fees_hostel_common',
    text: `Hostel fees at Aditya University: Non-AC hostel accommodation is Rs. 1,15,000 per year which includes laundry expenses and free health insurance up to Rs. 2 lakhs. AC hostel accommodation is Rs. 1,30,000 per year with the same inclusions. Admission fee is Rs. 15,000 one time and non-refundable. ASAT registration fee is Rs. 500 per attempt with maximum 2 attempts allowed. Lateral entry admission fee is Rs. 15,000 non-refundable with annual tuition fee of Rs. 1,00,000 per year. Executive MBA admission fee plus registration plus welcome kit is Rs. 50,000 and total tuition fee is Rs. 6,00,000 with scholarship bringing it to Rs. 3,00,000 for national students.`,
    metadata: { section: 'fees', type: 'hostel_common' },
  },

  // ── SCHOLARSHIPS ────────────────────────────────────────────────────────

  {
    id: 'scholarships_asat',
    text: `ASAT (Aditya Scholastic Aptitude Test) scholarship slabs at Aditya University. For B.Tech CSE, AIML, Data Science, ECE: ASAT above 97 percent gives 75 percent scholarship, ASAT 95 to 96.9 percent gives 50 percent scholarship, ASAT 92 to 94.9 percent gives 25 percent scholarship, ASAT 90 to 91.9 percent gives 10 percent scholarship. For B.Tech Civil, EEE, Mechanical, Agricultural, Mining, Petroleum: ASAT above 95 percent gives 75 percent scholarship, ASAT 92 to 94.9 percent gives 50 percent scholarship, ASAT 90 to 91.9 percent gives 25 percent scholarship, ASAT 85 to 89.9 percent gives 10 percent scholarship. For B.Sc and BBA programs: ASAT above 95 percent gives 20 percent scholarship, ASAT 92 to 94.9 percent gives 15 percent scholarship, ASAT 90 to 91.9 percent gives 10 percent scholarship. For B.Pharmacy and Pharma D: ASAT above 97 percent gives 70 percent scholarship, ASAT 95 to 96.9 percent gives 50 percent scholarship, ASAT 92 to 94.9 percent gives 25 percent scholarship, ASAT 90 to 91.9 percent gives 10 percent scholarship.`,
    metadata: { section: 'scholarships', type: 'asat' },
  },

  {
    id: 'scholarships_jee',
    text: `JEE Main percentile-based scholarships at Aditya University. For B.Tech CSE, AIML, Data Science, ECE: JEE above 98 percentile gives 100 percent scholarship, JEE above 95 percentile gives 75 percent scholarship, JEE 90 to 94.9 percentile gives 50 percent scholarship, JEE 80 to 89.9 percentile gives 25 percent scholarship, JEE 70 to 79.9 percentile gives 10 percent scholarship. For B.Tech Civil, EEE, Mechanical, Agricultural, Mining, Petroleum: JEE above 95 percentile gives 100 percent scholarship, JEE above 90 percentile gives 75 percent scholarship, JEE 80 to 89.9 percentile gives 50 percent scholarship, JEE 70 to 79.9 percentile gives 25 percent scholarship, JEE 65 to 69.9 percentile gives 10 percent scholarship.`,
    metadata: { section: 'scholarships', type: 'jee' },
  },

  {
    id: 'scholarships_eamcet',
    text: `AP EAMCET and TS EAMCET (EAPCET) rank-based scholarships at Aditya University. For B.Tech CSE, AIML, Data Science, ECE: Rank 1 to 5000 gives 75 percent scholarship, Rank 5001 to 10000 gives 50 percent scholarship, Rank 10001 to 25000 gives 25 percent scholarship, Rank 25001 to 50000 gives 10 percent scholarship. For B.Tech Civil, EEE, Mechanical, Agricultural, Mining, Petroleum: Rank 1 to 10000 gives 75 percent scholarship, Rank 10001 to 25000 gives 50 percent scholarship, Rank 25001 to 50000 gives 25 percent scholarship, Rank 50001 to 75000 gives 10 percent scholarship. For B.Pharmacy and Pharma D via EAPCET: Rank 1 to 4000 gives 70 percent scholarship, Rank 4001 to 10000 gives 50 percent scholarship, Rank 10001 to 25000 gives 25 percent scholarship, Rank 25001 to 35000 gives 10 percent scholarship.`,
    metadata: { section: 'scholarships', type: 'eamcet' },
  },

  {
    id: 'scholarships_board_marks',
    text: `Board marks-based scholarships at Aditya University. BIE (AP and TS board) scholarships for B.Tech CSE, AIML, Data Science, ECE: above 98 percent gives 75 percent scholarship, 96 to 97.9 percent gives 50 percent, 94 to 95.9 percent gives 25 percent, 92 to 93.9 percent gives 10 percent. For Civil, EEE, Mechanical and other B.Tech: above 95 percent gives 75 percent, 93 to 94.9 percent gives 50 percent, 90 to 92.9 percent gives 25 percent, 85 to 89.9 percent gives 10 percent. For B.Sc and BBA: above 95 percent gives 20 percent, 85 to 94.9 percent gives 15 percent, 75 to 84.9 percent gives 10 percent. CBSE scholarships for B.Tech CSE, AIML, ECE: above 450 marks out of 500 gives 75 percent, 425 to 449 gives 50 percent, 400 to 424 gives 25 percent, 375 to 399 gives 10 percent. For other B.Tech branches: above 425 gives 75 percent, 400 to 425 gives 50 percent, 375 to 399 gives 25 percent, 350 to 374 gives 10 percent. For BBA: above 475 gives 20 percent, 425 to 474 gives 15 percent, 375 to 424 gives 10 percent. Note: English, Maths or Biology, Physics, and Chemistry must be included when calculating CBSE percentage.`,
    metadata: { section: 'scholarships', type: 'board' },
  },

  {
    id: 'scholarships_mba_neet_sports',
    text: `MBA scholarships based on entrance exam percentile at Aditya University. CAT: above 94 percentile gives 50 percent scholarship, 85 to 94 gives 25 percent, 70 to 84.9 gives 15 percent, 60 to 69.9 gives 10 percent. NMAT, CMAT, XMAT, MAT: above 94 percentile gives 25 percent scholarship, 85 to 94 gives 15 percent, 75 to 84.9 gives 10 percent. NEET scholarships for B.Pharmacy and Pharma D: Rank 1 to 10000 gives 70 percent scholarship, Rank 10001 to 15000 gives 50 percent, Rank 15001 to 25000 gives 25 percent, Rank 25001 to 35000 gives 10 percent. Sports scholarships: National level sports participation gives 75 percent tuition scholarship. International level sports participation gives 100 percent tuition scholarship. Verification is done by University sports committee.`,
    metadata: { section: 'scholarships', type: 'mba_neet_sports' },
  },

  {
    id: 'scholarships_lateral_renewal',
    text: `Lateral entry B.Tech scholarships via ECET 2026 at Aditya University (scholarship applicable for second year only): ECET Rank 1 to 25 gives 100 percent scholarship, Rank 26 to 50 gives 75 percent, Rank 51 to 100 gives 50 percent, Rank 101 to 150 gives 25 percent. For same diploma branch: Branch Rank in ECET is considered. For other branches: Integrated Rank is considered. Scholarship renewal: All merit scholarships are applicable for the first year only at the time of admission. To continue the scholarship for subsequent years, student must maintain CGPA of 8.0 or above with no backlogs in any semester.`,
    metadata: { section: 'scholarships', type: 'lateral_renewal' },
  },

  // ── FACILITIES ──────────────────────────────────────────────────────────

  {
    id: 'facilities_hostel',
    text: `Aditya University provides separate hostel facilities for boys and girls on the 250-acre campus. Both AC and Non-AC options are available. Room configuration is triple sharing with attached bathroom and balcony. Boys hostel has a gym facility with a professional trainer. Girls hostel has an in-house beauty parlour. Campus amenities include 24/7 CCTV surveillance and security, uninterrupted power supply, banking facility on campus, and laundry service included in hostel fee. Free health insurance up to Rs. 2 lakhs is included in the hostel fee. Apollo Dispensary functions 24/7 on campus. A 24/7 ambulance facility is available.`,
    metadata: { section: 'facilities', type: 'hostel' },
  },

  {
    id: 'facilities_labs_campus',
    text: `Aditya University campus facilities include AI-enabled smart classrooms, advanced research labs, and high-speed Wi-Fi across the entire campus. The Advanced NSE Stock Market Simulation Lab recreates real-time trading environments with simulated trading, portfolio management, and risk analysis with NSE-certified modules. EY-designed FinTech Labs are available for FinTech students. The campus has indoor sports arena. The university has 500 plus partner companies for placements. The Career Development Centre coordinates internship drives, pre-placement training, aptitude sessions, mock interviews, group discussions, and resume building workshops.`,
    metadata: { section: 'facilities', type: 'labs' },
  },

  {
    id: 'facilities_placements_2026',
    text: `Placement statistics at Aditya University for 2026: 3832 plus students placed (still counting). Highest domestic package: Rs. 27 Lakhs per Annum from Walmart with 6 selections. Other 2026 domestic packages: Philips Rs. 14.50 LPA (1 selection), Turing Rs. 12.53 LPA (1 selection), Lavendel Consulting Rs. 12 LPA (3 selections), Maersk Rs. 10.83 LPA (10 selections), Infosys 181 selections. International placements in 2026: C.I. Takiron Rs. 39.60 LPA (2 selections), TigerChiyoda Materials Rs. 27.79 LPA (1 selection), Shinsei Electronics Group Rs. 27.81 LPA (1 selection), Nagano Sankoh Rs. 26.31 LPA (1 selection). Internships 2026: Google Rs. 1.23 Lakh per month (1 selection), Amazon Rs. 1.10 Lakh per month (1 selection), Walmart Rs. 1 Lakh per month (16 selections), Maersk Rs. 50,000 per month (10 selections), Airbus, LG, Flipkart and many more.`,
    metadata: { section: 'facilities', type: 'placements' },
  },

  {
    id: 'facilities_placements_2025',
    text: `Placement statistics at Aditya University for 2025: 3455 plus students placed. Notable packages: Walmart Rs. 22.60 LPA (5 selections), UiPath Rs. 17 LPA (1 selection), Darwinbox Rs. 16.30 LPA (2 selections), Cisco Rs. 16 LPA (1 selection), Increff Rs. 13.44 LPA (1 selection), GE Vernova Rs. 13.20 LPA (1 selection). International placements 2025: Hitachi Rs. 35.36 LPA (2 selections), JHC Co. Ltd Rs. 34.95 LPA (1 selection), Toyota Rs. 34.12 LPA (1 selection), Aisan Rs. 33.51 LPA (1 selection), JEMS Rs. 32.84 LPA (1 selection), Daiseki Rs. 31.70 LPA (3 selections). Internship offers 2027: Visa Rs. 90,000 per month (2 selections), Flipkart Rs. 50,000 per month (1 selection), Airbus Rs. 30,000 per month (4 selections).`,
    metadata: { section: 'facilities', type: 'placements_2025' },
  },

]
