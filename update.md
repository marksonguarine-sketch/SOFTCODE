# Update Log

## Version History

---

## [2026-05-15] — Reorder Point Formula

### Added
- **Reorder Point Formula** on the Add Item form in Inventory:
  - **Avg Daily Usage** — how many units are sold/used per day on average
  - **Lead Time (Days)** — number of days it takes for a supplier to deliver stock
  - **Safety Stock** — buffer stock to cover unexpected demand or delays
  - **Live computed preview** — shows the calculated Reorder Point in real time as inputs change
  - Formula: `Reorder Point = (Avg Daily Usage × Lead Time in Days) + Safety Stock`
- New fields added to the `Item` database model: `avgDailyUsage`, `leadTimeDays`, `safetyStock`
- Server-side auto-calculation of `reorderLevel` using the formula on item creation

### Changed
- **Add Item dialog** — replaced the single manual "Reorder Level" number input with a dedicated **Reorder Point Formula** section containing three inputs (Avg Daily Usage, Lead Time, Safety Stock) and a live computed result display
- **`createItemSchema`** (shared/schema.ts) — removed `reorderLevel` input field; added `avgDailyUsage`, `leadTimeDays`, `safetyStock` fields
- **`POST /api/items`** route (server/routes.ts) — now computes `reorderLevel` automatically from the formula before saving to the database instead of accepting it as a raw input

### Removed
- Manual "Reorder Level" number input from the Add Item form — users no longer set this directly; it is always derived from the formula

---

## [2026-05-15] — Backup & Database Migration

### Added
- **Database Migration Guide** panel in Maintenance page — step-by-step instructions for migrating all data to a new MongoDB database (change `MONGODB_URI`, log in with default admin, upload backup to restore)
- **Users included in backup** — the manual Download Backup now includes all user accounts (with hashed passwords) so they are fully restored when uploading to a new database
- **Users restored on upload** — the Upload Backup / Restore now also restores the `users` collection, so all accounts and passwords carry over to the new database

### Changed
- **Backup download** (`GET /api/maintenance/backup`) — now includes the `users` collection in the exported JSON alongside items, orders, customers, settings, etc.
- **Backup restore** (`POST /api/maintenance/backup/upload`) — now restores the `users` collection in addition to all other collections; uses `ordered: false` for more resilient bulk inserts
- **JSON body size limit** raised from 100 KB to **50 MB** on the server — allows large backup files to be uploaded without request rejection

---

## [2026-05-15] — Order Locking, Assignment & Staff Views

### Added
- **Order Locking** — when any user opens an order, it is automatically "locked" to them so no one else can accidentally process it at the same time
  - All other users who open the same order see a modal: *"This order is already being processed by [username]"* with:
    - **Time Started** — when the processor first opened it (12-hr format, MM/DD/YYYY)
    - **Last Active** — the most recent heartbeat timestamp
  - Locks automatically expire after **3 minutes of inactivity** (stale lock = anyone can take over)
  - Heartbeat sent every 90 seconds while the order is open to keep the lock alive
- **Admin: Take Over Order** — admins see a "Take Over Order" button in the locked-order modal to immediately claim the order from whoever has it
- **Admin: Assign from Locked Modal** — admins can also assign the locked order to any other staff member directly from the modal without taking it over themselves
- **Order Assignment** — admins can assign any order to any employee or admin
  - Assignment panel in the order detail sidebar (always visible to admins)
  - Inline assign dropdown in every row of the orders table (admin view)
  - Assigned user, assigned time, and assigned-by are stored and displayed
- **GET /api/users/simple** — new endpoint returning a lightweight list of all active users (username + role) for dropdowns
- **Employee Orders View — Greeting** — employees see a time-aware greeting (*Good morning / Good afternoon / Good evening, [name]*) at the top of the orders page
- **Employee Orders View — Assigned Orders section** — shows only orders assigned to the logged-in employee, split into:
  - **Pending** — detailed cards with tracking #, status badge, customer, total, channel, created time, assigned time, assigned-by, items preview
  - **Completed** — compact list of orders they already finished
- **Employee Orders View — Order Pool** — shows all orders below a divider; employees **cannot** click into any pool order while they still have unfinished assigned orders (a warning banner is shown)
- **Admin Orders View — View by Staff Member** — new section below the main tabs with two dropdowns (Employee / Admin including themselves); selecting a user shows:
  - **Assigned – Not Yet Completed** — detailed cards for that user's pending orders
  - **Completed** — table with tracking #, customer, total, and the exact timestamp the order was completed
- **Assigned To column** in the admin orders table — inline dropdown per row lets admins assign/reassign without opening the order

### Changed
- **Order model** (`server/models/Order.ts`) — added fields: `lockedBy`, `lockStartedAt`, `lockLastSeen`, `assignedTo`, `assignedToName`, `assignedAt`, `assignedBy`
- **IOrder interface** (`shared/schema.ts`) — extended with all new lock and assignment fields (all optional)
- **GET /api/orders** — now accepts `assignedToMe=true` (filters to current user's assigned orders) and `assignedTo=username` (admin filter by user)
- **POST /api/orders/:id/lock** — acquires a lock; returns `{ locked: true, ... }` if held by someone else with a fresh lock
- **DELETE /api/orders/:id/lock** — releases the current user's lock
- **POST /api/orders/:id/takeover** — admin forcibly claims a locked order
- **POST /api/orders/:id/assign** — assigns order to a user (or unassigns if username is empty)
