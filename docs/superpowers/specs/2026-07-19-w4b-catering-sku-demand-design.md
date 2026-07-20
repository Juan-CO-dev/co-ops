# W4b — Catering SKU-Demand (the SKU layer of the reserve/deplete moat)

**Date:** 2026-07-19
**Status:** Design approved (Juan), pre-implementation
**Follows:** W1a (#139), 3a (#140), W1b (#148), **W4a (#149 — the prep layer this extends)**

## 1. Context & goal

W4a shipped the **prep layer** of the catering↔inventory moat: confirmed catering → an append-only `catering_prep_demand` ledger (per prep-item, per date) + a prep-demand overlay/over-par signal. W4b is the **SKU layer** — Juan's Tier-2: *"when the ability to make that prep is low (not enough raw ingredients), that triggers SKUs getting ordered."*

W4b **flattens** the catering prep-demand into the **raw SKUs** it consumes (via the item→recipe→SKU graph), aggregates SKU demand across a location's confirmed catering, compares it against computed on-hand, and surfaces an advisory **"SKU short → order ~N more"** signal. **Advisory brain, not a hard hold / not a PO workflow** — same posture as W4a. **No new table** (pure derive-on-read over W4a's ledger + the recipe graph).

**Posture:** effectively DORMANT until the menu/recipe layer is authored. (4 recipes exist in prod today; ~5% authored per the inventory-wiring-state note — catering items/subs have no recipes yet, so the flatten yields ~nothing until the wiring pass loads the menu. Empty-state, no errors.)

## 2. Scope

**In scope (W4b):**
- A new `perUnitSkuOzForMenuItem(menuItemId)` flatten (subs → SKU oz), mirroring the existing `perUnitSkuOzForItem` via the `recipe_outputs.output_menu_item_id` path.
- Export the currently-private `loadInStockPacks` from `lib/production.ts` (the on-hand read W4b needs).
- A new read lib `lib/catering/sku-demand.ts` — `loadCateringSkuDemand(actor, {locationId, from, to})`: reads W4a's reserved prep-demand, flattens each item/sub line to SKU-oz (portion-scaled), aggregates per (SKU, date) + a window rollup, compares to on-hand, computes shortfall + suggested order quantity.
- A **"Raw / SKU" tab** on the existing W4a `/admin/catering/prep-demand` view (shared location + date-window controls).
- A seeded smoke.

**Out of scope (deferred):**
- **SKU-par write / any PO / ordering workflow** — there is no SKU-par table to write to (`par_levels` is vestigial; only item-level `item_par_levels` exists). The SKU-par/purchasing write lands with the **Phase-5 ordering / supply-chain slice**. W4b only *produces the signal*.
- **Choice-slot flatten** — unresolved W1b choice slots can't be decomposed (no concrete item); excluded + captioned.
- **A sub-level "prep par"** — there is no `menu_item` par (item_par_levels is item-only), so W4a's deferred "sub par comparison" has no home; W4b instead gives subs their *SKU-level* demand (the useful signal). No sub par is introduced.
- **W4c — over-prep surplus redistribution** (the cancellation flip-side: released-after-made prep → LTO/discount) — downstream, needs an LTO destination.

## 3. The flatten + SKU-demand aggregation

