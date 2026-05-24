# JOAP Hardware Trading — Code Documentation

**Last Updated**: 2026-05-24 (Session 3 — Major Feature Expansion)
**Build Status**: ✅ 0 TypeScript errors · ✅ Clean Vite + esbuild build
**Repo**: https://github.com/marksonguarine-sketch/SOFTCODE

A full-stack ERP for JOAP Hardware Trading built on React 18 + Vite + Express + MongoDB (Mongoose). This document is exhaustive — it explains every file that was touched, what it does, why it exists, and how the pieces wire together.

---

## Architecture overview

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query v5, Wouter (router), Socket.io-client
- **Backend**: Node.js, Express, MongoDB Atlas via Mongoose, Socket.io, edge-tts (text-to-speech via Microsoft Edge)
- **Auth**: JWT in httpOnly cookies + Bearer header fallback; bcrypt password hashing
- **Real-time**: Socket.io events + TanStack Query global polling (every 1 second)
- **Build outputs**: `dist/public/` (Vite frontend) + `dist/index.cjs` (esbuild server bundle, CJS)

The system is **bootable without an .env file** — MongoDB URI is hardcoded in `server/server_mongo.ts` with env override fallback.

---

## 1. Real-time synchronization (global 1-second polling)

### `client/src/lib/queryClient.ts` — this code is the central TanStack Query configuration and the heart of the real-time sync

**Key responsibilities:**
- Configures the global `queryClient` singleton used by every page
- Provides `apiRequest()` — a fetch wrapper that automatically attaches the auth token and **throws cleanly** on non-OK responses (with JSON message parsing — see the bug fix below)
- Provides `getQueryFn` — the default query function that derives the URL from the query key
- Exports `startGlobalRealtimeSync()` — kicks off a 1-second `setInterval` that invalidates the most important query keys (`/api/orders`, `/api/orders?pool=true`, `/api/requests`, `/api/messages`, `/api/billing`, `/api/items`, etc.) so admin and employee views stay in sync without requiring a page refresh.

**Critical bug fix (the "unexpected token" error):**
The previous `throwIfResNotOk` consumed the response body via `res.text()` before the caller could parse it as JSON. The new implementation uses `res.clone()` to read the body for the error message **without consuming the original stream**, and prefers JSON `message`/`error` fields over plain text. This fixes the "Cannot claim order: unexpected token" and "Failed to start processing: unexpected token" errors employees were seeing.

```ts
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const cloned = res.clone();
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await cloned.json();
        if (json?.message) message = json.message;
      } else {
        const text = await cloned.text();
        if (text) message = text;
      }
    } catch {}
    throw new Error(message);
  }
}
```

**Polling configuration:**
- `refetchInterval: 1000` — every query refetches every 1 second
- `staleTime: 500` — data considered fresh for half a second to avoid double-fetching
- `refetchOnWindowFocus: true` — also refetches when the user returns to the tab
- `refetchIntervalInBackground: false` — pauses polling when the tab is hidden

In addition to the per-query polling, `startGlobalRealtimeSync()` runs a single global `setInterval` that calls `queryClient.invalidateQueries()` on the critical keys. This guarantees cross-page invalidation even when a page doesn't have its own query for a given key.

### `client/src/App.tsx` — this code is the top-level React component

Wires up `SettingsProvider`, `AuthProvider`, `QueryClientProvider`, and the `Router`. Now calls `startGlobalRealtimeSync()` on mount inside the `AuthenticatedLayout`.

Routes added in this session:
- `/pending-payment` → `PendingPaymentPage`
- `/requests` → `RequestsPage` (admin only via `AdminRoute`)
- `/employees` → `EmployeesPage` (admin only)
- `/profile` → `ProfilePage` (any logged-in user, but useful for employees)

The `<FloatingCalculator username={...} />` component is rendered globally so it's available on every page.

---

## 2. Order assignment & lifecycle

### `server/routes.ts` — this code defines the order assignment system that is the backbone of employee workflow

Key routes:

