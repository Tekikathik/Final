# AdmitAI — Backend

Express + MongoDB API powering the AdmitAI admission-calling platform. Handles
auth, multi-tenant org/college data, AI call orchestration via an external
telephony provider, and Gemini-Flash-driven transcript extraction.

---

## Tech Stack

| Layer            | Choice                                             |
| ---------------- | -------------------------------------------------- |
| Runtime          | Node.js 20+                                        |
| HTTP             | Express 4                                          |
| DB / ORM         | MongoDB + Mongoose                                 |
| Auth             | JWT (access + refresh) with httpOnly refresh cookie |
| Validation       | express-validator                                  |
| AI extraction    | `@google/generative-ai` — Gemini 1.5 Flash         |
| Telephony client | axios → external provider (Vapi / Bland / Twilio)  |
| Scheduling       | `node-cron` (1-min sweep) + per-call `setTimeout`  |
| Logging          | morgan                                             |

---

## Quick start

```bash
cd backend
npm install
cp .env.example .env          # fill in real values
npm run dev                   # node --watch server.js
```

The server boots on `http://localhost:5000` and the scheduler immediately
sweeps for any due calls.

### Required environment variables

See `.env.example` for the full list. The most important ones:

| Variable                    | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `MONGO_URI`                 | Mongo connection string                                          |
| `JWT_ACCESS_SECRET` / `_REFRESH_SECRET` | Token signing keys                                   |
| `CLIENT_URL`                | Frontend origin — used by CORS                                   |
| `PUBLIC_BACKEND_URL`        | Public URL of this server — used to build webhook callback URLs  |
| `TELEPHONY_API_URL` / `_KEY` | External AI calling provider                                    |
| `TELEPHONY_FROM_NUMBER`     | Phone number to call from                                        |
| `TELEPHONY_WEBHOOK_SECRET`  | Shared secret verified on inbound webhook (`X-Webhook-Secret`)   |
| `GEMINI_API_KEY`            | Google AI Studio key for Gemini 1.5 Flash                        |
| `GEMINI_MODEL`              | `gemini-1.5-flash` (default) — override only for testing         |
| `SCHEDULER_ENABLED`         | `false` to disable the cron sweep (useful in tests)              |

If `TELEPHONY_API_URL` or `GEMINI_API_KEY` is missing the system falls back
to mock mode — calls are recorded as if dispatched, and transcripts are
parsed by the heuristic generator instead of Gemini. This keeps the dev
loop tight without external dependencies.

---

## Folder structure

```
backend/
├── server.js              # Express bootstrap + DB connect + scheduler boot
├── config/
│   └── db.js              # mongoose.connect()
├── middleware/
│   ├── auth.js            # authenticate, requireRole, scopeToCollege
│   └── errorHandler.js
├── models/                # Mongoose schemas
│   ├── Organization.js
│   ├── College.js
│   ├── User.js            # roles: admin | college_admin | officer | viewer
│   ├── Call.js            # one row per phone attempt (status, duration, …)
│   └── Report.js          # rich post-call AI report
├── routes/                # Express routers, one per resource
│   ├── auth.js            # /register /login /refresh /logout /me
│   ├── orgs.js
│   ├── colleges.js
│   ├── calls.js           # /trigger /webhook /export/csv …
│   ├── reports.js
│   └── analytics.js       # aggregation pipelines for the dashboard
├── services/              # Side-effecting integrations (no HTTP layer)
│   ├── telephony.js       # dispatchCall() → external provider
│   ├── gemini.js          # parseTranscript() → structured Report
│   └── scheduler.js       # cron sweep + per-call timers
├── utils/
│   ├── tokenUtils.js      # JWT sign/verify + refresh-cookie helpers
│   └── reportGenerator.js # heuristic fallback when Gemini is unavailable
├── scripts/
│   └── seed.js            # `node scripts/seed.js` to seed demo data
└── assets/                # see "Assets folder structure" below
```

---

## How the call pipeline works

```
                              ┌──────────────┐
   POST /api/calls/trigger ─▶ │  Create N    │  status='scheduled'
   body:{collegeId, contacts, │  Call docs   │  scheduledAt = now | future
   settings:{ scheduleAt? }}  └──────┬───────┘
                                     │
                          ┌──────────┴──────────┐
                          │ scheduleAt is now?  │
                          └──────────┬──────────┘
                  ┌──────────────────┴──────────────────┐
                  │                                     │
       ┌─────────────────────┐                ┌────────────────────────┐
       │ Immediate dispatch  │                │ services/scheduler.js  │
       │ via telephony.js    │                │  • per-call setTimeout │
       │                     │                │  • 1-min cron sweep    │
       └──────────┬──────────┘                └───────────┬────────────┘
                  │                                       │
                  ▼                                       ▼
       ┌─────────────────────────────────────────────────────────┐
       │   External AI calling provider (Vapi / Bland / Twilio)  │
       │   • places the call, runs the agent, records transcript │
       └────────────────────────────┬────────────────────────────┘
                                    │  HTTPS POST
                                    ▼
                    ┌──────────────────────────────────┐
                    │  POST /api/calls/webhook         │
                    │  X-Webhook-Secret verified       │
                    │  body: { transcript, duration… } │
                    └──────────────────┬───────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │ services/gemini.js               │
                    │  Gemini 1.5 Flash → JSON         │
                    │  → profile, summary, prob,       │
                    │    topicAnalysis, follow-ups     │
                    └──────────────────┬───────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │ Call.save() + Report.upsert()    │
                    │ → visible on the dashboard       │
                    └──────────────────────────────────┘
```

---

## RBAC

Four roles enforced on the backend (`models/User.js`):

| Role            | Scope of access                                           |
| --------------- | --------------------------------------------------------- |
| `admin`         | Full org — every college, every report, user management   |
| `college_admin` | Restricted to colleges in `user.collegeIds[]`             |
| `officer`       | Read/write within the org, no admin actions               |
| `viewer`        | Read-only                                                 |

Two middleware helpers (`middleware/auth.js`):

- `requireRole(...roles)` — coarse gate ("only admins can POST a college")
- `scopeToCollege('body.collegeId')` — fine-grained, blocks a college_admin
  from acting on a college not in their `collegeIds`

`collegeIds` is embedded in the JWT payload so RBAC checks don't require a
DB round-trip per request.

---

## Webhook contract

The external AI provider should POST to `/api/calls/webhook` (or include
`?callId=…` in the URL) with this shape:

```json
{
  "callId": "65f0a1...",        // matches Call._id we passed in metadata
  "phone": "+919876543210",
  "campaignId": "uuid-...",
  "status": "completed",
  "duration": 248,
  "startedAt": "2026-05-07T10:11:32Z",
  "endedAt":   "2026-05-07T10:15:40Z",
  "transcript": [
    { "speaker": "ai", "text": "Hi Rahul…", "timestamp": 0 },
    { "speaker": "student", "text": "Yes, I'm interested.", "timestamp": 4 }
  ]
}
```

Headers: `X-Webhook-Secret: <TELEPHONY_WEBHOOK_SECRET>`.

---

## Assets folder structure

```
backend/assets/
├── prompts/         # versioned Gemini system prompts (.md, .txt)
├── voices/          # voice-model config snippets (yaml/json) per provider
├── templates/       # email/SMS templates triggered by report follow-ups
└── seeds/           # JSON fixtures for `scripts/seed.js`
```

This folder is _not_ on the request path — it's read at boot or by scripts.
Keeping it under the backend (rather than committing prompts inline in JS)
makes it easy to A/B versions of the Gemini prompt without touching code.
