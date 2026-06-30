# R2 — Cost & Yield + Converts-Into View (design)

**Date:** 2026-06-30
**Status:** approved (design), pending plan
**Slice:** R2 of the resliced inventory roadmap (the old "C3").
**Parent architecture:** `docs/superpowers/specs/2026-06-28-inventory-recipe-spine-recalibration.md` (5d6c275), §10/R2.
**Builds on (shipped):** R1 composition→recipe upgrade (#102) — `lib/recipe-math.ts`, `content_oz` derivation, `batch_yield`, `avg_oz_per_each`, measure dimensions/factors.

> Turn the oz/batch/yield model into **money + yield**: record SKU purchase prices,
> derive per-unit / plate cost recursively through the BOM, show food-cost % against a
> hand-entered sell price, surface "case → N par-units" yield, and a transitive reverse
> "which items use this SKU." **Admin-only; no operator-flow change.** Cost is real where
> data exists and shows "—" otherwise.

---

## 1. The model in one breath

> A **SKU price** is recorded into the append-only `vendor_price_history` ledger
> (`unit_price` = price per full pack; current = latest `effective_date`). **Cost per oz** =
> pack price ÷ `content_oz` (R1). An item's **per-unit cost** = Σ of its components'
> per-unit cost (SKU component = per-unit oz × cost/oz; sub-item = recursive), mirroring
> R1's `itemPerUnitOz`. **Food-cost %** = per-unit cost ÷ `items.menu_price` (a new
> hand-entered sell price). **Yield** "case → N par-units" = `content_oz ÷ per-unit oz`
> (R1's `packYieldForComponent`). **Reverse lookup** walks the composition tree to list
> every item a SKU touches, directly or through sub-items.

## 2. Decisions (resolved with Juan)

- **SKU price home:** append-only `vendor_price_history` rows. `unit_price` = **price per
  full pack/case** (e.g. $48 for a case of 6×32 oz). Current price = the row with the
  latest `effective_date` (tie-break `recorded_at`). Tracks drift over time (the moat).
- **Sell price:** new nullable **`items.menu_price`** (hand-entered, editable). Food-cost %
  computed only where it's set.
- **Reverse lookup:** **transitive** (full tree).
- **Authority:** record SKU price = **AGM+** (≥6, operational invoice logging);
  `menu_price` edit = **MoO+** (≥8, rides the Global-tab definition panel — a company-wide
  sell price is a management call); cost/yield **views** = **AGM+** (≥6, matches the BOM view).
- **menu_price + locations:** `menu_price` is one column on `items`, so it serves global
  items (`location_id` NULL) AND location-only specialty items (`location_id` SET) by
  construction. R2 builds the editing UI for **global** items; local-specialty price editing
  rides the existing local-item model. Promotion (`promoteItemToGlobal`) carries `menu_price`
  with the row (confirm at build the promote path preserves the column).

## 3. Schema (migration 0099 — one column)

`items` (45 active), `vendor_price_history` (**empty**; columns: `vendor_item_id`,
`unit_price` numeric, `effective_date` date, `recorded_at`, `recorded_by`), `item_components`
(1 row).

- **`items.menu_price numeric`** nullable + `CHECK (menu_price IS NULL OR menu_price > 0)`.
- **No change to `vendor_price_history`** — R2 starts writing rows; RLS unchanged (service-role
  writes, deny-all to users — same as every config table). Append-only: prices are new rows,
  never updated/deleted.

## 4. The cost engine

### 4a. Pure functions — extend `lib/recipe-math.ts` (no I/O, client-safe)
- `skuCostPerOz(packPrice: number | null, contentOz: number | null): number | null`
  = `packPrice ÷ contentOz` (null if either missing or `contentOz ≤ 0`).
- `componentPerUnitCost(args, measuresByLabel, skuCostPerOzById, resolveSubItemPerUnitCost)`
  — SKU component: `componentPerUnitOz(...) × skuCostPerOz(sku)`; sub-item component:
  `(quantity ÷ batchYield) × resolveSubItemPerUnitCost(subItemId)`.
- `itemPerUnitCost(batchYield, components, …)` — Σ of `componentPerUnitCost`; **null if any
  component cost is unresolved** (so the UI shows "— (incomplete)").
- `foodCostPct(perUnitCost: number | null, menuPrice: number | null): number | null`
  = `perUnitCost ÷ menuPrice` (caller ×100 for display); null if either missing.

**R1 carry-forward resolved:** the sub-item branch divides by `batchYield` exactly as
`itemPerUnitOz` does — correct, because component quantities are **per-batch** in the R1 model.
This spec is the authoritative statement; a clarifying comment lands on both functions. No
behavior change to R1.

### 4b. Server loader — new `lib/admin/cost.ts`
- `loadCurrentSkuPrices(skuIds): Map<skuId, packPrice>` — latest `vendor_price_history` row
  per SKU (numeric→`Number()` coercion — PostgREST string footgun).
- `computeItemCosts(items, components, skus, prices, measures)` — builds the BOM graph once,
  **memoized recursive** resolution of `itemPerUnitCost` with a **defensive visited-set cycle
  guard** (add-time already guards, but compute must not infinite-loop on bad data); returns
  per-item `{ perUnitCost: number | null, foodCostPct: number | null }`.
- `recordSkuPrice(actor, { skuId, unitPrice, effectiveDate })` (AGM+) — inserts a
  `vendor_price_history` row (`recorded_by`/`recorded_at`); validates positive price + a real
  date; audits `vendor_item.price_recorded`.
- `loadItemsUsingSku(skuId): { itemId, name, viaPath }[]` — **transitive** reverse lookup:
  build reverse adjacency (component → parents) over all `item_components`, BFS from the SKU
  through sub-item edges, return reachable items (+ a short "via <sub-item>" path hint).

### 4c. Set the SKU `costPerOz` Map
`skuCostPerOzById` = for each SKU, `skuCostPerOz(currentPackPrice, skuContentOz(skuInputs, measures))`
— composes R1's `skuContentOz` with the current price. Drives both the SKU readout and the
component cost.

## 5. Surfaces (admin-only — no operator path touched)

- **SKU page** (`/admin/skus` + vendor-detail SKU card):
  - **Record-price** panel (AGM+): `unit_price` + `effective_date` (default today) → inserts a
    history row; shows **current price** + **cost-per-oz** ("$X.XX / oz") + a short recent-price
    list. Route `POST /api/admin/skus/[id]/price`.
  - **"Used by"** (transitive): "Used by N items: A, B (via House Sauce)…".
- **MadeFromEditor** (item BOM, AGM+ view): per-SKU-component **"1 {pack} → ≈ N {par-unit}"**
  yield + that component's **cost contribution**; the item's **total per-unit cost** + **food-cost
  %** badge (when `menu_price` set). All show "—" until prices/`content_oz`/`menu_price` exist.
- **Global-tab item definition panel** (MoO+): `menu_price` input (next to the R1 fields).

## 6. Verification
- `npx tsc --noEmit` + `npm run build` clean.
- Throwaway tsx smoke (deleted before commit): `skuCostPerOz` (e.g. $48 pack ÷ 512 oz =
  $0.09375/oz); `itemPerUnitCost` for the 1 live `item_components` row after recording a price
  (assert a `number`); `foodCostPct` (cost ÷ menu_price); `loadItemsUsingSku` transitive on a
  2-level composite; numeric→`number` coercion asserted.
- **Operator smoke (Juan, preview):** AM-prep / mid-day / Opening render identical; then record
  a SKU price → cost-per-oz appears; open an item's "Made from" → per-unit cost + yield; set a
  `menu_price` → food-cost % appears.

## 7. Boundary (what R2 is NOT)
- **Receiving** (auto price-ingest from digital vendor receipts) = R3.
- **Counting / on-hand / "available for prep"** = R4. **Variance** = R5.
- **Per-location pricing / dynamic pricing** = a later slice (the column supports local items;
  the per-location *pricing UI* is deferred).
- Food-cost % is **manual** (hand-entered `menu_price`) until Toast menu sync lands.

## 8. Open decisions deferred
- **D-price-authority:** if AGM+ should also set `menu_price`, give it its own affordance like
  the SKU price panel (currently MoO+ via the definition panel). Flagged to Juan.
- **D-sell-price-history:** `menu_price` is a single editable column now ("edit as we go"); a
  sell-price *history* (margin-over-time) can come with the pricing module if needed.