**`POST /api/orders/:id/claim`** (employee)
- Atomic `findByIdAndUpdate` with `$set` + `$unset` + `$push` operators (avoids document mutation issues)
- Task-lock check: an employee can hold only one **non-completedProcessingAt** order at a time
- Lock filter uses `$or: [{ completedProcessingAt: { $exists: false } }, { completedProcessingAt: null }]` plus `fulfillmentStatus: { $nin: ["completed", "cancelled", "ready"] }`
- On success emits `order:assigned` socket event so all clients invalidate immediately

**`POST /api/orders/:id/start-processing`**
- Sets `startedAt`, advances `fulfillmentStatus` from `"pending"` → `"processing"`
- Pushes a `statusHistory` entry; emits `order:status-changed`

**`POST /api/orders/:id/complete-processing`**
- Sets `completedProcessingAt`, advances `fulfillmentStatus` to `"ready"` (or `"completed"` if payment is already settled)
- This is the unlock point — after this call the employee can claim a new order

**`POST /api/orders/:id/assign`** (admin)
- Admin force-assigns an order to a user (bypasses task-lock)
- Resets `startedAt` and `completedProcessingAt` so the new assignee starts fresh

**`POST /api/orders/:id/unassign`** (admin)
- Returns the order to the pool by clearing `assignedTo`/`assignedAt`/`startedAt`/`completedProcessingAt`

**`GET /api/orders/my-active`** (employee)
- Returns ALL blocking orders for the current employee (the warning banner shows every active tracking number, not just one)
- Returns `{ order: firstActiveOrder, orders: [allBlockingOrders] }` — `order` kept for backwards-compat

**`POST /api/orders/check-duplicate`**
- Body: `{ customerName, itemIds }`
- Looks for a non-completed order with the same customer (case-insensitive) and at least one overlapping item
- Returns `{ duplicate: orderDoc | null }` — front-end shows an amber banner with a "See Order" button that navigates directly to the existing order

### `client/src/pages/orders.tsx` — this code is the unified Orders page for both admin and employee views

**`CreateOrderDialog`** (full-screen modal, 5-step wizard)
- Step 0: Customer name, order type, channel
- Step 1: Items (search + add)
- Step 2: Payment method + status
- Step 3: Fulfillment + delivery address
- Step 4: Review + submit
- **Duplicate check**: when leaving step 1, POSTs to `/api/orders/check-duplicate` and renders a `DuplicateOrderAlert` (amber banner with "See Order" button) if a match is found

**Employee view**
- Greeting header ("Good morning/afternoon/evening, {username}")
- **"Assigned to You"** section — only shows orders where `currentStatus !== "Completed"` AND `!completedProcessingAt` AND `fulfillmentStatus` is not `ready`/`completed`/`cancelled`. The Mark-as-Done bug is fixed here: once an employee marks an order done, it disappears entirely from this section.
- **"Pending Pool"** section — claim button per row, disabled when `isTaskLocked`. Warning banner now lists **all** blocking order tracking numbers (clickable buttons that navigate to the order detail).
- Employee can now create orders via the same `CreateOrderDialog` — new orders go straight to the pool.

**Admin view**
- **"Assigned Orders"** section at the top, grouped by employee. Filters: search input, view-employees dropdown, status filter (Not Yet / Done / All). Replaces the old "View by Staff Member" section.
- **"Pending Pool"** section — search input only, no dropdowns, no bulk update. Each row has an inline assign dropdown.
- **`AssignConfirmDialog`** — when admin picks an employee from the assign dropdown, this modal pops up showing the target employee's currently pending tasks (5 per page with index pagination). Admin can review workload before confirming.

### `client/src/pages/order-detail.tsx` — this code is the per-order page

Has the 3-step lifecycle tracker card (Assigned → Processing Started → Processing Complete), admin reassign/unassign controls, and the assignee's Start/Done buttons.

---

## 3. Requests system (Admin approval workflows)

### `server/models/Request.ts` — this code defines a new Mongoose model

One `Request` document represents an employee-initiated action that needs admin approval.

**Request types:**
- `ADD_ITEM` — employee requests to add a new inventory item (payload: `itemName`, `category`, `unitPrice`, `currentQuantity`, `supplier`, etc.)
- `TRANSFER_ORDER` — employee requests to transfer one of their assigned orders to another employee (payload: `orderId`, `trackingNumber`, `targetUsername`)
- `LEAVE` — employee requests time off (payload: `startDate`, `endDate`, `type`)

