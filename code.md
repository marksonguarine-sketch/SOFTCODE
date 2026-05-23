# JOAP Hardware Trading — Full Codebase Reference

This document covers every file in the project: what it does, how it works, and how it connects to the rest of the system. The app is a full-stack business management ERP for a hardware supply company called JOAP Hardware Trading. It handles inventory, orders, billing, accounting, user management, reports, and system administration.

---

## Project Structure Overview

```
/
├── client/                  # React frontend (Vite)
│   ├── index.html           # HTML entry point
│   ├── public/
│   │   └── favicon.png      # Browser tab icon
│   └── src/
│       ├── main.tsx         # React root mount
│       ├── App.tsx          # Root component, routing, layout
│       ├── index.css        # Global CSS + Tailwind directives
│       ├── components/      # Shared/reusable components
│       │   ├── app-sidebar.tsx
│       │   ├── dev_button.tsx
│       │   ├── tutorial.tsx
│       │   └── ui/          # 40+ shadcn/radix UI primitives
│       ├── hooks/           # Custom React hooks
│       │   ├── use-mobile.tsx
│       │   └── use-toast.ts
│       ├── lib/             # Client-side utilities and contexts
│       │   ├── auth.tsx
│       │   ├── queryClient.ts
│       │   ├── settings-context.tsx
│       │   ├── tts.ts       # ← NEW: Edge TTS helper (speakTTS, formatAmountForTTS)
│       │   └── utils.ts
│       └── pages/           # One file per route/page
│           ├── dashboard.tsx
│           ├── inventory.tsx
│           ├── orders.tsx
│           ├── order-detail.tsx
│           ├── reservations.tsx
│           ├── billing.tsx
│           ├── accounting.tsx
│           ├── reports.tsx
│           ├── users.tsx
│           ├── settings.tsx
│           ├── system-logs.tsx
│           ├── maintenance.tsx
│           ├── login.tsx
│           ├── about.tsx
│           ├── help.tsx
│           └── not-found.tsx
├── server/                  # Express backend (Node.js)
│   ├── index.ts             # Server entry point
│   ├── routes.ts            # All API route handlers
│   ├── db.ts                # MongoDB connection
│   ├── seed.ts              # Initial data seeding
│   ├── static.ts            # Production static file serving
│   ├── vite.ts              # Development Vite middleware
│   ├── storage.ts           # Legacy MemStorage interface (unused in prod)
│   ├── middleware/
│   │   └── auth.ts          # JWT auth middleware + in-memory session cache
│   └── models/              # Mongoose schemas (MongoDB collections)
│       ├── User.ts
│       ├── UserSession.ts
│       ├── Item.ts
│       ├── Customer.ts
│       ├── Order.ts
│       ├── BillingPayment.ts
│       ├── InventoryLog.ts
│       ├── AccountingAccount.ts
│       ├── GeneralLedgerEntry.ts
│       ├── SystemLog.ts
│       ├── Settings.ts
│       ├── BackupHistory.ts
│       └── ImageApproval.ts
├── shared/
│   └── schema.ts            # Zod schemas + TypeScript interfaces shared by client and server
├── script/
│   └── build.ts             # Production build script (Vite + esbuild)
├── package.json             # Dependencies and npm scripts
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite bundler config
├── tailwind.config.ts       # Tailwind CSS config
├── postcss.config.js        # PostCSS config
├── components.json          # shadcn/ui component config
├── drizzle.config.ts        # Drizzle ORM config (present but unused — app uses Mongoose)
└── replit.nix               # Replit Nix environment config
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript |
| Frontend build | Vite 7 |
| Styling | Tailwind CSS v3 + shadcn/ui (Radix UI) |
| Routing (client) | Wouter |
| Data fetching | TanStack Query (React Query) v5 |
| Icons | Lucide React |
| Charts | Recharts |
| Backend | Express.js v5 + Node.js 20 |
| Database | MongoDB via Mongoose |
| Auth | Custom JWT with bcryptjs + in-memory session cache |
| Real-time | Socket.io |
| Scheduled jobs | node-cron |
| File uploads | Multer |
| Validation | Zod |
| PDF export | jsPDF + jspdf-autotable |
| Text-to-Speech | msedge-tts (Microsoft Edge Neural Voices) |

---

## Entry Points

### `client/index.html`
The HTML shell loaded by the browser. Contains a single `<div id="root">` where React mounts, and a `<script type="module" src="/src/main.tsx">` tag that Vite transforms.

### `client/src/main.tsx`
The absolute starting point for the React app. Calls `createRoot(document.getElementById("root")).render(<App />)` and imports `index.css` for global styles. Nothing else lives here.

### `server/index.ts`
The Express server entry point. Does five things in order:
1. Creates the Express `app` and an `http.Server` wrapping it
2. Attaches JSON body parsing (50 MB limit) and URL-encoded body parsing
3. Sets up a request-logging middleware that prints every `/api/*` request with method, path, status code, and response time
4. Calls `connectDB()` to establish MongoDB connection, then `seedDatabase()` to populate initial data if empty
5. Calls `registerRoutes()` to attach all API routes, then either serves static production files or starts the Vite dev server depending on `NODE_ENV`
6. Starts listening on port from `process.env.PORT` (defaults to 5000) on host `0.0.0.0`

---

## Database Layer

### `server/db.ts`
Reads `MONGODB_URI` from environment variables. If it is missing or contains the word "placeholder", the process exits immediately with an error message. Otherwise connects to MongoDB using Mongoose and targets the `joap_hardware` database. The `connectDB()` function is awaited in `server/index.ts` before anything else starts.

**Connects to:** `server/index.ts` (called during startup), all `server/models/*.ts` (Mongoose uses the same connection)

### `server/seed.ts`
Runs once on every startup, but is a no-op if the `admin` user already exists. If the database is empty it creates:
- Two users: `admin` (password: `admin123`, role: ADMIN) and `employee` (password: `employee123`, role: EMPLOYEE)
- Five sample customers (Filipino names/addresses appropriate for the business)
- Ten sample hardware inventory items (cement, steel bars, hollow blocks, paint, PVC pipe, etc.)
- Eight standard accounting chart-of-accounts entries (Cash, AR, Inventory, AP, Equity, Revenue, COGS, OpEx)
- One Settings document with company defaults

All passwords are bcrypt-hashed with salt rounds of 10. Logs success/failure to console using the shared `log()` function from `server/index.ts`.

---

## MongoDB Models (`server/models/`)

Each file defines a Mongoose schema and exports a compiled Model. The model name determines the MongoDB collection name (pluralised automatically by Mongoose).

### `server/models/User.ts`
**Collection:** `users`

Stores employee accounts.

| Field | Type | Notes |
|---|---|---|
| `username` | String | Required, unique, trimmed, lowercased |
| `password` | String | bcrypt hash, required |
| `role` | String | enum: `ADMIN` or `EMPLOYEE`, default `EMPLOYEE` |
| `isActive` | Boolean | Soft-disable accounts without deleting, default `true` |
| `resetToken` | String | Optional, used for password reset flow |
| `resetTokenExpiry` | Date | When the reset token expires |
| `createdAt` / `updatedAt` | Date | Auto-managed by Mongoose timestamps |

**Used by:** auth routes, user management routes, auth middleware, seed.ts

### `server/models/UserSession.ts`
**Collection:** `usersessions`

Tracks active login sessions. When a user logs in, a session record is created with the JWT token. The auth middleware validates every request by checking that the token exists in this collection with `isActive: true`. Logging out sets `isActive: false`.

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | Ref to User |
| `token` | String | JWT string, unique |
| `isActive` | Boolean | Whether the session is still valid |
| `lastActivity` | Date | Updated on every authenticated request (throttled to once per 60 s via in-memory map) |

**Index:** on `userId`

**Used by:** auth middleware, login route, logout route, dashboard active-users count

### `server/models/Item.ts`
**Collection:** `items`

Inventory items — the core product catalog.

| Field | Type | Notes |
|---|---|---|
| `itemName` | String | Required, trimmed |
| `category` | String | Required, e.g. "Cement", "Steel", "Paint" |
| `supplierName` | String | Supplier who provides this item |
| `unitPrice` | Number | Price per unit in Philippine Pesos |
| `currentQuantity` | Number | Current stock count |
| `avgDailyUsage` | Number | Used for reorder point calculation |
| `leadTimeDays` | Number | Days from order to delivery |
| `safetyStock` | Number | Minimum buffer stock |
| `reorderLevel` | Number | Trigger point to reorder |
| `barcode` | String | Optional barcode string |
| `imageFilename` | String | Approved image file name in `/uploads/` |
| `imagePending` | Boolean | Whether an employee has uploaded an unapproved image |
| `pendingImageFilename` | String | Waiting for admin approval |
| `pendingImageUploadedBy` | String | Who uploaded the pending image |

**Indexes:** text index on `itemName` + `category` (for search), on `category`

**Used by:** inventory routes, order creation (stock deduction), dashboard stats, reports, global search

### `server/models/Customer.ts`
**Collection:** `customers`

Customer records linked to orders.

| Field | Type | Notes |
|---|---|---|
| `name` | String | Required, trimmed |
| `email` | String | Optional |
| `phone` | String | Optional |
| `address` | String | Optional |

**Index:** text index on `name`

**Used by:** order creation, order listing, global search

### `server/models/Order.ts`
**Collection:** `orders`

The most complex model. Each order has embedded line items, a full status history, an optional delivery address, and collaborative locking fields. Also handles reservations — `orderType` values of `walkin_reservation` and `online_reservation` are shown in the Reservations page.

**Sub-schemas:**
- `orderItemSchema` — `{ itemId, itemName, qty, originalUnitPrice, discountedUnitPrice, discountApplied, offerName, lineTotal }` — no `_id`
- `statusEntrySchema` — `{ status, timestamp, actor, note }` — no `_id`

| Field | Type | Notes |
|---|---|---|
| `trackingNumber` | String | Unique auto-generated (e.g. `JH-0042`), has unique index |
| `customerName` | String | Denormalized for display |
| `customerPhone` | String | Optional phone number |
| `orderType` | String | `walkin`, `delivery`, `walkin_reservation`, `online_reservation`, etc. |
| `orderChannel` | String | `walkin`, `email`, `sms`, `messenger`, `phone` |
| `paymentMethod` | String | `cash`, `gcash_qr`, `cod` |
| `paymentStatus` | String | `pending_payment`, `partial`, `paid` |
| `fulfillmentStatus` | String | `pending`, `processing`, `ready`, `completed`, `cancelled` |
| `items` | Array | Embedded order items |
| `totalAmount` | Number | Sum of all line totals + delivery fee |
| `subtotal` | Number | Sum of line totals before delivery fee |
| `deliveryFee` | Number | Extra delivery charge |
| `notes` | String | Free-text notes |
| `scheduledDate` | Date | For reservations — the appointment date/time |
| `statusHistory` | Array | Full audit trail of status changes |
| `address` | Object | Optional delivery address |
| `assignedTo` | String | Username of the assigned employee |

**Indexes:** `fulfillmentStatus`, `paymentStatus`, `orderType`, `orderChannel`, `createdAt` (desc), `assignedTo`, `customerName` (text), `scheduledDate`, `updatedAt` (desc). `trackingNumber` is unique (implicit index).

**Used by:** order routes, reservations routes, billing routes, dashboard stats, reports, global search

### `server/models/BillingPayment.ts`
**Collection:** `billingpayments`

Records each payment made against an order. Supports partial payments (multiple payments per order).

| Field | Type | Notes |
|---|---|---|
| `orderId` | ObjectId | Ref to Order |
| `paymentMethod` | String | Default `GCash` |
| `gcashNumber` | String | GCash wallet number used |
| `gcashReferenceNumber` | String | Unique transaction reference |
| `amountPaid` | Number | Amount in Philippine Pesos |
| `paymentDate` | Date | When payment was made |
| `proofNote` | String | Additional notes |
| `loggedBy` | String | Username of staff who logged the payment |

**Index:** on `orderId`

**Used by:** billing routes, dashboard revenue stats, revenue chart, reports

### `server/models/InventoryLog.ts`
**Collection:** `inventorylogs`

An append-only audit trail of every stock change.

| Field | Type | Notes |
|---|---|---|
| `itemId` | ObjectId | Ref to Item |
| `itemName` | String | Denormalized |
| `type` | String | `restock`, `deduction`, or `adjustment` |
| `quantity` | Number | Change amount (positive or negative) |
| `reason` | String | Free-text explanation |
| `actor` | String | Username who made the change |

**Indexes:** on `itemId`, on `createdAt` (descending)

**Used by:** inventory routes, reports

### `server/models/AccountingAccount.ts`
**Collection:** `accountingaccounts`

Chart of accounts — the five account types used in double-entry bookkeeping.

| Field | Type | Notes |
|---|---|---|
| `accountCode` | String | Unique code, e.g. `1000`, `4000` |
| `accountName` | String | e.g. `Cash/GCash`, `Sales Revenue` |
| `accountType` | String | enum: Asset, Liability, Equity, Revenue, Expense |
| `balance` | Number | Current balance (updated via ledger entries) |

**Used by:** accounting routes, ledger entry creation

### `server/models/GeneralLedgerEntry.ts`
**Collection:** `generalledgerentries`

Individual double-entry bookkeeping transactions. Each payment automatically creates a ledger entry debiting Cash and crediting Sales Revenue. Entries can be manually reversed.

| Field | Type | Notes |
|---|---|---|
| `date` | Date | Transaction date |
| `accountName` | String | Which account is affected |
| `debit` | Number | Debit amount |
| `credit` | Number | Credit amount |
| `description` | String | Description of the transaction |
| `referenceType` | String | e.g. `payment`, `manual` |
| `referenceId` | String | ID of the source document |
| `isReversing` | Boolean | Whether this is a reversal entry |
| `actor` | String | Who created the entry |

**Indexes:** on `date` (descending), on `accountName`

**Used by:** accounting routes, billing payment route (auto-creates entries)

### `server/models/SystemLog.ts`
**Collection:** `systemlogs`

Immutable audit log for every significant user action in the system (logins, logouts, item creation, order updates, payments, settings changes, etc.).

| Field | Type | Notes |
|---|---|---|
| `action` | String | Action name, e.g. `USER_LOGIN`, `ITEM_CREATED`, `ORDER_STATUS_CHANGED` |
| `actor` | String | Username who performed the action |
| `target` | String | What was acted upon |
| `metadata` | Mixed | Additional context (order status, old values, etc.) |

**Indexes:** on `action`, on `createdAt` (descending)

**Used by:** all route handlers (via `logAction()` helper), system-logs page

### `server/models/Settings.ts`
**Collection:** `settings`

Single-document collection. Only one settings document exists at a time.

| Field | Type | Notes |
|---|---|---|
| `companyName` | String | Displayed in the UI |
| `theme` | String | `light` or `dark` |
| `reorderThreshold` | Number | Items below this are "critical stock" |
| `lowStockThreshold` | Number | Items below this are "low stock" |
| `font` | String | Google Font name |
| `colorTheme` | String | Color accent: blue, emerald, purple, etc. |
| `gradient` | String | Sidebar gradient key |
| `autoBackupEnabled` | Boolean | Whether scheduled backups run |
| `autoBackupIntervalValue` | Number | Number of hours/days/weeks between backups |
| `autoBackupIntervalUnit` | String | `hours`, `days`, or `weeks` |
| `gcashNumber` | String | Store GCash wallet number shown on receipts |
| `gcashQrImageUrl` | String | URL of QR code image for GCash payments |
| `storeAddress` | String | Physical store address shown on PDFs |
| `storeContactNumber` | String | Store phone/contact shown on PDFs |
| `autoApplyOffers` | Boolean | Auto-apply active offers when creating orders |
| `showSavingsSummary` | Boolean | Show total savings when offers are applied |
| `ttsVoice` | String | Microsoft Edge Neural Voice ID for announcements (default: `en-US-AriaNeural`) |

**Used by:** settings routes, settings-context.tsx (client reads and applies theme/font/colors), dashboard stats (reads reorder thresholds), auto-backup scheduler, `/api/tts` route (reads voice)

### `server/models/BackupHistory.ts`
**Collection:** `backuphistories`

Records of every backup file created, both manual and automatic.

| Field | Type | Notes |
|---|---|---|
| `filename` | String | e.g. `auto-backup-2026-02-23T05-39-22-300Z.json` |
| `size` | Number | File size in bytes |
| `source` | String | `manual` or `auto` |
| `createdBy` | String | Username or `system` |

**Index:** on `createdAt` (descending)

**Used by:** maintenance routes (list, download, delete backups), auto-backup cron job

### `server/models/ImageApproval.ts`
**Collection:** `imageapprovals`

Tracks employee-submitted product images that are waiting for admin review. Employees can upload a photo for an inventory item, but it doesn't go live until an admin approves it.

| Field | Type | Notes |
|---|---|---|
| `itemId` | ObjectId | Ref to Item |
| `filename` | String | The uploaded file name in `/uploads/` |
| `uploadedBy` | String | Employee username |
| `status` | String | `pending`, `approved`, or `rejected` |
| `reviewedBy` | String | Admin who reviewed it |

**Indexes:** on `status`, on `itemId`

**Used by:** inventory image upload routes, maintenance/admin approval routes

---

## Backend (`server/`)

### `server/middleware/auth.ts`
JWT authentication middleware used to protect API routes.

**Exports:**

1. **`generateToken(payload)`** — Creates a JWT signed with `SESSION_SECRET` (or fallback `"joap-hardware-secret-key"`) that expires in 24 hours. The payload contains `_id`, `username`, and `role`.

2. **`authMiddleware`** — Applied to all protected routes. Uses a **30-second in-memory session cache** (a `Map<token, { user, expiresAt }>`) so repeated requests from the same session skip MongoDB entirely. Cache miss: verifies JWT, then runs `UserSession.findOne` and `User.findById` **in parallel** using `Promise.all` with `.lean()` for minimum overhead. On success, populates the cache and fires a non-blocking `lastActivity` update (throttled to at most once per 60 s per token). Returns `401` if no token, invalid token, inactive session, or inactive user.

3. **`adminOnly`** — Middleware that checks `req.user.role === "ADMIN"`. Returns 403 if not.

4. **`clearSessionCache(token)`** — Removes a specific token from the in-memory cache. Called by the logout route immediately after deactivating the session.

5. **`clearAllSessionsForUser(userId)`** — Removes all cached tokens for a given user ID. Called by the login route when it deactivates all previous sessions for a user (concurrent login enforcement).

**Performance impact:** Reduces auth overhead from ~3 sequential DB round trips per request to ~0 DB hits for cached tokens. The dashboard page fires 6+ API calls simultaneously — this alone saves ~15 MongoDB round trips on every dashboard load.

**Connects to:** `UserSession` model, `User` model, all route handlers in `routes.ts`

### `server/routes.ts`
The largest file in the project. Registers all API endpoints on the Express app and sets up Socket.io. Every route returns JSON in the format `{ success: true, data: ... }` on success, or `{ success: false, error: "..." }` on failure, via the `ok()` and `fail()` helper functions.

**Setup:**
- Attaches `cookieParser` middleware
- Creates Socket.io server attached to the HTTP server with CORS origin `*`
- Defines `emitEvent(event, data)` — broadcasts real-time events to all connected clients
- Defines `logAction(action, actor, target, metadata)` — creates a SystemLog entry
- Creates `/uploads` and `/backups` directories if they don't exist
- Configures Multer for image uploads (max 5 MB, images only, stored as `item-<timestamp>.<ext>`)
- Sets up auto-backup on startup by reading the Settings document

**Route groups:**

#### Auth Routes
- `POST /api/auth/login` — Validates credentials, **deactivates all existing sessions + clears cache** for that user (concurrent login enforcement via `clearAllSessionsForUser`), creates a new `UserSession`, returns JWT in body and httpOnly cookie.
- `POST /api/auth/logout` — Deactivates the session in DB, **calls `clearSessionCache(token)`** to evict the in-memory cache immediately, clears the cookie.
- `GET /api/auth/me` — Returns current user profile. Returns `401` if session is invalidated.

#### Dashboard Routes
- `GET /api/dashboard/stats` — Today's order count, revenue, stock levels, active users.
- `GET /api/dashboard/revenue-chart` — Revenue grouped by day for the last 30 days.
- `GET /api/dashboard/orders-by-status` — Count of orders grouped by `fulfillmentStatus`.
- `GET /api/dashboard/inventory-status` — Healthy / low / critical stock counts.
- `GET /api/dashboard/recent-orders` — Last 10 orders, essential fields only.
- `GET /api/dashboard/top-items` — Top 10 items by quantity sold (aggregation over embedded order items).
- `GET /api/dashboard/advanced` — Extended stats: earnings trend, sparkline, top customers, recent activity feed.

#### Item/Inventory Routes
- `GET /api/items` — Paginated items list. Supports `?search=`, `?category=`, `?lowStock=true`.
- `GET /api/items/all` — All items without pagination (used by Create Order and Create Reservation dropdowns).
- `GET /api/items/categories` — Distinct category values.
- `POST /api/items` — Creates item. Admin only. Emits `item:created`.
- `PUT /api/items/:id` — Updates item. Admin only. Emits `item:updated`.
- `DELETE /api/items/:id` — Soft-check for order references before deleting. Admin only.
- `POST /api/items/:id/inventory-log` — Adjusts stock with reason. Emits `inventory:updated`.
- `GET /api/items/:id/inventory-logs` — All log entries for an item.
- `POST /api/items/:id/image` — Employee uploads pending image via Multer.
- `GET /api/items/:id/image` — Streams approved image from disk.

#### Customer Routes
- `GET /api/customers` — All customers. Supports `?search=`.
- `POST /api/customers` — Creates customer.
- `PUT /api/customers/:id` — Updates customer.
- `DELETE /api/customers/:id` — Blocked if customer has orders.

#### Order Routes
- `GET /api/orders` — Paginated orders. Filters: `?search=`, `?status=`, `?orderType=`, `?paymentStatus=`, date range.
- `POST /api/orders` — Creates an order. Generates tracking number. Deducts stock. Logs `ORDER_CREATED`. Emits `order:created`. Also used to create reservations (when `orderType` is `walkin_reservation` or `online_reservation`).
- `GET /api/orders/:id` — Single order with full details.
- `PATCH /api/orders/:id/status` — Updates fulfillment/payment status. Appends to `statusHistory`.
- `PUT /api/orders/:id/assign` — Assigns to employee. Admin only.

#### Reservation Routes
- `GET /api/reservations` — All reservation-type orders (`walkin_reservation`, `online_reservation`), sorted by scheduled date.
- `PATCH /api/reservations/:id/status` — Updates reservation status (fulfillment or payment).

#### Billing/Payment Routes
- `GET /api/billing/payments` — All payments, paginated.
- `POST /api/billing/payments` — Logs a payment. Validates GCash reference uniqueness. Auto-creates General Ledger entry. Updates order payment status. Logs `PAYMENT_LOGGED`, emits `billing:payment`.

#### Settings Routes
- `GET /api/settings` — Returns the single settings document.
- `PATCH /api/settings` — Updates settings fields. Triggers auto-backup scheduler reconfiguration if backup settings change.

#### TTS Route
- `POST /api/tts` — Text-to-speech synthesis. Reads `ttsVoice` from the Settings document, instantiates `MsEdgeTTS` from the `msedge-tts` npm package, streams MP3 audio back to the client. Text is capped at 500 characters. Returns `audio/mpeg` content type. Used by `client/src/lib/tts.ts`.

#### Other Routes
- `GET /api/offers` — Active and all offers. Supports `?search=`, `?active=true`.
- `POST /api/offers` — Creates an offer. Admin only.
- `PUT /api/offers/:id` — Updates an offer. Admin only.
- `DELETE /api/offers/:id` — Deletes an offer. Admin only.
- `GET /api/accounting/accounts` — All chart-of-accounts entries.
- `POST /api/accounting/entries` — Manual ledger entry.
- `GET /api/accounting/ledger` — Paginated ledger entries with filters.
- `GET /api/users` — All users. Admin only.
- `POST /api/users` — Creates a new user. Admin only.
- `PUT /api/users/:id` — Updates user. Admin only. Deactivates all sessions if user is disabled.
- `GET /api/system-logs` — Paginated system log with filters.
- `GET /api/search` — Global search across orders, items, customers.
- `POST /api/maintenance/backup` — Manual backup of all collections to JSON.
- `GET /api/maintenance/backups` — List backup files.
- `GET /api/maintenance/backups/:filename` — Download a backup file.
- `DELETE /api/maintenance/backups/:filename` — Delete a backup file.
- `POST /api/maintenance/restore` — Restore database from a backup file. Admin only.

---

## Frontend (`client/src/`)

### `client/src/lib/queryClient.ts`
Sets up the global TanStack Query client.

- **Default fetcher (`getQueryFn`)** — Uses `queryKey[0]` as the URL, sends JWT from cookie (via `credentials: "include"`), and throws on non-2xx responses.
- **`apiRequest(method, url, data)`** — Used by all mutations. Sends JSON with cookie credentials.
- **Default query options:**
  - `staleTime: 30_000` — Data stays fresh for 30 s; no unnecessary refetches while navigating.
  - `refetchOnWindowFocus: false` — Prevents data reload just from switching browser tabs.
  - `refetchInterval: false` — No polling.
  - `retry: false` — Fail fast instead of retrying on errors.

### `client/src/lib/auth.tsx`
React context providing `{ user, isAdmin, isLoading, login, logout }` to the whole app.
- Calls `GET /api/auth/me` on mount to restore session.
- On `401`, checks `localStorage.session_expired` flag and shows the concurrent-login warning banner on the login page.
- `login(username, password)` calls `POST /api/auth/login`, stores token in `localStorage`, sets user state.
- `logout()` calls `POST /api/auth/logout`, clears token, redirects to `/login`.

### `client/src/lib/tts.ts` ← NEW
Text-to-speech utility for voice announcements.

- **`speakTTS(text: string)`** — POSTs `{ text }` to `/api/tts`, receives MP3 audio blob, creates an `<Audio>` element, and plays it. Revokes the object URL on end. Silent on any error (never crashes the UI).
- **`formatAmountForTTS(v: number)`** — Formats a number as a decimal string (e.g. `1234.56`) suitable for TTS reading.

**Used by:** `orders.tsx` (fired after successful order creation), `reservations.tsx` (fired after successful reservation creation).

### `client/src/lib/settings-context.tsx`
React context that fetches the Settings document from `/api/settings` and applies the active theme, font, color accent, and sidebar gradient globally by setting CSS variables and class names on `document.documentElement` and `document.body`. Every settings change in `settings.tsx` triggers a re-fetch here.

---

## Pages (`client/src/pages/`)

### `dashboard.tsx`
The main landing page after login. Shows KPI summary cards, revenue chart, order status breakdown, inventory status, recent orders table, top-selling items, and upcoming reservations. Fires 6 parallel API requests on mount. All are cached by TanStack Query for 30 s.

### `orders.tsx`
Full order management page.

**`CreateOrderDialog`** — Full-screen dialog (always maximized, no minimize/close buttons in header). 5-step wizard:
1. **Items** — Search bar with instant-add on click. Qty column uses **− qty + stepper buttons** (no text input). Validates at least one item is selected before proceeding.
2. **Customer** — Customer name (required), phone (optional), order type (walk-in, delivery, reservation types), order channel, optional delivery address.
3. **Payment** — Payment method (filtered by order type), payment status, delivery fee.
4. **Offers** — Auto-applied offers shown; can be removed per-item.
5. **Review** — Full summary before final submission.

On success: invalidates order cache, fires `speakTTS(...)` announcing order type, customer name, items, total, and payment method.

**`OrdersPage`** — Lists all orders with search, status filter, date filter. Each row links to `order-detail.tsx`.

### `reservations.tsx`
Reservations management page with two tabs: Calendar view and List view.

**`CreateReservationDialog`** — Modal dialog (not full-screen) for creating reservations directly from the Reservations page. Fields:
- Customer name (required), phone (optional)
- Reservation type: walk-in reservation or online reservation
- Scheduled date & time (required, `datetime-local` input)
- Order channel (walkin, email, sms, messenger, phone)
- Payment method (cash/GCash for walk-in; GCash only for online)
- Payment status, fulfillment status
- Items (optional — searchable with − qty + stepper, same UX as order dialog)
- Notes

On success: invalidates reservations cache, fires `speakTTS(...)` announcing type, customer name, scheduled date, items, total, and payment method.

**`generatePDF(reservation)`** — Generates a printable reservation slip PDF using jsPDF + autoTable. Currency is formatted via `pdfCurrency()` helper (outputs `PHP 1,234.56` — avoids the ± rendering bug in jsPDF Helvetica caused by the ₱ Unicode character).

**`CalendarView`** — Month calendar grid showing reservations as color-coded dots. Clicking a day opens a side panel with reservation details.

**`ReservationsListView`** — Filterable, paginated table of all reservations. Supports search, type, status, and payment filters. Bulk-confirm and bulk-ready actions. PDF export per reservation.

### `billing.tsx`
Payment management page. Shows all orders with outstanding balances. Click any order to open the payment logging sheet. Supports GCash reference number entry and validates for duplicates.

### `accounting.tsx`
General ledger and chart-of-accounts management. Shows all ledger entries with date, account, debit/credit, and description. Manual entry creation. Entry reversal.

### `reports.tsx`
Admin-only reports page with date-range filtering.

- **Sales Report** — Revenue and order count by day. PDF export uses `pdfCurrency()` helper.
- **Inventory Report** — Current stock levels, value at cost vs. sell price.
- **Customer Report** — Orders and spend per customer.

### `inventory.tsx`
Full inventory management. Create, edit, restock, and adjust items. Image upload (pending admin approval). Stock movement log per item. Low/critical stock highlighted.

### `settings.tsx`
System configuration page.

**Cards:**
- Company Info — Name, store address, contact number.
- Theme — Light/dark mode toggle.
- Appearance — Font family (Google Fonts preview), color accent, sidebar gradient.
- GCash Settings — Wallet number and QR image URL.
- Offers — Auto-apply offers toggle, show savings summary toggle.
- **Voice Announcements (TTS)** ← NEW — Dropdown to select from 6 Microsoft Edge Neural voices:
  - `en-US-AriaNeural` — Aria, warm expressive (US English, default)
  - `en-US-GuyNeural` — Guy, deep authoritative (US English)
  - `en-GB-SoniaNeural` — Sonia, crisp literary (British)
  - `en-GB-RyanNeural` — Ryan, dramatic clear (British)
  - `en-AU-NatashaNeural` — Natasha, smooth natural (Australian)
  - `en-IE-EmilyNeural` — Emily, gentle immersive (Irish)

Selecting a voice and saving updates the `ttsVoice` field in the Settings document. The `/api/tts` route reads this value on every TTS request.

### `users.tsx`
User management. Admin only. Create, activate/deactivate, change password, change role. Deactivating a user immediately kills all their sessions.

### `order-detail.tsx`
Detailed view for a single order. Shows all fields, item list, payment history, status history timeline, and notes. Staff can update status, log payments, and add notes.

### `system-logs.tsx`
Read-only audit log viewer. All system actions with filters by action type, actor, and date range. Admin only.

### `maintenance.tsx`
Database backup and restore. Manual backup, list of backup files, download, delete. Admin image approval queue for pending item photos. Admin only.

### `login.tsx`
Login form. On mount, checks `localStorage.session_expired` flag and displays an amber banner: "Your session was ended because the account was logged in elsewhere." Clears the flag after displaying.

### `about.tsx` / `help.tsx`
Static informational pages.

### `not-found.tsx`
404 page shown for unmatched routes.

---

## Shared (`shared/schema.ts`)

Single source of truth for all TypeScript types and Zod validation schemas shared between client and server.

**Key schemas:**
- `createOrderSchema` / `CreateOrderInput` — Used by both `POST /api/orders` route (server-side validation) and `CreateOrderDialog` / `CreateReservationDialog` (client-side form validation via `zodResolver`).
- `settingsSchema` / `SettingsInput` — Used by `PATCH /api/settings` and `settings.tsx` form. Includes `ttsVoice: z.string().optional().default("en-US-AriaNeural")`.
- `createItemSchema`, `createCustomerSchema`, `logPaymentSchema`, `inventoryLogSchema`, `ledgerEntrySchema`, `offerSchema` — Each used in corresponding route and page.

**Key interfaces (not Zod, just TypeScript):**
- `IOrder` — Full order object as returned by the API.
- `IItem` — Inventory item.
- `ICustomer`, `IUser`, `ISettings`, `IOffer`, `IBillingPayment`, `IInventoryLog`, `ILedgerEntry`.

**Constants:**
- `ORDER_TYPES`, `ORDER_TYPE_LABELS` — All valid order types with display labels.
- `ORDER_CHANNELS`, `ORDER_CHANNEL_LABELS` — Channel options.
- `PAYMENT_METHODS`, `PAYMENT_METHOD_LABELS` — Payment method options.
- `PAYMENT_STATUSES`, `PAYMENT_STATUS_LABELS` — Payment status options.
- `FULFILLMENT_STATUSES`, `FULFILLMENT_STATUS_LABELS` — Fulfillment status options.
- `ALLOWED_PAYMENT_METHODS` — Per-order-type map of which payment methods are valid.

---

## Key Flows

### Authentication Flow
1. User submits username + password on `login.tsx`
2. `POST /api/auth/login` verifies bcrypt hash
3. **All prior sessions for that user are deactivated in DB + evicted from the in-memory cache** (concurrent login enforcement)
4. New `UserSession` created, JWT generated and returned in cookie + body
5. `auth.tsx` stores token in `localStorage`, sets user context
6. Every subsequent API call goes through `authMiddleware`:
   - Token extracted from cookie
   - Checked against **in-memory session cache** (30 s TTL) → fast path, no DB
   - Cache miss: parallel `UserSession.findOne` + `User.findById` with `.lean()`
   - Cache populated on success

### Order Creation Flow
1. Staff opens "Create New Order" (full-screen dialog, always maximized)
2. Searches items — clicking an item immediately adds it with qty 1
3. Qty adjusted via − / + stepper buttons (no text input)
4. Staff fills in customer, payment details across 5 steps
5. Validation enforced at each step transition (cannot proceed until required fields are filled)
6. On submit: `POST /api/orders` → stock deducted, tracking number generated, status history initialized
7. On success: TanStack Query cache invalidated, **`speakTTS()`** fires to announce the order aloud

### Reservation Creation Flow (from Reservations page)
1. Staff clicks "New Reservation" button in the Reservations page header
2. `CreateReservationDialog` opens (modal, not full-screen)
3. Fills: customer name, phone, reservation type, scheduled date/time, channel, payment method, optional items (with − / + stepper), notes
4. Validation on submit: customer name + scheduled date required
5. On submit: `POST /api/orders` with `orderType` = `walkin_reservation` or `online_reservation`
6. On success: reservations cache invalidated, **`speakTTS()`** fires to announce the reservation

### TTS Announcement Flow
1. Order or reservation created successfully
2. `speakTTS(text)` called from the frontend
3. `POST /api/tts` with `{ text }` body
4. Server reads `ttsVoice` from Settings document
5. `MsEdgeTTS` connects to Microsoft Edge TTS WebSocket service
6. MP3 audio streamed back as `audio/mpeg` response
7. Client creates Blob URL, plays via `HTMLAudioElement`, revokes URL on end

### PDF Export Flow (Reservations)
1. Staff clicks PDF button on a reservation in the list
2. `generatePDF(reservation)` runs entirely client-side (jsPDF + autoTable)
3. All currency values formatted via `pdfCurrency()` → `PHP 1,234.56` (avoids ₱ → ± bug in Helvetica)
4. PDF opened in a new browser tab

### Settings → Theme/Font/Color Flow
1. Admin changes a setting in `settings.tsx` and saves
2. `PATCH /api/settings` updates the document
3. `SettingsProvider` re-fetches and re-runs the `useEffect`
4. CSS variables and class names on `<html>` and `document.body` are updated
5. Theme, colors, font, and sidebar gradient change immediately without page reload

### Auto-Backup
1. Admin enables auto-backup in `settings.tsx` with an interval
2. Server `PUT /api/settings` handler calls `setupAutoBackupScheduler()`
3. The old `node-cron` job is stopped, a new one is started with the correct cron expression
4. At each interval, `performAutoBackup()` runs: dumps all collections to JSON, saves to `/backups/`, records in `BackupHistory`
5. Admin can see, download, or delete backups from `maintenance.tsx`

---

## Performance Notes

### Auth Middleware Cache
The biggest single performance gain. Without the cache, every authenticated API request costs 3 sequential MongoDB round trips: `UserSession.findOne`, `User.findById`, `session.save`. The dashboard fires 6+ requests simultaneously — that was 18+ DB hits just for auth checks.

With the in-memory cache:
- Cache hit (within 30 s of last validation): **0 DB hits**
- Cache miss: **2 parallel DB hits** (instead of 3 sequential) using `Promise.all` + `.lean()`
- `lastActivity` update throttled to once per 60 s per token

### MongoDB Indexes on Order
Orders collection has indexes on `fulfillmentStatus`, `paymentStatus`, `orderType`, `orderChannel`, `createdAt`, `assignedTo`, `customerName` (text), `scheduledDate`, and `updatedAt`. `trackingNumber` is unique (automatic unique index). These cover all common query patterns in the orders, reservations, and reports routes.

### TanStack Query Caching
`staleTime: 30_000` means data fetched in the last 30 s is served from memory without a network round trip. `refetchOnWindowFocus: false` prevents unnecessary refetches when the user switches tabs.

---

## npm Scripts

| Script | Command | What it does |
|---|---|---|
| `npm run dev` | `NODE_ENV=development ./node_modules/.bin/tsx server/index.ts` | Starts the development server (Express + Vite middleware) |
| `npm run build` | `tsx script/build.ts` | Builds frontend to `dist/public/` and server to `dist/index.cjs` |
| `npm start` | `NODE_ENV=production node dist/index.cjs` | Starts the production server |
| `npm run check` | `tsc` | TypeScript type-checking only, no emit |
| `npm run db:push` | `drizzle-kit push` | Pushes Drizzle schema (legacy, not used — app uses Mongoose) |

---

## Default Credentials (after first run / seed)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | ADMIN |
| `employee` | `employee123` | EMPLOYEE |

**These are created automatically on first startup if the database is empty. Change them immediately in production via the Users page.**
