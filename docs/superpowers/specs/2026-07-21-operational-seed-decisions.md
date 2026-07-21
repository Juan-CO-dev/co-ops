# CO-OPS Operational Seed — Decisions Register

**Date opened:** 2026-07-21
**Status:** IN PROGRESS — resolving open questions before writing any seed script (per the "resolve the schema decision first" sequencing).
**Source input:** Juan's transcription of 13 photos of CO's physical order guides / build sheets / checklists / Google Sheets (the "CO-OPS Seed Data" distillation), plus forthcoming CSV exports of the "Food Inventory & Costing - Current" sheet (Inventory, Menu Costing, Sub Recipes tabs).
**Why this doc:** the seed loads CO's real operational data (vendors, SKUs, items, pars, sub builds→recipes, menu costing, checklists, catering menu) into the **existing** inventory spine. The schema is mature (PRs #82–#110) — this is population + targeted extension, not greenfield. This register locks the modeling decisions so the seed script has one reference.

> **Milestone:** this is CO-OPS going from "checklist app" to holding the actual operational brain of the business. The spine's rails are built and verified (~5% populated today); this seed loads the train.

---

## Grounding: what the schema ALREADY models (verified live 2026-07-21)

- **`vendor_items` (the SKU / "vendor product") already carries:** `vendor_id` (nullable → supports internal/person sources), `name`, `item_number` (the vendor's item #, e.g. PFG `231710`), the structured pack model (`pack_format` + `units_per_pack` + `each_size` + `each_measure` + `avg_oz_per_each` + `each_container_label`), `location_id` (nullable → per-location), and **`weekday_par` / `weekend_par` inline** (the exact "X / Y WE" dual-par format). Price is append-only via `vendor_price_history`.
- **`par_levels`** (SKU ordering par, per-day): `(location_id, vendor_item_id, day_of_week, par_value)` — a day-granular alternative to the inline weekday/weekend pars.
- **`items` (the ITEM / logical good / prep+menu layer):** `location_id` (NULL = global canonical), `name`, `section`, `default_par`/`default_par_unit`, `is_default` (default-template membership → propagation), `tracking_type` (on_hand|portioned|line), `batch_yield`, `oz_per_par_unit`, `menu_price`, `sold_directly`, `sell_portion`, `catering_available`, `catering_only`. Two-tier global/local + enable-per-location.
- **`item_components` (BOM / recipe):** `item_id` → `component_sku_id` XOR `component_item_id` + `quantity` + `unit`. This is a **recipe** (how much of a component goes into one item unit) — NOT a purchase-source list.
- **`item_par_levels`:** item prep par, per-location, per-day, `par_mode` (inherit|manual|auto).
- **`recipes` / `recipe_ingredients`:** TRAINING prose (free-text), links to the item — NOT the costing BOM.

---

## LOCKED DECISIONS

### Q3 — "same good, multiple vendors" → **A storage + B search** (LOCKED)
- **Storage = A:** each vendor's product is its own `vendor_items` SKU (per-vendor, per-location). **No parent "good" table** — a parent invites ordering from the wrong vendor. Ordering targets a specific SKU. Pars + inventory are **location-scoped** (you see your location's SKUs + par).
- **The "one good, many vendors" experience is a system-wide SEARCH, not a stored grouping.** Searching e.g. "ham" runs a **federated read across every ham SKU (all vendors, all locations)**, grouped by **name match** at query time, with pricing for cross-vendor comparison. This mirrors the existing federated-search pattern (`searchPipeline`, unified search). Grouping is by name similarity, **not** a canonical-good FK. No wrong-vendor risk because ordering still points at one SKU.
- **Future (regional vendors):** some vendors are region-based; as CO expands, limit which locations can order from which vendors. This is a later **additive** `vendor ↔ location/region availability` gate on the search/order path — the A model does not preclude it and needs nothing now.

### Q4 — dual pars → **already supported** (LOCKED)
`vendor_items.weekday_par` / `weekend_par` inline (matches "X / Y WE"), with the per-day `par_levels` table available if day-granular ordering par is ever needed. Seed the inline weekday/weekend pars from the guides.