**Status lifecycle:** `pending → accepted | declined | cancelled`. Every transition is logged in the `history` array with actor, timestamp, and optional note.

### `server/routes.ts` — Request routes section

- `GET /api/requests` — admin sees all; employees see only their own. Supports filtering by `status` and `requestType`.
- `POST /api/requests` — create a new request
- `POST /api/requests/:id/cancel` — employee cancels their own pending request
- `POST /api/requests/:id/accept` — admin only. Performs the actual action:
  - `ADD_ITEM`: creates an `Item` document
  - `TRANSFER_ORDER`: reassigns the order to the target user via atomic update + emits `order:assigned` event
  - `LEAVE`: increments `approvedLeaves` on the `EmployeeProfile`
- `POST /api/requests/:id/decline` — admin only. For LEAVE, increments `rejectedLeaves`.

All accept/decline events emit `request:updated` socket events and write to system logs.

### `client/src/pages/requests.tsx` — this code is the admin-only Requests inbox page

**Layout:**
- Header with pending/decided counts
- Tabs: `All` | `Add Item` | `Transfer Order` | `Leave Request`
- Pending section (cards, click to open detail modal)
- Decided section (compact cards, click to view history)

**Detail modal:** shows type-specific payload (item details, transfer details, leave dates), reason, full history, and Accept/Decline buttons with optional note. Admin can compare workload before accepting transfer requests by seeing the recipient's pending tasks.

---

## 4. Messages system (Admin ↔ Employee)

### `server/models/Message.ts` — this code is a new Mongoose model for internal messaging

Fields: `direction` (`ADMIN_TO_EMPLOYEE` or `EMPLOYEE_TO_ADMIN`), `fromUsername`, `toUsername`, `subject`, `body`, `isRead`, `readAt`.

### `server/routes.ts` — Message routes section

- `GET /api/messages` — inbox for current user (or `?direction=sent` to see sent items)
- `GET /api/messages/admin/all` — admin sees all messages in the system
- `POST /api/messages` — send a message. Direction is auto-determined from sender's role.
- `PATCH /api/messages/:id/read` — recipient marks as read
- `DELETE /api/messages/:id` — single delete (admin can delete any; users can delete their own sent/received)
- `POST /api/messages/bulk-delete` — admin only, accepts `{ ids: string[] }` or empty to delete all

### `client/src/pages/help.tsx` — this code is the Help page with employee↔admin messaging

- Adds `InboxFromAdmin` component for employees — shows messages where `direction === "ADMIN_TO_EMPLOYEE"` above the "Send Message to Admin" form
- The send form now uses the new `/api/messages` route with `{ toUsername: "admin", subject, body }` shape
- Auto-mark-as-read fires on click

### `client/src/pages/employees.tsx` — message button

Includes a "Message" button in the admin profile modal that opens a dialog to compose a message to that employee.

### `client/src/components/app-sidebar.tsx` — unread badge

Shows an unread-message badge next to the Help nav link (`{unreadMessages}` count badge).

---

## 5. Employee Profile system

### `server/models/EmployeeProfile.ts` — this code is the extended profile model

Separate from `User` to keep auth lean. Fields: `username`, `employeeId` (e.g. `JOAP-00001`), `photoDataUrl` (base64), `email`, `contactNumber`, `hireDate`, `lateCount`, `approvedLeaves`, `rejectedLeaves`, `adminRemarks` (admin-only).

### `server/routes.ts` — Profile routes section

- `GET /api/employee-profile/me` — current user's profile (auto-creates with a JOAP-XXXXX ID on first call)
- `GET /api/employee-profile/:username` — admin only
- `PATCH /api/employee-profile/:username` — update (self or admin). `adminRemarks` is admin-only.
- `GET /api/employee-profile/:username/summary` — admin only. Returns full analytics package:
  - Profile + user data (including derived `lastLogin` from latest `UserSession.lastActivity`)
  - KPI: completed orders, reservations (30d), pending leaves, late count
  - Recent orders (20), reservations, system logs (50)
  - Per-day productivity chart data (last 7 days, count + revenue)
- `GET /api/employees` — list all employees with profile data joined

