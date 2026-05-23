# JOAP Hardware Trading — ERP System

## Project Overview

A full-stack ERP (Enterprise Resource Planning) system for JOAP Hardware Trading, a hardware retail business in the Philippines. It manages inventory, orders, billing, customer relationships, reservations, promotions, and accounting for both admin and employee roles.

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, TanStack Query v5, Wouter (routing), Tailwind CSS, shadcn/ui, Recharts, Lucide React, Framer Motion
- **Backend**: Node.js + Express v5 + TypeScript, Mongoose (MongoDB ORM), Passport + JWT (auth), Socket.io (real-time), node-cron (scheduled jobs)
- **Database**: MongoDB via Mongoose (`MONGODB_URI` env secret). Database name: `joap_hardware`
- **Auth**: JWT tokens stored in cookies. Role-based access: Admin and Employee
- **File structure**:
  - `client/` — React frontend
  - `server/` — Express backend, Mongoose models, routes, middleware
  - `shared/schema.ts` — Zod schemas and TypeScript types (source of truth)

## Running the App

- Dev: `npm run dev` (starts Express + Vite on port 5000)
- Build: `npm run build`
- Production: `npm start`

## Environment Variables / Secrets

- `MONGODB_URI` — MongoDB connection string (required)
- `SESSION_SECRET` — Session secret for Express

## User Preferences

- Currency is Philippine Peso (₱)
- Timezone is Philippine Standard Time (PST, UTC+8)
- AM shift = before 12:00 PM; PM shift = 12:00 PM onward

---

## Planned Features Backlog

All features below are requested by the owner and should be implemented as the project grows. Group them by module when building.

### Dashboard

- **Live clock & date** — Show current Philippine time and date in the dashboard header, auto-updating every second.
- **Shift summary widget** — Today's totals broken down by AM shift and PM shift: orders processed, revenue collected, new customers added.
- **Daily sales goal bar** — Admin sets a daily revenue target in Settings; dashboard shows a progress bar and percentage toward that goal.
- **Top 5 selling items today** — Mini leaderboard card showing which items moved the most units today.
- **Top 5 customers by revenue this month** — Card showing highest-spending customers with avatar initials and total spend amount.
- **Revenue vs last week sparkline** — Tiny inline chart on the revenue card showing the 7-day trend.
- **Gross profit margin card** — (Revenue − cost of goods) / revenue shown as a percentage card. Requires cost price tracking on items.
- **Overdue payments alert banner** — If any order is unpaid and more than 3 days old, show a dismissible red banner at the top.
- **Employee activity feed** — Real-time list of recent actions across all users: order created, payment logged, item restocked, reservation confirmed.
- **Weather widget** — Show local weather from a free API. Useful for delivery planning on rainy days.

### Orders

- **Order aging indicator** — Color-code orders by how long they have been pending: green < 1 day, amber 1–3 days, red > 3 days.
- **Duplicate order detection** — Warn staff if the same customer placed a very similar order within the last 24 hours before confirming.
- **Order templates** — Save a common order as a named template for one-click re-ordering.
- **Internal order comments thread** — Staff can leave internal comments on any order (staff-only, never visible to customers).
- **Order activity timeline** — Vertical timeline on order detail page showing every status change with timestamp and user name.
- **Attach photos to orders** — Staff can upload photos to an order: delivery proof, damaged goods documentation, etc.
- **Customer signature capture** — On walk-in orders via tablet/touchscreen, capture a digital signature from the customer upon pickup.
- **Estimated completion time (ETA)** — Staff sets an ETA on an order; visible to all staff to manage customer expectations.
- **Assign order to staff member** — Each order can be assigned to one employee who owns and is responsible for its fulfillment.
- **Reorder button on completed orders** — One click creates a new draft order pre-filled with the same customer, items, and quantities.
- **Order cancellation reason log** — Require the staff member to select a reason and optional note when cancelling. Stored and shown on detail page.
- **SMS or email notification on status change** — Auto-send customer a message when fulfillment status changes.
- **Print packing list** — Generate a simple PDF with item names and quantities only (no prices) for the warehouse team.
- **Partial delivery tracking** — Mark individual items within one order as delivered while others are still pending.
- **Bulk CSV export of orders** — Download all filtered orders as a CSV file for external analysis.

### Inventory

