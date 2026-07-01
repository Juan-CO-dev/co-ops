# Recipe Stage — Design (Derivation Spine, sub-project #1)

**Date:** 2026-07-01
**Status:** design approved (Juan, section-by-section) — ready for spec review → writing-plans
**Parent:** `docs/superpowers/specs/2026-07-01-derivation-spine-skeleton.md` §8 item 1
**Unblocks:** the prep-consumption panel's operator language ("1 Case → 2.5 Quarts") + the whole downstream derivation graph.

> **One-line model (Juan):** *"There are two kinds of recipe. **Production recipes** consume SKUs (+ other production items) and produce inventoried items. **Consumer recipes** consume direct SKUs + production items and produce sold menu items. Production recipes are consumed by consumer recipes. Getting this right makes everything else easier."*

---

## 1. Ground truth (verified against prod `bgcvurheqzylyfehqgzh`, 2026-07-01)

- **`recipes` table already exists but is dormant — 0 rows.** Columns: `name, category, description, yield_quantity(text), prep_time_minutes, active, video_url, photo_url, notes, created_by`. It is the never-populated "training / how-to-make-it" scaffold, with dormant children `recipe_ingredients` (0 rows) + `recipe_steps` (0 rows), wired to a `/recipes` nav link + i18n. **We repurpose this 0-row table** as the recipe hub (training "directions/video/photo" fold in as a *facet* of a recipe, not a separate entity).
- **The costing BOM lives on items today:** `items` (131 rows, ALL `tracking_type='portioned'`, ALL `menu_price` NULL → menu_price is **vestigial**) carries `batch_yield` (NOT NULL), `oz_per_par_unit`, `menu_price`. `item_components` has **1 row** — the Hot Peppers smoke test (`512 oz` of a SKU → batch_yield 1).
- **`vendor_items`:** 25 SKUs. Registries present: `sku_pack_formats` (Bag/Box/Case/Flat/Each), `measure_units` (oz/lb/fl oz + dimension/to_base_factor), `units` (Bottle/Quart/Pan/Bag — item par-units).
- **Consequence:** migration cost is essentially nil (1 composition row, 0 menu items, 0 dormant-recipe rows). This is the clean moment to introduce the entity.

## 2. The two tiers (one recursive primitive)

```
           SKU (raw purchased good)
             │  direct, portioned
             ▼
   ┌──────────────────────┐
   │  PRODUCTION RECIPE    │  consumes: SKUs (+ other production items)
   │  "prep it"            │  produces: 1+ prepped ITEMS  (inventoried; par; counted 3×/day
   └──────────────────────┘                                at AM / Opening / Mid-day)
             │   e.g. 1 Case lettuce → 3 Pans shredded + 1 Pan scraps   (FAN-OUT)
             ▼   production items are consumed by…
   ┌──────────────────────┐
   │  CONSUMER RECIPE      │  consumes: direct SKUs (portioned) + production items
   │  "sell it"            │  produces: a sold MENU ITEM → Toast
   └──────────────────────┘  e.g. turkey sub = bread SKU + turkey SKU + shredded lettuce (production)
```

**Dual reconciliation (the moat, at the consumer tier):** a menu item is "counted" by **sales** (Toast: N subs sold → its consumer-recipe BOM → theoretical production-item consumption); its production-item parts are independently "counted" by **physical on-hand** (AM/Opening/Mid-day). The gap between the two = variance. Both tiers reconcile; production items reconcile physical-count vs (received − consumed).

**Both tiers are the same primitive** — inputs + portioning/directions → output — distinguished only by `recipe_type`. "Production consumed by consumer" = a consumer recipe's input points at a production recipe's output item. This **collapses the skeleton's separate "Menu layer" into the recipe entity** as `recipe_type='consumer'`.

## 3. Entity model

One recursive `recipes` hub + polymorphic input/output edges + a new `menu_items` leaf. All tables: append-only philosophy (deactivate via `active`, never delete except cascade); deny-all RLS split per-op (`_no_user_{select,insert,update,delete}`); service-role writes + app-layer role gate.

