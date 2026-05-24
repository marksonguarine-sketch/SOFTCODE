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

## 23. Session 4 — UX polish, SaaS-style modal, configurable goals

This section documents every change made in session 4, which focused on cleaning
up the header chrome, wiring previously-stub buttons, making the sales goal
configurable by admins, and giving the Employee Profile modal a proper SaaS
visual treatment.

### 23.1 `server/index.ts` — this code starts the HTTP/Socket.io server

The previous version called `httpServer.listen({ port, host: "0.0.0.0", reusePort: true })`. On Windows, the kernel doesn't support `SO_REUSEPORT`, so the listen call would throw `ENOTSUP` and the server would never start. That manifested as "Connection refused" when developers ran `npm run dev` on Windows even though MongoDB had connected fine.

The fix detects the platform at startup and only passes `reusePort: true` when the host is not Windows:

```ts
const isWindows = process.platform === "win32";
const listenOpts: any = { port, host: "0.0.0.0" };
if (!isWindows) listenOpts.reusePort = true;
httpServer.listen(listenOpts, () => log(`serving on port ${port}`));
```

This is the single most important change for any developer on Windows — without it nothing else works.

### 23.2 `client/src/lib/queryClient.ts` — this code is the TanStack Query singleton + helper utilities

`throwIfResNotOk()` used to call `res.text()` on every non-OK response. That permanently consumes the response body, so when a caller wrote `const json = await res.json()` after `await apiRequest(...)`, the parser would error out with `Unexpected token` because the stream had already been drained.

The new implementation reads the body for the error message using `res.clone()`, preserving the original stream:

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
        else if (json?.error) message = json.error;
      } else {
        const text = await cloned.text();
        if (text) message = text;
      }
    } catch {}
    throw new Error(message);
  }
}
```

That eliminated the "Cannot claim order: Unexpected token" + "Failed to start processing: Unexpected token" toasts the employees were seeing.

The same file also exports `startGlobalRealtimeSync()`, a `setInterval` that calls `queryClient.invalidateQueries()` on the critical keys once per second. Combined with `refetchInterval: 1000` on every individual query, this guarantees the UI never goes stale and never needs a manual page refresh.

### 23.3 `client/src/App.tsx` — this code wires the top-level shell

The header had three pieces removed in session 4 after user feedback:

1. **The global search input** (`<GlobalSearch />`) — too much visual noise for a hardware store with ~50 SKUs. Search now lives inline on each page that needs it (inventory, orders, employees, pending payment all have their own contextual search).
2. **The notification bell** (`<Bell />`) — replaced by sidebar badges (Orders, Pending Payment, Requests, Help). The bell didn't open anything meaningful.
3. **The unused stub `GlobalSearch` function** (135 lines deleted) — kept the file leaner.

The header is now: SidebarTrigger → Breadcrumbs → flex-spacer → LiveClock → username pill → Logout button. That's all.

`startGlobalRealtimeSync()` is invoked once on mount inside `AuthenticatedLayout`. The `FloatingCalculator` and `TweaksPanel` are rendered as floating siblings to the layout so they're available everywhere.

### 23.4 `client/src/components/live-clock.tsx` — this code is the PHT clock in the header

User requested 12-hour format. The `timeOpts` config is now:

```ts
const timeOpts: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Manila",
};
```

Output is something like `7:09:42 PM PHT`. Updates every second via `setInterval(() => setNow(new Date()), 1000)`.

### 23.5 `client/src/pages/inventory.tsx` — this code is the Inventory page with the wired-up edit menu

The `MoreHorizontal` (the `…` button) on each row used to be a static placeholder. It now opens a fully wired edit dialog:

```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-7 w-7"
  title="Edit item"
  data-testid={`button-edit-item-${item._id}`}
  onClick={() => openEdit(item)}
>
  <MoreHorizontal className="w-3.5 h-3.5" />
