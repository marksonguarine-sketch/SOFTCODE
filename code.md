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
│       │   ├── gemini-chat.tsx
│       │   ├── tutorial.tsx
│       │   └── ui/          # 40+ shadcn/radix UI primitives
│       ├── hooks/           # Custom React hooks
│       │   ├── use-mobile.tsx
│       │   └── use-toast.ts
│       ├── lib/             # Client-side utilities and contexts
│       │   ├── auth.tsx
│       │   ├── queryClient.ts
│       │   ├── settings-context.tsx
│       │   └── utils.ts
│       └── pages/           # One file per route/page
│           ├── dashboard.tsx
│           ├── inventory.tsx
│           ├── orders.tsx
│           ├── order-detail.tsx
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
│   ├── routes.ts            # All API route handlers (~1954 lines)
│   ├── db.ts                # MongoDB connection
│   ├── seed.ts              # Initial data seeding
│   ├── static.ts            # Production static file serving
│   ├── vite.ts              # Development Vite middleware
│   ├── storage.ts           # Legacy MemStorage interface (unused in prod)
│   ├── middleware/
│   │   └── auth.ts          # JWT auth middleware + token generation
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
| Auth | Custom JWT with bcryptjs |
| Real-time | Socket.io |
| Scheduled jobs | node-cron |
| File uploads | Multer |
| Validation | Zod |
| PDF export | jsPDF + jspdf-autotable |

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
| `lastActivity` | Date | Updated on every authenticated request |

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

The most complex model. Each order has embedded line items, a full status history, an optional delivery address, and collaborative locking fields.

**Sub-schemas:**
- `orderItemSchema` — `{ itemId, itemName, quantity, unitPrice, lineTotal }` — no `_id`
- `statusEntrySchema` — `{ status, timestamp, actor, note }` — no `_id`

| Field | Type | Notes |
|---|---|---|
| `trackingNumber` | String | Unique auto-generated (e.g. `ORD-20240223-0001`) |
| `customerId` | ObjectId | Ref to Customer |
| `customerName` | String | Denormalized for display |
| `items` | Array | Embedded order items |
| `totalAmount` | Number | Sum of all line totals |
| `sourceChannel` | String | `phone`, `email`, `message`, or `walk-in` |
| `notes` | String | Free-text notes |
| `currentStatus` | String | Current stage of the order lifecycle |
| `statusHistory` | Array | Full audit trail of status changes |
| `address` | Object | Optional delivery address |
| `lockedBy` | String | Username of who has the order open for editing |
| `lockStartedAt` | Date | When the lock was acquired |
| `lockLastSeen` | Date | Heartbeat for the lock (prevents stale locks) |
| `assignedTo` | String | Username of the assigned employee |
| `assignedToName` | String | Display name |
| `assignedAt` | Date | When it was assigned |
| `assignedBy` | String | Who made the assignment |

**Status lifecycle:** Pending Payment → Paid → Pending Release → Released → In Transit → Completed

**Indexes:** on `currentStatus`, on `createdAt` (descending), on `assignedTo`

**Used by:** order routes, billing routes, dashboard stats, reports, global search

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

**Used by:** settings routes, settings-context.tsx (client reads and applies theme/font/colors), dashboard stats (reads reorder thresholds), auto-backup scheduler

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

**Exports three things:**

1. **`generateToken(payload)`** — Creates a JWT signed with `SESSION_SECRET` (or fallback `"joap-hardware-secret-key"`) that expires in 24 hours. The payload contains `_id`, `username`, and `role`.

2. **`authMiddleware`** — Applied to all protected routes. Extracts the JWT from either the `Authorization: Bearer <token>` header or the `token` cookie. Verifies the JWT signature, checks that a matching active session exists in `UserSession`, and confirms the user account is still active. If all checks pass, attaches `req.user` and calls `next()`. Updates `session.lastActivity` on each request.

3. **`adminOnly`** — Middleware that checks `req.user.role === "ADMIN"`. Returns 403 if not. Applied after `authMiddleware` on admin-only routes.

**Connects to:** `UserSession` model, `User` model, all route handlers in `routes.ts`