### `client/src/pages/employees.tsx` — this code is the admin-only Employees nav page

Shows employee cards in a grid (photo, name, employee ID, email, online indicator). Click opens the `ProfileModal`:

**ProfileModal content:**
- Header: photo + name + role badge + status badge + employee ID + hire date
- Admin actions: Upload Photo, Delete Photo, Message, Export PDF
- Account Info card: email, contact, account created, last login
- KPI cards: Completed Orders, Reservations (30d), Approved Leaves, Pending Leaves
- **Productivity chart** (Recharts BarChart, last 7 days)
- Tabs: Orders | Reservations | Activity Timeline — each paginated 5 per page with index buttons
- **PDF export** uses jsPDF + jspdf-autotable to generate a multi-page employee report including profile, KPI summary, and order history

### `client/src/pages/profile.tsx` — this code is the employee's My Profile page

Accessible from the sidebar.

**Sections:**
- Header card: photo (upload/delete via base64 data URL), name, role, employee ID, hire date
- Contact Information: email + contact number (editable, persists to MongoDB)
- Leave Management: approved/rejected leave counters, "Request Leave" button that opens a dialog (type, from/to dates, reason) and POSTs to `/api/requests` with `requestType: "LEAVE"`

---

## 6. Floating Calculator

### `client/src/components/floating-calculator.tsx` — this code is the Casio-style floating calculator

**Bubble mode (default):** A small circular button (48px) with a calculator icon. Click it to expand.

**Expanded mode:** A draggable 220px-wide panel with:
- Display (with operator preview)
- 20 buttons including AC, ±, %, ÷, ×, −, +, =, 0–9, .
- 4 memory buttons (MC, MR, M+, M−)

**Drag behavior:** Click + drag anywhere on the bubble or the title bar to reposition. A click without drag toggles expansion.

**Persistence:** The on/off toggle is per-user via `localStorage.getItem('joap_calc_${username}')`. The settings page dispatches a `joap-calc-toggle` event when the user flips the switch; this component listens and updates immediately. The state persists across logouts.

---

## 7. System Logs — User Log calendar view

### `client/src/pages/system-logs.tsx` — this code is the System Logs page with calendar view

Two tabs:

**All Logs tab** — the original log table, but `USER_LOGIN`/`USER_LOGOUT` are excluded from the action filter dropdown (they have their own tab now).

**User Log tab** — calendar view:
- Month navigation (prev / current label / next)
- 7-column day grid with login/logout counts per day (green `LogIn` icon for logins, red `LogOut` icon for logouts)
- Click a day to expand a detail card showing all login/logout events for that day, paginated 5 per page with `<` / `>` controls
- Right side panel: scrollable "Recent Activity" list of the latest 50 events

---

## 8. Settings — color theme, font, font size, store details

### `client/src/lib/settings-context.tsx` — this code is the global settings provider and the critical color-theme bug fix

Previously `applySettings()` only set `--primary` and `--primary-foreground`. Now it sets all 8 CSS variables:
- `--primary`, `--primary-foreground`
- `--ring`
- `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-ring`
- `--accent`, `--accent-foreground`
- `--sidebar-gradient` (when a gradient is selected)
- `--font-sans` + `document.body.style.fontFamily`
- `--font-size-base` + `root.style.fontSize`

**Color themes:** 10 presets stored as `{ primary, primaryForeground, ring, sidebarPrimary, sidebarRing, accent }` HSL values.

**Gradients:** 10 presets stored as `linear-gradient(135deg, ...)` strings, applied to `--sidebar-gradient`.

**Font loading:** Google Fonts loaded dynamically via `<link>` injection on first use (memoized by ID).

`applySettings()` is exported so the settings page can call it immediately on save for instant feedback.

### `client/src/pages/settings.tsx` — this code is the Settings page

**Removed:** Reorder Threshold, Low Stock Threshold, Payment Information (GCash number/QR).

**Admin-only sections:** System Settings (theme, companyName, autoApplyOffers, showSavingsSummary), Store Details (storeName, storeAddress, storeContactNumber, storeEmail), TTS voice selector.

**Employee-visible sections:** Color Theme, Gradient, Font, Font Size, TTS enable/disable toggle, Calculator enable/disable toggle.

