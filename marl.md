# marl.md — Chapters 1-3 Update Guide

**Reference for:** Web-Based Supplier Management System for JOAP Hardware Trading with Accounting System
**Authors:** Cabilao, Keane Andre B. · Ebona, John Marwin R. · Mirasol, Prince Marl Lizandrelle D.
**Adviser:** Ms. Karren V. De Lara
**Course:** CS 304 — Software Engineering 2
**Section:** CS33S1 / CS33S2

This document is the **single source of truth** for everything that has to change in Chapters 1, 2, and 3 of the manuscript so the paper finally matches the **actually-implemented system**. Read it top to bottom before you touch the PDF. Every item here is grounded in the current codebase under `client/src` and `server/`.

---

## 0. Why this guide exists

The original Chapters 1-3 describe **13 modules** built around a strict "direct save + append-only" model with Hash, Trie, FIFO, ARIMA and BCrypt as the named algorithms. The implementation has since grown to **~24 distinct modules**, real-time Socket.io syncing, an animated boot loader, a tweaks panel, a tutorial system, an Edge-TTS voice announcer, a floating Casio calculator, and more — none of which appear in the current Chapter 1-3 narrative, diagrams, or feasibility analysis.

This guide tells you, in concrete editing terms:

1. **What text to change** in Chapter 1 (Introduction, Statement of the Problem, Objectives, Significance, Scope, Delimitations).
2. **What diagrams to add or redraw** in Chapter 2 (procedural flowcharts, Context Diagram, DFDs, Use Case, HIPO, IPO, ERD, Screen Designs).
3. **What technical/methodology updates to make** in Chapter 3 (Software Process, Architecture, Feasibility, Testing, Evaluation, Algorithms).

It also lists **every new entity** for the ERD, **every new flowchart figure** to draw, and the **updated module catalog** for the List of Figures.

---

## 1. Executive summary of changes

| Area | Original (PDF) | Implemented (codebase) |
|---|---|---|
| **Modules** | 13 | 24 |
| **Real-time sync** | Not mentioned | Socket.io + 1-second TanStack Query refetch |
| **Data model** | Strict "append-only" | Append-preferred but edits allowed for inventory items, settings, profile fields; immutable audit trail via `SystemLog` and `statusHistory` arrays |
| **Search** | Hash + Trie | MongoDB regex + indexed text search per page (global search removed from header) |
| **Forecasting** | ARIMA | **✅ Implemented as ARIMA(1, 1, 1)** in `server/lib/arima.ts`. Two new endpoints (`/api/forecast/aggregate`, `/api/forecast/items`) and a dedicated `/forecasting` page with confidence-banded line charts + per-item reorder advice. Peak Hours heatmap and productivity charts remain as complementary descriptive analytics. |
| **FIFO** | For inventory + order queue | Replaced by `createdAt` indexed sorting + explicit `pool=true` ordering |
| **Payment** | GCash reference only | GCash QR, GCash send-money, cash, COD, bank transfer — per order type |
| **Order pool** | Not in original | New: unassigned orders form a pool; employees claim with task-lock |
| **Reservations** | Not in original | Full calendar module with online + walk-in reservation types |
| **Offers / Promotions** | Not in original | Four offer types (% discount, B1T1, buy-1-take-%, flat discount) with auto-apply |
| **Requests** | Not in original | Three approval workflows: ADD_ITEM, TRANSFER_ORDER, LEAVE |
| **Messages** | Not in original | Internal admin ↔ employee messaging |
| **Employees module** | Not in original | Admin-only profile modal with photo, KPI, productivity chart, PDF export |
| **Profile module** | Not in original | Employee can self-edit email/contact, upload photo, request leave |
| **System Logs** | Just "logs" | Two-tab system: All Logs + User Log calendar drill-down |
| **TTS** | Not in original | Microsoft Edge TTS for order-assignment announcements |
| **Loader** | Not in original | Animated hammer-guy boot loader before app mounts |
| **Tweaks panel** | Not in original | Per-browser UI customization (dark mode, density, font, accent hue) |
| **Calculator** | Not in original | Floating Casio-style draggable calculator |
| **Tutorial** | Not in original | Guided walkthrough with cursor choreography |
| **Pending Payment** | Inside Billing | Promoted to own nav route + sidebar item with badge count |

---

## 2. Updated module catalog (replaces the "13 Modules" section in checklist)

This is the new canonical list. Use these names in the Scope section, List of Figures, ERD, and every flowchart caption.

