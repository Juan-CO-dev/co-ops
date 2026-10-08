# Seed 43 — depletion mapping sprint (revision 2)

Authored 2026-10-07 by reading prod (SELECT only, project `bgcvurheqzylyfehqgzh`) and the repo at `main d3034be`. Nothing has been applied, committed, or changed in app code.

**Revision 2** applies Sol's REWORK review, CC's rulings 1–5 and Juan's new answers (rule 6). The full list is in §8.

- **File:** `seed-43-mapping.sql`. It is one `DO $seed43$` block followed by six read-only verification SELECTs (V1–V6).
- **How to run:** send `BEGIN; SET LOCAL seed43.target = 'sim'; <file>; COMMIT;` as one query. Prod needs the value `'prod'`. The target guard checks for the `maya@sim.co-ops` persona, which exists only on the sim. If the target is wrong, the block raises an exception.
- **Idempotent:**
  - Every insert has a NOT EXISTS guard. A second run inserts nothing and supersedes nothing.
  - The seed deletes nothing.
  - A guard raises if the rule table ever holds a duplicate (name, role). Two matching rules would produce two inserts for one guid.
- **Audit:** every created, updated **and deactivated** row writes one `audit_log` row with `metadata.actor_context = 'seed_43'` (seed-42 shape).
  - A supersession writes two rows: `toast_map.manual_map` on the new row, and `toast_map.unmap` (reason `superseded`, `superseded_by`) on each row it deactivated.
  - Destructive flags follow the registry: map actions use `false`; recipe, menu_item, vendor and vendor_item actions use `true`.
- **Checks:** the SQL grammar and PL/pgSQL body parse cleanly (pglast / libpg_query 17). The G6 candidate set was dry-run as a read-only SELECT on prod. The counts below come from that run, adjusted for the revision-2 rule changes.

## 0. Does the modifier crosswalk support REMOVE and SWAP today?

Read from the code: `lib/catering/toast-sales.ts` `deriveSalesConsumption`, `lib/toast/modifiers-shared.ts`, and migrations 0146/0152/0155/0158.

**REMOVE: yes.** `disposition` accepts `deplete | remove | ignore | assortment_full | assortment_classics`. A `remove` behaves differently by target:

| Target | What a remove does |
|---|---|
| item | Parent-aware via `removalAmount(graph, parent, item)`, but **falls back to `portion_qty` when the parent recipe lacks the item** |
| sku | Portion only; not parent-aware |
| menu_item | Subtracts whole units |

The item and SKU lanes are both clamped at zero per day.

The portion fallback is the trap. A removal whose target differs by parent (No Cheese, No Mayo, No Peppers) subtracts the wrong ingredient on some parents. Revision 2 therefore maps only removals whose target is **the same on every parent**. The rest are staged (see §1).

**SWAP: no.** Three things block it:
- The unique index `toast_map_uq_guid` on (location_id, toast_item_guid) WHERE active AND confirmed.
- `modifierByGuid` is a guid → single-target map.
- `toast_map_entity_xor` requires exactly one entity.

One modifier cannot both add and remove, so the GF swap is staged until spec A ships.

**Dual-role guids.** Base lines resolve only against non-modifier rows, and modifier lines only against modifier rows. With one row per guid, two groups cannot resolve at all:
- Guids mapped as a modifier but rung as their own line: tomato, pickles, hot peppers, cheddar, cucumbers.
- Guids mapped as a base item but used as a bundle pick: Coca-Cola (129 under Full Lunch), Diet Coke, Dr. Brown's.

That needs spec C.

## 1. What the seed does

Row counts are from the prod dry-run.