- **`perUnitSkuOzForItem(itemId) → Promise<Map<sku_id, oz_per_unit>>`** — EXISTS (`lib/prep-consumption.ts:44`). Recursive item→recipe→(sub-items + SKUs), one-active-recipe, batch-yield fan-out, cycle guard. Returns empty map when no recipe.
- **`perUnitSkuOzForMenuItem(menuItemId) → Promise<Map<sku_id, oz_per_unit>>`** — NEW (add to `lib/prep-consumption.ts`). Same algorithm, but resolves the active recipe via `recipe_outputs.output_menu_item_id` (instead of `output_item_id`). Everything downstream (the recursive `batchOz`/`perUnitFromNode` walk over `recipe_inputs`) is shared with the item version — the only difference is the top-level recipe lookup. Returns empty map when the sub has no recipe.
- **`loadCateringSkuDemand(actor, {locationId, from, to})`** (`lib/catering/sku-demand.ts`, `requireLevel ≥6`):
  1. Read W4a `catering_prep_demand` (`status='reserved'`, location, `need_date` in [from,to]) → the demand lines (item/menu_item/choice refs + portion + qty + need_date).
  2. For each **distinct** item/sub ref (memoized — call the flatten once per ref, not per line): `item` → `perUnitSkuOzForItem`; `menu_item` → `perUnitSkuOzForMenuItem`.
  3. Per demand line, scale: `lineSkuOz = perUnitOz × qty × (portion ? PORTION_FRACTION[portion] : 1)` — a ½-sub consumes half the SKU oz. Choice-slot lines: skipped (flagged). No-recipe refs: empty flatten → contribute 0 (flagged).
  4. Aggregate `oz` **per (sku_id, need_date)** (the "when") AND a **window rollup per sku_id** (the "how much total").
- **Grain:** oz is the computation basis (recipe-math is oz-native). Display shows oz **and** packs (`oz ÷ skuContentOz(sku)`), skipping packs when `content_oz` is unknown.

## 4. Availability comparison (honest about the advisory on-hand)

- On-hand from **`loadInStockPacks(skuIds, locationId) → Map<sku_id, packs>`** (`lib/production.ts` — **export it**; currently private). It is `received − consumed`, **advisory** (packs; the consumed side has a known unit inconsistency; not a physical count). Convert packs→oz via `skuContentOz` for an oz-basis comparison.
- **Shortfall is a WINDOW ROLLUP, not per-date:** on-hand is a single *current* number while demand is spread across dates, so per-date shortfall would mislead. Per-(SKU, date) demand is shown for planning ("consume 192 oz Fri"); the **shortfall/order signal compares total window demand vs current on-hand** per SKU ("14-day catering needs 320 oz; on hand ~180 oz → short ~140 oz").
- **Every on-hand/shortfall figure is flagged "approx — received − used, not a count."** When a SKU's `content_oz` is unknown → show oz demand only, **skip packs + shortfall** (can't convert honestly).
- **Choice slots** contribute a caption "N unresolved catering lines not included in SKU totals"; **no-recipe refs** a separate caption "N demand lines have no recipe and aren't decomposed here." Numbers are never silently under-counted.

## 5. The "order more" signal (SKU-par deferred)

- Per SKU with a window shortfall: an advisory **"order ~N more"** = `ceil(shortfall_oz / content_oz)` packs (or oz when content-oz unknown). Purely informational; nothing written.
- **"Raise SKU par" is out of scope — there is no SKU-par table to write to.** Unlike W4a (which had the `/admin/pars` placeholder to link to), W4b has no SKU-par surface at all. The SKU-par/PO write lands with the Phase-5 ordering slice, which will consume this signal.

## 6. Surface

Extend the existing **W4a `/admin/catering/prep-demand` view** with a two-tab toggle sharing the location selector + date window:
- **"Prep" tab** = W4a (per-prep-item demand + over-par + par-bump) — unchanged.
- **"Raw / SKU" tab** = W4b — a per-(SKU, date) demand table + the window-rollup shortfall / "order ~N more" per SKU + the unresolved/no-recipe captions.

Server page adds a second data load (`loadCateringSkuDemand`); the client gets a tab switch. No new route. i18n EN+ES (tú-form) for all new strings.

## 7. Error handling, dormancy, edge cases

- **Dormant-safe:** no catering recipes → flatten returns empty → tab shows "no SKU demand — recipes not yet authored." No errors.
- **No-recipe demand lines:** contribute 0 SKU demand + a caption (distinct from the choice-slot caption).
- **Choice slots:** excluded + captioned.
- **Missing `content_oz`:** oz-only display; skip packs + shortfall for that SKU.
- **Query fan-out:** the flatten runs per-item recipe queries → W4b calls it **once per distinct item/sub ref** (memoize) — bounded at catering scale, not a growth-table risk.
- **Inherited assumptions** (documented, not re-litigated): one-active-recipe-per-item, multi-tier recursion + cycle guard, the advisory/heterogeneous-unit on-hand.
- **Authz:** read-only, `level ≥6` (reuse `PREP_DEMAND_READ_MIN`), service-role reads over W4a's already-location-gated ledger. No writes.