</Button>
```

`openEdit(item)` populates four state fields (`editPrice`, `editQty`, `editCategory`, `editSupplier`) and sets `editItem` to the row. The dialog at the bottom of the page reads from those fields. Submit posts to `PATCH /api/items/:id` via the existing `apiRequest` helper; the response invalidates `["/api/items"]` and `["/api/items/categories"]`. There's also a `Delete` button in the dialog that fires `DELETE /api/items/:id` after a confirm. All mutations go through `TanStack Query`'s `useMutation`, so loading states, errors, and toasts are uniform with the rest of the app.

The edit dialog uses `data-testid` attributes:
- `input-edit-category`, `input-edit-supplier`, `input-edit-price`, `input-edit-qty`
- `button-save-item`, `button-delete-item`

### 23.6 `server/models/Settings.ts` + `shared/schema.ts` — daily sales goal config

Added a new field `dailySalesGoal: number` with a default of `100000` (PHP). It's stored as part of the singleton `Settings` document in MongoDB. The Zod schema (`shared/schema.ts`) accepts it as an optional number with `min(0)`, defaulting to `100000`, so existing records that don't have the field still validate.

Why this lives in `Settings` and not per-user: the user explicitly said "this is reflected to all admins, employees etc as is, only the admin can change this." A single global value matches that requirement; the dashboard reads it on every page load and falls back to `100_000` if the API hasn't responded yet.

### 23.7 `client/src/pages/settings.tsx` — this code is the admin Settings page

A new `FormField` for `dailySalesGoal` appears at the top of the **System Settings** card (admin-only). The input is a numeric field with `min={0}` and `step={1000}` so it nudges in thousand-peso increments. Description text reads: "Target revenue per day. Shown on every dashboard (admins + employees) as a progress ring."

The form's `defaultValues` and `values` blocks both include `dailySalesGoal`, so:
- First-time admin opens settings with an empty Settings doc → `100000` placeholder
- Existing doc → reads `settings.dailySalesGoal` from the API

Save uses the existing `PATCH /api/settings` mutation, which already accepts any field defined in the Zod schema.

### 23.8 `client/src/pages/dashboard.tsx` — this code is the Dashboard with the configurable goal ring + Peak Hours export

`DAILY_GOAL` is no longer a hardcoded constant. The dashboard now queries `/api/settings` and derives the goal at render time:

```ts
const { data: settingsRes } = useQuery<{ success: boolean; data: { dailySalesGoal?: number } }>({
  queryKey: ["/api/settings"],
  staleTime: 60_000,
});
const DAILY_GOAL = settingsRes?.data?.dailySalesGoal ?? DAILY_GOAL_FALLBACK;
```

The Ring gauge, the Target text, and the Remaining calculation all read from this single derived `DAILY_GOAL` value, so editing it in Settings immediately updates the dashboard for every signed-in user (admin or employee).

**Peak Hours export** — previously the `Export` button was a ghost button with no `onClick`. Now it calls `exportPeakHoursPDF(grid)` which:

1. Lazy-imports `jspdf` to keep the initial bundle small
2. Creates a landscape A4 page
3. Renders the title, generation timestamp (PHT 12-hour), and a 7×24 grid where each cell's fill color is interpolated along the amber HSL ramp (lightness `95% → 50%`) based on its value relative to the max
4. Adds hour labels every 3 hours and day labels (Mon–Sun)
5. Draws a 5-step legend at the bottom (Low → High)
6. Saves as `peak-hours-YYYY-MM-DD.pdf`

The HSL→RGB helper is included inline because `jspdf`'s `setFillColor` takes RGB. That math is the standard Wikipedia HSL→RGB algorithm.

### 23.9 `client/src/pages/system-logs.tsx` — this code is the System Logs page (overhauled User Log tab)

Two major changes per the user spec:

**1. Target user selector.** A `Select` dropdown at the top of the User Log tab lets the admin pick any registered user (themselves included). The dropdown sources from `GET /api/users/simple`. Until a target is chosen, the calendar is replaced by an empty state that says "Select a user above to see their login/logout calendar."

```tsx
<Select value={targetUser || "__none__"} onValueChange={(v) => setTargetUser(v === "__none__" ? "" : v)}>
  <SelectTrigger className="w-[240px] h-9" data-testid="select-target-user">
    <SelectValue placeholder="Choose user…" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="__none__">— Select a user —</SelectItem>
    {allUsers.map((u) => (
      <SelectItem key={u.username} value={u.username}>{u.username} ({u.role})</SelectItem>
    ))}
  </SelectContent>
</Select>
```

The userLogs feeding into `CalendarUserLog` are now filtered by `l.actor === targetUser`, so each cell only counts the selected user's events. The day-detail card heading now reads `<strong>{targetUsername}</strong>'s activity · <day>` so context is always clear.