- **Barcode scanner support** — Scan a product barcode to instantly look up or add an item during order creation.
- **Bulk CSV import for items** — Upload a spreadsheet to add or update many inventory items at once.
- **Item image upload** — Attach a product photo to each inventory item. Shown in the item search dropdown during order creation.
- **Item variants and unit types** — Support multiple unit types per item (bag, sack, piece, meter) with conversion ratios.
- **Reorder point alerts per item** — Each item has a configurable reorder threshold. Alert fires when stock drops below it.
- **Supplier management** — Link each item to a supplier with name, contact number, and address. One click to start a purchase order.
- **Purchase order (PO) module** — Full workflow: create a PO, mark it sent, receive goods against it, auto-update stock on receipt.
- **Stock adjustment reason log** — Every manual stock edit requires a reason: damaged goods, miscounted, theft, customer return, etc.
- **Item location / bin tracking** — Assign a physical shelf or bin code (e.g., A3-Row2) to each item.
- **Expiry date tracking** — For cement, paint, adhesives, etc., track batch expiry dates and warn staff when a batch is near expiry.
- **Per-item stock movement chart** — Chart on each item's detail page showing stock level over time (last 30 or 90 days).
- **Dead stock identification** — Automatically flag items with zero sales in the last 60 days with a suggested action.
- **Item cost price tracking** — Track purchase cost separately from selling price. Auto-calculate gross margin per item.
- **Print item labels and barcodes** — Generate a printable PDF sheet of barcodes or QR codes for physical shelf labeling.
- **Multi-location / branch stock tracking** — Track stock separately per branch location.
- **Stock value summary by category** — Total peso value of stock per category so management knows where capital is tied up.
- **Low stock auto-draft purchase order** — When stock falls below reorder point, auto-create a draft PO for the linked supplier.

### Customers

- **Customer profile page** — Dedicated page per customer: full order history, total lifetime spend, payment reliability, and staff notes.
- **Customer loyalty tiers** — Bronze, Silver, Gold tiers based on cumulative spend. Tier badge shown on profile and in order creation dropdown.
- **Customer credit limit** — Set a maximum outstanding balance per customer. Warn staff if a new order would push them over the limit.
- **Customer tags and groups** — Tag customers as Contractor, Walk-in Regular, Wholesaler, VIP, etc. Filter orders and reports by tag.
- **Bulk customer import from CSV** — Upload a spreadsheet to add many customers at once from an existing contact list.
- **Duplicate customer detection** — Warn when a new customer's phone number already exists before saving.
- **Customer accounts receivable (AR) tracking** — Track total balance owed per customer. Show total AR summary on the billing page.
- **Customer communication log** — Log every contact: calls, emails, messages, with date, staff name, and a short summary.
- **Blacklist / block a customer** — Mark a customer as blacklisted. Warn staff with a red alert when they try to create an order for that customer.
- **Customer birthday field** — Store each customer's birthday. Dashboard widget shows customers with birthdays this week.
- **Customer notes pinning** — Pin important notes on a customer profile so they always appear at the top.

### Billing & Payments

- **Installment plan support** — Split an order balance into installments with individual due dates. Track each installment payment separately.
- **Payment receipt PDF** — Generate a clean, branded payment receipt PDF for any recorded payment. Downloadable and printable.
- **Formal invoice generation** — Generate a proper VAT invoice or sales invoice PDF with company letterhead, line items, and payment terms.
- **Overdue payment automated reminders** — Cron job that sends internal notifications or SMS for all unpaid orders past their expected payment date.
- **GCash reference number verification** — When a GCash payment is recorded, require the staff to enter the reference number. Flag as pending verification until confirmed.
- **Daily cash drawer reconciliation** — End-of-day form where staff enters the physical cash counted. System compares it to recorded cash sales and flags discrepancies.
- **VAT calculation** — Configurable VAT rate in Settings. Auto-calculate VAT on all orders; show it as a separate line on invoices and receipts.
- **Discount coupon / promo code at billing** — Staff manually enters a coupon code at payment time. System validates and applies the discount.
- **Split payment support** — Allow one order to be paid partly in cash and partly in GCash in a single transaction, both amounts recorded separately.
- **Outstanding balance summary** — Banner at top of billing page showing total unpaid balance across all customers, overdue count, and oldest unpaid date.
- **Payment method performance summary** — How much of today's revenue came via cash vs GCash vs COD. Shown as a small bar chart.

### Reservations

- **Export reservations to Google Calendar (.ics)** — Download all upcoming reservations as an .ics file that opens in Google/Apple/Outlook Calendar.
- **Reservation capacity limit per day** — Admin sets max reservations allowed per day. System blocks new ones once the limit is hit.
- **Reservation deposit tracking** — Track whether the required upfront deposit has been received. Block confirming until deposit is logged.
- **Customer self-service reservation form** — Public-facing form (no login required) where customers submit their details. Staff review and confirm or reject.
- **Reservation no-show tracking** — Mark a reservation as no-show. Track no-show rate per customer and flag repeat offenders.
- **Automatic reminder notifications** — Auto-send notifications to assigned staff 24 hours and 2 hours before the scheduled reservation.
- **Reservation rescheduling with history** — Change scheduled date with one click. Original date saved in change history log.
- **Walk-in queue number system** — Generate a queue number for walk-in customers automatically. Separate TV-friendly display screen shows current queue.
- **Reservation color coding by status** — Pending = amber, Confirmed = blue, Completed = green, Cancelled = red on the calendar.