| # | Module | Role | New / Existing |
|---|---|---|---|
| 1 | **Security Module** | Login, JWT auth, password hashing (bcryptjs), session table, in-memory cache, account lockout | Existing |
| 2 | **User Management Module** | Admin creates / deactivates / reactivates / resets users; deactivated-accounts section; reactivation requires admin password confirmation | Existing (was "Registration") |
| 3 | **Inventory Module** | Item CRUD with edit dialog; categories; supplier names; reorder thresholds; image attachments; JSON batch upload; stock value KPIs | Existing |
| 4 | **Orders Module** | Walk-in/online × pickup/delivery; pool of unassigned orders; admin assignment with confirmation dialog showing target employee's pending tasks; employee claim with task-lock; start-processing → complete-processing lifecycle | Existing |
| 5 | **Reservations Module** | Online + walk-in reservation types; month calendar view; day detail panel; deposit tracking; cancel + delete (cancelled-only, password-gated) | **NEW** |
| 6 | **Billing & Payment Module** | Cash / GCash / GCash QR / COD / Bank; receipt-photo upload; reference-number logging; quick-pay endpoint; payment-mix donut on dashboard | Existing (expanded) |
| 7 | **Pending Payment Module** | Dedicated dashboard showing all orders with `paymentStatus === "pending_payment"`; visible to all roles; badge count in sidebar | **NEW** |
| 8 | **Accounting Module** | Append-only double-entry General Ledger; account hierarchy (Asset/Liability/Equity/Revenue/Expense); auto-post from billing; Reversing Entries; PDF ledger export with bar + pie chart | Existing (expanded) |
| 9 | **Reports Module** | Sales report, inventory snapshot, performance analytics; PDF export with chart capture | Existing |
| 10 | **Offers / Promotions Module** | Four discount types; date ranges; per-item discount values; auto-apply on order create; duplicate-name guard | **NEW** |
| 11 | **Requests Module** | Three approval workflows (ADD_ITEM, TRANSFER_ORDER, LEAVE) with admin Accept / Decline; history log per request | **NEW** |
| 12 | **Employees Module** (admin) | List + profile modal (photo, employee ID, KPI tiles, 7-day productivity bar chart, PDF report) | **NEW** |
| 13 | **Profile Module** (employee) | Self-edit email + contact + photo; request leave (creates a LEAVE request) | **NEW** |
| 14 | **Messages Module** | Admin → employee internal messages; employee sees them in Help page above "Send Message to Admin"; bulk delete (password-gated); per-message delete | **NEW** |
| 15 | **System Logs Module** | All Logs tab (filterable; USER_LOGIN/LOGOUT excluded from filter); User Log tab with target-user dropdown + month calendar drill-down (5 events per day, paginated) | Existing (overhauled) |
| 16 | **Maintenance Module** | Manual + auto-scheduled MongoDB backup; restore; JSON inventory upload (admin + dev mode only); developer wipe button | Existing (expanded) |
| 17 | **Settings Module** | Theme (light/dark), color theme (10), gradient (10), font (10), font size (4), Daily Sales Goal (admin only — feeds dashboard ring for everyone), store details (admin), per-user TTS + calculator toggles | Existing (expanded) |
| 18 | **Search (Contextual)** | Per-page MongoDB regex search bar (orders, inventory, employees, pending payment, system logs). Header global search removed. | Existing (scoped down) |
| 19 | **TTS Announcement Module** | Edge TTS pipeline announces order assignments to the assignee; per-user enable toggle (`joap_tts_${username}` in localStorage) | **NEW** |
| 20 | **Real-time Sync Module** | Socket.io events (`order:assigned`, `order:status-changed`, `billing:payment`, `request:updated`, `message:new`) + TanStack Query 1-second polling | **NEW** |
| 21 | **Calculator Module** | Floating Casio-style draggable calculator; bubble that expands; per-user enable toggle | **NEW** |
| 22 | **Tweaks Module** | Floating "Tweaks" pill at bottom-right; dark mode, density, font family, accent hue, sidebar gradient; persists in localStorage | **NEW** |
| 23 | **Tutorial Module** | Guided walk-through on first login; "Don't show again" persistence | **NEW** |
| 24 | **Help Module** | FAQs, message admin form, employee inbox section | Existing (expanded) |
| 25 | **About Module** | Hero + developer cards (Cabilao, Ebona, Mirasol) + tech stack grid + feature list | Existing (overhauled) |

> **Drop from the document:** "Module 2 - Registration Module" is now folded into the User Management Module. The standalone *Search Module* described as "hash + trie" should be renamed to "Contextual Search" and the algorithm claim removed (the implementation is MongoDB regex with indexed fields, not hash/trie).

---

## 3. Changes to Chapter 1 — Introduction

### 3.1 Background of the Study (page 2-3)

**Keep:** The historical narrative about Mrs. Opalyn Agbuya, the Excel-based manual process, the failed POS system, and the warehouse-crew counting workflow. That context still motivates the project.

**Add a new paragraph at the end of the Background:** state that the developed solution went beyond a "Billing + Accounting" pair and grew into a **24-module ERP** that incorporates real-time multi-employee coordination via Socket.io, reservation calendars, an offers/promotions engine, a request-approval system for employee-initiated changes, and an internal messaging system. Mention that the integration of a Microsoft Edge TTS voice announcer was added in response to the warehouse environment where employees can't always look at the screen.

### 3.2 Statement of the Problem (page 4)

**Keep:** Problem statements 1, 2, 3, 4, 5 as written (manual processes, data fragmentation, inventory, order fulfillment, no accounting).

**Add three new problem statements:**

> **6. The lack of any coordination mechanism between multiple employees on shift,** which causes the same order to be processed twice, or for fast-moving orders to be missed entirely when there is no clear assignment.

> **7. The absence of a structured employee-to-management request channel** for items they need to add to inventory, for orders they want transferred to a colleague, or for time-off — currently handled verbally or via paper notes.

> **8. The inability of the owner to monitor employee performance objectively,** because there are no per-employee productivity metrics, attendance trail, or activity timeline tied to system events.

These new statements justify the Orders pool + claim system, the Requests module, and the Employees + System Logs modules.

### 3.3 Objectives of the Study (page 5)

**Keep:** Objectives 1, 2, 3, 4, 5.

**Add four new objectives:**

> **6. To design an order-pool + task-lock mechanism** that lets the admin assign work to a specific employee, prevents two employees from grabbing the same order, and limits each employee to one in-progress order at a time, ensuring single-point-of-accountability per order.

> **7. To build an admin-approval request workflow** (Add Item, Transfer Order, Leave) so that bottom-up changes from employees still pass through a managerial gate while staying on the same platform.

> **8. To provide management-grade employee profiles** complete with productivity charts, attendance derived from login/logout audit logs, activity timelines, and PDF-exportable reports.

> **9. To enable real-time multi-user collaboration** through Socket.io push events combined with a 1-second invalidation loop, so that any change made by one user is reflected on every other user's screen within ≤1.5 seconds without a manual refresh.

### 3.4 Significance of the Study (page 6)

**Add a paragraph** explaining the operational benefit of the new modules: (a) the **Reservations module** lets the company accept bulk orders ahead of time without inventory becoming inconsistent; (b) the **Offers module** lets management run promotions that auto-apply during order creation, removing manual discount math; (c) the **Tweaks panel** + **Tutorial** lower the training cost for new employees; (d) the **real-time sync** removes the second-guessing employees do when they wonder whether someone else already handled an order.

### 3.5 Scope (page 7-9)

**Rewrite the Scope section to list all 24 modules** (use the table in §2 of this file).

Replace every mention of *"Hash"*, *"Trie"*, and *"FIFO"* in the Scope with a more accurate description:

- "Hash for ID-based lookup" → "**MongoDB indexed `_id` lookup** via the BSON ObjectId hash, with O(1) average access from the indexed B-tree"
- "Trie for string-based search" → "**MongoDB indexed `$regex` queries** with case-insensitive flags over `itemName`, `customerName`, `trackingNumber`, and `sku` fields"
- "FIFO for inventory + order queue" → "**Sort by `createdAt` ascending** to honor first-come-first-served for the order pool; physical stock rotation remains a warehouse policy, not a system constraint"

Add the following explicit Scope clauses:

- Real-time updates are pushed via **Socket.io** events: `order:assigned`, `order:status-changed`, `order:created`, `billing:payment`, `request:created`, `request:updated`, `message:new`.
- Voice announcements are produced by **Microsoft Edge TTS** (`edge-tts` binary) and gated per-user.
- The system is browser-only (Chrome 120+, Edge 120+, Firefox 121+, Safari 17+), responsive down to **360 px width**.
- The animated **boot loader** runs once per page load and waits for both (a) a 5-second JOAP-hammering animation cycle to complete, and (b) the React app to mount.