### Q1 — canonical guide / seed structure → **global canonical baseline that propagates** (LOCKED)
Don't pick "one canonical guide." Use the spine's existing **global-item → per-location enable/disable** architecture:
- **Global ITEM roster** (`items.location_id = NULL`, `is_default` where appropriate) = the **union of goods across guides A/B/C**, seeded once → propagates to every location; expansion = enable/disable. Guide C ("DuPont 11/30/25", richest — has item #s + pack) is the primary source for item#/pack detail.
- **Location-scoped vendor SKUs** (`vendor_items` with `location_id` + `vendor_id`) carry *who each location actually buys from* + that vendor's item#/pack/price/par (Cap Hill Ham → US Foods SKU; Dupont Ham → PFG `231710` SKU).
- Per-location par + vendor differences ride on the location-scoped SKUs; the global item roster stays vendor-agnostic.

### Q9 — canonical sub name → **"Crunchy Boi"** (LOCKED)
Matches the customer-facing storefront + station build cards. The inventory/costing sheet's "Crunch Boi" is a shorthand typo → normalize to **"Crunchy Boi"** everywhere (menu, recipes, costing). Watch for the same normalization on other names as the CSVs land.

### Q2 — Boar's Head A vs B → **resolved by the per-location guides Juan is providing** (LOCKED approach)
Juan is handing over the authoritative **per-location order guides**. Seed per the Q1 model: **unify into the global item roster + scope SKUs/pars per location** from each location's actual guide. The A/B (5pc vs 4pc capicola, Ever Roast Chicken present/absent, C/O Water vs Deer Park, Sysco section) distinctions resolve from the real per-location guides — no era/location guess needed.

### Q8 — person / internal sources → **plain vendor rows** (LOCKED)
Sarah and Cristian become ordinary `vendors` rows (the directory handles minimal-info vendors — nullable contacts/pricing); their SKUs point at them via `vendor_id`. **"Pete's house" is NOT a source** — it's a **brand note** on a Baldor-sourced Worcestershire SKU (the inventory sheet lists it in the Brand column, meaning Pete's house recipe, bought via Baldor). Model it as a brand/note on that SKU, not a vendor.

---

## OPEN QUESTIONS (status)

| # | Question | Status |
|---|---|---|
| Q1 | Canonical guide / seed structure | ✅ LOCKED — global baseline propagates |
| Q3 | Same good, multiple vendors | ✅ LOCKED — A storage + B search |
| Q4 | Dual pars | ✅ LOCKED — already supported (inline weekday/weekend) |
| Q9 | Naming: "Crunchy Boi" vs "Crunch Boi" | ✅ LOCKED — "Crunchy Boi" |
| Q2 | Boar's Head guide A vs B | ✅ LOCKED approach — resolves from the per-location guides Juan is providing |
| Q8 | Person-sources (Sarah / Cristian / "Pete's house") | ✅ LOCKED — plain vendor rows; "Pete's house" = brand note |
| Q5 | Unit chaos ("1 Sleeve!", ".25 Filled", "1 Row") — verbatim + normalized? | ⏳ resolve WITH the incoming per-location guides (they carry the real unit vocabulary) |
| Q6 | Sub build quantities (slices vs oz) → slice→oz mapping to connect builds↔costing | ⏳ needs the Sub Recipes CSV |
| Q7 | Menu Costing gaps (only Crunch Boi complete; Inventory cuts off; NBC misaligned) | ⏳ BLOCKED on CSV exports (Inventory / Menu Costing / Sub Recipes) |

