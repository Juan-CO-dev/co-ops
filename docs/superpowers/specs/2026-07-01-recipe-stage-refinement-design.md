# Recipe Stage Refinement — Design

**Date:** 2026-07-01
**Status:** design approved (Juan, section-by-section via smoke feedback on PR #107) — ready for spec review → writing-plans
**Parent:** `docs/superpowers/specs/2026-07-01-recipe-stage-design.md` (shipped, PR #107 `6a671e8`)
**Trigger:** Juan's smoke of #107 surfaced three gaps. Sequencing decided: **#107 merged; this is a fast-follow refinement slice.**

> The Recipe-stage foundation (two-tier entity, engine repoint, operator-invisibility) is live. This slice makes the builder actually usable for authoring real recipes: standardized containers, the prepped-AND-sold-directly item, and a draft-then-commit authoring flow.

---

## 1. Container standardization (gap #1)

**Problem:** when adding a SKU to a recipe, the "how much" unit was free text. It should reflect the SKU's real physical breakdown — a case of hot peppers is `Case → 4 Bottles → each Bottle is 128 oz`.

**Decisions (approved):**
- **The each-container name lives on the SKU.** Add `vendor_items.each_container_label` (e.g. "Bottle") alongside the existing `pack_format` (Case), `units_per_pack` (4), `each_size` (128), `each_measure` (oz). One SKU = one physical each-shape, so it belongs on the SKU. GM+ sets it on SKU create/edit.
- **Recipe input unit picker is SKU-derived**, not free text. Picking a SKU offers exactly three levels: **`Case`** (the `pack_format`), **`Bottle`** (the `each_container_label`), **`oz`** (the `each_measure` base). The entered quantity × chosen level converts to oz via the existing `lib/recipe-math.ts` (`Case` = `units_per_pack × each_size × ozPerMeasureUnit`; `Bottle` = `each_size × ozPerMeasureUnit`; `oz` = direct). Recipes are typically authored at the **Bottle** level (1 Bottle → 2.5 Quarts); the system knows 1 Case = 4 Bottles = 4 batches.
- **Recipe output container is a standardized dropdown** from the existing `units` registry (Quart / 1/3 Pan / 1/6 Pan / Bottle / …; MoO+ adds new via the existing `unit.create`). No free text. Replaces the current free-typed `output_container_label`.
- **Sub-item (production item) inputs** likewise use a standardized unit — the item's own `default_par_unit` / the `units` registry — not free text.

**Data:** migration adds `vendor_items.each_container_label text`. No change to `recipe_inputs`/`recipe_outputs` columns (they already have `unit` / `each_container_label` / `output_container_label`); the builder just sources their values from the SKU + the `units` registry instead of free text.

## 2. Prepped-AND-sold-directly item (gap #2 — the antipasta case)

**Problem:** the strict `production → item` / `consumer → menu_item` split can't express a **prepped item that is sold directly** (antipasta side, meatballs) — prepped in bulk *and* sold as-is, outside the sub-assembly flow. Juan couldn't link a consumer recipe back to the existing antipasta item.

**Decisions (approved):**
- **A production item can be marked "sold directly."** On the item: `sold_directly` (bool) + `sell_portion` (numeric — how much on-hand one sale depletes) + `sell_portion_unit` (from the `units` registry) + `menu_price`. **No consumer recipe** is needed for a directly-sold prepped item — the item *is* its own sell face.
- **Consumer recipes are reserved for assembled-to-order sales** (a turkey sub — parts combined at sale time).
- A sold-directly item can **still** be an input to consumer recipes — the two compose (antipasta could be both a side and a sub ingredient).
- **`items.menu_price` is un-deprecated for this case.** #107 moved menu_price to `menu_items` and dropped the item editor; this slice brings a `menu_price` editor back **only when `sold_directly = true`**. So: `menu_items.menu_price` = assembled (consumer-recipe) sell face; `items.menu_price` = directly-sold item sell face. Both map to Toast later.

**The ledger model (Juan's load-bearing nuance) — two deduction points:**
- **Prep event** (already built — production-in-prep fold): raw SKU/ingredient on-hand is **consumed**, processed item on-hand is **credited**. Once antipasta/meatballs are prepped, their raw ingredients are gone (can't be repurposed).
- **Sale event:**
  - **Directly-sold item** → depletes the **prepped item's** on-hand by `sell_portion`. (Raw already consumed at prep.)
  - **Assembled sub** → the sub isn't made until sold, so its **component items stay available** on-hand until the moment of sale, then deplete at sale time.

So an item's on-hand pool is **filled at prep (from raw), drained at sale** (sold-as-is or assembled-into-a-sub). **The actual sale-time depletion fires when Toast sales land (deferred sub-project); this slice defines the model (`sell_portion` on directly-sold items; consumer-recipe input portions already exist) so the future sales-pull can compute depletion correctly.** No sales ingestion is built here.

**Data:** migration adds `items.sold_directly boolean not null default false`, `items.sell_portion numeric`, `items.sell_portion_unit text`. (`items.menu_price` already exists — reused.)

**UX:** the item edit surface (GlobalRegistryTab item definition / `/admin/recipes` item view) gains a "Sold directly" toggle; when on, it reveals `sell_portion` + `sell_portion_unit` + `menu_price`. GM+ toggle / MoO+ for `menu_price` (mirrors the recipe menu_price floor).

## 3. Draft-then-commit authoring flow (gap #3)

**Problem:** creating a recipe forced submitting a barebones skeleton (name+type+batchYield) *then* getting nagged to complete it — premature commitment.

**Decisions (approved):**
- **Creation is draft-the-whole-recipe-then-Save-once.** "New recipe" opens the full builder empty; nothing is persisted. You add inputs, outputs, directions to an in-memory draft, then one **Save** commits the whole recipe **atomically** (header + all inputs + all outputs in one transaction).
- **Save is enabled once the draft has ≥1 input AND ≥1 output** (can't save a truly empty recipe).
- **Editing an existing recipe stays live/incremental** (add/remove edges immediately — it already exists, so there's no premature-commit problem there).
- **Soft, non-blocking "incomplete" badge** stays in the list for saved recipes that have 0 inputs or 0 outputs (can arise from later edge removals) — a gentle nudge, never a modal nag or a block.

**Data:** no schema change. Add an **atomic create endpoint** — `POST /api/admin/recipes/full` → `createRecipeFull(actor, { header, inputs[], outputs[] })` in `lib/recipes.ts`, backed by a `create_recipe_full` RPC (or a transaction) so header + edges commit together or not at all. Reuses the per-edge validation + cycle guard.

## 4. Scope of this slice

| Area | Change |
|---|---|
| Migration (one) | `vendor_items.each_container_label`; `items.sold_directly` + `sell_portion` + `sell_portion_unit` |
| `lib/recipes.ts` | `createRecipeFull` (atomic header+inputs+outputs); sold-directly item ops (`setItemSoldDirectly`) |
| `lib/admin/skus.ts` | `each_container_label` on SKU create/edit + surfaced in the SKU→pack breakdown for the picker |
| Builder UI | draft-then-Save creation; SKU-derived input unit picker (Case/Bottle/oz); locked output-container dropdown from `units`; edit stays live |
| Item edit surface | "Sold directly" toggle → sell_portion + unit + menu_price |
| RPC | `create_recipe_full` (atomic multi-row insert) |
| i18n | new `recipes.*` + item sold-directly keys, EN+ES parity |

## 5. Out of scope (unchanged from parent)
- **Sales ingestion / Toast pull** — the sale-time depletion + Toast mapping. This slice only *defines* the sell model (portions/prices); nothing consumes sales yet.
- **Reconciliation/variance engine** — the 3×/day count corrector.
- **Menu layer richness** — beyond the consumer-recipe → menu_item and directly-sold-item sell faces already modeled.

## 6. Operator-invisibility
No operator-facing prep flow changes. All changes are in the GM+ admin builder + SKU/item admin. The prep-consumption engine (`loadDerivedForItems`) is untouched by this slice (container labels are display/authoring metadata; the oz math already runs off `each_size`/`each_measure`, which are unchanged). Re-run the Hot Peppers parity smoke as a guard.