```
recipes                         (REPURPOSE the dormant 0-row table)
  id, name, name_es
  recipe_type      text NOT NULL CHECK (recipe_type IN ('production','consumer'))
  batch_yield      numeric NOT NULL DEFAULT 1     (per-batch scaling; source of truth MOVES off items)
  directions       text        (+ directions_es)  ── training folds in here
  description, video_url, photo_url, prep_time_minutes, notes   (existing cols kept)
  category, yield_quantity(text)                   (existing; yield_quantity deprecated in favor of recipe_outputs.yield)
  active NOT NULL DEFAULT true, created_at, created_by, updated_at, updated_by

recipe_inputs                   (NEW — absorbs item_components; SKU XOR item edge)
  id, recipe_id → recipes (CASCADE)
  component_sku_id   uuid NULL → vendor_items      ─┐ exactly one of the two is non-null
  component_item_id  uuid NULL → items             ─┘ (a production item consumed by a higher recipe)
  quantity           numeric NOT NULL CHECK (quantity > 0)
  unit               text            (measure/pack unit the qty is expressed in)
  each_container_label text          ("Bottle" — recipe-time operator vocab; back-refs the SKU)
  portioned          boolean NOT NULL DEFAULT false
  display_order      integer NOT NULL DEFAULT 0
  created_at, created_by
  CHECK ( (component_sku_id IS NOT NULL) <> (component_item_id IS NOT NULL) )   -- exactly one

recipe_outputs                  (NEW — polymorphic; FAN-OUT lives here)
  id, recipe_id → recipes (CASCADE)
  output_item_id       uuid NULL → items          ─┐ exactly one (production → item; consumer → menu_item)
  output_menu_item_id  uuid NULL → menu_items      ─┘
  yield                numeric NOT NULL CHECK (yield > 0)   (outputs produced per ONE batch)
  output_container_label text     ("Quart" / "Pan" — the output's line-ready unit)
  oz_alloc_share       numeric NULL   (optional manual override of fan-out allocation; NULL = auto oz-share)
  display_order        integer NOT NULL DEFAULT 0
  created_at, created_by
  CHECK ( (output_item_id IS NOT NULL) <> (output_menu_item_id IS NOT NULL) )  -- exactly one

menu_items                      (NEW — the sold leaf; menu_price moves here from items)
  id, name, name_es
  menu_price     numeric NULL
  toast_ref      text NULL      (the 1:1 Toast mapping — populated in a later slice)
  active NOT NULL DEFAULT true, created_at, created_by, updated_at, updated_by
```

**Tier usage of the shared tables:**
- **Production recipe:** `recipe_inputs` = SKUs (+ production items); `recipe_outputs` = 1+ rows → `items` (fan-out = multiple output rows off one input set).
- **Consumer recipe:** `recipe_inputs` = direct SKUs (portioned) + production items; `recipe_outputs` = 1 row → `menu_items`.

**Baked-in decisions (approved):**
1. **Recipe is optional per item** — an item may exist with no recipe (just counted). Only *produced* items get a production recipe; we reparent only the 1 composed item (Hot Peppers).
2. **Container vocabulary lives on the edges** (`each_container_label` on inputs, `output_container_label` on outputs) — recipe-time facts, read (never re-asked) downstream.
3. **`menu_items` is a new entity**; `items.menu_price` migrates there and is left unread (dropped later once confirmed dead).
4. **`recipe_inputs`/`recipe_outputs` replace `item_components`** — the engine repoints to the recipe graph; the 1 data row migrates; `item_components` kept dormant for rollback.

## 4. Recipe builder UI

**New first-class surface `/admin/recipes`** (list + detail builder). Absorbs the current item-attached `MadeFromEditor` (which edited `item_components`). Also linked from an item ("production recipe →") and, later, a menu item.

- **List:** filter chip `Production | Consumer | All`; row shows name, type, output(s), derived cost / food-cost%, completeness status. GM+ "New recipe".
- **Authority (mirrors SKU-catalog + item-definition ladder; tunable):** GM+ create/edit inputs, outputs, directions, yields, vocab; AGM+ view; MoO+ for `menu_price`.
- **Detail = one adaptive form** (output section switches on `recipe_type`):

```
┌── RECIPE ─────────────────────────────────────────────────┐
│ Name [Hot Peppers]  ES [Chiles picantes]   Type (Production ▾)│
│ Batch yield [1]   Prep time [20 min]   [▸ Directions / video] │
├── CONSUMES (inputs) ──────────────────────────────────────┤
│  ⊕ add SKU   ⊕ add production item                          │
│  • [Hot Pepper SKU ▾]  qty[1] as [Case ▾]                   │
│        each-container "[Bottle]"   ☐ portioned  → derives 512 oz│
├── PRODUCES (outputs) ─────────────────────────────────────┤
│  ⊕ add output item          (Production: 1+ items = fan-out) │
│  • [Hot Peppers item ▾]  yield[2.5] as "[Quart]"           │
│  • [Pepper scraps item ▾] yield[1] as "[Pan]"   ← fan-out   │
├── LIVE READOUT ───────────────────────────────────────────┤
│  1 Case → Bottle → 2.5 Quarts + 1 Pan scraps                │
│  cost/Quart $X · food-cost% (if menu_price) · oz/unit …     │
└────────────────────────────────────────────────────────────┘
```

For **Consumer** type, PRODUCES becomes a single **menu-item** output (pick/create the menu_item + `menu_price`); inputs accept direct SKUs *and* production items.