## DATA RECEIVED (2026-07-21) — in-repo at `docs/seed/`
- `source/inventory-costing.csv` — the **2024 Inventory & Costing** tab: per-good `name, code, vendor, pack price, case qty, unit, cost/oz(or ea)`, sectioned (Produce/Meat/Dairy/Dry Goods/Bev/Misc). ~110 goods. **The cost basis.**
- `source/order-guide-caphill-2025-pfg.csv` — the **2025 Cap Hill order guide**. Item, **item #**, par, vendor. **Key finding: it's PFG-based with item#s** (same structure as the DuPont guide) → **CO consolidated ordering to PFG in 2025** for both locations. This is the **current ordering SKU source** (vendor + item# + par).
- `source/sandwich-build-sheet.csv` — per-sub ingredient **builds** (qty + unit). The sub `item_components`. Mostly oz/ea + a few hand-measures.
- `source/smallwares-order-guide-2023.csv` — cleaning/office/kitchen smallwares (item, par, source, item#).
- `recipes/ALL-RECIPES.md` — **38 sub-component recipes** (Garlic Mayo, Vodka Sauce, Marinara, Meatballs, aiolis, dressings, compound butters, etc.) text-extracted from .docx. **Bilingual EN/ES, structured** (ingredients + qty/unit, single/double batch, **yield**, method, storage/cook/reheat). These are recursive **sub-items** → feed `items` + `item_components` (composition/cost) AND training `recipes` (prose).

### Reconciliation nuance (surfaced, resolution below)
- **Ordering vendor (2025 PFG guide) ≠ costing vendor (2024 inventory).** The 2025 guide is the CURRENT ordering source (PFG consolidated, item#s, pars, **no prices**). The 2024 inventory has **cost/oz** but from the older per-vendor sourcing (Baldor/BH/US Foods/etc.). → seed **current SKUs from the 2025 guide** (vendor+item#+par) and use the **2024 inventory cost/oz as the starting price** on the corresponding good (Juan refines via the receiving flow → `vendor_price_history`). Where the inventory has goods not in the 2025 guide (Bacon, Mortadella, Corned Beef…), seed the good + its cost; SKU/vendor as available.

## OPEN QUESTIONS — updated status
- **Q5 (units) → RESOLVABLE (proposal):** store a numeric `par_value` + a `unit` string (from the units/measure registries, extended as needed: cs, lb, ea, oz, qt, jug, bottle, jar, bag, sleeve, box, #10 Can, gal, roll, pk, container…). The genuinely fuzzy order pars (".25 Filled", "half b. unopened") normalize to value+unit with the oddity in a note. Recipe hand-measures ("Handful", "pinch", "ladle") stay as recipe units on the build line, not order pars. Confirm the value+unit approach.
- **Q6 (slice→oz) → ONE REAL GAP:** the build sheet counts deli in **`ea` (slices)** (Ham 3 ea, Provolone 2 ea) but the inventory costs deli **per oz**. To cost a sub, deli slices need an **oz-per-slice** factor per meat (turkey shows as 4 oz in one build, ea in another — inconsistent). Need either (a) a slice-weight per deli, (b) the Menu Costing tab's ea→oz conversion, or (c) accept per-ea costing for deli where the pack gives $/slice. **Surfaced to Juan.**
- **Q7 (costing) → RESOLVED by the inventory CSV** (cost/oz per good) — sub cost is DERIVED from builds × cost (that's the spine's food-cost engine), so no separate "Menu Costing" export is needed; only the Q6 deli slice→oz gap remains to fully cost slice-counted subs.

**Next:** confirm Q5 + resolve Q6 (deli slice→oz), then decompose + write the staged seed scripts (below).

---

## Seed build shape (provisional — finalize once open questions close)

Likely decomposed into staged seed scripts (each idempotent, each verified against live counts), roughly:
1. **Vendors** (from the Vendor Master List — §9 of the distillation) + person-sources per Q8.
2. **SKUs** (`vendor_items`) per vendor, per location, with item#/pack/dual-par (A storage).
3. **Global item roster** (`items`, location_id NULL) = union of goods; enable per location.
4. **Item↔SKU recipes** (`item_components`) + **costing** (`vendor_price_history`, `menu_price`) — from the CSVs.
5. **Sub builds** (§1) → recipes/composition, once slice→oz (Q6) is resolved.
6. **Catering menu** (`menu_items` + catering pricing) — lights up the dormant catering moat (W1a/W4/FR/W4c) + funnel ⑤.
7. **Checklists** (§7 closing checklist) — reconcile against the already-seeded closing/opening templates (may already exist; verify, don't duplicate).

All idempotent (`pathToFileURL` main-guard), applied via `tsx --env-file=.env.local`, with pre/post live-count parity checks per the spine's backfill discipline.