### `server/routes.ts`
The largest file in the project (~1954 lines). Registers all API endpoints on the Express app and sets up Socket.io. Every route returns JSON in the format `{ success: true, data: ... }` on success, or `{ success: false, error: "..." }` on failure, via the `ok()` and `fail()` helper functions.

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
- `POST /api/auth/login` — Validates username/password with `loginSchema`, checks user exists and is active, compares bcrypt hash, terminates any existing active sessions, creates a new UserSession, generates and returns a JWT in both the response body and an httpOnly cookie.
- `POST /api/auth/logout` — Marks the current session as inactive, clears the cookie.
- `GET /api/auth/me` — Returns the current authenticated user's profile (no password).
- `GET /api/config/maps-key` — Returns the Google Maps API key from environment variables (used by the order detail map view).

#### Dashboard Routes
- `GET /api/dashboard/stats` — Returns a snapshot: today's order count, completed orders, pending payments, pending releases, today's revenue, total revenue, active users (sessions active in last hour), total items, critical stock count, low stock count, total inventory value. Reads reorder/low-stock thresholds from Settings.
- `GET /api/dashboard/revenue-chart` — Revenue grouped by day for the last 30 days using MongoDB aggregation pipeline.
- `GET /api/dashboard/orders-by-status` — Count of orders grouped by `currentStatus`.
- `GET /api/dashboard/inventory-status` — Counts of healthy, low, and critical stock items.
- `GET /api/dashboard/recent-orders` — Last 10 orders sorted by creation date, with only essential fields.
- `GET /api/dashboard/top-items` — Top 10 items by total quantity sold, calculated by aggregating order line items.

#### Item/Inventory Routes
- `GET /api/items` — All items, supports `?search=`, `?category=`, `?lowStock=true`, `?page=` and `?limit=` for pagination.
- `POST /api/items` — Creates a new item. Admin only. Validates with `createItemSchema`. Logs `ITEM_CREATED`, emits `item:created` socket event.
- `PUT /api/items/:id` — Updates an item. Admin only. Logs `ITEM_UPDATED`, emits `item:updated`.
- `DELETE /api/items/:id` — Soft-check: if item is referenced in any order, the delete is blocked. Admin only. Logs `ITEM_DELETED`, emits `item:deleted`.
- `POST /api/items/:id/inventory-log` — Adjusts stock (restock, deduction, adjustment). Updates `currentQuantity` on the item, creates an `InventoryLog` entry. Logs `INVENTORY_ADJUSTED`, emits `inventory:updated`.
- `GET /api/items/:id/inventory-logs` — Returns all inventory log entries for a specific item.
- `POST /api/items/:id/image` — Employee image upload via Multer. Sets `imagePending: true` on the item, creates an `ImageApproval` record.
- `GET /api/items/:id/image` — Streams the approved image file from disk.
- `GET /api/items/categories` — Returns a list of all distinct category values.

#### Customer Routes
- `GET /api/customers` — All customers. Supports `?search=`.
- `POST /api/customers` — Creates a new customer. Validates with `createCustomerSchema`.
- `PUT /api/customers/:id` — Updates customer info.
- `DELETE /api/customers/:id` — Deletes a customer (blocked if they have orders).

#### Order Routes
- `GET /api/orders` — All orders with pagination. Supports filtering by `?status=`, `?search=`, `?assignedTo=`, and date range.
- `POST /api/orders` — Creates a new order. Validates with `createOrderSchema`. Generates a unique tracking number in format `ORD-YYYYMMDD-NNNN`. Deducts stock from each item. Creates initial status history entry. Logs `ORDER_CREATED`, emits `order:created`.
- `GET /api/orders/:id` — Returns a single order with full details.
- `PUT /api/orders/:id/status` — Changes the order status. Validates the transition is allowed. Appends to `statusHistory`. Logs `ORDER_STATUS_CHANGED`, emits `order:updated`.
- `PUT /api/orders/:id/assign` — Assigns the order to an employee. Admin only.
- `POST /api/orders/:id/lock` — Acquires a collaborative edit lock. Prevents two users from editing the same order simultaneously. Lock expires after 30 seconds of no heartbeat.
- `DELETE /api/orders/:id/lock` — Releases the lock.
- `POST /api/orders/:id/lock/heartbeat` — Refreshes the lock timer.
- `GET /api/orders/:id/payments` — Returns all payments for a specific order.

#### Billing/Payment Routes
- `GET /api/billing/payments` — All payments across all orders, paginated.
- `POST /api/billing/payments` — Logs a new payment against an order. Validates with `logPaymentSchema`. Checks for duplicate GCash reference numbers. Automatically creates a General Ledger entry (debit Cash, credit Sales Revenue). Moves the order status from Pending Payment to Paid if fully paid. Logs `PAYMENT_LOGGED`, emits `billing:payment`.

