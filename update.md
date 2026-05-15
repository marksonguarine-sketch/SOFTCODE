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