## 5. Container vocabulary (the "Bottle → Quart" unblock)

Three labels on the edges, chosen once at authoring time, then **read** downstream (the panel never re-asks):
- **Input `each_container_label`** ("Bottle") — what the operator physically picks up; back-refs the SKU ("used as Bottles in the Hot Peppers recipe").
- **Input purchase unit** ("Case") — already structured on the SKU (`sku_pack_formats`).
- **Output `output_container_label`** ("Quart") + **yield** (2.5) — the item's line-ready unit and per-batch count.

The prep-consumption panel renders `1 Case → 2.5 Quarts` in the operator's words, **with oz shown alongside** (Juan's standing rule — oz drives recipes + trains staff), because it reads the labels off the recipe rather than guessing. Labels draw from existing registries (`sku_pack_formats` for purchase unit, `units` for output container) with MoO+ inline "add new" — vocabulary stays registry-backed (drift-prevention), not free text.

## 6. Migration & engine repoint

**Data migration (trivial):**
- Repurpose `recipes`: add `recipe_type`, `batch_yield`, `directions`/`directions_es`, `name_es`. Create `recipe_inputs`, `recipe_outputs`, `menu_items` (+ their deny-all RLS + captured `supabase/migrations/NNNN_*.sql`).
- **Reparent Hot Peppers:** insert one `production` recipe (batch_yield from the item) with `recipe_inputs` = the existing SKU edge (512 oz, Case/Bottle) and `recipe_outputs` = the Hot Peppers item (`yield` defaults to 1 — no output-yield data exists today; `output_container_label` default from `items.default_par_unit`; Juan sets the real yield/container in the builder).
- **`menu_price`:** create `menu_items`; add `menu_price` there; retire the item Global-tab menu_price editor (0 items use it). Leave `items.menu_price` column in place but unread (append-only; drop later once confirmed dead).

**Engine repoint (real code work, operator-invisible):**
- The prep panel reads consumption through exactly one function, `loadDerivedForItems(itemIds) → Map<itemId, DerivedSku[]>`. Keeping that return shape after repointing from `item_components` to the recipe graph means **Opening/Mid-day P2 + the panel do not change.**
- `lib/prep-consumption.ts` (`perUnitSkuOzForItem`, `loadDerivedForItems`) and `lib/admin/cost.ts` (`loadSkuConsumption`, item cost) repoint to walk: item → its production recipe (`recipe_outputs.output_item_id`) → `recipe_inputs`; recursion follows `component_item_id` → that item's recipe. `lib/recipe-math.ts` pure functions are **unchanged** — only the data-loading changes (pass `recipe_inputs` + `recipe.batch_yield`).
- Clean cutover (1 row); `item_components` kept as a dormant table for rollback, reads removed.

**Fan-out allocation (the one modeling call — approved v1 default):** when a batch produces multiple outputs from one input set, allocate the batch's input oz across outputs **by their oz-share** (share = this output's `yield × oz_per_output` ÷ Σ over outputs), then ÷ yield to get per-output-unit oz. `recipe_outputs.oz_alloc_share` allows a manual override later. Byproducts (scraps) carry a real small share, not free. Single-output recipes (the common case) reduce to today's math exactly.

## 7. Soft-gate, i18n, testing

- **Soft-gate (light):** recipes carry `active` + a derived completeness signal (missing inputs/outputs/yield → "incomplete" badge). Never blocking. Full verify→go-live gating is sub-project 2.
- **i18n:** `recipes.*` namespace, EN + ES parity, tú-form; `name_es`/`directions_es` on recipes, `name_es` on menu_items; container labels come from bilingual-capable registries.
- **Testing:** existing `recipe-math` tests hold (pure math unchanged); new throwaway `tsx` smokes prove **byte-identical `DerivedSku[]` for Hot Peppers pre/post cutover** (parity-gate pattern); `tsc --noEmit` + `next build` clean; operator smoke = Opening/Mid-day P2 render identical.

## 8. Out of scope (later sub-projects)
- **Verify → go-live gating** (sub-project 2) — recipes here only surface incompleteness.
- **Toast mapping + sales pull** (sub-project 4) — `menu_items.toast_ref` exists but is unpopulated; no sales ingestion.
- **Reconciliation/variance engine** (sub-project 5) — the dual-count moat; reads what this stage + prep produce.
- **Dropping `items.menu_price`** — deferred until confirmed dead post-cutover.

## 9. What ships in this sub-project
Both tiers: `recipes` (production + consumer) + `recipe_inputs` + `recipe_outputs` + `menu_items`; the `/admin/recipes` builder; the container-vocabulary edge-labels driving the panel language; reparent Hot Peppers; repoint the derivation engine (operator-invisible); move `menu_price` to `menu_items`. Migration + captured SQL files. EN/ES parity. No operator-flow change.