#### Accounting Routes
- `GET /api/accounting/accounts` — All chart-of-accounts entries with current balances.
- `POST /api/accounting/accounts` — Creates a new account. Admin only.
- `PUT /api/accounting/accounts/:id` — Updates an account.
- `DELETE /api/accounting/accounts/:id` — Deletes an account.
- `GET /api/accounting/ledger` — All general ledger entries, paginated. Supports date range filter.
- `POST /api/accounting/ledger` — Manually creates a ledger entry. Admin only. Validates with `ledgerEntrySchema`. Updates the affected account balance.
- `POST /api/accounting/ledger/:id/reverse` — Creates a reversing entry that negates the original. Marks the original as reversed.
- `GET /api/accounting/summary` — Totals: total revenue (sum of credits on Sales Revenue account), total expenses (sum of debits on Expense accounts), and net profit.

#### User Management Routes (Admin only)
- `GET /api/users` — All users (passwords excluded).
- `POST /api/users` — Creates a new user. Validates with `createUserSchema`. Hashes password. Logs `USER_CREATED`.
- `PUT /api/users/:id` — Updates user info or resets password. Logs `USER_UPDATED`.
- `PUT /api/users/:id/toggle-active` — Enables or disables a user account. Logs `USER_DEACTIVATED` or `USER_REACTIVATED`.
- `DELETE /api/users/:id` — Deletes a user. Cannot delete the currently logged-in user. Logs `USER_DELETED`.

#### Settings Routes (Admin only)
- `GET /api/settings` — Returns the current settings document.
- `PUT /api/settings` — Updates settings. Validates with `settingsSchema`. If auto-backup settings change, reconfigures the cron job. Logs `SETTINGS_UPDATED`.

#### Reports Routes
- `GET /api/reports/revenue` — Revenue breakdown by time period (daily/weekly/monthly). Uses MongoDB date aggregation.
- `GET /api/reports/inventory` — Current inventory snapshot with value calculations per item.
- `GET /api/reports/orders` — Order counts by status and by channel.
- `GET /api/reports/top-products` — Most sold products by quantity and by revenue.

#### System Logs Routes (Admin only)
- `GET /api/system-logs` — All system log entries, paginated and filterable by action type and actor.
- `DELETE /api/system-logs` — Clears all system logs. Logs the clearing action immediately after.

#### Maintenance / Backup Routes (Admin only)
- `GET /api/maintenance/backups` — Lists all backup files from `BackupHistory`.
- `POST /api/maintenance/backup` — Triggers a manual full backup. Serializes all MongoDB collections to JSON, writes to `/backups/` directory, records in `BackupHistory`.
- `GET /api/maintenance/backups/:filename/download` — Streams a backup JSON file as a download.
- `DELETE /api/maintenance/backups/:filename` — Deletes a backup file from disk and from `BackupHistory`.
- `POST /api/maintenance/restore` — Accepts a JSON backup file upload. Clears all collections and re-inserts data from the backup. Admin only.
- `GET /api/maintenance/image-approvals` — Lists all pending image approval requests.
- `POST /api/maintenance/image-approvals/:id/approve` — Approves an image: copies `pendingImageFilename` to `imageFilename` on the Item, marks the approval as approved.
- `POST /api/maintenance/image-approvals/:id/reject` — Rejects an image: deletes the pending file from disk, resets the item's pending state.

#### Search Route
- `GET /api/search?q=<query>` — Global search across Items (by name/barcode), Orders (by tracking number/customer name), and Customers (by name). Returns up to 5 results per category, each with a type, id, label, and sublabel for display in the search dropdown.

#### File Serving
- `GET /uploads/:filename` — Serves uploaded item images from the `/uploads/` directory.

**Auto-backup Scheduler:**
Uses `node-cron` to schedule `performAutoBackup()` at intervals defined in Settings. On server start, reads Settings and if `autoBackupEnabled` is true, sets up the cron job. The scheduler is reconfigured whenever Settings are updated via the API. Supports hourly, daily, and weekly intervals.

**Socket.io Events emitted:**
- `item:created`, `item:updated`, `item:deleted`
- `order:created`, `order:updated`
- `inventory:updated`
- `billing:payment`

