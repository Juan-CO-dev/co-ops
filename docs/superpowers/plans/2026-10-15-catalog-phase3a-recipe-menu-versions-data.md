# Catalog Redesign — Phase 3 (Shop Versions: Recipes + Menu Items, Adopt / Promote) Implementation Plan

## Part 3a of 2 — data model, the one resolver, the equivalence pin, permissions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision r2 (2026-10-15).** This revision answers Astra's round-1 review of 3a (CHANGES REQUESTED: 1 P1 + 6 P2) and carries the lead's decisions:
- **L1** yields stay global (a version is the LINES only). **L2** catering is untouched. **L3** with a shop selected, the costing board's margins use that shop's menu overlay price (Task 6).
- **L4 (P1)** every recipe consumer reads the shop's resolved recipe through the ONE resolver — production (picker and validation), prep demand, depletion and prior-day repair, ezCater, readiness, par advisories, product pins and the item-page connections. New Task 6b carries the routing table (2a's style) and the code.
- **L5** PROMOTE returns the source shop to the default: its version is retired (history kept) in the SAME transaction as the new default, timestamps aligned (0262).
- **L6** GM-created shop-only recipes wait for Phase 4.
- **Rule:** the legacy builder's MoO-only LINE restriction ships with 3b, never with 3a alone (3a changes no legacy permission).
- Also: every save is bound to a **dependency snapshot** re-validated under the graph lock (`recipe_change_snapshot`, `menu_item_change_snapshot`; 2b's atomic-apply pattern); the backfill → journal cutover is **protected by a table lock** taken before the backfill; restore / adopt / promote run the **same product-line validator** as add / update (in TS and in SQL); every version line-set read is **paged and id-chunked**; the after-state snapshot proof compares against an **independent pre-migration capture** and verifies the REAL journal tables.

**Revision r3 (2026-10-15)** answers Astra's round 2 (5 P2) with the lead's refinements: **(a)** the dependency snapshot covers only the change's dependency CLOSURE (its lines, the recipes they reach and consume, the SKUs / products / product members / vendors / receipts / primaries / overlays / packs / prices / measures they resolve through, for the affected shops) — never a whole table; **serialized**: every writer takes NOWAIT closure locks after the graph lock and re-checks the snapshot under them, so nothing can change between check and commit (lock order in 0262 (7a)); **(b)** a save may not ADD or CREATE an invalid line, lines already invalid may stay (flagged), and every refusal names the line (position, name, reason, en + es); **(c)** the hub's cross-shop readiness count is attributed per shop and links to that shop's list.

The finding-by-finding map is at the end of this file.

**Goal:** Give every recipe a shop version of its LINES, and every menu item a shop overlay (price here, sold here, name here), beside the global default, in the house idiom `location_id NULL = global`. Route every recipe consumer through one resolver point (the recipe graph loader, per location, with `asOf`): this shop's version in force, else the global one. Recipe versions are **effective-dated** — global edits included — so depletion and the prior-day repair of a past business date use the recipe lines that were live that day; this closes Phase 2a's open question 1 ("only PACKS are dated"). Prove first, with a frozen golden, that with no shop versions every costing, depletion and menu-board number is identical to today. Enforce the permission boundary inside the lib and the database. The SQL for adopt, promote and the GM notices also lands here (one writer, one lock discipline); **3a ships no new screen**. Part 3b (`docs/superpowers/plans/2026-10-15-catalog-phase3b-recipe-menu-pages-adopt-promote.md`) adds the recipe and menu-item pages, the preview before save, adopt / promote / back to default in the UI, the Shop changes list and the GM notices.

**Architecture:**
- **The global default's live lines stay in `recipe_inputs`.** Phase 1's line RPCs (`add_recipe_input_atomic` / `update_recipe_input_atomic`) and the 0258 graph lock keep their meaning, byte for byte. Every direct reader of recipe lines that answers for a SHOP now reads through the one resolver (`loadResolvedRecipeInputs`, Task 6b); the readers left on the global default are named in the routing table as global by intent.
- **Every version is a row** in `recipe_versions (recipe, location NULL|shop, based_on, adopted_from, promoted_from, valid_from, valid_to, active)` owning a full line set in `recipe_version_lines`. A shop version is written only through `save_recipe_version`. The global default's history is a **journal** of `recipe_inputs`: `recipe_global_journal`, run by deferred constraint triggers at COMMIT of every transaction that touches a recipe's lines (and explicitly by `save_recipe_version`), opens a new global version holding a copy of the lines. No writer can skip it.
- **Backfill:** every recipe gets one global version valid from `2000-01-01` holding a copy of its lines; a recipe created later also starts at `2000-01-01`. **Edits are dated; existence is not.** The migration takes `SHARE ROW EXCLUSIVE` on `recipe_inputs` and `recipes` (and the graph lock) BEFORE the backfill, so no legacy write can land between the copy and the journal triggers; the copy is then asserted equal, recipe by recipe, to `recipe_inputs`.
- **The one resolver.** Pure rules in `lib/recipe-versions-shared.ts` (`pickLiveShopRecipeVersions`, `pickRecipeVersionsAsOf`, `recipeLineReplacements`, `mergeResolvedInputs`); the I/O at ONE point, `loadRecipeLineOverlay`, read by exactly two loaders: `loadRecipeGraph({ locationId, versionLocationId, asOf, recipeOverrides })` (everything that flattens) and `loadResolvedRecipeInputs(scope, { asOf })` (everything that only needs the lines: readiness, par advisories, production's picker and validation, product pins). Where the answer is the global LIVE head, both keep reading `recipe_inputs` itself — same rows, same order. `createDatedGraphs` reuses the live graph unless a pack OR recipe boundary falls after the date.
- **Saves are bound to what the person saw — scoped and serialized.** `recipe_change_snapshot(recipe, scope, lines)` digests exactly the change's dependency closure (`recipe_change_closure`: the recipes it reaches and everything they consume, with every SKU, product member, vendor, receipt, primary, overlay, pack, price and measure product resolution and costing read for the affected shops); `menu_item_change_snapshot(menu item, scope)` wraps it per recipe that makes the item. Every writer takes the graph lock, its target row, then `recipe_change_lock` — NOWAIT row and table locks that block each dependency's own writers (insertions included) — and only then re-takes the snapshot, refusing `dependencies_changed` (moved) or `dependencies_busy` (being written right now).
- **Promote** writes the new default AND retires the source shop's version in one transaction (`valid_to` = the new default's `valid_from`): the source rides the default from then on, its food unchanged.
- **The cycle law per shop.** A shop's graph is the global lines with its own versions substituted. Every writer refuses `would_create_cycle` in every graph it changes, under the 0258 lock `7258025800`; the four 0258 functions are re-emitted (additions only) to sweep the shops.
- **Menu items.** `menu_item_shop_settings` (shop rows only; the global default IS the `menu_items` row) with `price`, `sold_here`, `name_override(_es)`, effective-dated and append-only. The pure `resolveMenuItemForShop` is the one rule; the costing board's shop view and the Toast auto-match / drift read it. Catering keeps the global prices (spec §3, §9: Keith's setup is global).
- **Permissions** in the lib before any I/O, and in SQL: GM (7) writes only its own shops' recipe versions and menu overlays; MoO (8)+ writes any active shop (2a's `catalogShopAllowed`) and the global default. Routes are Tier E; no Phase 3 act takes a one-shot grant (deleting a recipe stays a grant).

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres 17 (service role, SECURITY DEFINER RPCs, deferred constraint triggers), vitest 4, tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §2 (permissions), §3 (global defaults + shop versions; adopt; promote; back to default; history), §6 (Shop changes list, GM notices), §7 (Phase 3), §8 (testing).

**Builds on (all merged first, their migrations applied):**
- **Phase 1** (`docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md`, merged @ 2e59def7; 0257 + 0258 applied to prod): Tier E on its own clock; one-shot grants for retire product / delete recipe / deactivate SKU; the recipe line RPCs behind the graph lock `7258025800` with in-transaction cycle refusal; the ingredient picker; deep links.
- **Phase 2a** (`docs/superpowers/plans/2026-10-15-catalog-phase2a-shop-versions-data.md`, 0259 + 0260): effective-dated pack versions, price lanes, the scoped loaders, `createDatedGraphs`, `catalogShopAllowed`, the costing-board shop switcher, the privilege-ceiling pattern, the reemit generator.
- **Phase 2b** (`docs/superpowers/plans/2026-10-15-catalog-phase2b-item-page-jobs.md`, 0261): the connected item page at `/admin/catalog/sku/[id]`, the target-bound preview + token, `createRequestGuard`.

**Working copy:** `C:\Users\conta\co-ops-guides` (or the build worktree CC assigns). Branch once Phase 2b is on `origin/main`:

```bash
git fetch origin && git checkout -b feat/catalog-phase3a-recipe-menu-versions origin/main
ls supabase/migrations | tail -4
```

Expected: `0259_sku_shop_versions.sql`, `0260_sku_pack_versions_finalize.sql` and `0261_sku_pack_change_requests.sql` are present and 0262 is free. **If 0262 or 0263 is taken, renumber this plan's two migrations to the next free pair, then rename every `0262`/`0263` literal in this plan's files and tests first.** The pin tests assert the file names.

**Standing rules for every task:**
- Read `AGENTS.md` first — the law-book (its "Shop versions" section came with 2a). Closed audit vocabulary, location bind inside the lib, deny-all RLS with a service-role privilege ceiling, the batch-loader law, en + es in the same PR, tú Spanish.
- Sim only (`node scripts/sim/dev-sim.mjs`, http://localhost:3100). Production is touched only by the read-only snapshot export (Task 1 Step 8) and the gated apply runbook (Task 12).
- **Do not apply any migration** outside Task 12.
- Every commit message ends with the two trailer lines shown in each commit step.
- The equivalence pins stay green after every later task: `npx vitest run tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts`.

---

## Ground truth this plan is built on (verified 2026-10-15 against `main` @ 2e59def7, plus the Phase 2 plans' contracts)

| Fact | Where |
|---|---|
| `recipe_inputs` = config edges: `id, recipe_id → recipes ON DELETE CASCADE, component_sku_id, component_item_id, quantity > 0, unit, each_container_label, portioned NOT NULL default false, display_order NOT NULL default 0, created_at, created_by`; 0179 adds `component_product_id` and the 3-way exactly-one CHECK `recipe_inputs_exactly_one_component`. Deny-all RLS policy set. **No version column, no history.** | `supabase/migrations/0103_recipe_entities.sql:32-48, 86-90`; `0179_product_identity.sql:180-195` |
| `recipe_outputs` (item XOR menu item, `yield`) and `menu_items (id, name, name_es, menu_price ≥ 0, toast_ref, active, created_*, updated_*)` + 0245 `price_same_as_id`. | `0103:52-83`; `0245_menu_price_same_as.sql:6-8` |
| 0258 (APPLIED TO PROD 2026-10-15) defines `add_recipe_input_atomic`, `update_recipe_input_atomic`, `recipe_input_would_cycle`, `recipe_output_would_cycle`, and re-emits `create_recipe_full` / `add_recipe_output` from 0215 with the graph lock `pg_advisory_xact_lock(7258025800)` FIRST. Named P0001 refusals without a prefix (`would_create_cycle`, `line_changed`, `edge_not_found`, `recipe_not_found`). service_role-only grants, DO-block guard. | `supabase/migrations/0258_recipe_input_write_atomic.sql:4, 65-88, 90-132, 134-198, 200-220, 226-315, 321-380, 382-404` |
| The lock key's TS twin and the pure cycle mirrors. | `lib/recipe-graph-shared.ts:20` (`RECIPE_GRAPH_LOCK_KEY`), `:32` (`itemLineWouldCycle`), `:64` (`outputItemWouldCycle`) |
| `lib/recipes.ts`: `assertInputLineIsValid` (private, shape + product measure rule) `:178-197`; `RECIPE_INPUT_RPC_ERRORS` `:200-205`; `addRecipeInput` `:579-609`; `updateRecipeInput` `:630-686`; `removeRecipeEdge` — outputs go through `remove_recipe_output`, **inputs are a direct `.delete()`** `:773-778`; `createRecipe` inserts the header directly `:321-337`; `deactivateRecipe` `:508-515`. Floors: read 6, write 7, delete 8, menu price 8. | `lib/recipes.ts`; `lib/recipes-shared.ts:12-15` |
| `batch_yield` is LOADED and validated but NEVER divided by (a guard only); per-unit division is by the OUTPUT's `yield`. | `lib/prep-consumption-graph.ts:67-92` |
| `loadRecipeGraph` reads `recipes` (active, ordered `created_at nulls first, id`), `recipe_inputs` (unordered, unpaged) and `recipe_outputs` in one `Promise.all`, throws on each, then collects SKU/product ids FROM THE INPUT ROWS and builds the graph. Source pins: `tests/silent-read-fabrication.test.ts:124-162` (three labelled throws before `const outputItemIds`; no `await sb.` inside a `for` in the body), `tests/product-member-pack.test.ts:12-30`. | `lib/prep-consumption.ts:178-270` |
| **Direct readers of `recipe_inputs` outside the graph** (each gets an explicit decision in Task 6b's routing table): `lib/admin/cost.ts:168` (`loadSkuUsageMap`, the SKU list's "used in"), `lib/admin/product-item-links.ts:21` (the items page's product links), `lib/admin/readiness-load.ts:98` (`loadGraphRows` → `loadGraphReadiness`), `lib/ordering.ts:286` (`loadDemandSources` → the par advisories, called at `:796` inside the walk), `lib/production.ts:157,181` (`loadSkuToItems` → the production picker) and `:329,343` (`recordProduction`'s conversion check), `lib/products.ts:232` (`loadPinnedRecipesByProduct` → "N recipes still pin this") and `:1023` (`recordResolutionFlipsForLocation`), `lib/recipes.ts:226,285,544` (the legacy builder: the global recipe by definition). | grep `from("recipe_inputs")` |
| Every `loadRecipeGraph` / dated-graph caller already passes its shop through 2a's scope (Toast materialize `lib/catering/toast-sales.ts:565,816,1002`, ezCater `lib/ezcater/depletion.ts:79`, `lib/ezcater/pass2.ts:54`, catering sku-demand `lib/catering/sku-demand.ts:112`, surplus `lib/catering/surplus.ts:144`, capture paths via `versionLocationId` in `lib/opening.ts`, `lib/prep.ts`, `lib/yield-stats.ts`, `lib/batch-prep.ts`, the production preview `lib/prep-consumption.ts:436,489`, `lib/report-package.ts:223`, the costing board, the 2b item page's connections `usingRecipes = uniqueRecipes(graph)…`); the global ones are `lib/admin/catalog.ts:183`, `lib/admin/toast-map.ts:249,602`, `lib/weights.ts:301`, the seeds and sim scripts. Catering prep demand (W4a, `lib/catering/prep-demand.ts`) reads item definitions, not recipe lines. | grep `loadRecipeGraph(`; 2a plan Task 5 routing table |
| The costing board reads every active `menu_items` row once and prices it through `resolveMenuPrice({ typedPrice, toastPrices, sameAs })`. Toast prices come from `loadCachedMenuPrices()` across ALL shops. | `lib/admin/menu-costing.ts:123-149`; `lib/admin/menu-costing-toast.ts:6-61`; `lib/toast/in-store-prices-shared.ts:76-97` |
| The global menu price writer is MoO+ (8) with compare-and-set. | `lib/admin/menu-prices.ts:8, 13-37` |
| Toast mapping: `loadEntities(all)` builds the matcher pool from ALL active global menu items; `runAutoMatch(actor, locationId)` and `driftReport(actor, locationId)` are per shop but use the global pool. `TOAST_MAP_MIN = 7`; the location bind is `assertLocationAccess`. `CoEntity = { kind, id, name, priceCents }`. | `lib/admin/toast-map.ts:32, 54-58, 108-123, 199-210, 395-401`; `lib/toast/matcher.ts:18-23` |
| Catering à-la-carte is per location (rate rules) but prices from the GLOBAL `menu_items.menu_price`. | `lib/catering/menu.ts:111-130` |
| Step-up: `assertStepUp(ctx, "E")` reads `sessions.catalog_edit_unlocked_at`; `GRANT_ACTIONS = ["product.retire", "recipe.delete", "sku.deactivate"]`; the tier and grant maps are pinned. | `lib/admin/step-up.ts:39-50`; `lib/admin/step-up-shared.ts:20`; `tests/step-up-tier-map.test.ts:84-108, 222, 361-370` |
| The differential location-bind test: `TENANCY_SCOPED_TABLES` `:36`, `TENANCY_SCOPED_RPCS` `:78`, `BIND_PRIMITIVES` (incl. `requireLocation`) `:93`, `FILES` `:106`; a writer is an exported actor-taking function whose body names a scoped table with a write call or a scoped RPC. | `tests/location-bind-differential.test.ts` |
| The in-memory PostgREST stand-in: `select/eq/neq/is/not-is/in/gt/gte/lt/lte/or(is.null|eq)/order/range/limit/maybeSingle/upsert` (+ `insert` from 2a); **no `rpc`, no `update`**; a missing table answers `relation "<t>" does not exist`; 1000-row cap. | `tests/fixtures/counts-fake-db.ts:71-200` |
| AuthContext carries `level`; owner = 9, moo = 8, gm = 7, agm = 6. `canReadReportLocation` = level 8+ or a membership. | `lib/session.ts:44-50`; `lib/roles.ts:48-51`; `lib/locations.ts:56-58` |
| **2a contract:** `VersionScope`, `NIL_SCOPE`, `assertScopeToken`, `asOfForBusinessDate`, `catalogShopAllowed` (level ≥ 8 or a membership), `GLOBAL_VERSION_WRITE_MIN = 8` in `lib/sku-versions-shared.ts`; `loadRecipeGraph(opts?: { locationId?, versionLocationId?, asOf? })` (`versionLocationId` defaults to `locationId`; capture paths pass only `versionLocationId`); `createDatedGraphs({ locationId, liveGraph? })` caching ONE graph per pack INTERVAL (`bounds ??= loadPackBoundaries(opts.locationId)`, `packIntervalIndex`; the last interval is the live graph) — **as merged on main @ 4955da7f** (`lib/prep-consumption.ts:226-286`), which replaced the plan's `loadLatestPackBoundary`; Toast reuses it through its context's `graphFor` and ezCater through one dated builder per shop (`lib/ezcater/depletion.ts:77-90`); `loadSkuReadinessMap(actor)` reads GLOBAL prices and packs (`lib/admin/readiness-load.ts:51-75`); `loadCurrentSkuPrices(skuIds, scope)`; `loadMenuCostingBoard(actor, opts: { scope?: VersionScope } = {})` with `scope` on the board; the 0259 privilege-ceiling guard; `scripts/shop-versions/reemit-mods.ts` exports `normalize, extractFunction, applyMods, isLineSubsequence, type Mod, type Reemit`; `tests/fixtures/shop-versions-fixture.ts` exports `buildShopVersionsFixture, withBackfilledVersions, LOC, OTHER, QUIET_DAY` (recipes `r-slaw` → `i-slaw`, `r-italian` → `m-italian`, `r-pickle` → `m-pickle-side`, retired `r-old` → `m-old`; inputs `ri-01…ri-10`). 2a's open question 1: "Only PACKS are dated … Dating recipes would be its own arc." | 2a plan Tasks 1, 2, 3, 5, 6b; `:5837-5842` |
| **2b contract:** `/admin/catalog/sku/[id]` with `?location=<shop>|global` declared in `SHOP_PARAMS_BY_PREFIX`; `previewToken(parts)` (FNV-1a over `JSON.stringify`) in `lib/catalog/change-preview-shared.ts`; `createRequestGuard` in `lib/catalog/request-guard-shared.ts`; `costPerOzFromGraph` lives in `lib/menu-costing-shared.ts` and is re-exported by `lib/admin/menu-costing.ts`; the `catalog.item.*` en/es keys. | 2b plan Tasks 1, 2, 4, 10 |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/fixtures/recipe-versions-fixture.ts` | create | The fixture matrix in the post-0262/0263 shape (2a's fixture + baseline recipe versions + priced menu items). |
| `tests/fixtures/recipe-versions-harness.ts` | create | One compute function: live and dated graph numbers, costs and the menu board, per scope. |
| `tests/fixtures/recipe-versions-golden.json` | create (generated) | Today's numbers, frozen before any change. |
| `tests/recipe-versions-equivalence.test.ts`, `tests/recipe-versions-snapshot.test.ts` | create | Golden compare + anchors; env-gated read-only prod-shaped snapshot compare. |
| `lib/recipe-versions-shared.ts`, `tests/recipe-versions-shared.test.ts` | create | The pure resolver (live, as-of, replacements), line ops, the line diff, the write gate, the cycle mirror. |
| `supabase/migrations/0262_recipe_shop_versions.sql` | create | Versions + lines + dismissals, the cutover lock + backfill + per-recipe proof, the journal + deferred triggers, the scoped cycle functions, the dependency snapshot (`recipe_change_snapshot`), `save_recipe_version` (product rule on every line; promote retires its source), `retire_recipe_version`, `remove_recipe_input_atomic`, four re-emits, privilege ceilings. |
| `scripts/recipe-versions/reemit-mods.ts`, `scripts/recipe-versions/emit-0262-reemits.ts`, `tests/recipe-versions-migration.test.ts` | create | The enumerated re-emit mods, their generator, and the migration pins. |
| `scripts/recipe-versions/sim-scenario.sql` | create | The real-SQL scenario (runs on the sim, rolls itself back). |
| `supabase/migrations/0263_menu_item_shop_settings.sql`, `tests/menu-item-shop-migration.test.ts` | create | The menu overlay table, its dependency snapshot and its three writers (promote: field-by-field changed shops; the source returns to the default). |
| `lib/prep-consumption.ts` | modify | `loadRecipeLineOverlay`; `loadRecipeGraph(… recipeOverrides)`; `loadRecipeBoundaries` / `loadCatalogBoundaries`; `createDatedGraphs` cuts its intervals at pack AND recipe boundaries. |
| `tests/fixtures/counts-fake-db.ts` | modify | The four new tables exist (empty) in every fake database. |
| `tests/recipe-versions-graph.test.ts` | create | Shop versions present: live, as-of, back to default, overrides, the quiet-day reuse. |
| `lib/menu-item-shop-shared.ts`, `lib/menu-item-shop.ts`, `tests/menu-item-shop-shared.test.ts` | create | The pure menu overlay rule and its one loader. |
| `lib/admin/menu-costing.ts`, `app/admin/menu-costing/page.tsx`, `lib/admin/toast-map.ts`, `tests/menu-costing-shop-overlay.test.ts` | modify / create | The costing board's shop view and the Toast matcher read the overlay. |
| `lib/admin/recipe-versions.ts`, `tests/recipe-versions-permissions.test.ts` | create | Gated recipe writers (lines, restore, back to default; copies validated like edits) + paged history + the snapshot read. |
| `lib/admin/readiness-load.ts`, `lib/ordering.ts`, `lib/production.ts`, `lib/products.ts`, `lib/admin/cost.ts`, `lib/admin/product-item-links.ts`, `tests/recipe-consumers-shop-scope.test.ts` | modify / create | Task 6b: every recipe-line reader resolves through `loadResolvedRecipeInputs` (or is global by intent, named). |
| `lib/admin/menu-item-shop.ts`, `tests/menu-item-shop-permissions.test.ts` | create | Gated menu overlay writers + history. |
| `lib/recipes.ts`, `tests/recipe-input-remove-locked.test.ts` | modify / create | The legacy line delete goes through the graph-locked RPC; `assertInputLineIsValid` exported. |
| `lib/audit-actions.ts` / `lib/destructive-actions.ts` | modify | `recipe_version.save/retire/adopt/promote`, `menu_item.shop_setting_save/retire/promote`. |
| `app/api/admin/catalog/recipe/[id]/{lines, restore, back-to-default}/route.ts`, `app/api/admin/catalog/menu-item/[id]/shop/{route, back-to-default/route, restore/route}.ts`, `tests/recipe-menu-version-routes.test.ts` | create | Tier E routes over the gated writers. |
| `tests/location-bind-differential.test.ts`, `tests/step-up-tier-map.test.ts` | modify | Register the new writers and routes. |
| `lib/i18n/en.json`, `lib/i18n/es.json` | modify | The board's "not sold here" line. |
| `AGENTS.md` | modify | The recipe-versions law. |

---

## Task 1: The equivalence pin — freeze today's numbers BEFORE any change

Nothing in `lib/` changes in this task. It extends Phase 2a's fixture to the post-0262/0263 shape and builds a harness that computes, for the global scope and each shop:
- depletion ounces per menu item and per prep item from the **live** graph;
- the same per menu item from the **dated** graph of three business dates (before every pack version, mid-history, and after every boundary);
- cost per oz, the menu and prep cost rollups;
- the menu costing board (name, price, source, food-cost %, margin, rollup) and its totals.

The output is written once as a golden JSON with today's code (post-Phase-2 `main`). From then on the golden is the oracle.

**Files:**
- Create: `tests/fixtures/recipe-versions-fixture.ts`, `tests/fixtures/recipe-versions-harness.ts`, `tests/recipe-versions-equivalence.test.ts`, `tests/recipe-versions-snapshot.test.ts`
- Create (generated): `tests/fixtures/recipe-versions-golden.json`

- [ ] **Step 1: Create the fixture `tests/fixtures/recipe-versions-fixture.ts`**

```ts
/**
 * Catalog Phase 3a — THE FIXTURE MATRIX the recipe / menu equivalence pin runs over.
 *
 * Built on Phase 2a's shop-versions fixture (tests/fixtures/shop-versions-fixture.ts): products with
 * per-shop primaries, dated pack versions, price lanes, and four recipes —
 *   r-slaw    → i-slaw (prep)        48 oz lettuce + 16 oz mayo, yield 2
 *   r-italian → m-italian (menu)     turkey by chain label, slaw by weight, ham + bread products,
 *                                    tomato by count, cheese
 *   r-pickle  → m-pickle-side (menu) 1 jar of pickle (a legacy pack label)
 *   r-old     → m-old (menu)         RETIRED
 * — then extended to the POST-0262/0263 SHAPE:
 *   · every recipe has ONE baseline GLOBAL recipe_versions row (valid_from 2000-01-01, active) whose
 *     recipe_version_lines are a copy of its recipe_inputs (source_line_id = the input id);
 *   · menu_item_shop_settings and recipe_notice_dismissals exist and are empty;
 *   · menu_items carry the columns the costing board reads: the Italian is typed at $12.50, a lunch
 *     Italian has no recipe and inherits the Italian's price ("same as"), the pickle side is $2.25.
 * Code written before 0262 ignores the new tables, which is what lets ONE fixture produce the
 * golden (Task 1, today's code) and prove the new code against it (Tasks 5–6).
 */
import { buildShopVersionsFixture, LOC, OTHER, QUIET_DAY } from "./shop-versions-fixture";

type Row = Record<string, unknown>;
export { LOC, OTHER, QUIET_DAY };

export const RECIPE_BASELINE_FROM = "2000-01-01T00:00:00.000Z";
/** Before every pack version in the 2a fixture: the dated graph really runs its as-of path. */
export const EARLY_DAY = "2026-07-15";
/** After every pack boundary, inside the price history. */
export const MID_DAY = "2026-09-15";

/** The 0262 backfill, in fixture form: one baseline global version per recipe, lines copied. */
export function withBackfilledRecipeVersions(tables: Record<string, Row[]>): Record<string, Row[]> {
  const versions: Row[] = [...(tables.recipe_versions ?? [])];
  const lines: Row[] = [...(tables.recipe_version_lines ?? [])];
  const hasGlobal = new Set(versions.filter((v) => v.location_id == null).map((v) => String(v.recipe_id)));
  for (const r of tables.recipes ?? []) {
    const rid = String(r.id);
    if (hasGlobal.has(rid)) continue;
    const vid = `rv-${rid}-base`;
    versions.push({
      id: vid, recipe_id: rid, location_id: null, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: true, valid_from: RECIPE_BASELINE_FROM, valid_to: null,
      note: "0262 baseline", created_at: RECIPE_BASELINE_FROM, created_by: null, retired_by: null,
    });
    for (const i of (tables.recipe_inputs ?? []).filter((x) => x.recipe_id === rid)) {
      lines.push({
        id: `rvl-${String(i.id)}`, version_id: vid, recipe_id: rid, location_id: null,
        component_sku_id: i.component_sku_id ?? null, component_item_id: i.component_item_id ?? null,
        component_product_id: i.component_product_id ?? null, quantity: i.quantity, unit: i.unit ?? null,
        each_container_label: i.each_container_label ?? null, portioned: i.portioned === true,
        display_order: typeof i.display_order === "number" ? i.display_order : 0, source_line_id: i.id,
      });
    }
  }
  tables.recipe_versions = versions;
  tables.recipe_version_lines = lines;
  tables.menu_item_shop_settings ??= [];
  tables.recipe_notice_dismissals ??= [];
  return tables;
}

export function buildRecipeVersionsFixture(): Record<string, Row[]> {
  const t = buildShopVersionsFixture();
  const menu = (id: string) => {
    const row = (t.menu_items ?? []).find((r) => r.id === id);
    if (!row) throw new Error(`fixture: no menu item ${id}`);
    return row;
  };
  Object.assign(menu("m-italian"), { name_es: "Italiano", section: "Subs", menu_price: 12.5, price_same_as_id: null, catering_available: false });
  Object.assign(menu("m-pickle-side"), { name_es: "Pepinillos", section: "Sides", menu_price: 2.25, price_same_as_id: null, catering_available: false });
  Object.assign(menu("m-old"), { section: "Subs", menu_price: 9, price_same_as_id: null, catering_available: false });
  t.menu_items!.push({
    id: "m-italian-lunch", name: "Italian (lunch)", name_es: "Italiano (almuerzo)", active: true, section: "Subs",
    menu_price: null, price_same_as_id: "m-italian", catering_available: false,
  });
  return withBackfilledRecipeVersions(t);
}
```

- [ ] **Step 2: Create the harness `tests/fixtures/recipe-versions-harness.ts`**

```ts
/**
 * Catalog Phase 3a — THE RECIPE / MENU EQUIVALENCE PIN's engine. One function computes every number
 * the spec's precondition names for recipes and menu items (spec §3, §8), per scope, through the
 * public loaders: live graph oz + costs, the dated graph of each business date, and the menu costing
 * board. The API is the shipped one — Tasks 5–6 change what is UNDER it, never this file.
 */
import { createDatedGraphs, loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, loadMenuCostingBoard } from "@/lib/admin/menu-costing";
import { rollupItemCost, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface RecipeResolverApi {
  graph(scope: string | null): Promise<RecipeGraph>;
  datedGraph(scope: string | null, businessDate: string): Promise<RecipeGraph>;
  prices(skuIds: string[], scope: string | null): Promise<Map<string, number>>;
  board(actor: AuthContext, scope: string | null): ReturnType<typeof loadMenuCostingBoard>;
}

export const liveRecipeApi: RecipeResolverApi = {
  graph: (scope) => loadRecipeGraph(scope == null ? undefined : { locationId: scope }),
  datedGraph: (scope, businessDate) => createDatedGraphs({ locationId: scope })(businessDate),
  prices: (skuIds, scope) => loadCurrentSkuPrices(skuIds, scope),
  board: (actor, scope) => loadMenuCostingBoard(actor, scope == null ? {} : { scope }),
};

/** The viewer for the board: an owner (level 9) reads every shop. */
export const OWNER_ACTOR = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;

function sorted<V>(m: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface RecipeScopeOutputs {
  menuOz: Record<string, Record<string, number>>;
  itemOz: Record<string, Record<string, number>>;
  costPerOz: Record<string, number | null>;
  menuCost: Record<string, unknown>;
  itemCost: Record<string, unknown>;
  datedMenuOz: Record<string, Record<string, Record<string, number>>>;
  board: { rows: unknown[]; totals: unknown };
}
export type RecipeEquivalenceOutputs = Record<string, RecipeScopeOutputs>;

/** Every number, for "global" and each shop in `shopIds`. JSON-normalized. */
export async function computeRecipeOutputs(
  api: RecipeResolverApi, tables: Tables, shopIds: readonly string[], days: readonly string[],
): Promise<RecipeEquivalenceOutputs> {
  const outputs = tables.recipe_outputs ?? [];
  const menuIds = [...new Set(outputs.map((o) => o.output_menu_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const itemIds = [...new Set(outputs.map((o) => o.output_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const out: RecipeEquivalenceOutputs = {};
  for (const label of ["global", ...shopIds]) {
    const scope = label === "global" ? null : label;
    const graph = await api.graph(scope);
    const prices = await api.prices([...graph.skuPack.keys()], scope);
    const costPerOz = costPerOzFromGraph(graph, prices);
    const datedMenuOz: RecipeScopeOutputs["datedMenuOz"] = {};
    for (const day of days) {
      const dated = await api.datedGraph(scope, day);
      datedMenuOz[day] = Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(dated, m))]));
    }
    const board = await api.board(OWNER_ACTOR, scope);
    out[label] = {
      menuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(graph, m))])),
      itemOz: Object.fromEntries(itemIds.map((i) => [i, sorted(perUnitSkuOzForItemFromGraph(graph, i))])),
      costPerOz: sorted(costPerOz),
      menuCost: Object.fromEntries(menuIds.map((m) => [m, rollupMenuItemCost(graph, m, costPerOz)])),
      itemCost: Object.fromEntries(itemIds.map((i) => [i, rollupItemCost(graph, i, costPerOz)])),
      datedMenuOz,
      board: {
        rows: board.rows.map((r) => ({
          id: r.id, name: r.name, nameEs: r.nameEs, section: r.section, menuPrice: r.menuPrice, typedPrice: r.typedPrice ?? null,
          priceSource: r.priceSource ?? null, foodCostPct: r.foodCostPct, marginDollars: r.marginDollars,
          overThreshold: r.overThreshold, rollup: r.rollup,
        })),
        totals: board.totals,
      },
    };
  }
  return JSON.parse(JSON.stringify(out)) as RecipeEquivalenceOutputs;
}
```

- [ ] **Step 3: Create the test `tests/recipe-versions-equivalence.test.ts`**

```ts
/**
 * Catalog Phase 3a — THE RECIPE / MENU EQUIVALENCE PIN (spec §3 precondition, §8).
 *
 * With NO shop recipe versions and NO menu overlays present, every live recipe number — depletion oz
 * per menu item and prep item, cost per oz, the menu and prep cost rollups — the dated depletion of
 * three business dates, and every menu costing board row and total, for the global scope and each
 * shop, must be BYTE-IDENTICAL to what today's code produced on this fixture. The golden was written
 * by Task 1 with today's loaders, before any resolver change; later tasks change the loaders, never
 * the golden.
 *
 * Regenerate ONLY in Task 1 (or with a written reason in the PR):
 *   UPDATE_RECIPE_VERSIONS_GOLDEN=1 npx vitest run tests/recipe-versions-equivalence.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, EARLY_DAY, LOC, MID_DAY, OTHER, QUIET_DAY } from "./fixtures/recipe-versions-fixture";
import { computeRecipeOutputs, liveRecipeApi, type RecipeEquivalenceOutputs } from "./fixtures/recipe-versions-harness";

const GOLDEN = "tests/fixtures/recipe-versions-golden.json";
const DAYS = [EARLY_DAY, MID_DAY, QUIET_DAY];

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => { current = createFakeDb(buildRecipeVersionsFixture()); });
afterEach(() => { current = null; });

describe("no shop recipe versions and no menu overlays ⇒ every number is identical to today (the golden)", () => {
  it("matches the frozen golden for global, shop one and shop two", async () => {
    const got = await computeRecipeOutputs(liveRecipeApi, buildRecipeVersionsFixture(), [LOC, OTHER], DAYS);
    if (process.env.UPDATE_RECIPE_VERSIONS_GOLDEN === "1") writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(existsSync(GOLDEN), "golden missing — run Task 1 Step 4").toBe(true);
    expect(got).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")) as RecipeEquivalenceOutputs);
  });
});

describe("the fixture is not trivial — hand-checked anchors inside the golden", () => {
  const golden = (): RecipeEquivalenceOutputs => JSON.parse(readFileSync(GOLDEN, "utf8")) as RecipeEquivalenceOutputs;

  it("the Italian depletes 4 oz of turkey through the chain label and 9 oz of tomato through the avg", () => {
    const italian = golden().global!.menuOz["m-italian"]!;
    expect(italian["s-turkey"]).toBeCloseTo(4, 10);
    expect(italian["s-tomato"]).toBeCloseTo(9, 10);
  });

  it("the slaw makes 2: 24 oz lettuce and 8 oz mayo per unit", () => {
    const slaw = golden().global!.itemOz["i-slaw"]!;
    expect(slaw["s-lettuce"]).toBeCloseTo(24, 10);
    expect(slaw["s-mayo"]).toBeCloseTo(8, 10);
  });

  it("the quiet day's dated depletion equals live, for every scope", () => {
    for (const scope of ["global", LOC, OTHER]) {
      const g = golden()[scope]!;
      expect(g.datedMenuOz[QUIET_DAY]).toEqual(g.menuOz);
    }
  });

  it("the board prices the lunch Italian through 'same as' and leaves the retired sub off", () => {
    const rows = golden().global!.board.rows as Array<{ id: string; menuPrice: number | null; priceSource: string | null }>;
    expect(rows.find((r) => r.id === "m-italian")!.menuPrice).toBe(12.5);
    expect(rows.find((r) => r.id === "m-italian-lunch")).toMatchObject({ menuPrice: 12.5, priceSource: "same_as" });
    expect(rows.some((r) => r.id === "m-old")).toBe(false);
  });

  it("every shop board names and prices the menu exactly as global (no overlays exist)", () => {
    const pick = (rows: unknown[]) => (rows as Array<{ id: string; name: string; menuPrice: number | null }>).map((r) => [r.id, r.name, r.menuPrice]);
    const g = golden();
    expect(pick(g[LOC]!.board.rows)).toEqual(pick(g.global!.board.rows));
    expect(pick(g[OTHER]!.board.rows)).toEqual(pick(g.global!.board.rows));
  });
});
```

- [ ] **Step 4: Generate the golden with TODAY's code, then prove it reproduces**

```bash
UPDATE_RECIPE_VERSIONS_GOLDEN=1 npx vitest run tests/recipe-versions-equivalence.test.ts
npx vitest run tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts
```

Expected: the first run writes `tests/fixtures/recipe-versions-golden.json` and passes. The second run passes all three files, 0 failed. **If an anchor fails, the fixture or the harness is wrong. Fix that, never the anchor.**

- [ ] **Step 5: Create the read-only snapshot comparison `tests/recipe-versions-snapshot.test.ts`**

```ts
/**
 * Catalog Phase 3a — THE SAME PIN OVER A PROD-SHAPED SNAPSHOT (spec §8). Skipped unless
 * RECIPE_VERSIONS_SNAPSHOT_DIR is set, so CI never runs it. READ-ONLY BY CONSTRUCTION: the snapshot is
 * a directory of `<table>.json` files exported with SELECT statements only (Step 8); this test loads
 * them into the in-memory stand-in and never touches a database.
 *
 * TWO INDEPENDENT CAPTURES, NOTHING RECONSTRUCTED (Astra 3a r1#7):
 *   1. BEFORE — a PRE-migration export (it must NOT contain the 0262/0263 tables), computed by the Task 1
 *      commit's code. Writes { fingerprint, outputs }:
 *        RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-before RECIPE_VERSIONS_SNAPSHOT_OUT=tmp/recipe-before.json \
 *          npx vitest run tests/recipe-versions-snapshot.test.ts
 *   2. AFTER — a POST-migration export that MUST contain the real recipe_versions, recipe_version_lines and
 *      menu_item_shop_settings (no synthetic backfill, ever), computed by the finished branch's code:
 *        RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-after RECIPE_VERSIONS_SNAPSHOT_BASELINE=tmp/recipe-before.json \
 *          npx vitest run tests/recipe-versions-snapshot.test.ts
 *      It refuses unless the base tables are byte-identical to the BEFORE capture (same fingerprint — the
 *      data did not move between the captures), then checks the persisted journal itself (every recipe has
 *      exactly one live global version, from 2000-01-01, whose lines equal recipe_inputs), then compares
 *      the numbers.
 *   RECIPE_VERSIONS_SNAPSHOT_DAYS (default: yesterday ET) is a comma list of dated business dates.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { computeRecipeOutputs, liveRecipeApi, type RecipeEquivalenceOutputs } from "./fixtures/recipe-versions-harness";

/** The tables 0262/0263 create. A BEFORE export must not have them; an AFTER export must have the first three. */
const NEW_TABLES = ["recipe_versions", "recipe_version_lines", "menu_item_shop_settings", "recipe_notice_dismissals"];
const REQUIRED_AFTER = ["recipe_versions", "recipe_version_lines", "menu_item_shop_settings"];
const LINE_FIELDS = ["component_sku_id", "component_item_id", "component_product_id", "quantity", "unit",
  "each_container_label", "portioned", "display_order"] as const;

type Tables = Record<string, Array<Record<string, unknown>>>;
interface BeforeCapture { fingerprint: string; outputs: RecipeEquivalenceOutputs }

const DIR = process.env.RECIPE_VERSIONS_SNAPSHOT_DIR;

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

/** The export as it is — NO table is ever synthesized here. */
function loadSnapshot(dir: string): Tables {
  const tables: Tables = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    tables[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<Record<string, unknown>>;
  }
  return tables;
}

/** The base tables (every exported table but the new ones), hashed per table: equal fingerprints = the data did not move. */
function fingerprintOf(tables: Tables): string {
  const per = Object.keys(tables).filter((t) => !NEW_TABLES.includes(t)).sort()
    .map((t) => `${t}:${createHash("sha256").update(JSON.stringify(tables[t])).digest("hex")}`);
  return per.join("\n");
}

/** The persisted journal, checked directly: one live global version per recipe, from 2000-01-01, lines = recipe_inputs. */
function journalProblems(tables: Tables): string[] {
  const problems: string[] = [];
  const key = (l: Record<string, unknown>) => JSON.stringify(LINE_FIELDS.map((f) => (l[f] == null ? null : String(l[f]))));
  const versions = tables.recipe_versions ?? [];
  const linesByVersion = new Map<string, string[]>();
  for (const l of tables.recipe_version_lines ?? []) {
    const list = linesByVersion.get(String(l.version_id)) ?? [];
    list.push(key(l));
    linesByVersion.set(String(l.version_id), list);
  }
  const inputsByRecipe = new Map<string, string[]>();
  for (const i of tables.recipe_inputs ?? []) {
    const list = inputsByRecipe.get(String(i.recipe_id)) ?? [];
    list.push(key(i));
    inputsByRecipe.set(String(i.recipe_id), list);
  }
  for (const r of tables.recipes ?? []) {
    const live = versions.filter((v) => v.recipe_id === r.id && v.location_id == null && v.active === true);
    if (live.length !== 1) { problems.push(`${String(r.id)}: ${live.length} live global versions`); continue; }
    const v = live[0]!;
    if (!String(v.valid_from).startsWith("2000-01-01")) problems.push(`${String(r.id)}: baseline valid_from ${String(v.valid_from)}`);
    const a = [...(linesByVersion.get(String(v.id)) ?? [])].sort();
    const b = [...(inputsByRecipe.get(String(r.id)) ?? [])].sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${String(r.id)}: baseline lines differ from recipe_inputs`);
  }
  if (versions.some((v) => v.location_id != null)) problems.push("shop versions exist right after the apply");
  if ((tables.menu_item_shop_settings ?? []).length > 0) problems.push("menu shop settings exist right after the apply");
  return problems;
}

function yesterdayEt(): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!DIR)("prod-shaped snapshot — the same recipe and menu numbers before and after", () => {
  it("computes, and writes (BEFORE) or verifies and compares (AFTER)", async () => {
    const tables = loadSnapshot(DIR!);
    const outPath = process.env.RECIPE_VERSIONS_SNAPSHOT_OUT;
    const basePath = process.env.RECIPE_VERSIONS_SNAPSHOT_BASELINE;
    expect(Boolean(outPath) !== Boolean(basePath), "set exactly one of RECIPE_VERSIONS_SNAPSHOT_OUT / _BASELINE").toBe(true);
    if (outPath) {
      // BEFORE: a pre-migration export, or it is not an independent "before".
      expect(NEW_TABLES.filter((t) => t in tables), "a BEFORE export must predate 0262/0263").toEqual([]);
    } else {
      // AFTER: the REAL persisted tables, never a reconstruction.
      expect(REQUIRED_AFTER.filter((t) => !(t in tables)), "an AFTER export must include the persisted 0262/0263 tables").toEqual([]);
      expect(journalProblems(tables)).toEqual([]);
    }
    current = createFakeDb(tables);
    const shops = (tables.locations ?? []).filter((l) => l.active !== false).map((l) => String(l.id)).sort();
    const days = (process.env.RECIPE_VERSIONS_SNAPSHOT_DAYS ?? yesterdayEt()).split(",").map((d) => d.trim()).filter(Boolean);
    const got = await computeRecipeOutputs(liveRecipeApi, tables, shops, days);
    if (outPath) {
      const capture: BeforeCapture = { fingerprint: fingerprintOf(tables), outputs: got };
      writeFileSync(outPath, `${JSON.stringify(capture, null, 2)}\n`);
      return;
    }
    expect(existsSync(basePath!)).toBe(true);
    const before = JSON.parse(readFileSync(basePath!, "utf8")) as BeforeCapture;
    // The data did not move between the two captures; if it did, the proof is INCONCLUSIVE — never "re-take
    // the before from the after".
    expect(fingerprintOf(tables), "base tables moved between the captures: inconclusive (Task 12 Step 6)").toBe(before.fingerprint);
    expect(got).toEqual(before.outputs);
  });
});
```

(Inline `toLocaleDateString` is a test helper, never UI; the AGENTS.md format rule covers rendered dates.)

- [ ] **Step 6: Run**

Run: `npx vitest run tests/recipe-versions-equivalence.test.ts tests/recipe-versions-snapshot.test.ts`
Expected: 1 file passes, and `recipe-versions-snapshot.test.ts` reports 1 skipped.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/recipe-versions-fixture.ts tests/fixtures/recipe-versions-harness.ts tests/fixtures/recipe-versions-golden.json tests/recipe-versions-equivalence.test.ts tests/recipe-versions-snapshot.test.ts
git commit -F - <<'EOF'
test(catalog): the recipe/menu equivalence pin — today's numbers frozen before any change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

- [ ] **Step 8: The read-only export (how each snapshot is taken)**

Run these through the Supabase MCP `execute_sql`, SELECT only, against the sim for a rehearsal, or prod with Juan's word. Save each result array as `<dir>/<table>.json` — `tmp/recipe-snap-before/` for the BEFORE capture (taken immediately before the apply, Task 12 Step 6), `tmp/recipe-snap-after/` for the AFTER capture (immediately after). `tmp/` must be git-ignored; check with `git check-ignore tmp/x`. The BEFORE capture runs only the base list; the AFTER capture runs the base list AND the four persisted-table lines at the end. The two captures are independent reads of the database; nothing in the AFTER directory is ever derived from the BEFORE one or synthesized.

```sql
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendors t;
select coalesce(json_agg(t order by t.label), '[]'::json) from public.measure_units t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.sku_pack_levels t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.sku_pack_versions t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.sku_price_lanes t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.products t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.product_primaries t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.location_sku_settings t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_deliveries t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_delivery_items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipes t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_inputs t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_outputs t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.menu_items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_price_history t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.locations t;
-- AFTER capture only (these tables do not exist before 0262/0263):
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_versions t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_version_lines t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.menu_item_shop_settings t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_notice_dismissals t;
```

Rehearse on the sim now (sim BEFORE capture on this commit: `RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-before RECIPE_VERSIONS_SNAPSHOT_OUT=tmp/recipe-before.json npx vitest run tests/recipe-versions-snapshot.test.ts` → 1 passed). The PROD before/after pair is taken in Task 12 Step 6, around the apply, and computed with this commit's code for BEFORE (`git worktree add ../recipe-p3a-task1 <task-1-sha>`) and the final branch's for AFTER.

---
## Task 2: The pure resolver, the line ops, the line diff, the gate, the cycle mirror (`lib/recipe-versions-shared.ts`)

**Files:**
- Create: `lib/recipe-versions-shared.ts`
- Test: `tests/recipe-versions-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3a — the ONE recipe-version resolver (pure): live, as of an instant, the line ops, the gate, the cycle mirror. */
import { describe, expect, it } from "vitest";
import {
  RECIPE_GLOBAL_WRITE_MIN, RECIPE_SHOP_WRITE_MIN, applyRecipeLineOp, diffRecipeLineSets, parseRecipeLineOp,
  pickLiveShopRecipeVersions, pickRecipeVersionsAsOf, recipeLineReplacements, recipeLinesWouldCycle,
  recipeVersionWriteGate, rpcRecipeLines, scopedItemEdges, versionIdsNeedingLines,
  type LiveRecipeLine, type RecipeVersionLineRow, type RecipeVersionRow,
} from "@/lib/recipe-versions-shared";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

const SHOP_A = "6f1d2c3e-0000-4000-8000-00000000000a";
const SHOP_B = "6f1d2c3e-0000-4000-8000-00000000000b";
const v = (id: string, recipe: string, loc: string | null, from: string, to: string | null): RecipeVersionRow =>
  ({ id, recipe_id: recipe, location_id: loc, valid_from: from, valid_to: to, active: to === null });
const line = (id: string, version: string, recipe: string, sku: string, qty: number, order: number): RecipeVersionLineRow => ({
  id, version_id: version, recipe_id: recipe, component_sku_id: sku, component_item_id: null, component_product_id: null,
  quantity: qty, unit: "oz", each_container_label: null, portioned: false, display_order: order,
});
const f = (sku: string, qty: number, unit = "oz"): RecipeLineFields =>
  ({ componentSkuId: sku, componentItemId: null, componentProductId: null, quantity: qty, unit, eachContainerLabel: null, portioned: false });

describe("live — a shop's own live version answers; the global head never needs lines", () => {
  const versions = [
    v("g-ital", "italian", null, "2000-01-01T00:00:00Z", null),
    v("s-ital", "italian", SHOP_A, "2026-10-10T00:00:00Z", null),
    v("s-old", "slaw", SHOP_A, "2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z"),
    v("b-ital", "italian", SHOP_B, "2026-10-11T00:00:00Z", null),
  ];
  it("shop A gets its own live Italian; its retired slaw version is not live; B's version is never A's", () => {
    const picked = pickLiveShopRecipeVersions(versions, SHOP_A);
    expect([...picked.keys()]).toEqual(["italian"]);
    expect(picked.get("italian")!.id).toBe("s-ital");
  });
  it("the global scope picks nothing live (recipe_inputs IS the live global)", () => {
    expect(pickLiveShopRecipeVersions(versions, null).size).toBe(0);
  });
});

describe("as of an instant — the version IN FORCE then", () => {
  const versions = [
    v("g1", "italian", null, "2000-01-01T00:00:00Z", "2026-10-15T14:00:00Z"),
    v("g2", "italian", null, "2026-10-15T14:00:00Z", null),
    v("s1", "slaw", SHOP_A, "2026-10-10T00:00:00Z", "2026-10-12T00:00:00Z"), // back to default on 10-12
    v("gs", "slaw", null, "2000-01-01T00:00:00Z", null),
  ];
  it("yesterday reads the old global version; today the new head", () => {
    expect(pickRecipeVersionsAsOf(versions, null, "2026-10-15T03:59:59.999Z").get("italian")!.id).toBe("g1");
    expect(pickRecipeVersionsAsOf(versions, null, "2026-10-16T03:59:59.999Z").get("italian")!.id).toBe("g2");
  });
  it("a retired shop version answers only inside its own dates", () => {
    expect(pickRecipeVersionsAsOf(versions, SHOP_A, "2026-10-11T12:00:00Z").get("slaw")!.id).toBe("s1");
    expect(pickRecipeVersionsAsOf(versions, SHOP_A, "2026-10-13T12:00:00Z").get("slaw")!.id).toBe("gs");
    expect(pickRecipeVersionsAsOf(versions, SHOP_B, "2026-10-11T12:00:00Z").get("slaw")!.id).toBe("gs");
  });
  it("only non-head versions need their lines read; replacements are in line order", () => {
    const picked = pickRecipeVersionsAsOf(versions, SHOP_A, "2026-10-11T12:00:00Z");
    expect(versionIdsNeedingLines(picked).sort()).toEqual(["g1", "s1"]);
    const rep = recipeLineReplacements(picked, [line("b", "s1", "slaw", "mayo", 24, 1), line("a", "s1", "slaw", "lettuce", 48, 0), line("x", "gs", "slaw", "mayo", 16, 1)]);
    expect(rep.get("slaw")!.map((l) => l.id)).toEqual(["a", "b"]);
    expect(rep.has("italian")).toBe(true); // g1 is NOT the live head: its own lines answer
    expect(rep.get("italian")).toEqual([]);  // (none were supplied here)
  });
  it("the LIVE global head is never a replacement — recipe_inputs answers, byte for byte", () => {
    const picked = pickRecipeVersionsAsOf(versions, null, "2026-10-16T03:59:59.999Z");
    expect(versionIdsNeedingLines(picked)).toEqual([]);
    expect(recipeLineReplacements(picked, []).size).toBe(0);
  });
});

describe("line ops — the edit a person makes, applied to the set they saw", () => {
  const lines: LiveRecipeLine[] = [{ lineId: "l1", fields: f("turkey", 4) }, { lineId: "l2", fields: f("mayo", 1) }];
  it("update replaces exactly one line and keeps its id", () => {
    const r = applyRecipeLineOp(lines, { kind: "update", lineId: "l1", line: f("turkey", 5), expected: f("turkey", 4) });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (r.ok) expect(r.lines).toEqual([{ lineId: "l1", fields: f("turkey", 5) }, lines[1]]);
  });
  it("a stale expected line is 409 line_changed; a missing line 404; nothing-changed is a no-op", () => {
    expect(applyRecipeLineOp(lines, { kind: "update", lineId: "l1", line: f("turkey", 5), expected: f("turkey", 3) })).toEqual({ ok: false, status: 409, code: "line_changed" });
    expect(applyRecipeLineOp(lines, { kind: "remove", lineId: "zz", expected: f("turkey", 4) })).toEqual({ ok: false, status: 404, code: "edge_not_found" });
    expect(applyRecipeLineOp(lines, { kind: "update", lineId: "l1", line: f("turkey", 4, " oz "), expected: f("turkey", 4) })).toMatchObject({ ok: true, changed: false });
  });
  it("add appends a new line (no id); removing the last line is refused", () => {
    const r = applyRecipeLineOp(lines, { kind: "add", line: f("pickle", 1) });
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines[2]).toEqual({ lineId: null, fields: f("pickle", 1) });
    expect(applyRecipeLineOp([lines[0]!], { kind: "remove", lineId: "l1", expected: f("turkey", 4) })).toEqual({ ok: false, status: 400, code: "empty_recipe" });
  });
  it("the RPC payload names the kept line and every column", () => {
    expect(rpcRecipeLines([{ lineId: "l1", fields: f("turkey", 5) }])).toEqual([{
      keep_id: "l1", component_sku_id: "turkey", component_item_id: null, component_product_id: null,
      quantity: 5, unit: "oz", each_container_label: null, portioned: false,
    }]);
  });
});

describe("parseRecipeLineOp — the route's one parser", () => {
  const SKU = "7d0c1f2e-0000-4000-8000-000000000001";
  const LINE = "7d0c1f2e-0000-4000-8000-000000000009";
  it("accepts the three kinds with uuid ids", () => {
    expect(parseRecipeLineOp({ kind: "add", line: { componentSkuId: SKU, quantity: 2, unit: "oz" } })).toMatchObject({ ok: true, op: { kind: "add" } });
    expect(parseRecipeLineOp({ kind: "remove", lineId: LINE, expected: { componentSkuId: SKU, quantity: 2, unit: "oz" } })).toMatchObject({ ok: true, op: { kind: "remove", lineId: LINE } });
  });
  it("refuses a non-uuid id anywhere, an unknown kind, and a bad line", () => {
    expect(parseRecipeLineOp({ kind: "add", line: { componentSkuId: "x", quantity: 2 } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineOp({ kind: "remove", lineId: "nope", expected: { componentSkuId: SKU, quantity: 2 } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineOp({ kind: "rename" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineOp({ kind: "add", line: { componentSkuId: SKU, quantity: 0 } })).toEqual({ ok: false, code: "invalid_quantity" });
  });
});

describe("diffRecipeLineSets — what changed, in plain terms (by ingredient)", () => {
  it("changed, added and removed lines", () => {
    const d = diffRecipeLineSets([f("turkey", 4), f("mayo", 1)], [f("turkey", 5), f("pickle", 1)]);
    expect(d.map((c) => [c.kind, c.key])).toEqual([["changed", "sku:turkey"], ["added", "sku:pickle"], ["removed", "sku:mayo"]]);
  });
  it("identical sets differ by nothing", () => {
    expect(diffRecipeLineSets([f("turkey", 4)], [f("turkey", 4, "oz ")])).toEqual([]);
  });
});

describe("the gate (spec §2) — GM own shop; MoO any shop and global", () => {
  it("floors", () => { expect([RECIPE_SHOP_WRITE_MIN, RECIPE_GLOBAL_WRITE_MIN]).toEqual([7, 8]); });
  it("a shop version needs level 7 AND the shop", () => {
    expect(recipeVersionWriteGate({ level: 6, scope: SHOP_A, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(recipeVersionWriteGate({ level: 7, scope: SHOP_B, scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(recipeVersionWriteGate({ level: 7, scope: SHOP_A, scopeAllowed: true })).toEqual({ ok: true });
  });
  it("a GM never edits the global recipe; MoO does", () => {
    expect(recipeVersionWriteGate({ level: 7, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(recipeVersionWriteGate({ level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(recipeVersionWriteGate({ level: 8, scope: null, scopeAllowed: false })).toEqual({ ok: true });
  });
});

describe("the cycle mirror (0262 recipe_scope_item_edges + recipe_lines_would_cycle)", () => {
  // slaw-r makes SLAW from DRESSING; dress-r makes DRESSING (from no items).
  const outputs = [{ recipe_id: "slaw-r", output_item_id: "SLAW" }, { recipe_id: "dress-r", output_item_id: "DRESSING" }];
  const global = [{ recipe_id: "slaw-r", component_item_id: "DRESSING" }];
  it("global: dressing consuming slaw closes a loop", () => {
    const edges = scopedItemEdges(global, new Map(), []);
    expect(recipeLinesWouldCycle({ recipeId: "dress-r", lineItemIds: ["SLAW"], startItemIds: ["SLAW"] }, outputs, edges)).toBe(true);
  });
  it("shop A's own slaw no longer uses dressing — the same dressing edit is safe THERE", () => {
    const edges = scopedItemEdges(global, new Map([["slaw-r", "sv"]]), [{ version_id: "sv", recipe_id: "slaw-r", component_item_id: null }]);
    expect(recipeLinesWouldCycle({ recipeId: "dress-r", lineItemIds: ["SLAW"], startItemIds: ["SLAW"] }, outputs, edges)).toBe(false);
  });
  it("the recipe's OWN old lines are replaced by the new set, never walked", () => {
    const edges = scopedItemEdges([...global, { recipe_id: "dress-r", component_item_id: "SLAW" }], new Map(), []);
    expect(recipeLinesWouldCycle({ recipeId: "dress-r", lineItemIds: [], startItemIds: [] }, outputs, edges)).toBe(false);
  });
});
```

Run: `npx vitest run tests/recipe-versions-shared.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/recipe-versions-shared"`.

- [ ] **Step 2: Create `lib/recipe-versions-shared.ts`**

```ts
/**
 * Shop versions of a RECIPE's lines — THE ONE RESOLVER, PURE (catalog Phase 3a, migration 0262;
 * spec 2026-10-15 §3). Client-safe: no I/O, no server imports.
 *
 * THE MODEL. `recipe_inputs` stays the GLOBAL DEFAULT's live lines, so every existing reader and
 * Phase 1's line RPCs keep their meaning. Every version — the global default's history AND every
 * shop's version — is an effective-dated `recipe_versions` row owning a full line set in
 * `recipe_version_lines`. The global LIVE version ("the head") is the journal of recipe_inputs,
 * written in the same transaction as every change (0262 recipe_global_journal).
 *
 * THE RULE, ONE PLACE. A graph for scope S (null = global) at instant T (null = now) answers each
 * recipe's lines with S's version in force at T if S has one, else the global version in force at T —
 * and when that is the LIVE head, `recipe_inputs` itself (same rows, same order: byte-identical to
 * today). lib/prep-consumption.ts loadRecipeLineOverlay reads the rows and asks HERE; no consumer
 * ever picks a recipe version itself (AGENTS.md "RESOLUTION HAPPENS ONCE").
 *
 * WHAT A VERSION COVERS: the LINES (what goes in, how much). Outputs, yields, batch mode, shelf life,
 * name and directions stay global (lib/recipes.ts) in Phase 3.
 */
import {
  diffRecipeLine, normalizeRecipeLine, parseRecipeLinePatch, parseRecipeLineSnapshot, recipeLineKind,
  type RecipeLineFields,
} from "@/lib/recipe-line-shared";
import { GLOBAL_VERSION_WRITE_MIN, type VersionScope } from "@/lib/sku-versions-shared";

export const RECIPE_VERSION_READ_MIN = 6;
/** A GM (7) writes ITS OWN shops' recipe versions (spec §2: recipes are shop-level GM work). */
export const RECIPE_SHOP_WRITE_MIN = 7;
/** MoO (8)+ writes the global default and ANY active shop's version. */
export const RECIPE_GLOBAL_WRITE_MIN = GLOBAL_VERSION_WRITE_MIN;
/** The "since forever" start of every recipe's first global version (0262). */
export const RECIPE_BASELINE_FROM = "2000-01-01T00:00:00.000Z";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface RecipeVersionRow {
  id: string;
  recipe_id: string;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  active?: boolean | null;
}

export interface RecipeVersionLineRow {
  id: string;
  version_id: string;
  recipe_id: string;
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number | string;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean | null;
  display_order: number | null;
}

function isLive(v: RecipeVersionRow): boolean {
  return v.valid_to == null && v.active !== false;
}

/** The LIVE global head — its lines are recipe_inputs, so the graph never needs its journal copy. */
export function isLiveGlobalHead(v: RecipeVersionRow): boolean {
  return v.location_id === null && isLive(v);
}

// ── Live and as-of picks ──────────────────────────────────────────────────────

/** recipe → this shop's LIVE version (empty for the global scope: recipe_inputs is the live global). */
export function pickLiveShopRecipeVersions(versions: readonly RecipeVersionRow[], scope: VersionScope): Map<string, RecipeVersionRow> {
  const out = new Map<string, RecipeVersionRow>();
  if (scope === null) return out;
  for (const v of versions) if (v.location_id === scope && isLive(v)) out.set(v.recipe_id, v);
  return out;
}

function inForceAt(v: RecipeVersionRow, at: number): boolean {
  return Date.parse(v.valid_from) <= at && (v.valid_to == null || at < Date.parse(v.valid_to));
}

/**
 * recipe → the version IN FORCE at `asOf`: this shop's (if one was in force then) beats the global
 * one. A retired shop version answers only inside its own dates — "back to default", seen from the past.
 */
export function pickRecipeVersionsAsOf(versions: readonly RecipeVersionRow[], scope: VersionScope, asOf: string): Map<string, RecipeVersionRow> {
  const at = Date.parse(asOf);
  const shop = new Map<string, RecipeVersionRow>();
  const global = new Map<string, RecipeVersionRow>();
  for (const v of versions) {
    if (!inForceAt(v, at)) continue;
    const bucket = v.location_id === null ? global : scope !== null && v.location_id === scope ? shop : null;
    if (!bucket) continue;
    const prior = bucket.get(v.recipe_id);
    if (!prior || Date.parse(v.valid_from) > Date.parse(prior.valid_from)) bucket.set(v.recipe_id, v);
  }
  const out = new Map<string, RecipeVersionRow>(global);
  for (const [r, v] of shop) out.set(r, v);
  return out;
}

/** The versions whose journal lines must be read: every pick except the live global head. */
export function versionIdsNeedingLines(picked: ReadonlyMap<string, RecipeVersionRow>): string[] {
  return [...new Set([...picked.values()].filter((v) => !isLiveGlobalHead(v)).map((v) => v.id))];
}

/**
 * recipe → the lines that REPLACE its recipe_inputs in this graph, in line order (display_order, id).
 * The live global head is never a replacement. A picked version with no lines replaces with [] — the
 * honest answer for a version that held none.
 */
export function recipeLineReplacements(
  picked: ReadonlyMap<string, RecipeVersionRow>,
  lines: readonly RecipeVersionLineRow[],
): Map<string, RecipeVersionLineRow[]> {
  const byVersion = new Map<string, RecipeVersionLineRow[]>();
  for (const l of lines) {
    const list = byVersion.get(l.version_id) ?? [];
    list.push(l);
    byVersion.set(l.version_id, list);
  }
  const out = new Map<string, RecipeVersionLineRow[]>();
  for (const [recipe, v] of picked) {
    if (isLiveGlobalHead(v)) continue;
    const rows = [...(byVersion.get(v.id) ?? [])].sort((a, b) =>
      (a.display_order ?? 0) - (b.display_order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.set(recipe, rows);
  }
  return out;
}

// ── Line ops (the edit a person makes) ────────────────────────────────────────

/** One line of the set a person sees: `lineId` = its id in that set (null = a new line). */
export interface LiveRecipeLine {
  lineId: string | null;
  fields: RecipeLineFields;
}

export type RecipeLineOp =
  | { kind: "add"; line: RecipeLineFields }
  | { kind: "update"; lineId: string; line: RecipeLineFields; expected: RecipeLineFields }
  | { kind: "remove"; lineId: string; expected: RecipeLineFields };

export type LineOpResult =
  | { ok: true; lines: LiveRecipeLine[]; changed: boolean }
  | { ok: false; status: 400 | 404 | 409; code: "edge_not_found" | "line_changed" | "empty_recipe" };

/**
 * Apply ONE edit to the set the person saw. The line must still be what they saw (normalized), else
 * 409 line_changed — the version compare-and-set in SQL is the real guard; this is the friendly one.
 */
export function applyRecipeLineOp(lines: readonly LiveRecipeLine[], op: RecipeLineOp): LineOpResult {
  if (op.kind === "add") {
    return { ok: true, lines: [...lines, { lineId: null, fields: normalizeRecipeLine(op.line) }], changed: true };
  }
  const idx = lines.findIndex((l) => l.lineId === op.lineId);
  if (idx < 0) return { ok: false, status: 404, code: "edge_not_found" };
  const cur = lines[idx]!;
  if (diffRecipeLine(normalizeRecipeLine(op.expected), normalizeRecipeLine(cur.fields)).length > 0) {
    return { ok: false, status: 409, code: "line_changed" };
  }
  if (op.kind === "remove") {
    if (lines.length === 1) return { ok: false, status: 400, code: "empty_recipe" };
    return { ok: true, lines: lines.filter((_, i) => i !== idx), changed: true };
  }
  const next = normalizeRecipeLine(op.line);
  if (diffRecipeLine(normalizeRecipeLine(cur.fields), next).length === 0) return { ok: true, lines: [...lines], changed: false };
  return { ok: true, lines: lines.map((l, i) => (i === idx ? { lineId: l.lineId, fields: next } : l)), changed: true };
}

/** The save_recipe_version payload (0262): one object per line, the kept line's id as keep_id. */
export function rpcRecipeLines(lines: readonly LiveRecipeLine[]): Array<Record<string, unknown>> {
  return lines.map((l) => ({
    keep_id: l.lineId,
    component_sku_id: l.fields.componentSkuId,
    component_item_id: l.fields.componentItemId,
    component_product_id: l.fields.componentProductId,
    quantity: l.fields.quantity,
    unit: l.fields.unit,
    each_container_label: l.fields.eachContainerLabel,
    portioned: l.fields.portioned,
  }));
}

export type RecipeLineOpParse =
  | { ok: true; op: RecipeLineOp }
  | { ok: false; code: "invalid_payload" | "invalid_component" | "invalid_quantity" | "product_line_needs_measure_unit" };

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
function idsAreUuids(l: RecipeLineFields): boolean {
  return [l.componentSkuId, l.componentItemId, l.componentProductId].every((id) => id === null || isUuid(id));
}

/** The route's one parser: the kind, uuid ids, Phase 1's line rules (parseRecipeLinePatch / snapshot). */
export function parseRecipeLineOp(raw: unknown): RecipeLineOpParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  if (b.kind === "add") {
    const line = parseRecipeLinePatch(b.line);
    if (!line.ok) return line;
    return idsAreUuids(line.line) ? { ok: true, op: { kind: "add", line: line.line } } : { ok: false, code: "invalid_payload" };
  }
  if (b.kind !== "update" && b.kind !== "remove") return { ok: false, code: "invalid_payload" };
  if (!isUuid(b.lineId)) return { ok: false, code: "invalid_payload" };
  const expected = parseRecipeLineSnapshot(b.expected);
  if (!expected || !idsAreUuids(expected)) return { ok: false, code: "invalid_payload" };
  if (b.kind === "remove") return { ok: true, op: { kind: "remove", lineId: b.lineId, expected } };
  const line = parseRecipeLinePatch(b.line);
  if (!line.ok) return line;
  if (!idsAreUuids(line.line)) return { ok: false, code: "invalid_payload" };
  return { ok: true, op: { kind: "update", lineId: b.lineId, line: line.line, expected } };
}

// ── What changed (for the preview, the history and the Shop changes list) ─────

export function recipeLineTargetKey(l: Pick<RecipeLineFields, "componentSkuId" | "componentItemId" | "componentProductId">): string {
  const kind = recipeLineKind(l);
  return `${kind}:${kind === "sku" ? l.componentSkuId : kind === "item" ? l.componentItemId : l.componentProductId}`;
}

export interface RecipeLineChange {
  kind: "added" | "removed" | "changed";
  key: string;
  before: RecipeLineFields | null;
  after: RecipeLineFields | null;
}

/** Matched by ingredient, in order of appearance (a recipe may name an ingredient twice). */
export function diffRecipeLineSets(before: readonly RecipeLineFields[], after: readonly RecipeLineFields[]): RecipeLineChange[] {
  const pool = new Map<string, RecipeLineFields[]>();
  for (const b of before) {
    const key = recipeLineTargetKey(b);
    pool.set(key, [...(pool.get(key) ?? []), b]);
  }
  const out: RecipeLineChange[] = [];
  for (const a of after) {
    const key = recipeLineTargetKey(a);
    const b = pool.get(key)?.shift();
    if (!b) out.push({ kind: "added", key, before: null, after: a });
    else if (diffRecipeLine(normalizeRecipeLine(b), normalizeRecipeLine(a)).length > 0) out.push({ kind: "changed", key, before: b, after: a });
  }
  for (const [key, rest] of pool) for (const b of rest) out.push({ kind: "removed", key, before: b, after: null });
  return out;
}

// ── The write gate (spec §2) ──────────────────────────────────────────────────

export type RecipeWriteRefusal = { ok: false; status: 403 | 404; code: "forbidden" | "not_found" | "global_requires_moo" };

/**
 * Decided from the actor and the scope alone, before any I/O. `scopeAllowed` is the caller's
 * catalogShopAllowed(actor, scope) (2a: level ≥ 8 or a membership). A GM never edits the global
 * recipe: their edit is their shop's version (global_requires_moo names the reason).
 */
export function recipeVersionWriteGate(input: { level: number; scope: VersionScope; scopeAllowed: boolean }): { ok: true } | RecipeWriteRefusal {
  if (input.scope !== null) {
    if (input.level < RECIPE_SHOP_WRITE_MIN) return { ok: false, status: 403, code: "forbidden" };
    if (!input.scopeAllowed) return { ok: false, status: 404, code: "not_found" };
    return { ok: true };
  }
  if (input.level >= RECIPE_GLOBAL_WRITE_MIN) return { ok: true };
  if (input.level >= RECIPE_SHOP_WRITE_MIN) return { ok: false, status: 403, code: "global_requires_moo" };
  return { ok: false, status: 403, code: "forbidden" };
}

// ── The cycle mirror (0262 recipe_scope_item_edges + recipe_lines_would_cycle) ─

export interface ScopedItemEdge { recipe_id: string; component_item_id: string }

/**
 * The item edges scope S's graph resolves: the global item lines of every recipe S has no live
 * version of, plus the item lines of S's live versions. `shopLiveVersions` = recipe → S's live
 * version id (empty for the global scope).
 */
export function scopedItemEdges(
  globalInputs: ReadonlyArray<{ recipe_id: string; component_item_id: string | null }>,
  shopLiveVersions: ReadonlyMap<string, string>,
  shopLines: ReadonlyArray<{ version_id: string; recipe_id: string; component_item_id: string | null }>,
): ScopedItemEdge[] {
  const live = new Set(shopLiveVersions.values());
  const out: ScopedItemEdge[] = [];
  for (const i of globalInputs) {
    if (i.component_item_id === null || shopLiveVersions.has(i.recipe_id)) continue;
    out.push({ recipe_id: i.recipe_id, component_item_id: i.component_item_id });
  }
  for (const l of shopLines) {
    if (l.component_item_id === null || !live.has(l.version_id)) continue;
    out.push({ recipe_id: l.recipe_id, component_item_id: l.component_item_id });
  }
  return out;
}

/**
 * Would recipe R holding these item lines close a loop in this graph? R's own old edges are replaced
 * by `lineItemIds`; the walk starts at `startItemIds` and follows every producer's lines; a cycle iff
 * it reaches an item R outputs. The 0258 rule, per scope.
 */
export function recipeLinesWouldCycle(
  args: { recipeId: string; lineItemIds: readonly string[]; startItemIds: readonly string[] },
  outputs: ReadonlyArray<{ recipe_id: string; output_item_id: string | null }>,
  edges: readonly ScopedItemEdge[],
): boolean {
  const all = [
    ...edges.filter((e) => e.recipe_id !== args.recipeId),
    ...args.lineItemIds.map((item) => ({ recipe_id: args.recipeId, component_item_id: item })),
  ];
  const targets = new Set(outputs.filter((o) => o.recipe_id === args.recipeId && o.output_item_id !== null).map((o) => o.output_item_id as string));
  const reach = new Set<string>(args.startItemIds);
  const queue = [...args.startItemIds];
  while (queue.length > 0) {
    const item = queue.shift() as string;
    if (targets.has(item)) return true;
    const producers = new Set(outputs.filter((o) => o.output_item_id === item).map((o) => o.recipe_id));
    for (const e of all) {
      if (!producers.has(e.recipe_id) || reach.has(e.component_item_id)) continue;
      reach.add(e.component_item_id);
      queue.push(e.component_item_id);
    }
  }
  return false;
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/recipe-versions-shared.test.ts`
Expected: PASS, 0 failed.

```bash
git add lib/recipe-versions-shared.ts tests/recipe-versions-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): the one recipe-version resolver (live, as-of, replacements), line ops, the gate, the cycle mirror

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 3: Migration 0262 — recipe versions, the journal, per-shop cycle law, the writers, four re-emits, privilege ceilings

**Files:**
- Create: `supabase/migrations/0262_recipe_shop_versions.sql`
- Create: `scripts/recipe-versions/reemit-mods.ts`, `scripts/recipe-versions/emit-0262-reemits.ts`, `scripts/recipe-versions/sim-scenario.sql`
- Test: `tests/recipe-versions-migration.test.ts`

0262 is additive and **backward compatible with the code running in production when it is applied**: `recipe_inputs` keeps every column, constraint and reader; the four re-emitted functions keep their signatures, `SECURITY DEFINER`, `search_path` and grants; the only behaviour a pre-3a caller can observe is the journal row written at its commit and the refusal of a line that would close a loop in a SHOP's graph (no shop version exists until the 3a code ships, so that refusal cannot fire before then).

- [ ] **Step 1: Write the failing pin test `tests/recipe-versions-migration.test.ts`**

```ts
/**
 * Catalog Phase 3a — migration 0262 pinned: header + gate line; the dated version table and its
 * one-live index; the DB-proven line link; the backfill's assertions; the journal and its deferred
 * triggers; the per-shop cycle functions; the writers (SECURITY DEFINER, pinned search_path,
 * service_role only, graph lock FIRST); the privilege ceilings; and the four 0258 re-emits as
 * line-subsequences of their latest definer ± the enumerated mods, nothing else.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECIPE_REEMITS, applyMods, extractFunction, isLineSubsequence, normalize } from "../scripts/recipe-versions/reemit-mods";

const DIR = "supabase/migrations";
const read = (f: string) => normalize(readFileSync(`${DIR}/${f}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M0262 = "0262_recipe_shop_versions.sql";
const src = read(M0262);
const WRITERS = ["save_recipe_version", "retire_recipe_version", "remove_recipe_input_atomic"];
const HELPERS = [
  "recipe_journal_lines_equal", "recipe_global_journal", "recipe_inputs_journal_trg", "recipes_journal_trg",
  "recipe_scope_item_edges", "recipe_lines_would_cycle", "recipe_shops_input_would_cycle", "recipe_shops_output_would_cycle",
  "recipe_scope_lines", "recipe_change_closure", "recipe_change_lock",
];

describe("0262 header", () => {
  it("carries the house header and the gate line", () => {
    expect(src.split("\n")[0]).toBe("-- Migration 0262_recipe_shop_versions");
    expect(src).toContain("NOT YET APPLIED — apply via MCP after review");
  });
});

describe("0262 structure", () => {
  it("dated versions: one live per (recipe, scope), valid_to paired with active, the identity triple", () => {
    expect(src).toContain("create table if not exists public.recipe_versions");
    expect(src).toMatch(/scope_key\s+uuid\s+generated always as \(coalesce\(location_id, '00000000-0000-0000-0000-000000000000'::uuid\)\) stored/);
    expect(src).toContain("constraint recipe_versions_live_window check ((valid_to is null) = active)");
    expect(src).toContain("on public.recipe_versions (recipe_id, scope_key) where active;");
    expect(src).toContain("constraint recipe_versions_identity_uq unique (id, recipe_id, scope_key)");
  });
  it("lines are proven to belong to their version's recipe and shop, with the 3-way exactly-one rule", () => {
    expect(src).toContain("create table if not exists public.recipe_version_lines");
    expect(src).toContain("foreign key (version_id, recipe_id, scope_key) references public.recipe_versions (id, recipe_id, scope_key)");
    expect(src).toContain("constraint recipe_version_lines_exactly_one_component check");
  });
  it("the backfill gives every recipe ONE global baseline from 2000-01-01 and asserts instead of hoping", () => {
    expect(src).toContain("'2000-01-01T00:00:00Z'");
    expect(src).toContain("recipes without exactly one live global version");
    expect(src).toContain("baseline lines do not match recipe_inputs");
    // the triggers come AFTER the backfill, so the backfill journals nothing
    expect(src.indexOf("create constraint trigger recipe_inputs_journal")).toBeGreaterThan(src.indexOf("baseline lines do not match recipe_inputs"));
  });
  it("the cutover is closed: the table lock comes BEFORE the backfill, the triggers before COMMIT, then the per-recipe proof (Astra 3a r1#4)", () => {
    const lock = src.indexOf("lock table public.recipes, public.recipe_inputs in share row exclusive mode;");
    expect(lock).toBeGreaterThan(src.indexOf("\nbegin;"));
    expect(lock).toBeLessThan(src.indexOf("insert into public.recipe_versions (recipe_id, location_id, active, valid_from, note)"));
    expect(src.indexOf("select pg_advisory_xact_lock(7258025800);")).toBeLessThan(lock);
    const proof = src.indexOf("a line write landed during the cutover");
    expect(proof).toBeGreaterThan(src.indexOf("create constraint trigger recipes_journal"));
    // nothing commits between the lock and the triggers: the file's only COMMIT is its last statement
    expect(src.indexOf("\ncommit;")).toBe(src.lastIndexOf("\ncommit;"));
    expect(src.indexOf("\ncommit;")).toBeGreaterThan(proof);
  });
  it("the dependency snapshot is SCOPED to the change's closure — never a whole table (lead decision (a), Astra r2#1/#2)", () => {
    const snap = extractFunction(src, "create or replace function public.recipe_change_snapshot(", "\n$$;");
    expect(src).not.toContain("catalog_table_digest");
    expect(snap).toContain("from public.recipe_change_closure(p_recipe, p_location, p_lines);");
    // product resolution's inputs: product rows, members, primaries, activation overlay, vendors, receipts
    for (const needle of ["from public.products t where t.id = any(v_products)", "from public.product_primaries t",
      "from public.location_sku_settings t where t.sku_id = any(v_skus)", "from public.vendors t where t.id = any(v_vendors)",
      "from public.vendor_delivery_items di", "from public.vendor_items t where t.id = any(v_skus)",
      "from public.sku_pack_versions t", "from public.vendor_price_history t", "from public.sku_price_lanes t"]) {
      expect(snap, needle).toContain(needle);
    }
    const closure = extractFunction(src, "create or replace function public.recipe_change_closure(", "\n$$;");
    expect(closure).toContain("select vi.id from public.vendor_items vi join products p on vi.product_id = p.product_id"); // every member
    expect(closure).toContain("up(recipe_id) as (");   // the sandwiches the preview shows
    expect(closure).toContain("down(recipe_id) as ("); // everything their costs read
    // flat-pack measurement and only the affected shops (Astra r3)
    expect(closure).toContain("union select 'measure', vi.each_measure from public.vendor_items vi join skus s on s.id = vi.id");
    expect(closure).toContain("then not exists (select 1 from public.recipe_versions v");
    expect(closure).not.toContain("where s.active and (p_location is null or s.id = p_location)");
  });
  it("serialized: the closure locks (NOWAIT, after the graph lock) come BEFORE the snapshot re-check in both writers (Astra r2#3)", () => {
    const lockFn = extractFunction(src, "create or replace function public.recipe_change_lock(", "\n$$;");
    expect(lockFn).toContain("lock table public.locations, public.measure_units in share mode nowait;");
    expect(lockFn).toContain("from public.products where id = any(v_products) order by id for update nowait;");
    expect(lockFn).toContain("from public.vendor_items where id = any(v_skus) order by id for update nowait;");
    expect(lockFn).toContain("when lock_not_available then");
    expect(lockFn).toContain("'recipe_version:dependencies_busy'");
    for (const [fn, lines] of [["save_recipe_version", "v_lines"], ["retire_recipe_version", "v_default"]] as const) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      const graph = body.indexOf("pg_advisory_xact_lock(7258025800)");
      const lock = body.indexOf("perform public.recipe_change_lock(");
      const check = body.indexOf("public.recipe_change_snapshot(");
      expect(graph).toBeGreaterThan(-1);
      expect(lock).toBeGreaterThan(graph);
      expect(check).toBeGreaterThan(lock);
      expect(body).toContain(`, ${lines}) is distinct from p_snapshot`);
      expect(body).toContain("'recipe_version:dependencies_changed'");
    }
    expect(src).toContain("grant execute on function public.recipe_change_snapshot(uuid, uuid, jsonb) to service_role;");
    expect(src).toContain("revoke all on function public.recipe_change_lock(uuid, uuid, jsonb) from public, anon, authenticated, service_role;");
  });
  it("the product rule: no ADDED or CREATED invalid line, carried ones may stay, and the refusal names the line (lead decision (b))", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    const copy = save.indexOf("from public.recipe_version_lines l where l.version_id = v_source.id;");
    const check = save.indexOf("public.recipe_change_snapshot(p_recipe, p_location, v_lines)");
    const rule = save.indexOf("'recipe_version:product_line_invalid:%', v_i + 1");
    expect(rule).toBeGreaterThan(copy);
    expect(rule).toBeGreaterThan(check); // validated against the locked, re-checked state
    expect(save).toContain("where m.label = btrim(v_line ->> 'unit') and m.active");
    expect(save).toContain("and cur.quantity = (v_line ->> 'quantity')::numeric");
    // a copied set carries nothing; an edit's carried lines are counted with multiplicity (Astra r3#3)
    expect(save).toContain("v_copy := coalesce(p_restored_from, p_adopted_from, p_promoted_from) is not null;");
    expect(save).toContain("if v_seen > v_have then");
  });
  it("PROMOTE retires its source in the same transaction, closing when the new default opens (lead decision 5)", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    const journal = save.indexOf("v_new := public.recipe_global_journal(p_recipe, p_actor, p_promoted_from,");
    const changed = save.indexOf("v_changed := coalesce(");
    const retire = save.indexOf("where id = p_promoted_from and active;");
    expect(journal).toBeGreaterThan(-1);
    expect(changed).toBeGreaterThan(journal);
    expect(retire).toBeGreaterThan(changed);
    expect(save).toContain("valid_to = greatest((select valid_from from public.recipe_versions where id = v_new), valid_from),");
    expect(save).toContain("'returned_shop', case when p_promoted_from is not null then v_source.location_id end,");
  });
  it("provenance follows the content: an EDIT keeps it; a RESTORE takes the restored version's pointer (none = ended) (Astra 3a r5#1, r6)", () => {
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    expect(save).toContain("v_new_adopted := case when p_adopted_from is not null then p_adopted_from");
    expect(save).toContain("else (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = v_live) end;");
    // the END is recorded explicitly from the replaced row, never inferred (Astra r7)
    expect(save).toContain("v_ended := case when v_live is not null and v_new_adopted is null");
    const retire = extractFunction(src, "create or replace function public.retire_recipe_version(", "\n$$;");
    expect(retire).toContain("adoption_ended_from_version_id = coalesce(adoption_ended_from_version_id,"); // never nulls an earlier record (Astra r8)
    // every closing UPDATE of a version / overlay row touches only a LIVE row: a retired row's history columns are never rewritten
    for (const fn of ["recipe_global_journal", "save_recipe_version", "retire_recipe_version"]) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      for (const m of body.matchAll(/update public\.recipe_versions[\s\S]*?;/g)) expect(m[0], fn).toMatch(/and active;$/);
    }
  });
  it("the journal: graph lock, then the recipe row; a same-transaction head is updated, never versioned twice", () => {
    const body = extractFunction(src, "create or replace function public.recipe_global_journal(", "\n$$;");
    expect(body.indexOf("pg_advisory_xact_lock(7258025800)")).toBeLessThan(body.indexOf("from public.recipes where id = p_recipe for update"));
    expect(body).toContain("v_head.created_xact = pg_current_xact_id()");
    expect(body).toContain("current_setting('app.recipe_journal_actor', true)");
    expect(body).toContain("then v_now else '2000-01-01T00:00:00Z'::timestamptz end");
  });
  it("deferred constraint triggers journal every line change and every new recipe at COMMIT", () => {
    expect(src).toMatch(/create constraint trigger recipe_inputs_journal\s+after insert or update or delete on public\.recipe_inputs\s+deferrable initially deferred/);
    expect(src).toMatch(/create constraint trigger recipes_journal\s+after insert on public\.recipes\s+deferrable initially deferred/);
  });
  it("the cycle law per shop: a shop's graph substitutes its own versions", () => {
    const edges = extractFunction(src, "create or replace function public.recipe_scope_item_edges(", "\n$$;");
    expect(edges).toContain("from public.recipe_version_lines l");
    expect(edges).toContain("v.location_id = p_scope and v.active");
  });
  it("every writer: SECURITY DEFINER, pinned search_path, service_role only, takes the graph lock (save: before its first row lock)", () => {
    for (const fn of WRITERS) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = pg_catalog, public");
      expect(body).toContain("perform pg_advisory_xact_lock(7258025800);");
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    const save = extractFunction(src, "create or replace function public.save_recipe_version(", "\n$$;");
    expect(save.indexOf("pg_advisory_xact_lock(7258025800)")).toBeLessThan(save.indexOf("for update"));
    expect(save).toContain("recipe_version:version_changed");
    expect(save).toContain("public.recipe_global_journal(p_recipe, p_actor, p_promoted_from,");
    // adopt / promote / restore COPY the source in SQL; the caller's payload is ignored for them
    expect(save).toContain("from public.recipe_version_lines l where l.version_id = v_source.id;");
  });
  it("helpers are callable by nobody but their definer callers", () => {
    for (const fn of HELPERS) {
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`));
    }
    expect(src).toContain("raise exception '0262: unexpected execute grant'");
  });
  it("privilege ceilings: revoke all (service_role too), grant exactly, RLS deny-all, asserted both ways", () => {
    const grants: Record<string, string> = {
      recipe_versions: "select, insert, update", recipe_version_lines: "select, insert", recipe_notice_dismissals: "select, insert",
    };
    for (const [t, g] of Object.entries(grants)) {
      expect(src).toContain(`alter table public.${t} enable row level security;`);
      expect(src).toContain(`create policy ${t}_no_user_select on public.${t} for select using (false);`);
      expect(src).toContain(`create policy ${t}_no_user_delete on public.${t} for delete using (false);`);
      expect(src).toContain(`revoke all on public.${t} from public, anon, authenticated, service_role;`);
      expect(src).toContain(`grant ${g} on public.${t} to service_role;`);
      expect(src).toContain(`has_table_privilege('service_role', 'public.${t}', 'DELETE')`);
    }
    expect(src).toContain("raise exception '0262: service_role above its ceiling'");
    expect(src).toContain("raise exception '0262: service_role is missing a privilege the writers need'");
  });
});

describe("0262 re-emits the four 0258 graph writers faithfully", () => {
  for (const r of RECIPE_REEMITS) {
    describe(r.name, () => {
      it(`${r.source} was the latest definer before 0262, and 0262 is now`, () => {
        const defining = files.filter((f) => read(f).includes(r.start));
        expect(defining[defining.length - 1]).toBe(M0262);
        expect(defining[defining.length - 2]).toBe(r.source);
      });
      it("the source body (± the enumerated mods) is a line-subsequence of the 0262 body", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const check = isLineSubsequence(source, extractFunction(src, r.startReplaced, r.end));
        expect(check.ok, `missing from 0262 → ${check.missing}`).toBe(true);
      });
      it("adds nothing beyond the mods except comment lines", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const srcLines = new Set(source.split("\n").map((l) => l.trimEnd()));
        const extra = extractFunction(src, r.startReplaced, r.end).split("\n").map((l) => l.trimEnd())
          .filter((l) => l.trim() !== "" && !srcLines.has(l) && !l.trim().startsWith("--"));
        expect(extra).toEqual([]);
      });
    });
  }
  it("the authorship overload: + p_actor, the journal actor set from it, service_role only; the old signature kept (Astra 3a r4#1)", () => {
    const overload = extractFunction(src, "create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)", "\n$$;");
    expect(overload).toContain("  p_expected_portioned boolean,\n  p_actor uuid\n) returns table (");
    expect(overload).toContain("perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);");
    expect(overload).toContain("recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id)");
    expect(src).toContain("grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;");
    expect(src).toContain("grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) to service_role;");
    expect(src).not.toContain("drop function");
  });
  it("every re-emit adds the shop sweep; the two line writers also name their actor for the journal", () => {
    expect(extractFunction(src, "create or replace function public.add_recipe_input_atomic(", "\n$$;")).toContain("recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, null)");
    expect(extractFunction(src, "create or replace function public.update_recipe_input_atomic(", "\n$$;")).toContain("recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id)");
    expect(extractFunction(src, "create or replace function create_recipe_full(", "end $$;")).toContain("recipe_shops_output_would_cycle(v_recipe_id,");
    expect(extractFunction(src, "create or replace function add_recipe_output(", "end $$;")).toContain("recipe_shops_output_would_cycle(p_recipe_id, p_output_item_id)");
    expect(extractFunction(src, "create or replace function public.add_recipe_input_atomic(", "\n$$;")).toContain("set_config('app.recipe_journal_actor'");
  });
});
```

Run: `npx vitest run tests/recipe-versions-migration.test.ts`
Expected: FAIL with `Failed to resolve import "../scripts/recipe-versions/reemit-mods"`.

- [ ] **Step 2: Create `scripts/recipe-versions/reemit-mods.ts`** (the enumerated mods; reviewers read THIS list)

```ts
/**
 * Catalog Phase 3a — the four 0258 recipe-graph writers 0262 re-emits, as `[old, new]` modifications
 * of their latest definer (0258). Shared by the generator (emit-0262-reemits.ts) and the pin
 * (tests/recipe-versions-migration.test.ts), so the SQL that ships IS the list reviewers read.
 * The helpers are 2a's (scripts/shop-versions/reemit-mods.ts): ONE spelling of extract/apply/subsequence.
 *
 * Every mod is an ADDITION after an unchanged anchor:
 *   add_recipe_input_atomic    + the journal actor (p_created_by); + the shop sweep after the global refusal
 *   update_recipe_input_atomic + the shop sweep after the global refusal (excluding the edited line)
 *   create_recipe_full         + the journal actor (p_created_by); + the output shop sweep before the return
 *   add_recipe_output          + the output shop sweep after the global refusal
 * and ONE NEW OVERLOAD (lead decision, Astra 3a r4#1 — authorship):
 *   update_recipe_input_atomic_actor  the same body as the 16-argument writer + a 17th parameter `p_actor uuid`
 *                              and the journal actor, so a legacy-builder edit's version records WHO. A different
 *                              signature, so it is a NEW function beside the old one: the 16-argument writer stays
 *                              (re-emitted, shop sweep, no actor) through the deploy window — only code deployed
 *                              before 3a calls it — and is DROPPED by the first Phase 4 migration.
 */
import { applyMods, extractFunction, isLineSubsequence, normalize, type Reemit } from "../shop-versions/reemit-mods";

export { applyMods, extractFunction, isLineSubsequence, normalize };

const LOCK = "  perform pg_advisory_xact_lock(7258025800);\n";
const LINE_REFUSAL = "    raise exception 'would_create_cycle' using errcode = 'P0001';\n  end if;\n";
const ACTOR = [
  "  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).",
  "  perform set_config('app.recipe_journal_actor', coalesce(p_created_by::text, ''), true);",
  "",
].join("\n");

export const RECIPE_REEMITS: readonly Reemit[] = [
  {
    name: "add_recipe_input_atomic",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function public.add_recipe_input_atomic(",
    startReplaced: "create or replace function public.add_recipe_input_atomic(",
    end: "\n$$;",
    mods: [
      [LOCK, LOCK + ACTOR],
      [
        LINE_REFUSAL,
        LINE_REFUSAL + [
          "  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.",
          "  if p_component_item_id is not null",
          "     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, null) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "update_recipe_input_atomic",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function public.update_recipe_input_atomic(",
    startReplaced: "create or replace function public.update_recipe_input_atomic(",
    end: "\n$$;",
    mods: [
      [
        LINE_REFUSAL,
        LINE_REFUSAL + [
          "  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.",
          "  if p_component_item_id is not null",
          "     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "update_recipe_input_atomic_actor",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function public.update_recipe_input_atomic(",
    // A distinct first line, so the pin can find THIS definition (the 16-argument one comes first in 0262).
    startReplaced: "create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)",
    end: "\n$$;",
    mods: [
      [
        "create or replace function public.update_recipe_input_atomic(\n",
        "create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)\n",
      ],
      ["  p_expected_portioned boolean\n) returns table (", "  p_expected_portioned boolean,\n  p_actor uuid\n) returns table ("],
      [
        LOCK,
        LOCK + [
          "  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).",
          "  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);",
          "",
        ].join("\n"),
      ],
      [
        LINE_REFUSAL,
        LINE_REFUSAL + [
          "  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.",
          "  if p_component_item_id is not null",
          "     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "create_recipe_full",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function create_recipe_full(",
    startReplaced: "create or replace function create_recipe_full(",
    end: "end $$;",
    mods: [
      [LOCK, LOCK + ACTOR],
      [
        "    raise exception 'would_create_cycle' using errcode = 'P0001';\n  end if;\n\n  return v_recipe_id;",
        [
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
          "  -- 0262: the same refusal in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).",
          "  if exists (",
          "    select 1 from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)",
          "    where nullif(value->>'output_item_id','') is not null",
          "      and public.recipe_shops_output_would_cycle(v_recipe_id, nullif(value->>'output_item_id','')::uuid)",
          "  ) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
          "  return v_recipe_id;",
        ].join("\n"),
      ],
    ],
  },
  {
    name: "add_recipe_output",
    source: "0258_recipe_input_write_atomic.sql",
    start: "create or replace function add_recipe_output(",
    startReplaced: "create or replace function add_recipe_output(",
    end: "end $$;",
    mods: [
      [
        "  if p_output_item_id is not null and public.recipe_output_would_cycle(p_recipe_id, p_output_item_id) then\n    raise exception 'would_create_cycle' using errcode = 'P0001';\n  end if;\n",
        [
          "  if p_output_item_id is not null and public.recipe_output_would_cycle(p_recipe_id, p_output_item_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "  -- 0262: and in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).",
          "  if p_output_item_id is not null and public.recipe_shops_output_would_cycle(p_recipe_id, p_output_item_id) then",
          "    raise exception 'would_create_cycle' using errcode = 'P0001';",
          "  end if;",
          "",
        ].join("\n"),
      ],
    ],
  },
];
```

- [ ] **Step 3: Create `scripts/recipe-versions/emit-0262-reemits.ts`**

```ts
/**
 * Writes the four re-emitted recipe-graph writers into 0262 between their markers, from RECIPE_REEMITS.
 * Run: npx tsx scripts/recipe-versions/emit-0262-reemits.ts   (idempotent)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { RECIPE_REEMITS, applyMods, extractFunction, normalize } from "./reemit-mods";

const TARGET = "supabase/migrations/0262_recipe_shop_versions.sql";
let target = normalize(readFileSync(TARGET, "utf8"));
for (const r of RECIPE_REEMITS) {
  const src = normalize(readFileSync(`supabase/migrations/${r.source}`, "utf8"));
  const body = applyMods(extractFunction(src, r.start, r.end), r.mods);
  const open = `-- >>> REEMIT ${r.name} (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)\n`;
  const close = `-- <<< REEMIT ${r.name}\n`;
  const a = target.indexOf(open);
  const b = target.indexOf(close);
  if (a < 0 || b < a) throw new Error(`markers for ${r.name} not found in ${TARGET}`);
  target = `${target.slice(0, a + open.length)}${body}\n${target.slice(b)}`;
  console.log(`re-emitted ${r.name} from ${r.source} (${r.mods.length} mods)`);
}
writeFileSync(TARGET, target);
```

- [ ] **Step 4: Create `supabase/migrations/0262_recipe_shop_versions.sql`**

```sql
-- Migration 0262_recipe_shop_versions
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod dry-run → prod, BEFORE the 3a code merges; 0259–0261 first).
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase3a-recipe-menu-versions-data.md (Task 3).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 (global defaults + shop versions), §6 (notices).
--
-- WHAT. Shop versions of a RECIPE's LINES beside the global default, EFFECTIVE-DATED, in the house idiom
-- `location_id NULL = global`:
--   recipe_versions           one row per version. location_id NULL = the global default; a shop id = that
--                             shop's own version. based_on / adopted_from / promoted_from say where it came
--                             from. In force over [valid_from, valid_to); one live row per (recipe, scope).
--                             Append-only: a save closes the old version and opens a new one.
--   recipe_version_lines      the full line set of a version — immutable once committed.
--   recipe_notice_dismissals  a GM's "keep mine" / "got it" on a read-time notice (computed in lib, 3b).
--
-- THE GLOBAL DEFAULT'S LIVE LINES STAY IN recipe_inputs. Every existing reader, Phase 1's line RPCs and the
-- 0258 graph lock keep their meaning. The global history is a JOURNAL of recipe_inputs:
-- recipe_global_journal(recipe) opens a new live global version holding a copy of the recipe's lines. It
-- runs from DEFERRED constraint triggers at COMMIT of every transaction that inserts, updates or deletes a
-- recipe line or creates a recipe — so no writer, seed or script can skip it — and explicitly from
-- save_recipe_version. A transaction journals a recipe once: a head it opened itself is brought up to date
-- in place (its lines are not history yet), never versioned twice. An unchanged set opens nothing.
--
-- BACKFILL: every recipe gets ONE global version valid from 2000-01-01 (the "since forever" baseline, the
-- 0259 idiom) holding a copy of its recipe_inputs. The past resolves exactly as today until a line changes,
-- and a recipe created later starts at 2000-01-01 too: EDITS are dated, existence is not.
--
-- THE CUTOVER IS CLOSED (Astra 3a r1#4). Before the backfill copies a single line, this transaction takes the
-- graph lock AND `SHARE ROW EXCLUSIVE` on recipes + recipe_inputs: every legacy writer (INSERT / UPDATE /
-- DELETE take ROW EXCLUSIVE, which conflicts) waits until COMMIT, by which time the journal triggers exist.
-- So no line write can land between the copy and the triggers, and none goes un-journaled. Belt and braces:
-- after the triggers are created, (5b) re-proves, recipe by recipe, that every baseline equals recipe_inputs
-- (READ COMMITTED: that statement sees anything that committed earlier) and aborts the migration if not.
--
-- THE RESOLUTION RULE IS NOT IN SQL. lib/recipe-versions-shared.ts + lib/prep-consumption.ts
-- loadRecipeLineOverlay: a scope's version in force, else the global one in force — and recipe_inputs itself
-- wherever the answer is the live global head.
--
-- THE CYCLE LAW, PER SHOP (0258, extended). A shop's graph is the global lines with its own live versions
-- substituted (recipe_scope_item_edges). Every writer refuses would_create_cycle in EVERY graph it changes,
-- under the 0258 graph lock 7258025800 (lock order: graph lock → recipe row):
--   save_recipe_version, shop     → that shop's graph;
--   save_recipe_version, global   → the global graph AND every active shop riding that recipe's global lines;
--   retire_recipe_version         → that shop's graph with the global lines back;
--   add/update_recipe_input_atomic (re-emitted) → + every active shop riding the global lines;
--   create_recipe_full / add_recipe_output (re-emitted) → + every active shop (outputs are global).
--
-- THE WRITERS (SECURITY DEFINER, search_path pinned, EXECUTE for service_role only):
--   save_recipe_version(p_recipe, p_location, p_lines, p_expected, p_based_on, p_note, p_actor,
--                       p_restored_from, p_adopted_from, p_promoted_from, p_snapshot)
--       one writer for a line set: a shop's version, or the global default (written into recipe_inputs with
--       the least churn, then journaled as this actor's version). Restore / adopt / promote COPY the source
--       version's lines IN SQL — the caller's payload is ignored for them — and EVERY line set, copied or
--       sent, passes the same rules as an add / update (lib/recipes.ts assertInputLineIsValid), including the
--       product rule: an ACTIVE product measured in an ACTIVE measure-registry unit (Astra 3a r1#5).
--       Optimistic: p_expected must be this scope's live version (the shop's, or the global head); a shop
--       forking the default must have seen the CURRENT default (p_based_on).
--       PROMOTE (lead decision 5) writes the new default AND retires the source shop's version in the SAME
--       transaction (its valid_to = the new default's valid_from; history kept): the source shop rides the
--       default from then on, eating exactly what it ate before.
--   retire_recipe_version(p_version, p_location, p_actor, p_snapshot)   a shop's "back to default" (never the
--       global one).
--   recipe_change_snapshot(p_recipe, p_location, p_lines)   THE DEPENDENCY SNAPSHOT (the 0261 pattern), SCOPED to
--       the change's dependency CLOSURE (recipe_change_closure; lead decision (a)): the recipes it reaches and
--       everything they consume, their items, menu items, SKUs, products and product MEMBERS, vendors, measures,
--       and — for the global view and each affected shop — the versions, primaries, activation overlays, receipts,
--       pack versions / levels and prices those resolve through. Never a whole table: an unrelated edit leaves it
--       unchanged. The preview takes it; both writers take the CLOSURE LOCKS (recipe_change_lock, NOWAIT, after the
--       graph lock) and then re-take it, refusing 'recipe_version:dependencies_changed' on any difference and
--       'recipe_version:dependencies_busy' when a dependency is being written right now. Lock order: (7a).
--   remove_recipe_input_atomic(p_input_id, p_actor)          the legacy line delete under the graph lock, so
--       its commit-time journal never inverts the lock order (lib/recipes.ts removeRecipeEdge).
-- Named refusals: P0001 'recipe_version:<code>' (lib/admin/recipe-versions.ts maps them); the re-emits keep
-- 0258's unprefixed codes.
--
-- PRIVILEGE CEILING (the 0257 pattern): recipe_versions SELECT/INSERT/UPDATE; recipe_version_lines and
-- recipe_notice_dismissals SELECT/INSERT; nothing else for service_role; nothing for anon/authenticated; RLS
-- on with the deny-all policy set. Asserted both ways below.
--
-- PRE-FLIGHT (MCP, read-only):
--   select count(*) from public.recipes;                   -- = the global versions the backfill writes
--   select count(*) from public.recipe_inputs;             -- = the baseline lines it writes
--   select to_regclass('public.recipe_versions');          -- NULL
--   select version, name from supabase_migrations.schema_migrations order by version desc limit 5;  -- 0261 applied
-- VERIFY AFTER APPLY:
--   select count(*) from public.recipe_versions where location_id is null and active;           -- = recipes
--   select count(*) from public.recipe_versions where valid_from <> '2000-01-01T00:00:00Z';     -- 0
--   select count(*) from public.recipe_version_lines;                                           -- = recipe_inputs
--   select relname, relrowsecurity from pg_class where oid in ('public.recipe_versions'::regclass,
--     'public.recipe_version_lines'::regclass, 'public.recipe_notice_dismissals'::regclass);   -- t, t, t
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('recipe_versions','recipe_version_lines','recipe_notice_dismissals')
--    order by 1, 2, 3;      -- service_role: versions INSERT/SELECT/UPDATE, lines + dismissals INSERT/SELECT (+ owner)
--   select tgname from pg_trigger where tgrelid in ('public.recipe_inputs'::regclass, 'public.recipes'::regclass)
--      and not tgisinternal and tgname like '%journal%' order by 1;                              -- recipe_inputs_journal, recipes_journal
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and privilege_type = 'EXECUTE'
--      and routine_name in ('save_recipe_version','retire_recipe_version','remove_recipe_input_atomic','recipe_change_snapshot',
--                           'add_recipe_input_atomic','update_recipe_input_atomic','create_recipe_full','add_recipe_output')
--    order by 1, 2;                                                                            -- service_role (+ owner) only
--   select count(*) from public.recipe_versions v where v.location_id is null and v.active
--      and not public.recipe_journal_lines_equal(v.recipe_id, v.id);                            -- 0 (run as the owner)

begin;

-- ── (0) the cutover lock: no legacy line write between the backfill copy and the journal triggers ──
select pg_advisory_xact_lock(7258025800);
lock table public.recipes, public.recipe_inputs in share row exclusive mode;

-- ── (1) recipe_versions ───────────────────────────────────────────────────────
create table if not exists public.recipe_versions (
  id                       uuid        primary key default gen_random_uuid(),
  recipe_id                uuid        not null references public.recipes(id),
  location_id              uuid        null references public.locations(id),
  scope_key                uuid        generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  based_on_version_id      uuid        null references public.recipe_versions(id),
  adopted_from_version_id  uuid        null references public.recipe_versions(id),
  promoted_from_version_id uuid        null references public.recipe_versions(id),
  -- PROVENANCE'S END, RECORDED (Astra r7): set by the writer when this row ends an adoption link — on a restore's new
  -- row, the REPLACED version that carried the pointer; on a Back-to-default retirement, the retired row itself.
  -- History reads THIS, never an inference from based_on_version_id (a restore's based_on is the RESTORED version).
  adoption_ended_from_version_id uuid null references public.recipe_versions(id),
  active                   boolean     not null default true,
  valid_from               timestamptz not null default clock_timestamp(),
  valid_to                 timestamptz null,
  note                     text        null,
  created_at               timestamptz not null default clock_timestamp(),
  created_by               uuid        null references public.users(id),
  retired_by               uuid        null references public.users(id),
  created_xact             xid8        not null default pg_current_xact_id(),
  constraint recipe_versions_live_window check ((valid_to is null) = active),
  constraint recipe_versions_adopt_is_shop check (adopted_from_version_id is null or location_id is not null),
  constraint recipe_versions_promote_is_global check (promoted_from_version_id is null or location_id is null),
  constraint recipe_versions_adoption_end_is_shop check (adoption_ended_from_version_id is null or location_id is not null),
  constraint recipe_versions_identity_uq unique (id, recipe_id, scope_key)
);
comment on table public.recipe_versions is
  'A recipe''s LINE SET as an effective-dated version (0262). location_id NULL = the global default (its live '
  'version is the journal of recipe_inputs); a shop id = that shop''s own version. In force over [valid_from, '
  'valid_to); one live per (recipe, scope_key). Append-only. Resolution: lib/recipe-versions-shared.ts.';
comment on column public.recipe_versions.created_xact is
  'The transaction that opened this version (0262): recipe_global_journal journals a recipe once per transaction.';

create unique index if not exists recipe_versions_one_live on public.recipe_versions (recipe_id, scope_key) where active;
create index if not exists recipe_versions_as_of_ix on public.recipe_versions (recipe_id, scope_key, valid_from);
create index if not exists recipe_versions_shop_live_ix on public.recipe_versions (location_id) where active;
create index if not exists recipe_versions_adopted_ix on public.recipe_versions (adopted_from_version_id) where adopted_from_version_id is not null;

-- ── (2) recipe_version_lines ──────────────────────────────────────────────────
create table if not exists public.recipe_version_lines (
  id                   uuid        primary key default gen_random_uuid(),
  version_id           uuid        not null,
  recipe_id            uuid        not null,
  location_id          uuid        null references public.locations(id),
  scope_key            uuid        generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  component_sku_id     uuid        null references public.vendor_items(id),
  component_item_id    uuid        null references public.items(id),
  component_product_id uuid        null references public.products(id),
  quantity             numeric     not null check (quantity > 0),
  unit                 text        null,
  each_container_label text        null,
  portioned            boolean     not null default false,
  display_order        integer     not null default 0,
  source_line_id       uuid        null,
  created_at           timestamptz not null default clock_timestamp(),
  constraint recipe_version_lines_exactly_one_component check (
    ((component_sku_id     is not null)::int
   + (component_item_id    is not null)::int
   + (component_product_id is not null)::int) = 1
  ),
  constraint recipe_version_lines_version_fk
    foreign key (version_id, recipe_id, scope_key) references public.recipe_versions (id, recipe_id, scope_key)
);
comment on table public.recipe_version_lines is
  'The lines of one recipe version (0262), immutable once committed. source_line_id = the line it was copied or '
  'edited from (a recipe_inputs id or another version''s line) — lineage only, deliberately no FK.';
create index if not exists recipe_version_lines_version_ix on public.recipe_version_lines (version_id, display_order);
create index if not exists recipe_version_lines_item_ix on public.recipe_version_lines (component_item_id) where component_item_id is not null;

-- ── (3) recipe_notice_dismissals ──────────────────────────────────────────────
create table if not exists public.recipe_notice_dismissals (
  id              uuid        primary key default gen_random_uuid(),
  location_id     uuid        not null references public.locations(id),
  recipe_id       uuid        not null references public.recipes(id),
  kind            text        not null check (kind in ('source_changed', 'source_retired', 'new_default')),
  seen_version_id uuid        not null references public.recipe_versions(id),
  created_at      timestamptz not null default now(),
  created_by      uuid        null references public.users(id)
);
comment on table public.recipe_notice_dismissals is
  'A GM''s answer to a read-time notice (0262; the notices are computed in lib, never swept): this shop has '
  'seen THIS version of the source while it was live (source_changed) or once it was retired (source_retired — '
  'the source went back to the default or was promoted), or THIS new default (new_default). A later change — a '
  'new version, or the same version''s retirement — raises it again.';
create unique index if not exists recipe_notice_dismissals_once
  on public.recipe_notice_dismissals (location_id, recipe_id, kind, seen_version_id);

-- ── (4) backfill: every recipe gets ONE global baseline version holding its lines ──
do $$
declare
  v_recipes  int;
  v_inputs   int;
  v_lines    int;
  v_bad      int;
begin
  insert into public.recipe_versions (recipe_id, location_id, active, valid_from, note)
  select r.id, null, true, '2000-01-01T00:00:00Z'::timestamptz, '0262 baseline'
    from public.recipes r
   where not exists (select 1 from public.recipe_versions v where v.recipe_id = r.id and v.location_id is null);

  insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
    component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id, created_at)
  select v.id, ri.recipe_id, null, ri.component_sku_id, ri.component_item_id, ri.component_product_id,
         ri.quantity, ri.unit, ri.each_container_label, ri.portioned, ri.display_order, ri.id, ri.created_at
    from public.recipe_inputs ri
    join public.recipe_versions v on v.recipe_id = ri.recipe_id and v.location_id is null and v.active;
  get diagnostics v_lines = row_count;

  select count(*) into v_recipes from public.recipes;
  select count(*) into v_inputs from public.recipe_inputs;
  select count(*) into v_bad from public.recipes r
   where (select count(*) from public.recipe_versions v where v.recipe_id = r.id and v.location_id is null and v.active) <> 1;
  assert v_bad = 0, format('0262: %s recipes without exactly one live global version', v_bad);
  assert v_lines = v_inputs, format('0262: baseline lines do not match recipe_inputs (%s vs %s)', v_lines, v_inputs);
  raise notice '0262 backfill: % recipes, % baseline lines', v_recipes, v_lines;
end $$;

-- ── (5) the journal ───────────────────────────────────────────────────────────
-- Do recipe_inputs and a version hold the same lines? (multiset equality, NULL-safe via EXCEPT ALL)
create or replace function public.recipe_journal_lines_equal(p_recipe uuid, p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select not exists (
    (select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_inputs where recipe_id = p_recipe
     except all
     select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_version_lines where version_id = p_version)
    union all
    (select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_version_lines where version_id = p_version
     except all
     select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_inputs where recipe_id = p_recipe)
  );
$$;

-- Journal recipe_inputs as the recipe's live GLOBAL version. Returns the head (null if the recipe is gone).
create or replace function public.recipe_global_journal(p_recipe uuid, p_actor uuid, p_promoted_from uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_head  public.recipe_versions%rowtype;
  v_has   boolean;
  v_actor uuid := coalesce(p_actor, nullif(current_setting('app.recipe_journal_actor', true), '')::uuid);
  v_now   timestamptz;
  v_new   uuid;
begin
  -- The 0258 lock order: the graph lock, then the recipe row.
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.recipes where id = p_recipe for update;
  if not found then
    return null;
  end if;
  select * into v_head from public.recipe_versions
   where recipe_id = p_recipe and location_id is null and active for update;
  v_has := found;
  if v_has and v_head.created_xact = pg_current_xact_id() then
    -- THIS transaction opened the head: its lines are not history yet (nothing outside this transaction can
    -- have read them), so they are brought up to date in place — a recipe is journaled once per transaction.
    if not public.recipe_journal_lines_equal(p_recipe, v_head.id) then
      delete from public.recipe_version_lines where version_id = v_head.id;
      insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
        component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id)
      select v_head.id, ri.recipe_id, null, ri.component_sku_id, ri.component_item_id, ri.component_product_id,
             ri.quantity, ri.unit, ri.each_container_label, ri.portioned, ri.display_order, ri.id
        from public.recipe_inputs ri where ri.recipe_id = p_recipe;
    end if;
    return v_head.id;
  end if;
  if v_has and p_promoted_from is null and public.recipe_journal_lines_equal(p_recipe, v_head.id) then
    return v_head.id; -- nothing changed: no empty version
  end if;
  v_now := greatest(clock_timestamp(), coalesce(v_head.valid_from, '-infinity'::timestamptz));
  if v_has then
    update public.recipe_versions set active = false, valid_to = v_now, retired_by = v_actor where id = v_head.id and active;
  end if;
  insert into public.recipe_versions (recipe_id, location_id, based_on_version_id, promoted_from_version_id, active,
                                      valid_from, note, created_at, created_by)
  values (p_recipe, null, v_head.id, p_promoted_from, true,
          case when exists (select 1 from public.recipe_versions where recipe_id = p_recipe and location_id is null)
               then v_now else '2000-01-01T00:00:00Z'::timestamptz end,
          nullif(btrim(coalesce(p_note, '')), ''), v_now, v_actor)
  returning id into v_new;
  insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
    component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id)
  select v_new, ri.recipe_id, null, ri.component_sku_id, ri.component_item_id, ri.component_product_id,
         ri.quantity, ri.unit, ri.each_container_label, ri.portioned, ri.display_order, ri.id
    from public.recipe_inputs ri where ri.recipe_id = p_recipe;
  return v_new;
end;
$$;

create or replace function public.recipe_inputs_journal_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'DELETE' then
    perform public.recipe_global_journal(new.recipe_id, null, null, null);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.recipe_id is distinct from new.recipe_id) then
    perform public.recipe_global_journal(old.recipe_id, null, null, null);
  end if;
  return null;
end;
$$;

create or replace function public.recipes_journal_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recipe_global_journal(new.id, null, null, null);
  return null;
end;
$$;

-- Created AFTER the backfill, so the backfill journals nothing — and still under (0)'s table lock, so no
-- legacy write landed in between. DEFERRED to COMMIT: the journal sees the transaction's final lines,
-- whatever order its statements ran in.
drop trigger if exists recipe_inputs_journal on public.recipe_inputs;
create constraint trigger recipe_inputs_journal
  after insert or update or delete on public.recipe_inputs
  deferrable initially deferred
  for each row execute function public.recipe_inputs_journal_trg();
drop trigger if exists recipes_journal on public.recipes;
create constraint trigger recipes_journal
  after insert on public.recipes
  deferrable initially deferred
  for each row execute function public.recipes_journal_trg();

-- ── (5b) the cutover proof: every baseline still equals recipe_inputs, recipe by recipe ──
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.recipe_versions v
   where v.location_id is null and v.active
     and not public.recipe_journal_lines_equal(v.recipe_id, v.id);
  assert v_bad = 0, format('0262: %s baseline versions differ from recipe_inputs — a line write landed during the cutover', v_bad);
end $$;

-- ── (6) the cycle law, per scope ──────────────────────────────────────────────
-- The item edges scope p_scope's graph resolves: the global lines of every recipe it has no live version of,
-- plus the lines of its live versions. p_scope NULL = the global graph (recipe_inputs alone).
create or replace function public.recipe_scope_item_edges(p_scope uuid)
returns table (edge_recipe_id uuid, edge_item_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select ri.recipe_id, ri.component_item_id
    from public.recipe_inputs ri
   where ri.component_item_id is not null
     and (p_scope is null or not exists (
           select 1 from public.recipe_versions v
            where v.recipe_id = ri.recipe_id and v.location_id = p_scope and v.active))
  union all
  select l.recipe_id, l.component_item_id
    from public.recipe_version_lines l
    join public.recipe_versions v on v.id = l.version_id
   where p_scope is not null and v.location_id = p_scope and v.active and l.component_item_id is not null;
$$;

-- Would recipe p_recipe holding item lines p_line_items close a loop in scope p_scope's graph? Its own old
-- edges are replaced by p_line_items; the walk starts at p_start_items and follows every producer's lines; a
-- cycle iff it reaches an item p_recipe outputs. (lib/recipe-versions-shared.ts recipeLinesWouldCycle.)
create or replace function public.recipe_lines_would_cycle(p_scope uuid, p_recipe uuid, p_line_items uuid[], p_start_items uuid[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive edges(recipe_id, item_id) as (
    select e.edge_recipe_id, e.edge_item_id from public.recipe_scope_item_edges(p_scope) e where e.edge_recipe_id <> p_recipe
    union all
    select p_recipe, x.item_id from unnest(coalesce(p_line_items, '{}'::uuid[])) as x(item_id)
  ),
  targets(item_id) as (
    select ro.output_item_id from public.recipe_outputs ro where ro.recipe_id = p_recipe and ro.output_item_id is not null
  ),
  reach(item_id) as (
    select x.item_id from unnest(coalesce(p_start_items, '{}'::uuid[])) as x(item_id)
    union
    select e.item_id
      from reach r
      join public.recipe_outputs ro on ro.output_item_id = r.item_id
      join edges e on e.recipe_id = ro.recipe_id
  )
  select exists (select 1 from reach join targets using (item_id));
$$;

-- The 0258 single-line check, for every ACTIVE shop that rides p_recipe's GLOBAL lines.
create or replace function public.recipe_shops_input_would_cycle(p_recipe uuid, p_item uuid, p_exclude_input uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.locations l
     where l.active
       and not exists (select 1 from public.recipe_versions v
                        where v.recipe_id = p_recipe and v.location_id = l.id and v.active)
       and public.recipe_lines_would_cycle(
             l.id, p_recipe,
             array(select ri.component_item_id from public.recipe_inputs ri
                    where ri.recipe_id = p_recipe and ri.component_item_id is not null
                      and (p_exclude_input is null or ri.id <> p_exclude_input)) || p_item,
             array[p_item]));
$$;

-- The 0258 output check, in every ACTIVE shop's graph: a new output p_item on p_recipe closes a loop there iff
-- p_item is reachable from p_recipe's lines AS THAT SHOP RESOLVES THEM.
create or replace function public.recipe_shops_output_would_cycle(p_recipe uuid, p_item uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_loc uuid;
begin
  for v_loc in select id from public.locations where active order by id loop
    if exists (
      with recursive edges(recipe_id, item_id) as (
        select e.edge_recipe_id, e.edge_item_id from public.recipe_scope_item_edges(v_loc) e
      ),
      reach(item_id) as (
        select e.item_id from edges e where e.recipe_id = p_recipe
        union
        select e.item_id
          from reach r
          join public.recipe_outputs ro on ro.output_item_id = r.item_id
          join edges e on e.recipe_id = ro.recipe_id
      )
      select 1 from reach where item_id = p_item
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- ── (7a) the dependency closure, its snapshot and its locks (taken by the preview, re-taken by every writer) ──
-- SCOPED, NEVER WHOLE-TABLE (lead decision (a), Astra 3a r2#1/#2): a snapshot covers exactly what the change's
-- numbers are computed from — so an unrelated recipe or SKU edit never stales a preview, and a related one always does.

-- The lines scope p_scope resolves (NULL = the global graph): recipe_inputs for every recipe it has no live
-- version of, plus the lines of its live versions. (recipe_scope_item_edges, for every component kind.)
create or replace function public.recipe_scope_lines(p_scope uuid)
returns table (line_recipe_id uuid, line_sku_id uuid, line_item_id uuid, line_product_id uuid, line_unit text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select ri.recipe_id, ri.component_sku_id, ri.component_item_id, ri.component_product_id, ri.unit
    from public.recipe_inputs ri
   where p_scope is null or not exists (
           select 1 from public.recipe_versions v where v.recipe_id = ri.recipe_id and v.location_id = p_scope and v.active)
  union all
  select l.recipe_id, l.component_sku_id, l.component_item_id, l.component_product_id, l.unit
    from public.recipe_version_lines l
    join public.recipe_versions v on v.id = l.version_id
   where p_scope is not null and v.location_id = p_scope and v.active;
$$;

-- THE DEPENDENCY CLOSURE of a change to p_recipe at p_location (NULL = the global default, which reaches the
-- default and every active shop), with p_lines = the line set being written (the edit's result, or the source a
-- restore / adopt / promote copies). Over the global scope and every affected shop:
--   UP    the recipe and every recipe that (transitively) uses an item it makes — the sandwiches whose cost the
--         preview shows;
--   DOWN  every recipe any of those (transitively) consumes — everything those costs are computed from;
-- then every item, menu item, SKU, product, product MEMBER (any SKU of a pinned product — product resolution
-- picks among them), vendor (eligibility: active, source kind), measure (line units and the SKUs' pack-level
-- units) and shop they touch. Rows: (member_kind, member_id).
create or replace function public.recipe_change_closure(p_recipe uuid, p_location uuid, p_lines jsonb)
returns table (member_kind text, member_id text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive
  -- ONLY THE SCOPES WHOSE RESOLVED RESULT THIS CHANGE CAN MOVE (Astra 3b r3#2) — exactly the preview's reached set:
  --   a shop target         → that shop alone (its graph already carries the default lines it rides);
  --   the global default    → the global view + every active shop RIDING this recipe's default (a shop with
  --                           its own live version is untouched, so its ingredients are never dependencies);
  --   NIL (00000000-…)      → the global view alone (a menu promote shows only the default's cost).
  scopes(scope_id) as (
    select null::uuid where p_location is null or p_location = '00000000-0000-0000-0000-000000000000'::uuid
    union all
    select s.id from public.locations s
     where s.active
       and (case when p_location is null
                 then not exists (select 1 from public.recipe_versions v
                                   where v.recipe_id = p_recipe and v.location_id = s.id and v.active)
                 else s.id = p_location end)
  ),
  lines(recipe_id, sku_id, item_id, product_id, unit) as (
    select l.line_recipe_id, l.line_sku_id, l.line_item_id, l.line_product_id, l.line_unit
      from scopes sc cross join lateral public.recipe_scope_lines(sc.scope_id) l
    union all
    select p_recipe, nullif(x ->> 'component_sku_id', '')::uuid, nullif(x ->> 'component_item_id', '')::uuid,
           nullif(x ->> 'component_product_id', '')::uuid, nullif(btrim(coalesce(x ->> 'unit', '')), '')
      from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) x
  ),
  up(recipe_id) as (
    select p_recipe
    union
    select l.recipe_id
      from up
      join public.recipe_outputs ro on ro.recipe_id = up.recipe_id and ro.output_item_id is not null
      join lines l on l.item_id = ro.output_item_id
  ),
  down(recipe_id) as (
    select u.recipe_id from up u
    union
    select ro.recipe_id
      from down
      join lines l on l.recipe_id = down.recipe_id and l.item_id is not null
      join public.recipe_outputs ro on ro.output_item_id = l.item_id
  ),
  closure_lines as (select l.* from lines l join down d on d.recipe_id = l.recipe_id),
  products as (select distinct cl.product_id from closure_lines cl where cl.product_id is not null),
  skus(id) as (
    select cl.sku_id from closure_lines cl where cl.sku_id is not null
    union
    select vi.id from public.vendor_items vi join products p on vi.product_id = p.product_id
  )
  select 'recipe', d.recipe_id::text from down d
  union select 'item', cl.item_id::text from closure_lines cl where cl.item_id is not null
  union select 'item', ro.output_item_id::text from public.recipe_outputs ro join down d on d.recipe_id = ro.recipe_id where ro.output_item_id is not null
  union select 'menu_item', ro.output_menu_item_id::text from public.recipe_outputs ro join down d on d.recipe_id = ro.recipe_id where ro.output_menu_item_id is not null
  union select 'product', p.product_id::text from products p
  union select 'sku', s.id::text from skus s
  union select 'vendor', vi.vendor_id::text from public.vendor_items vi join skus s on s.id = vi.id where vi.vendor_id is not null
  union select 'measure', cl.unit from closure_lines cl where cl.unit is not null
  union select 'measure', pl.contains_measure_unit from public.sku_pack_levels pl join skus s on s.id = pl.sku_id where pl.contains_measure_unit is not null
  -- FLAT-PACK measurement (Astra 3a r3#2): a chainless SKU's content is units_per_pack × each_size in each_measure
  -- (lib/recipe-math.ts skuContentOz) — those columns are in the SKU row's digest; the registry row they read is here.
  union select 'measure', vi.each_measure from public.vendor_items vi join skus s on s.id = vi.id where vi.each_measure is not null
  union select 'shop', sc.scope_id::text from scopes sc where sc.scope_id is not null;
$$;

-- THE DEPENDENCY SNAPSHOT: the closure itself plus a digest of every row in it (and, per affected shop, every
-- row a resolver reads for it). Product resolution's inputs are all here: the product rows (active, unit_oz), the
-- members (active, vendor, pack), the primaries (global + affected shops), the shops' activation overlay, the
-- members' vendors (active, source kind) and the RECEIPT history at the affected shops (the store-run streak).
create or replace function public.recipe_change_snapshot(p_recipe uuid, p_location uuid, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipes  uuid[];
  v_items    uuid[];
  v_menu     uuid[];
  v_products uuid[];
  v_skus     uuid[];
  v_vendors  uuid[];
  v_measures text[];
  v_shops    uuid[];
begin
  select coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'recipe'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'item'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'menu_item'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'product'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'sku'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'vendor'), '{}'),
         coalesce(array_agg(member_id order by member_id) filter (where member_kind = 'measure'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'shop'), '{}')
    into v_recipes, v_items, v_menu, v_products, v_skus, v_vendors, v_measures, v_shops
    from public.recipe_change_closure(p_recipe, p_location, p_lines);
  return jsonb_build_object(
    'active_shops', coalesce((select jsonb_agg(l.id order by l.id) from public.locations l where l.active), '[]'::jsonb),
    'closure', jsonb_build_object('recipes', to_jsonb(v_recipes), 'items', to_jsonb(v_items), 'menu_items', to_jsonb(v_menu),
                                  'products', to_jsonb(v_products), 'skus', to_jsonb(v_skus), 'vendors', to_jsonb(v_vendors),
                                  'measures', to_jsonb(v_measures), 'shops', to_jsonb(v_shops)),
    'rows', jsonb_build_object(
      'recipes', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.recipes t where t.id = any(v_recipes)),
      'recipe_versions', (select md5(coalesce(string_agg(jsonb_build_array(t.id, t.recipe_id, t.location_id, t.active, t.valid_from, t.valid_to)::text, '|' order by t.id), ''))
                            from public.recipe_versions t
                           where t.recipe_id = any(v_recipes) and (t.location_id is null or t.location_id = any(v_shops))),
      'recipe_inputs', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.recipe_inputs t where t.recipe_id = any(v_recipes)),
      'recipe_outputs', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.recipe_outputs t where t.recipe_id = any(v_recipes)),
      'items', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.items t where t.id = any(v_items)),
      'menu_items', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.menu_items t where t.id = any(v_menu)),
      'vendor_items', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vendor_items t where t.id = any(v_skus)),
      'products', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.products t where t.id = any(v_products)),
      'product_primaries', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.product_primaries t
                             where t.product_id = any(v_products) and (t.location_id is null or t.location_id = any(v_shops))),
      'shop_activation', (select md5(coalesce(string_agg(jsonb_build_array(t.location_id, t.sku_id, t.active_override)::text, '|' order by t.location_id, t.sku_id), ''))
                            from public.location_sku_settings t where t.sku_id = any(v_skus) and t.location_id = any(v_shops)),
      'vendors', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vendors t where t.id = any(v_vendors)),
      'receipts', (select md5(coalesce(string_agg(jsonb_build_array(di.id, di.vendor_item_id, di.delivery_id, di.created_at, d.location_id, v.source_kind)::text, '|' order by di.id), ''))
                     from public.vendor_delivery_items di
                     join public.vendor_deliveries d on d.id = di.delivery_id
                     left join public.vendors v on v.id = d.vendor_id
                    where di.vendor_item_id = any(v_skus) and d.location_id = any(v_shops)),
      'measure_units', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.label), '')) from public.measure_units t where t.label = any(v_measures)),
      'sku_pack_versions', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.sku_pack_versions t
                             where t.sku_id = any(v_skus) and (t.location_id is null or t.location_id = any(v_shops))),
      'sku_pack_levels', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.sku_pack_levels t
                           where t.sku_id = any(v_skus) and (t.location_id is null or t.location_id = any(v_shops))),
      'sku_price_lanes', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.sku_price_lanes t
                           where t.sku_id = any(v_skus) and t.location_id = any(v_shops)),
      'vendor_price_history', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vendor_price_history t
                                where t.vendor_item_id = any(v_skus) and (t.location_id is null or t.location_id = any(v_shops)))));
end;
$$;

-- THE CLOSURE LOCKS (Astra 3a r2#3, 3b r2#1). Taken by every writer AFTER the graph lock and its own target-row lock,
-- BEFORE it re-takes the snapshot, held to COMMIT — so nothing the snapshot covers can change between the check and
-- the commit. Each lock is chosen to block that dependency's writers, insertions included:
--   locations, measure_units      SHARE table lock — no shop or measure is added, changed or (de)activated;
--   recipes, items, recipe_outputs FOR SHARE — blocks header / yield / item updates and legacy output deletes
--                                  (line and output INSERTS already need the graph lock we hold);
--   products                      FOR UPDATE — also blocks every INSERT/UPDATE whose foreign key names the product
--                                  (a new member SKU, a re-pointed SKU, a new primary row take FOR KEY SHARE);
--   product_primaries, location_sku_settings (affected shops)  FOR SHARE — blocks their updates;
--   vendors                       FOR SHARE — blocks deactivation / source-kind changes;
--   vendor_items                  FOR UPDATE — blocks every 0259 pack / price / lane writer (they lock the SKU row
--                                  FOR UPDATE first) AND every row inserted against the SKU: receipts
--                                  (vendor_delivery_items), price history, pack versions/levels, activation overlays;
--   menu_items                    FOR SHARE.
-- EVERY ONE IS NOWAIT: a writer of these never waits on a lock held by a non-graph writer, so it can never close a
-- deadlock cycle (they may wait on it for milliseconds; it never waits on them). A dependency being written right
-- now refuses 'recipe_version:dependencies_busy' (try again) instead of waiting.
-- LOCK ORDER for every Phase 3 writer: graph advisory lock 7258025800 → the target row (recipe / menu item; these
-- two may wait) → locations → measure_units → recipes → items → products → product_primaries → vendors →
-- vendor_items → location_sku_settings → menu_items → recipe_outputs (each by key; all NOWAIT).
create or replace function public.recipe_change_lock(p_recipe uuid, p_location uuid, p_lines jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipes  uuid[];
  v_items    uuid[];
  v_menu     uuid[];
  v_products uuid[];
  v_skus     uuid[];
  v_vendors  uuid[];
  v_shops    uuid[];
begin
  -- The graph lock FIRST (re-entrant: every writer already holds it, so this returns at once; the order above
  -- therefore holds even for a direct caller such as the sim scenario).
  perform pg_advisory_xact_lock(7258025800);
  lock table public.locations, public.measure_units in share mode nowait;
  select coalesce(array_agg(member_id::uuid) filter (where member_kind = 'recipe'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'item'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'menu_item'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'product'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'sku'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'vendor'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'shop'), '{}')
    into v_recipes, v_items, v_menu, v_products, v_skus, v_vendors, v_shops
    from public.recipe_change_closure(p_recipe, p_location, p_lines);
  perform 1 from public.recipes where id = any(v_recipes) order by id for share nowait;
  perform 1 from public.items where id = any(v_items) order by id for share nowait;
  perform 1 from public.products where id = any(v_products) order by id for update nowait;
  perform 1 from public.product_primaries where product_id = any(v_products) and (location_id is null or location_id = any(v_shops))
    order by id for share nowait;
  perform 1 from public.vendors where id = any(v_vendors) order by id for share nowait;
  perform 1 from public.vendor_items where id = any(v_skus) order by id for update nowait;
  perform 1 from public.location_sku_settings where sku_id = any(v_skus) and location_id = any(v_shops)
    order by location_id, sku_id for share nowait;
  perform 1 from public.menu_items where id = any(v_menu) order by id for share nowait;
  perform 1 from public.recipe_outputs where recipe_id = any(v_recipes) order by id for share nowait;
exception
  when lock_not_available then
    raise exception 'recipe_version:dependencies_busy' using errcode = 'P0001';
end;
$$;

-- ── (7) the writers ───────────────────────────────────────────────────────────
create or replace function public.save_recipe_version(
  p_recipe        uuid,
  p_location      uuid,
  p_lines         jsonb,
  p_expected      uuid,
  p_based_on      uuid,
  p_note          text,
  p_actor         uuid,
  p_restored_from uuid,
  p_adopted_from  uuid,
  p_promoted_from uuid,
  p_snapshot      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_changed jsonb;
  v_copy    boolean;
  v_new_adopted uuid;
  v_ended   uuid;
  v_seen    int;
  v_have    int;
  v_active  boolean;
  v_global  uuid;
  v_live    uuid;
  v_source  public.recipe_versions%rowtype;
  v_lines   jsonb;
  v_count   int;
  v_i       int;
  v_line    jsonb;
  v_items   uuid[];
  v_new     uuid := gen_random_uuid();
  v_now     timestamptz;
  v_written int;
begin
  if num_nonnulls(p_restored_from, p_adopted_from, p_promoted_from) > 1
     or (p_adopted_from is not null and p_location is null)
     or (p_promoted_from is not null and p_location is not null) then
    raise exception 'recipe_version:invalid_payload' using errcode = 'P0001';
  end if;

  -- THE GRAPH LOCK, then the recipe row (0258's order: every recipe writer serializes here).
  perform pg_advisory_xact_lock(7258025800);
  select r.active into v_active from public.recipes r where r.id = p_recipe for update;
  if not found then
    raise exception 'recipe_version:recipe_not_found' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'recipe_version:recipe_inactive' using errcode = 'P0001';
  end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'recipe_version:location_not_found' using errcode = 'P0001';
  end if;
  -- THE LINE SET: restore / adopt / promote COPY the source version here; otherwise the payload.
  if coalesce(p_restored_from, p_adopted_from, p_promoted_from) is not null then
    select * into v_source from public.recipe_versions
     where id = coalesce(p_restored_from, p_adopted_from, p_promoted_from) and recipe_id = p_recipe;
    if not found
       or (p_adopted_from is not null and (v_source.location_id is null or v_source.location_id = p_location or not v_source.active))
       or (p_promoted_from is not null and (v_source.location_id is null or not v_source.active)) then
      raise exception 'recipe_version:invalid_source' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'keep_id', null, 'component_sku_id', l.component_sku_id, 'component_item_id', l.component_item_id,
             'component_product_id', l.component_product_id, 'quantity', l.quantity, 'unit', l.unit,
             'each_container_label', l.each_container_label, 'portioned', l.portioned) order by l.display_order, l.id), '[]'::jsonb)
      into v_lines from public.recipe_version_lines l where l.version_id = v_source.id;
  else
    v_lines := p_lines;
  end if;

  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 200 then
    raise exception 'recipe_version:invalid_lines' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(v_lines);
  for v_i in 0 .. v_count - 1 loop
    v_line := v_lines -> v_i;
    if coalesce(jsonb_typeof(v_line), '') <> 'object'
       or coalesce(jsonb_typeof(v_line -> 'quantity'), '') <> 'number'
       or (v_line ->> 'quantity')::numeric <= 0
       or ((nullif(v_line ->> 'component_sku_id', '') is not null)::int
         + (nullif(v_line ->> 'component_item_id', '') is not null)::int
         + (nullif(v_line ->> 'component_product_id', '') is not null)::int) <> 1
       or (nullif(v_line ->> 'component_sku_id', '') is null and nullif(btrim(coalesce(v_line ->> 'each_container_label', '')), '') is not null)
       or (nullif(v_line ->> 'component_item_id', '') is not null and coalesce((v_line ->> 'portioned')::boolean, false))
       or (nullif(v_line ->> 'component_product_id', '') is not null and nullif(btrim(coalesce(v_line ->> 'unit', '')), '') is null) then
      raise exception 'recipe_version:invalid_lines' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_lines) x where nullif(x ->> 'keep_id', '') is not null)
     <> (select count(distinct x ->> 'keep_id') from jsonb_array_elements(v_lines) x where nullif(x ->> 'keep_id', '') is not null) then
    raise exception 'recipe_version:invalid_lines' using errcode = 'P0001';
  end if;

  -- THE CLOSURE LOCKS, then THE DEPENDENCY SNAPSHOT re-taken under them (7a; Astra 3a r2#1–#3): everything the
  -- preview's numbers were computed from is exactly as it was, and nothing in it can change until COMMIT.
  perform public.recipe_change_lock(p_recipe, p_location, v_lines);
  if p_snapshot is null or public.recipe_change_snapshot(p_recipe, p_location, v_lines) is distinct from p_snapshot then
    raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
  end if;

  -- THE PRODUCT RULE (lib/recipes.ts assertProductLineIsValid; lead decision (b)): a save may not ADD or CREATE a
  -- product line that is not an ACTIVE product measured in an ACTIVE measure-registry unit.
  --   · A COPIED set (restore / adopt / promote) carries nothing: every broken line in it is an addition (Astra r3#3).
  --   · An edit may keep a broken line the set this scope resolves now ALREADY holds — counted by IDENTITY AND
  --     MULTIPLICITY (same product, quantity, unit): the k-th identical broken line stays only if the current set
  --     holds at least k of them, so one existing broken line never licenses two.
  -- The refusal names the line: 'recipe_version:product_line_invalid:<position>' (1-based, in the set written).
  v_copy := coalesce(p_restored_from, p_adopted_from, p_promoted_from) is not null;
  for v_i in 0 .. v_count - 1 loop
    v_line := v_lines -> v_i;
    if nullif(v_line ->> 'component_product_id', '') is not null
       and (not exists (select 1 from public.products p
                         where p.id = (v_line ->> 'component_product_id')::uuid and coalesce(p.active, true))
         or not exists (select 1 from public.measure_units m
                         where m.label = btrim(v_line ->> 'unit') and m.active)) then
      if v_copy then
        raise exception 'recipe_version:product_line_invalid:%', v_i + 1 using errcode = 'P0001';
      end if;
      select count(*) into v_seen
        from jsonb_array_elements(v_lines) with ordinality as x(value, ord)
       where x.ord <= v_i + 1
         and nullif(x.value ->> 'component_product_id', '') = v_line ->> 'component_product_id'
         and (x.value ->> 'quantity')::numeric = (v_line ->> 'quantity')::numeric
         and nullif(btrim(coalesce(x.value ->> 'unit', '')), '') is not distinct from nullif(btrim(coalesce(v_line ->> 'unit', '')), '');
      select count(*) into v_have
        from (select ri.component_product_id, ri.quantity, ri.unit
                from public.recipe_inputs ri
               where ri.recipe_id = p_recipe
                 and not exists (select 1 from public.recipe_versions sv
                                  where sv.recipe_id = p_recipe and sv.location_id = p_location and sv.active)
              union all
              select l.component_product_id, l.quantity, l.unit
                from public.recipe_version_lines l
                join public.recipe_versions sv on sv.id = l.version_id
               where sv.recipe_id = p_recipe and sv.location_id = p_location and sv.active) cur
       where cur.component_product_id = (v_line ->> 'component_product_id')::uuid
         and cur.quantity = (v_line ->> 'quantity')::numeric
         and cur.unit is not distinct from nullif(btrim(coalesce(v_line ->> 'unit', '')), '');
      if v_seen > v_have then
        raise exception 'recipe_version:product_line_invalid:%', v_i + 1 using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- OPTIMISTIC: the version the caller saw — this shop's live version, or the global head.
  select id into v_global from public.recipe_versions where recipe_id = p_recipe and location_id is null and active for update;
  if p_location is null then
    v_live := v_global;
  else
    select id into v_live from public.recipe_versions where recipe_id = p_recipe and location_id = p_location and active for update;
  end if;
  if v_live is distinct from p_expected then
    raise exception 'recipe_version:version_changed' using errcode = 'P0001';
  end if;
  -- A shop FORKING the default (restore or edit) must have forked the CURRENT default.
  if p_location is not null and v_live is null and p_adopted_from is null and p_based_on is distinct from v_global then
    raise exception 'recipe_version:version_changed' using errcode = 'P0001';
  end if;

  -- THE CYCLE LAW in every graph this save changes.
  v_items := array(select nullif(x ->> 'component_item_id', '')::uuid from jsonb_array_elements(v_lines) x
                    where nullif(x ->> 'component_item_id', '') is not null);
  if public.recipe_lines_would_cycle(p_location, p_recipe, v_items, v_items) then
    raise exception 'recipe_version:would_create_cycle' using errcode = 'P0001';
  end if;
  if p_location is null and exists (
       select 1 from public.locations l
        where l.active
          and not exists (select 1 from public.recipe_versions v where v.recipe_id = p_recipe and v.location_id = l.id and v.active)
          and public.recipe_lines_would_cycle(l.id, p_recipe, v_items, v_items)) then
    raise exception 'recipe_version:would_create_cycle' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();
  if p_location is not null then
    -- A SHOP: close its live version (if any) and open the new one with the full set.
    -- PROVENANCE FOLLOWS THE CONTENT (lead decisions, Astra 3a r5#1 / r6): an adopt sets it; an EDIT of an adopted
    -- version keeps it (the shop still hears when that source changes — "you've changed your copy since adopting it");
    -- a RESTORE takes the restored version's pointer — kept for a version of the adopted lineage, ENDED for one from
    -- before the adoption or from global history (no pointer), like Back to default.
    v_new_adopted := case when p_adopted_from is not null then p_adopted_from
                          when p_restored_from is not null then (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = p_restored_from)
                          else (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = v_live) end;
    -- ITS END IS RECORDED, in this transaction, from the row being replaced (Astra r7): History reads the column.
    v_ended := case when v_live is not null and v_new_adopted is null
                     and (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = v_live) is not null
                    then v_live end;
    if v_live is not null then
      update public.recipe_versions set active = false, valid_to = greatest(v_now, valid_from), retired_by = p_actor where id = v_live and active;
    end if;
    insert into public.recipe_versions (id, recipe_id, location_id, based_on_version_id, adopted_from_version_id,
                                        adoption_ended_from_version_id, active, valid_from, note, created_at, created_by)
    values (v_new, p_recipe, p_location, coalesce(p_restored_from, p_adopted_from, v_live, p_based_on), v_new_adopted,
            v_ended, true, v_now, nullif(btrim(coalesce(p_note, '')), ''), v_now, p_actor);
    insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
      component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id)
    select v_new, p_recipe, p_location,
           nullif(t.value ->> 'component_sku_id', '')::uuid, nullif(t.value ->> 'component_item_id', '')::uuid,
           nullif(t.value ->> 'component_product_id', '')::uuid, (t.value ->> 'quantity')::numeric,
           nullif(btrim(coalesce(t.value ->> 'unit', '')), ''), nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), ''),
           coalesce((t.value ->> 'portioned')::boolean, false), (t.ord - 1)::int, nullif(t.value ->> 'keep_id', '')::uuid
      from jsonb_array_elements(v_lines) with ordinality as t(value, ord);
    get diagnostics v_written = row_count;
    if v_written <> v_count then
      raise exception 'recipe_version:readback_failed' using errcode = 'P0001';
    end if;
    return jsonb_build_object('version_id', v_new, 'retired_version_id', v_live, 'scope', 'shop',
                              'valid_from', v_now, 'line_count', v_count, 'changed_shops', jsonb_build_array(p_location));
  end if;

  -- THE GLOBAL DEFAULT: the set goes into recipe_inputs with the least churn (kept lines updated in place,
  -- the rest inserted / deleted), then it is journaled as THIS actor's version in this transaction.
  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);
  delete from public.recipe_inputs ri
   where ri.recipe_id = p_recipe
     and not exists (select 1 from jsonb_array_elements(v_lines) x where nullif(x ->> 'keep_id', '')::uuid = ri.id);
  update public.recipe_inputs ri
     set component_sku_id     = nullif(t.value ->> 'component_sku_id', '')::uuid,
         component_item_id    = nullif(t.value ->> 'component_item_id', '')::uuid,
         component_product_id = nullif(t.value ->> 'component_product_id', '')::uuid,
         quantity             = (t.value ->> 'quantity')::numeric,
         unit                 = nullif(btrim(coalesce(t.value ->> 'unit', '')), ''),
         each_container_label = nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), ''),
         portioned            = coalesce((t.value ->> 'portioned')::boolean, false),
         display_order        = (t.ord - 1)::int
    from jsonb_array_elements(v_lines) with ordinality as t(value, ord)
   where ri.recipe_id = p_recipe
     and ri.id = nullif(t.value ->> 'keep_id', '')::uuid
     and (ri.component_sku_id is distinct from nullif(t.value ->> 'component_sku_id', '')::uuid
       or ri.component_item_id is distinct from nullif(t.value ->> 'component_item_id', '')::uuid
       or ri.component_product_id is distinct from nullif(t.value ->> 'component_product_id', '')::uuid
       or ri.quantity is distinct from (t.value ->> 'quantity')::numeric
       or ri.unit is distinct from nullif(btrim(coalesce(t.value ->> 'unit', '')), '')
       or ri.each_container_label is distinct from nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), '')
       or ri.portioned is distinct from coalesce((t.value ->> 'portioned')::boolean, false)
       or ri.display_order is distinct from (t.ord - 1)::int);
  insert into public.recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit,
                                    each_container_label, portioned, display_order, created_by)
  select p_recipe,
         nullif(t.value ->> 'component_sku_id', '')::uuid, nullif(t.value ->> 'component_item_id', '')::uuid,
         nullif(t.value ->> 'component_product_id', '')::uuid, (t.value ->> 'quantity')::numeric,
         nullif(btrim(coalesce(t.value ->> 'unit', '')), ''), nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), ''),
         coalesce((t.value ->> 'portioned')::boolean, false), (t.ord - 1)::int, p_actor
    from jsonb_array_elements(v_lines) with ordinality as t(value, ord)
   where not exists (select 1 from public.recipe_inputs ri
                      where ri.recipe_id = p_recipe and ri.id = nullif(t.value ->> 'keep_id', '')::uuid);
  v_new := public.recipe_global_journal(p_recipe, p_actor, p_promoted_from,
             coalesce(nullif(btrim(coalesce(p_note, '')), ''), case when p_restored_from is not null then 'restored' end));
  -- The shops whose food changes: every active shop riding the default NOW — taken before a promote returns
  -- its source shop to the default (that shop's food does not change: the new default IS its lines).
  v_changed := coalesce((select jsonb_agg(l.id order by l.id) from public.locations l
                          where l.active and not exists (select 1 from public.recipe_versions v
                                                          where v.recipe_id = p_recipe and v.location_id = l.id and v.active)),
                        '[]'::jsonb);
  -- PROMOTE RETURNS THE SOURCE SHOP TO THE DEFAULT (lead decision 5), in this same transaction: its version is
  -- retired (kept in history), closing at the instant the new default opens, so no instant has two answers
  -- and none has none. Its lines equal the new default's, so its graph — and the cycle law there — is unchanged.
  if p_promoted_from is not null then
    update public.recipe_versions
       set active = false,
           valid_to = greatest((select valid_from from public.recipe_versions where id = v_new), valid_from),
           retired_by = p_actor
     where id = p_promoted_from and active;
    get diagnostics v_written = row_count;
    if v_written <> 1 then
      raise exception 'recipe_version:invalid_source' using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object(
    'version_id', v_new, 'retired_version_id', v_global, 'scope', 'global',
    'valid_from', (select valid_from from public.recipe_versions where id = v_new), 'line_count', v_count,
    'changed_shops', v_changed,
    'returned_shop', case when p_promoted_from is not null then v_source.location_id end,
    'returned_version_id', p_promoted_from);
end;
$$;

create or replace function public.retire_recipe_version(p_version uuid, p_location uuid, p_actor uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe  uuid;
  v_row     public.recipe_versions%rowtype;
  v_items   uuid[];
  v_now     timestamptz;
  v_default jsonb;
begin
  select recipe_id into v_recipe from public.recipe_versions where id = p_version;
  if not found then
    raise exception 'recipe_version:not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.recipes where id = v_recipe for update;
  -- The closure locks, then the snapshot under them (7a). Back to default puts the DEFAULT's lines into this shop's
  -- graph: they are the line set of this change (the preview passes the same lines), so their dependencies are in it.
  v_default := coalesce((select jsonb_agg(jsonb_build_object('component_sku_id', ri.component_sku_id, 'component_item_id', ri.component_item_id,
                                                             'component_product_id', ri.component_product_id, 'unit', ri.unit) order by ri.id)
                           from public.recipe_inputs ri where ri.recipe_id = v_recipe), '[]'::jsonb);
  perform public.recipe_change_lock(v_recipe, p_location, v_default);
  if p_snapshot is null or public.recipe_change_snapshot(v_recipe, p_location, v_default) is distinct from p_snapshot then
    raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
  end if;
  select * into v_row from public.recipe_versions where id = p_version for update;
  if v_row.location_id is null then
    raise exception 'recipe_version:global_cannot_retire' using errcode = 'P0001';
  end if;
  if v_row.location_id is distinct from p_location then
    raise exception 'recipe_version:not_found' using errcode = 'P0001';
  end if;
  if not v_row.active then
    raise exception 'recipe_version:not_live' using errcode = 'P0001';
  end if;
  -- Back to default puts the GLOBAL lines into this shop's graph: refuse if that closes a loop there.
  v_items := array(select ri.component_item_id from public.recipe_inputs ri
                    where ri.recipe_id = v_recipe and ri.component_item_id is not null);
  if public.recipe_lines_would_cycle(p_location, v_recipe, v_items, v_items) then
    raise exception 'recipe_version:would_create_cycle' using errcode = 'P0001';
  end if;
  v_now := greatest(clock_timestamp(), v_row.valid_from);
  -- Back to default ends an adoption link, recorded on the retired row itself (Astra r7) — ONLY when THIS operation
  -- ends one, and never over an earlier record: a row that already says "link ended" (a restore from before the
  -- adoption) keeps it (Astra r8). History is append-only; nothing here nulls a history column. Only a LIVE row closes.
  update public.recipe_versions
     set active = false, valid_to = v_now, retired_by = p_actor,
         adoption_ended_from_version_id = coalesce(adoption_ended_from_version_id,
                                                   case when v_row.adopted_from_version_id is not null then p_version end)
   where id = p_version and active;
  return jsonb_build_object('version_id', p_version, 'recipe_id', v_recipe, 'location_id', p_location, 'valid_to', v_now);
end;
$$;

create or replace function public.remove_recipe_input_atomic(p_input_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before jsonb;
begin
  -- The recipe-graph write lock FIRST (lib/recipe-graph-shared.ts RECIPE_GRAPH_LOCK_KEY): this delete's
  -- commit-time journal takes it too, so the order never inverts against another graph writer.
  perform pg_advisory_xact_lock(7258025800);
  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);
  delete from public.recipe_inputs ri where ri.id = p_input_id returning to_jsonb(ri) into v_before;
  if v_before is null then
    raise exception 'edge_not_found' using errcode = 'P0001';
  end if;
  return v_before;
end;
$$;

-- ── (8) the four 0258 graph writers, re-emitted (generated; see the header) ───
-- >>> REEMIT add_recipe_input_atomic (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
-- <<< REEMIT add_recipe_input_atomic
-- >>> REEMIT update_recipe_input_atomic (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
-- <<< REEMIT update_recipe_input_atomic
-- >>> REEMIT update_recipe_input_atomic_actor (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
-- <<< REEMIT update_recipe_input_atomic_actor
-- >>> REEMIT create_recipe_full (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
-- <<< REEMIT create_recipe_full
-- >>> REEMIT add_recipe_output (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
-- <<< REEMIT add_recipe_output

-- ── (9) posture: deny-all tables with a service_role ceiling; service-role writers ──
alter table public.recipe_versions enable row level security;
create policy recipe_versions_no_user_select on public.recipe_versions for select using (false);
create policy recipe_versions_no_user_insert on public.recipe_versions for insert with check (false);
create policy recipe_versions_no_user_update on public.recipe_versions for update using (false);
create policy recipe_versions_no_user_delete on public.recipe_versions for delete using (false);
revoke all on public.recipe_versions from public, anon, authenticated, service_role;
grant select, insert, update on public.recipe_versions to service_role;

alter table public.recipe_version_lines enable row level security;
create policy recipe_version_lines_no_user_select on public.recipe_version_lines for select using (false);
create policy recipe_version_lines_no_user_insert on public.recipe_version_lines for insert with check (false);
create policy recipe_version_lines_no_user_update on public.recipe_version_lines for update using (false);
create policy recipe_version_lines_no_user_delete on public.recipe_version_lines for delete using (false);
revoke all on public.recipe_version_lines from public, anon, authenticated, service_role;
grant select, insert on public.recipe_version_lines to service_role;

alter table public.recipe_notice_dismissals enable row level security;
create policy recipe_notice_dismissals_no_user_select on public.recipe_notice_dismissals for select using (false);
create policy recipe_notice_dismissals_no_user_insert on public.recipe_notice_dismissals for insert with check (false);
create policy recipe_notice_dismissals_no_user_update on public.recipe_notice_dismissals for update using (false);
create policy recipe_notice_dismissals_no_user_delete on public.recipe_notice_dismissals for delete using (false);
revoke all on public.recipe_notice_dismissals from public, anon, authenticated, service_role;
grant select, insert on public.recipe_notice_dismissals to service_role;

-- The helpers run only inside the definer writers and the triggers: nobody calls them directly.
revoke all on function public.recipe_journal_lines_equal(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_global_journal(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.recipe_inputs_journal_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipes_journal_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipe_scope_item_edges(uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_lines_would_cycle(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.recipe_shops_input_would_cycle(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_shops_output_would_cycle(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_scope_lines(uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_change_closure(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recipe_change_lock(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.save_recipe_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.retire_recipe_version(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.remove_recipe_input_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recipe_change_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.retire_recipe_version(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.remove_recipe_input_atomic(uuid, uuid) to service_role;
grant execute on function public.recipe_change_snapshot(uuid, uuid, jsonb) to service_role;
-- The four re-emits keep 0258's grants exactly (CREATE OR REPLACE keeps them; restated as 0258 did).
revoke all on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;
revoke all on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) to service_role;
-- The authorship overload (+ p_actor): the SAME ceiling — service_role only. The 16-argument writer above is dropped by
-- the first Phase 4 migration (only code deployed before 3a calls it).
revoke all on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) to service_role;

do $$
declare
  t text;
  v_need text[];
  p text;
begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_recipe_version', 'retire_recipe_version', 'remove_recipe_input_atomic',
                                     'add_recipe_input_atomic', 'update_recipe_input_atomic', 'create_recipe_full', 'add_recipe_output',
                                     'recipe_journal_lines_equal', 'recipe_global_journal', 'recipe_inputs_journal_trg', 'recipes_journal_trg',
                                     'recipe_scope_item_edges', 'recipe_lines_would_cycle', 'recipe_shops_input_would_cycle',
                                     'recipe_shops_output_would_cycle', 'recipe_change_snapshot', 'recipe_scope_lines',
                                     'recipe_change_closure', 'recipe_change_lock')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0262: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('recipe_journal_lines_equal', 'recipe_global_journal', 'recipe_inputs_journal_trg', 'recipes_journal_trg',
                                     'recipe_scope_item_edges', 'recipe_lines_would_cycle', 'recipe_shops_input_would_cycle',
                                     'recipe_shops_output_would_cycle', 'recipe_scope_lines', 'recipe_change_closure',
                                     'recipe_change_lock')
                and grantee = 'service_role' and privilege_type = 'EXECUTE') then
    raise exception '0262: unexpected execute grant';
  end if;
  foreach t in array array['recipe_versions', 'recipe_version_lines', 'recipe_notice_dismissals'] loop
    if exists (select 1 from information_schema.role_table_grants
                where table_schema = 'public' and table_name = t and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0262: unexpected table grant on %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'DELETE')
       or has_table_privilege('service_role', 'public.' || t, 'TRUNCATE')
       or has_table_privilege('service_role', 'public.' || t, 'REFERENCES')
       or has_table_privilege('service_role', 'public.' || t, 'TRIGGER')
       or (t <> 'recipe_versions' and has_table_privilege('service_role', 'public.' || t, 'UPDATE')) then
      raise exception '0262: service_role above its ceiling';
    end if;
    v_need := case when t = 'recipe_versions' then array['SELECT', 'INSERT', 'UPDATE'] else array['SELECT', 'INSERT'] end;
    foreach p in array v_need loop
      if not has_table_privilege('service_role', 'public.' || t, p) then
        raise exception '0262: service_role is missing a privilege the writers need';
      end if;
    end loop;
  end loop;
end $$;

-- The same ceiling, spelled per table (the audit trail a reviewer reads, and the literal the pin checks).
do $$ begin
  if has_table_privilege('service_role', 'public.recipe_versions', 'DELETE')
     or has_table_privilege('service_role', 'public.recipe_version_lines', 'DELETE')
     or has_table_privilege('service_role', 'public.recipe_version_lines', 'UPDATE')
     or has_table_privilege('service_role', 'public.recipe_notice_dismissals', 'DELETE')
     or has_table_privilege('service_role', 'public.recipe_notice_dismissals', 'UPDATE') then
    raise exception '0262: service_role above its ceiling';
  end if;
end $$;

commit;
```

- [ ] **Step 5: Generate the re-emits**

Run: `npx tsx scripts/recipe-versions/emit-0262-reemits.ts`
Expected:

```
re-emitted add_recipe_input_atomic from 0258_recipe_input_write_atomic.sql (2 mods)
re-emitted update_recipe_input_atomic from 0258_recipe_input_write_atomic.sql (1 mods)
re-emitted update_recipe_input_atomic_actor from 0258_recipe_input_write_atomic.sql (4 mods)
re-emitted create_recipe_full from 0258_recipe_input_write_atomic.sql (2 mods)
re-emitted add_recipe_output from 0258_recipe_input_write_atomic.sql (1 mods)
```

If an anchor does not occur exactly once, the script throws and names it. Fix the anchor against the real source text (`sed -n 90,200p supabase/migrations/0258_recipe_input_write_atomic.sql`), never the generated block.

- [ ] **Step 6: Create the real-SQL scenario `scripts/recipe-versions/sim-scenario.sql`** (run on the sim in Task 12; it always ends by raising, so nothing persists)

```sql
-- Catalog Phase 3a — 0262 real-SQL scenario. Run on the SIM ONLY (Task 12 Step 3) via execute_sql.
-- It ends with `raise exception 'recipe versions scenario: OK …'` so the whole transaction rolls back;
-- any other exception text is a failure.
do $$
declare
  v_actor   uuid;
  v_shop    uuid;
  v_other   uuid;
  v_recipe  uuid;
  v_sku     uuid;
  v_head0   uuid;
  v_res     jsonb;
  v_lines   jsonb;
  v_shop_v  uuid;
  v_head1   uuid;
  v_head2   uuid;
  v_product uuid;
  v_n       int;
  v_snap    jsonb;
  v_unrelated uuid;
  v_measure text;
  v_ri      public.recipe_inputs%rowtype;
begin
  select id into v_actor from public.users where active and role in ('owner', 'moo', 'cgs') order by id limit 1;
  select id into v_shop from public.locations where active order by id limit 1;
  select id into v_other from public.locations where active and id <> v_shop order by id limit 1;
  select r.id into v_recipe from public.recipes r
   where r.active and exists (select 1 from public.recipe_inputs ri where ri.recipe_id = r.id and ri.component_sku_id is not null)
   order by r.id limit 1;
  select component_sku_id into v_sku from public.recipe_inputs where recipe_id = v_recipe and component_sku_id is not null order by id limit 1;
  assert v_actor is not null and v_shop is not null and v_recipe is not null, 'scenario: sim has no actor / shop / recipe';
  select id into v_head0 from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  assert v_head0 is not null, 'scenario: no global baseline';

  -- (a) a shop version: the lines of the default with the first SKU line doubled.
  select jsonb_agg(jsonb_build_object('keep_id', ri.id, 'component_sku_id', ri.component_sku_id, 'component_item_id', ri.component_item_id,
           'component_product_id', ri.component_product_id,
           'quantity', case when ri.component_sku_id = v_sku then ri.quantity * 2 else ri.quantity end,
           'unit', ri.unit, 'each_container_label', ri.each_container_label, 'portioned', ri.portioned) order by ri.display_order, ri.id)
    into v_lines from public.recipe_inputs ri where ri.recipe_id = v_recipe;
  -- (a0) a save bound to a STALE dependency snapshot is refused before it writes anything.
  begin
    perform public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head0, 'scenario', v_actor, null, null, null,
                                       jsonb_set(public.recipe_change_snapshot(v_recipe, v_shop, v_lines), '{active_shops}', '[]'::jsonb));
    raise exception 'scenario: a stale snapshot was accepted';
  exception when others then
    if sqlerrm not like '%recipe_version:dependencies_changed%' then raise; end if;
  end;
  v_res := public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head0, 'scenario', v_actor, null, null, null,
                                      public.recipe_change_snapshot(v_recipe, v_shop, v_lines));
  v_shop_v := (v_res ->> 'version_id')::uuid;
  select count(*) into v_n from public.recipe_version_lines where version_id = v_shop_v;
  assert v_n = (select count(*) from public.recipe_inputs where recipe_id = v_recipe), 'scenario: shop version line count';
  assert (select based_on_version_id from public.recipe_versions where id = v_shop_v) = v_head0, 'scenario: shop based_on';

  -- (b) the same save again with a stale expectation (the shop now HAS a version) is refused.
  begin
    perform public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head0, null, v_actor, null, null, null,
                                       public.recipe_change_snapshot(v_recipe, v_shop, v_lines));
    raise exception 'scenario: stale save was accepted';
  exception when others then
    if sqlerrm not like '%recipe_version:version_changed%' then raise; end if;
  end;

  -- (c0) AUTHORSHIP (Astra 3a r4#1): the legacy builder's edit through the actor overload opens a version that
  -- records WHO, and retires its predecessor in the same name. (Runs first: later edits in this one transaction
  -- update that same head in place, by design.)
  set constraints all immediate;
  select * into v_ri from public.recipe_inputs where recipe_id = v_recipe and component_sku_id = v_sku order by id limit 1;
  perform public.update_recipe_input_atomic(v_ri.id, v_recipe, v_ri.component_sku_id, v_ri.component_item_id, v_ri.component_product_id,
    v_ri.quantity + 1, v_ri.unit, v_ri.each_container_label, v_ri.portioned,
    v_ri.component_sku_id, v_ri.component_item_id, v_ri.component_product_id, v_ri.quantity, v_ri.unit, v_ri.each_container_label, v_ri.portioned,
    v_actor);
  assert (select created_by from public.recipe_versions where recipe_id = v_recipe and location_id is null and active) = v_actor,
         'scenario: the legacy edit''s version records no author';
  assert (select retired_by from public.recipe_versions where id = v_head0) = v_actor, 'scenario: the retired head records no author';

  -- (c) a legacy GLOBAL line edit is journaled at statement end (constraints immediate stands in for COMMIT).
  set constraints all immediate;
  update public.recipe_inputs set quantity = quantity + 1 where recipe_id = v_recipe and component_sku_id = v_sku;
  select id into v_head1 from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  assert v_head1 <> v_head0, 'scenario: the global edit opened no new head';
  assert (select valid_to from public.recipe_versions where id = v_head0) is not null, 'scenario: old head not closed';
  assert public.recipe_journal_lines_equal(v_recipe, v_head1), 'scenario: head lines differ from recipe_inputs';
  -- the shop version is untouched by the global edit
  assert (select active from public.recipe_versions where id = v_shop_v), 'scenario: shop version moved';

  -- (d) PROMOTE the shop's version: one transaction writes the new default AND returns the shop to it.
  v_res := public.save_recipe_version(v_recipe, null, '[]'::jsonb, v_head1, null, 'scenario promote', v_actor, null, null, v_shop_v,
                                      public.recipe_change_snapshot(v_recipe, null, v_lines));
  v_head2 := (v_res ->> 'version_id')::uuid;
  assert (v_res ->> 'returned_shop')::uuid = v_shop, 'scenario: promote did not name its source shop';
  assert not (select active from public.recipe_versions where id = v_shop_v), 'scenario: promote left the source shop on its own version';
  assert (select valid_to from public.recipe_versions where id = v_shop_v)
       = (select valid_from from public.recipe_versions where id = v_head2), 'scenario: source closed at a different instant than the default opened';
  assert (select promoted_from_version_id from public.recipe_versions where id = v_head2) = v_shop_v, 'scenario: promote lineage';
  assert public.recipe_journal_lines_equal(v_recipe, v_head2), 'scenario: promoted head differs from recipe_inputs';
  assert not exists (select 1 from public.recipe_versions where recipe_id = v_recipe and location_id = v_shop and active),
         'scenario: the source shop still has a live version';
  assert not (v_res -> 'changed_shops') @> to_jsonb(v_shop::text), 'scenario: the source shop was reported as changed';

  -- (e) back to default: a fresh shop version, then retired.
  v_res := public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head2, 'scenario', v_actor, null, null, null,
                                      public.recipe_change_snapshot(v_recipe, v_shop, v_lines));
  v_shop_v := (v_res ->> 'version_id')::uuid;
  begin
    perform public.retire_recipe_version(v_shop_v, v_shop, v_actor, jsonb_set(public.recipe_change_snapshot(v_recipe, v_shop, null), '{active_shops}', '[]'::jsonb));
    raise exception 'scenario: a stale-snapshot retire was accepted';
  exception when others then
    if sqlerrm not like '%recipe_version:dependencies_changed%' then raise; end if;
  end;
  perform public.retire_recipe_version(v_shop_v, v_shop, v_actor, public.recipe_change_snapshot(v_recipe, v_shop, null));
  assert not (select active from public.recipe_versions where id = v_shop_v), 'scenario: back to default did not retire';
  if v_other is not null then
    begin
      perform public.retire_recipe_version(v_shop_v, v_other, v_actor, public.recipe_change_snapshot(v_recipe, v_other, null));
      raise exception 'scenario: retire under the wrong shop was accepted';
    exception when others then
      if sqlerrm not like '%recipe_version:%' then raise; end if;
    end;
  end if;

  -- (f) the product rule holds for every line set: a product line in a vendor pack word is refused.
  select id into v_product from public.products where active order by id limit 1;
  if v_product is not null then
    begin
      perform public.save_recipe_version(v_recipe, v_shop, jsonb_build_array(jsonb_build_object(
                'component_product_id', v_product, 'quantity', 1, 'unit', 'case', 'portioned', false)),
              null, (select id from public.recipe_versions where recipe_id = v_recipe and location_id is null and active),
              null, v_actor, null, null, null,
              public.recipe_change_snapshot(v_recipe, v_shop, jsonb_build_array(jsonb_build_object('component_product_id', v_product))));
      raise exception 'scenario: a product line in a pack word was accepted';
    exception when others then
      if sqlerrm not like '%recipe_version:product_line_invalid:1%' then raise; end if; -- names the line
    end;
  end if;

  -- (g) SCOPED (lead decision (a)): an unrelated SKU's change leaves the snapshot alone; a closure SKU's change moves it.
  v_snap := public.recipe_change_snapshot(v_recipe, v_shop, v_lines);
  select vi.id into v_unrelated from public.vendor_items vi
   where vi.active
     and vi.id::text not in (select c.member_id from public.recipe_change_closure(v_recipe, v_shop, v_lines) c where c.member_kind = 'sku')
   order by vi.id limit 1;
  if v_unrelated is not null then
    update public.vendor_items set updated_at = now() + interval '1 second' where id = v_unrelated;
    assert public.recipe_change_snapshot(v_recipe, v_shop, v_lines) = v_snap, 'scenario: an unrelated SKU staled the snapshot';
  end if;
  update public.vendor_items set updated_at = now() + interval '2 seconds' where id = v_sku;
  assert public.recipe_change_snapshot(v_recipe, v_shop, v_lines) is distinct from v_snap, 'scenario: a closure SKU change did not move the snapshot';

  -- (h) FLAT-PACK MEASUREMENT is a dependency (Astra r3): a closure SKU's each_measure registry row moves the snapshot.
  select m.label into v_measure
    from public.vendor_items vi join public.measure_units m on m.label = vi.each_measure
   where vi.id::text in (select c.member_id from public.recipe_change_closure(v_recipe, v_shop, v_lines) c where c.member_kind = 'sku')
   order by m.label limit 1;
  if v_measure is not null then
    v_snap := public.recipe_change_snapshot(v_recipe, v_shop, v_lines);
    update public.measure_units set to_base_factor = to_base_factor * 2 where label = v_measure;
    assert public.recipe_change_snapshot(v_recipe, v_shop, v_lines) is distinct from v_snap, 'scenario: a flat-pack measure change did not move the snapshot';
  end if;

  -- (i) AN UNTOUCHED SHOP NEVER STALES A GLOBAL PREVIEW (Astra 3b r3#2): OTHER takes its own version naming a SKU
  -- nothing else here uses; a change to that SKU leaves the GLOBAL change's snapshot alone (OTHER is untouched by it).
  select vi.id into v_unrelated from public.vendor_items vi
   where vi.active
     and vi.id::text not in (select c.member_id from public.recipe_change_closure(v_recipe, null, v_lines) c where c.member_kind = 'sku')
   order by vi.id limit 1;
  if v_other is not null and v_unrelated is not null then
    perform public.save_recipe_version(v_recipe, v_other,
              jsonb_build_array(jsonb_build_object('component_sku_id', v_unrelated, 'quantity', 1, 'unit', 'oz', 'portioned', false)),
              null, (select id from public.recipe_versions where recipe_id = v_recipe and location_id is null and active),
              'scenario other', v_actor, null, null, null,
              public.recipe_change_snapshot(v_recipe, v_other, jsonb_build_array(jsonb_build_object('component_sku_id', v_unrelated))));
    v_snap := public.recipe_change_snapshot(v_recipe, null, v_lines);
    update public.vendor_items set updated_at = now() + interval '3 seconds' where id = v_unrelated;
    assert public.recipe_change_snapshot(v_recipe, null, v_lines) = v_snap, 'scenario: an untouched shop''s ingredient staled a global preview';
  end if;

  raise exception 'recipe versions scenario: OK (rolled back)';
end $$;
```

- [ ] **Step 6b: The real writer in PGlite — provenance and its RECORDED end (Astra r7)**

History must read what the WRITER stored, never infer it (`based_on_version_id` of a restore is the RESTORED version, not
the replaced one). This runs 0258 + 0262 exactly as committed in PGlite (in-memory Postgres, the 2a pattern of
`tests/fixtures/snapshot-migrate.ts`) and drives `save_recipe_version` / `retire_recipe_version` through the four
sequences. 3b feeds the same rows to its History view-model.

Create `tests/fixtures/recipe-versions-pglite.ts`:

```ts
/**
 * Catalog Phase 3a — 0258 + 0262 AS COMMITTED, in PGlite (no network, no real database), over the minimum stub base
 * tables they read, and helpers that call the REAL writers. Nothing here fabricates a version row: every row a test
 * reads was written by save_recipe_version / retire_recipe_version / the journal.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.users(id uuid primary key);
  create table public.locations(id uuid primary key, name text, active boolean not null default true);
  create table public.vendors(id uuid primary key, name text, source_kind text, active boolean not null default true);
  create table public.products(id uuid primary key, name text, active boolean not null default true, unit_oz numeric);
  create table public.vendor_items(id uuid primary key, name text, active boolean not null default true,
    vendor_id uuid references public.vendors(id), product_id uuid references public.products(id), pack_format text,
    each_container_label text, units_per_pack numeric, each_size numeric, each_measure text, avg_oz_per_each numeric,
    updated_at timestamptz not null default now());
  create table public.measure_units(label text primary key, dimension text, to_base_factor numeric, active boolean not null default true);
  create table public.items(id uuid primary key, name text, active boolean not null default true);
  create table public.menu_items(id uuid primary key, name text, active boolean not null default true);
  create table public.recipes(id uuid primary key default gen_random_uuid(), name text, active boolean not null default true,
    batch_yield numeric, created_at timestamptz not null default now());
  create table public.recipe_inputs(id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id),
    component_sku_id uuid references public.vendor_items(id), component_item_id uuid references public.items(id),
    component_product_id uuid references public.products(id), quantity numeric not null, unit text, each_container_label text,
    portioned boolean not null default false, display_order integer not null default 0,
    created_at timestamptz not null default now(), created_by uuid references public.users(id));
  create table public.recipe_outputs(id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id),
    output_item_id uuid references public.items(id), output_menu_item_id uuid references public.menu_items(id), yield numeric not null default 1);
  create table public.product_primaries(id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id),
    location_id uuid, primary_sku_id uuid);
  create table public.location_sku_settings(id uuid primary key default gen_random_uuid(), location_id uuid,
    sku_id uuid references public.vendor_items(id), active_override boolean);
  create table public.vendor_deliveries(id uuid primary key default gen_random_uuid(), location_id uuid, vendor_id uuid);
  create table public.vendor_delivery_items(id uuid primary key default gen_random_uuid(), delivery_id uuid references public.vendor_deliveries(id),
    vendor_item_id uuid references public.vendor_items(id), created_at timestamptz not null default now());
  create table public.sku_pack_versions(id uuid primary key default gen_random_uuid(), sku_id uuid, location_id uuid,
    valid_from timestamptz, valid_to timestamptz, active boolean);
  create table public.sku_pack_levels(id uuid primary key default gen_random_uuid(), sku_id uuid, location_id uuid, label text, contains_measure_unit text);
  create table public.sku_price_lanes(id uuid primary key default gen_random_uuid(), sku_id uuid, location_id uuid);
  create table public.vendor_price_history(id uuid primary key default gen_random_uuid(), vendor_item_id uuid, location_id uuid, unit_price numeric);
`;

export const ID = {
  actor: "00000000-0000-4000-8000-0000000000a1",
  source: "00000000-0000-4000-8000-0000000000b0", // the shop others adopt from
  adopters: ["00000000-0000-4000-8000-0000000000c1", "00000000-0000-4000-8000-0000000000c2",
             "00000000-0000-4000-8000-0000000000c3", "00000000-0000-4000-8000-0000000000c4"],
  sku: "00000000-0000-4000-8000-0000000000d1",
  recipe: "00000000-0000-4000-8000-0000000000e1",
} as const;

/** Stub base tables → 0258 → 0262, as committed; one recipe (one SKU line), the source shop and four adopters. */
export async function migratedRecipeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(readFileSync("supabase/migrations/0258_recipe_input_write_atomic.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0262_recipe_shop_versions.sql", "utf8"));
  const shops = [ID.source, ...ID.adopters].map((id, i) => `('${id}', '${i === 0 ? "Source shop" : `Adopter ${i}`}', true)`).join(", ");
  await db.exec(`
    insert into public.users(id) values ('${ID.actor}');
    insert into public.locations(id, name, active) values ${shops};
    insert into public.measure_units(label, dimension, to_base_factor, active) values ('oz', 'weight', 1, true);
    insert into public.vendor_items(id, name) values ('${ID.sku}', 'Turkey');
    begin;
    insert into public.recipes(id, name) values ('${ID.recipe}', 'Italian');
    insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ('${ID.recipe}', '${ID.sku}', 1, 'oz');
    commit;
  `);
  return db;
}

const SNAP_LINES = JSON.stringify([{ component_sku_id: ID.sku }]); // every set here names only this SKU: the same closure
const lines = (qty: number) => JSON.stringify([{ component_sku_id: ID.sku, quantity: qty, unit: "oz", portioned: false }]);

export async function globalHead(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [ID.recipe]);
  return r.rows[0]!.id;
}

/** The REAL save_recipe_version; returns the new version id. */
export async function save(db: PGlite, a: {
  shop: string | null; expected: string | null; basedOn?: string | null; qty?: number;
  restoredFrom?: string; adoptedFrom?: string; promotedFrom?: string;
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select (public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, $4::uuid, $5::uuid, null, $6::uuid, $7::uuid, $8::uuid, $9::uuid,
              public.recipe_change_snapshot($1::uuid, $2::uuid, $10::jsonb))) ->> 'version_id' as id`,
    [ID.recipe, a.shop, a.qty === undefined ? null : lines(a.qty), a.expected, a.basedOn ?? null, ID.actor,
     a.restoredFrom ?? null, a.adoptedFrom ?? null, a.promotedFrom ?? null, SNAP_LINES],
  );
  return r.rows[0]!.id;
}

/** The REAL retire_recipe_version (back to default). */
export async function backToDefault(db: PGlite, versionId: string, shop: string): Promise<void> {
  await db.query(`select public.retire_recipe_version($1::uuid, $2::uuid, $3::uuid, public.recipe_change_snapshot($4::uuid, $2::uuid, $5::jsonb))`,
    [versionId, shop, ID.actor, ID.recipe, SNAP_LINES]);
}

export interface WrittenVersion {
  id: string; location_id: string | null; active: boolean; based_on_version_id: string | null;
  adopted_from_version_id: string | null; adoption_ended_from_version_id: string | null;
}

export async function versionRows(db: PGlite): Promise<WrittenVersion[]> {
  const r = await db.query<WrittenVersion>(
    `select id, location_id, active, based_on_version_id, adopted_from_version_id, adoption_ended_from_version_id
       from public.recipe_versions where recipe_id = $1 order by created_at, id`, [ID.recipe]);
  return r.rows;
}

/** The four sequences (Astra r7), through the real writers; returns the ids each test asserts on. */
export async function runProvenanceSequences(db: PGlite) {
  const [a1, a2, a3, a4] = ID.adopters;
  const head = await globalHead(db);
  const vSource = await save(db, { shop: ID.source, expected: null, basedOn: head, qty: 3 });
  // (1) adopt → restore a PRE-adoption version
  const pre1 = await save(db, { shop: a1!, expected: null, basedOn: head, qty: 2 });
  const adopted1 = await save(db, { shop: a1!, expected: pre1, adoptedFrom: vSource });
  const restoredPre = await save(db, { shop: a1!, expected: adopted1, restoredFrom: pre1 });
  // (2) adopt → restore GLOBAL history
  const adopted2 = await save(db, { shop: a2!, expected: null, adoptedFrom: vSource });
  const restoredGlobal = await save(db, { shop: a2!, expected: adopted2, restoredFrom: head });
  // (3) adopt → back to default
  const adopted3 = await save(db, { shop: a3!, expected: null, adoptedFrom: vSource });
  await backToDefault(db, adopted3, a3!);
  // (4) adopt → edit → restore the ADOPTED lineage: the link is kept, nothing ends
  const adopted4 = await save(db, { shop: a4!, expected: null, adoptedFrom: vSource });
  const edited4 = await save(db, { shop: a4!, expected: adopted4, qty: 5 });
  const restoredLineage = await save(db, { shop: a4!, expected: edited4, restoredFrom: adopted4 });
  // (5) adopt → restore pre-adoption → BACK TO DEFAULT (Astra r8): the restore's "link ended" record must survive
  // the later retirement of that same row (it carries no pointer, so Back to default ends nothing new).
  await backToDefault(db, restoredPre, a1!);
  return { vSource, pre1, adopted1, restoredPre, adopted2, restoredGlobal, adopted3, adopted4, edited4, restoredLineage };
}
```

Create `tests/recipe-provenance-writer.test.ts`:

```ts
/** Catalog Phase 3a — provenance follows the content, and its END is RECORDED by the writer (Astra r7), in PGlite. */
import { beforeAll, describe, expect, it } from "vitest";
import { migratedRecipeDb, runProvenanceSequences, versionRows, type WrittenVersion } from "./fixtures/recipe-versions-pglite";

describe("the real 0262 writers record where an adoption link ends", () => {
  let ids: Awaited<ReturnType<typeof runProvenanceSequences>>;
  let rows: Map<string, WrittenVersion>;
  beforeAll(async () => {
    const db = await migratedRecipeDb();
    ids = await runProvenanceSequences(db);
    rows = new Map((await versionRows(db)).map((r) => [r.id, r]));
  }, 60_000);
  const row = (id: string) => rows.get(id)!;

  it("adopt → restore a pre-adoption version: the link ends, recorded on the new row as the REPLACED version", () => {
    expect(row(ids.restoredPre).adopted_from_version_id).toBeNull();
    expect(row(ids.restoredPre).adoption_ended_from_version_id).toBe(ids.adopted1);
    expect(row(ids.restoredPre).based_on_version_id).toBe(ids.pre1); // why History must NOT infer from based_on
  });
  it("adopt → restore global history: the link ends, recorded the same way", () => {
    expect(row(ids.restoredGlobal).adopted_from_version_id).toBeNull();
    expect(row(ids.restoredGlobal).adoption_ended_from_version_id).toBe(ids.adopted2);
  });
  it("adopt → restore pre-adoption → back to default: the restore's end record SURVIVES the later retirement (Astra r8)", () => {
    expect(row(ids.restoredPre).active).toBe(false);                               // sequence (5) retired it
    expect(row(ids.restoredPre).adoption_ended_from_version_id).toBe(ids.adopted1); // not nulled, not overwritten
    expect(row(ids.adopted1).adoption_ended_from_version_id).toBeNull();           // and no second, false entry
  });
  it("adopt → back to default: the retired version records that its closing ended the link", () => {
    expect(row(ids.adopted3).active).toBe(false);
    expect(row(ids.adopted3).adoption_ended_from_version_id).toBe(ids.adopted3);
  });
  it("adopt → edit → restore the adopted lineage: the link is kept and nothing ends", () => {
    expect(row(ids.edited4).adopted_from_version_id).toBe(ids.vSource);
    expect(row(ids.restoredLineage).adopted_from_version_id).toBe(ids.vSource);
    expect(row(ids.restoredLineage).adoption_ended_from_version_id).toBeNull();
    expect(row(ids.edited4).adoption_ended_from_version_id).toBeNull();
  });
});
```

Run: `npx tsx scripts/recipe-versions/emit-0262-reemits.ts && npx vitest run tests/recipe-provenance-writer.test.ts` → 4 passed (after Step 4's migration and Step 5's re-emits).

- [ ] **Step 7: Run the pin**

Run: `npx vitest run tests/recipe-versions-migration.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0262_recipe_shop_versions.sql scripts/recipe-versions tests/recipe-versions-migration.test.ts tests/fixtures/recipe-versions-pglite.ts tests/recipe-provenance-writer.test.ts
git commit -F - <<'EOF'
feat(db): 0262 dated recipe versions, the global journal, the per-shop cycle law, writers, faithful re-emits (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 4: Migration 0263 — menu items per shop (the overlay and its three writers)

**Model decision.** The global default of a menu item IS its `menu_items` row (name, price, active). A shop's overlay is a `menu_item_shop_settings` row with `location_id NOT NULL`: `price` (NULL = the global price), `sold_here` (false = off the menu here), `name_override` / `name_override_es` (NULL = the global name). It is effective-dated and append-only like every version: a save closes the live row and opens a new one; "back to default" retires it. `promote_menu_item_shop_setting` (MoO+, lib-gated) copies a shop's price and/or name into `menu_items` under a compare-and-set; `sold_here` is never promoted (taking an item off every menu is not a promote). Like a recipe promote (lead decision 5), it **returns the source shop to the default for the promoted fields** in the same transaction: its row closes, and a new one opens holding only what it still says (or none). Its "changed shops" are computed **field by field** (Astra 3b r1#4): a shop changes when it inherits ANY promoted field. Every writer takes `p_snapshot` — `menu_item_change_snapshot(menu item, scope)`, the SCOPED dependency snapshot the preview showed (the item, its live shop rows, the active shops, and 0262's closure snapshot of every recipe that makes it at the scope whose cost is shown) — and, after the graph lock, the item row and the closure locks, refuses `dependencies_changed` on any difference.

**Files:**
- Create: `supabase/migrations/0263_menu_item_shop_settings.sql`
- Test: `tests/menu-item-shop-migration.test.ts`

- [ ] **Step 1: Write the failing pin test `tests/menu-item-shop-migration.test.ts`**

```ts
/** Catalog Phase 3a — migration 0263 pinned: the shop overlay, its three writers, its privilege ceiling. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0263_menu_item_shop_settings.sql", "utf8"));
const WRITERS = ["save_menu_item_shop_setting", "retire_menu_item_shop_setting", "promote_menu_item_shop_setting"];

describe("0263", () => {
  it("house header and gate line", () => {
    expect(src.split("\n")[0]).toBe("-- Migration 0263_menu_item_shop_settings");
    expect(src).toContain("NOT YET APPLIED — apply via MCP after review");
  });
  it("shop rows only, dated, one live per (menu item, shop), and a row must say something", () => {
    expect(src).toContain("location_id         uuid          not null references public.locations(id)");
    expect(src).toContain("constraint menu_item_shop_settings_live_window check ((valid_to is null) = active)");
    expect(src).toContain("on public.menu_item_shop_settings (menu_item_id, location_id) where active;");
    expect(src).toContain("constraint menu_item_shop_settings_says_something check");
  });
  it("every writer locks the menu item row first, is SECURITY DEFINER with a pinned search_path, service_role only", () => {
    for (const fn of WRITERS) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = pg_catalog, public");
      expect(body).toContain("from public.menu_items where id = ");
      expect(body.indexOf("for update")).toBeGreaterThan(-1);
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    expect(extractFunction(src, "create or replace function public.save_menu_item_shop_setting(", "\n$$;")).toContain("menu_item_shop:version_changed");
    const promote = extractFunction(src, "create or replace function public.promote_menu_item_shop_setting(", "\n$$;");
    expect(promote).toContain("menu_item_shop:global_changed");
    expect(promote).not.toContain("sold_here =");
  });
  it("every writer: graph lock → item row → closure locks → scoped snapshot re-check (Astra 3a r2#1–#3)", () => {
    for (const fn of WRITERS) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      const graph = body.indexOf("perform pg_advisory_xact_lock(7258025800);");
      const row = body.indexOf("from public.menu_items where id = ");
      const lock = body.indexOf("perform public.menu_item_change_lock(");
      const check = body.indexOf("public.menu_item_change_snapshot(");
      expect(graph).toBeGreaterThan(-1);
      expect(row).toBeGreaterThan(graph);
      expect(lock).toBeGreaterThan(row);
      expect(check).toBeGreaterThan(lock);
      expect(body).toContain("is distinct from p_snapshot");
      expect(body).toContain("'menu_item_shop:dependencies_changed'");
    }
    const snap = extractFunction(src, "create or replace function public.menu_item_change_snapshot(", "\n$$;");
    expect(snap).toContain("public.recipe_change_snapshot(r.recipe_id, p_location, null)");
    expect(src).not.toContain("-> 'tables'");
    expect(src).toContain("grant execute on function public.menu_item_change_snapshot(uuid, uuid) to service_role;");
  });
  it("promote: changed shops field by field, and the source shop returns to the default in the same transaction", () => {
    const promote = extractFunction(src, "create or replace function public.promote_menu_item_shop_setting(", "\n$$;");
    expect(promote).toContain("and ((v_price and not exists (select 1 from public.menu_item_shop_settings s");
    expect(promote).toContain("or (v_name and not exists (select 1 from public.menu_item_shop_settings s");
    expect(promote).not.toContain("((v_price and s.price is not null) or (v_name and s.name_override is not null))");
    const update = promote.indexOf("update public.menu_items");
    const retire = promote.indexOf("update public.menu_item_shop_settings set active = false, valid_to = v_now, retired_by = p_actor where id = v_row.id and active;");
    expect(retire).toBeGreaterThan(update);
    expect(promote).toContain("case when v_price then null else v_row.price end, v_row.sold_here,");
    expect(promote).toContain("'returned_shop', v_row.location_id");
  });
  it("privilege ceiling: deny-all RLS, revoke all (service_role too), grant exactly, asserted both ways", () => {
    expect(src).toContain("alter table public.menu_item_shop_settings enable row level security;");
    expect(src).toContain("create policy menu_item_shop_settings_no_user_delete on public.menu_item_shop_settings for delete using (false);");
    expect(src).toContain("revoke all on public.menu_item_shop_settings from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select, insert, update on public.menu_item_shop_settings to service_role;");
    expect(src).toContain("has_table_privilege('service_role', 'public.menu_item_shop_settings', 'DELETE')");
    expect(src).toContain("raise exception '0263: service_role above its ceiling'");
    expect(src).toContain("raise exception '0263: service_role is missing a privilege the writers need'");
    expect(src).toContain("raise exception '0263: unexpected execute grant'");
  });
});
```

Run: `npx vitest run tests/menu-item-shop-migration.test.ts`
Expected: FAIL with `ENOENT … 0263_menu_item_shop_settings.sql`.

- [ ] **Step 2: Create `supabase/migrations/0263_menu_item_shop_settings.sql`**

```sql
-- Migration 0263_menu_item_shop_settings
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod dry-run → prod, with 0262, BEFORE the 3a code merges).
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase3a-recipe-menu-versions-data.md (Task 4).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 (menu items: shop price, sold here, name override).
--
-- WHAT. A menu item's SHOP OVERLAY. The global default IS the menu_items row (the idiom's NULL location);
-- menu_item_shop_settings holds shop rows only:
--   price             NULL = the global price; else this shop's typed price (> 0, ≤ 1000, cents)
--   sold_here         false = off the menu at this shop (never deleted, never global)
--   name_override(_es) NULL = the global name
-- Effective-dated and append-only (valid_from / valid_to / active): a save closes the live row and opens a
-- new one; "back to default" retires it; Restore saves an old row's values as a new one.
-- The ONE rule that reads it is lib/menu-item-shop-shared.ts resolveMenuItemForShop.
--
-- WRITERS (SECURITY DEFINER, search_path pinned, service_role only; the menu_items row lock first):
--   save_menu_item_shop_setting(p_menu_item, p_location, p_price, p_sold_here, p_name, p_name_es, p_expected,
--                               p_note, p_actor, p_restored_from, p_snapshot)   optimistic on the live row id
--   retire_menu_item_shop_setting(p_setting, p_location, p_actor, p_snapshot)    back to default
--   promote_menu_item_shop_setting(p_setting, p_fields, p_expected_price, p_expected_name, p_expected_name_es, p_actor, p_snapshot)
--       MoO+ (lib gate): copies the shop's price and/or name into menu_items under a compare-and-set on the
--       global values; sold_here is never promoted. In the same transaction the SOURCE shop returns to the
--       default for the promoted fields (lead decision 5): its row closes; a new row opens with only what it
--       still says, or none. changed_shops = every active shop inheriting ANY promoted field (field by field).
--   menu_item_change_snapshot(p_menu_item, p_location)   THE DEPENDENCY SNAPSHOT, scoped: the item row, its live
--       shop rows, the active shops and, per recipe that makes it, 0262's closure snapshot at that scope. Every
--       writer above takes the graph lock, the item row, the closure locks (menu_item_change_lock → 0262
--       recipe_change_lock, NOWAIT) and then re-takes it: 'menu_item_shop:dependencies_changed' on any difference,
--       'recipe_version:dependencies_busy' when a dependency is being written right now.
-- Named refusals: P0001 'menu_item_shop:<code>' (lib/admin/menu-item-shop.ts maps them).
--
-- PRIVILEGE CEILING (the 0257 pattern): SELECT/INSERT/UPDATE for service_role, nothing else; nothing for
-- anon/authenticated; RLS on with the deny-all policy set.
--
-- VERIFY AFTER APPLY:
--   select count(*) from public.menu_item_shop_settings;                                    -- 0
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'menu_item_shop_settings' order by 2, 3;  -- service_role INSERT/SELECT/UPDATE (+ owner)
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and privilege_type = 'EXECUTE' and routine_name like '%menu_item_shop_setting'
--    order by 1, 2;                                                                         -- service_role (+ owner) only

begin;

create table if not exists public.menu_item_shop_settings (
  id                  uuid          primary key default gen_random_uuid(),
  menu_item_id        uuid          not null references public.menu_items(id),
  location_id         uuid          not null references public.locations(id),
  based_on_setting_id uuid          null references public.menu_item_shop_settings(id),
  price               numeric(10,2) null,
  sold_here           boolean       not null default true,
  name_override       text          null,
  name_override_es    text          null,
  active              boolean       not null default true,
  valid_from          timestamptz   not null default clock_timestamp(),
  valid_to            timestamptz   null,
  note                text          null,
  created_at          timestamptz   not null default clock_timestamp(),
  created_by          uuid          null references public.users(id),
  retired_by          uuid          null references public.users(id),
  constraint menu_item_shop_settings_live_window check ((valid_to is null) = active),
  constraint menu_item_shop_settings_price check (price is null or (price > 0 and price <= 1000)),
  constraint menu_item_shop_settings_names check (
    (name_override is null or char_length(btrim(name_override)) between 1 and 120)
    and (name_override_es is null or char_length(btrim(name_override_es)) between 1 and 120)
  ),
  constraint menu_item_shop_settings_says_something check (
    price is not null or not sold_here or name_override is not null or name_override_es is not null
  )
);
comment on table public.menu_item_shop_settings is
  'A menu item''s SHOP OVERLAY (0263): this shop''s price, whether it is sold here, and its name here. The '
  'global default is the menu_items row. Effective-dated, append-only, one live per (menu item, shop). '
  'Resolution: lib/menu-item-shop-shared.ts resolveMenuItemForShop.';
create unique index if not exists menu_item_shop_settings_one_live
  on public.menu_item_shop_settings (menu_item_id, location_id) where active;
create index if not exists menu_item_shop_settings_shop_live on public.menu_item_shop_settings (location_id) where active;
create index if not exists menu_item_shop_settings_history on public.menu_item_shop_settings (menu_item_id, location_id, valid_from desc);

-- THE DEPENDENCY SNAPSHOT (the 0261 pattern), SCOPED (lead decision (a)): what the menu preview's name, price,
-- cost and margins were computed from — this item's row, its live shop rows, the active shops, and, for every
-- recipe that makes it, 0262's closure snapshot at the scope whose cost is shown (p_location; NULL = the global
-- default, as a promote shows). Never a whole table.
create or replace function public.menu_item_change_snapshot(p_menu_item uuid, p_location uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'item', (select to_jsonb(m) from public.menu_items m where m.id = p_menu_item),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) order by s.location_id)
                            from public.menu_item_shop_settings s where s.menu_item_id = p_menu_item and s.active), '[]'::jsonb),
    'active_shops', coalesce((select jsonb_agg(l.id order by l.id) from public.locations l where l.active), '[]'::jsonb),
    'costs', coalesce((select jsonb_agg(jsonb_build_object('recipe_id', r.recipe_id,
                                                           'snapshot', public.recipe_change_snapshot(r.recipe_id, p_location, null))
                                        order by r.recipe_id)
                         from (select distinct ro.recipe_id from public.recipe_outputs ro where ro.output_menu_item_id = p_menu_item) r),
                      '[]'::jsonb));
$$;

-- THE CLOSURE LOCKS for a menu change (0262 recipe_change_lock, per recipe that makes the item; NOWAIT). Lock
-- order: graph lock (taken first by every menu writer, re-entrant here) → the menu item row → the closure.
create or replace function public.menu_item_change_lock(p_menu_item uuid, p_location uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe uuid;
begin
  perform pg_advisory_xact_lock(7258025800);
  for v_recipe in
    select distinct ro.recipe_id from public.recipe_outputs ro where ro.output_menu_item_id = p_menu_item order by 1
  loop
    perform public.recipe_change_lock(v_recipe, p_location, null);
  end loop;
end;
$$;

create or replace function public.save_menu_item_shop_setting(
  p_menu_item     uuid,
  p_location      uuid,
  p_price         numeric,
  p_sold_here     boolean,
  p_name          text,
  p_name_es       text,
  p_expected      uuid,
  p_note          text,
  p_actor         uuid,
  p_restored_from uuid,
  p_snapshot      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_live      uuid;
  v_src       public.menu_item_shop_settings%rowtype;
  v_price     numeric := p_price;
  v_sold      boolean := coalesce(p_sold_here, true);
  v_name      text := nullif(btrim(coalesce(p_name, '')), '');
  v_name_es   text := nullif(btrim(coalesce(p_name_es, '')), '');
  v_new       uuid;
  v_now       timestamptz := clock_timestamp();
begin
  -- LOCK ORDER (0262 (7a)): the graph lock, then THE MENU ITEM ROW (every overlay writer of this item serializes
  -- here), then the cost closure (NOWAIT), then the snapshot re-check under them all.
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.menu_items where id = p_menu_item and active for update;
  if not found then
    raise exception 'menu_item_shop:menu_item_not_found' using errcode = 'P0001';
  end if;
  perform public.menu_item_change_lock(p_menu_item, p_location);
  if p_snapshot is null or public.menu_item_change_snapshot(p_menu_item, p_location) is distinct from p_snapshot then
    raise exception 'menu_item_shop:dependencies_changed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'menu_item_shop:location_not_found' using errcode = 'P0001';
  end if;
  if p_restored_from is not null then
    select * into v_src from public.menu_item_shop_settings
     where id = p_restored_from and menu_item_id = p_menu_item and location_id = p_location;
    if not found then
      raise exception 'menu_item_shop:invalid_source' using errcode = 'P0001';
    end if;
    v_price := v_src.price; v_sold := v_src.sold_here; v_name := v_src.name_override; v_name_es := v_src.name_override_es;
  end if;
  if v_price is not null and (v_price <= 0 or v_price > 1000 or v_price <> round(v_price, 2)) then
    raise exception 'menu_item_shop:invalid_price' using errcode = 'P0001';
  end if;
  if (v_name is not null and char_length(v_name) > 120) or (v_name_es is not null and char_length(v_name_es) > 120) then
    raise exception 'menu_item_shop:invalid_name' using errcode = 'P0001';
  end if;
  if v_price is null and v_sold and v_name is null and v_name_es is null then
    raise exception 'menu_item_shop:empty_setting' using errcode = 'P0001';
  end if;
  select id into v_live from public.menu_item_shop_settings
   where menu_item_id = p_menu_item and location_id = p_location and active for update;
  if v_live is distinct from p_expected then
    raise exception 'menu_item_shop:version_changed' using errcode = 'P0001';
  end if;
  if v_live is not null then
    update public.menu_item_shop_settings set active = false, valid_to = greatest(v_now, valid_from), retired_by = p_actor where id = v_live and active;
  end if;
  insert into public.menu_item_shop_settings (menu_item_id, location_id, based_on_setting_id, price, sold_here, name_override,
                                              name_override_es, active, valid_from, note, created_at, created_by)
  values (p_menu_item, p_location, coalesce(p_restored_from, v_live), v_price, v_sold, v_name, v_name_es, true, v_now,
          nullif(btrim(coalesce(p_note, '')), ''), v_now, p_actor)
  returning id into v_new;
  return jsonb_build_object('setting_id', v_new, 'retired_setting_id', v_live, 'valid_from', v_now);
end;
$$;

create or replace function public.retire_menu_item_shop_setting(p_setting uuid, p_location uuid, p_actor uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.menu_item_shop_settings%rowtype;
  v_now timestamptz;
begin
  select * into v_row from public.menu_item_shop_settings where id = p_setting;
  if not found or v_row.location_id is distinct from p_location then
    raise exception 'menu_item_shop:not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.menu_items where id = v_row.menu_item_id for update;
  perform public.menu_item_change_lock(v_row.menu_item_id, p_location);
  if p_snapshot is null or public.menu_item_change_snapshot(v_row.menu_item_id, p_location) is distinct from p_snapshot then
    raise exception 'menu_item_shop:dependencies_changed' using errcode = 'P0001';
  end if;
  select * into v_row from public.menu_item_shop_settings where id = p_setting for update;
  if not v_row.active then
    raise exception 'menu_item_shop:not_live' using errcode = 'P0001';
  end if;
  v_now := greatest(clock_timestamp(), v_row.valid_from);
  update public.menu_item_shop_settings set active = false, valid_to = v_now, retired_by = p_actor where id = p_setting and active;
  return jsonb_build_object('setting_id', p_setting, 'menu_item_id', v_row.menu_item_id, 'location_id', p_location, 'valid_to', v_now);
end;
$$;

create or replace function public.promote_menu_item_shop_setting(
  p_setting          uuid,
  p_fields           text[],
  p_expected_price   numeric,
  p_expected_name    text,
  p_expected_name_es text,
  p_actor            uuid,
  p_snapshot         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row     public.menu_item_shop_settings%rowtype;
  v_item    public.menu_items%rowtype;
  v_price   boolean := 'price' = any(coalesce(p_fields, '{}'::text[]));
  v_name    boolean := 'name' = any(coalesce(p_fields, '{}'::text[]));
  v_changed jsonb;
  v_now     timestamptz;
  v_rest    uuid;
begin
  if cardinality(coalesce(p_fields, '{}'::text[])) = 0
     or exists (select 1 from unnest(p_fields) f where f not in ('price', 'name')) then
    raise exception 'menu_item_shop:invalid_payload' using errcode = 'P0001';
  end if;
  select * into v_row from public.menu_item_shop_settings where id = p_setting;
  if not found then
    raise exception 'menu_item_shop:not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7258025800);
  select * into v_item from public.menu_items where id = v_row.menu_item_id and active for update;
  if not found then
    raise exception 'menu_item_shop:menu_item_not_found' using errcode = 'P0001';
  end if;
  -- A promote shows the GLOBAL cost only: the closure and snapshot of the global view alone (NIL scope, 0262 (7a)).
  perform public.menu_item_change_lock(v_item.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if p_snapshot is null or public.menu_item_change_snapshot(v_item.id, '00000000-0000-0000-0000-000000000000'::uuid) is distinct from p_snapshot then
    raise exception 'menu_item_shop:dependencies_changed' using errcode = 'P0001';
  end if;
  select * into v_row from public.menu_item_shop_settings where id = p_setting for update;
  if not v_row.active then
    raise exception 'menu_item_shop:not_live' using errcode = 'P0001';
  end if;
  if (v_price and v_row.price is null) or (v_name and v_row.name_override is null) then
    raise exception 'menu_item_shop:nothing_to_promote' using errcode = 'P0001';
  end if;
  -- COMPARE-AND-SET on the global values the person saw in the preview.
  if v_item.menu_price is distinct from p_expected_price or v_item.name is distinct from p_expected_name
     or v_item.name_es is distinct from p_expected_name_es then
    raise exception 'menu_item_shop:global_changed' using errcode = 'P0001';
  end if;
  -- FIELD BY FIELD (Astra 3b r1#4): a shop's menu changes when it inherits ANY promoted field — a shop with its
  -- own price but the default name still changes when price AND name are promoted. Taken before the source
  -- returns to the default (its values ARE the promoted ones, so its menu does not change).
  v_changed := coalesce((
    select jsonb_agg(l.id order by l.id) from public.locations l
     where l.active and l.id <> v_row.location_id
       and ((v_price and not exists (select 1 from public.menu_item_shop_settings s
                                      where s.menu_item_id = v_item.id and s.location_id = l.id and s.active and s.price is not null))
         or (v_name and not exists (select 1 from public.menu_item_shop_settings s
                                     where s.menu_item_id = v_item.id and s.location_id = l.id and s.active and s.name_override is not null)))),
    '[]'::jsonb);
  update public.menu_items
     set menu_price = case when v_price then v_row.price else menu_price end,
         name       = case when v_name then v_row.name_override else name end,
         name_es    = case when v_name then coalesce(v_row.name_override_es, name_es) else name_es end,
         updated_at = now(),
         updated_by = p_actor
   where id = v_item.id;
  -- THE SOURCE SHOP RETURNS TO THE DEFAULT for what it promoted (lead decision 5): its row closes (history
  -- kept); what it still says on its own (a field not promoted, or "not sold here") carries on in a new row.
  v_now := greatest(clock_timestamp(), v_row.valid_from);
  update public.menu_item_shop_settings set active = false, valid_to = v_now, retired_by = p_actor where id = v_row.id and active;
  if (not v_price and v_row.price is not null) or not v_row.sold_here
     or (not v_name and (v_row.name_override is not null or v_row.name_override_es is not null)) then
    insert into public.menu_item_shop_settings (menu_item_id, location_id, based_on_setting_id, price, sold_here, name_override,
                                                name_override_es, active, valid_from, note, created_at, created_by)
    values (v_item.id, v_row.location_id, v_row.id,
            case when v_price then null else v_row.price end, v_row.sold_here,
            case when v_name then null else v_row.name_override end,
            case when v_name then null else v_row.name_override_es end,
            true, v_now, 'promoted to the default', v_now, p_actor)
    returning id into v_rest;
  end if;
  return jsonb_build_object(
    'menu_item_id', v_item.id, 'fields', to_jsonb(p_fields),
    'before', jsonb_build_object('menu_price', v_item.menu_price, 'name', v_item.name, 'name_es', v_item.name_es),
    'changed_shops', v_changed,
    'returned_shop', v_row.location_id, 'retired_setting_id', v_row.id, 'remaining_setting_id', v_rest);
end;
$$;

alter table public.menu_item_shop_settings enable row level security;
create policy menu_item_shop_settings_no_user_select on public.menu_item_shop_settings for select using (false);
create policy menu_item_shop_settings_no_user_insert on public.menu_item_shop_settings for insert with check (false);
create policy menu_item_shop_settings_no_user_update on public.menu_item_shop_settings for update using (false);
create policy menu_item_shop_settings_no_user_delete on public.menu_item_shop_settings for delete using (false);
revoke all on public.menu_item_shop_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.menu_item_shop_settings to service_role;

revoke all on function public.save_menu_item_shop_setting(uuid, uuid, numeric, boolean, text, text, uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.retire_menu_item_shop_setting(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.promote_menu_item_shop_setting(uuid, text[], numeric, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.menu_item_change_snapshot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.menu_item_change_lock(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_menu_item_shop_setting(uuid, uuid, numeric, boolean, text, text, uuid, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.retire_menu_item_shop_setting(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.promote_menu_item_shop_setting(uuid, text[], numeric, text, text, uuid, jsonb) to service_role;
grant execute on function public.menu_item_change_snapshot(uuid, uuid) to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_menu_item_shop_setting', 'retire_menu_item_shop_setting', 'promote_menu_item_shop_setting',
                                     'menu_item_change_snapshot', 'menu_item_change_lock')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0263: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'menu_item_shop_settings' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0263: unexpected table grant on menu_item_shop_settings';
  end if;
  if has_table_privilege('service_role', 'public.menu_item_shop_settings', 'DELETE')
     or has_table_privilege('service_role', 'public.menu_item_shop_settings', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.menu_item_shop_settings', 'REFERENCES')
     or has_table_privilege('service_role', 'public.menu_item_shop_settings', 'TRIGGER') then
    raise exception '0263: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.menu_item_shop_settings', 'SELECT')
          and has_table_privilege('service_role', 'public.menu_item_shop_settings', 'INSERT')
          and has_table_privilege('service_role', 'public.menu_item_shop_settings', 'UPDATE')) then
    raise exception '0263: service_role is missing a privilege the writers need';
  end if;
end $$;

commit;
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/menu-item-shop-migration.test.ts tests/recipe-versions-migration.test.ts`
Expected: PASS, 0 failed.

```bash
git add supabase/migrations/0263_menu_item_shop_settings.sql tests/menu-item-shop-migration.test.ts
git commit -F - <<'EOF'
feat(db): 0263 menu items per shop — price here, sold here, name here; save / back to default / promote (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 5: The recipe resolver at the ONE loader point — live per shop, as of a business date, preview overrides

`loadRecipeGraph` gains the recipe overlay at exactly one place: after its three reads and their throws, before anything is indexed. The scope is the one 2a already threads (`versionLocationId`, defaulting to `locationId`), so **every consumer 2a routed to a shop now follows that shop's recipe versions too** — Toast and ezCater depletion (dated), capture paths, sku-demand, surplus, counts, the costing board's shop view — without touching a consumer. The global live graph reads no new table (zero extra queries). `createDatedGraphs` reuses the live graph unless a pack OR a recipe boundary falls after the date. `recipeOverrides` (a preview's hypothetical lines, 3b) runs through the same loader, so a hypothetical ingredient's pack and product resolution are hydrated exactly like a real one.

**Files:**
- Modify: `lib/prep-consumption.ts`, `tests/fixtures/counts-fake-db.ts`, `tests/silent-read-fabrication.test.ts`
- Test: `tests/recipe-versions-graph.test.ts`

- [ ] **Step 1: Every fake database has the new tables (empty = "no shop versions")**

In `tests/fixtures/counts-fake-db.ts`, directly after the line `export function createFakeDb(tables: Tables, latencyMs = 0) {`, insert:

```ts
  // Catalog Phase 3a (0262/0263): these tables exist in every database after the migration and are
  // EMPTY until somebody makes a shop version — exactly what "no shop versions" means. A fixture that
  // brings its own rows keeps them.
  for (const t of ["recipe_versions", "recipe_version_lines", "menu_item_shop_settings", "recipe_notice_dismissals"]) tables[t] ??= [];
```

- [ ] **Step 2: Write the failing test `tests/recipe-versions-graph.test.ts`**

```ts
/**
 * Catalog Phase 3a — shop recipe versions PRESENT. The one resolver point answers:
 *   · live, per shop: a shop's own version replaces the global lines for THAT shop only;
 *   · as of a business date: a global edit made today never changes yesterday's rebuilt depletion; a
 *     shop version that went back to default still answers inside its own dates;
 *   · previews: hypothetical lines through the same loader, their SKUs hydrated;
 *   · the global live graph reads no version table at all; a quiet day reuses the live graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { createDatedGraphs, loadPackBoundaries, loadRecipeGraph, loadRecipeLineOverlay, packIntervalIndex } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import type { RecipeVersionLineRow } from "@/lib/recipe-versions-shared";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const SHOP_SAVE = "2026-10-10T16:00:00.000Z";
const BACK_TO_DEFAULT = "2026-10-12T16:00:00.000Z";
const TODAY_EDIT = "2026-10-15T14:00:00.000Z"; // 10 AM ET on 2026-10-15

type Row = Record<string, unknown>;
const vrow = (id: string, recipe: string, loc: string | null, from: string, to: string | null): Row => ({
  id, recipe_id: recipe, location_id: loc, based_on_version_id: null, adopted_from_version_id: null, promoted_from_version_id: null,
  active: to === null, valid_from: from, valid_to: to, note: null, created_at: from, created_by: null, retired_by: null,
});
const lrow = (id: string, version: string, recipe: string, loc: string | null, sku: string, qty: number, unit: string, order: number): Row => ({
  id, version_id: version, recipe_id: recipe, location_id: loc, component_sku_id: sku, component_item_id: null, component_product_id: null,
  quantity: qty, unit, each_container_label: null, portioned: false, display_order: order, source_line_id: null,
});

function withVersions(): Record<string, Row[]> {
  const t = buildRecipeVersionsFixture();
  // (1) LOC's own slaw since 10-10: 24 oz of mayo instead of 16.
  t.recipe_versions!.push(vrow("sv-slaw", "r-slaw", LOC, SHOP_SAVE, null));
  t.recipe_version_lines!.push(
    lrow("svl-1", "sv-slaw", "r-slaw", LOC, "s-lettuce", 48, "oz", 0),
    lrow("svl-2", "sv-slaw", "r-slaw", LOC, "s-mayo", 24, "oz", 1),
  );
  // (2) OTHER's own pickle side from 10-10 to 10-12 (then back to default): 2 jars instead of 1.
  t.recipe_versions!.push(vrow("ov-pickle", "r-pickle", OTHER, SHOP_SAVE, BACK_TO_DEFAULT));
  t.recipe_version_lines!.push(lrow("ovl-1", "ov-pickle", "r-pickle", OTHER, "s-pickle", 2, "jar", 0));
  // (3) A GLOBAL edit today at 10 AM ET: the Italian's turkey 0.0125 case (4 oz) → 0.025 case (8 oz).
  const base = t.recipe_versions!.find((v) => v.id === "rv-r-italian-base")!;
  Object.assign(base, { active: false, valid_to: TODAY_EDIT });
  t.recipe_versions!.push(vrow("gv-italian-2", "r-italian", null, TODAY_EDIT, null));
  for (const l of t.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
    t.recipe_version_lines!.push({ ...l, id: `g2-${String(l.id)}`, version_id: "gv-italian-2", quantity: l.source_line_id === "ri-03" ? 0.025 : l.quantity });
  }
  t.recipe_inputs!.find((r) => r.id === "ri-03")!.quantity = 0.025; // recipe_inputs IS the live global head
  return t;
}

const turkey = (g: RecipeGraph) => perUnitSkuOzForMenuItemFromGraph(g, "m-italian").get("s-turkey");
const pickle = (g: RecipeGraph) => perUnitSkuOzForMenuItemFromGraph(g, "m-pickle-side").get("s-pickle");
const slawMayo = (g: RecipeGraph) => perUnitSkuOzForItemFromGraph(g, "i-slaw").get("s-mayo");

beforeEach(() => { current = createFakeDb(withVersions()); });
afterEach(() => { current = null; });

describe("live — a shop's own version answers for that shop only", () => {
  it("LOC's slaw uses 24 oz of mayo (12 per unit); OTHER and global keep the default (8 per unit)", async () => {
    expect(slawMayo(await loadRecipeGraph({ locationId: LOC }))).toBeCloseTo(12, 10);
    expect(slawMayo(await loadRecipeGraph({ locationId: OTHER }))).toBeCloseTo(8, 10);
    expect(slawMayo(await loadRecipeGraph())).toBeCloseTo(8, 10);
  });
  it("capture paths that pass only versionLocationId follow the shop's recipe too", async () => {
    expect(slawMayo(await loadRecipeGraph({ versionLocationId: LOC }))).toBeCloseTo(12, 10);
  });
  it("a retired shop version is never live: OTHER's pickle side is back on the default", async () => {
    expect(pickle(await loadRecipeGraph({ locationId: OTHER }))).toBeCloseTo(8, 10);
  });
  it("the global live graph reads no version table (zero extra queries)", async () => {
    const before = current!.log.length;
    await loadRecipeGraph();
    const tables = current!.log.slice(before).map((q) => q.table);
    expect(tables).not.toContain("recipe_versions");
    expect(tables).not.toContain("recipe_version_lines");
    expect((await loadRecipeLineOverlay(null, null)).size).toBe(0);
  });
});

describe("as of a business date — recipes are dated now (closes 2a open question 1)", () => {
  it("a GLOBAL edit made today: yesterday still depletes 4 oz of turkey, today 8, live 8", async () => {
    const dated = createDatedGraphs({ locationId: null });
    expect(turkey(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkey(await dated("2026-10-15"))).toBeCloseTo(8, 10);
    expect(turkey(await loadRecipeGraph())).toBeCloseTo(8, 10);
  });
  it("every shop riding the default sees the same dated edit", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    expect(turkey(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkey(await dated("2026-10-15"))).toBeCloseTo(8, 10);
  });
  it("back to default, seen from the past: OTHER's 2-jar version answers on 10-11 only", async () => {
    const dated = createDatedGraphs({ locationId: OTHER });
    expect(pickle(await dated("2026-10-09"))).toBeCloseTo(8, 10);
    expect(pickle(await dated("2026-10-11"))).toBeCloseTo(16, 10);
    expect(pickle(await dated("2026-10-13"))).toBeCloseTo(8, 10);
  });
  it("LOC's slaw version starts on 10-10: 10-09 is the default, 10-11 is LOC's — INSIDE ONE pack interval (Astra 3a r3#1)", async () => {
    // 2a caches one graph per pack interval; 10-09 and 10-11 sit in the SAME pack interval, so only the recipe
    // boundary (merged into the cuts by loadCatalogBoundaries) can tell them apart.
    const packs = await loadPackBoundaries(LOC);
    expect(packIntervalIndex(packs, Date.parse("2026-10-10T03:59:59.999Z"))).toBe(packIntervalIndex(packs, Date.parse("2026-10-12T03:59:59.999Z")));
    const dated = createDatedGraphs({ locationId: LOC });
    expect(slawMayo(await dated("2026-10-09"))).toBeCloseTo(8, 10);
    expect(slawMayo(await dated("2026-10-11"))).toBeCloseTo(12, 10);
  });
  it("a day after every pack and recipe boundary reuses the live graph (no extra graph load)", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    const before = current!.log.filter((q) => q.table === "recipes").length;
    await dated("2026-10-16");
    await dated("2026-10-17");
    expect(current!.log.filter((q) => q.table === "recipes").length - before).toBe(1);
  });
});

describe("preview overrides — hypothetical lines through the same loader", () => {
  it("override wins over the version and hydrates a SKU no recipe names", async () => {
    const lines: RecipeVersionLineRow[] = [
      { id: "h1", version_id: "preview", recipe_id: "r-slaw", component_sku_id: "s-mayo", component_item_id: null, component_product_id: null, quantity: 40, unit: "oz", each_container_label: null, portioned: false, display_order: 0 },
      { id: "h2", version_id: "preview", recipe_id: "r-slaw", component_sku_id: "s-bags", component_item_id: null, component_product_id: null, quantity: 2, unit: "oz", each_container_label: null, portioned: false, display_order: 1 },
    ];
    const g = await loadRecipeGraph({ locationId: LOC, recipeOverrides: new Map([["r-slaw", lines]]) });
    expect(slawMayo(g)).toBeCloseTo(20, 10);
    expect(g.skuPack.has("s-bags")).toBe(true);
  });
});
```

Run: `npx vitest run tests/recipe-versions-graph.test.ts`
Expected: FAIL — `loadRecipeLineOverlay` is not exported, and the shop assertions read the default (8, not 12).

- [ ] **Step 3: The recipe-version resolver point in `lib/prep-consumption.ts`**

Add to the imports (beside 2a's `@/lib/sku-versions-shared` import):

```ts
import {
  pickLiveShopRecipeVersions, pickRecipeVersionsAsOf, recipeLineReplacements, versionIdsNeedingLines,
  type RecipeVersionLineRow, type RecipeVersionRow,
} from "@/lib/recipe-versions-shared";
```

Merged 2a (main @ 4955da7f) caches dated graphs **per pack INTERVAL**: `createDatedGraphs` loads `loadPackBoundaries(scope)` (every pack version's opening and closing, ascending), finds a date's interval with `packIntervalIndex`, and shares one as-of graph per interval (the last interval IS the live graph). A recipe edit inside a pack interval would therefore be invisible — two dates on opposite sides of it would share one graph (Astra 3a r3#1). The intervals must be cut at **pack AND recipe** boundaries. In `createDatedGraphs`, replace

```ts
    bounds ??= loadPackBoundaries(opts.locationId);
```

with

```ts
    // CATALOG PHASE 3a: recipe versions open and close too — the intervals are cut at every pack AND recipe
    // boundary, so two dates on opposite sides of a recipe edit never share a graph.
    bounds ??= loadCatalogBoundaries(opts.locationId);
```

and in its doc comment replace `ONE graph per pack INTERVAL for a shop` with `ONE graph per catalog INTERVAL (pack and, since 3a, recipe boundaries) for a shop`. Directly after the closing `}` of `packIntervalIndex`, insert:

```ts
/**
 * EVERY RECIPE BOUNDARY (a recipe version opening or closing) visible to `scope`, ascending, de-duplicated
 * (epoch ms) — catalog Phase 3a, 0262. Baseline versions open on 2000-01-01, so with no edit since the migration
 * the only recipe boundary is that date and every later business date resolves to the live graph. Paged.
 */
export async function loadRecipeBoundaries(scope: VersionScope): Promise<number[]> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<{ id: string; valid_from: string; valid_to: string | null }>(async (from, to) => {
    const base = sb.from("recipe_versions").select("id, valid_from, valid_to");
    const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped.order("id", { ascending: true }).range(from, to)
      .returns<Array<{ id: string; valid_from: string; valid_to: string | null }>>();
    if (error) throw new Error(`loadRecipeBoundaries: ${error.message}`);
    return { data };
  });
  const out = new Set<number>();
  for (const r of rows) {
    out.add(Date.parse(r.valid_from));
    if (r.valid_to != null) out.add(Date.parse(r.valid_to));
  }
  return [...out].filter(Number.isFinite).sort((x, y) => x - y);
}

/** Pack ∪ recipe boundaries for `scope`, ascending and de-duplicated: the cuts between dated-graph intervals. */
export async function loadCatalogBoundaries(scope: VersionScope): Promise<number[]> {
  const [packs, recipes] = await Promise.all([loadPackBoundaries(scope), loadRecipeBoundaries(scope)]);
  return [...new Set([...packs, ...recipes])].sort((x, y) => x - y);
}

/**
 * THE RECIPE-VERSION RESOLVER POINT (catalog Phase 3a, 0262). recipe → the lines that REPLACE its
 * recipe_inputs for `scope` at `asOf`, decided by the pure rules in lib/recipe-versions-shared.ts:
 *   live, global ....... nothing to read — recipe_inputs IS the live global (zero queries);
 *   live, a shop ....... that shop's live versions (one read) and their lines (one read, when any);
 *   as of an instant ... the versions of {global ∪ scope} opened by then, the pick, then the lines of
 *                        every pick that is not the live global head.
 * PAGED (the 1000-row cap) and id-CHUNKED (the request-line budget). Fails loud: a dropped read would
 * silently put the default's lines where a shop's version belongs.
 */
export async function loadRecipeLineOverlay(scope: VersionScope, asOf: string | null): Promise<Map<string, RecipeVersionLineRow[]>> {
  if (asOf == null && scope == null) return new Map();
  const sb = getServiceRoleClient();
  const versions = await selectAllRows<RecipeVersionRow>(async (from, to) => {
    const base = sb.from("recipe_versions").select("id, recipe_id, location_id, valid_from, valid_to, active");
    const scoped = asOf == null
      ? base.eq("location_id", assertScopeToken(scope as string)).eq("active", true)
      : (scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`)).lte("valid_from", asOf);
    const { data, error } = await scoped.order("id", { ascending: true }).range(from, to).returns<RecipeVersionRow[]>();
    if (error) throw new Error(`loadRecipeLineOverlay versions: ${error.message}`);
    return { data };
  });
  const picked = asOf == null ? pickLiveShopRecipeVersions(versions, scope) : pickRecipeVersionsAsOf(versions, scope, asOf);
  const ids = versionIdsNeedingLines(picked);
  if (ids.length === 0) return new Map();
  const lines: RecipeVersionLineRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    lines.push(...await selectAllRows<RecipeVersionLineRow>(async (from, to) => {
      const { data, error } = await sb.from("recipe_version_lines")
        .select("id, version_id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order")
        .in("version_id", chunk)
        .order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<RecipeVersionLineRow[]>();
      if (error) throw new Error(`loadRecipeLineOverlay lines: ${error.message}`);
      return { data };
    }));
  }
  return recipeLineReplacements(picked, lines);
}
```

- [ ] **Step 4: `loadRecipeGraph` reads the overlay once, before indexing**

1. Replace the signature line

```ts
export async function loadRecipeGraph(opts?: { locationId?: string | null; versionLocationId?: string | null; asOf?: string | null }): Promise<RecipeGraph> {
```

with

```ts
export async function loadRecipeGraph(opts?: {
  locationId?: string | null;
  versionLocationId?: string | null;
  asOf?: string | null;
  /** A preview's hypothetical lines (catalog Phase 3b): recipe → lines, winning over every version. */
  recipeOverrides?: ReadonlyMap<string, readonly RecipeVersionLineRow[]>;
}): Promise<RecipeGraph> {
```

2. Directly after the three-read throw loop (the block ending `    if (err) throw new Error(\`loadRecipeGraph ${label}: ${err.message}\`);` followed by `  }`), and before `  const outputItemIds = …`, insert:

```ts
  // CATALOG PHASE 3a (0262): THE RECIPE LINES THIS SCOPE RESOLVES. A recipe whose answer is a shop
  // version (live, or in force at `asOf`) or an older global version gets THAT version's lines; every
  // other recipe keeps its recipe_inputs rows exactly as read above (the live global head IS
  // recipe_inputs). A preview's overrides win over both. Outputs and product resolution are untouched.
  const replacements = await loadRecipeLineOverlay(versionScope, asOf);
  for (const [recipeId, lines] of opts?.recipeOverrides ?? []) replacements.set(recipeId, [...lines]);
  const lineRows = [...(inRows ?? []), ...[...replacements.values()].flat()];
```

3. Replace

```ts
  const skuIds = [...new Set((inRows ?? []).filter((c) => c.component_sku_id).map((c) => c.component_sku_id!))];
  const productIds = [...new Set((inRows ?? []).filter((c) => c.component_product_id).map((c) => c.component_product_id!))];
```

with

```ts
  // Every SKU / product ANY resolved line names — the base rows first (so with no versions the order,
  // and the graph, are byte-identical), then a version's or a preview's additions.
  const skuIds = [...new Set(lineRows.filter((c) => c.component_sku_id).map((c) => c.component_sku_id!))];
  const productIds = [...new Set(lineRows.filter((c) => c.component_product_id).map((c) => c.component_product_id!))];
```

4. Replace

```ts
  const inputsByRecipe = new Map<string, GraphRecipe["inputs"]>();
  for (const c of inRows ?? []) {
    const list = inputsByRecipe.get(c.recipe_id) ?? [];
```

with

```ts
  const inputsByRecipe = new Map<string, GraphRecipe["inputs"]>();
  for (const c of inRows ?? []) {
    if (replacements.has(c.recipe_id)) continue; // this scope answers with another version's lines (below)
    const list = inputsByRecipe.get(c.recipe_id) ?? [];
```

and directly after that loop's closing `  }` (the loop ends with `    inputsByRecipe.set(c.recipe_id, list);` and `  }`), insert:

```ts
  for (const [recipeId, lines] of replacements) {
    inputsByRecipe.set(recipeId, lines.map((c) => ({
      quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id,
      componentItemId: c.component_item_id, componentProductId: c.component_product_id,
    })));
  }
```

5. In the doc comment above `loadRecipeGraph`, append after 2a's `opts.versionLocationId` paragraph:

```ts
 *
 * RECIPES ARE VERSIONED TOO (catalog Phase 3a, 0262): the same `versionLocationId` chooses whose shop
 * recipe versions answer, and the same `asOf` chooses WHEN — loadRecipeLineOverlay is the one point
 * that decides; recipe_inputs answers wherever the live global head does. Query count stays FIXED:
 * +0 for the global live graph, +1–2 for a shop or a date, never per recipe.
```

- [ ] **Step 5: Register the new loader with the silent-read pin**

In `tests/silent-read-fabrication.test.ts`, inside the `for (const [decl, marker] of [` list of "every one of its four batch loaders throws too", add after `["async function loadItemParBasis(", "loadItemParBasis:"],`:

```ts
      // Catalog Phase 3a: the recipe-version resolver point fails loud too.
      ["export async function loadRecipeLineOverlay(", "loadRecipeLineOverlay versions:"],
      ["export async function loadRecipeBoundaries(", "loadRecipeBoundaries:"],
```

- [ ] **Step 6: Typecheck, then the pins**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/recipe-versions-graph.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/shop-versions-as-of.test.ts tests/counts-onhand-equivalence.test.ts tests/silent-read-fabrication.test.ts tests/product-member-pack.test.ts tests/scoped-flat-consumers.test.ts tests/toast-sales-context.test.ts tests/ezcater-depletion.test.ts tests/menu-costing-shop-scope.test.ts`

Expected: PASS, 0 failed. **Both goldens are unchanged:** `git diff --stat tests/fixtures/recipe-versions-golden.json tests/fixtures/shop-versions-golden.json` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add lib/prep-consumption.ts tests/fixtures/counts-fake-db.ts tests/silent-read-fabrication.test.ts tests/recipe-versions-graph.test.ts
git commit -F - <<'EOF'
feat(catalog): recipes resolve per shop and as of a business date at the one graph loader (no live number moves)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6: Menu items per shop — the one rule, its one loader, the costing board and the Toast matcher

**Files:**
- Create: `lib/menu-item-shop-shared.ts`, `lib/menu-item-shop.ts`
- Modify: `lib/admin/menu-costing.ts`, `app/admin/menu-costing/page.tsx`, `lib/admin/toast-map.ts`, `tests/menu-costing-shop-scope.test.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/menu-item-shop-shared.test.ts`, `tests/menu-costing-shop-overlay.test.ts`

- [ ] **Step 1: Write the failing pure test `tests/menu-item-shop-shared.test.ts`**

```ts
/** Catalog Phase 3a — a menu item's shop overlay (pure): resolve, the gates, the patch parser, the Toast pool. */
import { describe, expect, it } from "vitest";
import {
  MENU_GLOBAL_WRITE_MIN, MENU_SHOP_WRITE_MIN, applyMenuOverlayToEntities, menuPromoteGate, menuShopWriteGate,
  parseMenuShopPatch, resolveMenuItemForShop, type MenuItemShopSettingRow,
} from "@/lib/menu-item-shop-shared";

const g = { id: "m1", name: "Italian", nameEs: "Italiano", menuPrice: 12.5 };
const s = (over: Partial<MenuItemShopSettingRow>): MenuItemShopSettingRow => ({
  id: "ms", menu_item_id: "m1", location_id: "shop", based_on_setting_id: null, price: null, sold_here: true,
  name_override: null, name_override_es: null, valid_from: "2026-10-10T00:00:00Z", valid_to: null, active: true, created_by: null, ...over,
});

describe("resolveMenuItemForShop — field by field, the global row unless the shop says otherwise", () => {
  it("no overlay: exactly the global item", () => {
    expect(resolveMenuItemForShop(g, undefined)).toEqual({ id: "m1", name: "Italian", nameEs: "Italiano", typedPrice: 12.5, soldHere: true, settingId: null, overrides: { price: false, soldHere: false, name: false } });
  });
  it("price here, off here, name here", () => {
    expect(resolveMenuItemForShop(g, s({ price: "13.50" }))).toMatchObject({ typedPrice: 13.5, name: "Italian", overrides: { price: true } });
    expect(resolveMenuItemForShop(g, s({ sold_here: false }))).toMatchObject({ soldHere: false, typedPrice: 12.5, overrides: { soldHere: true } });
    expect(resolveMenuItemForShop(g, s({ name_override: "Italian (P St)" }))).toMatchObject({ name: "Italian (P St)", nameEs: null, overrides: { name: true } });
    expect(resolveMenuItemForShop(g, s({ name_override: "Italian (P St)", name_override_es: "Italiano (P St)" })).nameEs).toBe("Italiano (P St)");
  });
});

describe("gates (spec §2)", () => {
  it("floors", () => { expect([MENU_SHOP_WRITE_MIN, MENU_GLOBAL_WRITE_MIN]).toEqual([7, 8]); });
  it("a GM writes its own shop; another shop is 404; an AGM is 403", () => {
    expect(menuShopWriteGate({ level: 7, scopeAllowed: true })).toEqual({ ok: true });
    expect(menuShopWriteGate({ level: 7, scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(menuShopWriteGate({ level: 6, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
  it("promote is MoO+", () => {
    expect(menuPromoteGate(7)).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(menuPromoteGate(8)).toEqual({ ok: true });
  });
});

describe("parseMenuShopPatch", () => {
  it("accepts a price, off here, names; trims names", () => {
    expect(parseMenuShopPatch({ price: 13.5, soldHere: true, nameOverride: " Italian (P St) ", nameOverrideEs: null }))
      .toEqual({ ok: true, patch: { price: 13.5, soldHere: true, nameOverride: "Italian (P St)", nameOverrideEs: null } });
    expect(parseMenuShopPatch({ price: null, soldHere: false })).toEqual({ ok: true, patch: { price: null, soldHere: false, nameOverride: null, nameOverrideEs: null } });
  });
  it("refuses a bad price, a non-boolean, a long name, and a patch that says nothing", () => {
    expect(parseMenuShopPatch({ price: 13.555, soldHere: true })).toEqual({ ok: false, code: "invalid_menu_price" });
    expect(parseMenuShopPatch({ price: null, soldHere: "no" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuShopPatch({ price: null, soldHere: true, nameOverride: "x".repeat(121) })).toEqual({ ok: false, code: "invalid_name" });
    expect(parseMenuShopPatch({ price: null, soldHere: true, nameOverride: "  " })).toEqual({ ok: false, code: "empty_setting" });
  });
});

describe("applyMenuOverlayToEntities — the Toast matcher pool for a shop", () => {
  const entities = [
    { kind: "menu_item" as const, id: "m1", name: "Italian", priceCents: 1250 },
    { kind: "menu_item" as const, id: "m2", name: "Pickles", priceCents: 225 },
    { kind: "item" as const, id: "i1", name: "Slaw", priceCents: null },
  ];
  it("no overlay = the global pool, unchanged", () => {
    expect(applyMenuOverlayToEntities(entities, new Map())).toEqual(entities);
  });
  it("off here leaves the pool; name and price here are what Toast is matched against", () => {
    const overlay = new Map([["m1", s({ price: 13.5, name_override: "Italian (P St)" })], ["m2", s({ id: "ms2", menu_item_id: "m2", sold_here: false })]]);
    expect(applyMenuOverlayToEntities(entities, overlay)).toEqual([
      { kind: "menu_item", id: "m1", name: "Italian (P St)", priceCents: 1350 },
      { kind: "item", id: "i1", name: "Slaw", priceCents: null },
    ]);
  });
});
```

Run: `npx vitest run tests/menu-item-shop-shared.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/menu-item-shop-shared.ts`**

```ts
/**
 * A menu item's SHOP OVERLAY — THE ONE RULE, PURE (catalog Phase 3a, migration 0263; spec §3).
 * Client-safe. The global default is the menu_items row; a shop's live menu_item_shop_settings row
 * overrides it field by field: price (null = the global price), sold here (false = off the menu
 * here), name / name_es (null = the global name). Every consumer — the costing board's shop view, the
 * Toast matcher, the menu-item page — resolves through resolveMenuItemForShop and never reads the row.
 */
import { isValidMenuPrice } from "@/lib/toast/in-store-prices-shared";
import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

/** A GM (7) sets its own shops' menu (spec §2: "menu items and prices"); MoO+ (8) any shop + promote. */
export const MENU_SHOP_WRITE_MIN = 7;
export const MENU_GLOBAL_WRITE_MIN = GLOBAL_VERSION_WRITE_MIN;
export const MENU_NAME_MAX = 120;

export interface MenuItemShopSettingRow {
  id: string;
  menu_item_id: string;
  location_id: string;
  based_on_setting_id: string | null;
  price: number | string | null;
  sold_here: boolean;
  name_override: string | null;
  name_override_es: string | null;
  valid_from: string;
  valid_to: string | null;
  active?: boolean | null;
  note?: string | null;
  created_by: string | null;
}

export interface MenuItemGlobal { id: string; name: string; nameEs: string | null; menuPrice: number | null }

export interface ResolvedMenuItem {
  id: string;
  name: string;
  /** null = no Spanish name for what this shop calls it (the UI falls back to `name`). */
  nameEs: string | null;
  /** The TYPED price here (the shop's, else the global one) — Toast prices and "same as" layer on top. */
  typedPrice: number | null;
  soldHere: boolean;
  settingId: string | null;
  overrides: { price: boolean; soldHere: boolean; name: boolean };
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function resolveMenuItemForShop(g: MenuItemGlobal, s: MenuItemShopSettingRow | null | undefined): ResolvedMenuItem {
  if (!s) {
    return { id: g.id, name: g.name, nameEs: g.nameEs, typedPrice: g.menuPrice, soldHere: true, settingId: null, overrides: { price: false, soldHere: false, name: false } };
  }
  const price = num(s.price);
  const renamed = s.name_override !== null;
  return {
    id: g.id,
    name: s.name_override ?? g.name,
    // A Spanish override wins; an English-only override has no Spanish twin (never the OLD global es name).
    nameEs: s.name_override_es ?? (renamed ? null : g.nameEs),
    typedPrice: price ?? g.menuPrice,
    soldHere: s.sold_here,
    settingId: s.id,
    overrides: { price: price !== null, soldHere: !s.sold_here, name: renamed || s.name_override_es !== null },
  };
}

export type MenuWriteRefusal = { ok: false; status: 403 | 404; code: "forbidden" | "not_found" | "global_requires_moo" };

/** A shop overlay write: GM (7)+ AND the shop (catalogShopAllowed — MoO+ any shop). Decided before I/O. */
export function menuShopWriteGate(input: { level: number; scopeAllowed: boolean }): { ok: true } | MenuWriteRefusal {
  if (input.level < MENU_SHOP_WRITE_MIN) return { ok: false, status: 403, code: "forbidden" };
  if (!input.scopeAllowed) return { ok: false, status: 404, code: "not_found" };
  return { ok: true };
}

/** Promote a shop's price / name to everyone: MoO (8)+ only. */
export function menuPromoteGate(level: number): { ok: true } | MenuWriteRefusal {
  if (level >= MENU_GLOBAL_WRITE_MIN) return { ok: true };
  return { ok: false, status: 403, code: level >= MENU_SHOP_WRITE_MIN ? "global_requires_moo" : "forbidden" };
}

export interface MenuShopPatch { price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null }

export type MenuShopPatchParse =
  | { ok: true; patch: MenuShopPatch }
  | { ok: false; code: "invalid_payload" | "invalid_menu_price" | "invalid_name" | "empty_setting" };

function nameOf(v: unknown): string | null | "bad" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return "bad";
  const t = v.trim();
  if (t === "") return null;
  return t.length > MENU_NAME_MAX ? "bad" : t;
}

/** The route's one parser. A patch that sets nothing is "back to default" — its own act (empty_setting). */
export function parseMenuShopPatch(raw: unknown): MenuShopPatchParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  const price = b.price === undefined || b.price === null ? null : b.price;
  if (price !== null && !isValidMenuPrice(price)) return { ok: false, code: "invalid_menu_price" };
  const soldHere = b.soldHere === undefined ? true : b.soldHere;
  if (typeof soldHere !== "boolean") return { ok: false, code: "invalid_payload" };
  const name = nameOf(b.nameOverride);
  const nameEs = nameOf(b.nameOverrideEs);
  if (name === "bad" || nameEs === "bad") return { ok: false, code: "invalid_name" };
  if (price === null && soldHere && name === null && nameEs === null) return { ok: false, code: "empty_setting" };
  return { ok: true, patch: { price: price as number | null, soldHere, nameOverride: name, nameOverrideEs: nameEs } };
}

/**
 * The Toast matcher pool for ONE shop (lib/admin/toast-map.ts): a menu item off the menu here leaves the
 * pool; its name and price here are what the Toast menu is matched against. Prep items pass through.
 */
export function applyMenuOverlayToEntities<E extends { kind: "menu_item" | "item"; id: string; name: string; priceCents: number | null }>(
  entities: readonly E[],
  overlay: ReadonlyMap<string, MenuItemShopSettingRow>,
): E[] {
  const out: E[] = [];
  for (const e of entities) {
    const s = e.kind === "menu_item" ? overlay.get(e.id) : undefined;
    if (!s) { out.push(e); continue; }
    if (!s.sold_here) continue;
    const price = num(s.price);
    out.push({ ...e, name: s.name_override ?? e.name, priceCents: price !== null ? Math.round(price * 100) : e.priceCents });
  }
  return out;
}
```

- [ ] **Step 3: Create the one loader `lib/menu-item-shop.ts`**

```ts
/**
 * THE MENU OVERLAY LOADER (catalog Phase 3a, 0263). SERVER-ONLY, service role. One shop's LIVE
 * overlay rows, keyed by menu item; consumers hand them to resolveMenuItemForShop and never pick a
 * row themselves. PAGED. Fails loud: a dropped read would show the global price as this shop's.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { assertScopeToken } from "@/lib/sku-versions-shared";
import type { MenuItemShopSettingRow } from "@/lib/menu-item-shop-shared";

export const MENU_SHOP_SETTING_COLUMNS =
  "id, menu_item_id, location_id, based_on_setting_id, price, sold_here, name_override, name_override_es, valid_from, valid_to, active, note, created_by";

export async function loadLiveMenuItemShopSettings(shopId: string): Promise<Map<string, MenuItemShopSettingRow>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<MenuItemShopSettingRow>(async (from, to) => {
    const { data, error } = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS)
      .eq("location_id", assertScopeToken(shopId)).eq("active", true)
      .order("id", { ascending: true }).range(from, to).returns<MenuItemShopSettingRow[]>();
    if (error) throw new Error(`loadLiveMenuItemShopSettings: ${error.message}`);
    return { data };
  });
  return new Map(rows.map((r) => [r.menu_item_id, r]));
}
```

- [ ] **Step 4: The costing board's shop view reads the overlay (`lib/admin/menu-costing.ts`)**

1. Add imports: `import { loadLiveMenuItemShopSettings } from "@/lib/menu-item-shop";` and `import { resolveMenuItemForShop, type MenuItemShopSettingRow } from "@/lib/menu-item-shop-shared";`.
2. In `export interface MenuCostingBoard {`, after 2a's `scope: string | null;` member, add:

```ts
  /** Shop view only: active menu items this shop has taken off its menu (never on the board's rows). */
  notSoldHere: Array<{ id: string; name: string; nameEs: string | null }>;
```

3. Replace the block

```ts
  const menuById = new Map((menuRes.data ?? []).map((m) => [m.id, m]));
  const inputs: MenuCostInput[] = (menuRes.data ?? []).map((m) => {
    const parent = m.price_same_as_id ? menuById.get(m.price_same_as_id) : undefined;
    const resolved = resolveMenuPrice({
      typedPrice: num(m.menu_price), toastPrices: toast.prices.get(m.id) ?? [], hasZeroPriceModifier: toast.zeroPriceModifierItems.has(m.id),
      sameAs: parent ? { typedPrice: num(parent.menu_price), toastPrices: toast.prices.get(parent.id) ?? [] } : null,
    });
    return { id: m.id, name: m.name, nameEs: m.name_es, section: m.section,
      ...resolved, cateringAvailable: m.catering_available, menuPrice: resolved.effectivePrice, typedPrice: num(m.menu_price),
      sameAsName: parent?.name ?? null, sameAsNameEs: parent?.name_es ?? null };
  });
```

with

```ts
  // CATALOG PHASE 3a (0263): a SHOP view reads each menu item THROUGH ITS SHOP OVERLAY — its price here,
  // its name here, whether it is sold here (resolveMenuItemForShop, the one rule). "All shops" (scope
  // null) reads the global rows exactly as before; with no overlay rows a shop view is identical too.
  const overlay = scope === null ? new Map<string, MenuItemShopSettingRow>() : await loadLiveMenuItemShopSettings(scope);
  const here = (m: { id: string; name: string; name_es: string | null; menu_price: number | string | null }) =>
    resolveMenuItemForShop({ id: m.id, name: m.name, nameEs: m.name_es, menuPrice: num(m.menu_price) }, overlay.get(m.id));
  const menuById = new Map((menuRes.data ?? []).map((m) => [m.id, m]));
  const notSoldHere = (menuRes.data ?? []).filter((m) => !here(m).soldHere)
    .map((m) => ({ id: m.id, name: here(m).name, nameEs: here(m).nameEs }));
  const inputs: MenuCostInput[] = (menuRes.data ?? []).filter((m) => here(m).soldHere).map((m) => {
    const parent = m.price_same_as_id ? menuById.get(m.price_same_as_id) : undefined;
    const mine = here(m);
    const parentHere = parent ? here(parent) : null;
    const resolved = resolveMenuPrice({
      typedPrice: mine.typedPrice, toastPrices: toast.prices.get(m.id) ?? [], hasZeroPriceModifier: toast.zeroPriceModifierItems.has(m.id),
      sameAs: parent && parentHere ? { typedPrice: parentHere.typedPrice, toastPrices: toast.prices.get(parent.id) ?? [] } : null,
    });
    return { id: m.id, name: mine.name, nameEs: mine.nameEs, section: m.section,
      ...resolved, cateringAvailable: m.catering_available, menuPrice: resolved.effectivePrice, typedPrice: mine.typedPrice,
      sameAsName: parentHere?.name ?? null, sameAsNameEs: parentHere?.nameEs ?? null };
  });
```

4. In the function's final `return { … }`, add `notSoldHere,` directly after 2a's `scope,`.

Toast prices stay the all-shops cache in a shop view (unchanged; open question 3).

- [ ] **Step 5: The page says what this shop does not sell (`app/admin/menu-costing/page.tsx`)**

1. In 2a's destructuring line `const { rows, totals, skuNames, itemNames, productNames, toastFetchedAt, toastUnavailable, toastNotices } = await loadMenuCostingBoard(auth, { scope });`, add `notSoldHere` after `toastNotices`.
2. Directly after 2a's `<p className="mb-4 text-sm text-co-text-muted">{scopeLabel}</p>`, insert:

```tsx
      {notSoldHere.length > 0 ? (
        <p className="mb-4 text-sm text-co-text-muted">
          {serverT(lang, "admin.menu_costing.not_sold_here", {
            n: notSoldHere.length,
            names: notSoldHere.map((m) => (lang === "es" && m.nameEs ? m.nameEs : m.name)).join(", "),
          })}
        </p>
      ) : null}
```

3. Strings — in `lib/i18n/en.json`, put a comma after the current last entry and add `"admin.menu_costing.not_sold_here": "Not sold at this shop ({n}): {names}"`; in `lib/i18n/es.json` add `"admin.menu_costing.not_sold_here": "No se vende en esta tienda ({n}): {names}"`.

- [ ] **Step 6: The Toast matcher reads the shop's overlay (`lib/admin/toast-map.ts`)**

1. Add imports: `import { loadLiveMenuItemShopSettings } from "@/lib/menu-item-shop";` and `import { applyMenuOverlayToEntities } from "@/lib/menu-item-shop-shared";`.
2. Replace `async function loadEntities(all = false): Promise<CoEntity[]> {` with `async function loadEntities(all = false, locationId: string | null = null): Promise<CoEntity[]> {`.
3. In that function, replace

```ts
  return [
    ...(subs ?? []).map((r): CoEntity => ({ kind: "menu_item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
    ...(items ?? []).map((r): CoEntity => ({ kind: "item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
  ];
}
```

with

```ts
  const entities: CoEntity[] = [
    ...(subs ?? []).map((r): CoEntity => ({ kind: "menu_item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
    ...(items ?? []).map((r): CoEntity => ({ kind: "item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
  ];
  // CATALOG PHASE 3a (0263): a SHOP's matcher pool reads each menu item through its shop overlay — off
  // the menu here = out of the pool; its name and price here are what Toast is matched against.
  if (locationId === null) return entities;
  return applyMenuOverlayToEntities(entities, await loadLiveMenuItemShopSettings(locationId));
}
```

4. Replace BOTH occurrences (in `runAutoMatch` and in `driftReport`) of `  const [rows, entities] = await Promise.all([loadActiveRows(locationId), loadEntities()]);` with `  const [rows, entities] = await Promise.all([loadActiveRows(locationId), loadEntities(false, locationId)]);`.
5. In `runAutoMatch`, replace `    const allEntities = await loadEntities(true);` with `    const allEntities = await loadEntities(true, locationId);`.

`loadToastMapState` and `listMappableEntities` keep the global pool (they serve every shop's picker).

- [ ] **Step 7: Keep 2a's board test isolated from the new loader**

In `tests/menu-costing-shop-scope.test.ts`, after its `vi.mock("@/lib/admin/cost", …)` block, add:

```ts
vi.mock("@/lib/menu-item-shop", () => ({ loadLiveMenuItemShopSettings: async () => new Map() }));
```

- [ ] **Step 8: Write the overlay test `tests/menu-costing-shop-overlay.test.ts`**

```ts
/**
 * Catalog Phase 3a — the costing board's shop view reads the menu overlay; other shops and "All shops"
 * do not move; the Toast matcher passes the shop to its pool.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadMenuCostingBoard } from "@/lib/admin/menu-costing";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => {
  const t = buildRecipeVersionsFixture();
  const row = (id: string, menuItem: string, over: Record<string, unknown>) => ({
    id, menu_item_id: menuItem, location_id: LOC, based_on_setting_id: null, price: null, sold_here: true,
    name_override: null, name_override_es: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_by: null, ...over,
  });
  t.menu_item_shop_settings = [
    row("ms-1", "m-italian", { price: 13.5, name_override: "Italian (P St)" }),
    row("ms-2", "m-pickle-side", { sold_here: false }),
  ];
  current = createFakeDb(t);
});
afterEach(() => { current = null; });

const pick = (rows: Array<{ id: string; name: string; menuPrice: number | null; priceSource?: string | null; sameAsName?: string | null }>) =>
  Object.fromEntries(rows.map((r) => [r.id, { name: r.name, price: r.menuPrice, source: r.priceSource ?? null, sameAs: r.sameAsName ?? null }]));

describe("the board's shop view reads each menu item through its shop overlay", () => {
  it("LOC: the Italian at $13.50 under its name here; the lunch Italian inherits it; the pickle side is off the board", async () => {
    const board = await loadMenuCostingBoard(OWNER_ACTOR, { scope: LOC });
    const rows = pick(board.rows);
    expect(rows["m-italian"]).toEqual({ name: "Italian (P St)", price: 13.5, source: "typed", sameAs: null });
    expect(rows["m-italian-lunch"]).toMatchObject({ price: 13.5, source: "same_as", sameAs: "Italian (P St)" });
    expect(rows["m-pickle-side"]).toBeUndefined();
    expect(board.notSoldHere).toEqual([{ id: "m-pickle-side", name: "Pickle side", nameEs: "Pepinillos" }]);
  });
  it("OTHER and All shops do not move", async () => {
    for (const scope of [OTHER, null]) {
      const board = await loadMenuCostingBoard(OWNER_ACTOR, scope === null ? {} : { scope });
      const rows = pick(board.rows);
      expect(rows["m-italian"]).toMatchObject({ name: "Italian", price: 12.5 });
      expect(rows["m-pickle-side"]).toMatchObject({ price: 2.25 });
      expect(board.notSoldHere).toEqual([]);
    }
  });
});

describe("the Toast matcher's pool is the shop's", () => {
  it("auto-match and drift pass the shop to loadEntities; the global views do not", () => {
    const src = readFileSync("lib/admin/toast-map.ts", "utf8");
    expect(src.match(/loadEntities\(false, locationId\)/g)?.length).toBe(2);
    expect(src).toContain("await loadEntities(true, locationId);");
    expect(src).toContain("applyMenuOverlayToEntities(entities, await loadLiveMenuItemShopSettings(locationId))");
  });
});
```

- [ ] **Step 9: Run, then commit**

Run: `npx vitest run tests/menu-item-shop-shared.test.ts tests/menu-costing-shop-overlay.test.ts tests/menu-costing-shop-scope.test.ts tests/menu-prices-data.test.ts tests/recipe-versions-equivalence.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/menu-item-shop-shared.ts lib/menu-item-shop.ts lib/admin/menu-costing.ts app/admin/menu-costing/page.tsx lib/admin/toast-map.ts lib/i18n/en.json lib/i18n/es.json tests/menu-item-shop-shared.test.ts tests/menu-costing-shop-overlay.test.ts tests/menu-costing-shop-scope.test.ts
git commit -F - <<'EOF'
feat(catalog): menu items per shop — one rule, one loader; the costing board and the Toast matcher read it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6b: Every recipe-line reader resolves through the one resolver (lead decision 4, Astra 3a r1#1)

A shop that swaps mayo for pickle in its slaw must be asked for pickle, offered pickle at the production bench, allowed to record pickle → slaw, told its slaw is ready on pickle's terms, and see pickle in its par advisories — not the default's mayo. Task 5 put the resolver in `loadRecipeGraph`; this task routes the **direct** line readers through the same `loadRecipeLineOverlay`, via two loaders beside it:
- `loadResolvedRecipeInputs(scope, asOf?)` — the lines ONE scope resolves (global head = `recipe_inputs`, a shop's live version replaces its recipe's rows);
- `loadRecipeInputsAcrossScopes()` — every live line in ANY scope (the default plus every live shop version), for "is this used anywhere" answers that serve no single shop.

Yields stay global (lead decision 1: a version is the LINES only). Catering is untouched (lead decision 2): no catering file changes; its prices and setup stay global; its shop-scoped ingredient reads already pass their shop to the graph (2a), so they follow that shop's recipe through the same resolver with no code change. GM-created shop-only recipes are Phase 4 (lead decision 6).

**Routing table (the decision per consumer; "graph" = `loadRecipeGraph` / `createDatedGraphs`, which Task 5 made recipe-aware):**

| Consumer | Reads | Scope | Clock | This plan |
|---|---|---|---|---|
| Toast depletion — materialize `lib/catering/toast-sales.ts:566` (`loadRecipeGraph({ locationId, asOf })`), derive `:1010` (its context's `graphFor`), context `:822,838` (`graphFor: createDatedGraphs(…)`); **prior-day repair** (re-materialize a past business date) | graph | the sale's shop | **as of the business date** (the as-of graph / the interval cache, recipe boundaries included) | Task 5 (no consumer edit) |
| ezCater depletion `lib/ezcater/depletion.ts:77-90` (one dated builder per shop through the Toast context's `graphFor`), pass 2 `lib/ezcater/pass2.ts:52-55` (`createDatedGraphs` per shop) | graph | the order's shop | as of the business date | Task 5 |
| Production capture helpers → `lib/opening.ts:1029,1039,2149,2318`, `lib/prep.ts:987,1142,1148,1735`, `lib/yield-stats.ts:274,401,547`, `lib/batch-prep.ts:42` | graph (`versionLocationId`) | the instance's shop | now | Task 5 |
| Manual production preview `lib/prep-consumption.ts:436,489` | graph | the production's shop | now | Task 5 |
| **Production picker** `lib/production.ts:157,181` (`loadSkuToItems`) | lines | the form's shop | now | **this task** |
| **Production conversion check** `lib/production.ts:329,343` (`recordProduction`) | lines | the production's shop | now | **this task** |
| Prep demand — catering sku-demand `lib/catering/sku-demand.ts:112`, surplus `lib/catering/surplus.ts:144` | graph | `args.locationId` | now (forecast) | Task 5 (no catering edit) |
| Catering prep demand (W4a) `lib/catering/prep-demand.ts` | item definitions only, no recipe line | — | — | none |
| **Readiness** `lib/admin/readiness-load.ts:98` (`loadGraphRows` → `loadGraphReadiness`) | lines | **required scope**: the 3b recipe page passes its shop; `app/admin/recipes` and `app/admin/items` take `?location=<shop>|global` (absent = the default, labelled); the legacy builder and `lib/admin/catalog.ts:214` pass `null`; the hub rollup `countNotReady` checks the default AND every active shop and **attributes** the count per scope, each entry linking to that scope's list (lead decision (c)) | now | **this task** |
| **Par advisories** `lib/ordering.ts:286` (`loadDemandSources`, called at `:796` inside the walk) | lines | the walk's shop | now | **this task** |
| Ordering walk / counts / receiving pack math (2a) | graph / packs | their shop | now | 2a (graph now recipe-aware) |
| Costing board `lib/admin/menu-costing.ts:128` | graph + menu overlay | the selected shop; **margins use that shop's overlay price** (lead decision 3) | now | Task 6 |
| Item page connections (2b `lib/catalog/sku-item.ts`: `usingRecipes = uniqueRecipes(graph)…`, `reaching`) | graph | the page's shop | now | Task 5 (no edit); 3b's recipe page "Used in" reads its scoped graph too (3b Task 5) |
| **SKU "used in"** `lib/admin/cost.ts:168` (`loadSkuUsageMap`: SKU list, vendor page) | lines | **any scope** | now | **this task** |
| **Product ↔ item links** `lib/admin/product-item-links.ts:21` (items page) | lines | **any scope** | now | **this task** |
| **"N recipes still pin this product"** `lib/products.ts:232` (`loadPinnedRecipesByProduct`, before a retire) | lines | **any scope** | now | **this task** |
| **Resolution flips** `lib/products.ts:1023` (`recordResolutionFlipsForLocation`) | lines | that location | now | **this task** |
| `lib/report-package.ts:223` | graph | per row's shop | now | Task 5 |
| `lib/weights.ts:301`, `lib/admin/catalog.ts:183`, `lib/admin/toast-map.ts:249,602`, seeds, sim scripts | graph | global by intent (global weights, the global hub, the matcher's cost; its overlay read is Task 6) | now | none |
| Legacy builder `lib/recipes.ts:226,285,544` | `recipe_inputs` | the global default by definition — it edits it (its MoO-only line restriction ships with 3b, never 3a alone) | now | none |

**Files:**
- Create: `lib/admin/readiness-scope-shared.ts`
- Modify: `lib/recipe-versions-shared.ts` (`ResolvedRecipeInput`, `mergeResolvedInputs`, `addedLinePositions`, `recipeLineProblem`, `RecipeLineRefusal`), `lib/prep-consumption.ts` (`loadResolvedRecipeInputs`, `loadRecipeInputsAcrossScopes`), `lib/admin/readiness-load.ts`, `lib/ordering.ts`, `lib/production.ts`, `lib/products.ts`, `lib/admin/cost.ts`, `lib/admin/product-item-links.ts`, `lib/admin/catalog.ts`, `app/admin/page.tsx`, `app/admin/items/page.tsx`, `app/admin/recipes/page.tsx`, `app/admin/recipes/[id]/page.tsx`, `lib/shop-context-shared.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `tests/recipes-production-wiring.test.ts`, `tests/silent-read-fabrication.test.ts`
- Test: `tests/recipe-consumers-shop-scope.test.ts`

- [ ] **Step 1: Write the failing test `tests/recipe-consumers-shop-scope.test.ts`**

```ts
/**
 * Catalog Phase 3a — lead decision 4 (Astra 3a r1#1): every recipe-line reader answers with THE SHOP'S
 * recipe. LOC's slaw swaps mayo (s-mayo) for pickle (s-pickle); OTHER rides the default. Production's
 * picker and its conversion check, the par advisories' demand sources, readiness's line read, and the
 * any-scope "used in" all follow it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeInputsAcrossScopes, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { loadSkuToItems, recordProduction, ProductionError } from "@/lib/production";
import { loadDemandSources } from "@/lib/ordering";
import { loadGraphRows } from "@/lib/admin/readiness-load";
import { loadSkuUsageMap } from "@/lib/admin/cost";
import { attributeNotReady, itemsLandingView, readinessScopeHref } from "@/lib/admin/readiness-scope-shared";
import { readFileSync } from "node:fs";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

const SHOP_SAVE = "2026-10-01T12:00:00.000Z";
const owner = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [LOC, OTHER] } as unknown as AuthContext;

/** LOC's slaw: lettuce as before, PICKLE where the default has mayo. */
function withShopSlaw(): Record<string, Array<Record<string, unknown>>> {
  const t = buildRecipeVersionsFixture();
  t.recipe_versions!.push({
    id: "rv-slaw-loc", recipe_id: "r-slaw", location_id: LOC, based_on_version_id: "rv-r-slaw-base",
    adopted_from_version_id: null, promoted_from_version_id: null, active: true, valid_from: SHOP_SAVE, valid_to: null,
    note: null, created_at: SHOP_SAVE, created_by: null, retired_by: null,
  });
  const line = (id: string, sku: string, qty: number, order: number) => ({
    id, version_id: "rv-slaw-loc", recipe_id: "r-slaw", location_id: LOC, component_sku_id: sku, component_item_id: null,
    component_product_id: null, quantity: qty, unit: "oz", each_container_label: null, portioned: false, display_order: order,
    source_line_id: null,
  });
  t.recipe_version_lines!.push(line("rvl-loc-1", "s-lettuce", 48, 0), line("rvl-loc-2", "s-pickle", 16, 1));
  return t;
}
const skusOf = (rows: Array<{ recipe_id: string; component_sku_id: string | null }>, recipe: string) =>
  rows.filter((r) => r.recipe_id === recipe).map((r) => r.component_sku_id).sort();

describe("the one line resolver", () => {
  it("a shop's version replaces its recipe's rows; the default and other shops keep recipe_inputs", async () => {
    current = createFakeDb(withShopSlaw());
    expect(skusOf(await loadResolvedRecipeInputs(LOC), "r-slaw")).toEqual(["s-lettuce", "s-pickle"]);
    expect(skusOf(await loadResolvedRecipeInputs(OTHER), "r-slaw")).toEqual(["s-lettuce", "s-mayo"]);
    expect(skusOf(await loadResolvedRecipeInputs(null), "r-slaw")).toEqual(["s-lettuce", "s-mayo"]);
  });
  it("with no shop version every scope answers recipe_inputs exactly (same rows)", async () => {
    const t = buildRecipeVersionsFixture();
    current = createFakeDb(t);
    const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
    expect(ids(await loadResolvedRecipeInputs(LOC))).toEqual(ids(t.recipe_inputs as Array<{ id: string }>));
  });
  it("across scopes = the default's lines plus every live shop version's", async () => {
    current = createFakeDb(withShopSlaw());
    expect(skusOf(await loadRecipeInputsAcrossScopes(), "r-slaw")).toEqual(["s-lettuce", "s-lettuce", "s-mayo", "s-pickle"]);
  });
});

describe("production follows the shop's recipe", () => {
  it("the picker offers pickle → slaw at LOC and mayo → slaw at OTHER", async () => {
    current = createFakeDb(withShopSlaw());
    const atLoc = await loadSkuToItems(["s-mayo", "s-pickle"], LOC);
    expect((atLoc["s-pickle"] ?? []).map((x) => x.itemId)).toContain("i-slaw");
    expect((atLoc["s-mayo"] ?? []).map((x) => x.itemId)).not.toContain("i-slaw");
    const atOther = await loadSkuToItems(["s-mayo", "s-pickle"], OTHER);
    expect((atOther["s-mayo"] ?? []).map((x) => x.itemId)).toContain("i-slaw");
    expect((atOther["s-pickle"] ?? []).map((x) => x.itemId)).not.toContain("i-slaw");
  });
  it("the conversion check refuses what that shop's recipe does not make", async () => {
    current = createFakeDb(withShopSlaw());
    const tryRecord = async (locationId: string, inputSkuId: string) => {
      try {
        await recordProduction(owner, { locationId, inputSkuId, inputQty: 1, outputItemId: "i-slaw", outputQty: 1 });
        return "accepted";
      } catch (e) {
        if (e instanceof ProductionError) return e.code;
        throw e;
      }
    };
    expect(await tryRecord(LOC, "s-mayo")).toBe("invalid_conversion");
    expect(await tryRecord(OTHER, "s-pickle")).toBe("invalid_conversion");
  });
});

describe("par advisories and readiness follow the shop's recipe", () => {
  it("demand sources: pickle gains a recipe at LOC only; mayo loses its only one at LOC", async () => {
    current = createFakeDb(withShopSlaw());
    const skus = [{ id: "s-mayo", product_id: null }, { id: "s-pickle", product_id: null }];
    const atLoc = await loadDemandSources(getServiceRoleClient(), skus, LOC);
    const atOther = await loadDemandSources(getServiceRoleClient(), skus, OTHER);
    expect(atLoc.activeRefsBySku.get("s-pickle")).toBe((atOther.activeRefsBySku.get("s-pickle") ?? 0) + 1);
    expect(atLoc.activeRefsBySku.get("s-mayo") ?? 0).toBe(0);
    expect(atOther.activeRefsBySku.get("s-mayo")).toBe(1);
  });
  it("readiness reads the scope's lines (the default for null)", async () => {
    current = createFakeDb(withShopSlaw());
    expect(skusOf((await loadGraphRows(LOC)).inputs, "r-slaw")).toEqual(["s-lettuce", "s-pickle"]);
    expect(skusOf((await loadGraphRows(null)).inputs, "r-slaw")).toEqual(["s-lettuce", "s-mayo"]);
  });
});

describe("hub readiness is attributed per scope (lead decision (c), Astra 3a r2#5)", () => {
  it("a shop-only failure is counted once AND says which shop; the default is its own entry", () => {
    const bad = { status: "incomplete" as const, reasons: [] };
    const ok = { status: "ready" as const, reasons: [] };
    const r = attributeNotReady([
      { scope: null, scopeName: null, recipeReadiness: new Map([["r-slaw", ok], ["r-old", bad]]), itemReadiness: new Map() },
      { scope: LOC, scopeName: "P Street", recipeReadiness: new Map([["r-slaw", bad], ["r-old", bad]]), itemReadiness: new Map([["i-slaw", bad]]) },
      { scope: OTHER, scopeName: "Capitol Hill", recipeReadiness: new Map([["r-slaw", ok]]), itemReadiness: new Map() },
    ]);
    expect(r.recipes).toBe(2); // r-old and r-slaw, each counted once
    expect(r.items).toBe(1);
    expect(r.byScope).toEqual([
      { scope: null, scopeName: null, recipes: 1, items: 0 },
      { scope: LOC, scopeName: "P Street", recipes: 2, items: 1 },
    ]);
  });
  it("a shop's item warning lands on THAT shop's registry view, never the default catalog (Astra 3a r4#2)", () => {
    expect(readinessScopeHref("items", "/admin/items", LOC)).toBe(`/admin/items?view=registry&location=${LOC}`);
    expect(readinessScopeHref("recipes", "/admin/recipes", LOC)).toBe(`/admin/recipes?location=${LOC}`);
    expect(readinessScopeHref("items", "/admin/items", null)).toBe("/admin/items?view=registry&location=global");
    expect(itemsLandingView({ location: LOC })).toBe("registry");
    expect(itemsLandingView({})).toBe("catalog");
    expect(itemsLandingView({ view: "catalog", location: LOC })).toBe("catalog");
    expect(readFileSync("app/admin/items/page.tsx", "utf8")).toContain("itemsLandingView(sp)");
  });
  it("the recipes and items lists read the scope the hub links to", () => {
    for (const f of ["app/admin/recipes/page.tsx", "app/admin/items/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("loadGraphReadiness(auth, scope)");
      expect(src, f).toContain("readiness.scope.shop");
    }
    expect(readFileSync("app/admin/page.tsx", "utf8")).toContain("readiness.hub.where_shop");
  });
});

describe("'used anywhere' answers count every shop", () => {
  it("the SKU usage map lists pickle under the slaw once a shop's slaw uses it", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const before = (await loadSkuUsageMap()).get("s-pickle") ?? [];
    current = createFakeDb(withShopSlaw());
    const after = (await loadSkuUsageMap()).get("s-pickle") ?? [];
    expect(after.length).toBe(before.length + 1);
  });
});
```

Run: `npx vitest run tests/recipe-consumers-shop-scope.test.ts`
Expected: FAIL with `SyntaxError … does not provide an export named 'loadRecipeInputsAcrossScopes'` (or `loadResolvedRecipeInputs`).

- [ ] **Step 2: The pure merge in `lib/recipe-versions-shared.ts`**

Append:

```ts
/** One resolved recipe line in recipe_inputs' row shape (id = the recipe_inputs id, or the version line's id). */
export interface ResolvedRecipeInput {
  id: string;
  recipe_id: string;
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number | string;
  unit: string | null;
}

/**
 * The lines a scope resolves: every base row of a recipe with no replacement, then the replacement
 * lines of each replaced recipe (catalog Phase 3a). With no replacements this is `base` itself, in order.
 */
export function mergeResolvedInputs(
  base: readonly ResolvedRecipeInput[],
  replacements: ReadonlyMap<string, readonly RecipeVersionLineRow[]>,
): ResolvedRecipeInput[] {
  if (replacements.size === 0) return [...base];
  const out = base.filter((r) => !replacements.has(r.recipe_id));
  for (const [recipeId, lines] of replacements) {
    for (const l of lines) {
      out.push({
        id: l.id, recipe_id: recipeId, component_sku_id: l.component_sku_id, component_item_id: l.component_item_id,
        component_product_id: l.component_product_id, quantity: l.quantity, unit: l.unit,
      });
    }
  }
  return out;
}

// ── Lead decision (b): judge what a save ADDS; flag what it carries; name every refusal ─────────────

/** WHICH line was refused and WHY (1-based position in the set written; reason = the error code). */
export interface RecipeLineRefusal { position: number; name: string; reason: string }

const carriedKey = (f: RecipeLineFields) =>
  JSON.stringify([f.componentSkuId, f.componentItemId, f.componentProductId, f.quantity, f.unit?.trim() || null]);

/**
 * The 1-based positions of every line in `next` that is NOT carried unchanged from `current` (multiset match on
 * component, quantity and unit — 0262's SQL rule) — what a save ADDS or CREATES, and so what must pass the line
 * rules. A carried line stays even if it no longer would (it is flagged instead).
 */
export function addedLinePositions(current: readonly RecipeLineFields[], next: readonly RecipeLineFields[]): number[] {
  const pool = new Map<string, number>();
  for (const f of current) pool.set(carriedKey(f), (pool.get(carriedKey(f)) ?? 0) + 1);
  const out: number[] = [];
  next.forEach((f, i) => {
    const k = carriedKey(f);
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else out.push(i + 1);
  });
  return out;
}

/** Why a saved line would not pass an add today (the product rule) — a FLAG on the page, never a refusal of a carried line. */
export function recipeLineProblem(
  f: RecipeLineFields,
  ctx: { activeProductIds: ReadonlySet<string>; activeMeasureLabels: ReadonlySet<string> },
): "invalid_component_product" | "product_line_needs_measure_unit" | null {
  if (f.componentProductId === null) return null;
  if (!ctx.activeProductIds.has(f.componentProductId)) return "invalid_component_product";
  const unit = f.unit?.trim() ?? "";
  return unit !== "" && ctx.activeMeasureLabels.has(unit) ? null : "product_line_needs_measure_unit";
}
```

- [ ] **Step 3: The two loaders in `lib/prep-consumption.ts`**

Extend the Task 5 import from `@/lib/recipe-versions-shared` with `mergeResolvedInputs, type ResolvedRecipeInput`. Directly after `loadRecipeLineOverlay`, insert:

```ts
async function readAllRecipeInputs(sb: ReturnType<typeof getServiceRoleClient>, label: string): Promise<ResolvedRecipeInput[]> {
  return selectAllRows<ResolvedRecipeInput>(async (from, to) => {
    const { data, error } = await sb.from("recipe_inputs")
      .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit")
      .order("id", { ascending: true }).range(from, to).returns<ResolvedRecipeInput[]>();
    if (error) throw new Error(`${label} inputs: ${error.message}`);
    return { data };
  });
}

/**
 * THE RECIPE LINES `scope` RESOLVES, for readers that need lines but not a flattened graph (catalog
 * Phase 3a, lead decision 4): readiness, the par advisories' demand sources, production's picker and its
 * conversion check, a location's product pins. The SAME rule as the graph — loadRecipeLineOverlay
 * decides; recipe_inputs answers wherever the live global head does. scope null = the global default.
 * The whole line table is read (the graph is ~60 recipes; an id `.in()` of every SKU is the 414 cliff
 * sim P1 #6 named) and filtered in memory by the caller. Paged; fails loud.
 */
export async function loadResolvedRecipeInputs(scope: VersionScope, asOf: string | null = null): Promise<ResolvedRecipeInput[]> {
  const sb = getServiceRoleClient();
  const [base, replacements] = await Promise.all([
    readAllRecipeInputs(sb, "loadResolvedRecipeInputs"),
    loadRecipeLineOverlay(scope, asOf),
  ]);
  return mergeResolvedInputs(base, replacements);
}

/**
 * EVERY LIVE LINE IN ANY SCOPE: the global default's recipe_inputs plus every live shop version's lines
 * (catalog Phase 3a). For "is this used anywhere" answers that serve no single shop — the SKU list's
 * "used in", the items page's product links, "N recipes still pin this product" before a retire — so a
 * SKU or product only a shop's recipe uses is never reported unused. Paged, id-chunked, fails loud.
 */
export async function loadRecipeInputsAcrossScopes(): Promise<ResolvedRecipeInput[]> {
  const sb = getServiceRoleClient();
  const [base, shopVersions] = await Promise.all([
    readAllRecipeInputs(sb, "loadRecipeInputsAcrossScopes"),
    selectAllRows<{ id: string }>(async (from, to) => {
      const { data, error } = await sb.from("recipe_versions").select("id")
        .not("location_id", "is", null).eq("active", true)
        .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadRecipeInputsAcrossScopes versions: ${error.message}`);
      return { data };
    }),
  ]);
  const out = [...base];
  const ids = shopVersions.map((v) => v.id);
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...await selectAllRows<ResolvedRecipeInput>(async (from, to) => {
      const { data, error } = await sb.from("recipe_version_lines")
        .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit")
        .in("version_id", chunk).order("id", { ascending: true }).range(from, to).returns<ResolvedRecipeInput[]>();
      if (error) throw new Error(`loadRecipeInputsAcrossScopes lines: ${error.message}`);
      return { data };
    }));
  }
  return out;
}
```

In `tests/silent-read-fabrication.test.ts`, in the same batch-loader list Task 5 Step 5 extended, add:

```ts
      ["export async function loadResolvedRecipeInputs(", 'readAllRecipeInputs(sb, "loadResolvedRecipeInputs")'],
      ["async function readAllRecipeInputs(", "inputs: ${error.message}"],
      ["export async function loadRecipeInputsAcrossScopes(", "loadRecipeInputsAcrossScopes lines:"],
```

- [ ] **Step 4: Readiness (`lib/admin/readiness-load.ts`)**

1. Imports: add `import { loadResolvedRecipeInputs } from "@/lib/prep-consumption";` beside the existing `loadSkuPackChains` import (merge into one import line: `import { loadResolvedRecipeInputs, loadSkuPackChains } from "@/lib/prep-consumption";`), and `import type { VersionScope } from "@/lib/sku-versions-shared";`.
2. Replace `async function loadGraphRows(): Promise<GraphRows> {` with:

```ts
/** Exported for tests/recipe-consumers-shop-scope.test.ts. */
export async function loadGraphRows(scope: VersionScope): Promise<GraphRows> {
```

3. Replace the inputs read

```ts
    selectAllRows<GraphRows["inputs"][number]>((from, to) =>
      sb.from("recipe_inputs").select("recipe_id, component_sku_id, component_item_id, component_product_id, unit")
        .order("id", { ascending: true }).range(from, to)),
```

with

```ts
    // CATALOG PHASE 3a (lead decision 4): the lines THIS SCOPE resolves — a shop's live version replaces
    // its recipe's rows (the one resolver, lib/prep-consumption.ts); null = the global default.
    loadResolvedRecipeInputs(scope).then((rows) => rows.map((r) => ({
      recipe_id: r.recipe_id, component_sku_id: r.component_sku_id, component_item_id: r.component_item_id,
      component_product_id: r.component_product_id, unit: r.unit,
    }))),
```

4. **The SKU readiness a recipe inherits is the SHOP's too** (Astra 3a r3#4): merged `loadSkuReadinessMap(actor)` reads GLOBAL prices and packs (`loadCurrentSkuPrices(ids, null)`, `loadSkuPackChains(ids, null)`), so a SKU priced only through a shop's lane would keep a shop's recipe "not ready". Replace its signature `export async function loadSkuReadinessMap(actor: AuthContext): Promise<Map<string, Readiness>> {` with

```ts
/** Readiness per ACTIVE SKU AT `scope` (catalog Phase 3a): that shop's price lane and pack versions (2a's one
 *  resolver), else the global ones; null = the global default. Delivery history stays org-wide (a SKU delivered
 *  anywhere has been delivered). Inactive → absent from the map = no badge. */
export async function loadSkuReadinessMap(actor: AuthContext, scope: VersionScope): Promise<Map<string, Readiness>> {
```

and inside it replace `    loadCurrentSkuPrices(ids, null), loadSkuDeliveryCounts(ids), loadSkuPackChains(ids, null), loadMeasureUnits(actor),` with `    loadCurrentSkuPrices(ids, scope), loadSkuDeliveryCounts(ids), loadSkuPackChains(ids, scope), loadMeasureUnits(actor),`. Delete the now-duplicate `/** Readiness per ACTIVE SKU (inactive → absent from the map = no badge). */` line above it.

Then replace the `loadGraphReadiness` signature line `export async function loadGraphReadiness(actor: AuthContext): Promise<{` with `export async function loadGraphReadiness(actor: AuthContext, scope: VersionScope): Promise<{`, then inside it replace `    loadSkuReadinessMap(actor), loadGraphRows(), loadMeasureUnits(actor),` with `    loadSkuReadinessMap(actor, scope), loadGraphRows(scope), loadMeasureUnits(actor),`, and replace

```ts
  // PRODUCT-pinned inputs (0179). Resolution is the GLOBAL one (deviation D7 — this
  // board has no location), and a line is ready iff the product resolves to a member
```

with

```ts
  // PRODUCT-pinned inputs (0179). Resolution is the SCOPE's (catalog Phase 3a: a shop's readiness
  // resolves products as that shop does; null = the global one, deviation D7), and a line is ready iff the product resolves to a member
```

and `  const { byProduct } = await loadProductIndex(pinnedProductIds, null);` with `  const { byProduct } = await loadProductIndex(pinnedProductIds, scope);`.

5. ATTRIBUTED cross-shop counts (lead decision (c), Astra 3a r2#5). Create the pure rule `lib/admin/readiness-scope-shared.ts`:

```ts
/**
 * HUB READINESS, ATTRIBUTED (catalog Phase 3a; lead decisions 4 and (c)). A recipe or item counts as "not ready"
 * when it is not ready for the default OR for any active shop — and the count says WHERE: one entry per scope
 * with failures, so "3 not ready" reads "1 in the default · 2 at P Street" and each entry links to that scope's list.
 * Pure: the caller loads one readiness map per scope (one graph read per scope, never per recipe).
 */
import type { Readiness } from "@/lib/readiness";

export interface ScopeReadiness {
  scope: string | null;
  scopeName: string | null;
  recipeReadiness: ReadonlyMap<string, Readiness>;
  itemReadiness: ReadonlyMap<string, Readiness>;
}

export interface ReadinessByScope { scope: string | null; scopeName: string | null; recipes: number; items: number }

/**
 * WHERE a hub "N at P Street" entry links (Astra 3a r4#2): that scope's list, on the view that SHOWS that scope's
 * readiness. Items → the registry tab (the catalog tab's readiness is the default's); recipes → the list.
 */
export function readinessScopeHref(sectionId: string, href: string, scope: string | null): string {
  const location = `location=${scope ?? "global"}`;
  return sectionId === "items" ? `${href}?view=registry&${location}` : `${href}?${location}`;
}

/** The items page's first tab: the registry when asked, or when opened for a scope (a hub readiness link). */
export function itemsLandingView(params: { view?: string; location?: string }): "registry" | "catalog" {
  if (params.view === "registry") return "registry";
  if (params.view === "catalog") return "catalog";
  return params.location ? "registry" : "catalog";
}

export function attributeNotReady(perScope: readonly ScopeReadiness[]): { recipes: number; items: number; byScope: ReadinessByScope[] } {
  const bad = (m: ReadonlyMap<string, Readiness>) => [...m].filter(([, r]) => r.status !== "ready").map(([id]) => id);
  const allRecipes = new Set<string>();
  const allItems = new Set<string>();
  const byScope: ReadinessByScope[] = [];
  for (const s of perScope) {
    const r = bad(s.recipeReadiness);
    const i = bad(s.itemReadiness);
    r.forEach((id) => allRecipes.add(id));
    i.forEach((id) => allItems.add(id));
    if (r.length > 0 || i.length > 0) byScope.push({ scope: s.scope, scopeName: s.scopeName, recipes: r.length, items: i.length });
  }
  return { recipes: allRecipes.size, items: allItems.size, byScope };
}
```

Then in `lib/admin/readiness-load.ts` add `import { attributeNotReady, type ReadinessByScope } from "@/lib/admin/readiness-scope-shared";`, replace the `countNotReady` signature `export async function countNotReady(actor: AuthContext): Promise<{` + `  skus: number; recipes: number; items: number;` + `}> {` with

```ts
export async function countNotReady(actor: AuthContext): Promise<{
  skus: number; recipes: number; items: number; byScope: ReadinessByScope[];
}> {
```

and replace its body from `  const [skuMap, graph] = await Promise.all([` through `    items: countBad(graph.itemReadiness),` with:

```ts
  // CATALOG PHASE 3a: not ready for the default OR for ANY active shop (each shop's resolved recipe — lead
  // decision 4), ATTRIBUTED per scope (lead decision (c)). One graph read per scope, never per recipe.
  const { data: shops, error: shopErr } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true)
    .order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (shopErr) throw new Error(`countNotReady locations: ${shopErr.message}`);
  const scopes: Array<{ id: string | null; name: string | null }> = [{ id: null, name: null }, ...(shops ?? [])];
  const [skuMap, ...graphs] = await Promise.all([
    loadSkuReadinessMap(actor, null), ...scopes.map((s) => loadGraphReadiness(actor, s.id)),
  ]);
  const attributed = attributeNotReady(graphs.map((g, i) => ({
    scope: scopes[i]!.id, scopeName: scopes[i]!.name, recipeReadiness: g.recipeReadiness, itemReadiness: g.itemReadiness,
  })));
  const countBad = (m: Map<string, Readiness>) =>
    [...m.values()].filter((r) => r.status !== "ready").length;
  return {
    skus: countBad(skuMap),
    recipes: attributed.recipes,
    items: attributed.items,
    byScope: attributed.byScope,
```

6. **The hub says where, and each "where" opens that scope's list.** In `app/admin/page.tsx`:
- import `readinessScopeHref` and `type ReadinessByScope` from `@/lib/admin/readiness-scope-shared`; beside `let counts …` add `let byScope: ReadinessByScope[] = [];` and inside the `try` after `counts = …` add `byScope = c.byScope;`.
- In the section-card map, wrap the `<a key={s.id} href={s.href} …>…</a>` branch in `<div key={s.id} className="flex flex-col gap-1">` (move the `key` to the div) and, after the `</a>`, add:

```tsx
              {(s.id === "recipes" || s.id === "items") && (counts[s.id] ?? 0) > 0 && byScope.length > 0 ? (
                <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-sm" aria-label={serverT(lang, "readiness.hub.where")}>
                  {byScope.filter((b) => (s.id === "recipes" ? b.recipes : b.items) > 0).map((b) => (
                    <li key={b.scope ?? "global"}>
                      <a href={readinessScopeHref(s.id, s.href, b.scope)}
                        className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">
                        {b.scope === null
                          ? serverT(lang, "readiness.hub.where_default", { count: s.id === "recipes" ? b.recipes : b.items })
                          : serverT(lang, "readiness.hub.where_shop", { shop: b.scopeName ?? "", count: s.id === "recipes" ? b.recipes : b.items })}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
```

7. **The lists read the scope they were opened for.** `app/admin/recipes/page.tsx` and `app/admin/items/page.tsx` take `?location=<shop>|global` (absent = the default, as today):
- `app/admin/recipes/page.tsx`: change the signature to `export default async function AdminRecipesPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {`; after `const lang = …` add

```ts
  // ?location=<shop> shows THAT shop's readiness (its resolved recipes — lead decisions 4 and (c)); the hub's
  // attributed counts link here. Absent or "global" = the default, labelled.
  const { location } = await searchParams;
  const shops = await loadActiveShopsForReadiness();
  const scope = location && location !== "global" && shops.some((s) => s.id === location) ? location : null;
  const scopeName = scope ? shops.find((s) => s.id === scope)?.name ?? null : null;
```

replace `loadGraphReadiness(auth)` with `loadGraphReadiness(auth, scope)`, and directly under the `<PageHeader … />` add

```tsx
      <p className="mt-2 text-sm text-co-text-muted">
        {scope === null ? serverT(lang, "readiness.scope.default") : serverT(lang, "readiness.scope.shop", { shop: scopeName ?? "" })}
        {scope !== null ? <> · <a href="/admin/recipes" className="font-bold text-co-text underline">{serverT(lang, "readiness.scope.show_default")}</a></> : null}
      </p>
```

- `app/admin/items/page.tsx`: the same, with its searchParams type widened to `Promise<{ view?: string; location?: string }>`, reading `location` from the same `await searchParams` object, and the link `href="/admin/items?view=registry"`. **It lands where the shop's readiness is shown** (Astra 3a r4#2): replace `  const initialView = (await searchParams).view === "registry" ? "registry" : "catalog";` with `  const sp = await searchParams;` + `  const initialView = itemsLandingView(sp);` (and read `location` from `sp`), importing `itemsLandingView` from `@/lib/admin/readiness-scope-shared` — a shop-scoped link opens the REGISTRY tab, the one that reads the scoped readiness; the catalog tab's readiness stays the default's (`loadCatalogView`, global by intent), so a shop link never lands on it.
- `loadActiveShopsForReadiness()` is exported from `lib/admin/readiness-load.ts`: `export async function loadActiveShopsForReadiness(): Promise<Array<{ id: string; name: string }>> { const { data, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>(); if (error) throw new Error(`readiness shops: ${error.message}`); return data ?? []; }` (both pages import it with `loadGraphReadiness`).
- In `lib/shop-context-shared.ts` `SHOP_PARAMS_BY_PATH`, add `  "/admin/recipes": ["location"], // catalog Phase 3a — readiness at a shop (the hub's attributed counts)` and `  "/admin/items": ["location"],`.
- i18n, en (`lib/i18n/en.json`): `"readiness.hub.where": "Where"`, `"readiness.hub.where_default": "{count} in the default"`, `"readiness.hub.where_shop": "{count} at {shop}"`, `"readiness.scope.default": "Readiness for the global default."`, `"readiness.scope.shop": "Readiness at {shop} (its own recipes)."`, `"readiness.scope.show_default": "Show the default"`; es (`lib/i18n/es.json`, tú): `"readiness.hub.where": "Dónde"`, `"readiness.hub.where_default": "{count} en el predeterminado"`, `"readiness.hub.where_shop": "{count} en {shop}"`, `"readiness.scope.default": "Listo para el predeterminado global."`, `"readiness.scope.shop": "Listo en {shop} (sus propias recetas)."`, `"readiness.scope.show_default": "Ver el predeterminado"`.

8. The global pages pass the default explicitly (the compiler lists them, since `scope` is required):

6. The global pages pass the default explicitly (the compiler lists them, since `scope` is required):
- `lib/admin/catalog.ts:214`: `(await loadGraphReadiness(actor)).itemReadiness` → `(await loadGraphReadiness(actor, null)).itemReadiness`
- `app/admin/recipes/[id]/page.tsx:64`: `loadGraphReadiness(auth)` → `loadGraphReadiness(auth, null)` — the legacy builder edits the global default, so its readiness is the default's.
- `app/admin/items/page.tsx:40` and `app/admin/recipes/page.tsx:35`: `loadGraphReadiness(auth)` → `loadGraphReadiness(auth, scope)` (item 7).

9. **Test: a shop's readiness uses the SHOP's SKU readiness** (Astra 3a r3#4) — create `tests/readiness-shop-scope.test.ts`:

```ts
/**
 * Catalog Phase 3a — SKU readiness is resolved per scope through 2a's resolver: a SKU priced ONLY in a shop's lane
 * is priced at that shop and unpriced in the default. The SKU list and the pack predicate are stubbed (this test is
 * about which prices and packs are asked for, at which scope); prices answer per scope like 2a's lane resolver.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC } from "./fixtures/recipe-versions-fixture";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
const askedScopes: Array<string | null> = [];
vi.mock("@/lib/admin/skus", () => ({
  loadSkus: async () => [{ id: "s-turkey", active: true, skuClass: null }],
  loadMeasureUnits: async () => [],
}));
vi.mock("@/lib/readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/readiness")>()),
  skuPackComplete: () => true,
}));
vi.mock("@/lib/admin/cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/cost")>()),
  loadCurrentSkuPrices: async (_ids: string[], scope: string | null) => {
    askedScopes.push(scope);
    return scope === LOC ? new Map([["s-turkey", 80]]) : new Map<string, number>();
  },
}));
afterEach(() => { current = null; askedScopes.length = 0; });

const owner = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;

describe("SKU readiness per scope", () => {
  it("a shop-lane-only price is a price at that shop and missing in the default", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const { loadSkuReadinessMap } = await import("@/lib/admin/readiness-load");
    const global = JSON.stringify(await loadSkuReadinessMap(owner, null).then((m) => m.get("s-turkey") ?? null));
    const shop = JSON.stringify(await loadSkuReadinessMap(owner, LOC).then((m) => m.get("s-turkey") ?? null));
    expect(askedScopes).toEqual([null, LOC]);
    expect(global).toContain("missing_price");
    expect(shop).not.toContain("missing_price");
  });
});
```

Run: `npx vitest run tests/readiness-shop-scope.test.ts` → PASS after item 4.

- [ ] **Step 5: Par advisories (`lib/ordering.ts`)**

1. Add `loadResolvedRecipeInputs` to the existing `@/lib/prep-consumption` import.
2. Replace

```ts
async function loadDemandSources(
  sb: ReturnType<typeof getServiceRoleClient>,
  skus: ReadonlyArray<{ id: string; product_id: string | null }>,
): Promise<DemandSources> {
```

with

```ts
/** Exported for tests/recipe-consumers-shop-scope.test.ts. */
export async function loadDemandSources(
  sb: ReturnType<typeof getServiceRoleClient>,
  skus: ReadonlyArray<{ id: string; product_id: string | null }>,
  locationId: string,
): Promise<DemandSources> {
```

3. Replace the `inputs` element of its `Promise.all`:

```ts
    selectAllRows<{ recipe_id: string; component_sku_id: string | null; component_product_id: string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("recipe_inputs")
          .select("recipe_id, component_sku_id, component_product_id")
          .order("id", { ascending: true }).range(from, to)
          .returns<Array<{ recipe_id: string; component_sku_id: string | null; component_product_id: string | null }>>();
        if (error) throw new Error(`loadDemandSources inputs: ${error.message}`);
        return { data };
      },
    ),
```

with

```ts
    // CATALOG PHASE 3a (lead decision 4): THIS SHOP's recipe lines — a shop that swapped mayo for pickle
    // is told pickle has a recipe and mayo lost its source, not the default's story.
    loadResolvedRecipeInputs(locationId),
```

4. At the call site (`:796`), replace `      loadDemandSources(sb, skus),` with `      loadDemandSources(sb, skus, locationId),`.

- [ ] **Step 6: Production (`lib/production.ts`)**

1. Add `import { loadResolvedRecipeInputs } from "@/lib/prep-consumption";` after the `@/lib/production-shared` import.
2. Replace `async function loadSkuToItems(skuIds: string[]): Promise<Record<string, Array<{ itemId: string; name: string }>>> {` with:

```ts
/** Exported for tests/recipe-consumers-shop-scope.test.ts. */
export async function loadSkuToItems(skuIds: string[], locationId: string): Promise<Record<string, Array<{ itemId: string; name: string }>>> {
```

3. In `loadSkuToItems`, replace

```ts
  const sb = getServiceRoleClient();
  // Recipe inputs that consume one of these SKUs.
  const { data: ins, error: insErr } = await sb.from("recipe_inputs").select("recipe_id, component_sku_id").in("component_sku_id", skuIds).not("component_sku_id", "is", null)
    .returns<Array<{ recipe_id: string; component_sku_id: string }>>();
  // Every read in this chain narrows the SKU→output-item map, and the failure mode is one
  // direction only: FEWER options in the prep-capture dropdown. The operator cannot record
  // a prep they actually did, production capture stays dark, and depletion goes with it —
  // all of it looking like "this SKU just isn't used in a recipe".
  if (insErr) throw new Error(`loadSkuToItems recipe_inputs: ${insErr.message}`);
```

with

```ts
  const sb = getServiceRoleClient();
  // CATALOG PHASE 3a (lead decision 4): THIS SHOP's recipe lines (the one resolver) — a shop whose slaw
  // uses pickle is offered pickle → slaw here. Every read in this chain narrows the SKU→output-item map,
  // and the failure mode is one direction only: FEWER options in the prep-capture dropdown. The operator
  // cannot record a prep they actually did — so the resolver throws rather than return a partial set.
  const resolved = await loadResolvedRecipeInputs(locationId);
  const wanted = new Set(skuIds);
  const ins = resolved
    .filter((i): i is typeof i & { component_sku_id: string } => i.component_sku_id != null && wanted.has(i.component_sku_id))
    .map((i) => ({ recipe_id: i.recipe_id, component_sku_id: i.component_sku_id }));
```

4. Replace

```ts
  if (productIds.length > 0) {
    const { data: pins, error: pinErr } = await sb.from("recipe_inputs").select("recipe_id, component_product_id")
      .in("component_product_id", productIds)
      .returns<Array<{ recipe_id: string; component_product_id: string }>>();
    if (pinErr) throw new Error(`loadSkuToItems product pins: ${pinErr.message}`);
    for (const p of pins ?? []) {
      for (const skuId of membersByProduct.get(p.component_product_id) ?? []) {
```

with

```ts
  if (productIds.length > 0) {
    const pinned = new Set(productIds);
    for (const p of resolved) {
      if (p.component_product_id == null || !pinned.has(p.component_product_id)) continue;
      for (const skuId of membersByProduct.get(p.component_product_id) ?? []) {
```

and `  const allIns = [...(ins ?? []), ...productIns];` with `  const allIns = [...ins, ...productIns];`.

5. In `loadProductionFormData`, replace `    loadSkuToItems(ids),` with `    loadSkuToItems(ids, locationId),`.
6. In `recordProduction`, replace

```ts
  const { data: inRows } = await sb.from("recipe_inputs").select("recipe_id").eq("component_sku_id", input.inputSkuId)
    .returns<Array<{ recipe_id: string }>>();
```

with

```ts
  // CATALOG PHASE 3a (lead decision 4): the conversion is checked against THIS SHOP's resolved recipe — the
  // same lines its dropdown was built from (loadSkuToItems), so an offered conversion is never refused and a
  // conversion only the default makes is refused here.
  const resolvedLines = await loadResolvedRecipeInputs(input.locationId);
  const inRows = resolvedLines.filter((r) => r.component_sku_id === input.inputSkuId).map((r) => ({ recipe_id: r.recipe_id }));
```

then replace

```ts
    const { data: pinRows } = await sb.from("recipe_inputs").select("recipe_id").eq("component_product_id", sku.product_id)
      .returns<Array<{ recipe_id: string }>>();
    productRecipeIds = (pinRows ?? []).map((r) => r.recipe_id);
```

with

```ts
    productRecipeIds = resolvedLines.filter((r) => r.component_product_id === sku.product_id).map((r) => r.recipe_id);
```

and `  const skuPinnedRecipeIds = new Set((inRows ?? []).map((r) => r.recipe_id));` with `  const skuPinnedRecipeIds = new Set(inRows.map((r) => r.recipe_id));`.

7. Update the source pins that named the old reads:
- `tests/recipes-production-wiring.test.ts`: in "the dropdown drops a retired product's pins BEFORE the pins are read", replace `    expect(body.indexOf("retiredProductIds")).toBeLessThan(body.indexOf('.in("component_product_id"'));` with `    expect(body.indexOf("retiredProductIds")).toBeLessThan(body.indexOf("const pinned = new Set(productIds);"));`. In "the SKU-pin pass is untouched", replace `    expect(load).toContain('.in("component_sku_id", skuIds)');` with `    expect(load).toContain("wanted.has(i.component_sku_id)");` and `    expect(fnBody(src, "recordProduction")).toContain('.eq("component_sku_id", input.inputSkuId)');` with `    expect(fnBody(src, "recordProduction")).toContain("r.component_sku_id === input.inputSkuId");`.
- `tests/silent-read-fabrication.test.ts`: in "loadSkuToItems binds error on every read in its six-query chain", replace `    expect(body).toContain("loadSkuToItems recipe_inputs:");` with `    expect(body).toContain("await loadResolvedRecipeInputs(locationId)"); // the resolver throws on its own reads`.

- [ ] **Step 7: The "used anywhere" readers and a location's pins (`lib/admin/cost.ts`, `lib/admin/product-item-links.ts`, `lib/products.ts`)**

1. `lib/admin/cost.ts` — add `import { loadRecipeInputsAcrossScopes } from "@/lib/prep-consumption";` (merge into the existing `@/lib/prep-consumption` import if the file has one). In `loadSkuUsageMap`, replace

```ts
  const { data: ins, error: e1 } = await sb.from("recipe_inputs").select("recipe_id, component_sku_id, component_item_id, component_product_id")
    .returns<Array<{ recipe_id: string; component_sku_id: string | null; component_item_id: string | null; component_product_id: string | null }>>();
  if (e1) throw new Error(`loadSkuUsageMap inputs: ${e1.message}`);
```

with

```ts
  // CATALOG PHASE 3a: "used in" counts EVERY scope — a SKU only one shop's recipe uses is not unused.
  const ins = await loadRecipeInputsAcrossScopes();
```

(the later `(ins ?? [])` reads stay valid; `ins` is never null now).

2. `lib/admin/product-item-links.ts` — add `import { loadRecipeInputsAcrossScopes } from "@/lib/prep-consumption";`, and replace

```ts
    selectAllRows<LinkInput>((from, to) => sb.from("recipe_inputs")
      .select("recipe_id, component_product_id, component_sku_id, component_item_id").order("id").range(from, to)),
```

with

```ts
    // CATALOG PHASE 3a: a product feeds an item if ANY scope's recipe says so (the default or a shop's version).
    loadRecipeInputsAcrossScopes().then((rows) => rows.map((r): LinkInput => ({
      recipe_id: r.recipe_id, component_product_id: r.component_product_id,
      component_sku_id: r.component_sku_id, component_item_id: r.component_item_id,
    }))),
```

3. `lib/products.ts` — add `loadRecipeInputsAcrossScopes, loadResolvedRecipeInputs` to its `@/lib/prep-consumption` import (create the import if absent). In `loadPinnedRecipesByProduct`, replace

```ts
  const pins = await selectAllRows<{ recipe_id: string; component_product_id: string | null }>(
    async (from, to) => {
      const { data, error } = await sb
        .from("recipe_inputs")
        .select("recipe_id, component_product_id")
        .in("component_product_id", productIds)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ recipe_id: string; component_product_id: string | null }>>();
      if (error) throw new Error(`loadPinnedRecipesByProduct pins: ${error.message}`);
      return { data };
    },
  );
```

with

```ts
  // CATALOG PHASE 3a: a pin in ANY scope — the default or a shop's live version — still pins the product,
  // and retiring it would orphan that shop's line just the same.
  const wanted = new Set(productIds);
  const pins = (await loadRecipeInputsAcrossScopes())
    .filter((p) => p.component_product_id != null && wanted.has(p.component_product_id))
    .map((p) => ({ recipe_id: p.recipe_id, component_product_id: p.component_product_id }));
```

In `recordResolutionFlipsForLocation`, replace

```ts
    const { data, error } = await sb
      .from("recipe_inputs")
      .select("component_product_id")
      .not("component_product_id", "is", null)
      .returns<Array<{ component_product_id: string | null }>>();
    if (error) {
      console.error("[products] recordResolutionFlipsForLocation pins lookup failed:", error.message);
      return;
    }
    const productIds = [...new Set((data ?? []).map((r) => r.component_product_id).filter((v): v is string => v != null))];
```

with

```ts
    // CATALOG PHASE 3a: the pins THIS location's recipes resolve to (a shop version may pin a product the
    // default does not). The resolver throws; the surrounding try keeps this forensic read fail-open.
    const data = await loadResolvedRecipeInputs(locationId);
    const productIds = [...new Set(data.map((r) => r.component_product_id).filter((v): v is string => v != null))];
```

and delete the now-unused `    const sb = getServiceRoleClient();` line at the top of that `try` (lint flags it).

- [ ] **Step 8: Run, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/recipe-consumers-shop-scope.test.ts tests/recipes-production-wiring.test.ts tests/silent-read-fabrication.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts`
Expected: PASS, 0 failed; both goldens unchanged (`git diff --stat tests/fixtures/*-golden.json` prints nothing).

```bash
git add lib/recipe-versions-shared.ts lib/prep-consumption.ts lib/admin/readiness-load.ts lib/admin/readiness-scope-shared.ts lib/ordering.ts lib/production.ts lib/products.ts lib/admin/cost.ts lib/admin/product-item-links.ts lib/admin/catalog.ts app/admin/page.tsx app/admin/items/page.tsx app/admin/recipes/page.tsx "app/admin/recipes/[id]/page.tsx" lib/shop-context-shared.ts lib/i18n/en.json lib/i18n/es.json tests/recipe-consumers-shop-scope.test.ts tests/readiness-shop-scope.test.ts tests/recipes-production-wiring.test.ts tests/silent-read-fabrication.test.ts
git commit -F - <<'EOF'
feat(catalog): every recipe-line reader resolves the shop's recipe — production, readiness, par advisories, pins, "used in"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 7: The gated recipe writers (`lib/admin/recipe-versions.ts`) + the audit vocabulary

**Files:**
- Create: `lib/admin/recipe-versions.ts`
- Modify: `lib/recipes.ts` (export `assertInputLineIsValid`), `lib/destructive-actions.ts`, `tests/location-bind-differential.test.ts`
- Test: `tests/recipe-versions-permissions.test.ts`

- [ ] **Step 1: Write the failing permission test**

```ts
/**
 * Catalog Phase 3a — the recipe-version write gates hold INSIDE the lib, before any I/O (spec §2, §8:
 * the lib bind holds even when the route is bypassed). With no database installed, a call that got past
 * the gates fails with a plain Error ("no fake db installed"); with the fixture installed, one that got
 * all the way to the RPC fails because the stand-in has no rpc() — both prove the gates passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import {
  loadRecipeVersionHistory, RecipeVersionError, restoreRecipeVersion, retireShopRecipeVersion, saveRecipeLines,
} from "@/lib/admin/recipe-versions";
import { addedLinePositions } from "@/lib/recipe-versions-shared";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const sku = (id: string, qty: number, unit: string): RecipeLineFields =>
  ({ componentSkuId: id, componentItemId: null, componentProductId: null, quantity: qty, unit, eachContainerLabel: null, portioned: false });
const ADD = { kind: "add" as const, line: sku("s-cheese", 1, "oz") };
/** A stand-in dependency snapshot: the stand-in database has no rpc(), so the friendly-refusal tests hand one in. */
const SNAP = { test: true };

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof RecipeVersionError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("GM writes only its own shops; MoO any shop and the global default", () => {
  it("a GM of LOC cannot write OTHER's version (404, before any I/O)", async () => {
    expect(await refused(saveRecipeLines(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: OTHER, expectedVersionId: null, basedOnVersionId: null, op: ADD })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("an AGM cannot write any recipe version; a GM never edits the global recipe", async () => {
    expect(await refused(saveRecipeLines(actor("agm", 6, [LOC]), { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: null, op: ADD })))
      .toEqual({ status: 403, code: "forbidden" });
    expect(await refused(saveRecipeLines(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: null, expectedVersionId: null, basedOnVersionId: null, op: ADD })))
      .toEqual({ status: 403, code: "global_requires_moo" });
  });
  it("back to default and restore bind the shop too", async () => {
    expect(await refused(retireShopRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", versionId: "v", locationId: OTHER })))
      .toEqual({ status: 404, code: "not_found" });
    expect(await refused(restoreRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: null, fromVersionId: "v", expectedVersionId: null, basedOnVersionId: null })))
      .toEqual({ status: 403, code: "global_requires_moo" });
  });
  it("an UNASSIGNED MoO passes the gate for OTHER — it reaches the RPC (which the stand-in lacks)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const p = saveRecipeLines(actor("moo", 8, []), { recipeId: "r-slaw", scope: OTHER, expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base", op: ADD });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(RecipeVersionError);
  });
});

describe("the friendly refusals come after the bind, from the set the person saw", () => {
  it("a stale version, a forked default that moved, a stale line, the last line", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const gm = actor("gm", 7, [LOC]);
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-slaw", scope: LOC, expectedVersionId: "sv-x", basedOnVersionId: null, op: ADD, snapshot: SNAP })))
      .toEqual({ status: 409, code: "version_changed" });
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: "not-the-head", op: ADD, snapshot: SNAP })))
      .toEqual({ status: 409, code: "version_changed" });
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base",
      op: { kind: "update", lineId: "ri-01", line: sku("s-lettuce", 50, "oz"), expected: sku("s-lettuce", 47, "oz") }, snapshot: SNAP })))
      .toEqual({ status: 409, code: "line_changed" });
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-pickle", scope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-pickle-base",
      op: { kind: "remove", lineId: "ri-09", expected: sku("s-pickle", 1, "jar") }, snapshot: SNAP })))
      .toEqual({ status: 400, code: "empty_recipe" });
  });
  it("restore refuses another shop's version as a source", async () => {
    const t = buildRecipeVersionsFixture();
    t.recipe_versions!.push({ id: "ov", recipe_id: "r-slaw", location_id: OTHER, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-10T00:00:00Z", created_by: null, retired_by: null });
    current = createFakeDb(t);
    expect(await refused(restoreRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: LOC, fromVersionId: "ov", expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base", snapshot: SNAP })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("a restore whose source holds a product line in a pack word is refused like an edit (Astra 3a r1#5)", async () => {
    const t = buildRecipeVersionsFixture();
    t.recipe_versions!.push({ id: "old-ham", recipe_id: "r-italian", location_id: null, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: false, valid_from: "2000-01-01T00:00:00Z", valid_to: "2000-01-01T00:00:00Z", note: null,
      created_at: "2000-01-01T00:00:00Z", created_by: null, retired_by: null });
    t.recipe_version_lines!.push({ id: "old-ham-1", version_id: "old-ham", recipe_id: "r-italian", location_id: null, component_sku_id: null,
      component_item_id: null, component_product_id: "p-ham", quantity: 1, unit: "case", each_container_label: null, portioned: false,
      display_order: 0, source_line_id: null });
    current = createFakeDb(t);
    expect(await refused(restoreRecipeVersion(actor("moo", 8, []), { recipeId: "r-italian", scope: null, fromVersionId: "old-ham",
      expectedVersionId: "rv-r-italian-base", basedOnVersionId: null, snapshot: SNAP })))
      .toEqual({ status: 400, code: "product_line_needs_measure_unit" });
  });
  it("two broken lines: fixing ONE still saves — the other is carried, not re-judged (lead decision (b))", async () => {
    const t = buildRecipeVersionsFixture();
    for (const p of t.products!) if (p.id === "p-ham" || p.id === "p-bread") p.active = false; // ri-05 and ri-06 now broken
    current = createFakeDb(t);
    const p = saveRecipeLines(actor("moo", 8, []), { recipeId: "r-italian", scope: null, expectedVersionId: "rv-r-italian-base", basedOnVersionId: null,
      op: { kind: "update", lineId: "ri-05", line: sku("s-cheese", 3, "oz"), expected: { componentSkuId: null, componentItemId: null,
        componentProductId: "p-ham", quantity: 3, unit: "oz", eachContainerLabel: null, portioned: false } }, snapshot: SNAP });
    // past validation (ri-06 is carried) → the writer's RPC, which the stand-in lacks
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(RecipeVersionError);
  });
  it("ADDING a broken line is refused and the refusal names it: position, name, reason", async () => {
    const t = buildRecipeVersionsFixture();
    for (const p of t.products!) if (p.id === "p-ham") p.active = false;
    current = createFakeDb(t);
    const err = await saveRecipeLines(actor("moo", 8, []), { recipeId: "r-italian", scope: null, expectedVersionId: "rv-r-italian-base", basedOnVersionId: null,
      op: { kind: "add", line: { componentSkuId: null, componentItemId: null, componentProductId: "p-ham", quantity: 2, unit: "oz", eachContainerLabel: null, portioned: false } },
      snapshot: SNAP }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RecipeVersionError);
    const e = err as RecipeVersionError;
    expect(e.code).toBe("invalid_component_product");
    expect(e.line).toMatchObject({ position: 7, reason: "invalid_component_product" }); // r-italian has six lines
    expect(e.line!.name.length).toBeGreaterThan(0);
  });
  it("a COPIED broken line is an addition even when an identical one is already here (Astra 3a r3#3)", async () => {
    const t = buildRecipeVersionsFixture();
    for (const p of t.products!) if (p.id === "p-ham") p.active = false; // ri-05 (ham 3 oz) is broken AND already in the default
    t.recipe_versions!.push({ id: "old-it", recipe_id: "r-italian", location_id: null, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: false, valid_from: "2000-01-01T00:00:00Z", valid_to: "2000-01-01T00:00:00Z", note: null,
      created_at: "2000-01-01T00:00:00Z", created_by: null, retired_by: null });
    for (const l of t.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
      t.recipe_version_lines!.push({ ...l, id: `old-${String(l.id)}`, version_id: "old-it" }); // an identical copy, ham included
    }
    current = createFakeDb(t);
    const err = await restoreRecipeVersion(actor("moo", 8, []), { recipeId: "r-italian", scope: null, fromVersionId: "old-it",
      expectedVersionId: "rv-r-italian-base", basedOnVersionId: null, snapshot: SNAP }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RecipeVersionError);
    // without the copy rule this restore would have passed: every line is identical to the live default's
    expect((err as RecipeVersionError).line?.position).toBeGreaterThan(0);
    expect(["invalid_component_product", "product_line_needs_measure_unit"]).toContain((err as RecipeVersionError).line?.reason);
  });
  it("addedLinePositions: only what the save adds or changes is judged", () => {
    const a = sku("s-a", 1, "oz"), b = sku("s-b", 2, "oz");
    expect(addedLinePositions([a, b], [a, b])).toEqual([]);
    expect(addedLinePositions([a, b], [b, { ...a, quantity: 5 }])).toEqual([2]);
    expect(addedLinePositions([a], [a, a])).toEqual([2]); // a duplicate of a carried line is an addition
  });
  it("history pages past the 1000-row cap: 60 versions × 20 lines all come back (Astra 3a r1#6)", async () => {
    const t = buildRecipeVersionsFixture();
    for (let v = 0; v < 60; v++) {
      const id = `hist-${String(v).padStart(2, "0")}`;
      t.recipe_versions!.push({ id, recipe_id: "r-slaw", location_id: LOC, based_on_version_id: null, adopted_from_version_id: null,
        promoted_from_version_id: null, active: false, valid_from: `2026-0${1 + (v % 9)}-01T00:00:00Z`, valid_to: "2026-10-01T00:00:00Z",
        note: null, created_at: "2026-01-01T00:00:00Z", created_by: null, retired_by: null });
      for (let l = 0; l < 20; l++) {
        t.recipe_version_lines!.push({ id: `${id}-l${String(l).padStart(2, "0")}`, version_id: id, recipe_id: "r-slaw", location_id: LOC,
          component_sku_id: "s-lettuce", component_item_id: null, component_product_id: null, quantity: l + 1, unit: "oz",
          each_container_label: null, portioned: false, display_order: l, source_line_id: null });
      }
    }
    current = createFakeDb(t);
    const rows = await loadRecipeVersionHistory(actor("gm", 7, [LOC]), "r-slaw", LOC);
    const hist = rows.filter((r) => r.id.startsWith("hist-"));
    expect(hist).toHaveLength(60);
    expect(hist.every((r) => r.lines.length === 20)).toBe(true);
  });
  it("an unchanged edit writes nothing (no RPC, no error)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const r = await saveRecipeLines(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base",
      op: { kind: "update", lineId: "ri-01", line: sku("s-lettuce", 48, "oz"), expected: sku("s-lettuce", 48, "oz") }, snapshot: SNAP });
    expect(r).toEqual({ versionId: null, retiredVersionId: null, changed: false });
  });
});
```

Run: `npx vitest run tests/recipe-versions-permissions.test.ts` → FAIL (module not found).

- [ ] **Step 2: Export the line validator from `lib/recipes.ts`**

Replace `async function assertInputLineIsValid(` with `export async function assertInputLineIsValid(`. Nothing else changes: the shop-version writer runs the SAME validator as Phase 1's add and edit, so a version can never hold a line a global edit would refuse.

- [ ] **Step 3: Register the audit vocabulary**

In `lib/destructive-actions.ts`, directly after `  "recipe_output.update",`, insert:

```ts
  // ── Shop versions of recipes (catalog Phase 3, 0262) ──────────────────────
  // — recipe_version.save: a human saves a recipe's LINE SET for a shop or the global default (an
  //   edit or a Restore; which one rides in metadata). The same "who changed the kitchen?" act as
  //   recipe_input.update, scoped.
  "recipe_version.save",
  // — recipe_version.retire: a shop goes back to the default recipe.
  "recipe_version.retire",
  // — recipe_version.adopt: a shop copies another shop's version as-is (3b's first caller; registered
  //   here so the writer that names it compiles on its own).
  "recipe_version.adopt",
  // — recipe_version.promote: MoO+ makes a shop's version the global default (3b's first caller).
  "recipe_version.promote",
```

and directly after `  "menu_item.update",`, insert:

```ts
  // ── Menu items per shop (catalog Phase 3, 0263) ───────────────────────────
  // — menu_item.shop_setting_save: a shop's price / sold here / name here saved (or restored).
  "menu_item.shop_setting_save",
  // — menu_item.shop_setting_retire: a shop goes back to the global menu item.
  "menu_item.shop_setting_retire",
  // — menu_item.shop_setting_promote: MoO+ makes a shop's price / name the global one (3b's first caller).
  "menu_item.shop_setting_promote",
```

- [ ] **Step 4: Create `lib/admin/recipe-versions.ts`**

```ts
/**
 * RECIPE SHOP VERSIONS — the gated writers and the reads (catalog Phase 3a, 0262). SERVER-ONLY,
 * service role. THE LIB IS THE AUTHORITY (spec §2): every writer decides role and shop HERE, before any
 * I/O (requireLocation) — the route is the outer layer, not the lock (writeParFromSuggestion's posture):
 *   · a GM (7) writes ONLY its own shops' versions; MoO (8)+ writes ANY active shop (2a's
 *     catalogShopAllowed — deliberately not lockLocationContext) and the global default;
 *   · a GM never edits the global recipe: its edit is its shop's version (global_requires_moo).
 * The version compare-and-set, the copy for restore / adopt / promote, and the per-shop cycle law live
 * in SQL (save_recipe_version, retire_recipe_version). Every write is audited with a closed AuditAction.
 *
 * READS ARE ORG-WIDE at level 6: recipes are the company's knowledge, and adopting another shop's
 * version (3b) means seeing it. Only WRITES are bound to a shop.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { AuditAction } from "@/lib/audit-actions";
import { assertInputLineIsValid, RecipeError } from "@/lib/recipes";
import { lineFromRow, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import { assertScopeToken, catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";
import {
  RECIPE_VERSION_READ_MIN, addedLinePositions, applyRecipeLineOp, diffRecipeLineSets, recipeLineTargetKey, recipeVersionWriteGate,
  rpcRecipeLines, type LiveRecipeLine, type RecipeLineChange, type RecipeLineOp, type RecipeLineRefusal,
} from "@/lib/recipe-versions-shared";

export class RecipeVersionError extends Error {
  /** WHICH line and WHY, when a line is refused (lead decision (b)); the routes return it as `line`. */
  constructor(public status: number, public code: string, message?: string, public line?: RecipeLineRefusal) {
    super(message ?? code);
    this.name = "RecipeVersionError";
  }
}

/** THE BIND (a BIND_PRIMITIVES name): role + shop, decided before any I/O. */
function requireLocation(actor: AuthContext, scope: VersionScope): void {
  const gate = recipeVersionWriteGate({ level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
}

const RPC_STATUS: Record<string, number> = {
  version_changed: 409, not_live: 409, recipe_inactive: 409, dependencies_changed: 409, dependencies_busy: 409,
  global_cannot_retire: 400, invalid_lines: 400, invalid_payload: 400, invalid_source: 400, would_create_cycle: 400,
  product_line_invalid: 400,
  recipe_not_found: 404, location_not_found: 404, not_found: 404,
};

/** The id-list chunk for `.in()` reads (the request-line budget; 2a's ID_CHUNK). */
const ID_CHUNK = 100;

/**
 * THE DEPENDENCY SNAPSHOT (0262 recipe_change_snapshot): an opaque JSON digest of everything a preview's
 * numbers are computed from. A preview takes it BEFORE computing; every writer hands it to SQL, which
 * re-takes it under the graph lock and refuses `dependencies_changed` on any difference (Astra 3a r1#3).
 */
export type RecipeChangeSnapshot = Record<string, unknown>;

/**
 * The SCOPED snapshot for one change (0262 recipe_change_snapshot; lead decision (a)): the recipe, the scope it is
 * written to (null = the global default) and the line set being written (the edit's result, or the source a
 * restore / adopt / promote copies; null for back to default). The writer re-derives the same closure from the
 * same three inputs under its locks.
 */
export async function loadRecipeChangeSnapshot(
  recipeId: string, scope: VersionScope, lines: readonly RecipeLineFields[] | null,
): Promise<RecipeChangeSnapshot> {
  const { data, error } = await getServiceRoleClient().rpc("recipe_change_snapshot", {
    p_recipe: recipeId, p_location: scope,
    p_lines: lines === null ? null : rpcRecipeLines(lines.map((fields) => ({ lineId: null, fields }))),
  });
  if (error) throw new Error(`loadRecipeChangeSnapshot: ${error.message}`);
  if (data == null || typeof data !== "object") throw new Error("loadRecipeChangeSnapshot: no snapshot");
  return data as RecipeChangeSnapshot;
}

/** Map an RPC P0001 refusal (`recipe_version:<code>`) to a typed error; anything else is a 500. */
export function recipeVersionErrorFromRpc(message: string): never {
  const code = /recipe_version:([a-z_]+)/.exec(message)?.[1];
  if (code && RPC_STATUS[code]) throw new RecipeVersionError(RPC_STATUS[code]!, code);
  throw new Error(`recipe-version rpc failed: ${message}`);
}

/** A line's display name for a refusal: the SKU's, item's or product's name; the target key if it has none. */
async function lineName(f: RecipeLineFields): Promise<string> {
  const [table, id] = f.componentSkuId ? ["vendor_items", f.componentSkuId] as const
    : f.componentItemId ? ["items", f.componentItemId] as const
    : ["products", f.componentProductId] as const;
  if (!id) return recipeLineTargetKey(f);
  const { data } = await getServiceRoleClient().from(table).select("name").eq("id", id).maybeSingle<{ name: string }>();
  return data?.name ?? recipeLineTargetKey(f);
}

/** An RPC refusal that names a line (`recipe_version:<code>:<position>`, 0262) keeps WHICH line it was. */
async function recipeVersionRpcRefusal(message: string, lines: readonly RecipeLineFields[]): Promise<never> {
  const m = /recipe_version:([a-z_]+):(\d+)/.exec(message);
  const code = m?.[1];
  const line = m ? lines[Number(m[2]) - 1] : undefined;
  if (code && RPC_STATUS[code] && line) {
    throw new RecipeVersionError(RPC_STATUS[code]!, code, undefined, { position: Number(m![2]), name: await lineName(line), reason: code });
  }
  return recipeVersionErrorFromRpc(message);
}

// ── The set a person sees ─────────────────────────────────────────────────────

export interface RecipeLiveSet {
  recipeId: string;
  recipeName: string;
  recipeActive: boolean;
  scope: VersionScope;
  /** This scope's own live version: the shop's (null = it rides the default) or, for global, the head. */
  scopeVersionId: string | null;
  globalVersionId: string | null;
  ridesDefault: boolean;
  lines: LiveRecipeLine[];
}

type LineRowWithId = RecipeLineRow & { id: string; display_order: number | null };
const LINE_COLUMNS = "id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order";

/** The lines `scope` resolves NOW for one recipe, with the version ids an edit must name. No actor: callers gate. */
export async function loadRecipeLiveSet(recipeId: string, scope: VersionScope): Promise<RecipeLiveSet> {
  const sb = getServiceRoleClient();
  const versionsBase = sb.from("recipe_versions").select("id, location_id").eq("recipe_id", recipeId).eq("active", true);
  const [recipeRes, versionsRes] = await Promise.all([
    sb.from("recipes").select("id, name, active").eq("id", recipeId).maybeSingle<{ id: string; name: string; active: boolean | null }>(),
    (scope === null ? versionsBase.is("location_id", null) : versionsBase.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`))
      .returns<Array<{ id: string; location_id: string | null }>>(),
  ]);
  if (recipeRes.error) throw new Error(`loadRecipeLiveSet recipe: ${recipeRes.error.message}`);
  if (versionsRes.error) throw new Error(`loadRecipeLiveSet versions: ${versionsRes.error.message}`);
  if (!recipeRes.data) throw new RecipeVersionError(404, "recipe_not_found");
  const versions = versionsRes.data ?? [];
  const globalVersionId = versions.find((v) => v.location_id === null)?.id ?? null;
  const shopVersionId = scope === null ? null : (versions.find((v) => v.location_id === scope)?.id ?? null);
  // PAGED like every version line-set read (Astra 3a r1#6) — a set is capped at 200 lines in SQL today, but a
  // truncated read here would silently drop lines from the set an edit is computed against.
  const rows: LineRowWithId[] = shopVersionId
    ? await selectAllRows<LineRowWithId>(async (from, to) => {
        const { data, error } = await sb.from("recipe_version_lines").select(LINE_COLUMNS).eq("version_id", shopVersionId)
          .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<LineRowWithId[]>();
        if (error) throw new Error(`loadRecipeLiveSet version lines: ${error.message}`);
        return { data };
      })
    : await selectAllRows<LineRowWithId>(async (from, to) => {
        const { data, error } = await sb.from("recipe_inputs").select(LINE_COLUMNS).eq("recipe_id", recipeId)
          .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<LineRowWithId[]>();
        if (error) throw new Error(`loadRecipeLiveSet inputs: ${error.message}`);
        return { data };
      });
  return {
    recipeId, recipeName: recipeRes.data.name, recipeActive: recipeRes.data.active !== false, scope,
    scopeVersionId: scope === null ? globalVersionId : shopVersionId,
    globalVersionId, ridesDefault: scope !== null && shopVersionId === null,
    lines: rows.map((r) => ({ lineId: r.id, fields: lineFromRow(r) })),
  };
}

// ── The one writer ────────────────────────────────────────────────────────────

export interface WriteRecipeVersionInput {
  recipeId: string;
  scope: VersionScope;
  /** This scope's live version the person saw (the shop's, null = riding the default; or the global head). */
  expectedVersionId: string | null;
  /** The global head the person saw when forking the default (shop scope riding the default). */
  basedOnVersionId: string | null;
  /** The full new set; null = the source version's lines (restore / adopt / promote copy in SQL). */
  lines: LiveRecipeLine[] | null;
  note?: string | null;
  restoredFromVersionId?: string | null;
  adoptedFromVersionId?: string | null;
  promotedFromVersionId?: string | null;
  /** What the person did, for the audit row: "add" | "update" | "remove" | "restore" | "adopt" | "promote". */
  op: string;
  changes?: RecipeLineChange[] | null;
  /** The dependency snapshot the person's numbers were computed from (a 3b preview's, or the request's own). */
  snapshot: RecipeChangeSnapshot;
}

export interface WriteRecipeVersionResult {
  versionId: string;
  retiredVersionId: string | null;
  changedShops: string[];
  /** PROMOTE: the source shop, now back on the default (lead decision 5); else null. */
  returnedShop: string | null;
}

/** The lines of one version, paged — what a restore / adopt / promote is about to copy. */
async function loadVersionLineFields(versionId: string): Promise<RecipeLineFields[]> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<LineRowWithId>(async (from, to) => {
    const { data, error } = await sb.from("recipe_version_lines").select(LINE_COLUMNS).eq("version_id", versionId)
      .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<LineRowWithId[]>();
    if (error) throw new Error(`loadVersionLineFields: ${error.message}`);
    return { data };
  });
  return rows.map((r) => lineFromRow(r));
}

/**
 * THE ONE RECIPE-VERSION WRITE: bind, then save_recipe_version (graph lock, recipe row lock, version
 * compare-and-set, per-shop cycle law), then the audit row. Every 3a/3b recipe write goes through here.
 */
export async function writeRecipeVersion(actor: AuthContext, input: WriteRecipeVersionInput): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, input.scope);
  // THE SAME LINE RULES AS AN ADD / UPDATE (Astra 3a r1#5) — for every line this save ADDS or CREATES (lead
  // decision (b)): the sent set, or the source a restore / adopt / promote copies, against the set this scope
  // resolves NOW. A line already there, unchanged, may stay even if it no longer passes (it is flagged on the page),
  // so a recipe with two broken lines is repaired one line at a time. The refusal names WHICH line and WHY.
  // 0262 re-checks the product rule in SQL under the locks, with the same "carried" rule and the line's position.
  const sourceId = input.restoredFromVersionId ?? input.adoptedFromVersionId ?? input.promotedFromVersionId ?? null;
  const next = input.lines ? input.lines.map((l) => l.fields) : sourceId ? await loadVersionLineFields(sourceId) : [];
  const current = (await loadRecipeLiveSet(input.recipeId, input.scope)).lines.map((l) => l.fields);
  // A COPIED set carries nothing (Astra 3a r3#3; accepted ruling): every line a restore / adopt / promote copies is
  // an addition and must pass, even one identical to a broken line already here. Only an EDIT carries lines,
  // counted with multiplicity (addedLinePositions; 0262 counts the same way).
  const positions = input.lines ? addedLinePositions(current, next) : next.map((_, i) => i + 1);
  for (const position of positions) await validateLine(next[position - 1]!, position);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("save_recipe_version", {
    p_recipe: input.recipeId, p_location: input.scope, p_lines: input.lines ? rpcRecipeLines(input.lines) : null,
    p_expected: input.expectedVersionId, p_based_on: input.basedOnVersionId, p_note: input.note ?? null, p_actor: actor.user.id,
    p_restored_from: input.restoredFromVersionId ?? null, p_adopted_from: input.adoptedFromVersionId ?? null,
    p_promoted_from: input.promotedFromVersionId ?? null, p_snapshot: input.snapshot,
  });
  if (error) await recipeVersionRpcRefusal(error.message, next);
  const r = data as {
    version_id: string; retired_version_id: string | null; changed_shops: string[] | null;
    returned_shop?: string | null; returned_version_id?: string | null;
  };
  const action: AuditAction = input.promotedFromVersionId ? "recipe_version.promote"
    : input.adoptedFromVersionId ? "recipe_version.adopt" : "recipe_version.save";
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action, resourceTable: "recipe_versions", resourceId: r.version_id,
    metadata: {
      recipe_id: input.recipeId, location_id: input.scope, scope: input.scope === null ? "global" : "shop", op: input.op,
      retired_version_id: r.retired_version_id, based_on_version_id: input.basedOnVersionId,
      restored_from_version_id: input.restoredFromVersionId ?? null, adopted_from_version_id: input.adoptedFromVersionId ?? null,
      promoted_from_version_id: input.promotedFromVersionId ?? null, changes: input.changes ?? null,
      changed_shops: r.changed_shops ?? [], note: input.note ?? null,
      // PROMOTE: the source shop's version was retired in the same transaction (lead decision 5).
      returned_shop: r.returned_shop ?? null, returned_version_id: r.returned_version_id ?? null,
    },
    ipAddress: null, userAgent: null,
  });
  return {
    versionId: r.version_id, retiredVersionId: r.retired_version_id, changedShops: r.changed_shops ?? [],
    returnedShop: r.returned_shop ?? null,
  };
}

/** Phase 1's validator for ONE line; a refusal keeps its code and names the line (1-based position, name, reason). */
async function validateLine(line: RecipeLineFields, position: number): Promise<void> {
  try {
    await assertInputLineIsValid(getServiceRoleClient(), line);
  } catch (e) {
    if (e instanceof RecipeError) {
      throw new RecipeVersionError(e.status, e.code, e.message, { position, name: await lineName(line), reason: e.code });
    }
    throw e;
  }
}

export interface SaveRecipeLinesInput {
  recipeId: string;
  scope: VersionScope;
  expectedVersionId: string | null;
  basedOnVersionId: string | null;
  op: RecipeLineOp;
  note?: string | null;
  /** A 3b preview's dependency snapshot; absent = taken now, before this request's own reads. */
  snapshot?: RecipeChangeSnapshot;
}

/** ONE line edit (add / update / remove) to the set this scope resolves; a no-op writes nothing. */
export async function saveRecipeLines(
  actor: AuthContext,
  input: SaveRecipeLinesInput,
): Promise<{ versionId: string | null; retiredVersionId: string | null; changed: boolean }> {
  requireLocation(actor, input.scope);
  const live = await loadRecipeLiveSet(input.recipeId, input.scope);
  if (!live.recipeActive) throw new RecipeVersionError(409, "recipe_inactive");
  if (live.scopeVersionId !== input.expectedVersionId) throw new RecipeVersionError(409, "version_changed");
  if (live.ridesDefault && live.globalVersionId !== input.basedOnVersionId) throw new RecipeVersionError(409, "version_changed");
  const applied = applyRecipeLineOp(live.lines, input.op);
  if (!applied.ok) throw new RecipeVersionError(applied.status, applied.code);
  if (!applied.changed) return { versionId: live.scopeVersionId, retiredVersionId: null, changed: false };
  // A 3b preview hands its snapshot in; a direct call takes it now, over the set it is about to write.
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.scope, applied.lines.map((l) => l.fields));
  // writeRecipeVersion validates every line the edit adds or changes (lead decision (b)).
  const r = await writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: input.scope, expectedVersionId: input.expectedVersionId,
    basedOnVersionId: live.ridesDefault ? live.globalVersionId : null, lines: applied.lines, note: input.note ?? null,
    op: input.op.kind, changes: diffRecipeLineSets(live.lines.map((l) => l.fields), applied.lines.map((l) => l.fields)),
    snapshot,
  });
  return { versionId: r.versionId, retiredVersionId: r.retiredVersionId, changed: true };
}

/**
 * Restore = a NEW version holding an old version's lines (copied in SQL), never a revive. The source
 * must be this recipe's global history or this shop's own history (another shop's version is ADOPT).
 */
export async function restoreRecipeVersion(
  actor: AuthContext,
  input: {
    recipeId: string; scope: VersionScope; fromVersionId: string; expectedVersionId: string | null; basedOnVersionId: string | null;
    snapshot?: RecipeChangeSnapshot;
  },
): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, input.scope);
  const { data: from, error } = await getServiceRoleClient().from("recipe_versions").select("id, recipe_id, location_id")
    .eq("id", input.fromVersionId).maybeSingle<{ id: string; recipe_id: string; location_id: string | null }>();
  if (error) throw new Error(`restoreRecipeVersion source: ${error.message}`);
  if (!from || from.recipe_id !== input.recipeId || (from.location_id !== null && from.location_id !== input.scope)) {
    throw new RecipeVersionError(404, "not_found");
  }
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.scope, await loadVersionLineFields(input.fromVersionId));
  return writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: input.scope, expectedVersionId: input.expectedVersionId,
    basedOnVersionId: input.basedOnVersionId, lines: null, restoredFromVersionId: input.fromVersionId, op: "restore",
    snapshot,
  });
}

/** A shop goes BACK TO DEFAULT: its live version is retired (valid_to stamped), never deleted. */
export async function retireShopRecipeVersion(
  actor: AuthContext,
  input: { recipeId: string; versionId: string; locationId: string; snapshot?: RecipeChangeSnapshot },
): Promise<void> {
  requireLocation(actor, input.locationId);
  // Back to default writes the DEFAULT's lines into this shop's graph: they are this change's line set (0262 does the same).
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.locationId,
    (await loadRecipeLiveSet(input.recipeId, null)).lines.map((l) => l.fields));
  const sb = getServiceRoleClient();
  const { data: v, error: vErr } = await sb.from("recipe_versions").select("id, recipe_id, location_id")
    .eq("id", input.versionId).maybeSingle<{ id: string; recipe_id: string; location_id: string | null }>();
  if (vErr) throw new Error(`retireShopRecipeVersion read: ${vErr.message}`);
  if (!v || v.recipe_id !== input.recipeId || v.location_id !== input.locationId) throw new RecipeVersionError(404, "not_found");
  const { error } = await sb.rpc("retire_recipe_version", {
    p_version: input.versionId, p_location: input.locationId, p_actor: actor.user.id, p_snapshot: snapshot,
  });
  if (error) recipeVersionErrorFromRpc(error.message);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "recipe_version.retire", resourceTable: "recipe_versions", resourceId: input.versionId,
    metadata: { recipe_id: input.recipeId, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

// ── History ───────────────────────────────────────────────────────────────────

export interface RecipeVersionHistoryRow {
  id: string;
  locationId: string | null;
  active: boolean;
  validFrom: string;
  validTo: string | null;
  basedOnVersionId: string | null;
  adoptedFromVersionId: string | null;
  promotedFromVersionId: string | null;
  /** The version whose adoption link this row ENDED (0262 records it; History reads it, never infers). */
  adoptionEndedFromVersionId: string | null;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  lines: RecipeLineFields[];
}

/**
 * Every version of a recipe visible to a scope (global + that shop; or every shop when `allShops`),
 * newest first, with its lines and who made it. Read floor 6, org-wide.
 */
export async function loadRecipeVersionHistory(
  actor: AuthContext,
  recipeId: string,
  scope: VersionScope,
  opts: { allShops?: boolean } = {},
): Promise<RecipeVersionHistoryRow[]> {
  if (actor.level < RECIPE_VERSION_READ_MIN) throw new RecipeVersionError(403, "forbidden");
  const sb = getServiceRoleClient();
  type VersionRow = { id: string; location_id: string | null; active: boolean; valid_from: string; valid_to: string | null; based_on_version_id: string | null; adopted_from_version_id: string | null; promoted_from_version_id: string | null; adoption_ended_from_version_id: string | null; note: string | null; created_by: string | null };
  // EVERY READ PAGED AND ID-CHUNKED (Astra 3a r1#6): 51 versions of a 20-line recipe already pass the
  // PostgREST 1000-row cap, and a truncated line read would show an incomplete version and a false diff.
  const versions = await selectAllRows<VersionRow>(async (from, to) => {
    const base = sb.from("recipe_versions")
      .select("id, location_id, active, valid_from, valid_to, based_on_version_id, adopted_from_version_id, promoted_from_version_id, adoption_ended_from_version_id, note, created_by")
      .eq("recipe_id", recipeId);
    const scoped = opts.allShops ? base : scope === null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped.order("valid_from", { ascending: false }).order("id", { ascending: false })
      .range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`loadRecipeVersionHistory: ${error.message}`);
    return { data };
  });
  const ids = versions.map((v) => v.id);
  const userIds = [...new Set(versions.map((v) => v.created_by).filter((u): u is string => u !== null))];
  const lines: Array<LineRowWithId & { version_id: string }> = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    lines.push(...await selectAllRows<LineRowWithId & { version_id: string }>(async (from, to) => {
      const { data, error } = await sb.from("recipe_version_lines").select(`version_id, ${LINE_COLUMNS}`).in("version_id", chunk)
        .order("version_id", { ascending: true }).order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<Array<LineRowWithId & { version_id: string }>>();
      if (error) throw new Error(`loadRecipeVersionHistory lines: ${error.message}`);
      return { data };
    }));
  }
  const users: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const chunk = userIds.slice(i, i + ID_CHUNK);
    const { data, error } = await sb.from("users").select("id, name").in("id", chunk).returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`loadRecipeVersionHistory users: ${error.message}`);
    users.push(...(data ?? []));
  }
  const linesBy = new Map<string, RecipeLineFields[]>();
  for (const l of lines) linesBy.set(l.version_id, [...(linesBy.get(l.version_id) ?? []), lineFromRow(l)]);
  const nameBy = new Map(users.map((u) => [u.id, u.name]));
  return versions.map((v) => ({
    id: v.id, locationId: v.location_id, active: v.active, validFrom: v.valid_from, validTo: v.valid_to,
    basedOnVersionId: v.based_on_version_id, adoptedFromVersionId: v.adopted_from_version_id, promotedFromVersionId: v.promoted_from_version_id,
    adoptionEndedFromVersionId: v.adoption_ended_from_version_id ?? null,
    note: v.note, createdBy: v.created_by, createdByName: v.created_by ? (nameBy.get(v.created_by) ?? null) : null,
    lines: linesBy.get(v.id) ?? [],
  }));
}
```

- [ ] **Step 5: Register the writers with the differential location-bind check**

In `tests/location-bind-differential.test.ts`:
- `TENANCY_SCOPED_TABLES`, after 2a's `"vendor_price_history",`: add `// 0262/0263 — a shop's own recipe version / menu overlay / notice answer belongs to that shop (location_id NULL = global).` followed by `"recipe_versions",`, `"recipe_version_lines",`, `"recipe_notice_dismissals",`, `"menu_item_shop_settings",`.
- `TENANCY_SCOPED_RPCS`, after 2a's `"retire_sku_price_lane",`: add `// 0262/0263 — the recipe-version and menu-overlay writers; their libs bind before calling them.` followed by `"save_recipe_version",`, `"retire_recipe_version",`, `"save_menu_item_shop_setting",`, `"retire_menu_item_shop_setting",`, `"promote_menu_item_shop_setting",`.
- `FILES`: add `// 0262 — every recipe-version writer binds inside the lib (requireLocation) before any I/O.` followed by `"lib/admin/recipe-versions.ts",`.

- [ ] **Step 6: Run, then commit**

Run: `npx vitest run tests/recipe-versions-permissions.test.ts tests/location-bind-differential.test.ts tests/audit-actions.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/admin/recipe-versions.ts lib/recipes.ts lib/destructive-actions.ts tests/recipe-versions-permissions.test.ts tests/location-bind-differential.test.ts
git commit -F - <<'EOF'
feat(catalog): gated recipe-version writers — GM own shop, MoO any shop and global, one write path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 8: The gated menu-overlay writers (`lib/admin/menu-item-shop.ts`)

**Files:**
- Create: `lib/admin/menu-item-shop.ts`
- Modify: `tests/location-bind-differential.test.ts`
- Test: `tests/menu-item-shop-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3a — the menu overlay write gates hold inside the lib, before any I/O. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import {
  MenuShopError, restoreMenuItemShopSetting, retireMenuItemShopSetting, saveMenuItemShopSetting,
} from "@/lib/admin/menu-item-shop";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const PATCH = { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null };

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof MenuShopError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("GM writes only its own shops' menu; MoO any shop", () => {
  it("a GM of LOC cannot set OTHER's price, retire or restore OTHER's row (404, before I/O)", async () => {
    expect(await refused(saveMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: OTHER, expectedSettingId: null, patch: PATCH }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(retireMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: OTHER, settingId: "s" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(restoreMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: OTHER, fromSettingId: "s", expectedSettingId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("an AGM cannot set any shop's menu", async () => {
    expect(await refused(saveMenuItemShopSetting(actor("agm", 6, [LOC]), { menuItemId: "m-italian", locationId: LOC, expectedSettingId: null, patch: PATCH }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("an UNASSIGNED MoO passes the gate for OTHER — it reaches the RPC (which the stand-in lacks)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const p = saveMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", locationId: OTHER, expectedSettingId: null, patch: PATCH });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(MenuShopError);
  });
  it("retire refuses a row of another menu item", async () => {
    const t = buildRecipeVersionsFixture();
    t.menu_item_shop_settings = [{ id: "ms", menu_item_id: "m-pickle-side", location_id: LOC, based_on_setting_id: null, price: 3, sold_here: true,
      name_override: null, name_override_es: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_by: null }];
    current = createFakeDb(t);
    // A stand-in snapshot: the stand-in database has no rpc(), and this refusal comes from the row read after it.
    expect(await refused(retireMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: LOC, settingId: "ms", snapshot: { test: true } }))).toEqual({ status: 404, code: "not_found" });
  });
});
```

Run: `npx vitest run tests/menu-item-shop-permissions.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/admin/menu-item-shop.ts`**

```ts
/**
 * MENU ITEMS PER SHOP — the gated writers and the history read (catalog Phase 3a, 0263). SERVER-ONLY,
 * service role. The lib is the authority (spec §2): a GM (7) writes only its own shops' overlay, MoO
 * (8)+ any active shop (catalogShopAllowed) — decided HERE before any I/O (requireLocation). The
 * optimistic compare-and-set and the menu item row lock live in SQL. Every write is audited.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { assertScopeToken, catalogShopAllowed } from "@/lib/sku-versions-shared";
import { menuShopWriteGate, type MenuItemShopSettingRow, type MenuShopPatch } from "@/lib/menu-item-shop-shared";
import { MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";

export class MenuShopError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "MenuShopError";
  }
}

/** THE BIND (a BIND_PRIMITIVES name): role + shop, before any I/O. */
function requireLocation(actor: AuthContext, locationId: string): void {
  const gate = menuShopWriteGate({ level: actor.level, scopeAllowed: catalogShopAllowed(actor, locationId) });
  if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
}

const RPC_STATUS: Record<string, number> = {
  version_changed: 409, not_live: 409, global_changed: 409, dependencies_changed: 409, dependencies_busy: 409,
  invalid_price: 400, invalid_name: 400, empty_setting: 400, invalid_source: 400, invalid_payload: 400, nothing_to_promote: 400,
  menu_item_not_found: 404, location_not_found: 404, not_found: 404,
};

export function menuShopErrorFromRpc(message: string): never {
  // 'recipe_version:dependencies_busy' comes from 0262's closure locks, which the menu writers take too.
  const code = /(?:menu_item_shop|recipe_version):([a-z_]+)/.exec(message)?.[1];
  if (code && RPC_STATUS[code]) throw new MenuShopError(RPC_STATUS[code]!, code);
  throw new Error(`menu-shop rpc failed: ${message}`);
}

/**
 * THE DEPENDENCY SNAPSHOT (0263 menu_item_change_snapshot): the item, every shop's live row, the active
 * shops and the cost CLOSURE of every recipe that makes it at the scope shown (scoped, never a whole table).
 * A preview takes it before computing; every writer hands it to SQL, which takes the graph lock, the item row and
 * the closure locks, then re-takes it: `dependencies_changed` on any difference, `dependencies_busy` if busy.
 */
export type MenuChangeSnapshot = Record<string, unknown>;

/** The SCOPED snapshot (0263): `locationId` is the scope whose cost the preview shows (null = the default, a promote). */
export async function loadMenuChangeSnapshot(menuItemId: string, locationId: string | null): Promise<MenuChangeSnapshot> {
  const { data, error } = await getServiceRoleClient().rpc("menu_item_change_snapshot", { p_menu_item: menuItemId, p_location: locationId });
  if (error) throw new Error(`loadMenuChangeSnapshot: ${error.message}`);
  if (data == null || typeof data !== "object") throw new Error("loadMenuChangeSnapshot: no snapshot");
  return data as MenuChangeSnapshot;
}

async function writeSetting(
  actor: AuthContext,
  input: {
    menuItemId: string; locationId: string; expectedSettingId: string | null; patch: MenuShopPatch | null;
    restoredFromSettingId: string | null; note: string | null; snapshot?: MenuChangeSnapshot;
  },
): Promise<{ settingId: string; retiredSettingId: string | null }> {
  requireLocation(actor, input.locationId);
  const snapshot = input.snapshot ?? await loadMenuChangeSnapshot(input.menuItemId, input.locationId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("save_menu_item_shop_setting", {
    p_menu_item: input.menuItemId, p_location: input.locationId,
    p_price: input.patch?.price ?? null, p_sold_here: input.patch?.soldHere ?? true,
    p_name: input.patch?.nameOverride ?? null, p_name_es: input.patch?.nameOverrideEs ?? null,
    p_expected: input.expectedSettingId, p_note: input.note, p_actor: actor.user.id, p_restored_from: input.restoredFromSettingId,
    p_snapshot: snapshot,
  });
  if (error) menuShopErrorFromRpc(error.message);
  const r = data as { setting_id: string; retired_setting_id: string | null };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "menu_item.shop_setting_save", resourceTable: "menu_item_shop_settings", resourceId: r.setting_id,
    metadata: {
      menu_item_id: input.menuItemId, location_id: input.locationId, retired_setting_id: r.retired_setting_id,
      restored_from_setting_id: input.restoredFromSettingId, patch: input.patch,
    },
    ipAddress: null, userAgent: null,
  });
  return { settingId: r.setting_id, retiredSettingId: r.retired_setting_id };
}

/** Save this shop's price / sold here / name here (a new row; the old one is closed, never deleted). */
export async function saveMenuItemShopSetting(
  actor: AuthContext,
  input: { menuItemId: string; locationId: string; expectedSettingId: string | null; patch: MenuShopPatch; note?: string | null; snapshot?: MenuChangeSnapshot },
): Promise<{ settingId: string; retiredSettingId: string | null }> {
  requireLocation(actor, input.locationId);
  return writeSetting(actor, { ...input, restoredFromSettingId: null, note: input.note ?? null });
}

/** Restore = a new row with an old row's values (copied in SQL). The source must be this shop's own history. */
export async function restoreMenuItemShopSetting(
  actor: AuthContext,
  input: { menuItemId: string; locationId: string; fromSettingId: string; expectedSettingId: string | null; snapshot?: MenuChangeSnapshot },
): Promise<{ settingId: string; retiredSettingId: string | null }> {
  requireLocation(actor, input.locationId);
  return writeSetting(actor, {
    menuItemId: input.menuItemId, locationId: input.locationId, expectedSettingId: input.expectedSettingId, patch: null,
    restoredFromSettingId: input.fromSettingId, note: "restored", snapshot: input.snapshot,
  });
}

/** Back to the global menu item at this shop: the live row is retired (valid_to stamped), never deleted. */
export async function retireMenuItemShopSetting(
  actor: AuthContext,
  input: { menuItemId: string; locationId: string; settingId: string; snapshot?: MenuChangeSnapshot },
): Promise<void> {
  requireLocation(actor, input.locationId);
  const snapshot = input.snapshot ?? await loadMenuChangeSnapshot(input.menuItemId, input.locationId);
  const sb = getServiceRoleClient();
  const { data: row, error: rErr } = await sb.from("menu_item_shop_settings").select("id, menu_item_id, location_id")
    .eq("id", input.settingId).maybeSingle<{ id: string; menu_item_id: string; location_id: string }>();
  if (rErr) throw new Error(`retireMenuItemShopSetting read: ${rErr.message}`);
  if (!row || row.menu_item_id !== input.menuItemId || row.location_id !== input.locationId) throw new MenuShopError(404, "not_found");
  const { error } = await sb.rpc("retire_menu_item_shop_setting", {
    p_setting: input.settingId, p_location: input.locationId, p_actor: actor.user.id, p_snapshot: snapshot,
  });
  if (error) menuShopErrorFromRpc(error.message);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "menu_item.shop_setting_retire", resourceTable: "menu_item_shop_settings", resourceId: input.settingId,
    metadata: { menu_item_id: input.menuItemId, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

export interface MenuShopHistoryRow extends MenuItemShopSettingRow { createdByName: string | null }

/** Every overlay row of one menu item at one shop, newest first. Read floor 6, org-wide. */
export async function loadMenuItemShopHistory(actor: AuthContext, menuItemId: string, locationId: string): Promise<MenuShopHistoryRow[]> {
  if (actor.level < 6) throw new MenuShopError(403, "forbidden");
  const sb = getServiceRoleClient();
  // Paged like every history read (Astra 3a r1#6).
  const data = await selectAllRows<MenuItemShopSettingRow>(async (from, to) => {
    const res = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS)
      .eq("menu_item_id", menuItemId).eq("location_id", assertScopeToken(locationId))
      .order("valid_from", { ascending: false }).order("id", { ascending: false }).range(from, to).returns<MenuItemShopSettingRow[]>();
    if (res.error) throw new Error(`loadMenuItemShopHistory: ${res.error.message}`);
    return { data: res.data };
  });
  const userIds = [...new Set(data.map((r) => r.created_by).filter((u): u is string => u !== null))];
  const { data: users, error: uErr } = userIds.length === 0
    ? { data: [] as Array<{ id: string; name: string }>, error: null }
    : await sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>();
  if (uErr) throw new Error(`loadMenuItemShopHistory users: ${uErr.message}`);
  const nameBy = new Map((users ?? []).map((u) => [u.id, u.name]));
  return data.map((r) => ({ ...r, createdByName: r.created_by ? (nameBy.get(r.created_by) ?? null) : null }));
}
```

- [ ] **Step 3: Register the file with the differential location-bind check**

In `tests/location-bind-differential.test.ts` `FILES`, after `"lib/admin/recipe-versions.ts",`, add `// 0263 — every menu-overlay writer binds inside the lib (requireLocation) before any I/O.` followed by `"lib/admin/menu-item-shop.ts",`.

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/menu-item-shop-permissions.test.ts tests/location-bind-differential.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/admin/menu-item-shop.ts tests/menu-item-shop-permissions.test.ts tests/location-bind-differential.test.ts
git commit -F - <<'EOF'
feat(catalog): gated menu-overlay writers — price here, sold here, name here; back to default; restore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 9: The legacy line delete takes the graph lock (the journal's lock order)

0262's journal runs at COMMIT and takes the graph lock, then the recipe row. `removeRecipeEdge` deletes a recipe line with a direct `.delete()` that takes neither, so a direct delete racing a `save_recipe_version` on the same line could deadlock (row lock vs graph lock). The delete moves onto `remove_recipe_input_atomic` (0262), which takes the graph lock first. **No permission changes in 3a** (3b moves the legacy builder's line writes to MoO+ when the shop-version page exists).

**Files:**
- Modify: `lib/recipes.ts` (the delete takes the lock; the edit names its author), `tests/recipes-batch-mode.test.ts`, `tests/recipe-input-write-atomic.test.ts`
- Test: `tests/recipe-input-remove-locked.test.ts`

- [ ] **Step 1: Write the failing test `tests/recipe-input-remove-locked.test.ts`**

```ts
/** Catalog Phase 3a — the legacy recipe-line delete runs under the recipe-graph lock (0262 remove_recipe_input_atomic). */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc, from: () => { throw new Error("no direct table write expected"); } }) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
import { removeRecipeEdge } from "@/lib/recipes";

const gm = { user: { id: "u1", role: "gm" }, role: "gm", level: 7, locations: [] } as never;

describe("removeRecipeEdge(recipe_inputs)", () => {
  it("deletes through remove_recipe_input_atomic and never touches the table directly", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "ri-1", recipe_id: "r" }, error: null });
    await removeRecipeEdge(gm, { table: "recipe_inputs", id: "ri-1" });
    expect(rpc).toHaveBeenCalledWith("remove_recipe_input_atomic", { p_input_id: "ri-1", p_actor: "u1" });
  });
  it("a missing line is the named 404", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "edge_not_found" } });
    await expect(removeRecipeEdge(gm, { table: "recipe_inputs", id: "ri-x" })).rejects.toMatchObject({ status: 404, code: "edge_not_found" });
  });
  it("the source holds no direct delete of a recipe line any more", () => {
    const src = readFileSync("lib/recipes.ts", "utf8");
    expect(src).not.toContain(".from(args.table).delete(");
  });
});
```

Run: `npx vitest run tests/recipe-input-remove-locked.test.ts` → FAIL (`no direct table write expected`).

- [ ] **Step 2: `lib/recipes.ts` — the input branch of `removeRecipeEdge`**

Replace

```ts
  const { data: before } = await sb.from(args.table).select("*").eq("id", args.id).maybeSingle<Record<string, unknown>>();
  if (!before) throw new RecipeError(404, "edge_not_found");
  const { error, count } = await sb.from(args.table).delete({ count: "exact" }).eq("id", args.id);
  if (error) throw new Error(`removeRecipeEdge: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "edge_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_input.remove", resourceTable: args.table, resourceId: args.id, metadata: { before }, ipAddress: null, userAgent: null });
```

with

```ts
  // 0262: a recipe line leaves through remove_recipe_input_atomic, under the recipe-graph lock, so its
  // commit-time journal (recipe_global_journal) never inverts the lock order against another graph
  // writer. It returns the deleted row for the same `before` audit the direct delete wrote.
  const { data: before, error } = await sb.rpc("remove_recipe_input_atomic", { p_input_id: args.id, p_actor: actor.user.id });
  if (error) {
    const named = rpcRecipeError(error, RECIPE_INPUT_RPC_ERRORS);
    if (named) throw named;
    throw new Error(`removeRecipeEdge: ${error.message}`);
  }
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_input.remove", resourceTable: args.table, resourceId: args.id, metadata: { before: (before as Record<string, unknown> | null) ?? null }, ipAddress: null, userAgent: null });
```

- [ ] **Step 2b: The legacy edit names its author (`lib/recipes.ts` `updateRecipeInput`)** — lead decision, Astra 3a r4#1. In the `sb.rpc("update_recipe_input_atomic", { … })` call, replace

```ts
    p_expected_portioned: seen.portioned,
  });
```

with

```ts
    p_expected_portioned: seen.portioned,
    // 0262's authorship overload (+ p_actor): the journal records WHO made the version this edit opens.
    p_actor: actor.user.id,
  });
```

and in `tests/recipe-input-write-atomic.test.ts`, inside `it("updateRecipeInput calls update_recipe_input_atomic and writes no row itself", …)`, after `expect(upd).toContain('sb.rpc("update_recipe_input_atomic"');` add `    expect(upd).toContain("p_actor: actor.user.id"); // 0262 authorship overload`. `tests/recipe-input-rpc-fake.ts` reads its arguments by name, so the extra one changes nothing there.

- [ ] **Step 3: Update the batch-mode source pin**

In `tests/recipes-batch-mode.test.ts`, replace the whole `it("removeRecipeEdge deletes an output through remove_recipe_output and keeps the direct path for inputs only", () => { … });` block with:

```ts
  it("removeRecipeEdge deletes an output through remove_recipe_output and an input through remove_recipe_input_atomic (0262)", () => {
    const body = fnBody(lib, "removeRecipeEdge");
    expect(body).toMatch(/rpc\("remove_recipe_output"/);
    // The input path is reached only after the outputs branch has returned, and it is the graph-locked RPC.
    const rpcAt = body.indexOf('rpc("remove_recipe_output"');
    const returnAt = body.indexOf("return;", rpcAt);
    const inputAt = body.indexOf('rpc("remove_recipe_input_atomic"');
    expect(returnAt).toBeGreaterThan(rpcAt);
    expect(inputAt).toBeGreaterThan(returnAt);
    expect(body).not.toContain(".delete(");
  });
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/recipe-input-remove-locked.test.ts tests/recipes-batch-mode.test.ts`
Expected: PASS, 0 failed.

```bash
git add lib/recipes.ts tests/recipe-input-remove-locked.test.ts tests/recipes-batch-mode.test.ts tests/recipe-input-write-atomic.test.ts
git commit -F - <<'EOF'
fix(recipes): the legacy line delete runs under the recipe-graph lock (0262 journal lock order)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 10: The Tier E routes

The routes live under `/api/admin/catalog/recipe/[id]/…` and `/api/admin/catalog/menu-item/[id]/…`, beside 2a/2b's `/api/admin/catalog/sku/[id]/…`. Every route parses an explicit field list, takes the session, a level-7 outer floor, and asserts **Tier E** (Phase 1's 15-minute edit window). The lib decides the real gate (an unassigned MoO passes because the route never binds a shop itself). **No Phase 3 act takes a one-shot grant**: every save, restore and back-to-default keeps every row, so it is reversible; deleting a recipe stays the grant it is (`recipe.delete`).

**Files:**
- Create: `app/api/admin/catalog/recipe/[id]/lines/route.ts`, `app/api/admin/catalog/recipe/[id]/restore/route.ts`, `app/api/admin/catalog/recipe/[id]/back-to-default/route.ts`
- Create: `app/api/admin/catalog/menu-item/[id]/shop/route.ts`, `app/api/admin/catalog/menu-item/[id]/shop/back-to-default/route.ts`, `app/api/admin/catalog/menu-item/[id]/shop/restore/route.ts`
- Modify: `tests/step-up-tier-map.test.ts`
- Test: `tests/recipe-menu-version-routes.test.ts`

- [ ] **Step 1: Write the failing source-pin test `tests/recipe-menu-version-routes.test.ts`**

```ts
/** Catalog Phase 3a — the recipe and menu-overlay routes: Tier E, a level-7 floor outside, the lib inside, explicit fields. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = {
  "app/api/admin/catalog/recipe/[id]/lines/route.ts": ["saveRecipeLines(", "RecipeVersionError", "RECIPE_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/recipe/[id]/restore/route.ts": ["restoreRecipeVersion(", "RecipeVersionError", "RECIPE_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/recipe/[id]/back-to-default/route.ts": ["retireShopRecipeVersion(", "RecipeVersionError", "RECIPE_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/menu-item/[id]/shop/route.ts": ["saveMenuItemShopSetting(", "MenuShopError", "MENU_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/menu-item/[id]/shop/back-to-default/route.ts": ["retireMenuItemShopSetting(", "MenuShopError", "MENU_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/menu-item/[id]/shop/restore/route.ts": ["restoreMenuItemShopSetting(", "MenuShopError", "MENU_SHOP_WRITE_MIN"],
} as const;

describe.each(Object.entries(ROUTES))("%s", (file, [call, errorClass, floor]) => {
  const src = readFileSync(file, "utf8");
  it("asserts Tier E after the session and a level-7 outer floor", () => {
    expect(src).toContain('assertStepUp(ctx, "E")');
    expect(src).toContain(`ctx.level < ${floor}`);
    expect(src.indexOf("requireSession(")).toBeLessThan(src.indexOf('assertStepUp(ctx, "E")'));
  });
  it("delegates the real gate to the lib (no shop bind of its own) and maps its typed error", () => {
    expect(src).toContain(call);
    expect(src).toContain(`instanceof ${errorClass}`);
    expect(src).not.toContain("lockLocationContext");
    expect(src).not.toContain("consumeStepUpGrant");
  });
  it("accepts uuids only", () => {
    expect(src).toContain("UUID_RE");
  });
});
```

Run: `npx vitest run tests/recipe-menu-version-routes.test.ts` → FAIL (`ENOENT`).

- [ ] **Step 2: Create `app/api/admin/catalog/recipe/[id]/lines/route.ts`**

```ts
/**
 * POST /api/admin/catalog/recipe/[id]/lines — ONE recipe-line edit (catalog Phase 3a).
 * Body: { locationId: uuid | null, expectedVersionId: uuid | null, basedOnVersionId: uuid | null,
 *         op: { kind: "add", line } | { kind: "update", lineId, line, expected } | { kind: "remove", lineId, expected } }
 * locationId null = the global default (MoO+); a shop = that shop's version (GM: its own shops; MoO+: any).
 * The lib (lib/admin/recipe-versions.ts) is the authority; this route is the outer layer: session, a
 * level-7 floor, Tier E (the 15-minute edit window), an explicit field list.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveRecipeLines, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { parseRecipeLineOp, RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/lines`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedVersionId" });
  const basedOn = optUuid(b.basedOnVersionId);
  if (basedOn === undefined) return jsonError(400, "invalid_payload", { field: "basedOnVersionId" });
  const op = parseRecipeLineOp(b.op);
  if (!op.ok) return jsonError(400, op.code, { field: "op" });

  try {
    const r = await saveRecipeLines(ctx, { recipeId: id, scope: locationId, expectedVersionId: expected, basedOnVersionId: basedOn, op: op.op });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId, changed: r.changed }, r.changed ? 201 : 200);
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 3: Create `app/api/admin/catalog/recipe/[id]/restore/route.ts`**

```ts
/**
 * POST /api/admin/catalog/recipe/[id]/restore — Restore from History (catalog Phase 3a).
 * Body: { locationId: uuid | null, fromVersionId: uuid, expectedVersionId: uuid | null, basedOnVersionId: uuid | null }.
 * Restore makes a NEW version holding the old version's lines (copied in SQL) — never a delete, never a revive.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { restoreRecipeVersion, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.fromVersionId !== "string" || !UUID_RE.test(b.fromVersionId)) return jsonError(400, "invalid_payload", { field: "fromVersionId" });
  const expected = optUuid(b.expectedVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedVersionId" });
  const basedOn = optUuid(b.basedOnVersionId);
  if (basedOn === undefined) return jsonError(400, "invalid_payload", { field: "basedOnVersionId" });

  try {
    const r = await restoreRecipeVersion(ctx, { recipeId: id, scope: locationId, fromVersionId: b.fromVersionId, expectedVersionId: expected, basedOnVersionId: basedOn });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId }, 201);
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 4: Create `app/api/admin/catalog/recipe/[id]/back-to-default/route.ts`**

```ts
/**
 * POST /api/admin/catalog/recipe/[id]/back-to-default — a shop drops its own recipe version and the
 * global default answers for it again (catalog Phase 3a). Body: { locationId: uuid, versionId: uuid }.
 * The version row is retired (valid_to stamped), never deleted. Tier E; the lib binds the shop.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireShopRecipeVersion, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.versionId !== "string" || !UUID_RE.test(b.versionId)) return jsonError(400, "invalid_payload", { field: "versionId" });
  try {
    await retireShopRecipeVersion(ctx, { recipeId: id, versionId: b.versionId, locationId: b.locationId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 5: Create `app/api/admin/catalog/menu-item/[id]/shop/route.ts`**

```ts
/**
 * POST /api/admin/catalog/menu-item/[id]/shop — save this shop's price / sold here / name here for a
 * menu item (catalog Phase 3a). Body: { locationId: uuid, expectedSettingId: uuid | null,
 *   price: number | null, soldHere: boolean, nameOverride: string | null, nameOverrideEs: string | null }.
 * The lib (lib/admin/menu-item-shop.ts) binds the shop; this route: session, level-7 floor, Tier E, fields.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveMenuItemShopSetting, MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN, parseMenuShopPatch } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/shop`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedSettingId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedSettingId" });
  const patch = parseMenuShopPatch({ price: b.price, soldHere: b.soldHere, nameOverride: b.nameOverride, nameOverrideEs: b.nameOverrideEs });
  if (!patch.ok) return jsonError(400, patch.code);
  try {
    const r = await saveMenuItemShopSetting(ctx, { menuItemId: id, locationId: b.locationId, expectedSettingId: expected, patch: patch.patch });
    return jsonOk({ settingId: r.settingId, retiredSettingId: r.retiredSettingId }, 201);
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 6: Create `app/api/admin/catalog/menu-item/[id]/shop/back-to-default/route.ts`**

```ts
/**
 * POST /api/admin/catalog/menu-item/[id]/shop/back-to-default — this shop goes back to the global menu
 * item (catalog Phase 3a). Body: { locationId: uuid, settingId: uuid }. The row is retired, never deleted.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireMenuItemShopSetting, MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/shop/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.settingId !== "string" || !UUID_RE.test(b.settingId)) return jsonError(400, "invalid_payload", { field: "settingId" });
  try {
    await retireMenuItemShopSetting(ctx, { menuItemId: id, locationId: b.locationId, settingId: b.settingId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 7: Create `app/api/admin/catalog/menu-item/[id]/shop/restore/route.ts`**

```ts
/**
 * POST /api/admin/catalog/menu-item/[id]/shop/restore — save an old overlay row's values as a new one
 * (catalog Phase 3a). Body: { locationId: uuid, fromSettingId: uuid, expectedSettingId: uuid | null }.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { restoreMenuItemShopSetting, MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/shop/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.fromSettingId !== "string" || !UUID_RE.test(b.fromSettingId)) return jsonError(400, "invalid_payload", { field: "fromSettingId" });
  const expected = optUuid(b.expectedSettingId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedSettingId" });
  try {
    const r = await restoreMenuItemShopSetting(ctx, { menuItemId: id, locationId: b.locationId, fromSettingId: b.fromSettingId, expectedSettingId: expected });
    return jsonOk({ settingId: r.settingId, retiredSettingId: r.retiredSettingId }, 201);
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 8: Register the six routes in the tier map**

In `tests/step-up-tier-map.test.ts` `SERVER_TIER_MAP`, after 2a/2b's `app/api/admin/catalog/sku/…` entries, add:

```ts
  // Catalog Phase 3a: recipe versions and menu overlays — every write is Tier E (reversible; no grant).
  "app/api/admin/catalog/menu-item/[id]/shop/back-to-default/route.ts": ["E"],
  "app/api/admin/catalog/menu-item/[id]/shop/restore/route.ts": ["E"],
  "app/api/admin/catalog/menu-item/[id]/shop/route.ts": ["E"],
  "app/api/admin/catalog/recipe/[id]/back-to-default/route.ts": ["E"],
  "app/api/admin/catalog/recipe/[id]/lines/route.ts": ["E"],
  "app/api/admin/catalog/recipe/[id]/restore/route.ts": ["E"],
```

`CLIENT_TIER_MAP` and the grant maps do not change in 3a (no client calls these yet; 3b's pages do).

- [ ] **Step 9: Run, then commit**

Run: `npx vitest run tests/recipe-menu-version-routes.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add app/api/admin/catalog/recipe app/api/admin/catalog/menu-item tests/recipe-menu-version-routes.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): Tier E routes for recipe versions and menu overlays (lines, restore, back to default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 11: The law (AGENTS.md)

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the section** directly after 2a's `### Shop versions (0259–0260, catalog Phase 2a, 2026-10-15)` section (before `### Toast sales ingest`):

```markdown
### Recipe and menu-item shop versions (0262–0263, catalog Phase 3, 2026-10-15)

- **THE GLOBAL DEFAULT'S LIVE LINES STAY IN `recipe_inputs`; EVERY VERSION IS A ROW.** `recipe_versions (recipe, location NULL|shop, based_on, adopted_from, promoted_from, valid_from, valid_to, active)` owns a full line set in `recipe_version_lines` (immutable once committed; composite FK on the generated `scope_key` proves a line's shop is its version's shop). A shop version is written only through `save_recipe_version`; the global history is a **journal of `recipe_inputs`** written by `recipe_global_journal` from DEFERRED constraint triggers at COMMIT of every transaction that touches a recipe's lines or creates a recipe (and explicitly by `save_recipe_version`) — no writer, seed or script can skip it. A transaction journals a recipe once (a head it opened itself is brought up to date in place; an unchanged set opens nothing). **Do not add a recipe-line writer that bypasses `recipe_inputs` or a version RPC; do not truncate `recipe_inputs`** (row triggers would not fire).
- **A version covers the LINES only.** Outputs, yields, batch mode, shelf life, name and directions stay global (`lib/recipes.ts`) until a later phase versions them.
- **EDITS ARE DATED; EXISTENCE IS NOT.** Every recipe's first global version starts on 2000-01-01 (the 0262 baseline and every later recipe alike); every later edit — global or shop — is in force from the instant it was made. Depletion and the prior-day repair of business date D resolve recipes **as of the end of D** through `createDatedGraphs` (2a's D1, now for recipes too), whose cached intervals are cut at every PACK **and** RECIPE boundary (`loadCatalogBoundaries`). A global recipe edit inside the repair window moves those days to the recipe in force then — a deliberate correction (report it before apply).
- **ONE RESOLVER POINT.** `loadRecipeLineOverlay(scope, asOf)` (`lib/prep-consumption.ts`), called only by `loadRecipeGraph` and `loadResolvedRecipeInputs`, asks the pure rules in `lib/recipe-versions-shared.ts` (`pickLiveShopRecipeVersions`, `pickRecipeVersionsAsOf`, `recipeLineReplacements`). The scope is 2a's `versionLocationId` (default `locationId`), so every consumer 2a routed to a shop follows its recipes too. Wherever the answer is the live global head, the graph reads `recipe_inputs` itself (same rows, same order): the global live graph reads no version table. `recipeOverrides` (previews) goes through the same loader. **Every reader of recipe LINES resolves the shop's recipe** (lead decision 4): line-only readers use `loadResolvedRecipeInputs(scope, asOf?)` (readiness, ordering's par advisories, production's picker AND its conversion check, a location's product pins) and "is this used anywhere" answers use `loadRecipeInputsAcrossScopes()` (the SKU list's "used in", product ↔ item links, "N recipes still pin this product"); the first sits on the same `loadRecipeLineOverlay`; the second reads the default plus every live shop version's lines. The only direct `recipe_inputs` reader left is the legacy builder (`lib/recipes.ts`), which edits the global default by definition. **A new consumer of recipe lines goes through `loadRecipeGraph`, `loadResolvedRecipeInputs` or `loadRecipeInputsAcrossScopes` — never `from("recipe_inputs")`, never a second resolver.** The routing table is in the 3a plan, Task 6b.
- **EVERY SAVE IS BOUND TO WHAT THE PERSON SAW — SCOPED AND SERIALIZED.** `recipe_change_snapshot(recipe, scope, lines)` / `menu_item_change_snapshot(menu item, scope)` digest exactly the change's dependency closure (`recipe_change_closure`), never a whole table: an unrelated edit leaves a preview valid, a related one stales it. Every writer takes, in this order: the graph advisory lock 7258025800 → its target row (recipe / menu item) → `recipe_change_lock` (NOWAIT: `locations` and `measure_units` SHARE; recipes, items, recipe_outputs, primaries, overlays, vendors, menu items FOR SHARE; products and vendor_items FOR UPDATE, which also blocks every insert whose foreign key names them — receipts, prices, packs, new members, new primaries) → the snapshot re-check. Because every closure lock is NOWAIT, a Phase 3 writer never waits on a non-graph writer and cannot deadlock; a dependency being written refuses `dependencies_busy`. **A new writer of any closure table needs no new lock**: the row locks above already make it wait. A direct API call without a preview binds the snapshot it takes over the set it is about to write.
- **LINE RULES ON SAVE (lead decision (b)).** A save may not ADD or CREATE an invalid line (`addedLinePositions`; the SQL re-checks the product rule with the same "carried" match); a line already in the set may stay (`recipeLineProblem` flags it on the page). Every refusal names the line — `RecipeVersionError.line = { position, name, reason }`, returned by the routes as `line` and shown in en + es.
- **THE CYCLE LAW IS PER GRAPH.** A shop's graph is the global lines with its own live versions substituted (`recipe_scope_item_edges`). Every writer refuses `would_create_cycle` in every graph it changes, under the 0258 graph lock `7258025800` (lock order: graph lock → recipe row): a shop save → that shop; a global save → global + every active shop riding that recipe; back to default → that shop with the global lines; the re-emitted 0258 line writers → + every shop riding the global lines; the re-emitted output writers → + every active shop. The legacy line delete runs under the same lock (`remove_recipe_input_atomic`).
- **RESTORE / ADOPT / PROMOTE COPY IN SQL — AND PASS THE SAME LINE RULES.** `save_recipe_version` copies the source version's lines itself; the caller's payload is ignored for them. Every line set it writes, copied or sent, passes the add / update rules (`assertInputLineIsValid` in the lib; the product rule — active product, active measure-registry unit — again in SQL). Restore = a new version from this recipe's global history or this shop's own; adopt = a new shop version from another shop's LIVE version (`adopted_from_version_id`); promote (MoO+) = the shop's live version becomes the global default (`promoted_from_version_id`) **and, in the same transaction, the source shop returns to the default** (its version retired, closing at the instant the new default opens; history kept) — shops with their own version are untouched. Optimistic on the version the person saw (`p_expected`; a shop forking the default must have seen the current default, `p_based_on`).
- **MENU ITEMS PER SHOP.** The global default IS the `menu_items` row; `menu_item_shop_settings` holds shop rows only (price, sold here, name here), effective-dated and append-only. ONE rule: `resolveMenuItemForShop` (`lib/menu-item-shop-shared.ts`); ONE loader: `loadLiveMenuItemShopSettings`. The costing board's shop view (its margins use the shop's price — lead decision 3) and the Toast auto-match / drift read it; "All shops" and catering read the global row (catering is untouched — lead decision 2). Promote copies price/name into `menu_items` under a compare-and-set and returns the source shop to the default for those fields in the same transaction; its "changed shops" are field by field (a shop inheriting ANY promoted field changes); "sold here" is never promoted.
- **THE CUTOVER WAS CLOSED.** 0262 took `SHARE ROW EXCLUSIVE` on `recipes` + `recipe_inputs` before its backfill and created the journal triggers in the same transaction, then re-proved every baseline equal to `recipe_inputs`. Any future backfill of a journaled table follows the same order: lock, copy, install the trigger, prove — all before COMMIT.
- **GM-created shop-only recipes are Phase 4** (lead decision 6): a shop version always versions an existing global recipe.
- **PROVENANCE FOLLOWS THE CONTENT.** `adopted_from_version_id` is set by an adopt, kept by every edit of the copy, and on a restore taken from the restored version — so restoring the adopted lineage keeps the link and restoring a version from before the adoption ends it, like Back to default (the preview says so; History records it).
- **AUTHORSHIP ON LEGACY EDITS.** The legacy builder's line edit calls `update_recipe_input_atomic(…, p_actor)` (0262's overload), so its journaled version records who. The 16-argument signature is kept only for code deployed before 3a and is **dropped by the first Phase 4 migration** — do not add a caller to it.
- **PERMISSIONS LIVE IN THE LIB AND THE DATABASE.** A GM (7) writes only its own shops' recipe versions and menu overlays (`requireLocation` before any I/O); MoO (8)+ any active shop (`catalogShopAllowed`) and the global default; a GM never edits the global recipe (`global_requires_moo`). Reads are org-wide at 6 (recipes are the company's knowledge; adopt needs them). Routes are Tier E; no Phase 3 act takes a one-shot grant (deleting a recipe stays `recipe.delete`).
- **The equivalence pin is permanent.** `tests/recipe-versions-equivalence.test.ts` (golden frozen before the change) + 2a's two pins: with no shop versions and no overlays, every recipe oz, cost, dated depletion and menu-board number is byte-identical.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs(agents): the recipe and menu-item shop-versions law (0262–0263)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 12: Apply runbook — sim → prod dry-run with rollback → prod → stamp

**Gate:** all of these must hold:
- CC has reviewed the PR (Astra review to APPROVE per spec §7);
- CI is green;
- Juan gives the word for each production step.

Use the Supabase MCP. The sim project is the one `scripts/sim/dev-sim.mjs` points at; prod is `bgcvurheqzylyfehqgzh`. **0262 and 0263 apply BEFORE the 3a code merges** (the code reads their tables; both are backward compatible with the code running now).

- [ ] **Step 1: Pre-flight on prod (read-only).**

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 6;  -- 0257–0261 applied
select count(*) as recipes from public.recipes;
select count(*) as recipe_inputs from public.recipe_inputs;
select to_regclass('public.recipe_versions') as rv, to_regclass('public.menu_item_shop_settings') as miss;  -- null, null
select count(*) from public.locations where active;   -- the shops every sweep checks
-- No live recipe graph may already hold a loop (the per-shop sweeps assume a loop-free start).
-- Edge: item X (made by recipe R) depends on item Y (an input line of R). UNION terminates on a loop.
with recursive reach(start_item, item_id) as (
  select ro.output_item_id, ri.component_item_id
    from public.recipe_outputs ro
    join public.recipe_inputs ri on ri.recipe_id = ro.recipe_id
   where ro.output_item_id is not null and ri.component_item_id is not null
  union
  select r.start_item, ri.component_item_id
    from reach r
    join public.recipe_outputs ro on ro.output_item_id = r.item_id
    join public.recipe_inputs ri on ri.recipe_id = ro.recipe_id and ri.component_item_id is not null
)
select count(distinct start_item) as items_in_a_loop from reach where item_id = start_item;   -- 0
```

Record the numbers in the PR. A non-zero `items_in_a_loop` is a STOP (report the loop to Juan; 0262 would refuse every later edit touching it).

- [ ] **Step 2: Sim cutover rehearsal, then sim apply with the independent before/after proof.**
  1. *The cutover guard fires* (Astra 3a r1#4). Through `execute_sql` on the sim: `begin;` · the 0262 body without its own `begin;`/`commit;`, with ONE statement inserted directly above the `-- ── (5) the journal` marker line: `update public.recipe_inputs set quantity = quantity + 1 where id = (select id from public.recipe_inputs order by id limit 1);` (a line write landing between the copy and the triggers) · `rollback;`. Expected: it fails with `0262: 1 baseline versions differ from recipe_inputs — a line write landed during the cutover`. Confirm `select to_regclass('public.recipe_versions');` → `null`. (A real concurrent writer cannot reach that point at all: (0)'s `SHARE ROW EXCLUSIVE` makes it wait for COMMIT; this rehearsal proves the second guard too.)
  2. *BEFORE capture* of the sim (Task 1 Step 8, base list) into `tmp/recipe-snap-before/`; compute it with the Task 1 commit's code (`RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-before RECIPE_VERSIONS_SNAPSHOT_OUT=tmp/recipe-before-sim.json …` in the Task 1 worktree) → 1 passed.
  3. `apply_migration` name `0262_recipe_shop_versions` (the file body), then `0263_menu_item_shop_settings`. Run every VERIFY query in both headers. Expected: as annotated — global versions = recipes, baseline lines = recipe_inputs, the per-recipe equality count 0, every version from 2000-01-01, the two journal triggers, service_role at its ceilings, EXECUTE for service_role only.
  4. *AFTER capture* of the sim (base list + the four persisted tables) into `tmp/recipe-snap-after/`; on the final branch: `RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-after RECIPE_VERSIONS_SNAPSHOT_BASELINE=tmp/recipe-before-sim.json npx vitest run tests/recipe-versions-snapshot.test.ts` → 1 passed (journal verified from the real rows, fingerprint equal, numbers equal).

- [ ] **Step 3: Sim real-SQL scenario.** Run `scripts/recipe-versions/sim-scenario.sql` through `execute_sql` on the sim. Expected: it fails with exactly `recipe versions scenario: OK (rolled back)`. Any other message is a defect to fix before going on. Then confirm nothing persisted: `select count(*) from public.recipe_versions where location_id is not null;` → 0.

- [ ] **Step 3b: Two-session serialization check (sim; Astra 3a r2#3).** Issue the two `execute_sql` calls below IN PARALLEL (one message, two tool calls), with `<RECIPE>` a recipe that has a SKU line `<SKU>` and `<SHOP>` an active shop:
  - Session A (holds the closure for 8 s, then rolls back): `do $$ begin perform pg_advisory_xact_lock(7258025800); perform public.recipe_change_lock('<RECIPE>', '<SHOP>', null); perform pg_sleep(8); raise exception 'session A done'; end $$;`
  - Session B (starts ~1 s later — put `select pg_sleep(1);` first — and tries a 0259 price write on the closure SKU): `do $$ declare t0 timestamptz := clock_timestamp(); begin perform public.save_sku_global_price('<SKU>', 9.99, current_date, null, false); raise exception 'session B waited % s', round(extract(epoch from clock_timestamp() - t0)); end $$;` (0259's `save_sku_global_price(p_sku, p_unit_price, p_effective_date, p_actor, p_first_only)`).
  - Expected: A fails with `session A done`; B fails with `session B waited 7 s` (or 6–8): the price writer could not commit while the closure was held. Repeat with B as `insert into public.vendor_delivery_items …` against `<SKU>` (a receipt) — same wait. Then reverse the roles (B holds the SKU row with `perform 1 from public.vendor_items where id = '<SKU>' for update; perform pg_sleep(8);`, A calls `recipe_change_lock`): A fails at once with `recipe_version:dependencies_busy` — it never waits, so it can never deadlock.

- [ ] **Step 4: Sim smoke.** `node scripts/sim/dev-sim.mjs`. With no shop versions, `/admin/menu-costing` (All shops and each shop), `/ordering`, `/operations/counts` show the same numbers as before the apply (screenshot). Then, signed in as a GM on the sim with the edit window open:

```bash
curl -s -X POST http://localhost:3100/api/admin/catalog/recipe/<RECIPE_ID>/lines \
  -H "content-type: application/json" -H "cookie: <sim session cookie>" \
  -d '{"locationId":"<GM_SHOP_ID>","expectedVersionId":null,"basedOnVersionId":"<GLOBAL_HEAD_ID>","op":{"kind":"update","lineId":"<RECIPE_INPUT_ID>","line":{"componentSkuId":"<SKU_ID>","quantity":5,"unit":"oz"},"expected":{"componentSkuId":"<SKU_ID>","quantity":4,"unit":"oz"}}}'
```

(`<GLOBAL_HEAD_ID>`: `select id from recipe_versions where recipe_id = '<RECIPE_ID>' and location_id is null and active;`.) Expected: `201 {"versionId":…,"changed":true}`; `/admin/menu-costing?location=<GM_SHOP_ID>` shows the new cost for that sandwich, the other shop does not; a GM of the OTHER shop gets `404` on the same call with its shop swapped in; the same GM with `"locationId":null` gets `403 global_requires_moo`. Then `POST …/back-to-default` with the returned `versionId` → `200`, and the shop's cost returns. A menu overlay: `POST /api/admin/catalog/menu-item/<MENU_ID>/shop` with `{"locationId":"<GM_SHOP_ID>","expectedSettingId":null,"price":13.5,"soldHere":true}` → `201`; the shop's board shows $13.50.

- [ ] **Step 5: Prod dry-run with rollback.** Through `execute_sql` on prod, in this order: `begin;` · the 0262 body **without** its own `begin;`/`commit;` · the 0263 body without its own `begin;`/`commit;` · the VERIFY queries of both · `rollback;`. Expected: every VERIFY as annotated, then the rollback; confirm with `select to_regclass('public.recipe_versions');` → `null`.

- [ ] **Step 6: Prod apply** (Juan's word), in a window Juan names as quiet (no deliveries, counts, prep captures or catalog edits in flight):
  1. *BEFORE capture* of prod (Task 1 Step 8, base list) into `tmp/recipe-snap-before/`, IMMEDIATELY before the apply; compute it in the Task 1 worktree: `RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-before RECIPE_VERSIONS_SNAPSHOT_OUT=tmp/recipe-before.json npx vitest run tests/recipe-versions-snapshot.test.ts` → 1 passed.
  2. `apply_migration` `0262_recipe_shop_versions`, then `0263_menu_item_shop_settings`. Re-run the VERIFY queries read-only.
  3. *AFTER capture* of prod (base list + the four persisted tables) into `tmp/recipe-snap-after/`, IMMEDIATELY after; on the final branch: `RECIPE_VERSIONS_SNAPSHOT_DIR=tmp/recipe-snap-after RECIPE_VERSIONS_SNAPSHOT_BASELINE=tmp/recipe-before.json npx vitest run tests/recipe-versions-snapshot.test.ts` → 1 passed.
  4. If it fails on the journal check: STOP — the persisted backfill is wrong; report to Juan before the code merges. If it fails ONLY on the fingerprint ("base tables moved between the captures"), the prod comparison is **inconclusive**, not passed: record which tables moved (the failure lists them per table) in the PR, keep the journal check's pass, and rely on Step 2's sim pair for the numbers. Never re-take the BEFORE from the AFTER export — that compares the migration with itself.

- [ ] **Step 7: Merge** (Juan clicks the production merge). Vercel deploys main.

- [ ] **Step 8: Stamp the headers** in a docs-only follow-up commit on main (AGENTS.md allows pure docs): under each gate line add `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '<name>')`, the version read from `supabase_migrations.schema_migrations`; update the AGENTS.md "Current state" lineage line to 0263.

---

## Task 13: Final verification

- [ ] **Step 1: Full unit suite** — Run: `npx vitest run`. Expected: every file passes, 0 failed; `tests/recipe-versions-snapshot.test.ts` and `tests/shop-versions-snapshot.test.ts` report skipped.
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: exactly the 6 known Leaflet `TS2307` errors, nothing else.
- [ ] **Step 3: Lint and build** — Run: `npm run lint && npx next build`. Expected: lint clean; build succeeds.
- [ ] **Step 4: The golden is untouched** — Run: `git log --oneline -- tests/fixtures/recipe-versions-golden.json`. Expected: exactly one commit (Task 1's).
- [ ] **Step 5: Sim browser walk (port 3100)** — phone (390×844), tablet (820×1180), desktop (1440×900), en and es:
  1. `/admin/menu-costing` All shops and each shop: every row's cost, price and status equal the pre-branch screenshots (no versions, no overlays).
  2. `/ordering` and `/operations/counts` at each shop: unchanged.
  3. After Task 12 Step 4's curl: the shop's board shows the new sandwich cost, the other shop does not; "Not sold at this shop" appears in Spanish and English after an overlay with `"soldHere":false`.
  4. `/admin/recipes/<id>`: the legacy builder still edits lines as today (a GM's edit is global until 3b flips it); deleting a line works (now through the locked RPC).
  5. Yesterday's depletion at the shop is unchanged after the shop version (`GET /api/cron/toast-sales-pull?date=<yesterday>` with the sim cron secret, then `select business_date, direct_oz from toast_daily_depletion where location_id = '<SHOP>' and sku_id = '<SKU>' order by business_date desc limit 3;`).
  6. Lead decision 4 on the sim: give the GM's shop a version of a prep recipe that swaps one SKU for another (Task 12 Step 4's curl, `op.kind = "update"` with a new `componentSkuId`). At that shop, `/operations/production` offers the NEW SKU → the prep item and records it; the old SKU is no longer offered there and its submit returns `invalid_conversion`; the other shop is unchanged. `/ordering` at that shop shows the new SKU with a recipe source and the old one without. `/admin` hub's "not ready" count still counts that recipe if the shop's version is not ready.
- [ ] **Step 6: Open the PR** — title `feat(catalog): Phase 3a — recipe and menu-item shop versions, dated recipes, one resolver, equivalence pin`; body lists 0262 and 0263 as NOT APPLIED, links this plan, pastes the Task 12 pre-flight numbers, and ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
```

---

## Self-review against the spec (3a's share)

| Spec requirement | Where |
|---|---|
| §3 recipes are shop-versionable; a GM/AGM edit creates/updates the shop's version, `based_on` recorded | Tasks 3 (`save_recipe_version`, `based_on_version_id`), 7 (`saveRecipeLines` → shop scope) |
| §3 one resolver per kind, never a second time in a consumer; per-shop recipe graph | Tasks 2, 5 (`loadRecipeLineOverlay` inside `loadRecipeGraph`, scope = 2a's `versionLocationId`) |
| Phase 2a open question 1 (recipes current, not dated) | Tasks 3 (journal, dated versions), 5 (as-of overlay, catalog boundary) |
| §3 the equivalence precondition (fixture matrix + prod-shaped snapshot) | Task 1 (+ 2a's pins kept green every task) |
| §3 menu items per shop: price, sold here, name override | Tasks 4, 6 |
| §3 adopt / promote / back to default (data) | Task 3 (`p_adopted_from`, `p_promoted_from`, `retire_recipe_version`), Task 4 (promote menu) — UI in 3b |
| §3 history append-only and audited | Tasks 3, 4 (no DELETE anywhere; ceilings), 7, 8 (closed audit names) |
| §2 GM own shop (lib bind), MoO+ any shop and global | Tasks 2, 6, 7, 8, 10 (gates before I/O, differential bind registration) |
| §4 Tier E for edits; destructive acts keep the grant | Task 10 (no `consumeStepUpGrant` pinned) |
| §8 resolver tests (shop beats global; retired falls back), permission tests (bind holds when the route is bypassed) | Tasks 2, 5, 7, 8 |
| Database hardening (deny-all RLS, privilege ceilings, definer + pinned search_path, faithful re-emits) | Tasks 3, 4 |
| The cycle law evaluates the graph each shop actually resolves | Tasks 2 (mirror), 3 (SQL), 3 Step 6 (real-SQL scenario) |
| Lead decision 1 — yields stay global (a version is the LINES only) | Task 3 (no yield column on a version), Task 11 law |
| Lead decision 2 — catering untouched | Task 6b routing table (no catering file edited; prices global) |
| Lead decision 3 — a shop's board margins use the shop's overlay price | Task 6 Step 4 (`typedPrice` from the overlay), Step 8 test |
| Lead decision 4 — every consumer reads the shop's resolved recipe (production, prep demand, depletion, prior-day repair, ezCater, readiness, par advisories, item-page connections) | Task 5 (graph), Task 6b (routing table + direct readers + `tests/recipe-consumers-shop-scope.test.ts`) |
| Lead decision 5 — promote returns the source shop to the default, atomically | Task 3 (`save_recipe_version` retires `p_promoted_from` in the same transaction; pin + sim scenario (d)); Task 4 (menu promote) |
| Lead decision 6 — GM-created shop-only recipes wait for Phase 4 | Task 11 law; no writer creates a recipe for a shop |
| Lead decision (a) — scoped snapshots, serialized re-validation | Task 3 (0262 (7a): closure, snapshot, locks, lock order), Task 4 (0263), Tasks 7–8 (loaders), Task 12 Step 3b |
| Lead decision (b) — no added/created invalid line; carried lines flagged; refusals name the line | Task 3 (SQL `:<position>`), Task 6b Step 2 (`addedLinePositions`, `recipeLineProblem`), Task 7 (lib + tests), Task 10 (routes return `line`) |
| Lead decision (c) — attributed hub readiness | Task 6b Step 4 items 5–7 (+ test) |
| Rule — the legacy builder's MoO-only line restriction ships with 3b, never 3a alone | 3a changes no legacy permission (Task 9 only re-routes the delete through the locked RPC) |

**Placeholder scan:** every step names exact files, exact replaced text, and complete new code; the only conditional instructions are explicit fallbacks with the command that decides them (a renumber if 0262/0263 is taken; an INCONCLUSIVE prod proof, never a re-taken baseline, if prod data moved between the captures).

**Type consistency:** `RecipeVersionRow`, `RecipeVersionLineRow`, `LiveRecipeLine`, `RecipeLineOp`, `RecipeLineChange` (Task 2) are used by Tasks 5, 7 and 3b unchanged; `MenuItemShopSettingRow`, `MenuShopPatch`, `ResolvedMenuItem` (Task 6) by Tasks 8 and 3b; `ResolvedRecipeInput` / `mergeResolvedInputs` (Task 6b) back `loadResolvedRecipeInputs` and `loadRecipeInputsAcrossScopes`; `RecipeChangeSnapshot` / `MenuChangeSnapshot` (Tasks 7, 8) are what 3b's previews carry; the RPC parameter names match the SQL: `p_recipe, p_location, p_lines, p_expected, p_based_on, p_note, p_actor, p_restored_from, p_adopted_from, p_promoted_from, p_snapshot`; `p_version, p_location, p_actor, p_snapshot`; `p_input_id, p_actor`; `p_recipe, p_location, p_lines` (`recipe_change_snapshot`); `p_menu_item, p_location, p_price, p_sold_here, p_name, p_name_es, p_expected, p_note, p_actor, p_restored_from, p_snapshot`; `p_setting, p_location, p_actor, p_snapshot`; `p_setting, p_fields, p_expected_price, p_expected_name, p_expected_name_es, p_actor, p_snapshot`; `p_menu_item, p_location` (`menu_item_change_snapshot`).

**Astra round 1 (3a) — finding by finding:**

| # | Finding | Resolution |
|---|---|---|
| P1-1 | Shop versions do not reach all operational consumers | Task 6b: `loadResolvedRecipeInputs` / `loadRecipeInputsAcrossScopes` on the one overlay; readiness (required scope; hub counts every shop), par advisories, production picker AND conversion check, product pins, "used in", product links; routing table covering production, prep demand, depletion, prior-day repair, ezCater, readiness, par advisories, item-page connections; a differing-shop-recipe test (mayo → pickle). AGENTS law rewritten. |
| P2-2 | Promote leaves the source detached | 0262 `save_recipe_version` retires the source in the same transaction (`valid_to` = the new default's `valid_from`), reports `returned_shop`; pins + sim scenario (d); 3b preview/notices/judgment call updated. Menu promote does the same for the promoted fields (0263). |
| P2-3 | Preview not bound to its dependencies | `recipe_change_snapshot` / `menu_item_change_snapshot` (the 0261 pattern) re-taken under the lock by every writer → `dependencies_changed`; lib types + loaders; 3b tokens carry the snapshot and the displayed numbers. |
| P2-4 | Backfill-before-journal gap | 0262 (0): graph lock + `SHARE ROW EXCLUSIVE` on `recipes`, `recipe_inputs` before the backfill; triggers in the same transaction; (5b) per-recipe equality proof; pin; Task 12 Step 2.1 rehearses the gap write and sees the guard fire. |
| P2-5 | Restore/adopt/promote bypass the product validator | `writeRecipeVersion` validates every line of the set it writes, copied sets included; 0262 enforces the product rule (active product, active measure unit) on every line in SQL; a restore test with a pack-word product line. |
| P2-6 | History truncates | `loadRecipeVersionHistory` paged + id-chunked (versions, lines, users); `loadRecipeLiveSet`, `loadVersionLineFields`, `loadMenuItemShopHistory` paged; a 60 × 20 test past the cap. |
| r2-1 | Whole-table digests | `recipe_change_closure` + scoped `recipe_change_snapshot` / `menu_item_change_snapshot`; sim scenario (g): an unrelated SKU leaves the snapshot alone, a closure SKU moves it. |
| r2-2 | Product-resolution inputs missing | The closure takes every product MEMBER; the snapshot covers products (active, unit_oz), members, primaries (global + affected shops), activation overlays, vendors (active, source kind) and receipts at the affected shops. |
| r2-3 | Re-validation not serialized | `recipe_change_lock` / `menu_item_change_lock` after the graph lock and the target row, NOWAIT, held to COMMIT; the lock order is stated in 0262 (7a) and AGENTS.md; Task 12 Step 3b runs two sessions against it. |
| r2-4 | Refusal does not say which line | Only ADDED / CREATED lines are judged; a refusal carries `{ position, name, reason }` from the lib and `:<position>` from SQL; routes return it; 3b shows it beside the line, en + es. |
| r8 | Back to default overwrote an earlier end record | The retirement writes the column only when IT ends a link — `coalesce(existing, new)`, never nulling; every closing UPDATE (journal, shop save, back to default, all three menu writers) now targets `… and active` only, so a retired row's history is never rewritten (grep of both plans: no other UPDATE of a history/audit column); pin + PGlite sequence (5) adopt → restore pre-adoption → back to default, both entries survive. |
| r7 | History inferred the link's end from based_on (wrong for restores) | 0262 records it: `adoption_ended_from_version_id` on a restore's new row (the REPLACED version that carried the pointer) and on a Back-to-default retirement (the retired row), in the writer's transaction; History reads the column only; the REAL writers run in PGlite (`tests/fixtures/recipe-versions-pglite.ts`) for adopt → restore pre-adoption / restore global / back to default / restore adopted lineage. |
| r6 | Restoring pre-adoption history drops provenance | LEAD DECISION: provenance FOLLOWS THE CONTENT — a restore takes the restored version's pointer: kept for the adopted lineage, ended for a version from before the adoption (intended, like Back to default); 3b's preview says "This drops the link to <shop>'s recipe — you'll stop getting its updates." (en + es) and History records "Link to <shop>'s recipe ended"; tests for both sequences in 3b. |
| r5-1 | Editing an adopted recipe stops source notices | 0262 keeps `adopted_from_version_id` across edits (a restore takes the restored version's — r6); 3b's notice says "you've changed your copy since adopting it" (en + es), dismissible per state seen; pin + notice test (adopt → local edit → source update). |
| r4-1 | Legacy edits lose authorship | A NEW overload `update_recipe_input_atomic(…16…, p_actor uuid)` (generated from 0258's body + the journal actor + the shop sweep), same ceiling; `updateRecipeInput` calls it; the 16-argument writer stays through the deploy window and is dropped by the first Phase 4 migration; pin + sim scenario (c0). |
| r4-2 | Shop item warnings open the global catalog | `readinessScopeHref` links items to `?view=registry&location=<shop>`; `itemsLandingView` opens the registry for a scoped link; tests. |
| r3-1 | Dated graphs target a removed API | Rebased on merged 2a: `createDatedGraphs` caches per INTERVAL; Task 5 cuts the intervals at pack AND recipe boundaries (`loadRecipeBoundaries`, `loadCatalogBoundaries`); a test with two recipe versions inside one pack interval. |
| r3-2 | Flat-pack measures missing | The closure takes each closure SKU's `each_measure` registry row (its `units_per_pack` / `each_size` / `avg_oz_per_each` are in the SKU row digest); sim scenario (h). |
| r3-3 | Copied broken lines / SQL multiplicity | A copied set carries nothing (lib + SQL `v_copy`); an edit's carried lines are counted with multiplicity (`v_seen > v_have`); test. |
| r3-4 | Shop readiness used global SKU readiness | `loadSkuReadinessMap(actor, scope)` — the shop's price lane and pack versions; `tests/readiness-shop-scope.test.ts`. |
| 3b r3-2 | Untouched shops stale a global preview | The closure's scopes are exactly the preview's reached set (a shop target alone; the default + riding shops; NIL = the global view alone for a menu promote); sim scenario (i). |
| r2-5 | Hub count loses the shop | `attributeNotReady` (per-scope counts), the hub lists "N at P Street" links, and the recipes / items lists read `?location=`. |
| P2-7 | Snapshot proof reconstructs what it verifies | The snapshot test never synthesizes; BEFORE must predate 0262/0263, AFTER must carry the persisted tables, the journal is checked from the real rows, base-table fingerprints must match; sim pair around the sim apply; prod pair around the prod apply; a moved-data result is INCONCLUSIVE, never re-baselined. |

**Judgment calls and open questions** for all of Phase 3 are listed once, at the end of Part 3b (`docs/superpowers/plans/2026-10-15-catalog-phase3b-recipe-menu-pages-adopt-promote.md`).
