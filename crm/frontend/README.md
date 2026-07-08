# AdmitAI — Frontend

Vite + React 19 dashboard for organisations running AI-powered admission
calling campaigns. Talks to the AdmitAI backend over REST.

---

## Tech stack

| Layer            | Choice                                  |
| ---------------- | --------------------------------------- |
| Build            | Vite 8                                  |
| UI framework     | React 19                                |
| Router           | React Router v7                         |
| State            | Zustand (single store, slice-style)     |
| HTTP             | axios (single configured instance)      |
| Styling          | Tailwind CSS v4 + bespoke "glass" CSS   |
| Charts           | Recharts                                |
| Animations       | Framer Motion + GSAP (counters)         |
| Icons            | lucide-react                            |
| Primitives       | Radix UI (dialog, dropdown, tabs)       |

---

## Quick start

```bash
cd frontend
npm install
cp .env.example .env          # set VITE_API_BASE_URL if backend isn't on :5000
npm run dev                   # vite — http://localhost:5173
```

### Scripts

| Command          | What it does                                |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | Vite dev server with HMR                    |
| `npm run build`  | Production build → `dist/`                  |
| `npm run preview`| Serve the built bundle locally              |
| `npm run lint`   | ESLint                                      |

### Environment variables

Vite only exposes vars prefixed with `VITE_` to the client bundle.

| Variable               | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `VITE_API_BASE_URL`    | Base URL passed to axios (default `http://localhost:5000/api`) |
| `VITE_BACKEND_URL`     | Public backend URL — used for direct downloads (optional) |

If the backend is unreachable on boot the store falls back to a built-in
demo dataset so the UI still renders end-to-end.

---

## Folder structure

```
frontend/
├── index.html
├── vite.config.js
├── public/                  # static files copied verbatim into the build
└── src/
    ├── main.jsx             # React root
    ├── App.jsx              # Router + RBAC route guards
    ├── index.css            # Tailwind base + glass-card / pill helpers
    ├── App.css
    ├── lib/
    │   ├── api.js           # configured axios instance + JWT refresh logic
    │   ├── csv.js           # zero-dep CSV exporter (used by Calls "Export Data")
    │   └── dummyData.js     # 1000-row demo dataset for offline mode
    ├── store/
    │   └── useStore.js      # Zustand store (auth, colleges, calls, reports)
    ├── components/
    │   └── DashboardLayout.jsx
    ├── assets/              # images, fonts, marketing illustrations
    └── pages/
        ├── Landing/
        ├── Login/
        ├── CreateOrg/
        ├── OrgDashboard/         # super-admin view (org overview + colleges grid)
        ├── Colleges/             # full colleges list ("Colleges" tab)
        ├── CollegeDetail/        # admin's analytics view of a single college
        ├── CollegeDashboard/     # the college admin's working surface
        │                         # (Overview / Calls / Trigger / Reports tabs)
        ├── StudentReport/        # post-call AI report (transcript + insights)
        ├── Analytics/
        ├── Team/
        ├── Settings/
        └── Profile/
```

---

## Component patterns

- **One file per page.** Most pages are self-contained `index.jsx` files. The
  shared `DashboardLayout` wraps any authenticated route with the side
  navigation + topbar.
- **Style tokens at the top of each page.** Colours (`SAGE`, `AMBER`, `INK`)
  are repeated locally rather than imported, on purpose — pages stay
  copy-paste portable and design tweaks don't ripple.
- **Glass card + pill button classes.** Defined once in `index.css`. Used
  everywhere via `className="glass-card"` / `"btn-primary"` etc.
- **Animated counters via GSAP.** See `AnimatedCounter` in OrgDashboard.
- **Recharts for everything.** Same `TOOLTIP` style object reused.

---

## RBAC at the route layer

`App.jsx` wraps each route with one of three guards:

| Guard                | Who can enter                                          |
| -------------------- | ------------------------------------------------------ |
| `ProtectedRoute`     | Any signed-in user (Profile, Settings)                 |
| `OrgOnlyRoute`       | admin / officer / viewer — bounces college_admin to their college |
| `CollegeScopedRoute` | college_admin only allowed on colleges in `collegeIds` |

This is a UX guard — the backend enforces the same rules independently
(`scopeToCollege` middleware). Never trust the route guard alone.

---

## Assets folder structure

```
frontend/src/assets/
├── images/         # marketing photos, hero shots, screenshots
├── illustrations/  # SVG illustrations used on Landing / empty states
├── icons/          # custom SVGs not covered by lucide-react
├── logos/          # AdmitAI logo, partner / college logos
└── fonts/          # self-hosted webfonts (woff2)
```

All other static files (favicon, robots.txt, OG image) live in `frontend/public/`
so Vite serves them at the root URL.