**2. Recent Activity panel removed.** The right-hand "Recent Activity" sidebar (showing the latest 50 events across all users) was deleted. The user said it was redundant once the calendar is in place. The layout collapsed from `grid-cols-1 lg:grid-cols-2` to a single column.

### 23.10 `client/src/pages/employees.tsx` — this code is the Employees page with the SaaS-style profile modal

The modal got a complete visual overhaul. The new layout from top to bottom:

1. **Gradient hero header.** A 135° gradient from deep amber (`hsl(28 65% 22%)`) through mid-amber (`hsl(38 75% 38%)`) to bright amber (`hsl(38 92% 50%)`) covers the top of the dialog. Two radial-gradient white spots overlay it at 10% opacity to add depth without being noisy.

2. **Identity block.** A 96×96 photo (or fallback `UserCircle` on a translucent white tile) with a 4-px white ring and a soft shadow. Online indicator dot (emerald or gray) anchored to the bottom-right of the photo with `ring-2 ring-white`.

3. **Name + chips.** Name in `text-2xl font-bold tracking-tight`. Three pill chips:
   - Employee ID in monospaced font on a `bg-white/15` pill
   - Role (`ADMIN` / `EMPLOYEE`) in bold uppercase on a solid white pill with amber-900 text
   - Status (`Active` / `Inactive`) in a colored solid pill (emerald or gray)

4. **Action row.** Camera/Upload, Replace/Remove, Message, and Export buttons — all `variant="secondary"` with shadow, sized at `h-8 text-xs gap-1.5`. They sit aligned to the right of the identity block on wide viewports and wrap below on narrow ones.

5. **Account info strip.** Below the hero, a `bg-muted/30` rounded rectangle with a 2-column grid: Email, Phone, Created, Last login. Each cell has its label on the left and value flush-right, with a primary-colored icon. Phone number uses `font-mono` for tabular alignment.

6. **KPI tile row.** Four `KpiTile`s (new helper component defined at the bottom of the file). Each tile has:
   - Tiny uppercase label
   - A colored 28×28 rounded-square icon badge in the top-right (emerald / blue / amber / rose)
   - A big `font-mono tabular-nums text-2xl font-bold` value
   - Subtle hover shadow

7. **Productivity bar chart.** Wrapped in a card with a `from-primary/5 to-transparent` gradient header. The bars use a custom `<linearGradient id="empBarGrad">` defined in a `<defs>` block — top stop at `hsl(38 92% 60%)` 95% opacity, bottom stop at `hsl(38 92% 50%)` 55% opacity. `radius={[6, 6, 0, 0]}` rounds the tops; `maxBarSize={42}` keeps thin charts readable. Grid is `strokeDasharray="2 4"` on the border color, vertical lines hidden. Tooltip is custom-styled to match the card palette. This replaces the previous flat-red bars from the joap-main version (which were visibly out of place against the amber theme).

8. **Tabbed history.** Three tabs (Orders, Reservations, Activity) — each paginated 5 per page, click rows to drill in. No visual change here but the styling inherits from the new theme tokens automatically.

The `KpiTile` component is reusable and lives at the bottom of the file:

```tsx
function KpiTile({ label, value, Icon, color }: {
  label: string;
  value: number;
  Icon: any;
  color: "emerald" | "blue" | "amber" | "rose";
}) {
  const colorMap = { ... }[color];
  return (
    <div className={`rounded-xl border ring-1 ${colorMap.ring} bg-card p-3 hover:shadow-md transition-shadow`}>
      ...
    </div>
  );
}
```

The `exportPDF` function on the modal is unchanged in this session — it already produces a clean multi-page report with profile, KPI summary, and order history via `jspdf` + `jspdf-autotable`.

### 23.11 Files touched in session 4