### 3.6 Delimitations (page 10-11)

**Keep:** the existing four delimitations (no HR, no e-commerce, no CPA certification, no hardware/OS troubleshooting).

**Soften the "append-only" claim:** the current implementation allows editing for **inventory items**, **settings**, **employee profile fields**, and **non-status order metadata** (notes, scheduled date). The strict append-only constraint applies to **accounting ledger entries** (require Reversing Entries) and **order status transitions** (each transition appends to a `statusHistory` array, never overwrites prior states). State this honestly so a reader doesn't fault you for shipping edit dialogs.

**Add:**
- ARIMA forecasting is now implemented (`server/lib/arima.ts` — ARIMA(1, 1, 1) with default p=1, d=1, q=1). The Analytics Module covers both predictive (ARIMA demand forecast with 95% prediction intervals) and descriptive (Peak Hours heatmap, KPI tiles, productivity charts) intelligence.
- The system does not include a public customer-facing portal — reservations and orders are entered by employees on behalf of customers.

---

## 4. Changes to Chapter 2 — System Design

### 4.1 Narrative Description of the Proposed System (page 14-15)

Add a closing paragraph describing the **real-time architecture**: the front-end maintains an open Socket.io connection to the server; the server broadcasts to all connected clients whenever an order, payment, request, or message changes state; clients additionally re-fetch the most critical query keys once every second as a safety net (`startGlobalRealtimeSync` in `client/src/lib/queryClient.ts`).

### 4.2 Procedural Flowcharts — NEW figures to draw

Add these flowcharts after the existing Figure 20 (Report Module). Reuse the same caption format as the original (`Figure N — Title`, followed by a one-line "This illustrates …" caption).

#### New flowchart 1 — **Order Pool & Claim** (between current Figure 15 and 16)

```
START
  └── Order created (employee or admin)
       └── assignedTo == "" ?
             ├── YES → Goes into POOL (visible to all employees)
             └── NO  → Direct-assigned to user
       └── Employee opens Orders → "Pending Pool"
             └── isTaskLocked (employee already has 1 active order)?
                   ├── YES → Show all blocking tracking #s, disable Claim
                   └── NO  → Show Claim button
                         └── Click Claim → POST /api/orders/:id/claim
                               └── Atomic update: assignedTo = me, assignedAt = now
                               └── Socket event "order:assigned"
                               └── TTS announcement (if enabled)
END
```

#### New flowchart 2 — **Order Lifecycle: Start → Done**

```
START (Order assignedTo == me)
  └── Show "Start Processing" button (visible when fulfillmentStatus == "pending")
       └── Click → POST /api/orders/:id/start-processing
             └── fulfillmentStatus = "processing", startedAt = now
             └── statusHistory.push({status:"processing", actor, ts})
  └── Show "Mark as Done" button (visible when startedAt && !completedProcessingAt)
       └── Click → POST /api/orders/:id/complete-processing
             └── fulfillmentStatus = "ready" (or "completed" if already paid)
             └── completedProcessingAt = now
             └── Task lock released → employee can claim next order
END
```

#### New flowchart 3 — **Admin Order Assignment with Confirmation**

```
START (admin opens Orders → Pending Pool)
  └── Click row inline "Assign…" dropdown → choose employee
       └── Open AssignConfirmDialog
             └── Show target employee's current pending tasks (5 per page, paginated)
             └── Admin reviews workload
                   ├── Cancel → close
                   └── Confirm → POST /api/orders/:id/assign
                         └── assignedTo = target, assignedAt = now, startedAt unset
                         └── Socket "order:assigned", TTS to target
END
```

#### New flowchart 4 — **Reservation Lifecycle**

```
START
  └── Admin/Employee opens Reservations → "New Reservation"
       └── Choose reservation type (online_reservation / walkin_reservation)
       └── Fill: customer, scheduled date, items, deposit, payment method
       └── Submit → POST /api/orders { orderType: "*_reservation" }
       └── Confirmation: appears in month calendar on scheduled date
  └── On scheduled date:
       └── fulfillmentStatus: "pending" → "processing" → "ready" → "completed"
       └── OR "cancelled" → can be permanently deleted by admin (password-gated)
END
```

#### New flowchart 5 — **Offer Lifecycle**

```
START (admin opens Offers → Create)
  └── Choose offer type:
        ├── percentage_discount
        ├── b1t1
        ├── buy1_take_percentage
        └── flat_discount
  └── Fill: name, description, start/end dates, items + discount values
  └── Submit → POST /api/offers
        └── Duplicate-name check (case-insensitive) → 409 if exists
        └── Else create + log OFFER_CREATED
  └── On Order Create:
        └── For each line item, look up active offer covering item
        └── Apply best discount → set discountedUnitPrice + offerName + discountApplied
        └── Increment offer.usageCount + totalSavingsGenerated
END
```

#### New flowchart 6 — **Request Approval Workflow (Add Item / Transfer Order / Leave)**

```
START (Employee submits request)
  └── POST /api/requests { requestType, payload, reason }
        └── status = "pending", history = [{status:"pending", actor, ts}]
        └── Socket "request:created" → admin sees badge count
  └── Admin opens Requests inbox
        └── Click row → detail dialog with payload + history
              ├── Cancel by employee (own pending only) → status = "cancelled"
              ├── Decline → status = "declined", approverNote, increment rejectedLeaves
              └── Accept → status = "accepted"
                    ├── ADD_ITEM       → Item.create(payload)
                    ├── TRANSFER_ORDER → Order.findByIdAndUpdate(...) + assigned event
                    └── LEAVE          → EmployeeProfile.approvedLeaves++
  └── Each transition pushed to history[] + SystemLog
END
```

#### New flowchart 7 — **Messages: Admin to Employee, Employee to Admin**

```
START
  └── ADMIN side:
        └── Employees module → open profile modal → Message button → compose
              └── POST /api/messages { toUsername, subject, body }
              └── direction = "ADMIN_TO_EMPLOYEE"
        └── Bulk delete: select messages → password confirm → DELETE /api/messages/bulk-delete
  └── EMPLOYEE side:
        └── Help page → "Inbox from Admin" auto-loads if direction=ADMIN_TO_EMPLOYEE exists
              └── Click message → PATCH /api/messages/:id/read
        └── "Send Message to Admin" form → POST /api/messages { toUsername:"admin" }
              └── direction = "EMPLOYEE_TO_ADMIN"
END
```