| Group | What | Rows |
|---|---|---|
| **G1** | Vendor **District Bakery** plus SKU **Gluten Free Roll (District Bakery)** (raw, Each/1/count). No price is written (TODO for Juan). The older "Gluten Free Bread" SKU under vendor "Sarah" is untouched (Juan to confirm). | 1 + 1 |
| **G2** | Two **TODO parameters** at the top of the file, both NULL, so nothing is written: `p_whole_pickle_oz` and `p_gf_roll_oz`. When set, each writes `avg_oz_per_each` (weight_class OPERATIONAL) plus an audit row. While NULL, the pickle items and the GF add-on line stay **poisoned**: visible, not guessed. | 0 until filled |
| **G3** | New `menu_items`, all with `catering_available = false`. Full list below. | 25 |
| **G4** | Consumer recipes (batch 1, yield 1) for every new item and the 9 mapped-but-no-recipe dead ends. Skipped if an active recipe already outputs the item. | 34 |
| **G5** | Portion fixes. Each old row is superseded and re-inserted, with two audit rows per fix. Details below. | 9 |
| **G6** | Crosswalk rows from the reviewed name rules over every **unmapped** guid in the sales ledger or the Toast menu cache. Never mapped: a guid with several names (the open-item guids) or a guid that already has an active confirmed row. A modifier rule that targets a menu_item needs ledger evidence and an allowed parent. | **224** (EM 99 / MEP 125) |

**G3 items:**
- Caprese
- Chicken Bacon Caesar Sub
- Chicken Bacon Pesto Pasta
- Egg Salad- 1/2 pint
- Tuna Salad 1/2 Pint
- Whole Grain Chicken Salad
- Side Marinara Sauce
- Large Anti Pasta, Large French Onion Dip, Large Tuna and Large Egg Salad (32oz)
- **Large French Onion Dip (16oz)**: created for later, unmapped
- Fruity Pebble Cannoli (single)
- Gluten Free Roll (District Bakery)
- 9 "(add-on)" items
- 2 "(modifier build)" items: Cheesy Boi filling and Double Meat – Teamster

**G5 portion fixes:**

| Modifier | Old portion | New portion | Why |
|---|---|---|---|
| Pepperoncini | 1 each | 0.25 oz | Same as hot peppers |
| Dijon | 1 each | 1 oz | Sibling sauces |
| Cholula Mayo (→ HP Mayo) | NULL | 1 oz | Sibling sauces |

### The 224 G6 rows

Roughly 200 of them deplete today:
- **35 base add-ons.** Add X lines rung on their own map to the "(add-on)" items.
- **24 base sides:**
  - Egg, Tuna and Chicken salad at 6 oz.
  - **Side Marinara at 4 oz.**
  - Side of Meatballs (existing recipe).
  - The Larges at 32 oz.
  - Caesar Sal.
- **12 base aliases:**

  | Toast name | Maps to |
  |---|---|
  | BLT | Regular BLT |
  | Turkey Sandwich | Turkey Sub |
  | Marisa Tomei / Frex | their subs |
  | Saratoga Sparkling | Saratoga |
  | Mini Chips | Mini Chips- Utz Original |
  | "$12 Meal Uber" items | the sub |

- **5 specials.** Caprese, plus MEP's "Tomato & Mozz Sandwich" mapped to Caprese, plus the two chicken items.
- **4 GF base lines.** The GF roll sold as its own line; poisoned until the weight is filled.
- **1 package:** Full Lunch → package (1 sub, as an even mix).
- **1 retail:** Fruity Pebble Cannoli (single).
- **57 adds:**

  | Modifier | Depletes |
  |---|---|
  | Put Chips / Potato chips | 1 handful (2.2 oz) of Utz Ripples |
  | fresh mozz | 3 oz |
  | Add Bacon | 2.5 slices |
  | More Salami | 1.6 oz |
  | Prosciutto | 2 each |
  | Salsa Verde | 0.5 oz |
  | Double Roast Beef | 5 oz |
  | Radishes, Shredded lettuce, Garlic Mayo, Dukes/Extra/Add mayo, HC Aioli | copies of the live rows of the same name |

- **18 removals, same target on every parent:**

  | Modifier | Removes |
  |---|---|
  | No Bacon | Bacon |
  | No Shredduce | Iceberg |
  | No Oil and Vin | Vin |
  | No Arugula | Arugula |
  | No bread / Serve on Greens (GF) | Sub Roll |

