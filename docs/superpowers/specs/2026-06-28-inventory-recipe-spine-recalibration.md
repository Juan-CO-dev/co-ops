# Inventory / Recipe Spine — Recalibration Architecture

**Date:** 2026-06-28
**Status:** approved (model), pending spec-review → reslice into per-slice specs
**Supersedes the on-hand/depletion portion of:** `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md`
**Builds on (shipped):** C1 SKU catalog (#98) + C2 item↔SKU BOM (#99).
**North star:** `~/.claude/.../memory/project_coops_inventory_truth_model.md`.

> Recalibration done with Juan 2026-06-27/28 before building C3. Goal: make the
> inventory logic airtight end-to-end so every later slice (cost, yield, dynamic
> pars, shrinkage) falls out of one coherent model instead of being bolted on.

---

## 1. The model in one breath

> **Global ledger** (SKUs under vendors + Items) is the truth — checklists, reports,
> and composition all *pull from* it. Items carry an optional **composition**
> (recursive, in **oz**, **batch + yield**) and a **tracking type**
> (on-hand / portioned / line). **Receiving** raises on-hand; a periodic
> **count** re-establishes ground truth; the **variance engine** compares
> *actual* usage (count + received − count) against *theoretical* usage
> (compositions run forward from prep counts + sales) → the **shrinkage signal**
> (theft / over-portioning / waste / mis-log). **Cost** rides along via SKU price.

## 2. Two orthogonal axes (the core insight)

Every item sits on two independent axes:

1. **Composition — *what it's made of.*** ✅ The BOM (`item_components`) shipped in C2.
2. **Tracking type — *how it's counted and how it depletes.*** ❌ Not built (all 131 items are `kind='manual'`).

Conflating these was the old confusion. They're separate: the *same* lettuce is a
**SKU** (case, on-hand in the walk-in) → a **portioned** item (1/3 pans, made by
prep, composition-consumes the case) → staged on the **line**.

## 3. The global ledger is the truth

```
Vendor
 └─ SKU                         global SKU catalog (purchased thing; carries content_oz + price)
     └─ Item                    global item registry, optionally composed from SKUs + items
         • pure portion/prep        item ← 1 SKU (oz)          e.g. shredded lettuce
         • recipe                   item ← many SKUs/items     e.g. house sauce
         • assembly (recursive)     item ← items + SKUs        e.g. Italian Sub
         • leaf on-hand             no composition; just counted
              └─ referenced by → Checklists & Reports (already resolve from the registry)
```

Checklists/reports/composition **reference** the ledger; the ledger is the
source of truth. (Already true for prep templates → items.)

## 4. Composition — one primitive, a spectrum

`item_components` is the single primitive. It spans:

- **Pure portion / light prep** — a 1-line composition (`item ← 1 SKU`, X oz).
- **Recipe** — many components.
- **Assembly** — components that are themselves composed → **recursive**.
- **None** — leaf on-hand items have no composition; they're just counted.

Nothing is special-cased: a thing either has a composition (1 line / many / nested)
or it doesn't, and either way it carries a tracking type.

### Batch + yield (entered once, two views)
- **Entered (truth):** a composition produces a **`yield`** of N of the item's own
  units from **batch** component quantities — "this batch makes 4 pans from these
  inputs." Matches how recipe books are written; GM-and-down granularity.
- **Derived (never entered):** per-unit = `batch ÷ yield`; per-unit cost =
  `Σ(input cost) ÷ yield`. MoO+ reads cost-per-unit / food-cost % at a glance.
- A 1:1 pure-portion item is just `yield = 1`.

### Recursion is the depletion engine
Because an assembly composes **down to SKUs**, selling/making it runs the tree
forward to compute exactly what left, in oz, per SKU. A sub sold →
meat/cheese/lettuce/sauce → sauce → mayo SKU → oz. **That recursive run is the
theoretical-usage half of the variance engine.**

## 5. Units — everything is oz

Juan: **all recipes are weighed in oz** (fractions included). So:

- **Universal composition base = oz (weight).** Every component quantity is oz.
- **Each SKU carries `content_oz`** = total ounces per pack:
  - **Weight-bought** (mayo `Case · 4 · 128 oz`) → computed = **512 oz**
    (lb↔oz etc. via a same-type factor on the `measure_units` registry).
  - **Count-bought** (lettuce `Case · 24 heads`) → needs **one entered number:
    avg oz per head** (→ `content_oz = 24 × avg_oz_per_head`). Single field per
    count-bought SKU, not a conversion matrix.
- **Cost per oz** = `SKU price ÷ content_oz`. **Yield** converts oz → portions.
- **Head-weight variance is a feature:** avg-oz-per-head is approximate, so a
  count-bought SKU's theoretical-vs-counted will drift — and that drift is the
  *"heads smaller than billed / portioning heavy"* signal the count surfaces.

## 6. The two questions (purposes) the system answers

- **Readiness — "are we stocked to open & sell right now?"** The portioned/line
  side. Par-based. **Largely already captured** by AM-prep + opening counts.
- **Inventory truth — "exactly how much raw stock, and how much prep can we still
  get out of it?"** The on-hand side. **Net-new.** "Available for prep right now"
  = `current on-hand oz ÷ per-portion composition oz` = portions you can still make.

## 7. The variance engine (the payoff)

For a period (count → count), **per SKU, in oz**:

- **Actual usage** = `on-hand count(start) + received − on-hand count(end)`
  — pure physical reality.
- **Theoretical usage** = `Σ (items made [prep counts] + items sold [Toast]) ×
  their composition, run recursively to the SKU`.
- **Variance = Actual − Theoretical = shrinkage** → theft / over-portioning /
  waste / mis-log. *The signal.*

Confidence is built in (per the moat doc): counts are dual-source (closer vs
opener), reasons are typed, provenance is tagged — so the variance is causal +
confidence-weighted, not magnitude-only.

## 8. Recipes-as-prose stay (training), linked
The existing `recipes` table = human method/steps for **training**. It stays.
The **composition** (what's consumed) lives in the item BOM; the two **link**
(a training recipe ↔ the item it produces). Not merged.

---

## 9. Schema deltas (from current live state)

Current: `items` (131, all `kind='manual'`), `item_components` (**empty**),
`vendor_items` (C1 pack model: pack_format/units_per_pack/each_size/each_measure),
`vendor_price_history` (exists, unused), `recipes` (training prose). No
receiving / on-hand / count tables exist.

Planned deltas (each lands in its slice's own migration):
- **`items.tracking_type`** — enum `on_hand | portioned | line` (how it's counted).
  (Possibly retire/repurpose `kind`; decide at R1.)
- **`items.batch_yield`** — numeric, default 1 (how many of the item's units one
  batch/composition makes).
- **`item_components.quantity` semantics → batch** (relabel; it's empty so free)
  — quantity is per-batch oz; per-unit derived via `batch_yield`.
- **`vendor_items.content_oz`** — total oz per pack (computed for weight-bought;
  one entered `avg_oz_per_each` for count-bought).
- **`measure_units`** — add a same-type conversion factor to a canonical base
  (so lb/oz/gallon interoperate).
- **NEW `deliveries` / receiving** — SKU received qty (+ optional invoice price →
  `vendor_price_history`) → raises on-hand.
- **NEW `inventory_counts`** — periodic physical on-hand per SKU/item (the
  ground-truth event), dual-source-friendly, append-only.
- **on-hand state** — derived (received − consumed) or a materialized current
  on-hand; decide at R4.

## 10. Resliced roadmap (each = own brainstorm→spec→plan→build)

Order chosen so each slice is usable and de-risks the next; readiness order ≠
excitement order (per the moat doc).

- **R1 — Composition→Recipe upgrade.** `batch_yield` + relabel quantity as batch +
  `content_oz` on SKUs + `measure_units` factors + per-unit/cost derivation. Turns
  C2's BOM into the full oz/batch/yield recipe model. *No operator-flow change.*
- **R2 — Cost & yield + converts-into view (the old "C3").** Per-unit/plate cost,
  food-cost %, yield ("case → N pans"), and the reverse per-SKU "which items use
  this." Rides on R1 + `vendor_price_history`. (Cost gets *true* once invoices/Toast
  land; structure is ready now.)
- **R3 — Receiving.** SKU received → on-hand↑ (+ optional invoice price capture).
- **R4 — Inventory count + on-hand state.** Periodic physical count = ground truth;
  establishes/overwrites on-hand. "Available for prep" readout falls out.
- **R5 — Variance engine.** Actual (count+received−count) vs theoretical
  (compositions run forward from prep counts; **sales half waits on Toast**) →
  shrinkage per SKU. Inventory report (managers verify on-hand by category).
- **R6+ — Dynamic pars** (first second-order app: subtract reason-coded
  non-demand depletion → clean demand → par recommendations) and onward
  (recipe-cost↔training, etc.) per the moat doc. **Toast connection** is the
  keystone that lights up the sales-depletion half + true food cost.

Tracking-typing the 131 existing items + populating compositions is data work that
rides alongside R1–R2 (Juan/GM enter from the recipe book / food-cost chart, once).

## 11. Open decisions (resolve in each slice's spec)
- **D1 — `kind` vs `tracking_type`:** retire `kind` (all `manual`) and use
  `tracking_type`, or keep both? (R1.)
- **D2 — on-hand state:** purely derived vs materialized current-on-hand. (R4.)
- **D3 — count cadence & unit:** weekly? per-SKU vs per-item? counted in packs/
  eaches/oz (ladder converts either way). (R4.)
- **D4 — sales depletion before Toast:** theoretical-usage's sales half needs
  Toast; until then variance runs on *prep-made* usage only (still catches
  prep-side over-portioning/waste). (R5.)
- **D5 — content_oz for count-bought:** single avg per SKU vs per-delivery
  (lots vary). Start single-avg; revisit if variance is dominated by it. (R1/R3.)

## 12. What this preserves
C1 (SKU catalog + structured pack model) and C2 (composition primitive) stand —
R1 *extends* them, doesn't redo them. The daily operator flow (AM-prep / opening /
mid-day counts) is untouched and becomes the readiness + prep-made-usage feed.
