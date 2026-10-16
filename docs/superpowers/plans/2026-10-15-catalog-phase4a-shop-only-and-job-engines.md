# Catalog Redesign — Phase 4 (Guided Jobs: New Item, New Sandwich + Toast, Swap Vendor; Shop-Only Things) Implementation Plan

## Part 4a of 2 — the ownership law, the three job engines, sharing, the routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three guided jobs of spec §5 that Phase 4 owns — **New item, start to finish** (job 2), **Swap vendor** (job 3) and **New sandwich with its Toast link** (job 4) — as server engines with one atomic write each, and the rule that makes them safe: **new things a GM creates start shop-only; MoO+ shares them with every shop** (spec §3; lead decision 6 deferred GM-created shop-only recipes to this phase). Phase 4a also **drops the pre-3a 16-argument `update_recipe_input_atomic`** (3a kept it only for code deployed before 3a) — in its OWN migration, **0266**, applied only after the production deploy that serves the 4a code is READY and every older deployment has drained (Astra round 1; Task 15 Steps 9–10 say why that is the safer of the two options). Prove first that with no shop-only rows every number is byte-identical to the Phase 3 goldens. Part 4b (`docs/superpowers/plans/2026-10-15-catalog-phase4b-guided-job-pages.md`) builds the three job pages, the Toast-link section that moves the menu item's Toast link out of Catering, the "only at this shop" banners and **Share with every shop**, en + es.

**Architecture:**
- **Ownership is a column, in the house idiom.** `recipes.location_id` and `menu_items.location_id` (0264), NULL = every shop, set = only that shop — beside the existing `vendor_items.location_id` (0095, a shop-owned SKU; 2a's owner rule) and `items.location_id` (0079). Vendors stay global (they have no shop column; a "local vendor" is a global vendor row whose items are shop-owned).
- **What may be shop-only (lead decisions, 2026-10-15):** a bought item (any SKU, as today), a prep item (`items.location_id` — the checklist templates already make shop items), a **prep recipe** and a **sandwich** (a menu item plus its recipe). A shop-owned recipe makes ONLY items and menu items owned by the same shop, and its lines use only shared things or that shop's own; a shared recipe never makes a shop-owned menu item. So nothing another shop's graph reads is another shop's own. **A GM keeps creating recipes — as its shop's own** (lead decision 1; Juan: GMs need the permissions to finish their job at their shops); creating anything for every shop is MoO+.
- **Lead decisions folded in (2026-10-15):** (1) GM-created prep recipes are shop-only; (2) a shop-only SKU or item appears ONLY at its owning shop — the ordering walk, the par pass, counts and a shop's view of a vendor's guide filter at their one read point (Task 5b); (3) a "Just for now" swap never switches the old item off, and Back to normal restores exactly (no par is written; the grouping it made is undone); (4) product primaries stay undated (the existing law: recipes and product resolution stay current) — re-running a past day after a swap resolves product-PINNED lines through today's primary; (5) catering quote pickers list only menu items visible at the quote's shop (Task 5b); (6) the Catering Toast tab stays as it is.
- **Decisions sent with Astra round 1 (2026-10-15):** (a) a SHOP VERSION of a SHARED recipe names only shared things or that shop's own — another shop's own SKU or item is refused `line_other_shop`, in the lib (`writeRecipeVersion`) AND in SQL (0264's `recipe_version_lines_owner_law`); (b) the vendor's guide editor labels a shop's own lines "Only at <shop>" (en/es; 4b); (c) store copies leaving other shops' count sheets is correct — gated by a PRE-MERGE prod count (Task 15 Step 1b): any nonzero count in the last 30 days of a shop's own SKU at ANOTHER shop PAUSES the merge for Juan.
- **Astra round 1 (4a: 1 P1 + 7 P2; 4b: 10 P2), folded in:** every write whose right comes from OWNING the thing carries that owner into the write itself and refuses `ownership_changed` (en/es) — `save_owned_recipe_version` (0264) compare-and-sets the recipe's owner under the graph lock, the menu price and the SKU writers carry `location_id` in their UPDATE predicate (Task 6 Step 5b lists every such writer); product resolution never picks another shop's own SKU at any rung (`loadProductIndex`, Task 5b); readiness, the weights board and Toast read a shop's own prep recipe in its owner's graph (Task 5); the swap re-enumerates its recipes under the graph lock (`swap:recipes_changed`), previews and binds the primary it sets, and Back to normal locks before it compares (0265); `create_catalog_sku` serializes one vendor item number; the swap preview hands back the exact request it hashed; every route body is a plain object literal for `jsonOk`; the old writer's drop is its own migration (0266) behind a deploy gate.
- **The law lives in the database** (0264): deferred constraint triggers check, at COMMIT, that a shop-owned recipe makes and uses only its own shop's things or shared ones (and that a shared recipe never makes a shop's sandwich); before-insert triggers refuse a shop recipe version or a shop menu overlay of an owned thing (it has no default to differ from — its owner edits the thing itself), and a Toast link of an owned menu item at another shop; the owner is set at creation and only ever cleared (sharing), never moved.
- **Visible only to its owner — at the ONE resolver point.** `loadRecipeGraph` reads the recipes visible to its version scope (`location_id is null or = scope`); `loadResolvedRecipeInputs` drops lines of recipes owned by another shop; the costing board, the Toast matcher pool and the catalog list read menu items the same way (`ownerVisible`). "Used anywhere" readers (`loadRecipeInputsAcrossScopes`) keep every shop's things. With no owned rows, every query returns the same rows: the Phase 3 goldens hold byte for byte (Task 1). Readiness reads the same universe (a shop's own recipe and the items it makes are absent elsewhere, never "incomplete"); the weights board and Toast cost and portion a shop's own prep item in its owner's graph (Task 5). Beyond the graph, a shop-only SKU appears only at its owning shop in the ordering walk, the par pass, counts and a shop's view of its vendor's guide — and **product resolution never picks another shop's own SKU at any rung** (`loadProductIndex` member eligibility, so the walk's rescue falls through to a shared member) — and catering quote pickers list only menu items visible at the quote's shop (Task 5b).
- **Editing an owned thing:** its owner's GM edits the recipe's own lines (the global head of a recipe nobody else sees) and the menu item's own price — `ownedAwareRecipeGate` + `ownerWriteCheck`; MoO+ any. **The right is bound to the owner it was granted for** (Astra r1 P1): the recipe save goes through `save_owned_recipe_version` (the owner compared under the graph lock — sharing takes the same lock), the price UPDATE carries `location_id`, and a share landing in between refuses `ownership_changed`. The 3b recipe page serves an owned recipe in its default view with the owner allowed to edit.
- **The three engines, one atomic write each:**
  - **New item** → `create_catalog_sku` (0264): the SKU row (owned by the GM's shop; global only for MoO+), its first pack version (2a `save_sku_pack_version`, first-only below MoO) and its first price (2a `save_sku_global_price`) in ONE transaction. The shop setup that follows (par, order days, order-guide line, used-in recipe lines, barcode) is a list of independent steps through the existing writers, each saved and reported on its own; an item missing a step shows it in 2b's "What's missing".
  - **New sandwich** → `create_shop_sandwich` (0264): the menu item (owned, its price), the recipe (owned, through 0262's `create_recipe_full`), under the graph lock, in ONE transaction. The live cost per sandwich is computed from the shop's graph with the draft lines as a preview override (3a's `recipeOverrides`). The Toast link is one confirmed mapping through `manualMap` (Tier A, the mapping's own tier).
  - **Swap vendor** → `start_sku_swap` / `end_sku_swap` (0265): the shop's (or, MoO+ "for good everywhere", the default's) recipe versions that named the old SKU now name the replacement — every recipe in ONE transaction, each bound to the preview's dependency snapshot, the SET re-enumerated under the graph lock (a recipe that started using the old item after the preview refuses `recipes_changed`) — plus the product grouping and the product primary for that scope (the preview costs the proposed primary through the one resolver, and the recipes that follow it are bound too); **Back to normal** retires the swap's versions still in force, restores the primary and undoes the product grouping the swap made — atomically and exactly. A swap never switches the old item off and never writes a par (lead decision 3).
- **Sharing** → `share_shop_owned_menu_item` (the menu item, every recipe making it, and — named explicitly — the shop-only SKUs those recipes use), `share_shop_owned_recipe` (a prep recipe with the shop-only items it makes and the shop-only SKUs it uses) and `share_shop_owned_sku`, MoO+, one transaction each. A recipe that consumes another of the shop's own items waits until that item's recipe is shared (`uses_shop_only_item`).

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres 17 (service role, SECURITY DEFINER RPCs, deferred constraint triggers), vitest 4, PGlite (`@electric-sql/pglite`, already a dev dependency since 3a), tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §2 (permissions), §3 (line 45: "New things a GM creates start shop-only … MoO+ can promote them to global"), §5 jobs 2–4 (lines 80–82), §7 Phase 4 (line 105), §8 (testing).

**Builds on (all merged first, their migrations applied):**
- **Phase 1** (merged @ 2e59def7; 0257 + 0258): Tier E; the graph lock `7258025800`; `IngredientPicker`, `RecipeLineEditor`.
- **Phase 2a** (merged @ 4955da7f; 0259 + 0260): pack versions, price lanes, `save_sku_pack_version(…, p_first_only)`, `save_sku_global_price(…, p_first_only)`, `catalogShopAllowed`, `skuOwnerAllowed`, `catalogWriteRoleAllowed`, `loadCurrentSkuPrices(ids, scope)`.
- **Phase 2b** (`feat/catalog-p2b`, 0261; worktree `C:\Users\conta\co-ops-cat-p2b` @ d4399c77): the item page `/admin/catalog/sku/[id]`, `skuItemHref`, `ItemJob`, `createRequestGuard`, `previewToken`, `sentenceFromLevels` / `levelsFromSentence`.
- **Phase 3a / 3b** (plans committed on main @ ebca0ac2; 0262 + 0263): recipe versions + journal, `save_recipe_version(…, p_snapshot)`, `retire_recipe_version`, `recipe_change_snapshot` / `recipe_change_lock`, the 17-argument `update_recipe_input_atomic(…, p_actor)`, `loadRecipeGraph({ …, recipeOverrides })`, `loadResolvedRecipeInputs`, `loadRecipeInputsAcrossScopes`, `writeRecipeVersion` / `saveRecipeLines` / `loadRecipeLiveSet` / `loadRecipeChangeSnapshot` (`lib/admin/recipe-versions.ts`), the menu overlay (`menu_item_shop_settings`, `resolveMenuItemForShop`, `applyMenuOverlayToEntities`), the recipe and menu-item pages (`lib/catalog/recipe-item.ts`, `components/catalog/RecipeItemClient.tsx`, `MenuItemClient.tsx`), the PGlite fixture `tests/fixtures/recipe-versions-pglite.ts`, the equivalence harness `tests/fixtures/recipe-versions-harness.ts`.

**Working copy:** `C:\Users\conta\co-ops-guides` (or the build worktree CC assigns). Branch once Phase 3b is on `origin/main`:

```bash
git fetch origin && git checkout -b feat/catalog-phase4a-shop-only-jobs origin/main
ls supabase/migrations | tail -4
```

Expected: `0262_recipe_shop_versions.sql` and `0263_menu_item_shop_settings.sql` are present and 0264–0266 are free. **If 0264, 0265 or 0266 is taken, renumber this plan's three migrations to the next free numbers, then rename every `0264`/`0265`/`0266` literal in this plan's files and tests first.** The pin tests assert the file names.

**Standing rules for every task:**
- Read `AGENTS.md` first — the law-book (its "Shop versions" sections came with 2a and 3a). Closed audit vocabulary, location bind inside the lib, deny-all RLS with a service-role privilege ceiling, the batch-loader law, en + es in the same PR, tú Spanish.
- Sim only (`node scripts/sim/dev-sim.mjs`, http://localhost:3100). Production is touched only by the gated apply runbook (Task 15).
- **Do not apply any migration** outside Task 15.
- Every commit message ends with the two trailer lines shown in each commit step.
- The equivalence pins stay green after every later task: `npx vitest run tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts`.

---

## Ground truth this plan is built on (verified 2026-10-15 against `origin/main` @ ebca0ac2 merged into `feat/catalog-p2b` @ d4399c77, plus the Phase 3 plans' contracts)

| Fact | Where |
|---|---|
| Spec Phase 4 = "Guided jobs: new item, swap vendor, new sandwich with Toast". Job 2: what it is → vendor (pick, or add one with its order days inline) → name + vendor item number → how it arrives → price → par + order days for my shop → order-guide section → optionally where it's used; barcode now or at first delivery. Job 3: replacement → "Just for now at my shop" / "For good"; one product; every recipe switched in one go; preview shows cost changes; "Back to normal". Job 4: name → price for my shop → recipe (searchable picker; oz / each / slices; live cost per sandwich) → Toast link (suggest; confirm or pick from a searchable list); "Toast linking moves out of Catering". Every job "ends with the same preview and save choices". | `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md:76-82, 105` |
| "New things a GM creates start shop-only (e.g., a SKU from a local vendor); MoO+ can promote them to global." | spec `:45` |
| `vendor_items.location_id` (NULL = global, set = a shop-owned SKU; store copies 0216). `createSku(actor, CreateSkuInput)` — `requireLevel(SKU_WRITE_MIN = 7)`, binds a non-null `locationId` with `lockLocationContext`, **a GM may create a GLOBAL SKU today** (`locationId: null`), inserts the row, audits `vendor_item.create`. `updateSku` may change `locationId` at GM+. The legacy create route adds the chain AFTER the insert and deactivates the SKU when the chain fails (not atomic). | `lib/admin/skus.ts:55-56, 536-626`; `app/api/admin/skus/route.ts:101-135` |
| `items.location_id` exists (0079) and ALREADY means a shop's own item: a checklist template creates its prep items with `location_id = the template's shop` (`lib/admin/templates.ts:1065-1068`), and `promoteItemToGlobal` (MoO+ at its route) clears it (`:1621-1646`). The Toast matcher's item lane and the catalog list read `.is("location_id", null)`. `recipes` and `menu_items` have **no** owner column. `menu_items` carries `catering_available` (the menu price writer refuses `null` price when it is on). | `supabase/migrations/0079_item_registry_foundation.sql:6-24`; `lib/admin/toast-map.ts:108-123`; `lib/admin/menu-prices.ts:20-27` |
| `createRecipe` (direct insert) and `createRecipeFull` (`create_recipe_full` RPC) and `createMenuItem` are **GM+** (`RECIPE_WRITE_MIN = 7`; a typed menu price needs `MENU_PRICE_MIN = 8`). 3b keeps creation at GM+ "until Phase 4's New sandwich job". | `lib/recipes.ts:321-337, 403-460, 517-534`; `lib/recipes-shared.ts:12-15`; 3b plan `:4878` |
| Shop-scoped read points for SKUs: the counts roster `createCountsReadRefs(shopScope).roster` reads every active SKU (`lib/counts-read-refs.ts:59-72`); the ordering walk reads every SKU with a global par (`lib/ordering.ts:650-651, 686-693`, `WALKER_SKU_COLUMNS`); the par pass re-reads the submitted SKUs (`:1437-1492`, `submitParPass(actor, locationId, lines)`); purchase orders are made from par-pass lines (`lib/purchase-orders.ts`); `guideKeysFor` only ORDERS SKUs already chosen (`lib/order-guides.ts:82`); `loadOrderGuide(vendorId)` is the vendor page's whole sheet (`:58`). Store copies (0216) are shop-owned SKUs and today appear at every shop. | as named |
| Catering quotes: `loadCateringPackagesForQuote(actor, locationId)` (`lib/catering/menu.ts:153-215`) and `loadPublicCateringPackages(locationId)` (`lib/portal/menu.ts:131-215`) resolve package lines' and slot options' menu items by id, unfiltered; à-la-carte lists read `catering_available = true` (an owned menu item never is — 0264). | as named |
| The legacy create routes: `POST /api/admin/recipes` → `createRecipe`, `POST /api/admin/recipes/full` → `createRecipeFull`, `POST /api/admin/menu-items` → `createMenuItem`; `RecipeBuilder` posts the whole draft to `/recipes/full` (`components/admin/recipes/RecipeBuilder.tsx:284`). | `app/api/admin/recipes/route.ts:10-35`; `app/api/admin/recipes/full/route.ts`; `app/api/admin/menu-items/route.ts:19` |
| `create_recipe_full(p_header, p_inputs, p_outputs, p_created_by) returns uuid` takes the graph lock FIRST (0258), checks item-output producers + batch mode + shelf life, inserts header / inputs / outputs, refuses `would_create_cycle`; re-emitted by 0262 (additions only). Menu-item outputs take no producer lock. | `supabase/migrations/0258_recipe_input_write_atomic.sql:226-315`; 3a plan Task 3 |
| 0262's journal: `recipes_journal` is a deferred constraint trigger **after insert** on `recipes` only (a later `update recipes set location_id` journals nothing); `recipe_inputs_journal` after insert/update/delete. | 3a plan `:1857-1881` |
| 0262 writers: `save_recipe_version(p_recipe, p_location, p_lines, p_expected, p_based_on, p_note, p_actor, p_restored_from, p_adopted_from, p_promoted_from, p_snapshot) returns jsonb {version_id, retired_version_id, changed_shops, …}`; `retire_recipe_version(p_version, p_location, p_actor, p_snapshot)`; `recipe_change_snapshot(p_recipe, p_location, p_lines) returns jsonb` (service_role EXECUTE); `recipe_change_lock(uuid, uuid, jsonb)` (helper — no role EXECUTE; callable from a definer function). Lock order: graph lock → the recipe row → the closure (NOWAIT) → the snapshot re-check. **No SQL role check** — permissions are the lib's. Refusals are `P0001 'recipe_version:<code>'`. | 3a plan `:2241-2275, 2522-2577, 2109, 2640-2700` |
| 0262 keeps the 16-argument `update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)` "only for code deployed before 3a", and adds the 17-argument overload `(…, p_actor uuid)` with the same service_role-only ceiling; 3a Task 9 Step 2b switches `updateRecipeInput` to the overload. "**Dropped by the first Phase 4 migration** — do not add a caller to it." | 3a plan `:1355-1359, 2659-2665, 6308-6325, 6737` |
| 0263: `menu_item_shop_settings (menu_item_id, location_id NOT NULL, price, sold_here, name_override(_es), active, valid_from, valid_to, …)`; writers `save_menu_item_shop_setting`, `retire_menu_item_shop_setting`, `promote_menu_item_shop_setting`. | 3a plan `:3285-3315, 3365-3485` |
| 3a's resolver: `loadRecipeGraph(opts?: { locationId?, versionLocationId?, asOf?, recipeOverrides? })` — `versionScope = versionLocationId ?? locationId`; reads `recipes` (active, ordered `created_at nulls first, id`), `recipe_inputs`, `recipe_outputs`; `loadRecipeLineOverlay(versionScope, asOf)`; **override lines' SKUs and products are loaded too** (`lineRows` = base ∪ replacements ∪ overrides). `loadResolvedRecipeInputs(scope, asOf)` merges `recipe_inputs` with the overlay (no recipe filter); `loadRecipeInputsAcrossScopes()` = every scope. | `lib/prep-consumption.ts:336-380` (main); 3a plan `:3886-3970, 4728-4800` |
| The graph builder indexes producers only from the `recipes` rows it is given — an excluded recipe's inputs and outputs are never part of the graph. | `lib/prep-consumption-graph.ts:501-516`; `lib/prep-consumption.ts:430` |
| Global-graph callers: `lib/admin/catalog.ts:183` (`loadCatalogView`), `lib/admin/toast-map.ts:249, 602` (modifier portions — item entities only), `lib/weights.ts:301`. | grep `loadRecipeGraph()` |
| The costing board reads every active `menu_items` row (3a: through the shop overlay in a shop view). | `lib/admin/menu-costing.ts:123-149`; 3a plan `:4254-4300` |
| Toast: `loadEntities(all, locationId)` (3a) builds the matcher pool from every active menu item; `listMappableEntities` returns `MappableEntity { id, name, kind, locationId }` — "Items/menu_items/SKUs are global (null)"; `manualMap(actor, { locationId, toastItemGuid, toastItemName, entityKind, entityId, isModifier })` supersedes rivals and inserts a confirmed row; `requireLocationGuid` (private) → `fetchToastMenuItems(guid)`; `matchCandidates(entities, toastItems)` with `MATCH_THRESHOLD = 0.8`. `TOAST_MAP_MIN = 7`; the manual route is **Tier A**. | `lib/admin/toast-map.ts:32, 108-123, 185-194, 199-280, 506-640, 645-670`; `lib/toast/matcher.ts:18-36, 91`; `app/api/admin/toast-map/manual/route.ts:12-20` |
| `menu_items.menu_price` writer `updateMenuPrice(actor, id, value, expected)` — MoO+ (`MENU_PRICE_WRITE_MIN = 8`) before any I/O, compare-and-set, audit `menu_item.update`. | `lib/admin/menu-prices.ts:8-37` |
| Products: `products (name unique among active by lower(name), name_es, notes, unit_oz, active, created_by, updated_by)`; `vendor_items.product_id` (NULL = singleton) with `unique (id, product_id)`; `product_primaries (product_id, location_id NULL = global, primary_sku_id, note, updated_by)` `unique nulls not distinct (product_id, location_id)` and the composite FK `(primary_sku_id, product_id) → vendor_items(id, product_id)`. `setPrimary` = update-or-insert + audit `product.primary_set`; `attachMember` refuses `already_member` / `primary_must_be_reassigned`. Product resolution rung 1 = the primary, rung 2 = most-recently received active member. | `supabase/migrations/0179_product_identity.sql:100-178`; `lib/products.ts:1043-1080, 1204-1240, 1321-1385` |
| `upsertLocationSkuSettings(actor, { locationId, skuId, activeOverride, weekdayPar, weekendPar, expected? })` — SKU_WRITE_MIN, bind before validation, the par machine lane through `parWriteColumns`. | `lib/admin/skus.ts:1179-1300` |
| `setVendorRhythmPair(actor, { vendorId, locationId, orderDow, leadDays })` — `RHYTHM_APPEND_MIN = 6`, `assertLocationAuthored`. | `lib/vendor-rhythm.ts:41-42, 357-420` |
| Order guides are per VENDOR: `loadOrderGuide(vendorId)`, `createEmptyGuide(actor, vendorId)`, `saveOrderGuide(actor, vendorId, next, expectedUpdatedAt)`, `applyGuideEdit(model, { kind: "add_line", sectionId, skuId, label, itemNumber } | { kind: "add_section", name })`; the floor `ORDER_GUIDE_EDIT_MIN = 7` is checked at the ROUTE, not in the lib. | `lib/order-guides.ts:58, 95-130, 192-222`; `lib/order-guides-shared.ts:17-31, 72` |
| `teachBarcode(actor, { vendorId, locationId, code, skuId, level: "case" | "inner", … })` — binds the shop and the receiving assignment; the SKU's vendor must equal `vendorId`. | `lib/barcodes.ts:105-110, 183-260`; `lib/barcodes-shared.ts:16-17` |
| `createVendor(actor, { name, categoryIds ≥1, orderTypeIds ≥1, paymentTerms?, accountNumber?, notes?, firstContact, firstOrdering })` — GM+. Vendors have no shop column. | `lib/admin/vendors.ts:808-830` |
| 2a pack validation: `validateSubmission(levels, measureLabels, measures, avgOzPerEach, skuClass)` + `loadMeasureLabels()` / `loadMeasuresMap()` (`lib/admin/pack-chain.ts:91-200`); `rpcLevels(levels)` (`lib/admin/sku-versions.ts:110-117`); `saveSkuPrice` rules: `unitPrice > 0`, `YYYY-MM-DD` (`:227-232`). The global flat mirror (`sku_flat_mirror_apply`) rewrites `pack_format` / `units_per_pack` / `each_*` from the root of a GLOBAL chain inside `save_sku_pack_version`. | `supabase/migrations/0259_sku_shop_versions.sql:373-418, 421-440, 676-700` |
| The 3b recipe page serves `?location=<shop>|global`, picks the editing target from `view.can.editShop` / `view.can.editGlobal`; `gateFor(actor, scope)` wraps `recipeVersionWriteGate`; `computeRecipePreview` reaches `[null, …shops riding the default]` for a global target. The menu-item page view counts confirmed Toast links. | 3b plan `:1697-1699, 1719-1818, 1820-1900, 2067-2110, 3660-3670, 4027-4059` |
| 3a's equivalence harness `computeRecipeOutputs(api, tables, shopIds, days)` and fixture `buildRecipeVersionsFixture()` (2a's fixture: `LOC` "Shop one", `OTHER` "Shop two"; `s-turkey` chained case→bag→oz; `s-pickle` "jar" 32 oz flat; recipes `r-slaw`, `r-italian` → `m-italian`, `r-pickle` → `m-pickle-side`). | 3a plan `:150-300`; `tests/fixtures/shop-versions-fixture.ts:31-170` |
| The in-memory PostgREST stand-in: `is(col, v)` compares `(value ?? null) === v` (a row without the column reads as NULL); `or(is.null|eq)`; no `rpc`, no `update`. | `tests/fixtures/counts-fake-db.ts:71-200` |
| Tier maps: `SERVER_TIER_MAP` / `CLIENT_TIER_MAP` in `tests/step-up-tier-map.test.ts:84, 233`; the bind differential's `TENANCY_SCOPED_TABLES`, `TENANCY_SCOPED_RPCS`, `FILES` in `tests/location-bind-differential.test.ts`; the closed vocabulary in `lib/audit-actions.ts` + `lib/destructive-actions.ts`. | as named |
| **(Astra r1)** Product resolution: `loadProductIndex(productIds, locationId, shared: ProductIndexSharedReads = {})` builds each member's `active` from the overlay AND an ownership rule that today applies to STORE members only (`source_kind !== "store" || locationId == null || m.location_id == null || m.location_id === locationId`) — a shop-owned REGULAR-vendor member is eligible at every shop, and `tests/products-store-loader.test.ts` pins that ("resolves regular members … scoped to another shop as before"). The walk's rescue picks among `entry.members` with `m.active` (`lib/ordering.ts:1123-1129`). `ProductIndexSharedReads { vendors?, measures?, packChains? }`. `resolveProductMember` rungs ①–③ choose only among `active` members. | `lib/products.ts:448-452, 595-800`; `lib/products-shared.ts:158-193`; `lib/ordering.ts:1103-1135` |
| **(Astra r1)** `setPrimary` is read-then-write with no lock: it reads the scope's `product_primaries` row, then `update … where id = row.id` (or inserts). | `lib/products.ts:1321-1385` |
| **(Astra r1)** Readiness after 3a: `loadGraphRows(scope)` reads EVERY active recipe, every output, every active item, and the inputs through `loadResolvedRecipeInputs(scope)`; `loadGraphReadiness(actor, scope)` walks `g.recipes` and `g.items`; the hub's `countNotReady` attributes per scope. | `lib/admin/readiness-load.ts:85-110, 116-300`; 3a plan `:4802-4850` |
| **(Astra r1)** The weights board (`loadWeightBoard`) reads every active item and costs each through ONE global graph (`loadRecipeGraph()`) at global prices (`loadCurrentSkuPrices(skuIds, null)`; `perUnitSkuOzForItemFromGraph`). Toast: `loadEntities` reads items `.is("location_id", null)`; modifier portions (`derivePortion`, sampling sandwiches that use the item) come from the GLOBAL graph in auto-match (`:248-264`) and `manualMap` (`:602-606`). | `lib/weights.ts:268-320, 578-620`; `lib/admin/toast-map.ts:108-123, 245-266, 559-606`; `lib/toast/modifiers-shared.ts:134` |
| **(Astra r1)** Check-then-write on an owner or a shop: `updateMenuPrice` (reads, then `update … eq(id).eq(active).eq(menu_price)`); `updateSku` (reads `location_id`, binds, writes `location_id` whenever the form sends it); `deactivateSku` and `setSkuPriceBasis` (read `location_id`, bind, update by id); `promoteItemToGlobal` (read, bind, update by id). The 2a pack / price writers bind with `skuOwnerAllowed` and then call RPCs that lock the SKU row. | `lib/admin/menu-prices.ts:13-37`; `lib/admin/skus.ts:799-960`; `lib/catalog/sku-item.ts:714-737`; `lib/admin/templates.ts:1621-1660`; `lib/sku-versions-shared.ts:365-373` |
| **(Astra r1)** `jsonOk<T extends Record<string, unknown>>(body: T, status = 200)` — a value typed by a named INTERFACE (no index signature) is TS2345 there; an object literal (a spread) is not. | `lib/api-helpers.ts:46-51` |
| **(Astra r1)** Counts: `sku_count_events (id, location_id, counted_at, active, …)` and `sku_count_lines (id, count_event_id, sku_id, qty, resolved_oz, …)`. | `supabase/migrations/0160_receiving_counts.sql:84-116` |
| **(Astra r1)** The vendor page renders `OrderGuidePanel({ vendorId, vendorName, initial: { guide, skusNotOnGuide }, canEdit })`; the same `{ guide, skusNotOnGuide }` comes back from `GET /api/admin/vendors/[id]/order-guide` after a save. | `app/admin/vendors/[id]/page.tsx:84-95, 225-230`; `components/admin/vendors/OrderGuidePanel.tsx:34-43, 86-104, 338-357`; `app/api/admin/vendors/[id]/order-guide/route.ts:37-66` |
| **(Astra r1)** The sim concurrency harness: `scripts/sim/concurrency/driver.mjs` exports `Session`, `findUser`, `fireSimultaneous`, `makeReport`, `db`, `LOC`; scenario files export `run()` (e.g. `ordering-races.mjs`). | `scripts/sim/concurrency/driver.mjs:20-192`; `scripts/sim/concurrency/ordering-races.mjs` |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/fixtures/shop-owned-fixture.ts`, `tests/shop-owned-equivalence.test.ts` | create | The Phase 3 fixture + ONE sandwich only Shop one sells; no owned rows ⇒ the Phase 3 goldens; owned rows ⇒ every other scope's numbers unchanged. |
| `lib/catalog/shop-owned-shared.ts`, `tests/shop-owned-shared.test.ts` | create | The pure ownership rules: visibility, the owned-aware gates, the new-thing scope gate, the share gate, the RPC refusal map. |
| `supabase/migrations/0264_catalog_shop_owned.sql`, `tests/shop-owned-migration.test.ts` | create | Owner columns; the ownership law (triggers, incl. a shop version's lines — decision (a)); `save_owned_recipe_version` (the owner's own edit, compare-and-set); `create_shop_recipe`, `create_shop_sandwich`, `create_catalog_sku` (one item number per vendor, serialized); `share_shop_owned_menu_item` / `_recipe` / `_sku`; ceilings. |
| `supabase/migrations/0266_drop_recipe_input_16arg.sql`, `tests/drop-recipe-input-16arg-migration.test.ts` | create | The pre-3a 16-argument writer, dropped on its own — applied only behind the deploy gate (Task 15 Steps 9–10). |
| `tests/fixtures/recipe-versions-pglite.ts` | modify | Export its `STUB` (no other change). |
| `tests/fixtures/shop-owned-pglite.ts`, `tests/shop-owned-pglite.test.ts` | create | 0258 + 0262 + 0264 as committed in PGlite; the real triggers and writers. |
| `supabase/migrations/0265_sku_swaps.sql`, `tests/sku-swaps-migration.test.ts` | create | `sku_swaps`, `start_sku_swap` (the recipe set re-enumerated under the graph lock; the primary-following recipes bound), `end_sku_swap` (locks, then checked conditional writes), ceilings. |
| `lib/prep-consumption.ts`, `lib/admin/menu-costing.ts`, `lib/admin/toast-map.ts`, `lib/admin/catalog.ts`, `lib/admin/readiness-load.ts`, `lib/weights.ts`, `tests/shop-owned-scope.test.ts` | modify / create | Owned things visible only to their owner at the one resolver point, the menu readers and readiness; a shop's own prep item costed and portioned in its owner's graph (weights, Toast). |
| `lib/counts-read-refs.ts`, `lib/ordering.ts`, `lib/products.ts`, `lib/order-guides.ts`, `lib/order-guides-shared.ts`, `lib/catering/menu.ts`, `lib/portal/menu.ts`, `tests/shop-only-visibility.test.ts`, `tests/products-store-loader.test.ts` | modify / create | Task 5b: a shop-only SKU only at its shop (walk, par pass, counts, a shop's guide, product resolution at every rung); the guide's owner names for the vendor editor (decision (b)); catering pickers only what the quote's shop may sell. |
| `lib/admin/recipe-versions.ts`, `lib/admin/menu-item-shop.ts`, `lib/catalog/recipe-item.ts`, `lib/catalog/recipe-item-shared.ts`, `app/admin/catalog/recipe/[id]/page.tsx`, `lib/admin/menu-prices.ts`, `app/api/admin/menu-items/[id]/price/route.ts`, `lib/recipes.ts`, `app/api/admin/recipes/route.ts`, `app/api/admin/recipes/full/route.ts`, `app/api/admin/menu-items/route.ts`, `lib/admin/templates.ts`, `lib/admin/skus.ts`, `lib/catalog/sku-item.ts`, `tests/shop-owned-permissions.test.ts` | modify / create | The owner edits its own things — bound to that owner in the write (`ownership_changed`); a shop version never names another shop's own thing (decision (a)); GM creation and owner moves go shop-only; MoO+ shares. |
| `lib/catalog/new-item-shared.ts`, `lib/catalog/new-item.ts`, `tests/new-item.test.ts` | create | Job 2: parse, the atomic create, the shop setup steps. |
| `lib/catalog/new-sandwich-shared.ts`, `lib/catalog/new-sandwich.ts`, `lib/admin/toast-map.ts` (`loadToastLinkChoices`), `tests/new-sandwich.test.ts` | create / modify | Job 4: parse, the live cost, the atomic create, the Toast suggestions and link. |
| `lib/catalog/share.ts`, `tests/share.test.ts` | create | Share with every shop: preview + writers. |
| `lib/catalog/swap-shared.ts`, `lib/catalog/swap-vendor.ts`, `tests/swap-shared.test.ts`, `tests/swap-vendor.test.ts` | create | Job 3: the line rewrite, the preview, start, Back to normal. |
| `lib/audit-actions.ts`, `lib/destructive-actions.ts`, `tests/location-bind-differential.test.ts` | modify | The new audit actions; the new tables, RPCs and lib files with the bind check. |
| `app/api/admin/catalog/jobs/new-item/route.ts`, `app/api/admin/catalog/sku/[id]/setup/route.ts`, `app/api/admin/catalog/jobs/new-sandwich/{route, preview/route}.ts`, `app/api/admin/catalog/menu-item/[id]/{toast, share}/route.ts`, `app/api/admin/catalog/sku/[id]/{share, swap, swap/preview}/route.ts`, `app/api/admin/catalog/swaps/[swapId]/back-to-normal/route.ts`, `tests/catalog-job-routes.test.ts`, `tests/step-up-tier-map.test.ts` | create / modify | The routes; their tiers. |
| `scripts/catalog-jobs/sim-scenario.sql` | create | The real-SQL scenario for 0264 + 0265 (sim; always rolls back). |
| `scripts/sim/concurrency/catalog-job-races.mjs` | create | The races PGlite cannot run: two New-item creates on one vendor number, Back to normal against a primary change, a share against a GM's price edit (sim, real HTTP). |
| `AGENTS.md` | modify | The shop-only law and the job engines. |

---

## Task 1: The equivalence pin — no shop-only rows ⇒ the Phase 3 goldens; owned rows ⇒ every other scope unchanged

Nothing in `lib/` changes in this task. Phase 4 changes what the resolver READS (one more filter on recipes, menu items and Toast entities), so the oracle is the Phase 3 golden (`tests/fixtures/recipe-versions-golden.json`, frozen by 3a Task 1 and never regenerated since). This task adds a fixture variant with ONE sandwich only Shop one sells and a test with two halves:
- **with no owned rows** the harness reproduces the Phase 3 golden (this half is green now and must stay green);
- **with the owned sandwich** every number of the global scope and of Shop two equals the golden, and Shop one equals the golden plus the sandwich (this half is RED until Task 5 — today the sandwich leaks into every scope).

**Files:**
- Create: `tests/fixtures/shop-owned-fixture.ts`, `tests/shop-owned-equivalence.test.ts`

- [ ] **Step 1: Create the fixture `tests/fixtures/shop-owned-fixture.ts`**

```ts
/**
 * Catalog Phase 4a — the Phase 3 fixture matrix PLUS one sandwich only Shop one sells (0264's ownership).
 *
 *   m-local-hero (owned by LOC, $11)  ← r-local-hero (owned by LOC): 5 oz turkey + 1 oz mayo, yield 1
 *
 * Built on buildRecipeVersionsFixture (2a's SKUs, packs and prices; 3a's baseline recipe versions), so every
 * number it adds is computed by the same loaders as the Phase 3 golden. The baseline global version of the
 * owned recipe is added the way 0262's journal would (withBackfilledRecipeVersions).
 */
import { buildRecipeVersionsFixture, LOC, OTHER, withBackfilledRecipeVersions } from "./recipe-versions-fixture";

type Row = Record<string, unknown>;
export { LOC, OTHER };

export const OWNED_MENU = "m-local-hero";
export const OWNED_RECIPE = "r-local-hero";

/** The Phase 3 fixture with every recipe and menu item explicitly SHARED (location_id null) — what 0264 backfills. */
export function buildSharedOnlyFixture(): Record<string, Row[]> {
  const t = buildRecipeVersionsFixture();
  for (const r of t.recipes ?? []) r.location_id = null;
  for (const m of t.menu_items ?? []) m.location_id = null;
  return t;
}

/** …plus the one sandwich only Shop one sells. */
export function buildShopOwnedFixture(): Record<string, Row[]> {
  const t = buildSharedOnlyFixture();
  t.menu_items!.push({
    id: OWNED_MENU, name: "Local Hero", name_es: "Héroe local", active: true, section: "Subs",
    menu_price: 11, price_same_as_id: null, catering_available: false, location_id: LOC,
  });
  t.recipes!.push({ id: OWNED_RECIPE, name: "Local Hero", batch_yield: 1, active: true, created_at: "2026-10-10T00:00:00.000Z", location_id: LOC });
  t.recipe_inputs!.push(
    { id: "ri-lh-1", recipe_id: OWNED_RECIPE, quantity: 5, unit: "oz", component_sku_id: "s-turkey", component_item_id: null, component_product_id: null },
    { id: "ri-lh-2", recipe_id: OWNED_RECIPE, quantity: 1, unit: "oz", component_sku_id: "s-mayo", component_item_id: null, component_product_id: null },
  );
  t.recipe_outputs!.push({ id: "ro-lh", recipe_id: OWNED_RECIPE, output_item_id: null, output_menu_item_id: OWNED_MENU, yield: 1 });
  return withBackfilledRecipeVersions(t);
}
```

- [ ] **Step 2: Write the test `tests/shop-owned-equivalence.test.ts`**

```ts
/**
 * Catalog Phase 4a — THE SHOP-ONLY EQUIVALENCE PIN (spec §8; 0264).
 *
 * (1) No shop-only rows (every recipe and menu item location_id NULL) ⇒ every number — live and dated depletion,
 *     cost per oz, the rollups, the menu costing board — for the global scope and both shops is the PHASE 3 GOLDEN,
 *     byte for byte. Phase 4 adds a filter to the resolver; with nothing owned it must filter nothing.
 * (2) One sandwich only Shop one sells ⇒ the global scope and Shop two are STILL the golden (it never leaks), and
 *     Shop one is the golden plus that sandwich (it is there, costed, on the board).
 * The golden is 3a's; this file never writes it.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { EARLY_DAY, MID_DAY, QUIET_DAY } from "./fixtures/recipe-versions-fixture";
import { computeRecipeOutputs, liveRecipeApi, type RecipeEquivalenceOutputs, type RecipeScopeOutputs } from "./fixtures/recipe-versions-harness";
import { buildSharedOnlyFixture, buildShopOwnedFixture, LOC, OTHER, OWNED_MENU } from "./fixtures/shop-owned-fixture";

const GOLDEN = "tests/fixtures/recipe-versions-golden.json";
const DAYS = [EARLY_DAY, MID_DAY, QUIET_DAY];
const golden = (): RecipeEquivalenceOutputs => JSON.parse(readFileSync(GOLDEN, "utf8")) as RecipeEquivalenceOutputs;

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

/** The scope's outputs with the owned sandwich's keys removed (the harness keys every menu item of the tables). */
function withoutOwned(o: RecipeScopeOutputs): RecipeScopeOutputs {
  const drop = <V>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== OWNED_MENU));
  return {
    ...o,
    menuOz: drop(o.menuOz),
    menuCost: drop(o.menuCost),
    datedMenuOz: Object.fromEntries(Object.entries(o.datedMenuOz).map(([d, m]) => [d, drop(m)])),
    board: { rows: (o.board.rows as Array<{ id: string }>).filter((r) => r.id !== OWNED_MENU), totals: o.board.totals },
  };
}

describe("no shop-only rows ⇒ the Phase 3 golden, byte for byte", () => {
  it("global, shop one and shop two", async () => {
    const tables = buildSharedOnlyFixture();
    current = createFakeDb(tables);
    expect(await computeRecipeOutputs(liveRecipeApi, tables, [LOC, OTHER], DAYS)).toEqual(golden());
  });
});

describe("one sandwich only Shop one sells", () => {
  it("never reaches the global scope or Shop two: their numbers are the golden", async () => {
    const tables = buildShopOwnedFixture();
    current = createFakeDb(tables);
    const got = await computeRecipeOutputs(liveRecipeApi, tables, [LOC, OTHER], DAYS);
    for (const scope of ["global", OTHER]) {
      const g = got[scope]!;
      expect(g.menuOz[OWNED_MENU], scope).toEqual({});
      expect(g.menuCost[OWNED_MENU], scope).toMatchObject({ status: "no_recipe" });
      expect((g.board.rows as Array<{ id: string }>).some((r) => r.id === OWNED_MENU), scope).toBe(false);
      expect(withoutOwned(g), scope).toEqual(golden()[scope]);
    }
  });

  it("is Shop one's: costed from its lines, on its board; everything else there is the golden", async () => {
    const tables = buildShopOwnedFixture();
    current = createFakeDb(tables);
    const loc = (await computeRecipeOutputs(liveRecipeApi, tables, [LOC, OTHER], DAYS))[LOC]!;
    expect(loc.menuOz[OWNED_MENU]!["s-turkey"]).toBeCloseTo(5, 10);
    expect(loc.menuOz[OWNED_MENU]!["s-mayo"]).toBeCloseTo(1, 10);
    expect((loc.board.rows as Array<{ id: string; menuPrice: number | null }>).find((r) => r.id === OWNED_MENU)?.menuPrice).toBe(11);
    const g = golden()[LOC]!;
    const mine = withoutOwned(loc);
    expect({ ...mine, board: { rows: mine.board.rows, totals: g.board.totals } }).toEqual(g);
  });
});
```

- [ ] **Step 3: Run**

Run: `npx vitest run tests/shop-owned-equivalence.test.ts`

Expected: the "no shop-only rows" test PASSES; the two "one sandwich only Shop one sells" tests FAIL (the global scope and Shop two still cost and list `m-local-hero` — today nothing filters by owner). That failure is the target of Task 5.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/shop-owned-fixture.ts tests/shop-owned-equivalence.test.ts
git commit -m "$(cat <<'EOF'
test(catalog): Phase 4a equivalence pin — no shop-only rows = the Phase 3 golden; an owned sandwich stays in its shop

The isolation half is red until the resolver filters by owner (Task 5).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 2: The pure ownership rules (`lib/catalog/shop-owned-shared.ts`)

**Files:**
- Create: `lib/catalog/shop-owned-shared.ts`, `tests/shop-owned-shared.test.ts`

- [ ] **Step 1: Write the failing test `tests/shop-owned-shared.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  filterOwnedEntities, linesOwnedElsewhere, namedRefusal, newThingScopeGate, ownedAwareRecipeGate, ownedRecipeScopeRefusal, ownerVisible,
  ownerWriteCheck, shareGate, shopOwnedErrorFromRpc, ShopOwnedError,
} from "@/lib/catalog/shop-owned-shared";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const gm = (locations: string[]) => ({ level: 7, locations });
const moo = { level: 8, locations: [] as string[] };

describe("ownerVisible — the one visibility rule", () => {
  it("shared things are everyone's; an owned thing only its owner's", () => {
    expect(ownerVisible(null, null)).toBe(true);
    expect(ownerVisible(null, A)).toBe(true);
    expect(ownerVisible(undefined, A)).toBe(true);
    expect(ownerVisible(A, A)).toBe(true);
    expect(ownerVisible(A, B)).toBe(false);
    expect(ownerVisible(A, null)).toBe(false); // the global default never shows a shop's thing
  });
});

describe("ownedAwareRecipeGate — 3a's gate, with the owner's own recipe let through to the I/O check", () => {
  it("a GM writing the default is no longer refused up front: the owner check decides after one read", () => {
    expect(ownedAwareRecipeGate({ level: 7, scope: null, scopeAllowed: false })).toEqual({ ok: true, ownerCheck: true });
  });
  it("MoO+ needs no owner check; shop writes keep 3a's answers", () => {
    expect(ownedAwareRecipeGate({ level: 8, scope: null, scopeAllowed: false })).toEqual({ ok: true, ownerCheck: false });
    expect(ownedAwareRecipeGate({ level: 7, scope: A, scopeAllowed: true })).toEqual({ ok: true, ownerCheck: false });
    expect(ownedAwareRecipeGate({ level: 7, scope: B, scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(ownedAwareRecipeGate({ level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
});

describe("ownerWriteCheck — after the read", () => {
  it("a shared recipe's default stays MoO+; an owned one is its shop's", () => {
    expect(ownerWriteCheck(gm([A]), null)).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(ownerWriteCheck(gm([A]), A)).toEqual({ ok: true });
    expect(ownerWriteCheck(gm([A]), B)).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(ownerWriteCheck(moo, B)).toEqual({ ok: true });
  });
});

describe("ownedRecipeScopeRefusal — an owned recipe has no shop versions", () => {
  it("its owner is told to edit the recipe itself; another shop never sees it", () => {
    expect(ownedRecipeScopeRefusal(null, A)).toBeNull();
    expect(ownedRecipeScopeRefusal(A, null)).toBeNull();
    expect(ownedRecipeScopeRefusal(A, A)).toEqual({ ok: false, status: 409, code: "shop_owned_edit_here" });
    expect(ownedRecipeScopeRefusal(A, B)).toEqual({ ok: false, status: 404, code: "not_found" });
  });
});

describe("newThingScopeGate — below MoO a new thing names a shop the actor works in", () => {
  it("GM: own shop only; never the whole company", () => {
    expect(newThingScopeGate({ level: 7, role: "gm", locations: [A] }, A)).toEqual({ ok: true });
    expect(newThingScopeGate({ level: 7, role: "gm", locations: [A] }, null)).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(newThingScopeGate({ level: 7, role: "gm", locations: [A] }, B)).toEqual({ ok: false, status: 404, code: "not_found" });
  });
  it("MoO+: any shop or every shop; level 6 never creates", () => {
    expect(newThingScopeGate({ level: 8, role: "moo", locations: [] }, null)).toEqual({ ok: true });
    expect(newThingScopeGate({ level: 8, role: "moo", locations: [] }, B)).toEqual({ ok: true });
    expect(newThingScopeGate({ level: 6, role: "agm", locations: [A] }, A)).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
});

describe("shareGate", () => {
  it("MoO+ shares; a GM is told who can", () => {
    expect(shareGate(8)).toEqual({ ok: true });
    expect(shareGate(7)).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(shareGate(6)).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
});

describe("filterOwnedEntities — the Toast pool and every menu list", () => {
  it("keeps shared entities and the scope's own; drops other shops'", () => {
    const owners = new Map([["m2", A], ["m3", B]]);
    const es = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    expect(filterOwnedEntities(es, owners, A).map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(filterOwnedEntities(es, owners, null).map((e) => e.id)).toEqual(["m1"]);
  });
});

describe("linesOwnedElsewhere — a shop version names only shared things or that shop's own (decision (a), Astra r1)", () => {
  it("names the 1-based positions of lines using ANOTHER shop's own SKU or item", () => {
    const owners = { skus: new Map([["s-a", A], ["s-b", B]]), items: new Map([["i-b", B]]) };
    const line = (sku: string | null, item: string | null) => ({ componentSkuId: sku, componentItemId: item });
    expect(linesOwnedElsewhere([line("s-shared", null), line("s-a", null), line("s-b", null), line(null, "i-b"), line(null, "i-shared")], owners, A))
      .toEqual([3, 4]);
    expect(linesOwnedElsewhere([line("s-b", null), line(null, "i-b")], owners, B)).toEqual([]);
    expect(linesOwnedElsewhere([], owners, A)).toEqual([]);
  });
});

describe("namedRefusal — one answer for every typed 4xx error", () => {
  it("passes a status + code through, line included; never a 5xx or a plain Error", () => {
    expect(namedRefusal(new ShopOwnedError(400, "invalid_quantity", "x", { position: 2, name: "Mayo", reason: "invalid_quantity" })))
      .toEqual({ status: 400, code: "invalid_quantity", message: "x", line: { position: 2, name: "Mayo", reason: "invalid_quantity" } });
    expect(namedRefusal(Object.assign(new Error("boom"), { status: 500, code: "internal" }))).toBeNull();
    expect(namedRefusal(new Error("boom"))).toBeNull();
  });
});

describe("shopOwnedErrorFromRpc — every 0264 refusal is named, with a status", () => {
  it("maps the prefix and leaves anything else unnamed", () => {
    const named = (m: string) => { try { shopOwnedErrorFromRpc(m); } catch (e) { return e; } return null; };
    expect(named("shop_owned:name_taken")).toMatchObject({ status: 409, code: "name_taken" });
    expect(named("shop_owned:ownership_changed")).toMatchObject({ status: 409, code: "ownership_changed" });
    expect(named("swap:recipes_changed")).toMatchObject({ status: 409, code: "recipes_changed" });
    expect(named("shop_owned:not_found")).toMatchObject({ status: 404, code: "not_found" });
    expect(named("shop_owned:invalid_price")).toMatchObject({ status: 400, code: "invalid_price" });
    expect(named("boom")).toBeInstanceOf(Error);
    expect(named("boom")).not.toBeInstanceOf(ShopOwnedError);
  });
});
```

- [ ] **Step 2: Create `lib/catalog/shop-owned-shared.ts`**

```ts
/**
 * SHOP-ONLY THINGS (catalog Phase 4a, 0264; spec §3: "New things a GM creates start shop-only … MoO+ can
 * promote them to global"). PURE — no I/O; safe in client and server bundles.
 *
 * THE HOUSE IDIOM: an owner column `location_id`, NULL = every shop. A bought item (vendor_items, since 0095)
 * and a SANDWICH (a menu item and the recipe that makes it, 0264) can belong to ONE shop.
 *   · VISIBLE only to its owner (ownerVisible): the global default and every other shop never see it.
 *   · EDITED by its owner: an owned thing has no shop versions — there is no default for it to differ from —
 *     so the owner's GM edits the thing itself (the recipe's own lines, the menu item's own price):
 *     ownedAwareRecipeGate (before I/O) + ownerWriteCheck (after the one read); MoO+ any.
 *   · SHARED by MoO+ ("Share with every shop", shareGate): the owner is cleared atomically (0264). Never the
 *     reverse — an owner is set at creation only.
 *   · CREATED: below MoO a new thing names a shop the actor works in (newThingScopeGate).
 */
import type { RoleCode } from "@/lib/roles";
import { recipeVersionWriteGate, type RecipeWriteRefusal } from "@/lib/recipe-versions-shared";
import { catalogShopAllowed, catalogWriteRoleAllowed, GLOBAL_VERSION_WRITE_MIN, type VersionScope } from "@/lib/sku-versions-shared";

/** MoO (8)+ shares a shop's thing with every shop. */
export const SHARE_MIN = GLOBAL_VERSION_WRITE_MIN;
/** GM (7)+ creates a new thing — createSku's and the recipe writers' floor, unchanged. */
export const NEW_THING_MIN = 7;

export type OwnerRefusal = {
  ok: false; status: 403 | 404 | 409;
  code: "forbidden" | "not_found" | "global_requires_moo" | "shop_owned_edit_here";
};

/** THE visibility rule: a shared thing (owner null) everywhere; an owned thing only in its owner's scope. */
export function ownerVisible(owner: string | null | undefined, scope: VersionScope): boolean {
  return owner == null || owner === scope;
}

/** Entities (menu items) a scope may see, given each owned entity's owner (absent from the map = shared). */
export function filterOwnedEntities<E extends { id: string }>(entities: readonly E[], owners: ReadonlyMap<string, string>, scope: VersionScope): E[] {
  return entities.filter((e) => ownerVisible(owners.get(e.id) ?? null, scope));
}

/**
 * 3a's recipe write gate, ownership-aware, BEFORE any I/O. The one change: a GM (7) writing the DEFAULT is
 * no longer refused here — whether that default is theirs depends on the recipe's owner, which needs one read;
 * `ownerCheck: true` tells the writer to run ownerWriteCheck on it before writing anything.
 */
export function ownedAwareRecipeGate(input: { level: number; scope: VersionScope; scopeAllowed: boolean }): { ok: true; ownerCheck: boolean } | RecipeWriteRefusal {
  const base = recipeVersionWriteGate(input);
  if (base.ok) return { ok: true, ownerCheck: false };
  if (input.scope === null && base.code === "global_requires_moo") return { ok: true, ownerCheck: true };
  return base;
}

/** After the read: a shared thing's default stays MoO+ (global_requires_moo); an owned one is its shop's. */
export function ownerWriteCheck(actor: { level: number; locations: readonly string[] }, owner: string | null): { ok: true } | OwnerRefusal {
  if (actor.level >= GLOBAL_VERSION_WRITE_MIN) return { ok: true };
  if (owner === null) return { ok: false, status: 403, code: "global_requires_moo" };
  if (!catalogShopAllowed(actor, owner)) return { ok: false, status: 404, code: "not_found" };
  return { ok: true };
}

/** A SHOP-scoped recipe write on an owned recipe: never (0264 refuses the version row too). */
export function ownedRecipeScopeRefusal(owner: string | null, scope: VersionScope): OwnerRefusal | null {
  if (owner === null || scope === null) return null;
  return scope === owner
    ? { ok: false, status: 409, code: "shop_owned_edit_here" }
    : { ok: false, status: 404, code: "not_found" };
}

/** Where a NEW thing may be created: a shop the actor works in (GM+), or — MoO+ only — every shop (null). */
export function newThingScopeGate(
  actor: { level: number; role: RoleCode; locations: readonly string[] },
  scope: VersionScope,
): { ok: true } | OwnerRefusal {
  if (actor.level < NEW_THING_MIN || !catalogWriteRoleAllowed(actor.role, actor.level)) return { ok: false, status: 403, code: "forbidden" };
  if (scope === null) return actor.level >= GLOBAL_VERSION_WRITE_MIN ? { ok: true } : { ok: false, status: 403, code: "global_requires_moo" };
  if (!catalogShopAllowed(actor, scope)) return { ok: false, status: 404, code: "not_found" };
  return { ok: true };
}

/**
 * A SHOP VERSION of a SHARED recipe names only shared things or that shop's own (decision (a), Astra round 1; 0264's
 * recipe_version_lines_owner_law refuses the same in SQL). The 1-based positions of lines that name ANOTHER shop's own
 * SKU or item. `owners` holds shop-owned rows only (absent = shared).
 */
export function linesOwnedElsewhere(
  lines: ReadonlyArray<{ componentSkuId: string | null; componentItemId: string | null }>,
  owners: { skus: ReadonlyMap<string, string>; items: ReadonlyMap<string, string> },
  shop: string,
): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    const owner = (l.componentSkuId !== null ? owners.skus.get(l.componentSkuId) : undefined)
      ?? (l.componentItemId !== null ? owners.items.get(l.componentItemId) : undefined);
    if (owner !== undefined && owner !== shop) out.push(i + 1);
  });
  return out;
}

/** Share a shop's thing with every shop: MoO+. */
export function shareGate(level: number): { ok: true } | OwnerRefusal {
  if (level >= SHARE_MIN) return { ok: true };
  return { ok: false, status: 403, code: level >= NEW_THING_MIN ? "global_requires_moo" : "forbidden" };
}

export class ShopOwnedError extends Error {
  /** `line`: WHICH draft line was refused (1-based), its name and why — the shape the shared postJson passes through (3b). */
  constructor(public status: number, public code: string, message?: string, public line?: { position: number; name: string; reason: string }) {
    super(message ?? code);
    this.name = "ShopOwnedError";
  }
}

/** Every catalog job route answers a NAMED refusal the same way: any error carrying a 4xx status and a code. */
export function namedRefusal(e: unknown): { status: number; code: string; message: string; line?: unknown } | null {
  if (!(e instanceof Error)) return null;
  const x = e as Error & { status?: unknown; code?: unknown; line?: unknown };
  if (typeof x.status !== "number" || typeof x.code !== "string" || x.status < 400 || x.status >= 500) return null;
  return { status: x.status, code: x.code, message: x.message, ...(x.line ? { line: x.line } : {}) };
}

/** 0264 / 0265 refusals arrive as P0001 'shop_owned:<code>' (or 'swap:<code>'); each keeps its code. */
const RPC_STATUS: Record<string, number> = {
  not_found: 404, location_not_found: 404, sku_not_found: 404, vendor_not_found: 404, swap_not_found: 404,
  name_taken: 409, ownership_changed: 409, already_shared: 409, skus_changed: 409, already_swapped: 409, not_live: 409, recipes_changed: 409,
  product_name_taken: 409, product_needs_primary: 409, in_other_product: 409, item_number_taken: 409, uses_other_shop_sku: 409,
  invalid_name: 400, invalid_price: 400, invalid_yield: 400, incomplete_recipe: 400, invalid_payload: 400,
  same_sku: 400, invalid_mode: 400,
  line_other_shop: 400, uses_shop_only_item: 409, share_the_sandwich: 409, location_required: 400, output_other_shop: 400, global_recipe_makes_shop_item: 400, recipe_has_no_shop_versions: 409,
  menu_item_has_no_shop_settings: 409, toast_other_shop: 400, owner_is_set_at_creation: 400, owned_not_catering: 400,
};

/** Throws the named ShopOwnedError for a 0264 / 0265 refusal, else a plain Error (an unnamed failure is a 500). */
export function shopOwnedErrorFromRpc(message: string): never {
  const m = /(?:shop_owned|swap):([a-z_]+)/.exec(message);
  const code = m?.[1];
  if (code && RPC_STATUS[code] !== undefined) throw new ShopOwnedError(RPC_STATUS[code]!, code);
  throw new Error(message);
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/shop-owned-shared.test.ts` → expected: PASS.

```bash
git add lib/catalog/shop-owned-shared.ts tests/shop-owned-shared.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a pure ownership rules — visibility, owner-aware gates, new-thing scope, share gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 3: Migration 0264 — shop-only sandwiches; the ownership law; the owner's own edit; the new-item and new-sandwich writers; sharing

**Files:**
- Create: `supabase/migrations/0264_catalog_shop_owned.sql`, `tests/shop-owned-migration.test.ts`, `tests/fixtures/shop-owned-pglite.ts`, `tests/shop-owned-pglite.test.ts`
- Modify: `tests/fixtures/recipe-versions-pglite.ts` (export `STUB`)

- [ ] **Step 1: Write the failing pin test `tests/shop-owned-migration.test.ts`**

```ts
/**
 * Catalog Phase 4a — 0264's pins: the owner columns, the ownership law (a shop version's lines included), the owner's
 * own edit (compare-and-set), the writers, the lock order, and the privilege ceilings asserted both ways. Read as text;
 * PGlite runs it for real (tests/shop-owned-pglite.test.ts). The pre-3a writer is dropped by 0266, not here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction } from "../scripts/recipe-versions/reemit-mods";

const FILE = "supabase/migrations/0264_catalog_shop_owned.sql";
const src = readFileSync(FILE, "utf8");
const fn = (name: string) => extractFunction(src, `create or replace function public.${name}(`, "\n$$;");

describe("0264 header and transaction", () => {
  it("names itself, is gated, and runs in one transaction", () => {
    expect(src.startsWith("-- Migration 0264_catalog_shop_owned\n-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.")).toBe(true);
    expect(src).toContain("\nbegin;\n");
    expect(src.trimEnd().endsWith("commit;")).toBe(true);
  });
});

describe("(0) the pre-3a writer is NOT dropped here — 0266 drops it, behind the deploy gate (Astra r1)", () => {
  it("0264 never touches update_recipe_input_atomic", () => {
    expect(src).not.toMatch(/drop function[^;]*update_recipe_input_atomic/);
    expect(src).not.toContain("update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)");
  });
});

describe("(1) ownership columns in the house idiom", () => {
  it("recipes and menu_items gain location_id (NULL = every shop), indexed, commented", () => {
    expect(src).toContain("alter table public.recipes    add column if not exists location_id uuid null references public.locations(id);");
    expect(src).toContain("alter table public.menu_items add column if not exists location_id uuid null references public.locations(id);");
    expect(src).toContain("create index if not exists recipes_owner_idx    on public.recipes(location_id)    where location_id is not null;");
    expect(src).toContain("comment on column public.recipes.location_id is");
    expect(src).toContain("check (location_id is null or not catering_available)");
  });
});

describe("(2) the ownership law lives in the database", () => {
  it("an owner is set at creation only (one named writer may assign it in its own transaction)", () => {
    const f = fn("shop_owner_set_trg");
    expect(f).toContain("new.location_id is not null and new.location_id is distinct from old.location_id");
    expect(f).toContain("current_setting('co.shop_owner_assign', true)");
    expect(f).toContain("'shop_owned:owner_is_set_at_creation'");
    expect(src).toContain("before update of location_id on public.recipes");
    expect(src).toContain("before update of location_id on public.menu_items");
  });
  it("a recipe and what it makes agree on the owner — checked at COMMIT", () => {
    const law = fn("recipe_owner_law");
    for (const code of ["shop_owned:line_other_shop", "shop_owned:output_other_shop", "shop_owned:global_recipe_makes_shop_item"]) {
      expect(law).toContain(`'${code}'`);
    }
    for (const t of ["recipe_outputs_owner_law", "recipe_inputs_owner_law", "recipes_owner_law", "menu_items_owner_law", "items_owner_law"]) {
      expect(src).toMatch(new RegExp(`create constraint trigger ${t}\\n[^;]*deferrable initially deferred`));
    }
  });
  it("a SHOP version of a shared recipe names only shared things or that shop's own (decision (a), Astra r1)", () => {
    const f = fn("recipe_version_lines_owner_trg");
    expect(f).toContain("select v.location_id into v_shop from public.recipe_versions v where v.id = new.version_id;");
    expect(f).toContain("vi.location_id is not null and vi.location_id <> v_shop");
    expect(f).toContain("i.location_id is not null and i.location_id <> v_shop");
    expect(f).toContain("'recipe_version:line_other_shop'");
    expect(src).toContain("before insert or update of version_id, component_sku_id, component_item_id on public.recipe_version_lines");
  });
  it("an owned thing has no shop versions, no shop overlay, and no Toast link at another shop", () => {
    expect(fn("recipe_versions_owner_trg")).toContain("'shop_owned:recipe_has_no_shop_versions'");
    expect(fn("menu_item_shop_settings_owner_trg")).toContain("'shop_owned:menu_item_has_no_shop_settings'");
    expect(fn("toast_menu_map_owner_trg")).toContain("'shop_owned:toast_other_shop'");
    expect(src).toContain("before insert on public.recipe_versions");
    expect(src).toContain("before insert on public.menu_item_shop_settings");
    expect(src).toContain("before insert or update on public.toast_menu_map");
  });
});

describe("(2b) the owner's own edit is bound to the owner it was granted for (Astra r1 P1)", () => {
  const f = fn("save_owned_recipe_version");
  it("graph lock → the recipe row → the owner compared → 0262's writer, in ONE transaction", () => {
    const lock = f.indexOf("pg_advisory_xact_lock(7258025800)");
    const row = f.indexOf("select location_id into v_owner from public.recipes where id = p_recipe and active for update;");
    const cas = f.indexOf("if v_owner is distinct from p_expected_owner then");
    const save = f.indexOf("return public.save_recipe_version(p_recipe, null, p_lines, p_expected, p_based_on, p_note, p_actor,");
    expect(lock).toBeGreaterThan(0);
    expect(row).toBeGreaterThan(lock);
    expect(cas).toBeGreaterThan(row);
    expect(save).toBeGreaterThan(cas);
    expect(f).toContain("'shop_owned:ownership_changed'");
  });
  it("only the default of an owned recipe goes through it", () => {
    expect(f).toContain("if p_expected_owner is null or p_location is not null then");
  });
});

describe("(3) create_shop_sandwich — job 4's one write", () => {
  const f = fn("create_shop_sandwich");
  it("takes the graph lock FIRST, then refuses a taken name, then writes the menu item and the recipe", () => {
    const lock = f.indexOf("pg_advisory_xact_lock(7258025800)");
    expect(lock).toBeGreaterThan(0);
    expect(f.indexOf("'shop_owned:name_taken'")).toBeGreaterThan(lock);
    expect(f.indexOf("insert into public.menu_items")).toBeGreaterThan(f.indexOf("'shop_owned:name_taken'"));
    expect(f).toContain("v_recipe := public.create_shop_recipe(p_location,");
    expect(f).toContain("'recipe_type', 'consumer'");
  });
  it("owns the menu item and never offers the sandwich to catering", () => {
    expect(f).toContain("values (v_name, v_name_es, v_section, p_price, true, false, p_location, p_actor)");
  });
});

describe("(3b) create_shop_recipe — a GM's recipe, owned by its shop (lead decision 1)", () => {
  const f = fn("create_shop_recipe");
  it("graph lock, 0262's create_recipe_full, then the owner assigned by this writer in this transaction", () => {
    expect(f.indexOf("pg_advisory_xact_lock(7258025800)")).toBeLessThan(f.indexOf("v_recipe := public.create_recipe_full(p_header, p_inputs, p_outputs, p_created_by);"));
    expect(f).toContain("perform set_config('co.shop_owner_assign', v_recipe::text, true);");
    expect(f).toContain("update public.recipes set location_id = p_location where id = v_recipe;");
  });
});

describe("(4) create_catalog_sku — job 2's one write", () => {
  const f = fn("create_catalog_sku");
  it("inserts the SKU, then 2a's first pack version, then 2a's first price — one transaction, first-only below MoO", () => {
    const ins = f.indexOf("insert into public.vendor_items");
    const pack = f.indexOf("public.save_sku_pack_version(v_id, null, p_levels, null, null, 'New item', p_actor, p_first_only)");
    const price = f.indexOf("public.save_sku_global_price(v_id, p_unit_price, p_price_date, p_actor, p_first_only)");
    expect(ins).toBeGreaterThan(0);
    expect(pack).toBeGreaterThan(ins);
    expect(price).toBeGreaterThan(pack);
    expect(f).toContain("'shop_owned:item_number_taken'");
  });
  it("one vendor item number is SERIALIZED: the lock (vendor + number, every shop) comes before the check (Astra r1#8)", () => {
    const lock = f.indexOf("perform pg_advisory_xact_lock(hashtextextended('co.catalog_sku_number:' || v_vendor::text || ':' || lower(v_number), 0));");
    expect(lock).toBeGreaterThan(0);
    expect(f.indexOf("'shop_owned:item_number_taken'")).toBeGreaterThan(lock);
  });
});

describe("(5) sharing — MoO+ in the lib; compare-and-set on the owner in SQL", () => {
  it("a sandwich shares with every recipe that makes it and exactly the shop-only SKUs they use", () => {
    const f = fn("share_shop_owned_menu_item");
    expect(f.indexOf("pg_advisory_xact_lock(7258025800)")).toBeLessThan(f.indexOf("for update"));
    for (const code of ["not_found", "already_shared", "ownership_changed", "skus_changed", "uses_other_shop_sku", "uses_shop_only_item"]) expect(f).toContain(`'shop_owned:${code}'`);
    expect(f).toContain("update public.recipes set location_id = null where id = any(v_recipes);");
    expect(f).toContain("update public.vendor_items set location_id = null");
  });
  it("a prep recipe shares with exactly the shop's own items it makes and SKUs it uses", () => {
    const f = fn("share_shop_owned_recipe");
    for (const code of ["already_shared", "ownership_changed", "share_the_sandwich", "items_changed", "skus_changed", "uses_shop_only_item"]) expect(f).toContain(`'shop_owned:${code}'`);
    expect(f).toContain("update public.items set location_id = null");
  });
  it("a SKU shares alone", () => {
    const f = fn("share_shop_owned_sku");
    expect(f).toContain("'shop_owned:ownership_changed'");
    expect(f).toContain("update public.vendor_items set location_id = null");
  });
});

describe("(6) privilege ceilings, both ways", () => {
  const WRITERS = [
    "public.save_owned_recipe_version(uuid, uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb)",
    "public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid)",
    "public.create_shop_recipe(uuid, jsonb, jsonb, jsonb, uuid)",
    "public.create_catalog_sku(jsonb, jsonb, numeric, date, uuid, boolean)",
    "public.share_shop_owned_menu_item(uuid, uuid, uuid[], uuid)",
    "public.share_shop_owned_recipe(uuid, uuid, uuid[], uuid[], uuid)",
    "public.share_shop_owned_sku(uuid, uuid, uuid)",
  ];
  it("each writer: revoked from every API role, granted to service_role only", () => {
    for (const w of WRITERS) {
      expect(src).toContain(`revoke all on function ${w} from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function ${w} to service_role;`);
    }
  });
  it("every helper and trigger function: no role at all, service_role included", () => {
    for (const h of ["shop_owner_set_trg()", "recipe_owner_law(uuid)", "recipe_outputs_owner_trg()", "recipe_inputs_owner_trg()", "recipes_owner_trg()",
      "menu_items_owner_trg()", "items_owner_trg()", "recipe_versions_owner_trg()", "menu_item_shop_settings_owner_trg()", "toast_menu_map_owner_trg()",
      "recipe_version_lines_owner_trg()"]) {
      expect(src).toContain(`revoke all on function public.${h} from public, anon, authenticated, service_role;`);
    }
  });
  it("the DO block asserts it, writers and helpers", () => {
    expect(src).toContain("raise exception '0264: service_role cannot execute %', f;");
    expect(src).toContain("raise exception '0264: % can execute %', r, f;");
    expect(src).toContain("raise exception '0264: % can execute helper %', r, f;");
  });
});

describe("every definer function pins its search_path", () => {
  it("no SECURITY DEFINER without `set search_path = pg_catalog, public`", () => {
    const defs = src.split("create or replace function").slice(1);
    for (const d of defs) {
      if (d.includes("security definer")) expect(d.slice(0, d.indexOf("as $$"))).toContain("set search_path = pg_catalog, public");
    }
  });
});
```

Run: `npx vitest run tests/shop-owned-migration.test.ts` → expected: FAIL (`ENOENT … 0264_catalog_shop_owned.sql`).

- [ ] **Step 2: Create `supabase/migrations/0264_catalog_shop_owned.sql`**

```sql
-- Migration 0264_catalog_shop_owned
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase4a-shop-only-and-job-engines.md (Task 3).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 ("New things a GM creates start shop-only
-- … MoO+ can promote them to global"), §5 jobs 2 and 4, §7 Phase 4.
-- Requires 0258–0263 (create_recipe_full, save_sku_pack_version, save_sku_global_price, recipe_versions,
-- recipe_version_lines, save_recipe_version, menu_item_shop_settings).
--
-- WHAT.
--   (0) NOT HERE: the pre-3a 16-argument update_recipe_input_atomic is dropped by 0266, on its own, only after the
--       production deploy that serves this phase is READY and the older deployments have drained (Astra round 1: a
--       migration cannot see which code is serving; the drop must not ride the schema this code needs FIRST).
--   (1) OWNERSHIP, in the house idiom: recipes.location_id and menu_items.location_id — NULL = every shop (every
--       existing row), set = only that shop. Beside vendor_items.location_id (0095, a shop-owned SKU) and
--       items.location_id (0079). Set at creation; cleared by sharing; never moved.
--   (2) THE OWNERSHIP LAW, in the database:
--         · a shop-owned recipe makes ONLY items and menu items owned by the same shop, and its lines use only
--           shared things or that shop's own; a shared recipe never makes a shop-owned menu item — deferred
--           constraint triggers, judged at COMMIT whatever order a transaction wrote in. So nothing another shop's
--           graph reads is another shop's own. (items.location_id already means a shop's own item — 0079, the
--           checklist templates; a shared recipe that makes such an item today is left as it is.)
--         · an owned recipe has no SHOP recipe versions and an owned menu item no SHOP overlay — there is no
--           default for them to differ from; their owner edits the thing itself (before-insert triggers);
--         · a SHOP version of a SHARED recipe names only shared things or that shop's own (decision (a), Astra round 1;
--           recipe_version_lines_owner_law): another shop's own SKU or item refuses 'recipe_version:line_other_shop';
--         · an owned menu item is linked to Toast only at its owner;
--         · an owned menu item is never offered to catering (catering prices are global, lead decision L2).
--   (2b) save_owned_recipe_version — the owner's own edit (Astra round 1 P1). A GM may write the default of a recipe
--       only because its shop OWNS it; the lib passes the owner it authorized and this writer compares it under the
--       graph lock and the recipe row (sharing takes the same graph lock), then runs 0262's save_recipe_version in
--       the same transaction. A share that landed first refuses 'shop_owned:ownership_changed'.
--   (3) create_shop_recipe   — a GM's recipe (lead decision 1): 0262's create_recipe_full, owned by its shop.
--       create_shop_sandwich — job 4's one write: the menu item and the recipe that makes it, owned by one shop.
--   (4) create_catalog_sku   — job 2's one write: the SKU, its first pack version and its first price. One vendor item
--       number among what a shop can see, SERIALIZED by a transaction lock on (vendor, number) — every shop's create
--       of that number waits for the one before it (Astra round 1 #8).
--   (5) share_shop_owned_menu_item / share_shop_owned_recipe / share_shop_owned_sku — "Share with every shop". The
--       lib decides who (MoO+); SQL compare-and-sets the owner the person saw and shares a sandwich or a prep recipe
--       with exactly the shop-only items it makes and SKUs it uses, named by the person.
--   (6) Privilege ceilings, asserted both ways.
--
-- LOCK ORDER (0262 (7a)): the graph lock 7258025800 → the target rows → anything else. Every writer here that
-- touches recipes takes the graph lock first.
--
-- VERIFY (after apply):
--   select count(*) from public.recipes where location_id is not null;     -- 0
--   select count(*) from public.menu_items where location_id is not null;  -- 0
--   select count(*) from public.items where location_id is not null;       -- unchanged (the templates' shop items)
--   select has_function_privilege('authenticated', 'public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid)', 'execute');  -- false
--   select count(*) from pg_trigger where tgname = 'recipe_version_lines_owner_law';  -- 1
--   select has_function_privilege('service_role', 'public.save_owned_recipe_version(uuid, uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb)', 'execute');  -- true

begin;

-- ── (1) ownership ───────────────────────────────────────────────────────────────
alter table public.recipes    add column if not exists location_id uuid null references public.locations(id);
alter table public.menu_items add column if not exists location_id uuid null references public.locations(id);
create index if not exists recipes_owner_idx    on public.recipes(location_id)    where location_id is not null;
create index if not exists menu_items_owner_idx on public.menu_items(location_id) where location_id is not null;

comment on column public.recipes.location_id is
  'The shop this recipe belongs to (0264). NULL = every shop (the house idiom). Set = only that shop sees it: '
  'loadRecipeGraph / loadResolvedRecipeInputs show it only in that shop''s scope (lib/catalog/shop-owned-shared.ts '
  'ownerVisible). A shop-owned recipe makes only menu items owned by the same shop, has no shop versions (its owner '
  'edits it directly) and is set at creation only; MoO+ shares it (share_shop_owned_menu_item).';
comment on column public.menu_items.location_id is
  'The shop this menu item belongs to (0264). NULL = every shop. Set = a sandwich only that shop sells: its own '
  'price is menu_price (no shop overlay), it is linked to Toast only there, never offered to catering, and MoO+ '
  'shares it with every shop (share_shop_owned_menu_item).';

alter table public.menu_items drop constraint if exists menu_items_owned_not_catering;
alter table public.menu_items add constraint menu_items_owned_not_catering
  check (location_id is null or not catering_available);

-- ── (2) the ownership law ───────────────────────────────────────────────────────
create or replace function public.shop_owner_set_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- An owner is SET at creation (the INSERT), or by the one writer that creates a sandwich and names the row it
  -- assigns in the transaction-local setting co.shop_owner_assign. Afterwards it may only be CLEARED (sharing).
  if new.location_id is not null and new.location_id is distinct from old.location_id
     and coalesce(current_setting('co.shop_owner_assign', true), '') <> new.id::text then
    raise exception 'shop_owned:owner_is_set_at_creation' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists recipes_owner_set on public.recipes;
create trigger recipes_owner_set
  before update of location_id on public.recipes
  for each row execute function public.shop_owner_set_trg();
drop trigger if exists menu_items_owner_set on public.menu_items;
create trigger menu_items_owner_set
  before update of location_id on public.menu_items
  for each row execute function public.shop_owner_set_trg();

create or replace function public.recipe_owner_law(p_recipe uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  select r.location_id into v_owner from public.recipes r where r.id = p_recipe;
  if not found then
    return;
  end if;
  if v_owner is not null then
    -- What it makes: only its own shop's items and menu items.
    if exists (select 1 from public.recipe_outputs o join public.items i on i.id = o.output_item_id
                where o.recipe_id = p_recipe and i.location_id is distinct from v_owner)
       or exists (select 1 from public.recipe_outputs o join public.menu_items m on m.id = o.output_menu_item_id
                   where o.recipe_id = p_recipe and m.location_id is distinct from v_owner) then
      raise exception 'shop_owned:output_other_shop' using errcode = 'P0001';
    end if;
    -- What it uses: shared things, or its own shop's — never another shop's own item or SKU.
    if exists (select 1 from public.recipe_inputs ri
                 left join public.items i on i.id = ri.component_item_id
                 left join public.vendor_items vi on vi.id = ri.component_sku_id
                where ri.recipe_id = p_recipe
                  and ((i.location_id is not null and i.location_id <> v_owner)
                       or (vi.location_id is not null and vi.location_id <> v_owner))) then
      raise exception 'shop_owned:line_other_shop' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.recipe_outputs o join public.menu_items m on m.id = o.output_menu_item_id
                 where o.recipe_id = p_recipe and m.location_id is not null) then
    raise exception 'shop_owned:global_recipe_makes_shop_item' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.recipe_outputs_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recipe_owner_law(new.recipe_id);
  return null;
end;
$$;

create or replace function public.recipe_inputs_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recipe_owner_law(new.recipe_id);
  return null;
end;
$$;

create or replace function public.items_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe uuid;
begin
  -- An item a shop's own recipe makes may not be shared or moved alone (the recipe would make another shop's item).
  for v_recipe in select distinct o.recipe_id from public.recipe_outputs o where o.output_item_id = new.id loop
    perform public.recipe_owner_law(v_recipe);
  end loop;
  return null;
end;
$$;

create or replace function public.recipes_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recipe_owner_law(new.id);
  return null;
end;
$$;

create or replace function public.menu_items_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe uuid;
begin
  for v_recipe in select distinct o.recipe_id from public.recipe_outputs o where o.output_menu_item_id = new.id loop
    perform public.recipe_owner_law(v_recipe);
  end loop;
  return null;
end;
$$;

-- DEFERRED to COMMIT: a sandwich is written as a menu item, a recipe, its outputs and then its owner — the law is
-- judged on the transaction's final rows, whatever order its statements ran in.
drop trigger if exists recipe_outputs_owner_law on public.recipe_outputs;
create constraint trigger recipe_outputs_owner_law
  after insert or update on public.recipe_outputs
  deferrable initially deferred
  for each row execute function public.recipe_outputs_owner_trg();
drop trigger if exists recipe_inputs_owner_law on public.recipe_inputs;
create constraint trigger recipe_inputs_owner_law
  after insert or update on public.recipe_inputs
  deferrable initially deferred
  for each row execute function public.recipe_inputs_owner_trg();
drop trigger if exists items_owner_law on public.items;
create constraint trigger items_owner_law
  after update of location_id on public.items
  deferrable initially deferred
  for each row execute function public.items_owner_trg();
drop trigger if exists recipes_owner_law on public.recipes;
create constraint trigger recipes_owner_law
  after insert or update of location_id on public.recipes
  deferrable initially deferred
  for each row execute function public.recipes_owner_trg();
drop trigger if exists menu_items_owner_law on public.menu_items;
create constraint trigger menu_items_owner_law
  after update of location_id on public.menu_items
  deferrable initially deferred
  for each row execute function public.menu_items_owner_trg();

create or replace function public.recipe_versions_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- The journal's GLOBAL versions of an owned recipe are its own history (allowed); a SHOP version is not.
  if new.location_id is not null
     and exists (select 1 from public.recipes r where r.id = new.recipe_id and r.location_id is not null) then
    raise exception 'shop_owned:recipe_has_no_shop_versions' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists recipe_versions_owner on public.recipe_versions;
create trigger recipe_versions_owner
  before insert on public.recipe_versions
  for each row execute function public.recipe_versions_owner_trg();

create or replace function public.menu_item_shop_settings_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (select 1 from public.menu_items m where m.id = new.menu_item_id and m.location_id is not null) then
    raise exception 'shop_owned:menu_item_has_no_shop_settings' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists menu_item_shop_settings_owner on public.menu_item_shop_settings;
create trigger menu_item_shop_settings_owner
  before insert on public.menu_item_shop_settings
  for each row execute function public.menu_item_shop_settings_owner_trg();

create or replace function public.toast_menu_map_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.menu_item_id is not null and new.active
     and exists (select 1 from public.menu_items m
                  where m.id = new.menu_item_id and m.location_id is not null and m.location_id is distinct from new.location_id) then
    raise exception 'shop_owned:toast_other_shop' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists toast_menu_map_owner on public.toast_menu_map;
create trigger toast_menu_map_owner
  before insert or update on public.toast_menu_map
  for each row execute function public.toast_menu_map_owner_trg();

-- A SHOP version of a SHARED recipe names only shared things or that shop's own (decision (a), Astra round 1). Every
-- line of a version is (re)inserted by 0262's writers, so the check sits on the line: the version row (inserted first,
-- FK-proven) says which shop. The DEFAULT's lines (location null) are not judged here — a shared recipe's default is
-- MoO's, and a shop-owned recipe's default is judged by recipe_owner_law.
create or replace function public.recipe_version_lines_owner_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shop uuid;
begin
  select v.location_id into v_shop from public.recipe_versions v where v.id = new.version_id;
  if v_shop is null then
    return new;
  end if;
  if exists (select 1 from public.vendor_items vi
              where vi.id = new.component_sku_id and vi.location_id is not null and vi.location_id <> v_shop)
     or exists (select 1 from public.items i
                 where i.id = new.component_item_id and i.location_id is not null and i.location_id <> v_shop) then
    raise exception 'recipe_version:line_other_shop' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists recipe_version_lines_owner_law on public.recipe_version_lines;
create trigger recipe_version_lines_owner_law
  before insert or update of version_id, component_sku_id, component_item_id on public.recipe_version_lines
  for each row execute function public.recipe_version_lines_owner_trg();

-- ── (2b) save_owned_recipe_version — the owner's own edit, bound to that owner ───
create or replace function public.save_owned_recipe_version(
  p_expected_owner uuid,
  p_recipe         uuid,
  p_location       uuid,
  p_lines          jsonb,
  p_expected       uuid,
  p_based_on       uuid,
  p_note           text,
  p_actor          uuid,
  p_restored_from  uuid,
  p_adopted_from   uuid,
  p_promoted_from  uuid,
  p_snapshot       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  -- Only the DEFAULT of an owned recipe is written this way (an owned recipe has no shop versions).
  if p_expected_owner is null or p_location is not null then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  -- 0262's order: the graph lock, then the recipe row. share_shop_owned_menu_item / _recipe take the same graph lock,
  -- so a share either committed before this line (and the compare below sees it) or waits for this transaction.
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.recipes where id = p_recipe and active for update;
  if not found then
    raise exception 'shop_owned:not_found' using errcode = 'P0001';
  end if;
  if v_owner is distinct from p_expected_owner then
    raise exception 'shop_owned:ownership_changed' using errcode = 'P0001';
  end if;
  -- The same transaction, 0262's own writer (it re-takes both locks — re-entrant — and its snapshot check).
  return public.save_recipe_version(p_recipe, null, p_lines, p_expected, p_based_on, p_note, p_actor,
                                    p_restored_from, p_adopted_from, p_promoted_from, p_snapshot);
end;
$$;

-- ── (3) create_shop_recipe ──────────────────────────────────────────────────────
create or replace function public.create_shop_recipe(
  p_location   uuid,
  p_header     jsonb,
  p_inputs     jsonb,
  p_outputs    jsonb,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe uuid;
begin
  -- The graph lock FIRST (0258's order); create_recipe_full takes it again (re-entrant).
  perform pg_advisory_xact_lock(7258025800);
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'shop_owned:location_not_found' using errcode = 'P0001';
  end if;
  -- 0262's create_recipe_full: header, lines, outputs, the producer and cycle checks, the journal at COMMIT.
  v_recipe := public.create_recipe_full(p_header, p_inputs, p_outputs, p_created_by);
  -- The owner, assigned by THIS writer in THIS transaction (shop_owner_set_trg reads the setting). The ownership law
  -- (deferred) then judges its outputs and lines at COMMIT.
  perform set_config('co.shop_owner_assign', v_recipe::text, true);
  update public.recipes set location_id = p_location where id = v_recipe;
  perform set_config('co.shop_owner_assign', '', true);
  return v_recipe;
end;
$$;

-- ── (3) create_shop_sandwich ────────────────────────────────────────────────────
create or replace function public.create_shop_sandwich(
  p_location uuid,
  p_name     text,
  p_name_es  text,
  p_section  text,
  p_price    numeric,
  p_inputs   jsonb,
  p_yield    numeric,
  p_actor    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_name_es text := nullif(btrim(coalesce(p_name_es, '')), '');
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_menu    uuid;
  v_recipe  uuid;
begin
  -- The graph lock FIRST (0258's order): this adds a recipe, and the name check below must see every concurrent
  -- sandwich create (each takes the same lock).
  perform pg_advisory_xact_lock(7258025800);
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'shop_owned:location_not_found' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 1 and 120 or (v_name_es is not null and char_length(v_name_es) > 120) then
    raise exception 'shop_owned:invalid_name' using errcode = 'P0001';
  end if;
  if p_price is not null and not (p_price > 0 and p_price <= 1000) then
    raise exception 'shop_owned:invalid_price' using errcode = 'P0001';
  end if;
  if p_yield is null or p_yield <= 0 then
    raise exception 'shop_owned:invalid_yield' using errcode = 'P0001';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) = 0 then
    raise exception 'shop_owned:incomplete_recipe' using errcode = 'P0001';
  end if;
  -- ONE NAME PER SHOP'S MENU: an active menu item this shop sells by that name — shared, or its own — refuses.
  -- Another shop's own sandwich may share the name (it is never on this shop's menu).
  if exists (select 1 from public.menu_items m
              where m.active and lower(btrim(m.name)) = lower(v_name)
                and (m.location_id is null or m.location_id = p_location)) then
    raise exception 'shop_owned:name_taken' using errcode = 'P0001';
  end if;

  insert into public.menu_items (name, name_es, section, menu_price, active, catering_available, location_id, created_by)
  values (v_name, v_name_es, v_section, p_price, true, false, p_location, p_actor)
  returning id into v_menu;

  -- The recipe, owned by the shop (create_shop_recipe → 0262's create_recipe_full): lines, the one menu output, the journal.
  v_recipe := public.create_shop_recipe(p_location,
    jsonb_build_object('name', v_name, 'name_es', v_name_es, 'recipe_type', 'consumer', 'batch_yield', 1),
    p_inputs,
    jsonb_build_array(jsonb_build_object('output_menu_item_id', v_menu, 'yield', p_yield)),
    p_actor);

  return jsonb_build_object('menu_item_id', v_menu, 'recipe_id', v_recipe, 'location_id', p_location);
end;
$$;

-- ── (4) create_catalog_sku ──────────────────────────────────────────────────────
create or replace function public.create_catalog_sku(
  p_sku        jsonb,
  p_levels     jsonb,
  p_unit_price numeric,
  p_price_date date,
  p_actor      uuid,
  p_first_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name   text := btrim(coalesce(p_sku->>'name', ''));
  v_number text := nullif(btrim(coalesce(p_sku->>'item_number', '')), '');
  v_vendor uuid := nullif(p_sku->>'vendor_id', '')::uuid;
  v_loc    uuid := nullif(p_sku->>'location_id', '')::uuid;
  v_id     uuid;
  v_pack   jsonb;
  v_price  jsonb := null;
begin
  if char_length(v_name) not between 1 and 200 then
    raise exception 'shop_owned:invalid_name' using errcode = 'P0001';
  end if;
  if v_vendor is not null and not exists (select 1 from public.vendors where id = v_vendor and active) then
    raise exception 'shop_owned:vendor_not_found' using errcode = 'P0001';
  end if;
  if v_loc is not null and not exists (select 1 from public.locations where id = v_loc and active) then
    raise exception 'shop_owned:location_not_found' using errcode = 'P0001';
  end if;
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) = 0 then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  if p_unit_price is not null and (not (p_unit_price > 0) or p_price_date is null) then
    raise exception 'shop_owned:invalid_price' using errcode = 'P0001';
  end if;
  -- ONE ITEM NUMBER PER VENDOR, among the items this shop could see: the same vendor number twice is the same thing.
  -- SERIALIZED (Astra round 1 #8): every create of this (vendor, number) — for any shop or for every shop — takes the
  -- same transaction lock BEFORE it looks, so two concurrent creates cannot both pass the check; the second sees the
  -- first's committed row. (The legacy SKU form, the SKU edit and the vendor import do not take it — judgment call 16.)
  if v_vendor is not null and v_number is not null then
    perform pg_advisory_xact_lock(hashtextextended('co.catalog_sku_number:' || v_vendor::text || ':' || lower(v_number), 0));
  end if;
  if v_vendor is not null and v_number is not null and exists (
       select 1 from public.vendor_items vi
        where vi.vendor_id = v_vendor and vi.active and lower(btrim(vi.item_number)) = lower(v_number)
          and (vi.location_id is null or v_loc is null or vi.location_id = v_loc)) then
    raise exception 'shop_owned:item_number_taken' using errcode = 'P0001';
  end if;

  -- pack_format is a placeholder: the first GLOBAL pack version below mirrors the flat fields from its root (0259).
  insert into public.vendor_items (vendor_id, location_id, name, pack_format, item_number, avg_oz_per_each, sku_class,
                                   active, created_by, updated_by)
  values (v_vendor, v_loc, v_name, 'Each (no case)', v_number, nullif(p_sku->>'avg_oz_per_each', '')::numeric,
          coalesce(nullif(p_sku->>'sku_class', ''), 'raw'), true, p_actor, p_actor)
  returning id into v_id;

  -- 2a's writers, under THEIR locks and checks: the first pack version (first-only below MoO; trivially first) and
  -- the first price. Any refusal rolls the SKU back with them — no SKU without its pack.
  v_pack := public.save_sku_pack_version(v_id, null, p_levels, null, null, 'New item', p_actor, p_first_only);
  if p_unit_price is not null then
    v_price := public.save_sku_global_price(v_id, p_unit_price, p_price_date, p_actor, p_first_only);
  end if;

  return jsonb_build_object('sku_id', v_id, 'location_id', v_loc, 'pack', v_pack, 'price', v_price);
end;
$$;

-- ── (5) sharing ─────────────────────────────────────────────────────────────────
create or replace function public.share_shop_owned_menu_item(
  p_menu_item      uuid,
  p_expected_owner uuid,
  p_share_skus     uuid[],
  p_actor          uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner   uuid;
  v_recipes uuid[];
  v_skus    uuid[];
  v_named   uuid[];
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.menu_items where id = p_menu_item and active for update;
  if not found then
    raise exception 'shop_owned:not_found' using errcode = 'P0001';
  end if;
  if v_owner is null then
    raise exception 'shop_owned:already_shared' using errcode = 'P0001';
  end if;
  if v_owner is distinct from p_expected_owner then
    raise exception 'shop_owned:ownership_changed' using errcode = 'P0001';
  end if;

  v_recipes := array(select r.id from public.recipes r
                      where r.id in (select o.recipe_id from public.recipe_outputs o where o.output_menu_item_id = p_menu_item)
                      order by r.id);
  perform 1 from public.recipes where id = any(v_recipes) order by id for update;

  -- A shop-only SKU of ANOTHER shop in this sandwich: sharing cannot decide for that shop.
  if exists (select 1 from public.recipe_inputs ri join public.vendor_items vi on vi.id = ri.component_sku_id
              where ri.recipe_id = any(v_recipes) and vi.location_id is not null and vi.location_id <> v_owner) then
    raise exception 'shop_owned:uses_other_shop_sku' using errcode = 'P0001';
  end if;
  -- One of the shop's own ITEMS in it: share that item's recipe first (share_shop_owned_recipe), so every shop that
  -- gets this sandwich can also make what it uses.
  if exists (select 1 from public.recipe_inputs ri join public.items i on i.id = ri.component_item_id
              where ri.recipe_id = any(v_recipes) and i.location_id is not null) then
    raise exception 'shop_owned:uses_shop_only_item' using errcode = 'P0001';
  end if;
  -- This shop's own SKUs the recipes use are shared in the SAME act — exactly the set the person was shown.
  v_skus := array(select distinct vi.id from public.recipe_inputs ri join public.vendor_items vi on vi.id = ri.component_sku_id
                   where ri.recipe_id = any(v_recipes) and vi.location_id = v_owner order by vi.id);
  v_named := array(select distinct s from unnest(coalesce(p_share_skus, '{}'::uuid[])) s order by s);
  if v_skus is distinct from v_named then
    raise exception 'shop_owned:skus_changed' using errcode = 'P0001';
  end if;

  perform 1 from public.vendor_items where id = any(v_skus) order by id for update;
  update public.vendor_items set location_id = null, updated_by = p_actor where id = any(v_skus);
  update public.recipes set location_id = null where id = any(v_recipes);
  update public.menu_items set location_id = null, updated_at = now(), updated_by = p_actor where id = p_menu_item;

  return jsonb_build_object('menu_item_id', p_menu_item, 'from_location_id', v_owner,
                            'recipe_ids', to_jsonb(v_recipes), 'sku_ids', to_jsonb(v_skus));
end;
$$;

create or replace function public.share_shop_owned_recipe(
  p_recipe         uuid,
  p_expected_owner uuid,
  p_share_items    uuid[],
  p_share_skus     uuid[],
  p_actor          uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_items uuid[];
  v_skus  uuid[];
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.recipes where id = p_recipe and active for update;
  if not found then
    raise exception 'shop_owned:not_found' using errcode = 'P0001';
  end if;
  if v_owner is null then
    raise exception 'shop_owned:already_shared' using errcode = 'P0001';
  end if;
  if v_owner is distinct from p_expected_owner then
    raise exception 'shop_owned:ownership_changed' using errcode = 'P0001';
  end if;
  -- A recipe that makes a sandwich is shared WITH it (share_shop_owned_menu_item).
  if exists (select 1 from public.recipe_outputs where recipe_id = p_recipe and output_menu_item_id is not null) then
    raise exception 'shop_owned:share_the_sandwich' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.recipe_inputs ri join public.vendor_items vi on vi.id = ri.component_sku_id
              where ri.recipe_id = p_recipe and vi.location_id is not null and vi.location_id <> v_owner) then
    raise exception 'shop_owned:uses_other_shop_sku' using errcode = 'P0001';
  end if;
  -- One of the shop's own items as an INPUT: share that item's recipe first.
  if exists (select 1 from public.recipe_inputs ri join public.items i on i.id = ri.component_item_id
              where ri.recipe_id = p_recipe and i.location_id is not null) then
    raise exception 'shop_owned:uses_shop_only_item' using errcode = 'P0001';
  end if;
  -- What goes with it — exactly the sets the person was shown: the items it makes, the shop's SKUs it uses.
  v_items := array(select distinct o.output_item_id from public.recipe_outputs o join public.items i on i.id = o.output_item_id
                    where o.recipe_id = p_recipe and i.location_id = v_owner order by 1);
  if v_items is distinct from array(select distinct s from unnest(coalesce(p_share_items, '{}'::uuid[])) s order by s) then
    raise exception 'shop_owned:items_changed' using errcode = 'P0001';
  end if;
  v_skus := array(select distinct vi.id from public.recipe_inputs ri join public.vendor_items vi on vi.id = ri.component_sku_id
                   where ri.recipe_id = p_recipe and vi.location_id = v_owner order by vi.id);
  if v_skus is distinct from array(select distinct s from unnest(coalesce(p_share_skus, '{}'::uuid[])) s order by s) then
    raise exception 'shop_owned:skus_changed' using errcode = 'P0001';
  end if;
  perform 1 from public.items where id = any(v_items) order by id for update;
  perform 1 from public.vendor_items where id = any(v_skus) order by id for update;
  update public.items set location_id = null, updated_by = p_actor, updated_at = now() where id = any(v_items);
  update public.vendor_items set location_id = null, updated_by = p_actor where id = any(v_skus);
  update public.recipes set location_id = null where id = p_recipe;
  return jsonb_build_object('recipe_id', p_recipe, 'from_location_id', v_owner, 'item_ids', to_jsonb(v_items), 'sku_ids', to_jsonb(v_skus));
end;
$$;

create or replace function public.share_shop_owned_sku(
  p_sku            uuid,
  p_expected_owner uuid,
  p_actor          uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  select location_id into v_owner from public.vendor_items where id = p_sku and active for update;
  if not found then
    raise exception 'shop_owned:not_found' using errcode = 'P0001';
  end if;
  if v_owner is null then
    raise exception 'shop_owned:already_shared' using errcode = 'P0001';
  end if;
  if v_owner is distinct from p_expected_owner then
    raise exception 'shop_owned:ownership_changed' using errcode = 'P0001';
  end if;
  -- The owner's own pack / price versions stay its own (2a); every other shop now rides the global default.
  update public.vendor_items set location_id = null, updated_by = p_actor where id = p_sku;
  return jsonb_build_object('sku_id', p_sku, 'from_location_id', v_owner);
end;
$$;

-- ── (6) privilege ceilings ──────────────────────────────────────────────────────
revoke all on function public.shop_owner_set_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipe_owner_law(uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_outputs_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipe_inputs_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.items_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipes_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.menu_items_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipe_versions_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.menu_item_shop_settings_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.toast_menu_map_owner_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipe_version_lines_owner_trg() from public, anon, authenticated, service_role;

revoke all on function public.save_owned_recipe_version(uuid, uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid) from public, anon, authenticated;
revoke all on function public.create_shop_recipe(uuid, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.share_shop_owned_recipe(uuid, uuid, uuid[], uuid[], uuid) from public, anon, authenticated;
revoke all on function public.create_catalog_sku(jsonb, jsonb, numeric, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.share_shop_owned_menu_item(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.share_shop_owned_sku(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_owned_recipe_version(uuid, uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid) to service_role;
grant execute on function public.create_shop_recipe(uuid, jsonb, jsonb, jsonb, uuid) to service_role;
grant execute on function public.share_shop_owned_recipe(uuid, uuid, uuid[], uuid[], uuid) to service_role;
grant execute on function public.create_catalog_sku(jsonb, jsonb, numeric, date, uuid, boolean) to service_role;
grant execute on function public.share_shop_owned_menu_item(uuid, uuid, uuid[], uuid) to service_role;
grant execute on function public.share_shop_owned_sku(uuid, uuid, uuid) to service_role;

do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.save_owned_recipe_version(uuid, uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb)',
    'public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid)',
    'public.create_shop_recipe(uuid, jsonb, jsonb, jsonb, uuid)',
    'public.create_catalog_sku(jsonb, jsonb, numeric, date, uuid, boolean)',
    'public.share_shop_owned_menu_item(uuid, uuid, uuid[], uuid)',
    'public.share_shop_owned_recipe(uuid, uuid, uuid[], uuid[], uuid)',
    'public.share_shop_owned_sku(uuid, uuid, uuid)'
  ] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0264: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '0264: % can execute %', r, f;
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.shop_owner_set_trg()', 'public.recipe_owner_law(uuid)', 'public.recipe_outputs_owner_trg()',
    'public.recipe_inputs_owner_trg()', 'public.items_owner_trg()',
    'public.recipes_owner_trg()', 'public.menu_items_owner_trg()', 'public.recipe_versions_owner_trg()',
    'public.menu_item_shop_settings_owner_trg()', 'public.toast_menu_map_owner_trg()', 'public.recipe_version_lines_owner_trg()'
  ] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '0264: % can execute helper %', r, f;
      end if;
    end loop;
  end loop;
end $$;

commit;
```

- [ ] **Step 3: Export the 3a PGlite stub**

In `tests/fixtures/recipe-versions-pglite.ts`, replace `const STUB = \`` with `export const STUB = \``. Nothing else changes.

- [ ] **Step 4: Create `tests/fixtures/shop-owned-pglite.ts`**

```ts
/**
 * Catalog Phase 4a — 0258 + 0262 + 0264 AS COMMITTED, in PGlite, over 3a's stub base tables plus the columns
 * 0264's writers touch (create_recipe_full's header and output columns, the menu item's catering flag, the
 * Toast map, a minimal shop overlay table). Every row a test reads was written by a real writer or trigger.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STUB } from "./recipe-versions-pglite";

const EXTRA = `
  alter table public.recipes add column name_es text, add column recipe_type text, add column directions text,
    add column directions_es text, add column created_by uuid, add column batch_mode boolean not null default false,
    add column shelf_life_days integer not null default 5;
  alter table public.recipe_outputs add column output_container_label text, add column display_order integer not null default 0,
    add column created_by uuid;
  alter table public.menu_items add column name_es text, add column section text, add column menu_price numeric,
    add column catering_available boolean not null default false, add column created_by uuid,
    add column updated_at timestamptz not null default now(), add column updated_by uuid;
  alter table public.vendor_items add column location_id uuid, add column updated_by uuid, add column item_number text;
  alter table public.items add column location_id uuid, add column updated_by uuid, add column updated_at timestamptz not null default now();
  -- 0179's product identity, as far as 0265's swap writes it (Task 4).
  alter table public.products alter column id set default gen_random_uuid(), add column name_es text, add column notes text,
    add column created_by uuid, add column updated_by uuid;
  create unique index products_active_name_uq on public.products (lower(name)) where active;
  alter table public.vendor_items add constraint vendor_items_id_product_uq unique (id, product_id);
  alter table public.product_primaries add column note text, add column updated_by uuid,
    add column updated_at timestamptz not null default now();
  alter table public.product_primaries add constraint product_primaries_scope_uq unique nulls not distinct (product_id, location_id);
  alter table public.product_primaries add constraint product_primaries_member_fk
    foreign key (primary_sku_id, product_id) references public.vendor_items(id, product_id);
  create table public.menu_item_shop_settings(id uuid primary key default gen_random_uuid(),
    menu_item_id uuid references public.menu_items(id), location_id uuid, price numeric, sold_here boolean not null default true,
    active boolean not null default true);
  create table public.toast_menu_map(id uuid primary key default gen_random_uuid(), location_id uuid,
    menu_item_id uuid references public.menu_items(id), item_id uuid, toast_item_guid text, active boolean not null default true);
`;

export const OWN = {
  actor: "00000000-0000-4000-8000-0000000000a1",
  shopA: "00000000-0000-4000-8000-00000000a0a0",
  shopB: "00000000-0000-4000-8000-00000000b0b0",
  turkey: "00000000-0000-4000-8000-0000000000d1",
  localPickles: "00000000-0000-4000-8000-0000000000d2", // owned by shop A
  otherShopSku: "00000000-0000-4000-8000-0000000000d3", // owned by shop B
  sharedMenu: "00000000-0000-4000-8000-0000000000f1",
  sharedRecipe: "00000000-0000-4000-8000-0000000000e1",
  newTurkey: "00000000-0000-4000-8000-0000000000d4", // the replacement a swap moves to (Task 4)
} as const;

/** Stub → 0258 → 0262 → 0264 (→ 0265 with `swaps`, → 0266 with `drop`), as committed; two shops, shared and shop-owned SKUs, one shared sandwich. */
export async function migratedShopOwnedDb(opts: { swaps?: boolean; drop?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(EXTRA);
  const files = ["0258_recipe_input_write_atomic.sql", "0262_recipe_shop_versions.sql", "0264_catalog_shop_owned.sql",
    ...(opts.swaps ? ["0265_sku_swaps.sql"] : []), ...(opts.drop ? ["0266_drop_recipe_input_16arg.sql"] : [])];
  for (const m of files) {
    await db.exec(readFileSync(`supabase/migrations/${m}`, "utf8"));
  }
  await db.exec(`
    insert into public.users(id) values ('${OWN.actor}');
    insert into public.locations(id, name, active) values ('${OWN.shopA}', 'Shop A', true), ('${OWN.shopB}', 'Shop B', true);
    insert into public.measure_units(label, dimension, to_base_factor, active) values ('oz', 'weight', 1, true);
    insert into public.vendor_items(id, name, location_id) values
      ('${OWN.turkey}', 'Turkey', null), ('${OWN.localPickles}', 'Local pickles', '${OWN.shopA}'), ('${OWN.otherShopSku}', 'B relish', '${OWN.shopB}'),
      ('${OWN.newTurkey}', 'Turkey (new vendor)', null);
    insert into public.menu_items(id, name) values ('${OWN.sharedMenu}', 'Italian');
    begin;
    insert into public.recipes(id, name, recipe_type, batch_yield) values ('${OWN.sharedRecipe}', 'Italian', 'consumer', 1);
    insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ('${OWN.sharedRecipe}', '${OWN.turkey}', 4, 'oz');
    insert into public.recipe_outputs(recipe_id, output_menu_item_id, yield) values ('${OWN.sharedRecipe}', '${OWN.sharedMenu}', 1);
    commit;
  `);
  return db;
}

export const sandwichLines = (...skus: string[]) =>
  JSON.stringify(skus.map((s, i) => ({ component_sku_id: s, quantity: 2, unit: "oz", portioned: false, display_order: i })));

/** The REAL create_shop_sandwich. */
export async function createSandwich(db: PGlite, shop: string, name: string, skus: string[] = [OWN.turkey]): Promise<{ menu: string; recipe: string }> {
  const r = await db.query<{ v: { menu_item_id: string; recipe_id: string } }>(
    `select public.create_shop_sandwich($1::uuid, $2, null, 'Subs', 11.5, $3::jsonb, 1, $4::uuid) as v`,
    [shop, name, sandwichLines(...skus), OWN.actor]);
  return { menu: r.rows[0]!.v.menu_item_id, recipe: r.rows[0]!.v.recipe_id };
}

/** The message a failing statement raised (PGlite rejects with the server error). */
export async function refusal(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as Error).message; }
  return "(no error)";
}
```

- [ ] **Step 5: Write `tests/shop-owned-pglite.test.ts`**

```ts
/** Catalog Phase 4a — 0264 for real (PGlite): the law, the owner's own edit, the writers, sharing. */
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createSandwich, migratedShopOwnedDb, OWN, refusal, sandwichLines } from "./fixtures/shop-owned-pglite";

let db: PGlite;
beforeEach(async () => { db = await migratedShopOwnedDb(); });

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

describe("(0) 0264 leaves both update_recipe_input_atomic signatures alone (0266 drops the old one later)", () => {
  it("to_regprocedure answers an oid for 16 AND 17 arguments", async () => {
    const r = await one<{ old: string | null; neu: string | null }>(`select
      to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)')::text as old,
      to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)')::text as neu`);
    expect(r.old).not.toBeNull();
    expect(r.neu).not.toBeNull();
  });
});

describe("(3) create_shop_sandwich", () => {
  it("writes an owned menu item and an owned recipe that makes it, journaled like any recipe", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    const menu = await one<{ location_id: string; catering_available: boolean; menu_price: string }>(
      `select location_id, catering_available, menu_price from public.menu_items where id = $1`, [s.menu]);
    expect(menu).toMatchObject({ location_id: OWN.shopA, catering_available: false });
    expect(Number(menu.menu_price)).toBe(11.5);
    expect((await one<{ location_id: string }>(`select location_id from public.recipes where id = $1`, [s.recipe])).location_id).toBe(OWN.shopA);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [s.recipe])).n).toBe(1);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_inputs where recipe_id = $1`, [s.recipe])).n).toBe(1);
  });
  it("one name per shop's menu: a shared item's name or the shop's own refuses; another shop may reuse it", async () => {
    expect(await refusal(createSandwich(db, OWN.shopA, "italian"))).toContain("shop_owned:name_taken");
    await createSandwich(db, OWN.shopA, "Local Hero");
    expect(await refusal(createSandwich(db, OWN.shopA, "Local hero "))).toContain("shop_owned:name_taken");
    await expect(createSandwich(db, OWN.shopB, "Local Hero")).resolves.toBeDefined();
  });
  it("refuses an empty recipe, a bad price and an inactive shop", async () => {
    expect(await refusal(db.query(`select public.create_shop_sandwich($1::uuid, 'X', null, null, 5, '[]'::jsonb, 1, $2::uuid)`, [OWN.shopA, OWN.actor])))
      .toContain("shop_owned:incomplete_recipe");
    expect(await refusal(db.query(`select public.create_shop_sandwich($1::uuid, 'X', null, null, 0, $2::jsonb, 1, $3::uuid)`, [OWN.shopA, sandwichLines(OWN.turkey), OWN.actor])))
      .toContain("shop_owned:invalid_price");
    await db.exec(`update public.locations set active = false where id = '${OWN.shopB}'`);
    expect(await refusal(createSandwich(db, OWN.shopB, "Y"))).toContain("shop_owned:location_not_found");
  });
});

describe("(2) the ownership law", () => {
  it("an owned recipe makes only its shop's own things — never a shared item, nor another shop's sandwich (judged at COMMIT)", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    await db.exec(`insert into public.items(id, name) values ('00000000-0000-4000-8000-00000000c0c0', 'Slaw')`);
    expect(await refusal(db.exec(`begin; insert into public.recipe_outputs(recipe_id, output_item_id, yield)
      values ('${s.recipe}', '00000000-0000-4000-8000-00000000c0c0', 1); commit;`))).toContain("shop_owned:output_other_shop");
    await db.exec("rollback").catch(() => undefined);
    const b = await createSandwich(db, OWN.shopB, "B special");
    expect(await refusal(db.exec(`begin; insert into public.recipe_outputs(recipe_id, output_menu_item_id, yield)
      values ('${s.recipe}', '${b.menu}', 1); commit;`))).toContain("shop_owned:output_other_shop");
    await db.exec("rollback").catch(() => undefined);
  });
  it("a GM's prep recipe (lead decision 1): owned, makes its shop's own item, may not use another shop's own item", async () => {
    await db.exec(`insert into public.items(id, name, location_id) values
      ('00000000-0000-4000-8000-0000000000c1', 'A slaw', '${OWN.shopA}'), ('00000000-0000-4000-8000-0000000000c2', 'B pickle', '${OWN.shopB}'),
      ('00000000-0000-4000-8000-0000000000c5', 'A salad', '${OWN.shopA}')`);
    const ok = await one<{ id: string }>(`select public.create_shop_recipe($1::uuid,
      '{"name":"A slaw","recipe_type":"production","batch_yield":1}'::jsonb,
      jsonb_build_array(jsonb_build_object('component_sku_id', $2::uuid, 'quantity', 4, 'unit', 'oz')),
      '[{"output_item_id":"00000000-0000-4000-8000-0000000000c1","yield":2}]'::jsonb, $3::uuid) as id`, [OWN.shopA, OWN.localPickles, OWN.actor]);
    expect((await one<{ location_id: string }>(`select location_id from public.recipes where id = $1`, [ok.id])).location_id).toBe(OWN.shopA);
    expect(await refusal(db.query(`select public.create_shop_recipe($1::uuid,
      '{"name":"Bad","recipe_type":"production","batch_yield":1}'::jsonb,
      '[{"component_item_id":"00000000-0000-4000-8000-0000000000c2","quantity":1,"unit":"oz"}]'::jsonb,
      '[{"output_item_id":"00000000-0000-4000-8000-0000000000c5","yield":1}]'::jsonb, $2::uuid)`, [OWN.shopA, OWN.actor]))).toContain("shop_owned:line_other_shop");
  });
  it("an item a shop's own recipe makes is never shared alone", async () => {
    await db.exec(`insert into public.items(id, name, location_id) values ('00000000-0000-4000-8000-0000000000c3', 'A dressing', '${OWN.shopA}')`);
    await db.query(`select public.create_shop_recipe($1::uuid, '{"name":"A dressing","recipe_type":"production","batch_yield":1}'::jsonb,
      jsonb_build_array(jsonb_build_object('component_sku_id', $2::uuid, 'quantity', 1, 'unit', 'oz')),
      '[{"output_item_id":"00000000-0000-4000-8000-0000000000c3","yield":1}]'::jsonb, $3::uuid)`, [OWN.shopA, OWN.turkey, OWN.actor]);
    expect(await refusal(db.query(`update public.items set location_id = null where id = '00000000-0000-4000-8000-0000000000c3'`)))
      .toContain("shop_owned:output_other_shop");
  });
  it("a shared recipe may not make a shop's sandwich", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    expect(await refusal(db.exec(`begin; insert into public.recipe_outputs(recipe_id, output_menu_item_id, yield)
      values ('${OWN.sharedRecipe}', '${s.menu}', 1); commit;`))).toContain("shop_owned:global_recipe_makes_shop_item");
    await db.exec("rollback").catch(() => undefined);
  });
  it("an owner is never moved, and never set after creation", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    expect(await refusal(db.query(`update public.menu_items set location_id = $1 where id = $2`, [OWN.shopB, s.menu]))).toContain("shop_owned:owner_is_set_at_creation");
    expect(await refusal(db.query(`update public.recipes set location_id = $1 where id = $2`, [OWN.shopA, OWN.sharedRecipe]))).toContain("shop_owned:owner_is_set_at_creation");
  });
  it("an owned thing has no shop version, no shop overlay, no Toast link at another shop", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    const head = (await one<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [s.recipe])).id;
    const snap = JSON.stringify([{ component_sku_id: OWN.turkey }]);
    expect(await refusal(db.query(
      `select public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, null, $4::uuid, null, $5::uuid, null, null, null,
              public.recipe_change_snapshot($1::uuid, $2::uuid, $6::jsonb))`,
      [s.recipe, OWN.shopA, sandwichLines(OWN.turkey, OWN.turkey), head, OWN.actor, snap]))).toContain("shop_owned:recipe_has_no_shop_versions");
    expect(await refusal(db.query(`insert into public.menu_item_shop_settings(menu_item_id, location_id, price) values ($1, $2, 9)`, [s.menu, OWN.shopA])))
      .toContain("shop_owned:menu_item_has_no_shop_settings");
    expect(await refusal(db.query(`insert into public.toast_menu_map(location_id, menu_item_id, toast_item_guid) values ($1, $2, 'g1')`, [OWN.shopB, s.menu])))
      .toContain("shop_owned:toast_other_shop");
    await expect(db.query(`insert into public.toast_menu_map(location_id, menu_item_id, toast_item_guid) values ($1, $2, 'g1')`, [OWN.shopA, s.menu])).resolves.toBeDefined();
  });
  it("its owner edits the recipe itself: a new GLOBAL version of an owned recipe is allowed", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    const head = (await one<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [s.recipe])).id;
    const snap = JSON.stringify([{ component_sku_id: OWN.turkey }]);
    const v = await one<{ v: { version_id: string } }>(
      `select public.save_recipe_version($1::uuid, null, $2::jsonb, $3::uuid, null, null, $4::uuid, null, null, null,
              public.recipe_change_snapshot($1::uuid, null, $5::jsonb)) as v`,
      [s.recipe, sandwichLines(OWN.turkey, OWN.turkey), head, OWN.actor, snap]);
    expect(v.v.version_id).toBeTruthy();
  });
});

describe("(2) decision (a) — a SHOP version of a SHARED recipe names only shared things or that shop's own", () => {
  const shopVersion = async (shop: string, skus: string[]) => {
    const lines = sandwichLines(...skus);
    const h = (await one<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [OWN.sharedRecipe])).id;
    return db.query(`select public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, null, $4::uuid, null, $5::uuid, null, null, null,
                       public.recipe_change_snapshot($1::uuid, $2::uuid, $3::jsonb))`, [OWN.sharedRecipe, shop, lines, h, OWN.actor]);
  };
  it("Shop B's version may not name Shop A's own SKU — refused, nothing written", async () => {
    expect(await refusal(shopVersion(OWN.shopB, [OWN.turkey, OWN.localPickles]))).toContain("recipe_version:line_other_shop");
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where recipe_id = $1 and location_id = $2`, [OWN.sharedRecipe, OWN.shopB])).n).toBe(0);
  });
  it("Shop B's version may name Shop B's own SKU and shared ones", async () => {
    await expect(shopVersion(OWN.shopB, [OWN.turkey, OWN.otherShopSku])).resolves.toBeDefined();
  });
  it("another shop's own ITEM is refused the same way", async () => {
    await db.exec(`insert into public.items(id, name, location_id) values ('00000000-0000-4000-8000-0000000000c6', 'A only', '${OWN.shopA}')`);
    const h = (await one<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [OWN.sharedRecipe])).id;
    const lines = JSON.stringify([{ component_item_id: "00000000-0000-4000-8000-0000000000c6", quantity: 1, unit: "oz", portioned: false, display_order: 0 }]);
    expect(await refusal(db.query(`select public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, null, $4::uuid, null, $5::uuid, null, null, null,
      public.recipe_change_snapshot($1::uuid, $2::uuid, $3::jsonb))`, [OWN.sharedRecipe, OWN.shopB, lines, h, OWN.actor]))).toContain("recipe_version:line_other_shop");
  });
});

describe("(2b) the owner's own edit is bound to its owner (Astra r1 P1)", () => {
  const ownedEdit = async (recipe: string, expectedOwner: string) => {
    const lines = sandwichLines(OWN.turkey, OWN.turkey);
    const h = (await one<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [recipe])).id;
    return db.query<{ v: { version_id: string } }>(`select public.save_owned_recipe_version($1::uuid, $2::uuid, null, $3::jsonb, $4::uuid, null, null, $5::uuid,
      null, null, null, public.recipe_change_snapshot($2::uuid, null, $3::jsonb)) as v`, [expectedOwner, recipe, lines, h, OWN.actor]);
  };
  it("writes the default when the owner is still the one authorized", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    expect((await ownedEdit(s.recipe, OWN.shopA)).rows[0]!.v.version_id).toBeTruthy();
  });
  it("a share that landed first refuses ownership_changed — the GM's right was the OWNER's, and nothing is written", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    await db.query(`select public.share_shop_owned_menu_item($1::uuid, $2::uuid, '{}'::uuid[], $3::uuid)`, [s.menu, OWN.shopA, OWN.actor]);
    const before = (await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where recipe_id = $1`, [s.recipe])).n;
    expect(await refusal(ownedEdit(s.recipe, OWN.shopA))).toContain("shop_owned:ownership_changed");
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where recipe_id = $1`, [s.recipe])).n).toBe(before);
  });
  it("never a shop version", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero");
    expect(await refusal(db.query(`select public.save_owned_recipe_version($1::uuid, $2::uuid, $1::uuid, '[]'::jsonb, null, null, null, $3::uuid,
      null, null, null, '{}'::jsonb)`, [OWN.shopA, s.recipe, OWN.actor]))).toContain("shop_owned:invalid_payload");
  });
});

describe("(5) sharing", () => {
  it("compare-and-sets the owner and the exact shop-only SKU set, then shares everything in one act", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero", [OWN.turkey, OWN.localPickles]);
    const share = (owner: string, skus: string[]) =>
      db.query(`select public.share_shop_owned_menu_item($1::uuid, $2::uuid, $3::uuid[], $4::uuid) as v`, [s.menu, owner, skus, OWN.actor]);
    expect(await refusal(share(OWN.shopB, [OWN.localPickles]))).toContain("shop_owned:ownership_changed");
    expect(await refusal(share(OWN.shopA, []))).toContain("shop_owned:skus_changed");
    await share(OWN.shopA, [OWN.localPickles]);
    const after = await one<{ m: string | null; r: string | null; k: string | null }>(`select
      (select location_id from public.menu_items where id = $1) as m,
      (select location_id from public.recipes where id = $2) as r,
      (select location_id from public.vendor_items where id = $3) as k`, [s.menu, s.recipe, OWN.localPickles]);
    expect(after).toEqual({ m: null, r: null, k: null });
    expect(await refusal(share(OWN.shopA, []))).toContain("shop_owned:already_shared");
  });
  it("never decides for another shop: a sandwich using another shop's own SKU cannot be shared", async () => {
    const s = await createSandwich(db, OWN.shopA, "Local Hero", [OWN.turkey, OWN.otherShopSku]);
    expect(await refusal(db.query(`select public.share_shop_owned_menu_item($1::uuid, $2::uuid, '{}'::uuid[], $3::uuid)`, [s.menu, OWN.shopA, OWN.actor])))
      .toContain("shop_owned:uses_other_shop_sku");
  });
  it("a prep recipe shares with exactly the items it makes and the shop's SKUs it uses; a sandwich using a shop item waits for it", async () => {
    await db.exec(`insert into public.items(id, name, location_id) values ('00000000-0000-4000-8000-0000000000c4', 'A relish', '${OWN.shopA}')`);
    const r = await one<{ id: string }>(`select public.create_shop_recipe($1::uuid, '{"name":"A relish","recipe_type":"production","batch_yield":1}'::jsonb,
      jsonb_build_array(jsonb_build_object('component_sku_id', $2::uuid, 'quantity', 1, 'unit', 'oz')),
      '[{"output_item_id":"00000000-0000-4000-8000-0000000000c4","yield":1}]'::jsonb, $3::uuid) as id`, [OWN.shopA, OWN.localPickles, OWN.actor]);
    const sand = await db.query<{ v: { menu_item_id: string } }>(`select public.create_shop_sandwich($1::uuid, 'Relish Hero', null, null, 9, $2::jsonb, 1, $3::uuid) as v`,
      [OWN.shopA, JSON.stringify([{ component_item_id: "00000000-0000-4000-8000-0000000000c4", quantity: 1, unit: "oz", display_order: 0 }]), OWN.actor]);
    expect(await refusal(db.query(`select public.share_shop_owned_menu_item($1::uuid, $2::uuid, '{}'::uuid[], $3::uuid)`,
      [sand.rows[0]!.v.menu_item_id, OWN.shopA, OWN.actor]))).toContain("shop_owned:uses_shop_only_item");
    expect(await refusal(db.query(`select public.share_shop_owned_recipe($1::uuid, $2::uuid, '{}'::uuid[], $3::uuid[], $4::uuid)`,
      [r.id, OWN.shopA, [OWN.localPickles], OWN.actor]))).toContain("shop_owned:items_changed");
    await db.query(`select public.share_shop_owned_recipe($1::uuid, $2::uuid, $3::uuid[], $4::uuid[], $5::uuid)`,
      [r.id, OWN.shopA, ["00000000-0000-4000-8000-0000000000c4"], [OWN.localPickles], OWN.actor]);
    const after = await one<{ r: string | null; i: string | null; k: string | null }>(`select
      (select location_id from public.recipes where id = $1) as r, (select location_id from public.items where id = $2) as i,
      (select location_id from public.vendor_items where id = $3) as k`, [r.id, "00000000-0000-4000-8000-0000000000c4", OWN.localPickles]);
    expect(after).toEqual({ r: null, i: null, k: null });
  });
  it("a SKU shares alone, with the same compare-and-set", async () => {
    expect(await refusal(db.query(`select public.share_shop_owned_sku($1::uuid, $2::uuid, $3::uuid)`, [OWN.localPickles, OWN.shopB, OWN.actor]))).toContain("shop_owned:ownership_changed");
    await db.query(`select public.share_shop_owned_sku($1::uuid, $2::uuid, $3::uuid)`, [OWN.localPickles, OWN.shopA, OWN.actor]);
    expect((await one<{ k: string | null }>(`select location_id as k from public.vendor_items where id = $1`, [OWN.localPickles])).k).toBeNull();
  });
});

describe("(6) the ceilings hold in a real database", () => {
  it("API roles cannot execute a writer; nobody executes a helper", async () => {
    const r = await one<{ a: boolean; s: boolean; h: boolean }>(`select
      has_function_privilege('authenticated', 'public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid)', 'execute') as a,
      has_function_privilege('service_role', 'public.create_shop_sandwich(uuid, text, text, text, numeric, jsonb, numeric, uuid)', 'execute') as s,
      has_function_privilege('service_role', 'public.recipe_owner_law(uuid)', 'execute') as h`);
    expect(r).toEqual({ a: false, s: true, h: false });
  });
});
```

(`create_catalog_sku` calls 2a's `save_sku_pack_version` / `save_sku_global_price`, which this stub does not carry; it is exercised for real by the sim scenario (Task 14 — including the item-number refusal in both directions, shared vs a shop's own) and its SERIALIZATION by the sim race harness (Task 14b: two concurrent creates of one vendor number, exactly one SKU). PGlite is one connection, so no test here can interleave two transactions.)

- [ ] **Step 6: Run**

Run: `npx vitest run tests/shop-owned-migration.test.ts tests/shop-owned-pglite.test.ts tests/recipe-provenance-writer.test.ts`

Expected: PASS, 0 failed (`tests/recipe-provenance-writer.test.ts` is 3a's PGlite test — it imports the fixture whose `STUB` is now exported, and must stay green).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0264_catalog_shop_owned.sql tests/shop-owned-migration.test.ts tests/fixtures/shop-owned-pglite.ts tests/shop-owned-pglite.test.ts tests/fixtures/recipe-versions-pglite.ts
git commit -m "$(cat <<'EOF'
feat(db): 0264 — shop-only sandwiches; the ownership law; the owner's own edit (compare-and-set); new-item and new-sandwich writers; sharing (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 3b: Migration 0266 — the pre-3a writer goes, on its own, behind the deploy gate

**Why its own migration (Astra round 1; the safer of the two options).** The alternative — keep the drop in 0264 and have the runbook apply 0264 only after the deploy that removed the last caller is READY — fails three ways: (1) 0264 must apply BEFORE the 4a code merges (that code reads `recipes.location_id`, `menu_items.location_id`, `sku_swaps`), so tying it to "the new code is serving" deadlocks the order; (2) a migration cannot observe deployments, so the gate would be a runbook promise wrapped around an irreversible statement inside a large schema change — a failed gate would have to roll back the whole ownership schema; (3) Vercel's instant rollback to any deployment built before 3a would call the 16-argument signature, and with the drop inside 0264 the only way back is re-applying the old function by hand mid-incident. As its own migration, 0266 is one statement, applied last (Task 15 Steps 9–10) after evidence that production serves code with the 17-argument caller and nothing older can run, and reverting it is one `create function` from 0262's text with no schema involved.

**Files:**
- Create: `supabase/migrations/0266_drop_recipe_input_16arg.sql`, `tests/drop-recipe-input-16arg-migration.test.ts`

- [ ] **Step 1: Write the failing pin test `tests/drop-recipe-input-16arg-migration.test.ts`**

```ts
/** Catalog Phase 4a — 0266: the pre-3a 16-argument writer is dropped on its own; nothing still calls it. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migratedShopOwnedDb } from "./fixtures/shop-owned-pglite";

const src = readFileSync("supabase/migrations/0266_drop_recipe_input_16arg.sql", "utf8");
const OLD_SIG = "public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)";
const NEW_SIG = "public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)";

describe("0266", () => {
  it("is gated, transactional, and says it is applied only behind the deploy gate", () => {
    expect(src.startsWith("-- Migration 0266_drop_recipe_input_16arg\n-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.")).toBe(true);
    expect(src).toContain("-- APPLY ONLY AFTER the deploy gate in the 4a plan, Task 15 Step 9");
    expect(src).toContain("\nbegin;\n");
    expect(src.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("checks the overload exists, THEN drops exactly the 16-argument signature (no IF EXISTS — a different signature fails loud)", () => {
    const guard = src.indexOf(`to_regprocedure('${NEW_SIG}') is null`);
    const drop = src.indexOf(`drop function ${OLD_SIG};`);
    expect(guard).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(guard);
    expect(src).not.toContain("drop function if exists");
  });
  it("the closing assertion proves the old one gone and the new one service_role-only", () => {
    expect(src).toContain(`if to_regprocedure('${OLD_SIG}') is not null then`);
    expect(src).toContain(`if not has_function_privilege('service_role', '${NEW_SIG}', 'execute') then`);
  });
  it("no code still calls the writer without its author", () => {
    for (const f of ["lib/recipes.ts", "lib/admin/recipe-versions.ts"]) {
      const body = readFileSync(f, "utf8");
      let at = body.indexOf('rpc("update_recipe_input_atomic"');
      while (at >= 0) {
        expect(body.slice(at, body.indexOf("});", at)), f).toContain("p_actor:");
        at = body.indexOf('rpc("update_recipe_input_atomic"', at + 1);
      }
    }
    const scripts = readdirSync("scripts", { recursive: true }) as string[];
    for (const s of scripts.filter((p) => p.endsWith(".ts") || p.endsWith(".mjs"))) {
      const body = readFileSync(join("scripts", s), "utf8");
      if (body.includes('rpc("update_recipe_input_atomic"')) expect(body, s).toContain("p_actor");
    }
  });
  it("for real (PGlite): after 0266 the 16-argument signature is gone and the 17-argument one stays", async () => {
    const db = await migratedShopOwnedDb({ swaps: true, drop: true });
    const r = (await db.query<{ old: string | null; neu: string | null }>(`select to_regprocedure('${OLD_SIG}')::text as old, to_regprocedure('${NEW_SIG}')::text as neu`)).rows[0]!;
    expect(r.old).toBeNull();
    expect(r.neu).not.toBeNull();
  });
});
```

Run: `npx vitest run tests/drop-recipe-input-16arg-migration.test.ts` → expected: FAIL (`ENOENT`).

- [ ] **Step 2: Create `supabase/migrations/0266_drop_recipe_input_16arg.sql`**

```sql
-- Migration 0266_drop_recipe_input_16arg
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.
-- APPLY ONLY AFTER the deploy gate in the 4a plan, Task 15 Step 9 (production serves a deployment whose code calls
-- only the 17-argument writer, it is READY, and no older deployment can serve or be promoted without first re-creating
-- this function).
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase4a-shop-only-and-job-engines.md (Task 3b).
-- Requires 0262 (the 17-argument overload of update_recipe_input_atomic, with p_actor).
--
-- WHAT. 0262 kept update_recipe_input_atomic's 16-argument signature only for code deployed before 3a; every caller since
-- passes p_actor (the 17-argument overload). It goes here, ON ITS OWN, so the drop is the last and smallest step of the
-- phase and is reversible by re-creating one function from 0262's text. A plain DROP (no IF EXISTS): a database whose
-- signature differs fails loudly.
--
-- VERIFY (after apply):
--   select to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)');  -- null
--   select count(*) from pg_proc where proname = 'update_recipe_input_atomic';  -- 1

begin;

do $$
begin
  if to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)') is null then
    raise exception '0266: the 0262 authorship overload of update_recipe_input_atomic is missing — apply 0262 first';
  end if;
end $$;

drop function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean);

do $$
declare
  r text;
begin
  if to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)') is not null then
    raise exception '0266: the 16-argument update_recipe_input_atomic still exists';
  end if;
  if not has_function_privilege('service_role', 'public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)', 'execute') then
    raise exception '0266: service_role cannot execute the 17-argument writer';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)', 'execute') then
      raise exception '0266: % can execute the 17-argument writer', r;
    end if;
  end loop;
end $$;

commit;
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/drop-recipe-input-16arg-migration.test.ts tests/shop-owned-pglite.test.ts` → expected: PASS.

```bash
git add supabase/migrations/0266_drop_recipe_input_16arg.sql tests/drop-recipe-input-16arg-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): 0266 — drop the pre-3a 16-argument update_recipe_input_atomic, on its own, behind the deploy gate (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 4: Migration 0265 — the swap record, Swap vendor's one write, and Back to normal

The swap moves a shop (or, MoO+ "for good everywhere", the default) from one bought item to another in ONE transaction:
1. **bound to the preview** — the SET of recipes it writes (every recipe this scope makes with the old item) and the set that follows the primary (every recipe here that pins the product) are re-enumerated under the graph lock and must equal what the preview showed (`swap:recipes_changed`, Astra r1); every one's dependency snapshot (0262 `recipe_change_snapshot`, over the NEW lines — or, for a recipe that follows the primary, its current lines) is re-taken under its closure locks before anything is written, so a swap never lands on numbers the person did not see;
2. **one product** — both items join the old one's product, or a new product (whose default primary is pinned to the OLD item, so no other shop's resolution moves);
3. **every recipe** — each affected recipe gets the version the preview showed (the old item's lines now name the new one) through 0262's own `save_recipe_version`, with a fresh snapshot per save (an earlier recipe may feed a later one's closure, e.g. slaw inside a sandwich);
4. **the primary** at that scope names the new item (what was there before is recorded);
5. **the record** — `sku_swaps`; "For good" is a record from the start, "Just for now" is live until **Back to normal**.

Back to normal (`end_sku_swap`) undoes it the same way: each version the swap wrote that is STILL in force goes back — retired if the shop rode the default before, restored (a new version holding the replaced lines) if the shop had its own, or for a recipe the shop owns; a version the GM changed since is KEPT and named; the primary returns to what it was (or its row is removed) unless someone changed it since — decided by LOCKING the product, its primary rows and the joined items first and then a conditional write whose row count is the answer (Astra r1: never an unlocked `EXISTS` followed by a write by id; a product-only swap has no recipe locks to lean on).

**Files:**
- Create: `supabase/migrations/0265_sku_swaps.sql`, `tests/sku-swaps-migration.test.ts`, `tests/sku-swaps-pglite.test.ts`

- [ ] **Step 1: Write the failing pin test `tests/sku-swaps-migration.test.ts`**

```ts
/** Catalog Phase 4a — 0265's pins: the record, the bound-then-write order, the lock order, the ceilings. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction } from "../scripts/recipe-versions/reemit-mods";

const src = readFileSync("supabase/migrations/0265_sku_swaps.sql", "utf8");
const fn = (name: string) => extractFunction(src, `create or replace function public.${name}(`, "\n$$;");

describe("0265 header, table, RLS", () => {
  it("is gated and transactional", () => {
    expect(src.startsWith("-- Migration 0265_sku_swaps\n-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.")).toBe(true);
    expect(src).toContain("\nbegin;\n");
    expect(src.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("the record: one live swap per (old item, shop); for-now is always at a shop; for-good is never live", () => {
    expect(src).toContain("constraint sku_swaps_for_now_at_a_shop check (mode = 'for_good' or location_id is not null)");
    expect(src).toContain("constraint sku_swaps_for_good_is_done check (mode = 'for_now' or not active)");
    expect(src).toContain("constraint sku_swaps_live_window check ((ended_at is null) = active)");
    expect(src).toContain("create unique index if not exists sku_swaps_one_live on public.sku_swaps (old_sku_id, location_id) where active;");
  });
  it("deny-all RLS; service_role may only READ it (writes are the two functions)", () => {
    expect(src).toContain("alter table public.sku_swaps enable row level security;");
    expect(src).toContain("revoke all on table public.sku_swaps from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select on table public.sku_swaps to service_role;");
  });
});

describe("start_sku_swap — bound, then written, in the house lock order", () => {
  const f = fn("start_sku_swap");
  it("the recipe set is re-enumerated under the graph lock, after the SKUs and before any recipe lock (Astra r1)", () => {
    const skus = f.indexOf("from public.vendor_items where id in (p_old, p_new) order by id for update");
    const affected = f.indexOf("v_affected := public.swap_affected_recipes(p_location, p_old);");
    const complete = f.indexOf("if array(select (t.value->>'recipe_id')::uuid from jsonb_array_elements(p_recipes) as t(value) order by 1) is distinct from v_affected then");
    const pinned = f.indexOf("if array(select (t.value->>'recipe_id')::uuid from jsonb_array_elements(p_bound) as t(value) order by 1) is distinct from v_pinned then");
    expect(affected).toBeGreaterThan(skus);
    expect(complete).toBeGreaterThan(affected);
    expect(pinned).toBeGreaterThan(complete);
    expect(f.indexOf("perform public.recipe_change_lock(")).toBeGreaterThan(pinned);
    expect(fn("swap_affected_recipes")).toContain("from public.recipe_scope_lines(p_location) l");
    expect(fn("swap_affected_recipes")).toContain("and (r.location_id is null or r.location_id = p_location)");
    expect(fn("swap_pinned_recipes")).toContain("l.line_product_id = p_product");
  });
  it("the recipes that follow the primary are bound (snapshot under their locks) and never written", () => {
    const bound = f.indexOf("for v_r in select value from jsonb_array_elements(p_bound) as t(value) order by value->>'recipe_id' loop");
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(f.indexOf("insert into public.products"));
    expect(f.slice(bound, f.indexOf("end loop;", bound))).not.toContain("save_recipe_version");
  });
  it("graph lock → the two SKUs → each recipe and its closure → the snapshot check, all BEFORE the first write", () => {
    const graph = f.indexOf("pg_advisory_xact_lock(7258025800)");
    const skus = f.indexOf("from public.vendor_items where id in (p_old, p_new) order by id for update");
    const lock = f.indexOf("perform public.recipe_change_lock(v_rid, v_loc, v_r->'lines');");
    const check = f.indexOf("is distinct from v_r->'snapshot'");
    const firstWrite = f.indexOf("insert into public.products");
    expect(graph).toBeGreaterThan(0);
    expect(skus).toBeGreaterThan(graph);
    expect(lock).toBeGreaterThan(skus);
    expect(check).toBeGreaterThan(lock);
    expect(firstWrite).toBeGreaterThan(check);
  });
  it("each recipe is saved by 0262's writer with a FRESH snapshot (an earlier save may feed a later recipe)", () => {
    expect(f).toContain("public.recipe_change_snapshot(v_rid, v_loc, v_r->'lines'));");
    expect(f).toContain("v_saved := public.save_recipe_version(");
  });
  it("a new product pins today's answer: the OLD item is its default primary", () => {
    expect(f).toContain("values (v_product, null, p_old, 'swap: the item every shop used', p_actor);");
  });
  it("names every refusal", () => {
    for (const c of ["invalid_mode", "same_sku", "invalid_payload", "location_not_found", "sku_not_found", "already_swapped",
      "not_found", "in_other_product", "product_needs_primary", "product_name_taken", "recipes_changed"]) expect(f).toContain(`'swap:${c}'`);
    expect(f).toContain("'recipe_version:dependencies_changed'");
  });
  it("a shop's own recipe is written as itself (0264), never as a shop version", () => {
    expect(f).toContain("(v_loc is null and v_owner is not null and v_owner = p_location)");
  });
});

describe("end_sku_swap — Back to normal", () => {
  const f = fn("end_sku_swap");
  it("checks every version still in force under its locks before writing anything", () => {
    expect(f.indexOf("is distinct from (p_snapshots -> v_rid::text)")).toBeLessThan(f.indexOf("perform public.retire_recipe_version("));
  });
  it("retires what replaced nothing, restores what replaced a version, keeps what changed since", () => {
    expect(f).toContain("perform public.retire_recipe_version(v_vid, v_loc, p_actor, public.recipe_change_snapshot(v_rid, v_loc, v_lines));");
    expect(f).toContain("perform public.save_recipe_version(v_rid, v_loc, null, v_vid, null, 'Back to normal', p_actor, v_replaced, null, null,");
    expect(f).toContain("v_kept := v_kept || jsonb_build_array(v_rid);");
  });
  it("LOCKS first — the product, its primary rows, the joined items — then CHECKED conditional writes (Astra r1)", () => {
    const product = f.indexOf("perform 1 from public.products where id = v_s.product_id for update;");
    const prims = f.indexOf("perform 1 from public.product_primaries where product_id = v_s.product_id order by id for update;");
    const joined = f.indexOf("perform 1 from public.vendor_items where id = any(v_s.joined_sku_ids) order by id for update;");
    expect(product).toBeGreaterThan(f.indexOf("'swap:not_live'"));
    expect(prims).toBeGreaterThan(product);
    expect(joined).toBeGreaterThan(prims);
    expect(f.indexOf("perform public.recipe_change_lock(")).toBeGreaterThan(joined);
    expect(f).not.toContain("if exists (select 1 from public.product_primaries where id = v_s.primary_row_id");
  });
  it("the primary goes back only if the swap's choice is still in force — the write's row count is the answer", () => {
    expect(f).toContain("delete from public.product_primaries where id = v_s.primary_row_id and primary_sku_id = v_s.new_sku_id;");
    expect(f).toContain("where id = v_s.primary_row_id and primary_sku_id = v_s.new_sku_id;");
    expect(f).toContain("get diagnostics v_n = row_count;");
    expect(f).toContain("v_primary := case when v_n = 1 then 'restored' else 'changed_since' end;");
  });
  it("the grouping it made is undone — exactly (lead decision 3); a product something now leans on is kept", () => {
    expect(f).toContain("update public.vendor_items set product_id = null where id = any(v_s.joined_sku_ids) and product_id = v_s.product_id;");
    expect(f).toContain("update public.products set active = false, updated_by = p_actor where id = v_s.product_id;");
    expect(f).toContain("v_grouping := 'kept_in_use';");
    expect(fn("start_sku_swap")).toContain("v_joined := array(select id from public.vendor_items where id in (p_old, p_new) and product_id is null order by id);");
    expect(src).not.toMatch(/location_sku_settings|active_override/); // a swap never writes a par and never switches an item off
  });
});

describe("privilege ceilings", () => {
  it("writers: service_role only; helpers: nobody", () => {
    for (const w of ["public.start_sku_swap(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, uuid)", "public.end_sku_swap(uuid, jsonb, uuid)"]) {
      expect(src).toContain(`revoke all on function ${w} from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function ${w} to service_role;`);
    }
    for (const h of ["public.swap_recipe_default_lines(uuid)", "public.swap_version_lines(uuid)", "public.swap_affected_recipes(uuid, uuid)",
      "public.swap_pinned_recipes(uuid, uuid)"]) {
      expect(src).toContain(`revoke all on function ${h} from public, anon, authenticated, service_role;`);
    }
    expect(src).toContain("raise exception '0265: service_role may only read sku_swaps';");
  });
});
```

Run: `npx vitest run tests/sku-swaps-migration.test.ts` → expected: FAIL (`ENOENT`).

- [ ] **Step 2: Create `supabase/migrations/0265_sku_swaps.sql`**

```sql
-- Migration 0265_sku_swaps
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase4a-shop-only-and-job-engines.md (Task 4).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §5 job 3 ("Swap vendor" — "Just for now at my
-- shop" or "For good"; one product; every recipe switched in one go; "Back to normal").
-- Requires 0179 (products, product_primaries), 0262 (save_recipe_version, retire_recipe_version, recipe_change_snapshot,
-- recipe_change_lock) and 0264.
--
-- WHAT.
--   sku_swaps        one row per swap: where (a shop, or NULL = the default, "for good everywhere"), from which item to
--                    which, the product that groups them, what the primary at that scope was before, and every recipe
--                    version the swap wrote (with the version each replaced). "Just for now" is LIVE until Back to
--                    normal; "For good" is a record from the start (nothing to undo). One live swap per (old item, shop).
--   start_sku_swap   the swap, in ONE transaction (see the function's comments for the order). Astra round 1: the SET it
--                    writes and the set that follows the primary are re-enumerated under the graph lock
--                    (swap_affected_recipes / swap_pinned_recipes) and must equal the preview's ('swap:recipes_changed');
--                    the recipes that follow the primary are bound by their snapshots (p_bound) and never written.
--   end_sku_swap     Back to normal, in ONE transaction. Astra round 1: it LOCKS the product, its primary rows and the
--                    items it joined before it compares anything, and its primary / grouping writes are conditional,
--                    their row counts the answer — a concurrent primary choice is kept, never overwritten.
--
-- THE PRODUCT PRIMARY is how ordering, counts and every product-pinned recipe line follow the swap; the recipe lines
-- that named the OLD item directly are switched by recipe versions (0262), so a past business date still depletes the
-- item it used then. A swap NEVER moves another shop: a new product's default primary is pinned to the old item.
--
-- VERIFY (after apply):
--   select count(*) from public.sku_swaps;  -- 0
--   select has_table_privilege('service_role', 'public.sku_swaps', 'insert');  -- false

begin;

create table if not exists public.sku_swaps (
  id                      uuid        primary key default gen_random_uuid(),
  location_id             uuid        null references public.locations(id),
  old_sku_id              uuid        not null references public.vendor_items(id),
  new_sku_id              uuid        not null references public.vendor_items(id),
  product_id              uuid        not null references public.products(id),
  mode                    text        not null,
  product_created         boolean     not null default false,
  joined_sku_ids          uuid[]      not null default '{}'::uuid[],
  primary_row_id          uuid        null,
  previous_primary_sku_id uuid        null references public.vendor_items(id),
  versions                jsonb       not null default '[]'::jsonb,
  active                  boolean     not null default true,
  started_at              timestamptz not null default clock_timestamp(),
  started_by              uuid        null references public.users(id),
  ended_at                timestamptz null,
  ended_by                uuid        null references public.users(id),
  end_note                jsonb       null,
  note                    text        null,
  constraint sku_swaps_mode check (mode in ('for_now', 'for_good')),
  constraint sku_swaps_two_items check (old_sku_id <> new_sku_id),
  constraint sku_swaps_live_window check ((ended_at is null) = active),
  constraint sku_swaps_for_now_at_a_shop check (mode = 'for_good' or location_id is not null),
  constraint sku_swaps_for_good_is_done check (mode = 'for_now' or not active)
);

comment on table public.sku_swaps is
  'Swap vendor (0265, spec §5 job 3): one row per swap. versions = [{recipe_id, location, version_id, '
  'replaced_version_id}] — every recipe version the swap wrote and the one it replaced (null = the shop rode the '
  'default). primary_row_id / previous_primary_sku_id = the product_primaries row it set and what that row named '
  'before (null = there was none). joined_sku_ids / product_created = the grouping it made, undone by Back to normal. '
  'A swap never writes a par and never switches the old item off. Written only by start_sku_swap / end_sku_swap.';

create unique index if not exists sku_swaps_one_live on public.sku_swaps (old_sku_id, location_id) where active;
create index if not exists sku_swaps_new_live_idx on public.sku_swaps (new_sku_id) where active;

alter table public.sku_swaps enable row level security;
revoke all on table public.sku_swaps from public, anon, authenticated, service_role;
grant select on table public.sku_swaps to service_role;

-- The DEFAULT's lines of a recipe, exactly as 0262's retire_recipe_version derives them (its change's line set).
create or replace function public.swap_recipe_default_lines(p_recipe uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('component_sku_id', ri.component_sku_id, 'component_item_id', ri.component_item_id,
                                               'component_product_id', ri.component_product_id, 'unit', ri.unit) order by ri.id), '[]'::jsonb)
    from public.recipe_inputs ri
   where ri.recipe_id = p_recipe;
$$;

-- One version's lines, in the same shape (what a restore copies).
create or replace function public.swap_version_lines(p_version uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('component_sku_id', l.component_sku_id, 'component_item_id', l.component_item_id,
                                               'component_product_id', l.component_product_id, 'unit', l.unit)
                            order by l.display_order, l.id), '[]'::jsonb)
    from public.recipe_version_lines l
   where l.version_id = p_version;
$$;

-- THE SET A SWAP WRITES (Astra round 1): the active recipes whose lines IN FORCE at this scope name the old item — at a
-- shop, the shared recipes (through the shop's own version when it has one, else the default) and the shop's OWN
-- recipes (0264); for "everywhere" (null), the shared recipes' defaults. Exactly what previewSkuSwap reads through
-- loadResolvedRecipeInputs(scope). Sorted, so two sets compare as arrays.
create or replace function public.swap_affected_recipes(p_location uuid, p_old uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct l.line_recipe_id order by l.line_recipe_id), '{}'::uuid[])
    from public.recipe_scope_lines(p_location) l
    join public.recipes r on r.id = l.line_recipe_id and r.active
   where l.line_sku_id = p_old
     and (r.location_id is null or r.location_id = p_location);
$$;

-- The recipes at this scope that PIN the product: they follow the primary the swap sets, with no new version.
create or replace function public.swap_pinned_recipes(p_location uuid, p_product uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct l.line_recipe_id order by l.line_recipe_id), '{}'::uuid[])
    from public.recipe_scope_lines(p_location) l
    join public.recipes r on r.id = l.line_recipe_id and r.active
   where p_product is not null
     and l.line_product_id = p_product
     and (r.location_id is null or r.location_id = p_location);
$$;

create or replace function public.start_sku_swap(
  p_location uuid,
  p_old      uuid,
  p_new      uuid,
  p_mode     text,
  p_product  jsonb,
  p_recipes  jsonb,
  p_bound    jsonb,
  p_note     text,
  p_actor    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old      public.vendor_items%rowtype;
  v_new      public.vendor_items%rowtype;
  v_r        jsonb;
  v_rid      uuid;
  v_loc      uuid;
  v_owner    uuid;
  v_product  uuid;
  v_pname    text := btrim(coalesce(p_product->'create'->>'name', ''));
  v_created  boolean := false;
  v_joined   uuid[];
  v_saved    jsonb;
  v_versions jsonb := '[]'::jsonb;
  v_prim     public.product_primaries%rowtype;
  v_prev     uuid;
  v_prim_id  uuid;
  v_swap     uuid;
  v_affected uuid[];
  v_pinned   uuid[];
begin
  if p_mode is null or p_mode not in ('for_now', 'for_good') or (p_mode = 'for_now' and p_location is null) then
    raise exception 'swap:invalid_mode' using errcode = 'P0001';
  end if;
  if p_old = p_new then
    raise exception 'swap:same_sku' using errcode = 'P0001';
  end if;
  if p_recipes is null or jsonb_typeof(p_recipes) <> 'array' or p_bound is null or jsonb_typeof(p_bound) <> 'array' or p_product is null
     or (not (p_product ? 'id') and char_length(v_pname) not between 1 and 120) then
    raise exception 'swap:invalid_payload' using errcode = 'P0001';
  end if;

  -- LOCK ORDER (0262 (7a)): the graph lock → the two items (by id) → each recipe row and its closure (by recipe id).
  perform pg_advisory_xact_lock(7258025800);
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'swap:location_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.vendor_items where id in (p_old, p_new) order by id for update;
  select * into v_old from public.vendor_items where id = p_old;
  select * into v_new from public.vendor_items where id = p_new;
  -- Both active; a shop-owned item swaps only at its owner (2a's owner rule); "everywhere" swaps shared items only.
  if v_old.id is null or v_new.id is null or not v_old.active or not v_new.active
     or (v_old.location_id is not null and v_old.location_id is distinct from p_location)
     or (v_new.location_id is not null and v_new.location_id is distinct from p_location) then
    raise exception 'swap:sku_not_found' using errcode = 'P0001';
  end if;
  if p_location is not null
     and exists (select 1 from public.sku_swaps where old_sku_id = p_old and location_id = p_location and active) then
    raise exception 'swap:already_swapped' using errcode = 'P0001';
  end if;

  -- 0. THE SET IS COMPLETE (Astra round 1): recomputed HERE, under the graph lock no recipe writer can pass. A recipe that
  --    started using the old item after the preview, or one that stopped, changes the set; the swap refuses rather than
  --    leave a recipe unswapped. The same for the recipes that FOLLOW the primary (they pin the product).
  v_affected := public.swap_affected_recipes(p_location, p_old);
  if array(select (t.value->>'recipe_id')::uuid from jsonb_array_elements(p_recipes) as t(value) order by 1) is distinct from v_affected then
    raise exception 'swap:recipes_changed' using errcode = 'P0001';
  end if;
  v_pinned := array(select x from unnest(public.swap_pinned_recipes(p_location, case when p_product ? 'id' then (p_product->>'id')::uuid end)) as x
                     where not (x = any(v_affected)) order by 1);
  if array(select (t.value->>'recipe_id')::uuid from jsonb_array_elements(p_bound) as t(value) order by 1) is distinct from v_pinned then
    raise exception 'swap:recipes_changed' using errcode = 'P0001';
  end if;

  -- 1. BOUND TO WHAT THE PERSON SAW: every recipe's preview snapshot (over its NEW lines) re-taken under its locks,
  --    BEFORE anything is written.
  for v_r in select value from jsonb_array_elements(p_recipes) as t(value) order by value->>'recipe_id' loop
    v_rid := (v_r->>'recipe_id')::uuid;
    v_loc := nullif(v_r->>'location', '')::uuid;
    select location_id into v_owner from public.recipes where id = v_rid and active for update;
    if not found then
      raise exception 'swap:not_found' using errcode = 'P0001';
    end if;
    -- A shop's swap writes that shop's version of a shared recipe; a recipe the shop OWNS is written as itself (0264:
    -- it has no shop versions). The default's swap ("everywhere") writes shared recipes only.
    if not ((v_loc is not distinct from p_location and v_owner is null)
            or (v_loc is null and v_owner is not null and v_owner = p_location)) then
      raise exception 'swap:invalid_payload' using errcode = 'P0001';
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(v_r->'lines', '[]'::jsonb)) as l(value)
                where nullif(l.value->>'component_sku_id', '')::uuid = p_old) then
      raise exception 'swap:invalid_payload' using errcode = 'P0001';
    end if;
    perform public.recipe_change_lock(v_rid, v_loc, v_r->'lines');
    if public.recipe_change_snapshot(v_rid, v_loc, v_r->'lines') is distinct from v_r->'snapshot' then
      raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
    end if;
  end loop;
  -- …and every recipe that FOLLOWS the primary (it pins the product): its CURRENT lines, its snapshot, its locks — the
  -- costs the preview showed for it are bound too. It is never written.
  for v_r in select value from jsonb_array_elements(p_bound) as t(value) order by value->>'recipe_id' loop
    v_rid := (v_r->>'recipe_id')::uuid;
    v_loc := nullif(v_r->>'location', '')::uuid;
    select location_id into v_owner from public.recipes where id = v_rid and active for update;
    if not found then
      raise exception 'swap:not_found' using errcode = 'P0001';
    end if;
    if not ((v_loc is not distinct from p_location and v_owner is null)
            or (v_loc is null and v_owner is not null and v_owner = p_location)) then
      raise exception 'swap:invalid_payload' using errcode = 'P0001';
    end if;
    perform public.recipe_change_lock(v_rid, v_loc, v_r->'lines');
    if public.recipe_change_snapshot(v_rid, v_loc, v_r->'lines') is distinct from v_r->'snapshot' then
      raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
    end if;
  end loop;

  -- 2. ONE PRODUCT: an existing one both may join (it must already say which item every shop uses), or a new one.
  if p_product ? 'id' then
    v_product := (p_product->>'id')::uuid;
    if not exists (select 1 from public.products where id = v_product and active) then
      raise exception 'swap:not_found' using errcode = 'P0001';
    end if;
    if (v_old.product_id is not null and v_old.product_id <> v_product)
       or (v_new.product_id is not null and v_new.product_id <> v_product) then
      raise exception 'swap:in_other_product' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.product_primaries where product_id = v_product and location_id is null) then
      raise exception 'swap:product_needs_primary' using errcode = 'P0001';
    end if;
  else
    if v_old.product_id is not null or v_new.product_id is not null then
      raise exception 'swap:in_other_product' using errcode = 'P0001';
    end if;
    begin
      insert into public.products (name, name_es, active, created_by, updated_by)
      values (v_pname, nullif(btrim(coalesce(p_product->'create'->>'name_es', '')), ''), true, p_actor, p_actor)
      returning id into v_product;
    exception when unique_violation then
      raise exception 'swap:product_name_taken' using errcode = 'P0001';
    end;
    v_created := true;
  end if;
  -- What the swap joins is recorded, so Back to normal can undo exactly this (lead decision 3).
  v_joined := array(select id from public.vendor_items where id in (p_old, p_new) and product_id is null order by id);
  update public.vendor_items set product_id = v_product where id in (p_old, p_new) and product_id is null;
  if v_created then
    -- A NEW product pins TODAY's answer everywhere: the old item is its default primary, so no other shop moves.
    insert into public.product_primaries (product_id, location_id, primary_sku_id, note, updated_by)
    values (v_product, null, p_old, 'swap: the item every shop used', p_actor);
  end if;

  -- 3. EVERY RECIPE, through 0262's writer. A FRESH snapshot per save: an earlier recipe's new version may be in a
  --    later recipe's closure (slaw inside a sandwich); step 1 already bound all of them to the preview.
  for v_r in select value from jsonb_array_elements(p_recipes) as t(value) order by value->>'recipe_id' loop
    v_rid := (v_r->>'recipe_id')::uuid;
    v_loc := nullif(v_r->>'location', '')::uuid;
    v_saved := public.save_recipe_version(
      v_rid, v_loc, v_r->'lines', nullif(v_r->>'expected', '')::uuid, nullif(v_r->>'based_on', '')::uuid,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Swap vendor'), p_actor, null, null, null,
      public.recipe_change_snapshot(v_rid, v_loc, v_r->'lines'));
    v_versions := v_versions || jsonb_build_array(jsonb_build_object(
      'recipe_id', v_rid, 'location', v_loc, 'version_id', v_saved->>'version_id',
      'replaced_version_id', v_saved->>'retired_version_id'));
  end loop;

  -- 4. THE PRIMARY at this scope names the new item; what was there before is recorded for Back to normal.
  select * into v_prim from public.product_primaries
   where product_id = v_product and location_id is not distinct from p_location
   for update;
  if found then
    v_prev := v_prim.primary_sku_id;
    v_prim_id := v_prim.id;
    update public.product_primaries
       set primary_sku_id = p_new, note = 'swap', updated_at = now(), updated_by = p_actor
     where id = v_prim.id;
  else
    v_prev := null;
    insert into public.product_primaries (product_id, location_id, primary_sku_id, note, updated_by)
    values (v_product, p_location, p_new, 'swap', p_actor)
    returning id into v_prim_id;
  end if;

  -- 5. THE RECORD. "For good" is never live (nothing to undo); "Just for now" is live until Back to normal.
  insert into public.sku_swaps (location_id, old_sku_id, new_sku_id, product_id, mode, product_created, joined_sku_ids, primary_row_id,
                                previous_primary_sku_id, versions, active, started_by, ended_at, ended_by, note)
  values (p_location, p_old, p_new, v_product, p_mode, v_created, v_joined, v_prim_id, v_prev, v_versions, p_mode = 'for_now', p_actor,
          case when p_mode = 'for_good' then clock_timestamp() end, case when p_mode = 'for_good' then p_actor end,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_swap;

  return jsonb_build_object('swap_id', v_swap, 'product_id', v_product, 'product_created', v_created,
                            'primary_row_id', v_prim_id, 'previous_primary_sku_id', v_prev, 'versions', v_versions);
end;
$$;

create or replace function public.end_sku_swap(
  p_swap      uuid,
  p_snapshots jsonb,
  p_actor     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_s        public.sku_swaps%rowtype;
  v_v        jsonb;
  v_rid      uuid;
  v_loc      uuid;
  v_vid      uuid;
  v_replaced uuid;
  v_lines    jsonb;
  v_back     jsonb := '[]'::jsonb;
  v_kept     jsonb := '[]'::jsonb;
  v_primary  text := 'none';
  v_grouping text := 'none';
  v_n        int;
begin
  perform pg_advisory_xact_lock(7258025800);
  select * into v_s from public.sku_swaps where id = p_swap for update;
  if not found then
    raise exception 'swap:swap_not_found' using errcode = 'P0001';
  end if;
  if not v_s.active or v_s.mode <> 'for_now' then
    raise exception 'swap:not_live' using errcode = 'P0001';
  end if;

  -- 0. LOCKS FOR THE PRODUCT SIDE, BEFORE ANY CHECK (Astra round 1): the product row (a new member, a new primary row or a
  --    new pin each take FOR KEY SHARE on it), every primary row of the product, then the items the swap joined — by id.
  --    A concurrent primary choice (setPrimary) either committed before this point (step 3's conditional write sees it
  --    and keeps it) or waits for this transaction. A product-only swap has no recipe locks to lean on; these are its own.
  perform 1 from public.products where id = v_s.product_id for update;
  perform 1 from public.product_primaries where product_id = v_s.product_id order by id for update;
  perform 1 from public.vendor_items where id = any(v_s.joined_sku_ids) order by id for update;

  -- 1. BOUND TO THE PREVIEW: every version still in force, checked under its locks before anything is written. The
  --    change's line set is what goes back: the default's lines (retire) or the replaced version's (restore).
  for v_v in select value from jsonb_array_elements(v_s.versions) as t(value) order by value->>'recipe_id' loop
    v_rid := (v_v->>'recipe_id')::uuid;
    v_loc := nullif(v_v->>'location', '')::uuid;
    v_vid := (v_v->>'version_id')::uuid;
    v_replaced := nullif(v_v->>'replaced_version_id', '')::uuid;
    if exists (select 1 from public.recipe_versions where id = v_vid and active) then
      perform 1 from public.recipes where id = v_rid for update;
      v_lines := case when v_replaced is null then public.swap_recipe_default_lines(v_rid) else public.swap_version_lines(v_replaced) end;
      perform public.recipe_change_lock(v_rid, v_loc, v_lines);
      if public.recipe_change_snapshot(v_rid, v_loc, v_lines) is distinct from (p_snapshots -> v_rid::text) then
        raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- 2. BACK. A version that replaced nothing (the shop rode the default) is retired; one that replaced a version (the
  --    shop's own, or a shop-owned recipe's previous lines) is RESTORED — a new version holding those lines. A version
  --    the GM changed after the swap is no longer in force: it is KEPT, and named.
  for v_v in select value from jsonb_array_elements(v_s.versions) as t(value) order by value->>'recipe_id' loop
    v_rid := (v_v->>'recipe_id')::uuid;
    v_loc := nullif(v_v->>'location', '')::uuid;
    v_vid := (v_v->>'version_id')::uuid;
    v_replaced := nullif(v_v->>'replaced_version_id', '')::uuid;
    if exists (select 1 from public.recipe_versions where id = v_vid and active) then
      v_lines := case when v_replaced is null then public.swap_recipe_default_lines(v_rid) else public.swap_version_lines(v_replaced) end;
      if v_replaced is null then
        perform public.retire_recipe_version(v_vid, v_loc, p_actor, public.recipe_change_snapshot(v_rid, v_loc, v_lines));
      else
        perform public.save_recipe_version(v_rid, v_loc, null, v_vid, null, 'Back to normal', p_actor, v_replaced, null, null,
                                           public.recipe_change_snapshot(v_rid, v_loc, v_lines));
      end if;
      v_back := v_back || jsonb_build_array(v_rid);
    else
      v_kept := v_kept || jsonb_build_array(v_rid);
    end if;
  end loop;

  -- 3. THE PRIMARY goes back — only if the swap's choice is still in force. A row the swap created is removed (the
  --    shop rides the product's default again); a row it changed names what it named before.
  if v_s.primary_row_id is not null then
    -- CHECKED CONDITIONAL WRITES (Astra round 1): the row is locked (step 0) and the write re-states the condition; its
    -- row count IS the answer — never an EXISTS followed by a write by id.
    if v_s.previous_primary_sku_id is null then
      delete from public.product_primaries where id = v_s.primary_row_id and primary_sku_id = v_s.new_sku_id;
    else
      update public.product_primaries
         set primary_sku_id = v_s.previous_primary_sku_id, note = 'back to normal', updated_at = now(), updated_by = p_actor
       where id = v_s.primary_row_id and primary_sku_id = v_s.new_sku_id;
    end if;
    get diagnostics v_n = row_count;
    v_primary := case when v_n = 1 then 'restored' else 'changed_since' end;
  end if;

  -- 4. THE GROUPING goes back too (lead decision 3: Back to normal restores exactly) — when the primary did. The
  --    memberships the swap made are undone; a product the swap CREATED is retired with its default row — unless
  --    something now leans on it (a recipe line pins it, another item joined it, a shop chose a primary for it).
  if v_primary = 'restored' and coalesce(array_length(v_s.joined_sku_ids, 1), 0) > 0 then
    if v_s.product_created then
      if not exists (select 1 from public.recipe_inputs where component_product_id = v_s.product_id)
         and not exists (select 1 from public.recipe_version_lines where component_product_id = v_s.product_id)
         and not exists (select 1 from public.vendor_items where product_id = v_s.product_id and not (id = any(v_s.joined_sku_ids)))
         and not exists (select 1 from public.product_primaries where product_id = v_s.product_id and location_id is not null) then
        delete from public.product_primaries where product_id = v_s.product_id and location_id is null;
        update public.vendor_items set product_id = null where id = any(v_s.joined_sku_ids) and product_id = v_s.product_id;
        update public.products set active = false, updated_by = p_actor where id = v_s.product_id;
        v_grouping := 'undone';
      else
        v_grouping := 'kept_in_use';
      end if;
    else
      -- It joined an existing product: the items it added leave again (a primary that names one keeps it — the FK).
      update public.vendor_items vi set product_id = null
       where vi.id = any(v_s.joined_sku_ids) and vi.product_id = v_s.product_id
         and not exists (select 1 from public.product_primaries pp where pp.primary_sku_id = vi.id);
      v_grouping := 'undone';
    end if;
  elsif v_primary = 'changed_since' then
    v_grouping := 'kept_primary_changed';
  end if;

  update public.sku_swaps
     set active = false, ended_at = clock_timestamp(), ended_by = p_actor,
         end_note = jsonb_build_object('back', v_back, 'kept', v_kept, 'primary', v_primary, 'grouping', v_grouping)
   where id = p_swap;
  return jsonb_build_object('swap_id', p_swap, 'back', v_back, 'kept', v_kept, 'primary', v_primary, 'grouping', v_grouping);
end;
$$;

revoke all on function public.swap_recipe_default_lines(uuid) from public, anon, authenticated, service_role;
revoke all on function public.swap_version_lines(uuid) from public, anon, authenticated, service_role;
revoke all on function public.swap_affected_recipes(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.swap_pinned_recipes(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.start_sku_swap(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.end_sku_swap(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.start_sku_swap(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, uuid) to service_role;
grant execute on function public.end_sku_swap(uuid, jsonb, uuid) to service_role;

do $$
declare
  f text;
  r text;
  p text;
begin
  foreach f in array array['public.start_sku_swap(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, uuid)', 'public.end_sku_swap(uuid, jsonb, uuid)'] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0265: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '0265: % can execute %', r, f;
      end if;
    end loop;
  end loop;
  foreach f in array array['public.swap_recipe_default_lines(uuid)', 'public.swap_version_lines(uuid)', 'public.swap_affected_recipes(uuid, uuid)',
                           'public.swap_pinned_recipes(uuid, uuid)'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '0265: % can execute helper %', r, f;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role', 'public.sku_swaps', 'select') then
    raise exception '0265: service_role cannot read sku_swaps';
  end if;
  foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('service_role', 'public.sku_swaps', p) then
      raise exception '0265: service_role may only read sku_swaps';
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.sku_swaps', 'select') then
      raise exception '0265: % can read sku_swaps', r;
    end if;
  end loop;
end $$;

commit;
```

- [ ] **Step 3: Write `tests/sku-swaps-pglite.test.ts`**

```ts
/**
 * Catalog Phase 4a — 0265 for real (PGlite): a shop's swap, a default swap, a product-only swap, the complete-set check,
 * Back to normal (and a primary changed since), kept changes, an owned recipe. PGlite is ONE connection: interleavings
 * that need two live transactions run in the sim race harness (Task 14b); here each "meanwhile" is a committed write.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createSandwich, migratedShopOwnedDb, OWN, refusal } from "./fixtures/shop-owned-pglite";

let db: PGlite;
beforeEach(async () => { db = await migratedShopOwnedDb({ swaps: true }); });
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const turkeyLines = (sku: string, qty = 4) => JSON.stringify([{ component_sku_id: sku, quantity: qty, unit: "oz", portioned: false }]);
const head = async (recipe: string) =>
  (await one<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [recipe])).id;
const snapshot = async (recipe: string, location: string | null, lines: string) =>
  (await one<{ s: unknown }>(`select public.recipe_change_snapshot($1::uuid, $2::uuid, $3::jsonb) as s`, [recipe, location, lines])).s;

type Entry = { recipe: string; location: string | null; expected: string | null; basedOn: string | null; lines?: string; stale?: boolean };
type Bound = { recipe: string; location: string | null; lines: string };
type Started = { swap_id: string; versions: Array<{ recipe_id: string; version_id: string }> };
type Ended = { back: string[]; kept: string[]; primary: string; grouping: string };

/** The REAL start_sku_swap; every snapshot taken now, as the preview would. */
async function start(a: {
  shop: string | null; mode: "for_now" | "for_good"; recipes: Entry[]; bound?: Bound[]; product?: object; old?: string; neu?: string;
}): Promise<Started> {
  const recipes: unknown[] = [];
  for (const e of a.recipes) {
    const lines = e.lines ?? turkeyLines(a.neu ?? OWN.newTurkey);
    recipes.push({ recipe_id: e.recipe, location: e.location, expected: e.expected, based_on: e.basedOn, lines: JSON.parse(lines),
      snapshot: e.stale ? {} : await snapshot(e.recipe, e.location, lines) });
  }
  const bound: unknown[] = [];
  for (const b of a.bound ?? []) {
    bound.push({ recipe_id: b.recipe, location: b.location, lines: JSON.parse(b.lines), snapshot: await snapshot(b.recipe, b.location, b.lines) });
  }
  return (await one<{ v: Started }>(
    `select public.start_sku_swap($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6::jsonb, $7::jsonb, null, $8::uuid) as v`,
    [a.shop, a.old ?? OWN.turkey, a.neu ?? OWN.newTurkey, a.mode, JSON.stringify(a.product ?? { create: { name: "Turkey" } }),
     JSON.stringify(recipes), JSON.stringify(bound), OWN.actor])).v;
}

/** The REAL end_sku_swap; snapshots taken now over what goes back (the default's lines, or the replaced version's). */
async function backToNormal(swapId: string, entries: Array<{ recipe: string; location: string | null; replaced: string | null }>): Promise<Ended> {
  const snaps: Record<string, unknown> = {};
  for (const e of entries) {
    const lines = e.replaced === null
      ? (await one<{ l: unknown }>(`select public.swap_recipe_default_lines($1::uuid) as l`, [e.recipe])).l
      : (await one<{ l: unknown }>(`select public.swap_version_lines($1::uuid) as l`, [e.replaced])).l;
    snaps[e.recipe] = await snapshot(e.recipe, e.location, JSON.stringify(lines));
  }
  return (await one<{ v: Ended }>(`select public.end_sku_swap($1::uuid, $2::jsonb, $3::uuid) as v`, [swapId, JSON.stringify(snaps), OWN.actor])).v;
}

const sharedAtA = async (): Promise<Entry> => ({ recipe: OWN.sharedRecipe, location: OWN.shopA, expected: null, basedOn: await head(OWN.sharedRecipe) });

describe("Just for now at Shop A", () => {
  it("switches Shop A's recipe, groups both items, pins the default to the old item, and points Shop A at the new one", async () => {
    const s = await start({ shop: OWN.shopA, mode: "for_now", recipes: [await sharedAtA()] });
    const v = await one<{ location_id: string; active: boolean }>(`select location_id, active from public.recipe_versions where id = $1`, [s.versions[0]!.version_id]);
    expect(v).toEqual({ location_id: OWN.shopA, active: true });
    const prims = (await db.query<{ location_id: string | null; primary_sku_id: string }>(
      `select pp.location_id, pp.primary_sku_id from public.product_primaries pp join public.vendor_items vi on vi.product_id = pp.product_id
        where vi.id = $1 order by pp.location_id nulls first`, [OWN.turkey])).rows;
    expect(prims).toEqual([{ location_id: null, primary_sku_id: OWN.turkey }, { location_id: OWN.shopA, primary_sku_id: OWN.newTurkey }]);
    expect((await one<{ active: boolean }>(`select active from public.sku_swaps where id = $1`, [s.swap_id])).active).toBe(true);
    expect(await refusal(start({ shop: OWN.shopA, mode: "for_now",
      recipes: [{ recipe: OWN.sharedRecipe, location: OWN.shopA, expected: s.versions[0]!.version_id, basedOn: null }] }))).toContain("swap:already_swapped");
  });
  it("Back to normal: the shop rides the default again and its primary row is gone", async () => {
    const s = await start({ shop: OWN.shopA, mode: "for_now", recipes: [await sharedAtA()] });
    expect(await backToNormal(s.swap_id, [{ recipe: OWN.sharedRecipe, location: OWN.shopA, replaced: null }]))
      .toEqual({ back: [OWN.sharedRecipe], kept: [], primary: "restored", grouping: "undone" });
    // Exactly as before: no product, no membership.
    expect((await one<{ n: number }>(`select count(*)::int as n from public.vendor_items where product_id is not null`)).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.products where active`)).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where recipe_id = $1 and location_id = $2 and active`, [OWN.sharedRecipe, OWN.shopA])).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.product_primaries where location_id = $1`, [OWN.shopA])).n).toBe(0);
    expect((await one<{ active: boolean }>(`select active from public.sku_swaps where id = $1`, [s.swap_id])).active).toBe(false);
  });
  it("a version the GM changed after the swap is KEPT and named", async () => {
    const s = await start({ shop: OWN.shopA, mode: "for_now", recipes: [await sharedAtA()] });
    const lines = turkeyLines(OWN.newTurkey, 5);
    await db.query(`select public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, $4::uuid, null, null, $5::uuid, null, null, null,
                      public.recipe_change_snapshot($1::uuid, $2::uuid, $3::jsonb))`,
      [OWN.sharedRecipe, OWN.shopA, lines, s.versions[0]!.version_id, OWN.actor]);
    expect(await backToNormal(s.swap_id, [{ recipe: OWN.sharedRecipe, location: OWN.shopA, replaced: null }]))
      .toEqual({ back: [], kept: [OWN.sharedRecipe], primary: "restored", grouping: "undone" });
  });
  it("is bound to the preview: a stale snapshot refuses before anything is written", async () => {
    expect(await refusal(start({ shop: OWN.shopA, mode: "for_now", recipes: [{ ...(await sharedAtA()), stale: true }] })))
      .toContain("recipe_version:dependencies_changed");
    expect((await one<{ n: number }>(`select count(*)::int as n from public.products`)).n).toBe(0);
  });
  it("refuses lines that still name the old item", async () => {
    expect(await refusal(start({ shop: OWN.shopA, mode: "for_now", recipes: [{ ...(await sharedAtA()), lines: turkeyLines(OWN.turkey) }] })))
      .toContain("swap:invalid_payload");
  });
  it("THE SET IS COMPLETE (Astra r1): a recipe that started using the old item after the preview refuses recipes_changed, nothing written", async () => {
    await db.exec(`begin;
      insert into public.recipes(id, name, recipe_type, batch_yield) values ('00000000-0000-4000-8000-0000000000e2', 'Club', 'consumer', 1);
      insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ('00000000-0000-4000-8000-0000000000e2', '${OWN.turkey}', 3, 'oz');
      commit;`);
    expect(await refusal(start({ shop: OWN.shopA, mode: "for_now", recipes: [await sharedAtA()] }))).toContain("swap:recipes_changed");
    expect((await one<{ n: number }>(`select count(*)::int as n from public.products`)).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where location_id = $1`, [OWN.shopA])).n).toBe(0);
  });
});

describe("For good everywhere (the default)", () => {
  it("writes the default's version, points the default primary at the new item, and is a record from the start", async () => {
    const h = await head(OWN.sharedRecipe);
    const s = await start({ shop: null, mode: "for_good", recipes: [{ recipe: OWN.sharedRecipe, location: null, expected: h, basedOn: null }] });
    expect((await one<{ location_id: string | null }>(`select location_id from public.recipe_versions where id = $1`, [s.versions[0]!.version_id])).location_id).toBeNull();
    expect((await one<{ p: string }>(`select primary_sku_id as p from public.product_primaries where location_id is null`)).p).toBe(OWN.newTurkey);
    expect((await one<{ active: boolean; prev: string }>(`select active, previous_primary_sku_id as prev from public.sku_swaps where id = $1`, [s.swap_id])))
      .toEqual({ active: false, prev: OWN.turkey });
    expect(await refusal(backToNormal(s.swap_id, [{ recipe: OWN.sharedRecipe, location: null, replaced: null }]))).toContain("swap:not_live");
  });
  it("Just for now must name a shop", async () => {
    expect(await refusal(start({ shop: null, mode: "for_now", recipes: [{ recipe: OWN.sharedRecipe, location: null, expected: await head(OWN.sharedRecipe), basedOn: null }] })))
      .toContain("swap:invalid_mode");
  });
});

describe("a product-only swap — the recipes that pin the product follow the primary (Astra r1)", () => {
  const P = "00000000-0000-4000-8000-0000000000f7";
  const HAM1 = "00000000-0000-4000-8000-0000000000d7";
  const HAM2 = "00000000-0000-4000-8000-0000000000d8";
  const CLUB = "00000000-0000-4000-8000-0000000000e3";
  const clubLines = JSON.stringify([{ component_product_id: P, quantity: 3, unit: "oz", portioned: false }]);
  beforeEach(async () => {
    await db.exec(`
      insert into public.vendor_items(id, name, location_id) values ('${HAM1}', 'Ham', null), ('${HAM2}', 'Ham (new vendor)', null);
      insert into public.products(id, name, active) values ('${P}', 'Ham', true);
      update public.vendor_items set product_id = '${P}' where id in ('${HAM1}', '${HAM2}');
      insert into public.product_primaries(product_id, location_id, primary_sku_id) values ('${P}', null, '${HAM1}');
      begin;
      insert into public.recipes(id, name, recipe_type, batch_yield) values ('${CLUB}', 'Club', 'consumer', 1);
      insert into public.recipe_inputs(recipe_id, component_product_id, quantity, unit) values ('${CLUB}', '${P}', 3, 'oz');
      commit;`);
  });
  const swapHam = (bound: Bound[]) => start({ shop: OWN.shopA, mode: "for_now", old: HAM1, neu: HAM2, product: { id: P }, recipes: [], bound });

  it("the recipes that follow the primary must be exactly the ones the preview bound", async () => {
    expect(await refusal(swapHam([]))).toContain("swap:recipes_changed");
  });
  it("binds them, writes no version for them, and points Shop A at the new item", async () => {
    await swapHam([{ recipe: CLUB, location: OWN.shopA, lines: clubLines }]);
    expect((await one<{ p: string }>(`select primary_sku_id as p from public.product_primaries where product_id = $1 and location_id = $2`, [P, OWN.shopA])).p).toBe(HAM2);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.recipe_versions where recipe_id = $1 and location_id = $2`, [CLUB, OWN.shopA])).n).toBe(0);
  });
  it("Back to normal keeps a primary someone chose since (checked conditional write) and says so", async () => {
    const s = await swapHam([{ recipe: CLUB, location: OWN.shopA, lines: clubLines }]);
    await db.query(`update public.product_primaries set primary_sku_id = $1 where product_id = $2 and location_id = $3`, [HAM1, P, OWN.shopA]);
    expect(await backToNormal(s.swap_id, [])).toEqual({ back: [], kept: [], primary: "changed_since", grouping: "kept_primary_changed" });
    expect((await one<{ p: string }>(`select primary_sku_id as p from public.product_primaries where product_id = $1 and location_id = $2`, [P, OWN.shopA])).p).toBe(HAM1);
  });
  it("…and removes the swap's own row when nobody touched it", async () => {
    const s = await swapHam([{ recipe: CLUB, location: OWN.shopA, lines: clubLines }]);
    expect(await backToNormal(s.swap_id, [])).toEqual({ back: [], kept: [], primary: "restored", grouping: "none" });
    expect((await one<{ n: number }>(`select count(*)::int as n from public.product_primaries where product_id = $1 and location_id = $2`, [P, OWN.shopA])).n).toBe(0);
  });
});

describe("a sandwich Shop A owns (0264)", () => {
  it("is switched as itself (its default) beside the shared recipe, and both are restored by Back to normal", async () => {
    const sw = await createSandwich(db, OWN.shopA, "Local Hero", [OWN.turkey]);
    const before = await head(sw.recipe);
    const s = await start({ shop: OWN.shopA, mode: "for_now", recipes: [
      await sharedAtA(),
      { recipe: sw.recipe, location: null, expected: before, basedOn: null,
        lines: JSON.stringify([{ component_sku_id: OWN.newTurkey, quantity: 2, unit: "oz", portioned: false }]) },
    ] });
    const own = s.versions.find((v) => v.recipe_id === sw.recipe)!;
    expect((await one<{ location_id: string | null }>(`select location_id from public.recipe_versions where id = $1`, [own.version_id])).location_id).toBeNull();
    const r = await backToNormal(s.swap_id, [
      { recipe: OWN.sharedRecipe, location: OWN.shopA, replaced: null },
      { recipe: sw.recipe, location: null, replaced: before },
    ]);
    expect([...r.back].sort()).toEqual([OWN.sharedRecipe, sw.recipe].sort());
    expect((await one<{ sku: string }>(`select component_sku_id as sku from public.recipe_inputs where recipe_id = $1`, [sw.recipe])).sku).toBe(OWN.turkey);
  });
  it("a shared recipe cannot be written as 'itself' by a shop", async () => {
    expect(await refusal(start({ shop: OWN.shopA, mode: "for_now", recipes: [{ recipe: OWN.sharedRecipe, location: null, expected: await head(OWN.sharedRecipe), basedOn: null }] })))
      .toContain("swap:invalid_payload");
  });
});
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/sku-swaps-migration.test.ts tests/sku-swaps-pglite.test.ts tests/shop-owned-pglite.test.ts` → expected: PASS, 0 failed.

```bash
git add supabase/migrations/0265_sku_swaps.sql tests/sku-swaps-migration.test.ts tests/sku-swaps-pglite.test.ts
git commit -m "$(cat <<'EOF'
feat(db): 0265 — Swap vendor in one transaction (bound to the preview), and Back to normal (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 5: Owned things are visible only to their owner — at the ONE resolver point and the menu readers

Every reader that answers for a scope reads ownership from the same rows it already reads and filters in memory (`ownerVisible`). No new query on the graph path; one small paged read for the line-only loader and for the Toast pool. With no owned rows nothing is hidden — the Task 1 golden half stays green, and its isolation half turns green here.

| Reader | Decision |
|---|---|
| `loadRecipeGraph` (every depletion, cost, prep, catering and preview caller) | the version scope's visible recipes; `allShopOwned: true` only for cross-shop listings |
| `loadResolvedRecipeInputs` (readiness, par advisories, production, pins) | drops the lines of recipes another shop owns |
| `loadRecipeInputsAcrossScopes` ("used anywhere") | **unchanged** — every shop's things count |
| `loadMenuCostingBoard` | shared menu items + the scope's own |
| Toast `loadEntities(…, locationId)` (auto-match, drift) | shared + that shop's own |
| Toast `listMappableEntities` (every shop's picker) | every entity, a shop-only menu item tagged with its shop |
| Toast `manualMap` | refuses a shop-only target at another shop (0264 refuses it too) |
| `loadCatalogView` (the catalog list) | every shop's (`allShopOwned`), a shop-only menu item named with its shop |
| Readiness `loadGraphRows(scope)` (Astra r1#5) | the SAME universe: another shop's own recipe — and an item only such recipes make — is absent (never "no inputs"); template shop items (0079) no owned recipe makes keep their rows |
| The weights board `loadWeightBoard` (Astra r1#7) | shared items: the global graph and global prices, unchanged; a shop's OWN prep item (made by an owned recipe): its owner's graph and that shop's prices (`ownerCostSources`) |
| Toast item lanes and modifier portions (Astra r1#6) | a shop's pool also holds the prep items ITS OWN recipes make (`loadOwnedPrepItems`); every picker tags them (and a shop's own raw SKUs) with their shop; a portion for a shop's own item comes from that shop's graph; another shop's own item or SKU is refused at the manual link |

**Files:**
- Modify: `lib/prep-consumption.ts`, `lib/menu-item-shop.ts`, `lib/admin/menu-costing.ts`, `lib/admin/toast-map.ts`, `lib/admin/catalog.ts`, `lib/admin/catalog-shared.ts`, `lib/admin/readiness-load.ts`, `lib/weights.ts`, `tests/fixtures/counts-fake-db.ts`, `tests/silent-read-fabrication.test.ts`
- Create: `tests/shop-owned-scope.test.ts`

- [ ] **Step 1: Every fake database has the swap table (empty)**

In `tests/fixtures/counts-fake-db.ts`, in 3a's line `for (const t of ["recipe_versions", "recipe_version_lines", "menu_item_shop_settings", "recipe_notice_dismissals"]) tables[t] ??= [];`, add `"sku_swaps"` to the list (catalog Phase 4a, 0265).

- [ ] **Step 2: Write the failing test `tests/shop-owned-scope.test.ts`**

```ts
/**
 * Catalog Phase 4a — a shop-only sandwich is its owner's: the graph, the line-only loader, the Toast picker and the
 * manual link all agree (the costing board and every number: tests/shop-owned-equivalence.test.ts).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_MENU, OWNED_RECIPE } from "./fixtures/shop-owned-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));

import { loadRecipeGraph, loadRecipeInputsAcrossScopes, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { listMappableEntities, manualMap } from "@/lib/admin/toast-map";
import { loadGraphReadiness, loadGraphRows } from "@/lib/admin/readiness-load";
import { ownerCostSources } from "@/lib/weights";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { perUnitSkuOzForItemFromGraph } from "@/lib/prep-consumption-graph";

beforeEach(() => {
  const t = buildShopOwnedFixture();
  t.catering_packages ??= [];
  current = createFakeDb(t);
});
afterEach(() => { current = null; });

/**
 * Shop one's own PREP recipe (lead decision 1): "A dressing" (4 oz mayo) makes Shop one's own item, and Shop one's own
 * sandwich uses 1 oz of it (a modifier's portion samples the sandwiches that use the item).
 */
function installWithOwnedPrep(): void {
  const t = buildShopOwnedFixture();
  t.catering_packages ??= [];
  t.toast_menu_map ??= [];
  t.items!.push({ id: "i-a-dressing", name: "A dressing", active: true, location_id: LOC, oz_per_par_unit: 16, sold_directly: false,
    sell_portion: null, sell_portion_unit: null, menu_price: null, default_par_unit: "quart" });
  t.recipes!.push({ id: "r-a-dressing", name: "A dressing", active: true, batch_yield: 1, location_id: LOC, created_at: "2026-10-15T00:00:00.000Z" });
  t.recipe_inputs!.push({ id: "ri-a-dressing", recipe_id: "r-a-dressing", component_sku_id: "s-mayo", component_item_id: null,
    component_product_id: null, quantity: 4, unit: "oz", display_order: 0 });
  t.recipe_outputs!.push({ id: "ro-a-dressing", recipe_id: "r-a-dressing", output_item_id: "i-a-dressing", output_menu_item_id: null, yield: 1 });
  t.recipe_inputs!.push({ id: "ri-hero-dressing", recipe_id: OWNED_RECIPE, component_sku_id: null, component_item_id: "i-a-dressing",
    component_product_id: null, quantity: 1, unit: "oz", display_order: 9 });
  current = createFakeDb(t);
}

describe("the graph", () => {
  it("the default and Shop two never see Shop one's sandwich; Shop one does; a cross-shop listing sees everything", async () => {
    expect((await loadRecipeGraph()).byOutputMenuItem.has(OWNED_MENU)).toBe(false);
    expect((await loadRecipeGraph({ locationId: OTHER })).byOutputMenuItem.has(OWNED_MENU)).toBe(false);
    expect((await loadRecipeGraph({ locationId: LOC })).byOutputMenuItem.get(OWNED_MENU)?.recipeId).toBe(OWNED_RECIPE);
    expect((await loadRecipeGraph({ allShopOwned: true })).byOutputMenuItem.has(OWNED_MENU)).toBe(true);
  });
  it("a capture path (versionLocationId only) follows the shop it captures for", async () => {
    expect((await loadRecipeGraph({ versionLocationId: LOC })).byOutputMenuItem.has(OWNED_MENU)).toBe(true);
    expect((await loadRecipeGraph({ versionLocationId: OTHER })).byOutputMenuItem.has(OWNED_MENU)).toBe(false);
  });
});

describe("the line-only loader", () => {
  it("drops another shop's recipe; keeps the owner's; 'used anywhere' keeps every shop's", async () => {
    const recipesOf = (rows: Array<{ recipe_id: string }>) => new Set(rows.map((r) => r.recipe_id));
    expect(recipesOf(await loadResolvedRecipeInputs(null)).has(OWNED_RECIPE)).toBe(false);
    expect(recipesOf(await loadResolvedRecipeInputs(OTHER)).has(OWNED_RECIPE)).toBe(false);
    expect(recipesOf(await loadResolvedRecipeInputs(LOC)).has(OWNED_RECIPE)).toBe(true);
    expect(recipesOf(await loadRecipeInputsAcrossScopes()).has(OWNED_RECIPE)).toBe(true);
  });
});

describe("Toast", () => {
  it("every shop's picker lists the sandwich, tagged with the one shop it can be linked at", async () => {
    const e = (await listMappableEntities(OWNER_ACTOR)).find((x) => x.id === OWNED_MENU);
    expect(e).toMatchObject({ kind: "menu_item", locationId: LOC });
  });
  it("a manual link at another shop is refused before any write", async () => {
    await expect(manualMap(OWNER_ACTOR, {
      locationId: OTHER, toastItemGuid: "g-1", toastItemName: "Local Hero", entityKind: "menu_item", entityId: OWNED_MENU, isModifier: false,
    })).rejects.toMatchObject({ status: 400, code: "invalid_entity" });
    expect(current!.writes.filter((w) => w.table === "toast_menu_map")).toEqual([]);
  });
  it("the auto-match pool filters by owner before the shop overlay, and adds the shop's own prep items", () => {
    const src = readFileSync("lib/admin/toast-map.ts", "utf8");
    expect(src).toContain("return [...applyMenuOverlayToEntities(filterOwnedEntities(entities, owners, locationId), overlay), ...ownItems];");
    expect(src).toContain("? derivePortion(ownedItemIds.has(c.entity.id) ? shopGraph : graph, c.entity.id)");
  });
  it("a shop's own prep item: tagged with its shop in every picker; linked at its shop with the portion its own sandwiches use; refused elsewhere (Astra r1#6)", async () => {
    installWithOwnedPrep();
    expect((await listMappableEntities(OWNER_ACTOR)).find((x) => x.id === "i-a-dressing")).toMatchObject({ kind: "item", locationId: LOC });
    await manualMap(OWNER_ACTOR, { locationId: LOC, toastItemGuid: "g-dressing", toastItemName: "Add dressing", entityKind: "item", entityId: "i-a-dressing", isModifier: true });
    expect(current!.writes.find((w) => w.table === "toast_menu_map")!.rows[0]).toMatchObject({ item_id: "i-a-dressing", portion_qty: 1, portion_unit: "oz" });
    await expect(manualMap(OWNER_ACTOR, { locationId: OTHER, toastItemGuid: "g-dressing-2", toastItemName: "Add dressing", entityKind: "item", entityId: "i-a-dressing", isModifier: true }))
      .rejects.toMatchObject({ status: 400, code: "invalid_entity" });
  });
});

describe("readiness reads the same universe (Astra r1#5)", () => {
  it("another shop's own recipe, and the items only it makes, are absent from that shop's and the default's rows — never 'no inputs'", async () => {
    installWithOwnedPrep();
    for (const scope of [null, OTHER]) {
      const rows = await loadGraphRows(scope);
      expect(rows.recipes.map((r) => r.id)).not.toContain(OWNED_RECIPE);
      expect(rows.recipes.map((r) => r.id)).not.toContain("r-a-dressing");
      expect(rows.outputs.some((o) => o.recipe_id === "r-a-dressing" || o.recipe_id === OWNED_RECIPE)).toBe(false);
      expect(rows.items.map((i) => i.id)).not.toContain("i-a-dressing");
    }
    const here = await loadGraphRows(LOC);
    expect(here.recipes.map((r) => r.id)).toEqual(expect.arrayContaining([OWNED_RECIPE, "r-a-dressing"]));
    expect(here.items.map((i) => i.id)).toContain("i-a-dressing");
  });
  it("…so neither the entries nor the hub's per-shop rollup count it at another shop", async () => {
    installWithOwnedPrep();
    const other = await loadGraphReadiness(OWNER_ACTOR, OTHER);
    expect(other.recipeReadiness.has("r-a-dressing")).toBe(false);
    expect(other.itemReadiness.has("i-a-dressing")).toBe(false);
    const here = await loadGraphReadiness(OWNER_ACTOR, LOC);
    expect(here.recipeReadiness.get("r-a-dressing")?.reasons ?? []).not.toContain("no_inputs");
  });
});

describe("the weights board costs a shop's own prep item in its owner's graph (Astra r1#7)", () => {
  it("at its shop's prices; every other item keeps the global graph", async () => {
    installWithOwnedPrep();
    const global = await loadRecipeGraph();
    expect(global.byOutputItem.has("i-a-dressing")).toBe(false);
    const prices = await loadCurrentSkuPrices([...global.skuPack.keys()], null);
    const globalSrc = { graph: global, costPerOz: costPerOzFromGraph(global, prices) };
    const src = await ownerCostSources(globalSrc);
    expect(src("i-slaw")).toBe(globalSrc);
    const own = src("i-a-dressing");
    expect(own.graph.byOutputItem.get("i-a-dressing")?.recipeId).toBe("r-a-dressing");
    expect([...perUnitSkuOzForItemFromGraph(own.graph, "i-a-dressing").keys()]).toEqual(["s-mayo"]);
    expect(own.costPerOz).not.toBe(globalSrc.costPerOz);
  });
  it("with nothing owned it reads nothing more than the owners", async () => {
    const global = await loadRecipeGraph();
    const globalSrc = { graph: global, costPerOz: new Map<string, number>() };
    const before = current!.log.length;
    const src = await ownerCostSources(globalSrc as never);
    expect(src("i-slaw")).toBe(globalSrc);
    expect(current!.log.slice(before).map((q) => q.table)).toEqual(["recipes"]);
  });
});
```

Run: `npx vitest run tests/shop-owned-scope.test.ts tests/shop-owned-equivalence.test.ts` → expected: FAIL (the sandwich leaks into every scope; `allShopOwned`, `loadRecipeOwners` / `loadMenuItemOwners`, `ownerCostSources` and `loadOwnedPrepItems` do not exist; readiness lists Shop one's recipe everywhere).

(The fake database's `readiness` reasons depend on 3a's `recipeOwnReadiness`; the last assertion only says Shop one's own prep recipe is not "no inputs" at its own shop — if the reason code there is spelled differently, use 3a's spelling.)

- [ ] **Step 3: The graph (`lib/prep-consumption.ts`)**

1. Add `import { ownerVisible } from "@/lib/catalog/shop-owned-shared";` beside the other `@/lib/…` imports.
2. In `loadRecipeGraph`'s options type (3a's multi-line form), after the `recipeOverrides?: …;` member, add:

```ts
  /**
   * Every shop's SHOP-ONLY recipes too (catalog Phase 4a, 0264) — ONLY for a listing that serves no one shop (the
   * catalog list). Never for a number a shop acts on: by default a shop-only recipe exists only in its owner's scope.
   */
  allShopOwned?: boolean;
```

3. In the recipes read, replace `sb.from("recipes").select("id, batch_yield").eq("active", true)` with `sb.from("recipes").select("id, batch_yield, location_id").eq("active", true)`, and in the same call replace `.returns<Array<{ id: string; batch_yield: number | string | null }>>(),` with `.returns<Array<{ id: string; batch_yield: number | string | null; location_id?: string | null }>>(),`.
4. Replace 3a's

```ts
  const replacements = await loadRecipeLineOverlay(versionScope, asOf);
  for (const [recipeId, lines] of opts?.recipeOverrides ?? []) replacements.set(recipeId, [...lines]);
  const lineRows = [...(inRows ?? []), ...[...replacements.values()].flat()];
```

with

```ts
  const replacements = await loadRecipeLineOverlay(versionScope, asOf);
  // CATALOG PHASE 4a (0264): A SHOP-ONLY RECIPE EXISTS ONLY IN ITS OWNER'S SCOPE (ownerVisible). The default and every
  // other shop never see it — not as a producer, not through its lines' SKUs and products, not through a dated
  // version. Decided in memory from the recipes read above: with nothing owned nothing is hidden, and every row, its
  // order and the query count are exactly as before.
  const hidden = new Set((recRows ?? [])
    .filter((r) => opts?.allShopOwned !== true && !ownerVisible(r.location_id ?? null, versionScope))
    .map((r) => r.id));
  for (const id of hidden) replacements.delete(id);
  for (const [recipeId, lines] of opts?.recipeOverrides ?? []) replacements.set(recipeId, [...lines]);
  const visibleInRows = hidden.size === 0 ? (inRows ?? []) : (inRows ?? []).filter((c) => !hidden.has(c.recipe_id));
  const lineRows = [...visibleInRows, ...[...replacements.values()].flat()];
```

5. Replace 3a's

```ts
  for (const c of inRows ?? []) {
    if (replacements.has(c.recipe_id)) continue; // this scope answers with another version's lines (below)
```

with

```ts
  for (const c of visibleInRows) {
    if (replacements.has(c.recipe_id)) continue; // this scope answers with another version's lines (below)
```

6. Replace `  const recipes: GraphRecipe[] = (recRows ?? []).map((r) => ({` with `  const recipes: GraphRecipe[] = (recRows ?? []).filter((r) => !hidden.has(r.id)).map((r) => ({`.
7. In the doc comment above `loadRecipeGraph`, append after 3a's "RECIPES ARE VERSIONED TOO" paragraph:

```ts
 *
 * SHOP-ONLY RECIPES (catalog Phase 4a, 0264): a recipe a shop owns is part of that shop's graph only — the same
 * version scope decides (ownerVisible), so a capture path follows the shop it captures for. `allShopOwned` lists
 * every shop's, for the catalog list only.
```

- [ ] **Step 4: The line-only loader (`lib/prep-consumption.ts`)**

1. Directly before `export async function loadResolvedRecipeInputs(`, insert:

```ts
/** recipe → the shop that owns it, for SHOP-ONLY recipes only (0264; shared recipes are absent). Paged; fails loud. */
export async function loadRecipeOwners(sb: ReturnType<typeof getServiceRoleClient> = getServiceRoleClient()): Promise<Map<string, string>> {
  const rows = await selectAllRows<{ id: string; location_id: string }>(async (from, to) => {
    const { data, error } = await sb.from("recipes").select("id, location_id").not("location_id", "is", null)
      .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string }>>();
    if (error) throw new Error(`loadRecipeOwners: ${error.message}`);
    return { data };
  });
  return new Map(rows.map((r) => [r.id, r.location_id]));
}
```

2. Replace 3a's body of `loadResolvedRecipeInputs`

```ts
  const sb = getServiceRoleClient();
  const [base, replacements] = await Promise.all([
    readAllRecipeInputs(sb, "loadResolvedRecipeInputs"),
    loadRecipeLineOverlay(scope, asOf),
  ]);
  return mergeResolvedInputs(base, replacements);
}
```

with

```ts
  const sb = getServiceRoleClient();
  const [base, replacements, owners] = await Promise.all([
    readAllRecipeInputs(sb, "loadResolvedRecipeInputs"),
    loadRecipeLineOverlay(scope, asOf),
    loadRecipeOwners(sb),
  ]);
  // CATALOG PHASE 4a (0264): another shop's shop-only recipe is not this scope's (the graph's rule, ownerVisible).
  const merged = mergeResolvedInputs(base, replacements);
  return owners.size === 0 ? merged : merged.filter((l) => ownerVisible(owners.get(l.recipe_id) ?? null, scope));
}
```

`loadRecipeInputsAcrossScopes` does not change ("used anywhere" counts every shop's).

3. In `tests/silent-read-fabrication.test.ts`, in the batch-loader list 3a extended, add `["export async function loadRecipeOwners(", "loadRecipeOwners:"],`.

- [ ] **Step 5: The menu owners loader (`lib/menu-item-shop.ts`)**

Append:

```ts
/** menu item → the shop that owns it, for SHOP-ONLY sandwiches only (0264; shared items are absent). Paged; fails loud. */
export async function loadMenuItemOwners(): Promise<Map<string, string>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<{ id: string; location_id: string }>(async (from, to) => {
    const { data, error } = await sb.from("menu_items").select("id, location_id").not("location_id", "is", null)
      .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string }>>();
    if (error) throw new Error(`loadMenuItemOwners: ${error.message}`);
    return { data };
  });
  return new Map(rows.map((r) => [r.id, r.location_id]));
}
```

and add `["export async function loadMenuItemOwners(", "loadMenuItemOwners:"],` to the same silent-read list.

- [ ] **Step 6: The costing board (`lib/admin/menu-costing.ts`)**

1. Add `import { ownerVisible } from "@/lib/catalog/shop-owned-shared";`.
2. In the `menu_items` read, replace `.select("id, name, name_es, section, menu_price, price_same_as_id, catering_available")` with `.select("id, name, name_es, section, menu_price, price_same_as_id, catering_available, location_id")`, and in its `.returns<…>()` type add `location_id?: string | null;` after `catering_available: boolean;`.
3. Directly after `  if (menuRes.error) throw new Error(\`loadMenuCostingBoard menu_items: ${menuRes.error.message}\`);`, insert:

```ts
  // CATALOG PHASE 4a (0264): the board of a scope lists the shared menu and that scope's OWN sandwiches — never another
  // shop's (ownerVisible). "All shops" lists the shared menu only.
  const menuRows = (menuRes.data ?? []).filter((m) => ownerVisible(m.location_id ?? null, scope));
```

4. In the rest of the function, replace each of 3a's three occurrences of `(menuRes.data ?? [])` (in `menuById`, `notSoldHere` and `inputs`) with `menuRows`.

- [ ] **Step 6b: Readiness reads the same universe (`lib/admin/readiness-load.ts`, after 3a; Astra r1#5)**

1. Add `import { ownerVisible } from "@/lib/catalog/shop-owned-shared";`.
2. In `interface GraphRows`, replace `  recipes: Array<{ id: string; batch_yield: number | string | null; batch_mode?: boolean | null }>;` with `  recipes: Array<{ id: string; batch_yield: number | string | null; batch_mode?: boolean | null; location_id?: string | null }>;`.
3. In `loadGraphRows`, replace `      sb.from("recipes").select("id, batch_yield, batch_mode").eq("active", true)` with `      sb.from("recipes").select("id, batch_yield, batch_mode, location_id").eq("active", true)`.
4. Replace the function's closing `  return { recipes, inputs, outputs, items };` with:

```ts
  // CATALOG PHASE 4a (0264; Astra 4a r1#5): readiness reads the SAME universe as the graph. The inputs above already drop
  // another shop's own recipe (loadResolvedRecipeInputs); its ROW, its outputs and the items ONLY such recipes make go
  // too — otherwise a complete recipe of Shop A reads "no inputs" at Shop B and inflates Shop B's rollup. Template shop
  // items (0079) that no shop-owned recipe makes keep their rows, as before.
  const hidden = new Set(recipes.filter((r) => !ownerVisible(r.location_id ?? null, scope)).map((r) => r.id));
  if (hidden.size === 0) return { recipes, inputs, outputs, items };
  const visibleOutputs = outputs.filter((o) => !hidden.has(o.recipe_id));
  const madeHere = new Set(visibleOutputs.map((o) => o.output_item_id).filter((v): v is string => v != null));
  const onlyHidden = new Set(outputs.filter((o) => hidden.has(o.recipe_id) && o.output_item_id != null && !madeHere.has(o.output_item_id))
    .map((o) => o.output_item_id!));
  return {
    recipes: recipes.filter((r) => !hidden.has(r.id)),
    inputs,
    outputs: visibleOutputs,
    items: items.filter((i) => !onlyHidden.has(i.id)),
  };
```

- [ ] **Step 6c: The weights board (`lib/weights.ts`; Astra r1#7)**

1. Replace `import { loadRecipeGraph } from "@/lib/prep-consumption";` with `import { loadRecipeGraph, loadRecipeOwners } from "@/lib/prep-consumption";` and `import { perUnitSkuOzForItemFromGraph } from "@/lib/prep-consumption-graph";` with `import { perUnitSkuOzForItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";`.
2. Directly before `export async function loadWeightBoard(`, insert:

```ts
type CostSource = { graph: RecipeGraph; costPerOz: ReturnType<typeof costPerOzFromGraph> };

/**
 * CATALOG PHASE 4a (0264; Astra 4a r1#7): a shop's OWN prep item is made only in its owner's graph (an owned recipe is
 * invisible to the global one), so its $/oz is read THERE, at that shop's prices. Every other item keeps the global
 * graph and global prices — byte-identical. One read of the owners; one graph and one price read per shop that owns a
 * recipe, all in one wave — none when nothing is owned.
 */
export async function ownerCostSources(global: CostSource): Promise<(itemId: string) => CostSource> {
  const owners = await loadRecipeOwners();
  if (owners.size === 0) return () => global;
  const shops = [...new Set(owners.values())].sort();
  const sources = await Promise.all(shops.map(async (shop) => {
    const graph = await loadRecipeGraph({ locationId: shop });
    const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()], shop);
    return { shop, src: { graph, costPerOz: costPerOzFromGraph(graph, prices) } };
  }));
  const byItem = new Map<string, CostSource>();
  for (const { shop, src } of sources) {
    for (const [itemId, node] of src.graph.byOutputItem) if (owners.get(node.recipeId) === shop) byItem.set(itemId, src);
  }
  return (itemId) => byItem.get(itemId) ?? global;
}
```

3. In `loadWeightBoard`, directly after `  const costPerOz = costPerOzFromGraph(graph, prices);`, add `  const costSourceFor = await ownerCostSources({ graph, costPerOz });`; in the ITEM loop replace `    const legs = perUnitSkuOzForItemFromGraph(graph, it.id);` with

```ts
    // A shop's own prep item: its owner's graph and prices (ownerCostSources); every other item: the global ones.
    const src = costSourceFor(it.id);
    const legs = perUnitSkuOzForItemFromGraph(src.graph, it.id);
```

and, in the same loop, `        const c = costPerOz.get(skuId) ?? null;` with `        const c = src.costPerOz.get(skuId) ?? null;`.

- [ ] **Step 7: Toast (`lib/admin/toast-map.ts`)**

1. Extend 3a's import from `@/lib/menu-item-shop` to `import { loadLiveMenuItemShopSettings, loadMenuItemOwners } from "@/lib/menu-item-shop";` and add `import { filterOwnedEntities } from "@/lib/catalog/shop-owned-shared";`.
2. Directly before `async function loadEntities(`, insert (Astra 4a r1#6):

```ts
/**
 * CATALOG PHASE 4a (0264; Astra 4a r1#6): the prep items a shop's OWN recipes make (an owned recipe makes only its shop's
 * own items). The shared-only item read in loadEntities never sees them. `shopId` null = every shop's (each tagged).
 * `all` false = the sellable lane (sold_directly). Fixed batch reads; none past the first when nothing is owned.
 */
type OwnedEntity = CoEntity & { ownerShopId: string };
async function loadOwnedPrepItems(shopId: string | null, all: boolean): Promise<OwnedEntity[]> {
  const sb = getServiceRoleClient();
  let rq = sb.from("recipes").select("id, location_id").eq("active", true).not("location_id", "is", null);
  if (shopId !== null) rq = rq.eq("location_id", shopId);
  const { data: recs, error: rErr } = await rq.returns<Array<{ id: string; location_id: string }>>();
  if (rErr) throw new Error(`toast-map owned recipes: ${rErr.message}`);
  if ((recs ?? []).length === 0) return [];
  const { data: outs, error: oErr } = await sb.from("recipe_outputs").select("recipe_id, output_item_id")
    .in("recipe_id", (recs ?? []).map((r) => r.id)).not("output_item_id", "is", null)
    .returns<Array<{ recipe_id: string; output_item_id: string }>>();
  if (oErr) throw new Error(`toast-map owned outputs: ${oErr.message}`);
  const shopOfRecipe = new Map((recs ?? []).map((r) => [r.id, r.location_id]));
  const shopOfItem = new Map((outs ?? []).map((o) => [o.output_item_id, shopOfRecipe.get(o.recipe_id)!]));
  if (shopOfItem.size === 0) return [];
  let iq = sb.from("items").select("id, name, menu_price, location_id").eq("active", true).in("id", [...shopOfItem.keys()]);
  if (!all) iq = iq.eq("sold_directly", true);
  const { data: rows, error: iErr } = await iq.returns<Array<{ id: string; name: string; menu_price: number | string | null; location_id: string | null }>>();
  if (iErr) throw new Error(`toast-map owned items: ${iErr.message}`);
  return (rows ?? []).filter((r) => r.location_id != null && r.location_id === shopOfItem.get(r.id))
    .map((r) => ({ kind: "item" as const, id: r.id, name: r.name, priceCents: toCents(r.menu_price), ownerShopId: r.location_id! }));
}
```

3. In `loadEntities`, replace 3a's

```ts
  if (locationId === null) return entities;
  return applyMenuOverlayToEntities(entities, await loadLiveMenuItemShopSettings(locationId));
}
```

with

```ts
  if (locationId === null) return entities;
  // CATALOG PHASE 4a (0264): a shop's pool holds the shared menu and ITS OWN sandwiches — never another shop's — and,
  // in the item lanes, the prep items ITS OWN recipes make (Astra 4a r1#6).
  const [owners, overlay, ownItems] = await Promise.all([
    loadMenuItemOwners(), loadLiveMenuItemShopSettings(locationId), loadOwnedPrepItems(locationId, all),
  ]);
  return [...applyMenuOverlayToEntities(filterOwnedEntities(entities, owners, locationId), overlay), ...ownItems];
}
```

4. The modifier lane of `runAutoMatch` reads the SHOP's pool and portions a shop's own item from the shop's graph. Make its pool call pass the shop (3a's `loadEntities(true…)` → `loadEntities(true, locationId)`; with nothing owned and no shop overlay the pool is unchanged), then replace

```ts
    const graph = await loadRecipeGraph();
```

(the modifier lane's — the first of the two in the file) with

```ts
    const graph = await loadRecipeGraph();
    // A shop's OWN prep item (0264) is made — and used — only in its owner's graph: its portion comes from there.
    const ownedItemIds = new Set(allEntities.filter((e): e is OwnedEntity => "ownerShopId" in e).map((e) => e.id));
    const shopGraph = ownedItemIds.size > 0 ? await loadRecipeGraph({ locationId }) : graph;
```

and replace `        ? derivePortion(graph, c.entity.id)` with `        ? derivePortion(ownedItemIds.has(c.entity.id) ? shopGraph : graph, c.entity.id)`.

5. In `export interface MappableEntity`, replace the doc line `  /** Packages only: null = global, else the owning location. Items/menu_items/SKUs are global (null). */` with `  /** null = every shop; else the one shop it belongs to — a package, a shop-only menu item or prep item (0264), a shop's own raw SKU. */`.
6. `loadRawSkus`: select `"id, name, location_id"` and return `Array<{ id: string; name: string; location_id: string | null }>` (its `.returns<…>()` and the function's return type).
7. In `listMappableEntities`, replace `  const [all, { data: pkgs, error: pErr }, rawSkus] = await Promise.all([` with `  const [all, { data: pkgs, error: pErr }, rawSkus, owners, ownItems] = await Promise.all([`, and replace the array's last element `    loadRawSkus(),\n  ]);` with `    loadRawSkus(),\n    loadMenuItemOwners(),\n    loadOwnedPrepItems(null, true),\n  ]);`; then replace `    ...all.map((e): MappableEntity => ({ id: e.id, name: e.name, kind: e.kind, locationId: null })),` with

```ts
    ...all.map((e): MappableEntity => ({ id: e.id, name: e.name, kind: e.kind, locationId: e.kind === "menu_item" ? (owners.get(e.id) ?? null) : null })),
    // A shop's own prep items (0264), each tagged with its shop — linkable only there.
    ...ownItems.map((e): MappableEntity => ({ id: e.id, name: e.name, kind: "item", locationId: e.ownerShopId })),
```

and `    ...rawSkus.map((s): MappableEntity => ({ id: s.id, name: s.name, kind: "sku", locationId: null })),` with `    ...rawSkus.map((s): MappableEntity => ({ id: s.id, name: s.name, kind: "sku", locationId: s.location_id ?? null })),`.
8. In `manualMap`, replace

```ts
      const { data: ent, error: eErr } = await sb.from(table).select("id, name").eq("id", input.entityId!).eq("active", true)
        .maybeSingle<{ id: string; name: string }>();
      if (eErr) throw new Error(`toast-map manual entity check: ${eErr.message}`);
      if (!ent) throw new AdminToastMapError(400, "invalid_entity", "Target not found or inactive");
```

with

```ts
      const { data: ent, error: eErr } = await sb.from(table).select("id, name, location_id").eq("id", input.entityId!).eq("active", true)
        .maybeSingle<{ id: string; name: string; location_id: string | null }>();
      if (eErr) throw new Error(`toast-map manual entity check: ${eErr.message}`);
      if (!ent) throw new AdminToastMapError(400, "invalid_entity", "Target not found or inactive");
      // CATALOG PHASE 4a (0264; the database refuses it too): a shop-only target is linked only at its own shop.
      if (ent.location_id != null && ent.location_id !== input.locationId) {
        throw new AdminToastMapError(400, "invalid_entity", "That is only sold at another shop");
      }
      entityOwner = ent.location_id ?? null;
```

9. In `manualMap`, directly after `  let entityName: string | null = null;` add `  let entityOwner: string | null = null; // a shop's own item (0264): its portion comes from that shop's graph`; in its SKU branch replace `.select("id, name, sku_class").eq("id", input.entityId!).eq("active", true)` with `.select("id, name, sku_class, location_id").eq("id", input.entityId!).eq("active", true)`, its `.maybeSingle<{ id: string; name: string; sku_class: string }>()` with `.maybeSingle<{ id: string; name: string; sku_class: string; location_id: string | null }>()`, and `      if (!skuRow || skuRow.sku_class !== "raw") throw new AdminToastMapError(400, "invalid_entity", "Raw SKU not found or inactive");` with

```ts
      if (!skuRow || skuRow.sku_class !== "raw") throw new AdminToastMapError(400, "invalid_entity", "Raw SKU not found or inactive");
      // Lead decision 2: another shop's own SKU is not this shop's to deplete.
      if (skuRow.location_id != null && skuRow.location_id !== input.locationId) throw new AdminToastMapError(400, "invalid_entity", "That item belongs to another shop");
```

10. In `manualMap`'s modifier portion, replace

```ts
      const graph = await loadRecipeGraph();
      const portion = derivePortion(graph, input.entityId!);
```

with

```ts
      // A shop's own item is made and used only in that shop's graph (0264; Astra 4a r1#6); every other item: the global one.
      const graph = await loadRecipeGraph(entityOwner !== null ? { locationId: input.locationId } : undefined);
      const portion = derivePortion(graph, input.entityId!);
```

- [ ] **Step 8: The catalog list (`lib/admin/catalog.ts`, `lib/admin/catalog-shared.ts`)**

1. In `lib/admin/catalog-shared.ts` `export interface CatalogEntity`, after `taxonType: CatalogType;`, add:

```ts
  /** A shop-only sandwich (0264): the one shop that sells it. Absent / null = every shop. */
  onlyAtShopName?: string | null;
```

2. In `lib/admin/catalog.ts`: in `interface MenuItemRow`, add `location_id?: string | null;`; in the `menu_items` select string append `, location_id`; replace the `loadRecipeGraph(),` element of `loadCatalogView`'s `Promise.all` with `loadRecipeGraph({ allShopOwned: true }),` (the list serves every shop: a shop's own sandwich shows its recipe); in the menu-item `entities.push({ … })`, after `taxonType: deriveCatalogType({ kind: "menu_item", hasBuild: hasRecipe }),` add `onlyAtShopName: mi.location_id ? (locationNameById.get(mi.location_id) ?? null) : null,`.

- [ ] **Step 9: Run**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/shop-owned-scope.test.ts tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/recipe-consumers-shop-scope.test.ts tests/recipe-versions-graph.test.ts tests/menu-costing-shop-overlay.test.ts tests/menu-costing-shop-scope.test.ts tests/silent-read-fabrication.test.ts tests/product-member-pack.test.ts`

Expected: PASS, 0 failed — Task 1's isolation half is green now. **No golden changed:** `git diff --stat tests/fixtures/*golden*.json` prints nothing. (`tests/menu-costing-shop-scope.test.ts` mocks `@/lib/menu-item-shop` with only `loadLiveMenuItemShopSettings` — the costing board does not call `loadMenuItemOwners`, so the mock stands.)

- [ ] **Step 10: Commit**

```bash
git add lib/prep-consumption.ts lib/menu-item-shop.ts lib/admin/menu-costing.ts lib/admin/toast-map.ts lib/admin/catalog.ts lib/admin/catalog-shared.ts lib/admin/readiness-load.ts lib/weights.ts tests/fixtures/counts-fake-db.ts tests/silent-read-fabrication.test.ts tests/shop-owned-scope.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a — a shop-only sandwich is its owner's at the one resolver point, the board, readiness, weights, Toast and the catalog list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 5b: A shop-only SKU appears only at its shop — the walk, the par pass, counts, a shop's guide; catering pickers (lead decisions 2 and 5)

Each shop-scoped read point applies the one rule (`ownerVisible`) to the rows it already reads — no new resolver, no new query on the walk or the par pass:

| Read point | Decision |
|---|---|
| Counts roster `createCountsReadRefs(shopScope).roster` | a shop counts shared SKUs and its own; the cross-shop view (`null`) keeps every one |
| Ordering walk `loadWalkerData` | a shop walks shared SKUs and its own |
| Product resolution `loadProductIndex` (Astra 4b r1#1) | a member another shop owns is NOT eligible at this shop — at every rung (primary, most recently received, any), so the walk's rescue (which picks among eligible members) falls through to a shared member; a regular-vendor member a shop owns is never the global default's answer either; store copies keep 0216's rule |
| Par pass `submitParPass` | another shop's own SKU is refused like an unknown one |
| Purchase orders | made from par-pass lines — covered by the par pass |
| A shop's view of a vendor's guide | `loadOrderGuideForShop` (read-only) drops another shop's own lines; the vendor's sheet editor keeps the whole guide (saving a filtered model would delete those lines — judgment call 17) and labels each shop's own line "Only at <shop>" (decision (b): `loadGuideSkuShopNames`, rendered by 4b) |
| Catering quote pickers (staff + portal) | package lines and slot options of a menu item another shop owns are left out (à-la-carte already reads `catering_available`, never true for an owned item) |
| Items | a shop's own prep item is already location-scoped where it is listed (templates, the item spine); the graph and the line loader hide another shop's recipes (Task 5) |

**Files:**
- Modify: `lib/counts-read-refs.ts`, `lib/ordering.ts`, `lib/products.ts`, `lib/order-guides.ts`, `lib/order-guides-shared.ts`, `lib/catering/menu.ts`, `lib/portal/menu.ts`, `tests/products-store-loader.test.ts`
- Create: `tests/shop-only-visibility.test.ts`

- [ ] **Step 1: Write the failing test `tests/shop-only-visibility.test.ts`**

```ts
/** Catalog Phase 4a (lead decisions 2 and 5): another shop's own SKU or sandwich never shows at this shop. */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

import { createCountsReadRefs } from "@/lib/counts-read-refs";
import { loadGuideSkuShopNames, loadOrderGuideForShop } from "@/lib/order-guides";
import { loadCateringPackagesForQuote } from "@/lib/catering/menu";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const sku = (id: string, location_id: string | null) => ({ id, name: id, pack_format: "case", vendor_id: "v-1", product_id: null, active: true, location_id });

describe("counts", () => {
  it("a shop counts shared SKUs and its own; the cross-shop view counts every one", async () => {
    current = createFakeDb({ vendor_items: [sku("shared", null), sku("a-own", A), sku("b-own", B)] });
    const ids = async (scope: string | null) => (await createCountsReadRefs(scope).roster()).map((r) => r.id).sort();
    expect(await ids(A)).toEqual(["a-own", "shared"]);
    expect(await ids(B)).toEqual(["b-own", "shared"]);
    expect(await ids(null)).toEqual(["a-own", "b-own", "shared"]);
  });
});

describe("a shop's view of a vendor's guide", () => {
  it("drops lines of another shop's own SKU; keeps its own and the shared ones", async () => {
    current = createFakeDb({
      vendor_items: [sku("shared", null), sku("a-own", A), sku("b-own", B)],
      vendor_order_guides: [{ id: "g-1", vendor_id: "v-1", name: "Guide", updated_at: "2026-10-01T00:00:00.000Z" }],
      order_guide_sections: [{ id: "sec-1", guide_id: "g-1", name: "Dairy", position: 1 }],
      order_guide_lines: ["shared", "a-own", "b-own"].map((s, i) => ({ id: `l-${s}`, section_id: "sec-1", position: i + 1, sku_id: s, label: s, item_number: null, note: null })),
    });
    const g = await loadOrderGuideForShop("v-1", A);
    expect(g!.sections[0]!.lines.map((l) => l.skuId)).toEqual(["shared", "a-own"]);
  });
  it("the vendor's guide EDITOR keeps every line and names each shop's own one (decision (b))", async () => {
    current = createFakeDb({
      vendor_items: [sku("shared", null), sku("a-own", A), sku("b-own", B)],
      locations: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }],
    });
    expect(await loadGuideSkuShopNames("v-1")).toEqual({ "a-own": "Shop A", "b-own": "Shop B" });
    expect(await loadGuideSkuShopNames("v-none")).toEqual({});
  });
});

describe("catering quote pickers", () => {
  it("a package line naming another shop's own sandwich is left out of this shop's quote", async () => {
    current = createFakeDb({
      catering_packages: [{ id: "p-1", label_en: "Box", label_es: null, pricing_mode: "per_person", price_cents: 1000, min_headcount: null, location_id: null, active: true, display_order: 1 }],
      catering_package_items: [
        { package_id: "p-1", item_id: null, menu_item_id: "m-shared", description: null, quantity: 1, active: true, display_order: 1 },
        { package_id: "p-1", item_id: null, menu_item_id: "m-b-own", description: null, quantity: 1, active: true, display_order: 2 },
      ],
      menu_items: [
        { id: "m-shared", name: "Italian", menu_price: 12, location_id: null },
        { id: "m-b-own", name: "B hero", menu_price: 11, location_id: B },
      ],
      items: [],
    });
    const owner = { user: { id: "u", role: "owner", name: "T" }, role: "owner", level: 9, locations: [] } as never;
    const [pkg] = await loadCateringPackagesForQuote(owner, A);
    expect(pkg!.items.map((l) => l.menuItemId)).toEqual(["m-shared"]);
    expect((await loadCateringPackagesForQuote(owner, B))[0]!.items.map((l) => l.menuItemId)).toEqual(["m-shared", "m-b-own"]);
  });
  it("the walk, the par pass and the portal apply the same rule", () => {
    const ordering = readFileSync("lib/ordering.ts", "utf8");
    expect(ordering).toContain("const skuRows = (allSkuRows ?? []).filter((s) => ownerVisible(s.location_id ?? null, locationId));");
    expect(ordering).toContain("&& ownerVisible(s.location_id ?? null, locationId)).map((s) => [s.id, s]));");
    // The rescue needs no filter of its own: it picks among ELIGIBLE members, and product resolution decides eligibility
    // (tests/products-store-loader.test.ts) — never a second opinion in a consumer.
    expect(ordering).not.toContain("|| !ownerVisible(r.location_id ?? null, locationId)) continue;");
    expect(readFileSync("lib/portal/menu.ts", "utf8")).toContain("if (r.menu_item_id && hiddenMenuIds.has(r.menu_item_id)) continue;");
  });
});
```

Run: `npx vitest run tests/shop-only-visibility.test.ts` → expected: FAIL.

- [ ] **Step 2: Counts (`lib/counts-read-refs.ts`)**

Extend its `@/lib/sku-versions-shared` import to `import { assertScopeToken, type VersionScope } from "@/lib/sku-versions-shared";`, then replace

```ts
      const { data, error } = await sb.from("vendor_items").select("id, name, pack_format, vendor_id, product_id").eq("active", true)
        .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<RosterSku[]>();
```

with

```ts
      // CATALOG PHASE 4a (lead decision 2): a shop counts shared SKUs and its OWN — never another shop's own (a store
      // copy, a local vendor's item). The cross-shop view (null) keeps every one.
      const base = sb.from("vendor_items").select("id, name, pack_format, vendor_id, product_id").eq("active", true);
      const visible = shopScope === null ? base : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(shopScope)}`);
      const { data, error } = await visible
        .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<RosterSku[]>();
```

- [ ] **Step 3: The walk and the par pass (`lib/ordering.ts`)**

1. Add `import { ownerVisible } from "@/lib/catalog/shop-owned-shared";`.
2. Append `, location_id` to `WALKER_SKU_COLUMNS` (the string ends `… product_id, inventory_only, location_id";`) and add `location_id?: string | null;` as the first member of `interface WalkerSkuRow {`.
3. In `loadWalkerData`, replace

```ts
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select(WALKER_SKU_COLUMNS)
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
```

with

```ts
  const { data: allSkuRows, error: sErr } = await sb.from("vendor_items")
    .select(WALKER_SKU_COLUMNS)
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
```

and directly after `  if (sErr) throw new Error(\`loadWalkerData skus: ${sErr.message}\`);` insert:

```ts
  // CATALOG PHASE 4a (lead decision 2): a shop walks shared SKUs and its OWN — never another shop's own.
  const skuRows = (allSkuRows ?? []).filter((s) => ownerVisible(s.location_id ?? null, locationId));
```

4. The product rescue is NOT filtered here (Astra 4b r1#1): a filter after the rescue target is picked would drop the rescue instead of trying a shared member. Eligibility is decided once, in product resolution (Step 3b), and the rescue already picks only among eligible (`m.active`) members.
5. In `submitParPass`, replace

```ts
  const skuById = new Map((skuRows ?? []).filter((s) => s.vendor_id == null || !storeVendorIds.has(s.vendor_id)).map((s) => [s.id, s]));
```

with

```ts
  // CATALOG PHASE 4a (lead decision 2): another shop's own SKU is refused here like an unknown one.
  const skuById = new Map((skuRows ?? []).filter((s) => (s.vendor_id == null || !storeVendorIds.has(s.vendor_id)) && ownerVisible(s.location_id ?? null, locationId)).map((s) => [s.id, s]));
```

- [ ] **Step 3b: Product resolution never picks another shop's own SKU — at any rung (`lib/products.ts`; Astra 4b r1#1)**

1. In `loadProductIndex`, replace

```ts
      active: resolveActive(overlayBySku.get(m.id) ?? null, m.active ?? true) &&
        (vendorById.get(m.vendor_id ?? "")?.source_kind !== "store" ||
          locationId == null || m.location_id == null || m.location_id === locationId),
```

with

```ts
      // OWNERSHIP IS ELIGIBILITY, AT EVERY RUNG (catalog Phase 4a, lead decision 2; Astra 4b r1#1): a member another shop
      // owns is never this shop's answer — not the primary, not the most recently received, not "any" — so the walk's
      // rescue (which picks among eligible members) falls through to a shared one. A REGULAR-vendor member a shop owns is
      // eligible only at that shop, never at the global default; a STORE copy keeps 0216's rule (its shop, or the global view).
      active: resolveActive(overlayBySku.get(m.id) ?? null, m.active ?? true) &&
        (vendorById.get(m.vendor_id ?? "")?.source_kind === "store"
          ? locationId == null || m.location_id == null || m.location_id === locationId
          : m.location_id == null || m.location_id === locationId),
```

2. In `tests/products-store-loader.test.ts`, replace

```ts
  it("resolves regular members on inactive vendors and scoped to another shop as before", async () => {
    fixture.tables.vendors![0]!.active = false;
    fixture.tables.vendor_items![0]!.location_id = "south";
    fixture.tables.vendor_items![1]!.active = false;
```

with

```ts
  it("resolves regular members on inactive vendors as before", async () => {
    fixture.tables.vendors![0]!.active = false;
    fixture.tables.vendor_items![1]!.active = false;
```

and append inside the `describe`, after that test:

```ts
  // CATALOG PHASE 4a (lead decision 2; Astra 4b r1#1) — SUPERSEDES the old "scoped to another shop as before": a
  // regular-vendor member another shop owns is never this shop's answer, at any rung; resolution falls through to a shared member.
  it("never picks another shop's own regular member — not as the primary, not as the most recently received", async () => {
    fixture.tables.vendor_items!.push({ id: "south-sku", name: "south", vendor_id: "regular", product_id: "product", active: true,
      pending_review: false, location_id: "south", units_per_pack: 1, each_size: 16, each_measure: "oz", avg_oz_per_each: null });
    fixture.tables.product_primaries = [{ id: "pp", product_id: "product", location_id: null, primary_sku_id: "south-sku", note: null }];
    fixture.tables.vendor_delivery_items!.push({ ...receipt("six", "vendor", "north", 9), vendor_item_id: "south-sku" });
    const north = await loadProductIndex(["product"], "north");
    expect(north.index.resolution.get("product")?.skuId).toBe("regular-sku");
    expect(north.byProduct.get("product")?.members.find(m => m.skuId === "south-sku")?.active).toBe(false);
    // the global default never rides a shop's own item either
    expect((await loadProductIndex(["product"])).index.resolution.get("product")?.skuId).toBe("regular-sku");
    // …and at its own shop it is the primary again
    expect((await loadProductIndex(["product"], "south")).index.resolution.get("product")?.skuId).toBe("south-sku");
  });
```

(This changes an existing pinned behavior on purpose — lead decision 2. The runbook's pre-flight lists the live shop-owned regular-vendor product members it touches, Task 15 Step 1.)

- [ ] **Step 4: A shop's view of a vendor's guide (`lib/order-guides-shared.ts`, `lib/order-guides.ts`)**

1. Append to `lib/order-guides-shared.ts`:

```ts
/**
 * The guide ONE SHOP sees (catalog Phase 4a, lead decision 2): every section, minus the lines of a SKU another shop
 * owns. `owners` holds shop-owned SKUs only (absent = shared). Read-only: never save a filtered model.
 */
export function guideForShop(model: GuideModel, owners: ReadonlyMap<string, string>, shopId: string): GuideModel {
  return {
    ...model,
    sections: model.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => l.skuId === null || (owners.get(l.skuId) ?? shopId) === shopId) })),
  };
}
```

2. In `lib/order-guides.ts`, add `guideForShop` to the import from `@/lib/order-guides-shared`, and directly after `loadOrderGuide`'s closing `}` insert:

```ts
/**
 * A SHOP's view of a vendor's guide (catalog Phase 4a): lines of another shop's own SKUs left out. READ-ONLY — the
 * vendor's sheet editor keeps the whole guide (saving a filtered model would delete the hidden lines).
 */
export async function loadOrderGuideForShop(vendorId: string, shopId: string): Promise<GuideModel | null> {
  const model = await loadOrderGuide(vendorId);
  if (!model) return null;
  const skuIds = [...new Set(model.sections.flatMap((s) => s.lines.map((l) => l.skuId)).filter((v): v is string => v !== null))];
  if (skuIds.length === 0) return model;
  const { data, error } = await getServiceRoleClient().from("vendor_items").select("id, location_id").in("id", skuIds)
    .not("location_id", "is", null).returns<Array<{ id: string; location_id: string }>>();
  if (error) throw new Error(`loadOrderGuideForShop: ${error.message}`);
  return guideForShop(model, new Map((data ?? []).map((r) => [r.id, r.location_id])), shopId);
}

/**
 * The vendor's guide EDITOR's labels (decision (b), Astra round 1): skuId → the name of the ONE shop that owns it, for
 * this vendor's shop-owned SKUs. The editor keeps the whole guide (a filtered save would delete lines) and says
 * "Only at <shop>" beside each such line and bucket entry instead (4b). Two fixed reads, keyed by the vendor — no id list.
 */
export async function loadGuideSkuShopNames(vendorId: string): Promise<Record<string, string>> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("vendor_items").select("id, location_id").eq("vendor_id", vendorId).not("location_id", "is", null)
    .returns<Array<{ id: string; location_id: string }>>();
  if (error) throw new Error(`loadGuideSkuShopNames: ${error.message}`);
  if ((data ?? []).length === 0) return {};
  const { data: shops, error: sErr } = await sb.from("locations").select("id, name")
    .in("id", [...new Set((data ?? []).map((r) => r.location_id))]).returns<Array<{ id: string; name: string }>>();
  if (sErr) throw new Error(`loadGuideSkuShopNames shops: ${sErr.message}`);
  const name = new Map((shops ?? []).map((s) => [s.id, s.name]));
  return Object.fromEntries((data ?? []).map((r) => [r.id, name.get(r.location_id) ?? ""]));
}
```

- [ ] **Step 5: Catering quote pickers (`lib/catering/menu.ts`, `lib/portal/menu.ts`)** — read filter only; catering otherwise untouched (lead decision 5).

In BOTH files, inside the package loader (`loadCateringPackagesForQuote` / `loadPublicCateringPackages`):
1. Directly after `  const menuMap = new Map<string, { name: string; priceCents: number }>();` add `  const hiddenMenuIds = new Set<string>(); // another shop's own sandwich (0264): never on this shop's quote`.
2. Replace

```ts
    const { data: rows } = await sb.from("menu_items").select("id, name, menu_price").in("id", menuItemIds).returns<Array<{ id: string; name: string; menu_price: number | string | null }>>();
    for (const r of rows ?? []) menuMap.set(r.id, { name: r.name, priceCents: dollarsToCents(r.menu_price) });
```

with

```ts
    const { data: rows } = await sb.from("menu_items").select("id, name, menu_price, location_id").in("id", menuItemIds).returns<Array<{ id: string; name: string; menu_price: number | string | null; location_id: string | null }>>();
    for (const r of rows ?? []) {
      if (r.location_id != null && r.location_id !== locationId) { hiddenMenuIds.add(r.id); continue; }
      menuMap.set(r.id, { name: r.name, priceCents: dollarsToCents(r.menu_price) });
    }
```

3. Replace `  for (const r of pkgItems) {` with `  for (const r of pkgItems) {\n    if (r.menu_item_id && hiddenMenuIds.has(r.menu_item_id)) continue;`.
4. In `lib/portal/menu.ts` only (the staff loader has no slot options), replace

```ts
    if (optMenuIds.length > 0) { const { data } = await sb.from("menu_items").select("id, name").in("id", optMenuIds).returns<Array<{ id: string; name: string }>>(); for (const x of data ?? []) menuMap.set(x.id, { name: x.name, priceCents: 0 }); }
```

with

```ts
    if (optMenuIds.length > 0) {
      const { data } = await sb.from("menu_items").select("id, name, location_id").in("id", optMenuIds).returns<Array<{ id: string; name: string; location_id: string | null }>>();
      for (const x of data ?? []) {
        if (x.location_id != null && x.location_id !== locationId) { hiddenMenuIds.add(x.id); continue; }
        menuMap.set(x.id, { name: x.name, priceCents: 0 });
      }
    }
```

and replace `    for (const o of optRows ?? []) {` with `    for (const o of optRows ?? []) {\n      if (o.menu_item_id && hiddenMenuIds.has(o.menu_item_id)) continue;`.

- [ ] **Step 6: Run, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/shop-only-visibility.test.ts tests/products-store-loader.test.ts tests/counts-onhand-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/ordering*.test.ts tests/order-guides*.test.ts tests/catering*.test.ts tests/portal*.test.ts` → expected: PASS. The counts pin's fixture SKUs are all shared, so its golden holds. **If any golden or count changes, STOP and report** — the only allowed difference is another shop's own SKU leaving a shop's sheet, and a golden is never regenerated without the lead's word.

```bash
git add lib/counts-read-refs.ts lib/ordering.ts lib/products.ts lib/order-guides.ts lib/order-guides-shared.ts lib/catering/menu.ts lib/portal/menu.ts tests/shop-only-visibility.test.ts tests/products-store-loader.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a — a shop-only SKU appears only at its shop (walk, par pass, counts, a shop's guide, product resolution at every rung); catering pickers by shop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 6: The owner edits its own things; GM creation and owner moves go shop-only; MoO+ shares

Spec §3 + lead decision 6, turned into floors:

| Act | Before Phase 4 | After |
|---|---|---|
| Edit the lines of a recipe a shop OWNS | (no such recipe) | its shop's GM (and MoO+), as the recipe itself (scope = the default); a shop version of it → `shop_owned_edit_here` |
| Edit a SHARED recipe's default lines | MoO+ (3a/3b) | unchanged |
| Set the price of a sandwich a shop OWNS (`menu_items.menu_price`) | (none) | its shop's GM (and MoO+) |
| Set a SHARED menu item's price | MoO+ | unchanged |
| Create a recipe / menu item (legacy builder, New sandwich job) | GM+ (every shop's) | below MoO: **its shop's own** — the one shop the GM works at, or the shop it names (`location_required` at several; lead decision 1); MoO+: every shop's unless a shop is named |
| Share a shop's own item a shop's own recipe makes, alone (`promoteItemToGlobal`) | MoO+ | refused (`share_the_recipe`): it goes WITH its recipe |
| Create a SKU for every shop (`createSku` with no shop) | GM+ | **MoO+**; a GM's new SKU names its shop |
| Move a SKU's shop (`updateSku` `locationId` change) | GM+ | **MoO+** (sharing is MoO+; a move is a share by another name) |
| A write whose right came from OWNING the thing, raced by a share (Astra r1 P1) | (n/a) | the owner it was authorized for rides the write (Step 5b) — `ownership_changed` (409, en/es) |
| A shop VERSION of a shared recipe naming another shop's own SKU or item (decision (a)) | allowed | refused `line_other_shop`, the line named (lib + 0264) |

**Files:**
- Modify: `lib/admin/recipe-versions.ts`, `lib/admin/menu-item-shop.ts`, `lib/catalog/recipe-item.ts`, `lib/catalog/recipe-item-shared.ts`, `app/admin/catalog/recipe/[id]/page.tsx`, `lib/admin/menu-prices.ts`, `app/api/admin/menu-items/[id]/price/route.ts`, `lib/recipes.ts`, `lib/admin/skus.ts`, `lib/catalog/sku-item.ts`, `lib/admin/templates.ts`
- Create: `tests/shop-owned-permissions.test.ts`

- [ ] **Step 1: Write the failing test `tests/shop-owned-permissions.test.ts`**

```ts
/** Catalog Phase 4a — who may edit, create and move shop-only things (spec §3; lead decision 6). */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_MENU, OWNED_RECIPE } from "./fixtures/shop-owned-fixture";

let current: ReturnType<typeof createFakeDb> | null = null;
let rpc: ReturnType<typeof vi.fn>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no database expected");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/recipes", async (orig) => ({ ...(await orig<typeof import("@/lib/recipes")>()), assertInputLineIsValid: async () => {} }));

import { saveRecipeLines } from "@/lib/admin/recipe-versions";
import { updateMenuPrice } from "@/lib/admin/menu-prices";
import { createMenuItem, createRecipe, createRecipeFull, updateRecipe } from "@/lib/recipes";
import { createSku, updateSku } from "@/lib/admin/skus";

const actor = (role: string, level: number, locations: string[]) =>
  ({ user: { id: "u-1", role, name: "Test" }, role, level, locations }) as never;
const gmLoc = actor("gm", 7, [LOC]);
const gmOther = actor("gm", 7, [OTHER]);
const moo = actor("moo", 8, []);
const line = { componentSkuId: "s-cheese", componentItemId: null, componentProductId: null, quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false };
const HEAD = `rv-${OWNED_RECIPE}-base`;
const OWNED_UUID = "11111111-1111-4111-8111-111111111111";
const SHARED_UUID = "22222222-2222-4222-8222-222222222222";

let tables: ReturnType<typeof buildShopOwnedFixture>;
function install() {
  const t = buildShopOwnedFixture();
  tables = t;
  // A SKU Shop two owns (decision (a)) and one Shop one owns (the SKU compare-and-set).
  const cheese = t.vendor_items!.find((s) => s.id === "s-cheese")!;
  t.vendor_items!.push({ ...cheese, id: "s-other-own", name: "Shop two relish", location_id: OTHER });
  t.vendor_items!.push({ ...cheese, id: "s-loc-own", name: "Shop one relish", location_id: LOC });
  // updateMenuPrice takes a UUID: give the two sandwiches UUID ids (nothing else in this file reads them by id).
  t.menu_items!.find((m) => m.id === OWNED_MENU)!.id = OWNED_UUID;
  t.menu_items!.find((m) => m.id === "m-italian")!.id = SHARED_UUID;
  // The shared SKU says so explicitly (updateSku's bind reads location_id).
  t.vendor_items!.find((s) => s.id === "s-cheese")!.location_id = null;
  // A shop prep item nothing makes yet (a GM's new recipe will make it).
  t.items!.push({ id: "i-a-dressing", name: "A dressing", active: true, location_id: LOC });
  current = createFakeDb(t);
  rpc = vi.fn(async () => ({ data: { version_id: "rv-new", retired_version_id: HEAD, changed_shops: [] }, error: null }));
  (current.client as unknown as { rpc: unknown }).rpc = rpc;
}
beforeEach(install);
afterEach(() => { current = null; });

describe("a shop-only recipe is edited as itself, by its shop", () => {
  const add = (who: never, scope: string | null, expected: string | null) =>
    saveRecipeLines(who, { recipeId: OWNED_RECIPE, scope, expectedVersionId: expected, basedOnVersionId: null, op: { kind: "add", line }, snapshot: {} });

  it("its GM writes the recipe's own lines (the default of a recipe nobody else sees) — bound to the owner it was granted for", async () => {
    await expect(add(gmLoc, null, HEAD)).resolves.toMatchObject({ changed: true });
    expect(rpc).toHaveBeenCalledWith("save_owned_recipe_version", expect.objectContaining({ p_expected_owner: LOC, p_recipe: OWNED_RECIPE, p_location: null }));
  });
  it("a share that landed after the read refuses ownership_changed (Astra r1 P1)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "shop_owned:ownership_changed" } });
    await expect(add(gmLoc, null, HEAD)).rejects.toMatchObject({ status: 409, code: "ownership_changed" });
  });
  it("another shop's GM never reaches the database", async () => {
    await expect(add(gmOther, null, HEAD)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a shop version of it is refused — the owner is told to edit it here", async () => {
    await expect(add(gmLoc, LOC, null)).rejects.toMatchObject({ status: 409, code: "shop_owned_edit_here" });
  });
  it("MoO+ edits it too (its right is not the owner's: 0262's writer directly); a SHARED recipe's default stays MoO+", async () => {
    await expect(add(moo, null, HEAD)).resolves.toMatchObject({ changed: true });
    expect(rpc).toHaveBeenLastCalledWith("save_recipe_version", expect.objectContaining({ p_recipe: OWNED_RECIPE, p_location: null }));
    await expect(saveRecipeLines(gmLoc, { recipeId: "r-italian", scope: null, expectedVersionId: "rv-r-italian-base", basedOnVersionId: null, op: { kind: "add", line }, snapshot: {} }))
      .rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
  });
});

describe("decision (a) — a shop version of a SHARED recipe names only shared things or that shop's own", () => {
  const shopAdd = (sku: string) => saveRecipeLines(gmLoc, { recipeId: "r-italian", scope: LOC, expectedVersionId: null,
    basedOnVersionId: "rv-r-italian-base", op: { kind: "add", line: { ...line, componentSkuId: sku } }, snapshot: {} });
  it("another shop's own SKU is refused and the line named — before the database", async () => {
    await expect(shopAdd("s-other-own")).rejects.toMatchObject({ status: 400, code: "line_other_shop", line: expect.objectContaining({ reason: "line_other_shop" }) });
    expect(rpc).not.toHaveBeenCalledWith("save_recipe_version", expect.anything());
  });
  it("the shop's own SKU and shared ones are fine", async () => {
    await expect(shopAdd("s-loc-own")).resolves.toMatchObject({ changed: true });
  });
});

describe("a shop-only sandwich's price is its shop's", () => {
  it("its GM reaches the compare-and-set; a shared item's price stays MoO+; another shop's is not found", async () => {
    // The fake's UPDATE returns no rows, so the allowed call ends in the compare-and-set's 409 AFTER the write is logged.
    await updateMenuPrice(gmLoc, OWNED_UUID, 12, 11).catch(() => undefined);
    expect(current!.writes.some((w) => w.table === "menu_items")).toBe(true);
    await expect(updateMenuPrice(gmLoc, SHARED_UUID, 13, 12.5)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(updateMenuPrice(gmOther, OWNED_UUID, 12, 12)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
  it("a share landing between the read and the write is refused, and the price is untouched (Astra r1 P1)", async () => {
    const realFrom = current!.client.from.bind(current!.client);
    let menuCalls = 0;
    (current!.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      // The 1st menu_items call is the read; before the 2nd (the write), MoO shares the sandwich.
      if (t === "menu_items" && ++menuCalls === 2) tables.menu_items!.find((m) => m.id === OWNED_UUID)!.location_id = null;
      return realFrom(t);
    };
    await expect(updateMenuPrice(gmLoc, OWNED_UUID, 12, 11)).rejects.toMatchObject({ status: 409, code: "ownership_changed" });
    expect(tables.menu_items!.find((m) => m.id === OWNED_UUID)!.menu_price).toBe(11);
  });
});

describe("the SKU writers carry the shop they bound (Astra r1 P1 inventory, Step 5b)", () => {
  it("a stale form never re-owns an item shared meanwhile: the UPDATE carries the bound owner → ownership_changed", async () => {
    const realFrom = current!.client.from.bind(current!.client);
    let skuCalls = 0;
    (current!.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "vendor_items" && ++skuCalls === 2) tables.vendor_items!.find((s) => s.id === "s-loc-own")!.location_id = null;
      return realFrom(t);
    };
    await expect(updateSku(gmLoc, { id: "s-loc-own", changes: { locationId: LOC, name: "Shop one relish (new)" } }))
      .rejects.toMatchObject({ status: 409, code: "ownership_changed" });
    expect(tables.vendor_items!.find((s) => s.id === "s-loc-own")).toMatchObject({ location_id: null, name: "Shop one relish" });
  });
});

describe("the legacy recipe writers: another shop's own recipe does not exist for you", () => {
  it("updateRecipe by another shop's GM is 404 before the database writes", async () => {
    await expect(updateRecipe(gmOther, OWNED_RECIPE, { name: "Mine now" })).rejects.toMatchObject({ status: 404, code: "recipe_not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("a GM creates things at its shop — never for every shop (lead decision 1)", () => {
  it("a GM's new recipe and menu item are its shop's own; MoO's are every shop's", async () => {
    await createRecipe(gmLoc, { name: "A slaw", recipeType: "production", batchYield: 1 });
    expect(current!.writes.find((w) => w.table === "recipes")!.rows[0]).toMatchObject({ name: "A slaw", location_id: LOC });
    await createMenuItem(gmLoc, { name: "A hero", menuPrice: 9 });
    expect(current!.writes.find((w) => w.table === "menu_items")!.rows[0]).toMatchObject({ location_id: LOC, catering_available: false, menu_price: 9 });
    await createRecipe(moo, { name: "Every slaw", recipeType: "production", batchYield: 1 });
    expect(current!.writes.filter((w) => w.table === "recipes")[1]!.rows[0]).not.toHaveProperty("location_id");
  });
  it("a GM at two shops names one; never a shop it doesn't work at", async () => {
    const two = actor("gm", 7, [LOC, OTHER]);
    await expect(createRecipe(two, { name: "X", recipeType: "production", batchYield: 1 })).rejects.toMatchObject({ status: 400, code: "location_required" });
    await expect(createRecipe(gmLoc, { name: "X", recipeType: "production", batchYield: 1, locationId: OTHER })).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
  it("a GM's full recipe goes through create_shop_recipe, at its shop", async () => {
    rpc.mockResolvedValueOnce({ data: "r-new", error: null });
    await createRecipeFull(gmLoc, {
      name: "A dressing", recipeType: "production", batchYield: 1,
      inputs: [{ componentSkuId: "s-cheese", quantity: 1, unit: "oz" }], outputs: [{ outputItemId: "i-a-dressing", yield: 1 }],
    });
    expect(rpc).toHaveBeenCalledWith("create_shop_recipe", expect.objectContaining({ p_location: LOC, p_created_by: "u-1" }));
  });
  it("createSku for every shop is MoO+; a SKU's shop moves only with MoO+", async () => {
    await expect(createSku(gmLoc, { vendorId: null, locationId: null, name: "X", packFormat: "case" })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    await expect(updateSku(gmLoc, { id: "s-cheese", changes: { locationId: LOC } })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    expect(current!.writes.filter((w) => w.table === "vendor_items")).toEqual([]);
  });
});

describe("the recipe page serves a shop-only recipe in its default view", () => {
  it("the page forces the default scope for an owned recipe; the view names the owner", () => {
    expect(readFileSync("app/admin/catalog/recipe/[id]/page.tsx", "utf8")).toContain("const scope = owner !== null ? null");
    expect(readFileSync("lib/catalog/recipe-item.ts", "utf8")).toContain("owner: owner === null ? null : { shopId: owner, shopName: shopName(owner) },");
  });
});
```

Run: `npx vitest run tests/shop-owned-permissions.test.ts` → expected: FAIL.

- [ ] **Step 2: The recipe writers (`lib/admin/recipe-versions.ts`)**

1. Add `import { ownedAwareRecipeGate, ownedRecipeScopeRefusal, ownerWriteCheck } from "@/lib/catalog/shop-owned-shared";`.
2. Replace 3a's

```ts
/** THE BIND (a BIND_PRIMITIVES name): role + shop, decided before any I/O. */
function requireLocation(actor: AuthContext, scope: VersionScope): void {
  const gate = recipeVersionWriteGate({ level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
}
```

with

```ts
/**
 * THE BIND (a BIND_PRIMITIVES name): role + shop, decided before any I/O. Catalog Phase 4a (0264): a GM writing the
 * DEFAULT passes here only to be decided by the recipe's owner after the one read (requireRecipeOwner) — the default of
 * a shop-only recipe is its shop's; every other default stays MoO+ (global_requires_moo).
 */
function requireLocation(actor: AuthContext, scope: VersionScope): { ownerCheck: boolean } {
  const gate = ownedAwareRecipeGate({ level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
  return { ownerCheck: gate.ownerCheck };
}

/** After the read: a shop-only recipe has no shop versions (409 / 404), and its default is its shop's (0264). */
function requireRecipeOwner(actor: AuthContext, owner: string | null, scope: VersionScope, ownerCheck: boolean): void {
  const shop = ownedRecipeScopeRefusal(owner, scope);
  if (shop) throw new RecipeVersionError(shop.status, shop.code);
  if (!ownerCheck) return;
  const check = ownerWriteCheck(actor, owner);
  if (!check.ok) throw new RecipeVersionError(check.status, check.code);
}
```

and drop `recipeVersionWriteGate` from the `@/lib/recipe-versions-shared` import if nothing else in the file uses it.
3. Add `shop_owned_edit_here: 409, recipe_has_no_shop_versions: 409,` to the file's `RPC_STATUS`, and in `recipeVersionErrorFromRpc` replace `/recipe_version:([a-z_]+)/` with `/(?:recipe_version|shop_owned):([a-z_]+)/` (0264's trigger raises `shop_owned:recipe_has_no_shop_versions`).
4. In `export interface RecipeLiveSet {`, after `recipeActive: boolean;` add:

```ts
  /** The shop that owns this recipe (0264), or null when every shop shares it. */
  ownerLocationId: string | null;
```

In `loadRecipeLiveSet`, replace `sb.from("recipes").select("id, name, active").eq("id", recipeId).maybeSingle<{ id: string; name: string; active: boolean | null }>(),` with `sb.from("recipes").select("id, name, active, location_id").eq("id", recipeId).maybeSingle<{ id: string; name: string; active: boolean | null; location_id?: string | null }>(),`, and in its returned object replace `recipeId, recipeName: recipeRes.data.name, recipeActive: recipeRes.data.active !== false, scope,` with `recipeId, recipeName: recipeRes.data.name, recipeActive: recipeRes.data.active !== false, ownerLocationId: recipeRes.data.location_id ?? null, scope,`.
5. In `writeRecipeVersion`, replace

```ts
  requireLocation(actor, input.scope);
  // THE SAME LINE RULES AS AN ADD / UPDATE (Astra 3a r1#5)
```

with

```ts
  const { ownerCheck } = requireLocation(actor, input.scope);
  // CATALOG PHASE 4a (0264): the recipe's owner decides first — before any line is read or checked.
  const liveSet = await loadRecipeLiveSet(input.recipeId, input.scope);
  requireRecipeOwner(actor, liveSet.ownerLocationId, input.scope, ownerCheck);
  // THE SAME LINE RULES AS AN ADD / UPDATE (Astra 3a r1#5)
```

and replace `  const current = (await loadRecipeLiveSet(input.recipeId, input.scope)).lines.map((l) => l.fields);` with `  const current = liveSet.lines.map((l) => l.fields);`.
6. In `saveRecipeLines`, replace

```ts
  requireLocation(actor, input.scope);
  const live = await loadRecipeLiveSet(input.recipeId, input.scope);
```

with

```ts
  const { ownerCheck } = requireLocation(actor, input.scope);
  const live = await loadRecipeLiveSet(input.recipeId, input.scope);
  requireRecipeOwner(actor, live.ownerLocationId, input.scope, ownerCheck);
```

(`restoreRecipeVersion` and 3b's adopt / promote reach the owner check through `writeRecipeVersion`; `retireShopRecipeVersion` retires a SHOP version, which a shop-only recipe never has.)
7. **The owner's right rides the write (Astra 4a r1 P1).** In `writeRecipeVersion`, replace

```ts
  const { data, error } = await sb.rpc("save_recipe_version", {
    p_recipe: input.recipeId,
```

with

```ts
  // THE OWNER'S OWN EDIT IS BOUND TO THAT OWNER (Astra 4a r1 P1): when the right came from owning the recipe (a GM writing
  // its shop's own recipe), 0264's save_owned_recipe_version compares the owner under the graph lock first — a share that
  // landed since refuses ownership_changed. MoO+ (no owner check) writes through 0262's writer directly.
  const ownerBound = ownerCheck ? liveSet.ownerLocationId : null;
  const { data, error } = await sb.rpc(ownerBound !== null ? "save_owned_recipe_version" : "save_recipe_version", {
    ...(ownerBound !== null ? { p_expected_owner: ownerBound } : {}),
    p_recipe: input.recipeId,
```

and add `ownership_changed: 409, line_other_shop: 400, invalid_payload: 400,` to the file's `RPC_STATUS` (keep an existing entry if 3a already has it).
8. **Decision (a).** Add `linesOwnedElsewhere` to the `@/lib/catalog/shop-owned-shared` import; directly after `  for (const position of positions) await validateLine(next[position - 1]!, position);` add

```ts
  // DECISION (a), Astra round 1: a SHOP version of a SHARED recipe names only shared things or that shop's own — every
  // line, carried or added (0264's recipe_version_lines_owner_law judges every inserted line the same way).
  if (input.scope !== null) await assertLinesVisibleAt(next, input.scope);
```

and directly before `export async function writeRecipeVersion(` insert

```ts
/** Decision (a): the first line naming ANOTHER shop's own SKU or item is refused, and named. Two reads of only the ids in the set. */
async function assertLinesVisibleAt(lines: readonly RecipeLineFields[], shop: string): Promise<void> {
  const skuIds = [...new Set(lines.map((l) => l.componentSkuId).filter((v): v is string => v !== null))];
  const itemIds = [...new Set(lines.map((l) => l.componentItemId).filter((v): v is string => v !== null))];
  const sb = getServiceRoleClient();
  const none = { data: [] as Array<{ id: string; location_id: string }>, error: null };
  const [s, i] = await Promise.all([
    skuIds.length ? sb.from("vendor_items").select("id, location_id").in("id", skuIds).not("location_id", "is", null)
      .returns<Array<{ id: string; location_id: string }>>() : Promise.resolve(none),
    itemIds.length ? sb.from("items").select("id, location_id").in("id", itemIds).not("location_id", "is", null)
      .returns<Array<{ id: string; location_id: string }>>() : Promise.resolve(none),
  ]);
  if (s.error) throw new Error(`line owners (skus): ${s.error.message}`);
  if (i.error) throw new Error(`line owners (items): ${i.error.message}`);
  const bad = linesOwnedElsewhere(lines, {
    skus: new Map((s.data ?? []).map((r) => [r.id, r.location_id])), items: new Map((i.data ?? []).map((r) => [r.id, r.location_id])),
  }, shop);
  if (bad.length === 0) return;
  const position = bad[0]!;
  throw new RecipeVersionError(400, "line_other_shop", undefined, { position, name: await lineName(lines[position - 1]!), reason: "line_other_shop" });
}
```

- [ ] **Step 3: The menu overlay refusal is named (`lib/admin/menu-item-shop.ts`)**

Add `menu_item_has_no_shop_settings: 409,` to its `RPC_STATUS`, and in `menuShopErrorFromRpc` replace `/(?:menu_item_shop|recipe_version):([a-z_]+)/` with `/(?:menu_item_shop|recipe_version|shop_owned):([a-z_]+)/`.

- [ ] **Step 4: The recipe page (3b's `lib/catalog/recipe-item.ts`, `lib/catalog/recipe-item-shared.ts`, `app/admin/catalog/recipe/[id]/page.tsx`)**

1. `lib/catalog/recipe-item-shared.ts`, in `export interface RecipeItemView {`, after `can: { editShop: boolean; editGlobal: boolean };` add:

```ts
  /** A shop-only recipe (0264): its shop — the page edits it as itself (the default view). null = every shop's. */
  owner: { shopId: string; shopName: string | null } | null;
```

2. `lib/catalog/recipe-item.ts`: add `import { ownedAwareRecipeGate, ownedRecipeScopeRefusal, ownerWriteCheck } from "@/lib/catalog/shop-owned-shared";` (and drop `recipeVersionWriteGate` from its `@/lib/recipe-versions-shared` import once nothing else in the file uses it). Replace

```ts
function gateFor(actor: AuthContext, scope: VersionScope) {
  return recipeVersionWriteGate({ level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
}
```

with

```ts
/** Who may write this scope of this recipe — the same answer the writers give (owner-aware since 0264). */
function gateFor(actor: AuthContext, scope: VersionScope, owner: string | null = null) {
  const pre = ownedAwareRecipeGate({ level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!pre.ok) return pre;
  const shop = ownedRecipeScopeRefusal(owner, scope);
  if (shop) return shop;
  return pre.ownerCheck ? ownerWriteCheck(actor, owner) : { ok: true as const };
}
```

3. In `loadRecipeItemView`: replace `sb.from("recipes").select("id, name, name_es, recipe_type, active").eq("id", recipeId)` with `sb.from("recipes").select("id, name, name_es, recipe_type, active, location_id").eq("id", recipeId)` and in its `.maybeSingle<…>()` type add `location_id?: string | null;`; directly after `  if (!recipe) return null;` add `  const owner = recipe.location_id ?? null;`; replace `loadRecipeGraph(scope === null ? undefined : { locationId: scope }),` with `loadRecipeGraph((owner ?? scope) === null ? undefined : { locationId: (owner ?? scope)! }),` (a shop-only recipe is costed where it is sold); replace `loadCurrentSkuPrices([...graph.skuPack.keys()], scope)` with `loadCurrentSkuPrices([...graph.skuPack.keys()], owner ?? scope)`; replace `  const canEditShop = scope !== null && gateFor(actor, scope).ok;` with `  const canEditShop = scope !== null && gateFor(actor, scope, owner).ok;`; replace `    can: { editShop: canEditShop, editGlobal: gateFor(actor, null).ok },` with

```ts
    can: { editShop: canEditShop, editGlobal: gateFor(actor, null, owner).ok },
    owner: owner === null ? null : { shopId: owner, shopName: shopName(owner) },
```

4. In `computeRecipePreview`, replace

```ts
  const gate = gateFor(actor, scope);
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
  const sb = getServiceRoleClient();
  const live = await loadRecipeLiveSet(recipeId, scope);
```

with

```ts
  const pre = gateFor(actor, scope);
  // Before any I/O, everything but the owner's own default is decided; the owner check needs the one read below.
  if (!pre.ok && !(scope === null && pre.code === "global_requires_moo")) throw new RecipeVersionError(pre.status, pre.code);
  const sb = getServiceRoleClient();
  const live = await loadRecipeLiveSet(recipeId, scope);
  const gate = gateFor(actor, scope, live.ownerLocationId);
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
```

and replace

```ts
  if (scope !== null) {
    reachedScopes = [scope];
  } else {
```

with

```ts
  if (scope !== null || live.ownerLocationId !== null) {
    // A shop-only recipe (0264) reaches its own shop only: its default IS that shop's recipe.
    reachedScopes = [scope ?? live.ownerLocationId];
  } else {
```

4b. **The picker offers only what this scope may use (decision (a)).** In `lib/catalog/recipe-item.ts` add `ownerVisible` to the `@/lib/catalog/shop-owned-shared` import and `import { selectAllRows } from "@/lib/supabase-paginate";` (if absent); directly before `export async function loadRecipeItemView(` insert

```ts
/** Shop-owned SKUs and items (0095 / 0079 / 0264): id → its shop. Two paged reads (decision (a)'s picker filter). */
async function loadOwnedIds(sb: ReturnType<typeof getServiceRoleClient>): Promise<{ skus: Map<string, string>; items: Map<string, string> }> {
  const read = (table: "vendor_items" | "items") => selectAllRows<{ id: string; location_id: string }>(async (from, to) => {
    const { data, error } = await sb.from(table).select("id, location_id").not("location_id", "is", null)
      .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string }>>();
    if (error) throw new Error(`recipe page owned ${table}: ${error.message}`);
    return { data };
  });
  const [s, i] = await Promise.all([read("vendor_items"), read("items")]);
  return { skus: new Map(s.map((r) => [r.id, r.location_id])), items: new Map(i.map((r) => [r.id, r.location_id])) };
}
```

then, in `loadRecipeItemView`, directly before `  const pickerPacks = await loadSkuPackResolution(catalog.skus.map((s) => s.id), scope);` insert

```ts
  // DECISION (a): at a shop (a shop version, or a shop's own recipe) the picker offers only shared things and that shop's
  // own — never another shop's own SKU or item (the writer and 0264 refuse them too). A shared recipe's default: unchanged.
  const pickScope = owner ?? scope;
  const pickerOwners = pickScope === null ? null : await loadOwnedIds(sb);
  const pickable = (owners: ReadonlyMap<string, string> | undefined, id: string) => pickScope === null || ownerVisible(owners?.get(id) ?? null, pickScope);
```

and replace `      skus: scopedPickerSkus(catalog.skus, pickerPacks), items: catalog.items, products: catalog.products,` with `      skus: scopedPickerSkus(catalog.skus.filter((s) => pickable(pickerOwners?.skus, s.id)), pickerPacks), items: catalog.items.filter((i) => pickable(pickerOwners?.items, i.id)), products: catalog.products,`.
5. `app/admin/catalog/recipe/[id]/page.tsx`: directly after the `if (error) throw new Error(\`catalog recipe page locations: ${error.message}\`);` line, insert:

```tsx
  // CATALOG PHASE 4a (0264): a shop-only recipe has no shop versions — the page shows and edits it as itself.
  const { data: own, error: ownErr } = await getServiceRoleClient().from("recipes").select("location_id").eq("id", id)
    .maybeSingle<{ location_id: string | null }>();
  if (ownErr) throw new Error(`catalog recipe page owner: ${ownErr.message}`);
  const owner = own?.location_id ?? null;
```

and replace `  const scope = explicit === "global" ? null` with `  const scope = owner !== null ? null : explicit === "global" ? null`.

- [ ] **Step 5: A shop-only sandwich's price (`lib/admin/menu-prices.ts`, the route)**

1. In `lib/admin/menu-prices.ts`, add `import { NEW_THING_MIN, ownerWriteCheck } from "@/lib/catalog/shop-owned-shared";`. Replace

```ts
  if (getRoleLevel(actor.user.role) < MENU_PRICE_WRITE_MIN) throw new MenuPriceError(403, "forbidden");
```

with

```ts
  // CATALOG PHASE 4a (0264): a sandwich only one shop sells has ONE price — that shop's — set by its GM (decided after
  // the read, below); every other menu price stays MoO+. Below GM nothing reaches the read.
  const level = getRoleLevel(actor.user.role);
  if (level < NEW_THING_MIN) throw new MenuPriceError(403, "forbidden");
```

replace `const { data, error } = await sb.from("menu_items").select("menu_price, catering_available").eq("id", id).eq("active", true)` with `const { data, error } = await sb.from("menu_items").select("menu_price, catering_available, location_id").eq("id", id).eq("active", true)`, and its `.maybeSingle<{ menu_price: number | string | null; catering_available: boolean }>();` with `.maybeSingle<{ menu_price: number | string | null; catering_available: boolean; location_id?: string | null }>();`; directly after `  if (!data) throw new MenuPriceError(404, "not_found");` insert:

```ts
  if (level < MENU_PRICE_WRITE_MIN) {
    const owned = ownerWriteCheck({ level, locations: actor.locations }, data.location_id ?? null);
    if (!owned.ok) throw new MenuPriceError(owned.status, owned.code === "global_requires_moo" ? "forbidden" : owned.code);
  }
```

1b. **The owner rides the write (Astra 4a r1 P1).** In `updateMenuPrice`, replace

```ts
  let query = sb.from("menu_items").update({ menu_price: value, updated_at: new Date().toISOString(), updated_by: actor.user.id })
    .eq("id", id).eq("active", true);
```

with

```ts
  let query = sb.from("menu_items").update({ menu_price: value, updated_at: new Date().toISOString(), updated_by: actor.user.id })
    .eq("id", id).eq("active", true);
  // THE OWNER THIS WRITE WAS AUTHORIZED FOR RIDES IT (Astra 4a r1 P1): a GM may set this price only because its shop owns
  // the sandwich; a MoO share after the read makes the UPDATE match nothing, and the re-read below names why.
  const owner = data.location_id ?? null;
  query = owner === null ? query.is("location_id", null) : query.eq("location_id", owner);
```

and replace `  if (!result.data?.length) throw new MenuPriceError(409, "menu_price_changed");` with

```ts
  if (!result.data?.length) {
    const { data: now } = await sb.from("menu_items").select("location_id").eq("id", id).maybeSingle<{ location_id: string | null }>();
    throw new MenuPriceError(409, now && (now.location_id ?? null) !== owner ? "ownership_changed" : "menu_price_changed");
  }
```

2. In `app/api/admin/menu-items/[id]/price/route.ts`, replace the import `import { MENU_PRICE_WRITE_MIN, MenuPriceError, updateMenuPrice } from "@/lib/admin/menu-prices";` with `import { MenuPriceError, updateMenuPrice } from "@/lib/admin/menu-prices";` plus `import { NEW_THING_MIN } from "@/lib/catalog/shop-owned-shared";`, and replace `  if (ROLES[ctx.user.role].level < MENU_PRICE_WRITE_MIN) return jsonError(403, "forbidden");` with `  // A GM sets its own shop-only sandwich's price (0264); the lib decides which items, after the read.\n  if (ROLES[ctx.user.role].level < NEW_THING_MIN) return jsonError(403, "forbidden");`.

- [ ] **Step 5b: Every check-then-write on an owner carries that owner into the write (Astra 4a r1 P1)**

The inventory (grep `location_id` reads followed by a write by id in `lib/`; `skuOwnerAllowed` / `lockLocationContext` / `ownerWriteCheck` call sites):

| Writer | Owner decides? | Fix |
|---|---|---|
| `writeRecipeVersion` / `saveRecipeLines` (and restore / adopt / promote through them) — a GM on its shop's own recipe | yes — the owner GRANTS the right | `save_owned_recipe_version` (Step 2 item 7; 0264) |
| `updateMenuPrice` — a GM on its shop's own sandwich | yes — grants | `location_id` in the UPDATE + re-read (Step 5 item 1b) |
| `updateSku` | binds on the owner; and a stale form re-sent `location_id`, RE-OWNING an item shared meanwhile | write `location_id` only when it changes; the bound owner in the UPDATE (below) |
| `deactivateSku`, `setSkuPriceBasis` (`lib/catalog/sku-item.ts`), `promoteItemToGlobal` | bind on the owner | the bound owner in the UPDATE (below) |
| `share_shop_owned_*` | yes | `p_expected_owner` compare-and-set (0264, already) |
| 2a's pack / price writers (`save_sku_pack_version`, `save_sku_global_price`, Record price) | the owner bind only RESTRICTS (the global value's first-value rule is decided in SQL under the SKU lock whatever the owner) | none — a share between the bind and the RPC cannot widen what the write may do |
| `setUpItemAtShop` steps (par, order days, guide line, use-in, barcode) | visibility at the shop | none — an owner is only ever CLEARED (a share widens visibility); a MoO move to another shop would leave an overlay row no reader at this shop sees |
| Legacy recipe header / output writers (`updateRecipe`, `addRecipeOutput`, `updateRecipeOutputYield`, `removeRecipeEdge`) | no owner check before 4a (GM+ for every recipe) | a 404 for another shop's own recipe (below); racing a share only widens, so no compare-and-set is needed |

1. `lib/admin/skus.ts` `updateSku`: replace `    update.location_id = changes.locationId;` with `    // A stale form never RE-OWNS an item shared meanwhile (Astra 4a r1): the column is written only when it changes.\n    if ((packBefore.location_id ?? null) !== changes.locationId) update.location_id = changes.locationId;`; replace

```ts
  let q = sb.from("vendor_items").update(update, { count: "exact" }).eq("id", args.id);
```

with

```ts
  let q = sb.from("vendor_items").update(update, { count: "exact" }).eq("id", args.id);
  // THE BOUND OWNER RIDES THE WRITE (Astra 4a r1 P1): the shop this edit was authorized for must still own the item.
  const boundOwner = (packBefore.location_id as string | null | undefined) ?? null;
  q = boundOwner === null ? q.is("location_id", null) : q.eq("location_id", boundOwner);
```

and replace `  if (count === 0) {\n    throw changedPack.length > 0` with

```ts
  if (count === 0) {
    const { data: now } = await sb.from("vendor_items").select("location_id").eq("id", args.id).maybeSingle<{ location_id: string | null }>();
    if (now && (now.location_id ?? null) !== boundOwner) {
      throw new AdminSkuError(409, "ownership_changed", "This item was shared or moved since you opened it — reload");
    }
    throw changedPack.length > 0
```

2. `deactivateSku`: replace `    .eq("id", args.id);\n  if (error) throw new Error(\`deactivateSku failed: ${error.message}\`);\n  if (count === 0) throw new AdminSkuError(404, "sku_not_found", "SKU not found");` with

```ts
    .eq("id", args.id)
    // Astra 4a r1: the shop this was authorized for must still own it.
    .or(cur.location_id === null ? "location_id.is.null" : `location_id.eq.${cur.location_id}`);
  if (error) throw new Error(`deactivateSku failed: ${error.message}`);
  if (count === 0) throw new AdminSkuError(409, "ownership_changed", "This item was shared or moved since you opened it — reload");
```

3. `lib/catalog/sku-item.ts` `setSkuPriceBasis`: replace `  const base = sb.from("vendor_items").update({ price_basis: basis }, { count: "exact" }).eq("id", skuId);` with `  const base = sb.from("vendor_items").update({ price_basis: basis }, { count: "exact" }).eq("id", skuId)\n    .or(row.location_id === null ? "location_id.is.null" : \`location_id.eq.${row.location_id}\`); // the bound owner (Astra 4a r1)` (a mismatch stays its existing `409 version_changed`).
4. `lib/admin/templates.ts` `promoteItemToGlobal`: replace

```ts
  const { error: uErr } = await sb
    .from("items")
    .update({ location_id: null, updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`promoteItemToGlobal update failed: ${uErr.message}`);
```

with

```ts
  const { error: uErr, count: promoted } = await sb
    .from("items")
    .update({ location_id: null, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", args.itemId)
    .eq("location_id", item.location_id); // Astra 4a r1: the shop this was authorized for must still own it
  if (uErr) throw new Error(`promoteItemToGlobal update failed: ${uErr.message}`);
  if (promoted === 0) throw new AdminTemplateError(409, "ownership_changed", "Item was shared or moved since you looked");
```

5. `lib/recipes.ts`: directly after `creationScope` (Step 6 item 1), add

```ts
/**
 * CATALOG PHASE 4a (lead decision 2; Astra 4a r1 inventory): another shop's own recipe does not exist for this actor — the
 * legacy header / output writers answer 404. They grant nothing extra to an owner (GM+ for every recipe), so a share racing
 * this read only widens who may write: no compare-and-set is needed.
 */
async function requireRecipeVisible(actor: AuthContext, recipeId: string): Promise<void> {
  const { data, error } = await getServiceRoleClient().from("recipes").select("location_id").eq("id", recipeId)
    .maybeSingle<{ location_id: string | null }>();
  if (error) throw new Error(`recipe owner read: ${error.message}`);
  const owner = data?.location_id ?? null;
  if (owner !== null && !catalogShopAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, owner)) {
    throw new RecipeError(404, "recipe_not_found");
  }
}
```

and call it: in `updateRecipe` replace `  requireLevel(actor, RECIPE_WRITE_MIN);\n  const upd: Record<string, unknown> = { updated_at:` with `  requireLevel(actor, RECIPE_WRITE_MIN);\n  await requireRecipeVisible(actor, id);\n  const upd: Record<string, unknown> = { updated_at:`; in `addRecipeOutput` replace `  requireLevel(actor, RECIPE_WRITE_MIN);\n  const itemId = input.outputItemId ?? null, menuId` with `  requireLevel(actor, RECIPE_WRITE_MIN);\n  await requireRecipeVisible(actor, input.recipeId);\n  const itemId = input.outputItemId ?? null, menuId`; in `updateRecipeOutputYield` replace `  requireLevel(actor, RECIPE_WRITE_MIN);\n  if (!(typeof input.yield === "number"` with `  requireLevel(actor, RECIPE_WRITE_MIN);\n  await requireRecipeVisible(actor, input.recipeId);\n  if (!(typeof input.yield === "number"`; in `removeRecipeEdge` replace `  requireLevel(actor, RECIPE_WRITE_MIN);\n  const sb = getServiceRoleClient();\n  if (args.table === "recipe_outputs") {` with

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { data: edge } = await sb.from(args.table).select("recipe_id").eq("id", args.id).maybeSingle<{ recipe_id: string }>();
  if (edge) await requireRecipeVisible(actor, edge.recipe_id);
  if (args.table === "recipe_outputs") {
```

- [ ] **Step 6: GM creation goes shop-only (`lib/recipes.ts`, `lib/admin/skus.ts`)**

1. `lib/recipes.ts` (lead decision 1 — a GM keeps creating recipes, as its shop's own). Add `import { catalogShopAllowed } from "@/lib/sku-versions-shared";` (if absent) and, directly after 3b's `requireGlobalLineWriter` function, add:

```ts
/**
 * WHERE A NEW RECIPE OR MENU ITEM LIVES (catalog Phase 4a, lead decision 1; spec §3). MoO+ creates for every shop
 * (null) unless it names a shop. Below MoO it is the creator's SHOP's own: the shop it names, or — naming none — the
 * one shop it works at; a GM at several shops must name one (location_required). Never a shop it does not work at.
 */
function creationScope(actor: AuthContext, requested: string | null | undefined): string | null {
  const level = getRoleLevel(actor.user.role);
  const shop = requested ?? (level >= RECIPE_GLOBAL_WRITE_MIN ? null : actor.locations.length === 1 ? actor.locations[0]! : undefined);
  if (shop === undefined) throw new RecipeError(400, "location_required");
  if (shop !== null && !catalogShopAllowed({ level, locations: actor.locations }, shop)) throw new RecipeError(404, "not_found");
  return shop;
}
```

2. `createRecipe`: in its signature, add `locationId?: string | null; ` after `batchMode?: boolean; ` in the input type (the input type ends `shelfLifeDays?: number; batchMode?: boolean }`, which becomes `shelfLifeDays?: number; batchMode?: boolean; locationId?: string | null }`). Replace

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (!normStr(input.name)) throw new RecipeError(400, "invalid_name");
  if (!Number.isFinite(input.batchYield) || input.batchYield <= 0) throw new RecipeError(400, "invalid_batch_yield");
```

with

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  // Catalog Phase 4a (lead decision 1): below MoO, the recipe is the creator's shop's own (recipes.location_id).
  const scope = creationScope(actor, input.locationId);
  if (!normStr(input.name)) throw new RecipeError(400, "invalid_name");
  if (!Number.isFinite(input.batchYield) || input.batchYield <= 0) throw new RecipeError(400, "invalid_batch_yield");
```

and in its insert replace `directions_es: normStr(input.directionsEs), active: true, created_by: actor.user.id,` with `directions_es: normStr(input.directionsEs), ...(scope ? { location_id: scope } : {}), active: true, created_by: actor.user.id,` (the owner is set by the INSERT itself — 0264 allows that; outputs added later are judged by the ownership law).

3. `createRecipeFull`: in `export interface RecipeDraft {`, after `shelfLifeDays?: number;` add `  /** Catalog Phase 4a: the shop it belongs to (creationScope; below MoO always a shop). */\n  locationId?: string | null;`. Replace

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (!normStr(draft.name)) throw new RecipeError(400, "invalid_name");
```

with

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  // Catalog Phase 4a (lead decision 1): below MoO, a shop's own recipe — written by 0264's create_shop_recipe.
  const scope = creationScope(actor, draft.locationId);
  if (!normStr(draft.name)) throw new RecipeError(400, "invalid_name");
```

replace `  const { data, error } = await sb.rpc("create_recipe_full", {` with

```ts
  // A shop's own recipe: 0264's create_shop_recipe (0262's create_recipe_full, then the owner, in one transaction) —
  // the same arguments plus the shop.
  const { data, error } = await sb.rpc(scope === null ? "create_recipe_full" : "create_shop_recipe", {
    ...(scope === null ? {} : { p_location: scope }),
```

replace

```ts
    const named = rpcRecipeError(error, BATCH_MODE_RPC_ERRORS);
    if (named) throw named;
    throw new Error(`createRecipeFull rpc: ${error.message}`);
```

with

```ts
    const named = rpcRecipeError(error, BATCH_MODE_RPC_ERRORS);
    if (named) throw named;
    // 0264's ownership law (what a shop's own recipe may make and use), named.
    const owned = /shop_owned:([a-z_]+)/.exec(error.message ?? "")?.[1];
    if (owned) throw new RecipeError(owned === "location_not_found" ? 404 : 400, owned);
    throw new Error(`createRecipeFull rpc: ${error.message}`);
```

and in its audit metadata replace `metadata: { name: draft.name, recipe_type: draft.recipeType,` with `metadata: { name: draft.name, recipe_type: draft.recipeType, location_id: scope,`.

4. `createMenuItem`: change its input type to `{ name: string; nameEs?: string | null; menuPrice?: number | null; locationId?: string | null }`; replace

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (input.menuPrice != null) requireLevel(actor, MENU_PRICE_MIN);
```

with

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  // Catalog Phase 4a (lead decision 1): below MoO, the creator's shop's own sandwich — whose price IS that shop's.
  const scope = creationScope(actor, input.locationId);
  if (input.menuPrice != null && scope === null) requireLevel(actor, MENU_PRICE_MIN);
```

and in its insert replace `menu_price: input.menuPrice ?? null, active: true, created_by: actor.user.id })` with `menu_price: input.menuPrice ?? null, ...(scope ? { location_id: scope, catering_available: false } : {}), active: true, created_by: actor.user.id })`.

5. The routes pass the shop through: in `app/api/admin/recipes/route.ts` (createRecipe) and `app/api/admin/recipes/full/route.ts` (createRecipeFull), directly after the line `      name: b.name as string,` add `      locationId: typeof b.locationId === "string" ? b.locationId : undefined,`; in `app/api/admin/menu-items/route.ts`, directly after its `      name: b.name as string,` add the same line.

6. `lib/admin/templates.ts` `promoteItemToGlobal`: directly before `  // All item columns (incl. menu_price, oz_per_par_unit, tracking_type, etc.) ride this in-place flip automatically — no explicit column list needed.`, insert:

```ts
  // Catalog Phase 4a: an item one of its shop's OWN recipes makes is shared WITH that recipe ("Share with every shop" on
  // the recipe page) — never alone, or every other shop would see an item nothing there can make (0264 refuses it too).
  const { data: makers, error: mErr } = await sb.from("recipe_outputs").select("recipe_id").eq("output_item_id", args.itemId)
    .returns<Array<{ recipe_id: string }>>();
  if (mErr) throw new Error(`promoteItemToGlobal makers: ${mErr.message}`);
  const makerIds = [...new Set((makers ?? []).map((m) => m.recipe_id))];
  if (makerIds.length > 0) {
    const { data: ownedMakers, error: oErr } = await sb.from("recipes").select("id").in("id", makerIds).not("location_id", "is", null)
      .returns<Array<{ id: string }>>();
    if (oErr) throw new Error(`promoteItemToGlobal owned makers: ${oErr.message}`);
    if ((ownedMakers ?? []).length > 0) throw new AdminTemplateError(409, "share_the_recipe", "Share the recipe that makes it");
  }
```

7. `lib/admin/skus.ts`: add `import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";` (if not already imported). In `createSku`, replace

```ts
  requireLevel(actor, SKU_WRITE_MIN);
  // A shop-scoped SKU may only be minted at a shop the actor holds; a GLOBAL SKU
```

with

```ts
  requireLevel(actor, SKU_WRITE_MIN);
  // Catalog Phase 4a (spec §3): a new item for EVERY shop is MoO+; a GM's new item names its shop and starts there.
  if (input.locationId === null && actor.level < GLOBAL_VERSION_WRITE_MIN) {
    throw new AdminSkuError(403, "global_requires_moo", "A new item starts at your shop — the Director of Operations shares it with every shop");
  }
  // A shop-scoped SKU may only be minted at a shop the actor holds; a GLOBAL SKU
```

In `updateSku`, replace

```ts
  if (changes.locationId !== undefined) {
    if (changes.locationId !== null) {
```

with

```ts
  if (changes.locationId !== undefined) {
    // Catalog Phase 4a: moving an item's shop (to every shop, or to another) is sharing by another name — MoO+.
    if ((packBefore.location_id ?? null) !== changes.locationId && actor.level < GLOBAL_VERSION_WRITE_MIN) {
      throw new AdminSkuError(403, "global_requires_moo", "Only the Director of Operations moves an item between shops");
    }
    if (changes.locationId !== null) {
```

- [ ] **Step 7: Run, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/shop-owned-permissions.test.ts tests/recipe-versions-permissions.test.ts tests/recipe-adopt-promote-permissions.test.ts tests/catalog-recipe-server.test.ts tests/legacy-recipe-line-boundary.test.ts tests/location-bind-skus.test.ts tests/location-bind-differential.test.ts` → expected: PASS, 0 failed. (If an existing SKU test creates a GLOBAL SKU as a GM, change its actor to MoO and add a line saying why: Phase 4a, spec §3.)

```bash
git add lib/admin/recipe-versions.ts lib/admin/menu-item-shop.ts lib/catalog/recipe-item.ts lib/catalog/recipe-item-shared.ts "app/admin/catalog/recipe/[id]/page.tsx" lib/admin/menu-prices.ts "app/api/admin/menu-items/[id]/price/route.ts" lib/recipes.ts lib/admin/skus.ts lib/catalog/sku-item.ts lib/admin/templates.ts tests/shop-owned-permissions.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a — a shop edits its own sandwich, bound to that owner; a shop version names no other shop's own thing; GM-created things start shop-only; moving an item's shop is MoO+

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 7: Job 2 — New item: the atomic create and the shop setup steps

**Files:**
- Create: `lib/catalog/new-item-shared.ts`, `lib/catalog/new-item.ts`, `tests/new-item.test.ts`

- [ ] **Step 1: Write the failing test `tests/new-item.test.ts`**

```ts
/** Catalog Phase 4a — job 2: what the page may send, the one atomic create, and each shop setup step through its own writer. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_RECIPE } from "./fixtures/shop-owned-fixture";

let current: ReturnType<typeof createFakeDb> | null = null;
let rpc: ReturnType<typeof vi.fn>;
const audits: string[] = [];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no database expected");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async (a: { action: string }) => { audits.push(a.action); } }));
vi.mock("@/lib/admin/pack-chain", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin/pack-chain")>()),
  loadMeasureLabels: async () => new Set(["oz", "lb", "each"]),
  loadMeasuresMap: async () => new Map([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }],
    ["each", { dimension: "count", toBaseFactor: 1 }]]),
}));
const upsertPar = vi.fn(async () => {});
const setPair = vi.fn(async () => ({ id: "pair-1" }));
const saveGuide = vi.fn(async (_a: unknown, _v: string, next: { guideId: string }) => next);
const saveLines = vi.fn(async () => ({ versionId: "rv-x", retiredVersionId: null, changed: true }));
const teach = vi.fn(async () => ({ created: true }));
vi.mock("@/lib/admin/skus", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/skus")>()), upsertLocationSkuSettings: upsertPar }));
vi.mock("@/lib/vendor-rhythm", async (orig) => ({ ...(await orig<typeof import("@/lib/vendor-rhythm")>()), setVendorRhythmPair: setPair }));
vi.mock("@/lib/order-guides", async (orig) => ({
  ...(await orig<typeof import("@/lib/order-guides")>()),
  loadOrderGuide: async () => ({ guideId: "g-1", vendorId: "v-1", name: "Guide", updatedAt: "2026-10-01T00:00:00.000Z",
    sections: [{ id: "sec-1", name: "Dairy", position: 1, lines: [] }] }),
  saveOrderGuide: saveGuide,
}));
vi.mock("@/lib/admin/recipe-versions", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/recipe-versions")>()), saveRecipeLines: saveLines }));
vi.mock("@/lib/barcodes", async (orig) => ({ ...(await orig<typeof import("@/lib/barcodes")>()), teachBarcode: teach }));

import { parseNewItemRequest, parseSetupStep, type NewItemRequest, type SetupStep } from "@/lib/catalog/new-item-shared";
import { createCatalogItem, setUpItemAtShop } from "@/lib/catalog/new-item";

const actor = (role: string, level: number, locations: string[]) => ({ user: { id: "u-1", role, name: "T" }, role, level, locations }) as never;
const gm = actor("gm", 7, [LOC]);
const moo = actor("moo", 8, []);
const V = "33333333-3333-4333-8333-333333333333";
const SHOP = "44444444-4444-4444-8444-444444444444"; // parse tests take real UUIDs; the fake database's shops are "loc-1" / "loc-2"
const caseOf = [{ label: "case", containsQty: 6, containsIndex: 1, containsMeasureUnit: null }, { label: "bag", containsQty: 5, containsIndex: null, containsMeasureUnit: "lb" }];
/** A request as parseNewItemRequest would hand it over (built directly: the fixture's shop ids are not UUIDs). */
const request = (over: Partial<NewItemRequest> = {}): NewItemRequest => ({
  scope: LOC, vendorId: V, name: "Local pickles", itemNumber: "P-12", levels: caseOf, avgOzPerEach: null,
  unitPrice: 42, priceDate: "2026-10-15", skuClass: "raw", ...over,
});

beforeEach(() => {
  const t = buildShopOwnedFixture();
  t.vendor_items!.push({ id: "s-new", name: "Local pickles", vendor_id: "v-1", location_id: LOC, item_number: "P-12", active: true });
  t.vendor_items!.push({ id: "s-other", name: "B relish", vendor_id: "v-1", location_id: OTHER, item_number: null, active: true });
  current = createFakeDb(t);
  rpc = vi.fn(async () => ({ data: { sku_id: "s-new", location_id: LOC, pack: { version_id: "pv-1" }, price: { price_id: "ph-1" } }, error: null }));
  (current.client as unknown as { rpc: unknown }).rpc = rpc;
  audits.length = 0;
  for (const f of [upsertPar, setPair, saveGuide, saveLines, teach, rpc]) f.mockClear();
});
afterEach(() => { current = null; });

describe("parseNewItemRequest", () => {
  it("takes a full request and refuses each bad part by name", () => {
    expect(parseNewItemRequest({ scope: SHOP, vendorId: V, name: " Local pickles ", itemNumber: "P-12", levels: caseOf, unitPrice: 42, priceDate: "2026-10-15" }))
      .toEqual({ ok: true, request: { scope: SHOP, vendorId: V, name: "Local pickles", itemNumber: "P-12", levels: caseOf, avgOzPerEach: null, unitPrice: 42, priceDate: "2026-10-15", skuClass: "raw" } });
    expect(parseNewItemRequest({ scope: "x", name: "A", levels: caseOf })).toMatchObject({ ok: false, field: "scope" });
    expect(parseNewItemRequest({ scope: null, name: " ", levels: caseOf })).toMatchObject({ ok: false, code: "invalid_name" });
    expect(parseNewItemRequest({ scope: null, name: "A", levels: [] })).toMatchObject({ ok: false, code: "invalid_levels" });
    expect(parseNewItemRequest({ scope: null, name: "A", levels: caseOf, unitPrice: 5 })).toMatchObject({ ok: false, code: "invalid_date" });
    expect(parseNewItemRequest({ scope: null, name: "A", levels: caseOf, unitPrice: -1, priceDate: "2026-10-15" })).toMatchObject({ ok: false, code: "invalid_price" });
  });
});

describe("parseSetupStep", () => {
  it("each step's shape", () => {
    expect(parseSetupStep({ shopId: SHOP, step: { kind: "par", weekdayPar: 2, weekendPar: null } })).toEqual({ ok: true, shopId: SHOP, step: { kind: "par", weekdayPar: 2, weekendPar: null } });
    expect(parseSetupStep({ shopId: "loc-1", step: { kind: "par", weekdayPar: 2, weekendPar: null } })).toMatchObject({ ok: false, field: "shopId" });
    expect(parseSetupStep({ shopId: SHOP, step: { kind: "order_days", days: [{ orderDow: 1, leadDays: 2 }, { orderDow: 1, leadDays: 1 }] } })).toMatchObject({ ok: false, field: "days" });
    expect(parseSetupStep({ shopId: SHOP, step: { kind: "guide_line", sectionId: null, newSectionName: null } })).toMatchObject({ ok: false, field: "section" });
    expect(parseSetupStep({ shopId: SHOP, step: { kind: "use_in", recipeId: "nope", quantity: 1, unit: "oz", expectedVersionId: null, basedOnVersionId: null } })).toMatchObject({ ok: false, field: "recipeId" });
    expect(parseSetupStep({ shopId: SHOP, step: { kind: "barcode", code: "0123456789012", level: "case" } })).toMatchObject({ ok: true });
    expect(parseSetupStep({ shopId: SHOP, step: { kind: "nope" } })).toMatchObject({ ok: false, field: "kind" });
  });
});

describe("createCatalogItem — ONE write: the SKU, its first pack, its first price", () => {
  it("a GM's item starts at its shop, first-only, through create_catalog_sku; audited in each write's own words", async () => {
    await expect(createCatalogItem(gm, request())).resolves.toEqual({ skuId: "s-new", ownerLocationId: LOC, packVersionId: "pv-1", priceId: "ph-1" });
    expect(rpc).toHaveBeenCalledWith("create_catalog_sku", expect.objectContaining({
      p_sku: expect.objectContaining({ location_id: LOC, vendor_id: V, name: "Local pickles", item_number: "P-12", sku_class: "raw" }),
      p_levels: [{ label: "case", containsQty: 6, containsIndex: 1, containsMeasureUnit: null }, { label: "bag", containsQty: 5, containsIndex: null, containsMeasureUnit: "lb" }],
      p_unit_price: 42, p_price_date: "2026-10-15", p_first_only: true,
    }));
    expect(audits).toEqual(["vendor_item.create", "sku.pack_version_save", "vendor_item.price_recorded"]);
  });
  it("a GM never creates for every shop; MoO+ may, not first-only", async () => {
    await expect(createCatalogItem(gm, request({ scope: null }))).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    expect(rpc).not.toHaveBeenCalled();
    await createCatalogItem(moo, request({ scope: null }));
    expect(rpc).toHaveBeenCalledWith("create_catalog_sku", expect.objectContaining({ p_first_only: false }));
  });
  it("the chain is checked by 2a's rules before the database: a container named like a unit is refused", async () => {
    await expect(createCatalogItem(gm, request({ levels: [{ label: "oz", containsQty: 1, containsIndex: null, containsMeasureUnit: "lb" }] })))
      .rejects.toMatchObject({ status: 400, code: "label_is_measure_unit" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a database refusal keeps its name", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "shop_owned:item_number_taken" } });
    await expect(createCatalogItem(gm, request())).rejects.toMatchObject({ status: 409, code: "item_number_taken" });
  });
});

describe("setUpItemAtShop — each step through the writer that owns it", () => {
  const step = (s: SetupStep, skuId = "s-new", shopId = LOC) => setUpItemAtShop(gm, { skuId, shopId, step: s });
  it("par: the first par at this shop — the baseline is 'nothing set here'", async () => {
    await step({ kind: "par", weekdayPar: 2, weekendPar: 3 });
    expect(upsertPar).toHaveBeenCalledWith(gm, expect.objectContaining({ skuId: "s-new", locationId: LOC, weekdayPar: 2, weekendPar: 3,
      expected: { activeOverride: null, weekdayPar: null, weekendPar: null } }));
  });
  it("order days: one rhythm pair per day, for the item's vendor at this shop", async () => {
    await step({ kind: "order_days", days: [{ orderDow: 1, leadDays: 2 }, { orderDow: 4, leadDays: 1 }] });
    expect(setPair).toHaveBeenCalledTimes(2);
    expect(setPair).toHaveBeenCalledWith(gm, { vendorId: "v-1", locationId: LOC, orderDow: 4, leadDays: 1 });
  });
  it("order guide: a new section, then the line, in ONE guide save", async () => {
    await step({ kind: "guide_line", sectionId: null, newSectionName: "Pickles" });
    const saved = saveGuide.mock.calls[0]![2] as unknown as { sections: Array<{ name: string; lines: Array<{ skuId: string }> }> };
    expect(saved.sections.at(-1)).toMatchObject({ name: "Pickles", lines: [{ skuId: "s-new" }] });
  });
  it("where it's used: a shared recipe gets this shop's version; the shop's own recipe is edited as itself", async () => {
    await step({ kind: "use_in", recipeId: "r-italian", quantity: 1, unit: "oz", expectedVersionId: null, basedOnVersionId: "rv-r-italian-base" });
    expect(saveLines).toHaveBeenLastCalledWith(gm, expect.objectContaining({ recipeId: "r-italian", scope: LOC }));
    await step({ kind: "use_in", recipeId: OWNED_RECIPE, quantity: 1, unit: "oz", expectedVersionId: `rv-${OWNED_RECIPE}-base`, basedOnVersionId: null });
    expect(saveLines).toHaveBeenLastCalledWith(gm, expect.objectContaining({ recipeId: OWNED_RECIPE, scope: null }));
  });
  it("barcode: taught at the door's own writer, for the item's vendor", async () => {
    await step({ kind: "barcode", code: "0123456789012", level: "case" });
    expect(teach).toHaveBeenCalledWith(gm, expect.objectContaining({ vendorId: "v-1", locationId: LOC, skuId: "s-new", level: "case" }));
  });
  it("another shop's item, or another shop, is not this GM's to set up", async () => {
    await expect(step({ kind: "par", weekdayPar: 1, weekendPar: 1 }, "s-other")).rejects.toMatchObject({ status: 404 });
    await expect(step({ kind: "par", weekdayPar: 1, weekendPar: 1 }, "s-new", OTHER)).rejects.toMatchObject({ status: 404 });
    expect(upsertPar).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/new-item.test.ts` → expected: FAIL (modules missing).

- [ ] **Step 2: Create `lib/catalog/new-item-shared.ts`**

```ts
/**
 * JOB 2 — NEW ITEM, START TO FINISH (catalog Phase 4a; spec §5 job 2). PURE: the request a page sends, and the shop
 * setup steps that follow the one atomic create. No I/O; safe in client bundles.
 *
 *   what it is → vendor → name + vendor item number → how it arrives → price ......... ONE write (create_catalog_sku)
 *   par → order days → order-guide line → where it's used → barcode ................. one save each, its own writer
 *
 * The create is atomic: no item exists without its first pack and price. Each setup step is a SEPARATE save through
 * the writer that already owns it — the par lane, the vendor's rhythm, the vendor's guide, the recipe version writer,
 * the barcode door — so each keeps its own rules, refusals and audit. A step that fails is reported on its own, and
 * the item page's "What's missing" (2b) keeps offering it.
 */
import { isSkuClass, type SkuClass } from "@/lib/admin/catalog-shared";
import type { PackChainLevelInput } from "@/lib/admin/pack-chain";
import { parseLevels } from "@/lib/catalog/sku-item-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuidOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID.test(v) ? v : undefined;
const textOrNull = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t.length <= max ? t : undefined;
};

export interface NewItemRequest {
  /** Where it starts (spec §3): a shop the actor works in; null = every shop — MoO+ only. */
  scope: string | null;
  vendorId: string | null;
  name: string;
  itemNumber: string | null;
  /** How it arrives — 2b's sentence editor, as chain levels (levelsFromSentence). */
  levels: PackChainLevelInput[];
  /** What ONE weighs, in oz — needed when the chain ends in a count ("each") on a food item. */
  avgOzPerEach: number | null;
  /** The first price (per the top container), and the day it took effect. */
  unitPrice: number | null;
  priceDate: string | null;
  skuClass: SkuClass;
}

export type NewItemParse =
  | { ok: true; request: NewItemRequest }
  | { ok: false; code: "invalid_payload" | "invalid_name" | "invalid_levels" | "invalid_price" | "invalid_date"; field: string };

export function parseNewItemRequest(raw: unknown): NewItemParse {
  if (!isObj(raw)) return { ok: false, code: "invalid_payload", field: "body" };
  const scope = uuidOrNull(raw.scope);
  if (scope === undefined) return { ok: false, code: "invalid_payload", field: "scope" };
  const vendorId = uuidOrNull(raw.vendorId);
  if (vendorId === undefined) return { ok: false, code: "invalid_payload", field: "vendorId" };
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length < 1 || name.length > 200) return { ok: false, code: "invalid_name", field: "name" };
  const itemNumber = textOrNull(raw.itemNumber, 80);
  if (itemNumber === undefined) return { ok: false, code: "invalid_payload", field: "itemNumber" };
  const levels = parseLevels(raw.levels);
  if (!levels || levels.length === 0) return { ok: false, code: "invalid_levels", field: "levels" };
  const avg = raw.avgOzPerEach;
  const avgOzPerEach = avg === null || avg === undefined ? null : typeof avg === "number" && Number.isFinite(avg) && avg > 0 ? avg : undefined;
  if (avgOzPerEach === undefined) return { ok: false, code: "invalid_payload", field: "avgOzPerEach" };
  const p = raw.unitPrice;
  const unitPrice = p === null || p === undefined ? null : typeof p === "number" && Number.isFinite(p) && p > 0 && p <= 100000 ? p : undefined;
  if (unitPrice === undefined) return { ok: false, code: "invalid_price", field: "unitPrice" };
  const d = raw.priceDate;
  const priceDate = d === null || d === undefined ? null : typeof d === "string" && DATE.test(d) && !Number.isNaN(Date.parse(d)) ? d : undefined;
  if (priceDate === undefined || (unitPrice !== null && priceDate === null)) return { ok: false, code: "invalid_date", field: "priceDate" };
  const skuClass = raw.skuClass === null || raw.skuClass === undefined ? "raw" : isSkuClass(raw.skuClass) ? raw.skuClass : undefined;
  if (skuClass === undefined) return { ok: false, code: "invalid_payload", field: "skuClass" };
  return { ok: true, request: { scope, vendorId, name, itemNumber, levels, avgOzPerEach, unitPrice, priceDate, skuClass } };
}

/** The shop setup after the create — each one an existing writer, saved and reported on its own. */
export type SetupStep =
  | { kind: "par"; weekdayPar: number | null; weekendPar: number | null }
  | { kind: "order_days"; days: Array<{ orderDow: number; leadDays: number }> }
  | { kind: "guide_line"; sectionId: string | null; newSectionName: string | null }
  | { kind: "use_in"; recipeId: string; quantity: number; unit: string; expectedVersionId: string | null; basedOnVersionId: string | null }
  | { kind: "barcode"; code: string; level: "case" | "inner" };

export const SETUP_STEP_KINDS = ["par", "order_days", "guide_line", "use_in", "barcode"] as const satisfies ReadonlyArray<SetupStep["kind"]>;

export type SetupParse = { ok: true; shopId: string; step: SetupStep } | { ok: false; field: string };

const par = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : undefined;
const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

export function parseSetupStep(raw: unknown): SetupParse {
  if (!isObj(raw)) return { ok: false, field: "body" };
  if (typeof raw.shopId !== "string" || !UUID.test(raw.shopId)) return { ok: false, field: "shopId" };
  const shopId = raw.shopId;
  const s = raw.step;
  if (!isObj(s)) return { ok: false, field: "step" };
  switch (s.kind) {
    case "par": {
      const weekdayPar = par(s.weekdayPar);
      const weekendPar = par(s.weekendPar);
      if (weekdayPar === undefined || weekendPar === undefined) return { ok: false, field: "par" };
      return { ok: true, shopId, step: { kind: "par", weekdayPar, weekendPar } };
    }
    case "order_days": {
      if (!Array.isArray(s.days) || s.days.length === 0 || s.days.length > 7) return { ok: false, field: "days" };
      const days: Array<{ orderDow: number; leadDays: number }> = [];
      const seen = new Set<number>();
      for (const d of s.days) {
        if (!isObj(d)) return { ok: false, field: "days" };
        const orderDow = int(d.orderDow, 0, 6);
        const leadDays = int(d.leadDays, 0, 14);
        if (orderDow === undefined || leadDays === undefined || seen.has(orderDow)) return { ok: false, field: "days" };
        seen.add(orderDow);
        days.push({ orderDow, leadDays });
      }
      return { ok: true, shopId, step: { kind: "order_days", days } };
    }
    case "guide_line": {
      const sectionId = uuidOrNull(s.sectionId);
      const newSectionName = textOrNull(s.newSectionName, 60);
      if (sectionId === undefined || newSectionName === undefined || (sectionId === null) === (newSectionName === null)) return { ok: false, field: "section" };
      return { ok: true, shopId, step: { kind: "guide_line", sectionId, newSectionName } };
    }
    case "use_in": {
      if (typeof s.recipeId !== "string" || !UUID.test(s.recipeId)) return { ok: false, field: "recipeId" };
      if (typeof s.quantity !== "number" || !Number.isFinite(s.quantity) || s.quantity <= 0) return { ok: false, field: "quantity" };
      const unit = textOrNull(s.unit, 40);
      if (!unit) return { ok: false, field: "unit" };
      const expectedVersionId = uuidOrNull(s.expectedVersionId);
      const basedOnVersionId = uuidOrNull(s.basedOnVersionId);
      if (expectedVersionId === undefined || basedOnVersionId === undefined) return { ok: false, field: "version" };
      return { ok: true, shopId, step: { kind: "use_in", recipeId: s.recipeId, quantity: s.quantity, unit, expectedVersionId, basedOnVersionId } };
    }
    case "barcode": {
      const code = textOrNull(s.code, 64);
      if (!code || code.length < 6) return { ok: false, field: "code" };
      if (s.level !== "case" && s.level !== "inner") return { ok: false, field: "level" };
      return { ok: true, shopId, step: { kind: "barcode", code, level: s.level } };
    }
    default:
      return { ok: false, field: "kind" };
  }
}
```

- [ ] **Step 3: Create `lib/catalog/new-item.ts`**

```ts
/**
 * JOB 2 — NEW ITEM, START TO FINISH: the server half (catalog Phase 4a). SERVER-ONLY, service role.
 *
 * THE CREATE IS ONE WRITE (create_catalog_sku, 0264): the item row, its first pack version and its first price — 2a's
 * own writers, under their own locks, in one transaction. Below MoO it is FIRST-ONLY (trivially: the item is new) and it
 * starts at the GM's shop (spec §3, newThingScopeGate); MoO+ may create it for every shop.
 * THE SETUP IS ONE STEP AT A TIME, each through the writer that owns it (see lib/catalog/new-item-shared.ts).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { GLOBAL_VERSION_WRITE_MIN, type VersionScope } from "@/lib/sku-versions-shared";
import { loadMeasureLabels, loadMeasuresMap, PackChainError, validateSubmission, type PackChainLevelInput } from "@/lib/admin/pack-chain";
import { rpcLevels, versionErrorFromRpc } from "@/lib/admin/sku-versions";
import { upsertLocationSkuSettings } from "@/lib/admin/skus";
import { setVendorRhythmPair } from "@/lib/vendor-rhythm";
import { applyGuideEdit, createEmptyGuide, loadOrderGuide, ORDER_GUIDE_EDIT_MIN, saveOrderGuide } from "@/lib/order-guides";
import { saveRecipeLines } from "@/lib/admin/recipe-versions";
import { teachBarcode } from "@/lib/barcodes";
import { newThingScopeGate, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";
import type { NewItemRequest, SetupStep } from "@/lib/catalog/new-item-shared";

/** THE BIND (a BIND_PRIMITIVES name), before any I/O: a new thing starts at a shop the actor works in; every shop = MoO+. */
function requireLocation(actor: AuthContext, scope: VersionScope): void {
  const gate = newThingScopeGate({ level: actor.level, role: actor.role, locations: actor.locations }, scope);
  if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
}

export interface CreatedItem { skuId: string; ownerLocationId: string | null; packVersionId: string; priceId: string | null }

export async function createCatalogItem(actor: AuthContext, req: NewItemRequest): Promise<CreatedItem> {
  requireLocation(actor, req.scope);
  let levels: PackChainLevelInput[];
  try {
    const [measureLabels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
    // The SAME chain rules as every pack writer (2a's validateSubmission); 0259 re-checks the shape in SQL.
    levels = validateSubmission(req.levels, measureLabels, measures, req.avgOzPerEach, req.skuClass);
  } catch (e) {
    if (e instanceof PackChainError) throw new ShopOwnedError(e.status, e.code, e.message);
    throw e;
  }
  const firstOnly = actor.level < GLOBAL_VERSION_WRITE_MIN;
  const { data, error } = await getServiceRoleClient().rpc("create_catalog_sku", {
    p_sku: {
      vendor_id: req.vendorId, location_id: req.scope, name: req.name, item_number: req.itemNumber,
      avg_oz_per_each: req.avgOzPerEach, sku_class: req.skuClass,
    },
    p_levels: rpcLevels(levels), p_unit_price: req.unitPrice, p_price_date: req.priceDate,
    p_actor: actor.user.id, p_first_only: firstOnly,
  });
  if (error) {
    if (/shop_owned:/.test(error.message)) shopOwnedErrorFromRpc(error.message);
    versionErrorFromRpc(error.message); // 2a's own refusals (sku_pack_version:… / sku_price:…) keep their names
  }
  const r = data as { sku_id: string; location_id: string | null; pack: { version_id: string; mirror_synced?: boolean | null }; price: { price_id: string } | null };
  // Three rows, in the words each write already uses — the catalog's history reads the same as the legacy screens'.
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: r.sku_id,
    metadata: { name: req.name, vendor_id: req.vendorId, location_id: req.scope, item_number: req.itemNumber, job: "new_item" },
    ipAddress: null, userAgent: null,
  });
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "sku.pack_version_save", resourceTable: "sku_pack_versions", resourceId: r.pack.version_id,
    metadata: { sku_id: r.sku_id, location_id: null, scope: "global", first_only: firstOnly, labels: levels.map((l) => l.label.trim()), level_count: levels.length, job: "new_item" },
    ipAddress: null, userAgent: null,
  });
  if (r.price) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: r.price.price_id,
      metadata: { vendor_item_id: r.sku_id, unit_price: req.unitPrice, effective_date: req.priceDate, location_id: null, first_only: firstOnly, job: "new_item" },
      ipAddress: null, userAgent: null,
    });
  }
  return { skuId: r.sku_id, ownerLocationId: r.location_id, packVersionId: r.pack.version_id, priceId: r.price?.price_id ?? null };
}

export interface SetupResult { step: SetupStep["kind"]; detail: Record<string, unknown> }

/** ONE setup step at ONE shop, through the writer that owns it. The item must be shared or this shop's own. */
export async function setUpItemAtShop(actor: AuthContext, input: { skuId: string; shopId: string; step: SetupStep }): Promise<SetupResult> {
  requireLocation(actor, input.shopId);
  const sb = getServiceRoleClient();
  const { data: sku, error } = await sb.from("vendor_items").select("id, name, vendor_id, location_id, item_number, active").eq("id", input.skuId)
    .maybeSingle<{ id: string; name: string; vendor_id: string | null; location_id: string | null; item_number: string | null; active: boolean }>();
  if (error) throw new Error(`setUpItemAtShop sku: ${error.message}`);
  // Another shop's own item is not this shop's to set up (2a's owner rule) — the same answer as a missing one.
  if (!sku || !sku.active || ((sku.location_id ?? null) !== null && sku.location_id !== input.shopId)) throw new ShopOwnedError(404, "sku_not_found");
  const step = input.step;
  switch (step.kind) {
    case "par": {
      // The FIRST par at this shop: the baseline is "nothing set here" — a par someone already set refuses (overlay_changed).
      await upsertLocationSkuSettings(actor, {
        skuId: sku.id, locationId: input.shopId, activeOverride: null, weekdayPar: step.weekdayPar, weekendPar: step.weekendPar,
        expected: { activeOverride: null, weekdayPar: null, weekendPar: null },
      });
      return { step: "par", detail: { weekdayPar: step.weekdayPar, weekendPar: step.weekendPar } };
    }
    case "order_days": {
      if (!sku.vendor_id) throw new ShopOwnedError(400, "needs_vendor");
      const pairIds: string[] = [];
      // Up to seven writes, one per weekday, each its own audited rhythm pair (the vendor page's own writer).
      for (const d of step.days) {
        pairIds.push((await setVendorRhythmPair(actor, { vendorId: sku.vendor_id, locationId: input.shopId, orderDow: d.orderDow, leadDays: d.leadDays })).id);
      }
      return { step: "order_days", detail: { pairIds } };
    }
    case "guide_line": {
      if (actor.level < ORDER_GUIDE_EDIT_MIN) throw new ShopOwnedError(403, "forbidden");
      if (!sku.vendor_id) throw new ShopOwnedError(400, "needs_vendor");
      const guide = (await loadOrderGuide(sku.vendor_id)) ?? (await createEmptyGuide(actor, sku.vendor_id));
      let model = guide;
      let sectionId = step.sectionId;
      if (step.newSectionName !== null) {
        model = applyGuideEdit(model, { kind: "add_section", name: step.newSectionName });
        sectionId = model.sections[model.sections.length - 1]!.id;
      }
      model = applyGuideEdit(model, { kind: "add_line", sectionId: sectionId!, skuId: sku.id, label: sku.name, itemNumber: sku.item_number });
      // ONE guide save for the section and the line, compare-and-set on the guide the person saw (save_order_guide).
      const saved = await saveOrderGuide(actor, sku.vendor_id, model, guide.updatedAt);
      return { step: "guide_line", detail: { guideId: saved.guideId } };
    }
    case "use_in": {
      const { data: rec, error: rErr } = await sb.from("recipes").select("id, location_id, active").eq("id", step.recipeId)
        .maybeSingle<{ id: string; location_id: string | null; active: boolean | null }>();
      if (rErr) throw new Error(`setUpItemAtShop recipe: ${rErr.message}`);
      if (!rec || rec.active === false || ((rec.location_id ?? null) !== null && rec.location_id !== input.shopId)) throw new ShopOwnedError(404, "not_found");
      // A shop's OWN recipe is edited as itself (0264); a shared recipe gets this shop's version (3a).
      const scope = (rec.location_id ?? null) === input.shopId ? null : input.shopId;
      const r = await saveRecipeLines(actor, {
        recipeId: rec.id, scope, expectedVersionId: step.expectedVersionId, basedOnVersionId: step.basedOnVersionId,
        op: { kind: "add", line: { componentSkuId: sku.id, componentItemId: null, componentProductId: null, quantity: step.quantity, unit: step.unit, eachContainerLabel: null, portioned: false } },
      });
      return { step: "use_in", detail: { recipeId: rec.id, versionId: r.versionId } };
    }
    case "barcode": {
      if (!sku.vendor_id) throw new ShopOwnedError(400, "needs_vendor");
      const r = await teachBarcode(actor, { vendorId: sku.vendor_id, locationId: input.shopId, code: step.code, skuId: sku.id, level: step.level });
      return { step: "barcode", detail: { created: r.created } };
    }
  }
}
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/new-item.test.ts` → expected: PASS.

```bash
git add lib/catalog/new-item-shared.ts lib/catalog/new-item.ts tests/new-item.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a job 2 — New item: one atomic create (item, first pack, first price) and the shop setup steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 8: Job 4 — New sandwich: the live cost, the atomic create, the Toast link

**Files:**
- Create: `lib/catalog/new-sandwich-shared.ts`, `lib/catalog/new-sandwich.ts`, `tests/new-sandwich.test.ts`
- Modify: `lib/admin/toast-map.ts` (`loadToastLinkChoices`)

- [ ] **Step 1: Write the failing test `tests/new-sandwich.test.ts`**

```ts
/** Catalog Phase 4a — job 4: the draft, its live cost at the shop, the one create, the Toast suggestions and the link. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_MENU } from "./fixtures/shop-owned-fixture";

let current: ReturnType<typeof createFakeDb> | null = null;
let rpc: ReturnType<typeof vi.fn>;
const audits: string[] = [];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no database expected");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async (a: { action: string }) => { audits.push(a.action); } }));
vi.mock("@/lib/recipes", async (orig) => ({
  ...(await orig<typeof import("@/lib/recipes")>()),
  assertInputLineIsValid: async (_sb: unknown, line: { quantity: number }) => {
    const { RecipeError } = await orig<typeof import("@/lib/recipes")>();
    if (line.quantity > 999) throw new RecipeError(400, "invalid_quantity");
  },
}));
const manual = vi.fn(async () => ({ id: "map-1" }));
vi.mock("@/lib/admin/toast-map", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/toast-map")>()), manualMap: manual }));

import { parseSandwichDraft, rankToastSuggestions, withDraftSandwich, DRAFT_MENU_ITEM_ID, type SandwichDraft } from "@/lib/catalog/new-sandwich-shared";
import { createShopSandwich, linkSandwichToToast, previewSandwichCost } from "@/lib/catalog/new-sandwich";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";

const gm = { user: { id: "u-1", role: "gm", name: "T" }, role: "gm", level: 7, locations: [LOC] } as never;
const turkey5 = { componentSkuId: "s-turkey", componentItemId: null, componentProductId: null, quantity: 5, unit: "oz", eachContainerLabel: null, portioned: false };
const mayo1 = { ...turkey5, componentSkuId: "s-mayo", quantity: 1 };
const SHOP = "44444444-4444-4444-8444-444444444444"; // parse tests take real UUIDs; the fake database's shops are "loc-1" / "loc-2"
/** A draft as parseSandwichDraft would hand it over (built directly: the fixture's shop ids are not UUIDs). */
const draft = (over: Partial<SandwichDraft> = {}): SandwichDraft => ({ shopId: LOC, name: "Club", nameEs: null, section: "Subs", price: 12, lines: [turkey5, mayo1], ...over });

beforeEach(() => {
  current = createFakeDb(buildShopOwnedFixture());
  rpc = vi.fn(async () => ({ data: { menu_item_id: "m-new", recipe_id: "r-new", location_id: LOC }, error: null }));
  (current.client as unknown as { rpc: unknown }).rpc = rpc;
  audits.length = 0;
  manual.mockClear();
});
afterEach(() => { current = null; });

describe("parseSandwichDraft", () => {
  it("normalizes every line through the recipe-line rules; names a bad one by position", () => {
    expect(parseSandwichDraft({ shopId: SHOP, name: " Club ", nameEs: null, section: "Subs", price: 12, lines: [turkey5, mayo1] }, { requireLines: true }))
      .toEqual({ ok: true, draft: { shopId: SHOP, name: "Club", nameEs: null, section: "Subs", price: 12, lines: [turkey5, mayo1] } });
    expect(parseSandwichDraft({ shopId: SHOP, name: "Club", lines: [] }, { requireLines: true })).toMatchObject({ ok: false, code: "incomplete_recipe" });
    expect(parseSandwichDraft({ shopId: SHOP, name: "Club", lines: [turkey5, { ...turkey5, quantity: 0 }] }, { requireLines: true }))
      .toMatchObject({ ok: false, code: "invalid_quantity", position: 2 });
    expect(parseSandwichDraft({ shopId: SHOP, name: "Club", lines: [], price: 0 }, { requireLines: false })).toMatchObject({ ok: false, code: "invalid_price" });
    expect(parseSandwichDraft({ shopId: "loc-1", name: "Club", lines: [] }, { requireLines: false })).toMatchObject({ ok: false, field: "shopId" });
  });
});

describe("the live cost per sandwich", () => {
  it("is the shop's own graph with the draft in it — the SAME rollup as the costing board", async () => {
    const got = await previewSandwichCost(gm, draft());
    // Independently: the shop's graph, the turkey and mayo it already prices.
    const graph = await loadRecipeGraph({ locationId: LOC });
    const priced = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], LOC));
    const expected = 5 * priced.get("s-turkey")! + 1 * priced.get("s-mayo")!;
    expect(got.status).toBe("costed");
    expect(got.cost).toBeCloseTo(expected, 10);
    expect(got.foodCostPct).toBeCloseTo((expected / 12) * 100, 10);
  });
  it("the pure overlay never touches the real menu", async () => {
    const graph = await loadRecipeGraph({ locationId: LOC });
    const g2 = withDraftSandwich(graph, [turkey5]);
    expect(g2.byOutputMenuItem.has(DRAFT_MENU_ITEM_ID)).toBe(true);
    expect(graph.byOutputMenuItem.has(DRAFT_MENU_ITEM_ID)).toBe(false);
    expect(rollupMenuItemCost(g2, OWNED_MENU, new Map()).status).toBe(rollupMenuItemCost(graph, OWNED_MENU, new Map()).status);
  });
  it("another shop's GM is refused before any read", async () => {
    current = null;
    const other = { user: { id: "u-2", role: "gm", name: "T" }, role: "gm", level: 7, locations: [OTHER] } as never;
    await expect(previewSandwichCost(other, draft())).rejects.toMatchObject({ status: 404 });
  });
});

describe("createShopSandwich — ONE write: the menu item and its recipe, owned by the shop", () => {
  it("validates every line first (naming the refused one), then calls create_shop_sandwich once", async () => {
    await expect(createShopSandwich(gm, draft({ lines: [turkey5, { ...mayo1, quantity: 1000 }] })))
      .rejects.toMatchObject({ status: 400, code: "invalid_quantity", line: { position: 2, reason: "invalid_quantity" } });
    expect(rpc).not.toHaveBeenCalled();
    await expect(createShopSandwich(gm, draft())).resolves.toEqual({ menuItemId: "m-new", recipeId: "r-new" });
    expect(rpc).toHaveBeenCalledWith("create_shop_sandwich", expect.objectContaining({
      p_location: LOC, p_name: "Club", p_price: 12, p_yield: 1,
      p_inputs: [expect.objectContaining({ component_sku_id: "s-turkey", quantity: 5, unit: "oz", display_order: 0 }), expect.objectContaining({ component_sku_id: "s-mayo", display_order: 1 })],
    }));
    expect(audits).toEqual(["menu_item.create", "recipe.create"]);
  });
  it("a taken name keeps its name", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "shop_owned:name_taken" } });
    await expect(createShopSandwich(gm, draft())).rejects.toMatchObject({ status: 409, code: "name_taken" });
  });
});

describe("the Toast link", () => {
  it("suggestions are the matcher's, best first, never a Toast item already linked to something", () => {
    const items = [
      { itemGuid: "g1", name: "CLUB!", priceCents: 1200, groupName: "Subs" }, // normalizes to "club": an exact match
      { itemGuid: "g2", name: "Club", priceCents: 1200, groupName: "Subs" },
      { itemGuid: "g3", name: "Pickle Side", priceCents: 300, groupName: "Sides" },
    ];
    const s = rankToastSuggestions({ kind: "menu_item", id: "m-new", name: "Club", priceCents: 1200 }, items, new Set(["g2"]));
    expect(s.map((x) => x.guid)).toEqual(["g1"]);
  });
  it("a link is ONE confirmed mapping at the shop the sandwich is sold at", async () => {
    await linkSandwichToToast(gm, { menuItemId: OWNED_MENU, shopId: LOC, toastItemGuid: "g1", toastItemName: "Local Hero" });
    expect(manual).toHaveBeenCalledWith(gm, { locationId: LOC, toastItemGuid: "g1", toastItemName: "Local Hero", entityKind: "menu_item", entityId: OWNED_MENU, isModifier: false });
  });
});
```

Run: `npx vitest run tests/new-sandwich.test.ts` → expected: FAIL (modules missing).

- [ ] **Step 2: Create `lib/catalog/new-sandwich-shared.ts`**

```ts
/**
 * JOB 4 — NEW SANDWICH (catalog Phase 4a; spec §5 job 4). PURE: the draft a page sends, the draft as an overlay of the
 * shop's recipe graph (so the live cost is computed by THE costing rollup, never a second formula), the cost line, and
 * the ranking of Toast suggestions. No I/O; safe in client bundles.
 */
import type { RecipeGraph, GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MenuCostRollup } from "@/lib/menu-costing-shared";
import { normalizeRecipeLine, parseRecipeLinePatch, type RecipeLineFields } from "@/lib/recipe-line-shared";
import type { RecipeVersionLineRow } from "@/lib/recipe-versions-shared";
import { matchCandidates, type CoEntity, type ToastItem } from "@/lib/toast/matcher";

/** The draft's ids in a graph — never a real row's (a real id is a UUID). */
export const DRAFT_RECIPE_ID = "draft:new-sandwich";
export const DRAFT_MENU_ITEM_ID = "draft:new-sandwich-item";
export const SANDWICH_MAX_LINES = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SandwichDraft {
  /** The shop it starts at — a sandwich always starts at one shop (spec §3; MoO+ shares it later). */
  shopId: string;
  name: string;
  nameEs: string | null;
  section: string | null;
  /** The price for this shop (menu_items.menu_price of a shop-only sandwich). */
  price: number | null;
  /** What goes in ONE sandwich. */
  lines: RecipeLineFields[];
}

export type SandwichDraftParse =
  | { ok: true; draft: SandwichDraft }
  | { ok: false; code: string; field: string; position?: number };

export function parseSandwichDraft(raw: unknown, opts: { requireLines: boolean }): SandwichDraftParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload", field: "body" };
  const b = raw as Record<string, unknown>;
  if (typeof b.shopId !== "string" || !UUID.test(b.shopId)) return { ok: false, code: "invalid_payload", field: "shopId" };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 120) return { ok: false, code: "invalid_name", field: "name" };
  const es = b.nameEs === null || b.nameEs === undefined ? null : typeof b.nameEs === "string" ? (b.nameEs.trim() || null) : undefined;
  if (es === undefined || (es !== null && es.length > 120)) return { ok: false, code: "invalid_name", field: "nameEs" };
  const section = b.section === null || b.section === undefined ? null : typeof b.section === "string" ? (b.section.trim() || null) : undefined;
  if (section === undefined || (section !== null && section.length > 60)) return { ok: false, code: "invalid_payload", field: "section" };
  const p = b.price;
  const price = p === null || p === undefined ? null : typeof p === "number" && Number.isFinite(p) && p > 0 && p <= 1000 ? p : undefined;
  if (price === undefined) return { ok: false, code: "invalid_price", field: "price" };
  if (!Array.isArray(b.lines) || b.lines.length > SANDWICH_MAX_LINES) return { ok: false, code: "invalid_payload", field: "lines" };
  if (opts.requireLines && b.lines.length === 0) return { ok: false, code: "incomplete_recipe", field: "lines" };
  const lines: RecipeLineFields[] = [];
  for (const [i, l] of b.lines.entries()) {
    const parsed = parseRecipeLinePatch(l);
    if (!parsed.ok) return { ok: false, code: parsed.code, field: "lines", position: i + 1 };
    lines.push(normalizeRecipeLine(parsed.line));
  }
  return { ok: true, draft: { shopId: b.shopId, name, nameEs: es, section, price, lines } };
}

/** The draft's lines as a preview override (3a's recipeOverrides): the graph loads their SKUs' packs and products. */
export function draftOverrideRows(lines: readonly RecipeLineFields[]): RecipeVersionLineRow[] {
  return lines.map((l, i) => ({
    id: `draft-line-${i + 1}`, version_id: "draft", recipe_id: DRAFT_RECIPE_ID,
    component_sku_id: l.componentSkuId, component_item_id: l.componentItemId, component_product_id: l.componentProductId,
    quantity: l.quantity, unit: l.unit, each_container_label: l.eachContainerLabel, portioned: l.portioned, display_order: i,
  }));
}

/** The shop's graph WITH the draft sandwich in it (a new graph; the given one is untouched). One recipe makes one. */
export function withDraftSandwich(graph: RecipeGraph, lines: readonly RecipeLineFields[]): RecipeGraph {
  const recipe: GraphRecipe = {
    recipeId: DRAFT_RECIPE_ID,
    batchYield: 1,
    inputs: lines.map((l) => ({
      quantity: l.quantity, unit: l.unit, componentSkuId: l.componentSkuId, componentItemId: l.componentItemId, componentProductId: l.componentProductId,
    })),
    outputs: [{ outputItemId: null, outputMenuItemId: DRAFT_MENU_ITEM_ID, yield: 1, ozPerParUnit: null }],
  };
  const byOutputMenuItem = new Map(graph.byOutputMenuItem);
  byOutputMenuItem.set(DRAFT_MENU_ITEM_ID, recipe);
  return { ...graph, byOutputMenuItem };
}

export interface SandwichCost {
  status: MenuCostRollup["status"];
  /** The whole cost of one sandwich — only when every line is priced (the board's rule). */
  cost: number | null;
  /** What could be priced so far (a lower bound while a line is unpriced). */
  pricedCost: number;
  unpricedSkuIds: string[];
  foodCostPct: number | null;
  marginDollars: number | null;
}

export function sandwichCost(rollup: MenuCostRollup, price: number | null): SandwichCost {
  const cost = rollup.cost;
  return {
    status: rollup.status, cost, pricedCost: rollup.pricedCost, unpricedSkuIds: [...rollup.unpricedSkuIds],
    foodCostPct: cost !== null && price !== null && price > 0 ? (cost / price) * 100 : null,
    marginDollars: cost !== null && price !== null ? price - cost : null,
  };
}

/** The matcher's candidates for ONE entity, best first, never a Toast item another entity already holds. */
export function rankToastSuggestions(
  entity: CoEntity, items: readonly ToastItem[], taken: ReadonlySet<string>, max = 5,
): Array<{ guid: string; name: string; priceCents: number | null; score: number }> {
  return matchCandidates([entity], items.filter((t) => !taken.has(t.itemGuid)))
    .sort((a, b) => b.score - a.score || a.toast.name.localeCompare(b.toast.name))
    .slice(0, max)
    .map((c) => ({ guid: c.toast.itemGuid, name: c.toast.name, priceCents: c.toast.priceCents, score: c.score }));
}
```

- [ ] **Step 3: `loadToastLinkChoices` in `lib/admin/toast-map.ts`**

1. Add `import { rankToastSuggestions } from "@/lib/catalog/new-sandwich-shared";` and extend the matcher import to `import { matchCandidates, type CoEntity, type ToastItem } from "@/lib/toast/matcher";` (unchanged if already so).
2. Directly after `confirmMapping`'s closing `}`, insert:

```ts
export interface ToastLinkChoices {
  /** false = Toast could not be reached now; the page says so and offers the link later (never a silent empty list). */
  reachable: boolean;
  /** This entity's confirmed links at this shop (multi-guid law: a sandwich may hold several channel variants). */
  linked: Array<{ mapId: string; guid: string; name: string }>;
  /** The matcher's suggestions, best first, among Toast items nothing holds yet. */
  suggestions: Array<{ guid: string; name: string; priceCents: number | null; score: number }>;
  /** Every Toast item at this shop, for the searchable list; `taken` = another entity holds it. */
  all: Array<{ guid: string; name: string; priceCents: number | null; groupName: string | null; taken: boolean }>;
}

/**
 * What to offer when linking ONE entity at ONE shop (catalog Phase 4a — "Toast linking moves out of Catering", spec §5
 * job 4). The menu-item page and the New sandwich job read this; the write is manualMap (Tier A, its own tier).
 */
export async function loadToastLinkChoices(actor: AuthContext, locationId: string, entity: CoEntity): Promise<ToastLinkChoices> {
  requireLevel(actor, TOAST_MAP_MIN);
  assertLocationAccess(actor, locationId);
  const rows = await loadActiveRows(locationId);
  const mine = (r: DbMapRow) => (entity.kind === "menu_item" ? r.menu_item_id === entity.id : r.item_id === entity.id);
  const linked = rows.filter((r) => r.match_status === "confirmed" && mine(r))
    .map((r) => ({ mapId: r.id, guid: r.toast_item_guid, name: r.toast_item_name }));
  const taken = new Set(rows.filter((r) => r.match_status === "confirmed").map((r) => r.toast_item_guid));
  const guid = await requireLocationGuid(locationId);
  let items: ToastItem[];
  try {
    items = await fetchToastMenuItems(guid);
  } catch (e) {
    console.warn("[toast-map] link choices: Toast unreachable", e instanceof Error ? e.message : e);
    return { reachable: false, linked, suggestions: [], all: [] };
  }
  return {
    reachable: true,
    linked,
    suggestions: rankToastSuggestions(entity, items, taken),
    all: items.map((t) => ({ guid: t.itemGuid, name: t.name, priceCents: t.priceCents, groupName: t.groupName, taken: taken.has(t.itemGuid) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.guid.localeCompare(b.guid)),
  };
}
```

- [ ] **Step 4: Create `lib/catalog/new-sandwich.ts`**

```ts
/**
 * JOB 4 — NEW SANDWICH: the server half (catalog Phase 4a). SERVER-ONLY, service role.
 *
 * THE LIVE COST is the shop's own recipe graph with the draft added as a preview override (3a's recipeOverrides loads
 * the draft lines' packs and products at this shop) and THE costing rollup — the number the costing board will show.
 * THE CREATE IS ONE WRITE (create_shop_sandwich, 0264): the menu item and its recipe, owned by the shop, with the price
 * for this shop. A sandwich always starts at a shop (spec §3); MoO+ shares it (lib/catalog/share.ts).
 * THE TOAST LINK is one confirmed mapping (manualMap) at that shop.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { assertInputLineIsValid, RecipeError } from "@/lib/recipes";
import { loadToastLinkChoices, manualMap, type ToastLinkChoices } from "@/lib/admin/toast-map";
import { newThingScopeGate, ownerVisible, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";
import {
  DRAFT_MENU_ITEM_ID, DRAFT_RECIPE_ID, draftOverrideRows, sandwichCost, withDraftSandwich, type SandwichCost, type SandwichDraft,
} from "@/lib/catalog/new-sandwich-shared";

/** THE BIND (a BIND_PRIMITIVES name), before any I/O: a sandwich starts at a shop the actor works in. */
function requireLocation(actor: AuthContext, shopId: string): void {
  const gate = newThingScopeGate({ level: actor.level, role: actor.role, locations: actor.locations }, shopId);
  if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
}

export async function previewSandwichCost(actor: AuthContext, draft: SandwichDraft): Promise<SandwichCost> {
  requireLocation(actor, draft.shopId);
  const graph = await loadRecipeGraph({ locationId: draft.shopId, recipeOverrides: new Map([[DRAFT_RECIPE_ID, draftOverrideRows(draft.lines)]]) });
  const withDraft = withDraftSandwich(graph, draft.lines);
  const prices = await loadCurrentSkuPrices([...withDraft.skuPack.keys()], draft.shopId);
  return sandwichCost(rollupMenuItemCost(withDraft, DRAFT_MENU_ITEM_ID, costPerOzFromGraph(withDraft, prices)), draft.price);
}

export async function createShopSandwich(actor: AuthContext, draft: SandwichDraft): Promise<{ menuItemId: string; recipeId: string }> {
  requireLocation(actor, draft.shopId);
  if (draft.lines.length === 0) throw new ShopOwnedError(400, "incomplete_recipe");
  // Every line passes the SAME rules as any recipe line (Phase 1's validator); a refusal names WHICH line.
  const sb = getServiceRoleClient();
  for (const [i, line] of draft.lines.entries()) {
    try {
      await assertInputLineIsValid(sb, line);
    } catch (e) {
      if (e instanceof RecipeError) throw new ShopOwnedError(e.status, e.code, e.message, { position: i + 1, name: await componentName(sb, line), reason: e.code });
      throw e;
    }
  }
  const { data, error } = await sb.rpc("create_shop_sandwich", {
    p_location: draft.shopId, p_name: draft.name, p_name_es: draft.nameEs, p_section: draft.section, p_price: draft.price,
    p_inputs: draft.lines.map((l, idx) => ({
      component_sku_id: l.componentSkuId, component_item_id: l.componentItemId, component_product_id: l.componentProductId,
      quantity: l.quantity, unit: l.unit, each_container_label: l.eachContainerLabel, portioned: l.portioned, display_order: idx,
    })),
    p_yield: 1, p_actor: actor.user.id,
  });
  if (error) shopOwnedErrorFromRpc(error.message);
  const r = data as { menu_item_id: string; recipe_id: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "menu_item.create", resourceTable: "menu_items", resourceId: r.menu_item_id,
    metadata: { name: draft.name, location_id: draft.shopId, menu_price: draft.price, job: "new_sandwich" },
    ipAddress: null, userAgent: null,
  });
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.create", resourceTable: "recipes", resourceId: r.recipe_id,
    metadata: { name: draft.name, recipe_type: "consumer", location_id: draft.shopId, input_count: draft.lines.length, menu_item_id: r.menu_item_id, atomic: true, job: "new_sandwich" },
    ipAddress: null, userAgent: null,
  });
  return { menuItemId: r.menu_item_id, recipeId: r.recipe_id };
}

/** A refused line's display name: its item's, SKU's or product's name ("" when it has none). */
async function componentName(sb: ReturnType<typeof getServiceRoleClient>, l: SandwichDraft["lines"][number]): Promise<string> {
  const ref: ["vendor_items" | "items" | "products", string | null] = l.componentSkuId ? ["vendor_items", l.componentSkuId]
    : l.componentItemId ? ["items", l.componentItemId] : ["products", l.componentProductId];
  if (!ref[1]) return "";
  const { data } = await sb.from(ref[0]).select("name").eq("id", ref[1]).maybeSingle<{ name: string }>();
  return data?.name ?? "";
}

async function visibleMenuItem(menuItemId: string, shopId: string): Promise<{ id: string; name: string; menu_price: number | string | null }> {
  const { data, error } = await getServiceRoleClient().from("menu_items").select("id, name, menu_price, location_id, active").eq("id", menuItemId)
    .maybeSingle<{ id: string; name: string; menu_price: number | string | null; location_id: string | null; active: boolean }>();
  if (error) throw new Error(`sandwich menu item: ${error.message}`);
  // A sandwich another shop owns is not on this shop's menu: the same answer as a missing one.
  if (!data || !data.active || !ownerVisible(data.location_id ?? null, shopId)) throw new ShopOwnedError(404, "not_found");
  return data;
}

/** The Toast choices for one sandwich at one shop (the job's last step and the menu-item page's Toast section). */
export async function loadSandwichToastChoices(actor: AuthContext, menuItemId: string, shopId: string): Promise<ToastLinkChoices> {
  const m = await visibleMenuItem(menuItemId, shopId);
  return loadToastLinkChoices(actor, shopId, {
    kind: "menu_item", id: m.id, name: m.name, priceCents: m.menu_price == null ? null : Math.round(Number(m.menu_price) * 100),
  });
}

/** ONE confirmed mapping at the shop (manualMap supersedes a rival on that Toast item; the database refuses another shop's sandwich). */
export async function linkSandwichToToast(
  actor: AuthContext,
  input: { menuItemId: string; shopId: string; toastItemGuid: string; toastItemName: string },
): Promise<{ mapId: string }> {
  const r = await manualMap(actor, {
    locationId: input.shopId, toastItemGuid: input.toastItemGuid, toastItemName: input.toastItemName,
    entityKind: "menu_item", entityId: input.menuItemId, isModifier: false,
  });
  return { mapId: r.id };
}
```

- [ ] **Step 5: Run, then commit**

Run: `npx vitest run tests/new-sandwich.test.ts tests/toast-matcher.test.ts` → expected: PASS.

```bash
git add lib/catalog/new-sandwich-shared.ts lib/catalog/new-sandwich.ts lib/admin/toast-map.ts tests/new-sandwich.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a job 4 — New sandwich: live cost from the shop's graph, one atomic create, the Toast link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 9: Share with every shop — the preview and the two writers

**Files:**
- Create: `lib/catalog/share.ts`, `tests/share.test.ts`

- [ ] **Step 1: Write the failing test `tests/share.test.ts`**

```ts
/** Catalog Phase 4a — "Share with every shop" (spec §3: MoO+ promotes a shop's thing): what the preview says, what the write sends. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_MENU, OWNED_RECIPE } from "./fixtures/shop-owned-fixture";

let current: ReturnType<typeof createFakeDb> | null = null;
let rpc: ReturnType<typeof vi.fn>;
const audits: string[] = [];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no database expected");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async (a: { action: string }) => { audits.push(a.action); } }));

import { previewShareMenuItem, previewShareRecipe, previewShareSku, shareMenuItemWithAllShops, shareRecipeWithAllShops, shareSkuWithAllShops } from "@/lib/catalog/share";

const moo = { user: { id: "u-1", role: "moo", name: "T" }, role: "moo", level: 8, locations: [] } as never;
const gm = { user: { id: "u-2", role: "gm", name: "T" }, role: "gm", level: 7, locations: [LOC] } as never;

beforeEach(() => {
  const t = buildShopOwnedFixture();
  t.vendor_items!.push({ id: "s-local", name: "Local pickles", vendor_id: null, location_id: LOC, active: true });
  t.recipe_inputs!.push({ id: "ri-lh-3", recipe_id: OWNED_RECIPE, quantity: 1, unit: "oz", component_sku_id: "s-local", component_item_id: null, component_product_id: null });
  t.sku_pack_versions = [...(t.sku_pack_versions ?? []), { id: "pv-local", sku_id: "s-local", location_id: LOC, active: true, valid_from: "2026-10-01T00:00:00.000Z", valid_to: null }];
  current = createFakeDb(t);
  rpc = vi.fn(async (name: string) => ({ data: name === "share_shop_owned_menu_item"
    ? { menu_item_id: OWNED_MENU, from_location_id: LOC, recipe_ids: [OWNED_RECIPE], sku_ids: ["s-local"] }
    : { sku_id: "s-local", from_location_id: LOC }, error: null }));
  (current.client as unknown as { rpc: unknown }).rpc = rpc;
  audits.length = 0;
});
afterEach(() => { current = null; });

describe("sharing is MoO+", () => {
  it("a GM is told who can, before any read", async () => {
    current = null;
    await expect(previewShareMenuItem(gm, OWNED_MENU)).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    await expect(shareSkuWithAllShops(gm, { skuId: "s-local", expectedOwner: LOC })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
  });
});

describe("a sandwich", () => {
  it("the preview names the shop, the recipe, and the shop's own items that go with it", async () => {
    expect(await previewShareMenuItem(moo, OWNED_MENU)).toMatchObject({
      menuItemId: OWNED_MENU, name: "Local Hero", price: 11, ownerShopId: LOC, ownerShopName: "Shop one",
      recipes: [{ id: OWNED_RECIPE, name: "Local Hero" }], shopOnlySkus: [{ id: "s-local", name: "Local pickles" }], blockedBy: [],
    });
  });
  it("another shop's own item blocks it, by name", async () => {
    const t = buildShopOwnedFixture();
    t.vendor_items!.push({ id: "s-b", name: "B relish", vendor_id: null, location_id: OTHER, active: true });
    t.recipe_inputs!.push({ id: "ri-lh-4", recipe_id: OWNED_RECIPE, quantity: 1, unit: "oz", component_sku_id: "s-b", component_item_id: null, component_product_id: null });
    current = createFakeDb(t);
    expect((await previewShareMenuItem(moo, OWNED_MENU)).blockedBy).toEqual([{ id: "s-b", name: "B relish", shopName: "Shop two", kind: "sku" }]);
  });
  it("the write compare-and-sets the owner and the exact item set the person saw", async () => {
    await expect(shareMenuItemWithAllShops(moo, { menuItemId: OWNED_MENU, expectedOwner: LOC, shareSkuIds: ["s-local"] }))
      .resolves.toEqual({ recipeIds: [OWNED_RECIPE], skuIds: ["s-local"] });
    expect(rpc).toHaveBeenCalledWith("share_shop_owned_menu_item", { p_menu_item: OWNED_MENU, p_expected_owner: LOC, p_share_skus: ["s-local"], p_actor: "u-1" });
    expect(audits).toEqual(["menu_item.share"]);
  });
  it("a shared one has nothing to share; a moved owner keeps its name", async () => {
    await expect(previewShareMenuItem(moo, "m-italian")).rejects.toMatchObject({ status: 409, code: "already_shared" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "shop_owned:ownership_changed" } });
    await expect(shareMenuItemWithAllShops(moo, { menuItemId: OWNED_MENU, expectedOwner: OTHER, shareSkuIds: [] })).rejects.toMatchObject({ status: 409, code: "ownership_changed" });
  });
});

describe("a prep recipe (lead decision 1)", () => {
  it("the preview names the items it makes and the shop's SKUs it uses; the write sends exactly those", async () => {
    const t = buildShopOwnedFixture();
    t.vendor_items!.push({ id: "s-local", name: "Local pickles", vendor_id: null, location_id: LOC, active: true });
    t.items!.push({ id: "i-a-relish", name: "A relish", active: true, location_id: LOC });
    t.recipes!.push({ id: "r-a-relish", name: "A relish", active: true, batch_yield: 1, location_id: LOC });
    t.recipe_outputs!.push({ id: "ro-ar", recipe_id: "r-a-relish", output_item_id: "i-a-relish", output_menu_item_id: null, yield: 1 });
    t.recipe_inputs!.push({ id: "ri-ar", recipe_id: "r-a-relish", component_sku_id: "s-local", component_item_id: null, component_product_id: null, quantity: 1, unit: "oz" });
    current = createFakeDb(t);
    (current.client as unknown as { rpc: unknown }).rpc = rpc;
    expect(await previewShareRecipe(moo, "r-a-relish")).toMatchObject({
      ownerShopId: LOC, shopOnlyItems: [{ id: "i-a-relish" }], shopOnlySkus: [{ id: "s-local" }], makesSandwich: null, blockedBy: [],
    });
    rpc.mockResolvedValueOnce({ data: { recipe_id: "r-a-relish", from_location_id: LOC, item_ids: ["i-a-relish"], sku_ids: ["s-local"] }, error: null });
    await shareRecipeWithAllShops(moo, { recipeId: "r-a-relish", expectedOwner: LOC, shareItemIds: ["i-a-relish"], shareSkuIds: ["s-local"] });
    expect(rpc).toHaveBeenCalledWith("share_shop_owned_recipe", { p_recipe: "r-a-relish", p_expected_owner: LOC, p_share_items: ["i-a-relish"], p_share_skus: ["s-local"], p_actor: "u-1" });
    expect(audits).toContain("recipe.share");
  });
});

describe("an item", () => {
  it("the preview says the shop keeps its own pack; the write is one compare-and-set", async () => {
    expect(await previewShareSku(moo, "s-local")).toMatchObject({ skuId: "s-local", ownerShopId: LOC, ownerKeepsOwnPack: true, ownerKeepsOwnPrice: false,
      usedIn: [{ id: OWNED_RECIPE, name: "Local Hero" }] });
    await shareSkuWithAllShops(moo, { skuId: "s-local", expectedOwner: LOC });
    expect(rpc).toHaveBeenCalledWith("share_shop_owned_sku", { p_sku: "s-local", p_expected_owner: LOC, p_actor: "u-1" });
    expect(audits).toEqual(["vendor_item.share"]);
  });
});
```

Run: `npx vitest run tests/share.test.ts` → expected: FAIL (module missing).

- [ ] **Step 2: Create `lib/catalog/share.ts`**

```ts
/**
 * SHARE WITH EVERY SHOP (catalog Phase 4a, 0264; spec §3: "MoO+ can promote them to global"). SERVER-ONLY.
 *
 * The preview says what changes in plain words: every shop now sees this sandwich (at its price, with its recipe, as the
 * default), and the shop's own items its recipe uses go with it — another shop could not order them otherwise; another
 * shop's own item BLOCKS the share (sharing cannot decide for that shop). The write compare-and-sets the owner the
 * person saw and the exact item set (share_shop_owned_menu_item); an item shares alone (share_shop_owned_sku), its
 * owner keeping its own pack / price versions (2a) while every other shop rides the default.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { shareGate, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";

/** MoO+ — decided before any I/O. */
function requireShare(actor: AuthContext): void {
  const g = shareGate(actor.level);
  if (!g.ok) throw new ShopOwnedError(g.status, g.code);
}

type Sb = ReturnType<typeof getServiceRoleClient>;
const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

async function shopNames(sb: Sb): Promise<Map<string, string>> {
  const { data, error } = await sb.from("locations").select("id, name").returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`share shops: ${error.message}`);
  return new Map((data ?? []).map((l) => [l.id, l.name]));
}

export interface ShareMenuItemPreview {
  menuItemId: string;
  name: string;
  nameEs: string | null;
  /** Its price today — every shop's default once shared (a shop may still set its own, 3a). */
  price: number | null;
  ownerShopId: string;
  ownerShopName: string | null;
  recipes: Array<{ id: string; name: string }>;
  /** The shop's OWN items its recipe uses: shared with it, in the same act. */
  shopOnlySkus: Array<{ id: string; name: string }>;
  /** What blocks it: ANOTHER shop's own SKU (swap it out first), or one of the shop's own prep items it uses (share that
   *  item's recipe first — every shop that gets the sandwich must be able to make what goes in it). */
  blockedBy: Array<{ id: string; name: string; shopName: string | null; kind: "sku" | "item" }>;
}

export async function previewShareMenuItem(actor: AuthContext, menuItemId: string): Promise<ShareMenuItemPreview> {
  requireShare(actor);
  const sb = getServiceRoleClient();
  const { data: m, error } = await sb.from("menu_items").select("id, name, name_es, menu_price, location_id, active").eq("id", menuItemId)
    .maybeSingle<{ id: string; name: string; name_es: string | null; menu_price: number | string | null; location_id: string | null; active: boolean }>();
  if (error) throw new Error(`share menu item: ${error.message}`);
  if (!m || !m.active) throw new ShopOwnedError(404, "not_found");
  if (!m.location_id) throw new ShopOwnedError(409, "already_shared");
  const { data: outs, error: oErr } = await sb.from("recipe_outputs").select("recipe_id").eq("output_menu_item_id", menuItemId)
    .returns<Array<{ recipe_id: string }>>();
  if (oErr) throw new Error(`share menu item outputs: ${oErr.message}`);
  const recipeIds = [...new Set((outs ?? []).map((o) => o.recipe_id))];
  const [recipesRes, inputsRes, names] = await Promise.all([
    recipeIds.length
      ? sb.from("recipes").select("id, name").in("id", recipeIds).order("name").returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    recipeIds.length
      ? sb.from("recipe_inputs").select("component_sku_id, component_item_id").in("recipe_id", recipeIds)
          .returns<Array<{ component_sku_id: string | null; component_item_id: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ component_sku_id: string | null; component_item_id: string | null }>, error: null }),
    shopNames(sb),
  ]);
  if (recipesRes.error) throw new Error(`share menu item recipes: ${recipesRes.error.message}`);
  if (inputsRes.error) throw new Error(`share menu item lines: ${inputsRes.error.message}`);
  const skuIds = [...new Set((inputsRes.data ?? []).map((i) => i.component_sku_id).filter((v): v is string => v !== null))];
  const lineItemIds = [...new Set((inputsRes.data ?? []).map((i) => i.component_item_id).filter((v): v is string => v !== null))];
  const { data: shopItems, error: iErr } = lineItemIds.length
    ? await sb.from("items").select("id, name, location_id").in("id", lineItemIds).not("location_id", "is", null).order("name")
        .returns<Array<{ id: string; name: string; location_id: string }>>()
    : { data: [] as Array<{ id: string; name: string; location_id: string }>, error: null };
  if (iErr) throw new Error(`share menu item prep items: ${iErr.message}`);
  const { data: owned, error: sErr } = skuIds.length
    ? await sb.from("vendor_items").select("id, name, location_id").in("id", skuIds).not("location_id", "is", null).order("name")
        .returns<Array<{ id: string; name: string; location_id: string }>>()
    : { data: [] as Array<{ id: string; name: string; location_id: string }>, error: null };
  if (sErr) throw new Error(`share menu item items: ${sErr.message}`);
  return {
    menuItemId: m.id, name: m.name, nameEs: m.name_es, price: num(m.menu_price),
    ownerShopId: m.location_id, ownerShopName: names.get(m.location_id) ?? null,
    recipes: recipesRes.data ?? [],
    shopOnlySkus: (owned ?? []).filter((s) => s.location_id === m.location_id).map((s) => ({ id: s.id, name: s.name })),
    blockedBy: [
      ...(owned ?? []).filter((s) => s.location_id !== m.location_id).map((s) => ({ id: s.id, name: s.name, shopName: names.get(s.location_id) ?? null, kind: "sku" as const })),
      ...(shopItems ?? []).map((i) => ({ id: i.id, name: i.name, shopName: names.get(i.location_id) ?? null, kind: "item" as const })),
    ],
  };
}

export async function shareMenuItemWithAllShops(
  actor: AuthContext,
  input: { menuItemId: string; expectedOwner: string; shareSkuIds: string[] },
): Promise<{ recipeIds: string[]; skuIds: string[] }> {
  requireShare(actor);
  const { data, error } = await getServiceRoleClient().rpc("share_shop_owned_menu_item", {
    p_menu_item: input.menuItemId, p_expected_owner: input.expectedOwner, p_share_skus: input.shareSkuIds, p_actor: actor.user.id,
  });
  if (error) shopOwnedErrorFromRpc(error.message);
  const r = data as { from_location_id: string; recipe_ids: string[] | null; sku_ids: string[] | null };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "menu_item.share", resourceTable: "menu_items", resourceId: input.menuItemId,
    metadata: { from_location_id: r.from_location_id, recipe_ids: r.recipe_ids ?? [], sku_ids: r.sku_ids ?? [] },
    ipAddress: null, userAgent: null,
  });
  return { recipeIds: r.recipe_ids ?? [], skuIds: r.sku_ids ?? [] };
}

export interface ShareRecipePreview {
  recipeId: string;
  name: string;
  ownerShopId: string;
  ownerShopName: string | null;
  /** The shop's own items it makes: shared with it, in the same act. */
  shopOnlyItems: Array<{ id: string; name: string }>;
  /** The shop's own SKUs it uses: shared with it, in the same act. */
  shopOnlySkus: Array<{ id: string; name: string }>;
  /** It makes a sandwich: share the sandwich (it carries this recipe). */
  makesSandwich: { id: string; name: string } | null;
  /** What blocks it: another shop's own SKU, or one of the shop's own items it uses (share that item's recipe first). */
  blockedBy: Array<{ id: string; name: string; shopName: string | null; kind: "sku" | "item" }>;
}

/** Share a shop's own PREP recipe (lead decision 1): the preview. */
export async function previewShareRecipe(actor: AuthContext, recipeId: string): Promise<ShareRecipePreview> {
  requireShare(actor);
  const sb = getServiceRoleClient();
  const { data: r, error } = await sb.from("recipes").select("id, name, location_id, active").eq("id", recipeId)
    .maybeSingle<{ id: string; name: string; location_id: string | null; active: boolean | null }>();
  if (error) throw new Error(`share recipe: ${error.message}`);
  if (!r || r.active === false) throw new ShopOwnedError(404, "not_found");
  if (!r.location_id) throw new ShopOwnedError(409, "already_shared");
  const owner = r.location_id;
  const [outs, ins, names] = await Promise.all([
    sb.from("recipe_outputs").select("output_item_id, output_menu_item_id").eq("recipe_id", recipeId)
      .returns<Array<{ output_item_id: string | null; output_menu_item_id: string | null }>>(),
    sb.from("recipe_inputs").select("component_sku_id, component_item_id").eq("recipe_id", recipeId)
      .returns<Array<{ component_sku_id: string | null; component_item_id: string | null }>>(),
    shopNames(sb),
  ]);
  if (outs.error) throw new Error(`share recipe outputs: ${outs.error.message}`);
  if (ins.error) throw new Error(`share recipe lines: ${ins.error.message}`);
  const ids = (xs: Array<string | null>) => [...new Set(xs.filter((v): v is string => v !== null))];
  const outItemIds = ids((outs.data ?? []).map((o) => o.output_item_id));
  const menuIds = ids((outs.data ?? []).map((o) => o.output_menu_item_id));
  const lineSkuIds = ids((ins.data ?? []).map((i) => i.component_sku_id));
  const lineItemIds = ids((ins.data ?? []).map((i) => i.component_item_id));
  type Named = { id: string; name: string; location_id: string | null };
  const read = (table: "items" | "menu_items" | "vendor_items", list: string[]) => list.length
    ? sb.from(table).select("id, name, location_id").in("id", list).order("name").returns<Named[]>()
    : Promise.resolve({ data: [] as Named[], error: null });
  const [made, menus, skus, usedItems] = await Promise.all([read("items", outItemIds), read("menu_items", menuIds), read("vendor_items", lineSkuIds), read("items", lineItemIds)]);
  for (const [label, x] of [["items", made], ["menu", menus], ["skus", skus], ["used items", usedItems]] as const) {
    if (x.error) throw new Error(`share recipe ${label}: ${x.error.message}`);
  }
  const sandwich = (menus.data ?? [])[0];
  return {
    recipeId: r.id, name: r.name, ownerShopId: owner, ownerShopName: names.get(owner) ?? null,
    shopOnlyItems: (made.data ?? []).filter((i) => i.location_id === owner).map((i) => ({ id: i.id, name: i.name })),
    shopOnlySkus: (skus.data ?? []).filter((s) => s.location_id === owner).map((s) => ({ id: s.id, name: s.name })),
    makesSandwich: sandwich ? { id: sandwich.id, name: sandwich.name } : null,
    blockedBy: [
      ...(skus.data ?? []).filter((s) => s.location_id !== null && s.location_id !== owner)
        .map((s) => ({ id: s.id, name: s.name, shopName: names.get(s.location_id!) ?? null, kind: "sku" as const })),
      ...(usedItems.data ?? []).filter((i) => i.location_id !== null)
        .map((i) => ({ id: i.id, name: i.name, shopName: names.get(i.location_id!) ?? null, kind: "item" as const })),
    ],
  };
}

export async function shareRecipeWithAllShops(
  actor: AuthContext,
  input: { recipeId: string; expectedOwner: string; shareItemIds: string[]; shareSkuIds: string[] },
): Promise<{ itemIds: string[]; skuIds: string[] }> {
  requireShare(actor);
  const { data, error } = await getServiceRoleClient().rpc("share_shop_owned_recipe", {
    p_recipe: input.recipeId, p_expected_owner: input.expectedOwner, p_share_items: input.shareItemIds,
    p_share_skus: input.shareSkuIds, p_actor: actor.user.id,
  });
  if (error) shopOwnedErrorFromRpc(error.message);
  const r = data as { from_location_id: string; item_ids: string[] | null; sku_ids: string[] | null };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.share", resourceTable: "recipes", resourceId: input.recipeId,
    metadata: { from_location_id: r.from_location_id, item_ids: r.item_ids ?? [], sku_ids: r.sku_ids ?? [] },
    ipAddress: null, userAgent: null,
  });
  return { itemIds: r.item_ids ?? [], skuIds: r.sku_ids ?? [] };
}

export interface ShareSkuPreview {
  skuId: string;
  name: string;
  ownerShopId: string;
  ownerShopName: string | null;
  /** Recipes (any shop's, the owner's own included) that use it today. */
  usedIn: Array<{ id: string; name: string }>;
  /** The owner keeps its own pack / price versions (2a); every other shop rides the default. */
  ownerKeepsOwnPack: boolean;
  ownerKeepsOwnPrice: boolean;
}

export async function previewShareSku(actor: AuthContext, skuId: string): Promise<ShareSkuPreview> {
  requireShare(actor);
  const sb = getServiceRoleClient();
  const { data: s, error } = await sb.from("vendor_items").select("id, name, location_id, active").eq("id", skuId)
    .maybeSingle<{ id: string; name: string; location_id: string | null; active: boolean }>();
  if (error) throw new Error(`share item: ${error.message}`);
  if (!s || !s.active) throw new ShopOwnedError(404, "not_found");
  if (!s.location_id) throw new ShopOwnedError(409, "already_shared");
  const owner = s.location_id;
  const [usesRes, packRes, laneRes, names] = await Promise.all([
    sb.from("recipe_inputs").select("recipe_id").eq("component_sku_id", skuId).returns<Array<{ recipe_id: string }>>(),
    sb.from("sku_pack_versions").select("id").eq("sku_id", skuId).eq("location_id", owner).eq("active", true).returns<Array<{ id: string }>>(),
    sb.from("sku_price_lanes").select("id").eq("sku_id", skuId).eq("location_id", owner).eq("active", true).returns<Array<{ id: string }>>(),
    shopNames(sb),
  ]);
  for (const [label, r] of [["uses", usesRes], ["packs", packRes], ["prices", laneRes]] as const) {
    if (r.error) throw new Error(`share item ${label}: ${r.error.message}`);
  }
  const recipeIds = [...new Set((usesRes.data ?? []).map((u) => u.recipe_id))];
  const { data: recipes, error: rErr } = recipeIds.length
    ? await sb.from("recipes").select("id, name").in("id", recipeIds).eq("active", true).order("name").returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (rErr) throw new Error(`share item recipes: ${rErr.message}`);
  return {
    skuId: s.id, name: s.name, ownerShopId: owner, ownerShopName: names.get(owner) ?? null, usedIn: recipes ?? [],
    ownerKeepsOwnPack: (packRes.data ?? []).length > 0, ownerKeepsOwnPrice: (laneRes.data ?? []).length > 0,
  };
}

export async function shareSkuWithAllShops(actor: AuthContext, input: { skuId: string; expectedOwner: string }): Promise<void> {
  requireShare(actor);
  const { data, error } = await getServiceRoleClient().rpc("share_shop_owned_sku", {
    p_sku: input.skuId, p_expected_owner: input.expectedOwner, p_actor: actor.user.id,
  });
  if (error) shopOwnedErrorFromRpc(error.message);
  const r = data as { from_location_id: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_item.share", resourceTable: "vendor_items", resourceId: input.skuId,
    metadata: { from_location_id: r.from_location_id },
    ipAddress: null, userAgent: null,
  });
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/share.test.ts` → expected: PASS.

```bash
git add lib/catalog/share.ts tests/share.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a — Share with every shop: a sandwich (with its shop-only items) or an item, MoO+, compare-and-set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 10: Job 3 — Swap vendor: the line rewrite, the preview, start, Back to normal

**Files:**
- Create: `lib/catalog/swap-shared.ts`, `lib/catalog/swap-vendor.ts`, `tests/swap-shared.test.ts`, `tests/swap-vendor.test.ts`
- Modify: `lib/products.ts`, `lib/prep-consumption.ts` (the preview's proposed primary through the one resolver — Step 3b)

- [ ] **Step 1: Write the failing pure test `tests/swap-shared.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseSwapRequest, roundQty, swapLine } from "@/lib/catalog/swap-shared";

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const SHOP = "33333333-3333-4333-8333-333333333333";
const line = (quantity: number, unit: string | null) =>
  ({ componentSkuId: OLD, componentItemId: null, componentProductId: null, quantity, unit, eachContainerLabel: unit === "each" ? "slice" : null, portioned: false });
const ctx = (oldOz: Record<string, number>, newOz: Record<string, number>) => ({
  isMeasure: (u: string) => ["oz", "lb", "each"].includes(u),
  oldOz: (u: string) => oldOz[u] ?? null,
  newOz: (u: string) => newOz[u] ?? null,
});

describe("swapLine — the same food, from the new item", () => {
  it("a measure carries over as written (weight is weight; a count is a portion — 2 slices stay 2 slices)", () => {
    expect(swapLine(line(5, "oz"), NEW, ctx({}, {}))).toEqual({ ok: true, line: { ...line(5, "oz"), componentSkuId: NEW }, converted: false });
    expect(swapLine(line(2, "each"), NEW, ctx({}, {}))).toEqual({ ok: true, line: { ...line(2, "each"), componentSkuId: NEW }, converted: false });
  });
  it("a pack label both items hold with the same contents carries over", () => {
    expect(swapLine(line(1, "jar"), NEW, ctx({ jar: 32 }, { jar: 32 }))).toMatchObject({ ok: true, converted: false, line: { unit: "jar", quantity: 1 } });
  });
  it("any other pack label becomes ounces of the old item's pack — never '1 jar' of a different jar", () => {
    expect(swapLine(line(1, "jar"), NEW, ctx({ jar: 32 }, { jar: 24 }))).toMatchObject({ ok: true, converted: true, line: { componentSkuId: NEW, unit: "oz", quantity: 32, eachContainerLabel: null } });
    expect(swapLine(line(0.0125, "case"), NEW, ctx({ case: 320 }, {}))).toMatchObject({ ok: true, converted: true, line: { unit: "oz", quantity: 4 } });
  });
  it("a label the old item cannot weigh is refused — the swap waits for it", () => {
    expect(swapLine(line(1, "tub"), NEW, ctx({}, { tub: 10 }))).toEqual({ ok: false, reason: "unit_unknown" });
    expect(swapLine(line(1, null), NEW, ctx({}, {}))).toEqual({ ok: false, reason: "unit_unknown" });
  });
  it("rounds to a millionth", () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
  });
});

describe("parseSwapRequest", () => {
  it("Just for now names a shop; the two items differ; the rest is optional and bounded", () => {
    expect(parseSwapRequest({ newSkuId: NEW, scope: SHOP, mode: "for_now" }, OLD))
      .toEqual({ ok: true, request: { oldSkuId: OLD, newSkuId: NEW, scope: SHOP, mode: "for_now", productName: null, productNameEs: null, note: null } });
    expect(parseSwapRequest({ newSkuId: NEW, scope: null, mode: "for_now" }, OLD)).toEqual({ ok: false, field: "scope" });
    expect(parseSwapRequest({ newSkuId: OLD, scope: SHOP, mode: "for_good" }, OLD)).toEqual({ ok: false, field: "newSkuId" });
    expect(parseSwapRequest({ newSkuId: NEW, scope: SHOP, mode: "sometimes" }, OLD)).toEqual({ ok: false, field: "mode" });
    expect(parseSwapRequest({ newSkuId: NEW, scope: null, mode: "for_good", productName: "x".repeat(121) }, OLD)).toEqual({ ok: false, field: "productName" });
  });
});
```

- [ ] **Step 2: Create `lib/catalog/swap-shared.ts`**

```ts
/**
 * JOB 3 — SWAP VENDOR (catalog Phase 4a; spec §5 job 3). PURE: the request a page sends, and how ONE recipe line that
 * named the old item names the new one. No I/O; safe in client bundles.
 */
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

export type SwapMode = "for_now" | "for_good";
export const SWAP_MODES: readonly SwapMode[] = ["for_now", "for_good"];

export interface SwapRequest {
  oldSkuId: string;
  newSkuId: string;
  /** A shop; or null = every shop's default — "For good" only, MoO+. */
  scope: string | null;
  mode: SwapMode;
  /** The new product's name when neither item has a product yet (default: the old item's name). */
  productName: string | null;
  productNameEs: string | null;
  note: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textOrNull = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t.length <= max ? t : undefined;
};

export function parseSwapRequest(raw: unknown, oldSkuId: string): { ok: true; request: SwapRequest } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, field: "body" };
  const b = raw as Record<string, unknown>;
  if (typeof b.newSkuId !== "string" || !UUID.test(b.newSkuId) || b.newSkuId === oldSkuId) return { ok: false, field: "newSkuId" };
  const scope = b.scope === null || b.scope === undefined ? null : typeof b.scope === "string" && UUID.test(b.scope) ? b.scope : undefined;
  if (scope === undefined) return { ok: false, field: "scope" };
  if (!SWAP_MODES.includes(b.mode as SwapMode)) return { ok: false, field: "mode" };
  const mode = b.mode as SwapMode;
  if (mode === "for_now" && scope === null) return { ok: false, field: "scope" };
  const productName = textOrNull(b.productName, 120);
  if (productName === undefined) return { ok: false, field: "productName" };
  const productNameEs = textOrNull(b.productNameEs, 120);
  if (productNameEs === undefined) return { ok: false, field: "productNameEs" };
  const note = textOrNull(b.note, 200);
  if (note === undefined) return { ok: false, field: "note" };
  return { ok: true, request: { oldSkuId, newSkuId: b.newSkuId, scope, mode, productName, productNameEs, note } };
}

export type SwapLineResult = { ok: true; line: RecipeLineFields; converted: boolean } | { ok: false; reason: "unit_unknown" };

/** What ONE `unit` of each item weighs at the scope (the shop's resolved packs), and which units are measures. */
export interface SwapUnitContext {
  isMeasure(unit: string): boolean;
  oldOz(unit: string): number | null;
  newOz(unit: string): number | null;
}

export function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * ONE LINE, OLD ITEM → NEW ITEM, the same food:
 *   · a MEASURE unit carries over as written — weight is weight, and a count is a PORTION (2 slices stay 2 slices from
 *     the new vendor; a different slice weight is the point of the swap, not an error);
 *   · a PACK label both items hold with the same contents ("1 jar" = 32 oz in both) carries over;
 *   · any other pack label becomes OUNCES of what the old pack held — "1 jar" of a 32 oz jar is 32 oz of the new item,
 *     never "1 jar" of a jar of another size;
 *   · a label the OLD item cannot weigh cannot be carried: refused, and named (the swap waits for it to be fixed).
 */
export function swapLine(line: RecipeLineFields, newSkuId: string, ctx: SwapUnitContext): SwapLineResult {
  const unit = line.unit?.trim() ?? "";
  if (unit === "") return { ok: false, reason: "unit_unknown" };
  const same: RecipeLineFields = { ...line, componentSkuId: newSkuId };
  if (ctx.isMeasure(unit)) return { ok: true, line: same, converted: false };
  const oldOz = ctx.oldOz(unit);
  if (oldOz === null || !(oldOz > 0)) return { ok: false, reason: "unit_unknown" };
  const newOz = ctx.newOz(unit);
  if (newOz !== null && Math.abs(newOz - oldOz) <= 1e-9 * Math.max(1, oldOz)) return { ok: true, line: same, converted: false };
  return { ok: true, line: { ...same, quantity: roundQty(line.quantity * oldOz), unit: "oz", eachContainerLabel: null }, converted: true };
}
```

Run: `npx vitest run tests/swap-shared.test.ts` → expected: PASS.

- [ ] **Step 3: Write the failing test `tests/swap-vendor.test.ts`**

```ts
/** Catalog Phase 4a — job 3 on the server: the preview (bound by a token), start, Back to normal. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_RECIPE } from "./fixtures/shop-owned-fixture";

let current: ReturnType<typeof createFakeDb> | null = null;
let rpc: ReturnType<typeof vi.fn>;
const audits: string[] = [];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no database expected");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async (a: { action: string }) => { audits.push(a.action); } }));

import { endSkuSwap, previewBackToNormal, previewSkuSwap, startSkuSwap } from "@/lib/catalog/swap-vendor";
import { roundQty, type SwapRequest } from "@/lib/catalog/swap-shared";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";

const gm = { user: { id: "u-1", role: "gm", name: "T" }, role: "gm", level: 7, locations: [LOC] } as never;
const req = (over: Partial<SwapRequest> = {}): SwapRequest =>
  ({ oldSkuId: "s-pickle", newSkuId: "s-pickle-2", scope: LOC, mode: "for_now", productName: null, productNameEs: null, note: null, ...over });

beforeEach(() => {
  const t = buildShopOwnedFixture();
  const sku = (id: string) => t.vendor_items!.find((s) => s.id === id)!;
  // The replacement pickles: a 24 oz jar from another vendor; the replacement turkey: a flat 300 oz case.
  t.vendor_items!.push({ ...sku("s-pickle"), id: "s-pickle-2", name: "Pickles (new vendor)", each_size: 24, product_id: null, location_id: null });
  t.vendor_items!.push({ ...sku("s-turkey"), id: "s-turkey-2", name: "Turkey (new vendor)", pack_format: "case", units_per_pack: 1, each_size: 300, each_measure: "oz", product_id: null, location_id: null });
  const price = t.vendor_price_history!.find((p) => p.vendor_item_id === "s-pickle")!;
  t.vendor_price_history!.push({ ...price, id: "ph-p2", vendor_item_id: "s-pickle-2", unit_price: 6 });
  current = createFakeDb(t);
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "recipe_change_snapshot") return { data: { closure: [args.p_recipe, args.p_location] }, error: null };
    if (name === "start_sku_swap") return { data: { swap_id: "sw-1", product_id: "p-new", product_created: true, primary_row_id: "pp-1", previous_primary_sku_id: null,
      versions: [{ recipe_id: "r-pickle", location: LOC, version_id: "rv-new", replaced_version_id: null }] }, error: null };
    if (name === "end_sku_swap") return { data: { swap_id: "sw-1", back: ["r-pickle"], kept: [], primary: "restored", grouping: "undone" }, error: null };
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  });
  (current.client as unknown as { rpc: unknown }).rpc = rpc;
  audits.length = 0;
});
afterEach(() => { current = null; });

describe("previewSkuSwap", () => {
  it("Shop one's pickle side gets ITS version: '1 jar' of the 32 oz jar becomes 32 oz of the new pickles", async () => {
    const p = await previewSkuSwap(gm, req());
    expect(p.product).toEqual({ kind: "create", name: expect.any(String), nameEs: null });
    expect(p.recipes).toHaveLength(1);
    expect(p.recipes[0]).toMatchObject({
      recipeId: "r-pickle", writeScope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-pickle-base",
      changes: [{ position: 1, converted: true, after: { componentSkuId: "s-pickle-2", quantity: 32, unit: "oz" } }],
    });
    expect(p.refused).toEqual([]);
    const side = p.costs.find((c) => c.menuItemId === "m-pickle-side")!;
    expect(side.before).not.toBeNull();
    expect(side.after).not.toBeNull();
    expect(side.after).not.toBe(side.before);
  });
  it("the same state gives the same token", async () => {
    expect((await previewSkuSwap(gm, req())).token).toBe((await previewSkuSwap(gm, req())).token);
  });
  it("hands back the EXACT request it hashed — the first confirmation never goes stale (Astra 4a r1#7, 4b r1#5)", async () => {
    const p = await previewSkuSwap(gm, req());
    expect(p.request.productName).toBe(p.product.kind === "create" ? p.product.name : null);
    await expect(startSkuSwap(gm, p.request, p.token)).resolves.toMatchObject({ swapId: "sw-1" });
    // an unnamed request normalizes to the same one
    await expect(startSkuSwap(gm, req(), p.token)).resolves.toMatchObject({ swapId: "sw-1" });
  });
  it("a recipe the shop OWNS is switched as itself; a pack label becomes ounces of the shop's own pack", async () => {
    const p = await previewSkuSwap(gm, req({ oldSkuId: "s-turkey", newSkuId: "s-turkey-2" }));
    const own = p.recipes.find((r) => r.recipeId === OWNED_RECIPE)!;
    expect(own).toMatchObject({ writeScope: null, changes: [{ converted: false, after: { componentSkuId: "s-turkey-2", quantity: 5, unit: "oz" } }] });
    const g = await loadRecipeGraph({ locationId: LOC });
    const caseOz = ozForRecipeInput(1, "case", g.skuPack.get("s-turkey")!, g.measures)!;
    expect(p.recipes.find((r) => r.recipeId === "r-italian")!.changes[0]).toMatchObject({ converted: true, after: { unit: "oz", quantity: roundQty(0.0125 * caseOz) } });
  });
  it("another shop, and the default below MoO, are refused before any read", async () => {
    current = null;
    await expect(previewSkuSwap(gm, req({ scope: OTHER }))).rejects.toMatchObject({ status: 404 });
    await expect(previewSkuSwap(gm, req({ scope: null, mode: "for_good" }))).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
  });
});

describe("startSkuSwap", () => {
  it("sends exactly what the preview showed, bound by its token — and writes no par (lead decision 3)", async () => {
    const p = await previewSkuSwap(gm, req());
    const r = await startSkuSwap(gm, req(), p.token);
    expect(r).toMatchObject({ swapId: "sw-1", versions: [{ recipeId: "r-pickle", versionId: "rv-new" }] });
    expect(rpc).toHaveBeenCalledWith("start_sku_swap", expect.objectContaining({
      p_location: LOC, p_old: "s-pickle", p_new: "s-pickle-2", p_mode: "for_now", p_product: { create: { name: p.product.name, name_es: null } },
      p_recipes: [expect.objectContaining({ recipe_id: "r-pickle", location: LOC, expected: null, based_on: "rv-r-pickle-base", snapshot: p.recipes[0]!.snapshot,
        lines: [expect.objectContaining({ component_sku_id: "s-pickle-2", quantity: 32, unit: "oz" })] })],
      p_bound: [], // nothing pins a pickle product
    }));
    expect(audits).toEqual(expect.arrayContaining(["sku.swap_start", "recipe_version.save", "product.primary_set"]));
    expect(r).not.toHaveProperty("parCopy");
    expect(current!.writes.filter((w) => w.table === "location_sku_settings")).toEqual([]);
  });
  it("a stale token refuses before the database", async () => {
    await expect(startSkuSwap(gm, req(), "stale")).rejects.toMatchObject({ status: 409, code: "preview_stale" });
    expect(rpc).not.toHaveBeenCalledWith("start_sku_swap", expect.anything());
  });
});

describe("a product-only swap — the primary it sets is previewed and bound (Astra 4a r1#2, 4b r1#4)", () => {
  it("costs every pinned sandwich exactly as the COMMITTED state will, and sends the recipes that follow it as p_bound", async () => {
    const t = buildShopOwnedFixture();
    // Two ham members priced apart, so moving the primary moves the Italian's cost.
    const tmpl = t.vendor_price_history!.find((p) => p.vendor_item_id === "s-ham-a") ?? t.vendor_price_history![0]!;
    t.vendor_price_history = t.vendor_price_history!.filter((p) => p.vendor_item_id !== "s-ham-a" && p.vendor_item_id !== "s-ham-b");
    t.vendor_price_history.push({ ...tmpl, id: "ph-ha", vendor_item_id: "s-ham-a", unit_price: 5 }, { ...tmpl, id: "ph-hb", vendor_item_id: "s-ham-b", unit_price: 15 });
    current = createFakeDb(t);
    (current.client as unknown as { rpc: unknown }).rpc = rpc;
    const p = await previewSkuSwap(gm, req({ oldSkuId: "s-ham-a", newSkuId: "s-ham-b" }));
    expect(p.product).toMatchObject({ kind: "existing", id: "p-ham" });
    expect(p.recipes).toEqual([]);
    expect(p.bound.map((b) => b.recipeId)).toContain("r-italian");
    expect(p.followsPrimary.map((f) => f.id)).toContain("r-italian");
    // THE ORACLE: Shop one's primary row naming s-ham-b, costed by the same rollup.
    const committed = buildShopOwnedFixture();
    committed.vendor_price_history = t.vendor_price_history;
    committed.product_primaries!.push({ id: "pp-swap", product_id: "p-ham", location_id: LOC, primary_sku_id: "s-ham-b", note: "swap" });
    current = createFakeDb(committed);
    const g = await loadRecipeGraph({ locationId: LOC });
    const want = rollupMenuItemCost(g, "m-italian", costPerOzFromGraph(g, await loadCurrentSkuPrices([...g.skuPack.keys()], LOC))).cost;
    expect(p.costs.find((c) => c.menuItemId === "m-italian")?.after ?? null).toBe(want);
    // …and the write is bound to them.
    current = createFakeDb(t);
    (current.client as unknown as { rpc: unknown }).rpc = rpc;
    await startSkuSwap(gm, p.request, p.token);
    expect(rpc).toHaveBeenCalledWith("start_sku_swap", expect.objectContaining({
      p_recipes: [], p_product: { id: "p-ham" },
      p_bound: expect.arrayContaining([expect.objectContaining({ recipe_id: "r-italian", location: LOC, snapshot: p.bound.find((b) => b.recipeId === "r-italian")!.snapshot })]),
    }));
  });
});

describe("Back to normal", () => {
  beforeEach(() => {
    // A live swap at Shop one, built straight into a fresh fake: its shop version of the pickle side and its primary row.
    const tables = buildShopOwnedFixture();
    tables.sku_swaps = [{ id: "sw-1", location_id: LOC, old_sku_id: "s-pickle", new_sku_id: "s-turkey", product_id: "p-x", mode: "for_now", active: true,
      started_at: "2026-10-15T12:00:00.000Z", primary_row_id: "pp-1", previous_primary_sku_id: null,
      versions: [{ recipe_id: "r-pickle", location: LOC, version_id: "rv-shop", replaced_version_id: null }] }];
    tables.recipe_versions!.push({ id: "rv-shop", recipe_id: "r-pickle", location_id: LOC, active: true, valid_from: "2026-10-15T12:00:00.000Z", valid_to: null });
    tables.product_primaries = [...(tables.product_primaries ?? []), { id: "pp-1", product_id: "p-x", location_id: LOC, primary_sku_id: "s-turkey" }];
    current = createFakeDb(tables);
    (current.client as unknown as { rpc: unknown }).rpc = rpc;
  });
  it("the preview names what goes back and how; the write sends its snapshots", async () => {
    const p = await previewBackToNormal(gm, "sw-1");
    expect(p).toMatchObject({ goingBack: [{ recipeId: "r-pickle", how: "retire" }], kept: [], primary: "restore" });
    await expect(endSkuSwap(gm, "sw-1", p.token)).resolves.toEqual({ back: ["r-pickle"], kept: [], primary: "restored", grouping: "undone" });
    expect(rpc).toHaveBeenCalledWith("end_sku_swap", { p_swap: "sw-1", p_snapshots: p.snapshots, p_actor: "u-1" });
    expect(audits).toContain("sku.swap_end");
  });
  it("another shop's GM never sees it", async () => {
    const other = { user: { id: "u-2", role: "gm", name: "T" }, role: "gm", level: 7, locations: [OTHER] } as never;
    await expect(previewBackToNormal(other, "sw-1")).rejects.toMatchObject({ status: 404, code: "swap_not_found" });
  });
});
```

Run: `npx vitest run tests/swap-vendor.test.ts` → expected: FAIL (module missing).

- [ ] **Step 3b: The proposed primary goes through the ONE resolver (`lib/products.ts`, `lib/prep-consumption.ts`; Astra 4a r1#2)**

A swap's preview must cost what the swap will commit — the new primary at its scope, and the items it joins as members — through `resolveProductMember`, never a second resolver.

1. `lib/products.ts`: directly before `export interface ProductIndexSharedReads {`, insert

```ts
/**
 * A swap PREVIEW's proposal (catalog Phase 4a; Astra 4a r1#2): at the loader's own scope, `primarySkuId` is the chosen
 * primary and `joinSkuIds` are members of `productId` — exactly what start_sku_swap will commit. Preview-only; the
 * ladder still decides (an inactive or ineligible proposal falls through like any primary).
 */
export interface ProductProposal { productId: string; joinSkuIds: readonly string[]; primarySkuId: string }
```

and add `  proposal?: ProductProposal;` as the last member of `ProductIndexSharedReads`.
2. In `loadProductIndex`, replace `  const memberIds = memberRowList.map((m) => m.id);` with

```ts
  // A swap preview's proposal: the items it joins are members of its product, read like any member (one read, preview only).
  const proposal = shared.proposal && presentIds.includes(shared.proposal.productId) ? shared.proposal : null;
  if (proposal) {
    const have = new Set(memberRowList.map((m) => m.id));
    const join = proposal.joinSkuIds.filter((id) => !have.has(id));
    if (join.length > 0) {
      const { data: extra, error: xErr } = await sb.from("vendor_items")
        .select("id, name, vendor_id, product_id, active, avg_oz_per_each, pending_review, location_id, units_per_pack, each_size, each_measure")
        .in("id", join).returns<DbMemberRow[]>();
      if (xErr) throw new Error(`loadProductIndex proposal members: ${xErr.message}`);
      for (const m of extra ?? []) memberRowList.push({ ...m, product_id: proposal.productId });
    }
  }
  const memberIds = memberRowList.map((m) => m.id);
```

then directly after `    const chosen = locationRow ?? globalRow ?? null;` add `    const proposedPrimary = proposal?.productId === p.id ? proposal.primarySkuId : null;`, and replace BOTH `primarySkuId: chosen?.primary_sku_id ?? null,` (the `resolveProductMember` input and the `byProduct` entry) with `primarySkuId: proposedPrimary ?? chosen?.primary_sku_id ?? null,`.
3. `lib/prep-consumption.ts`: add `import type { ProductProposal } from "@/lib/products";`; in `loadRecipeGraph`'s options type add

```ts
  /** A swap preview's proposed primary + joined members (Astra 4a r1#2) — the one resolver costs what the swap will commit. */
  productProposal?: ProductProposal;
```

and replace `    loadProductIndex(productIds, locationId),` with `    loadProductIndex(productIds, locationId, opts?.productProposal ? { proposal: opts.productProposal } : {}),`. With no proposal every read and number is unchanged (the equivalence pins).

- [ ] **Step 4: Create `lib/catalog/swap-vendor.ts`**

```ts
/**
 * JOB 3 — SWAP VENDOR: the server half (catalog Phase 4a, 0265). SERVER-ONLY, service role.
 *
 * THE PREVIEW says everything the swap will do, computed by the code that will do it:
 *   · every recipe THIS scope makes with the old item (the one resolver, so a shop's own versions and its own recipes
 *     count), each line rewritten by swapLine from the packs THIS scope resolves for both items;
 *   · one product (the old item's, the new item's, or a new one), and the recipes that pin it (they follow the primary);
 *   · every sandwich's cost before and after, by THE costing rollup on the shop's graph with the new lines as overrides;
 *   · for "everywhere": the shops that keep their own version (they are not the default).
 * Its token binds the recipes' versions, new lines and dependency snapshots — and the recipes that FOLLOW the primary
 * (they pin the product) by their current lines' snapshots, with the proposed primary costed through the one resolver
 * (Astra r1#2). The preview hands back the exact request it hashed (a new product's name filled in), so the page sends
 * that and never invalidates its own token (Astra r1#7). START recomputes the preview, refuses a stale token, and sends
 * exactly that to start_sku_swap — one transaction (0265), which re-enumerates both recipe sets under the graph lock. BACK TO NORMAL does the same with
 * end_sku_swap. A recipe the shop OWNS is written as itself (0264): its swap version is its own new default.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeGraph, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import type { RecipeGraph } from "@/lib/prep-consumption-graph";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { loadRecipeChangeSnapshot, loadRecipeLiveSet, recipeVersionErrorFromRpc } from "@/lib/admin/recipe-versions";
import { rpcRecipeLines, type LiveRecipeLine, type RecipeVersionLineRow } from "@/lib/recipe-versions-shared";
import { lineFromRow, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import { previewToken } from "@/lib/catalog/change-preview-shared";
import { catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";
import type { ProductProposal } from "@/lib/products";
import { NEW_THING_MIN, newThingScopeGate, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";
import { swapLine, type SwapRequest } from "@/lib/catalog/swap-shared";

/** THE BIND (a BIND_PRIMITIVES name), before any I/O: a shop the actor works in; the default ("everywhere") = MoO+. */
function requireLocation(actor: AuthContext, scope: VersionScope): void {
  const gate = newThingScopeGate({ level: actor.level, role: actor.role, locations: actor.locations }, scope);
  if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
}

type Sb = ReturnType<typeof getServiceRoleClient>;
type SkuRow = { id: string; name: string; vendor_id: string | null; location_id: string | null; active: boolean; product_id: string | null };

/** Never a real recipe id: a probe override only makes the graph load both items' packs. */
const SWAP_PROBE_ID = "swap:probe";

export interface SwapPreviewRecipe {
  recipeId: string;
  recipeName: string;
  /** Where the version is written: this shop — or, for a recipe the shop owns (0264) or "everywhere", the recipe itself (null). */
  writeScope: string | null;
  expectedVersionId: string | null;
  basedOnVersionId: string | null;
  changes: Array<{ position: number; before: RecipeLineFields; after: RecipeLineFields; converted: boolean }>;
  /** The full new line set. */
  lines: LiveRecipeLine[];
  snapshot: Record<string, unknown>;
}

export interface SwapPreview {
  request: SwapRequest;
  oldSku: { id: string; name: string; vendorName: string | null };
  newSku: { id: string; name: string; vendorName: string | null };
  scopeName: string | null;
  product: { kind: "existing"; id: string; name: string } | { kind: "create"; name: string; nameEs: string | null };
  recipes: SwapPreviewRecipe[];
  /** Lines that cannot be carried (a label the old item cannot weigh): the swap waits until they are fixed. */
  refused: Array<{ recipeId: string; recipeName: string; position: number; reason: "unit_unknown" }>;
  /** Recipes that pin the product: they follow the swap through the primary, with no new version. */
  followsPrimary: Array<{ id: string; name: string }>;
  /** …each bound to the preview by its CURRENT lines' snapshot (start_sku_swap checks them under their locks; Astra r1#2). */
  bound: Array<{ recipeId: string; writeScope: string | null; lines: LiveRecipeLine[]; snapshot: Record<string, unknown> }>;
  /** "Everywhere": shops with their OWN version of a switched recipe keep it. */
  untouchedShops: Array<{ id: string; name: string }>;
  /** Every sandwich whose cost moves, before and after (THE costing rollup). */
  costs: Array<{ menuItemId: string; name: string; nameEs: string | null; before: number | null; after: number | null }>;
  token: string;
}

const lineRow = (recipeId: string, l: LiveRecipeLine, i: number): RecipeVersionLineRow => ({
  id: l.lineId ?? `swap-line-${i + 1}`, version_id: "swap", recipe_id: recipeId,
  component_sku_id: l.fields.componentSkuId, component_item_id: l.fields.componentItemId, component_product_id: l.fields.componentProductId,
  quantity: l.fields.quantity, unit: l.fields.unit, each_container_label: l.fields.eachContainerLabel, portioned: l.fields.portioned, display_order: i,
});

const probeRows = (skuIds: readonly string[]): RecipeVersionLineRow[] => skuIds.map((id, i) => lineRow(SWAP_PROBE_ID, {
  lineId: null, fields: { componentSkuId: id, componentItemId: null, componentProductId: null, quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false },
}, i));

const graphFor = (scope: VersionScope, overrides: ReadonlyMap<string, readonly RecipeVersionLineRow[]>, productProposal?: ProductProposal) =>
  loadRecipeGraph(scope === null ? { recipeOverrides: overrides, productProposal } : { locationId: scope, recipeOverrides: overrides, productProposal });

function menuCosts(graph: RecipeGraph, prices: ReadonlyMap<string, number>): Map<string, number | null> {
  const perOz = costPerOzFromGraph(graph, prices);
  return new Map([...graph.byOutputMenuItem.keys()].map((id) => [id, rollupMenuItemCost(graph, id, perOz).cost]));
}

/** The snapshot over EXACTLY the payload start_sku_swap sends for this recipe (rpcRecipeLines of the new set). */
async function snapshotOf(recipeId: string, scope: VersionScope, lines: readonly LiveRecipeLine[]): Promise<Record<string, unknown>> {
  const { data, error } = await getServiceRoleClient().rpc("recipe_change_snapshot", { p_recipe: recipeId, p_location: scope, p_lines: rpcRecipeLines(lines) });
  if (error) throw new Error(`swap snapshot: ${error.message}`);
  if (data == null || typeof data !== "object") throw new Error("swap snapshot: none");
  return data as Record<string, unknown>;
}

export async function previewSkuSwap(actor: AuthContext, req: SwapRequest): Promise<SwapPreview> {
  requireLocation(actor, req.scope);
  if (req.scope === null && req.mode !== "for_good") throw new ShopOwnedError(400, "invalid_mode");
  if (req.oldSkuId === req.newSkuId) throw new ShopOwnedError(400, "same_sku");
  const sb = getServiceRoleClient();
  const [skus, locs] = await Promise.all([
    sb.from("vendor_items").select("id, name, vendor_id, location_id, active, product_id").in("id", [req.oldSkuId, req.newSkuId]).returns<SkuRow[]>(),
    sb.from("locations").select("id, name").returns<Array<{ id: string; name: string }>>(),
  ]);
  if (skus.error) throw new Error(`swap items: ${skus.error.message}`);
  if (locs.error) throw new Error(`swap shops: ${locs.error.message}`);
  const old = (skus.data ?? []).find((s) => s.id === req.oldSkuId);
  const neu = (skus.data ?? []).find((s) => s.id === req.newSkuId);
  // Both active; a shop-owned item swaps only at its owner (2a's owner rule) — the same answer as a missing one.
  const usable = (s: SkuRow | undefined): s is SkuRow => !!s && s.active && ((s.location_id ?? null) === null || s.location_id === req.scope);
  if (!usable(old) || !usable(neu)) throw new ShopOwnedError(404, "sku_not_found");
  const shopName = (id: string | null) => (id === null ? null : (locs.data ?? []).find((l) => l.id === id)?.name ?? null);
  const vendorIds = [old.vendor_id, neu.vendor_id].filter((v): v is string => v !== null);
  const vendors = vendorIds.length
    ? await sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (vendors.error) throw new Error(`swap vendors: ${vendors.error.message}`);
  const vendorName = (id: string | null) => (id === null ? null : (vendors.data ?? []).find((v) => v.id === id)?.name ?? null);

  // ONE PRODUCT: the old item's, else the new item's, else a new one named for the old item (0265 pins its default).
  if (old.product_id && neu.product_id && old.product_id !== neu.product_id) throw new ShopOwnedError(409, "in_other_product");
  const pid = old.product_id ?? neu.product_id;
  let product: SwapPreview["product"];
  if (pid) {
    const [p, prim] = await Promise.all([
      sb.from("products").select("id, name, active").eq("id", pid).maybeSingle<{ id: string; name: string; active: boolean }>(),
      sb.from("product_primaries").select("id").eq("product_id", pid).is("location_id", null).returns<Array<{ id: string }>>(),
    ]);
    if (p.error) throw new Error(`swap product: ${p.error.message}`);
    if (prim.error) throw new Error(`swap product primary: ${prim.error.message}`);
    if (!p.data || !p.data.active) throw new ShopOwnedError(404, "not_found");
    if ((prim.data ?? []).length === 0) throw new ShopOwnedError(409, "product_needs_primary");
    product = { kind: "existing", id: p.data.id, name: p.data.name };
  } else {
    product = { kind: "create", name: req.productName ?? old.name, nameEs: req.productNameEs };
  }
  // THE REQUEST THE TOKEN HASHES (Astra r1#7): normalized — a new product's name is the one shown — so the page sends back
  // exactly `preview.request` and the first confirmation is never stale; an unnamed request normalizes to the same.
  const request: SwapRequest = {
    ...req,
    productName: product.kind === "create" ? product.name : null,
    productNameEs: product.kind === "create" ? product.nameEs : null,
  };

  // EVERY RECIPE THIS SCOPE MAKES WITH THE OLD ITEM — through the one resolver (shop versions and the shop's own recipes).
  const resolved = await loadResolvedRecipeInputs(req.scope);
  const usingIds = [...new Set(resolved.filter((l) => l.component_sku_id === req.oldSkuId).map((l) => l.recipe_id))].sort();
  const pinIds = pid ? [...new Set(resolved.filter((l) => l.component_product_id === pid).map((l) => l.recipe_id))] : [];
  const allIds = [...new Set([...usingIds, ...pinIds])];
  const recs = allIds.length
    ? await sb.from("recipes").select("id, name, active, location_id").in("id", allIds)
        .returns<Array<{ id: string; name: string; active: boolean | null; location_id?: string | null }>>()
    : { data: [] as Array<{ id: string; name: string; active: boolean | null; location_id?: string | null }>, error: null };
  if (recs.error) throw new Error(`swap recipes: ${recs.error.message}`);
  const recipeById = new Map((recs.data ?? []).filter((r) => r.active !== false).map((r) => [r.id, r]));
  const affected = usingIds.filter((id) => recipeById.has(id));
  // A recipe the shop OWNS is written as itself (0264: it has no shop versions); every other gets this scope's version.
  const writeScopeOf = (id: string): VersionScope =>
    req.scope !== null && (recipeById.get(id)!.location_id ?? null) === req.scope ? null : req.scope;
  const lives = await Promise.all(affected.map((id) => loadRecipeLiveSet(id, writeScopeOf(id))));
  // THE RECIPES THAT FOLLOW THE PRIMARY (they pin the product; Astra r1#2): their current lines, bound by snapshot.
  const followIds = pinIds.filter((id) => recipeById.has(id) && !affected.includes(id)).sort();
  const followLives = await Promise.all(followIds.map((id) => loadRecipeLiveSet(id, writeScopeOf(id))));

  // How each old line names the new item — from the packs THIS scope resolves for both (a probe override loads them).
  const before = await graphFor(req.scope, new Map([[SWAP_PROBE_ID, probeRows([req.oldSkuId, req.newSkuId])]]));
  const ozOf = (skuId: string) => (unit: string): number | null => {
    const pack = before.skuPack.get(skuId);
    return pack ? ozForRecipeInput(1, unit, pack, before.measures) : null;
  };
  const ctx = { isMeasure: (u: string) => before.measures.has(u), oldOz: ozOf(req.oldSkuId), newOz: ozOf(req.newSkuId) };
  const refused: SwapPreview["refused"] = [];
  const drafts = lives.map((live) => {
    const changes: SwapPreviewRecipe["changes"] = [];
    const lines: LiveRecipeLine[] = live.lines.map((l, i) => {
      if (l.fields.componentSkuId !== req.oldSkuId) return l;
      const r = swapLine(l.fields, req.newSkuId, ctx);
      if (!r.ok) {
        refused.push({ recipeId: live.recipeId, recipeName: live.recipeName, position: i + 1, reason: r.reason });
        return l;
      }
      changes.push({ position: i + 1, before: l.fields, after: r.line, converted: r.converted });
      return { lineId: l.lineId, fields: r.line };
    });
    return { live, lines, changes };
  });
  const [snapshots, boundSnaps] = await Promise.all([
    Promise.all(drafts.map((d) => snapshotOf(d.live.recipeId, d.live.scope, d.lines))),
    Promise.all(followLives.map((l) => snapshotOf(l.recipeId, l.scope, l.lines))),
  ]);
  const bound: SwapPreview["bound"] = followLives.map((l, i) => ({ recipeId: l.recipeId, writeScope: l.scope, lines: l.lines, snapshot: boundSnaps[i]! }));
  const recipes: SwapPreviewRecipe[] = drafts.map((d, i) => ({
    recipeId: d.live.recipeId, recipeName: d.live.recipeName, writeScope: d.live.scope,
    expectedVersionId: d.live.scopeVersionId, basedOnVersionId: d.live.ridesDefault ? d.live.globalVersionId : null,
    changes: d.changes, lines: d.lines, snapshot: snapshots[i]!,
  }));

  // WHAT IT COSTS: every sandwich this scope sells, before and after, by THE costing rollup on this scope's graph — the
  // after graph WITH the primary the swap will set (and the items it joins), through the one resolver (Astra r1#2).
  const proposal: ProductProposal | undefined = pid
    ? { productId: pid, joinSkuIds: [old, neu].filter((s) => s.product_id == null).map((s) => s.id), primarySkuId: req.newSkuId }
    : undefined;
  const after = await graphFor(req.scope, new Map(recipes.map((r) => [r.recipeId, r.lines.map((l, i) => lineRow(r.recipeId, l, i))])), proposal);
  const prices = await loadCurrentSkuPrices([...new Set([...before.skuPack.keys(), ...after.skuPack.keys()])], req.scope);
  const costBefore = menuCosts(before, prices);
  const costAfter = menuCosts(after, prices);
  const movedIds = [...costAfter.keys()].filter((id) => costAfter.get(id) !== costBefore.get(id));
  const menus = movedIds.length
    ? await sb.from("menu_items").select("id, name, name_es").in("id", movedIds).returns<Array<{ id: string; name: string; name_es: string | null }>>()
    : { data: [] as Array<{ id: string; name: string; name_es: string | null }>, error: null };
  if (menus.error) throw new Error(`swap menu items: ${menus.error.message}`);
  const costs = (menus.data ?? [])
    .map((m) => ({ menuItemId: m.id, name: m.name, nameEs: m.name_es, before: costBefore.get(m.id) ?? null, after: costAfter.get(m.id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.menuItemId.localeCompare(b.menuItemId));

  let untouchedShops: SwapPreview["untouchedShops"] = [];
  if (req.scope === null && affected.length > 0) {
    const own = await sb.from("recipe_versions").select("location_id").in("recipe_id", affected).eq("active", true).not("location_id", "is", null)
      .returns<Array<{ location_id: string }>>();
    if (own.error) throw new Error(`swap own versions: ${own.error.message}`);
    untouchedShops = [...new Set((own.data ?? []).map((o) => o.location_id))].sort().map((id) => ({ id, name: shopName(id) ?? "" }));
  }
  const followsPrimary = followIds.map((id) => ({ id, name: recipeById.get(id)!.name }));

  const token = previewToken({
    kind: "sku_swap", req: request, product, refused,
    recipes: recipes.map((r) => [r.recipeId, r.writeScope, r.expectedVersionId, r.basedOnVersionId, rpcRecipeLines(r.lines), r.snapshot]),
    bound: bound.map((b) => [b.recipeId, b.writeScope, rpcRecipeLines(b.lines), b.snapshot]),
  });
  return {
    request,
    oldSku: { id: old.id, name: old.name, vendorName: vendorName(old.vendor_id) },
    newSku: { id: neu.id, name: neu.name, vendorName: vendorName(neu.vendor_id) },
    scopeName: shopName(req.scope), product, recipes, refused, followsPrimary, bound, untouchedShops, costs, token,
  };
}

export interface SwapStarted {
  swapId: string;
  productId: string;
  versions: Array<{ recipeId: string; versionId: string }>;
}

export async function startSkuSwap(actor: AuthContext, req: SwapRequest, token: string): Promise<SwapStarted> {
  requireLocation(actor, req.scope); // the bind, visibly in THIS writer's body, before any I/O (the preview repeats it)
  const preview = await previewSkuSwap(actor, req);
  if (preview.token !== token) throw new ShopOwnedError(409, "preview_stale");
  if (preview.refused.length > 0) throw new ShopOwnedError(400, "swap_line_unit_unknown");
  const { data, error } = await getServiceRoleClient().rpc("start_sku_swap", {
    p_location: req.scope, p_old: req.oldSkuId, p_new: req.newSkuId, p_mode: req.mode,
    p_product: preview.product.kind === "existing"
      ? { id: preview.product.id }
      : { create: { name: preview.product.name, name_es: preview.product.nameEs } },
    p_recipes: preview.recipes.map((r) => ({
      recipe_id: r.recipeId, location: r.writeScope, expected: r.expectedVersionId, based_on: r.basedOnVersionId,
      lines: rpcRecipeLines(r.lines), snapshot: r.snapshot,
    })),
    p_bound: preview.bound.map((b) => ({ recipe_id: b.recipeId, location: b.writeScope, lines: rpcRecipeLines(b.lines), snapshot: b.snapshot })),
    p_note: req.note, p_actor: actor.user.id,
  });
  if (error) {
    if (/recipe_version:/.test(error.message)) recipeVersionErrorFromRpc(error.message);
    shopOwnedErrorFromRpc(error.message);
  }
  const r = data as {
    swap_id: string; product_id: string; product_created: boolean; previous_primary_sku_id: string | null;
    versions: Array<{ recipe_id: string; location: string | null; version_id: string; replaced_version_id: string | null }>;
  };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "sku.swap_start", resourceTable: "sku_swaps", resourceId: r.swap_id,
    metadata: { old_sku_id: req.oldSkuId, new_sku_id: req.newSkuId, location_id: req.scope, mode: req.mode, product_id: r.product_id,
      product_created: r.product_created, recipe_ids: r.versions.map((v) => v.recipe_id), note: req.note },
    ipAddress: null, userAgent: null,
  });
  for (const v of r.versions) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_version.save", resourceTable: "recipe_versions", resourceId: v.version_id,
      metadata: { recipe_id: v.recipe_id, location_id: v.location, scope: v.location === null ? "global" : "shop", op: "swap",
        retired_version_id: v.replaced_version_id, swap_id: r.swap_id },
      ipAddress: null, userAgent: null,
    });
  }
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "product.primary_set", resourceTable: "product_primaries", resourceId: r.product_id,
    metadata: { location_id: req.scope, primary_sku_id: req.newSkuId, previous_primary_sku_id: r.previous_primary_sku_id, swap_id: r.swap_id },
    ipAddress: null, userAgent: null,
  });
  // Lead decision 3: a swap writes no par and never switches the old item off — Back to normal can then restore exactly.
  return { swapId: r.swap_id, productId: r.product_id, versions: r.versions.map((v) => ({ recipeId: v.recipe_id, versionId: v.version_id })) };
}

// ── Back to normal ───────────────────────────────────────────────────────────

type SwapRow = {
  id: string; location_id: string | null; old_sku_id: string; new_sku_id: string; mode: "for_now" | "for_good"; active: boolean;
  started_at: string; primary_row_id: string | null;
  versions: Array<{ recipe_id: string; location: string | null; version_id: string; replaced_version_id: string | null }>;
};

export interface BackToNormalPreview {
  swapId: string;
  oldSku: { id: string; name: string };
  newSku: { id: string; name: string };
  shopId: string;
  shopName: string | null;
  startedAt: string;
  /** Versions still in force: retired (the shop rode the default before) or restored (it had its own, or owns the recipe). */
  goingBack: Array<{ recipeId: string; recipeName: string; how: "retire" | "restore" }>;
  /** Versions changed since the swap: kept, and named. */
  kept: Array<{ recipeId: string; recipeName: string }>;
  primary: "restore" | "changed_since" | "none";
  snapshots: Record<string, Record<string, unknown>>;
  token: string;
}

async function versionLineFields(sb: Sb, versionId: string): Promise<RecipeLineFields[]> {
  const rows = await selectAllRows<RecipeLineRow & { id: string; display_order: number | null }>(async (from, to) => {
    const { data, error } = await sb.from("recipe_version_lines")
      .select("id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order")
      .eq("version_id", versionId).order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to)
      .returns<Array<RecipeLineRow & { id: string; display_order: number | null }>>();
    if (error) throw new Error(`swap version lines: ${error.message}`);
    return { data };
  });
  return rows.map((r) => lineFromRow(r));
}

export async function previewBackToNormal(actor: AuthContext, swapId: string): Promise<BackToNormalPreview> {
  if (actor.level < NEW_THING_MIN) throw new ShopOwnedError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data: swap, error } = await sb.from("sku_swaps")
    .select("id, location_id, old_sku_id, new_sku_id, mode, active, started_at, primary_row_id, versions").eq("id", swapId).maybeSingle<SwapRow>();
  if (error) throw new Error(`swap: ${error.message}`);
  // An opaque id: read, then the 404-masked bind (attachMember's posture) — another shop's swap does not exist for you.
  if (!swap || swap.location_id === null || !catalogShopAllowed(actor, swap.location_id)) throw new ShopOwnedError(404, "swap_not_found");
  requireLocation(actor, swap.location_id);
  if (!swap.active || swap.mode !== "for_now") throw new ShopOwnedError(409, "not_live");
  const versionIds = swap.versions.map((v) => v.version_id);
  const recipeIds = [...new Set(swap.versions.map((v) => v.recipe_id))];
  const [vrows, recs, skus, prim, shops] = await Promise.all([
    versionIds.length ? sb.from("recipe_versions").select("id, active").in("id", versionIds).returns<Array<{ id: string; active: boolean }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; active: boolean }>, error: null }),
    recipeIds.length ? sb.from("recipes").select("id, name").in("id", recipeIds).returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    sb.from("vendor_items").select("id, name").in("id", [swap.old_sku_id, swap.new_sku_id]).returns<Array<{ id: string; name: string }>>(),
    swap.primary_row_id
      ? sb.from("product_primaries").select("id, primary_sku_id").eq("id", swap.primary_row_id).maybeSingle<{ id: string; primary_sku_id: string }>()
      : Promise.resolve({ data: null, error: null }),
    sb.from("locations").select("id, name").eq("id", swap.location_id).returns<Array<{ id: string; name: string }>>(),
  ]);
  for (const [label, r] of [["versions", vrows], ["recipes", recs], ["items", skus], ["primary", prim], ["shop", shops]] as const) {
    if (r.error) throw new Error(`swap back ${label}: ${r.error.message}`);
  }
  const live = new Set((vrows.data ?? []).filter((v) => v.active).map((v) => v.id));
  const nameOf = (id: string) => (recs.data ?? []).find((r) => r.id === id)?.name ?? "";
  const back = swap.versions.filter((v) => live.has(v.version_id));
  const goingBack = back.map((v) => ({ recipeId: v.recipe_id, recipeName: nameOf(v.recipe_id), how: v.replaced_version_id ? "restore" as const : "retire" as const }));
  const kept = swap.versions.filter((v) => !live.has(v.version_id)).map((v) => ({ recipeId: v.recipe_id, recipeName: nameOf(v.recipe_id) }));
  // The change's line set, exactly as end_sku_swap derives it: the default's lines (retire) or the replaced version's (restore).
  const snapshotList = await Promise.all(back.map(async (v) => {
    const lines = v.replaced_version_id
      ? await versionLineFields(sb, v.replaced_version_id)
      : (await loadRecipeLiveSet(v.recipe_id, null)).lines.map((l) => l.fields);
    return [v.recipe_id, await loadRecipeChangeSnapshot(v.recipe_id, v.location, lines)] as const;
  }));
  const snapshots = Object.fromEntries(snapshotList) as Record<string, Record<string, unknown>>;
  const primary: BackToNormalPreview["primary"] = swap.primary_row_id === null ? "none"
    : prim.data && prim.data.primary_sku_id === swap.new_sku_id ? "restore" : "changed_since";
  const skuName = (id: string) => (skus.data ?? []).find((s) => s.id === id)?.name ?? "";
  const token = previewToken({ kind: "sku_swap_back", swapId, goingBack: goingBack.map((g) => [g.recipeId, g.how]), kept: kept.map((k) => k.recipeId), primary, snapshots });
  return {
    swapId, oldSku: { id: swap.old_sku_id, name: skuName(swap.old_sku_id) }, newSku: { id: swap.new_sku_id, name: skuName(swap.new_sku_id) },
    shopId: swap.location_id, shopName: (shops.data ?? [])[0]?.name ?? null, startedAt: swap.started_at,
    goingBack, kept, primary, snapshots, token,
  };
}

export async function endSkuSwap(actor: AuthContext, swapId: string, token: string): Promise<{ back: string[]; kept: string[]; primary: string; grouping: string }> {
  const p = await previewBackToNormal(actor, swapId);
  requireLocation(actor, p.shopId); // the bind, visibly in THIS writer's body (the swap id is opaque: the preview read it first)
  if (p.token !== token) throw new ShopOwnedError(409, "preview_stale");
  const { data, error } = await getServiceRoleClient().rpc("end_sku_swap", { p_swap: swapId, p_snapshots: p.snapshots, p_actor: actor.user.id });
  if (error) {
    if (/recipe_version:/.test(error.message)) recipeVersionErrorFromRpc(error.message);
    shopOwnedErrorFromRpc(error.message);
  }
  const r = data as { back: string[]; kept: string[]; primary: string; grouping: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "sku.swap_end", resourceTable: "sku_swaps", resourceId: swapId,
    metadata: { location_id: p.shopId, back: r.back, kept: r.kept, primary: r.primary, grouping: r.grouping,
      how: Object.fromEntries(p.goingBack.map((g) => [g.recipeId, g.how])) },
    ipAddress: null, userAgent: null,
  });
  return { back: r.back, kept: r.kept, primary: r.primary, grouping: r.grouping };
}

/** The live "Just for now" swaps touching one item at one shop — the item page's "Back to normal" banner (4b). */
export async function loadLiveSwapsForItem(actor: AuthContext, skuId: string, shopId: string): Promise<Array<{ swapId: string; oldSkuId: string; newSkuId: string; startedAt: string }>> {
  if (actor.level < 6 || !catalogShopAllowed(actor, shopId)) throw new ShopOwnedError(404, "not_found");
  const { data, error } = await getServiceRoleClient().from("sku_swaps").select("id, old_sku_id, new_sku_id, started_at")
    .eq("location_id", shopId).eq("active", true).order("started_at", { ascending: false })
    .returns<Array<{ id: string; old_sku_id: string; new_sku_id: string; started_at: string }>>();
  if (error) throw new Error(`live swaps: ${error.message}`);
  return (data ?? []).filter((s) => s.old_sku_id === skuId || s.new_sku_id === skuId)
    .map((s) => ({ swapId: s.id, oldSkuId: s.old_sku_id, newSkuId: s.new_sku_id, startedAt: s.started_at }));
}
```

- [ ] **Step 5: Run, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/swap-shared.test.ts tests/swap-vendor.test.ts` → expected: PASS.

```bash
git add lib/catalog/swap-shared.ts lib/catalog/swap-vendor.ts lib/products.ts lib/prep-consumption.ts tests/swap-shared.test.ts tests/swap-vendor.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a job 3 — Swap vendor: the line rewrite, a token-bound preview with cost changes, start, Back to normal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 11: The audit vocabulary and the differential location-bind check

**Files:**
- Modify: `lib/destructive-actions.ts`, `tests/location-bind-differential.test.ts`

- [ ] **Step 1: Register the audit vocabulary**

In `lib/destructive-actions.ts`, directly after 3a's `  "recipe_version.promote",`, insert:

```ts
  // ── Shop-only things and the guided jobs (catalog Phase 4a, 0264–0265) ─────
  // — menu_item.share / vendor_item.share: MoO+ makes a shop's own sandwich (with its recipe and the shop's own items
  //   it uses) or item every shop's. Who sees and orders it changes for every shop.
  "menu_item.share",
  "vendor_item.share",
  // — recipe.share: MoO+ makes a shop's own prep recipe (with the items it makes and the shop's SKUs it uses) every shop's.
  "recipe.share",
  // — sku.swap_start / sku.swap_end: Swap vendor and Back to normal. Every recipe version and the primary they write
  //   are audited in their own words too (recipe_version.save, product.primary_set).
  "sku.swap_start",
  "sku.swap_end",
```

(The jobs' creates reuse `vendor_item.create`, `sku.pack_version_save`, `vendor_item.price_recorded`, `menu_item.create` and `recipe.create` — already registered — with `job` in the metadata.)

- [ ] **Step 2: Register the writers with the differential location-bind check**

In `tests/location-bind-differential.test.ts`:
- `TENANCY_SCOPED_TABLES`, after 3a's `"menu_item_shop_settings",`: add `// 0265 — a swap belongs to its shop.` followed by `"sku_swaps",`.
- `TENANCY_SCOPED_RPCS`, after 3a's `"promote_menu_item_shop_setting",`: add `// 0264/0265 — the job writers; their libs bind before calling them (sharing is MoO-only org scope: lib/catalog/share.ts is not shop-bound).` followed by `"create_catalog_sku",`, `"create_shop_sandwich",`, `"save_owned_recipe_version",`, `"start_sku_swap",`, `"end_sku_swap",` (`save_owned_recipe_version` is called only from `lib/admin/recipe-versions.ts`, which binds before any I/O — 3a's FILES entry).
- `FILES`: add `// 0264/0265 — every job writer binds inside the lib (requireLocation) before any I/O.` followed by `"lib/catalog/new-item.ts",`, `"lib/catalog/new-sandwich.ts",`, `"lib/catalog/swap-vendor.ts",`.

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/location-bind-differential.test.ts tests/audit-actions.test.ts` → expected: PASS (if the vocabulary has no test of its own, `npx tsc --noEmit` proves every `action:` literal is a member).

```bash
git add lib/destructive-actions.ts tests/location-bind-differential.test.ts
git commit -m "$(cat <<'EOF'
chore(catalog): Phase 4a — audit vocabulary for share and swap; the job writers join the location-bind check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 12: The routes

Every write is **Tier E** (reversible; the catalog's edit window) except the Toast link, which keeps the mapping's own **Tier A** (`app/api/admin/toast-map/manual/route.ts` asks A for the same act; a sandwich is not a reason to lower it). Previews are reads (no step-up). Every route parses before the session (the 2b pattern), checks the level floor, asks its tier, and answers a named refusal with its status and code (`namedRefusal`).

**Files:**
- Create: `app/api/admin/catalog/jobs/new-item/route.ts`, `app/api/admin/catalog/sku/[id]/setup/route.ts`, `app/api/admin/catalog/jobs/new-sandwich/route.ts`, `app/api/admin/catalog/jobs/new-sandwich/preview/route.ts`, `app/api/admin/catalog/menu-item/[id]/toast/route.ts`, `app/api/admin/catalog/menu-item/[id]/share/route.ts`, `app/api/admin/catalog/sku/[id]/share/route.ts`, `app/api/admin/catalog/sku/[id]/swap/route.ts`, `app/api/admin/catalog/sku/[id]/swap/preview/route.ts`, `app/api/admin/catalog/swaps/[swapId]/back-to-normal/route.ts`, `tests/catalog-job-routes.test.ts`
- Modify: `tests/step-up-tier-map.test.ts`

- [ ] **Step 1: Write the failing source-pin test `tests/catalog-job-routes.test.ts`**

```ts
/** Catalog Phase 4a — the job routes: floor, tier, the one lib call, the named-refusal answer. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const R = (p: string) => readFileSync(`app/api/admin/catalog/${p}/route.ts`, "utf8");
const ROUTES: Array<[string, string | null, string[]]> = [
  ["jobs/new-item", "E", ["createCatalogItem(ctx, r.request)", "parseNewItemRequest(parsed)", "ctx.level < NEW_THING_MIN"]],
  ["sku/[id]/setup", "E", ["setUpItemAtShop(ctx, { skuId: id, shopId: s.shopId, step: s.step })", "parseSetupStep(parsed)"]],
  ["jobs/new-sandwich/preview", null, ["previewSandwichCost(ctx, d.draft)", "parseSandwichDraft(parsed, { requireLines: false })"]],
  ["jobs/new-sandwich", "E", ["createShopSandwich(ctx, d.draft)", "parseSandwichDraft(parsed, { requireLines: true })"]],
  ["menu-item/[id]/toast", "A", ["loadSandwichToastChoices(ctx, id, location)", "linkSandwichToToast(ctx, {", "ctx.level < TOAST_MAP_MIN"]],
  ["menu-item/[id]/share", "E", ["previewShareMenuItem(ctx, id)", "shareMenuItemWithAllShops(ctx, {", "ctx.level < SHARE_MIN"]],
  ["sku/[id]/share", "E", ["previewShareSku(ctx, id)", "shareSkuWithAllShops(ctx, {"]],
  ["recipe/[id]/share", "E", ["previewShareRecipe(ctx, id)", "shareRecipeWithAllShops(ctx, {"]],
  ["sku/[id]/swap/preview", null, ["previewSkuSwap(ctx, s.request)", "parseSwapRequest(parsed, id)"]],
  ["sku/[id]/swap", "E", ["startSkuSwap(ctx, s.request, b.token)"]],
  ["swaps/[swapId]/back-to-normal", "E", ["previewBackToNormal(ctx, swapId)", "endSkuSwap(ctx, swapId, b.token)"]],
];

describe("every job route", () => {
  for (const [path, tier, calls] of ROUTES) {
    it(path, () => {
      const src = R(path);
      for (const c of calls) expect(src, c).toContain(c);
      if (tier) expect(src).toContain(`assertStepUp(ctx, "${tier}")`);
      else expect(src).not.toContain("assertStepUp(");
      expect(src).toContain("const n = namedRefusal(e);");
      // jsonOk takes Record<string, unknown>: a lib's named interface is TS2345 there, so every body is an object literal (Astra 4a r1#8).
      expect(src).not.toMatch(/jsonOk\(await /);
      expect(src).toContain("if (n) return jsonError(n.status, n.code,");
    });
  }
  it("an id in the path is a UUID before anything else", () => {
    for (const p of ["sku/[id]/setup", "menu-item/[id]/toast", "menu-item/[id]/share", "sku/[id]/share", "recipe/[id]/share", "sku/[id]/swap", "sku/[id]/swap/preview"]) {
      expect(R(p)).toContain('if (!UUID_RE.test(id)) return jsonError(404, "not_found");');
    }
    expect(R("swaps/[swapId]/back-to-normal")).toContain('if (!UUID_RE.test(swapId)) return jsonError(404, "not_found");');
  });
});
```

Run: `npx vitest run tests/catalog-job-routes.test.ts` → expected: FAIL (`ENOENT`).

- [ ] **Step 2: Create `app/api/admin/catalog/jobs/new-item/route.ts`**

```ts
/**
 * POST /api/admin/catalog/jobs/new-item — job 2's one write (catalog Phase 4a): the item, its first pack version and its
 * first price (create_catalog_sku). Body: { scope: uuid | null, vendorId, name, itemNumber, levels, avgOzPerEach,
 * unitPrice, priceDate, skuClass }. Below MoO the item starts at a shop the actor works in (the lib decides; spec §3).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createCatalogItem } from "@/lib/catalog/new-item";
import { parseNewItemRequest } from "@/lib/catalog/new-item-shared";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catalog/jobs/new-item");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const r = parseNewItemRequest(parsed);
  if (!r.ok) return jsonError(400, r.code, { field: r.field });
  try {
    return jsonOk({ ...(await createCatalogItem(ctx, r.request)) }, 201);
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 3: Create `app/api/admin/catalog/sku/[id]/setup/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/setup — ONE shop setup step of a new item (catalog Phase 4a; spec §5 job 2):
 * { shopId, step: { kind: "par" | "order_days" | "guide_line" | "use_in" | "barcode", … } }, through the writer that
 * owns that step. Each step is its own save; the page shows each result on its own line.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setUpItemAtShop } from "@/lib/catalog/new-item";
import { parseSetupStep } from "@/lib/catalog/new-item-shared";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/setup`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const s = parseSetupStep(parsed);
  if (!s.ok) return jsonError(400, "invalid_payload", { field: s.field });
  try {
    return jsonOk({ ...(await setUpItemAtShop(ctx, { skuId: id, shopId: s.shopId, step: s.step })) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 4: Create `app/api/admin/catalog/jobs/new-sandwich/preview/route.ts`**

```ts
/**
 * POST /api/admin/catalog/jobs/new-sandwich/preview — the live cost per sandwich (catalog Phase 4a; spec §5 job 4). A
 * READ: the shop's own graph with the draft lines as a preview override, THE costing rollup. No step-up.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { previewSandwichCost } from "@/lib/catalog/new-sandwich";
import { parseSandwichDraft } from "@/lib/catalog/new-sandwich-shared";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catalog/jobs/new-sandwich/preview");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const d = parseSandwichDraft(parsed, { requireLines: false });
  if (!d.ok) return jsonError(400, d.code, { field: d.field, ...(d.position ? { position: d.position } : {}) });
  try {
    return jsonOk({ ...(await previewSandwichCost(ctx, d.draft)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 5: Create `app/api/admin/catalog/jobs/new-sandwich/route.ts`**

```ts
/**
 * POST /api/admin/catalog/jobs/new-sandwich — job 4's one write (catalog Phase 4a): the menu item and its recipe, owned
 * by the shop, with its price there (create_shop_sandwich). A refused line answers `line: { position, reason }`.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createShopSandwich } from "@/lib/catalog/new-sandwich";
import { parseSandwichDraft } from "@/lib/catalog/new-sandwich-shared";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catalog/jobs/new-sandwich");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const d = parseSandwichDraft(parsed, { requireLines: true });
  if (!d.ok) return jsonError(400, d.code, { field: d.field, ...(d.position ? { line: { position: d.position, name: "", reason: d.code } } : {}) });
  try {
    return jsonOk({ ...(await createShopSandwich(ctx, d.draft)) }, 201);
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message, ...(n.line ? { line: n.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 6: Create `app/api/admin/catalog/menu-item/[id]/toast/route.ts`**

```ts
/**
 * GET  /api/admin/catalog/menu-item/[id]/toast?location=<shop> — what to offer when linking this sandwich to Toast at a
 *      shop: its links there, the matcher's suggestions, every Toast item (catalog Phase 4a; spec §5 job 4).
 * POST /api/admin/catalog/menu-item/[id]/toast — link it: { locationId, toastItemGuid, toastItemName } → one confirmed
 *      mapping (manualMap). Tier A — the mapping's own tier (app/api/admin/toast-map/manual).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { TOAST_MAP_MIN } from "@/lib/admin/toast-map";
import { linkSandwichToToast, loadSandwichToastChoices } from "@/lib/catalog/new-sandwich";
import { namedRefusal } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/toast`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < TOAST_MAP_MIN) return jsonError(403, "forbidden");
  const location = req.nextUrl.searchParams.get("location") ?? "";
  if (!UUID_RE.test(location)) return jsonError(400, "invalid_payload", { field: "location" });
  try {
    return jsonOk({ ...(await loadSandwichToastChoices(ctx, id, location)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/toast`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < TOAST_MAP_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.toastItemGuid !== "string" || b.toastItemGuid.length === 0 || b.toastItemGuid.length > 100) return jsonError(400, "invalid_payload", { field: "toastItemGuid" });
  if (typeof b.toastItemName !== "string" || b.toastItemName.trim().length === 0) return jsonError(400, "invalid_payload", { field: "toastItemName" });
  try {
    return jsonOk({ ...(await linkSandwichToToast(ctx, { menuItemId: id, shopId: b.locationId, toastItemGuid: b.toastItemGuid, toastItemName: b.toastItemName })) }, 201);
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 7: Create `app/api/admin/catalog/menu-item/[id]/share/route.ts`**

```ts
/**
 * GET  /api/admin/catalog/menu-item/[id]/share — what sharing this shop's sandwich with every shop does (MoO+).
 * POST /api/admin/catalog/menu-item/[id]/share — share it: { expectedOwner, shareSkuIds } (Tier E; catalog Phase 4a).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { previewShareMenuItem, shareMenuItemWithAllShops } from "@/lib/catalog/share";
import { namedRefusal, SHARE_MIN } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/share`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHARE_MIN) return jsonError(403, "global_requires_moo");
  try {
    return jsonOk({ ...(await previewShareMenuItem(ctx, id)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/share`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHARE_MIN) return jsonError(403, "global_requires_moo");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.expectedOwner !== "string" || !UUID_RE.test(b.expectedOwner)) return jsonError(400, "invalid_payload", { field: "expectedOwner" });
  if (!Array.isArray(b.shareSkuIds) || b.shareSkuIds.length > 200 || !b.shareSkuIds.every((s) => typeof s === "string" && UUID_RE.test(s))) {
    return jsonError(400, "invalid_payload", { field: "shareSkuIds" });
  }
  try {
    return jsonOk({ ...(await shareMenuItemWithAllShops(ctx, { menuItemId: id, expectedOwner: b.expectedOwner, shareSkuIds: b.shareSkuIds as string[] })) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 8: Create `app/api/admin/catalog/sku/[id]/share/route.ts`**

```ts
/**
 * GET  /api/admin/catalog/sku/[id]/share — what sharing this shop's item with every shop does (MoO+).
 * POST /api/admin/catalog/sku/[id]/share — share it: { expectedOwner } (Tier E; catalog Phase 4a).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { previewShareSku, shareSkuWithAllShops } from "@/lib/catalog/share";
import { namedRefusal, SHARE_MIN } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/share`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHARE_MIN) return jsonError(403, "global_requires_moo");
  try {
    return jsonOk({ ...(await previewShareSku(ctx, id)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/share`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHARE_MIN) return jsonError(403, "global_requires_moo");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.expectedOwner !== "string" || !UUID_RE.test(b.expectedOwner)) return jsonError(400, "invalid_payload", { field: "expectedOwner" });
  try {
    await shareSkuWithAllShops(ctx, { skuId: id, expectedOwner: b.expectedOwner });
    return jsonOk({ ok: true });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 8b: Create `app/api/admin/catalog/recipe/[id]/share/route.ts`** (a shop's own prep recipe; lead decision 1)

```ts
/**
 * GET  /api/admin/catalog/recipe/[id]/share — what sharing this shop's own prep recipe with every shop does (MoO+).
 * POST /api/admin/catalog/recipe/[id]/share — share it: { expectedOwner, shareItemIds, shareSkuIds } (Tier E; catalog Phase 4a).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { previewShareRecipe, shareRecipeWithAllShops } from "@/lib/catalog/share";
import { namedRefusal, SHARE_MIN } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= 200 && v.every((s) => typeof s === "string" && UUID_RE.test(s)) ? (v as string[]) : null;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/share`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHARE_MIN) return jsonError(403, "global_requires_moo");
  try {
    return jsonOk({ ...(await previewShareRecipe(ctx, id)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/share`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHARE_MIN) return jsonError(403, "global_requires_moo");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.expectedOwner !== "string" || !UUID_RE.test(b.expectedOwner)) return jsonError(400, "invalid_payload", { field: "expectedOwner" });
  const items = uuidList(b.shareItemIds);
  const skus = uuidList(b.shareSkuIds);
  if (!items) return jsonError(400, "invalid_payload", { field: "shareItemIds" });
  if (!skus) return jsonError(400, "invalid_payload", { field: "shareSkuIds" });
  try {
    return jsonOk({ ...(await shareRecipeWithAllShops(ctx, { recipeId: id, expectedOwner: b.expectedOwner, shareItemIds: items, shareSkuIds: skus })) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 9: Create `app/api/admin/catalog/sku/[id]/swap/preview/route.ts` and `app/api/admin/catalog/sku/[id]/swap/route.ts`**

`swap/preview/route.ts`:

```ts
/**
 * POST /api/admin/catalog/sku/[id]/swap/preview — what swapping this item does (catalog Phase 4a; spec §5 job 3): every
 * recipe this scope makes with it (old line → new line), every sandwich's cost before and after, the product, and the
 * token the swap must bring back. A READ: no step-up. Body: { newSkuId, scope, mode, productName?, productNameEs?, note? }.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { previewSkuSwap } from "@/lib/catalog/swap-vendor";
import { parseSwapRequest } from "@/lib/catalog/swap-shared";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/swap/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const s = parseSwapRequest(parsed, id);
  if (!s.ok) return jsonError(400, "invalid_payload", { field: s.field });
  try {
    return jsonOk({ ...(await previewSkuSwap(ctx, s.request)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

`swap/route.ts`:

```ts
/**
 * POST /api/admin/catalog/sku/[id]/swap — Swap vendor (catalog Phase 4a, 0265): the preview's request plus its `token`.
 * The lib recomputes the preview, refuses `preview_stale`, and sends exactly that to start_sku_swap — one transaction.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { startSkuSwap } from "@/lib/catalog/swap-vendor";
import { parseSwapRequest } from "@/lib/catalog/swap-shared";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/swap`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.token !== "string" || b.token.length === 0 || b.token.length > 64) return jsonError(400, "invalid_payload", { field: "token" });
  const s = parseSwapRequest(parsed, id);
  if (!s.ok) return jsonError(400, "invalid_payload", { field: s.field });
  try {
    return jsonOk({ ...(await startSkuSwap(ctx, s.request, b.token)) }, 201);
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 10: Create `app/api/admin/catalog/swaps/[swapId]/back-to-normal/route.ts`**

```ts
/**
 * GET  /api/admin/catalog/swaps/[swapId]/back-to-normal — what Back to normal does (catalog Phase 4a, 0265): the
 *      versions that go back (retired or restored), the ones changed since (kept), the primary, and the token.
 * POST /api/admin/catalog/swaps/[swapId]/back-to-normal — do it: { token } (Tier E).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { endSkuSwap, previewBackToNormal } from "@/lib/catalog/swap-vendor";
import { NEW_THING_MIN, namedRefusal } from "@/lib/catalog/shop-owned-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ swapId: string }> }) {
  const { swapId } = await params;
  if (!UUID_RE.test(swapId)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/swaps/${swapId}/back-to-normal`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  try {
    return jsonOk({ ...(await previewBackToNormal(ctx, swapId)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ swapId: string }> }) {
  const { swapId } = await params;
  if (!UUID_RE.test(swapId)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/swaps/${swapId}/back-to-normal`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < NEW_THING_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.token !== "string" || b.token.length === 0 || b.token.length > 64) return jsonError(400, "invalid_payload", { field: "token" });
  try {
    return jsonOk({ ...(await endSkuSwap(ctx, swapId, b.token)) });
  } catch (e) {
    const n = namedRefusal(e);
    if (n) return jsonError(n.status, n.code, { message: n.message });
    throw e;
  }
}
```

- [ ] **Step 11: Register the tiers**

In `tests/step-up-tier-map.test.ts` `SERVER_TIER_MAP`, after 3a/3b's `app/api/admin/catalog/…` entries, add:

```ts
  // Catalog Phase 4a: the guided jobs and sharing are Tier E; the Toast link keeps the mapping's own Tier A. Previews are reads.
  "app/api/admin/catalog/jobs/new-item/route.ts": ["E"],
  "app/api/admin/catalog/jobs/new-sandwich/route.ts": ["E"],
  "app/api/admin/catalog/menu-item/[id]/share/route.ts": ["E"],
  "app/api/admin/catalog/menu-item/[id]/toast/route.ts": ["A"],
  "app/api/admin/catalog/sku/[id]/setup/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/share/route.ts": ["E"],
  "app/api/admin/catalog/recipe/[id]/share/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/swap/route.ts": ["E"],
  "app/api/admin/catalog/swaps/[swapId]/back-to-normal/route.ts": ["E"],
```

`CLIENT_TIER_MAP` does not change in 4a (no client calls these yet; 4b's pages do).

- [ ] **Step 12: Run, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output — the WHOLE route family typechecks (Astra 4a r1#8: `jsonOk` takes `Record<string, unknown>`, so every body is an object literal spread from the lib's result; never `jsonOk(await …)`).

Run: `npx vitest run tests/catalog-job-routes.test.ts tests/step-up-tier-map.test.ts` → expected: PASS.

```bash
git add app/api/admin/catalog/jobs "app/api/admin/catalog/sku/[id]/setup" "app/api/admin/catalog/sku/[id]/share" "app/api/admin/catalog/recipe/[id]/share" "app/api/admin/catalog/sku/[id]/swap" "app/api/admin/catalog/menu-item/[id]/toast" "app/api/admin/catalog/menu-item/[id]/share" "app/api/admin/catalog/swaps" tests/catalog-job-routes.test.ts tests/step-up-tier-map.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4a routes — new item, setup steps, new sandwich (+ live cost), Toast link (Tier A), share, swap, Back to normal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 13: The law (AGENTS.md)

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Amend 3a's section** `### Recipe and menu-item shop versions (0262–0263, catalog Phase 3, 2026-10-15)`:
  1. Replace the bullet `- **GM-created shop-only recipes are Phase 4** (lead decision 6): a shop version always versions an existing global recipe.` with `- **A shop version always versions a SHARED recipe.** A recipe a shop owns (0264) has no shop versions — see "Shop-only things" below.`
  2. In the bullet starting `- **AUTHORSHIP ON LEGACY EDITS.**`, replace `The 16-argument signature is kept only for code deployed before 3a and is **dropped by the first Phase 4 migration** — do not add a caller to it.` with `The 16-argument signature is dropped by 0266 (catalog Phase 4a), on its own, after the deploy gate; the 17-argument writer is the only one to call.`
  3. In 3b's bullet starting `- **The legacy builder's LINE writes are the global default's (MoO+):**`, replace `Creating a recipe, its header, outputs, yields and batch mode keep their GM floor until a later phase versions them.` with `A recipe or menu item a GM creates there is its shop's own since Phase 4a (every shop's is MoO+); header, outputs, yields and batch mode keep their GM floor.`

- [ ] **Step 2: Add the section** directly after that section:

```markdown
### Shop-only things and the guided jobs (0264–0266, catalog Phase 4a, 2026-10-15)

- **NEW THINGS A GM CREATES START AT ITS SHOP** (spec §3; lead decision 6). Ownership is a column in the house idiom: `vendor_items.location_id` (an item), and since 0264 `menu_items.location_id` + `recipes.location_id` (a SANDWICH: a menu item and the recipe that makes it) — NULL = every shop. Below MoO a new item, recipe or sandwich is the creator's shop's own (`newThingScopeGate` for the jobs; `creationScope` in `lib/recipes.ts` for the legacy builder — the one shop the GM works at, or the shop it names, `location_required` at several); creating anything for every shop is MoO+ (`createSku` with no shop: `global_requires_moo`). A GM keeps the permissions to finish its job at its shop (lead decision 1). Moving an item's shop (`updateSku`) is MoO+ (a move is a share by another name). Vendors stay global: a "local vendor" is a vendor row whose items are shop-owned.
- **THE OWNERSHIP LAW IS IN THE DATABASE (0264).** A shop-owned recipe makes ONLY menu items owned by the same shop; a shared recipe never makes a shop-owned menu item (deferred constraint triggers, judged at COMMIT). An owned recipe has no shop recipe versions and an owned menu item no shop overlay (before-insert triggers) — there is no default to differ from. An owned menu item is linked to Toast only at its owner and never offered to catering. An owner is set at creation (only `create_shop_sandwich` assigns one after the insert, through the transaction-local `co.shop_owner_assign`) and is only ever CLEARED, by sharing. A shop-owned recipe — prep or sandwich — makes only its shop's own items and menu items and uses only shared things or its shop's own (`line_other_shop`); an item its own recipe makes is shared WITH that recipe (`promoteItemToGlobal` refuses `share_the_recipe`; the database too). The legacy header / output writers answer 404 for another shop's own recipe.
- **VISIBLE ONLY TO ITS OWNER — at the one resolver point.** `ownerVisible(owner, scope)` (`lib/catalog/shop-owned-shared.ts`) is the one rule: `loadRecipeGraph` (by its version scope; `allShopOwned` only for the catalog list), `loadResolvedRecipeInputs`, readiness (`loadGraphRows`: the recipe row, its outputs and the items only it makes go with its lines), the costing board, the Toast auto-match / drift pool (`filterOwnedEntities`; a shop's own prep items join its pool) and the Toast manual link all apply it; a shop's own prep item is costed (weights board, `ownerCostSources`) and portioned (Toast) in its OWNER's graph; `loadRecipeInputsAcrossScopes` ("used anywhere") keeps every shop's. **A new reader of recipes or menu items for a scope applies `ownerVisible` — never its own rule.** With nothing owned, nothing is hidden: the Phase 3 goldens hold (`tests/shop-owned-equivalence.test.ts`).
- **THE OWNER EDITS ITS OWN THING AS ITSELF.** An owned recipe's lines are written at the DEFAULT scope by its shop's GM (`ownedAwareRecipeGate` before I/O + `ownerWriteCheck` after the one read, in `lib/admin/recipe-versions.ts`); a shop version of it refuses `shop_owned_edit_here`. An owned sandwich's price is `menu_items.menu_price`, set by its shop's GM (`updateMenuPrice`); every other menu price stays MoO+. The recipe page serves an owned recipe in its default view (`view.owner`).
- **A RIGHT THAT COMES FROM OWNING A THING RIDES THE WRITE** (Astra round 1 P1). The owner the lib authorized goes INTO the write: the recipe through `save_owned_recipe_version` (the owner compared under the graph lock, which sharing also takes), the menu price, `updateSku`, `deactivateSku`, `setSkuPriceBasis` and `promoteItemToGlobal` with `location_id` in their UPDATE predicate. A share landing between the read and the write refuses `ownership_changed` (409, en/es). **A new writer whose permission depends on who owns the row does the same — never a read, a check, then a write by id.** `updateSku` writes `location_id` only when it changes (a stale form never re-owns a shared item).
- **A SHOP VERSION OF A SHARED RECIPE names only shared things or that shop's own** (decision (a), Astra round 1): another shop's own SKU or item refuses `line_other_shop`, the line named — in `writeRecipeVersion` and in SQL (`recipe_version_lines_owner_law`, every inserted line). The recipe page's picker at a shop never offers them. A shared recipe's DEFAULT is not policed for shop-owned components (MoO's call; existing template items stay).
- **PRODUCT RESOLUTION NEVER PICKS ANOTHER SHOP'S OWN SKU — AT ANY RUNG** (lead decision 2; Astra round 1). In `loadProductIndex` a member a shop owns is eligible only at that shop (a regular-vendor one never at the global default; a store copy keeps 0216's rule), so the primary, "most recently received" and "any" all skip it and the walk's rescue falls through to a shared member. Never filter a resolved member in a consumer — that is a second resolver.
- **SHARE WITH EVERY SHOP = MoO+, ONE TRANSACTION.** `share_shop_owned_menu_item` clears the owner of the sandwich, every recipe that makes it and EXACTLY the shop's own items those recipes use (the person sees and names them); another shop's own item blocks it (`uses_other_shop_sku`). `share_shop_owned_recipe` shares a prep recipe with EXACTLY the shop's own items it makes and SKUs it uses; a recipe or sandwich that uses one of the shop's own items waits until that item's recipe is shared (`uses_shop_only_item`). `share_shop_owned_sku` shares one item; its owner keeps its own pack / price versions (2a). All compare-and-set the owner the person saw (`ownership_changed`).
- **A SHOP-ONLY SKU APPEARS ONLY AT ITS SHOP** (lead decision 2): the ordering walk, the par pass, the count roster and a shop's view of a vendor's guide (`loadOrderGuideForShop`) apply `ownerVisible` at their one read; product resolution decides eligibility for the walk's rescue; purchase orders follow the par pass. The vendor's sheet editor keeps the whole guide (a filtered save would delete lines) and labels each shop's own line "Only at <shop>" (`loadGuideSkuShopNames`; decision (b)). Store copies leaving other shops' count sheets was gated by a pre-merge count of the last 30 days (decision (c)). Catering quote pickers (staff and portal) list only menu items visible at the quote's shop (lead decision 5); catering is otherwise untouched, and the Catering Toast tab stays as it is (lead decision 6).
- **PRODUCT PRIMARIES ARE UNDATED** (lead decision 4; the existing law — recipes and product resolution stay current): re-running a past business date after a swap resolves product-PINNED lines through today's primary; lines that named an item directly are dated (0262) and keep that day's item.
- **THE JOBS' WRITES ARE ONE TRANSACTION EACH, AND THEIR SETUP IS ONE WRITER EACH.** New item → `create_catalog_sku` (the row + 2a's first pack version + first price, first-only below MoO; one vendor item number among what a shop can see, SERIALIZED by a transaction lock on (vendor, number)); its shop setup — par, order days, order-guide line, where it's used, barcode — is `setUpItemAtShop`, one step at a time through the writer that already owns each step (never a second par / rhythm / guide / recipe / barcode writer). New sandwich → `create_shop_sandwich` (menu item + recipe through 0262's `create_recipe_full`, under the graph lock); its live cost is the shop's graph with the draft as a `recipeOverrides` overlay and THE costing rollup — never a second costing formula. The Toast link is `manualMap` (Tier A, its own tier).
- **SWAP VENDOR (0265) IS BOUND TO ITS PREVIEW.** `previewSkuSwap` rewrites every line this scope's recipes have for the old item (`swapLine`: a measure carries — a count is a portion; a pack label with the same contents carries; any other pack label becomes ounces of the OLD pack; a label the old item cannot weigh blocks the swap) and costs every sandwich before / after; its token binds versions, lines and dependency snapshots. `start_sku_swap` re-enumerates the recipes it writes AND the recipes that pin the product under the graph lock and refuses `recipes_changed` if either set differs from the preview's; re-takes every snapshot (both sets) under its locks BEFORE writing; groups both items under one product (a NEW product's default primary is pinned to the OLD item — no other shop moves), saves every recipe version through 0262's writer, points the scope's primary at the new item, and records the swap. A shop's own recipe is switched as itself. "For good everywhere" is MoO+ and writes the default (shops with their own version keep it). The preview costs the primary the swap will set THROUGH the one resolver (`loadRecipeGraph({ productProposal })`) and hands back the exact request it hashed. **Back to normal** (`end_sku_swap`) LOCKS the product, its primary rows and the joined items first, then retires a swap version that replaced nothing, restores one that replaced a version, KEEPS (and names) one changed since, and puts the primary back only if the swap's choice still stands — a conditional write whose row count is the answer — the swap's own primary row is the one `product_primaries` row the app ever deletes. A swap never writes a par and never switches the old item off; Back to normal also undoes the product grouping the swap made — exactly (lead decision 3).
- **REFUSALS ARE NAMED.** 0264/0265 raise `P0001 'shop_owned:<code>'` / `'swap:<code>'`; `shopOwnedErrorFromRpc` keeps the code and status; every job route answers `namedRefusal(e)` (any typed 4xx error), with `line: { position, reason }` when one draft line is refused.
- **The 16-argument `update_recipe_input_atomic` is dropped by 0266 — its own migration, applied only after production serves code with no caller of it, READY, older deployments drained** (a migration cannot see which code is serving; the drop must never ride a schema the new code needs first). Re-creating it from 0262's text is the rollback.
- **A job route answers `jsonOk({ ...(await lib()) })`** — `jsonOk` takes `Record<string, unknown>`; a lib's named interface is TS2345 there.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs(agents): shop-only things and the guided jobs (0264–0266)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 14: The real-SQL scenario (sim; always rolls back)

**Files:**
- Create: `scripts/catalog-jobs/sim-scenario.sql`

- [ ] **Step 1: Create `scripts/catalog-jobs/sim-scenario.sql`**

```sql
-- Catalog Phase 4a — 0264 + 0265 for real, on the SIM, in one transaction that ALWAYS raises at the end (nothing
-- persists). Expected outcome: ERROR 'catalog jobs scenario: OK (rolled back)'. Any other message is a defect.
-- Run through the Supabase MCP execute_sql on the sim project (Task 15 Step 3).
do $$
declare
  v_actor   uuid;
  v_shop    uuid;
  v_other   uuid;
  v_sku     jsonb;
  v_new     uuid;
  v_sand    jsonb;
  v_recipe  uuid;
  v_old     uuid;
  v_head    uuid;
  v_lines   jsonb;
  v_swap    jsonb;
  v_end     jsonb;
  v_msg     text;
begin
  select id into v_actor from public.users where active and role in ('owner', 'moo', 'cgs') order by id limit 1;
  select id into v_shop from public.locations where active order by name, id limit 1;
  select id into v_other from public.locations where active and id <> v_shop order by name, id limit 1;
  if v_actor is null or v_shop is null or v_other is null then
    raise exception 'scenario setup: needs an owner/moo user and two active shops';
  end if;

  -- (0) 0266 is NOT applied yet (it waits for the deploy gate): both update_recipe_input_atomic signatures are here.
  if to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)') is null then
    raise exception 'scenario (0): the 17-argument writer is missing';
  end if;

  -- (4) New item: the row, its first pack version, its first price — owned by the shop.
  v_sku := public.create_catalog_sku(
    jsonb_build_object('name', 'Scenario pickles', 'location_id', v_shop, 'sku_class', 'raw'),
    '[{"label":"case","containsQty":2,"containsIndex":null,"containsMeasureUnit":"lb"}]'::jsonb,
    10, current_date, v_actor, true);
  v_new := (v_sku->>'sku_id')::uuid;
  if (select location_id from public.vendor_items where id = v_new) is distinct from v_shop then
    raise exception 'scenario (4): the new item is not owned by its shop';
  end if;
  if (select pack_format from public.vendor_items where id = v_new) <> 'case' then
    raise exception 'scenario (4): the flat mirror did not follow the first pack version';
  end if;
  if not exists (select 1 from public.sku_pack_versions where sku_id = v_new and location_id is null and active) then
    raise exception 'scenario (4): no live global pack version';
  end if;
  if not exists (select 1 from public.vendor_price_history where vendor_item_id = v_new and location_id is null) then
    raise exception 'scenario (4): no first price';
  end if;
  -- (4b) One vendor item number among what a shop can see — both directions (a shop's own vs every shop's).
  update public.vendor_items set vendor_id = (select id from public.vendors where active order by id limit 1), item_number = 'SCN-1' where id = v_new;
  begin
    perform public.create_catalog_sku(jsonb_build_object('name', 'Scenario dup', 'vendor_id', (select vendor_id from public.vendor_items where id = v_new),
      'item_number', 'scn-1', 'sku_class', 'raw'), '[{"label":"case","containsQty":2,"containsIndex":null,"containsMeasureUnit":"lb"}]'::jsonb,
      null, null, v_actor, false);
    raise exception 'scenario (4b): an every-shop item took a number a shop already uses';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%shop_owned:item_number_taken%' then raise exception 'scenario (4b): unexpected %', v_msg; end if;
  end;
  begin
    perform public.create_catalog_sku(jsonb_build_object('name', 'Scenario dup 2', 'vendor_id', (select vendor_id from public.vendor_items where id = v_new),
      'item_number', 'SCN-1', 'location_id', v_other, 'sku_class', 'raw'), '[{"label":"case","containsQty":2,"containsIndex":null,"containsMeasureUnit":"lb"}]'::jsonb,
      null, null, v_actor, true);
  exception when others then
    raise exception 'scenario (4b): another shop could not reuse a number only this shop uses: %', sqlerrm;
  end;

  -- (a) A shop version of a shared recipe never names another shop's own item (decision (a)).
  select r.id into v_recipe from public.recipes r where r.active and r.location_id is null
     and exists (select 1 from public.recipe_inputs ri where ri.recipe_id = r.id)
     and not exists (select 1 from public.recipe_versions v where v.recipe_id = r.id and v.location_id = v_other and v.active)
   order by r.id limit 1;
  select id into v_head from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  v_lines := (select jsonb_agg(jsonb_build_object('component_sku_id', v_new, 'quantity', 1, 'unit', 'lb', 'portioned', false, 'display_order', 0)));
  begin
    perform public.save_recipe_version(v_recipe, v_other, v_lines, null, v_head, 'scenario', v_actor, null, null, null,
      public.recipe_change_snapshot(v_recipe, v_other, v_lines));
    raise exception 'scenario (a): another shop''s version named this shop''s own item';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%recipe_version:line_other_shop%' then raise exception 'scenario (a): unexpected %', v_msg; end if;
  end;

  -- (3) New sandwich with that item: menu item + recipe, owned; journaled; never linkable at another shop.
  v_sand := public.create_shop_sandwich(v_shop, 'Scenario Hero ' || substr(md5(random()::text), 1, 6), null, 'Subs', 11.5,
    jsonb_build_array(jsonb_build_object('component_sku_id', v_new, 'quantity', 0.25, 'unit', 'lb', 'portioned', false, 'display_order', 0)),
    1, v_actor);
  v_recipe := (v_sand->>'recipe_id')::uuid;
  if (select location_id from public.recipes where id = v_recipe) is distinct from v_shop then
    raise exception 'scenario (3): the recipe is not owned by its shop';
  end if;
  if not exists (select 1 from public.recipe_versions where recipe_id = v_recipe and location_id is null and active) then
    raise exception 'scenario (3): the journal did not open the recipe''s head';
  end if;
  begin
    insert into public.toast_menu_map (location_id, menu_item_id, toast_item_guid, toast_item_name, match_status, created_by)
    values (v_other, (v_sand->>'menu_item_id')::uuid, 'scenario-guid', 'Scenario', 'confirmed', v_actor);
    raise exception 'scenario (2): a Toast link at another shop was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%shop_owned:toast_other_shop%' then raise exception 'scenario (2): unexpected refusal %', v_msg; end if;
  end;

  -- (2b) The owner's own edit is bound to its owner: allowed now; after the share below it refuses ownership_changed.
  select id into v_head from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  v_lines := (select jsonb_agg(jsonb_build_object('component_sku_id', v_new, 'quantity', 0.5, 'unit', 'lb', 'portioned', false, 'display_order', 0)));
  perform public.save_owned_recipe_version(v_shop, v_recipe, null, v_lines, v_head, null, 'scenario', v_actor, null, null, null,
    public.recipe_change_snapshot(v_recipe, null, v_lines));

  -- (5) Share: the sandwich, its recipe and the shop's own item, in one act.
  perform public.share_shop_owned_menu_item((v_sand->>'menu_item_id')::uuid, v_shop, array[v_new], v_actor);
  begin
    select id into v_head from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
    perform public.save_owned_recipe_version(v_shop, v_recipe, null, v_lines, v_head, null, 'scenario', v_actor, null, null, null,
      public.recipe_change_snapshot(v_recipe, null, v_lines));
    raise exception 'scenario (2b): a shop edit landed on a shared recipe';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%shop_owned:ownership_changed%' then raise exception 'scenario (2b): unexpected %', v_msg; end if;
  end;
  if exists (select 1 from public.menu_items where id = (v_sand->>'menu_item_id')::uuid and location_id is not null)
     or exists (select 1 from public.recipes where id = v_recipe and location_id is not null)
     or exists (select 1 from public.vendor_items where id = v_new and location_id is not null) then
    raise exception 'scenario (5): sharing left an owner behind';
  end if;

  -- (0265) Swap a shared single-vendor item on a shared recipe at the shop to the (now shared) new item, then Back to normal.
  select ri.recipe_id, ri.component_sku_id into v_recipe, v_old
    from public.recipe_inputs ri
    join public.recipes r on r.id = ri.recipe_id and r.active and r.location_id is null
    join public.vendor_items vi on vi.id = ri.component_sku_id and vi.active and vi.location_id is null and vi.product_id is null
   where not exists (select 1 from public.recipe_versions v where v.recipe_id = ri.recipe_id and v.location_id = v_shop and v.active)
   order by ri.recipe_id, ri.id limit 1;
  if v_recipe is null then raise exception 'scenario setup: no shared recipe with a single-vendor item line'; end if;
  select id into v_head from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  v_lines := (select jsonb_agg(jsonb_build_object(
      'keep_id', ri.id,
      'component_sku_id', case when ri.component_sku_id = v_old then v_new else ri.component_sku_id end,
      'component_item_id', ri.component_item_id, 'component_product_id', ri.component_product_id,
      'quantity', ri.quantity, 'unit', ri.unit, 'each_container_label', ri.each_container_label, 'portioned', ri.portioned) order by ri.display_order, ri.id)
    from public.recipe_inputs ri where ri.recipe_id = v_recipe);
  -- The SET must be complete (0265 re-enumerates it): every recipe at this shop that names the old item, each with its swap lines.
  if public.swap_affected_recipes(v_shop, v_old) <> array[v_recipe] then
    raise exception 'scenario setup: the old item is used by more than one recipe at the shop — pick another (or extend the scenario)';
  end if;
  v_swap := public.start_sku_swap(v_shop, v_old, v_new, 'for_now',
    jsonb_build_object('create', jsonb_build_object('name', 'Scenario product ' || substr(md5(random()::text), 1, 6))),
    jsonb_build_array(jsonb_build_object('recipe_id', v_recipe, 'location', v_shop, 'expected', null, 'based_on', v_head,
      'lines', v_lines, 'snapshot', public.recipe_change_snapshot(v_recipe, v_shop, v_lines))),
    '[]'::jsonb, 'scenario', v_actor);
  if not exists (select 1 from public.recipe_versions where recipe_id = v_recipe and location_id = v_shop and active) then
    raise exception 'scenario (swap): the shop has no version';
  end if;
  if (select primary_sku_id from public.product_primaries where product_id = (v_swap->>'product_id')::uuid and location_id is null) <> v_old then
    raise exception 'scenario (swap): the new product''s default is not pinned to the old item';
  end if;
  if (select primary_sku_id from public.product_primaries where product_id = (v_swap->>'product_id')::uuid and location_id = v_shop) <> v_new then
    raise exception 'scenario (swap): the shop does not point at the new item';
  end if;

  v_end := public.end_sku_swap((v_swap->>'swap_id')::uuid,
    jsonb_build_object(v_recipe::text, public.recipe_change_snapshot(v_recipe, v_shop, public.swap_recipe_default_lines(v_recipe))), v_actor);
  if v_end->>'primary' <> 'restored' or jsonb_array_length(v_end->'back') <> 1 then
    raise exception 'scenario (back): unexpected result %', v_end;
  end if;
  if exists (select 1 from public.recipe_versions where recipe_id = v_recipe and location_id = v_shop and active) then
    raise exception 'scenario (back): the shop still has its swap version';
  end if;
  if exists (select 1 from public.product_primaries where product_id = (v_swap->>'product_id')::uuid and location_id = v_shop) then
    raise exception 'scenario (back): the shop''s primary row is still there';
  end if;

  raise exception 'catalog jobs scenario: OK (rolled back)';
end $$;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/catalog-jobs/sim-scenario.sql
git commit -m "$(cat <<'EOF'
test(catalog): Phase 4a real-SQL scenario for 0264 + 0265 (sim; always rolls back)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 14b: The races PGlite cannot run (sim, real HTTP, concurrent)

PGlite is one connection, so the three interleavings Astra round 1 named are proved against the sim with the existing harness (`scripts/sim/concurrency/driver.mjs`): two creates of one vendor number, Back to normal against a primary change, a share against a GM's price edit.

**Files:**
- Create: `scripts/sim/concurrency/catalog-job-races.mjs`

- [ ] **Step 1: Create `scripts/sim/concurrency/catalog-job-races.mjs`**

```js
import { pathToFileURL } from "node:url";
import { Session, findUser, fireSimultaneous, makeReport, db, LOC, personaFor } from "./driver.mjs";
/**
 * CATALOG PHASE 4a RACES (Astra round 1). Needs 0264 + 0265 on the sim, the 4a branch on :3100, a GM at EM and the MoO.
 *   A · two New-item creates of ONE vendor number at the same instant (one for the shop, one for every shop) → exactly one SKU.
 *   B · Back to normal racing a primary change at the shop → the later human choice stands; the swap says "changed_since"
 *       or the primary change lands after the restore — never a restore that erased a choice made after it.
 *   C · a GM's price edit on its own sandwich racing the MoO's share → never "200 and shared with the GM's price written
 *       after the share" (audit order proves which came first).
 */
const loc = LOC.EM;
const today = new Date().toISOString().slice(0, 10);
const LEVELS = [{ label: "case", containsQty: 2, containsIndex: null, containsMeasureUnit: "lb" }];

export async function run() {
  const { check, done } = makeReport("CATALOG JOB RACES");
  const gm = await new Session(await findUser(loc, "gm", personaFor({ locationCode: "EM", role: "gm" }).name), "1111").login(loc);
  const moo = await new Session(await findUser(null, "moo", personaFor({ locationCode: "EM", role: "moo" }).name), "2222").login(loc);
  await gm.unlockCatalogWindow(); await moo.unlockCatalogWindow(); // Tier E (the harness's password unlock)
  const { data: vendor } = await db.from("vendors").select("id").eq("active", true).order("id").limit(1).maybeSingle();
  const number = `RACE-${Date.now()}`;

  // ── A ──
  const create = (s, scope) => () => s.call("POST", "/api/admin/catalog/jobs/new-item",
    { scope, vendorId: vendor.id, name: `Race item ${number}`, itemNumber: number, skuClass: "raw", levels: LEVELS, unitPrice: 10, priceDate: today });
  const a = await fireSimultaneous([create(gm, loc), create(moo, null)]);
  const { count: made } = await db.from("vendor_items").select("*", { count: "exact", head: true }).eq("vendor_id", vendor.id).ilike("item_number", number);
  check("A · two creates of one vendor number → exactly ONE SKU; the other is item_number_taken", made === 1 && a.some((r) => r.code === "item_number_taken"),
    `${made} SKUs, responses ${a.map((r) => r.status + (r.code ? "/" + r.code : "")).join(",")}`);

  // ── B ── a product-only swap on a two-member product the sim seeds (s1 → s2), then Back to normal vs setPrimary.
  const { data: prod } = await db.from("products").select("id").eq("active", true).order("id").limit(1).maybeSingle();
  const { data: members } = await db.from("vendor_items").select("id").eq("product_id", prod.id).eq("active", true).is("location_id", null).order("id").limit(2);
  if ((members ?? []).length < 2) { check("B setup: a product with two shared members", false, "none on the sim"); }
  else {
    const body = { newSkuId: members[1].id, scope: loc, mode: "for_now" };
    const pv = await gm.call("POST", `/api/admin/catalog/sku/${members[0].id}/swap/preview`, body);
    const st = await gm.call("POST", `/api/admin/catalog/sku/${members[0].id}/swap`, { ...pv.data.request, token: pv.data.token });
    const back = await gm.call("GET", `/api/admin/catalog/swaps/${st.data.swapId}/back-to-normal`);
    const b = await fireSimultaneous([
      () => gm.call("POST", `/api/admin/catalog/swaps/${st.data.swapId}/back-to-normal`, { token: back.data.token }),
      () => moo.call("POST", `/api/admin/products/${prod.id}/primary`, { locationId: loc, primarySkuId: members[0].id }),
    ]);
    const { data: row } = await db.from("product_primaries").select("primary_sku_id").eq("product_id", prod.id).eq("location_id", loc).maybeSingle();
    const end = b[0].data ?? {};
    // Either the restore ran first (its row is gone; the MoO's choice then re-made or updated it) or the choice ran first
    // (the swap reports changed_since and the row names the MoO's choice). Never: "restored" AND the choice lost.
    check("B · Back to normal never erases a primary chosen after it", end.primary === "changed_since" ? row?.primary_sku_id === members[0].id : true,
      `end ${JSON.stringify(end)}, row ${JSON.stringify(row)}, responses ${b.map((r) => r.status + (r.code ? "/" + r.code : "")).join(",")}`);
  }

  // ── C ── the GM's own sandwich: price edit vs the MoO's share.
  const sand = await gm.call("POST", "/api/admin/catalog/jobs/new-sandwich", { shopId: loc, name: `Race hero ${number}`, nameEs: null, section: "Subs", price: 10,
    lines: [{ componentSkuId: members?.[0]?.id, componentItemId: null, componentProductId: null, quantity: 2, unit: "oz", eachContainerLabel: null, portioned: false }] });
  const menuId = sand.data?.menuItemId;
  const sp = await moo.call("GET", `/api/admin/catalog/menu-item/${menuId}/share`);
  const c = await fireSimultaneous([
    () => gm.call("PATCH", `/api/admin/menu-items/${menuId}/price`, { menuPrice: 12, expectedMenuPrice: 10 }),
    () => moo.call("POST", `/api/admin/catalog/menu-item/${menuId}/share`, { expectedOwner: loc, shareSkuIds: sp.data?.shareSkuIds ?? [] }),
  ]);
  const { data: audits } = await db.from("audit_log").select("action, created_at").eq("resource_id", menuId).in("action", ["menu_item.update", "menu_item.share"]).order("created_at");
  const priceAfterShare = (audits ?? []).findIndex((x) => x.action === "menu_item.update") > (audits ?? []).findIndex((x) => x.action === "menu_item.share");
  check("C · a GM price edit never lands on a sandwich already shared (ownership_changed instead)",
    !(c[0].status === 200 && priceAfterShare), `responses ${c.map((r) => r.status + (r.code ? "/" + r.code : "")).join(",")}, audit ${JSON.stringify(audits)}`);
  return done();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().then((ok) => process.exit(ok ? 0 : 1));
```

(The driver's `Session` names — `login`, `call`, the catalog-window unlock, the product-primary route — follow `driver.mjs` and `ordering-races.mjs`; adapt a name to the driver's actual one if it differs, never the assertions.)

- [ ] **Step 2: Commit**

```bash
git add scripts/sim/concurrency/catalog-job-races.mjs
git commit -m "$(cat <<'EOF'
test(catalog): Phase 4a sim races — one vendor number, Back to normal vs a primary change, a share vs a price edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 15: Apply runbook — sim → prod dry-run with rollback → prod → merge → the 0266 deploy gate → stamp

**Gate:** CC has reviewed the PR (Astra review to APPROVE per spec §7); CI is green; Juan gives the word for each production step.

Use the Supabase MCP. The sim project is the one `scripts/sim/dev-sim.mjs` points at; prod is `bgcvurheqzylyfehqgzh`. **0264 and 0265 apply BEFORE the 4a code merges** (the code reads `recipes.location_id`, `menu_items.location_id` and `sku_swaps`). Both are backward compatible with the 3b code running now: every existing row stays shared, the triggers fire only on owned rows (and on shop-version lines naming another shop's own thing, which no row does — Step 1 checks), and neither touches `update_recipe_input_atomic`. **0266 applies LAST, after the merge, behind the deploy gate (Steps 9–10).**

- [ ] **Step 1: Pre-flight on prod (read-only).**

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 4;   -- 0262, 0263 applied
select to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)') is not null as old_sig,
       to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid)') is not null as new_sig;  -- true, true
-- No SQL body still calls the writer (only the lib does, with p_actor).
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname <> 'update_recipe_input_atomic' and p.prosrc ilike '%update_recipe_input_atomic(%';  -- 0 rows
-- The columns 0264 / 0265 write exist.
select table_name, column_name from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (
  ('menu_items','catering_available'), ('menu_items','section'), ('menu_items','updated_by'), ('vendor_items','item_number'),
  ('vendor_items','avg_oz_per_each'), ('vendor_items','sku_class'), ('vendor_items','updated_by'), ('products','created_by'),
  ('products','updated_by'), ('product_primaries','note'), ('product_primaries','updated_by'), ('product_primaries','updated_at'),
  ('toast_menu_map','active')) order by 1, 2;   -- 13 rows
select count(*) from public.menu_items where catering_available;   -- record (owned items can never be among them)
-- Lead decision 2: shop-owned SKUs today (store copies) — after the merge they leave the OTHER shops' walk, par pass and count sheet.
select location_id, count(*) from public.vendor_items where location_id is not null and active group by 1 order by 1;
-- The templates' shop items that SHARED recipes already make or use (left as they are; recorded).
select count(*) from public.recipe_outputs o join public.items i on i.id = o.output_item_id join public.recipes r on r.id = o.recipe_id
 where i.location_id is not null and r.active;
select count(*) from public.recipe_inputs ri join public.items i on i.id = ri.component_item_id where i.location_id is not null;
-- Decision (a): shop-version lines that ALREADY name another shop's own SKU or item (0264's trigger judges new lines only).  -- expect 0
select count(*) from public.recipe_version_lines l join public.recipe_versions v on v.id = l.version_id and v.location_id is not null
  left join public.vendor_items vi on vi.id = l.component_sku_id left join public.items i on i.id = l.component_item_id
 where (vi.location_id is not null and vi.location_id <> v.location_id) or (i.location_id is not null and i.location_id <> v.location_id);
-- Product resolution (Task 5b Step 3b): shop-owned REGULAR-vendor product members — after the merge they resolve only at their shop.
select vi.id, vi.name, vi.location_id, vi.product_id from public.vendor_items vi join public.vendors v on v.id = vi.vendor_id
 where vi.product_id is not null and vi.location_id is not null and v.source_kind <> 'store' and vi.active order by 1;
-- create_catalog_sku's rule vs existing data: (vendor, number) pairs already visible together (recorded; the job refuses NEW ones).
select a.vendor_id, lower(btrim(a.item_number)) as num, count(*) from public.vendor_items a
 where a.active and a.vendor_id is not null and a.item_number is not null group by 1, 2 having count(*) > 1 order by 3 desc;
```

Record the numbers in the PR. Any missing column is a STOP (report; the plan's writers assume them). A nonzero decision-(a) count is a STOP (report the lines; 0264 would refuse re-saving them).

- [ ] **Step 1b: The PRE-MERGE count gate for store copies and other shop-owned SKUs (decision (c)).** Lead decision 2 takes a shop's own SKU off every OTHER shop's count sheet. Before the merge, on prod (read-only):

```sql
-- Nonzero counts in the last 30 days of a SKU one shop owns, counted at ANOTHER shop. ANY ROW = PAUSE THE MERGE FOR JUAN.
select e.location_id                      as counted_at_shop,
       cs.name                            as counted_at_shop_name,
       vi.location_id                     as owner_shop,
       os.name                            as owner_shop_name,
       vi.id                              as sku_id,
       vi.name                            as sku_name,
       v.source_kind,
       count(*)                           as nonzero_lines,
       sum(l.resolved_oz)                 as oz_counted,
       max(e.counted_at)                  as last_counted_at
  from public.sku_count_lines l
  join public.sku_count_events e on e.id = l.count_event_id
  join public.vendor_items vi on vi.id = l.sku_id
  left join public.vendors v on v.id = vi.vendor_id
  left join public.locations cs on cs.id = e.location_id
  left join public.locations os on os.id = vi.location_id
 where vi.location_id is not null
   and vi.location_id <> e.location_id
   and e.counted_at >= now() - interval '30 days'
   and (l.qty > 0 or l.resolved_oz > 0)
 group by 1, 2, 3, 4, 5, 6, 7
 order by last_counted_at desc;
```

Expected: **0 rows → proceed.** **Any row → STOP and send Juan the table** (which shop counts which other shop's item, how often, how much): those counts disappear from that shop's sheet at the merge. The merge waits for Juan's word (share the item, or accept the loss of the line). Superseded count events are included on purpose — a shop that counted it at all in 30 days relies on it.

- [ ] **Step 2: Sim apply.** `apply_migration` name `0264_catalog_shop_owned` (the file body), then `0265_sku_swaps`. Run every VERIFY query in both headers. Expected: as annotated. Then `notify pgrst, 'reload schema';`. Both `update_recipe_input_atomic` signatures are still there: `select count(*) from pg_proc where proname = 'update_recipe_input_atomic';` → 2 (0266 comes after the deploy gate, Step 10 — on the sim too, after Step 4's smoke).

- [ ] **Step 3: Sim real-SQL scenario.** Run `scripts/catalog-jobs/sim-scenario.sql` through `execute_sql` on the sim. Expected: it fails with exactly `catalog jobs scenario: OK (rolled back)`. Then confirm nothing persisted: `select count(*) from public.sku_swaps;` → 0, `select count(*) from public.menu_items where name like 'Scenario Hero %';` → 0.

- [ ] **Step 3b: Sim races.** With the 4a branch on :3100: `node scripts/sim/concurrency/catalog-job-races.mjs` → every check PASS (A: one SKU; B: no erased primary; C: no price written after a share).

- [ ] **Step 4: Sim smoke** (`node scripts/sim/dev-sim.mjs`, the 4a branch; signed in with the edit window open — Tier E — and, for the Toast link, Tier A):
  1. The Phase 3 numbers: `/admin/menu-costing` (All shops and each shop), `/ordering`, `/operations/counts` show the same numbers as before the apply (screenshot).
  2. As a GM: `POST /api/admin/catalog/jobs/new-item` with `{"scope":"<GM_SHOP_ID>","vendorId":"<VENDOR_ID>","name":"Sim pickles","itemNumber":"SIM-1","levels":[{"label":"case","containsQty":2,"containsIndex":null,"containsMeasureUnit":"lb"}],"unitPrice":10,"priceDate":"<today>"}` → `201 {"skuId":…,"ownerLocationId":"<GM_SHOP_ID>",…}`; the same with `"scope":null` → `403 global_requires_moo`. Then `POST /api/admin/catalog/sku/<SKU_ID>/setup` with `{"shopId":"<GM_SHOP_ID>","step":{"kind":"par","weekdayPar":2,"weekendPar":3}}` → `200`.
  3. As a GM: `POST /api/admin/catalog/jobs/new-sandwich/preview` with a two-line draft → `200 {"status":"costed","cost":…}`; `POST …/jobs/new-sandwich` → `201`; `/admin/menu-costing?location=<GM_SHOP_ID>` lists it with its price, the other shop's board does not; `GET /api/admin/catalog/menu-item/<MENU_ID>/toast?location=<GM_SHOP_ID>` → `200` with `reachable` and suggestions (fixture Toast on the sim).
  4. As a GM: `POST /api/admin/catalog/sku/<OLD_SKU>/swap/preview` with `{"newSkuId":"<NEW_SKU>","scope":"<GM_SHOP_ID>","mode":"for_now"}` → `200` with recipes, costs and a token; `POST …/swap` with the same body + `"token"` → `201`; the shop's board shows the changed costs, the other shop's does not; `GET /api/admin/catalog/swaps/<SWAP_ID>/back-to-normal` then `POST` with its token → `200 {"back":[…],"kept":[],"primary":"restored"}`; the costs return.
  5. As MoO: `GET /api/admin/catalog/menu-item/<MENU_ID>/share` → the preview; `POST` with `{"expectedOwner":"<GM_SHOP_ID>","shareSkuIds":[…]}` → `200`; every shop's board lists the sandwich.

- [ ] **Step 5: Prod dry-run with rollback.** Through `execute_sql` on prod: `begin;` · the 0264 body without its own `begin;`/`commit;` · the 0265 body without its own `begin;`/`commit;` · the VERIFY queries of both · `rollback;`. Expected: every VERIFY as annotated, then the rollback; confirm with `select to_regclass('public.sku_swaps');` → `null`.

- [ ] **Step 6: Prod apply** (Juan's word): `apply_migration` `0264_catalog_shop_owned`, then `0265_sku_swaps`; `notify pgrst, 'reload schema';`; re-run the VERIFY queries read-only.

- [ ] **Step 7: Merge** (Juan clicks the production merge — only after Step 1b returned 0 rows or Juan gave his word on the rows it listed). Vercel deploys main.

- [ ] **Step 8: Stamp 0264 / 0265** in a docs-only follow-up commit on main: under each gate line add `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '<name>')`; update the AGENTS.md "Current state" lineage line to 0265.

- [ ] **Step 9: The 0266 deploy gate (all four, recorded in the PR).** 0266 is irreversible for any caller of the 16-argument signature, so it waits for evidence, not a promise:
  1. **The serving deployment carries the 17-argument caller.** Vercel MCP: `list_deployments` for the project, target production → the deployment the production alias points at is `READY`, and its git commit is a descendant of 3a's merge (`git merge-base --is-ancestor <3a merge sha> <deployed sha>` → exit 0). (`tests/drop-recipe-input-16arg-migration.test.ts` already proves no code on main calls the old signature.)
  2. **Older deployments are drained.** At least 10 minutes (twice the 300 s function limit) have passed since that alias switch, so no request started on an older deployment is still running.
  3. **Nothing can roll back past 3a without knowing.** Juan agrees that an instant rollback to a deployment older than 3a's merge first re-creates the 16-argument function (its body is in 0262; one `create function` — keep the text in the PR).
  4. **Prod shows no recent calls, where it can.** `show track_functions;` — if it is `pl` or `all`: `select calls from pg_stat_user_functions where funcid = to_regprocedure('public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean)')::oid;` twice, an hour apart → unchanged. If it is `none`, record that and rely on 1–3.

- [ ] **Step 10: Apply 0266** (Juan's word, after Step 9): on the sim first, then prod — `apply_migration` `0266_drop_recipe_input_16arg`; `notify pgrst, 'reload schema';`; its VERIFY queries (→ `null`, `1`). Stamp its header and move the AGENTS.md lineage line to 0266 in a docs-only commit.

---

## Task 16: Final verification

- [ ] **Step 1: Full unit suite** — Run: `npx vitest run`. Expected: every file passes, 0 failed; the snapshot tests report skipped.
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: exactly the 6 known Leaflet `TS2307` errors, nothing else.
- [ ] **Step 3: Lint and build** — Run: `npm run lint && npx next build`. Expected: lint clean; build succeeds.
- [ ] **Step 4: The goldens are untouched** — Run: `git log --oneline origin/main..HEAD -- tests/fixtures/recipe-versions-golden.json tests/fixtures/shop-versions-golden.json`. Expected: no output.
- [ ] **Step 5: Sim browser walk (port 3100)** — phone (390×844), tablet (820×1180), desktop (1440×900), en and es. 4a ships no new screen; walk the screens whose behavior it changes:
  1. `/admin/menu-costing` All shops and each shop: unchanged before any owned row; after Task 15 Step 4's sandwich, it is on its shop's board only.
  2. `/admin/catalog/recipe/<owned recipe>` as its shop's GM: the page opens in the default view, the line editor is offered, a line edit saves (the version is the recipe's own); as the other shop's GM: read-only. `/admin/catalog/recipe/<shared recipe>?location=global` as a GM: read-only, the hint names the Director of Operations (3b).
  3. `/admin/recipes/new` (legacy) as a GM with one shop: the new prep recipe is that shop's own (`select location_id from recipes where id = …`); the other shop's costing board, walk and count sheet never show it or its item; as MoO it is every shop's. A shop-owned SKU (a store copy) is on its own shop's walk and count sheet only.
  4. `/admin/skus` (legacy) as a GM: adding an item with no shop refuses `global_requires_moo` in en and es; with the GM's shop it saves.
  5. `/admin/catering/menu` → Toast tab: the shop-only sandwich is offered only at its shop's tab.
- [ ] **Step 6: Open the PR** — title `feat(catalog): Phase 4a — shop-only sandwiches + items, new item / new sandwich / swap vendor engines, sharing (0264–0266)`; body lists 0264, 0265 and 0266 as NOT APPLIED (0266 behind the Task 15 Step 9 deploy gate), links this plan, pastes the Task 15 pre-flight numbers and the Step 1b count-gate result, and ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
```

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| §3 "New things a GM creates start shop-only" | 0264 ownership + law (Task 3); `newThingScopeGate`; `creationScope` (Task 6); every-shop creation → MoO+ |
| §3 "MoO+ can promote them to global" | `share_shop_owned_menu_item` / `share_shop_owned_sku` (Task 3), `lib/catalog/share.ts` (Task 9), routes (Task 12); 4b's Share buttons |
| Lead decision 6 + 2026-10-15 decision 1 — GM-created recipes start shop-only (sandwiches AND prep) | 0264 `create_shop_recipe` / `create_shop_sandwich` + the law (Task 3); `creationScope` (Task 6); `share_shop_owned_recipe` (Tasks 3, 9, 12) |
| 2026-10-15 decision 2 — a shop-only SKU / item only at its shop | Task 5b (walk, par pass, counts, a shop's guide); Task 5 (graph, line loader, board, Toast) |
| 2026-10-15 decision 3 — "Just for now" never switches the old item off; Back to normal exact | 0265 records and undoes the grouping; no par write (Tasks 4, 10) |
| 2026-10-15 decision 4 — primaries undated | the AGENTS law line (Task 13) |
| 2026-10-15 decisions 5 and 6 — catering pickers by shop; the Catering Toast tab as is | Task 5b; 4b leaves `ToastTab` alone |
| The 16-argument writer is dropped (Astra r1: gated on the deployed code) | its own migration 0266 (Task 3b; pinned + PGlite), applied after the deploy gate (Task 15 Steps 9–10) — the safer option, reasons in Task 3b |
| Astra r1 P1 — a share racing a GM's owner-granted write | `save_owned_recipe_version` (0264) + the menu price / SKU / item writers' UPDATE predicates; inventory in Task 6 Step 5b; `ownership_changed` (en/es in 4b); PGlite + lib tests + sim race C |
| Astra r1 — product resolution never picks another shop's own SKU at any rung | `loadProductIndex` eligibility (Task 5b Step 3b) + `tests/products-store-loader.test.ts`; the walk's rescue filter removed (no second resolver) |
| Astra r1 — readiness / weights / Toast and a shop's own prep recipe | Task 5 Steps 6b, 6c, 7 + `tests/shop-owned-scope.test.ts` |
| Astra r1 — the swap's recipe set, its primary preview, Back to normal's race | 0265 (`swap_affected_recipes` / `swap_pinned_recipes`, `p_bound`, step-0 locks + conditional writes), Task 10 Step 3b (`productProposal`), PGlite + lib tests, sim race B |
| Astra r1 — the preview's own request; the item-number race; `jsonOk` typing | `preview.request` normalized (Task 10); 0264's (vendor, number) lock + sim race A; route bodies spread (Task 12) |
| Decisions (a), (b), (c) | (a) `assertLinesVisibleAt` + `recipe_version_lines_owner_law` + the recipe page picker (Tasks 3, 6); (b) `loadGuideSkuShopNames` (Task 5b) rendered by 4b; (c) Task 15 Step 1b's count gate |
| §5 job 2 — new item: vendor (inline add) → name + number → how it arrives → price → par + order days → guide section → where used; barcode now or at first delivery | Engine: Task 7 (atomic create + five setup steps). Page with the inline vendor and order days: 4b |
| §5 job 3 — swap: replacement → just for now / for good; one product; every recipe in one go; preview shows cost changes; Back to normal | 0265 (Task 4) + Task 10; page and the item page's Back-to-normal banner: 4b |
| §5 job 4 — new sandwich: name → price for my shop → recipe with live cost → Toast link (suggest; confirm or search) | Task 8 (+ `loadToastLinkChoices`); page: 4b |
| §5 "Toast linking moves out of Catering" | the link lives on the job and (4b) the menu-item page; the Catering Toast tab keeps packages / modifiers / assortments (judgment call 12) |
| §5 "ends with the same preview and save choices" | each write has a read preview first (sandwich cost, swap preview + token, share preview, back-to-normal preview + token); the new-item create shows its summary before saving (4b) |
| §8 equivalence pins | Task 1 (no owned rows ⇒ Phase 3 golden; owned ⇒ other scopes unchanged) |
| §8 permission tests (incl. the lib bind when the route is bypassed) | Tasks 2, 6, 7, 8, 9, 10 call the libs directly; Task 11 bind differential |
| §8 UI walks, en + es | 4b |

Placeholder scan: no TBD / "similar to" / "add error handling" — every step carries its code. Type consistency: `SetupStep`, `NewItemRequest`, `SandwichDraft`, `SwapRequest`, `SwapPreview`, `BackToNormalPreview`, `ShopOwnedError(status, code, message?, line?)`, `namedRefusal` are defined once and used with the same names in tests, libs and routes.

---

## Judgment calls (for the reviewer)

1. **What can be shop-only (lead decision 1):** SKUs, prep items (`items.location_id`, as the templates already make them), prep recipes and sandwiches. A shop-owned recipe makes only its shop's own items / menu items and uses only shared things or its shop's own — enforced at COMMIT by 0264 — so nothing another shop's graph reads is another shop's own.
2. **A GM keeps creating recipes, as its shop's own** (`creationScope`: the one shop it works at, or the shop it names); every-shop creation (and `createSku` with no shop, and `updateSku` moving an item's shop) is MoO+.
3. **An owned thing has no shop versions or overlays; its owner edits it as itself** (the recipe's default lines; `menu_items.menu_price` as its price). This mirrors 2a's owner rule for items and keeps one row of truth per owned thing.
4. **Vendors stay global.** The new-item job's "add a vendor" creates an ordinary vendor (GM+ today); "local" is a property of the items, not the vendor.
5. **New item = one atomic create + independent setup steps.** The create (row, first pack, first price) is one transaction; par, order days, guide line, used-in and barcode are each saved by their existing writer and reported one by one (2b's "What's missing" keeps offering what failed). A single all-or-nothing RPC would have re-implemented five writers' rules in SQL.
6. **A swap writes recipe versions that name the NEW item directly** (dated, so past business dates keep the old item), and points the product primary at it (ordering, counts and product-pinned lines follow). Lines are not converted into product lines.
7. **Swap unit rule:** a measure carries over (a count is a portion: 2 slices stay 2 slices); a shared pack label with identical contents carries; any other pack label becomes ounces of the OLD pack; an unweighable label blocks the swap and is named.
8. **A swap never moves another shop:** a new product's default primary is pinned to the old item; an existing product without a default primary refuses (`product_needs_primary`) rather than guess.
9. **"For good" for a GM = permanently at its shop** (a swap record, no Back to normal); **"For good everywhere" = MoO+**, writes the default and its primary; shops with their own version keep it (named in the preview).
10. **Back to normal** retires or restores only versions still in force, keeps (and names) ones the GM changed since, and restores the primary only if the swap's choice still stands — deleting the swap's own `product_primaries` row when there was none before (the only such DELETE in the app).
11. **A swap writes no par** (lead decision 3): Back to normal can then restore exactly — the versions, the primary and the grouping it made. The new item's par is set on its item page (the swap page says so).
12. **The Toast link keeps Tier A** (the mapping's tier), not the catalog's Tier E; the Catering Toast tab stays exactly as it is (lead decision 6).
13. **Sharing a sandwich shares the shop's own items its recipe uses in the same act** (named in the preview); another shop's own item blocks it.
14. **0266 drops the old writer on its own, with a plain `DROP`** (no `IF EXISTS`; a different signature fails loudly), after the deploy gate — chosen over "0264 drops it, applied after the deploy" because 0264 must land BEFORE the 4a code, a migration cannot see deployments, and a separate one-statement migration is the one that can wait, and be undone, alone.
15. **Sandwich recipe:** yield 1 (lines are per sandwich), `recipe_type = 'consumer'`, `catering_available = false`; one active name per shop's menu (case-insensitive), another shop's own sandwich may share it.
16. **One item number per vendor** among the items a shop can see, checked in `create_catalog_sku` under a transaction lock on (vendor, lower(number)) — every New-item create of that number serializes, shared vs shop-owned included. The legacy SKU form, the SKU edit and the vendor import do not take the lock (they never promised the rule); the pre-flight lists today's duplicates.
17. **The vendor's guide editor stays whole** (lead decision 2): a shop's VIEW of the guide drops another shop's own lines (`loadOrderGuideForShop`), but the vendor page edits the whole sheet — saving a filtered model would delete the hidden lines — and labels each shop's own line "Only at <shop>" (decision (b)).
18. **Existing data is left as it is:** shared recipes that already make or use a template's shop item keep working (the law judges shop-owned recipes and new shop sandwiches only); the runbook records the counts.
19. **Back to normal retires a product the swap created** only if nothing leans on it (no recipe line pins it, no other item joined, no shop chose its primary); otherwise it reports `kept_in_use`.
20. **Owner-bound writes (Astra r1 P1):** recipes go through a SQL wrapper (`save_owned_recipe_version`) rather than re-emitting 0262's writer — the wrapper takes the same locks first and hands the transaction over; the existing snapshot would also have caught most races (it digests the recipe row), but the named refusal and the explicit compare are the contract.
21. **Store copies at the global default** keep 0216's eligibility in product resolution (the store-run law); only REGULAR-vendor shop-owned members became shop-only at every rung. The pre-flight lists the regular-vendor members whose resolution changes.
22. **Readiness hides only what an owned recipe makes**; a template shop item (0079) no owned recipe makes keeps its readiness row everywhere, as before (changing that is not this phase).
23. **Toast**: a shop's own prep items join that shop's pool; the modifier lane now reads the SHOP's pool (so a shop's menu overlay applies there too — identical with no overlay rows); another shop's own item or raw SKU is refused at the manual link.
24. **A shared recipe's DEFAULT is not policed for shop-owned components** (decision (a) covers shop versions; the default is MoO's, and template items may already be there).

## Open questions

The six questions of the first draft and the three of the second were answered by the lead on 2026-10-15 (folded in above: decisions (a), (b), (c)). Remaining, smaller:

1. Should the legacy SKU form / SKU edit / vendor import also take the (vendor, number) lock (judgment call 16), or is the New-item job's guarantee enough?
2. Should a shared recipe's DEFAULT refuse shop-owned components too (judgment call 24), after a census of today's template-item lines?
