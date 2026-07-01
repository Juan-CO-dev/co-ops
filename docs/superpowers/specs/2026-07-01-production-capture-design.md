# Production Capture (S1 signal, standalone) design

**Date:** 2026-07-01
**Status:** approved (design), pending plan
**Slice:** First of the consumption-engine arc — **S1 production capture**, standalone.
**Builds on:** R1 (`content_oz`, recipe-math), R2 (prices, `lib/admin/cost.ts`), R3 (deliveries), R3.5 (`loadSkuReceivingLedger`, `SkuCostPanel`).
**Vision context:** the triangulated consumption engine (S1 production / S2 count / S3 recipe-theoretical, averaged; gaps = shrinkage). This slice ships **S1 only**.

> A prep person logs a **conversion**: pick a SKU → the items makeable from it → enter how much
> raw they're using ("1 case") → the system **predicts the output** ("≈ 4 pans") → confirm or edit.
> Recording it **depletes the SKU** (the consumption signal), **credits the item made**, and
> **refines the yield** (running average) for the next prediction. The SKU catalog tile gains a
> real **in-stock** number = received (R3) − consumed. **Standalone `/operations/production` — no
> AM-prep change** (folding into the prep flow is the follow-up).

---

## 1. The model in one breath

> A **production** row = one conversion: `input_sku_id × input_qty → output_item_id × output_qty`
> at a location. **In-stock** per SKU = `received oz/$ (R3.5) − Σ conversions' input converted to
> oz/$`. **Predicted output** for a (SKU → item) pair = running-average observed `output ÷ input`
> × input_qty (fallback: the item's recipe; none → no prediction, prep enters + seeds). KH+,
> location-bound, `/operations/production`.

## 2. The flow (Juan's SKU-first cascade)

1. Pick an active **SKU** (the dropdown shows each SKU + its current in-stock qty).
2. The **item** dropdown populates with only items **makeable from that SKU** = items whose
   `item_components` has a `component_sku_id` = the SKU (direct reverse edge).
3. Enter **input qty** (in the SKU's pack unit — "1 case").
4. System **predicts output** (running-avg observed yield × input; else recipe; else blank).
5. Prep **confirms or edits** the output qty (item par-units).
6. Optional notes → **submit**.

## 3. What one conversion does

- **Depletes the SKU** by `input_qty` → drives the SKU in-stock number down (§5).
- **Credits the item made** (`output_qty`) — recorded for later S3/reporting.
- **Refines the yield**: observed `output_qty ÷ input_qty` (pans per case) feeds the running average
  that drives the *next* prediction. Recipes self-correct toward operational truth **without editing
  the stored recipe** (observations layer on top; the `item_components` recipe stays the stable seed
  / fallback — writing back to the recipe is a later pass).

## 3a. Prediction (`predictOutput`)

For a `(inputSkuId, outputItemId)` pair + `inputQty`:
1. If ≥1 prior `productions` rows for that pair → `predicted = inputQty × mean(output_qty ÷ input_qty)`
   over those rows.
2. Else if the item's recipe (`item_components` edge for this SKU, with `content_oz`) resolves →
   derive an expected output (input converted to oz ÷ the item's per-unit oz from this SKU).
3. Else → no prediction (prep enters the output, seeding observation #1).
Prediction is advisory only — the prep's confirmed/edited `output_qty` is what's stored.

## 4. Schema (migration 0101)

New **`productions`** (one conversion per row):
- `id uuid pk default gen_random_uuid()`
- `location_id uuid not null references locations(id)`
- `produced_at timestamptz not null default now()`
- `input_sku_id uuid not null references vendor_items(id)`
- `input_qty numeric not null check (input_qty > 0)` — in the SKU's pack unit
- `output_item_id uuid not null references items(id)`
- `output_qty numeric not null check (output_qty > 0)` — in the item's par-unit
- `notes text`
- `created_by uuid`
- indexes on `input_sku_id`, `output_item_id`, `location_id`.
- **RLS:** deny-all to users (`_no_user_{select,insert,update,delete}`), service-role writes (mirror
  `vendor_delivery_items`). Append-only.

## 5. SKU in-stock (the tile — Juan's #4, now real)

- New **`loadSkuConsumption(actor, skuIds): Map<skuId, { consumedOz, consumedDollars }>`** (AGM+):
  Σ over `productions` with `input_sku_id ∈ skuIds` of `input_qty × content_oz(sku)` (oz) and
  `× cost/oz(sku)` ($). Composes R1 `skuContentOz` + R2 `loadCurrentSkuPrices` (same as the ledger).
- **`SkuCostPanel`** gains an **In stock** line above/with the Deliveries block:
  `oz = receivedOz − consumedOz`, `$ = receivedDollars − consumedDollars` (received from R3.5's
  ledger). Labeled honestly (e.g. "In stock (est.)" — theoretical until physical count reconciles).
  Both `skuLedger` (R3.5) + the new `skuConsumption` thread from the two SKU page loaders.
- The **production form's SKU dropdown** shows each SKU's current in-stock qty (packs) for context —
  computed the same way (received packs − consumed packs), a light per-SKU number in
  `loadProductionFormData`.

## 6. Data layer (`lib/production.ts` — operational, service-role + KH+ gate + location-bind)

- `PRODUCE_MIN = 4`. `ProductionError` (typed).
- `loadProductionFormData(actor, locationId)` → `{ skus: [{id, name, inStockPacks}], skuToItems:
  Record<skuId, [{itemId, name}]> }` — active SKUs (+ in-stock packs) + the direct reverse map
  (SKU → items with an `item_components` edge from it). KH+ + location-bind.
- `predictOutput(actor, { inputSkuId, outputItemId, inputQty })` → `{ predicted: number | null }`
  (§3a). Called by the form on input change (a small POST or a computed pass — see §7).
- `recordProduction(actor, { locationId, inputSkuId, inputQty, outputItemId, outputQty, notes? })`
  → `{ productionId }`. KH+ + location-bind; validate SKU active + item active + the item actually
  uses the SKU (an `item_components` edge exists — else `invalid_conversion`); positive qtys; insert;
  audit `production.recorded` (metadata: sku, item, input/output qty, observed yield).
- `loadRecentProductions(actor, locationId, limit)` → recent conversions (date · SKU → item · qtys).

## 7. Surfaces & authority

- **`/operations/production`** page (KH+, `?location` + `lockLocationContext`) + a `ProductionForm`
  client (SKU select → item select cascade → input qty → predicted output [editable] → notes) +
  a recent-productions list. Prediction: the form fetches `predictOutput` (a `POST
  /api/operations/production/predict`) when SKU+item+input are set, OR the page passes enough to
  compute client-side — **plan picks** the POST-predict (keeps yield math server-side, one source).
- **`POST /api/operations/production`** (record) + **`POST /api/operations/production/predict`**
  (advisory), both KH+.
- **Dashboard tile** (KH+) → `/operations/production`.
- **Authority:** KH+ (≥4), location-bound. `loadSkuConsumption` view = AGM+ (SKU catalog).

## 8. Verification

- `tsc --noEmit` + `npm run build` clean.
- Throwaway tsx smoke (deleted): `recordProduction` for a real SKU→item pair (needs an
  `item_components` edge — create a temp one if none, roll back) → asserts a `productions` row lands;
  `predictOutput` returns the running-avg after ≥1 obs; `loadSkuConsumption` returns numbers and the
  SKU's on-hand = received − consumed moves; numeric→number coercion asserted; cleanup deletes the
  smoke rows.
- **Operator smoke (Juan, preview):** AM-prep / mid-day / Opening / closing **render identical**
  (production is a NEW standalone surface — touches no existing operator flow). Then from the
  Production tile: pick a SKU → the item it makes appears → enter input → see a predicted output →
  confirm → it lands in recent productions and the SKU's in-stock number on `/admin/skus` drops.

## 9. Boundary (what this is NOT)

- **S1 only.** S2 (physical count) + S3 (recipe-theoretical usage) + the **triangulation/averaging**
  across signals = later slices.
- **Single input SKU → single item** per conversion (portioning). Multi-SKU "combining" recipes =
  a follow-up.
- **No AM-prep change** — folding production into the prep flow is the explicit follow-up.
- **No recipe write-back** — observations refine the *prediction*, not the stored `item_components`
  (later pass). Physical-count reconciliation (theoretical → true on-hand, shrinkage) = S2/variance.

## 10. Open decisions deferred
- **D-writeback:** later, promote the running-avg yield into `item_components`/`batch_yield` so the
  stored recipe itself self-corrects.
- **D-multi-input:** combining recipes (multiple SKUs → one item) — a richer capture UX.
- **D-onhand-window:** in-stock is all-time received − all-time consumed until physical counts (S2)
  add a re-baseline anchor.
