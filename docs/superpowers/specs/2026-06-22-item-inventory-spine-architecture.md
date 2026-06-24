# Item / Inventory Spine — Architecture & Decomposition

**Date:** 2026-06-22
**Type:** Architecture + decomposition doc (NOT a single implementation spec). Maps the model end-to-end, then sequences it into buildable sub-projects. Each sub-project gets its own brainstorm → spec → plan later.
**Origin:** Emerged from the C.44 prep-template-editor work (slices 1–2 shipped, #80/#81). Juan's "items maintain par across multiple reports" → "items originate from vendor deliveries" reframed a template feature into the app's central item/inventory model.
**Status:** DRAFT for Juan's review.

---

## 1. Why this exists (the thesis)

CO-OPS is meant to be an append-only "business's brain" — one attributed model producing integrated awareness, not separate lists that happen to overlap. The **item** is the spine of that model: a first-class entity that

- **originates from what vendors deliver** ("what we get in is what the system makes available"),
- **holds its par across every report it appears on** (AM-prep, mid-day, opening verification, closing), instead of par being copied per list,
- **is tracked per location** (each store manages its own inventory) **and rolled up globally** (the Owner/MoO+ unified view),
- **decomposes from purchased SKUs into line-ready and composite items** via a bill-of-materials, so the system can compute **actual food cost** (Σ component cost) and **yield projection** ("how many menu items can we make before we run out"),
- and eventually feeds **ordering + inventory + sales-velocity-driven par** (Toast integration).

This doc maps that spine and sequences the build so the daily operator flows (AM-prep / Opening run every morning) never break mid-migration.

## 2. Ground truth — the dormant scaffold (verified live 2026-06-22)

Most of this spine was scaffolded in Phase 0/1 and left dormant. Activating + wiring it is the bulk of the work; very little is net-new.

| Table | Rows today | Role in the spine |
|---|---|---|
| `vendors` | 1 (placeholder) | Shared vendor directory (shared account). Cols: name, category, contacts, ordering_email/url/days, payment_terms, account_number, active. |
| `vendor_items` | 24 (placeholder) | **The item catalog / global registry.** Cols: vendor_id, name, category, unit, unit_size, item_number, source_url, lead_time_days, weekday_par, weekend_par, notes, active. **No `location_id` yet** (global-only today). |
| `par_levels` | 0 | **Per-location dynamic par.** Cols: location_id, vendor_item_id, par_value, day_of_week, active, updated_by. |
| `vendor_orders` | (scaffold) | Per-location order header. Cols: vendor_id, location_id, order_date, expected_delivery, status, total_estimated, notes, created_by. |
| `vendor_deliveries` | (scaffold) | Per-location delivery header ("what we get in"). Cols: vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, received_by. **Header-only — no line-items table.** |
| `vendor_price_history` | (scaffold) | Price tracking over time — the cost source for food-cost math. |
| `recipes` / `recipe_ingredients` / `recipe_steps` | (scaffold) | **Human training recipes** (free-text `ingredient_name`, **text** `quantity`, steps + photo/video). This is knowledge-base content (Module #3), **NOT a costing BOM** (no SKU FK, non-numeric qty). The costing BOM is separate + new. A training recipe may *link to* its costing item later, but they're distinct artifacts. |
| `checklist_template_items.vendor_item_id` | 0 wired | The existing (unused) link. **Will be re-pointed to reference an ITEM, not a raw SKU** (see §3). Prep lines carry standalone `prep_meta.parValue` today. |

**Key gaps (net-new):** `location_id` on `vendor_items` (global vs location-owned); a **delivery line-items** table (which items, how many, arrived); an **intake verification** workflow; **on-hand inventory** state; a `par_mode` (manual/auto) concept; the wiring of report lines to `vendor_item_id` (re-pointing slices 1–2 par).

## 3. The entity model (the spine)

Two stacked registries: **SKUs** (what you buy / receive) and **Items** (what reports
reference + the menu is built from). A **bill-of-materials** links Items to SKUs (and
sub-Items), which is what makes food-cost and yield computable.

```
vendors (shared directory, shared account)
  └── vendor_items  ── the SKU LAYER (purchased units)
        • location_id NULL = global default; SET = location-owned; promotable
        • active = disable/enable (never delete)
        • cost ← vendor_price_history; on-hand tracked here (per location)
        • MANUAL SKUs: vendor_id nullable → "bought it ourselves to test" items
        │
        ├── par_levels (ordering par: per location, per day_of_week)
        ├── vendor_orders (per location) → vendor_order_items (NEW: order, sku, qty)
        ├── vendor_deliveries (per location, email/photo capture)
        │     → vendor_delivery_items (NEW: delivery, sku, qty)
        │     → intake verification report (NEW): a person verifies what arrived
        │       → CONFIRMS delivery → activates on-hand inventory
        └── inventory_on_hand (NEW, per location, per SKU)
              • increased by VERIFIED deliveries; decreased by usage

items  ── the ITEM LAYER (line-ready / composite / manual — what reports use)
  • kind = sku_direct  : one SKU portioned into a line-ready item
  •        composite    : built from a BOM (sauces, chicken cutlets, …)
  •        manual       : written-in, no SKU (ad-hoc / test items)
  • location_id NULL = global default; SET = location-owned; promotable; active flag
  │
  ├── item_components (NEW — the costing BOM)
  │     • parent item_id → component (sku_id OR child item_id) + qty (NUMERIC) + unit
  │     • DISTINCT from recipes/recipe_ingredients (that's human training content)
  │     • drives: food cost = Σ(component cost × qty); yield = min(on_hand/qty)
  │
  ├── item par (prep par: per location/day) ── the PAR LAYER
  │     • default ← item → location override (AGM+) → auto (Toast velocity)
  │     • par_mode: manual | auto
  │
  └── checklist_template_items → references an ITEM  ── THE BRIDGE
        • report lines reference an item; par resolves from the par layer (not prep_meta)
        • AM-prep↔Opening "mirror" becomes "same item" by construction
          (retires the slice-1/2 propagation helpers)

DERIVED: food cost (item & menu) · yield projection ("N left before out") ·
GLOBAL AGGREGATE VIEW (MoO+/Owner): rollup of inventory/orders/deliveries/par/cost
across all locations — the unified picture only one model can produce.
```

**Par attaches at two levels** (both via a par mechanism): **item par** for prep lists
("6 pans of veg") and **ordering par** for SKUs ("order N cases"). Whether one generalized
`par_levels` (FK to either item or SKU) or two tables is a sub-project detail (§7).

## 4. The layers

### 4.1 Registries (what exists) — SKUs and Items
- **SKU registry** (`vendor_items`): purchased units. Vendor-linked, OR **manual** (`vendor_id` null = "we buy it ourselves to test"). Cost via `vendor_price_history`.
- **Item registry** (`items`, new): what reports reference + the menu builds from. Three `kind`s — `sku_direct` (one SKU portioned), `composite` (a BOM of SKUs/sub-items), `manual` (written-in, no SKU).
- Both registries are two-tier: `location_id NULL` = global default (all locations run on it); set = location-owned. **Disable/enable** via `active` — never delete; re-enable reuses the row (Juan's explicit ask). **Promotion** = flip `location_id → NULL` to adopt a location's item/SKU to global. Governance: location add = AGM+; promote-to-global = Owner/CGS.

### 4.2 BOM, cost & yield (derived)
- **`item_components`** (new): parent item → component (a SKU or a child item) + **numeric** qty + unit. The structured bill-of-materials — distinct from the free-text training `recipes`.
- **Food cost** = Σ(component cost × qty), recursing through sub-items; SKU cost from `vendor_price_history`.
- **Yield projection** = for a composite item, `min` over components of `(on_hand / qty_per_unit)` → "how many can we make before we run out." Menu-item yield rolls these up.

### 4.3 Par (how much) — layered resolution
Resolve a line's par in priority order:
1. **Auto / velocity** — if `par_mode = auto`, par is suggested/derived from Toast sales velocity (future; until Toast lands, auto falls back to override/default).
2. **Per-location override** — AGM+ set, per `day_of_week`.
3. **Default** — the item's default (prep par) / the SKU default (`weekday_par`/`weekend_par`, ordering par).

Two par contexts: **item par** for prep lists, **ordering par** for SKUs. Authority: **AGM+ (≥6)** set/override at their location. `par_mode` toggles manual/auto per line.

### 4.4 Origination / availability (what's actually here) — the order→deliver→verify→active lifecycle
1. **Order** — a manager inputs a `vendor_order` (+ confirmation number); status `pending`/`ordered`. Lines = `vendor_order_items`.
2. **Delivery** — arrival captured as a `vendor_delivery` via **email receipt or photo**; lines = `vendor_delivery_items`.
3. **Intake verification** — a person fills an **intake verification report** confirming exactly what came in (qty matches, condition, discrepancies). This is a verification workflow analogous to opening/closing reports.
4. **Activation** — a verified delivery **activates inventory**: `inventory_on_hand` increases; the item is "live in the system" and available to reports.
5. **Usage** — prep/usage depletes on-hand (the depletion-capture mechanism is a later design — likely derived from prep counts).

**Availability depth = full on-hand inventory** (Juan's choice). Staged: registry + par + reports first; on-hand accounting wired as deliveries/verification land.

## 5. How reports consume the spine
- Prep/opening/closing template lines reference an **item** (the bridge — re-point the existing `vendor_item_id` link to an `item_id`, or add `item_id`).
- A line's **definition** (name, unit) and **par** come from the item registry + par layer — not `prep_meta`. `prep_meta` shrinks to list-specific bits (column set, display order, required) or becomes a thin reference.
- The **AM-prep ↔ Opening mirror** (slices 1–2) becomes "both lines reference the same **item**," so name/par sync is *by construction* — retiring `propagateParToOpeningMirror` / `setOpeningMirrorSection` etc.
- **Migration reconciliation:** slices 1–2 stay (the admin template editor is still how you *arrange* lists), but item definition + par migrate to the registry. Existing `prep_meta.parValue` values backfill into the item registry / par layer; existing prep lines backfill their `item_id` (dedup AM-prep↔Opening mirrors into one item via the existing link).

## 6. Authority / governance (who does what)
| Action | Level |
|---|---|
| Set/override per-location par; toggle auto | AGM+ (≥6) at the location |
| Add a location-owned item; disable/enable at location | AGM+ (≥6) |
| Input orders; capture deliveries; intake verification | location operational roles (KH+/SL+ TBD per sub-project) |
| Promote a location item to global; edit global catalog | Owner/CGS (≥9) |
| Global aggregate view across locations | MoO+ (≥8) |
| Manage vendors (full) | GM+ (≥7) per existing AGENTS.md vendor split |

(Exact gates per action finalized in each sub-project's spec.)

## 7. Decisions
**RESOLVED (Juan, 2026-06-22):**
- **SKU vs item layer** — CONFIRMED: two registries (SKUs + Items) with an `item_components` BOM above SKUs. Drives food cost + yield. (Was the biggest open question.)
- **Manual items** — CONFIRMED needed: SKUs/items can be written-in without a vendor ("we buy it ourselves to test").
- **Item storage** — `location_id` on both registries (NULL=global), single-table + promotion.
- **Availability** — full on-hand inventory, activated by verified deliveries.

**Still open (resolve per sub-project):**
- **Par storage:** one generalized `par_levels` (FK to item OR sku) vs separate item-par and sku-par tables. Reconcile granularity (`day_of_week` vs weekday/weekend buckets vs prep's single value).
- **Training recipes ↔ BOM items:** do `recipes` (knowledge content) link to their costing `item` (a `recipes.item_id`)? Likely yes, later — keep distinct for now.
- **On-hand depletion source:** how usage decrements on-hand (derive from prep/sales counts? explicit waste/usage capture?).
- **Delivery capture parsing:** email/photo stored as-is first; OCR/auto-parse later?
- **Unit conversions:** SKU unit (case) → recipe unit (oz/each) conversion factors for cost/yield math.

## 8. Decomposition & safe build sequence
Each is its own brainstorm → spec → plan → subagent build → review → PR. Staged so daily ops never break.

1. **Registry foundation (behind the scenes).** Schema: `location_id` on `vendor_items` (+ nullable `vendor_id` for manual SKUs); new `items` table (kind sku_direct/composite/manual, location_id, active) + `item_components` BOM; `item_id` bridge on report lines. Backfill items from current prep/opening lines (dedup AM-prep↔Opening mirrors into one item via the existing link); seed obvious `sku_direct` links where a line clearly maps to a SKU. **Operator forms unchanged.** Verified by backfill-correctness.
2. **Registry-driven editing + par layer.** Admin edits the *item* (incl. composite BOM, manual items) + per-location par (AGM+), `par_mode`; reports read definition + par from the registry; retire slices 1–2 propagation. (Absorbs *Vendors + Pars*. The mid-day "add from existing" picker falls out here = pick a registry item.)
3. **Vendors + SKUs admin.** Activate the vendor directory + SKU management (incl. manual SKUs) — GM+ full / AGM+ trivial per existing split.
4. **Ordering.** Per-location `vendor_orders` + `vendor_order_items` (manager inputs order + confirmation #).
5. **Receiving + intake verification.** `vendor_deliveries` + `vendor_delivery_items`, email/photo capture, the intake verification report → confirms delivery.
6. **Inventory on-hand.** Activation from verified deliveries; depletion model; "available to reports."
7. **Food cost + yield.** BOM rollup × `vendor_price_history` → item/menu food cost; on-hand ÷ BOM → yield projection. The payoff analytics.
8. **Global aggregate view (MoO+/Owner).** Cross-location rollup of inventory/orders/cost/par.
9. **Sales-velocity / auto-par (Toast).** `par_mode=auto` suggestions. (Gated on Toast integration phase.)
10. **Section model for prep** (the earlier slice-3/4 ask: display-rename + dynamic sections + generic operator-form refactor) — independent of the spine; ran alongside. ✅ SHIPPED across #85 (sections first-class + display-rename) and #88 (data-driven AM-prep render via one shape-driven `GenericPrepSection` + add/remove/reorder sections + edit-input-type; section `shape` ∈ on_hand|portioned|line|yes_no drives columns + auto-total). Section editing is MoO+-only.

## 8a. Progress log (as built)
- **#82** registry foundation (migration 0079 `items`+`item_components`+`item_id` bridge; backfill 87 items/174 lines). Step 1 ✅.
- **#83** registry goes live — reports/edits resolve par+name from the item; propagation retired. Step 2 (part) ✅.
- **#84** par layer (migration 0080 `item_par_levels`, day-aware resolver) + 3-tab checklist admin (Global registry + per-location). Step 2 ✅.
- **#85 / #86 / #87** sections first-class + rename · full item definition (special-instruction/required/min-role/section, item-canonical + propagate) · units registry + dropdown + normalize. Admin matured.
- **#88** add/remove/reorder sections + data-driven AM-prep render (migration 0086 `prep_sections.shape`; one `GenericPrepSection`) + edit-input-type. Committed parity gate ran 0-drift on prod.
- **⭐ NEXT (post-#88): per-line input type + non-inventory Q&A.** Input type moves onto the line (section = default → mixed sections fall out). Questions keep the `items` registry PURE — two flavors: *item-attached* questions ride their item onto reports; *standalone* questions behave like **searchable report tags** (Reports Hub free-text search). The read-path already tolerates `item_id = NULL` lines, so this is a write/admin + heterogeneous-render change, not a schema fight. Then steps 3–9 (vendors/SKU → ordering → receiving → on-hand → cost/yield → aggregate → Toast auto-par).

## 9. What this absorbs / supersedes
- The planned **Vendors + Pars** admin module is now sub-projects 2–3 of this arc.
- The **prep-template-editor slice 3/4** (mid-day picker, dynamic sections) is reframed: the mid-day "pull from existing" picker becomes "add a registry item to a list" (falls out of sub-project 2); section model is sub-project 9.
- This is the **Ordering/Inventory phase** from the vision/REMAINING_SCOPE, now designed as the central spine rather than a bolt-on.
- The remaining standalone admin modules (**Locations**, **Audit viewer**) are unaffected and can run anytime.

## 10. Next step
Juan reviews this. On approval, we brainstorm **sub-project 1 (SKU + item registry foundation)** in detail — the schema for the two registries + the BOM + the backfill from today's prep/opening lines, all behind the scenes with operator forms unchanged. The big shape question (SKU vs item layer) is now resolved (§7), so the foundation brainstorm focuses on table shapes, the backfill/dedup strategy, and the par-storage decision.
