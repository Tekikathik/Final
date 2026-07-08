"""
Aditya University — structured admissions knowledge, backing Priya's lookup tools.

This is the "small local data file" approach: all the courses, fees, eligibility,
entrance exams, scholarship slabs, placements and facilities live here as plain Python
data, with a few helper functions for exact lookups (fuzzy course matching + scholarship
computation). No vector DB / RAG needed — exact lookups are faster and more accurate.

Source: Aditya_University_Extracted_Data.txt. "None" = NOT MENTIONED in the source; tools
return a "counsellor will follow up" message for those so Priya never invents a value.
"""

# ── University facts ─────────────────────────────────────────────────────────
UNIVERSITY = {
    "name": "Aditya University",
    "location": "Aditya Nagar, ADB Road, Surampalem - 533437, Kakinada District, Andhra Pradesh",
    "established": "2024 as Aditya University (legacy since 2001 as Aditya Engineering College)",
    "campus": "250-acre smart campus",
    "naac": "A++ Grade",
    "nba": "NBA Tier 1 Accredited",
    "nirf": "NIRF 2025 Rank Band 151-200 (University category)",
    "qs": "QS I-Gauge Diamond Rating",
    "the_impact": "Times Higher Education Impact: 1001-1500 global band, Top 50 in India; "
                  "Ranked #1 in Quality Education (SDG 4) in Andhra Pradesh",
    "memberships": "AIMA (All India Management Association), CII (Confederation of Indian Industry)",
    "international": "Collaborations with University of Hull, SUNY, Georgia Institute of Technology, "
                     "RWTH Aachen, University of Wisconsin Madison, University of East Anglia and more; "
                     "students from 20+ countries",
    "website": "www.adityauniversity.in",
    "contacts": "+91 70360 76661, +91 99498 76662, +91 99897 76661",
}

