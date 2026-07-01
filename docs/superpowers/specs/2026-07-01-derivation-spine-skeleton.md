# Derivation Spine — Skeleton Architecture

**Date:** 2026-07-01
**Status:** skeleton approved (Juan) — decomposition doc, not a single implementation plan
**Purpose:** map the end-to-end derivation pipeline (vendor → SKU → recipe → item → prep → menu → Toast) as one architecture so we know what's possible, then design each sub-project on its own. Driven by the production-in-prep fold (shipped, PR #106) exposing that the **recipe** is the only place that knows the raw-each container ("Bottle") + item-unit ("Quart") + the yield between them.

> **The one-line model (Juan):** *"Recipes enable the ability to consume SKUs and produce items. The real power is you can stand on any SKU and see what it fans out to."*

---

## 1. The pipeline (gated, but soft)

1. **Vendor** — who you buy from.
2. **SKU** — a purchasable raw good under a vendor, in a pack (Case) of eaches (Bottle).
3. **Delivery / intake** — record what was received (manual now, auto email-capture later).
4. **Verify** received-accurate → the SKU has **live on-hand**.
5. **SKU live** → usable as a recipe input.
6. **Recipe** — consumes 1+ inputs (SKUs and/or sub-items), carries directions + portioning + the **unit/container vocabulary** + batch scaling, and **produces 1+ output Items** with a yield per output.
7. **Item** — a processed thing (shredded lettuce). Output of a recipe; can be an input to another recipe (composites).
8. **Prep → line** — an item gets prepped and placed on the line; on-hand tracked. *(the fold — shipped)*
9. **MenuItem** — what's sold: composed of 1+ items with portions (a menu BOM).
10. **Toast** — MenuItem maps 1:1 to a Toast menu item; sales pull consumption back down the chain.

---

## 2. The Recipe hub (the keystone)

A **Recipe is a directed edge / transformation node**, many-to-many in both directions:
- **Fan-out (1 SKU → many items):** 1 Case lettuce → 3–4 pans shredded **+** 1 pan scraps (→ turkey caesar sub). The scraps are an *output with its own destiny*, not free waste.
- **Convergence (many SKUs → 1 item):** several SKUs → one item, single or **double batch** (recipe runs scale).
- Inputs may be **SKUs and/or sub-items** (an item made earlier, used in a later recipe = composites).

**Cost-split across a batch's multiple outputs (shredded vs scraps) is a deferred, optional edge annotation** — the skeleton does NOT need to solve it. Options when we get there: allocate by yield/value, or flag byproducts. The traceability graph works regardless of the split.

---

## 3. The composition graph IS the product

```
Vendor → SKU ─┐                                        ┌→ Item ─┐
              ├─[recipe_input]→  RECIPE  ─[recipe_output]→        ├→ (sub-item into another Recipe)
    (a case) ─┘   directions · units · yield · batch     (pans) ─┘        │
                                                                          ▼
                                          Items ─[menu portion]→ MenuItem → Toast
```

Everything valuable is **walking this graph up or down** — the same directed graph, two directions:
- **Down** (from a SKU): what does this Case become? which items, which menu items, which Toast SKUs?
- **Up** (from a sale): what did tonight's turkey-caesar sales consume, all the way back to cases of lettuce?
- **Cross-cuts that fall out for free:** "Baldor's lettuce price jumped — which menu items are hit and by how much?" · "given tonight's Toast sales, what do I re-order?" · "this SKU is out — what can't I make?"

Build the graph + the two-way walk once; the reports are queries over it.

---

## 4. Entities (the nouns)