### `server/static.ts`
Used only in production (`NODE_ENV=production`). Serves the compiled Vite output from `dist/public/` as static files. All non-API routes fall through to `index.html` (enabling client-side routing with Wouter).

**Connects to:** `server/index.ts` (called conditionally)

### `server/vite.ts`
Used only in development (`NODE_ENV=development`). Creates a Vite dev server in middleware mode and attaches it to the Express app. Serves the React frontend with hot module replacement. Every request to a non-API path serves `client/index.html` through Vite's transform pipeline. Uses `nanoid` to cache-bust the main.tsx import on every request.

**Connects to:** `server/index.ts` (called conditionally), `vite.config.ts`

### `server/storage.ts`
A legacy in-memory storage class (`MemStorage`) with a `IStorage` interface that defines `getUser`, `getUserByUsername`, and `createUser`. This was scaffolded as a placeholder but is **not used in production** — all data storage uses Mongoose models directly. It remains in the codebase but has no active callers.

---

## Shared Types (`shared/schema.ts`)

This file is imported by both the frontend (`client/`) and backend (`server/`) and is the single source of truth for:

**Constants/enums:**
- `UserRole` — `ADMIN` | `EMPLOYEE`
- `OrderStatus` — `Pending Payment` | `Paid` | `Pending Release` | `Released` | `In Transit` | `Completed`
- `InventoryLogType` — `restock` | `deduction` | `adjustment`

**Zod validation schemas (used on the server to validate incoming request bodies):**
- `loginSchema` — username + password
- `createUserSchema` — username (min 3), password (min 6), role
- `createItemSchema` — itemName, category, supplierName, unitPrice, currentQuantity, avgDailyUsage, leadTimeDays, safetyStock
- `createCustomerSchema` — name, email, phone, address
- `createOrderSchema` — customerId, customerName, items array, sourceChannel, notes, address
- `logPaymentSchema` — orderId, paymentMethod, gcashNumber, gcashReferenceNumber (8-20 chars), amountPaid, paymentDate, proofNote
- `inventoryLogSchema` — itemId, type, quantity, reason
- `settingsSchema` — companyName, theme, reorderThreshold, lowStockThreshold, font, colorTheme, gradient
- `ledgerEntrySchema` — date, accountName, debit, credit, description, referenceType, referenceId

**TypeScript interfaces (used on the frontend for type safety):**
- `IUser`, `IItem`, `ICustomer`, `IOrder`, `IOrderItem`, `IStatusEntry`, `IOrderAddress`
- `IBillingPayment`, `IInventoryLog`, `IAccountingAccount`, `IGeneralLedgerEntry`
- `ISystemLog`, `ISettings`, `DashboardStats`

The `@shared/schema` path alias is configured in `tsconfig.json` and `vite.config.ts` so both sides can import it the same way.

---

## Frontend Application (`client/src/`)

### `client/src/main.tsx`
Single line of logic: mounts `<App />` into `#root`. Imports `index.css` for global styles.

### `client/src/index.css`
Global stylesheet. Contains:
- `@tailwind base; @tailwind components; @tailwind utilities;` directives
- CSS custom properties (`--background`, `--foreground`, `--primary`, etc.) for the shadcn/ui design token system, in both `:root` (light mode) and `.dark` (dark mode) scopes
- `.hover-elevate` utility class that adds a subtle shadow + translate animation on hover
- `.sidebar-gradient` class that applies the `--sidebar-gradient` CSS variable as a background

### `client/src/App.tsx`
The root React component. Wraps everything in providers and handles top-level routing logic.

**Provider hierarchy (outermost to innermost):**
```
QueryClientProvider → TooltipProvider → AuthProvider → AppContent
                                                          └─ if logged in → SettingsProvider → AuthenticatedLayout
                                                          └─ if not logged in → LoginPage
```

**Components defined in this file:**

**`Router`** — Defines all client-side routes using Wouter `<Switch>/<Route>`:
- `/` → DashboardPage
- `/inventory` → InventoryPage
- `/orders` → OrdersPage
- `/orders/:id` → OrderDetailPage
- `/billing` → BillingPage
- `/users` → UsersPage
- `/accounting` → AccountingPage
- `/reports` → ReportsPage
- `/settings` → SettingsPage
- `/about` → AboutPage
- `/help` → HelpPage
- `/system-logs` → SystemLogsPage
- `/maintenance` → MaintenancePage
- `*` → NotFound

