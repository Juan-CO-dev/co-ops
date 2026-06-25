# SKU Catalog — Slice C1 Design

**Date:** 2026-06-25
**Phase:** Item/Inventory Spine — vendor mini-arc, Slice C1 (of C: C1 SKU catalog / C2 BOM / C3 converts-into + cost-yield). Depends on B (#95–#97 merged).
**Status:** draft, pending review

---

## Goal
Activate the SKU catalog (`vendor_items`) — the purchasable units. Manage SKUs **both** under each vendor (vendor detail page) **and** on a global catalog page; support **manual** (vendor-less) + **per-location** SKUs. This is the foundation the C2 BOM (item ← SKUs) + C3 "what a vendor's cases convert into" build on.

## Ground truth
- `vendor_items`: 24 SKUs, all on "Baldor", `vendor_id` NOT NULL, no `location_id`. Cols: name, category(text, vestigial), unit, unit_size, item_number, source_url, lead_time_days, weekday_par/weekend_par (dormant ordering par — leave), notes, active, audit.
- `items`: all `kind="manual"` (45 active); `item_components` (BOM) empty → C2's job.

## Decisions (Juan-locked)
- **Both placements:** per-vendor (vendor detail SKUs card) + a global `/admin/skus` catalog page (all SKUs, filter by vendor).
- **Authority:** **GM+ (≥7)** add/edit/deactivate; **AGM+ (≥6)** view (admin floor).
- **Schema now:** `vendor_items.vendor_id` → **nullable** (manual/vendor-less SKUs); add **`location_id`** (nullable FK→locations; null = global, set = location-specific).

## Architecture (C1)

### Migration 0095
```
alter table vendor_items alter column vendor_id drop not null;
alter table vendor_items add column location_id uuid null references locations(id);
```
(No backfill — existing 24 keep their vendor + null location = global.)

### Lib `lib/admin/skus.ts` (new)
- `SkuView` (id, vendorId, vendorName|null, locationId, name, unit, unitSize, itemNumber, sourceUrl, leadTimeDays, notes, active).
- `loadSkus(actor, { vendorId? })` — ≥6. All SKUs, or filtered to a vendor. Hydrate vendor name + location.
- `loadVendorSkus(actor, vendorId)` — ≥6 (the vendor detail card).
- `createSku(actor, input)` — GM+. `vendor_id` optional (manual), `location_id` optional (global). Validate name + unit; lowercase nothing special.
- `updateSku(actor, { id, changes })` — GM+ (incl. reassigning `vendor_id` → handles the "reassign off Baldor" flow).
- `deactivateSku(actor, { id, active })` — GM+ (append-only).
- `AdminSkuError`. Audits: reuse/extend — add `vendor_item.create` / `vendor_item.update` / `vendor_item.deactivate` to destructive-actions.
- SKU **category** omitted from the C1 form (SKUs get categorization via their item link in C2; the vestigial `category` text column is left untouched). SKU **cost** deferred to the C3 cost/yield slice (`vendor_price_history`).

### Routes
- `app/api/admin/skus/route.ts`: GET (≥6, optional `?vendorId=`) + POST create (GM+, Tier B).
- `app/api/admin/skus/[id]/route.ts`: PATCH update (GM+, Tier A) + deactivate (GM+).
- (Reuses the existing stubbed `vendors/[id]/items` route? No — use the cleaner `/admin/skus` set; leave that stub or wire it to loadVendorSkus. Decide at build — prefer `/admin/skus?vendorId=` for both surfaces.)

### Pages / UI
- **Vendor detail SKUs card** (`VendorDetailClient`): list the vendor's SKUs (name · unit/unit_size · item # · lead time) + Add/Edit/Deactivate (GM+). Add form: name, unit, unit_size, item_number, source_url, lead_time, location (optional, default global), notes.
- **Global catalog page** `/admin/skus`: all SKUs, filter by vendor (incl. a "Manual / no vendor" bucket), add (GM+) — here a SKU can be created vendor-less (manual) or assigned/reassigned to a vendor. Hub card (≥6).
- EN+ES i18n.

## Testing
tsc + build + throwaway smoke (deleted): createSku (GM+) with + without a vendor (manual) + with/without location; AGM blocked from create; loadSkus all + by-vendor; updateSku reassigns vendor (Baldor→another); deactivate. Clean up.

## Open decisions (your review)
- **D1 — SKU category.** Omit from C1 (categorization via the item link in C2) vs add a categories-registry dropdown to SKUs now. *Recommend omit for C1.*
- **D2 — vendors/[id]/items stub.** Use `/admin/skus?vendorId=` for both surfaces (retire the stub) vs wire the existing `vendors/[id]/items` stub. *Recommend the unified `/admin/skus` route.*

## Out of scope
- C2 BOM (item ← component SKUs via `item_components`) + C3 converts-into view + food cost/yield (needs `vendor_price_history`).
- Ordering/receiving/on-hand (later spine steps).
