# Production-in-Prep Fold (S1-via-prep) design

**Date:** 2026-07-01
**Status:** approved (design), pending plan
**Supersedes the destination of:** `docs/superpowers/specs/2026-07-01-production-capture-design.md` (standalone S1).
The standalone spec's plumbing stays and is reused; its "standalone surface is the way prep logs
production" premise is replaced by this fold. The `/operations/production` page is demoted to a
manual/correction entry, not the primary path.
**Builds on:** R1 (`content_oz`, recipe-math recursion), R2 (`lib/admin/cost.ts` prices + recursive
item cost), C2 (`item_components` BOM), S1 (migration 0101 `productions`, `lib/production.ts`,
`loadSkuConsumption`, the SKU **In stock (est.)** line — all on branch `claude/production-capture`,
PR #106, HELD not merged, absorbed here).

> **The core clarification driving this (Juan):** AM prep is a *truth capture* (a count). Only
> **Opening prep Phase 2** and **Mid-day prep Phase 2** actually convert SKUs→items. So production
> capture folds into those two Phase 2 flows ONLY — never AM prep.

---

## 1. The model in one breath

> When a prepper saves a Phase 2 item ("made 4 pans of shredded peppers"), the system walks that
> item's recipe (`item_components`) down to its **leaf SKUs**, computes the SKU amounts that *should*
> have been used (recipe ratio × output), shows them **pre-filled and editable**, and the prepper
> confirms or overrides. Confirming records the theoretical consumption; **overriding records the
> actual** — which is the yield/variance signal. The prep task the operator already does IS the
> production event. One honest prep save carries both the theoretical (pre-fill) and the actual
> (confirm/override).

---

## 2. The two flows + the seam

Both Phase 2 flows are the collaborative per-item-save pattern (C.52). The seam is the **per-item
save** (where the output qty for one specific item is known), NOT finalize.

| Flow | Seam function | File:line | Output qty field | `item_id` availability |
|---|---|---|---|---|
| Opening P2 | `savePhase2Item` | `lib/opening.ts:2119` | `openerPrepped` | already on the load path (`lib/opening.ts:707`) |
| Mid-day P2 | `saveMidDayPhase2Item` | `lib/prep.ts:1205` | `prepped` | loaded (`lib/prep.ts:864`) but dropped before the form; in scope again at the save's re-load (`lib/prep.ts:1222`) |

A shared helper hangs off both saves:
```
recordProductionFromPrep(actor, {
  locationId, instanceId, templateItemId, outputItemId, outputQty,
  confirmedConsumption: Array<{
    skuId,
    qtyOz,               // canonical consumed oz (feeds the ledger) → production_inputs.input_oz
    qtyEntered, unitEntered,  // what the prepper typed (case/each) → for display
    derivedOz,           // the recipe pre-fill → retains actual-vs-theoretical per line
  }>,
  source: 'opening_p2' | 'mid_day_p2',
}) → { productionId }
```
Authorization **inherits the prep save** — if the actor may save the Phase 2 item, the consumption
side-effect is permitted. No separate `PRODUCE_MIN` gate on the embedded path (reconciles the
opening L4 / mid-day "any clocked-in cook" floors — Explore open-Q #7).

---

## 3. The derive engine (new, on recipe-math)

`skuConsumptionForItem(itemId, outputQty) → Map<skuId, { oz }>` — recursively flattens
`item_components` to leaf SKUs:
- **SKU edge** (`component_sku_id` set) → leaf. Consumed = `quantity × outputQty`, resolved to oz via
  the component `unit` + measure-unit factors (same conversion the cost/ledger path uses).
- **Sub-item edge** (`component_item_id` set) → recurse into that sub-item's own components at
  `quantity × outputQty` (composites bottom out in SKUs). Cycle-guarded exactly like R2's recursive
  item cost (`lib/admin/cost.ts`).
- Accumulate per leaf SKU (an item reachable via two paths sums).

This directly answers Juan's "handle multi-SKU + composites" (Explore open-Q #2): one prep item can
deplete several SKUs, including through sub-recipes. Lives in `lib/recipe-math.ts` (pure) or a thin
server wrapper that loads the `item_components` tree; the pure math already exists (R1/R2), this adds
the "collect per-SKU while recursing" shape.

**Per-unit vs scaled:** the loader returns the **per-one-output-unit** flattened map so the client can
scale live as the prepper types the output qty (§4). `derivedForItem(itemId) → Map<skuId,
{ perUnitOz, skuName, unitsPerPack, eachSize, eachMeasure, packFormatLabel }>`; client multiplies
`perUnitOz × outputQty` and converts to the display unit.

---

## 4. The prep-row UX (low friction by default)

A **convertible** Phase 2 item = one whose `item_id` resolves to ≥1 leaf SKU via §3. Non-convertible
items (no `item_id`, or an `item_id` with no SKU edge) render **exactly as today** — no panel, no
depletion (Explore open-Q #1).

For a convertible item, under its normal numeric prep input:
- **Collapsed summary (default):** a single line — *"Uses: 1 Case Hot Peppers · 2 qt Pepper Base"* —
  scaled live from the entered output qty. Recipe-is-right case = one glance, zero taps.
- **Expand (tap):** each leaf SKU on its own row, pre-filled with the derived amount, **editable**,
  with a **case ⇄ each** unit toggle (Juan's earlier call). Editing any row records the actual.
- **Units:** derived oz → the SKU's pack/each units for display (`skuContentOz` inverse); the toggle
  switches the shown/entered unit; the value is resolved back to canonical oz on save.
- **Default = derived:** if the prepper does nothing, the theoretical set is what's recorded.

Rendered in the Phase 2 components (`components/opening/OpeningPrepEntry.tsx`,
`components/MidDayPhase2Form.tsx`) as a shared sub-component (`ProductionConsumptionPanel`) so both
flows present it identically.

---

## 5. Data model (migration 0102) — normalize to header + lines

S1's `productions` is single-input (one `input_sku_id`/`input_qty` column pair). Multi-SKU needs
**one production event → many SKU depletions**, so 0102 reshapes to header + lines. `productions` has
**0 rows** in prod (S1 held), so the reshape is safe.

**`productions`** (header — one per conversion event):
- `id uuid pk`
- `location_id uuid not null → locations`
- `produced_at timestamptz not null default now()`
- `output_item_id uuid not null → items`
- `output_qty numeric not null check (> 0)` — item par-units
- `source text not null check (source in ('opening_p2','mid_day_p2','manual'))`
- `instance_id uuid → checklist_instances` (null for `manual`)
- `template_item_id uuid → checklist_template_items` (null for `manual`)
- `superseded_at timestamptz`, `revoked_at timestamptz` — lifecycle (§6)
- `notes text`, `created_by uuid`
- (drop the old `input_sku_id` / `input_qty` columns — 0 rows)

**`production_inputs`** (lines — one per leaf SKU depleted):
- `id uuid pk`
- `production_id uuid not null → productions on delete cascade`
- `input_sku_id uuid not null → vendor_items`
- `input_oz numeric not null check (> 0)` — canonical consumed oz (what feeds the ledger)
- `qty_entered numeric`, `unit_entered text` — what the prepper actually typed (case/each), for display
- `derived_oz numeric` — the pre-filled theoretical (so actual-vs-theoretical = the variance signal, retained per line)

Both tables: **deny-all RLS** (`_no_user_{select,insert,update,delete}`), service-role writes,
app-layer gate + location-bind — mirroring `productions`' S1 policies. Append-only (supersede/revoke
via timestamps, never DELETE except the cascade on a hard error path).

`unit` measure conversions reuse the existing `measure_units` factors.

---

## 6. Idempotency & revoke (the correctness piece)

Phase 2 saves are append-only supersede-on-resave + revoke (Explore open-Q #5). The production write
must track that lifecycle, keyed by **(instance_id, template_item_id)**:
- **Save / re-save:** set `superseded_at = now()` on the prior live `productions` header for that
  (instance, template_item), then insert a fresh header + lines. "4 pans → 5 pans" re-depletes
  correctly, never doubles.
- **Revoke** (`revokePhase2Completion`, opening; mid-day equivalent): set `revoked_at = now()` on the
  live header for that (instance, template_item). The consumption reverses (the SKU's in-stock rises
  back).
- **`loadSkuConsumption`** sums `production_inputs.input_oz` only for headers where
  `superseded_at IS NULL AND revoked_at IS NULL`.
- **Two mid-day instances/day** (`MAX_MID_DAY_PREP_PER_DAY = 2`, Explore open-Q #6): headers are keyed
  by `instance_id`, so both instances' conversions **coexist** (summed), not treated as corrections.

Wired atomically with the prep completion where possible (both flows already use atomic RPCs —
`save_phase2_item_atomic`, `save_mid_day_phase2_item_atomic`); the production supersede+insert either
joins that transaction or runs immediately after in the same server call, with the completion as the
source of truth (if the completion save fails, no production write).

---

## 7. `loadSkuConsumption` + the In-stock line (mostly unchanged)

`loadSkuConsumption(actor, skuIds)` now sums `production_inputs.input_oz` (and `× cost/oz` for $) over
live headers, instead of `productions.input_qty × content_oz`. **External signature + the SKU panel's
In stock (est.) = received − consumed line are unchanged** — only the internal source of the consumed
number moves from the single-input column to the lines table. Received side (R3.5 ledger) untouched.

---

## 8. The standalone surface (demoted, kept)

`/operations/production` becomes a **manual/correction entry** (`source = 'manual'`): ad-hoc
conversions, backfill, or fixing a mis-prep. It keeps `PRODUCE_MIN = 4` (KH+) since it's a
standalone action, not a prep side-effect. **Drop its dashboard tile** so prep is the presented path;
keep the page reachable (e.g. from the SKU catalog or a nav link). `recordProduction` (single SKU)
stays for this path, rewritten to emit one header + one line.

---

## 9. Threading & touch-list

- **Opening P2:** extend `savePhase2Item` (`lib/opening.ts:2119`) + its route
  (`app/api/opening/prep/item/route.ts`) to accept `confirmedConsumption` and call the helper.
  `OpeningPrepEntry.tsx` renders the panel.
- **Mid-day P2:** thread `item_id` through `MidDayPhase2Item` (`components/MidDayPhase2Form.tsx:31`) +
  the page builder (`app/(authed)/operations/mid-day/page.tsx:156`); extend `saveMidDayPhase2Item`
  (`lib/prep.ts:1205`) + its route; `MidDayPhase2Form.tsx` renders the panel (Explore open-Q #4).
- **Loaders** (`loadOpeningState`, `loadMidDayPrepState`) return `derivedForItem` (§3) per convertible
  Phase 2 item.
- **Revoke paths** call the reverse.
- **Shared:** `lib/production.ts` (helper + reshaped record), `lib/recipe-math.ts` (the recursion),
  `lib/admin/cost.ts` (`loadSkuConsumption` source swap), `components/production/ProductionConsumptionPanel.tsx` (new shared UI).

## 10. How the 7 ground-truth open questions are resolved

| # | Explore open question | Resolution |
|---|---|---|
| 1 | Phase 2 items with no `item_id` / no SKU edge | Non-convertible → render as today, no panel, no depletion (§4) |
| 2 | Multi-SKU / composite items | Recursive flatten to leaf SKUs (§3) — Juan's chosen scope |
| 3 | Input qty not captured in prep | Derived from recipe ratio × output, pre-filled, confirm/edit (§1, §4) — the core mechanism |
| 4 | Mid-day drops `item_id` | Thread it through the form + page builder + save (§9) |
| 5 | Re-save / revoke double-count | Header lifecycle keyed (instance, template_item): supersede-on-resave, reverse-on-revoke (§6) |
| 6 | Two mid-day instances/day | Keyed by `instance_id` → both coexist, summed (§6) |
| 7 | Role floors differ | Embedded write inherits the prep-save authorization; no `PRODUCE_MIN` on the embedded path (§2) |

---

## 11. Verification

- `tsc --noEmit` + `npm run build` clean.
- Throwaway tsx smoke (deleted): for a real multi-SKU item, `skuConsumptionForItem` flattens correctly
  (incl. a composite sub-item); `recordProductionFromPrep` writes header + N lines; a re-save
  supersedes the prior header (consumption unchanged-not-doubled); a revoke reverses it;
  `loadSkuConsumption` reflects each state; numeric→number coercion asserted; cleanup.
- **Operator smoke (Juan, preview):** AM prep renders **identical** (untouched). Opening P2 + Mid-day
  P2: a convertible item shows the "Uses:" summary scaled to the entered output; expand → per-SKU
  editable rows with case/each toggle; save → the SKU's In stock (est.) on `/admin/skus` drops by the
  confirmed amount; re-save a different output → in-stock adjusts, not doubles; revoke → in-stock
  returns. A non-convertible item shows no panel.

## 12. Scope boundary (what this is / is NOT)

- **IS:** S1 folded into Opening P2 + Mid-day P2 — the direct made signal with actual-usage capture,
  multi-SKU + composites, idempotent under re-save/revoke; the manual standalone entry retained.
- **NOT (later slices):** S2 physical count; S3 pure recipe-theoretical as its own stored signal; the
  triangulation/variance view (average the signals, gaps = shrinkage); recipe write-back (promote a
  persistent yield override into `item_components`); AM prep (stays a count, never a conversion).

## 13. Open decisions deferred
- **D-writeback:** later, an override that repeats could promote a persistent yield into the recipe.
- **D-panel-default-collapsed:** the collapsed-summary + tap-to-expand is my call unless Juan objects
  (keeps the common case a single glance).
- **D-atomic-vs-after:** whether the production write joins the completion RPC transaction or runs
  immediately after in the same server call — plan picks based on how cleanly the RPCs extend; the
  invariant is "no production write without a committed completion."