**`GlobalSearch`** — A search bar in the top header. Debounces keystrokes by 300ms, calls `GET /api/search?q=<query>`, shows a dropdown with results grouped by type (item/order/customer). Clicking a result navigates to the relevant page. Closes on click-outside.

**`AuthenticatedLayout`** — The main app shell shown to logged-in users. Contains:
- `<AppSidebar />` — left navigation
- A sticky top header with the sidebar toggle, `GlobalSearch`, username display, and logout button
- `<Router />` — the page content area
- `<GeminiFloatingChat />` — the AI assistant button
- `<Tutorial />` — the interactive guided tutorial (shown on demand)
- A tutorial prompt dialog (asks on first login)
- A logout confirmation dialog

**`AppContent`** — Checks auth state. Shows a spinner while loading. Shows `<LoginPage />` if not authenticated. Shows `<AuthenticatedLayout />` if authenticated.

**`App`** — The exported default. Wraps everything in providers and renders `<Toaster />` for toast notifications.

---

## Client Pages (`client/src/pages/`)

### `login.tsx`
The login screen shown to unauthenticated users. A centered card with username and password fields. On submit, calls `useAuth().login(username, password)`. Shows error messages. Has a "forgot password" link (UI only, no backend implementation visible). The JOAP Hardware logo/icon is shown at the top.