| File | Why |
|---|---|
| `server/index.ts` | Conditionally apply `reusePort: true` so dev server boots on Windows |
| `server/models/Settings.ts` | Added `dailySalesGoal: number` (default `100000`) to schema + interface |
| `shared/schema.ts` | Mirrored `dailySalesGoal` in Zod schema and `ISettings` interface |
| `client/src/App.tsx` | Removed `<GlobalSearch />`, `<Bell />` icon button, and dead 135-line `GlobalSearch` function |
| `client/src/components/live-clock.tsx` | Switched `hour12: false` → `hour12: true`, `hour: "2-digit"` → `hour: "numeric"` |
| `client/src/pages/inventory.tsx` | Edit dialog state, edit/delete mutations, wired `…` button onClick, added `Edit2` and `Trash2` to lucide imports |
| `client/src/pages/settings.tsx` | Added `dailySalesGoal` to form defaults + values, rendered a `FormField` in the System Settings card |
| `client/src/pages/dashboard.tsx` | Query `/api/settings` and use `dailySalesGoal` for ring; new `exportPeakHoursPDF()` function wired to Peak Hours Export button |
| `client/src/pages/system-logs.tsx` | Added target user `Select`, filtered `CalendarUserLog` by `actor`, removed Recent Activity sidebar, updated day-detail title to include target's name |
| `client/src/pages/employees.tsx` | Gradient hero header for the profile modal, online-indicator dot, pill chips, account info strip, four colored KPI tiles (`KpiTile` helper), gradient productivity chart |
| `client/src/lib/queryClient.ts` | (carried over from session 3) `throwIfResNotOk` reads body via `res.clone()` so callers can parse JSON normally |

### 23.12 What to look at in the deployed app

After deploying session 4:

- The header is leaner — no more search input, no bell. The clock reads in 12-hour PH format with seconds.
- On Inventory, hovering any row's `…` opens the Edit dialog with the price/qty/category/supplier prepopulated. Save updates the row in place. Delete removes it after a confirm.
- On Settings → System Settings, an admin can change `Daily Sales Goal (₱)`. Save. Switch to Dashboard. The "Daily sales goal" ring updates in real time on every connected client.
- On Reports / Dashboard → Peak Hours, click Export. A PDF downloads named `peak-hours-2026-05-24.pdf` with the colored heatmap and legend.
- On System Logs → User Log, pick a user from the dropdown. Click any day in the calendar to see that user's logins/logouts.
- On Employees, click any employee card. The modal opens with the new gradient header, identity pills, and colored KPI tiles. Charts use the amber gradient bars. The whole thing now feels production-grade SaaS rather than plain Bootstrap.

---

## 24. Architectural decisions still in force

- **MongoDB Atlas URI hardcoded** in `server/server_mongo.ts`. No `.env` file required to run the app.
- **JWT in localStorage + httpOnly cookie fallback.** The client reads `localStorage.getItem("token")` for the `Authorization: Bearer …` header. Server also accepts `req.cookies.token`.
- **Session store in MongoDB** (`UserSession` model) with a 30-second in-memory cache (`server/middleware/auth.ts`). Logging in deactivates all existing active sessions for that user — only one session per account stays valid at a time.
- **Real-time everywhere.** Every TanStack Query has `refetchInterval: 1000`. A separate `setInterval` invalidates the top-N critical keys every second on top of that, plus Socket.io events for `order:assigned`, `order:unassigned`, `order:status-changed`, `order:created`, `billing:payment`, `request:created`, `request:updated`, `message:new`.
- **TTS gated per-user.** `localStorage.getItem('joap_tts_${username}')` controls whether `speakTTS()` plays sound. Defaults to enabled.
- **Calculator gated per-user.** `localStorage.getItem('joap_calc_${username}')` controls whether the floating bubble + panel render. Defaults to enabled.
- **Tweaks panel state per-browser.** `localStorage.joap_tweaks` JSON stores dark mode, accent hue, density, font, card style. Applied immediately at import time (before React mounts) so the chosen theme is visible from the first paint.

---

## 25. Build verification

```bash
cd C:\Users\LENOVO\Downloads\PYTHON\SOFTCODE\SOFTCODE
npx tsc --noEmit                # 0 errors after session 4
npm run build                   # produces dist/public/ + dist/index.cjs
```

Last build output sizes:
- `dist/public/index.html` — 2.01 kB
- `dist/public/assets/index-*.css` — ~115 kB (~18 kB gzip)
- `dist/public/assets/index-*.js` — ~2.1 MB (~610 kB gzip)
- `dist/index.cjs` — 1.2 MB

Manual click-through verified on a running dev server: login as `admin` / `admin123`, dismiss tutorial, visit Dashboard, Inventory (open and close edit dialog), Orders, Reservations, Billing, Accounting, Reports, Pending Payment, Offers, Requests, Employees (open profile modal, switch tabs, click Export), Users, Settings (change daily sales goal, save, verify dashboard ring updates), Maintenance, System Logs (switch to User Log, pick a user, click a calendar day), Profile, Help, About. Every page renders with a proper H1 and at least one meaningful interactive element.

---

End of code.md.
