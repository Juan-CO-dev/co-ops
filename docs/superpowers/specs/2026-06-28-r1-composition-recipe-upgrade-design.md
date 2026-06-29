# R1 — Composition→Recipe Upgrade (design)

**Date:** 2026-06-28
**Status:** approved (design), pending plan
**Slice:** R1 of the resliced inventory roadmap.
**Parent architecture:** `docs/superpowers/specs/2026-06-28-inventory-recipe-spine-recalibration.md` (commit 5d6c275).
**Builds on (shipped):** C1 SKU catalog (#98), C2 item↔SKU BOM (#99).
**North star:** `~/.claude/.../memory/project_coops_inventory_truth_model.md`.

> Turns C2's `item_components` BOM into the full **oz / batch / yield recipe model**: items
> carry a tracking type + a batch yield; SKUs carry the inputs to derive total ounces per
> pack; measure units carry a dimension + conversion factor; a pure derivation engine
> computes per-unit consumption (in oz) and pack yield. **No operator-flow change** — the
> daily AM-prep / opening / mid-day forms read no new field. This is the structure + math +
> admin entry; cost numbers are R2, counting/on-hand is R4, variance is R5.

---

## 1. The model in one breath

> Every **item** has a **tracking type** (`on_hand | portioned | line`) and a **batch yield**
> (how many of its par-units one batch/composition makes). Its **composition**
> (`item_components`, from C2) is now read as **per-batch** quantities. Every **SKU** carries
> the inputs to derive **`content_oz`** (total usable ounces per pack). Every **measure unit**
> carries a **dimension** + **factor to its dimension's base**. A pure **derivation engine**
> turns all of this into per-unit oz, per-unit consumption, and "this case makes ≈ N par-units."

## 2. Two oz-conversions (the core distinction)

There are **two** independent ways "ounces" enter the system; conflating them is the trap:

1. **SKU → oz** (`content_oz`, via `avg_oz_per_each`) — raw purchased stock in the walk-in.
   Mayo `Case · 4 · 128 oz` → 512 oz; lettuce `Case · 24 heads` → 24 × avg-oz-per-head.
2. **Item container → oz** (`oz_per_par_unit`) — a *full quart / 1/3 pan / cambro of the
   finished item* ≈ N oz. Shredded mozz, peppers, onions, caramelized onions, jus, basil,
   pickles, etc. are stored/counted in standardized containers, so "oz per full quart" is
   easy to approximate; 3rd-pan items are irregular → approximate as close as possible.

They **differ whenever there is yield loss**: 10 oz of raw onion cooks down to ~6 oz of
caramelized onion in the quart. The composition **depletes 10 oz** of the onion SKU
(theoretical usage), but you **physically count 6 oz** of finished product. Both numbers are
real and needed; the gap between them is itself a yield-loss signal (surfaced in R4/R5).

## 3. Batch + yield (entered once, two views) — locked in recalibration

- **Entered (truth):** a composition produces a **`batch_yield`** of N of the item's own
  par-units from **per-batch** component quantities — "this batch makes 4 quarts from these
  inputs." Matches how recipe books are written; GM-and-down granularity.
- **Derived (never entered):** per-unit consumption = `per-batch quantity ÷ batch_yield`;
  (per-unit **cost** = `Σ input cost ÷ batch_yield` — shape only in R1, real numbers in R2).
- A 1:1 pure-portion item is just `batch_yield = 1`.

## 4. Units — everything resolves to oz

Recipes are weighed in oz, but `measure_units` mixes **weight** (oz/lb/g/kg), **volume**
(fl oz/gallon/mL/liter), and **count**. Converting *within* a dimension is pure math
(lb→oz = ×16); converting *across* dimensions (fl oz→oz) needs density and is product-specific.
So:

- `measure_units` gains **`dimension`** (`weight | volume | count`) + **`to_base_factor`**
  (factor to the dimension's canonical base — weight→oz, volume→fl oz, count→each).
- **`content_oz` is computed** for weight-measured SKUs (the factor is known); for
  count/volume-measured SKUs it uses the SKU's entered **`avg_oz_per_each`** (oz per one
  `each_measure` unit — oz per head, oz per gallon).
- **The head/lot variance is a feature:** `avg_oz_per_each` is one running average now; R3
  (receiving — see §9) refines it from measured deliveries, and the residual drift is the
  count signal.

## 5. Schema deltas (one migration — **0097**)

`items` (45 active, all `kind='manual'`), `item_components` (**empty** — semantics free),
`vendor_items` (C1 pack model), `measure_units` (9 labels, no dimension/factor).

- **`items`**
  - `+ tracking_type text NOT NULL DEFAULT 'portioned'` CHECK in (`on_hand`,`portioned`,`line`).
    Backfill: all 45 → `'portioned'`; Juan reclassifies the on-hand/line ones via the picker
    (nothing consumes the field until R4, so a rough default is harmless).
  - `+ batch_yield numeric NOT NULL DEFAULT 1` CHECK `> 0`.
  - `+ oz_per_par_unit numeric` (nullable) — ≈ oz when a full `default_par_unit` of the
    **finished** item; a measured/approximated **source of truth** (stored, not derived,
    because yield loss makes it independent of the composition). Consumed by R4.
  - **`− kind`** — drop the column (all `'manual'`, not load-bearing) and retire the
    `ItemKind` type. Coordinate with the lib edits (see §8) in the same PR so no insert path
    sends the dropped column.
- **`vendor_items`**
  - `+ avg_oz_per_each numeric` (nullable) — oz per one `each_measure` unit; **required when
    the measure's dimension is `count` or `volume`**, ignored (null) for `weight`.
  - **No `content_oz` column** — derived (see §6). *Deliberate deviation* from the
    recalibration doc's literal "add `content_oz` column": deriving keeps `avg_oz_per_each`
    the single source of truth, so refining the average instantly re-flows everywhere (the
    whole point of the ledger). R5 snapshots point-in-time `content_oz` when it needs to
    freeze a value.
- **`measure_units`**
  - `+ dimension text` CHECK in (`weight`,`volume`,`count`).
  - `+ to_base_factor numeric`.
  - Backfill the 9: `oz`=weight/1, `lb`=weight/16, `gram`=weight/0.035274,
    `kg`=weight/35.27396, `fl oz`=volume/1, `gallon`=volume/128, `mL`=volume/0.033814,
    `liter`=volume/33.814, `count`=count/1.
- **`item_components`** — no DDL (empty). `quantity` is now interpreted as **per-batch**,
  enforced by the editor + helpers; `unit` is the component's measure label.

RLS: new columns inherit existing table policies (service-role writes, deny-all to users) —
no policy change. Append-only unaffected (these are config tables).

## 6. The derivation engine — new `lib/recipe-math.ts` (pure, no I/O)

Single home for the math; consumed by the admin BOM readout now, and by R2 (cost) + R5
(variance) later. All functions pure (take already-loaded data + a `measuresById` map).

- `skuContentOz(sku, measuresById): number | null`
  = `units_per_pack × each_size × ozPerMeasureUnit`, where `ozPerMeasureUnit` =
  `to_base_factor` when the each_measure dimension is `weight`, else the SKU's
  `avg_oz_per_each`. Null when inputs are missing. (Mayo `4×128×1 = 512`; lettuce
  `24×1×avgHead`; oil `4×1×ozPerGallon`.)
- `componentPerUnitOz(component, batchYield, skuById, itemById, measuresById): number`
  — the component's oz contribution per ONE par-unit = (component oz ÷ `batchYield`).
  Component oz: SKU component → convert `quantity`(measure) to oz (weight → ×factor;
  count/volume → × the SKU's `avg_oz_per_each`); sub-item component → `quantity` ×
  (sub-item's `itemPerUnitOz`, **recursive**; the C2 cycle guard already prevents loops).
- `itemPerUnitOz(item, components, …): number` — Σ of `componentPerUnitOz` over the item's
  components = oz of inputs consumed per ONE par-unit (theoretical SKU depletion per par-unit).
- `packYieldForComponent(contentOz, perUnitOz): number | null`
  = `contentOz ÷ perUnitOz` = "this pack makes ≈ N par-units" (the converts-into hint).

Note: per-unit **cost** is intentionally **not** built in R1 (no SKU price exists; price is
R2). The engine's shape anticipates it (cost = same traversal with price ÷ content_oz), but
R1 ships only the oz math, which is fully usable today.

## 7. Admin surfacing — NO operator-flow change

All admin-only; the operator AM-prep / opening / mid-day forms read none of these fields.

- **SkuForm** (`components/admin/skus/SkuForm.tsx`): `avg_oz_per_each` input, shown only when
  the chosen `each_measure`'s dimension is `count` or `volume`; a read-only computed
  "**≈ 512 oz / case**" readout (`skuContentOz`).
- **MadeFromEditor** (`components/admin/templates/MadeFromEditor.tsx`): a `batch_yield` input
  on the item; the quantity column relabeled "**per batch**"; per SKU component, a derived
  **per-unit**, **per-unit oz**, and "**case → ≈ N par-units**" hint.
- **Global-tab item panel**: a `tracking_type` picker + an `oz_per_par_unit` input
  ("≈ oz per full {default_par_unit}"), next to the existing definition controls.
- **measure_units add** (MoO+, via `RegistrySelect` inline-add): now also collects
  `dimension` + `to_base_factor`.
- All new strings EN + ES (tú-form), parity required.

Authority (unchanged from C1/C2): SKU fields GM+ (≥7) manage / AGM+ (≥6) view; item
definition fields MoO+ (≥8) edit; measure-unit add MoO+ (≥8). `tracking_type` /
`batch_yield` / `oz_per_par_unit` are item-definition fields → MoO+ edit, AGM+ view.

## 8. Retiring `kind` (cross-cutting — same PR as the migration)

Dropping a `NOT NULL` column that current inserts populate must ship with the lib edits, or
inserts error. Confirm exact sites at build (`grep` noise: `ComponentView.kind: "sku"|"item"`
and unrelated `kind` words are **not** consumers). Known real consumers:

- `lib/types.ts` — `Item.kind` + the `ItemKind` type → remove; add `trackingType`,
  `batchYield`, `ozPerParUnit` to `Item`.
- `lib/admin/templates.ts` — item insert paths (`addRegistryItem`/`ensureItemLineOnTemplate`/
  `addPrepItem`) that set `kind` → remove the field.
- `scripts/backfill-item-registry.ts` / `scripts/backfill-par-layer.ts` — historical scripts;
  if they reference `kind`, leave the script files but they won't run again (note only).

## 9. What R1 sets up (not in scope, for context)

- **R2 — cost & yield + converts-into:** SKU price + `vendor_price_history` → plate cost,
  food-cost %, "case → N pans", reverse per-SKU "which items use this." Rides directly on
  §6's engine.
- **R3 — receiving:** ingests the now-**digital vendor receipts** (a GM got vendors to send
  them) — the producer's label states the pack oz, which **validates** §6's `content_oz` and
  **refines** `avg_oz_per_each` from measured deliveries.
- **R4 — count + on-hand:** counts items in containers → oz via `oz_per_par_unit`; "ounces
  available for the line" + "total ounces at the location" readouts; consumes `tracking_type`.
- **R5 — variance:** actual (count+received−count) vs theoretical (§6 run forward) = shrinkage.

## 10. Verification

- `npx tsc --noEmit` + `npm run build` clean.
- Throwaway smoke (`scripts/_smoke_*.ts`, run via `npx tsx --env-file=.env.local`, **deleted
  before commit**): `skuContentOz` for a weight SKU (expect computed) + a count SKU (expect
  `units × avg_oz_per_each`); `itemPerUnitOz` for a mock item with `batch_yield > 1` and a
  SKU component (expect `componentOz ÷ batch_yield`) + a recursive sub-item; assert all
  returns are `number` (PostgREST numeric→string footgun — coerce in the hydrate layer).
- **Operator smoke (Juan, preview):** AM-prep / mid-day / Opening render **identical** to
  today (no operator path reads any new field); then in admin, set a SKU's `avg_oz_per_each`
  and an item's `batch_yield` and confirm the derived readouts appear.

## 11. Open decisions — resolved

- **D1 (`kind` vs `tracking_type`):** retire `kind`, add `tracking_type`.
- **D5 (`content_oz` cadence):** single editable `avg_oz_per_each` now; R3 refines from
  measured deliveries; variance is the signal.
- **content_oz for non-weight:** count → `avg_oz_per_each`; volume → `avg_oz_per_each` (oz per
  one volume unit). No density math.
- **SKU price:** deferred to R2.
- **`oz_per_par_unit`:** included in R1 (populate early; R4 consumes).
- **store vs derive `content_oz`:** derive (single source of truth).