### Offers & Discounts

- **Offer usage cap** — Set a maximum number of total uses or a per-customer limit on any offer.
- **Customer-specific or group-specific offers** — Create offers that only apply to a specific customer or customer tag (VIP, Contractor, etc.).
- **Minimum order value to trigger offer** — Offer only activates if order total exceeds a set threshold (e.g., 20% off orders above ₱2,000).
- **Combo deal offers** — Buy Item A and Item B together in the same order and get a discount on the combination.
- **Flash sale countdown timer** — For time-limited offers, show a live countdown timer on the offers page and inside the Create Order panel.
- **Offer activation notification on login** — If a new offer was activated since a staff member last logged in, show them a brief banner.
- **Full offer change history / audit log** — Every edit to every offer is logged: who changed what field, what the old value was, and when.

### Reports & Analytics

- **Profit and loss (P&L) statement** — Monthly income statement: revenue − COGS − operating expenses = net profit. Exportable to PDF and Excel.
- **Peak hours heatmap** — Heatmap showing order volume by hour of day and day of week for staffing decisions.
- **Staff performance report** — Orders processed, payments recorded, and revenue generated per employee over a selected period.
- **Customer acquisition report** — New customers added per month. New vs returning customer split shown as a chart.
- **Aged receivables report** — Outstanding balances grouped by age: 0–30 days, 31–60, 61–90, 90+ days overdue.
- **Inventory valuation report** — Total inventory value at cost price vs selling price. Shows potential revenue if all current stock is sold.
- **Delivery performance report** — On-time vs late deliveries and average fulfillment time per order type over a selected period.
- **Scheduled auto-email reports** — Admin configures daily or weekly reports to be automatically generated and emailed as PDF attachments.
- **Side-by-side period comparison** — Compare any two date ranges on the same chart (e.g., January vs February, this year vs last year).
- **Category sales breakdown report** — Revenue and units sold grouped by item category.

### Users & Access

- **Role-based page permissions matrix** — Admin configures which pages and actions (create, edit, delete) each role can access from a visual grid.
- **Employee shift / time log** — Track login and logout times per user per day. Simple timesheet view in the user management page.
- **Two-factor authentication (2FA)** — Optional TOTP-based 2FA for admin accounts using Google Authenticator or any compatible app.
- **User profile photos** — Each user uploads a profile photo. Shown in activity feeds, order assignments, and system logs.
- **Password strength enforcement** — Enforce minimum password requirements (length, uppercase, special character) on creation and reset.
- **Concurrent session limit** — Prevent the same account from being logged in on more than one device at the same time.
- **Full admin audit trail per user** — Detailed log of every action any user performed: page visited, record created, edited, or deleted.

### Settings & System

- **Company logo upload** — Upload the company logo once in Settings. It appears automatically on all generated PDFs: invoices, receipts, reservation confirmations.
- **Business hours configuration** — Set open and close times per day of the week. Show a "Closed today" banner when accessed outside business hours.
- **Notification preferences per user** — Each user chooses which events they want notifications for: new orders, low stock, payment received, etc.
- **Soft delete and recycle bin** — Deleted orders, customers, and items go to a recycle bin and can be restored within 30 days, not permanently removed immediately.
- **System health dashboard** — Show database connection status, last backup time, active sessions, server uptime, and disk usage.
- **Maintenance mode toggle** — Admin flips a switch and all non-admin users immediately see a maintenance screen.
- **Custom field builder** — Admin adds custom fields to orders or customers without touching code (e.g., Contractor License Number, Project Site Address).
- **Changelog / version history page** — A page listing what changed in each version update with dates and brief descriptions.

### UX & Mobile

- **Progressive Web App (PWA) support** — Make the app installable on Android and iOS home screens so staff can use it like a native app with offline basic viewing.
- **Global command palette** — Press Ctrl+K anywhere in the app to open a spotlight-style search across customers, orders, items, and pages.
- **Unsaved changes warning** — If a user navigates away from a half-filled form, show a confirmation dialog: "You have unsaved changes. Are you sure you want to leave?"
- **Collapsible sidebar** — The sidebar can be pinned open or collapsed to icon-only mode to give more horizontal space on smaller screens.
- **Table column visibility toggle** — On any data table, users can show or hide individual columns. Preference persists across sessions.
- **Recently viewed quick access** — Small popover on the sidebar showing the last 5 orders, items, or customers the user viewed.
- **Inline help tooltips on complex fields** — Small question mark icons next to fields like order type and payment method that explain the option on hover.
- **Keyboard shortcut reference sheet** — Press "?" anywhere in the app to open a modal listing all available keyboard shortcuts.
- **Breadcrumb navigation on all detail pages** — Always show where the user is: Dashboard > Orders > Order #JH-0042.
- **Print-friendly CSS for all pages** — Proper print styles so any page can be printed cleanly without the sidebar and nav appearing.