- **30 BOI fillings.** Cheesy Boi uses its modifier build.
- **4 Double Meat** rows (Teamster only).
- **1 size:** "Medium (16oz)" → +1 unit of Bacon Caesar Pasta Salad. The roasted-red-peppers guid is excluded and stays unmapped.
- **7 bundle extras:**
  - Regular Utz, BBQ, S&P and S&V → the chip items.
  - Whole Pickle → Deli Pickle.
  - Staffer "Sandwich → Crunchy Boi".
  - Most Popular → `assortment_full`.
- **1 Three Footer pick:** "3 foot Crunchy Boi" depletes **4.5 Crunchy Bois** (approximate). The rule for "3 foot Teamster" has had no sales yet.

**24 STAGED rows** (`ignore`, target and portion recorded). V5 lists them for the flip-on follow-ups:

| Staged rows | Count | Why staged | Flips on with |
|---|---|---|---|
| Lunch picks: Crunchy Boi (Turkey Sub), Teamster (Italian), Sicky, NBC, Hot Pants, Marisa, FMAD | 7 | Depleting now would double-count the package's even spread | spec B |
| GF swap modifiers: "District Bakery's Gluten Free Roll", "On / Serve on gluten free bread" | 11 | Would add a GF roll without taking back the Sub Roll | spec A swap |
| No Mayo (→ Dukes) | 4 | The spread differs by parent (Aioli / Dukes / Horsey) | spec A parent-only |
| No Peppers (→ Hot Peppers) | 2 | The peppers differ by parent (hot / sweet / banana) | spec A parent-only |

**Deliberately NOT mapped:**
- **No Cheese** (18 guids). It keeps today's behaviour, a slight cheese over-count, until spec A.
- **Light Lunch base.** Juan says it is half a sub. The package slot quantity (1) is also the customer portal's `pickN` (`app/order/build/page.tsx` requires the picks to sum to exactly `pickN`). Setting it to 0.5 would break ordering, so it waits for `depletion_qty` in spec B.
- **Three Footer base.** Its content is the 4.5-sub pick. Mapping the base to the package as well would double-count.

## 2. Recipes (G4)

- **Sourced from Juan or existing builds:**
  - Sides at 6 oz of the prepped item; **Side Marinara at 4 oz (Juan r2)**.
  - Larges at 32 oz. Anti Pasta is 4 par units, because 1 par unit is one 8 oz side.
  - **French Onion Dip 16 oz** (unmapped). Toast has only one Large button, priced $20, and it maps to 32 oz.
  - The add-ons, using the app's own `derivePortion` medians.
  - Double Meat, the GF roll, and the retail 1:1 links: Mini Chips 1 oz, the mini case 24 oz, the assorted case at 24 × 2.75 oz even across 5 flavours, and the sodas split 12/12.
- **Approximate.** Each of these is named "(build — approximate)":
  - Caprese.
  - Chicken Bacon Caesar Sub (Ever Roast Chicken 4 oz plus 2 bacon on the Turkey Caesar build).
  - Chicken Bacon Pesto Pasta.
  - Fruity Pebble Cannoli; "Cannolis" is 2× the single.
  - Garlic Bread.
  - Bacon Caesar Pasta Salad, as an 8 oz unit.
  - House Greek, 64 oz.
  - Caesar Salad.
  - Cheesy Boi filling.
  - 24 Mixed Sodas.
- **Three Footer.** This is not a recipe. It is the 4.5 whole-sub portion on the pick: 36 in ÷ an assumed 8 in regular sub. It uses 4.5 sub rolls, though the real thing is one 3-ft Cardinal roll. Approximate; listed for Juan.
- **Not built:**
  - Summer Fling (retired, per Juan).
  - Kid's (only ever an open item).
  - Staffer Combo (its contents arrive as picks).
- **Retail with no SKU** (still mapped, still no recipe): Whisked cookie, Berger 2pk and Large, Olivia's cinnamon rolls, Topo Chico, Red Bull ×2.

## 3. Assumptions

