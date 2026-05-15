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
