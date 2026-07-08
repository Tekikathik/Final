require('dotenv').config()
const http       = require('http')
const express    = require('express')
const cors       = require('cors')
const cookieParser = require('cookie-parser')
const morgan     = require('morgan')
const path       = require('path')
const fs         = require('fs')
const connectDB  = require('./config/db')
const errorHandler = require('./middleware/errorHandler')
const { startScheduler } = require('./services/scheduler')
const { startCompetitiveSchedule } = require('./services/competitiveSchedule')
const { startMarketingSchedule } = require('./services/marketing/marketingSchedule')
const mediaStream  = require('./services/mediaStream')
// vectorStore auto-initialises on require (see services/vectorStore.js)

const app = express()

// Connect DB, then start the cron scheduler. The scheduler relies on the
// DB connection so we kick it off only after connectDB resolves.
connectDB().then(() => { startScheduler(); startCompetitiveSchedule(); startMarketingSchedule() }).catch(err => console.error(err))

// Ensure the audio directory exists for Priya TTS files
const audioDir = path.join(__dirname, 'audio')
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true })

// ── Middleware ────────────────────────────────────────────────────────────
// Twilio webhooks POST form-encoded bodies; the existing routes use JSON.
// Both parsers must be registered.
app.use(cors({
  origin: (origin, cb) => {
    // Allow the frontend dev server, production client, and Twilio (no origin)
    const allowed = [process.env.CLIENT_URL, process.env.SERVER_URL].filter(Boolean)
    if (!origin || allowed.includes(origin)) return cb(null, true)
    cb(null, true) // open for now — tighten in production
  },
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true })) // required for Twilio webhook form bodies
app.use(cookieParser())
app.use(morgan('dev'))

// Serve Priya TTS audio files so Twilio's <Play> tag can download them
app.use('/audio', express.static(audioDir))

// ── Routes — existing AdmitAI platform ───────────────────────────────────
app.use('/api/auth',      require('./routes/auth'))
app.use('/api/orgs',      require('./routes/orgs'))
app.use('/api/colleges',  require('./routes/colleges'))
app.use('/api/calls',     require('./routes/calls'))
app.use('/api/reports',   require('./routes/reports'))
app.use('/api/analytics', require('./routes/analytics'))

// ── Routes — CRM (leads, branches, appointments, audit) ──────────────────
app.use('/api/leads',         require('./routes/leads'))
app.use('/api/branches',      require('./routes/branches'))
app.use('/api/appointments',  require('./routes/appointments'))
app.use('/api/audit',         require('./routes/audit'))
app.use('/api/crm-analytics', require('./routes/crmAnalytics'))
app.use('/api/competitive',   require('./routes/competitive'))
app.use('/api/marketing',     require('./routes/marketing'))

// ── Routes — Priya Calling System ────────────────────────────────────────
app.use('/api/priya',            require('./routes/priya'))
app.use('/api/priya/documents',  require('./routes/documents'))
app.use('/webhook',              require('./routes/priyaWebhook'))

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

// Error handler
app.use(errorHandler)

const PORT       = process.env.PORT || 5000
const httpServer = http.createServer(app)

// Attach WebSocket server for Twilio Media Streams (real-time audio pipeline)
mediaStream.setup(httpServer)


httpServer.listen(PORT, () => console.log(`AdmitAI + Priya backend running on port ${PORT}`))