- **Pickles:** a quart = 3 pickles; that was already the live recipe.
- **Cholula:** = HP Mayo (already mapped; only the portion was missing).
- **Ever Roast Chicken** stands in for "chicken breast".
- **Full Lunch** stays on its package: 1 sub, as an even mix over 15 subs until spec B. The packages carry no water or chips lines.
- **Left unmapped on purpose:**
  - "Bag of Chips" base: its flavour child carries the bag.
  - "Sandwich" / "Drink": group markers.
- **Not mapped:**
  - Open-item text (Chips, Bread, Ripples, Kid S, GF, Catering…), ezCater codes, "16/32 Pieces".
  - Stuffed Peppers and Roasted Red Peppers (no recipe).
  - The `tg-*` guids: **14 test-fixture rows sitting in the prod sales ledger**. Consider a purge migration.

## 4. Juan to confirm (short)

1. **Weights:** weigh **one whole pickle** and **one District Bakery GF roll**, fill the two parameters and re-run. Also add the GF roll's **price**.
2. **Approximate builds** (the list in §2). Is Bacon Caesar Pasta Salad an 8 oz base with Medium = 16 oz?
3. **Three Footer:** is 4.5 regular subs right (36 in ÷ 8 in)? Is a regular sub really 8 in?
4. **Portions:** Add Bacon 2.5 slices; Put Chips 1 handful = 2.2 oz.
5. **Lunch packages:** add water and mini-chips lines?
6. **Caprese:** is "Tomato & Mozz" the same sandwich?
7. **GF bread:** is the "Sarah" GF bread SKU the same as the District Bakery roll (retire it)?

## 5. Code-change specs (for the cutover builder)

### A. Multi-effect modifiers: swap and parent-only removal

**Data.** New table `toast_map_effects`:
- Columns: `id`, `map_id → toast_menu_map`, `ordinal`, one of `item_id | sku_id | menu_item_id` (num_nonnulls = 1), `disposition deplete|remove`, `portion_qty`, `portion_unit`, `active`, `created_at`, `created_by`.
- Deny-all RLS (0146 pattern).
- Add **`toast_menu_map.parent_only boolean default false`** so the **primary** effect can carry the same semantics. The primary map row is effect #0. The unique index and entity XOR are untouched.

**Code.** In `deriveSalesConsumption`:
1. Load the effects for the map rows in **one** query. Build `effectsByGuid` = [primary, …effects].
2. Extract today's per-target modifier body into `applyModifierEffect(...)` and loop over the effects.
3. **Parent-only removal:**
   - Item targets: `removalAmount(graph, parent, item)`.
   - SKU targets: `perUnitDirectSkuOzForMenuItem(graph, parent).get(sku)`.
   - If the parent lacks the target, contribute **0**. There is no portion fallback when `parent_only`.
   - This applies to the **primary as well as** the extra effects.
4. Give SKU removes the parent-aware amount (with fallback when not parent_only).

**Data rules for the seed.** Each cheese appears **once** across primary + effects. Example, No Cheese:
- primary = remove Provolone, parent_only;
- effects = remove Fresh Mozzarella, Cheddar, Shredded Mozzarella, all parent_only.

**Tests** (pure, in `modifiers-shared`):
- **Mixed parents, same day.** One No Cheese on a provolone sub, one on a mozz sub, one on a no-cheese parent. Each removes only its own parent's cheese. The day's item totals never take another sale's cheese.
- A swap on a parent with no Sub Roll removes nothing.

**Then flip:**
- GF swap: primary = deplete the GF roll 1 each; effect = remove Sub Roll 1 each, parent_only. This covers the 11 staged GF rows.
- No Mayo and No Peppers as parent-only multi-target removes (the 6 staged rows).
- Add No Cheese.

### B. Named picks under a package replace the choice spread

**Code.** In the platter lane of `deriveSalesConsumption`:
1. Collect the picks of each package sale. These are modifier lines whose map row targets a menu_item and whose parent selection is that sale.
2. **Bind each pick to one choice slot:** the choice line whose pool (`catering_package_slot_options`) contains the pick's menu_item. Ties go to the first slot by `display_order`. A pick that is in no slot's pool stays in the modifier lane, as today.
3. Per slot, `cap = line.depletionQty × sale.qty`. Picks fill the slot in ledger order: each adds `min(pickQty, remaining)` whole subs (scaled by `line.depletionQty / line.quantity` when they differ). **Excess picks beyond the cap are dropped** and reported in a new `packageIssues` code, `excess_picks`.
4. Even-mix only `remaining` over the assortment pool.
5. Mark the consumed picks so the modifier lane skips them.

