# CO-OPS Operational Seed — Decisions Register

**Date opened:** 2026-07-21
**Status:** ✅ ALL 9 QUESTIONS RESOLVED (2026-07-21) — decisions locked, source data in-repo, ready to decompose + write the staged seed scripts.
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
- **Q5 (units) → ✅ LOCKED:** numeric `par_value` + a `unit` string (cs, lb, ea, oz, qt, jug, bottle, jar, bag, sleeve, box, #10 Can, gal, roll, pk, container…). Fuzzy order pars (".25 Filled", "half b. unopened") normalize to value+unit with the oddity in a **note**. Recipe hand-measures ("Handful", "pinch", "ladle") stay as **recipe units on the build/component line**, not order pars.
- **Q6 (slice→oz) → ✅ LOCKED: estimate now, refine later.** Seed an **estimated oz/slice per deli** (flagged estimated) so every slice-counted sub costs immediately; refine via the spine's existing **running-average `avg_oz_per_each`** (receiving observations). CC proposes the estimates; Juan corrects any.
- **Q7 (costing) → ✅ RESOLVED by the inventory CSV** (cost/oz per good) — sub cost is DERIVED from `builds × cost/oz` (the spine's food-cost engine). No separate "Menu Costing" export needed.

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

---

## STAGE PROGRESS

### ✅ Stage 1 — Vendors (DONE, prod, `scripts/seed/01-vendors.ts`)
17 vendors, idempotent. `Sisco→Sysco` reconciled in place. Two axes seeded: **categories** (prep-section: Veg/Cooks/Sides/Sauces/Slicing/Misc/Paper/Cleaning/Other) + **order_types** (supply: Produce/Protein/Dairy/DryGoods/Paper/Chemical/Beverage/Specialty/Equipment/Other). Real contacts/ordering where known (Penny Candy email), placeholders "TBD" else. All satisfy min-1 on every axis. **Lesson:** the two vendor axes are distinct registries — don't conflate `categories` (prep-section) with `order_types` (supply). The seed's own min-1 verify caught it.

### ✅ Stage 2 — SKUs (`vendor_items`) — DONE (prod, `scripts/seed/02-skus.ts`, commit `2a5ceb2`)
**Result on prod:** 97 SKUs created from the Cap Hill 2025 guide (global, one per row, honoring each row's own vendor col; `n/a` rows skipped). 45 pack-enriched from the 2024 inventory sheet; 52 pack-null (packaging/chemicals not in the food sheet + a few name mismatches → Stage 4/manual). 10 in-house-prep placeholders deactivated; 15 raw placeholders + **Hot Peppers** (its `item_components` link) left untouched. Post-run: **112 active global `vendor_items`** (25 − 10 + 97), 10 inactive, 107 stage-2 audit rows. Idempotent; `SEED_DRY=1` dry-run mode.
**Grounding corrections surfaced (confirm-before-authoring):** the 25 placeholders were on **Baldor/Sysco**, NOT PFG — a legacy prep-bench catalog that barely overlaps the PFG purchasing guide (only `Ham`/`Fresh Mozzarella` by name; the one linked row, Hot Peppers, isn't in the guide at all). So the locked "update raw in place" step was **moot** and dropped — Juan chose option 1 (seed new + deactivate preps + leave raw/Hot Peppers), since Q3's per-vendor model welcomes multi-vendor name duplicates.
**Decisions (Juan-locked, as executed):**
- **Scope = GLOBAL** (`location_id NULL`). P Street par overrides / extra SKUs later (its guide TBD).
- **Placeholders:** deactivate the 10 preps; leave the 15 raw + Hot Peppers.
- **Par:** numeric → `weekday_par` (the existing layered-par mechanism the backend/admin dictate); verbatim par (".25 jug") → `notes`; `weekend_par` NULL. (Juan: weekday/weekend par IS the dynamic-par home — no new column.)
- **Price/cost + pack for the 52 unmatched → Stage 4** (`vendor_price_history`), reusing the same alias matcher.
- **⭐ inventory-only gate (Juan add-on):** packaging + cleaning supplies (the guide's **"Packaging Supplies"** + **"Trimark"** sections = **38 SKUs**) must be orderable/inventory-tracked but **excluded from ingredient contexts**. Migration **0142** adds `vendor_items.inventory_only bool NOT NULL DEFAULT false`; the seed sets it true for those 2 sections; the two recipe-builder queries (`app/admin/recipes/[id]/page.tsx` + `new/page.tsx`) now `.eq("inventory_only", false)`. Every inventory surface (SKU admin, vendor detail, receiving, par, readiness — all via `loadSkus`/direct reads) still shows them. **`MadeFromEditor` (BOM picker) is currently UNMOUNTED — when wired, its `skuOptions` source must apply the same filter.**
- **Naming-alias matcher (durable — reused in Stage 4):** normalize + alias so `Hot/Sweet/Banana Peppers` ↔ `Peppers (Hot/Sweet/Banana)`, `Fresh Mozzarella` ↔ `Mozzarella`, `Roasted Red Peppers` ↔ `Roasted Red Pepper`, `Red wine vinegar` ↔ `Red wine vin`. Lives in `scripts/seed/02-skus.ts` (`ALIAS`/`canonKey`).

### 🔄 Stage 3 — RECIPE-DRIVEN item wiring (merges old Stage 3 + Stage 5) — IN PROGRESS
**⭐ Architecture re-frame (Juan: "items are born from recipes" — CONFIRMED by schema).** Grounding overturned the old plan:
- **The item roster is NOT empty** — **45 active global `items` already exist** (131 total), organized by prep SECTION (Cooks/Misc/Sauces/Sides/Slicing/Veg). So "seed the item roster" was wrong; the work is **wiring the existing items to their composition**.
- **The canonical composition graph is the RECIPE graph**: `recipe_inputs` (SKUs/sub-items consumed) → `recipe` (recipe_type `production`→items | `consumer`→menu_items) → `recipe_outputs.output_item_id` (the item produced, + yield). **Cost, readiness, production, prep-consumption ALL read this** (`lib/production.ts`). **`item_components` is the DEAD legacy graph** (diverged post-#121; MadeFromEditor unmounted; even Hot Peppers' 1 link is a stale leftover — leave it, a proper recipe_input supersedes it). **So seed into recipe_inputs/outputs, NEVER item_components.**
- So old **Stage 3 (items) + Stage 5 (recipes) MERGE** into one recipe-driven pass, **section by section**. Write path mirrors `lib/recipes.ts` (`createRecipeFull` / recipe+inputs+outputs; directions bilingual on `recipes.directions`, NOT recipe_steps).
**Locked decisions (Juan):** (1) recipe-driven, section by section — **Sauces → Cooks → Sides → (seed BH SKUs) → Slicing → Veg**. (2) Portioned deli/produce items (no .docx) = **trivial single-input recipes** (raw SKU → item) so cost/readiness work uniformly. (3) Ranch/Horsey/Vin = **APPROXIMATE** simple house mixes (no .docx yet; flagged, refine later). (4) No-item recipes → **wire existing items + birth required recursive sub-components** (Strata Base, Meatball Spice Mix, Caramelized Onion feeds Beef Jus/French Onion Dip — graph is recursive); **defer pure menu builds (Fun-guy) + catering/seasonal (Coleslaw, Corn esquite, Breadpudding, Strata) to Stage 6**. (5) Ingredient→SKU match is **alias-aware + REPORTS misses** (don't fabricate).
**⭐ Boar's Head gap found + captured:** the BH order guide (deli meats/cheeses/pickles/peppers/DB sodas, with the **FIRST dual weekday/weekend pars** + pack like Turkey 2/cs) was in the original chat distillation but NOT among the 4 committed CSVs — now saved as `docs/seed/source/boars-head-order-guide-vA.md` (Version A = accurate). BH SKUs get seeded when the **Slicing/Veg** sections wire (they need them; Salsa Verde's pickle-chip input connects then). Cost basis = the "BH" rows in inventory-costing.csv.

**✅ Stage 3a — Sauces DONE** (`scripts/seed/03a-recipes-sauces.ts`, commit `6452329`): 9 recipes on prod wiring all 9 Sauces items (Garlic Mayo→Aioli, Honey Chili Aioli→HC Aioli, Cholula Mayo→**HP Mayo** ["HP"=Hot Pants], Mustard Aioli, Italian Salsa Verde, Dukes portioned, + 3 approximate Ranch/Horsey/Vin); 36 inputs (16 SKUs), 9 outputs, 9 audit rows. 1 known miss = Salsa Verde pickle chips (BH, unseeded).
**✅ Stage 3b — Cooks DONE** (`scripts/seed/03b-recipes-cooks.ts`, commit `e623151`): 6 recipes on prod (Caramelized Onions→Caramelized onion, **Beef Jus→Jus** [Juan: Jus=Beef], Marinara, Vodka Sauce→Vodka, Garlic/Compound Butter→Compound Butter, Chicken Cutlet approximate); 32 inputs incl. the **first recursive sub-item** (Caramelized onion item → Beef Jus). 3 misses = Worcestershire, Beef Base, White Wine (unseeded pantry items, not on the guides). Pattern now supports `component_item_id` inputs (SKU-first; explicit `item:true` for sub-items).
**✅ Stage 3c — Sides DONE** (`scripts/seed/03c-recipes-sides.ts`, commit `4e47101`): 6 recipes (Cannoli Cream, Chicken Salad→Chix Salad, Egg Salad, French Onion Dip→Onion Dip, Tuna Salad, Antipasto Pasta approx).
**⭐ Shared engine `scripts/seed/lib-recipe-seed.ts` + AUTO-PLACEHOLDER (Juan: "placeholder the misses so they can get filled in").** All section scripts are now thin callers. The engine is idempotent at recipe AND input/output level (re-runs top up missing edges, no dupes) and **auto-creates an empty placeholder SKU for any unresolved ingredient** (global/active, no vendor/pack/price, note `placeholder ingredient SKU…`) so no recipe input dangles. Sauces + Cooks were refactored to thin callers + RE-RUN to backfill their prior misses. **7 placeholder SKUs now live** (Pickle Chips, Worcestershire, Beef Base, White Wine, Vanilla Bean Paste, **Ever Roast Chicken** [BH], Dried Chives) — reconcile when their guide seeds (Pickle Chips + Ever Roast Chicken ↔ Boar's Head).
**Prod after 3a–3c:** 21 recipes (Sauces 9 + Cooks 6 + Sides 6), 21 outputs, 106 inputs (1 recursive sub-item: Caramelized onion→Beef Jus), 7 placeholder SKUs all wired.
**✅ Boar's Head SKUs DONE** (`scripts/seed/04-boars-head-skus.ts`, commit `f6df082`): 23 active BH global SKUs from the guide with **dual weekday/weekend pars** (first source; 20 carry weekend_par) + pack from "N/cs". **Filled 2 recipe placeholders in place** (Ever Roast Chicken; BH Pickle slices → the "Pickle Chips" placeholder) preserving their recipe_input wiring. **Deactivated 8 Baldor deli/pepper stand-ins** (Turkey/Pepperoni/Capicola/Provolone/Roast Beef/Banana/Hot/Sweet Peppers — Juan OK'd; Ham/Fresh Mozz/White Cheddar/Salami untouched). Prod: 132 active global SKUs, 5 recipe placeholders left (Worcestershire/Beef Base/White Wine/Vanilla Bean Paste/Dried Chives).
**⏳ NEXT = Stage 3d/3e Slicing + Veg** (portioned items = single-input recipes: raw SKU → item, via the shared engine). Slicing (Capicola, Cheddar, Genoa, Ham, Mortadella, Pepperoni, Provolone, Roast Beef, Turkey) → their BH deli SKUs (Ham=PFG, Cheddar=US Foods/PFG). Veg (Basil, Cucumber, Fresh Mozzarella, Hot Peppers, Iceberg, Onion, Pickles, Radish, Shredded Mozzarella, Sweet Peppers, Tomato) → PFG produce + BH peppers/pickles. Portioned single-input recipe needs a yield (pieces/oz per raw unit) — estimate per Q6, refine later.

### ⏳ Stage 6 — Catering menu; Stage 7 — Checklists (unchanged; see read-first memory)