### `dashboard.tsx`
The home page after login. Fetches data from:
- `GET /api/dashboard/stats` — shows 9 KPI cards (today's orders, revenue, inventory value, etc.)
- `GET /api/dashboard/revenue-chart` — Recharts AreaChart of revenue over last 30 days
- `GET /api/dashboard/orders-by-status` — Recharts PieChart of order distribution
- `GET /api/dashboard/inventory-status` — horizontal bar or stat cards for stock health
- `GET /api/dashboard/recent-orders` — a table of the last 10 orders

All data is refetched every 30 seconds. The page also connects to Socket.io and invalidates relevant queries when real-time events arrive (`order:created`, `billing:payment`, etc.).

### `inventory.tsx`
Full inventory management page. Features:
- A searchable, filterable, paginated data table of all items
- Category filter dropdown
- Low-stock filter toggle
- "Add Item" dialog form (admin only) — uses `createItemSchema` validation
- Edit item inline (admin only)
- Delete item with confirmation (admin only)
- Stock adjustment dialog — restock, deduction, or manual adjustment with reason
- Image upload (employees can upload, admins see approval status)
- Displays item image thumbnails if an approved image exists
- Stock status badges: "Critical", "Low", "OK"
- Reorder point calculation display (avgDailyUsage × leadTimeDays + safetyStock)

Fetches `GET /api/items` with query parameters. Mutations use `apiRequest` and invalidate the items query cache. Listens to Socket.io for real-time item and inventory updates.

### `orders.tsx`
Order list and creation page. Features:
- Paginated list of all orders with status badges
- Filter by status, search by tracking number or customer name
- "Create Order" dialog: select/search customers, add line items (each with item, quantity, price), notes, source channel, delivery address
- Stock availability check before adding items
- Order assignment (admin only): assign to an employee
- Real-time updates via Socket.io

### `order-detail.tsx`
Detailed view for a single order, accessed via `/orders/:id`. Features:
- Full order information: customer, items table, total, status, timestamps
- Collaborative lock indicator — shows who else has the order open
- Status advancement buttons — moves order through lifecycle stages
- Payment history tab — lists all payments logged against this order
- Delivery address with optional Google Maps embed
- Status history timeline
- Heartbeat polling every 10 seconds to maintain the edit lock

### `billing.tsx`
Payment management page. Features:
- Searchable list of all payments across all orders
- "Log Payment" dialog: select an order (shows outstanding balance), enter GCash number, reference number, amount, date
- Validates that the reference number is unique and amount > 0
- After logging, automatically updates the order status if fully paid
- Displays payment status per order (partially paid / fully paid)

### `accounting.tsx`
Double-entry bookkeeping page. Two tabs:

**Chart of Accounts tab:**
- Table of all accounts (Code, Name, Type, Balance)
- Add / edit / delete accounts (admin only)

**General Ledger tab:**
- Chronological log of all ledger entries
- Date range filter
- Manual entry creation dialog (admin only)
- Entry reversal button — creates a reversing entry and marks the original

### `reports.tsx`
Business intelligence and reporting page. Features:
- Revenue report: daily/weekly/monthly breakdown with bar charts (Recharts)
- Inventory report: table of all items with quantity and value
- Orders report: by status and by source channel
- Top products: most sold items by quantity and by revenue
- Export to PDF button (uses jsPDF + jspdf-autotable)
- Date range picker for filtering

### `users.tsx`
User management page (admin only). Features:
- Table of all user accounts with role badges and active/inactive status
- "Add User" dialog
- Edit user (change username, role)
- Reset password
- Toggle active/inactive status
- Delete user (with confirmation; cannot delete yourself)

### `settings.tsx`
System settings page (admin only). Features:
- Company name field
- Theme toggle (light/dark)
- Color accent selector (10 options: blue, emerald, purple, rose, orange, teal, indigo, amber, cyan, slate)
- Font selector (10 Google Fonts options)
- Sidebar gradient selector (10 gradient options)
- Stock threshold fields (reorder threshold, low-stock threshold)
- Auto-backup configuration (enable/disable, interval value, interval unit)
- Save button — PUTs to `/api/settings`

Changes to theme/colors/fonts apply live via `SettingsProvider` without page reload.

### `system-logs.tsx`
Audit trail viewer (admin only). Features:
- Paginated table of all SystemLog entries
- Filter by action type (dropdown) and by actor (search)
- Timestamp display
- Metadata display (shows what changed)
- Clear all logs button (with confirmation)

### `maintenance.tsx`
System maintenance tools (admin only). Three sections:

**Backup & Restore:**
- List of all backup files with file size and creation date
- "Create Backup" button — triggers manual backup
- Download backup as JSON file
- Delete backup
- Restore from backup (upload a JSON file — this REPLACES all data)

**Image Approvals:**
- List of pending item image submissions from employees
- Preview the uploaded image
- Approve button — goes live on the item
- Reject button — discards the image

### `about.tsx`
Static informational page describing the JOAP Hardware Trading system, its purpose, and technology stack. No API calls.

### `help.tsx`
Static help/documentation page with feature descriptions and usage instructions organized in an accordion. No API calls.

### `not-found.tsx`
404 page shown when no route matches. Has a "Go Home" link.

---

## Client Components (`client/src/components/`)

### `app-sidebar.tsx`
The left navigation sidebar. Uses the shadcn/ui `Sidebar` compound components.

**Navigation sections:**
1. **Header** — Logo icon + "JOAP Hardware Trading" brand name + "Supplier Management" subtitle
2. **Navigation group** — main nav items: Dashboard, Inventory, Orders, Billing, Accounting, Reports
3. **Administration group** — admin-only items: Users, Settings, Maintenance, System Logs (only shown if `isAdmin` is true)
4. **Footer** — Help, About links + current username/role badge

The active route is highlighted using Wouter's `useLocation()`. The sidebar reads `settings.gradient` from `SettingsProvider` and dynamically applies the `.sidebar-gradient` CSS class to the sidebar inner element via a DOM query.

### `gemini-chat.tsx`
A floating AI assistant chat widget. Renders as a circular button in the bottom-right corner. Clicking it opens a chat panel. Communicates with Google's Gemini API (via `@google/generative-ai` or a backend proxy route) to answer questions about the app or general queries. The chat panel has a message history, input field, and send button. Accessible to all logged-in users.

### `tutorial.tsx`
An interactive guided tour of the application. When triggered, it overlays a semi-transparent backdrop and walks users through each feature section with text callouts. Originally designed to use the Gemini TTS API for voice narration, the code includes a comment noting it should use local MP3 files instead (`tut1.mp3` through `tut17.mp3` in `/tutorial_mp3/`). The tutorial also includes a planned "alive cursor" feature that would animate a simulated cursor to show users where to click/hover. The `Tutorial` component accepts `isAdmin` prop to show admin-specific steps, and `onComplete` callback fired when the tour ends.

### `dev_button.tsx`
A development utility button that is only rendered in development mode. Provides quick-access shortcuts for testing (e.g., auto-filling login forms, navigating to specific pages). Not shown in production.

### `client/src/components/ui/` (40+ files)
All shadcn/ui component primitives. These are copy-pasted from the shadcn/ui registry and wrap Radix UI primitives with Tailwind styling. They include:

`accordion`, `alert`, `alert-dialog`, `aspect-ratio`, `avatar`, `badge`, `breadcrumb`, `button`, `calendar`, `card`, `carousel`, `chart`, `checkbox`, `collapsible`, `command`, `context-menu`, `dialog`, `drawer`, `dropdown-menu`, `form`, `hover-card`, `input`, `input-otp`, `label`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`, `resizable`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `switch`, `table`, `tabs`, `textarea`, `toast`, `toaster`, `toggle`, `toggle-group`, `tooltip`

Each of these is a self-contained, accessible, styled React component. They are used throughout all pages for consistent UI.

The `sidebar.tsx` component is particularly complex — it implements the full collapsible sidebar system with mobile responsiveness, keyboard shortcut (`Ctrl+B`), cookie persistence for open/closed state, and all sub-components (`SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, etc.).