**Data.** New column `catering_package_items.depletion_qty numeric null` (CHECK > 0). Depletion reads `coalesce(depletion_qty, quantity)`. It is **separate from `quantity`**, which the customer portal uses as `pickN` and the package pricing uses. Then set:
- Light Lunch depletion_qty = **0.5** (Juan); map the Light Lunch base to its package.
- Three Footer depletion_qty = **4.5** (approximate) if the Three Footer base ever moves to the package. In that case retire the seed-43 "3 foot …" 4.5 pick rows in the same change.

**Tests:**
- Two choice slots in one package, with picks for each.
- Excess picks beyond the cap.
- Picks plus an assortment marker.
- No picks (today's behaviour, byte-identical).

**Then:** flip the 7 staged lunch picks to `deplete` with `portion_qty` NULL.

### C. Dual-role guids

In `deriveSalesConsumption`, add two fallbacks:
- **Base line misses `entityByGuid`, but the guid has a modifier row** (item or sku, deplete). Apply it as a parentless modifier application (`portion × qty`). This covers tomato (~80 in the window), pickles, hot peppers, cheddar and cucumbers.
- **Modifier line misses `modifierByGuid`, but the guid has a base row** (menu_item or item). Add 1 unit. This covers Coca-Cola / Diet Coke / Dr. Brown's under bundles.

Put the decision in a pure helper (`resolveLineTarget`) for vitest.

### D. Open-item alias table (none exists)

**Background.** Typed items share one guid per shop: `2c3c26f1-87ef-4d86-b760-67c96ddd2ca2` at EM and `398bbb87-223f-414c-a2b1-960edaf3fa6b` at MEP.

**Data.**
- New table `toast_open_item_aliases`:
  - Columns: `id`, `location_id` (NULL = every shop), `normalized_text`, one of `menu_item_id | item_id`, `qty_multiplier default 1`, `active`, `created_at`, `created_by`.
  - UNIQUE (`coalesce(location_id, nil-uuid)`, `normalized_text`) WHERE active.
  - Deny-all RLS.
- Allow `disposition = 'open_item'` with no entity, to mark the shared guid. This extends both CHECKs (0155 shape).

**Code.** For a base line on an open-item guid:
1. Normalize the text: lowercase; trim and collapse spaces; strip punctuation; drop a trailing "s"; apply a misspelling map (chioz→chips, crewm→cream, proscuitto→prosciutto, cstering→catering).
2. Look up the alias. A miss stays unmapped and visible.
3. Skip-list:
   - `^[0-9a-z]{3}-[0-9a-z]{3}$` → ezCater codes.
   - `^cater` and date-only lines → catering.
   - These are not counted as unmapped. A separate ezCater build covers their contents.

**Seed aliases:**

| Normalized text | Target |
|---|---|
| chip / chips / bag of chips / big chip(s) / bigchips / big bag / big utz / large chip / chips xl / chioz | Utz Original Chips |
| ripple(s) | Put Chips In It (add-on) |
| mini chip(s) | Mini Chips |
| utz salt & pepper chips | Salt & Pepper Chips |
| bread | a new Extra Sub Roll add-on |
| gf / gluten free / sub district bread gluten free roll | GF Roll |
| hp mayo | an HP Mayo add-on |
| chx cutlet / chicken cutlet / chix | The chicken cutlet |
| cream soda / crewm soda | Dr. Brown's Cream Soda |
| kid s / kids | Kid's (needs a build first) |

### E. (Optional) Size modifiers that select a package

"16/32 Pieces" under the EM bases "The Classics" / "Our Favorites" (3 sales). Low value.

## 6. ezCater: what is already stored (shape only)

- **`ezcater_events`** (157 rows) holds webhook notifications only. `raw` keys are `entity_id, entity_type, id, key, occurred_at, parent_id, parent_type`. There are **no line items**.
- **Line items are already fetched at intake** by `lib/ezcater/orders.ts` (GraphQL `orderByID`): `catererCart.orderItems { name, uuid, quantity, posItemId, menuItemSizeId, totalInSubunits, noteToCaterer, specialInstructions, customizations{…} }`.
  - They are kept only as free-text bullets in `catering_pipeline.notes`. All 66 leads have them.
  - **`posItemId` is the likely join key to `toast_menu_map`.**
- **`toast_catering_orders.items`** is a JSON array of `{name, priceCents, quantity, voided}`. These are Toast line names: the 19 rows classed ezCater hold the order-code open items, not the contents.
- **Recommended follow-up:**
  1. Persist the normalized `orderItems` to an `ezcater_order_items` table.
  2. Resolve them through the crosswalk.
  3. Add them as their own catering depletion lane, separate from Toast (double-count law).

## 7. Expected depletion-coverage change (revision 2, against the `out.json` audit window)

| Shop | Unmapped before | Unmapped after (est.) | Depleting today (est.) | Staged (est.) |
|---|---|---|---|---|
| **EM** | 2018 | **~220 (−89%)** | ~1590 | ~185 |
| **MEP** | 1471 | **~335 (−77%)** | ~900 | ~240 |

**What stays unmapped at EM:**
- No Cheese, 118.
- Open items and ezCater codes.
- The dual-role tomato, pickles, hot peppers and cheddar (~38).
- Olivia's, "16/32 Pieces", and the Three Footer base (2).

**What stays unmapped at MEP:**
- Light Lunch base, 97.
- No Cheese, 62.
- Coca-Cola and Diet Coke picks, 79.
- Open-item GF / Kid / S&P.
- Bag of Chips, the Staffer base, and a tail of ~24.

**Depleting today at EM:**
- ~440 base: the GF base line is excluded while poisoned, and the Three Footer base is excluded.
- ~1,150 modifiers.

**Depleting today at MEP:**
- ~260 base.
- ~640 modifiers.

**Staged:**
- EM: GF 178, No Mayo 6, No Peppers 1.
- MEP: GF 80, No Mayo 16, the 141 lunch picks (until spec B).

**Portion-needed** (Pepperoncini, Dijon, Cholula): 318 → 0 at EM and 112 → 0 at MEP. GF no longer lands in this advisory because it is staged.

**Poisoned items** until the weights are filled: Deli Pickle, Quart of Pickle Spears, and the GF add-on.

## 8. Revision 2 changes

| # | Ruling | Change |
|---|---|---|
| 1 | P1, CC ruling 1 | **No Cheese removed** from the seed. **No Mayo / No Peppers staged** (parent-varying targets). Spec A now gives the **primary** effect parent-only semantics, lists each cheese once, and adds the mixed-parent same-day test. |
| 2 | P2, ruling 2 | **GF swap modifiers staged.** The GF bread sold as its own line still maps. |
| 3 | P2, ruling 3 | **Spec B** binds picks to a choice slot, caps them at `depletion_qty × sale.qty`, reports excess picks, and adds tests for multiple slots and excess picks. |
| 4 | P2, ruling 4 | **"Medium (16oz)"** is limited to the Bacon Caesar Pasta Salad parent. The roasted-red-peppers guid (`c5b99dac…`) stays unmapped. |
| 5 | P3, ruling 5 | **One `toast_map.unmap` audit row per deactivated row** in G5 and G6. G6 now inserts first, then supersedes its non-confirmed rivals. |
| 6 | Juan, ruling 6 | Side Marinara = **4 oz**. **Large FOD 16 oz** item added unmapped, because Toast has one Large button (mapped to 32 oz). **Light Lunch = 0.5** is not writable without breaking the portal (`pickN`), so its base stays unmapped and spec B adds `depletion_qty`. **Three Footer = 4.5 subs (approximate)** on the "3 foot …" pick, with the base unmapped. Summer Fling skipped. |