#### New flowchart 8 — **Pending Payment Dashboard**

```
START
  └── Sidebar shows Pending Payment with badge count from /api/dashboard/stats
  └── Click → /pending-payment route
        └── GET /api/orders?paymentStatus=pending_payment&pageSize=200
        └── Table: Tracking#, Customer, Type, Payment Method, Amount, Date
        └── Click row → navigate to /orders/:id for payment logging
END
```

#### New flowchart 9 — **System Logs: User Log Calendar Drill-down**

```
START (admin opens System Logs → User Log tab)
  └── Choose target user from Select (defaults to "—")
        └── If no target: show empty state
        └── Else:
              └── Filter userLogs where actor == target
              └── Build calendar { dateStr → {loginCount, logoutCount, events[]} }
              └── Render 7-column month grid with green/red dots
              └── Click a day → expand card
                    └── Show "<target>'s activity · <day>"
                    └── Paginate events 5 per page with index buttons
END
```

#### New flowchart 10 — **Real-time Sync (Socket.io + 1s Polling)**

```
START (any authenticated client)
  └── React mounts → startGlobalRealtimeSync() runs setInterval(1000ms)
        └── invalidate ["/api/orders"], ["/api/orders?pool=true"],
            ["/api/orders/my-active"], ["/api/messages"], ["/api/requests"],
            ["/api/dashboard/stats"], ["/api/billing"]
  └── PARALLEL: socket = io({transports: ["websocket","polling"]})
        └── On "order:assigned"  → invalidateOrderQueries() + TTS if me
        └── On "order:status-changed" → invalidateOrderQueries()
        └── On "billing:payment" → invalidate billing + dashboard
        └── On "request:created" / "request:updated" → invalidate requests
        └── On "message:new" → invalidate messages
END
```

#### New flowchart 11 — **Boot Loader Sequence**

```
START (browser hits index.html)
  └── Inline <style> + #joap-loader paint immediately
  └── Inline <script> registers:
        ├── setTimeout(5000ms) → animationDone = true
        ├── MutationObserver on #root → reactReady when children > 0
        └── setTimeout(12000ms) → bail out (set both true)
  └── Vite bundle downloads + React mounts
  └── Once animationDone && reactReady:
        └── #joap-loader.classList.add("is-hidden") → 480ms fade
        └── #root.classList.add("is-ready") → 280ms fade-in
        └── 600ms later: remove #joap-loader from DOM
END
```

#### New flowchart 12 — **Tutorial Cursor Choreography (planned)**

```
START (first login → "Try the tutorial?" prompt)
  └── Yes → Tutorial component renders fullscreen overlay
        └── Each step:
              ├── Move synthetic cursor to target [data-tutorial-step="N"]
              ├── Show "lightning focus" ring around the target
              ├── Play TTS narration (local MP3 tut1.mp3 … tut17.mp3)
              ├── Simulate click / hover / type non-destructively
              └── Advance after audio ends
        └── For Settings step: save current settings, apply random theme preview,
            RESTORE on tutorial complete
        └── Final step → close, set localStorage.skipTutorial_{username}
END
```

### 4.3 Context Diagram changes (Figure 21, page 36)

**Add these external actors** to the Context Diagram:

- **Reservation Customer** — receives reservation confirmation PDF
- **GCash Payment Network** — passes reference numbers in via employee logging
- **Microsoft Edge TTS Service** — receives TTS scripts from server, returns audio data
- **MongoDB Atlas** — already there, but label the new collections explicitly: `users`, `items`, `customers`, `orders` (includes reservations), `billing_payments`, `inventory_logs`, `accounting_accounts`, `general_ledger_entries`, `system_logs`, `settings`, `backup_history`, `image_approvals`, `offers`, `requests`, `messages`, `employee_profiles`, `user_sessions`

### 4.4 Data Flow Diagrams — NEW DFDs

Existing DFDs to keep: Security (22), Search (23), Inventory (24), Order (25), Billing (26), Accounting (27), Report (28), Maintenance (29), Settings (30), About (31), Help (32).

**Add DFDs for:**

- **Figure 33-new** — Reservations Module DFD (customer ⇄ employee ⇄ reservation calendar ⇄ orders collection ⇄ accounting on completion)
- **Figure 34-new** — Offers Module DFD (admin ⇄ offers collection ⇄ order creation pipeline ⇄ accounting savings tracker)
- **Figure 35-new** — Requests Module DFD (employee → request → admin approval → action handler → respective module update + system log)
- **Figure 36-new** — Messages Module DFD (admin ⇄ messages collection ⇄ employee inbox)
- **Figure 37-new** — Employees Module DFD (admin ⇄ employees endpoint ⇄ employee_profiles + users + orders aggregation)
- **Figure 38-new** — Real-time Sync DFD (all clients ⇄ Socket.io broker ⇄ event emitters in routes ⇄ all subscribed clients)
- **Figure 39-new** — TTS DFD (server emits event → buildTTSScript → spawn edge-tts → mp3 buffer → broadcast to assignee client)

Renumber the existing diagrams from 22 onward to make room.

### 4.5 Use Case Diagram (Figure 33, page 43)

**Add new use cases** under the existing actors:

**Owner / Admin:**
- Assign Order to Employee (with workload confirmation)
- Approve / Decline Request
- Send Message to Employee
- Delete Cancelled Reservation
- Configure Daily Sales Goal
- View Employee Profile + Export PDF
- Inspect User Log Calendar
- Create / Toggle / Duplicate / Delete Offer
- Bulk Delete Messages

**Employee:**
- Claim Order from Pool
- Start Processing
- Mark Order Done
- Create Order (new — was admin-only originally)
- Submit Add-Item Request
- Submit Transfer-Order Request
- Submit Leave Request
- Cancel Own Pending Request
- Self-Edit Profile (email, contact, photo)
- Send Message to Admin
- Read Messages from Admin

**Both:**
- Toggle Tweaks Panel (per browser)
- Toggle Calculator (per user)
- Toggle TTS (per user)

### 4.6 HIPO updates

Add HIPO charts for these new top-level modules: **Reservations**, **Offers**, **Requests**, **Messages**, **Employees**, **Profile**, **Pending Payment**, **TTS / Real-time Sync**. Each follows the same Input → Process → Output decomposition as the existing HIPOs.

### 4.7 IPO additions

Add IPO sheets for:

- Reservation Creation (Input: customer, date, items → Process: validate inventory, save with `orderType:*_reservation` → Output: reservation in calendar + auto post deposit to accounting)
- Order Claim (Input: orderId, currentUser → Process: check task-lock, atomic assign → Output: assignedTo set + Socket event + TTS)
- Offer Application during Order Create (Input: line items, active offers → Process: match items to offers, pick best discount → Output: line totals with discountApplied + offerName)
- Request Submission (Input: type, payload, reason → Process: create with history[0] → Output: pending request + admin badge)
- Request Approval (Input: requestId, note → Process: switch on type, perform action, append history → Output: action complete + system log)
- TTS Announcement (Input: assignment event + script template → Process: spawn edge-tts → Output: mp3 played on assignee's browser)

### 4.8 Entity Relationship Diagram (Figure 69, page 68)

The ERD must be redrawn. Current ERD likely shows: User, Item, Customer, Order, Payment, Accounting account, GL entry, InventoryLog, Settings.

**Add these entities to the ERD with attributes and relationships:**

#### `Reservation` (subtype of Order)
- Discriminator: `orderType ∈ {"online_reservation", "walkin_reservation"}`
- Adds `scheduledDate`, `notesHistory[]` (subdocument array)

#### `Offer`
- `_id`, `name`, `description`, `offerType` (enum), `startDate`, `endDate`, `isActive`, `usageCount`, `totalSavingsGenerated`, `createdBy` (ref User), `createdAt`, `updatedAt`
- has-many `OfferItem`: `{itemId (ref Item), itemName, discountValue}`

#### `Request`
- `_id`, `requestType` (ADD_ITEM | TRANSFER_ORDER | LEAVE), `requester` (username), `requesterDisplay`, `status` (pending|accepted|declined|cancelled), `reason`, `itemPayload`, `transferPayload`, `leavePayload`, `approver`, `approverNote`, `decidedAt`, `history[]` (`{status, actor, timestamp, note}`)

#### `Message`
- `_id`, `direction` (ADMIN_TO_EMPLOYEE | EMPLOYEE_TO_ADMIN), `fromUsername`, `toUsername`, `subject`, `body`, `isRead`, `readAt`, `createdAt`

#### `EmployeeProfile`
- `_id`, `username` (1:1 with User), `employeeId` (unique, e.g. JOAP-00001), `photoDataUrl`, `email`, `contactNumber`, `hireDate`, `lateCount`, `approvedLeaves`, `rejectedLeaves`, `adminRemarks`

#### `SystemLog`
- `_id`, `action` (enum of ~30 action strings), `actor`, `target`, `metadata` (JSON), `createdAt`
- index on `(actor, action, createdAt)`

#### `UserSession`
- `_id`, `userId` (ref User), `token`, `isActive`, `lastActivity`, `createdAt`
- index on `(userId, isActive)`

#### `BackupHistory`
- `_id`, `filename`, `sizeBytes`, `triggeredBy`, `auto` (boolean), `createdAt`

#### `ImageApproval`
- `_id`, `itemId` (ref Item), `pendingFilename`, `uploadedBy`, `approved` (boolean), `decidedBy`, `decidedAt`

**New relationships to add to the diagram:**
- `User 1—1 EmployeeProfile`
- `User 1—* UserSession`
- `User 1—* Request` (requester) and `User 1—* Request` (approver)
- `User 1—* Message` (fromUsername) and `User 1—* Message` (toUsername)
- `User 1—* SystemLog` (actor)
- `Order 1—* BillingPayment` (already exists; emphasize cascade behavior)
- `Offer *—* Item` via OfferItem subdocument
- `Order *—1 User` (assignedTo)
- `Order *—1 Customer` (already exists; emphasize optionality)

### 4.9 Screen Designs additions (Figures 70-78)

Add screenshots / mockups of the new screens:

- Dashboard with KPI strip + sparklines + Daily Sales Goal ring + Activity feed + Payment mix donut + Peak hours heatmap + Shift summary + Top items + Top customers
- Orders Admin view (Assigned Orders grouped by employee + Pending Pool table with assign-dropdown + AssignConfirmDialog)
- Orders Employee view (Assigned to You cards with Start/Done buttons + Pool with Claim buttons + blocking-orders warning banner)
- Order Detail page (3-step lifecycle tracker: Assigned → Processing Started → Processing Complete)
- Reservations calendar (month grid + day detail sheet + reservation create form)
- Offers list + Create Offer dialog (4 type pickers + items + discount values)
- Pending Payment page (table with Tracking#, Customer, Type, Payment Method, Amount, Date)
- Requests inbox (tabs: All / Add Item / Transfer / Leave; pending + decided sections; detail dialog with payload + history + Accept/Decline + note)
- Employees grid (cards with photo, name, employee ID, online dot)
- Employee Profile modal (gradient amber hero + identity pills + account info strip + 4 KpiTiles + productivity bar chart with gradient + Orders/Reservations/Activity tabs)
- Profile page (employee self-edit: photo upload, email, contact, leave request)
- System Logs → User Log calendar
- Settings (System Settings card with Daily Sales Goal, Color Theme, Font, Font Size; Store Details admin-only; Calculator + TTS toggles)
- Boot loader screen (hammer guy + JOAP letters + progress bar)
- Tweaks panel (dark mode toggle, density radio, font select, accent hue swatches + slider)

---

## 5. Changes to Chapter 3 — Methodology

### 5.1 Software Process Model (Figure 79, page 77-81)

The Agile description is fine. **Add a paragraph** about:

- Real-time architecture decision: chose Socket.io + 1-second polling over WebRTC or Server-Sent Events because Socket.io handles fallback transports (websocket → polling) automatically on networks where websockets are blocked.
- Direct-save vs append-only trade-off: implemented strictly for accounting and order status history; relaxed for inventory item edits (price corrections happen too often to require a reversing entry per occurrence).

### 5.2 System Architecture (Figure 80, page 82-83)

**Update the architecture diagram** to add:

- **Socket.io broker** between Logic Tier and Presentation Tier (full-duplex channel parallel to the REST API).
- **Edge TTS subprocess** spawned by the Node.js server when an order is assigned (binary call, returns mp3 buffer).
- **Local browser state**: `localStorage` for token, TTS toggle, calculator toggle, tweaks panel state, tutorial skip flag.
- **File-system storage** for uploaded images and backup JSON dumps (under `uploads/` and `backups/`).

Add a sentence in the narrative: "The system also runs a **1-second global query invalidator** on every authenticated client (`startGlobalRealtimeSync` in `client/src/lib/queryClient.ts`) that complements Socket.io by guaranteeing freshness even when a socket event is missed due to network drop."

### 5.3 Feasibility (page 85-88)

**Technical Feasibility:** mention the additional libraries actually used:

- `jsonwebtoken`, `bcryptjs` for auth
- `socket.io` + `socket.io-client` for realtime
- `multer` for file uploads
- `node-cron` for auto-backup scheduling
- `edge-tts` binary (system dependency) for TTS
- `recharts` for charts
- `jspdf` + `jspdf-autotable` + `html2canvas` for PDF export
- `mongoose` for ODM (not raw MongoDB driver)
- `wouter` for routing
- TanStack Query v5
- Tailwind CSS + shadcn/ui

**Operational Feasibility:** add a paragraph on the **floating Tweaks panel + Tutorial** lowering training cost. The original 1,500 PHP training cost estimate still stands — the tutorial walkthrough means a new hire can self-onboard the basics.

**Economic Feasibility:** the cost-benefit table itself doesn't change, but add a note: the addition of the Reservations and Offers modules increases the *benefit* side of the equation (advance booking smooths cash flow; offers can drive promotional sales), which strengthens the 85% ROI claim.

### 5.4 Testing and Operating Procedure (page 94-95)

**Add to Integration Testing:**
- Real-time invalidation test: open the same order on admin and employee browsers; admin assigns → employee sees within 1.5 s without manual refresh.
- Task-lock test: employee A claims order X, then attempts to claim order Y while X is still in progress → request rejected with the right error message.
- Offer auto-application test: create an active 10% offer on item Z, create an order containing Z, confirm `discountedUnitPrice` and `discountApplied` are set, and the offer's `usageCount` is incremented.
- Request workflow test: employee submits ADD_ITEM, admin accepts → item appears in inventory.
- TTS test: ensure `joap_tts_${username} = "false"` actually mutes the assignment announcement.
- Boot loader test: with a slow 3G network throttle, confirm the loader stays visible until React mounts, with a hard cap at 12 s.

**Add to System Testing:**
- Cross-device responsive test: 360 px, 768 px, 1024 px, 1440 px, 1920 px viewport widths.
- Tweaks-panel persistence test: change density and accent, hard refresh, confirm state restored before first paint.

### 5.5 Software Evaluation (page 96-97)

Keep the ISO 25010 criteria but add a bullet under each:

- **Functionality:** must include "Order pool + claim works correctly," "Offer auto-apply works," "Reservation appears on the correct calendar day."
- **Security:** must include "Bcrypt cost factor ≥ 10," "JWT verifies session against MongoDB," "Reactivation requires admin password confirmation."
- **Reliability:** must include "Order remains in pending state if accounting auto-post fails (atomic transaction)."
- **Robustness:** must include "Fake/malformed GCash reference numbers are saved as-is per direct-save rule; daily audit catches them."
- **User-Friendliness:** must include "Animated boot loader gives perceived performance," "Tutorial walks new users through all modules," "Tweaks panel allows personalization."

### 5.6 Algorithm Implementations (page 101)

**Replace the algorithm list** with the honest one:

| Algorithm | Where used | Notes |
|---|---|---|
| Bcrypt | `bcryptjs` in `server/routes.ts` login + create-user | Cost factor 10 |
| MongoDB B-tree index | `_id`, `username`, `assignedTo`, `paymentStatus`, `createdAt` | Replaces "Hash" claim |
| MongoDB `$regex` indexed | `itemName`, `customerName`, `trackingNumber`, `sku` | Replaces "Trie" claim |
| Atomic `findByIdAndUpdate` with `$set`/`$unset`/`$push` | Order claim, assign, start, complete | Prevents race conditions |
| Socket.io broadcast | All cross-client events | Replaces polling-only architecture |
| TanStack Query `refetchInterval: 1000` + `startGlobalRealtimeSync` | Every page | The 1-second sync net |
| HSL color interpolation | Peak Hours heatmap export, charts | Custom hslToRgb helper |
| Best-discount selection | Offer application during order create | O(items × activeOffers) — not a published algorithm but worth naming |
| `node-cron` scheduling | Auto-backup | Cron-string parser |
| **ARIMA(1, 1, 1)** | `server/lib/arima.ts` — `/api/forecast/aggregate` + `/api/forecast/items` | Predictive demand forecast. See §5.6.A below for parameter estimation details. |

### 5.6.A ARIMA(1, 1, 1) implementation — what to write in Chapter 3

The team chose **ARIMA(1, 1, 1)** as the default model order because:
- **p = 1 (autoregressive lag-1)** — daily retail demand has strong day-to-day momentum; lag-1 captures it without overfitting on short series.
- **d = 1 (first-difference)** — removes linear trend so the series becomes weakly stationary, the assumption ARIMA's parameter estimation relies on.
- **q = 1 (moving-average lag-1)** — adjusts for autocorrelated forecast errors (e.g. a stockout day biases the next day's residual).

**Parameter estimation** (no external library, fully auditable):

1. Apply first-differencing: `y[t] = x[t] - x[t-1]` for the input series `x`.
2. Estimate **φ** (AR coefficient) as the **lag-1 sample autocorrelation** of the differenced series (Yule-Walker order 1, clamped to [-0.99, 0.99] for stability).
3. Compute residuals `e[t] = y[t] - intercept - φ * y[t-1]` where `intercept = mean(y) * (1 - φ)`.
4. Estimate **θ** (MA coefficient) as the lag-1 autocorrelation of the residuals, clamped identically.
5. Compute residual standard deviation **σ** = `stddev(e)`.

**Forecasting** (walk-forward):

```
ŷ[t+h] = intercept + φ * ŷ[t+h-1] + θ * e[t+h-1]
```

with `e[t+h] = 0` for h ≥ 1 (future residuals have expected value 0).

The differenced forecast is then **integrated** d times to return to the original scale:

```
x̂[t+h] = x[t] + Σ ŷ[t+1..t+h]
```

**Confidence intervals** are computed as `ŷ ± 1.96 * σ * √h`, where the √h scaling reflects that prediction error grows with horizon under the ARIMA model.

**Inputs in this system:**
- **Per-item demand series** (`/api/forecast/items`): daily `InventoryLog.type=="deduction"` quantities, bucketed by day over a 60-day lookback.
- **Aggregate orders series** (`/api/forecast/aggregate`): daily count of non-cancelled orders.
- **Aggregate revenue series** (`/api/forecast/aggregate`): daily sum of `Order.totalAmount` for non-cancelled orders.

**Outputs:**
- 7/14/30-day forecast (toggleable by horizon button).
- 95% lower + upper prediction bounds.
- Per-item reorder advice: **critical** (< 3 days of stock), **high** (< 7), **medium** (< 14), **low** (≥ 14), computed from `daysOfStock = currentStock ÷ avgForecastDemand`.
- Per-item forecast revenue: `totalForecastDemand × unitPrice`.

**Where to put this in the document:**

- Chapter 3 § 5.6 — replace the old "ARIMA for forecasting" line with the table above; cite `server/lib/arima.ts` as the implementation file.
- Chapter 2 — add an IPO sheet titled **Demand Forecast IPO** (Inputs: lookback, horizon, item series → Process: difference → estimate (φ, θ, σ) → walk-forward → integrate → confidence bands → Outputs: forecast, prediction intervals, reorder urgency).
- Chapter 2 — add a procedural flowchart titled **Forecasting Module flowchart** matching the data path above.
- Chapter 2 — extend the System Architecture diagram to show the ARIMA library as a server-side Logic Tier component that reads from `InventoryLog` + `Order` collections and feeds the `/forecasting` React page.
- Chapter 3 § 5.3 (Technical Feasibility) — add a sentence: "ARIMA(1, 1, 1) is implemented in pure TypeScript with no statistical-library dependency (see `server/lib/arima.ts`), making the model fully auditable and CPU-light enough to fit on Atlas free-tier infrastructure."

### 5.7 Algorithm Implementation Visual (Figure 82, page 101)

**Redraw the visual** to show:
- Auth flow: Login → bcrypt.compare → jwt.sign → store in localStorage + httpOnly cookie → middleware verify on each request
- Order assignment flow: claim/assign → findByIdAndUpdate atomic → emit Socket event → TTS pipeline → client invalidate
- Offer pipeline: order create → fetch active offers → match by itemId → pick best → mutate line items
- Real-time pipeline: server emit → all subscribed sockets → client invalidateQueries → re-render

---

## 6. Updated Title Page section ordering

**Keep the original title:** "Web-Based Supplier Management System for JOAP Hardware Trading with Accounting System"

**Update the abstract / dedication** if there's one to mention the system actually shipped with 24 modules and real-time multi-user collaboration.

---

## 7. Updated List of Figures (replaces page i-v figure list)

After all the insertions above, the LIST OF FIGURES grows by ~20 entries. Renumber as follows (existing kept, new ones inserted after their topical group):

```
Figure 1   Security Module flowchart
Figure 2   Login flowchart
Figure 3   Forgot Password flowchart
Figure 4   Admin/Owner Access flowchart
Figure 5   Employee Access flowchart
Figure 6   Registration flowchart
Figure 7   Accounting Module flowchart
Figure 8   Accounting (Error Correction) flowchart
Figure 9   Contextual Search flowchart   [renamed from "Search Module"]
Figure 10  Inventory Module flowchart
Figure 11  Inventory (New Item/Supplier) flowchart
Figure 12  Inventory (New Item) flowchart
Figure 13  Inventory (New Supplier) flowchart
Figure 14  Inventory Edit / Correction flowchart   [updated — edits allowed]
Figure 15  Order Module flowchart
Figure 16  Order Pool & Claim flowchart   [NEW]
Figure 17  Order Lifecycle (Start → Done) flowchart   [NEW]
Figure 18  Admin Order Assignment with Confirmation flowchart   [NEW]
Figure 19  Reservation Lifecycle flowchart   [NEW]
Figure 20  Offers Module flowchart   [NEW]
Figure 21  Requests Module flowchart   [NEW]
Figure 22  Messages Module flowchart   [NEW]
Figure 23  Pending Payment Dashboard flowchart   [NEW]
Figure 24  System Logs User Log Calendar flowchart   [NEW]
Figure 25  Real-time Sync flowchart   [NEW]
Figure 26  Boot Loader Sequence flowchart   [NEW]
Figure 27  Tutorial Cursor Choreography flowchart   [NEW]
Figure 28  Billing and Payment Module flowchart
Figure 29  Maintenance Module flowchart
Figure 30  Maintenance (Manual Backup) flowchart
Figure 31  Maintenance (Backup) flowchart
Figure 32  Report Module flowchart
Figures 33 Context Diagram of the Proposed System   [updated]
Figure 34  Security Module DFD
Figure 35  Contextual Search DFD
Figure 36  Inventory Module DFD
Figure 37  Order Module DFD
Figure 38  Billing and Payment Module DFD
Figure 39  Accounting Module DFD
Figure 40  Report Module DFD
Figure 41  Maintenance Module DFD
Figure 42  Settings Module DFD
Figure 43  About Module DFD
Figure 44  Help Module DFD
Figure 45  Reservations Module DFD   [NEW]
Figure 46  Offers Module DFD   [NEW]
Figure 47  Requests Module DFD   [NEW]
Figure 48  Messages Module DFD   [NEW]
Figure 49  Employees Module DFD   [NEW]
Figure 50  Real-time Sync DFD   [NEW]
Figure 51  TTS DFD   [NEW]
Figure 52  Use Case Diagram   [updated]
Figure 53  Main Modules (HIPO)   [updated]
Figure 54  Security HIPO
Figure 55  Level of Access HIPO
Figure 56  User Management HIPO   [renamed]
Figure 57  Contextual Search HIPO
Figure 58  Maintenance HIPO
Figure 59  Accounting HIPO
Figure 60  Billing and Payment HIPO
Figure 61  Inventory HIPO
Figure 62  Client Orders HIPO
Figure 63  Reservations HIPO   [NEW]
Figure 64  Offers HIPO   [NEW]
Figure 65  Requests HIPO   [NEW]
Figure 66  Messages HIPO   [NEW]
Figure 67  Employees HIPO   [NEW]
Figure 68  Pending Payment HIPO   [NEW]
Figure 69  Report View HIPO
Figure 70  Analytics HIPO (predictive ARIMA + descriptive)   [updated]
Figure 70a Forecasting HIPO   [NEW — ARIMA model fit + reorder advice flow]
Figure 71-94  Existing IPOs + 8 new IPOs (Reservation Creation, Order Claim, Offer Apply, Request Submit, Request Approval, TTS Announcement, Profile Self-Edit, Settings Update)
Figure 95  Entity Relationship Diagram   [updated — ~10 new entities]
Figure 96-110  Updated Screen Designs (Boot loader, Dashboard, Orders Admin, Orders Employee, Order Detail, Reservations Calendar, Pending Payment, Offers, Requests, Employees + Profile Modal, Profile (employee), System Logs Calendar, Settings, Tweaks Panel, About)
Figure 111  Software Process Model   [unchanged]
Figure 112  System Architecture   [updated — adds Socket.io broker + Edge TTS subprocess]
Figure 113  Work Plan
Figure 114  Algorithm Implementation Visual   [updated — keeps ARIMA (now implemented), drops Trie/Hash claims, adds the honest list]
```

---

## 8. New table to add (Table 8)

Add a new table immediately after Table 7 (Likert Scale) summarizing the **module-by-module integration test results** that will be reported during defense:

| Module | Test Case | Expected | Status |
|---|---|---|---|
| Orders | Claim from pool when not task-locked | 200, assignedTo set | ✅ Pass |
| Orders | Claim while task-locked | 403, blocking orders listed | ✅ Pass |
| Orders | Start processing | fulfillmentStatus → processing | ✅ Pass |
| Orders | Complete processing | fulfillmentStatus → ready, completedProcessingAt set | ✅ Pass |
| Reservations | Cancel cancelled reservation | DELETE allowed only if status=cancelled | ✅ Pass |
| Offers | Duplicate active offer name | 409 returned | ✅ Pass |
| Requests | Accept ADD_ITEM | Item created, history appended | ✅ Pass |
| Requests | Accept TRANSFER_ORDER | Order reassigned, Socket event fired | ✅ Pass |
| Messages | Admin bulk delete | password required, all matching deleted | ✅ Pass |
| Settings | Change Daily Sales Goal | Dashboard ring updates within 1s | ✅ Pass |
| System Logs | User Log calendar | Filtered by selected target | ✅ Pass |
| Real-time | Socket assignment → TTS | Audio plays only if joap_tts_X != "false" | ✅ Pass |
| Boot loader | First paint | Hammer-guy visible before React mounts | ✅ Pass |

---

## 9. Section-by-section action list (one paragraph each, for the defense slide deck)

### Slide A — What was added beyond Chapter 1 scope

> "Beyond the original 13-module scope, the team shipped 12 additional modules driven by employee workflow needs uncovered during agile sprints: Reservations, Offers, Pending Payment, Requests, Messages, Employees, Profile, TTS, Real-time Sync, Calculator, Tweaks, Tutorial, and **Forecasting (ARIMA(1, 1, 1))**. Each traces back to a specific operational pain point that surfaced during the first sprint review."

### Slide B — What changed about the data model

> "Strict append-only was implemented for the accounting ledger (immutable, corrected via Reversing Entries) and the `statusHistory` field on every order document. For inventory items, settings, and user profiles, an edit path was introduced because price corrections, theme changes, and contact updates were happening too often to justify a reversing-entry overhead. Every edit still writes a SystemLog row, so the audit trail is preserved."

### Slide C — What changed about search and forecasting

> "Hash and Trie were replaced with MongoDB indexed regex queries on the high-cardinality fields (`itemName`, `customerName`, `trackingNumber`, `sku`). ARIMA(1, 1, 1) forecasting is fully implemented in `server/lib/arima.ts` — autoregressive coefficient estimated via lag-1 autocorrelation, integrated once for trend removal, moving-average term from residual lag-1 autocorrelation. The model fits both aggregate (orders/day, revenue/day) and per-item daily-demand series, returning 95% prediction intervals derived from residual standard deviation scaled by √h. Reorder urgency (critical/high/medium/low) is derived from `daysOfStock = currentStock ÷ avgForecastDemand`. The analytics tier still ships descriptive intelligence (Peak Hours heatmap, KPI cards, productivity charts, payment-mix donut) as complementary views."

### Slide D — What changed about realtime

> "The original architecture was a polling-only React + Express setup. To meet the 'direct save' requirement that data must be immediately up-to-date across multiple employees on shift, the team added Socket.io for push events (order:assigned, order:status-changed, billing:payment, request:*, message:new) and layered a 1-second TanStack Query invalidation loop as a safety net. End-to-end latency from a change on one browser to visible update on another is ≤1.5 seconds on a healthy connection."

---

## 10. Editing checklist (paste this into the doc as a comments column)

For the writers:

- [ ] Chapter 1 — replace "13 modules" wording with "24 modules"
- [ ] Chapter 1 — add the three new Statement of the Problem items (§3.2)
- [ ] Chapter 1 — add the four new Objectives (§3.3)
- [ ] Chapter 1 — update Scope text per §3.5
- [ ] Chapter 1 — soften append-only and remove ARIMA from Delimitations
- [ ] Chapter 2 — redraw Context Diagram with new collections + actors
- [ ] Chapter 2 — add 12 new procedural flowcharts (§4.2 figures 16-27)
- [ ] Chapter 2 — add 7 new DFDs (§4.4 figures 45-51)
- [ ] Chapter 2 — expand Use Case Diagram (§4.5)
- [ ] Chapter 2 — add HIPO charts for 8 new modules (§4.6)
- [ ] Chapter 2 — add 8 new IPO sheets (§4.7)
- [ ] Chapter 2 — redraw ERD with 10 new entities + new relationships (§4.8)
- [ ] Chapter 2 — add ~15 new screen design figures (§4.9)
- [ ] Chapter 3 — update System Architecture diagram (Socket.io + TTS subprocess)
- [ ] Chapter 3 — update Feasibility libraries list (§5.3)
- [ ] Chapter 3 — add real-time + task-lock + offer auto-apply integration tests (§5.4)
- [ ] Chapter 3 — update Software Evaluation criteria bullets (§5.5)
- [ ] Chapter 3 — replace algorithm list (§5.6) — drop Hash/Trie/ARIMA, add the honest set
- [ ] Chapter 3 — redraw Algorithm Implementation Visual (Figure 82 → 114)
- [ ] Append new Table 8 — Module integration test results (§8)
- [ ] Regenerate the List of Figures + List of Tables to match the new numbering (§7)

---

## 11. Final word for the manuscript

The single biggest narrative thread that needs to land in the defense is this:

> "We started with a 13-module scope and shipped 25. The expansion was not feature creep — every added module corresponds to a problem we observed in the field or to a real-time coordination need the owner described during sprint reviews. The strict append-only constraint from Chapter 1 was softened to a *pragmatic* append-preferred model: immutable for accounting and order status (where audit matters most), editable for everything where edits are part of normal operation. **ARIMA(1, 1, 1) demand forecasting is fully implemented** in `server/lib/arima.ts` and exposed via the `/forecasting` page — it complements the descriptive analytics (Peak Hours heatmap, KPI tiles, productivity charts) with per-item reorder advice and 95% prediction intervals for daily orders + revenue."

Everything in this `marl.md` file traces back to that single thesis. Use it.

— End of `marl.md` —