**Font Size selector:** small (13px) / medium (14px) / large (16px) / xl (18px). Applied via `--font-size-base` and `root.style.fontSize`.

**Per-user toggles:**
- TTS enable/disable: persisted via `localStorage.getItem('joap_tts_${username}')`
- Calculator on/off: persisted via `localStorage.getItem('joap_calc_${username}')` — dispatches `joap-calc-toggle` event so the floating calculator hides/shows in real time

### `server/models/Settings.ts` — this code is the Mongoose Settings schema

Schema now has `fontSize`, `storeEmail`, `storeName`. Removed `reorderThreshold`, `lowStockThreshold`, `gcashNumber`, `gcashQrImageUrl`.

### `shared/schema.ts` — this code is the shared TypeScript types and Zod validators

`ISettings` interface mirrors the Mongoose schema. `settingsSchema` Zod validator updated accordingly.

---

## 9. Socket.io notifications & TTS

### `client/src/hooks/use-socket-notifications.ts` — this code is the global Socket.io listener hook

Connects to the Socket.io server on mount. Subscribes to:
- `order:assigned` → invalidates all order queries, plays TTS announcement (if user is the assignee AND TTS is enabled in localStorage)
- `order:unassigned` → same, with a "destructive" toast variant
- `order:status-changed` → invalidates order queries
- `order:created` → invalidates order + dashboard
- `billing:payment` → invalidates billing + dashboard
- `request:created` / `request:updated` → invalidates `/api/requests`
- `message:new` → invalidates `/api/messages`

**TTS gating:** `isTtsEnabled(username)` reads `localStorage.getItem('joap_tts_${username}')` — TTS only plays when the value is not `"false"`. This was the bug where employees weren't hearing the "admin has assigned you" announcement — the global TTS toggle is now respected.

**Query invalidation:** `invalidateOrderQueries()` explicitly invalidates all 4 order query key variants because TanStack Query treats `["/api/orders"]` and `["/api/orders?pool=true"]` as separate cache entries.

### `client/src/lib/tts.ts` — this code manages the Edge TTS audio queue

Uses Microsoft Edge TTS via the server's `/api/tts/synthesize` route. `buildAssignmentTTSScript(data)` constructs a natural-sounding announcement like: "Admin {actor} has assigned you order {trackingNumber}. Customer: {customerName}."

---

## 10. Pending Payment dedicated page

### `client/src/pages/pending-payment.tsx` — this code is the new Pending Payment page

At `/pending-payment`, showing all orders where `paymentStatus === "pending_payment"`.

**Columns:** Tracking #, Customer, Type, Payment Method, Amount Due, Date.

**Behavior:**
- Notification bar at the top when there are unpaid orders
- Search by tracking # or customer name
- Click row → navigate to order detail page
- Auto-refreshes every 1 second via global polling; once payment is logged the order disappears immediately

### `client/src/components/app-sidebar.tsx` — Pending Payment nav badge

The "Pending Payment" nav item has a yellow count badge fed from `/api/dashboard/stats`.

### `client/src/pages/billing.tsx` — this code is the Billing page

- Removed the **GCash #** search tab and table column
- Pending-payment notification bar now links to `/pending-payment` instead of `/orders`

---

## 11. Users page — Deactivated accounts + Reactivation

### `client/src/pages/users.tsx` — this code is the User Management page

**Active Users** section — table with username, role, last login, created, actions (Deactivate / Toggle Role / Reset Password).

**Deactivated Accounts** section — appears only when there are deactivated users. Each row has a "Reactivate" button that opens a password-confirmation dialog.

**Reactivation flow:**
1. Click "Reactivate" → opens `ReactivateDialog`
2. Admin types their own password
3. Client POSTs to `/api/auth/verify-password` (returns 401 on bad password)
4. On success, the existing `toggleMutation` flips `isActive: true` via `PATCH /api/admin/users/:id/status`
5. Real-time polling immediately moves the row from Deactivated → Active without page refresh

### `server/routes.ts` — verify-password route

New route `POST /api/auth/verify-password` checks the current user's password without issuing a new token. Used by the reactivation flow and the reservation delete flow.

---

## 12. Reservations — Delete cancelled

### `client/src/pages/reservations.tsx` — this code is the Reservations page