# ── Courses ──────────────────────────────────────────────────────────────────
# sch = scholarship category key (see SCHOLARSHIP_SLABS). fee_note = extra add-on.
# keywords = used for fuzzy matching of what a caller says to the right program.
COURSES = [
    # ---- B.Tech (School of Engineering) ----
    {"name": "B.Tech - Computer Science & Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.75 lakh per year", "sch": "btech_tier1", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["cse", "computer science", "computer science and engineering", "cs"]},
    {"name": "B.Tech - Artificial Intelligence & Machine Learning", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.50 lakh per year", "sch": "btech_tier1", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["aiml", "ai ml", "ai&ml", "artificial intelligence", "machine learning", "ai and ml"]},
    {"name": "B.Tech - CSE (Data Science)", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.00 lakh per year", "sch": "btech_tier1", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["data science", "cse data science", "ds", "datascience"]},
    {"name": "B.Tech - Electronics & Communication Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.00 lakh per year", "sch": "btech_tier1", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["ece", "electronics", "electronics and communication", "communication engineering"]},
    {"name": "B.Tech - Electrical & Electronics Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "sch": "btech_tier2", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["eee", "electrical", "electrical and electronics"]},
    {"name": "B.Tech - Civil Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "sch": "btech_tier2", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["civil", "civil engineering"]},
    {"name": "B.Tech - Mechanical Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "sch": "btech_tier2", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["mechanical", "mech", "mechanical engineering"]},
    {"name": "B.Tech - Petroleum Technology", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "sch": "btech_tier2", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["petroleum", "petroleum technology"]},
    {"name": "B.Tech - Agricultural Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "sch": "btech_tier2", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["agricultural", "agriculture", "agricultural engineering", "agri"]},
    {"name": "B.Tech - Mining Engineering", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "sch": "btech_tier2", "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "keywords": ["mining", "mining engineering"]},
    # ---- B.Tech industry-collaborated ----
    {"name": "B.Tech - CSE in association with SAP", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.75 lakh + ₹0.60 lakh per year", "sch": "btech_tier1", "industry": "SAP",
     "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "special": "Industry-customized curriculum, mentorship by SAP experts, globally renowned "
                "certifications, internships and career opportunities",
     "keywords": ["sap", "cse sap", "cse with sap"]},
    {"name": "B.Tech - CSE in association with Google Cloud", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.75 lakh + ₹0.50 lakh per year", "sch": "btech_tier1", "industry": "Google Cloud",
     "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "special": "Industry-customized curriculum, mentorship by industry experts, globally renowned certifications",
     "keywords": ["cse google", "cse google cloud", "google cloud cse"]},
    {"name": "B.Tech - AIML in association with Microsoft", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.50 lakh + ₹0.60 lakh per year", "sch": "btech_tier1", "industry": "Microsoft",
     "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "special": "Industry-customized curriculum, mentorship by industry experts, globally renowned certifications",
     "keywords": ["aiml microsoft", "ai microsoft", "microsoft"]},
    {"name": "B.Tech - AIML in association with Google Cloud", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.50 lakh + ₹0.50 lakh per year", "sch": "btech_tier1", "industry": "Google Cloud",
     "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "special": "Industry-customized curriculum, mentorship by industry experts, globally renowned certifications",
     "keywords": ["aiml google", "ai google cloud"]},
    {"name": "B.Tech - CSE (Data Science) in association with Google Cloud", "degree": "B.Tech", "school": "Engineering",
     "fee": "₹2.00 lakh + ₹0.50 lakh per year", "sch": "btech_tier1", "industry": "Google Cloud",
     "elig": "Minimum 60% in 12th or equivalent",
     "exams": "ASAT (compulsory), JEE, EAPCET (AP & TS), BIE (AP & TS), CBSE",
     "special": "Industry-customized curriculum, mentorship by industry experts, globally renowned certifications",
     "keywords": ["data science google", "ds google cloud"]},
    # ---- M.Tech ----
    {"name": "M.Tech - Structural Engineering", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["structural", "mtech structural"]},
    {"name": "M.Tech - Power Electronics & Drives", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["power electronics", "drives"]},
    {"name": "M.Tech - Energy Science & Technology", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["energy science", "energy technology"]},
    {"name": "M.Tech - VLSI Design", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["vlsi", "vlsi design"]},
    {"name": "M.Tech - CSE (AI&ML)", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["mtech aiml", "mtech ai ml", "mtech cse aiml"]},
    {"name": "M.Tech - Computer Science & Engineering", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["mtech cse", "mtech computer science"]},
    {"name": "M.Tech - Artificial Intelligence & Data Science", "degree": "M.Tech", "school": "Engineering",
     "fee": "₹0.75 lakh per year", "keywords": ["mtech ai data science", "ai and data science"]},
    # ---- Computer Applications ----
    {"name": "BCA - Bachelor of Computer Applications", "degree": "BCA", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "exams": "ASAT (compulsory for UG programs)",
     "keywords": ["bca", "bachelor of computer applications"]},
    {"name": "MCA - Master of Computer Applications", "degree": "MCA", "school": "Engineering",
     "fee": "₹1.00 lakh per year", "keywords": ["mca", "master of computer applications"]},
    # ---- Pharmacy ----
    {"name": "B.Pharmacy", "degree": "B.Pharmacy", "school": "Pharmacy",
     "fee": "₹1.80 lakh per year", "sch": "pharmacy", "exams": "ASAT, EAPCET (AP & TS), NEET",
     "keywords": ["b pharmacy", "bpharmacy", "b.pharm", "bpharm", "pharmacy degree"]},
    {"name": "Pharma D", "degree": "Pharm. D", "school": "Pharmacy",
     "fee": "₹2.50 lakh per year", "sch": "pharmacy", "exams": "ASAT, EAPCET (AP & TS), NEET",
     "keywords": ["pharma d", "pharmd", "pharm d", "doctor of pharmacy"]},
    {"name": "M.Pharmacy (Pharmaceutics)", "degree": "M.Pharmacy", "school": "Pharmacy",
     "fee": "₹0.75 lakh per year", "keywords": ["m pharmacy pharmaceutics", "mpharm pharmaceutics"]},
    {"name": "M.Pharmacy (Pharmaceutical Analysis)", "degree": "M.Pharmacy", "school": "Pharmacy",
     "fee": "₹0.75 lakh per year", "keywords": ["m pharmacy analysis", "pharmaceutical analysis"]},
    # ---- Sciences ----
    {"name": "B.Sc. - Forensic Science", "degree": "B.Sc.", "school": "Sciences",
     "fee": "₹1.00 lakh per year", "sch": "bsc", "elig": "Minimum 55% in 12th or equivalent",
     "exams": "ASAT, BIE (AP & TS), CBSE", "keywords": ["forensic", "forensic science", "bsc forensic"]},
    {"name": "B.Sc. - Cyber Security & Digital Forensics", "degree": "B.Sc.", "school": "Sciences",
     "fee": "₹1.00 lakh per year", "sch": "bsc", "elig": "Minimum 55% in 12th or equivalent",
     "exams": "ASAT, BIE (AP & TS), CBSE",
     "keywords": ["cyber security", "cybersecurity", "digital forensics", "bsc cyber"]},
    {"name": "M.Sc. - Forensic Science", "degree": "M.Sc.", "school": "Sciences",
     "fee": "₹0.75 lakh per year", "keywords": ["msc forensic", "m sc forensic"]},
    {"name": "M.Sc. - Cyber Security & Digital Forensics", "degree": "M.Sc.", "school": "Sciences",
     "fee": "₹0.75 lakh per year", "keywords": ["msc cyber", "msc cyber security"]},
    {"name": "M.Sc. - Real Estate Valuation", "degree": "M.Sc.", "school": "Sciences",
     "fee": "₹0.75 lakh per year", "keywords": ["real estate", "real estate valuation"]},
    # ---- BBA (School of Business) ----
    {"name": "BBA in association with Deloitte", "degree": "BBA (Hons.)", "school": "Business",
     "fee": "₹1.40 lakh per year", "sch": "bba", "industry": "Deloitte",
     "elig": "Minimum 55% in 12th or equivalent", "exams": "ASAT (compulsory), BIE (AP & TS), CBSE",
     "special": "Harvard-style case study method, Bajaj FinServ BFSI & TISS certifications, "
                "Big 4 live projects, mentorship by senior executives",
     "keywords": ["bba deloitte", "bba", "bba hons"]},
    {"name": "BBA - Business Analytics (Powered by KPMG)", "degree": "BBA (Hons.)", "school": "Business",
     "fee": "₹1.65 lakh per year", "sch": "bba", "industry": "KPMG",
     "elig": "Minimum 55% in 12th or equivalent", "exams": "ASAT (compulsory), BIE (AP & TS), CBSE",
     "special": "KPMG-curated curriculum, live analytics projects, course-wise KPMG certifications",
     "keywords": ["bba business analytics", "bba kpmg", "business analytics bba"]},
    {"name": "BBA - Global Finance (Powered by PwC)", "degree": "BBA (Hons.)", "school": "Business",
     "fee": "₹1.65 lakh per year", "sch": "bba", "industry": "PwC",
     "elig": "Minimum 55% in 12th or equivalent", "exams": "ASAT (compulsory), BIE (AP & TS), CBSE",
     "special": "PwC mentorship, international market simulations, course-wise PwC certifications",
     "keywords": ["bba global finance", "bba pwc", "global finance"]},
    {"name": "BBA - FinTech (Powered by EY)", "degree": "BBA (Hons.)", "school": "Business",
     "fee": "₹1.65 lakh per year", "sch": "bba", "industry": "EY",
     "elig": "Minimum 55% in 12th or equivalent", "exams": "ASAT (compulsory), BIE (AP & TS), CBSE",
     "special": "EY-designed FinTech labs, 3-year EY mentorship, course-wise EY certifications",
     "keywords": ["bba fintech", "bba ey", "fintech bba"]},
    {"name": "BBA - Health Care Management (with Red Varsity)", "degree": "BBA (Hons.)", "school": "Business",
     "fee": "₹1.65 lakh per year", "sch": "bba", "industry": "Red Varsity",
     "elig": "Minimum 55% in 12th or equivalent", "exams": "ASAT (compulsory), BIE (AP & TS), CBSE",
     "special": "Clinical operations, patient experience, healthcare finance, logistics and technology",
     "keywords": ["bba health care", "bba healthcare", "health care management bba"]},
    # ---- MBA ----
    {"name": "MBA in association with Deloitte", "degree": "MBA", "school": "Business",
     "fee": "₹1.65 lakh per year", "sch": "mba", "industry": "Deloitte",
     "exams": "CAT, NMAT, CMAT, XMAT, MAT",
     "special": "Management Consulting Certification by Deloitte, six majors and five minors, "
                "NSE Simulation Lab, Global CXO masterclasses, Harvard-style case method",
     "keywords": ["mba deloitte", "mba"]},
    {"name": "MBA - Business Analytics (Powered by KPMG)", "degree": "MBA", "school": "Business",
     "fee": "₹2.50 lakh per year", "sch": "mba", "industry": "KPMG", "exams": "CAT, NMAT, CMAT, XMAT, MAT",
     "special": "Continuous KPMG mentorship, globally recognized MBA in Business Analytics credential",
     "keywords": ["mba business analytics", "mba kpmg"]},
    {"name": "MBA - FinTech (Powered by EY)", "degree": "MBA", "school": "Business",
     "fee": "₹2.50 lakh per year", "sch": "mba", "industry": "EY", "exams": "CAT, NMAT, CMAT, XMAT, MAT",
     "special": "EY certifications, live projects and hackathons, digital banking and blockchain expertise",
     "keywords": ["mba fintech", "mba ey"]},
    {"name": "MBA - Global Finance (Powered by PwC)", "degree": "MBA", "school": "Business",
     "fee": "₹2.50 lakh per year", "sch": "mba", "industry": "PwC", "exams": "CAT, NMAT, CMAT, XMAT, MAT",
     "special": "PwC certifications, global financial simulations, US Tax and international finance",
     "keywords": ["mba global finance", "mba pwc"]},
    {"name": "MBA - Health Care Management (with Red Varsity)", "degree": "MBA", "school": "Business",
     "fee": "₹2.50 lakh per year", "sch": "mba", "industry": "Red Varsity", "exams": "CAT, NMAT, CMAT, XMAT, MAT",
     "special": "Executive vision and financial strategy for global healthcare systems",
     "keywords": ["mba health care", "mba healthcare"]},
    {"name": "MBA for Working Professionals (Executive MBA)", "degree": "MBA (Executive)", "school": "Business",
     "fee": "₹1.75 lakh per year", "duration": "2 Years (4 Semesters), 100% Online, weekend classes",
     "industry": "SUNY (dual credential: MBA from Aditya + PG Diploma in AI from SUNY)",
     "special": "For working professionals with min 2 years experience; bachelor's (min 3 yrs, 50%) required",
     "keywords": ["working professionals", "executive mba", "online mba", "weekend mba"]},
    {"name": "Ph.D. in All Disciplines", "degree": "Ph.D.", "school": "Research",
     "keywords": ["phd", "ph d", "doctorate", "doctoral"]},
]

# ── Fees common to all (one-time / hostel / exam) ────────────────────────────
COMMON_FEES = {
    "admission_fee": "₹15,000 one-time (non-refundable)",
    "asat_fee": "₹500 per attempt (maximum 2 attempts)",
    "hostel_non_ac": "₹1.15 lakh per year (laundry + medical insurance up to ₹2 lakh included)",
    "hostel_ac": "₹1.30 lakh per year (laundry + medical insurance up to ₹2 lakh included)",
    "lateral_entry": "Admission fee ₹15,000 (non-refundable) + tuition ₹1,00,000 per year",
}

# ── Scholarship slabs ────────────────────────────────────────────────────────
# mode "min": you qualify if score >= threshold (percentage/percentile/marks).
# mode "rank": you qualify if rank <= threshold (lower rank is better).
SCHOLARSHIP_SLABS = {
    "ASAT": {"mode": "min", "by_cat": {
        "btech_tier1": [(97, "75%"), (95, "50%"), (92, "25%"), (90, "10%")],
        "btech_tier2": [(95, "75%"), (92, "50%"), (90, "25%"), (85, "10%")],
        "bsc": [(95, "20%"), (92, "15%"), (90, "10%")],
        "bba": [(95, "20%"), (92, "15%"), (90, "10%")],
        "pharmacy": [(97, "70%"), (95, "50%"), (92, "25%"), (90, "10%")]}},
    "JEE": {"mode": "min", "unit": "percentile", "by_cat": {
        "btech_tier1": [(98, "100%"), (95, "75%"), (90, "50%"), (80, "25%"), (70, "10%")],
        "btech_tier2": [(95, "100%"), (90, "75%"), (80, "50%"), (70, "25%"), (65, "10%")]}},
    "EAPCET": {"mode": "rank", "by_cat": {
        "btech_tier1": [(5000, "75%"), (10000, "50%"), (25000, "25%"), (50000, "10%")],
        "btech_tier2": [(10000, "75%"), (25000, "50%"), (50000, "25%"), (75000, "10%")],
        "pharmacy": [(4000, "70%"), (10000, "50%"), (25000, "25%"), (35000, "10%")]}},
    "BIE": {"mode": "min", "unit": "percent", "by_cat": {
        "btech_tier1": [(98, "75%"), (96, "50%"), (94, "25%"), (92, "10%")],
        "btech_tier2": [(95, "75%"), (93, "50%"), (90, "25%"), (85, "10%")],
        "bsc": [(95, "20%"), (85, "15%"), (75, "10%")],
        "bba": [(95, "20%"), (85, "15%"), (75, "10%")]}},
    "CBSE": {"mode": "min", "unit": "marks out of 500", "by_cat": {
        "btech_tier1": [(450, "75%"), (425, "50%"), (400, "25%"), (375, "10%")],
        "btech_tier2": [(425, "75%"), (400, "50%"), (375, "25%"), (350, "10%")],
        "bba": [(475, "20%"), (425, "15%"), (375, "10%")]}},
    "CAT": {"mode": "min", "unit": "percentile", "by_cat": {
        "mba": [(94, "50%"), (85, "25%"), (70, "15%"), (60, "10%")]}},
    "NMAT": {"mode": "min", "unit": "percentile", "by_cat": {  # also CMAT / XMAT / MAT
        "mba": [(94, "25%"), (85, "15%"), (75, "10%")]}},
    "NEET": {"mode": "rank", "by_cat": {
        "pharmacy": [(10000, "70%"), (15000, "50%"), (25000, "25%"), (35000, "10%")]}},
}
# Exam-name aliases the caller might say -> canonical key above.
EXAM_ALIASES = {
    "asat": "ASAT", "jee": "JEE", "jee main": "JEE", "jee mains": "JEE",
    "eapcet": "EAPCET", "eamcet": "EAPCET", "ap eamcet": "EAPCET", "ts eamcet": "EAPCET",
    "ap eapcet": "EAPCET", "ts eapcet": "EAPCET",
    "bie": "BIE", "inter": "BIE", "intermediate": "BIE", "board": "BIE",
    "cbse": "CBSE", "cat": "CAT", "nmat": "NMAT", "cmat": "NMAT", "xmat": "NMAT", "mat": "NMAT",
    "neet": "NEET",
}
SPORTS_SCHOLARSHIP = "75% for National-level participation, 100% for International-level " \
                     "(subject to scrutiny by a University-constituted committee)"

# ── Placements ───────────────────────────────────────────────────────────────
PLACEMENTS = {
    "2026": "3832+ placements (still counting). Highest domestic ₹27 LPA (Walmart, 6 selections); "
            "Philips ₹14.5 LPA, Turing ₹12.53 LPA, Maersk ₹10.83 LPA (10 selections), Infosys 181 "
            "selections. International highest ₹39.6 LPA (C.I. Takiron).",
    "2025": "3455+ placements. Walmart ₹22.6 LPA, UiPath ₹17 LPA, Darwinbox ₹16.3 LPA, Cisco ₹16 LPA. "
            "International: Hitachi ₹35.36 LPA, Toyota ₹34.12 LPA.",
    "recruiters": "Walmart, Infosys, Philips, Turing, Maersk, UiPath, Cisco, GE Vernova, "
                  "Toyota, Hitachi and many more.",
    "internships": "2026: Google ₹1.23 lakh/month, Amazon ₹1.10 lakh/month, Walmart ₹1 lakh/month "
                   "(16 selections). 2027: Visa ₹90,000/month, Flipkart ₹50,000/month.",
}

# ── Facilities ───────────────────────────────────────────────────────────────
FACILITIES = {
    "hostel": "AC and Non-AC options, triple-sharing with attached bath and balcony. Boys: gym with "
              "trainer; Girls: in-house beauty parlour. Non-AC ₹1.15 lakh/yr, AC ₹1.30 lakh/yr "
              "(laundry + medical insurance up to ₹2 lakh included).",
    "medical": "Apollo Dispensary 24/7, 24/7 ambulance, free health insurance up to ₹2 lakh.",
    "sports": "Indoor Sports Arena; 75%/100% sports scholarships for National/International participation.",
    "safety": "24/7 CCTV surveillance and security, uninterrupted power supply, banking on campus, Wi-Fi.",
    "labs": "Advanced NSE Simulation Lab, AI-enabled smart classrooms, EY-designed FinTech Labs.",
}


# ── Lookup helpers ───────────────────────────────────────────────────────────
def find_course(query: str):
    """Fuzzy-match what a caller says to one course. Returns the course dict or None."""
    if not query:
        return None
    q = " " + query.lower().strip() + " "
    best, best_score = None, 0
    for c in COURSES:
        score = 0
        for kw in c.get("keywords", []):
            if " " + kw + " " in q or kw in query.lower():
                score = max(score, len(kw))  # longer keyword = more specific match
        # Degree hint (e.g. caller says "M.Tech CSE" vs "B.Tech CSE")
        deg = c["degree"].lower().replace(".", "").replace(" ", "")
        if deg and deg in query.lower().replace(".", "").replace(" ", ""):
            score += 2
        if score > best_score:
            best, best_score = c, score
    return best if best_score > 0 else None


def list_programs(filter_text: str = ""):
    """List program names, optionally filtered by degree or school keyword."""
    f = filter_text.lower().strip()
    out = []
    for c in COURSES:
        if not f or f in c["degree"].lower() or f in c["school"].lower() or f in c["name"].lower():
            out.append(c["name"])
    return out


def _category_for_exam(course_cat: str, exam: str):
    """Return the slab category usable for this exam, or None if that exam doesn't apply."""
    table = SCHOLARSHIP_SLABS.get(exam, {}).get("by_cat", {})
    if course_cat in table:
        return course_cat
    return None


def compute_scholarship(exam_input: str, score, course_query: str):
    """Compute the scholarship % for an exam + score + program. Returns a spoken-ready string."""
    course = find_course(course_query)
    if not course:
        return f"I couldn't match '{course_query}' to a specific program — could you tell me the exact course?"
    cat = course.get("sch")
    if not cat:
        return (f"Scholarship slabs aren't specified for {course['name']} — our counsellor will confirm "
                "your eligibility.")
    exam = EXAM_ALIASES.get(str(exam_input).lower().strip())
    if not exam:
        return f"I don't have scholarship slabs for the '{exam_input}' exam — a counsellor will check that for you."
    slab_cat = _category_for_exam(cat, exam)
    if not slab_cat:
        return (f"{exam} scholarships don't apply to {course['name']} — its accepted route is: "
                f"{course.get('exams', 'as per the program')}. A counsellor can guide the right exam.")
    spec = SCHOLARSHIP_SLABS[exam]
    slabs = spec["by_cat"][slab_cat]
    try:
        val = float(str(score).replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return f"What's your exact {exam} {'rank' if spec['mode'] == 'rank' else 'score'}? I'll check the slab."
    pct = None
    if spec["mode"] == "rank":
        for max_rank, p in slabs:           # ascending ranks; first you fall within
            if val <= max_rank:
                pct = p
                break
        unit = "rank"
    else:
        for min_score, p in sorted(slabs, reverse=True):  # descending; first you exceed
            if val >= min_score:
                pct = p
                break
        unit = spec.get("unit", "score")
    if pct is None:
        return (f"With a {exam} {unit} of {score}, you're just outside the scholarship slabs for "
                f"{course['name']}, but a counsellor can discuss other options.")
    return f"With a {exam} {unit} of {score}, you'd qualify for a {pct} tuition scholarship on {course['name']}."


def format_course(course: dict):
    """A compact, spoken-ready summary of one course for the LLM to phrase naturally."""
    if not course:
        return None
    parts = [course["name"], f"({course['degree']}, School of {course['school']})"]
    if course.get("duration"):
        parts.append(f"Duration: {course['duration']}.")
    if course.get("elig"):
        parts.append(f"Eligibility: {course['elig']}.")
    if course.get("exams"):
        parts.append(f"Accepted exams: {course['exams']}.")
    if course.get("fee"):
        parts.append(f"Annual fee: {course['fee']}.")
    if course.get("industry"):
        parts.append(f"Industry partner: {course['industry']}.")
    if course.get("special"):
        parts.append(f"Highlights: {course['special']}.")
    return " ".join(parts)
