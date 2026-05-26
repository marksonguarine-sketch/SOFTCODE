<div align="center">

# JOAP Hardware Trading

**ERP system for a Antipolo, Philippines hardware store.**
Inventory · Orders · Reservations · Billing · Accounting · Reports — in one place.

![status](https://img.shields.io/badge/status-active-success?style=flat-square)
![stack](https://img.shields.io/badge/stack-React%20%2B%20Express%20%2B%20MongoDB-blue?style=flat-square)
![license](https://img.shields.io/badge/license-internal-lightgrey?style=flat-square)

</div>

---

## What this is

A full-stack ERP built for the way Philippine hardware stores actually work: walk-in counter sales, online + GCash deliveries, bulk reservations, multi-employee shifts, peso-denominated accounting, and Filipino-style customer relationships. Designed for the JOAP Hardware Trading branch in Antipolo.

Built on **React 18 + Vite + TypeScript** on the front, **Express + MongoDB (Atlas) + Mongoose** on the back, **Socket.io** for realtime, and **edge-tts** for spoken order announcements.

## Feature highlights

- **Realtime everywhere** — every query refetches every 1s on top of Socket.io push events
- **Order assignment + lifecycle** — claim → start → mark done with task-locking per employee
- **Reservations calendar** — month view + day drill-down
- **Billing & Pending Payment** — dedicated dashboard for unpaid orders
- **Offers / Promotions** — % discount, BOGO, B1T1, flat discount
- **Accounting ledger** with PDF export (charts captured + embedded)
- **Reports** — peak hours heatmap with PDF export
- **Requests inbox** — admin-approved Add Item, Transfer Order, and Leave workflows
- **Employees** — full profile modal with photo, KPI tiles, productivity chart, PDF export
- **System Logs** — All Logs tab + User Log calendar with per-user target selector
- **Edge TTS** — order assignment voice announcements (per-user toggle)
- **Floating Casio calculator** — draggable, per-user persist
- **Tweaks panel** — dark mode, density, font, accent hue per browser
- **Tutorial** — guided walkthrough with cursor choreography
- **Animated boot loader** — hammer-guy hammers every letter of JOAP before the app shows

## Quick start

### Prerequisites

- Node.js 20+
- MongoDB connection string (Atlas or local) — paste into `server_mongo.ts` or set `MONGODB_URI`

### Install + run

```bash
git clone https://github.com/marksonguarine-sketch/SOFTCODE.git
cd SOFTCODE
npm install
npm run dev
```

The app boots at **http://localhost:5000** (frontend + backend on the same port). The Vite dev server is mounted as Express middleware in development.

### Seeded users

| Username   | Password       | Role     |
|------------|----------------|----------|
| `admin`    | `admin123`     | ADMIN    |
| `employee` | `employee123`  | EMPLOYEE |

### Production build

```bash
npm run build     # bundles client → dist/public, server → dist/index.cjs
npm start         # NODE_ENV=production node dist/index.cjs
```

## Scripts

| Command         | What it does                                         |
|-----------------|------------------------------------------------------|
| `npm run dev`   | Start Express + Vite middleware on port 5000         |
| `npm run build` | Vite bundle + esbuild server bundle                  |
| `npm start`     | Run the production build                             |
| `npm run check` | `tsc --noEmit` — type-check the whole repo           |
| `npm run db:push` | Push Drizzle schema (legacy — Mongoose is canonical) |

## Project layout

```
SOFTCODE/
├── client/                # React frontend (Vite root)
│   ├── public/            # Static assets (favicon.svg, favicon.png)
│   ├── src/
│   │   ├── components/    # Sidebar, Breadcrumbs, LiveClock, Tweaks, Logo, Charts…
│   │   ├── hooks/         # useAuth, useToast, useSocketNotifications…
│   │   ├── lib/           # queryClient, settings-context, tts, utils
│   │   ├── pages/         # One file per route — Dashboard, Orders, Inventory…
│   │   └── App.tsx        # Router + shell
│   └── index.html         # Includes the animated boot loader
├── server/                # Express + Mongoose backend
│   ├── models/            # Mongoose schemas (User, Order, Item, Settings…)
│   ├── middleware/        # auth.ts — JWT + session cache
│   ├── routes.ts          # All HTTP routes + Socket.io events (3300+ lines)
│   ├── index.ts           # Server entrypoint
│   ├── seed.ts            # First-run seed data
│   └── ...
├── shared/
│   └── schema.ts          # Zod schemas + TypeScript types shared with client
├── server_mongo.ts        # MongoDB connection (env-overridable URI)
├── vite.config.ts
├── package.json
└── README.md
```

## Architecture notes

### Realtime sync

Two layers stacked for redundancy:

1. **TanStack Query `refetchInterval: 1000`** — every active query refetches every second.
2. **`startGlobalRealtimeSync()`** in `client/src/lib/queryClient.ts` — a single `setInterval` that invalidates the most important query keys every second, catching cross-page cases.
3. **Socket.io events** — `order:assigned`, `order:status-changed`, `billing:payment`, `request:created`, `message:new`, etc. trigger immediate invalidations.

### Auth

JWT in `localStorage` + httpOnly cookie fallback. The middleware (`server/middleware/auth.ts`) verifies the token, looks up the active `UserSession` in MongoDB, and caches the result in-memory for 30 s. Only one active session per user — logging in elsewhere deactivates other devices.

### Order assignment

Atomic `findByIdAndUpdate` with `$set` + `$unset` + `$push`. Task-lock: employees can hold at most one non-`completedProcessingAt` order at a time. Admins bypass the lock. Every state change emits a Socket.io event and writes a `SystemLog` entry for the audit trail.

### Settings

A single MongoDB Settings document holds global config (company name, color theme, font, font size, store details, daily sales goal, TTS voice, auto-apply offers, etc.). Per-user preferences (TTS on/off, calculator on/off, tweaks panel state) live in `localStorage` keyed by username.

## Conventions

- Currency rendered as `₱1,234.56` everywhere, formatted via `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`. In PDFs we use a `pdfCurrency()` helper that outputs `"PHP 1,234.56"` because jsPDF's default fonts don't include the ₱ glyph.
- Time everywhere is **Philippine Time** (`Asia/Manila`) in 12-hour format. The header live clock and date pickers all honor this.
- IDs and numerics use `font-mono tabular-nums` so columns align.
- Status colors: `bg-amber-500` for warnings/pending, `bg-emerald-500` for success, `bg-red-500` for danger/cancel, `bg-blue-500` for info.

## Tech stack

| Layer        | Stack                                                                |
|--------------|----------------------------------------------------------------------|
| Frontend     | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui                  |
| Routing      | Wouter                                                                |
| Data         | TanStack Query v5 (1 s refetchInterval) + Socket.io-client            |
| Forms        | react-hook-form + zod                                                 |
| Charts       | Recharts                                                              |
| PDFs         | jsPDF + jspdf-autotable + html2canvas (for chart capture)             |
| Backend      | Node.js, Express, TypeScript                                          |
| Database     | MongoDB Atlas via Mongoose                                            |
| Realtime     | Socket.io                                                             |
| Auth         | jsonwebtoken + bcryptjs + session table in Mongo + in-memory cache    |
| TTS          | Microsoft Edge TTS via `edge-tts` binary                              |

## Documentation

Every file's purpose and every architectural choice is documented in **[`code.md`](./code.md)** (~2000 lines, kept current commit-by-commit). When you touch a file, update its section there.

## Browser support

Tested on Chrome 120+, Edge 120+, Firefox 121+, Safari 17+. Responsive down to 360 px width. Designed for keyboard-first use on POS terminals.

## Contributing

- Branch off `main`, PR back.
- Run `npm run check` before pushing — TypeScript must be clean (zero errors).
- Run `npm run build` — bundle must succeed.
- Keep `data-testid` attributes on interactive elements — they're used by manual click-through verification.
- Update `code.md` whenever you add or modify a file.

## Credits

**Development team:**
- **Cabilao, Keane Andre B.** — Full-Stack Developer
- **Ebona, John Marwin R.** — Backend & DB Architect
- **Mirasol, Prince Marl Lizandrelle D.** — Systems Developer

© 2026 JOAP Hardware Trading. All rights reserved.