In the reservation detail sheet:
- "Cancel Reservation" button remains for non-cancelled reservations
- New **"Delete Permanently"** button appears only when `fulfillmentStatus === "cancelled"`
- Click → opens a password-confirmation dialog
- On confirm, client POSTs to `/api/auth/verify-password`, then DELETE `/api/reservations/:id`

### `server/routes.ts` — DELETE /api/reservations/:id

Admin only. Refuses if the reservation isn't cancelled. Logs `RESERVATION_DELETED`.

---

## 13. Offers — Duplicate prevention

### `server/routes.ts` — POST /api/offers update

`POST /api/offers` now checks for an existing active offer with the same name (case-insensitive, regex-escaped) before creating. Returns `409` with a clear error if a duplicate is detected. Logged via `OFFER_CREATED` system action.

---

## 14. About page overhaul

### `client/src/pages/about.tsx` — this code is the new About page

- Hero with logo + version badges
- Hero "About This System" card
- Features grid (10 features)
- **Development Team** section with 3 cards:
  - Cabilao, Keane Andre B. — Full-Stack Developer
  - Ebona, John Marwin R. — Backend & DB Architect
  - Mirasol, Prince Marl Lizandrelle D. — Systems Developer
- Tech Stack grid (6 cards)
- Footer with copyright

---

## 15. Maintenance — JSON upload template

### `itemupload.json` (project root) — this code is the template for batch inventory upload

```json
[
  {
    "itemName": "Sample Item 1",
    "sku": "SKU-001",
    "category": "Hardware",
    "unitPrice": 150.00,
    "currentQuantity": 50,
    "unit": "pcs",
    "description": "...",
    "supplier": "..."
  }
]
```

The maintenance page UI (when dev mode is on) consumes this format and creates `Item` documents via the existing `POST /api/items` route.

---

## 16. Accounting (existing — improvements)

The accounting page already had a chart + PDF export from the previous session. The chart is built with Recharts (`BarChart` of debits/credits per account + pie chart of account type distribution). The PDF export uses `html2canvas` to capture the chart as an image and embed it in the jsPDF document alongside the ledger table.