The `chart.tsx` component wraps Recharts with the shadcn/ui chart configuration system that allows consistent color theming for charts.

---

## Client Hooks (`client/src/hooks/`)

### `use-mobile.tsx`
A custom hook `useMobile()` that returns `true` if the viewport width is below 768px. Uses `window.matchMedia` and updates on resize. Used by the sidebar component to determine mobile behavior.

### `use-toast.ts`
The toast notification system from shadcn/ui. Provides `useToast()` hook and `toast()` function. Manages a queue of toast messages with a maximum of 1 visible at a time. The `<Toaster />` component in `App.tsx` renders them. Used throughout pages to show success/error notifications after API calls.

---

## Client Libraries (`client/src/lib/`)

### `auth.tsx`
React Context provider for authentication state. The `AuthProvider` wraps the app and:
- Initializes token from `localStorage.getItem("token")`
- On mount, if a token exists, calls `GET /api/auth/me` to validate it and load the user profile
- Exposes `user`, `token`, `isAdmin`, `isLoading`, `login()`, and `logout()`
- `login(username, password)` — POSTs to `/api/auth/login`, stores the returned token in localStorage and state
- `logout()` — POSTs to `/api/auth/logout`, removes token from localStorage and clears user state
- `useAuth()` hook — throws if used outside `<AuthProvider>`

The entire app is gated on `user` being non-null. If `user` is null and loading is done, `<LoginPage />` is shown.

### `queryClient.ts`
Configures the TanStack Query client and provides the `apiRequest()` helper function.

**`apiRequest(method, url, data)`** — Makes authenticated fetch requests. Automatically attaches the `Authorization: Bearer <token>` header from localStorage. Throws an error if the response is not OK.

**`getQueryFn({ on401 })`** — A factory that creates TanStack Query `queryFn`s. Used as the default `queryFn`. Automatically attaches auth headers. If `on401: "returnNull"` is set, returns null on 401 instead of throwing. The URL is constructed from the `queryKey` (joined with `/`).

**Query client defaults:**
- No refetch on window focus
- 30-second stale time
- No automatic retry
- All queries use `getQueryFn({ on401: "throw" })`

### `settings-context.tsx`
React Context provider for system settings. After login, `<SettingsProvider>` fetches `GET /api/settings` and applies the loaded settings to the DOM:
- Sets `document.body.style.fontFamily` to the selected Google Font (dynamically loading the font from Google Fonts if needed)
- Adds/removes the `.dark` class on `<html>` for dark mode
- Sets `--primary` and `--primary-foreground` CSS variables for the color theme
- Sets `--sidebar-gradient` CSS variable for the sidebar gradient

**Exports:**
- `useSettings()` hook
- `GRADIENT_OPTIONS` — record of gradient key → label + CSS value (also imported by `app-sidebar.tsx`)
- `SettingsProvider` component

Settings are re-applied reactively whenever the settings document changes (e.g., after saving on the Settings page).

### `utils.ts`
Single exported function `cn(...inputs)` that merges Tailwind class names using `clsx` + `tailwind-merge`. Used everywhere to conditionally apply CSS classes without conflicts.

---

## Build System