## 8. Testing

`scripts/w4b-smoke.ts` (heaviest smoke yet — must author real recipes; mirror w4a-smoke structure, service-role, seed→drive→assert→hard-delete, zero residue):
- Seed: a `vendor_items` SKU (pack/oz fields set so `content_oz` resolves) + a `vendor_deliveries` + `vendor_delivery_items` (`qty_received` → on-hand); an `items` extra + a `recipes`(recipe_type/batch_yield) + `recipe_inputs`(component_sku_id, quantity, unit) + `recipe_outputs`(output_item_id, yield) → item→SKU oz; a `menu_items` sub + its recipe + `recipe_outputs`(output_menu_item_id) → sub→SKU oz; a confirmed lead + accepted quote + `catering_quote_items` (item qty, sub qty with `portion='half'`, a package/choice line) → `reservePrepDemand` (W4a).
- Assert `loadCateringSkuDemand`: SKU-oz aggregation = `item(qty × item→sku oz) + sub(qty × 0.5 × sub→sku oz)`; per-(SKU, date) + window rollup; shortfall = `demand_oz − onhand_oz` (received→oz via `skuContentOz`); order-more = `ceil(shortfall/content_oz)`; the choice slot excluded with its caption count; a **second SKU with missing content-oz** shows oz-only (no packs/shortfall).
- Hard-delete everything (recipes/inputs/outputs, SKU, delivery, W4a chain) → zero residue. Plus `build`/`typecheck`/`eslint`.

## 9. Confirm-before-authoring — VERIFIED against live DB + code (2026-07-19)

- **`loadInStockPacks(skuIds, locationId) → Promise<Map<sku_id, packs>>`** is **PRIVATE** in `lib/production.ts:138` (only `loadProductionFormData` is exported). **W4b must export it** (change `async function` → `export async function`) — the one code-touch outside the new files.
- **`perUnitSkuOzForItem`** exported (`lib/prep-consumption.ts:44`, `→ Map<sku_id, oz_per_unit>`). **`skuContentOz(sku, measuresByLabel)`** exported (`lib/recipe-math.ts:30`, `→ number|null`, packs→oz).
- **Schema:** `recipe_outputs` = `id, recipe_id, output_item_id, output_menu_item_id, yield, oz_alloc_share, ...` (XOR item/menu output — the sub path exists). `recipe_inputs` = `recipe_id, component_sku_id, component_item_id, quantity, unit, portioned, ...`. `recipes` = `recipe_type, batch_yield, active, ...`. `vendor_items` (SKU) oz fields = `units_per_pack, each_size, each_measure, avg_oz_per_each, pack_format`. `vendor_delivery_items` = `delivery_id, vendor_item_id, qty_received, ...`.
- **W4a ledger:** `catering_prep_demand` (migration 0137) — read `status='reserved'` rows (`item_id`/`menu_item_id`/`choice_package_item_id`, `portion`, `qty`, `need_date`, `location_id`).
- **`PORTION_FRACTION`** (`lib/catering/pricing-derivation.ts`) `{quarter:0.25, half:0.5, whole:1}`.
- **4 recipes** exist in prod (still ~5% authored; catering menu unauthored → flatten effectively dormant for catering). **W4b adds NO migration** (pure derive-on-read + one export + one new flatten fn + read lib + UI tab).

## 10. Deferred / boundaries

- **W4c** — over-prep surplus redistribution (released-after-made prep → LTO/discount/staff-meal); needs W4b + an LTO destination surface.
- **SKU-par write + purchasing/PO** — Phase-5 ordering slice (consumes W4b's signal).
- **Choice-slot resolution** (W1b) — so choice demand becomes concrete + flattenable.
- The advisory on-hand becoming authoritative (a real count/ledger) is its own inventory-truth effort, out of scope.