`pdfCurrency(v)` is a helper that formats PHP currency without rendering the ₱ glyph (which jsPDF doesn't ship in its default fonts). It outputs `"PHP 1,234.56"` style strings.

---

## 17. Files added in this session

| File | Purpose |
|---|---|
| `server/models/Request.ts` | Universal request model (ADD_ITEM, TRANSFER_ORDER, LEAVE) |
| `server/models/Message.ts` | Admin ↔ Employee messaging |
| `server/models/EmployeeProfile.ts` | Extended employee data (photo, email, employee ID, leave counters) |
| `client/src/pages/requests.tsx` | Admin-only requests inbox with Accept/Decline |
| `client/src/pages/employees.tsx` | Admin-only employee list + full profile modal |
| `client/src/pages/profile.tsx` | Employee profile page (photo, email, contact, leave request) |
| `client/src/pages/pending-payment.tsx` | Dedicated pending-payment dashboard |
| `client/src/components/floating-calculator.tsx` | Bubble-mode Casio calculator |
| `itemupload.json` | Template for batch inventory JSON upload |

---

## 18. Files modified in this session

| File | What changed |
|---|---|
| `client/src/lib/queryClient.ts` | Fixed "unexpected token" bug, added 1-second global polling via `startGlobalRealtimeSync()` |
| `client/src/App.tsx` | Wires up `startGlobalRealtimeSync`, routes for new pages, mounts `FloatingCalculator` |
| `client/src/components/app-sidebar.tsx` | Added Pending Payment, Requests, Employees, Profile (employee), Settings (employee) nav items; pending request + unread message badges |
| `client/src/hooks/use-socket-notifications.ts` | TTS now gated on `joap_tts_${username}`; invalidates all 4 order query variants; listens for request/message events |
| `client/src/lib/settings-context.tsx` | Complete rewrite — applies all 8 CSS variables for color themes, sets `--font-sans`, `--font-size-base`, `body.fontFamily`, `root.style.fontSize` |
| `client/src/pages/about.tsx` | Full UI overhaul with 3 developers and tech stack grid |
| `client/src/pages/billing.tsx` | Removed GCash search tab + column; pending-payment notification links to new page |
| `client/src/pages/orders.tsx` | Admin: Assigned Orders grouped by employee + AssignConfirmDialog; Employee: Create Order button + duplicate check + show all blocking orders in pool warning + filter out completed-processing orders from pending list |
| `client/src/pages/reservations.tsx` | Delete cancelled reservations with password confirmation |
| `client/src/pages/settings.tsx` | Font Size picker, Store Details (admin), per-user TTS + Calculator toggles, removed Reorder/LowStock/GCash |
| `client/src/pages/system-logs.tsx` | Two tabs: All Logs + User Log (calendar view); USER_LOGIN/LOGOUT removed from action filter |
| `client/src/pages/users.tsx` | Deactivated accounts section + Reactivate dialog with admin password confirmation |
| `client/src/pages/help.tsx` | InboxFromAdmin component for employees; message form posts to new /api/messages route |
| `server/models/Settings.ts` | Removed reorder/lowStock/gcash fields; added fontSize, storeEmail, storeName |
| `server/routes.ts` | Added: verify-password, requests routes, messages routes, employee-profile routes, employees list, reservation DELETE, check-duplicate, my-active now returns array, offer duplicate check, payment-status filter in /api/orders |
| `server/seed.ts` | Removed obsolete settings fields from seed |
| `shared/schema.ts` | Settings schema/interface synced |

---

## 19. How to verify the build

```bash
cd C:\Users\LENOVO\Downloads\PYTHON\SOFTCODE\SOFTCODE
npx tsc --noEmit              # should output nothing (0 errors)
npm run build                 # produces dist/public + dist/index.cjs
```

The current build produces:
- `dist/public/index.html` — 2.01 kB
- `dist/public/assets/index-*.js` — ~2 MB (gzipped ~607 kB)
- `dist/public/assets/index-*.css` — ~113 kB
- `dist/index.cjs` — 1.2 MB

---

## 20. Real-time guarantees (every 1 second)

The combination of two mechanisms ensures the UI never requires a manual refresh:

1. **Per-query polling** — every TanStack Query has `refetchInterval: 1000`, so the data behind any currently-mounted page refetches automatically.
2. **Global polling loop** — `startGlobalRealtimeSync()` runs a `setInterval` that explicitly invalidates the most important query keys every second. This catches cross-page invalidation cases where a page might not have its own query for `/api/orders?pool=true` but still needs to be aware of changes.
3. **Socket.io events** — for immediate (sub-second) updates, events like `order:assigned`, `request:updated`, `message:new` trigger explicit invalidations through `use-socket-notifications.ts`.

Browser tabs that go to the background pause polling (`refetchIntervalInBackground: false`) to save battery, but resume on focus.

Scroll positions and component states are preserved because we use `invalidateQueries` rather than reloading routes.

---

## 21. Known limitations / future work

- The Payment Logging mandatory upload dialog (receipt photo + reference number gates Mark-as-Done) is **not yet wired into the order-detail page**. The schema supports it (`BillingPayment` already accepts `proofNote`), but the UI dialog enforcing photo upload before `complete-processing` will be a follow-up.
- The Add Item request flow from the **employee inventory page** (with the "Waiting for Admin Approval" status div + Cancel Request button) needs to be wired into `inventory.tsx`. The backend routes (`POST /api/requests` with `requestType: ADD_ITEM`) already exist.
- The admin "Order Process" calendar drill-down inside the User Log day-detail still needs the order-list-by-day endpoint wired (currently shows login/logout events only).
- Image-based proof of payment upload uses base64 data URLs; for large-scale deployments this should move to disk or object storage.

---

## 22. Mongoose schema integrity

All new models inherit `{ timestamps: true }` for `createdAt`/`updatedAt`. Indexes have been added for:
- `Request`: `(status, createdAt -1)`, `(requester, status)`
- `Message`: `(toUsername, isRead, createdAt -1)`
- `EmployeeProfile`: `username` (unique), `employeeId` (unique)

All accept/decline/cancel operations are atomic (`findByIdAndUpdate` or document-level save with history push). System log entries are written for every state change so the audit trail is complete.

---

End of code.md.