### `vite.config.ts`
Configures Vite for the frontend build:
- Entry: `client/index.html`
- Output: `dist/public/` (so Express can serve it as static files)
- Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`, Replit-specific plugins (`@replit/vite-plugin-runtime-error-modal`, `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`) active only in development
- Path aliases: `@` → `client/src`, `@shared` → `shared`
- Resolve extensions for TypeScript

### `script/build.ts`
Production build script invoked by `npm run build`. Does two things in sequence:

1. **`viteBuild()`** — Compiles and bundles the React frontend into `dist/public/`

2. **esbuild** — Compiles and bundles the Express server (`server/index.ts`) into `dist/index.cjs` (CommonJS). Uses an allowlist of packages to bundle (reducing cold start time), and externalizes all others. Minifies the output. Sets `NODE_ENV=production`.

The `dist/` directory is cleaned before each build.

### `tailwind.config.ts`
Configures Tailwind CSS:
- Content paths scan `client/src/**/*.{ts,tsx}` and `client/index.html`
- Dark mode via `class` strategy (toggled by adding `.dark` to `<html>`)
- Extends the theme with the shadcn/ui design tokens (using CSS variables for all colors)
- Adds `tailwindcss-animate` and `tw-animate-css` plugins

### `postcss.config.js`
Standard PostCSS config. Just enables Tailwind CSS processing.

### `components.json`
shadcn/ui configuration file. Tells the `shadcn` CLI where to place components (`client/src/components/ui`), what style to use (default), the path aliases, and the base color (slate). Used when adding new UI components from the shadcn CLI.

### `tsconfig.json`
TypeScript compiler configuration:
- Target: ESNext
- Module: ESNext
- `moduleResolution: bundler` (works with Vite)
- `paths`: `@/*` → `client/src/*`, `@shared/*` → `shared/*`
- Strict mode enabled
- Includes `client/src`, `server`, `shared`, `script`

---

## Environment Variables

| Variable | Where Used | Notes |
|---|---|---|
| `MONGODB_URI` | `server/db.ts` | **Required.** MongoDB Atlas connection string |
| `SESSION_SECRET` | `server/middleware/auth.ts` | JWT signing secret. Defaults to `"joap-hardware-secret-key"` if not set (insecure in prod) |
| `PORT` | `server/index.ts` | Server port. Defaults to `5000` |
| `NODE_ENV` | `server/index.ts`, `vite.config.ts` | `development` or `production` |
| `GOOGLE_API_KEY` | `server/routes.ts` `/api/config/maps-key` | Optional. Google Maps API key for order delivery map view |

---

## Data Flow: How Features Connect End-to-End

### Login Flow
1. User enters credentials in `login.tsx`
2. `useAuth().login()` in `auth.tsx` calls `POST /api/auth/login`
3. Server validates password, creates a `UserSession`, generates JWT
4. JWT stored in `localStorage` and set as httpOnly cookie
5. `auth.tsx` sets `user` state → `AppContent` renders `AuthenticatedLayout`
6. `SettingsProvider` fetches settings and applies theme/font to DOM

### Creating an Order
1. User fills the "Create Order" dialog in `orders.tsx`
2. `apiRequest("POST", "/api/orders", data)` is called
3. Server validates with `createOrderSchema`
4. Server generates tracking number, deducts stock from each `Item`, creates the `Order`
5. Server logs `ORDER_CREATED` to `SystemLog`, emits `order:created` via Socket.io
6. Client receives the socket event, invalidates the `orders` query cache
7. The new order appears in the list

### Logging a Payment
1. User submits the payment dialog in `billing.tsx`
2. `apiRequest("POST", "/api/billing/payments", data)` is called
3. Server validates with `logPaymentSchema`, checks for duplicate reference number
4. Server creates `BillingPayment`, creates `GeneralLedgerEntry` (debit Cash/GCash, credit Sales Revenue)
5. Server checks if order is now fully paid → advances order status
6. Logs `PAYMENT_LOGGED`, emits `billing:payment` socket event
7. Dashboard stats and revenue chart update in real-time

### Settings / Theme Change
1. Admin saves new settings in `settings.tsx`
2. `apiRequest("PUT", "/api/settings", data)` updates the `Settings` document
3. TanStack Query cache for `/api/settings` is invalidated
4. `SettingsProvider` re-fetches and re-runs the `useEffect`
5. CSS variables and class names on `<html>` and `document.body` are updated
6. Theme, colors, font, and sidebar gradient change immediately without page reload

### Auto-Backup
1. Admin enables auto-backup in `settings.tsx` with an interval
2. Server `PUT /api/settings` handler calls `setupAutoBackupScheduler()`
3. The old `node-cron` job is stopped, a new one is started with the correct cron expression
4. At each interval, `performAutoBackup()` runs: dumps all collections to JSON, saves to `/backups/`, records in `BackupHistory`
5. Admin can see, download, or delete backups from `maintenance.tsx`

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