| Entity | Role | Status |
|---|---|---|
| `vendors` | who you buy from | built |
| `vendor_items` (SKU) | raw good, pack (Case) of eaches (Bottle) | built (pack model); **needs each-container name** |
| `vendor_delivery_items` | intake lines; verify → live on-hand | built (R3) |
| **`recipes`** | the hub: directions, batch/scaling, **unit/container vocabulary** | **new** |
| **`recipe_inputs`** | recipe → SKU **or** sub-item, qty + unit | **new** (absorbs `item_components`) |
| **`recipe_outputs`** | recipe → item, yield + unit | **new** |
| `items` | processed thing; recipe output; can be a recipe input | built (reparents under recipe) |
| prep / `productions` | item prepped → on-hand; consumes recipe inputs | built (the fold) |
| **`menu_items`** | sold thing, composed of items with portions | **new** |
| **`menu_item_components`** | menu item → items, portion | **new** |
| **Toast mapping** | menu_item ↔ external Toast id (1:1) | **new (integration, deferred)** |

**The each-container vocabulary** (the original driver — "Bottle", "Head") lives on the **recipe input / SKU as declared through the recipe**, NOT as standalone SKU metadata — because it's a recipe-time fact (one SKU used in three recipes could be portioned three ways). Resolve the exact home in the recipe sub-project.

---

## 5. Soft gating (Juan's call)

Gates are **status + prompts, never blocking.** Build the graph in any order, backfill freely; the system surfaces incompleteness and *nudges*:
- A SKU with no verified delivery → badge "unverified — verify to go live" + a one-tap verify prompt.
- A recipe using an unverified/inactive SKU → warn, don't block.
- A menu item missing an item's recipe → "2 items have no recipe — cost/traceability incomplete."
- Nothing is prevented; everything incomplete is *visible and actionable*. Trust the team, surface the gaps.

---

## 6. What exists vs what's new (build surface)

| Stage | Built | Gap |
|---|---|---|
| Vendor, SKU | ✅ | each-container naming (→ recipe) |
| Intake (manual) | ✅ R3 | auto email-capture (R3b) |
| Verify → live | ⚠️ partial | explicit verify step + soft go-live status |
| **Recipe** | ⚠️ `item_components` + R1/R2 math only | **the recipe entity: inputs/outputs, directions, unit vocabulary, scaling** |
| Item | ✅ | reparent under recipe |
| Prep → line | ✅ the fold | migrate per-item → per-recipe-run later |
| **Menu** | ❌ | menu_items + composition |
| **Toast** | ❌ | 1:1 mapping + sales pull |

---

## 7. Migration posture (nothing breaks)

`item_components` (item → its parts) is the seed of `recipe_inputs` + `recipe_outputs`: a current 1-item BOM becomes a recipe with that item as its single output. The **shipped fold reads `item_components`** and keeps working; it migrates onto recipe-runs when the recipe entity lands. No big-bang — the recipe sub-project can build alongside and cut over per the proven pattern.

---

## 8. Decomposition → sub-projects (each its own spec → plan)

Build order, most-valuable + unblocking first:

1. **Recipe stage (the hinge).** The `recipes` / `recipe_inputs` / `recipe_outputs` entity + the recipe builder UI (pick SKUs/sub-items, directions, unit/container vocabulary, yields, scaling) + reparent items under recipes + migrate `item_components`. **Unblocks the panel's operator language + the whole downstream graph.** ← *design this next.*
2. **Verify → go-live + soft-gate status** across the existing surfaces (SKU/vendor/recipe badges + prompts).
3. **Menu layer** — `menu_items` + composition + the item→menu attach.
4. **Toast mapping + sales pull** — the keystone; menu_item ↔ Toast, sales → consumption down the graph.
5. **Reconciliation/variance engine** (the 3×/day count corrector) + **cost-split annotation** + **R3b auto email-capture** — fold in where they fit.

---

## 9. Deferred / open (revisit at the relevant sub-project)
- **Fan-out cost-split** (shredded vs scraps) — an optional edge annotation; default by-yield/value or byproduct flag.
- **Per-recipe-run prep model** — the fold currently attributes consumption per-item; move to per-run when recipes land.
- **Toast integration mechanics** — external ids, sales polling/webhook — its own design.
- **Each-container vocabulary home** — recipe-input vs SKU; decide in the recipe sub-project.
