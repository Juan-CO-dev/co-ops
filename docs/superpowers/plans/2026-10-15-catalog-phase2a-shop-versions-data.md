# Catalog Redesign — Phase 2 (Shop Versions: Pack, Price, Sourcing + Item Page) Implementation Plan

## Part 2a of 2 — data model, the one resolver, the equivalence pin, permissions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision r2 (2026-10-15).** This revision answers Astra's review (CHANGES REQUESTED, 12 findings) and the lead's decisions D1–D5:
- **D1:** pack versions are effective-dated, and historical depletion resolves as of its business date.
- **D2:** MoO+ may write any active shop's version.
- **D3:** auto pars are stamped with the effective pack version and checked in both the walk and the submit.
- **D5:** the global-write boundary is enforced in 2a on every existing writer, atomically.
- **Numbering:** Phase 1 owns 0257 and 0258, so 2a is **0259** (versions) + **0260** (finalize), and 2b is **0261**.

The finding-by-finding map is at the end of this file.

**Goal:** Give every SKU a shop version of its pack chain and its price, beside the global default, using the house idiom `location_id NULL = global`. Route every consumer through one resolver: this shop's version in force, else the global one. Prove first, with a golden-master differential, that with no shop versions present every live number is identical to today. Pack versions are **effective-dated**, so a past business date resolves through the packs in force that day. Enforce the permission boundary **inside the lib and the database**: AGM/GM write only their own shop's version; MoO+ write any shop and the global default; a GM/AGM may set a SKU's *first* global value only, decided atomically under a SKU lock. Pin how a pack change retires a machine par. **2a ships no new screen.** Production numbers move only when somebody makes a shop version, or when a past day is rebuilt across a global chain change (D1, a deliberate correction). **Part 2b** (`docs/superpowers/plans/2026-10-15-catalog-phase2b-item-page-jobs.md`) adds the item page, the change preview and the two jobs.

**Architecture:**
- **Pack chains.** The chain-as-a-set becomes a row: `sku_pack_versions (sku_id, location_id NULL = global, based_on_version_id, valid_from, valid_to, active)`. It is append-only. A save closes the old version (`valid_to`) and opens a new one, so the history is the effective-date timeline. Every existing level set is backfilled into a global version with its real dates. Levels gain `version_id`, a denormalized `location_id` and a generated `scope_key`; a composite FK proves from the database that a level's shop is its version's shop.
- **Prices.** The ledger stays one append-only table. `vendor_price_history` gains `location_id` (NULL = global) and `price_lane_id`. A shop's own price is an explicit lane (`sku_price_lanes`) that "back to default" retires.
- **Writes.** Every write is an RPC that takes the SKU row lock first: `save_sku_pack_version` (with `p_first_only`), `retire_sku_pack_version`, `save_sku_shop_price`, `save_sku_global_price` (with `p_first_only`), `retire_sku_price_lane`, and `record_receiving_prices`, which resolves the lane and appends under the lock. The two live SQL chain writers (0211 vendor import, 0216 store copy) are re-emitted mechanically. The store-copy re-emit derives its flat mirror from the chain it actually cloned.
- **The one resolver.** The pure rule lives in `lib/sku-versions-shared.ts`: `resolvePackLevels` (live), `pickVersionsAsOf` + `packsFromVersions` (as of an instant), `resolveCurrentPrices`, `contentOzForScope`, `catalogShopAllowed`, `versionWriteGate`. The I/O sits at the existing loader points, with a **required** scope parameter: `loadSkuPackChains` / `loadSkuPackResolution` (paged, chunked; optional `asOf`), `loadAllSkuPackChains`, `loadRecipeGraph({ locationId, versionLocationId, asOf })`, `createDatedGraphs`, and `loadCurrentSkuPrices`.
- **Dated graphs.** Depletion for business date D resolves packs `asOf` D (D1). Live screens use now. Receipts and counts keep their stored ounces.
- **Dynamic Pars.** A machine par carries the effective pack version it was computed against. Any change of the effective version retires it at read time, through one shared overlay loader that both the walk and its submission use (D3).

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres 17 (service role, SECURITY DEFINER RPCs), vitest 4, tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md`, §2 (permissions), §3 (global defaults + shop versions; "past counts, receipts and sales are never re-resolved"), §7 (Phase 2), §8 (testing), §9 (the Dynamic Pars open item).

**Builds on Phase 1** (`docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md`, merged first with its migrations `0257_step_up_catalog_window_and_grants` and `0258_recipe_input_write_atomic` applied):
- Tier E on its own clock (`assertStepUp(ctx, "E")` reads `sessions.catalog_edit_unlocked_at`).
- The one-shot grants (`mintStepUpGrant` / `consumeStepUpGrant`) for destructive acts.
- `useStepUpPost`, `skuCatalogHref` / `readFocusParam`, `chainNeedsAvgOzPerEach`.
- The privilege-ceiling migration pattern (0257).
- The advisory-locked recipe input writer (0258): `addRecipeInput` / `updateRecipeInput` write recipe lines through it. Phase 2 writes no recipe line. Any later change that does must build on that RPC and never write `recipe_inputs` directly.

No Phase 2 act takes the one-shot grant. Saving, restoring and back-to-default are all reversible: every version and price row stays, and Restore or a new value undoes them. So every Phase 2 write is an ordinary catalog edit at Tier E.

**Working copy:** `C:\Users\conta\co-ops-guides` (or the build worktree CC assigns). Branch once Phase 1 is on `origin/main`:

```bash
git fetch origin && git checkout -b feat/catalog-phase2a-shop-versions origin/main
ls supabase/migrations | tail -3
```

Expected: Phase 1's `0257_step_up_catalog_window_and_grants.sql` and `0258_recipe_input_write_atomic.sql` are present; another branch holds 0256. Phase 2's migrations start at **0259**. **If 0259 or 0260 is taken, renumber this plan's two migrations to the next free pair, then rename every `0259`/`0260` literal in this plan's files and tests first.** The pin tests assert the file names.

**Standing rules for every task:**
- Read `AGENTS.md` first. It is the law-book: closed audit vocabulary, location bind inside the lib, deny-all RLS with a service-role privilege ceiling, the batch-loader law, en + es in the same PR, and tú Spanish.
- Use the sim only (`node scripts/sim/dev-sim.mjs`, http://localhost:3100). Production is touched only by the read-only snapshot export (Task 1 Step 8) and the gated apply runbook (Task 14).
- **Do not apply any migration** outside Task 14.
- Every commit message ends with the two trailer lines shown in each commit step.
- The equivalence pin must stay green after every later task: `npx vitest run tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts`.

---

## Ground truth this plan is built on (verified 2026-10-15 against `main` @ 98340c95)

| Fact | Where |
|---|---|
| Pack chains are `sku_pack_levels` rows: `sku_id, label, contains_qty, contains_level_id XOR contains_measure_unit, display_ordinal, effective_from, active, created_by`. There is **no version row**. A "version" is the set superseded together. Unique `(sku_id, label) WHERE active`. RLS is the deny-all triad. | `supabase/migrations/0159_sku_pack_levels.sql:34-74` |
| 0159's council lock L4 ("per-location variance = separate location-scoped vendor_items rows … NO location_id on this table") is **superseded** by the Juan-approved spec §3. AGENTS.md records it. | `0159:24-25`; spec §3 |
| The TS chain writer deactivates **every** active level of the SKU, inserts the new set, then best-effort syncs the flat mirror. Floors: read 6, write 7. Audit `sku.pack_chain_update`. | `lib/admin/pack-chain.ts:45-48, 275-298, 314-386` |
| Two live SQL chain writers. `apply_vendor_import` locks and reads `where sku_id = v_sku_id and active`, then reads the unscoped price head. `receiving_create_store_item` inserts the store copy with the **reference's flat pack fields** (0216:155-161), then clones its active levels (0216:170-177). | `0211_vendor_import.sql:171-188, 273-278`; `0216_receiving_store_runs.sql:104-180` |
| `vendor_price_history` (`id, vendor_item_id, unit_price DECIMAL(10,2), effective_date, recorded_at DEFAULT now(), recorded_by` + 0177 `source, source_note`) has RLS read policy level ≥ 6. | Foundation spec `:613-624`; `0177`; `0058:166` |
| `recordSkuPrice` inserts a GLOBAL price at AGM+ with no lock. Receiving builds rows with `receivingPriceRows` and inserts them directly at `lib/receiving.ts:574` and `:1293`. | `lib/admin/cost.ts:226-262`; `lib/receiving-shared.ts:188-201` |
| `updateSku` writes the flat pack fields (`pack_format, units_per_pack, each_size, each_measure, each_container_label`) at GM+ in one unconditional UPDATE. For an unchained SKU those fields **are** its global pack. | `lib/admin/skus.ts:765-880` |
| THE pack loaders are `loadSkuPack` (private), `loadSkuPackChains(skuIds)` (unpaged single query), `loadAllSkuPackChains()` (paged), and `loadRecipeGraph(opts?: { locationId })`, where `locationId` scopes **product** resolution only. THE price loader is `loadCurrentSkuPrices(skuIds)`. A private copy lives in purchase orders (`loadLatestPriceCentsBySku`). | `lib/prep-consumption.ts:51-130, 178-270`; `lib/admin/cost.ts:79-106`; `lib/purchase-orders.ts:817-848` |
| **Two flat-only consumers** never read a chain. Manual production writes `input_oz = qty × flat content` (`lib/production.ts:93-100, 381-397`). Catering surplus divides shop ounces by flat content (`lib/catering/surplus.ts:162-177`, `num(x) \|\| null` quirk included). | listed |
| **Historical sales are rebuilt.** The cron materializes T-1 and repairs T-2/T-3 (`lib/toast-sales-pull-run.ts:80-91` → `materializeCapturedDepletion`). The graph is loaded date-blind at `lib/catering/toast-sales.ts:565` and `:1002`; `loadSalesConsumptionContext` reuses one graph across a window (`:796-834`). ezCater does the same (`lib/ezcater/depletion.ts:76-97`; `lib/ezcater/pass2.ts:52-56, 169`). | listed |
| `operationalDayUtcRange(date)` gives the ET business day's `[startIso, endExclusiveIso)` and is pure. | `lib/operational-day.ts:134-140` |
| Location bind: `lockLocationContext` grants all shops at **level 9** only. MoO = 8, GM = 7, AGM (and catering/prep/social managers) = 6. `writeParFromSuggestion` binds inside the lib, before any I/O. | `lib/locations.ts:13-44`; `lib/roles.ts:47-57`; `lib/dynamic-pars.ts:1222-1238` |
| Dynamic Pars: `resolveLane` = human ?? auto (only if `autoBaseline === global`) ?? global. The machine writes `auto_*_par / _baseline_par / _applied_at` through `parWriteColumns`. Auto-apply is SHADOW in prod, so auto values are null today. | `lib/location-sku-shared.ts:63-71`; `lib/dynamic-pars-shared.ts:1000-1091`; AGENTS.md "Dynamic pars" |
| **The walk and its submission load overlays separately.** `loadWalkerData` resolves pars for display (`lib/ordering.ts:781-797`). `submitParPass` re-reads the overlay and resolves the par that sets implied on-hand (`:1520-1561`). | listed |
| The differential location-bind test lists tables, RPCs and files; a writer must name a bind primitive (`requireLocation` counts). | `tests/location-bind-differential.test.ts:37-128` |
| Source pins this plan must keep or update: `tests/silent-read-fabrication.test.ts:143` (`loadSkuPackChains` throws); `tests/receiving-store-prices.test.ts:41-42` (the two `receivingPriceRows(...)` call texts); `tests/fixtures/counts-v0-oracle.ts:211,1029` (`loadSkuPackChains(ids)`). | listed |
| An in-memory PostgREST stand-in exists. It supports `select/eq/is/not-is/in/gt/gte/lt/lte/or(is.null|eq)/order/range/limit/maybeSingle/upsert`, but **not `insert`** (Task 5 adds it). The B9 equivalence test is this plan's **on-hand pin**. | `tests/fixtures/counts-fake-db.ts`; `tests/counts-onhand-equivalence.test.ts` |
| The privilege-ceiling pattern: revoke ALL from `public, anon, authenticated, service_role`, grant exactly the needed set, then assert the forbidden set (`DELETE/TRUNCATE/REFERENCES/TRIGGER`) and the required set. | Phase 1 plan, 0257 (`:497-540`) |
| Migration pin idiom: re-emit from the latest definer plus an enumerated `[old, new]` list, proven as a line-subsequence. | `tests/under-par-alert-recipients-migration.test.ts` |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/fixtures/shop-versions-fixture.ts` | create | The fixture matrix (counts fixture + recipes, items, menu outputs, prices) in the post-0259 shape. |
| `tests/fixtures/shop-versions-harness.ts` | create | One compute function over the resolver API: every number the pin covers, per scope. |
| `tests/fixtures/shop-versions-golden.json` | create (generated) | Today's numbers, frozen before any change. |
| `tests/shop-versions-equivalence.test.ts`, `tests/shop-versions-snapshot.test.ts` | create | Golden compare plus anchors; env-gated read-only snapshot compare. |
| `lib/sku-versions-shared.ts`, `tests/sku-versions-shared.test.ts` | create | The pure resolver (live, as-of, prices, flat content), the catalog shop allowance, the gates. |
| `supabase/migrations/0259_sku_shop_versions.sql` | create | Versions (effective-dated, with a pre-chain flat baseline) + backfill, level columns, price lanes, pack epochs + trigger, the in-transaction flat mirror, six RPCs, two re-emits, privilege ceilings. |
| `supabase/migrations/0260_sku_pack_versions_finalize.sql` | create | After deploy: heal the window, then `version_id NOT NULL`. |
| `scripts/shop-versions/reemit-mods.ts`, `scripts/shop-versions/emit-0259-reemits.ts`, `tests/shop-versions-migration.test.ts` | create | The enumerated re-emit mods, their generator, and the migration pins. |
| `lib/prep-consumption.ts` | modify | Scoped, paged, as-of pack loaders; `loadRecipeGraph({ locationId, versionLocationId, asOf })`; `loadLatestPackBoundary`; `createDatedGraphs`. |
| `lib/catering/toast-sales.ts`, `lib/ezcater/depletion.ts`, `lib/ezcater/pass2.ts` | modify | Depletion resolves packs as of its business date (D1). |
| `lib/production.ts`, `lib/catering/surplus.ts` | modify | The two flat-only consumers go through `contentOzForScope`. |
| `lib/admin/cost.ts`, `lib/purchase-orders.ts`, `lib/receiving.ts` | modify | Scoped price resolver; the PO uses it; receiving appends through `record_receiving_prices`. |
| `lib/counts.ts`, `lib/counts-read-refs.ts`, `app/(authed)/operations/counts/page.tsx`, `lib/products.ts`, `lib/batch-prep.ts`, `lib/opening.ts`, `lib/prep.ts`, `lib/yield-stats.ts`, `lib/catering/sku-demand.ts`, `lib/report-package.ts`, `lib/admin/readiness-load.ts`, `lib/admin/menu-costing.ts`, `lib/weights.ts`, `app/admin/skus/page.tsx`, `app/admin/vendors/[id]/page.tsx` | modify | Each passes its explicit scope (routing table, Task 5). |
| `lib/vendor-import.ts` | modify | The staging read is the GLOBAL lane, explicitly. |
| `lib/admin/menu-costing.ts`, `app/admin/menu-costing/page.tsx`, `tests/menu-costing-shop-scope.test.ts` | modify / create | The costing board follows the selected shop (lead decision, Task 6b): its packs and prices; All shops labelled global. |
| `lib/sku-data-readiness.ts`, `lib/sku-data-readiness-load.ts` | modify | Per-shop chain, price and auto-par stamp through the pure resolver. |
| `lib/location-sku-shared.ts`, `lib/dynamic-pars-shared.ts`, `lib/ordering.ts`, `lib/dynamic-pars.ts` | modify | Pack-EPOCH stamps (D3) through one shared overlay loader for the walk, its submission and the nightly run. |
| `lib/production-units-shared.ts`, `components/production/ProductionConsumptionPanel.tsx` | create / modify | The prep case/each/oz conversion, moved out of the panel so the persisted ounces are testable. |
| `lib/admin/sku-versions.ts` | create | Gated writers (D2 allowance; atomic first-value), restore, back to default, history. |
| `lib/admin/pack-chain.ts`, `lib/admin/skus.ts` | modify | The legacy global pack writers obey the boundary (D5). |
| `lib/destructive-actions.ts` | modify | `sku.pack_version_save`, `sku.pack_version_retire`, `sku.price_lane_retire`. |
| `components/admin/skus/shared.ts`, `lib/i18n/en.json`, `lib/i18n/es.json` | modify | `global_requires_moo` / `version_changed` explained on the SKU screens (en + es). |
| `app/api/admin/catalog/sku/[id]/{pack, pack/back-to-default, pack/restore, price, price/back-to-default}/route.ts` | create | Tier E routes over the gated writers. |
| `tests/sku-versions-resolution.test.ts`, `tests/shop-versions-as-of.test.ts`, `tests/scoped-flat-consumers.test.ts`, `tests/receiving-price-lanes.test.ts`, `tests/sku-versions-permissions.test.ts`, `tests/legacy-global-writers.test.ts`, `tests/sku-version-routes.test.ts`, `tests/sku-data-readiness-shop-versions.test.ts`, `tests/shop-pack-dynamic-pars.test.ts` | create | Every behaviour above, plus source pins. |
| `tests/fixtures/counts-fake-db.ts` | modify | `insert` support (persisted-ounce tests). |
| `tests/location-bind-differential.test.ts`, `tests/step-up-tier-map.test.ts`, `tests/silent-read-fabrication.test.ts`, `tests/fixtures/counts-v0-oracle.ts`, `tests/counts-onhand-equivalence.test.ts`, `tests/dynamic-pars-write.test.ts` | modify | Register the new writers, routes and signatures. |
| `AGENTS.md` | modify | The shop-versions law. |

---

## Task 1: The equivalence pin — freeze today's numbers BEFORE any change

Nothing in `lib/` changes in this task. It builds the fixture matrix and a harness that computes every number the spec names, for the global scope and for each shop:
- pack chains per SKU;
- prices and PO cents;
- depletion ounces per menu item and prep item, from the live graph and from a **dated** graph (a business date after every pack boundary);
- cost per oz, and the menu and prep cost rollups;
- order-unit ounces (the only pack input to ordering suggestions and Dynamic Pars);
- the **flat content** that manual production and catering surplus divide by.

The output is written once as a golden JSON with today's code. From then on the golden is the oracle. On-hand is pinned by `tests/counts-onhand-equivalence.test.ts`.

**Files:**
- Create: `tests/fixtures/shop-versions-fixture.ts`, `tests/fixtures/shop-versions-harness.ts`, `tests/shop-versions-equivalence.test.ts`, `tests/shop-versions-snapshot.test.ts`
- Create (generated): `tests/fixtures/shop-versions-golden.json`

- [ ] **Step 1: Create the fixture matrix `tests/fixtures/shop-versions-fixture.ts`**

```ts
/**
 * Catalog Phase 2a — THE FIXTURE MATRIX the equivalence pin runs over.
 *
 * Built on the B9 counts fixture (tests/fixtures/counts-onhand-fixture.ts) so products, per-shop
 * primaries, a store copy, receipts and chains are already awkward in the right ways, then
 * extended with everything the costing / depletion / ordering / production numbers need:
 *
 *   chained, weight leaf, two levels ........ s-turkey  (case → 4 bag → 80 oz = 320 oz)
 *   chained, count leaf via avg .............. s-tomato  (case → 20 each, avg 4.5 oz = 90 oz)
 *   chained, count leaf, packaging ........... s-bags    (case → 10 sleeve → 50 each)
 *   inactive historical level set ............ s-cups    (box, active=false)
 *   unchained, legacy flat path .............. s-lettuce (case of 24 × 1 lb), s-mayo (tub 30 lb), s-pickle (jar 32 oz)
 *   no pack basis at all ..................... s-cheese
 *   product pins, per-shop primaries ......... p-ham (global primary), p-bread (LOC → twin-y, OTHER → twin-x off-here)
 *   recipe line in a CHAIN label ............. 0.0125 case of turkey (= 4 oz)
 *   recipe line in a LEGACY pack label ....... 1 jar of pickle
 *   item-ref line by weight .................. 2 oz of Slaw (quart = 32 oz)
 *   retired recipe ........................... r-old
 *   price ties ............................... s-cheese: same effective_date, later recorded_at wins
 *   price on an inactive SKU ................. s-old
 *
 * THE POST-0259 SHAPE. Every level carries version_id + location_id (null); the backfilled global
 * sku_pack_versions rows exist with their real dates (valid_from / valid_to); every price row
 * carries location_id + price_lane_id (null); sku_price_lanes exists and is empty. Code written
 * before 0259 ignores all of it — which is what lets ONE fixture produce the golden (Task 1,
 * today's code) and prove the new code against it (Tasks 5–6).
 */
import { buildCountsFixture, LOC, OTHER } from "./counts-onhand-fixture";

type Row = Record<string, unknown>;
export { LOC, OTHER };

export const ACTIVE_FROM = "2026-08-01T00:00:00.000Z";
export const OLD_FROM = "2026-07-01T00:00:00.000Z";
/** A business date after every pack boundary in the fixture: its dated graph IS the live graph. */
export const QUIET_DAY = "2026-10-14";

/** Turn plain chain rows into the post-0259 shape: one global version per (sku, active) set, dated. */
export function withBackfilledVersions(tables: Record<string, Row[]>): Record<string, Row[]> {
  const levels = tables.sku_pack_levels ?? [];
  const versions: Row[] = [];
  const versionIdFor = new Map<string, string>();
  for (const l of levels) {
    if (l.version_id != null) continue;
    const active = l.active !== false;
    const from = (l.effective_from as string | undefined) ?? (active ? ACTIVE_FROM : OLD_FROM);
    l.effective_from = from;
    const key = `${String(l.sku_id)}|${from}|${active}`;
    let vid = versionIdFor.get(key);
    if (!vid) {
      vid = `pv-${String(l.sku_id)}-${active ? "live" : "old"}`;
      versionIdFor.set(key, vid);
      versions.push({
        id: vid, sku_id: l.sku_id, location_id: null, based_on_version_id: null,
        active, valid_from: from, valid_to: active ? null : ACTIVE_FROM,
        note: null, created_at: from, created_by: null, retired_by: null,
      });
    }
    l.version_id = vid;
    if (!("location_id" in l)) l.location_id = null;
  }
  tables.sku_pack_versions = [...(tables.sku_pack_versions ?? []), ...versions];
  for (const p of tables.vendor_price_history ?? []) {
    if (!("location_id" in p)) p.location_id = null;
    if (!("price_lane_id" in p)) p.price_lane_id = null;
  }
  tables.sku_price_lanes ??= [];
  return tables;
}

export function buildShopVersionsFixture(): Record<string, Row[]> {
  const t = buildCountsFixture();
  const sku = (id: string) => {
    const row = (t.vendor_items ?? []).find((r) => r.id === id);
    if (!row) throw new Error(`fixture: no SKU ${id}`);
    return row;
  };
  // Unchained SKUs on the legacy flat path.
  Object.assign(sku("s-lettuce"), { pack_format: "case", units_per_pack: 24, each_size: 1, each_measure: "lb" });
  Object.assign(sku("s-mayo"), { pack_format: "tub", units_per_pack: 1, each_size: 30, each_measure: "lb" });
  Object.assign(sku("s-pickle"), { pack_format: "jar", units_per_pack: 1, each_size: 32, each_measure: "oz" });
  // A chained count leaf that converts through the SKU's avg.
  Object.assign(sku("s-tomato"), { avg_oz_per_each: "4.5" });
  t.sku_pack_levels!.push({
    id: "pl-tom-case", sku_id: "s-tomato", label: "case", contains_qty: 20,
    contains_level_id: null, contains_measure_unit: "each", display_ordinal: 1, active: true,
  });

  t.items = [{ id: "i-slaw", name: "Slaw", oz_per_par_unit: 32, default_par_unit: "quart", active: true }];
  t.menu_items = [
    { id: "m-italian", name: "Italian", name_es: null, active: true },
    { id: "m-pickle-side", name: "Pickle side", name_es: null, active: true },
    { id: "m-old", name: "Old sub", name_es: null, active: false },
  ];
  t.recipes = [
    { id: "r-slaw", name: "Slaw", batch_yield: 2, active: true, created_at: "2026-09-01T00:00:00.000Z" },
    { id: "r-italian", name: "Italian", batch_yield: 1, active: true, created_at: "2026-09-02T00:00:00.000Z" },
    { id: "r-pickle", name: "Pickle side", batch_yield: 4, active: true, created_at: "2026-09-03T00:00:00.000Z" },
    { id: "r-old", name: "Old sub", batch_yield: 1, active: false, created_at: "2026-06-01T00:00:00.000Z" },
  ];
  const input = (id: string, recipe_id: string, quantity: number, unit: string, target: Row): Row =>
    ({ id, recipe_id, quantity, unit, component_sku_id: null, component_item_id: null, component_product_id: null, ...target });
  t.recipe_inputs = [
    input("ri-01", "r-slaw", 48, "oz", { component_sku_id: "s-lettuce" }),
    input("ri-02", "r-slaw", 16, "oz", { component_sku_id: "s-mayo" }),
    input("ri-03", "r-italian", 0.0125, "case", { component_sku_id: "s-turkey" }),
    input("ri-04", "r-italian", 2, "oz", { component_item_id: "i-slaw" }),
    input("ri-05", "r-italian", 3, "oz", { component_product_id: "p-ham" }),
    input("ri-06", "r-italian", 1, "each", { component_product_id: "p-bread" }),
    input("ri-07", "r-italian", 2, "each", { component_sku_id: "s-tomato" }),
    input("ri-08", "r-italian", 1.5, "oz", { component_sku_id: "s-cheese" }),
    input("ri-09", "r-pickle", 1, "jar", { component_sku_id: "s-pickle" }),
    input("ri-10", "r-old", 1, "oz", { component_sku_id: "s-onion" }),
  ];
  t.recipe_outputs = [
    { id: "ro-1", recipe_id: "r-slaw", output_item_id: "i-slaw", output_menu_item_id: null, yield: 2 },
    { id: "ro-2", recipe_id: "r-italian", output_item_id: null, output_menu_item_id: "m-italian", yield: 1 },
    { id: "ro-3", recipe_id: "r-pickle", output_item_id: null, output_menu_item_id: "m-pickle-side", yield: 4 },
    { id: "ro-4", recipe_id: "r-old", output_item_id: null, output_menu_item_id: "m-old", yield: 1 },
  ];
  const price = (id: string, vendor_item_id: string, unit_price: number | string, effective_date: string, recorded_at: string): Row =>
    ({ id, vendor_item_id, unit_price, effective_date, recorded_at, recorded_by: null, source: null, source_note: null });
  t.vendor_price_history = [
    price("ph-01", "s-turkey", 120, "2026-09-01", "2026-09-01T12:00:00.000Z"),
    price("ph-02", "s-turkey", 128, "2026-10-01", "2026-10-01T12:00:00.000Z"),
    price("ph-03", "s-cheese", "45.10", "2026-10-01", "2026-10-01T10:00:00.000Z"),
    price("ph-04", "s-cheese", "46.20", "2026-10-01", "2026-10-01T12:00:00.000Z"),
    price("ph-05", "s-ham-a", 3.1, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-06", "s-ham-b", 6.4, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-07", "s-twin-x", 4, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-08", "s-twin-y", 4.5, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-09", "s-lettuce", 38, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-10", "s-mayo", 22, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-11", "s-pickle", 9.99, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-12", "s-tomato", 25, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-13", "s-old", 7, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-14", "s-bags", 30, "2026-10-03", "2026-10-03T12:00:00.000Z"),
  ];
  t.locations = [
    { id: LOC, name: "Shop one", active: true },
    { id: OTHER, name: "Shop two", active: true },
  ];
  return withBackfilledVersions(t);
}
```

- [ ] **Step 2: Create the harness `tests/fixtures/shop-versions-harness.ts`**

```ts
/**
 * Catalog Phase 2a — THE EQUIVALENCE PIN's engine. One function computes every number the spec's
 * precondition names (spec §3, §8), per scope, through a small ResolverApi so the SAME
 * computation runs over today's loaders (Task 1 freezes the golden with them) and over the scoped
 * loaders (Tasks 5–6 change ONLY the `liveApi` lines marked TASK-5 / TASK-6).
 *
 * The numbers: pack chains per SKU (every pack consumer's input); the whole-catalog chain read
 * (counts); the current price and the PO's cents per SKU; per graph — live AND dated (a business
 * date after every boundary, which must equal live) — the hydrated skuPack, depletion oz per menu
 * item and prep item, cost per oz, the menu/prep cost rollups; the order-unit oz per SKU
 * (perOrderUnitOz — the ONLY pack/price input to the walk's suggestion and Dynamic Pars); and the
 * FLAT content oz that manual production and catering surplus divide by.
 */
import { loadAllSkuPackChains, loadMeasures, loadRecipeGraph, loadSkuPackChains } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { rollupItemCost, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { perOrderUnitOz } from "@/lib/ordering";
import { skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export interface FlatPack { unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null }

/** The resolver surface the pin exercises. `scope` null = the global default. */
export interface ResolverApi {
  chains(skuIds: string[], scope: string | null): Promise<Map<string, PackChainLevel[]>>;
  allChains(scope: string | null): Promise<Map<string, PackChainLevel[]>>;
  prices(skuIds: string[], scope: string | null): Promise<Map<string, number>>;
  graph(scope: string | null): Promise<RecipeGraph>;
  datedGraph(scope: string | null, businessDate: string): Promise<RecipeGraph>;
  flatContent(flat: ReadonlyMap<string, FlatPack>, scope: string | null, measures: Map<string, MeasureUnitFactor>): Promise<Map<string, number | null>>;
}

/**
 * THE LIVE API. Task 1: today's loaders (unscoped; every shop reads the global answer, which is
 * exactly what "no shop versions" must keep producing). Task 5 and Task 6 replace the marked
 * lines with the scoped calls and change NOTHING else in this file.
 */
export const liveApi: ResolverApi = {
  chains: (skuIds, _scope) => loadSkuPackChains(skuIds), // TASK-5
  allChains: (_scope) => loadAllSkuPackChains(), // TASK-5
  prices: (skuIds, _scope) => loadCurrentSkuPrices(skuIds), // TASK-6
  graph: (scope) => loadRecipeGraph(scope == null ? undefined : { locationId: scope }),
  datedGraph: (scope, _businessDate) => loadRecipeGraph(scope == null ? undefined : { locationId: scope }), // TASK-5
  flatContent: async (flat, _scope, measures) => new Map([...flat].map(([id, f]) => [id, skuContentOz(f, measures)])), // TASK-5
};

const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
function sorted<V>(m: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
/** The PO's dollars → cents rule (lib/purchase-orders.ts:840-845), spelled once here for the pin. */
function cents(d: number): number {
  return Math.round(Number((d * 100).toFixed(4)));
}
function shapeOf(r: Row): RecipeInputSku {
  return {
    packFormat: (r.pack_format as string | null) ?? null,
    eachContainerLabel: (r.each_container_label as string | null) ?? null,
    unitsPerPack: n(r.units_per_pack), eachSize: n(r.each_size),
    eachMeasure: (r.each_measure as string | null) ?? null, avgOzPerEach: n(r.avg_oz_per_each),
  };
}

export interface ScopeOutputs {
  chains: Record<string, PackChainLevel[]>;
  allChains: Record<string, PackChainLevel[]>;
  prices: Record<string, number>;
  priceCents: Record<string, number>;
  orderUnitOz: Record<string, number | null>;
  flatContentOz: Record<string, number | null>;
  graph: {
    skuPack: Record<string, RecipeInputSku>;
    menuOz: Record<string, Record<string, number>>;
    itemOz: Record<string, Record<string, number>>;
    costPerOz: Record<string, number | null>;
    menuCost: Record<string, unknown>;
    itemCost: Record<string, unknown>;
  };
  datedMenuOz: Record<string, Record<string, number>>;
}
export type EquivalenceOutputs = Record<string, ScopeOutputs>;

/** Every number, for "global" and for each shop id in `shopIds`. JSON-normalized. */
export async function computeOutputs(api: ResolverApi, tables: Tables, shopIds: readonly string[], datedDay: string): Promise<EquivalenceOutputs> {
  const skuRows = [...(tables.vendor_items ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const skuIds = skuRows.map((r) => String(r.id));
  const outputs = tables.recipe_outputs ?? [];
  const menuIds = [...new Set(outputs.map((o) => o.output_menu_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const itemIds = [...new Set(outputs.map((o) => o.output_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const measures = await loadMeasures();
  // Production's and surplus's own flat read: units_per_pack, each_size, each_measure, avg_oz_per_each.
  const flat = new Map(skuRows.map((r) => [String(r.id), { unitsPerPack: n(r.units_per_pack), eachSize: n(r.each_size), eachMeasure: (r.each_measure as string | null) ?? null, avgOzPerEach: n(r.avg_oz_per_each) }]));
  const out: EquivalenceOutputs = {};
  for (const label of ["global", ...shopIds]) {
    const scope = label === "global" ? null : label;
    const chains = await api.chains(skuIds, scope);
    const allChains = await api.allChains(scope);
    const prices = await api.prices(skuIds, scope);
    const graph = await api.graph(scope);
    const dated = await api.datedGraph(scope, datedDay);
    const costPerOz = costPerOzFromGraph(graph, prices);
    out[label] = {
      chains: sorted(chains),
      allChains: sorted(allChains),
      prices: sorted(prices),
      priceCents: sorted(new Map([...prices].map(([id, d]) => [id, cents(d)]))),
      orderUnitOz: Object.fromEntries(skuRows.map((r) => {
        const id = String(r.id);
        return [id, perOrderUnitOz(shapeOf(r), chains.get(id) ?? null, measures)];
      })),
      flatContentOz: sorted(await api.flatContent(flat, scope, measures)),
      graph: {
        skuPack: sorted(graph.skuPack),
        menuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(graph, m))])),
        itemOz: Object.fromEntries(itemIds.map((i) => [i, sorted(perUnitSkuOzForItemFromGraph(graph, i))])),
        costPerOz: sorted(costPerOz),
        menuCost: Object.fromEntries(menuIds.map((m) => [m, rollupMenuItemCost(graph, m, costPerOz)])),
        itemCost: Object.fromEntries(itemIds.map((i) => [i, rollupItemCost(graph, i, costPerOz)])),
      },
      datedMenuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(dated, m))])),
    };
  }
  return JSON.parse(JSON.stringify(out)) as EquivalenceOutputs;
}
```

- [ ] **Step 3: Create the test `tests/shop-versions-equivalence.test.ts`**

```ts
/**
 * Catalog Phase 2a — THE EQUIVALENCE PIN (spec §3 precondition, §8).
 *
 * With NO shop versions present, every LIVE number — pack chains, prices + PO cents, depletion oz,
 * cost per oz, menu/prep cost rollups, order-unit oz, the flat content production and surplus
 * divide by — and the depletion of a business date after every pack boundary must be
 * BYTE-IDENTICAL to what today's code produced on this fixture matrix. The golden was written by
 * Task 1 with today's loaders, before any resolver change; later tasks may change the loaders,
 * never the golden.
 *
 * Regenerate ONLY in Task 1 (or with a written reason in the PR):
 *   UPDATE_SHOP_VERSIONS_GOLDEN=1 npx vitest run tests/shop-versions-equivalence.test.ts
 *
 * On-hand is pinned separately by tests/counts-onhand-equivalence.test.ts (frozen v0 oracle).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER, QUIET_DAY } from "./fixtures/shop-versions-fixture";
import { computeOutputs, liveApi, type EquivalenceOutputs } from "./fixtures/shop-versions-harness";

const GOLDEN = "tests/fixtures/shop-versions-golden.json";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => { current = createFakeDb(buildShopVersionsFixture()); });
afterEach(() => { current = null; });

describe("no shop versions ⇒ every number is identical to today (the golden)", () => {
  it("matches the frozen golden for global, shop one and shop two", async () => {
    const got = await computeOutputs(liveApi, buildShopVersionsFixture(), [LOC, OTHER], QUIET_DAY);
    if (process.env.UPDATE_SHOP_VERSIONS_GOLDEN === "1") {
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(existsSync(GOLDEN), "golden missing — run Task 1 Step 4").toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as EquivalenceOutputs;
    expect(got).toEqual(golden);
  });
});

describe("the fixture is not trivial — hand-checked anchors inside the golden", () => {
  const golden = (): EquivalenceOutputs => JSON.parse(readFileSync(GOLDEN, "utf8")) as EquivalenceOutputs;

  it("chained, count-leaf and flat order units resolve to the right ounces", () => {
    const g = golden().global!;
    expect(g.orderUnitOz["s-turkey"]).toBe(320); // case → 4 bag → 80 oz
    expect(g.orderUnitOz["s-tomato"]).toBe(90); // case → 20 each × avg 4.5
    expect(g.orderUnitOz["s-lettuce"]).toBe(384); // flat: 24 × 1 lb
    expect(g.orderUnitOz["s-cheese"]).toBeNull(); // no pack basis
  });

  it("the flat content production and surplus read: flat SKUs resolve, chain-only SKUs stay null exactly as today", () => {
    const g = golden().global!;
    expect(g.flatContentOz["s-lettuce"]).toBe(384);
    expect(g.flatContentOz["s-turkey"]).toBeNull(); // no flat mirror in the fixture → today's null
  });

  it("the later-recorded price wins a same-date tie and cents round exactly", () => {
    const g = golden().global!;
    expect(g.prices["s-cheese"]).toBe(46.2);
    expect(g.priceCents["s-pickle"]).toBe(999);
  });

  it("the Italian depletes 4 oz of turkey through the chain label and 9 oz of tomato through the avg", () => {
    const italian = golden().global!.graph.menuOz["m-italian"]!;
    expect(italian["s-turkey"]).toBeCloseTo(4, 10);
    expect(italian["s-tomato"]).toBeCloseTo(9, 10);
  });

  it("cost per oz rides the chain: turkey $128 / 320 oz; the quiet day's dated depletion equals live", () => {
    const g = golden().global!;
    expect(g.graph.costPerOz["s-turkey"]).toBeCloseTo(0.4, 12);
    expect(g.datedMenuOz).toEqual(g.graph.menuOz);
  });

  it("every shop reads the global pack and price (no shop versions exist)", () => {
    const g = golden();
    expect(g[LOC]!.chains).toEqual(g.global!.chains);
    expect(g[OTHER]!.prices).toEqual(g.global!.prices);
  });
});
```

- [ ] **Step 4: Generate the golden with TODAY's code, then prove it reproduces**

```bash
UPDATE_SHOP_VERSIONS_GOLDEN=1 npx vitest run tests/shop-versions-equivalence.test.ts
npx vitest run tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts
```

Expected: the first run writes `tests/fixtures/shop-versions-golden.json` (several thousand lines) and passes. The second run passes both files, 0 failed. **If an anchor fails, the fixture or the harness is wrong. Fix that, never the anchor.**

- [ ] **Step 5: Create the read-only snapshot comparison `tests/shop-versions-snapshot.test.ts`**

```ts
/**
 * Catalog Phase 2a — THE SAME PIN OVER A PROD-SHAPED SNAPSHOT (spec §8). Skipped unless
 * SHOP_VERSIONS_SNAPSHOT_DIR is set, so CI never runs it. READ-ONLY BY CONSTRUCTION: the snapshot
 * is a directory of `<table>.json` files exported with SELECT statements only (Step 8); this test
 * loads them into the in-memory stand-in and never touches a database.
 *
 *   1. On the Task 1 commit:
 *        SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot SHOP_VERSIONS_SNAPSHOT_OUT=tmp/before.json \
 *          npx vitest run tests/shop-versions-snapshot.test.ts
 *   2. On the finished branch:
 *        SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot SHOP_VERSIONS_SNAPSHOT_BASELINE=tmp/before.json \
 *          npx vitest run tests/shop-versions-snapshot.test.ts
 *   SHOP_VERSIONS_SNAPSHOT_DAY (default: yesterday ET) is the dated business date; on the finished
 *   branch it must still equal live unless a GLOBAL chain changed after that day (Task 14 Step 1
 *   reports whether one did).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { withBackfilledVersions } from "./fixtures/shop-versions-fixture";
import { computeOutputs, liveApi, type EquivalenceOutputs } from "./fixtures/shop-versions-harness";

const DIR = process.env.SHOP_VERSIONS_SNAPSHOT_DIR;

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

function loadSnapshot(dir: string): Record<string, Array<Record<string, unknown>>> {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    tables[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<Record<string, unknown>>;
  }
  return tables.sku_pack_versions ? tables : withBackfilledVersions(tables);
}

function yesterdayEt(): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const t = Date.parse(`${today}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

describe.skipIf(!DIR)("prod-shaped snapshot — the same numbers before and after", () => {
  it("computes, and writes or compares", async () => {
    const tables = loadSnapshot(DIR!);
    current = createFakeDb(tables);
    const shops = (tables.locations ?? []).filter((l) => l.active !== false).map((l) => String(l.id)).sort();
    const got = await computeOutputs(liveApi, tables, shops, process.env.SHOP_VERSIONS_SNAPSHOT_DAY ?? yesterdayEt());
    const outPath = process.env.SHOP_VERSIONS_SNAPSHOT_OUT;
    const basePath = process.env.SHOP_VERSIONS_SNAPSHOT_BASELINE;
    if (outPath) writeFileSync(outPath, `${JSON.stringify(got, null, 2)}\n`);
    if (basePath) {
      expect(existsSync(basePath)).toBe(true);
      expect(got).toEqual(JSON.parse(readFileSync(basePath, "utf8")) as EquivalenceOutputs);
    }
    expect(outPath ?? basePath, "set SHOP_VERSIONS_SNAPSHOT_OUT or _BASELINE").toBeTruthy();
  });
});
```

(Inline `toLocaleDateString` is a test helper, never UI; the AGENTS.md format rule covers rendered dates.)

- [ ] **Step 6: Run**

Run: `npx vitest run tests/shop-versions-equivalence.test.ts tests/shop-versions-snapshot.test.ts tests/counts-onhand-equivalence.test.ts`
Expected: 2 files pass, and `shop-versions-snapshot.test.ts` reports 1 skipped.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/shop-versions-fixture.ts tests/fixtures/shop-versions-harness.ts tests/fixtures/shop-versions-golden.json tests/shop-versions-equivalence.test.ts tests/shop-versions-snapshot.test.ts
git commit -F - <<'EOF'
test(catalog): the shop-versions equivalence pin — today's numbers frozen before any change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

- [ ] **Step 8: The read-only export (how the snapshot is taken)**

Run these through the Supabase MCP `execute_sql`, SELECT only, against the sim for a rehearsal, or prod with Juan's word. Save each result array as `tmp/shop-versions-snapshot/<table>.json` (`tmp/` must be git-ignored; check with `git check-ignore tmp/x`).

```sql
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendors t;
select coalesce(json_agg(t order by t.label), '[]'::json) from public.measure_units t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.sku_pack_levels t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.products t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.product_primaries t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.location_sku_settings t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_deliveries t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_delivery_items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipes t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_inputs t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.recipe_outputs t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.items t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.vendor_price_history t;
select coalesce(json_agg(t order by t.id), '[]'::json) from public.locations t;
-- Record in the PR; Task 6 unifies the PO's price order onto the costing order, which differ
-- ONLY on null recorded_at rows. Must read 0.
select count(*) as null_recorded_at from public.vendor_price_history where recorded_at is null;
```

Then, still on this commit: `SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot SHOP_VERSIONS_SNAPSHOT_OUT=tmp/before.json npx vitest run tests/shop-versions-snapshot.test.ts`. Expected: 1 passed. Keep `tmp/before.json` for Task 14 Step 6.

---

## Task 2: The pure resolver, the dated pick, the shop allowance, the gates (`lib/sku-versions-shared.ts`)

**Files:**
- Create: `lib/sku-versions-shared.ts`
- Test: `tests/sku-versions-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2a — the ONE version resolver (pure): live, as of an instant, prices, flat content, gates. */
import { describe, expect, it } from "vitest";
import {
  FIRST_GLOBAL_WRITE_MIN, GLOBAL_VERSION_WRITE_MIN, SHOP_VERSION_WRITE_MIN,
  asOfForBusinessDate, assertScopeToken, catalogShopAllowed, contentOzForScope, levelsBySku,
  packsFromVersions, pickVersionsAsOf, priceCentsFromDollars, resolveCurrentPrices, resolvePackLevels,
  skuOwnerAllowed, unitsPerPackForScope, versionWriteGate, type ScopedLevelRow, type ScopedPriceRow, type ScopedVersionRow,
} from "@/lib/sku-versions-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

const lvl = (id: string, sku_id: string, location_id: string | null, version_id: string, ord: number, label = id): ScopedLevelRow => ({
  id, sku_id, version_id, location_id, effective_from: location_id ? "2026-10-10T00:00:00Z" : "2026-08-01T00:00:00Z",
  label, contains_qty: ord === 0 ? 4 : "80", contains_level_id: ord === 0 ? `${sku_id}-${location_id ?? "g"}-1` : null,
  contains_measure_unit: ord === 0 ? null : "oz", display_ordinal: ord,
});

describe("resolvePackLevels — this shop's live version, else the global one", () => {
  const rows = [
    lvl("t-g-0", "turkey", null, "v-g", 0, "case"), lvl("t-g-1", "turkey", null, "v-g", 1, "bag"),
    lvl("t-s-0", "turkey", "shop-a", "v-s", 0, "case"), lvl("t-s-1", "turkey", "shop-a", "v-s", 1, "bag"),
    lvl("h-g-0", "ham", null, "v-h", 1, "pack"),
    lvl("x-b-0", "cheese", "shop-b", "v-b", 1, "block"),
  ];
  it("a shop version beats the global one for that shop", () => {
    const r = resolvePackLevels(rows, "shop-a").get("turkey")!;
    expect(r).toMatchObject({ versionId: "v-s", locationId: "shop-a", effectiveFrom: "2026-10-10T00:00:00Z" });
    expect(r.levels.map((l) => l.id)).toEqual(["t-s-0", "t-s-1"]);
  });
  it("with no shop version the shop reads the global one", () => {
    expect(resolvePackLevels(rows, "shop-a").get("ham")!.versionId).toBe("v-h");
  });
  it("another shop's version is never this shop's answer; the global scope ignores every shop row", () => {
    expect(resolvePackLevels(rows, "shop-a").has("cheese")).toBe(false);
    expect(resolvePackLevels(rows, null).get("turkey")!.versionId).toBe("v-g");
  });
  it("rows without the 0259 columns read as global, and levels keep input order", () => {
    const legacy = [{ id: "a", sku_id: "s", label: "case", contains_qty: "2", contains_level_id: "b", contains_measure_unit: null, display_ordinal: 0 },
      { id: "b", sku_id: "s", label: "bag", contains_qty: 5, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1 }] as ScopedLevelRow[];
    expect(resolvePackLevels(legacy, "shop-a").get("s")).toMatchObject({ locationId: null, versionId: null });
    expect(levelsBySku(resolvePackLevels(legacy, null)).get("s")).toEqual([
      { id: "a", label: "case", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
    ]);
  });
});

describe("as of an instant (D1) — the version IN FORCE then", () => {
  const v = (id: string, sku: string, loc: string | null, from: string, to: string | null): ScopedVersionRow => ({ id, sku_id: sku, location_id: loc, valid_from: from, valid_to: to });
  const versions = [
    v("g1", "turkey", null, "2026-08-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    v("g2", "turkey", null, "2026-10-01T00:00:00Z", null),
    v("s1", "turkey", "shop-a", "2026-10-15T14:00:00Z", null),
    v("s0", "ham", "shop-a", "2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z"), // back to default on 09-10
    v("h1", "ham", null, "2026-08-01T00:00:00Z", null),
  ];
  it("yesterday reads the global version in force; today (after the shop save) reads the shop's", () => {
    expect(pickVersionsAsOf(versions, "shop-a", "2026-10-15T03:59:59.999Z").get("turkey")!.id).toBe("g2");
    expect(pickVersionsAsOf(versions, "shop-a", "2026-10-16T03:59:59.999Z").get("turkey")!.id).toBe("s1");
    expect(pickVersionsAsOf(versions, null, "2026-09-15T00:00:00Z").get("turkey")!.id).toBe("g1");
  });
  it("a retired shop version answers only inside its own dates (back to default)", () => {
    expect(pickVersionsAsOf(versions, "shop-a", "2026-09-05T00:00:00Z").get("ham")!.id).toBe("s0");
    expect(pickVersionsAsOf(versions, "shop-a", "2026-09-10T00:00:00Z").get("ham")!.id).toBe("h1");
  });
  it("packsFromVersions builds the chain of exactly the picked version, in level order", () => {
    const picked = pickVersionsAsOf(versions, "shop-a", "2026-10-16T03:59:59.999Z");
    const packs = packsFromVersions(picked, [lvl("x", "turkey", "shop-a", "s1", 0, "case"), lvl("y", "turkey", null, "g2", 0, "case"), lvl("z", "turkey", "shop-a", "s1", 1, "bag")]);
    expect(packs.get("turkey")).toMatchObject({ versionId: "s1", locationId: "shop-a", effectiveFrom: "2026-10-15T14:00:00Z" });
    expect(packs.get("turkey")!.levels.map((l) => l.id)).toEqual(["x", "z"]);
  });
  it("a pre-chain baseline version answers with the flat pack it preserved (Astra 2b r2#5)", () => {
    const flat = { pack_format: "case", each_container_label: null, units_per_pack: 24, each_size: 1, each_measure: "lb" };
    const vs = [
      { ...v("base", "lettuce", null, "2000-01-01T00:00:00Z", "2026-10-15T14:00:00Z"), flat_snapshot: flat },
      v("first", "lettuce", null, "2026-10-15T14:00:00Z", null),
    ];
    const yesterday = packsFromVersions(pickVersionsAsOf(vs, null, "2026-10-15T03:59:59.999Z"), []);
    expect(yesterday.get("lettuce")).toMatchObject({ versionId: "base", levels: [], flat });
    const today = packsFromVersions(pickVersionsAsOf(vs, null, "2026-10-16T03:59:59.999Z"), [lvl("c", "lettuce", null, "first", 1, "case")]);
    expect(today.get("lettuce")!.flat).toBeUndefined();
  });
  it("a business date resolves at its last instant (ET)", () => {
    expect(asOfForBusinessDate("2026-10-14")).toBe("2026-10-15T03:59:59.999Z"); // EDT
    expect(asOfForBusinessDate("2026-12-14")).toBe("2026-12-15T04:59:59.999Z"); // EST
  });
});

describe("contentOzForScope — the two flat-path consumers (production, surplus)", () => {
  const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }]]);
  const flat = { unitsPerPack: 24, eachSize: 1, eachMeasure: "lb", avgOzPerEach: null };
  it("global answer: today's flat mirror, byte-for-byte (the chain is ignored, exactly as before)", () => {
    expect(contentOzForScope(flat, undefined, measures)).toBe(384);
    expect(contentOzForScope(flat, { levels: [{ id: "c", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }], versionId: "g", locationId: null, effectiveFrom: null }, measures)).toBe(384);
  });
  it("a shop version answers through its chain (it has no flat mirror)", () => {
    expect(contentOzForScope(flat, { levels: [{ id: "c", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }], versionId: "s", locationId: "shop-a", effectiveFrom: null }, measures)).toBe(192);
  });
});

describe("unitsPerPackForScope — prep's 'each' comes from the SAME pack as its content", () => {
  const shop = (levels: Array<[string, number, string | null, string | null]>) => ({
    levels: levels.map(([id, q, next, unit], i) => ({ id, label: id, containsQty: q, containsLevelId: next, containsMeasureUnit: unit, displayOrdinal: i })),
    versionId: "s", locationId: "shop-a", effectiveFrom: null,
  });
  it("a shop's 4 × 10 lb case is 4 per pack — never the global flat 6", () => {
    expect(unitsPerPackForScope(6, shop([["case", 4, "bag", null], ["bag", 10, null, "lb"]]))).toBe(4);
  });
  it("global answers stay the flat mirror; a one-level shop chain is 1; a malformed chain is null", () => {
    expect(unitsPerPackForScope(6, undefined)).toBe(6);
    expect(unitsPerPackForScope(6, { ...shop([["case", 4, "bag", null], ["bag", 10, null, "lb"]]), locationId: null })).toBe(6);
    expect(unitsPerPackForScope(6, shop([["case", 12, null, "lb"]]))).toBe(1);
    expect(unitsPerPackForScope(6, shop([["a", 2, "b", null], ["b", 3, "a", null]]))).toBeNull();
  });
});

describe("resolveCurrentPrices — the shop's live lane, else the global head", () => {
  const p = (id: string, sku: string, unit_price: number | string, date: string, location_id: string | null = null, price_lane_id: string | null = null): ScopedPriceRow =>
    ({ id, vendor_item_id: sku, unit_price, effective_date: date, recorded_at: `${date}T12:00:00Z`, location_id, price_lane_id });
  const rows = [
    p("p5", "turkey", 150, "2026-10-12", "shop-a", "lane-a"),
    p("p4", "turkey", 128, "2026-10-01"),
    p("p3", "turkey", 140, "2026-09-20", "shop-a", "lane-old"),
    p("p2", "ham", "3.10", "2026-10-02"),
    p("p1", "ham", 2.9, "2026-09-02"),
  ];
  it("no lanes: first parseable global row per SKU — today's rule", () => {
    const r = resolveCurrentPrices(rows, new Map());
    expect(r.get("turkey")).toMatchObject({ value: 128, priceId: "p4", laneId: null, locationId: null });
    expect(r.get("ham")!.value).toBe(3.1);
  });
  it("a live lane prices the shop from that lane only; a retired lane's rows are ignored", () => {
    expect(resolveCurrentPrices(rows, new Map([["turkey", "lane-a"]])).get("turkey")).toMatchObject({ value: 150, laneId: "lane-a" });
    expect(resolveCurrentPrices(rows.filter((x) => x.id !== "p5"), new Map([["turkey", "lane-a"]])).get("turkey")!.priceId).toBe("p4");
  });
  it("an unparseable row is skipped exactly as today; cents round with the PO's rule", () => {
    expect(resolveCurrentPrices([p("bad", "ham", "x", "2026-10-03"), ...rows], new Map()).get("ham")!.priceId).toBe("p2");
    expect(priceCentsFromDollars(19.99)).toBe(1999);
    expect(priceCentsFromDollars(0.1 + 0.2)).toBe(30);
  });
});

describe("the catalog shop allowance (D2) and the write gates (spec §2)", () => {
  it("floors", () => {
    expect([SHOP_VERSION_WRITE_MIN, GLOBAL_VERSION_WRITE_MIN, FIRST_GLOBAL_WRITE_MIN.pack, FIRST_GLOBAL_WRITE_MIN.price]).toEqual([6, 8, 7, 6]);
  });
  it("a GLOBAL write to a shop-OWNED SKU binds that shop below MoO; a shared SKU follows the first-value rule (r3#1)", () => {
    expect(skuOwnerAllowed({ level: 6, locations: ["shop-a"] }, "shop-b")).toBe(false);
    expect(skuOwnerAllowed({ level: 7, locations: ["shop-a"] }, "shop-a")).toBe(true);
    expect(skuOwnerAllowed({ level: 6, locations: ["shop-a"] }, null)).toBe(true);
    expect(skuOwnerAllowed({ level: 8, locations: [] }, "shop-b")).toBe(true);
  });
  it("MoO (8) and up may work in ANY shop; GM/AGM only their memberships", () => {
    expect(catalogShopAllowed({ level: 8, locations: [] }, "shop-b")).toBe(true);
    expect(catalogShopAllowed({ level: 7, locations: ["shop-a"] }, "shop-b")).toBe(false);
    expect(catalogShopAllowed({ level: 6, locations: ["shop-a"] }, "shop-a")).toBe(true);
  });
  it("a shop version needs level 6 AND the shop", () => {
    expect(versionWriteGate({ kind: "pack", level: 5, scope: "a", scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(versionWriteGate({ kind: "pack", level: 7, scope: "a", scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(versionWriteGate({ kind: "price", level: 6, scope: "a", scopeAllowed: true })).toEqual({ ok: true, firstOnly: false });
  });
  it("global: MoO+ freely; a GM (pack) / AGM (price) only the FIRST value — the database decides that, atomically", () => {
    expect(versionWriteGate({ kind: "pack", level: 8, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: false });
    expect(versionWriteGate({ kind: "pack", level: 7, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: true });
    expect(versionWriteGate({ kind: "pack", level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(versionWriteGate({ kind: "price", level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: true, firstOnly: true });
  });
  it("assertScopeToken refuses anything that could break a PostgREST filter", () => {
    expect(assertScopeToken("6f1d2c3e-0000-4000-8000-000000000001")).toBe("6f1d2c3e-0000-4000-8000-000000000001");
    expect(() => assertScopeToken("a,location_id.is.null")).toThrow(/scope/);
  });
});
```

Run: `npx vitest run tests/sku-versions-shared.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/sku-versions-shared"`.

- [ ] **Step 2: Create `lib/sku-versions-shared.ts`**

```ts
/**
 * Shop versions of a SKU's pack chain and price — THE ONE RESOLVER, PURE (catalog Phase 2a,
 * migration 0259; spec 2026-10-15 §3). Client-safe: no I/O, no server imports.
 *
 * THE RULE, ONE PLACE PER KIND: every consumer gets "this shop's version IN FORCE if it has one,
 * else the global default". The loaders (lib/prep-consumption.ts for packs, lib/admin/cost.ts for
 * prices) read rows for {global ∪ this shop} and hand them HERE; no consumer ever picks a version
 * itself — the same law as product resolution (AGENTS.md "RESOLUTION HAPPENS ONCE").
 *
 *   scope null      → the global default only (rows with location_id NULL).
 *   scope "<shop>"  → that shop's version when it has one, else the global one. Another shop's
 *                     rows are never an answer for this one.
 *
 * TWO CLOCKS (D1). LIVE screens resolve NOW (the active rows). A PAST business date resolves AS OF
 * its last instant (pickVersionsAsOf over valid_from / valid_to), so a pack version made today never
 * re-resolves yesterday's rebuilt depletion. Receipts and counts keep the ounces they stored.
 *
 * Rows written before 0259 carry no location_id/version_id; they read as global, which is exactly
 * what they are — that is what makes the no-shop-version case byte-identical.
 */
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import { operationalDayUtcRange } from "@/lib/operational-day";

/** null = the global default; otherwise a shop (locations.id). */
export type VersionScope = string | null;

/** The generated scope_key a global row carries (0259). */
export const NIL_SCOPE = "00000000-0000-0000-0000-000000000000";

/** A shop id that is safe to interpolate into a PostgREST `or=` filter. Throws otherwise. */
export function assertScopeToken(scope: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(scope)) throw new Error(`invalid version scope: ${JSON.stringify(scope)}`);
  return scope;
}

// ── Packs, live ───────────────────────────────────────────────────────────────

/** A sku_pack_levels row as the pack loaders select it (0259 columns optional). */
export interface ScopedLevelRow {
  id: string;
  sku_id: string;
  version_id?: string | null;
  location_id?: string | null;
  effective_from?: string | null;
  label: string;
  contains_qty: number | string;
  contains_level_id: string | null;
  contains_measure_unit: string | null;
  display_ordinal: number;
}

/**
 * The legacy FLAT pack a SKU had before its first global chain (0259 trigger
 * sku_pack_versions_flat_baseline). A version carrying one has no levels; a past business date
 * inside it resolves to these fields, never to today's (overwritten) flat mirror.
 */
export interface FlatPackSnapshot {
  pack_format: string | null;
  each_container_label: string | null;
  units_per_pack: number | null;
  each_size: number | string | null;
  each_measure: string | null;
}

/** One SKU's resolved chain: the levels, which version, whose, and since when. */
export interface ResolvedPack {
  levels: PackChainLevel[];
  versionId: string | null;
  /** null = the global default answered; a shop id = that shop's own version answered. */
  locationId: string | null;
  effectiveFrom: string | null;
  /** Set only on an as-of answer from a pre-chain baseline version: the flat pack in force then. */
  flat?: FlatPackSnapshot;
}

function numOrZero(v: number | string): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toLevel(r: ScopedLevelRow): PackChainLevel {
  return {
    id: r.id, label: r.label, containsQty: numOrZero(r.contains_qty),
    containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit,
    displayOrdinal: r.display_ordinal,
  };
}

/** Each SKU's LIVE chain for `scope` from ACTIVE rows of {global ∪ scope}; levels keep arrival order. */
export function resolvePackLevels(rows: readonly ScopedLevelRow[], scope: VersionScope): Map<string, ResolvedPack> {
  const global = new Map<string, ScopedLevelRow[]>();
  const shop = new Map<string, ScopedLevelRow[]>();
  const order: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const loc = r.location_id ?? null;
    let bucket: Map<string, ScopedLevelRow[]> | null = null;
    if (loc === null) bucket = global;
    else if (scope !== null && loc === scope) bucket = shop;
    if (!bucket) continue; // another shop's row: never this scope's answer
    const list = bucket.get(r.sku_id) ?? [];
    list.push(r);
    bucket.set(r.sku_id, list);
    if (!seen.has(r.sku_id)) { seen.add(r.sku_id); order.push(r.sku_id); }
  }
  const out = new Map<string, ResolvedPack>();
  for (const skuId of order) {
    const pick = shop.get(skuId) ?? global.get(skuId);
    if (!pick || pick.length === 0) continue;
    const head = pick[0]!;
    out.set(skuId, {
      levels: pick.map(toLevel), versionId: head.version_id ?? null,
      locationId: head.location_id ?? null, effectiveFrom: head.effective_from ?? null,
    });
  }
  return out;
}

/** The pre-0259 loader shape: skuId → chain levels. */
export function levelsBySku(resolved: ReadonlyMap<string, ResolvedPack>): Map<string, PackChainLevel[]> {
  return new Map([...resolved].map(([id, r]) => [id, r.levels]));
}

// ── Packs, as of an instant (D1) ──────────────────────────────────────────────

export interface ScopedVersionRow {
  id: string;
  sku_id: string;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  /** A pre-chain baseline (0259): the legacy flat pack in force over this version's dates. */
  flat_snapshot?: FlatPackSnapshot | null;
}

function inForceAt(v: ScopedVersionRow, at: number): boolean {
  return Date.parse(v.valid_from) <= at && (v.valid_to == null || at < Date.parse(v.valid_to));
}

/**
 * The version IN FORCE at `asOf` per SKU: this shop's (if one was in force then) beats the
 * global one. A retired shop version answers only inside its own dates — that is "back to
 * default", seen from the past.
 */
export function pickVersionsAsOf(versions: readonly ScopedVersionRow[], scope: VersionScope, asOf: string): Map<string, ScopedVersionRow> {
  const at = Date.parse(asOf);
  const shop = new Map<string, ScopedVersionRow>();
  const global = new Map<string, ScopedVersionRow>();
  for (const v of versions) {
    if (!inForceAt(v, at)) continue;
    const bucket = v.location_id === null ? global : scope !== null && v.location_id === scope ? shop : null;
    if (!bucket) continue;
    const prior = bucket.get(v.sku_id);
    if (!prior || Date.parse(v.valid_from) > Date.parse(prior.valid_from)) bucket.set(v.sku_id, v);
  }
  const out = new Map<string, ScopedVersionRow>();
  for (const [sku, v] of global) out.set(sku, v);
  for (const [sku, v] of shop) out.set(sku, v);
  return out;
}

/** The chains of exactly the picked versions (levels of any activity; history is append-only). */
export function packsFromVersions(picked: ReadonlyMap<string, ScopedVersionRow>, levels: readonly ScopedLevelRow[]): Map<string, ResolvedPack> {
  const byVersion = new Map<string, ScopedLevelRow[]>();
  for (const l of levels) {
    if (l.version_id == null) continue;
    const list = byVersion.get(l.version_id) ?? [];
    list.push(l);
    byVersion.set(l.version_id, list);
  }
  const out = new Map<string, ResolvedPack>();
  for (const [sku, v] of picked) {
    if (v.flat_snapshot) {
      // A pre-chain baseline answers with the FLAT pack it preserved (Astra 2b r2#5).
      out.set(sku, { levels: [], versionId: v.id, locationId: v.location_id, effectiveFrom: v.valid_from, flat: v.flat_snapshot });
      continue;
    }
    const rows = byVersion.get(v.id);
    if (!rows || rows.length === 0) continue;
    out.set(sku, { levels: rows.map(toLevel), versionId: v.id, locationId: v.location_id, effectiveFrom: v.valid_from });
  }
  return out;
}

/** A business date resolves at its LAST instant (ET), so a change made that day is that day's pack. */
export function asOfForBusinessDate(businessDate: string): string {
  const { endExclusiveIso } = operationalDayUtcRange(businessDate);
  return new Date(Date.parse(endExclusiveIso) - 1).toISOString();
}

// ── The two flat-path consumers ───────────────────────────────────────────────

/**
 * Content oz for MANUAL PRODUCTION and CATERING SURPLUS, which have always divided by the flat
 * mirror (vendor_items.units_per_pack × each_size × oz-per-measure) and never read a chain. The
 * GLOBAL answer stays exactly that (byte-identical; replaceSkuPackChain keeps the mirror synced
 * from the global chain). A SHOP version has no flat mirror, so its chain is its only truth.
 */
export function contentOzForScope(
  flat: { unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null },
  resolved: ResolvedPack | undefined,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  if (resolved && resolved.locationId !== null) return skuContentOz({ ...flat, packChain: resolved.levels }, measures);
  return skuContentOz(flat, measures);
}

/**
 * Units per pack from the SAME selected pack the content came from (Astra 2a r2#1): prep's "each"
 * is content ÷ units, so mixing a shop chain's content with the global flat count mis-weighs every
 * each. A SHOP version answers from its chain (the product of the non-leaf quantities, root to leaf;
 * a one-level chain is 1 — deriveFlatFieldsFromChain's rule); the GLOBAL answer stays the flat
 * mirror, byte-for-byte. A malformed chain (no unique root, a cycle, no leaf) is null — never a guess.
 */
export function unitsPerPackForScope(flatUnits: number | null, resolved: ResolvedPack | undefined): number | null {
  if (!resolved || resolved.locationId === null) return flatUnits;
  const levels = resolved.levels;
  const pointedAt = new Set(levels.map((l) => l.containsLevelId).filter((id): id is string => id != null));
  const roots = levels.filter((l) => !pointedAt.has(l.id));
  if (roots.length !== 1) return null;
  const byId = new Map(levels.map((l) => [l.id, l]));
  let cur: PackChainLevel | undefined = roots[0];
  let units = 1;
  const seen = new Set<string>();
  while (cur && cur.containsLevelId != null) {
    if (seen.has(cur.id) || !(cur.containsQty > 0)) return null;
    seen.add(cur.id);
    units *= cur.containsQty;
    cur = byId.get(cur.containsLevelId);
  }
  return cur ? units : null;
}

// ── Prices ────────────────────────────────────────────────────────────────────

/** A vendor_price_history row as the scoped loader selects it (0259 columns optional). */
export interface ScopedPriceRow {
  id?: string | null;
  vendor_item_id: string;
  unit_price: number | string;
  effective_date: string;
  recorded_at: string | null;
  location_id?: string | null;
  price_lane_id?: string | null;
}

export interface ResolvedPrice {
  value: number;
  priceId: string | null;
  /** null = the global head answered; a shop id = that shop's live lane answered. */
  locationId: string | null;
  laneId: string | null;
  effectiveDate: string;
}

function parsePrice(v: number | string): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Current price per SKU from rows ordered NEWEST FIRST (effective_date, recorded_at, id — desc).
 * `liveLaneBySku` maps a SKU to this shop's LIVE lane id (empty for the global scope). A live lane
 * → the newest row OF THAT LANE (a lane with no row of its own falls back to the global head);
 * no lane → the newest GLOBAL row. The first PARSEABLE row wins — today's rule.
 */
export function resolveCurrentPrices(
  rowsNewestFirst: readonly ScopedPriceRow[],
  liveLaneBySku: ReadonlyMap<string, string>,
): Map<string, ResolvedPrice> {
  const out = new Map<string, ResolvedPrice>();
  const globalFallback = new Map<string, ResolvedPrice>();
  for (const r of rowsNewestFirst) {
    const value = parsePrice(r.unit_price);
    if (value == null) continue;
    const sku = r.vendor_item_id;
    const isGlobal = (r.location_id ?? null) === null;
    const resolved: ResolvedPrice = { value, priceId: r.id ?? null, locationId: r.location_id ?? null, laneId: r.price_lane_id ?? null, effectiveDate: r.effective_date };
    const lane = liveLaneBySku.get(sku);
    if (lane !== undefined) {
      if (r.price_lane_id === lane) { if (!out.has(sku)) out.set(sku, resolved); }
      else if (isGlobal && !globalFallback.has(sku)) globalFallback.set(sku, resolved);
    } else if (isGlobal && !out.has(sku)) {
      out.set(sku, resolved);
    }
  }
  for (const [sku, p] of globalFallback) if (!out.has(sku)) out.set(sku, p);
  return out;
}

/** Dollars → integer cents, float-safe (the purchase-order rule, one spelling). */
export function priceCentsFromDollars(dollars: number): number {
  return Math.round(Number((dollars * 100).toFixed(4)));
}

// ── The shop allowance and the write gates (spec §2; D2, D5) ─────────────────

/** AGM (6) / GM (7) write their OWN shop's version (pack, price). */
export const SHOP_VERSION_WRITE_MIN = 6;
/** MoO (8) and up write the global default and ANY shop's version. */
export const GLOBAL_VERSION_WRITE_MIN = 8;
/** Setting the FIRST global value of a SKU that has none keeps today's floors. */
export const FIRST_GLOBAL_WRITE_MIN = { pack: 7, price: 6 } as const;

/**
 * CATALOG SHOP ALLOWANCE (D2): which shop's catalog versions an actor may write. MoO (8) and up —
 * any active shop (the database re-checks "active"); GM/AGM — only their memberships. Deliberately
 * NOT lockLocationContext (all shops at 9): the catalog is the org's, and Cristian runs it.
 */
export function catalogShopAllowed(actor: { level: number; locations: readonly string[] }, shopId: string): boolean {
  return actor.level >= GLOBAL_VERSION_WRITE_MIN || actor.locations.includes(shopId);
}

/**
 * THE OWNING-SHOP RULE for a GLOBAL write (Astra 2a r3#1). A SKU owned by ONE shop
 * (vendor_items.location_id — a store copy, a shop-only item) is that shop's business: below MoO
 * its global value (the first pack, the first price) may be set only by someone who works in that
 * shop. A SHARED SKU (location_id NULL) follows the first-value rule alone, decided in SQL under the
 * SKU lock. MoO+ any (catalogShopAllowed).
 */
export function skuOwnerAllowed(actor: { level: number; locations: readonly string[] }, ownerLocationId: string | null): boolean {
  return ownerLocationId === null || catalogShopAllowed(actor, ownerLocationId);
}

export type VersionKind = "pack" | "price";
export type VersionWriteRefusal = { ok: false; status: 403 | 404; code: "forbidden" | "not_found" | "global_requires_moo" };

/**
 * Decided from the actor and the scope alone, before any I/O. `scopeAllowed` is the caller's
 * catalogShopAllowed(actor, scope). A global write below MoO is `firstOnly`: the writer RPC refuses
 * it, under the SKU lock and in the same transaction as the insert, if a global value exists.
 */
export function versionWriteGate(input: {
  kind: VersionKind; level: number; scope: VersionScope; scopeAllowed: boolean;
}): { ok: true; firstOnly: boolean } | VersionWriteRefusal {
  if (input.scope !== null) {
    if (input.level < SHOP_VERSION_WRITE_MIN) return { ok: false, status: 403, code: "forbidden" };
    if (!input.scopeAllowed) return { ok: false, status: 404, code: "not_found" };
    return { ok: true, firstOnly: false };
  }
  if (input.level >= GLOBAL_VERSION_WRITE_MIN) return { ok: true, firstOnly: false };
  if (input.level >= FIRST_GLOBAL_WRITE_MIN[input.kind]) return { ok: true, firstOnly: true };
  return { ok: false, status: 403, code: "forbidden" };
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/sku-versions-shared.test.ts`
Expected: PASS, 0 failed.

```bash
git add lib/sku-versions-shared.ts tests/sku-versions-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): the one shop-version resolver (live, as-of, prices, flat content) and the write gates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 3: Migration 0259 — dated versions, lanes, pack stamps, six writers, two re-emits, privilege ceilings

**Files:**
- Create: `supabase/migrations/0259_sku_shop_versions.sql`
- Create: `scripts/shop-versions/reemit-mods.ts`, `scripts/shop-versions/emit-0259-reemits.ts`
- Test: `tests/shop-versions-migration.test.ts`

0259 is additive and **backward compatible with the code running in production when it is applied**. `version_id` stays nullable until 0260, every new column is nullable, and the replaced label index constrains today's rows exactly as the old one did. 0260 (Task 4) runs after the 2a deploy and closes the window.

- [ ] **Step 1: Write the failing pin test `tests/shop-versions-migration.test.ts`**

```ts
/**
 * Catalog Phase 2a — migrations 0259 + 0260 pinned: header + gate line; the dated version table
 * and its one-live index; the DB-proven level link; the lanes; the auto-par pack stamps; the six
 * writers (SECURITY DEFINER, locked search_path, service_role only, refused to PostgREST roles,
 * first-value decided under the SKU lock); the privilege ceilings; and the two re-emits as
 * line-subsequences of their latest definers ± the enumerated mods, nothing else.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REEMITS, applyMods, extractFunction, isLineSubsequence, normalize } from "../scripts/shop-versions/reemit-mods";

const DIR = "supabase/migrations";
const read = (f: string) => normalize(readFileSync(`${DIR}/${f}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M0259 = "0259_sku_shop_versions.sql";
const M0260 = "0260_sku_pack_versions_finalize.sql";
const WRITERS = ["save_sku_pack_version", "retire_sku_pack_version", "save_sku_shop_price", "save_sku_global_price", "retire_sku_price_lane", "record_receiving_prices"];

describe("0259 / 0260 headers", () => {
  it("both carry the house header and the gate line", () => {
    for (const f of [M0259, M0260]) {
      const src = read(f);
      expect(src.split("\n")[0]).toBe(`-- Migration ${f.replace(/\.sql$/, "")}`);
      expect(src).toContain("NOT YET APPLIED — apply via MCP after review");
    }
    expect(read(M0260)).toContain("ONLY AFTER the Phase 2a code is deployed");
  });
});

describe("0259 structure", () => {
  const src = read(M0259);
  it("dated versions: valid_from / valid_to paired with active, one live chain per (sku, scope)", () => {
    expect(src).toContain("create table if not exists public.sku_pack_versions");
    expect(src).toMatch(/scope_key\s+uuid\s+generated always as \(coalesce\(location_id, '00000000-0000-0000-0000-000000000000'::uuid\)\) stored/);
    expect(src).toContain("check ((valid_to is null) = active)");
    expect(src).toContain("on public.sku_pack_versions (sku_id, scope_key) where active;");
    expect(src).toContain("on public.sku_pack_versions (sku_id, scope_key, valid_from);");
  });
  it("levels: the DB-proven composite FK and the scoped label index replacing the old one", () => {
    expect(src).toContain("add column if not exists version_id  uuid null");
    expect(src).toContain("foreign key (version_id, sku_id, scope_key)");
    expect(src).toContain("drop index if exists public.sku_pack_levels_sku_label_active;");
    expect(src).toContain("on public.sku_pack_levels (sku_id, scope_key, label) where active;");
  });
  it("the backfill asserts instead of hoping", () => {
    expect(src).toContain("pack levels left without a version");
    expect(src).toContain("would have two live global chains");
  });
  it("price lanes + the location/lane pairing", () => {
    expect(src).toContain("create table if not exists public.sku_price_lanes");
    expect(src).toContain("check ((location_id is null) = (price_lane_id is null))");
    expect(src).toContain("foreign key (price_lane_id, vendor_item_id, location_id)");
  });
  it("D3: a MONOTONIC pack epoch per (sku, shop), bumped by trigger on every effective change; auto values stamped with it", () => {
    expect(src).toContain("create table if not exists public.sku_pack_epochs");
    expect(src).toContain("add column if not exists auto_weekday_pack_epoch bigint null");
    expect(src).toContain("add column if not exists auto_weekend_pack_epoch bigint null");
    expect(src).toContain("set auto_weekday_pack_epoch = case when auto_weekday_par is not null then 0 end,");
    const bump = extractFunction(src, "create or replace function public.sku_pack_epoch_bump(", "\n$$;");
    expect(bump).toContain("on conflict (sku_id, location_id) do update set epoch = e.epoch + 1");
    expect(bump).toContain("elsif tg_op = 'UPDATE' and old.active and not new.active and new.location_id is not null then");
    expect(src).toContain("after insert or update of active on public.sku_pack_versions");
    // the triggers come AFTER the backfill, so the backfill bumps nothing and snapshots nothing
    expect(src.indexOf("create trigger sku_pack_versions_epoch")).toBeGreaterThan(src.indexOf("pack levels left without a version"));
  });
  it("2b r2#5: a pre-chain flat baseline is recorded before a SKU's first global chain", () => {
    expect(src).toContain("constraint sku_pack_versions_baseline_never_live check (flat_snapshot is null or not active)");
    const base = extractFunction(src, "create or replace function public.sku_pack_versions_flat_baseline(", "\n$$;");
    expect(base).toContain("if exists (select 1 from public.sku_pack_versions where sku_id = new.sku_id and location_id is null) then return new; end if;");
    expect(base).toContain("values (new.sku_id, null, false, '2000-01-01T00:00:00Z', new.valid_from,");
    expect(base).not.toContain("v_vi.pack_format is null and v_vi.units_per_pack is null"); // an all-null pack is history too
    expect(src).toContain("before insert on public.sku_pack_versions");
  });
  it("2a r2#6: the GLOBAL flat mirror is derived inside save_sku_pack_version's transaction", () => {
    const body = extractFunction(src, "create or replace function public.save_sku_pack_version(", "\n$$;");
    expect(body).toContain("v_mirror := public.sku_flat_mirror_apply(p_sku, v_new);");
    expect(body.indexOf("sku_flat_mirror_apply")).toBeGreaterThan(body.indexOf("readback_failed"));
    const mirror = extractFunction(src, "create or replace function public.sku_flat_mirror_apply(", "\n$$;");
    expect(mirror).toContain("units_per_pack = case when v_units = trunc(v_units) then v_units::int else null end");
    expect(mirror).toContain("set pack_format = 'Each (no case)', units_per_pack = null, each_size = null, each_measure = null");
  });
  it("every writer is SECURITY DEFINER, locked search_path, service_role only; first-value is decided under the SKU lock", () => {
    for (const fn of WRITERS) {
      const body = src.slice(src.indexOf(`create or replace function public.${fn}(`));
      expect(body.slice(0, 700)).toContain("security definer");
      expect(body.slice(0, 700)).toContain("set search_path = pg_catalog, public");
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    for (const fn of ["save_sku_pack_version", "save_sku_global_price"]) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body.indexOf("for update")).toBeGreaterThan(-1);
      expect(body.indexOf("for update")).toBeLessThan(body.indexOf("global_requires_moo"));
    }
    expect(src).toContain("raise exception '0259: unexpected execute grant'");
  });
  it("record_receiving_prices: under the SKU lock, the shop's live lane — else it OPENS the shop's first lane (decision e)", () => {
    const body = extractFunction(src, "create or replace function public.record_receiving_prices(", "\n$$;");
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("from public.sku_price_lanes"));
    expect(body).toContain("insert into public.sku_price_lanes (sku_id, location_id, based_on_price_id, active, created_at, created_by)");
    expect(body).toContain("if v_owner is distinct from p_location then");
    expect(body.indexOf("insert into public.sku_price_lanes")).toBeLessThan(body.indexOf("insert into public.vendor_price_history"));
  });
  it("privilege ceiling on both new tables: revoke all (service_role too), grant exactly, assert both ways", () => {
    for (const t of ["sku_pack_versions", "sku_price_lanes", "sku_pack_epochs"]) {
      expect(src).toContain(`alter table public.${t} enable row level security;`);
      expect(src).toContain(`revoke all on public.${t} from public, anon, authenticated, service_role;`);
      expect(src).toContain(`grant select, insert, update on public.${t} to service_role;`);
      expect(src).toContain(`has_table_privilege('service_role', 'public.${t}', 'DELETE')`);
      expect(src).toContain(`has_table_privilege('service_role', 'public.${t}', 'TRUNCATE')`);
    }
    expect(src).toContain("raise exception '0259: service_role above its ceiling'");
    expect(src).toContain("raise exception '0259: service_role is missing a privilege the writers need'");
  });
});

describe("0259 re-emits its two SQL chain writers faithfully", () => {
  const emitted0259 = read(M0259);
  for (const r of REEMITS) {
    describe(r.name, () => {
      it(`${r.source} was the latest definer before 0259, and 0259 is now`, () => {
        const defining = files.filter((f) => read(f).includes(r.start) || read(f).includes(r.startReplaced));
        expect(defining[defining.length - 1]).toBe(M0259);
        expect(defining[defining.length - 2]).toBe(r.source);
      });
      it("the source body (± the enumerated mods) is a line-subsequence of the 0259 body", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const check = isLineSubsequence(source, extractFunction(emitted0259, r.startReplaced, r.end));
        expect(check.ok, `missing from 0259 → ${check.missing}`).toBe(true);
      });
      it("adds nothing beyond the mods except comment lines", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const srcLines = new Set(source.split("\n").map((l) => l.trimEnd()));
        const extra = extractFunction(emitted0259, r.startReplaced, r.end).split("\n").map((l) => l.trimEnd())
          .filter((l) => l.trim() !== "" && !srcLines.has(l) && !l.trim().startsWith("--"));
        expect(extra).toEqual([]);
      });
    });
  }
  it("the store copy derives its flat mirror from the chain it cloned (Astra 2a#10)", () => {
    const body = extractFunction(emitted0259, "create or replace function public.receiving_create_store_item(", "$$;");
    expect(body).toContain("update public.vendor_items set pack_format = v_root_label");
  });
});

describe("0260 finalize", () => {
  const src = read(M0260);
  it("heals legacy-window writes with real dates, asserts every invariant, then makes version_id NOT NULL", () => {
    expect(src).toContain("note = '0260 backfill'");
    expect(src).toContain("assert v_null = 0");
    expect(src).toContain("assert v_mismatch = 0");
    expect(src).toContain("alter table public.sku_pack_levels alter column version_id set not null;");
  });
  it("re-dates the whole global timeline across versioned AND healed rows (Astra 2a r2#5), with the baseline trigger off", () => {
    expect(src).toContain("lead(v.valid_from) over (partition by v.sku_id order by v.valid_from, v.created_at, v.id)");
    expect(src).toContain("assert v_overlap = 0");
    expect(src.indexOf("disable trigger sku_pack_versions_flat_baseline")).toBeLessThan(src.indexOf("'0260 backfill'"));
    expect(src).toContain("enable trigger sku_pack_versions_flat_baseline");
  });
});
```

Run: `npx vitest run tests/shop-versions-migration.test.ts`
Expected: FAIL with `Failed to resolve import "../scripts/shop-versions/reemit-mods"`.

- [ ] **Step 2: Create `scripts/shop-versions/reemit-mods.ts`** (the enumerated mods; reviewers read THIS list)

```ts
/**
 * Catalog Phase 2a — the two SQL chain writers 0259 re-emits, as `[old, new]` modifications of
 * their latest definers. Shared by the generator (emit-0259-reemits.ts) and the pin
 * (tests/shop-versions-migration.test.ts), so the SQL that ships IS the list reviewers read.
 *
 * apply_vendor_import (0211) edits the GLOBAL lane only: it locks/reads/supersedes only
 * location_id IS NULL levels, closes the global version (valid_to) and opens the new one
 * (valid_from), and reads the GLOBAL price head as its before-state.
 *
 * receiving_create_store_item (0216) clones the chain THIS SHOP receives (its own version when it
 * has one, else the global) into the new store copy as that copy's global version — and, when the
 * shop's own version was cloned, derives the copy's flat mirror from that chain in the same
 * transaction (the reference's flat fields describe the GLOBAL pack, not the shop's).
 */
export type Mod = readonly [string, string];
export interface Reemit { name: string; source: string; start: string; startReplaced: string; end: string; mods: readonly Mod[] }

export function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

export function extractFunction(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`function start not found: ${start}`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`function end not found after: ${start}`);
  return src.slice(a, b + end.length);
}

export function applyMods(body: string, mods: readonly Mod[]): string {
  let out = body;
  for (const [o, n] of mods) {
    const count = out.split(o).length - 1;
    if (count !== 1) throw new Error(`mod anchor must occur exactly once (found ${count}): ${o.slice(0, 80)}`);
    out = out.replace(o, n);
  }
  return out;
}

export function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (const line of n) {
    while (j < h.length && h[j] !== line) j++;
    if (j >= h.length) return { ok: false, missing: line };
    j++;
  }
  return { ok: true, missing: null };
}

export const REEMITS: readonly Reemit[] = [
  {
    name: "apply_vendor_import",
    source: "0211_vendor_import.sql",
    start: "create or replace function public.apply_vendor_import(",
    startReplaced: "create or replace function public.apply_vendor_import(",
    end: "end $$;",
    mods: [
      [
        "  v_ratio numeric; v_written int; v_count int; v_now timestamptz;",
        "  v_ratio numeric; v_written int; v_count int; v_now timestamptz;\n  v_old_version uuid; v_new_version uuid;",
      ],
      [
        "    perform 1 from public.sku_pack_levels where sku_id = v_sku_id and active order by id for update;",
        "    perform 1 from public.sku_pack_levels where sku_id = v_sku_id and active and location_id is null order by id for update;",
      ],
      [
        "       from public.sku_pack_levels where sku_id = v_sku_id and active) l;",
        "       from public.sku_pack_levels where sku_id = v_sku_id and active and location_id is null) l;",
      ],
      [
        "        into v_price from public.vendor_price_history where vendor_item_id = v_sku_id\n",
        "        into v_price from public.vendor_price_history where vendor_item_id = v_sku_id and location_id is null\n",
      ],
      [
        "      update public.sku_pack_levels set active = false where sku_id = v_sku_id and active;",
        [
          "      update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor",
          "        where sku_id = v_sku_id and location_id is null and active returning id into v_old_version;",
          "      v_new_version := gen_random_uuid();",
          "      insert into public.sku_pack_versions(id,sku_id,location_id,based_on_version_id,active,valid_from,created_at,created_by)",
          "        values (v_new_version,v_sku_id,null,v_old_version,true,v_now,v_now,p_actor);",
          "      update public.sku_pack_levels set active = false where sku_id = v_sku_id and active and location_id is null;",
        ].join("\n"),
      ],
      [
        "      insert into public.sku_pack_levels(id,sku_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)",
        "      insert into public.sku_pack_levels(id,sku_id,version_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)",
      ],
      [
        "      select (v_id_map->>(x->>'id'))::uuid,v_sku_id,x->>'label',(x->>'contains_qty')::numeric,",
        "      select (v_id_map->>(x->>'id'))::uuid,v_sku_id,v_new_version,x->>'label',(x->>'contains_qty')::numeric,",
      ],
    ],
  },
  {
    name: "receiving_create_store_item",
    source: "0216_receiving_store_runs.sql",
    start: "create function public.receiving_create_store_item(",
    startReplaced: "create or replace function public.receiving_create_store_item(",
    end: "$$;",
    mods: [
      ["create function public.receiving_create_store_item(", "create or replace function public.receiving_create_store_item("],
      [
        "declare v_ref public.vendor_items%rowtype; v_id uuid; v_product uuid; v_map jsonb; v_group jsonb;",
        "declare v_ref public.vendor_items%rowtype; v_id uuid; v_product uuid; v_map jsonb; v_group jsonb;\n  v_scope uuid; v_version uuid; v_node public.sku_pack_levels%rowtype; v_units numeric; v_root_label text; v_hops int;",
      ],
      [
        "  perform 1 from public.sku_pack_levels where sku_id = p_reference and active order by id for update;",
        [
          "  -- 0259: clone the chain THIS SHOP receives — its own version when it has one, else the global.",
          "  v_scope := case when exists (select 1 from public.sku_pack_levels",
          "      where sku_id = p_reference and active and location_id = p_location) then p_location else null end;",
          "  perform 1 from public.sku_pack_levels where sku_id = p_reference and active",
          "    and location_id is not distinct from v_scope order by id for update;",
        ].join("\n"),
      ],
      [
        "  select jsonb_object_agg(id::text, gen_random_uuid()::text) into v_map\n    from public.sku_pack_levels where sku_id = p_reference and active;",
        "  select jsonb_object_agg(id::text, gen_random_uuid()::text) into v_map\n    from public.sku_pack_levels where sku_id = p_reference and active\n      and location_id is not distinct from v_scope;",
      ],
      [
        [
          "  insert into public.sku_pack_levels(id, sku_id, label, contains_qty, contains_level_id,",
          "    contains_measure_unit, display_ordinal, effective_from, active, created_by)",
          "  select (v_map->>id::text)::uuid, v_id, label, contains_qty,",
          "    (v_map->>contains_level_id::text)::uuid, contains_measure_unit, display_ordinal,",
          "    now(), true, p_actor from public.sku_pack_levels where sku_id = p_reference and active;",
        ].join("\n"),
        [
          "  if v_map is not null then",
          "    v_version := gen_random_uuid();",
          "    insert into public.sku_pack_versions(id, sku_id, location_id, based_on_version_id, active, valid_from, created_by)",
          "      values (v_version, v_id, null, null, true, now(), p_actor);",
          "  end if;",
          "  insert into public.sku_pack_levels(id, sku_id, version_id, label, contains_qty, contains_level_id,",
          "    contains_measure_unit, display_ordinal, effective_from, active, created_by)",
          "  select (v_map->>id::text)::uuid, v_id, v_version, label, contains_qty,",
          "    (v_map->>contains_level_id::text)::uuid, contains_measure_unit, display_ordinal,",
          "    now(), true, p_actor from public.sku_pack_levels where sku_id = p_reference and active",
          "      and location_id is not distinct from v_scope;",
          "  -- 0259: a SHOP version was cloned → the copy's flat mirror must describe THAT chain, derived",
          "  -- here (root label; product of the non-leaf quantities; the leaf's size and unit).",
          "  if v_scope is not null and v_map is not null then",
          "    select l.* into v_node from public.sku_pack_levels l",
          "     where l.sku_id = v_id and l.active",
          "       and not exists (select 1 from public.sku_pack_levels c",
          "                        where c.sku_id = v_id and c.active and c.contains_level_id = l.id);",
          "    v_root_label := v_node.label; v_units := 1; v_hops := 0;",
          "    while v_node.contains_level_id is not null and v_hops < 16 loop",
          "      v_units := v_units * v_node.contains_qty; v_hops := v_hops + 1;",
          "      select l.* into v_node from public.sku_pack_levels l where l.id = v_node.contains_level_id;",
          "    end loop;",
          "    update public.vendor_items set pack_format = v_root_label,",
          "      units_per_pack = case when v_units = trunc(v_units) then v_units::int else null end,",
          "      each_size = v_node.contains_qty, each_measure = v_node.contains_measure_unit",
          "     where id = v_id;",
          "  end if;",
        ].join("\n"),
      ],
    ],
  },
];
```

- [ ] **Step 3: Create `scripts/shop-versions/emit-0259-reemits.ts`**

```ts
/**
 * Writes the two re-emitted SQL writers into 0259 between their markers, from REEMITS.
 * Run: npx tsx scripts/shop-versions/emit-0259-reemits.ts   (idempotent)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { REEMITS, applyMods, extractFunction, normalize } from "./reemit-mods";

const TARGET = "supabase/migrations/0259_sku_shop_versions.sql";
let target = normalize(readFileSync(TARGET, "utf8"));
for (const r of REEMITS) {
  const src = normalize(readFileSync(`supabase/migrations/${r.source}`, "utf8"));
  const body = applyMods(extractFunction(src, r.start, r.end), r.mods);
  const open = `-- >>> REEMIT ${r.name} (generated by scripts/shop-versions/emit-0259-reemits.ts — do not hand-edit)\n`;
  const close = `-- <<< REEMIT ${r.name}\n`;
  const a = target.indexOf(open);
  const b = target.indexOf(close);
  if (a < 0 || b < a) throw new Error(`markers for ${r.name} not found in ${TARGET}`);
  target = `${target.slice(0, a + open.length)}${body}\n${target.slice(b)}`;
  console.log(`re-emitted ${r.name} from ${r.source} (${r.mods.length} mods)`);
}
writeFileSync(TARGET, target);
```

- [ ] **Step 4: Create `supabase/migrations/0259_sku_shop_versions.sql`**

```sql
-- Migration 0259_sku_shop_versions
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod dry-run → prod, BEFORE the 2a code merges).
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase2a-shop-versions-data.md (Task 3).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 (global defaults + shop versions).
--
-- WHAT. Shop versions of a SKU's PACK CHAIN and PRICE, beside the global default, in the house
-- idiom `location_id NULL = global` (product_primaries 0179, location_sku_settings 0174):
--
--   sku_pack_versions        the chain-as-a-set, now a row, EFFECTIVE-DATED (valid_from / valid_to;
--                            append-only: a save closes the old version and opens a new one).
--                            location_id NULL = global; a shop id = that shop's version, based_on
--                            the version it came from. Every existing level set is backfilled into
--                            a GLOBAL version carrying its real dates.
--   sku_pack_levels          + version_id, + location_id (denormalized), + scope_key (generated);
--                            a composite FK (version_id, sku_id, scope_key) proves IN THE DATABASE
--                            that a level's shop is its version's shop.
--   sku_price_lanes          a shop's own price lane; "back to default" retires it, rows stay.
--   vendor_price_history     + location_id (NULL = global), + price_lane_id; CHECK-paired, FK-proven.
--   sku_pack_epochs          per (sku, shop), a MONOTONIC count of every change of the pack that shop
--                            EFFECTIVELY receives (its own version made or retired; the global one
--                            replaced while it rides it), bumped by a trigger on sku_pack_versions.
--   location_sku_settings    + auto_{weekday,weekend}_pack_epoch: the epoch a machine par was computed
--                            in (D3) — any other epoch retires it at read time, and "back to default"
--                            is a NEW epoch, so it can never resurrect a stale value (G → S → G).
--   sku_pack_versions.flat_snapshot   a PRE-CHAIN BASELINE: when a SKU gets its first global chain, a
--                            trigger first records its legacy flat pack as a version valid up to that
--                            moment, so a past business date never resolves to the overwritten mirror.
--   sku_flat_mirror_apply    the GLOBAL flat mirror (vendor_items pack fields), derived from the chain
--                            INSIDE save_sku_pack_version's locked transaction — never synced after.
--
-- SUPERSEDES 0159 council lock L4 (per-shop pack variance lives on chain versions now).
--
-- THE RESOLUTION RULE IS NOT IN SQL. Readers resolve "this shop's version in force, else global"
-- in ONE pure place (lib/sku-versions-shared.ts) behind the existing loaders — live by `active`,
-- historically by valid_from / valid_to (a past business date resolves as of its last instant).
--
-- EVERY WRITER TAKES THE SKU ROW LOCK FIRST (`vendor_items … for update`), so pack writes, price
-- writes, lane changes and the first-value rule serialize per SKU:
--   save_sku_pack_version(…, p_first_only)   p_first_only (a GM's global write) refuses when a global
--                                            chain exists — decided UNDER the lock, same transaction.
--   retire_sku_pack_version                  a shop's "back to default"; never global.
--   save_sku_shop_price                      opens the shop's lane on its first price, appends.
--   save_sku_global_price(…, p_first_only)   p_first_only (an AGM/GM) refuses when a global price exists.
--   retire_sku_price_lane                    a shop's price "back to default".
--   record_receiving_prices                  the door (decision e): per SKU, lock → this shop's live lane,
--                                            else OPEN its first lane → append there. A shared SKU's global
--                                            price is never written by a delivery; a shop's own store-copy
--                                            SKU (vendor_items.location_id = the shop) keeps its global row.
-- plus the two live SQL chain writers, re-emitted (scripts/shop-versions/reemit-mods.ts lists every
-- change): apply_vendor_import (0211) and receiving_create_store_item (0216, now deriving the copy's
-- flat mirror from the chain it actually cloned).
--
-- BACKWARD COMPATIBLE WITH THE CODE RUNNING WHEN THIS IS APPLIED: version_id stays NULLABLE (0260
-- tightens it after the 2a deploy and heals the window), every new column is nullable, the replaced
-- label index is the old one plus the scope, and no existing policy or grant changes.
-- vendor_price_history keeps its read policy (level >= 6, 0058).
--
-- PRIVILEGE CEILING (the Phase 1 0257 pattern): both new tables revoke ALL from public, anon,
-- authenticated AND service_role (Supabase's default privileges hand it ALL), grant exactly SELECT,
-- INSERT, UPDATE to service_role, and the guard proves no DELETE/TRUNCATE/REFERENCES/TRIGGER and
-- no missing privilege.
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class where oid in
--     ('public.sku_pack_versions'::regclass, 'public.sku_price_lanes'::regclass);               -- t, t
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('sku_pack_versions','sku_price_lanes') order by 1,2,3;
--     -- service_role INSERT / SELECT / UPDATE only (plus the owner)
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and privilege_type = 'EXECUTE'
--      and routine_name in ('save_sku_pack_version','retire_sku_pack_version','save_sku_shop_price','save_sku_global_price',
--                           'retire_sku_price_lane','record_receiving_prices','apply_vendor_import','receiving_create_store_item')
--    order by 1, 2;                                                           -- service_role (+ owner) only
--   select count(*) from public.sku_pack_levels where version_id is null;   -- 0
--   select count(*) from (select sku_id from public.sku_pack_versions where active group by sku_id, scope_key having count(*) > 1) x;  -- 0
--   select count(*) from public.sku_pack_levels l join public.sku_pack_versions v on v.id = l.version_id where l.active <> v.active;  -- 0
--   select count(*) from public.location_sku_settings where auto_weekday_par is not null and auto_weekday_pack_epoch is null;  -- 0 (D3 stamp)
--   select count(*) from public.sku_pack_epochs;                         -- 0 right after apply (no change has happened yet)
--   select tgname from pg_trigger where tgrelid = 'public.sku_pack_versions'::regclass and not tgisinternal order by 1;
--     -- sku_pack_versions_epoch, sku_pack_versions_flat_baseline

begin;

-- ── (1) sku_pack_versions ─────────────────────────────────────────────────────
create table if not exists public.sku_pack_versions (
  id                  uuid        primary key default gen_random_uuid(),
  sku_id              uuid        not null references public.vendor_items(id),
  location_id         uuid        null references public.locations(id),
  scope_key           uuid        generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  based_on_version_id uuid        null references public.sku_pack_versions(id),
  active              boolean     not null default true,
  valid_from          timestamptz not null default now(),
  valid_to            timestamptz null,
  note                text        null,
  flat_snapshot       jsonb       null,
  created_at          timestamptz not null default now(),
  created_by          uuid        null references public.users(id),
  retired_by          uuid        null references public.users(id),
  constraint sku_pack_versions_baseline_never_live check (flat_snapshot is null or not active),
  constraint sku_pack_versions_identity_uq unique (id, sku_id, scope_key)
);

comment on table public.sku_pack_versions is
  'A SKU''s pack chain as an effective-dated SET (0259). location_id NULL = the global default; a shop '
  'id = that shop''s own version, based_on the version it came from. In force over [valid_from, valid_to); '
  'one live (active, valid_to NULL) version per (sku, scope_key). Append-only: a save closes the old '
  'version and opens a new one; nothing is deleted. Resolution: lib/sku-versions-shared.ts.';

create index if not exists sku_pack_versions_history_ix on public.sku_pack_versions (sku_id, created_at desc);
create index if not exists sku_pack_versions_as_of_ix on public.sku_pack_versions (sku_id, scope_key, valid_from);

-- ── (2) sku_pack_levels: the version and the shop ─────────────────────────────
alter table public.sku_pack_levels
  add column if not exists version_id  uuid null,
  add column if not exists location_id uuid null references public.locations(id);
alter table public.sku_pack_levels
  add column if not exists scope_key uuid generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

-- ── (3) backfill: every existing level set becomes a dated GLOBAL version ────
do $$
declare
  v_groups      int;
  v_levels      int;
  v_unversioned int;
  v_multi_live  int;
begin
  insert into public.sku_pack_versions (sku_id, location_id, active, valid_from, created_at, created_by)
  select g.sku_id, null, g.active, g.effective_from, g.effective_from, g.created_by
    from (select sku_id, effective_from, active, (array_agg(created_by order by id))[1] as created_by
            from public.sku_pack_levels
           where version_id is null
           group by sku_id, effective_from, active) g;
  get diagnostics v_groups = row_count;

  update public.sku_pack_levels l
     set version_id = v.id
    from public.sku_pack_versions v
   where l.version_id is null and v.location_id is null
     and v.sku_id = l.sku_id and v.valid_from = l.effective_from and v.active = l.active;
  get diagnostics v_levels = row_count;

  select count(*) into v_unversioned from public.sku_pack_levels where version_id is null;
  assert v_unversioned = 0, format('0259: %s pack levels left without a version', v_unversioned);

  select count(*) into v_multi_live
    from (select sku_id from public.sku_pack_versions where active and location_id is null group by sku_id having count(*) > 1) x;
  assert v_multi_live = 0, format('0259: %s SKUs would have two live global chains', v_multi_live);

  -- History: each global version is based on the one before it; an inactive one stopped being in
  -- force when the next began (an inactive set with no successor closes on its own start).
  update public.sku_pack_versions v
     set based_on_version_id = h.prev_id,
         valid_to = case when v.active then null else coalesce(h.next_from, v.valid_from) end
    from (select id, lag(id) over w as prev_id, lead(valid_from) over w as next_from
            from public.sku_pack_versions where location_id is null
          window w as (partition by sku_id order by valid_from, active, id)) h
   where h.id = v.id and v.based_on_version_id is null;

  raise notice '0259 backfill: % global versions, % levels linked', v_groups, v_levels;
end $$;

alter table public.sku_pack_versions drop constraint if exists sku_pack_versions_live_window;
alter table public.sku_pack_versions
  add constraint sku_pack_versions_live_window check ((valid_to is null) = active);

-- ── (4) the DB-proven link and the scoped indexes ────────────────────────────
alter table public.sku_pack_levels drop constraint if exists sku_pack_levels_version_fk;
alter table public.sku_pack_levels
  add constraint sku_pack_levels_version_fk
  foreign key (version_id, sku_id, scope_key) references public.sku_pack_versions (id, sku_id, scope_key);

drop index if exists public.sku_pack_levels_sku_label_active;
create unique index if not exists sku_pack_levels_scope_label_active
  on public.sku_pack_levels (sku_id, scope_key, label) where active;
create index if not exists sku_pack_levels_scope_active on public.sku_pack_levels (sku_id, location_id) where active;
create index if not exists sku_pack_levels_version_ix on public.sku_pack_levels (version_id);
create unique index if not exists sku_pack_versions_one_live
  on public.sku_pack_versions (sku_id, scope_key) where active;

comment on column public.sku_pack_levels.version_id is
  'The sku_pack_versions set this level belongs to (0259). NULLABLE until 0260 heals rows written by pre-2a code in the deploy window.';
comment on column public.sku_pack_levels.location_id is
  'Denormalized from the version (0259): NULL = global, a shop id = that shop''s version. Proven by sku_pack_levels_version_fk.';

-- ── (5) price lanes ──────────────────────────────────────────────────────────
create table if not exists public.sku_price_lanes (
  id                uuid        primary key default gen_random_uuid(),
  sku_id            uuid        not null references public.vendor_items(id),
  location_id       uuid        not null references public.locations(id),
  based_on_price_id uuid        null references public.vendor_price_history(id),
  active            boolean     not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid        null references public.users(id),
  retired_at        timestamptz null,
  retired_by        uuid        null references public.users(id),
  constraint sku_price_lanes_identity_uq unique (id, sku_id, location_id)
);
comment on table public.sku_price_lanes is
  'A shop''s OWN price for a SKU (0259). While live, that shop is priced from the newest row of the lane; '
  'otherwise from the newest global row. Retiring it is "back to default" — the rows stay. One live lane per (sku, shop).';
create unique index if not exists sku_price_lanes_one_live on public.sku_price_lanes (sku_id, location_id) where active;

alter table public.vendor_price_history
  add column if not exists location_id   uuid null references public.locations(id),
  add column if not exists price_lane_id uuid null;
alter table public.vendor_price_history drop constraint if exists vendor_price_history_lane_pair;
alter table public.vendor_price_history
  add constraint vendor_price_history_lane_pair check ((location_id is null) = (price_lane_id is null));
alter table public.vendor_price_history drop constraint if exists vendor_price_history_lane_fk;
alter table public.vendor_price_history
  add constraint vendor_price_history_lane_fk
  foreign key (price_lane_id, vendor_item_id, location_id) references public.sku_price_lanes (id, sku_id, location_id);
create index if not exists vendor_price_history_scope_ix on public.vendor_price_history (vendor_item_id, location_id, effective_date desc);

-- ── (6) auto-par pack EPOCHS (D3), the pre-chain baseline, the global flat mirror ──
-- An auto value is valid only in the pack EPOCH it was computed in. sku_pack_epochs counts, per
-- (sku, shop), every change of the pack that shop EFFECTIVELY receives — its own version made or
-- retired, or the global one replaced while the shop rides it — MONOTONICALLY, so "back to default"
-- is a new epoch and can never resurrect a value computed before the shop's own case existed
-- (G → S → G = epochs 0 → 1 → 2). No row = epoch 0.
create table if not exists public.sku_pack_epochs (
  sku_id      uuid        not null references public.vendor_items(id),
  location_id uuid        not null references public.locations(id),
  epoch       bigint      not null default 0 check (epoch >= 0),
  updated_at  timestamptz not null default now(),
  primary key (sku_id, location_id)
);
comment on table public.sku_pack_epochs is
  'Per (sku, shop), a monotonic count of changes to the pack that shop effectively receives (0259). '
  'Bumped only by the sku_pack_versions_epoch trigger. No row = epoch 0. A machine par stamped with any '
  'other epoch is retired at read time (D3, lib/location-sku-shared.ts).';

alter table public.location_sku_settings
  add column if not exists auto_weekday_pack_epoch bigint null,
  add column if not exists auto_weekend_pack_epoch bigint null;
comment on column public.location_sku_settings.auto_weekday_pack_epoch is
  'The pack epoch (0259, sku_pack_epochs) the weekday machine par was computed in. Any other current epoch retires it (D3).';
comment on column public.location_sku_settings.auto_weekend_pack_epoch is
  'The pack epoch (0259, sku_pack_epochs) the weekend machine par was computed in. Any other current epoch retires it (D3).';
-- Existing auto values (none in prod while auto-apply is SHADOW) were computed in epoch 0 (no epoch
-- row exists yet). Stamp them, so 0259 itself retires nothing.
update public.location_sku_settings
   set auto_weekday_pack_epoch = case when auto_weekday_par is not null then 0 end,
       auto_weekend_pack_epoch = case when auto_weekend_par is not null then 0 end
 where auto_weekday_par is not null or auto_weekend_par is not null;

create or replace function public.sku_pack_epoch_bump()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' and new.active then
    if new.location_id is not null then
      -- a shop's own version: that shop's pack changed.
      insert into public.sku_pack_epochs as e (sku_id, location_id, epoch, updated_at)
      values (new.sku_id, new.location_id, 1, clock_timestamp())
      on conflict (sku_id, location_id) do update set epoch = e.epoch + 1, updated_at = clock_timestamp();
    else
      -- the global pack changed: every active shop RIDING it (no own live version) is in a new epoch.
      insert into public.sku_pack_epochs as e (sku_id, location_id, epoch, updated_at)
      select new.sku_id, l.id, 1, clock_timestamp()
        from public.locations l
       where l.active
         and not exists (select 1 from public.sku_pack_versions v
                          where v.sku_id = new.sku_id and v.location_id = l.id and v.active)
      on conflict (sku_id, location_id) do update set epoch = e.epoch + 1, updated_at = clock_timestamp();
    end if;
  elsif tg_op = 'UPDATE' and old.active and not new.active and new.location_id is not null then
    -- a shop version retired ("back to default"): a NEW epoch, never the old one again.
    insert into public.sku_pack_epochs as e (sku_id, location_id, epoch, updated_at)
    values (new.sku_id, new.location_id, 1, clock_timestamp())
    on conflict (sku_id, location_id) do update set epoch = e.epoch + 1, updated_at = clock_timestamp();
  end if;
  return null;
end;
$$;

-- THE PRE-CHAIN BASELINE (Astra 2b r2#5, r3#1). A SKU's FIRST global version (from any writer: the
-- item page, the legacy editor, the vendor import) is about to overwrite its flat mirror; first
-- record the flat pack it had — even an all-null "unknown" one — as a version valid up to this
-- moment, so a past business date resolves to THAT pack (lib/sku-versions-shared.ts
-- packsFromVersions), never to today's overwritten fields.
create or replace function public.sku_pack_versions_flat_baseline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vi public.vendor_items%rowtype;
begin
  if new.location_id is not null or new.flat_snapshot is not null then return new; end if;
  if exists (select 1 from public.sku_pack_versions where sku_id = new.sku_id and location_id is null) then return new; end if;
  select * into v_vi from public.vendor_items where id = new.sku_id;
  -- An ALL-NULL flat pack is recorded too (Astra 2b r3#1): "unknown then" is history, and a past
  -- date must resolve to it — never to the mirror this first chain is about to write.
  if not found then
    return new;
  end if;
  insert into public.sku_pack_versions (sku_id, location_id, active, valid_from, valid_to, note, created_by, flat_snapshot)
  values (new.sku_id, null, false, '2000-01-01T00:00:00Z', new.valid_from, 'pre-chain flat pack (0259 baseline)', new.created_by,
          jsonb_build_object('pack_format', v_vi.pack_format, 'each_container_label', v_vi.each_container_label,
                             'units_per_pack', v_vi.units_per_pack, 'each_size', v_vi.each_size, 'each_measure', v_vi.each_measure));
  return new;
end;
$$;

-- Both triggers are created AFTER the backfill above, so the backfill bumps no epoch and snapshots nothing.
drop trigger if exists sku_pack_versions_flat_baseline on public.sku_pack_versions;
create trigger sku_pack_versions_flat_baseline
  before insert on public.sku_pack_versions
  for each row execute function public.sku_pack_versions_flat_baseline();
drop trigger if exists sku_pack_versions_epoch on public.sku_pack_versions;
create trigger sku_pack_versions_epoch
  after insert or update of active on public.sku_pack_versions
  for each row execute function public.sku_pack_epoch_bump();

-- THE GLOBAL FLAT MIRROR, derived from a version's chain INSIDE the writer's transaction (Astra 2a
-- r2#6): deriveFlatFieldsFromChain's rule in SQL — the unique root's label; the product of the
-- non-leaf quantities (1 for a one-level chain); the leaf's size and unit; and, for a malformed
-- chain, the same all-null mirror with pack_format 'Each (no case)' the TS sync wrote.
create or replace function public.sku_flat_mirror_apply(p_sku uuid, p_version uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_root  public.sku_pack_levels%rowtype;
  v_node  public.sku_pack_levels%rowtype;
  v_roots int;
  v_units numeric := 1;
  v_hops  int := 0;
  v_ok    boolean := true;
begin
  select count(*) into v_roots from public.sku_pack_levels l
   where l.version_id = p_version
     and not exists (select 1 from public.sku_pack_levels c where c.version_id = p_version and c.contains_level_id = l.id);
  if v_roots <> 1 then
    v_ok := false;
  else
    select l.* into v_root from public.sku_pack_levels l
     where l.version_id = p_version
       and not exists (select 1 from public.sku_pack_levels c where c.version_id = p_version and c.contains_level_id = l.id);
    v_node := v_root;
    while v_node.contains_level_id is not null loop
      v_hops := v_hops + 1;
      if v_hops > 16 or v_node.contains_qty <= 0 then v_ok := false; exit; end if;
      v_units := v_units * v_node.contains_qty;
      select l.* into v_node from public.sku_pack_levels l where l.id = v_node.contains_level_id and l.version_id = p_version;
      if not found then v_ok := false; exit; end if;
    end loop;
    if v_ok and (coalesce(btrim(v_node.contains_measure_unit), '') = '' or v_node.contains_qty <= 0) then v_ok := false; end if;
  end if;
  if v_ok then
    update public.vendor_items
       set pack_format = coalesce(nullif(btrim(v_root.label), ''), 'Each (no case)'),
           units_per_pack = case when v_units = trunc(v_units) then v_units::int else null end,
           each_size = v_node.contains_qty,
           each_measure = btrim(v_node.contains_measure_unit)
     where id = p_sku;
  else
    update public.vendor_items set pack_format = 'Each (no case)', units_per_pack = null, each_size = null, each_measure = null where id = p_sku;
  end if;
  return v_ok;
end;
$$;

-- ── (7) the six writers ──────────────────────────────────────────────────────
create or replace function public.save_sku_pack_version(
  p_sku           uuid,
  p_location      uuid,
  p_levels        jsonb,
  p_expected_live uuid,
  p_based_on      uuid,
  p_note          text,
  p_actor         uuid,
  p_first_only    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scope   uuid := coalesce(p_location, '00000000-0000-0000-0000-000000000000'::uuid);
  v_live    uuid;
  v_new     uuid := gen_random_uuid();
  v_now     timestamptz := clock_timestamp();
  v_count   int;
  v_ids     uuid[];
  v_i       int;
  v_level   jsonb;
  v_ptr     int;
  v_unit    text;
  v_written int;
  v_mirror  boolean := null;
begin
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) = 0 then
    raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_levels);
  for v_i in 0 .. v_count - 1 loop
    v_level := p_levels -> v_i;
    if coalesce(jsonb_typeof(v_level), '') <> 'object'
       or coalesce(btrim(v_level ->> 'label'), '') = ''
       or coalesce(jsonb_typeof(v_level -> 'containsQty'), '') <> 'number'
       or (v_level ->> 'containsQty')::numeric <= 0 then
      raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
    end if;
    v_unit := nullif(btrim(coalesce(v_level ->> 'containsMeasureUnit', '')), '');
    if (v_level ->> 'containsIndex') is not null then
      if coalesce(jsonb_typeof(v_level -> 'containsIndex'), '') <> 'number' or v_unit is not null then
        raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
      end if;
      v_ptr := (v_level ->> 'containsIndex')::int;
      if v_ptr < 0 or v_ptr >= v_count or v_ptr = v_i then
        raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
      end if;
    elsif v_unit is null then
      raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
    elsif not exists (select 1 from public.measure_units where label = v_unit and active) then
      raise exception 'sku_pack_version:unknown_measure' using errcode = 'P0001';
    end if;
  end loop;

  -- THE SKU LOCK: every pack/price writer of this SKU serializes here (lock order: SKU, then version).
  perform 1 from public.vendor_items where id = p_sku for update;
  if not found then
    raise exception 'sku_pack_version:sku_not_found' using errcode = 'P0001';
  end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'sku_pack_version:location_not_found' using errcode = 'P0001';
  end if;
  -- FIRST VALUE ONLY (D5), decided under the lock: a GM may set the FIRST global chain, never change one.
  if p_first_only and p_location is null and (
       exists (select 1 from public.sku_pack_versions where sku_id = p_sku and location_id is null and active)
       or exists (select 1 from public.sku_pack_levels where sku_id = p_sku and location_id is null and active)) then
    raise exception 'sku_pack_version:global_requires_moo' using errcode = 'P0001';
  end if;

  select id into v_live from public.sku_pack_versions where sku_id = p_sku and scope_key = v_scope and active for update;
  if v_live is distinct from p_expected_live then
    raise exception 'sku_pack_version:version_changed' using errcode = 'P0001';
  end if;
  if p_based_on is not null and not exists (select 1 from public.sku_pack_versions where id = p_based_on and sku_id = p_sku) then
    raise exception 'sku_pack_version:invalid_based_on' using errcode = 'P0001';
  end if;

  if v_live is not null then
    update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor where id = v_live;
    update public.sku_pack_levels set active = false where version_id = v_live and active;
  end if;
  -- Rows written by pre-2a code in the deploy window (no version yet) are superseded too.
  update public.sku_pack_levels set active = false where sku_id = p_sku and scope_key = v_scope and active and version_id is null;

  insert into public.sku_pack_versions (id, sku_id, location_id, based_on_version_id, active, valid_from, note, created_at, created_by)
  values (v_new, p_sku, p_location, coalesce(p_based_on, v_live), true, v_now, nullif(btrim(coalesce(p_note, '')), ''), v_now, p_actor);

  v_ids := array(select gen_random_uuid() from generate_series(1, v_count));
  insert into public.sku_pack_levels
    (id, sku_id, version_id, location_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal, effective_from, active, created_by)
  select v_ids[t.ord::int], p_sku, v_new, p_location,
         btrim(t.value ->> 'label'), (t.value ->> 'containsQty')::numeric,
         case when (t.value ->> 'containsIndex') is null then null else v_ids[(t.value ->> 'containsIndex')::int + 1] end,
         case when (t.value ->> 'containsIndex') is null then btrim(t.value ->> 'containsMeasureUnit') else null end,
         (t.ord - 1)::int, v_now, true, p_actor
    from jsonb_array_elements(p_levels) with ordinality as t(value, ord);
  get diagnostics v_written = row_count;
  if v_written <> v_count then
    raise exception 'sku_pack_version:readback_failed' using errcode = 'P0001';
  end if;
  -- THE GLOBAL FLAT MIRROR, in THIS transaction under THIS lock (Astra 2a r2#6 / 2b r2#6): two saves
  -- can never commit chains A then B but mirrors B then A. A shop version has no mirror.
  if p_location is null then
    v_mirror := public.sku_flat_mirror_apply(p_sku, v_new);
  end if;
  return jsonb_build_object('version_id', v_new, 'retired_version_id', v_live, 'valid_from', v_now, 'level_count', v_count,
                            'mirror_synced', v_mirror);
end;
$$;

create or replace function public.retire_sku_pack_version(p_version uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sku uuid;
  v_row public.sku_pack_versions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select sku_id into v_sku from public.sku_pack_versions where id = p_version;
  if not found then
    raise exception 'sku_pack_version:not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.vendor_items where id = v_sku for update;
  select * into v_row from public.sku_pack_versions where id = p_version for update;
  if v_row.location_id is null then
    raise exception 'sku_pack_version:global_cannot_retire' using errcode = 'P0001';
  end if;
  if not v_row.active then
    raise exception 'sku_pack_version:not_live' using errcode = 'P0001';
  end if;
  update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor where id = p_version;
  update public.sku_pack_levels set active = false where version_id = p_version and active;
  return jsonb_build_object('version_id', p_version, 'sku_id', v_sku, 'location_id', v_row.location_id, 'valid_to', v_now);
end;
$$;

create or replace function public.save_sku_shop_price(
  p_sku uuid, p_location uuid, p_unit_price numeric, p_effective_date date, p_actor uuid, p_source text, p_source_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lane    uuid;
  v_created boolean := false;
  v_head    uuid;
  v_price   uuid;
  v_now     timestamptz := clock_timestamp();
begin
  if p_location is null then raise exception 'sku_price:location_required' using errcode = 'P0001'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'sku_price:invalid_price' using errcode = 'P0001';
  end if;
  if p_effective_date is null then raise exception 'sku_price:invalid_date' using errcode = 'P0001'; end if;
  perform 1 from public.vendor_items where id = p_sku and active for update;
  if not found then raise exception 'sku_price:sku_not_found' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'sku_price:location_not_found' using errcode = 'P0001';
  end if;
  select id into v_lane from public.sku_price_lanes where sku_id = p_sku and location_id = p_location and active for update;
  if v_lane is null then
    select id into v_head from public.vendor_price_history
     where vendor_item_id = p_sku and location_id is null
     order by effective_date desc, recorded_at desc, id desc limit 1;
    insert into public.sku_price_lanes (sku_id, location_id, based_on_price_id, active, created_at, created_by)
    values (p_sku, p_location, v_head, true, v_now, p_actor) returning id into v_lane;
    v_created := true;
  end if;
  insert into public.vendor_price_history
    (vendor_item_id, unit_price, effective_date, recorded_at, recorded_by, source, source_note, location_id, price_lane_id)
  values (p_sku, p_unit_price, p_effective_date, v_now, p_actor,
          nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_source_note, '')), ''), p_location, v_lane)
  returning id into v_price;
  return jsonb_build_object('price_id', v_price, 'lane_id', v_lane, 'lane_created', v_created, 'recorded_at', v_now);
end;
$$;

create or replace function public.save_sku_global_price(
  p_sku uuid, p_unit_price numeric, p_effective_date date, p_actor uuid, p_first_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_price uuid;
  v_now   timestamptz := clock_timestamp();
begin
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'sku_price:invalid_price' using errcode = 'P0001';
  end if;
  if p_effective_date is null then raise exception 'sku_price:invalid_date' using errcode = 'P0001'; end if;
  -- THE SKU LOCK, then the first-value rule (D5): two first-price requests cannot both see "none".
  perform 1 from public.vendor_items where id = p_sku and active for update;
  if not found then raise exception 'sku_price:sku_not_found' using errcode = 'P0001'; end if;
  if p_first_only and exists (select 1 from public.vendor_price_history where vendor_item_id = p_sku and location_id is null) then
    raise exception 'sku_price:global_requires_moo' using errcode = 'P0001';
  end if;
  insert into public.vendor_price_history (vendor_item_id, unit_price, effective_date, recorded_at, recorded_by)
  values (p_sku, p_unit_price, p_effective_date, v_now, p_actor)
  returning id into v_price;
  return jsonb_build_object('price_id', v_price, 'recorded_at', v_now);
end;
$$;

create or replace function public.retire_sku_price_lane(p_sku uuid, p_location uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lane uuid;
begin
  perform 1 from public.vendor_items where id = p_sku for update;
  if not found then raise exception 'sku_price:sku_not_found' using errcode = 'P0001'; end if;
  update public.sku_price_lanes set active = false, retired_at = clock_timestamp(), retired_by = p_actor
   where sku_id = p_sku and location_id = p_location and active
  returning id into v_lane;
  if v_lane is null then raise exception 'sku_price:no_shop_price' using errcode = 'P0001'; end if;
  return jsonb_build_object('lane_id', v_lane, 'sku_id', p_sku, 'location_id', p_location);
end;
$$;

create or replace function public.record_receiving_prices(p_location uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row     jsonb;
  v_sku     uuid;
  v_lane    uuid;
  v_owner   uuid;
  v_head    uuid;
  v_opened  int := 0;
  v_shop    int := 0;
  v_global  int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'sku_price:invalid_payload' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location) then
    raise exception 'sku_price:location_not_found' using errcode = 'P0001';
  end if;
  -- THE SKU LOCKS FIRST, in id order (no deadlock between two deliveries), so a lane cannot be
  -- opened or retired between "is there a live lane?" and the append below.
  for v_sku in select distinct (r ->> 'vendor_item_id')::uuid from jsonb_array_elements(p_rows) r order by 1 loop
    perform 1 from public.vendor_items where id = v_sku for update;
  end loop;
  for v_row in select r from jsonb_array_elements(p_rows) r loop
    v_sku := (v_row ->> 'vendor_item_id')::uuid;
    if (v_row ->> 'unit_price')::numeric is null or (v_row ->> 'unit_price')::numeric <= 0 then
      raise exception 'sku_price:invalid_price' using errcode = 'P0001';
    end if;
    select id into v_lane from public.sku_price_lanes where sku_id = v_sku and location_id = p_location and active;
    if v_lane is null then
      -- DECISION (e): an invoice is THIS shop's evidence. Its first one (or the first after "back to
      -- default") OPENS the shop's own lane, under the SKU lock taken above — it never moves the
      -- global price every other shop inherits. A shop's OWN store-copy SKU has no other shop: its
      -- price stays the SKU's global row, exactly as before.
      select location_id into v_owner from public.vendor_items where id = v_sku;
      if v_owner is distinct from p_location then
        select id into v_head from public.vendor_price_history
         where vendor_item_id = v_sku and location_id is null
         order by effective_date desc, recorded_at desc, id desc limit 1;
        insert into public.sku_price_lanes (sku_id, location_id, based_on_price_id, active, created_at, created_by)
        values (v_sku, p_location, v_head, true, clock_timestamp(), nullif(v_row ->> 'recorded_by', '')::uuid)
        returning id into v_lane;
        v_opened := v_opened + 1;
      end if;
    end if;
    insert into public.vendor_price_history
      (vendor_item_id, unit_price, effective_date, recorded_by, source, location_id, price_lane_id)
    values (v_sku, (v_row ->> 'unit_price')::numeric, (v_row ->> 'effective_date')::date,
            nullif(v_row ->> 'recorded_by', '')::uuid, nullif(v_row ->> 'source', ''),
            case when v_lane is null then null else p_location end, v_lane);
    if v_lane is null then v_global := v_global + 1; else v_shop := v_shop + 1; end if;
  end loop;
  return jsonb_build_object('shop_rows', v_shop, 'global_rows', v_global, 'lanes_opened', v_opened);
end;
$$;

-- ── (8) the two live SQL chain writers, re-emitted (generated; see the header) ──
-- >>> REEMIT apply_vendor_import (generated by scripts/shop-versions/emit-0259-reemits.ts — do not hand-edit)
-- <<< REEMIT apply_vendor_import
-- >>> REEMIT receiving_create_store_item (generated by scripts/shop-versions/emit-0259-reemits.ts — do not hand-edit)
-- <<< REEMIT receiving_create_store_item

-- ── (9) posture: deny-all tables with a service_role ceiling; service-role writers ──
alter table public.sku_pack_versions enable row level security;
revoke all on public.sku_pack_versions from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_pack_versions to service_role;

alter table public.sku_price_lanes enable row level security;
revoke all on public.sku_price_lanes from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_price_lanes to service_role;

alter table public.sku_pack_epochs enable row level security;
revoke all on public.sku_pack_epochs from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_pack_epochs to service_role;

-- The three helpers run only inside the definer writers and the triggers: nobody calls them directly.
revoke all on function public.sku_pack_epoch_bump() from public, anon, authenticated, service_role;
revoke all on function public.sku_pack_versions_flat_baseline() from public, anon, authenticated, service_role;
revoke all on function public.sku_flat_mirror_apply(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.save_sku_pack_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.retire_sku_pack_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_sku_shop_price(uuid, uuid, numeric, date, uuid, text, text) from public, anon, authenticated;
revoke all on function public.save_sku_global_price(uuid, numeric, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.retire_sku_price_lane(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_receiving_prices(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_vendor_import(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.receiving_create_store_item(uuid, uuid, uuid, uuid, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.save_sku_pack_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean) to service_role;
grant execute on function public.retire_sku_pack_version(uuid, uuid) to service_role;
grant execute on function public.save_sku_shop_price(uuid, uuid, numeric, date, uuid, text, text) to service_role;
grant execute on function public.save_sku_global_price(uuid, numeric, date, uuid, boolean) to service_role;
grant execute on function public.retire_sku_price_lane(uuid, uuid, uuid) to service_role;
grant execute on function public.record_receiving_prices(uuid, jsonb) to service_role;
grant execute on function public.apply_vendor_import(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.receiving_create_store_item(uuid, uuid, uuid, uuid, text, text, numeric, uuid) to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_sku_pack_version', 'retire_sku_pack_version', 'save_sku_shop_price', 'save_sku_global_price',
                                     'retire_sku_price_lane', 'record_receiving_prices', 'apply_vendor_import', 'receiving_create_store_item')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0259: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_pack_versions' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0259: unexpected table grant on sku_pack_versions';
  end if;
  if has_table_privilege('service_role', 'public.sku_pack_versions', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_pack_versions', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_pack_versions', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_pack_versions', 'TRIGGER') then
    raise exception '0259: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_pack_versions', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_pack_versions', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_pack_versions', 'UPDATE')) then
    raise exception '0259: service_role is missing a privilege the writers need';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_price_lanes' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0259: unexpected table grant on sku_price_lanes';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_pack_epochs' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0259: unexpected table grant on sku_pack_epochs';
  end if;
  if has_table_privilege('service_role', 'public.sku_pack_epochs', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_pack_epochs', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_pack_epochs', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_pack_epochs', 'TRIGGER') then
    raise exception '0259: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_pack_epochs', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_pack_epochs', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_pack_epochs', 'UPDATE')) then
    raise exception '0259: service_role is missing a privilege the writers need';
  end if;
  if has_table_privilege('service_role', 'public.sku_price_lanes', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_price_lanes', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_price_lanes', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_price_lanes', 'TRIGGER') then
    raise exception '0259: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_price_lanes', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_price_lanes', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_price_lanes', 'UPDATE')) then
    raise exception '0259: service_role is missing a privilege the writers need';
  end if;
end $$;

commit;
```

- [ ] **Step 5: Generate the re-emits**

Run: `npx tsx scripts/shop-versions/emit-0259-reemits.ts`
Expected:

```
re-emitted apply_vendor_import from 0211_vendor_import.sql (7 mods)
re-emitted receiving_create_store_item from 0216_receiving_store_runs.sql (5 mods)
```

If an anchor does not occur exactly once, the script throws and names it. Fix the anchor against the real source text (`sed -n 160,180p supabase/migrations/0211_vendor_import.sql`), never the generated block.

- [ ] **Step 6: Run the pin**

Run: `npx vitest run tests/shop-versions-migration.test.ts`
Expected: every 0259 test passes. The `0260` tests fail with `ENOENT`, because Task 4 creates that file.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0259_sku_shop_versions.sql scripts/shop-versions tests/shop-versions-migration.test.ts
git commit -F - <<'EOF'
feat(db): 0259 dated shop versions of pack and price, locked writers, scoped re-emits, privilege ceilings (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 4: Migration 0260 — finalize after the deploy

Between the 0259 apply and the 2a deploy, the old TS writer can still save a chain. It deactivates **every** active level of the SKU, including versioned ones, and inserts unversioned rows. 0260 heals exactly that, with real dates: it closes a "live" version whose levels were deactivated underneath it, at the moment it was replaced, and versions the stragglers. Then it makes `version_id` NOT NULL.

**Files:**
- Create: `supabase/migrations/0260_sku_pack_versions_finalize.sql`

- [ ] **Step 1: Create the file**

```sql
-- Migration 0260_sku_pack_versions_finalize
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.
-- ORDER: apply ONLY AFTER the Phase 2a code is deployed to production (plan Task 14, step 9), and
-- only after the A → B → C sequence check (plan Task 4 Step 2) has passed on the sim.
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase2a-shop-versions-data.md (Task 4).
--
-- WHY A SECOND MIGRATION. 0259 had to stay compatible with the code running when it was applied:
-- the pre-2a chain writer deactivates EVERY active level of the SKU — versioned ones included — and
-- inserts rows with no version_id. Between the 0259 apply and the 2a deploy that can leave (a) a
-- version marked live whose levels are all inactive, and (b) level sets with no version. After the
-- deploy every chain write goes through save_sku_pack_version, so the window is closed; this heals
-- it WITH REAL DATES (so as-of resolution stays true), asserts every invariant the resolver relies
-- on, and makes version_id NOT NULL so a forgotten writer (a spent seed, the 0201 one-shot bundle)
-- fails loudly instead of writing an orphan.
--
-- VERIFY AFTER APPLY:
--   select is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'sku_pack_levels' and column_name = 'version_id';  -- NO
--   select count(*) from public.sku_pack_versions where note = '0260 backfill';  -- SKUs saved in the window (usually 0)

begin;

-- The baseline trigger (0259) must not fire while the window is healed: a SKU whose FIRST chain was
-- written in the window by the old code already had its flat mirror overwritten, so a "baseline"
-- taken now would record the NEW pack as the old one. Healing inserts no baseline.
alter table public.sku_pack_versions disable trigger sku_pack_versions_flat_baseline;

do $$
declare
  v_touched  uuid[];
  v_orphaned int;
  v_healed   int;
  v_redated  int;
  v_null     int;
  v_multi    int;
  v_empty    int;
  v_mismatch int;
  v_overlap  int;
begin
  -- The SKUs the window touched: an unversioned level set, or a version marked live whose levels
  -- were deactivated underneath it by the old writer.
  select coalesce(array_agg(distinct x.sku_id), '{}') into v_touched from (
    select sku_id from public.sku_pack_levels where version_id is null
    union
    select v.sku_id from public.sku_pack_versions v
     where v.active and not exists (select 1 from public.sku_pack_levels l where l.version_id = v.id and l.active)
  ) x;

  -- (a) a version marked live with no live level is no longer live (its end is re-dated in (c)).
  update public.sku_pack_versions v
     set active = false, valid_to = clock_timestamp()
   where v.active
     and not exists (select 1 from public.sku_pack_levels l where l.version_id = v.id and l.active);
  get diagnostics v_orphaned = row_count;

  -- (b) straggler level sets become global versions starting at their own effective_from (the
  --     end is a placeholder until (c)).
  insert into public.sku_pack_versions (sku_id, location_id, active, valid_from, valid_to, note, created_at, created_by)
  select g.sku_id, null, g.active, g.effective_from,
         case when g.active then null else g.effective_from end,
         '0260 backfill', g.effective_from, g.created_by
    from (select sku_id, effective_from, active, (array_agg(created_by order by id))[1] as created_by
            from public.sku_pack_levels where version_id is null
           group by sku_id, effective_from, active) g;
  get diagnostics v_healed = row_count;

  update public.sku_pack_levels l
     set version_id = v.id
    from public.sku_pack_versions v
   where l.version_id is null and v.note = '0260 backfill'
     and v.sku_id = l.sku_id and v.valid_from = l.effective_from and v.active = l.active;

  -- (c) RE-DATE THE WHOLE GLOBAL TIMELINE of every touched SKU, across versioned AND healed rows
  --     (Astra 2a r2#5): each closed version ends exactly when the next one (in valid_from order)
  --     began. A → B (old code, unversioned) → C (new code) gives A until B, B until C — so a past
  --     day inside B resolves to B, never to A. Pre-chain baselines keep their own end.
  with t as (
    select v.id, lead(v.valid_from) over (partition by v.sku_id order by v.valid_from, v.created_at, v.id) as next_from
      from public.sku_pack_versions v
     where v.location_id is null and v.flat_snapshot is null and v.sku_id = any (v_touched)
  )
  update public.sku_pack_versions v
     set valid_to = coalesce(t.next_from, v.valid_to, clock_timestamp())
    from t
   where v.id = t.id and not v.active
     and v.valid_to is distinct from coalesce(t.next_from, v.valid_to, clock_timestamp());
  get diagnostics v_redated = row_count;

  select count(*) into v_null from public.sku_pack_levels where version_id is null;
  assert v_null = 0, format('0260: %s levels still without a version', v_null);

  select count(*) into v_multi
    from (select sku_id from public.sku_pack_versions where active group by sku_id, scope_key having count(*) > 1) x;
  assert v_multi = 0, format('0260: %s (sku, scope) pairs with two live chains', v_multi);

  select count(*) into v_empty from public.sku_pack_versions v
   where v.active and not exists (select 1 from public.sku_pack_levels l where l.version_id = v.id and l.active);
  assert v_empty = 0, format('0260: %s live versions with no live level', v_empty);

  select count(*) into v_mismatch from public.sku_pack_levels l
    join public.sku_pack_versions v on v.id = l.version_id
   where l.active <> v.active;
  assert v_mismatch = 0, format('0260: %s levels disagree with their version about being live', v_mismatch);

  -- No two global chain versions of a touched SKU are in force at the same instant.
  select count(*) into v_overlap
    from public.sku_pack_versions a join public.sku_pack_versions b
      on a.sku_id = b.sku_id and a.id < b.id and a.location_id is null and b.location_id is null
     and a.flat_snapshot is null and b.flat_snapshot is null
     and a.valid_from < coalesce(b.valid_to, 'infinity') and b.valid_from < coalesce(a.valid_to, 'infinity')
   where a.sku_id = any (v_touched);
  assert v_overlap = 0, format('0260: %s overlapping global version intervals', v_overlap);

  raise notice '0260: % orphaned live versions closed, % straggler sets versioned, % versions re-dated', v_orphaned, v_healed, v_redated;
end $$;

alter table public.sku_pack_versions enable trigger sku_pack_versions_flat_baseline;

alter table public.sku_pack_levels alter column version_id set not null;

commit;
```

- [ ] **Step 2: The A → B → C sequence check (a real SQL test of the heal, run on the SIM)**

This is the deployment-window case the heal exists for. **Before** 0260 is applied on the sim (Task 14 Step 8), run this through `execute_sql` as one script, with the 0260 body pasted at the marked line, without its own `begin;`/`commit;`. It sets up A (a backfilled live global version), then B (the OLD writer: every level deactivated, an unversioned set inserted), then C (the NEW writer). After it runs the heal, it asserts the intervals and **rolls everything back**.

```sql
begin;
do $$
declare v_sku uuid; v_a uuid; v_b timestamptz; v_c jsonb;
begin
  select v.sku_id, v.id into v_sku, v_a from public.sku_pack_versions v
   where v.location_id is null and v.active and v.flat_snapshot is null limit 1;
  -- B: the pre-2a writer.
  v_b := clock_timestamp();
  update public.sku_pack_levels set active = false where sku_id = v_sku and active;
  insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal, effective_from, active)
  values (gen_random_uuid(), v_sku, 'zz-check-case', 7, null, 'lb', 0, v_b, true);
  perform pg_sleep(0.01);
  -- C: the 2a writer (A is still marked live, so it is the expected live version).
  v_c := public.save_sku_pack_version(v_sku, null, '[{"label":"zz-check-box","containsQty":9,"containsIndex":null,"containsMeasureUnit":"lb"}]'::jsonb, v_a, null, null, null, false);
  create temp table finalize_check as
    select v_sku as sku_id, v_a as a_id, v_b as b_from, (v_c ->> 'version_id')::uuid as c_id, (v_c ->> 'valid_from')::timestamptz as c_from;
end $$;

-- >>> paste the 0260 body here (everything between its begin; and commit;) <<<

do $$
declare r record; v_b uuid;
begin
  select * into r from finalize_check;
  assert (select valid_to from public.sku_pack_versions where id = r.a_id) = r.b_from, 'A must end exactly when B began';
  select id into v_b from public.sku_pack_versions where sku_id = r.sku_id and note = '0260 backfill' and valid_from = r.b_from;
  assert v_b is not null, 'B must be versioned';
  assert (select valid_to from public.sku_pack_versions where id = v_b) = r.c_from, 'B must end exactly when C began';
  assert (select active and valid_to is null from public.sku_pack_versions where id = r.c_id), 'C stays live';
  raise notice 'finalize sequence check: OK';
end $$;
rollback;
```

Expected: `NOTICE: finalize sequence check: OK`, and nothing persists (`rollback`). On the pre-fix heal this fails at "A must end exactly when B began": C's save closed A at C's time, so A ended at C and B got a zero-length interval.

- [ ] **Step 3: Run the pin, then commit**

Run: `npx vitest run tests/shop-versions-migration.test.ts`
Expected: PASS, 0 failed.

```bash
git add supabase/migrations/0260_sku_pack_versions_finalize.sql
git commit -F - <<'EOF'
feat(db): 0260 finalize pack versions after the 2a deploy — heal the window with real dates, version_id NOT NULL (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 5: The pack resolver at the loader points — live (paged), as of a date (D1) — and every pack consumer routed through it

The scope parameter becomes **required** on `loadSkuPackChains` / `loadAllSkuPackChains`, so the compiler lists every consumer, and each gets an explicit decision from the routing table below. The live loader is now **paged and id-chunked**: global plus shop rows can exceed the PostgREST row cap (Astra 2a#12). `loadRecipeGraph` gains:
- `versionLocationId`, which defaults to its `locationId`, so callers that already pass a shop follow that shop's versions automatically;
- `asOf`, which resolves the versions in force at an instant.

`createDatedGraphs` hands depletion one graph per business date. It reuses the live graph whenever no pack boundary falls after that day, which is the common case and keeps the batch law. **Product resolution is unchanged everywhere.** The two flat-only consumers (manual production, catering surplus) move onto `contentOzForScope` (Astra 2a#1, #11).

**Routing table (the decision per consumer):**

| Consumer | Scope | Clock |
|---|---|---|
| `lib/admin/catalog.ts:183`, `lib/admin/toast-map.ts:249,602`, `scripts/parity-angel.ts:389`, `scripts/sim/product-identity/day1-vendor-down.ts:171,234` (`loadRecipeGraph()`) | global (unchanged) | now |
| `lib/admin/menu-costing.ts` board | **the selected shop** (Task 6b) — graph AND prices; "All shops" = global, labelled | now |
| `lib/admin/cost.ts:144` ledgers; `lib/admin/readiness-load.ts:60`; `lib/weights.ts:301`; `app/admin/skus/page.tsx:81`; `app/admin/vendors/[id]/page.tsx:104`; `lib/products.ts:341` `listProducts`; `lib/admin/pack-chain.ts` `loadSkuPackChain` (legacy editor read) | global, explicit `null` | now |
| `lib/products.ts:698` `loadProductIndex` | its `locationId` | now |
| `lib/counts-read-refs.ts:79`, `lib/counts.ts:394` | the count's shop | now (the count stores the ounces it converted) |
| `lib/ordering.ts` walk, rescue, submit, shrinkage; `lib/dynamic-pars.ts:438` | the walk's shop | now |
| `lib/receiving.ts:321,805,1209`; `lib/purchase-orders.ts:1509` | the delivery's / PO's shop | now (receipts store ounces) |
| `lib/catering/sku-demand.ts:137`; sku-demand / surplus graphs | `args.locationId` | now (forecast) |
| `lib/production.ts:381` manual production | the production's shop, via `contentOzForScope` | now (stores `input_oz`) |
| `lib/catering/surplus.ts:162-177` | `args.locationId`, via `contentOzForScope` | now |
| `lib/prep-consumption.ts` capture helpers → `lib/opening.ts:1029,1039,2149,2318`, `lib/prep.ts:987,1142,1148,1735`, `lib/yield-stats.ts:274,401,547` (via `lib/batch-prep.ts`) | the instance's shop (versions only; product resolution stays global as today) | now (stores `input_oz`) |
| `lib/catering/toast-sales.ts:565` (materialize), `:1002` (derive), `:816` context; `lib/ezcater/depletion.ts:76-97`; `lib/ezcater/pass2.ts:52-56,169` | their shop | **as of the business date (D1)** |
| `lib/report-package.ts:223,259` | per row's shop | now (valuation at current cost; quantities are stored) |
| `lib/sku-data-readiness.ts` | per shop (Task 7) | now |
| `lib/vendor-import.ts:93` | global, explicit (Task 6) | now |

**Files:** every file in the table, plus `lib/prep-consumption.ts`, `tests/fixtures/shop-versions-harness.ts`, `tests/fixtures/counts-fake-db.ts`, `tests/silent-read-fabrication.test.ts`, `tests/fixtures/counts-v0-oracle.ts`, `tests/counts-onhand-equivalence.test.ts`, `app/(authed)/operations/counts/page.tsx`.
**Also:** `lib/production-units-shared.ts` (create: the prep "each"/"case" conversion, moved out of `components/production/ProductionConsumptionPanel.tsx` so it can be tested), `components/production/ProductionConsumptionPanel.tsx`.
**Tests:** `tests/shop-versions-as-of.test.ts`, `tests/scoped-flat-consumers.test.ts`.

- [ ] **Step 1: Point the harness at the scoped API, and write the two new tests (failing)**

In `tests/fixtures/shop-versions-harness.ts`:
- Add `createDatedGraphs, loadSkuPackResolution` to the `@/lib/prep-consumption` import, and `import { contentOzForScope } from "@/lib/sku-versions-shared";`.
- Replace the four `// TASK-5` lines with:

```ts
  chains: (skuIds, scope) => loadSkuPackChains(skuIds, scope),
  allChains: (scope) => loadAllSkuPackChains(scope),
  datedGraph: (scope, businessDate) => createDatedGraphs({ locationId: scope })(businessDate),
  flatContent: async (flat, scope, measures) => {
    const packs = await loadSkuPackResolution([...flat.keys()], scope);
    return new Map([...flat].map(([id, f]) => [id, contentOzForScope(f, packs.get(id), measures)]));
  },
```

- Remove `skuContentOz` from its `@/lib/recipe-math` import if lint reports it unused.

Create `tests/shop-versions-as-of.test.ts` (D1):

```ts
/**
 * Catalog Phase 2a — D1: a shop pack version made TODAY never changes YESTERDAY's rebuilt depletion.
 * The materializer's seam is loadSalesConsumptionContext(...).graphFor(businessDate); the cron's
 * prior-day repair (lib/toast-sales-pull-run.ts) rebuilds T-1..T-3 through it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER } from "./fixtures/shop-versions-fixture";
import { createDatedGraphs, loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForMenuItemFromGraph } from "@/lib/prep-consumption-graph";
import { loadSalesConsumptionContext } from "@/lib/catering/toast-sales";
import { skuContentOz } from "@/lib/recipe-math";
import { readFileSync } from "node:fs";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const TODAY_SAVE = "2026-10-15T14:00:00.000Z";
/** LOC makes its own turkey case (4 × 10 lb = 640 oz) at 10 AM ET on 2026-10-15. */
function withTodaysShopVersion() {
  const t = buildShopVersionsFixture();
  t.sku_pack_versions!.push({ id: "sv-today", sku_id: "s-turkey", location_id: LOC, based_on_version_id: "pv-s-turkey-live", active: true, valid_from: TODAY_SAVE, valid_to: null });
  t.sku_pack_levels!.push(
    { id: "sv-c", sku_id: "s-turkey", version_id: "sv-today", location_id: LOC, effective_from: TODAY_SAVE, label: "case", contains_qty: 4, contains_level_id: "sv-b", contains_measure_unit: null, display_ordinal: 0, active: true },
    { id: "sv-b", sku_id: "s-turkey", version_id: "sv-today", location_id: LOC, effective_from: TODAY_SAVE, label: "bag", contains_qty: 10, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1, active: true },
  );
  t.toast_menu_map = [];
  t.toast_ingest_exclusions = [];
  return t;
}
const turkeyOz = (g: Awaited<ReturnType<typeof loadRecipeGraph>>) => perUnitSkuOzForMenuItemFromGraph(g, "m-italian").get("s-turkey");

beforeEach(() => { current = createFakeDb(withTodaysShopVersion()); });
afterEach(() => { current = null; });

describe("D1 — depletion resolves packs as of its business date", () => {
  it("yesterday (2026-10-14) still depletes 4 oz per Italian at LOC; today 8 oz; live 8 oz", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    expect(turkeyOz(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkeyOz(await dated("2026-10-15"))).toBeCloseTo(8, 10);
    expect(turkeyOz(await loadRecipeGraph({ locationId: LOC }))).toBeCloseTo(8, 10);
  });
  it("the materializer's own seam: the sales context rebuilds yesterday with yesterday's pack", async () => {
    const ctx = await loadSalesConsumptionContext(LOC);
    expect(turkeyOz(await ctx.graphFor!("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkeyOz(await ctx.graphFor!("2026-10-15"))).toBeCloseTo(8, 10);
  });
  it("another shop is untouched on every date", async () => {
    const dated = createDatedGraphs({ locationId: OTHER });
    expect(turkeyOz(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkeyOz(await dated("2026-10-15"))).toBeCloseTo(4, 10);
  });
  it("ezCater: the Toast window AND the actual-order loop both resolve by business date (Astra 2a r2#3)", () => {
    const src = readFileSync("lib/ezcater/depletion.ts", "utf8");
    expect(src).toContain("const dayGraph = await context.graphFor!(date);");
    expect(src).toContain("const graph = await datedGraphFor(locationId, order.event_date); // D1: the order's event date");
    expect(readFileSync("lib/ezcater/pass2.ts", "utf8")).toContain("const graph = await graphFor(order.location_id, order.event_date!);");
  });
  it("a SKU's FIRST global chain made today: yesterday still resolves to its old FLAT pack (Astra 2b r2#5)", async () => {
    const t = withTodaysShopVersion();
    const lettuce = t.vendor_items!.find((v) => v.id === "s-lettuce")!;
    const oldFlat = { pack_format: lettuce.pack_format, each_container_label: lettuce.each_container_label ?? null, units_per_pack: lettuce.units_per_pack, each_size: lettuce.each_size, each_measure: lettuce.each_measure };
    // The save overwrote the mirror with the new chain (a 12 lb case); the trigger kept the old flat pack as a baseline.
    Object.assign(lettuce, { pack_format: "case", units_per_pack: 1, each_size: 12, each_measure: "lb" });
    t.sku_pack_versions!.push(
      { id: "base-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: false, valid_from: "2000-01-01T00:00:00.000Z", valid_to: TODAY_SAVE, flat_snapshot: oldFlat },
      { id: "g-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: true, valid_from: TODAY_SAVE, valid_to: null },
    );
    t.sku_pack_levels!.push({ id: "g-let-c", sku_id: "s-lettuce", version_id: "g-let", location_id: null, effective_from: TODAY_SAVE, label: "case", contains_qty: 12, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0, active: true });
    current = createFakeDb(t);
    const dated = createDatedGraphs({ locationId: OTHER });
    const content = (g: Awaited<ReturnType<typeof loadRecipeGraph>>) => skuContentOz(g.skuPack.get("s-lettuce")!, g.measures);
    expect(content(await dated("2026-10-14"))).toBe(384); // the old 24 × 1 lb flat pack
    expect(content(await dated("2026-10-15"))).toBe(192); // the new 12 lb case
  });
  it("a SKU whose pack was UNKNOWN before its first chain: yesterday stays unknown (null), never today's 192 (Astra 2b r3#1)", async () => {
    const t = withTodaysShopVersion();
    const lettuce = t.vendor_items!.find((v) => v.id === "s-lettuce")!;
    Object.assign(lettuce, { pack_format: "case", units_per_pack: 1, each_size: 12, each_measure: "lb" }); // the mirror the first chain wrote
    t.sku_pack_versions!.push(
      { id: "base-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: false, valid_from: "2000-01-01T00:00:00.000Z", valid_to: TODAY_SAVE,
        flat_snapshot: { pack_format: null, each_container_label: null, units_per_pack: null, each_size: null, each_measure: null } },
      { id: "g-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: true, valid_from: TODAY_SAVE, valid_to: null },
    );
    t.sku_pack_levels!.push({ id: "g-let-c", sku_id: "s-lettuce", version_id: "g-let", location_id: null, effective_from: TODAY_SAVE, label: "case", contains_qty: 12, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0, active: true });
    current = createFakeDb(t);
    const dated = createDatedGraphs({ locationId: OTHER });
    const content = (g: Awaited<ReturnType<typeof loadRecipeGraph>>) => skuContentOz(g.skuPack.get("s-lettuce")!, g.measures);
    expect(content(await dated("2026-10-14"))).toBeNull();
    expect(content(await dated("2026-10-15"))).toBe(192);
  });
  it("a day after every boundary reuses the live graph (no extra graph load)", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    const before = current!.log.filter((q) => q.table === "recipes").length;
    await dated("2026-10-16");
    await dated("2026-10-17");
    expect(current!.log.filter((q) => q.table === "recipes").length - before).toBe(1);
  });
});
```

Create `tests/scoped-flat-consumers.test.ts` (Astra 2a#1, #11):

```ts
/**
 * Catalog Phase 2a — the two flat-only consumers follow the shop's pack: manual production PERSISTS
 * the shop's ounces; catering surplus divides by the shop's case. Global answers stay byte-identical.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER } from "./fixtures/shop-versions-fixture";
import { recordProduction } from "@/lib/production";
import { loadDerivedForItems, recordProductionFromPrep } from "@/lib/prep-consumption";
import { unitToOz } from "@/lib/production-units-shared";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));

/** LOC buys lettuce as a case of 4 × 10 lb bags (640 oz); the global flat pack is 24 × 1 lb (384 oz). */
function withShopLettuce() {
  const t = buildShopVersionsFixture();
  const at = "2026-10-10T00:00:00.000Z";
  t.sku_pack_versions!.push({ id: "sv-let", sku_id: "s-lettuce", location_id: LOC, based_on_version_id: null, active: true, valid_from: at, valid_to: null });
  t.sku_pack_levels!.push(
    { id: "sv-let-c", sku_id: "s-lettuce", version_id: "sv-let", location_id: LOC, effective_from: at, label: "case", contains_qty: 4, contains_level_id: "sv-let-b", contains_measure_unit: null, display_ordinal: 0, active: true },
    { id: "sv-let-b", sku_id: "s-lettuce", version_id: "sv-let", location_id: LOC, effective_from: at, label: "bag", contains_qty: 10, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1, active: true },
  );
  t.productions = [];
  t.production_inputs = [];
  return t;
}
const actor = (locations: string[]) => ({ user: { id: "u-cook", role: "key_holder" }, role: "key_holder", level: 4, locations }) as unknown as AuthContext;

beforeEach(() => { current = createFakeDb(withShopLettuce()); });
afterEach(() => { current = null; });

describe("manual production persists the shop's ounces", () => {
  it("1 case at LOC = 640 oz consumed (its own case); 1 case at OTHER = 384 oz (the global case)", async () => {
    await recordProduction(actor([LOC, OTHER]), { locationId: LOC, inputSkuId: "s-lettuce", inputQty: 1, outputItemId: "i-slaw", outputQty: 2 });
    await recordProduction(actor([LOC, OTHER]), { locationId: OTHER, inputSkuId: "s-lettuce", inputQty: 1, outputItemId: "i-slaw", outputQty: 2 });
    const lines = current!.writes.filter((w) => w.table === "production_inputs").flatMap((w) => w.rows);
    expect(lines.map((l) => l.input_oz)).toEqual([640, 384]);
  });
});

describe("prep's 'each' comes from the SAME pack as its content (Astra 2a r2#1)", () => {
  it("1 each at LOC = 160 oz (640 ÷ 4 bags), never 640 ÷ the global 24; 1 each at OTHER = 16 oz", async () => {
    const atLoc = (await loadDerivedForItems(["i-slaw"], LOC)).get("i-slaw")!.find((d) => d.skuId === "s-lettuce")!;
    expect(atLoc).toMatchObject({ unitsPerPack: 4, contentOz: 640 });
    expect(unitToOz(1, "each", atLoc)).toBe(160); // what the panel persists as the consumed ounces
    const atOther = (await loadDerivedForItems(["i-slaw"], OTHER)).get("i-slaw")!.find((d) => d.skuId === "s-lettuce")!;
    expect(atOther).toMatchObject({ unitsPerPack: 24, contentOz: 384 });
    expect(unitToOz(1, "each", atOther)).toBe(16);

    // THE SAVE ITSELF (Astra r3 remark): the prep form's "1 each" goes through recordProductionFromPrep,
    // and the persisted production_inputs row carries 160 oz. A recording client stands in for the
    // database here (the fake db has no update(), which the supersede step uses).
    const saved: Array<Record<string, unknown>> = [];
    const chain = (table: string): Record<string, unknown> => {
      const q: Record<string, unknown> = {
        update: () => q, eq: () => q, is: () => q, select: () => q,
        insert: (rows: unknown) => { if (table === "production_inputs") saved.push(...(rows as Array<Record<string, unknown>>)); return q; },
        maybeSingle: async () => ({ data: { id: "prod-1" }, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    };
    current = { client: { from: chain } } as never;
    await recordProductionFromPrep({ userId: "u-cook", role: "key_holder" }, {
      locationId: LOC, instanceId: "inst-1", templateItemId: "tpl-1", outputItemId: "i-slaw", outputQty: 2, source: "opening_p2",
      confirmedConsumption: [{ skuId: "s-lettuce", qtyOz: unitToOz(1, "each", atLoc), qtyEntered: 1, unitEntered: "each", derivedOz: null }],
    });
    expect(saved).toEqual([expect.objectContaining({ input_sku_id: "s-lettuce", input_oz: 160, qty_entered: 1, unit_entered: "each" })]);
  });
});

describe("catering surplus divides by the shop's case", () => {
  it("routes its denominator through the one resolver and the scoped content rule", () => {
    const src = readFileSync("lib/catering/surplus.ts", "utf8");
    expect(src).toContain("loadSkuPackResolution(skuIds, args.locationId ?? null)");
    expect(src).toContain("contentOzForScope(");
  });
});
```

Run: `npx tsc --noEmit 2>&1 | grep -E "shop-versions-harness|shop-versions-as-of|scoped-flat"`
Expected: errors (`Expected 1 arguments, but got 2`, `has no exported member 'createDatedGraphs'`). This is the failing state.

- [ ] **Step 2: The fake DB learns `insert` (the persisted-ounce test needs it)**

In `tests/fixtures/counts-fake-db.ts`:
- Add `let insertRows: Row[] | null = null;` next to `let upsertRows: Row[] | null = null;`.
- At the very top of `run`, directly after `log.push({ table, select: selectStr, depth });`, insert:

```ts
      if (insertRows) {
        const list = (tables[table] ??= []);
        const inserted = insertRows.map((r, i) => ({ id: `ins-${table}-${list.length + i + 1}`, ...r }));
        list.push(...inserted);
        writes.push({ table, rows: inserted });
        const fields = parseSelect(selectStr);
        const projected = inserted.map((r) => project(table, r, fields)).filter((r): r is Row => r !== null);
        return { data: single ? (projected[0] ?? null) : projected, error: null };
      }
```

- Add the builder method next to `upsert(...)`:

```ts
      insert(rows: Row | Row[]) { insertRows = Array.isArray(rows) ? rows : [rows]; return q; },
```

(`select("id")` after `insert` sets `selectStr`, exactly as PostgREST's `return=representation`.)

- [ ] **Step 3: Rewrite the pack loaders in `lib/prep-consumption.ts`**

Add to the imports, after `import type { PackChainLevel } from "@/lib/pack-chain-shared";`:

```ts
import {
  asOfForBusinessDate, assertScopeToken, levelsBySku, packsFromVersions, pickVersionsAsOf, resolvePackLevels,
  type ResolvedPack, type ScopedLevelRow, type ScopedVersionRow, type VersionScope,
} from "@/lib/sku-versions-shared";
```

Replace the whole block from `async function loadSkuPack(skuIds: string[]): Promise<Map<string, RecipeInputSku>> {` through the end of `function groupPackLevels(...) { ... }` (current lines 51–130) with:

```ts
async function loadSkuPack(skuIds: string[], scope: VersionScope, asOf: string | null = null): Promise<Map<string, RecipeInputSku>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  // A SKU absent from this map has no pack basis, which reads downstream as "we cannot
  // weigh this" — the honest answer for a genuinely unweighed SKU and a lie for a
  // weighed one the read simply failed to return.
  if (error) throw new Error(`loadSkuPack: ${error.message}`);
  const packs = await loadSkuPackResolution(skuIds, scope, asOf);
  return new Map((data ?? []).map((s) => {
    const pack = packs.get(s.id);
    // A past date inside a PRE-CHAIN BASELINE (0259) reads the flat pack it preserved, not today's
    // overwritten mirror (Astra 2b r2#5). Every other answer reads the flat fields exactly as before.
    const f = pack?.flat;
    return [s.id, {
      packFormat: f ? f.pack_format : s.pack_format, eachContainerLabel: f ? f.each_container_label : s.each_container_label,
      unitsPerPack: f ? f.units_per_pack : s.units_per_pack, eachSize: num(f ? f.each_size : s.each_size), eachMeasure: f ? f.each_measure : s.each_measure,
      avgOzPerEach: num(s.avg_oz_per_each),
      packChain: pack && pack.levels.length > 0 ? pack.levels : null,
    }];
  }));
}

/**
 * The level columns every pack read selects. version_id / location_id / effective_from ride along
 * so THE ONE RESOLVER (lib/sku-versions-shared.ts) can choose "this shop's version, else the global
 * one" — no consumer ever chooses (catalog Phase 2a, 0259).
 */
const PACK_LEVEL_COLUMNS =
  "id, sku_id, version_id, location_id, effective_from, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal";
/** How many ids ride one `.in()` filter (the request-line budget, lib/supabase-paginate.ts). */
const ID_CHUNK = 100;

/**
 * THE PACK RESOLVER POINT (catalog Phase 2a). Chains for these SKUs as `scope` sees them — `null` =
 * the global default; a shop id = that shop's version, else the global one. LIVE by default; with
 * `asOf`, the versions IN FORCE at that instant (D1 — a past business date's packs). PAGED and
 * id-CHUNKED: {global ∪ shop} rows can exceed the row cap, and a truncated page would drop a leaf
 * and break a conversion silently. `scope` is REQUIRED so the compiler makes every caller decide.
 */
export async function loadSkuPackResolution(skuIds: string[], scope: VersionScope, asOf: string | null = null): Promise<Map<string, ResolvedPack>> {
  if (skuIds.length === 0) return new Map();
  if (asOf != null) return loadSkuPackResolutionAsOf(skuIds, scope, asOf);
  const sb = getServiceRoleClient();
  const rows: ScopedLevelRow[] = [];
  for (let i = 0; i < skuIds.length; i += ID_CHUNK) {
    const chunk = skuIds.slice(i, i + ID_CHUNK);
    rows.push(...await selectAllRows<ScopedLevelRow>(async (from, to) => {
      const base = sb.from("sku_pack_levels").select(PACK_LEVEL_COLUMNS).in("sku_id", chunk).eq("active", true);
      const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
      const { data, error } = await scoped
        .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<ScopedLevelRow[]>();
      // "No chain" is a MEANINGFUL answer (it routes the SKU to the legacy flat-field path), so a
      // swallowed failure would silently re-denominate every chained SKU in the graph.
      if (error) throw new Error(`loadSkuPackChains: ${error.message}`);
      return { data };
    }));
  }
  return resolvePackLevels(rows, scope);
}

/** D1: the versions in force at `asOf` (versions first, then exactly their levels; both paged). */
async function loadSkuPackResolutionAsOf(skuIds: string[], scope: VersionScope, asOf: string): Promise<Map<string, ResolvedPack>> {
  const sb = getServiceRoleClient();
  const versions: ScopedVersionRow[] = [];
  for (let i = 0; i < skuIds.length; i += ID_CHUNK) {
    const chunk = skuIds.slice(i, i + ID_CHUNK);
    versions.push(...await selectAllRows<ScopedVersionRow>(async (from, to) => {
      const base = sb.from("sku_pack_versions").select("id, sku_id, location_id, valid_from, valid_to, flat_snapshot").in("sku_id", chunk).lte("valid_from", asOf);
      const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
      const { data, error } = await scoped.order("id", { ascending: true }).range(from, to).returns<ScopedVersionRow[]>();
      if (error) throw new Error(`loadSkuPackChains as-of versions: ${error.message}`);
      return { data };
    }));
  }
  const picked = pickVersionsAsOf(versions, scope, asOf);
  const versionIds = [...new Set([...picked.values()].filter((v) => !v.flat_snapshot).map((v) => v.id))];
  const levels: ScopedLevelRow[] = [];
  for (let i = 0; i < versionIds.length; i += ID_CHUNK) {
    const chunk = versionIds.slice(i, i + ID_CHUNK);
    levels.push(...await selectAllRows<ScopedLevelRow>(async (from, to) => {
      const { data, error } = await sb.from("sku_pack_levels").select(PACK_LEVEL_COLUMNS).in("version_id", chunk)
        .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<ScopedLevelRow[]>();
      if (error) throw new Error(`loadSkuPackChains as-of levels: ${error.message}`);
      return { data };
    }));
  }
  return packsFromVersions(picked, levels);
}

/** Chain levels per SKU for `scope` (the pre-0259 return shape); missing entry = no chain. */
export async function loadSkuPackChains(skuIds: string[], scope: VersionScope, asOf: string | null = null): Promise<Map<string, PackChainLevel[]>> {
  return levelsBySku(await loadSkuPackResolution(skuIds, scope, asOf));
}

/**
 * EVERY live chain, grouped per SKU, as `scope` sees them (B9: the counts render needs chains for
 * nearly the whole catalog, and a ~200-id `.in()` list sits at the request-line ceiling). PAGED.
 */
export async function loadAllSkuPackResolution(scope: VersionScope): Promise<Map<string, ResolvedPack>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<ScopedLevelRow>(async (from, to) => {
    const base = sb.from("sku_pack_levels").select(PACK_LEVEL_COLUMNS).eq("active", true);
    const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped
      .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
      .range(from, to).returns<ScopedLevelRow[]>();
    if (error) throw new Error(`loadAllSkuPackChains: ${error.message}`);
    return { data };
  });
  return resolvePackLevels(rows, scope);
}

export async function loadAllSkuPackChains(scope: VersionScope): Promise<Map<string, PackChainLevel[]>> {
  return levelsBySku(await loadAllSkuPackResolution(scope));
}

/**
 * The latest pack BOUNDARY (a version opening or closing) visible to `scope` — after it, nothing
 * changed, so any business date ending later resolves to exactly the live graph. Two indexed reads.
 */
export async function loadLatestPackBoundary(scope: VersionScope): Promise<string | null> {
  const sb = getServiceRoleClient();
  const base = () => {
    const q = sb.from("sku_pack_versions").select("valid_from, valid_to");
    return scope == null ? q.is("location_id", null) : q.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
  };
  const [opened, closed] = await Promise.all([
    base().order("valid_from", { ascending: false }).limit(1).returns<Array<{ valid_from: string; valid_to: string | null }>>(),
    base().not("valid_to", "is", null).order("valid_to", { ascending: false }).limit(1).returns<Array<{ valid_from: string; valid_to: string | null }>>(),
  ]);
  if (opened.error) throw new Error(`loadLatestPackBoundary opened: ${opened.error.message}`);
  if (closed.error) throw new Error(`loadLatestPackBoundary closed: ${closed.error.message}`);
  const times = [opened.data?.[0]?.valid_from, closed.data?.[0]?.valid_to].filter((t): t is string => typeof t === "string");
  return times.length === 0 ? null : times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/**
 * D1 — ONE graph per business date for a shop, with the batch law kept: a date ending after the
 * last pack boundary IS the live graph (loaded once); an earlier date loads its own as-of graph,
 * memoized. Depletion (Toast and ezCater) resolves through this, so yesterday's rebuilt sales use
 * yesterday's packs. Product resolution is unchanged (current, as before).
 */
export function createDatedGraphs(opts: { locationId: string | null; liveGraph?: RecipeGraph }): (businessDate: string) => Promise<RecipeGraph> {
  let live: Promise<RecipeGraph> | null = opts.liveGraph ? Promise.resolve(opts.liveGraph) : null;
  let epoch: Promise<string | null> | null = null;
  const dated = new Map<string, Promise<RecipeGraph>>();
  return async (businessDate: string) => {
    const asOf = asOfForBusinessDate(businessDate);
    epoch ??= loadLatestPackBoundary(opts.locationId);
    const e = await epoch;
    if (e == null || Date.parse(asOf) >= Date.parse(e)) {
      live ??= loadRecipeGraph({ locationId: opts.locationId });
      return live;
    }
    let g = dated.get(businessDate);
    if (!g) { g = loadRecipeGraph({ locationId: opts.locationId, asOf }); dated.set(businessDate, g); }
    return g;
  };
}
```

- [ ] **Step 4: `loadRecipeGraph` gains `versionLocationId` and `asOf`**

Replace:

```ts
export async function loadRecipeGraph(opts?: { locationId?: string | null }): Promise<RecipeGraph> {
  const locationId = opts?.locationId ?? null;
```

with:

```ts
export async function loadRecipeGraph(opts?: { locationId?: string | null; versionLocationId?: string | null; asOf?: string | null }): Promise<RecipeGraph> {
  const locationId = opts?.locationId ?? null;
  // WHOSE SHOP VERSIONS, AND WHEN (catalog Phase 2a, 0259). `versionLocationId` defaults to the
  // product-resolution location, so every location-aware caller follows that shop's pack versions.
  // Capture paths pass ONLY versionLocationId: their ounces become the shop's while their product
  // resolution stays global exactly as today. `asOf` (D1) resolves the packs in force at an instant.
  const versionScope: VersionScope = opts?.versionLocationId !== undefined ? opts.versionLocationId : locationId;
  const asOf = opts?.asOf ?? null;
```

Then replace `    loadSkuPack(skuIds),` with `    loadSkuPack(skuIds, versionScope, asOf),`, and `    for (const [id, pack] of await loadSkuPack(memberIds)) skuPack.set(id, pack);` with `    for (const [id, pack] of await loadSkuPack(memberIds, versionScope, asOf)) skuPack.set(id, pack);`. In the doc comment above `loadRecipeGraph`, append this paragraph after the `opts.locationId (deviation D7)` paragraph:

```ts
 *
 * `opts.versionLocationId` (catalog Phase 2a) chooses whose SHOP VERSIONS of pack chains the graph's
 * skuPack carries (default: `locationId`); `opts.asOf` chooses WHEN (default: now). Depletion for a
 * business date goes through createDatedGraphs, never through a bare live graph.
```

- [ ] **Step 5: The one-shot capture helpers take a version scope**

Replace each line on the left with the line on the right:

| Replace | With |
|---|---|
| `export async function perUnitSkuOzForItem(itemId: string): Promise<Map<string, number>> {` + next line `  const graph = await loadRecipeGraph();` | `export async function perUnitSkuOzForItem(itemId: string, versionLocationId: VersionScope): Promise<Map<string, number>> {` + `  const graph = await loadRecipeGraph({ versionLocationId });` |
| `export async function perUnitSkuOzForMenuItem(menuItemId: string): Promise<Map<string, number>> {` + `  const graph = await loadRecipeGraph();` | `export async function perUnitSkuOzForMenuItem(menuItemId: string, versionLocationId: VersionScope): Promise<Map<string, number>> {` + `  const graph = await loadRecipeGraph({ versionLocationId });` |
| `export async function skuConsumptionForItem(itemId: string, outputQty: number): Promise<Map<string, number>> {` and `  const perUnit = await perUnitSkuOzForItem(itemId);` | `export async function skuConsumptionForItem(itemId: string, outputQty: number, versionLocationId: VersionScope): Promise<Map<string, number>> {` and `  const perUnit = await perUnitSkuOzForItem(itemId, versionLocationId);` |
| `export async function loadDerivedForItems(itemIds: string[]): Promise<Map<string, DerivedSku[]>> {` | `export async function loadDerivedForItems(itemIds: string[], versionLocationId: VersionScope): Promise<Map<string, DerivedSku[]>> {` |
| inside it, `  const graph = await loadRecipeGraph();` | `  const graph = await loadRecipeGraph({ versionLocationId });` |
| inside it, `    const chainsBySku = await loadSkuPackChains([...allSkuIds]); // chain-aware content (0159)` | `    const packs = await loadSkuPackResolution([...allSkuIds], versionLocationId); // this shop's pack (0259)` |
| `async function hydrateSkuInfo(` / `  graph: RecipeGraph,` / `  skuIds: string[],` / `): Promise<…>` | the same with `  scope: VersionScope,` added after `  skuIds: string[],` |
| inside it, `  const chainsBySku = await loadSkuPackChains(skuIds);` | `  const packs = await loadSkuPackResolution(skuIds, scope);` |
| `  const skuInfo = await hydrateSkuInfo(graph, [...allSkuIds]);` | `  const skuInfo = await hydrateSkuInfo(graph, [...allSkuIds], locationId);` |

Then, in BOTH `loadDerivedForItems` and `hydrateSkuInfo`, one selected pack answers BOTH numbers prep shows (Astra 2a r2#1): its content AND its units per pack. Mixing a shop chain's content with the global flat count is how "1 each" of a 4 × 10 lb case became 640 ÷ 6 = 106.67 oz instead of 160. In `loadDerivedForItems` replace

```ts
      const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: chainsBySku.get(s.id) ?? null }, measures);
      skuInfo.set(s.id, { name: s.name, unitsPerPack: s.units_per_pack, contentOz });
```

with

```ts
      const pack = packs.get(s.id);
      const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: pack && pack.levels.length > 0 ? pack.levels : null }, measures);
      skuInfo.set(s.id, { name: s.name, unitsPerPack: unitsPerPackForScope(s.units_per_pack, pack), contentOz });
```

and in `hydrateSkuInfo` replace

```ts
    const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: chainsBySku.get(s.id) ?? null }, graph.measures);
    skuInfo.set(s.id, { name: s.name, unitsPerPack: s.units_per_pack, contentOz });
```

with

```ts
    const pack = packs.get(s.id);
    const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: pack && pack.levels.length > 0 ? pack.levels : null }, graph.measures);
    skuInfo.set(s.id, { name: s.name, unitsPerPack: unitsPerPackForScope(s.units_per_pack, pack), contentOz });
```

and add `unitsPerPackForScope` to the `@/lib/sku-versions-shared` import. Global answers are byte-identical: the content uses the same chain as before (a resolution entry exists exactly when the chain map had one), and `unitsPerPackForScope` returns the flat count for any global answer.

**The prep conversion becomes testable.** Create `lib/production-units-shared.ts` with the three helpers from `components/production/ProductionConsumptionPanel.tsx`, moved verbatim and exported:

```ts
/**
 * Prep consumption units — PURE (catalog Phase 2a moved these out of ProductionConsumptionPanel so
 * the persisted ounces can be tested). "case" = the selected pack's content; "each" = content ÷ units
 * per pack, both from the SAME selected pack (lib/prep-consumption.ts DerivedSku).
 */
import type { DerivedSku } from "@/lib/prep-consumption";

export type DisplayUnit = "case" | "each" | "oz";

/** oz → display quantity in a given unit. Returns null when conversion is impossible. */
export function ozToUnit(oz: number, unit: DisplayUnit, d: DerivedSku): number | null {
  if (unit === "oz") return oz;
  if (unit === "case") {
    return d.contentOz && d.contentOz > 0 ? oz / d.contentOz : null;
  }
  if (d.contentOz && d.contentOz > 0 && d.unitsPerPack && d.unitsPerPack > 0) {
    return oz / (d.contentOz / d.unitsPerPack);
  }
  return null;
}

/** Display quantity in unit → oz. */
export function unitToOz(qty: number, unit: DisplayUnit, d: DerivedSku): number {
  if (unit === "oz") return qty;
  if (unit === "case") {
    return qty * (d.contentOz ?? 0);
  }
  const ozPerEach =
    d.contentOz && d.unitsPerPack && d.unitsPerPack > 0
      ? d.contentOz / d.unitsPerPack
      : 0;
  return qty * ozPerEach;
}

/** Best default display unit: case > each > oz. */
export function defaultDisplayUnit(d: DerivedSku): DisplayUnit {
  if (d.contentOz && d.contentOz > 0) return "case";
  if (d.contentOz && d.contentOz > 0 && d.unitsPerPack && d.unitsPerPack > 0) return "each";
  return "oz";
}
```

`import type` of `DerivedSku` erases, so the module stays client-safe. In `components/production/ProductionConsumptionPanel.tsx`, delete the local `type DisplayUnit`, `ozToUnit`, `unitToOz` and `defaultDisplayUnit` (from `type DisplayUnit = "case" | "each" | "oz";` through the closing `}` of `defaultDisplayUnit`). Add `import { defaultDisplayUnit, ozToUnit, unitToOz, type DisplayUnit } from "@/lib/production-units-shared";`. The panel's behaviour does not change.

In `lib/batch-prep.ts`, add `import type { VersionScope } from "@/lib/sku-versions-shared";`. Then make these two replacements:
- `export async function loadBatchContextForItems(itemIds: string[], graphIn?: RecipeGraph): Promise<Map<string, BatchItemContext>> {` → `export async function loadBatchContextForItems(itemIds: string[], versionLocationId: VersionScope, graphIn?: RecipeGraph): Promise<Map<string, BatchItemContext>> {`
- `  const graph = graphIn ?? (await loadRecipeGraph());` → `  const graph = graphIn ?? (await loadRecipeGraph({ versionLocationId }));`

- [ ] **Step 6: The capture-path callers pass their shop**

| File | Replace | With |
|---|---|---|
| `lib/opening.ts` | `  const derivedMap = await loadDerivedForItems(phase2DerivedItemIds);` | `  const derivedMap = await loadDerivedForItems(phase2DerivedItemIds, args.locationId);` |
| `lib/opening.ts` | `  const batchContextMap = await loadBatchContextForItems(phase2DerivedItemIds);` | `  const batchContextMap = await loadBatchContextForItems(phase2DerivedItemIds, args.locationId);` |
| `lib/opening.ts` | `(await loadBatchContextForItems([tItemPre.item_id])).get(tItemPre.item_id)` | `(await loadBatchContextForItems([tItemPre.item_id], args.locationId)).get(tItemPre.item_id)` |
| `lib/opening.ts` | `        const m = await skuConsumptionForItem(tItem.item_id, args.entry.openerPrepped);` | `        const m = await skuConsumptionForItem(tItem.item_id, args.entry.openerPrepped, args.locationId);` |
| `lib/prep.ts` | `  const amBatchContext = await loadBatchContextForItems(amItemIds);` | `  const amBatchContext = await loadBatchContextForItems(amItemIds, args.locationId);` |
| `lib/prep.ts` | `  const derivedByItemId = await loadDerivedForItems(itemIds);` | `  const derivedByItemId = await loadDerivedForItems(itemIds, instanceRow.location_id);` |
| `lib/prep.ts` | `  const batchContextByItemId = await loadBatchContextForItems(itemIds);` | `  const batchContextByItemId = await loadBatchContextForItems(itemIds, instanceRow.location_id);` |
| `lib/prep.ts` | `        const derivedMap = await skuConsumptionForItem(item.itemId, args.prepped);` | `        const derivedMap = await skuConsumptionForItem(item.itemId, args.prepped, state.instance.locationId);` |
| `lib/yield-stats.ts` | `    loadBatchContextForItems(itemIds),` | `    loadBatchContextForItems(itemIds, locationId),` |
| `lib/yield-stats.ts` (2×, replace-all) | `  const ctx = (await loadBatchContextForItems([input.itemId])).get(input.itemId);` | `  const ctx = (await loadBatchContextForItems([input.itemId], input.locationId)).get(input.itemId);` |

- [ ] **Step 7: Every other live pack consumer passes its explicit scope**

| File | Replace | With |
|---|---|---|
| `lib/admin/cost.ts` (`loadChainAwareContentOz`) | `    loadSkuPackChains(skuIds),` | `    loadSkuPackChains(skuIds, null), // the drawer's ledgers span every shop: the global default` |
| `lib/admin/readiness-load.ts` | `loadSkuPackChains(ids), loadMeasureUnits(actor),` | `loadSkuPackChains(ids, null), loadMeasureUnits(actor),` |
| `app/admin/skus/page.tsx` | `  const chainMap = await loadSkuPackChains(skus.map((s) => s.id));` | `  const chainMap = await loadSkuPackChains(skus.map((s) => s.id), null); // the global default` |
| `app/admin/vendors/[id]/page.tsx` | `  const chainMap = await loadSkuPackChains(skus.map((s) => s.id));` | `  const chainMap = await loadSkuPackChains(skus.map((s) => s.id), null);` |
| `lib/products.ts` (`listProducts`) | `    loadMeasures(), loadSkuPackChains(members.map((m) => m.id)),` | `    loadMeasures(), loadSkuPackChains(members.map((m) => m.id), null),` |
| `lib/products.ts` (`loadProductIndex`) | `    shared.packChains ? shared.packChains(memberIds) : loadSkuPackChains(memberIds),` | `    shared.packChains ? shared.packChains(memberIds) : loadSkuPackChains(memberIds, locationId),` |
| `lib/ordering.ts` (4 sites) | every `loadSkuPackChains(skuIds)` / `loadSkuPackChains(rescueIds)` | the same with `, locationId` (Task 12 then moves the walk and the submit onto the shared pack-aware overlay loader) |
| `lib/dynamic-pars.ts` | `    loadSkuPackChains(skuIds),` | `    loadSkuPackChains(skuIds, locationId),` |
| `lib/purchase-orders.ts` (`loadPoDetail`) | `  const chains = await loadSkuPackChains(availableSkus.map((s) => s.id));` | `  const chains = await loadSkuPackChains(availableSkus.map((s) => s.id), po.location_id);` |
| `lib/catering/sku-demand.ts` | `loadSkuPackChains(skuIds)]);` | `loadSkuPackChains(skuIds, args.locationId ?? null)]);` |
| `lib/receiving.ts` | `async function loadReceivingChains(ids: string[]): Promise<Map<string, PackChainLevel[]>> {` / `    const chunk = await loadSkuPackChains(ids.slice(i, i + 100));` | `async function loadReceivingChains(ids: string[], locationId: string): Promise<Map<string, PackChainLevel[]>> {` / `    const chunk = await loadSkuPackChains(ids.slice(i, i + 100), locationId);` |
| `lib/receiving.ts` | `    loadReceivingChains(skuList.map((s) => s.id)),` | `    loadReceivingChains(skuList.map((s) => s.id), locationId),` |
| `lib/receiving.ts` | `  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds)]);` | `  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds, deliveryLocationId ?? null)]);` |
| `lib/receiving.ts` | `  const chainsBySku = await loadSkuPackChains(poSkuIds);` | `  const chainsBySku = await loadSkuPackChains(poSkuIds, locationId);` |
| `lib/admin/pack-chain.ts` (`loadSkuPackChain`) | after `    .eq("active", true)` in that function | insert `    .is("location_id", null)` |

Confirm with `grep -n "loadSkuPackChains(" lib/ordering.ts`: four lines, each with `, locationId)`.

- [ ] **Step 8: The two flat-only consumers go through `contentOzForScope`**

`lib/production.ts`: add `import { loadSkuPackResolution } from "@/lib/prep-consumption";` and `import { contentOzForScope } from "@/lib/sku-versions-shared";`. Replace the whole `skuContentOzById` function (from its `/** content_oz (oz per pack) for one SKU, or null if not configured. */` comment through its closing `}`) with:

```ts
/**
 * content_oz (oz per pack) for one SKU AT A SHOP (catalog Phase 2a): the shop's own pack version
 * when it has one, else today's flat mirror byte-for-byte (contentOzForScope). Manual production
 * PERSISTS input_oz from this, so the shop's case must be the one counted.
 */
async function skuContentOzAt(skuId: string, locationId: string): Promise<number | null> {
  const sb = getServiceRoleClient();
  const [{ data: sku }, packs, measures] = await Promise.all([
    sb.from("vendor_items").select("units_per_pack, each_size, each_measure, avg_oz_per_each").eq("id", skuId)
      .maybeSingle<{ units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>(),
    loadSkuPackResolution([skuId], locationId),
    loadMeasuresMap(),
  ]);
  if (!sku) return null;
  return contentOzForScope(
    { unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: num(sku.avg_oz_per_each) },
    packs.get(skuId),
    measures,
  );
}
```

and `  const contentOz = await skuContentOzById(input.inputSkuId);` → `  const contentOz = await skuContentOzAt(input.inputSkuId, input.locationId);`. Remove `skuContentOz` from the `@/lib/recipe-math` import if lint reports it unused.

`lib/catering/surplus.ts`: add `import { loadSkuPackResolution } from "@/lib/prep-consumption";` (merge it into the existing prep-consumption import) and `import { contentOzForScope } from "@/lib/sku-versions-shared";`. Replace:

```ts
    const measures = await loadMeasures();
    const { data: skuRows } = await sb
```

with:

```ts
    // The shop's own case when it has one (catalog Phase 2a); else today's flat mirror, unchanged.
    const [measures, packs] = await Promise.all([loadMeasures(), loadSkuPackResolution(skuIds, args.locationId ?? null)]);
    const { data: skuRows } = await sb
```

and replace

```ts
      const contentOz = skuContentOz(
        { unitsPerPack: s.units_per_pack, eachSize: num(s.each_size) || null, eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) || null },
        measures,
      );
```

with

```ts
      const contentOz = contentOzForScope(
        { unitsPerPack: s.units_per_pack, eachSize: num(s.each_size) || null, eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) || null },
        packs.get(s.id),
        measures,
      );
```

- [ ] **Step 9: Depletion resolves packs as of its business date (D1)**

`lib/catering/toast-sales.ts`:
- Add `import { asOfForBusinessDate } from "@/lib/sku-versions-shared";` and add `createDatedGraphs` to the `@/lib/prep-consumption` import.
- In `SalesConsumptionContext`, after `  graph: RecipeGraph;` add:

```ts
  /**
   * D1 — the graph for ONE business date (packs in force that day). Optional only so hand-built test
   * contexts compile; loadSalesConsumptionContext always sets it, and every derivation prefers it.
   */
  graphFor?: (businessDate: string) => Promise<RecipeGraph>;
```

- In `loadSalesConsumptionContext`, replace `  return { locationId, graph: resolvedGraph, mapRows,` with `  return { locationId, graph: resolvedGraph, graphFor: createDatedGraphs({ locationId, liveGraph: resolvedGraph }), mapRows,`.
- Replace `  const graph = context?.graph ?? await loadRecipeGraph({ locationId });` with:

```ts
  // CATALOG PHASE 2a (D1): a business date's ounces resolve through the packs IN FORCE THAT DAY —
  // a shop pack version made today never re-resolves yesterday's rebuilt depletion.
  const graph = context?.graphFor
    ? await context.graphFor(businessDate)
    : context?.graph ?? await loadRecipeGraph({ locationId, asOf: asOfForBusinessDate(businessDate) });
```

- In `materializeCapturedDepletion`, replace `  const graph = await loadRecipeGraph({ locationId });` with `  const graph = await loadRecipeGraph({ locationId, asOf: asOfForBusinessDate(businessDate) });`.

`lib/ezcater/depletion.ts` has TWO loops, and both are dated (Astra 2a r2#3):
- The Toast window: directly after `    for (const [date, day] of days) {`, insert `      const dayGraph = await context.graphFor!(date); // D1: that day's packs`. Then replace `perUnitSkuAttributionsForItem(graph, item.itemId)` with `perUnitSkuAttributionsForItem(dayGraph, item.itemId)`.
- The actual ezCater orders: directly after the `graphFor` helper's closing `  };`, add:

```ts
  // D1: an ezCater ORDER depletes through the packs in force on its event date — never today's.
  const datedByLocation = new Map<string, ReturnType<typeof createDatedGraphs>>();
  const datedGraphFor = (locationId: string, businessDate: string) => {
    let dated = datedByLocation.get(locationId);
    if (!dated) { dated = createDatedGraphs({ locationId, liveGraph: graphs.get(locationId) }); datedByLocation.set(locationId, dated); }
    return dated(businessDate);
  };
```

  Then, in the order loop, replace `      const graph = await graphFor(locationId);` (six spaces of indentation: the line directly after `      if (window.locationId && locationId !== window.locationId) continue;`) with `      const graph = await datedGraphFor(locationId, order.event_date); // D1: the order's event date`. That `graph` feeds `customizedLineAmounts`, so the order's amounts are dated too. Add `createDatedGraphs` to the file's `@/lib/prep-consumption` import.

`lib/ezcater/pass2.ts`: add `import { createDatedGraphs } from "@/lib/prep-consumption";` (merge it with the existing import) and replace:

```ts
  const graphs = new Map<string, Awaited<ReturnType<typeof loadRecipeGraph>>>();
  const graphFor = async (locationId: string) => {
    let graph = graphs.get(locationId);
    if (!graph) { graph = await loadRecipeGraph({ locationId }); graphs.set(locationId, graph); }
    return graph;
  };
```

with:

```ts
  // D1: an order's ounces resolve through the packs in force on its event date.
  const datedByLocation = new Map<string, ReturnType<typeof createDatedGraphs>>();
  const graphFor = async (locationId: string, businessDate: string) => {
    let dated = datedByLocation.get(locationId);
    if (!dated) { dated = createDatedGraphs({ locationId }); datedByLocation.set(locationId, dated); }
    return dated(businessDate);
  };
```

and `        const graph = await graphFor(order.location_id);` → `        const graph = await graphFor(order.location_id, order.event_date!);`. Remove the `loadRecipeGraph` import from `pass2.ts` if lint reports it unused.

- [ ] **Step 10: `lib/counts.ts` and the counts refs are per shop**

In `lib/counts-read-refs.ts`:
- Add `import type { VersionScope } from "@/lib/sku-versions-shared";`.
- Replace `export function createCountsReadRefs(): CountsReadRefs {` with:

```ts
/**
 * ONE SHOP PER RENDER (catalog Phase 2a). The refs read that shop's live pack versions; a product
 * index asked for under a different shop would mix two shops' chains, so it refuses.
 */
export function createCountsReadRefs(shopScope: VersionScope): CountsReadRefs {
```

- Replace `  const allChains = once(() => loadAllSkuPackChains());` with `  const allChains = once(() => loadAllSkuPackChains(shopScope));`.
- As the first statement inside `const productIndex = async (productIds: readonly string[], locationId: string): Promise<ProductIndexLoad> => {`, insert `    if (locationId !== shopScope) throw new Error("counts refs: one shop per render");`.

In `lib/counts.ts`:
- Replace each `refs: CountsReadRefs = createCountsReadRefs()` default with `refs: CountsReadRefs = createCountsReadRefs(locationId)`. There are five sites; each has `locationId` as an earlier parameter. Confirm with `grep -n "createCountsReadRefs(" lib/counts.ts`.
- `async function loadRecipeSkus(skuIds: string[]): Promise<Map<string, RecipeInputSku>> {` → `async function loadRecipeSkus(skuIds: string[], scope: VersionScope): Promise<Map<string, RecipeInputSku>> {`, and inside it `  const chainsBySku = await loadSkuPackChains(skuIds);` → `  const chainsBySku = await loadSkuPackChains(skuIds, scope);`.
- `loadRecipeSkus(skuIds)]);` (in `createCountEvent`) → `loadRecipeSkus(skuIds, input.locationId)]);`, and `loadRecipeSkus(primaryIds)]);` (in `allocateProductLines`) → `loadRecipeSkus(primaryIds, locationId)]);`.
- Add `import type { VersionScope } from "@/lib/sku-versions-shared";`.

In `app/(authed)/operations/counts/page.tsx`: `  const refs = createCountsReadRefs();` → `  const refs = createCountsReadRefs(location);`.
In `tests/counts-onhand-equivalence.test.ts`: `  const refs = counts.createCountsReadRefs();` → `  const refs = counts.createCountsReadRefs(LOC);`.
In `tests/fixtures/counts-v0-oracle.ts` (the frozen oracle; a **type-only** accommodation, since its semantics were global): `loadSkuPackChains(list.map((s) => s.id))` → `loadSkuPackChains(list.map((s) => s.id), null)`, and `    loadSkuPackChains(countSkuIds),` → `    loadSkuPackChains(countSkuIds, null),`.

- [ ] **Step 11: `lib/report-package.ts` values waste and inventory at the shop that tossed or counted**

Waste block:
- `      const [items, who, graph] = await Promise.all([` → the two lines `      const shopIds = [...new Set(rows.map((r) => r.location_id as string))];` and `      const [items, who, costing] = await Promise.all([`.
- Replace

```ts
        loadRecipeGraph(),
      ]);
      const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()]));
```

with

```ts
        Promise.all(shopIds.map(async (shopId) => {
          const graph = await loadRecipeGraph({ versionLocationId: shopId });
          const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()]));
          return [shopId, { graph, costPerOz }] as const;
        })).then((pairs) => new Map(pairs)),
      ]);
```

- `        const rollup = rollupItemCost(graph, r.item_id as string, costPerOz);` → the two lines `        const shopCosting = costing.get(r.location_id as string)!;` and `        const rollup = rollupItemCost(shopCosting.graph, r.item_id as string, shopCosting.costPerOz);`.

Inventory block:
- `      const [skus, chains, measures, prices, who] = await Promise.all([` → `      const [skus, chainsByShop, measures, prices, who] = await Promise.all([`.
- `        loadSkuPackChains(skuIds),` → `        Promise.all(locationIds.map(async (shopId) => [shopId, await loadSkuPackChains(skuIds, shopId)] as const)).then((p) => new Map(p)),`.
- Replace the `const sku = new Map(skus.map((s) => [s.id, { … }]));` block (seven lines starting `      const sku = new Map(skus.map((s) => [s.id, {`) with:

```ts
      const skuRow = new Map(skus.map((s) => [s.id, s]));
      const eventShop = new Map(events.map((e) => [e.id, e.location_id]));
      // Cost per oz AT THE SHOP THAT COUNTED: its own pack version (0259), else the global one.
      const costPerOzAt = (shopId: string | undefined, skuId: string): number | null => {
        const s = skuRow.get(skuId);
        if (!s || !shopId) return null;
        return skuCostPerOz(prices.get(skuId) ?? null, skuContentOz({
          unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each),
          packChain: chainsByShop.get(shopId)?.get(skuId) ?? null,
        }, measures));
      };
```

- `sku: sku.get(l.sku_id as string)?.name ?? "(sku)",` → `sku: skuRow.get(l.sku_id as string)?.name ?? "(sku)",`
- `        cost_per_oz: sku.get(l.sku_id as string)?.costPerOz ?? null,` → `        cost_per_oz: costPerOzAt(eventShop.get(l.count_event_id as string), l.sku_id as string),`

(Task 6 makes `prices` per shop as well.)

- [ ] **Step 12: Update the source pin**

In `tests/silent-read-fabrication.test.ts`, replace `      ["export async function loadSkuPackChains(", "loadSkuPackChains:"],` with:

```ts
      // Catalog Phase 2a: the query (and its throw) moved into the resolver point; the markers stay.
      ["export async function loadSkuPackResolution(", "loadSkuPackChains:"],
      ["export async function loadAllSkuPackResolution(", "loadAllSkuPackChains:"],
```

- [ ] **Step 13: Typecheck, then the pins**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

Run: `npx vitest run tests/shop-versions-equivalence.test.ts tests/shop-versions-as-of.test.ts tests/scoped-flat-consumers.test.ts tests/counts-onhand-equivalence.test.ts tests/silent-read-fabrication.test.ts tests/sku-versions-shared.test.ts tests/opening-phase2-batch-save.test.ts tests/yield-stats-server.test.ts tests/prep-bad-row-writers.test.ts tests/products-store-loader.test.ts tests/ordering-po-exists.test.ts tests/toast-sales-context.test.ts tests/ezcater-depletion.test.ts`

Expected: PASS, 0 failed. **The golden is unchanged:** `git diff --stat tests/fixtures/shop-versions-golden.json` prints nothing.

- [ ] **Step 14: Commit**

```bash
git add -A lib app tests
git commit -F - <<'EOF'
feat(catalog): every pack consumer resolves through the one scoped resolver — paged, and dated for depletion (no live number moves)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6: The price resolver — every price consumer routed through it; receiving appends under the lock

**Files:**
- Modify: `lib/admin/cost.ts`, `lib/purchase-orders.ts`, `lib/receiving.ts`, `lib/admin/menu-costing.ts`, `lib/admin/readiness-load.ts`, `lib/weights.ts`, `lib/report-package.ts`, `lib/vendor-import.ts`, `app/admin/skus/page.tsx`, `app/admin/vendors/[id]/page.tsx`, `tests/fixtures/shop-versions-harness.ts`, `tests/receiving-store-prices.test.ts`
- Test: `tests/receiving-price-lanes.test.ts`

`receivingPriceRows` keeps its exact signature and payload. Its existing tests stay unchanged, because the lane decision moved into SQL. `record_receiving_prices` takes those rows and, per SKU, under the SKU lock, appends to the shop's live lane. When the shop has none — its first invoice, or the first after "back to default" — it **opens the shop's first lane** and appends there (decision e; Astra 2a#9, r2#4). A delivery never moves the global price another shop inherits. The one exception is a shop's own store-copy SKU, which has no other shop; its price stays the SKU's global row, as before.

- [ ] **Step 1: Point the harness at the scoped price API, and write the source pin (failing)**

In `tests/fixtures/shop-versions-harness.ts`, replace `  prices: (skuIds, _scope) => loadCurrentSkuPrices(skuIds), // TASK-6` with `  prices: (skuIds, scope) => loadCurrentSkuPrices(skuIds, scope),`.

Create `tests/receiving-price-lanes.test.ts`:

```ts
/**
 * Catalog Phase 2a — a delivery's price lands in the shop's lane: its live one, else a lane the
 * delivery OPENS (decision e) — decided IN THE DATABASE under the SKU lock (record_receiving_prices),
 * so a lane opened or retired concurrently can never strand an invoice price, and a shop's first
 * invoice never moves the global price other shops inherit (Astra 2a#9, r2#4). The payload is unchanged.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { receivingPriceRows } from "@/lib/receiving-shared";

describe("receiving prices", () => {
  it("the payload is byte-identical to before (no lane in TS)", () => {
    expect(JSON.stringify(receivingPriceRows([{ skuId: "a", unitPrice: 12.5 }], "2026-10-07", "kh", "vendor")))
      .toBe(JSON.stringify([{ vendor_item_id: "a", unit_price: 12.5, effective_date: "2026-10-07", recorded_by: "kh" }]));
  });
  it("both receiving writes go through the locked RPC with the delivery's shop, never a bare insert", () => {
    const src = readFileSync("lib/receiving.ts", "utf8");
    expect(src).toContain('sb.rpc("record_receiving_prices", { p_location: input.locationId, p_rows: receivingPriceRows(priced, input.deliveryDate, actor.user.id, vend.source_kind) })');
    expect(src).toContain('sb.rpc("record_receiving_prices", { p_location: h.location_id, p_rows: receivingPriceRows(priced, h.delivery_date, actor.user.id, source.source_kind) })');
    expect(src).not.toContain('from("vendor_price_history").insert(');
  });
});
```

Run: `npx vitest run tests/receiving-price-lanes.test.ts` → FAIL (the second test).

- [ ] **Step 2: The scoped price resolver in `lib/admin/cost.ts`**

Add to the imports:

```ts
import { assertScopeToken, resolveCurrentPrices, type ResolvedPrice, type ScopedPriceRow, type VersionScope } from "@/lib/sku-versions-shared";
```

Replace the whole `loadCurrentSkuPrices` function, from its doc comment through its closing `}`, with:

```ts
const PRICE_COLUMNS = "id, vendor_item_id, unit_price, effective_date, recorded_at, location_id, price_lane_id";
const PRICE_ID_CHUNK = 100;

/** This shop's LIVE price lanes for these SKUs (0259): skuId → lane id. Paged; throws on error. */
export async function loadLiveShopPriceLanes(skuIds: string[], locationId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  for (let i = 0; i < skuIds.length; i += PRICE_ID_CHUNK) {
    const chunk = skuIds.slice(i, i + PRICE_ID_CHUNK);
    const rows = await selectAllRows<{ id: string; sku_id: string }>((from, to) => sb
      .from("sku_price_lanes").select("id, sku_id").eq("location_id", assertScopeToken(locationId)).eq("active", true)
      .in("sku_id", chunk).order("id", { ascending: true }).range(from, to));
    for (const r of rows) out.set(r.sku_id, r.id);
  }
  return out;
}

/**
 * THE PRICE RESOLVER POINT (catalog Phase 2a). Current pack price per SKU as `scope` sees it:
 * `null` = the newest GLOBAL row; a shop id = the newest row of that shop's LIVE lane, else the
 * newest global row. The rule is pure (lib/sku-versions-shared.ts resolveCurrentPrices). Paged past
 * PostgREST's row cap (an append-only ledger grows per delivery line); `id` makes newest-first a
 * total order. `scope` is REQUIRED: an optional one is how a consumer silently stays global.
 */
export async function loadCurrentSkuPriceHeads(skuIds: string[], scope: VersionScope): Promise<Map<string, ResolvedPrice>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const rows: ScopedPriceRow[] = [];
  for (let i = 0; i < skuIds.length; i += PRICE_ID_CHUNK) {
    const chunk = skuIds.slice(i, i + PRICE_ID_CHUNK);
    rows.push(...await selectAllRows<ScopedPriceRow>((from, to) => {
      const base = sb.from("vendor_price_history").select(PRICE_COLUMNS).in("vendor_item_id", chunk);
      const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
      return scoped.order("effective_date", { ascending: false }).order("recorded_at", { ascending: false })
        .order("id", { ascending: false }).range(from, to);
    }));
  }
  const lanes = scope == null ? new Map<string, string>() : await loadLiveShopPriceLanes(skuIds, scope);
  return resolveCurrentPrices(rows, lanes);
}

/** Current pack price (dollars) per SKU for `scope` — the pre-0259 return shape. */
export async function loadCurrentSkuPrices(skuIds: string[], scope: VersionScope): Promise<Map<string, number>> {
  const heads = await loadCurrentSkuPriceHeads(skuIds, scope);
  return new Map([...heads].map(([id, h]) => [id, h.value]));
}
```

Rows from different chunks never share a SKU, so the per-SKU newest-first order the pure rule needs holds.

In `loadSkuPriceHistory`, insert `    .is("location_id", null) // the global ledger; a shop's lane is listed on the item page (2b)` after `    .eq("vendor_item_id", skuId)`. In `loadSkuReceivingLedger` and `loadSkuConsumption`, replace `  const prices = await loadCurrentSkuPrices(skuIds);` (two occurrences) with `  const prices = await loadCurrentSkuPrices(skuIds, null); // org-wide ledgers: the global price`. (`recordSkuPrice` moves onto its RPC in Task 9.)

- [ ] **Step 3: Purchase orders use the one resolver, at the PO's shop**

In `lib/purchase-orders.ts`, add `import { loadCurrentSkuPrices } from "@/lib/admin/cost";` and `import { priceCentsFromDollars } from "@/lib/sku-versions-shared";`. Replace the whole `loadLatestPriceCentsBySku` function, from its doc comment through its closing `}`, with:

```ts
/**
 * Latest price (in CENTS) per SKU at the PO's shop — THE ONE PRICE RESOLVER (lib/admin/cost.ts
 * loadCurrentSkuPrices, catalog Phase 2a), never a second query of its own. Before 2a this was a
 * private copy ordered `recorded_at desc nulls last`; the one resolver orders `recorded_at desc`.
 * They differ ONLY on rows with a null recorded_at, of which the pre-flight requires zero (Task 1
 * Step 8). A SKU with no price is absent (→ advisory null; never fabricated).
 */
async function loadLatestPriceCentsBySku(locationId: string, skuIds: string[]): Promise<Map<string, number>> {
  const dollars = await loadCurrentSkuPrices(skuIds, locationId);
  return new Map([...dollars].map(([id, d]) => [id, priceCentsFromDollars(d)]));
}
```

and the call site `      loadLatestPriceCentsBySku(sb, skuIds),` → `      loadLatestPriceCentsBySku(po.location_id, skuIds),`. Remove whatever `npm run lint` then reports as unused, and nothing else.

- [ ] **Step 4: Receiving appends through the locked RPC**

In `lib/receiving.ts`, replace

```ts
    const { error: pErr } = await sb.from("vendor_price_history").insert(
      receivingPriceRows(priced, input.deliveryDate, actor.user.id, vend.source_kind),
    );
```

with

```ts
    // CATALOG PHASE 2a: lane-or-global is decided UNDER THE SKU LOCK in SQL (record_receiving_prices).
    const { error: pErr } = await sb.rpc("record_receiving_prices", { p_location: input.locationId, p_rows: receivingPriceRows(priced, input.deliveryDate, actor.user.id, vend.source_kind) });
```

and

```ts
    const { error: pErr } = await sb.from("vendor_price_history").insert(
      receivingPriceRows(priced, h.delivery_date, actor.user.id, source.source_kind),
    );
```

with

```ts
    const { error: pErr } = await sb.rpc("record_receiving_prices", { p_location: h.location_id, p_rows: receivingPriceRows(priced, h.delivery_date, actor.user.id, source.source_kind) });
```

`tests/receiving-store-prices.test.ts:41-42` still finds the `receivingPriceRows(priced, …)` call texts inside the new lines, so it stays unchanged and green.

- [ ] **Step 5: Every other price consumer passes its scope**

| File | Replace | With |
|---|---|---|
| `lib/admin/readiness-load.ts` | `    loadCurrentSkuPrices(ids), loadSkuDeliveryCounts(ids),` | `    loadCurrentSkuPrices(ids, null), loadSkuDeliveryCounts(ids),` |
| `lib/weights.ts` | `  const prices = await loadCurrentSkuPrices(skuIds);` | `  const prices = await loadCurrentSkuPrices(skuIds, null);` |
| `app/admin/skus/page.tsx` | `  const prices = await loadCurrentSkuPrices(skus.map((s) => s.id));` | `  const prices = await loadCurrentSkuPrices(skus.map((s) => s.id), null);` |
| `app/admin/vendors/[id]/page.tsx` | `  const prices = await loadCurrentSkuPrices(skus.map((s) => s.id));` | `  const prices = await loadCurrentSkuPrices(skus.map((s) => s.id), null);` |
| `lib/report-package.ts` (waste) | `          const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()]));` | `          const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], shopId));` |
| `lib/report-package.ts` (inventory) | `      const [skus, chainsByShop, measures, prices, who] = await Promise.all([` | `      const [skus, chainsByShop, measures, pricesByShop, who] = await Promise.all([` |
| `lib/report-package.ts` (inventory) | `        loadCurrentSkuPrices(skuIds),` | `        Promise.all(locationIds.map(async (shopId) => [shopId, await loadCurrentSkuPrices(skuIds, shopId)] as const)).then((p) => new Map(p)),` |
| `lib/report-package.ts` (inventory) | `        return skuCostPerOz(prices.get(skuId) ?? null, skuContentOz({` | `        return skuCostPerOz(pricesByShop.get(shopId)?.get(skuId) ?? null, skuContentOz({` |

- [ ] **Step 6: The vendor import's staging read is the GLOBAL lane, explicitly**

In `lib/vendor-import.ts`, make two replacements:
- `        .in("sku_id", ids).eq("active", true).order("id").range(from, to)),` → `        .in("sku_id", ids).eq("active", true).is("location_id", null).order("id").range(from, to)),`
- `        .in("vendor_item_id", ids).order("effective_date", { ascending: false })` → `        .in("vendor_item_id", ids).is("location_id", null).order("effective_date", { ascending: false })`

Above the `Promise.all`, add this comment:

```ts
    // GLOBAL LANE ONLY (catalog Phase 2a): the import supersedes the GLOBAL chain and appends a
    // GLOBAL price, and apply_vendor_import (re-emitted in 0259) re-checks exactly this before-state.
```

- [ ] **Step 7: The invoice-lane SQL check (run on the SIM after 0259, Task 14 Step 2)**

`tests/shop-versions-migration.test.ts` pins the text. This proves the behaviour against real Postgres, in a transaction that rolls back:

```sql
begin;
do $$
declare v_sku uuid; v_shop uuid; v_global_before uuid; v_r jsonb; v_lane1 uuid; v_lane2 uuid;
begin
  -- a SHARED SKU (no owning shop) with a global price, and an active shop with no lane for it
  select vi.id into v_sku from public.vendor_items vi
   where vi.location_id is null and exists (select 1 from public.vendor_price_history p where p.vendor_item_id = vi.id and p.location_id is null)
   limit 1;
  select l.id into v_shop from public.locations l
   where l.active and not exists (select 1 from public.sku_price_lanes x where x.sku_id = v_sku and x.location_id = l.id and x.active) limit 1;
  select id into v_global_before from public.vendor_price_history where vendor_item_id = v_sku and location_id is null
   order by effective_date desc, recorded_at desc, id desc limit 1;
  -- 1) the shop's FIRST invoice opens its lane; the global head does not move
  v_r := public.record_receiving_prices(v_shop, jsonb_build_array(jsonb_build_object('vendor_item_id', v_sku, 'unit_price', 99.99, 'effective_date', current_date, 'recorded_by', null)));
  assert (v_r ->> 'lanes_opened')::int = 1 and (v_r ->> 'shop_rows')::int = 1 and (v_r ->> 'global_rows')::int = 0, 'first invoice must open the shop lane';
  select id into v_lane1 from public.sku_price_lanes where sku_id = v_sku and location_id = v_shop and active;
  assert v_lane1 is not null, 'lane must be live';
  assert (select id from public.vendor_price_history where vendor_item_id = v_sku and location_id is null
           order by effective_date desc, recorded_at desc, id desc limit 1) = v_global_before, 'global head must not move';
  -- 2) back to default, then the next invoice opens a NEW lane
  perform public.retire_sku_price_lane(v_sku, v_shop, null);
  v_r := public.record_receiving_prices(v_shop, jsonb_build_array(jsonb_build_object('vendor_item_id', v_sku, 'unit_price', 88.88, 'effective_date', current_date, 'recorded_by', null)));
  select id into v_lane2 from public.sku_price_lanes where sku_id = v_sku and location_id = v_shop and active;
  assert (v_r ->> 'lanes_opened')::int = 1 and v_lane2 is not null and v_lane2 <> v_lane1, 'an invoice after back-to-default opens a new lane';
  assert exists (select 1 from public.vendor_price_history where price_lane_id = v_lane2 and unit_price = 88.88), 'the invoice lands in the new lane';
  raise notice 'invoice lane check: OK';
end $$;
rollback;
```

Expected: `NOTICE: invoice lane check: OK`.

- [ ] **Step 8: Run, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.
Run: `npx vitest run tests/shop-versions-equivalence.test.ts tests/receiving-price-lanes.test.ts tests/receiving-store-prices.test.ts tests/store-run-prices.test.ts tests/menu-prices-data.test.ts tests/receiving-shared.test.ts`
Expected: PASS, and the golden is untouched.

```bash
git add -A lib app tests
git commit -F - <<'EOF'
feat(catalog): every price consumer resolves through the one scoped resolver; deliveries append under the SKU lock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6b: The costing board follows the shop (lead decision)

With decision (e), a delivery's price lands in **that shop's** lane, so a board priced from the global row alone would never show what a shop actually pays (Astra 2a r3#2). The lead's ruling:
- `/admin/menu-costing` gets a **shop switcher**. It defaults through the one shop resolver (`resolveShopId`, `lib/shop-context.ts`) to the viewer's shop: explicit `?location=`, then the remembered shop, then the first allowed.
- The selected shop drives **both** the graph/pack loaders (that shop's pack versions and product resolution) **and** the price resolver (that shop's lane, else global).
- "**All shops**" (`?location=global`) is the global default, and it is **labelled as using global prices**.

Reads follow the house read rule (`canReadReportLocation`: the actor's shops; level 8+ every shop). The CSV/PDF export follows the SAME scope (Step 3b): the export link carries the page's `?location=`, `lib/report-export.ts` binds it as the page does and loads that shop's board, and the file's first line names its pricing scope.

**Files:**
- Modify: `lib/admin/menu-costing.ts`, `app/admin/menu-costing/page.tsx`, `lib/shop-context-shared.ts`, `lib/report-export.ts`, `lib/report-export-shared.ts`, `app/api/reports/export/route.ts`, `components/reports-export/ExportLinks.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/menu-costing-shop-scope.test.ts`, `tests/costing-export-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Catalog Phase 2a (lead decision) — the costing board follows the selected shop: its packs AND its
 * prices; "All shops" is the global view, labelled as global prices.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";

const seen = vi.hoisted(() => ({ graph: [] as unknown[], prices: [] as unknown[] }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, eq: () => q, not: () => q, is: () => q, in: () => q, order: () => q,
    returns: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  });
  return { from: () => q };
} }));
vi.mock("@/lib/prep-consumption", () => ({
  loadRecipeGraph: async (opts?: unknown) => { seen.graph.push(opts ?? null); return buildRecipeGraph([], new Map(), new Map()); },
}));
vi.mock("@/lib/admin/cost", () => ({
  COST_READ_MIN: 6,
  loadCurrentSkuPrices: async (_ids: string[], scope: unknown) => { seen.prices.push(scope); return new Map(); },
}));
import { loadMenuCostingBoard, MenuCostingError } from "@/lib/admin/menu-costing";

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: string, locations: string[]) => ({ user: { id: "u", role }, role, locations }) as unknown as AuthContext;

beforeEach(() => { seen.graph = []; seen.prices = []; });

describe("loadMenuCostingBoard — the selected shop's packs AND prices", () => {
  it("All shops (the default, and the CSV export): the global graph and global prices, labelled", async () => {
    const board = await loadMenuCostingBoard(actor("owner", []));
    expect(seen.graph).toEqual([null]);
    expect(seen.prices).toEqual([null]);
    expect(board.scope).toBeNull();
  });
  it("a shop: that shop's graph (packs + product resolution) and that shop's prices", async () => {
    const board = await loadMenuCostingBoard(actor("gm", [A]), { scope: A });
    expect(seen.graph).toEqual([{ locationId: A }]);
    expect(seen.prices).toEqual([A]);
    expect(board.scope).toBe(A);
  });
  it("a GM cannot read another shop's board", async () => {
    await expect(loadMenuCostingBoard(actor("gm", [A]), { scope: B })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(loadMenuCostingBoard(actor("gm", [A]), { scope: B })).rejects.toBeInstanceOf(MenuCostingError);
  });
});

describe("the page: switcher through the one shop resolver, labelled global view", () => {
  const src = readFileSync("app/admin/menu-costing/page.tsx", "utf8");
  it("resolves the shop through resolveShopId over the shops the viewer may read, and passes it on", () => {
    expect(src).toContain('shopParamFor("/admin/menu-costing", searchParamValues(sp))');
    expect(src).toContain("await resolveShopId(shops.map((s) => s.id), explicit ?? null)");
    expect(src).toContain("loadMenuCostingBoard(auth, { scope })");
    expect(src).toContain('"admin.menu_costing.scope_all"');
  });
});
```

Run: `npx vitest run tests/menu-costing-shop-scope.test.ts` → FAIL (`board.scope` is undefined; the page pins fail).

- [ ] **Step 2: `lib/admin/menu-costing.ts`**

1. Add `import { canReadReportLocation } from "@/lib/locations";` and `import type { VersionScope } from "@/lib/sku-versions-shared";`.
2. In `export interface MenuCostingBoard {`, add as its first member:

```ts
  /** The shop this board was costed for (its packs AND prices); null = All shops, on GLOBAL prices. */
  scope: string | null;
```

3. Replace

```ts
export async function loadMenuCostingBoard(actor: AuthContext): Promise<MenuCostingBoard> {
  requireLevel(actor, MENU_COSTING_READ_MIN);
  const sb = getServiceRoleClient();

  const [graph, menuRes, toast] = await Promise.all([
    loadRecipeGraph(),
```

with

```ts
export async function loadMenuCostingBoard(actor: AuthContext, opts: { scope?: VersionScope } = {}): Promise<MenuCostingBoard> {
  requireLevel(actor, MENU_COSTING_READ_MIN);
  // CATALOG PHASE 2a (lead decision): the board is costed FOR A SHOP — its pack versions and product
  // resolution (the graph) AND its prices (its lane, else global). null = All shops = global prices.
  const scope = opts.scope ?? null;
  if (scope !== null && !canReadReportLocation({ role: actor.user.role, locations: actor.locations }, scope)) {
    throw new MenuCostingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();

  const [graph, menuRes, toast] = await Promise.all([
    loadRecipeGraph(scope === null ? undefined : { locationId: scope }),
```

4. Replace `  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()]);` with `  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()], scope);`.
5. In the function's final `return { … }` object, add `scope,` as its first property.

`scripts/sim/product-identity/day1-vendor-down.ts` keeps `loadMenuCostingBoard(auth)`, the all-shops view; `lib/report-export.ts` passes the export's scope (Step 3b). `tests/menu-prices-data.test.ts` mocks `loadCurrentSkuPrices` and `loadRecipeGraph` with argument-free stubs, which still type-check and pass.

- [ ] **Step 3: The page — switcher, default shop, labelled global view**

In `lib/shop-context-shared.ts` `SHOP_PARAMS_BY_PATH`, add `  "/admin/menu-costing": ["location"], // catalog Phase 2a — the costing board's shop switcher`.

In `app/admin/menu-costing/page.tsx`:
- Add the imports `import Link from "next/link";`, `import { getServiceRoleClient } from "@/lib/supabase-server";`, `import { canReadReportLocation } from "@/lib/locations";`, `import { resolveShopId } from "@/lib/shop-context";` and `import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";`.
- Replace `export default async function AdminMenuCostingPage() {` with

```tsx
export default async function AdminMenuCostingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
```

- Replace `  const { rows, totals, skuNames, itemNames, productNames, toastFetchedAt, toastUnavailable, toastNotices } = await loadMenuCostingBoard(auth);` with:

```tsx
  // THE ONE SHOP RESOLVER over the shops this viewer may read (level 8+: every shop):
  // ?location=<shop> | global → the remembered shop → the first allowed.
  const { data: locs, error: locErr } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string }>>();
  if (locErr) throw new Error(`menu costing page locations: ${locErr.message}`);
  const shops = (locs ?? []).filter((l) => canReadReportLocation({ role: auth.user.role, locations: auth.locations }, l.id));
  const explicit = shopParamFor("/admin/menu-costing", searchParamValues(sp));
  const scope = explicit === "global" ? null : await resolveShopId(shops.map((s) => s.id), explicit ?? null);
  const scopeLabel = scope === null
    ? serverT(lang, "admin.menu_costing.scope_all")
    : serverT(lang, "admin.menu_costing.scope_shop", { shop: shops.find((s) => s.id === scope)?.name ?? "" });

  const { rows, totals, skuNames, itemNames, productNames, toastFetchedAt, toastUnavailable, toastNotices } = await loadMenuCostingBoard(auth, { scope });
  const pill = (on: boolean) =>
    `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;
```

- Directly after the `<PageHeader … />` element, insert:

```tsx
      <nav aria-label={serverT(lang, "admin.menu_costing.shop_switcher")} className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {shops.map((s) => (
          <Link key={s.id} href={`/admin/menu-costing?location=${s.id}`} aria-current={scope === s.id ? "page" : undefined} className={pill(scope === s.id)}>
            {s.name}
          </Link>
        ))}
        <Link href="/admin/menu-costing?location=global" aria-current={scope === null ? "page" : undefined} className={pill(scope === null)}>
          {serverT(lang, "admin.menu_costing.scope_all_short")}
        </Link>
      </nav>
      <p className="mb-4 text-sm text-co-text-muted">{scopeLabel}</p>
```

`"admin.menu_costing.scope_all"` appears as a literal in `scopeLabel`, which is the page pin. The switcher is its own horizontal scroller, so the page never scrolls sideways, and every pill is 44px with `items-center`.

- [ ] **Step 3b: The export carries the SAME scope (lead decision, Astra round 4)**

The CSV/PDF download is the board the viewer is looking at. It takes the page's `?location=`, binds it exactly as the page does, and names its pricing scope on its first line.

`tests/costing-export-scope.test.ts`:

```ts
/** Catalog Phase 2a (lead decision) — the costing export is the board on screen: same shop, same bind, scope named. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const seen = vi.hoisted(() => ({ scopes: [] as unknown[] }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: A, code: "EM", name: "P Street" }, error: null }) });
  return { from: () => q };
} }));
vi.mock("@/lib/admin/menu-costing", () => ({
  MENU_COSTING_READ_MIN: 6,
  loadMenuCostingBoard: async (_auth: unknown, opts?: { scope?: string | null }) => {
    seen.scopes.push(opts?.scope ?? null);
    const cost = opts?.scope === A ? 4.25 : 3.1; // the shop's own price makes its cost differ
    return { scope: opts?.scope ?? null, rows: [{ id: "m1", name: "Crunchy", nameEs: null, section: "subs", menuPrice: 13.5,
      rollup: { status: "ok", cost } as never, foodCostPct: null, marginDollars: null, overThreshold: false }] };
  },
}));
import { ExportError, loadExportTable } from "@/lib/report-export";
import { EXPORT_COLUMNS, toCsv } from "@/lib/report-export-shared";

const gm = { user: { id: "u", role: "gm", language: "en" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;

describe("the costing export follows the board's shop", () => {
  it("a shop-scoped export: that shop's board, its costs, and its pricing scope", async () => {
    const t = await loadExportTable(gm, "costing", { location: A });
    expect(seen.scopes.at(-1)).toBe(A);
    expect(t.pricingScope).toEqual({ kind: "shop", name: "P Street" });
    expect(toCsv(t.columns, t.rows)).toContain("4.25");
  });
  it("no location, or ?location=global: the labelled all-shops view on global prices", async () => {
    for (const location of [undefined, "global"]) {
      const t = await loadExportTable(gm, "costing", { location });
      expect(seen.scopes.at(-1)).toBeNull();
      expect(t.pricingScope).toEqual({ kind: "global" });
      expect(toCsv(t.columns, t.rows)).toContain("3.10");
    }
  });
  it("a GM cannot export another shop's board", async () => {
    await expect(loadExportTable(gm, "costing", { location: B })).rejects.toMatchObject({ status: 403, code: "location_forbidden" });
    await expect(loadExportTable(gm, "costing", { location: B })).rejects.toBeInstanceOf(ExportError);
  });
  it("the CSV's FIRST line names the pricing scope; the header row follows", () => {
    const csv = toCsv(EXPORT_COLUMNS.costing, [], ["Prices: P Street"]);
    expect(csv.replace(/^﻿/, "").split("\r\n").slice(0, 2)).toEqual(["Prices: P Street", EXPORT_COLUMNS.costing.map((c) => c.key).join(",")]);
  });
  it("the route writes that line (CSV) and that header line (PDF); the page links the export with its own scope", () => {
    const route = readFileSync("app/api/reports/export/route.ts", "utf8");
    expect(route).toContain('"reports.export.pricing_scope_shop"');
    expect(route).toContain('"reports.export.pricing_scope_global"');
    expect(route).toContain("toCsv(table.columns, table.rows, pricingLine ? [pricingLine] : [])");
    const page = readFileSync("app/admin/menu-costing/page.tsx", "utf8");
    expect(page).toContain('query={{ location: scope ?? "global" }}');
    expect(page).toContain('"admin.menu_costing.export_scope"');
  });
});
```

Run → FAIL (`pricingScope` undefined; `toCsv` takes no preamble).

**`lib/report-export-shared.ts`**: replace

```ts
export function toCsv(columns: readonly ExportColumn[], rows: readonly ExportRow[]): string {
  const lines = [columns.map((c) => csvField(c.key)).join(",")];
```

with

```ts
export function toCsv(columns: readonly ExportColumn[], rows: readonly ExportRow[], preamble: readonly string[] = []): string {
  // Optional context lines BEFORE the header row (the costing export's pricing scope). Every other
  // family passes none, so their files are byte-identical.
  const lines = [...preamble.map((p) => csvField(p)), columns.map((c) => csvField(c.key)).join(",")];
```

Update the doc comment above it to `/** The whole file: BOM + optional preamble lines + one header row + one line per row, CRLF, trailing CRLF. */`.

**`lib/report-export.ts`**:
- In `export interface ExportTable {`, after `  to: string;`, add:

```ts
  /** costing only (catalog Phase 2a): whose prices the costs use — named on the file's first line. */
  pricingScope?: { kind: "global" } | { kind: "shop"; name: string };
```

- Replace

```ts
      case "costing": {
        const board = await loadMenuCostingBoard(auth);
        return { ...base, from: today, to: today, rows: costingRows(board.rows) };
      }
```

with

```ts
      case "costing": {
        // CATALOG PHASE 2a (lead decision): the export IS the board on screen — the page's ?location=
        // (a shop, or "global" / absent = All shops on global prices), bound exactly as the page binds.
        const loc = params.location;
        let scope: string | null = null;
        if (loc !== undefined && loc !== "" && loc !== "global") {
          if (!/^[0-9a-f-]{36}$/i.test(loc)) throw new ExportError(400, "invalid_location");
          if (!canReadReportLocation(actorOf(auth), loc)) throw new ExportError(403, "location_forbidden");
          scope = loc;
        }
        const board = await loadMenuCostingBoard(auth, { scope });
        const pricingShop = scope ? await loadShop(scope) : null;
        return {
          ...base, shop: pricingShop, from: today, to: today, rows: costingRows(board.rows),
          pricingScope: pricingShop ? { kind: "shop", name: pricingShop.name } : { kind: "global" },
        };
      }
```

  (`canReadReportLocation`, `actorOf` and `loadShop` are already in this module. `loadMenuCostingBoard` re-binds the shop in the lib, as a second layer. The file name now carries the shop's code for a shop-scoped board.)

**`app/api/reports/export/route.ts`**: directly after `  const shopLabel = …;`, add:

```ts
  // Catalog Phase 2a: the costing export names WHOSE prices it used, on its first line (CSV) / header (PDF).
  const pricingLine = table.pricingScope
    ? table.pricingScope.kind === "shop"
      ? serverT(language, "reports.export.pricing_scope_shop", { shop: table.pricingScope.name })
      : serverT(language, "reports.export.pricing_scope_global")
    : null;
```

Then:
- Replace `      ? toCsv(table.columns, table.rows)` with `      ? toCsv(table.columns, table.rows, pricingLine ? [pricingLine] : [])`.
- Replace `lines: pdfHeaderLines(language, { shop: shopLabel, from: table.from, to: table.to, at: new Date(), by: ctx.user.name }) },` with `lines: [...pdfHeaderLines(language, { shop: shopLabel, from: table.from, to: table.to, at: new Date(), by: ctx.user.name }), ...(pricingLine ? [pricingLine] : [])] },`.

**`components/reports-export/ExportLinks.tsx`**: add an optional `caption?: string` prop. When it is set, render it before the two links as `<span className="text-xs font-bold text-co-text-muted">{caption}</span>`, inside the same flex row. Every existing caller passes none and is unchanged.

**`app/admin/menu-costing/page.tsx`**: replace `      <ExportLinks className="mb-4" family="costing" language={lang} query={{}} />` with:

```tsx
      <ExportLinks className="mb-4" family="costing" language={lang} query={{ location: scope ?? "global" }}
        caption={serverT(lang, "admin.menu_costing.export_scope", { scope: scope === null ? serverT(lang, "admin.menu_costing.scope_all_short") : shops.find((s) => s.id === scope)?.name ?? "" })} />
```

- [ ] **Step 4: Strings (en + es, tú)**

In `lib/i18n/en.json`, put a comma after the current last entry and add:

```json
  "admin.menu_costing.shop_switcher": "Show costs for",
  "admin.menu_costing.scope_all_short": "All shops",
  "admin.menu_costing.scope_all": "All shops — costed with GLOBAL prices. A shop's own prices show on that shop's view.",
  "admin.menu_costing.scope_shop": "{shop} — costed with this shop's packs and prices.",
  "admin.menu_costing.export_scope": "Download — {scope}",
  "reports.export.pricing_scope_shop": "Prices: {shop}",
  "reports.export.pricing_scope_global": "Prices: global (all shops)"
```

In `lib/i18n/es.json`, the same:

```json
  "admin.menu_costing.shop_switcher": "Ver costos de",
  "admin.menu_costing.scope_all_short": "Todas las tiendas",
  "admin.menu_costing.scope_all": "Todas las tiendas: costeado con precios GLOBALES. Los precios propios de una tienda se ven en la vista de esa tienda.",
  "admin.menu_costing.scope_shop": "{shop}: costeado con los empaques y precios de esta tienda.",
  "admin.menu_costing.export_scope": "Descargar: {scope}",
  "reports.export.pricing_scope_shop": "Precios: {shop}",
  "reports.export.pricing_scope_global": "Precios: globales (todas las tiendas)"
```

- [ ] **Step 5: Run, then commit**

Run: `npx vitest run tests/menu-costing-shop-scope.test.ts tests/costing-export-scope.test.ts tests/report-export-shared.test.ts tests/menu-prices-data.test.ts tests/shop-context.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS, no tsc output.

```bash
git add lib/admin/menu-costing.ts app/admin/menu-costing/page.tsx lib/shop-context-shared.ts lib/report-export.ts lib/report-export-shared.ts app/api/reports/export/route.ts components/reports-export/ExportLinks.tsx lib/i18n/en.json lib/i18n/es.json tests/menu-costing-shop-scope.test.ts tests/costing-export-scope.test.ts
git commit -F - <<'EOF'
feat(costing): the menu-costing board follows the selected shop — its packs and prices; All shops labelled global

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 7: SKU data readiness resolves chain and price per shop, through the pure resolver

**Files:**
- Modify: `lib/sku-data-readiness.ts`, `lib/sku-data-readiness-load.ts`
- Test: `tests/sku-data-readiness-shop-versions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2a — readiness is per shop: a shop's own pack/price answers for that shop only. */
import { describe, expect, it } from "vitest";
import { evaluateWave7Tables, type LiveTables } from "@/lib/sku-data-readiness";

function tables(): LiveTables {
  const data: LiveTables = Object.fromEntries(["items", "menu_items", "products", "recipes", "recipe_inputs", "recipe_outputs", "vendor_deliveries", "vendor_delivery_items", "product_primaries", "location_sku_settings", "sku_pack_levels", "vendor_price_history", "vendor_cutoffs", "vendor_delivery_rhythm", "sku_price_lanes"].map((n) => [n, []]));
  data.locations = [{ id: "north", name: "North", active: true }, { id: "south", name: "South", active: true }];
  data.vendors = [{ id: "vendor", active: true }];
  data.vendor_items = [{ id: "sku", name: "Turkey", vendor_id: "vendor", active: true, sku_class: "raw", pack_format: null, units_per_pack: null, each_size: null, each_measure: null, weight_class: "OPERATIONAL", weekday_par: 1, weekend_par: 1 }];
  data.measure_units = [{ id: "oz", label: "oz", dimension: "weight", to_base_factor: 1, active: true }];
  data.vendor_cutoffs = [{ id: "c", vendor_id: "vendor", active: true }];
  data.vendor_delivery_rhythm = [{ id: "r", vendor_id: "vendor", active: true }];
  return data;
}

describe("evaluateWave7Tables — per-shop chain and price", () => {
  it("a shop-only chain and a shop-only price clear that shop's errands and nobody else's", () => {
    const data = tables();
    data.sku_pack_levels = [{ id: "l1", sku_id: "sku", version_id: "v-n", location_id: "north", label: "case", contains_qty: 160, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: true }];
    data.sku_price_lanes = [{ id: "lane-n", sku_id: "sku", location_id: "north", active: true }];
    data.vendor_price_history = [{ id: "p-n", vendor_item_id: "sku", unit_price: 40, effective_date: "2026-09-05", recorded_at: "2026-09-05T12:00:00Z", location_id: "north", price_lane_id: "lane-n" }];
    const shops = evaluateWave7Tables(data).shops;
    const north = shops.find((s) => s.id === "north")!.rows[0]!;
    const south = shops.find((s) => s.id === "south")!.rows[0]!;
    expect(north.errands.map((e) => e.code)).not.toContain("no_price");
    expect(north.errands.map((e) => e.code)).not.toContain("raw_pack_contents_missing");
    expect(south.errands.map((e) => e.code)).toEqual(expect.arrayContaining(["no_price", "raw_pack_contents_missing"]));
  });

  it("a retired lane answers nobody: the shop falls back to the global price", () => {
    const data = tables();
    data.sku_price_lanes = [{ id: "lane-n", sku_id: "sku", location_id: "north", active: false }];
    data.vendor_price_history = [
      { id: "p-g", vendor_item_id: "sku", unit_price: 30, effective_date: "2026-09-01", recorded_at: "2026-09-01T12:00:00Z", location_id: null, price_lane_id: null },
      { id: "p-n", vendor_item_id: "sku", unit_price: 40, effective_date: "2026-09-05", recorded_at: "2026-09-05T12:00:00Z", location_id: "north", price_lane_id: "lane-n" },
    ];
    const north = evaluateWave7Tables(data).shops.find((s) => s.id === "north")!.rows[0]!;
    expect(JSON.parse(north.consumerBasis).price).toBe(30);
  });

  it("with no versions at all, every shop reads exactly what it read before 0259", () => {
    const data = tables();
    Object.assign(data.vendor_items![0]!, { pack_format: "Case", units_per_pack: 1, each_size: 16, each_measure: "oz" });
    data.vendor_price_history = [{ id: "p", vendor_item_id: "sku", unit_price: 10, effective_date: "2026-09-01" }];
    for (const shop of evaluateWave7Tables(data).shops) expect(shop.rows[0]).toMatchObject({ order: "usable", count: "usable", cost: "usable" });
  });
});
```

Run: `npx vitest run tests/sku-data-readiness-shop-versions.test.ts` → FAIL. The north row still lists `no_price`.

- [ ] **Step 2: Route `evaluateWave7Tables` through the pure resolver**

In `lib/sku-data-readiness.ts`, add `import { resolveCurrentPrices, resolvePackLevels, type ResolvedPack, type ScopedLevelRow, type ScopedPriceRow } from "@/lib/sku-versions-shared";`. Replace `liveBasis` and `liveHead`:

```ts
function liveBasis(row: LiveRow, chain: LiveRow[]): RecipeInputSku {
  return liveBasisFromLevels(row, liveChain(chain));
}
function liveBasisFromLevels(row: LiveRow, levels: PackChainLevel[]): RecipeInputSku {
  return { packFormat: liveText(row.pack_format), eachContainerLabel: liveText(row.each_container_label),
    unitsPerPack: liveNum(row.units_per_pack), eachSize: liveNum(row.each_size), eachMeasure: liveText(row.each_measure),
    avgOzPerEach: liveNum(row.avg_oz_per_each), packChain: levels };
}
/** Newest first by (effective_date, recorded_at, id), all desc — this module's own order since r3. */
function newestFirst(a: LiveRow, b: LiveRow): number {
  for (const key of ["effective_date", "recorded_at", "id"]) {
    const d = String(b[key] ?? "").localeCompare(String(a[key] ?? "")); if (d) return d;
  }
  return 0;
}
```

Replace the block

```ts
  const prices = new Map<string, LiveRow | null>(), bases = new Map<string, RecipeInputSku>();
  for (const sku of skus) {
    const id = liveId(sku), override = overrides.get(id);
    const chain = override?.chain ?? liveRows(tables, "sku_pack_levels").filter(r => r.sku_id === id && r.active === true);
    bases.set(id, liveBasis(sku, chain));
    prices.set(id, override ? override.price : liveHead(liveRows(tables, "vendor_price_history").filter(r => r.vendor_item_id === id)));
  }
```

with

```ts
  // CATALOG PHASE 2a: chain and price resolve PER SHOP through the one pure resolver
  // (lib/sku-versions-shared.ts) — this module never picks a version itself. A pre-0259 table (no
  // location/version columns, no lanes) resolves to exactly what it resolved to before.
  const liveLevels = liveRows(tables, "sku_pack_levels").filter(r => r.active === true) as unknown as ScopedLevelRow[];
  const priceRowsNewestFirst = [...liveRows(tables, "vendor_price_history")].sort(newestFirst);
  const priceById = new Map(priceRowsNewestFirst.map(r => [liveId(r), r]));
  const laneRows = tables.sku_price_lanes ?? [];
  const basesFor = (shopId: string | null): { bases: Map<string, RecipeInputSku>; prices: Map<string, LiveRow | null>; packs: Map<string, ResolvedPack> } => {
    const packs = resolvePackLevels(liveLevels, shopId);
    const lanes = new Map<string, string>();
    if (shopId) for (const l of laneRows) if (l.location_id === shopId && l.active === true) lanes.set(String(l.sku_id), liveId(l));
    const heads = resolveCurrentPrices(priceRowsNewestFirst as unknown as ScopedPriceRow[], lanes);
    const bases = new Map<string, RecipeInputSku>(), prices = new Map<string, LiveRow | null>();
    for (const sku of skus) {
      const id = liveId(sku), override = overrides.get(id);
      bases.set(id, override ? liveBasis(sku, override.chain) : liveBasisFromLevels(sku, packs.get(id)?.levels ?? []));
      const head = heads.get(id);
      prices.set(id, override ? override.price : head?.priceId ? (priceById.get(head.priceId) ?? null) : null);
    }
    return { bases, prices, packs };
  };
```

Directly after `    const shopId = liveId(shop), overlays = liveRows(tables, "location_sku_settings").filter(r => r.location_id === shopId);`, insert `    const { bases, prices, packs } = basesFor(shopId);`. Run `grep -n "bases\.\|prices\." lib/sku-data-readiness.ts` and check that every hit sits inside the shop loop. (`packs` is read by Task 12's par stamp. Until then lint may report it unused; prefix it as `_packs` only if lint fails the build, and rename it back in Task 12.)

- [ ] **Step 3: The loader selects the 0259 columns and the lanes**

In `lib/sku-data-readiness-load.ts` `COLUMNS`:
- `sku_pack_levels: "id,sku_id,version_id,location_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,active",`
- `vendor_price_history: "id,vendor_item_id,unit_price,effective_date,recorded_at,location_id,price_lane_id",`
- add `sku_price_lanes: "id,sku_id,location_id,active",`

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/sku-data-readiness-shop-versions.test.ts tests/sku-data-readiness.test.ts tests/angel-wave7.test.ts` → PASS.

```bash
git add lib/sku-data-readiness.ts lib/sku-data-readiness-load.ts tests/sku-data-readiness-shop-versions.test.ts
git commit -F - <<'EOF'
feat(catalog): SKU data readiness resolves pack and price per shop through the one resolver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 8: Shop versions PRESENT — the resolver tests over the fake DB

**Files:**
- Test: `tests/sku-versions-resolution.test.ts`

- [ ] **Step 1: Write the test**

```ts
/**
 * Catalog Phase 2a — shop versions PRESENT (spec §8 "Resolver tests"): shop version beats global;
 * a retired shop version falls back to global; another shop's version is invisible; and every number
 * downstream (order-unit oz, cost per oz, depletion oz, flat content) follows the shop's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER, QUIET_DAY } from "./fixtures/shop-versions-fixture";
import { computeOutputs, liveApi } from "./fixtures/shop-versions-harness";
import { loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadCurrentSkuPriceHeads } from "@/lib/admin/cost";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const FROM = "2026-10-10T00:00:00.000Z";
/** LOC: turkey 4 × 10 lb (640 oz/case) at $150; OTHER: its own tomato case; LOC's lettuce version is RETIRED. */
function withShopVersions() {
  const t = buildShopVersionsFixture();
  const lv = (id: string, sku: string, loc: string, ver: string, label: string, qty: number, next: string | null, unit: string | null, ord: number, active = true) =>
    ({ id, sku_id: sku, version_id: ver, location_id: loc, effective_from: FROM, label, contains_qty: qty, contains_level_id: next, contains_measure_unit: unit, display_ordinal: ord, active });
  t.sku_pack_versions!.push(
    { id: "sv-turkey-loc", sku_id: "s-turkey", location_id: LOC, based_on_version_id: "pv-s-turkey-live", active: true, valid_from: FROM, valid_to: null },
    { id: "sv-tomato-other", sku_id: "s-tomato", location_id: OTHER, based_on_version_id: "pv-s-tomato-live", active: true, valid_from: FROM, valid_to: null },
    { id: "sv-lettuce-loc-old", sku_id: "s-lettuce", location_id: LOC, based_on_version_id: null, active: false, valid_from: "2026-09-10T00:00:00.000Z", valid_to: "2026-09-20T00:00:00.000Z" },
  );
  t.sku_pack_levels!.push(
    lv("sl-t-case", "s-turkey", LOC, "sv-turkey-loc", "case", 4, "sl-t-bag", null, 0),
    lv("sl-t-bag", "s-turkey", LOC, "sv-turkey-loc", "bag", 10, null, "lb", 1),
    lv("sl-tom-case", "s-tomato", OTHER, "sv-tomato-other", "case", 30, null, "each", 0),
    lv("sl-let-case", "s-lettuce", LOC, "sv-lettuce-loc-old", "case", 12, null, "lb", 0, false),
  );
  t.sku_price_lanes!.push(
    { id: "lane-turkey-loc", sku_id: "s-turkey", location_id: LOC, based_on_price_id: "ph-02", active: true },
    { id: "lane-cheese-loc", sku_id: "s-cheese", location_id: LOC, based_on_price_id: "ph-04", active: false },
  );
  t.vendor_price_history!.push(
    { id: "ph-s1", vendor_item_id: "s-turkey", unit_price: 150, effective_date: "2026-10-10", recorded_at: "2026-10-10T12:00:00.000Z", location_id: LOC, price_lane_id: "lane-turkey-loc" },
    { id: "ph-s2", vendor_item_id: "s-cheese", unit_price: 99, effective_date: "2026-10-10", recorded_at: "2026-10-10T12:00:00.000Z", location_id: LOC, price_lane_id: "lane-cheese-loc" },
  );
  return t;
}

beforeEach(() => { current = createFakeDb(withShopVersions()); });
afterEach(() => { current = null; });

describe("shop version beats global — for that shop only", () => {
  it("LOC reads its turkey version; OTHER and global read the default", async () => {
    expect((await loadSkuPackResolution(["s-turkey"], LOC)).get("s-turkey")).toMatchObject({ versionId: "sv-turkey-loc", locationId: LOC });
    expect((await loadSkuPackResolution(["s-turkey"], OTHER)).get("s-turkey")).toMatchObject({ versionId: "pv-s-turkey-live", locationId: null });
    expect((await loadSkuPackResolution(["s-turkey"], null)).get("s-turkey")!.locationId).toBeNull();
  });
  it("a RETIRED shop version falls back to global live, but still answers for a date inside its own window", async () => {
    expect((await loadSkuPackResolution(["s-lettuce"], LOC)).has("s-lettuce")).toBe(false); // global lettuce is unchained
    expect((await loadSkuPackResolution(["s-lettuce"], LOC, "2026-09-15T12:00:00.000Z")).get("s-lettuce")!.versionId).toBe("sv-lettuce-loc-old");
    expect((await loadSkuPackResolution(["s-tomato"], LOC)).get("s-tomato")!.locationId).toBeNull();
    expect((await loadSkuPackResolution(["s-tomato"], OTHER)).get("s-tomato")!.versionId).toBe("sv-tomato-other");
  });
  it("prices: LOC's live lane answers; a retired lane does not; OTHER reads global", async () => {
    const loc = await loadCurrentSkuPriceHeads(["s-turkey", "s-cheese"], LOC);
    expect(loc.get("s-turkey")).toMatchObject({ value: 150, laneId: "lane-turkey-loc" });
    expect(loc.get("s-cheese")).toMatchObject({ value: 46.2, laneId: null });
    expect((await loadCurrentSkuPriceHeads(["s-turkey"], OTHER)).get("s-turkey")!.value).toBe(128);
  });
});

describe("every number downstream follows the shop's answer", () => {
  it("order unit, cost per oz, depletion oz at LOC; untouched at OTHER and global", async () => {
    const out = await computeOutputs(liveApi, withShopVersions(), [LOC, OTHER], QUIET_DAY);
    expect(out[LOC]!.orderUnitOz["s-turkey"]).toBe(640);
    expect(out[LOC]!.graph.costPerOz["s-turkey"]).toBeCloseTo(150 / 640, 12);
    expect(out[LOC]!.graph.menuOz["m-italian"]!["s-turkey"]).toBeCloseTo(8, 10); // 0.0125 case × 640
    expect(out[LOC]!.datedMenuOz["m-italian"]!["s-turkey"]).toBeCloseTo(8, 10); // the quiet day is after LOC's version
    expect(out[LOC]!.flatContentOz["s-turkey"]).toBe(640); // the shop version answers the flat consumers
    expect(out[OTHER]!.orderUnitOz["s-turkey"]).toBe(320);
    expect(out[OTHER]!.orderUnitOz["s-tomato"]).toBe(135); // 30 each × 4.5
    expect(out.global!.orderUnitOz["s-turkey"]).toBe(320);
    expect(out.global!.prices["s-turkey"]).toBe(128);
  });
});
```

- [ ] **Step 2: Run, then commit**

Run: `npx vitest run tests/sku-versions-resolution.test.ts`
Expected: PASS. Tasks 2, 5 and 6 already built the behaviour. If it fails, fix the resolver or the loader, never the expectation.

```bash
git add tests/sku-versions-resolution.test.ts
git commit -F - <<'EOF'
test(catalog): shop versions present — shop beats global, retired falls back (and answers inside its window), other shops invisible

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 9: The gated writers (`lib/admin/sku-versions.ts`) + the audit vocabulary

**Files:**
- Create: `lib/admin/sku-versions.ts`
- Modify: `lib/admin/pack-chain.ts` (exports only), `lib/destructive-actions.ts`, `tests/location-bind-differential.test.ts`
- Test: `tests/sku-versions-permissions.test.ts`

- [ ] **Step 1: Write the failing permission test**

```ts
/**
 * Catalog Phase 2a — the write gates hold INSIDE the lib, before any I/O (spec §2, §8: the lib bind
 * holds even when the route is bypassed). vitest has no Supabase env, so a call that got PAST the
 * gates fails on the service client with a plain Error — which is how the MoO case proves it passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { retireShopPackVersion, retireShopPriceLane, saveSkuPackVersion, saveSkuPrice, SkuVersionError } from "@/lib/admin/sku-versions";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed"); // "fails for want of a database"
  return current.client;
} }));
afterEach(() => { current = null; });
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

const SHOP_A = "6f1d2c3e-0000-4000-8000-00000000000a";
const SHOP_B = "6f1d2c3e-0000-4000-8000-00000000000b";
const LEVELS = [{ label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null }, { label: "bag", containsQty: 10, containsIndex: null, containsMeasureUnit: "lb" }];
const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof SkuVersionError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("AGM/GM write only their own shop's version; MoO+ any shop (D2)", () => {
  it("a GM at shop A cannot write shop B's pack version (404, before I/O)", async () => {
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_B, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("an UNASSIGNED MoO passes the gate for shop B (fails later only for want of a database)", async () => {
    const p = saveSkuPackVersion(actor("moo", 8, []), { skuId: "s", scope: SHOP_B, levels: LEVELS, expectedLiveVersionId: null });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(SkuVersionError);
  });
  it("an AGM at shop A cannot write shop B's price or retire shop B's lane", async () => {
    expect(await refused(saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId: "s", scope: SHOP_B, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(retireShopPriceLane(actor("agm", 6, [SHOP_A]), { skuId: "s", locationId: SHOP_B }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a shift lead (5) cannot write any version; an AGM cannot write the global pack at all", async () => {
    expect(await refused(saveSkuPackVersion(actor("shift_lead", 5, [SHOP_A]), { skuId: "s", scope: SHOP_A, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(saveSkuPackVersion(actor("agm", 6, [SHOP_A]), { skuId: "s", scope: null, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("back to default: a GM may not retire another shop's version", async () => {
    expect(await refused(retireShopPackVersion(actor("gm", 7, [SHOP_A]), { versionId: "v", locationId: SHOP_B }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a GLOBAL first value binds the SKU's OWNING shop (Astra 2a r3#1): a shop-B SKU refuses an AGM/GM of A, for price AND pack", async () => {
    current = createFakeDb({ vendor_items: [{ id: "s-b", location_id: SHOP_B, avg_oz_per_each: null, sku_class: "raw", active: true }] });
    expect(await refused(saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId: "s-b", scope: null, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s-b", scope: null, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a shared SKU, or one owned by the actor's own shop, passes the owner bind (it reaches the RPC)", async () => {
    current = createFakeDb({ vendor_items: [
      { id: "s-shared", location_id: null, avg_oz_per_each: null, sku_class: "raw", active: true },
      { id: "s-a", location_id: SHOP_A, avg_oz_per_each: null, sku_class: "raw", active: true },
    ] });
    for (const skuId of ["s-shared", "s-a"]) {
      const p = saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId, scope: null, unitPrice: 10, effectiveDate: "2026-10-15" });
      await expect(p).rejects.not.toBeInstanceOf(SkuVersionError); // the fake db has no rpc(): every gate passed
    }
  });
  it("payload refusals come after the bind: an in-scope actor with an empty chain or a bad price gets the validation error", async () => {
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_A, levels: [], expectedLiveVersionId: null }))).toEqual({ status: 400, code: "empty_chain" });
    expect(await refused(saveSkuPrice(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_A, unitPrice: -1, effectiveDate: "2026-10-15" }))).toEqual({ status: 400, code: "invalid_price" });
  });
});
```

Run: `npx vitest run tests/sku-versions-permissions.test.ts` → FAIL (module not found).

- [ ] **Step 2: Export what the writer reuses from `lib/admin/pack-chain.ts`**

Add `export ` in front of `function validateSubmission(`, `async function loadMeasureLabels(`, `async function loadMeasuresMap(` and `async function assertSkuExists(`. `assertSkuExists` also returns the SKU's owning shop. Change its select to `"id, avg_oz_per_each, sku_class, location_id"`, its row type to add `location_id: string | null`, its return type to `Promise<{ avgOzPerEach: number | null; skuClass: PackChainSkuClass; ownerLocationId: string | null }>`, and its return to `return { avgOzPerEach: num(data.avg_oz_per_each), skuClass: normalizeSkuClass(data.sku_class), ownerLocationId: data.location_id };`. Existing destructuring callers are unaffected. No other change in this task; Task 10 moves `replaceSkuPackChain` onto the RPC and deletes `syncSkuFlatFieldsFromChain` (the global mirror is now derived inside the RPC's transaction, 0259 `sku_flat_mirror_apply`).

- [ ] **Step 3: Register the audit vocabulary**

In `lib/destructive-actions.ts`, directly after `  "sku.pack_chain_update",`, insert:

```ts
  // ── Shop versions (catalog Phase 2a, 0259) ─────────────────────────────────
  // — sku.pack_version_save: a human saves a pack chain version (a shop's own, the global default,
  //   or a Restore). The same basis-altering act as sku.pack_chain_update, scoped.
  "sku.pack_version_save",
  // — sku.pack_version_retire: a shop goes "back to default"; the global chain answers for it again.
  "sku.pack_version_retire",
  // — sku.price_lane_retire: a shop's own price retired; the global price answers again.
  //   (A shop price itself is vendor_item.price_recorded, like every recorded price.)
  "sku.price_lane_retire",
```

- [ ] **Step 4: Create `lib/admin/sku-versions.ts`**

```ts
/**
 * SHOP VERSIONS — the gated writers and the history read (catalog Phase 2a, 0259). SERVER-ONLY,
 * service role. THE LIB IS THE AUTHORITY (spec §2): every writer decides role and shop HERE, before
 * any I/O — the route is the outer layer, not the lock (writeParFromSuggestion's posture):
 *   · AGM (6) / GM (7) write ONLY their own shop's version; MoO (8)+ write ANY active shop (D2 —
 *     catalogShopAllowed, deliberately not lockLocationContext) and the global default;
 *   · below MoO a global write is FIRST-VALUE-ONLY, decided by the writer RPC UNDER THE SKU LOCK in
 *     the same transaction as the insert (D5) — two requests cannot both see "none".
 * Atomicity lives in SQL; every write is audited with a closed AuditAction.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import {
  assertScopeToken, catalogShopAllowed, GLOBAL_VERSION_WRITE_MIN, skuOwnerAllowed, versionWriteGate,
  type VersionKind, type VersionScope, type VersionWriteRefusal,
} from "@/lib/sku-versions-shared";
import {
  assertSkuExists, loadMeasureLabels, loadMeasuresMap, validateSubmission,
  PackChainError, type PackChainLevelInput,
} from "@/lib/admin/pack-chain";

export class SkuVersionError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "SkuVersionError";
  }
}

function refuse(r: VersionWriteRefusal): never {
  throw new SkuVersionError(r.status, r.code);
}

/** THE BIND (a BIND_PRIMITIVES name): role + shop, decided before any I/O. Returns firstOnly for the RPC. */
function requireLocation(actor: AuthContext, kind: VersionKind, scope: VersionScope): { firstOnly: boolean } {
  const gate = versionWriteGate({ kind, level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!gate.ok) refuse(gate);
  return { firstOnly: gate.firstOnly };
}

/**
 * THE OWNING-SHOP BIND for a GLOBAL write (Astra 2a r3#1; skuOwnerAllowed): below MoO, a shop-owned
 * SKU's global value belongs to the people of that shop. One indexed read; refused as not_found.
 */
async function requireOwningShop(actor: AuthContext, skuId: string): Promise<void> {
  if (actor.level >= GLOBAL_VERSION_WRITE_MIN) return;
  const { data, error } = await getServiceRoleClient().from("vendor_items").select("id, location_id").eq("id", skuId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (error) throw new Error(`requireOwningShop: ${error.message}`);
  if (!data) throw new SkuVersionError(404, "sku_not_found");
  if (!skuOwnerAllowed(actor, data.location_id)) throw new SkuVersionError(404, "not_found");
}

/** Map an RPC P0001 refusal (`area:code`) to a typed error; anything else is a 500. */
export function versionErrorFromRpc(message: string): never {
  const m = /(?:sku_pack_version|sku_price|sku_pack_change):([a-z_]+)/.exec(message);
  const code = m?.[1];
  const status: Record<string, number> = {
    version_changed: 409, not_live: 409, no_shop_price: 409, par_changed: 409, request_not_open: 409,
    global_requires_moo: 403, global_cannot_retire: 400, invalid_levels: 400, unknown_measure: 400,
    invalid_based_on: 400, invalid_price: 400, invalid_date: 400, invalid_payload: 400, location_required: 400,
    par_lane_mismatch: 400, invalid_patch: 400, request_mismatch: 400,
    sku_not_found: 404, location_not_found: 404, not_found: 404,
  };
  if (code && status[code]) throw new SkuVersionError(status[code]!, code);
  throw new Error(`shop-version rpc failed: ${message}`);
}

export interface PreparedPackWrite { levels: PackChainLevelInput[]; firstOnly: boolean }

/**
 * Gate (before I/O) + the full chain validation (the same validateSubmission the legacy editor runs).
 * Exported so the 2b item page's atomic pack+par apply shares EXACTLY this decision.
 */
export async function preparePackVersionWrite(
  actor: AuthContext,
  input: { skuId: string; scope: VersionScope; levels: PackChainLevelInput[] },
): Promise<PreparedPackWrite> {
  const { firstOnly } = requireLocation(actor, "pack", input.scope);
  if (input.levels.length === 0) throw new SkuVersionError(400, "empty_chain");
  try {
    const { avgOzPerEach, skuClass, ownerLocationId } = await assertSkuExists(input.skuId);
    // A GLOBAL chain of a shop-owned SKU binds that shop below MoO (Astra 2a r3#1).
    if (input.scope === null && !skuOwnerAllowed(actor, ownerLocationId)) throw new SkuVersionError(404, "not_found");
    const [measureLabels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
    return { levels: validateSubmission(input.levels, measureLabels, measures, avgOzPerEach, skuClass), firstOnly };
  } catch (e) {
    if (e instanceof PackChainError) throw new SkuVersionError(e.status, e.code, e.message);
    throw e;
  }
}

/** The RPC payload of a validated chain (index-linked, trimmed). */
export function rpcLevels(levels: readonly PackChainLevelInput[]): Array<Record<string, unknown>> {
  return levels.map((l) => ({
    label: l.label.trim(), containsQty: l.containsQty, containsIndex: l.containsIndex,
    containsMeasureUnit: l.containsIndex != null ? null : (l.containsMeasureUnit ?? "").trim(),
  }));
}

export interface SavePackVersionInput {
  skuId: string;
  scope: VersionScope;
  levels: PackChainLevelInput[];
  /** The live version the editor saw for this scope (null = none). A mismatch is 409 version_changed. */
  expectedLiveVersionId: string | null;
  basedOnVersionId?: string | null;
  note?: string | null;
  restoredFromVersionId?: string | null;
}

/** Save a pack chain version for a shop or the global default. */
export async function saveSkuPackVersion(
  actor: AuthContext,
  input: SavePackVersionInput,
): Promise<{ versionId: string; retiredVersionId: string | null; flatFieldsSynced: boolean | null }> {
  const prepared = await preparePackVersionWrite(actor, input);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("save_sku_pack_version", {
    p_sku: input.skuId, p_location: input.scope, p_levels: rpcLevels(prepared.levels),
    p_expected_live: input.expectedLiveVersionId, p_based_on: input.basedOnVersionId ?? null,
    p_note: input.note ?? null, p_actor: actor.user.id, p_first_only: prepared.firstOnly,
  });
  if (error) versionErrorFromRpc(error.message);
  const result = data as { version_id: string; retired_version_id: string | null; mirror_synced: boolean | null };
  // The GLOBAL flat mirror was derived INSIDE the RPC's locked transaction (0259 sku_flat_mirror_apply,
  // Astra 2a r2#6) — never synced afterwards, so two saves can never leave the mirror of the older one.
  const flatFieldsSynced = result.mirror_synced;
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_version_save", resourceTable: "sku_pack_versions", resourceId: result.version_id,
    metadata: {
      sku_id: input.skuId, location_id: input.scope, scope: input.scope === null ? "global" : "shop",
      retired_version_id: result.retired_version_id, based_on_version_id: input.basedOnVersionId ?? result.retired_version_id,
      restored_from_version_id: input.restoredFromVersionId ?? null, first_only: prepared.firstOnly,
      labels: prepared.levels.map((l) => l.label.trim()), level_count: prepared.levels.length, flat_fields_synced: flatFieldsSynced,
    },
    ipAddress: null, userAgent: null,
  });
  return { versionId: result.version_id, retiredVersionId: result.retired_version_id, flatFieldsSynced };
}

/** Restore = a NEW version with the old one's levels, based on the old one. Never a delete, never a revive. */
export async function restoreSkuPackVersion(
  actor: AuthContext,
  input: { skuId: string; scope: VersionScope; fromVersionId: string; expectedLiveVersionId: string | null },
): Promise<{ versionId: string; retiredVersionId: string | null }> {
  requireLocation(actor, "pack", input.scope);
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("sku_pack_levels")
    .select("id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
    .eq("version_id", input.fromVersionId).eq("sku_id", input.skuId)
    .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
    .returns<Array<{ id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number }>>();
  if (error) throw new Error(`restoreSkuPackVersion read: ${error.message}`);
  if (!rows || rows.length === 0) throw new SkuVersionError(404, "not_found");
  const indexById = new Map(rows.map((r, i) => [r.id, i]));
  const levels: PackChainLevelInput[] = rows.map((r) => ({
    label: r.label, containsQty: Number(r.contains_qty),
    containsIndex: r.contains_level_id != null ? (indexById.get(r.contains_level_id) ?? -1) : null,
    containsMeasureUnit: r.contains_level_id != null ? null : r.contains_measure_unit,
  }));
  const saved = await saveSkuPackVersion(actor, {
    skuId: input.skuId, scope: input.scope, levels, expectedLiveVersionId: input.expectedLiveVersionId,
    basedOnVersionId: input.fromVersionId, restoredFromVersionId: input.fromVersionId,
  });
  return { versionId: saved.versionId, retiredVersionId: saved.retiredVersionId };
}

/** A shop goes BACK TO DEFAULT for its pack: retire its live version (never the global one). */
export async function retireShopPackVersion(actor: AuthContext, input: { versionId: string; locationId: string }): Promise<void> {
  requireLocation(actor, "pack", input.locationId);
  const sb = getServiceRoleClient();
  const { data: v, error: vErr } = await sb.from("sku_pack_versions").select("id, sku_id, location_id")
    .eq("id", input.versionId).maybeSingle<{ id: string; sku_id: string; location_id: string | null }>();
  if (vErr) throw new Error(`retireShopPackVersion read: ${vErr.message}`);
  // The version must be THIS shop's — the bind above was on the shop the caller named.
  if (!v || v.location_id !== input.locationId) throw new SkuVersionError(404, "not_found");
  const { error } = await sb.rpc("retire_sku_pack_version", { p_version: input.versionId, p_actor: actor.user.id });
  if (error) versionErrorFromRpc(error.message);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_version_retire", resourceTable: "sku_pack_versions", resourceId: input.versionId,
    metadata: { sku_id: v.sku_id, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

export interface SavePriceInput { skuId: string; scope: VersionScope; unitPrice: number; effectiveDate: string }

/** Record a price for a shop (opens its lane on the first one) or the global default (MoO+, or a FIRST global price). */
export async function saveSkuPrice(actor: AuthContext, input: SavePriceInput): Promise<{ priceId: string; laneId: string | null; laneCreated: boolean }> {
  const { firstOnly } = requireLocation(actor, "price", input.scope);
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) throw new SkuVersionError(400, "invalid_price");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) || Number.isNaN(Date.parse(input.effectiveDate))) {
    throw new SkuVersionError(400, "invalid_date");
  }
  // A GLOBAL price of a shop-owned SKU binds that shop below MoO (Astra 2a r3#1).
  if (input.scope === null) await requireOwningShop(actor, input.skuId);
  const sb = getServiceRoleClient();
  if (input.scope !== null) {
    const { data, error } = await sb.rpc("save_sku_shop_price", {
      p_sku: input.skuId, p_location: input.scope, p_unit_price: input.unitPrice,
      p_effective_date: input.effectiveDate, p_actor: actor.user.id, p_source: null, p_source_note: null,
    });
    if (error) versionErrorFromRpc(error.message);
    const r = data as { price_id: string; lane_id: string; lane_created: boolean };
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: r.price_id,
      metadata: { vendor_item_id: input.skuId, unit_price: input.unitPrice, effective_date: input.effectiveDate, location_id: input.scope, price_lane_id: r.lane_id, lane_created: r.lane_created },
      ipAddress: null, userAgent: null,
    });
    return { priceId: r.price_id, laneId: r.lane_id, laneCreated: r.lane_created };
  }
  const { data, error } = await sb.rpc("save_sku_global_price", {
    p_sku: input.skuId, p_unit_price: input.unitPrice, p_effective_date: input.effectiveDate,
    p_actor: actor.user.id, p_first_only: firstOnly,
  });
  if (error) versionErrorFromRpc(error.message);
  const r = data as { price_id: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: r.price_id,
    metadata: { vendor_item_id: input.skuId, unit_price: input.unitPrice, effective_date: input.effectiveDate, location_id: null, first_only: firstOnly },
    ipAddress: null, userAgent: null,
  });
  return { priceId: r.price_id, laneId: null, laneCreated: false };
}

/** A shop goes BACK TO DEFAULT for its price: retire its live lane (the rows stay). */
export async function retireShopPriceLane(actor: AuthContext, input: { skuId: string; locationId: string }): Promise<void> {
  requireLocation(actor, "price", input.locationId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("retire_sku_price_lane", { p_sku: input.skuId, p_location: input.locationId, p_actor: actor.user.id });
  if (error) versionErrorFromRpc(error.message);
  const r = data as { lane_id: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.price_lane_retire", resourceTable: "sku_price_lanes", resourceId: r.lane_id,
    metadata: { sku_id: input.skuId, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

export interface PackVersionHistoryRow {
  id: string; locationId: string | null; active: boolean; basedOnVersionId: string | null;
  validFrom: string; validTo: string | null; createdBy: string | null; note: string | null; labels: string[];
}

/** Every pack version of a SKU visible to a scope (global + that shop), newest first. Read floor 6; D2 allowance. */
export async function loadSkuPackVersionHistory(actor: AuthContext, skuId: string, scope: VersionScope): Promise<PackVersionHistoryRow[]> {
  if (actor.level < 6) throw new SkuVersionError(403, "forbidden");
  if (scope !== null && !catalogShopAllowed(actor, scope)) throw new SkuVersionError(404, "not_found");
  const sb = getServiceRoleClient();
  const base = sb.from("sku_pack_versions").select("id, location_id, active, based_on_version_id, valid_from, valid_to, created_by, note").eq("sku_id", skuId);
  const scoped = scope === null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
  const { data: versions, error } = await scoped.order("valid_from", { ascending: false }).order("id", { ascending: false })
    .returns<Array<{ id: string; location_id: string | null; active: boolean; based_on_version_id: string | null; valid_from: string; valid_to: string | null; created_by: string | null; note: string | null }>>();
  if (error) throw new Error(`loadSkuPackVersionHistory: ${error.message}`);
  const ids = (versions ?? []).map((v) => v.id);
  const labelsBy = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: levels, error: lErr } = await sb.from("sku_pack_levels").select("version_id, label, display_ordinal")
      .in("version_id", ids).order("display_ordinal", { ascending: true })
      .returns<Array<{ version_id: string; label: string; display_ordinal: number }>>();
    if (lErr) throw new Error(`loadSkuPackVersionHistory levels: ${lErr.message}`);
    for (const l of levels ?? []) labelsBy.set(l.version_id, [...(labelsBy.get(l.version_id) ?? []), l.label]);
  }
  return (versions ?? []).map((v) => ({
    id: v.id, locationId: v.location_id, active: v.active, basedOnVersionId: v.based_on_version_id,
    validFrom: v.valid_from, validTo: v.valid_to, createdBy: v.created_by, note: v.note, labels: labelsBy.get(v.id) ?? [],
  }));
}
```

- [ ] **Step 5: Register the writers with the differential location-bind check**

In `tests/location-bind-differential.test.ts`:
- `TENANCY_SCOPED_TABLES`, after `"recipe_yield_retrain_notes",`: add `// 0259 — a shop's own pack version / price lane belongs to that shop (location_id NULL = global).` followed by `"sku_pack_versions",`, `"sku_pack_levels",`, `"sku_price_lanes",`, `"vendor_price_history",`.
- `TENANCY_SCOPED_RPCS`, after `"complete_yield_retrain",`: add `// 0259 — the shop-version writers; lib/admin/sku-versions.ts binds before calling them.` followed by `"save_sku_pack_version",`, `"retire_sku_pack_version",`, `"save_sku_shop_price",`, `"save_sku_global_price",`, `"retire_sku_price_lane",`.
- `FILES`: add `// 0259 — every shop-version writer binds inside the lib (requireLocation) before any I/O.` followed by `"lib/admin/sku-versions.ts",`.

- [ ] **Step 6: Run, then commit**

Run: `npx vitest run tests/sku-versions-permissions.test.ts tests/location-bind-differential.test.ts tests/audit-actions.test.ts` → PASS.

```bash
git add lib/admin/sku-versions.ts lib/admin/pack-chain.ts lib/destructive-actions.ts tests/sku-versions-permissions.test.ts tests/location-bind-differential.test.ts
git commit -F - <<'EOF'
feat(catalog): gated shop-version writers — own shop for AGM/GM, any shop and global for MoO+, first value under the SKU lock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 10: The existing global writers obey the boundary, in 2a (D5)

Spec §3 says a GM/AGM never edits the global default. Three existing writers could still change it, and each now holds the line atomically:
- **`/admin/skus` chain editor** (`replaceSkuPackChain`, GM+). It moves onto `save_sku_pack_version` with `p_first_only = level < 8`.
- **"Record price"** (`recordSkuPrice`, AGM+). It moves onto `save_sku_global_price` with `p_first_only = level < 8`.
- **The SKU edit's flat pack fields** (`updateSku`, GM+). For an unchained SKU these ARE its global pack. Below MoO a field may be **set** (it was empty) but never **changed**, and the UPDATE carries that as a compare-and-set on NULL, so a concurrent first value cannot be overwritten.

Receiving-door price capture is untouched (an invoice is evidence, not an edit, and it lands in a shop's lane when the shop has one), and so is the level-9 vendor import. Until 2b, the SKU screens explain the refusal; 2b adds the item-page link.

**Files:**
- Modify: `lib/admin/pack-chain.ts`, `lib/admin/cost.ts`, `lib/admin/skus.ts`, `components/admin/skus/shared.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/legacy-global-writers.test.ts`

- [ ] **Step 1: Write the failing pins**

```ts
/**
 * Catalog Phase 2a (D5) — every EXISTING global pack/price writer obeys the boundary: below MoO a
 * first value only, decided atomically (an RPC under the SKU lock, or a compare-and-set UPDATE).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const body = (file: string, start: string) => {
  const src = readFileSync(file, "utf8");
  const a = src.indexOf(start);
  expect(a, `${start} not found`).toBeGreaterThan(-1);
  return src.slice(a, src.indexOf("\n}\n", a));
};

describe("the /admin/skus chain editor", () => {
  const b = body("lib/admin/pack-chain.ts", "export async function replaceSkuPackChain(");
  it("writes through the locked RPC with first-only below MoO, and never deactivates rows itself", () => {
    expect(b).toContain('sb.rpc("save_sku_pack_version"');
    expect(b).toContain("p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN");
    expect(b).not.toContain('.from("sku_pack_levels")');
    expect(b).toContain("skuOwnerAllowed(");
  });
  it("never syncs the flat mirror after the transaction (Astra 2a r2#6 — the RPC derives it under the lock)", () => {
    const src = readFileSync("lib/admin/pack-chain.ts", "utf8");
    expect(src).not.toContain("syncSkuFlatFieldsFromChain");
    expect(readFileSync("lib/admin/sku-versions.ts", "utf8")).not.toContain("syncSkuFlatFieldsFromChain");
  });
});

describe("Record price", () => {
  const b = body("lib/admin/cost.ts", "export async function recordSkuPrice(");
  it("writes through the locked first-value RPC, never a bare insert; binds the owning shop", () => {
    expect(b).toContain('sb.rpc("save_sku_global_price"');
    expect(b).toContain("skuOwnerAllowed(");
    expect(b).toContain("p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN");
    expect(b).not.toContain(".insert(");
  });
});

describe("the SKU edit's flat pack fields", () => {
  const b = body("lib/admin/skus.ts", "export async function updateSku(");
  it("below MoO: an UNCHANGED pack field is stripped (a stale form can never restore a MoO's change); a changed one must have been empty, enforced by the UPDATE itself", () => {
    expect(b).toContain("delete update[f];");
    expect(b).toContain("for (const f of changedPack) q = q.is(f, null);");
    expect(b).toContain('.select("id, location_id, sku_class, pack_format, units_per_pack, each_size, each_measure, each_container_label")');
    expect(b).toContain("currentSkuClass = cur.sku_class;");
    expect(b).toContain('"global_requires_moo"');
    expect(b).toContain('.from("sku_pack_versions")');
  });
});

describe("the SKU screens explain the refusal", () => {
  it("knows the codes, in English and Spanish", () => {
    const shared = readFileSync("components/admin/skus/shared.ts", "utf8");
    expect(shared).toContain('"global_requires_moo",');
    expect(shared).toContain('"version_changed",');
    for (const k of ["admin.skus.error.global_requires_moo", "admin.skus.error.version_changed"]) {
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((es as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
```

Run → FAIL.

- [ ] **Step 2: `replaceSkuPackChain` onto the RPC**

In `lib/admin/pack-chain.ts`, add `import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";`. Replace the body of `replaceSkuPackChain` from `  const sb = getServiceRoleClient();` through `  if (insErr) throw new Error(\`replaceSkuPackChain insert: ${insErr.message}\`);` with:

```ts
  const sb = getServiceRoleClient();

  // CATALOG PHASE 2a (D5): the legacy editor writes the GLOBAL default through the one atomic writer.
  // Below MoO it may set the FIRST chain of a SKU that has none (the add-SKU flow) and never change
  // one — decided by the RPC under the SKU lock. A GM changes how an item arrives for their own shop
  // on the item page (2b). The old deactivate-all/insert pair would also have deactivated every shop
  // version's levels, so it is gone.
  const { data: live, error: liveErr } = await sb.from("sku_pack_versions").select("id")
    .eq("sku_id", args.skuId).is("location_id", null).eq("active", true).maybeSingle<{ id: string }>();
  if (liveErr) throw new Error(`replaceSkuPackChain live version: ${liveErr.message}`);
  const { data: saved, error: rpcErr } = await sb.rpc("save_sku_pack_version", {
    p_sku: args.skuId, p_location: null,
    p_levels: validated.map((l) => ({ label: l.label.trim(), containsQty: l.containsQty, containsIndex: l.containsIndex, containsMeasureUnit: l.containsIndex != null ? null : l.containsMeasureUnit!.trim() })),
    p_expected_live: live?.id ?? null, p_based_on: null, p_note: null, p_actor: actor.user.id,
    p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN,
  });
  if (rpcErr) {
    if (rpcErr.message.includes("sku_pack_version:global_requires_moo")) throw new PackChainError(403, "global_requires_moo", "Only a Manager of Operations or higher can change this for everyone");
    if (rpcErr.message.includes("sku_pack_version:version_changed")) throw new PackChainError(409, "version_changed", "This pack changed since it was loaded — reload and re-apply");
    throw new Error(`replaceSkuPackChain save: ${rpcErr.message}`);
  }
  const rows = validated.map((l) => ({ label: l.label.trim() }));
  // The flat mirror was derived inside the RPC's locked transaction (Astra 2a r2#6).
  const flatFieldsSynced = (saved as { mirror_synced: boolean | null }).mirror_synced === true;
```

Then delete the line `  const flatFieldsSynced = await syncSkuFlatFieldsFromChain(sb, args.skuId, validated);` and the comment block directly above it (`  // FLAT-FIELD SYNC-ON-SAVE (SKU top-tier PR-B): …` through `  // those above, so a persisted chain always derives cleanly.`). Delete the whole `syncSkuFlatFieldsFromChain` function and its `SYNC_ATTEMPTS` constant; `npm run lint` confirms nothing else used them. Remove `deriveFlatFieldsFromChain` from the file's `@/lib/admin/catalog-shared` import if lint reports it unused. The audit (`rows.length` / `rows.map((r) => r.label)` / `flat_fields_synced: flatFieldsSynced`) and the return are unchanged.

- [ ] **Step 3: `recordSkuPrice` onto the RPC**

In `lib/admin/cost.ts`, add `GLOBAL_VERSION_WRITE_MIN` to the `@/lib/sku-versions-shared` import. Replace, inside `recordSkuPrice`, the block from `  const { data: inserted, error } = await sb` through `  if (!inserted) throw new Error("recordSkuPrice returned no row");` with:

```ts
  // CATALOG PHASE 2a (D5): a price recorded here is the GLOBAL price. Below MoO it may be the FIRST
  // one only, decided under the SKU lock with the insert (save_sku_global_price). Shops record their
  // own price (a lane) on the item page (2b); delivery prices are captured at the door, unchanged.
  const { data: savedPrice, error } = await sb.rpc("save_sku_global_price", {
    p_sku: args.skuId, p_unit_price: args.unitPrice, p_effective_date: args.effectiveDate, p_actor: actor.user.id,
    p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN,
  });
  if (error) {
    if (error.message.includes("sku_price:global_requires_moo")) throw new AdminCostError(403, "global_requires_moo", "Only a Manager of Operations or higher can change this price for everyone");
    throw new Error(`recordSkuPrice save: ${error.message}`);
  }
  const inserted = { id: (savedPrice as { price_id: string }).price_id };
```

The audit and return below keep using `inserted.id`.

- [ ] **Step 3b: Both legacy global writers bind the SKU's OWNING shop below MoO (Astra 2a r3#1)**

In `lib/admin/pack-chain.ts` `replaceSkuPackChain`, replace `  const { avgOzPerEach, skuClass } = await assertSkuExists(args.skuId);` with:

```ts
  const { avgOzPerEach, skuClass, ownerLocationId } = await assertSkuExists(args.skuId);
  // A shop-owned SKU's GLOBAL chain belongs to that shop's people below MoO (skuOwnerAllowed).
  if (!skuOwnerAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, ownerLocationId)) {
    throw new PackChainError(404, "not_found", "SKU not found");
  }
```

and add `skuOwnerAllowed` to the file's `@/lib/sku-versions-shared` import.

In `lib/admin/cost.ts` `recordSkuPrice`, replace

```ts
  const { data: sku, error: sErr } = await sb.from("vendor_items").select("id").eq("id", args.skuId).eq("active", true).maybeSingle<{ id: string }>();
```

with

```ts
  const { data: sku, error: sErr } = await sb.from("vendor_items").select("id, location_id").eq("id", args.skuId).eq("active", true)
    .maybeSingle<{ id: string; location_id: string | null }>();
```

and directly after `  if (!sku) throw new AdminCostError(400, "invalid_sku", "SKU not found or inactive");` insert:

```ts
  // A shop-owned SKU's GLOBAL price belongs to that shop's people below MoO (skuOwnerAllowed, Astra 2a r3#1).
  if (!skuOwnerAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, sku.location_id)) {
    throw new AdminCostError(404, "not_found", "SKU not found");
  }
```

and add `skuOwnerAllowed` to the file's `@/lib/sku-versions-shared` import.

- [ ] **Step 4: `updateSku` — set, never change, the flat pack below MoO (and never restore it from a stale form)**

The rule is decided against what was READ, and the write carries it (Astra 2a r2#2):
- A protected pack field whose payload value **equals what was read is stripped from the payload**. A GM's form that still shows `units_per_pack: 6` can never write 6 back over a MoO's concurrent 4.
- A field that **differs** must have been empty, and the UPDATE is a compare-and-set on NULL for each such field. A concurrent first value makes the update count 0, which is refused.

`sku_class` stays in the select and its type, because Phase 1's validation reads `currentSkuClass` (Astra 2a r2#7).

In `lib/admin/skus.ts`:
1. Add `import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";`, then add above `export async function updateSku(`:

```ts
/** The flat pack fields — for an unchained SKU, its GLOBAL pack (catalog Phase 2a, D5). */
const PACK_FIELDS = ["pack_format", "units_per_pack", "each_size", "each_measure", "each_container_label"] as const;
function samePackValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}
```

2. Directly before the line `  // The SKU is addressed by opaque id, so its shop has to be READ before it can be bound`, insert `  let packBefore: Record<string, unknown> = {};`.
3. Replace (Phase 1's bind read, which already selects `sku_class`)

```ts
      .select("id, location_id, sku_class")
      .eq("id", args.id)
      .maybeSingle<{ id: string; location_id: string | null; sku_class: string | null }>();
```

with

```ts
      .select("id, location_id, sku_class, pack_format, units_per_pack, each_size, each_measure, each_container_label")
      .eq("id", args.id)
      .maybeSingle<{
        id: string; location_id: string | null; sku_class: string | null;
        pack_format: string | null; units_per_pack: number | null; each_size: number | string | null;
        each_measure: string | null; each_container_label: string | null;
      }>();
```

4. Directly after `    currentSkuClass = cur.sku_class;`, insert `    packBefore = cur;`.
5. Directly before `  // MEMBERSHIP FIRST, AND ONLY AFTER THE REST HAS VALIDATED.`, which is still before any write so a refusal can never leave half an edit, insert:

```ts
  // CATALOG PHASE 2a (D5; Astra 2a r2#2): below MoO, the flat pack is the GLOBAL pack. A field equal
  // to what was read is NOT written — a stale form must never restore a value a MoO changed
  // meanwhile — and a changed field must have been EMPTY (a first value), enforced again by the
  // UPDATE below as a compare-and-set on NULL. A GM changes how an item arrives on the item page.
  const changedPack: string[] = [];
  if (getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN) {
    for (const f of PACK_FIELDS) {
      if (!(f in update)) continue;
      if (samePackValue(update[f], packBefore[f])) { delete update[f]; continue; }
      if (packBefore[f] != null) {
        throw new AdminSkuError(403, "global_requires_moo", "Only a Manager of Operations or higher can change this item's pack for everyone");
      }
      changedPack.push(f);
    }
    if (changedPack.length > 0) {
      // A CHAINED SKU's flat fields are the mirror of its global chain, never a first value of their own.
      const { count: chained, error: chErr } = await getServiceRoleClient().from("sku_pack_versions")
        .select("id", { count: "exact", head: true }).eq("sku_id", args.id).is("location_id", null).eq("active", true);
      if (chErr) throw new Error(`updateSku chain check: ${chErr.message}`);
      if ((chained ?? 0) > 0) throw new AdminSkuError(403, "global_requires_moo", "This item's pack is set by its pack chain — a Manager of Operations changes it for everyone");
    }
  }
```

6. Replace

```ts
  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("vendor_items")
    .update(update, { count: "exact" })
    .eq("id", args.id);
  if (error) throw new Error(`updateSku failed: ${error.message}`);
  if (count === 0) throw new AdminSkuError(404, "sku_not_found", "SKU not found");
```

with

```ts
  const sb = getServiceRoleClient();
  let q = sb.from("vendor_items").update(update, { count: "exact" }).eq("id", args.id);
  // The first-value rule rides the write itself: each newly set pack field must STILL be empty.
  for (const f of changedPack) q = q.is(f, null);
  const { error, count } = await q;
  if (error) throw new Error(`updateSku failed: ${error.message}`);
  if (count === 0) {
    throw changedPack.length > 0
      ? new AdminSkuError(403, "global_requires_moo", "Someone set this pack first — reload")
      : new AdminSkuError(404, "sku_not_found", "SKU not found");
  }
```

The existing `if (Object.keys(update).length === 0) return;` above the write now also covers a form whose only pack fields were stripped as unchanged. Nothing is written, and nothing is audited, exactly as for an empty edit today.

- [ ] **Step 5: Explain the refusal (en + es)**

In `components/admin/skus/shared.ts` `KNOWN_ERROR_CODES`, after `  "products_schema_pending",` add `  // Catalog Phase 2a (D5): the global pack/price boundary.`, `  "global_requires_moo",`, `  "version_changed",`.

In `lib/i18n/en.json`, append after the current last key (put a comma after it first):

```json
  "admin.skus.error.global_requires_moo": "Only a Manager of Operations or higher can change this for everyone.",
  "admin.skus.error.version_changed": "This changed while you were editing. Reload and try again."
```

In `lib/i18n/es.json`, the same:

```json
  "admin.skus.error.global_requires_moo": "Solo un Gerente de Operaciones o superior puede cambiar esto para todos.",
  "admin.skus.error.version_changed": "Esto cambió mientras editabas. Vuelve a cargar e inténtalo otra vez."
```

- [ ] **Step 6: Run, then commit**

Run: `npx vitest run tests/legacy-global-writers.test.ts tests/sku-builder-shared.test.ts tests/location-bind-skus.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS, and no tsc output. (Drop any listed test file that does not exist.)

```bash
git add lib/admin/pack-chain.ts lib/admin/cost.ts lib/admin/skus.ts components/admin/skus/shared.ts lib/i18n/en.json lib/i18n/es.json tests/legacy-global-writers.test.ts
git commit -F - <<'EOF'
feat(catalog): existing global pack and price writers obey the boundary — first value only below MoO, atomically

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 11: The Tier E routes

The routes live under `/api/admin/catalog/sku/[id]/…`, the item page's own namespace. 2b adds the page at `/admin/catalog/sku/[id]`. Every route:
- parses an explicit field list;
- takes the session floor (6) as an outer layer;
- asserts Tier E (Phase 1's 15-minute edit window, on its own clock).

The lib decides the real gate. That includes D2: an unassigned MoO passes, because the route never binds a shop itself.

**No Phase 2 act takes Phase 1's one-shot grant.** The grant is for acts that cannot be taken back: retire a product, delete a recipe, deactivate a SKU. Every Phase 2 write is reversible by construction:
- Saving a version supersedes the old one and keeps it; Restore brings it back.
- "Back to default" retires a shop version or lane, but its rows stay; Restore or a new shop price reverses it.

So every Phase 2 write is an ordinary catalog edit, at Tier E. If review rules "back to default" destructive, the change touches nothing else:
1. Add `"sku.version_back_to_default"` to Phase 1's `GRANT_ACTIONS`.
2. Mint the grant from the client with that purpose.
3. Call `consumeStepUpGrant` in the two back-to-default routes before the lib call.

**Files:**
- Create: `app/api/admin/catalog/sku/[id]/pack/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/pack/restore/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/price/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/price/back-to-default/route.ts`
- Modify: `tests/step-up-tier-map.test.ts`
- Test: `tests/sku-version-routes.test.ts`

- [ ] **Step 1: Write the failing source-pin test `tests/sku-version-routes.test.ts`**

```ts
/** Catalog Phase 2a — the version routes: Tier E, a 6 floor outside, the lib inside, explicit fields. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = {
  "app/api/admin/catalog/sku/[id]/pack/route.ts": "saveSkuPackVersion(",
  "app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts": "retireShopPackVersion(",
  "app/api/admin/catalog/sku/[id]/pack/restore/route.ts": "restoreSkuPackVersion(",
  "app/api/admin/catalog/sku/[id]/price/route.ts": "saveSkuPrice(",
  "app/api/admin/catalog/sku/[id]/price/back-to-default/route.ts": "retireShopPriceLane(",
} as const;

describe.each(Object.entries(ROUTES))("%s", (file, call) => {
  const src = readFileSync(file, "utf8");
  it("asserts Tier E after the session and a level-6 outer floor", () => {
    expect(src).toContain('assertStepUp(ctx, "E")');
    expect(src).toContain("ctx.level < SHOP_VERSION_WRITE_MIN");
    expect(src.indexOf("requireSession(")).toBeLessThan(src.indexOf('assertStepUp(ctx, "E")'));
  });
  it("delegates the real gate to the lib (no shop bind of its own — D2 lives in the lib) and maps its typed error", () => {
    expect(src).toContain(call);
    expect(src).toContain("instanceof SkuVersionError");
    expect(src).not.toContain("lockLocationContext");
  });
  it("accepts a uuid shop or null, nothing else", () => {
    expect(src).toContain("UUID_RE");
  });
});
```

Run: `npx vitest run tests/sku-version-routes.test.ts` → FAIL (`ENOENT`).

- [ ] **Step 2: Create `app/api/admin/catalog/sku/[id]/pack/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/pack — save a pack chain version (catalog Phase 2a).
 * Body: { locationId: uuid | null, levels: [{ label, containsQty, containsIndex|null, containsMeasureUnit|null }],
 *         expectedLiveVersionId: uuid | null, basedOnVersionId?: uuid | null, note?: string | null }
 * locationId null = the global default (MoO+, or a GM's FIRST chain, decided under the SKU lock);
 * a shop = that shop's version (AGM/GM: their own shop; MoO+: any active shop). The lib
 * (lib/admin/sku-versions.ts) is the authority; this route is the outer layer: session, a level-6
 * floor, Tier E (the 15-minute edit window), an explicit field list.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveSkuPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import type { PackChainLevelInput } from "@/lib/admin/pack-chain";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedLiveVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedLiveVersionId" });
  const basedOn = optUuid(b.basedOnVersionId);
  if (basedOn === undefined) return jsonError(400, "invalid_payload", { field: "basedOnVersionId" });
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > 500)) {
    return jsonError(400, "invalid_payload", { field: "note" });
  }
  if (!Array.isArray(b.levels) || b.levels.length > 8) return jsonError(400, "invalid_payload", { field: "levels" });
  const levels: PackChainLevelInput[] = [];
  for (const raw of b.levels) {
    if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_payload", { field: "levels" });
    const l = raw as Record<string, unknown>;
    if (typeof l.label !== "string" || l.label.length > 60) return jsonError(400, "invalid_payload", { field: "label" });
    if (typeof l.containsQty !== "number") return jsonError(400, "invalid_payload", { field: "containsQty" });
    const containsIndex = l.containsIndex === null || l.containsIndex === undefined ? null : l.containsIndex;
    if (containsIndex !== null && typeof containsIndex !== "number") return jsonError(400, "invalid_payload", { field: "containsIndex" });
    const unit = l.containsMeasureUnit === null || l.containsMeasureUnit === undefined ? null : l.containsMeasureUnit;
    if (unit !== null && typeof unit !== "string") return jsonError(400, "invalid_payload", { field: "containsMeasureUnit" });
    levels.push({ label: l.label, containsQty: l.containsQty, containsIndex: containsIndex as number | null, containsMeasureUnit: unit as string | null });
  }

  try {
    const r = await saveSkuPackVersion(ctx, {
      skuId: id, scope: locationId, levels, expectedLiveVersionId: expected,
      basedOnVersionId: basedOn, note: (b.note as string | null | undefined) ?? null,
    });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId }, 201);
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: Create `app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/pack/back-to-default — a shop drops its own pack version and
 * the global default answers for it again (catalog Phase 2a). Body: { locationId: uuid, versionId: uuid }.
 * The version row is retired (valid_to stamped), never deleted. Tier E; the lib binds the shop.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireShopPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.versionId !== "string" || !UUID_RE.test(b.versionId)) return jsonError(400, "invalid_payload", { field: "versionId" });
  try {
    await retireShopPackVersion(ctx, { versionId: b.versionId, locationId: b.locationId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 4: Create `app/api/admin/catalog/sku/[id]/pack/restore/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/pack/restore — Restore from the History tab (catalog Phase 2a).
 * Body: { locationId: uuid | null, fromVersionId: uuid, expectedLiveVersionId: uuid | null }.
 * Restore makes a NEW version based on the old one — never a delete, never a revive.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { restoreSkuPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedLiveVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedLiveVersionId" });
  if (typeof b.fromVersionId !== "string" || !UUID_RE.test(b.fromVersionId)) return jsonError(400, "invalid_payload", { field: "fromVersionId" });
  try {
    const r = await restoreSkuPackVersion(ctx, { skuId: id, scope: locationId, fromVersionId: b.fromVersionId, expectedLiveVersionId: expected });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId }, 201);
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 5: Create `app/api/admin/catalog/sku/[id]/price/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/price — record a price for a shop (its own lane) or the global
 * default (catalog Phase 2a). Body: { locationId: uuid | null, unitPrice: number, effectiveDate: "YYYY-MM-DD" }.
 * Global below MoO = a FIRST price only, decided under the SKU lock (save_sku_global_price).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveSkuPrice, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
  if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });
  try {
    const r = await saveSkuPrice(ctx, { skuId: id, scope: locationId, unitPrice: b.unitPrice, effectiveDate: b.effectiveDate });
    return jsonOk({ priceId: r.priceId, laneId: r.laneId, laneCreated: r.laneCreated }, 201);
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 6: Create `app/api/admin/catalog/sku/[id]/price/back-to-default/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/price/back-to-default — a shop's price goes back to the global
 * default (catalog Phase 2a). Body: { locationId: uuid }. The lane retires; its rows stay.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireShopPriceLane, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  try {
    await retireShopPriceLane(ctx, { skuId: id, locationId: b.locationId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 7: Pin the new routes in the tier map**

In `tests/step-up-tier-map.test.ts`, add to `SERVER_TIER_MAP`:

```ts
  // Catalog Phase 2a — the shop-version routes run in the 15-minute edit window.
  "app/api/admin/catalog/sku/[id]/pack/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/pack/restore/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/price/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/price/back-to-default/route.ts": ["E"],
```

- [ ] **Step 8: Run**

Run: `npx vitest run tests/sku-version-routes.test.ts tests/step-up-tier-map.test.ts tests/step-up-edit-window-wiring.test.ts`
Expected: PASS, 0 failed. (Drop `step-up-edit-window-wiring` from the command if Phase 1 named that file differently; `ls tests | grep step-up` lists them.)

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/catalog tests/sku-version-routes.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): Tier E routes for shop versions — save, restore, back to default, shop price

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 12: Dynamic Pars — an auto par is valid only in the pack EPOCH it was computed in (D3)

**The ruling (D3, answering spec §9 and Astra 2a#4/#5, 2b r2#4).** An auto par is a number of **order units**, computed against the pack the shop effectively had.

**Why an epoch and not a version id.** A version id cannot tell "still on the pack I was computed with" from "back on it after a detour": G → S → back to default compares equal to G again and would resurrect a stale value. So 0259 keeps, per (SKU, shop), a **monotonic pack epoch** (`sku_pack_epochs`). A trigger on `sku_pack_versions` bumps it on every change of the pack that shop effectively receives:
- its own version made;
- its own version retired;
- the global version replaced while the shop rides it.

Each auto value carries the epoch it was computed in (`auto_{weekday,weekend}_pack_epoch`). At READ time the shop's current epoch for that SKU is stamped onto its overlay. Any other epoch retires the auto value, and the lane falls through to the global (or human) par. G → S → G is epochs 0 → 1 → 2, so a value computed in 0 is stale forever after. This is the r2-6 self-invalidation idiom: no sweeper, no staleness window.

**One loader decides for both halves of the walk.** `loadPackAwareOverlay` loads the overlay, the pack resolution and the epochs together and stamps them. **Both** `loadWalkerData` (what the manager sees) and `submitParPass` (the `par_qty` snapshot and the implied on-hand it saves) call it, and nothing else calls `loadOverlayBySku`. So display and submission cannot disagree (Astra 2a#5's 3-vs-5 probe). The nightly engine and readiness stamp the same way.

Three things are unchanged:
- **A human par is never touched.**
- **Unstamped readers** (an overlay object whose `effectivePackEpoch` was never set) behave as today. Only the four stamping readers above apply the check, and each is pinned.
- **Auto-apply is SHADOW in prod**, so no live number moves. 0259 stamps any existing auto value with epoch 0 (no epoch row yet), so the migration itself retires nothing.

The machine writer must now name its epoch: `parWriteColumns` throws for a machine write without `packEpoch`, the same "loud beats silent" posture as a revert without `appliedAt`.

**Files:**
- Modify: `lib/location-sku-shared.ts`, `lib/prep-consumption.ts` (adds `loadShopPackEpochs`), `lib/ordering.ts`, `lib/dynamic-pars.ts`, `lib/dynamic-pars-shared.ts`, `lib/sku-data-readiness.ts`, `lib/sku-data-readiness-load.ts`, `tests/dynamic-pars-write.test.ts`
- Test: `tests/shop-pack-dynamic-pars.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Catalog Phase 2a — D3: an auto par stands only in the PACK EPOCH it was computed in, per (sku, shop);
 * "back to default" is a new epoch, never the old one; the walk and its submission resolve through
 * ONE pack-aware loader.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { loadPackAwareOverlay } from "@/lib/ordering";
import { autoPackStale, resolvePar, resolveParSlot, stampEffectivePack, type LocationSkuOverlay } from "@/lib/location-sku-shared";
import { parWriteColumns } from "@/lib/dynamic-pars-shared";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const GLOBAL = { weekdayPar: 3, weekendPar: 4 };
const auto = (extra: Partial<LocationSkuOverlay> = {}): LocationSkuOverlay => ({
  weekdayPar: null, weekendPar: null,
  autoWeekdayPar: 5, autoWeekdayBaselinePar: 3, autoWeekdayPackEpoch: 0,
  autoWeekendPar: 6, autoWeekendBaselinePar: 4, autoWeekendPackEpoch: 0,
  ...extra,
});

describe("the pure rule", () => {
  it("unstamped reader: today's behaviour exactly (auto stands)", () => {
    expect(resolveParSlot(auto(), GLOBAL, "weekday")).toEqual({ value: 5, lane: "auto" });
  });
  it("the same epoch it was computed in: auto stands", () => {
    expect(resolveParSlot(auto({ effectivePackEpoch: 0 }), GLOBAL, "weekday")).toEqual({ value: 5, lane: "auto" });
  });
  it("G → S → G (shop version made, then back to default): stale at 1 AND at 2 — never resurrected", () => {
    expect(resolveParSlot(auto({ effectivePackEpoch: 1 }), GLOBAL, "weekday")).toEqual({ value: 3, lane: "global" });
    expect(resolveParSlot(auto({ effectivePackEpoch: 2 }), GLOBAL, "weekday")).toEqual({ value: 3, lane: "global" });
    expect([0, 1, 2].map((e) => autoPackStale(0, e))).toEqual([false, true, true]);
  });
  it("a global version replaced while the shop rides it is a new epoch too: stale", () => {
    expect(resolveParSlot(auto({ autoWeekendPackEpoch: 3, effectivePackEpoch: 4 }), GLOBAL, "weekend")).toEqual({ value: 4, lane: "global" });
  });
  it("an unstamped value cannot prove its epoch: stale; an unstamping reader skips the check", () => {
    expect(autoPackStale(null, 0)).toBe(true);
    expect(autoPackStale(undefined, undefined)).toBe(false);
  });
  it("a human par still wins over everything", () => {
    expect(resolveParSlot(auto({ weekdayPar: 2, effectivePackEpoch: 1 }), GLOBAL, "weekday")).toEqual({ value: 2, lane: "human" });
  });
  it("stampEffectivePack stamps EVERY overlay with its SKU's current epoch (0 when there is no row)", () => {
    const overlays = new Map<string, LocationSkuOverlay>([["a", auto()], ["b", auto()]]);
    stampEffectivePack(overlays, new Map([["a", 2]]));
    expect(overlays.get("a")!.effectivePackEpoch).toBe(2);
    expect(overlays.get("b")!.effectivePackEpoch).toBe(0);
  });
  it("the machine must name its epoch; it writes the stamp on ITS slot only", () => {
    expect(() => parWriteColumns({ kind: "machine", dayClass: "weekday", value: null, autoValue: 5, baselinePar: 3, appliedAt: "2026-10-15T10:00:00.000Z" }))
      .toThrow(/packEpoch/);
    const cols = parWriteColumns({ kind: "machine", dayClass: "weekday", value: null, autoValue: 5, baselinePar: 3, appliedAt: "2026-10-15T10:00:00.000Z", packEpoch: 2 });
    expect(cols.autoLane.auto_weekday_pack_epoch).toBe(2);
    expect(Object.keys(cols.autoLane).some((k) => k.includes("weekend"))).toBe(false);
  });
});

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const FROM = "2026-10-01T00:00:00.000Z";
/** turkey: global case 4 × 5 lb; auto par 5 computed in epoch 0; global par 3. `epoch` = this shop's current epoch. */
function tables(epoch: number, withShopVersion: boolean) {
  const t: Record<string, Array<Record<string, unknown>>> = {
    location_sku_settings: [{
      id: "lss-1", sku_id: "s-turkey", location_id: LOC, active_override: null, weekday_par: null, weekend_par: null,
      auto_weekday_par: 5, auto_weekend_par: 5, auto_weekday_baseline_par: 3, auto_weekend_baseline_par: 3,
      auto_weekday_applied_at: FROM, auto_weekend_applied_at: FROM,
      auto_weekday_pack_epoch: 0, auto_weekend_pack_epoch: 0,
    }],
    sku_pack_epochs: epoch === 0 ? [] : [{ sku_id: "s-turkey", location_id: LOC, epoch }],
    sku_pack_versions: [{ id: "pv-g", sku_id: "s-turkey", location_id: null, based_on_version_id: null, active: true, valid_from: FROM, valid_to: null }],
    sku_pack_levels: [
      { id: "g-c", sku_id: "s-turkey", version_id: "pv-g", location_id: null, effective_from: FROM, label: "case", contains_qty: 4, contains_level_id: "g-b", contains_measure_unit: null, display_ordinal: 0, active: true },
      { id: "g-b", sku_id: "s-turkey", version_id: "pv-g", location_id: null, effective_from: FROM, label: "bag", contains_qty: 5, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1, active: true },
    ],
  };
  if (withShopVersion) {
    t.sku_pack_versions!.push({ id: "sv-l", sku_id: "s-turkey", location_id: LOC, based_on_version_id: "pv-g", active: true, valid_from: "2026-10-15T14:00:00.000Z", valid_to: null });
    t.sku_pack_levels!.push({ id: "s-c", sku_id: "s-turkey", version_id: "sv-l", location_id: LOC, effective_from: "2026-10-15T14:00:00.000Z", label: "case", contains_qty: 2, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0, active: true });
  }
  return t;
}

describe("ONE pack-aware overlay loader for the walk and its submission (display/submission parity)", () => {
  afterEach(() => { current = null; });
  it("epoch 0 (the one it was computed in): the auto par (5) answers, and the chain is the global one", async () => {
    current = createFakeDb(tables(0, false));
    const { overlayBySku, chainsBySku } = await loadPackAwareOverlay(current.client as never, LOC, ["s-turkey"]);
    expect(resolvePar(overlayBySku.get("s-turkey") ?? null, GLOBAL, false)).toBe(5);
    expect(chainsBySku.get("s-turkey")!.map((l) => l.label)).toEqual(["case", "bag"]);
  });
  it("this shop makes its own case (epoch 1): the SAME loader retires the auto par — 3 (global), never 5", async () => {
    current = createFakeDb(tables(1, true));
    const { overlayBySku, chainsBySku } = await loadPackAwareOverlay(current.client as never, LOC, ["s-turkey"]);
    expect(overlayBySku.get("s-turkey")!.effectivePackEpoch).toBe(1);
    expect(resolvePar(overlayBySku.get("s-turkey") ?? null, GLOBAL, false)).toBe(3);
    expect(chainsBySku.get("s-turkey")!.map((l) => l.label)).toEqual(["case"]);
  });
  it("…and back to default (epoch 2, the global chain again): STILL 3 — the old value is never resurrected", async () => {
    current = createFakeDb(tables(2, false));
    const { overlayBySku, chainsBySku } = await loadPackAwareOverlay(current.client as never, LOC, ["s-turkey"]);
    expect(chainsBySku.get("s-turkey")!.map((l) => l.label)).toEqual(["case", "bag"]);
    expect(resolvePar(overlayBySku.get("s-turkey") ?? null, GLOBAL, false)).toBe(3);
  });
  it("the walk and the submit both resolve through that loader and nothing else loads overlays", () => {
    const src = readFileSync("lib/ordering.ts", "utf8");
    expect(src.match(/loadPackAwareOverlay\(sb, locationId, skuIds\)/g)?.length).toBe(2);
    expect(src.match(/loadOverlayBySku\(sb, locationId\)/g)?.length).toBe(1); // inside loadPackAwareOverlay only
    const submit = src.slice(src.indexOf("export async function submitParPass("));
    expect(submit).toContain("const [{ chainsBySku, overlayBySku }, measures] = await Promise.all([loadPackAwareOverlay(sb, locationId, skuIds), loadMeasures()]);");
    expect(submit).toContain("const par = resolvePar(overlayForPar,");
  });
  it("the nightly engine and readiness stamp from the epochs too", () => {
    const pars = readFileSync("lib/dynamic-pars.ts", "utf8");
    expect(pars).toContain("stampEffectivePack(overlayBySku, await loadShopPackEpochs(skuIds, locationId));");
    expect(pars).toContain("auto_weekday_pack_epoch");
    const ready = readFileSync("lib/sku-data-readiness.ts", "utf8");
    expect(ready).toContain("effectivePackEpoch: stamped ? epochFor(shopId, id) : undefined");
  });
});
```

Run: `npx vitest run tests/shop-pack-dynamic-pars.test.ts` → FAIL (`autoPackStale` is not exported).

- [ ] **Step 2: `lib/location-sku-shared.ts`**

In `LocationSkuOverlay`, directly after `  autoWeekendBaselinePar?: number | null;`, add:

```ts
  /**
   * The pack EPOCH each auto value was computed in (0259 sku_pack_epochs; catalog Phase 2a D3).
   * Absent before the probe; null = never stamped (cannot prove its epoch).
   */
  autoWeekdayPackEpoch?: number | null;
  autoWeekendPackEpoch?: number | null;
  /**
   * This SKU's CURRENT pack epoch at this shop, set by stampEffectivePack. UNDEFINED = this reader
   * did not stamp, and nothing below changes; a number = the epoch (0 when no change ever happened).
   */
  effectivePackEpoch?: number;
```

Replace the whole `resolveLane` function (from `function resolveLane(` through its closing `}`) with:

```ts
/**
 * D3 (catalog Phase 2a): an auto value is a number of ORDER UNITS computed against the pack the
 * shop effectively had, and it is valid only in the pack EPOCH it was computed in. Every change of
 * the effective pack — a shop version made or retired, the global one replaced while the shop rides
 * it — is a NEW epoch (monotonic, 0259), so "back to default" can never resurrect a value computed
 * before the detour. `undefined` effective = an unstamped reader = today's behaviour.
 */
export function autoPackStale(autoEpoch: number | null | undefined, effective: number | undefined): boolean {
  if (effective === undefined) return false;
  return (autoEpoch ?? null) !== effective;
}

function resolveLane(
  human: number | null | undefined,
  auto: number | null | undefined,
  autoBaseline: number | null | undefined,
  global: number | null,
  autoEpoch?: number | null,
  effectiveEpoch?: number,
): { value: number | null; lane: ParLane } {
  if (human != null) return { value: human, lane: "human" };
  if (auto != null && (autoBaseline ?? null) === global && !autoPackStale(autoEpoch, effectiveEpoch)) {
    return { value: auto, lane: "auto" };
  }
  return { value: global, lane: global == null ? "none" : "global" };
}
```

In `resolveParSlot`, replace its `return` statement with:

```ts
  return dayClass === "weekend"
    ? resolveLane(
        overlay?.weekendPar, overlay?.autoWeekendPar, overlay?.autoWeekendBaselinePar,
        global.weekendPar, overlay?.autoWeekendPackEpoch, overlay?.effectivePackEpoch,
      )
    : resolveLane(
        overlay?.weekdayPar, overlay?.autoWeekdayPar, overlay?.autoWeekdayBaselinePar,
        global.weekdayPar, overlay?.autoWeekdayPackEpoch, overlay?.effectivePackEpoch,
      );
```

Append at the end of the file:

```ts
/**
 * Stamp each overlay with its SKU's CURRENT pack epoch at this shop (D3) — from sku_pack_epochs
 * (lib/prep-consumption.ts loadShopPackEpochs). No row = epoch 0. A SKU with no overlay row has no
 * auto value to retire.
 */
export function stampEffectivePack<T extends LocationSkuOverlay>(
  overlays: Map<string, T>,
  epochs: ReadonlyMap<string, number>,
): void {
  for (const [skuId, overlay] of overlays) overlay.effectivePackEpoch = epochs.get(skuId) ?? 0;
}
```

- [ ] **Step 3: `lib/prep-consumption.ts` — the epoch loader**

Directly after `loadAllSkuPackChains`, add:

```ts
/**
 * This shop's CURRENT pack epoch per SKU (0259 sku_pack_epochs; D3). A SKU with no row is at epoch 0
 * and is simply absent here. Chunked + paged like every pack read; throws on error (a swallowed
 * failure would read every epoch as 0 and resurrect stale machine pars).
 */
export async function loadShopPackEpochs(skuIds: string[], locationId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  for (let i = 0; i < skuIds.length; i += ID_CHUNK) {
    const chunk = skuIds.slice(i, i + ID_CHUNK);
    const rows = await selectAllRows<{ sku_id: string; epoch: number | string }>(async (from, to) => {
      const { data, error } = await sb.from("sku_pack_epochs").select("sku_id, epoch")
        .eq("location_id", assertScopeToken(locationId)).in("sku_id", chunk)
        .order("sku_id", { ascending: true }).range(from, to).returns<Array<{ sku_id: string; epoch: number | string }>>();
      if (error) throw new Error(`loadShopPackEpochs: ${error.message}`);
      return { data };
    });
    for (const r of rows) out.set(r.sku_id, Number(r.epoch));
  }
  return out;
}
```

- [ ] **Step 4: `lib/ordering.ts` — one pack-aware overlay loader for the walk and the submit**

1. `OVERLAY_AUTO_COLUMNS`: replace `  "auto_weekday_par, auto_weekend_par, auto_weekday_baseline_par, auto_weekend_baseline_par";` with `  "auto_weekday_par, auto_weekend_par, auto_weekday_baseline_par, auto_weekend_baseline_par, auto_weekday_pack_epoch, auto_weekend_pack_epoch";`.
2. In `loadOverlayBySku`'s `.returns<Array<{ … }>>` type, after `      auto_weekend_baseline_par?: number | string | null;` add `      auto_weekday_pack_epoch?: number | string | null;` and `      auto_weekend_pack_epoch?: number | string | null;`.
3. In its `if (autoLane) { … }` block, after `      row.autoWeekendBaselinePar = num(r.auto_weekend_baseline_par ?? null);` add `      row.autoWeekdayPackEpoch = num(r.auto_weekday_pack_epoch ?? null);` and `      row.autoWeekendPackEpoch = num(r.auto_weekend_pack_epoch ?? null);`.
4. Directly after the closing `}` of `loadOverlayBySku`, add:

```ts
/**
 * THE ONE OVERLAY READ OF THE WALK (catalog Phase 2a, D3). The overlay, THIS shop's pack resolution
 * and its pack epochs, loaded together and stamped together: chains feed the order units, and the
 * epoch retires an auto par computed in any other epoch (a new case, or back to default).
 * loadWalkerData (what the manager SEES) and submitParPass (the par_qty snapshot and the implied
 * on-hand it SAVES) both call exactly this, so display and submission cannot disagree.
 */
export async function loadPackAwareOverlay(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  skuIds: string[],
): Promise<{ overlayBySku: Map<string, OverlayRow>; chainsBySku: Map<string, PackChainLevel[]>; packResolution: Map<string, ResolvedPack>; epochs: Map<string, number> }> {
  const [overlayBySku, packResolution, epochs] = await Promise.all([
    loadOverlayBySku(sb, locationId),
    loadSkuPackResolution(skuIds, locationId),
    loadShopPackEpochs(skuIds, locationId),
  ]);
  stampEffectivePack(overlayBySku, epochs);
  return { overlayBySku, chainsBySku: levelsBySku(packResolution), packResolution, epochs };
}
```

5. In `loadWalkerData`:
   - Replace `  const [chainsBySku, measures, rawUsageBySku, onHandView, { data: vendorRows, error: vErr }, lastOrderBySku, overlayBySku, cutoffsByVendor,` with `  const [packAware, measures, rawUsageBySku, onHandView, { data: vendorRows, error: vErr }, lastOrderBySku, cutoffsByVendor,`. The rest of that destructure line is unchanged.
   - Replace the element `      loadSkuPackChains(skuIds, locationId),` (the first element of that `Promise.all`) with `      loadPackAwareOverlay(sb, locationId, skuIds),`.
   - Delete the element line `      loadOverlayBySku(sb, locationId),` in that `Promise.all`.
   - Directly after `  if (vErr) throw new Error(\`loadWalkerData vendors: ${vErr.message}\`);`, insert:

```ts
  // CATALOG PHASE 2a (D3): the chains and the epoch-stamped overlay come from ONE pack-aware read.
  const { overlayBySku, chainsBySku } = packAware;
```

6. In `submitParPass`, replace

```ts
  const [chainsBySku, measures, overlayBySku] = await Promise.all([
    loadSkuPackChains(skuIds, locationId),
    loadMeasures(),
    loadOverlayBySku(sb, locationId),
  ]);
```

with

```ts
  // CATALOG PHASE 2a (D3): the SAME pack-aware read the walk rendered from — a stale auto par the
  // manager did not see can never become the par_qty snapshot or the implied on-hand saved here.
  const [{ chainsBySku, overlayBySku }, measures] = await Promise.all([loadPackAwareOverlay(sb, locationId, skuIds), loadMeasures()]);
```

7. Imports:
   - add `loadShopPackEpochs, loadSkuPackResolution` to the `@/lib/prep-consumption` import;
   - add `stampEffectivePack` to the `@/lib/location-sku-shared` import;
   - add `import { levelsBySku, type ResolvedPack } from "@/lib/sku-versions-shared";`;
   - add `import type { PackChainLevel } from "@/lib/pack-chain-shared";` if it is not imported already.

   Remove `loadSkuPackChains` from the prep-consumption import only if `grep -n "loadSkuPackChains(" lib/ordering.ts` shows no remaining call (the rescue and shrinkage paths keep theirs).

- [ ] **Step 5: `lib/dynamic-pars.ts` — the nightly engine stamps the same way, and the machine names its epoch**

1. `loadParOverlay`: its `auto` columns string becomes `"auto_weekday_par, auto_weekend_par, auto_weekday_baseline_par, auto_weekend_baseline_par, pinned_weekday_at, pinned_weekend_at, auto_weekday_pack_epoch, auto_weekend_pack_epoch"`. Its `.returns` type gains `auto_weekday_pack_epoch?: number | string | null; auto_weekend_pack_epoch?: number | string | null;`. Its `if (autoLane)` block gains `row.autoWeekdayPackEpoch = num(r.auto_weekday_pack_epoch ?? null);` and `row.autoWeekendPackEpoch = num(r.auto_weekend_pack_epoch ?? null);`.
2. `loadDemandInputs`: directly after `  if (actionRows.error) throw new Error(\`loadDemandInputs suggestion actions: ${actionRows.error.message}\`);` insert:

```ts
  // CATALOG PHASE 2a (D3): the epoch stamp that retires an auto par computed in any other pack epoch
  // (one chunked read for the whole shop — the batch law holds).
  stampEffectivePack(overlayBySku, await loadShopPackEpochs(skuIds, locationId));
```

   (Its `loadSkuPackChains(skuIds, locationId)` from Task 5 stays as it is; the chains need no epoch.)
3. `ParWriteInput`: after `  baselinePar?: number | null;` add:

```ts
  /** "machine" only, REQUIRED (D3): the pack epoch (sku_pack_epochs) the auto value was computed in. */
  packEpoch?: number;
```

4. `writeParFromSuggestion`, in the machine branch, directly after the `machine_write_has_actor` check's closing `}`, insert:

```ts
    if (input.packEpoch === undefined) {
      throw new DynamicParsError(400, "machine_write_needs_pack", "A machine par names the pack epoch it was computed in");
    }
```

   In its `parWriteColumns({ … })` call, after `    baselinePar: input.baselinePar ?? null,` add `    packEpoch: input.packEpoch,`.
5. Imports: `loadShopPackEpochs` (`@/lib/prep-consumption`) and `stampEffectivePack` (`@/lib/location-sku-shared`).

- [ ] **Step 6: `lib/dynamic-pars-shared.ts` — `parWriteColumns` records the epoch**

In `ParWriteColumnsInput`, after `  baselinePar?: number | null;` add:

```ts
  /**
   * "machine" only, REQUIRED (catalog Phase 2a, D3): the pack EPOCH the auto value was computed in.
   * Its absence THROWS — the same posture as a revert with no appliedAt: a machine value that cannot
   * say which case it counted in must never be written.
   */
  packEpoch?: number;
```

In `parWriteColumns`, replace the whole `if (input.kind === "machine") { … }` block with:

```ts
  if (input.kind === "machine") {
    if (input.packEpoch === undefined) throw new Error("parWriteColumns: machine requires packEpoch (D3)");
    // Writes the AUTO lane ONLY. Never the human lane, never the pin, never the global
    // vendor_items par. actor null. The baseline AND the pack epoch ride along so the
    // read-time self-invalidation rules (r2-6, D3) have something to compare against.
    return {
      human: {},
      autoLane: {
        [autoCol]: input.autoValue ?? null,
        [baselineCol]: input.baselinePar ?? null,
        [appliedCol]: input.appliedAt ?? null,
        [`auto_${dc}_pack_epoch`]: input.packEpoch,
      },
    };
  }
```

A human write already nulls the auto value on its slot, so a leftover epoch stamp is inert there, and the human kinds' column sets stay exactly as they are.

In `tests/dynamic-pars-write.test.ts`, make these edits:
- In the test `the human patch never names a machine column, and vice versa`, replace `        const cols = parWriteColumns({ kind, dayClass, value: 4, autoValue: 4, baselinePar: 3, appliedAt: AT });` with `        const cols = parWriteColumns({ kind, dayClass, value: 4, autoValue: 4, baselinePar: 3, appliedAt: AT, packEpoch: 1 });`.
- In `\`machine\` NEVER touches the human lane or the pin`, replace `        kind: "machine", dayClass, value: 99, autoValue: 4, baselinePar: 3, appliedAt: AT,` with `        kind: "machine", dayClass, value: 99, autoValue: 4, baselinePar: 3, appliedAt: AT, packEpoch: 1,`.
- In `\`machine\` writes value, baseline and stamp together on ITS OWN slot`, replace `      kind: "machine", dayClass: "weekend", value: null, autoValue: 6, baselinePar: 5, appliedAt: AT,` with `      kind: "machine", dayClass: "weekend", value: null, autoValue: 6, baselinePar: 5, appliedAt: AT, packEpoch: 1,`.
- In the same test, replace `      auto_weekend_applied_at: AT,` (inside `toEqual`) with the two lines `      auto_weekend_applied_at: AT,` and `      auto_weekend_pack_epoch: 1,`.

- [ ] **Step 7: Readiness stamps too**

In `lib/sku-data-readiness-load.ts` `COLUMNS`:
- the `location_sku_settings` value gains `,auto_weekday_pack_epoch,auto_weekend_pack_epoch` at its end;
- add `sku_pack_epochs: "sku_id,location_id,epoch",`.

In `lib/sku-data-readiness.ts`, directly after the `basesFor` arrow function (Task 7), add:

```ts
  // D3: this shop's current pack epoch per SKU (no row = 0).
  const epochRows = tables.sku_pack_epochs ?? [];
  const epochFor = (shopId: string, skuId: string): number =>
    Number(epochRows.find((e) => e.location_id === shopId && e.sku_id === skuId)?.epoch ?? 0);
```

Then, inside the `resolvePar(overlay ? { … } : null, …)` call, replace `autoWeekendBaselinePar: liveNum(overlay.auto_weekend_baseline_par) }` with:

```ts
autoWeekendBaselinePar: liveNum(overlay.auto_weekend_baseline_par), autoWeekdayPackEpoch: liveNum(overlay.auto_weekday_pack_epoch), autoWeekendPackEpoch: liveNum(overlay.auto_weekend_pack_epoch), effectivePackEpoch: stamped ? epochFor(shopId, id) : undefined }
```

Directly above the `const par = resolvePar(` line, add `      const stamped = overlay != null && ("auto_weekday_pack_epoch" in overlay || "auto_weekend_pack_epoch" in overlay);`. A pre-0259 table has no stamp columns, so its overlay is unstamped and its auto value stands exactly as before. If Task 7 prefixed `packs` as `_packs` and nothing else reads it, delete that binding now.

- [ ] **Step 8: Run**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → no output.
Run: `npx vitest run tests/shop-pack-dynamic-pars.test.ts tests/shop-versions-equivalence.test.ts tests/dynamic-pars-base.test.ts tests/dynamic-pars-write.test.ts tests/dynamic-pars-scenarios.test.ts tests/sku-data-readiness.test.ts tests/sku-data-readiness-shop-versions.test.ts`
Expected: PASS, 0 failed. (`ls tests | grep dynamic-pars` lists the suite; drop any name that does not exist.)

- [ ] **Step 9: Commit**

```bash
git add lib/location-sku-shared.ts lib/prep-consumption.ts lib/ordering.ts lib/dynamic-pars.ts lib/dynamic-pars-shared.ts lib/sku-data-readiness.ts lib/sku-data-readiness-load.ts tests/shop-pack-dynamic-pars.test.ts tests/dynamic-pars-write.test.ts
git commit -F - <<'EOF'
feat(pars): an auto par stands only in the pack epoch it was computed in — back to default never resurrects it; one loader for walk and submit (D3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 13: The law (AGENTS.md)

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the section**

Insert this section immediately before `### Toast sales ingest`:

```markdown
### Shop versions (0259–0260, catalog Phase 2a, 2026-10-15)

- **ONE RESOLVER PER KIND, AND IT IS PURE.** A SKU's pack chain and price have a GLOBAL default and optional SHOP versions (`location_id NULL = global`, the product_primaries idiom). Every consumer gets "this shop's version in force, else the global one" from `lib/sku-versions-shared.ts` (`resolvePackLevels`, `pickVersionsAsOf` + `packsFromVersions`, `resolveCurrentPrices`, `contentOzForScope`) behind the loader points — `loadSkuPackResolution` / `loadSkuPackChains` / `loadAllSkuPackChains` / `loadRecipeGraph` / `createDatedGraphs` (`lib/prep-consumption.ts`) and `loadCurrentSkuPrices` (`lib/admin/cost.ts`). **The scope parameter is REQUIRED** so the compiler makes every caller decide; a consumer never picks a version itself. Pack loaders are PAGED and id-chunked (global ∪ shop rows exceed the row cap). A flat-only consumer (manual production, catering surplus) goes through `contentOzForScope`, never `skuContentOz` on flat fields alone.
- **SUPERSEDES 0159 lock L4.** Per-shop pack variance lives on chain versions, not on location-scoped `vendor_items` copies (Juan's spec 2026-10-15 §3). Store copies remain shop-scoped SKUs with their own chains, and their flat mirror is derived from the chain the copy actually cloned.
- **A version is an EFFECTIVE-DATED ROW.** `sku_pack_versions (valid_from, valid_to, active)` — append-only; a save closes the old version and opens the new one; `(valid_to is null) = active`. Levels carry `version_id` + denormalized `location_id`, proven equal by the composite FK on the generated `scope_key`. Writes go through `save_sku_pack_version` / `retire_sku_pack_version` (SKU row lock first, optimistic `expected_live`). **Restore = a new version based on the old one. Back to default = retire the shop's version. Nothing is deleted.**
- **THE PAST RESOLVES AS OF ITS DAY (D1).** Depletion for business date D (Toast materialize and prior-day repair; ezCater's Toast window AND its actual orders, by `event_date`) resolves packs **as of the end of D** (`asOfForBusinessDate`, through `createDatedGraphs`), so a shop pack made today never re-resolves yesterday's sales. Live screens use now. Receipts, counts and productions keep the ounces they stored. Prep's "each" and "case" come from ONE selected pack (`unitsPerPackForScope` beside the chain's content). Recipes and product resolution stay current, as before.
- **A shop's price is a LANE.** `vendor_price_history` stays the one append-only ledger, now with `location_id` + `price_lane_id` (CHECK-paired, FK-proven). While a shop's `sku_price_lanes` row is live, that shop is priced from its lane. **A delivery's price is THAT shop's evidence** (decision e): `record_receiving_prices`, under the SKU lock, appends to the shop's live lane or OPENS its first lane — it never moves the global price other shops inherit (a shop's own store-copy SKU keeps its global row). The global price moves only through the catalog writers and the vendor import, which reads and writes the GLOBAL lane only.
- **The GLOBAL flat mirror is derived INSIDE the version transaction** (`sku_flat_mirror_apply`, called by `save_sku_pack_version` under the SKU lock). Nothing syncs it afterwards. A SKU's FIRST global chain first records its legacy flat pack as a dated baseline version (`flat_snapshot`, trigger `sku_pack_versions_flat_baseline`), so a past day never resolves to the overwritten mirror.
- **PERMISSIONS LIVE IN THE LIB AND THE DATABASE.** AGM (6) / GM (7) write ONLY their own shop's version, bound before any I/O; MoO (8)+ write ANY active shop (`catalogShopAllowed`, deliberately not `lockLocationContext`, which grants all shops only at 9) and the global default. Below MoO a GLOBAL pack or price may be set only when none exists — decided by the writer RPC under the SKU lock in the same transaction as the insert (`p_first_only`), or by a compare-and-set UPDATE on the flat pack fields. This binds every global writer: the item-page routes, the `/admin/skus` chain editor, Record price, and the SKU edit form. Routes are Tier E; no Phase 2 act takes a one-shot grant.
- **Every new table carries a service-role privilege CEILING** (revoke all from public/anon/authenticated/service_role, grant exactly SELECT/INSERT/UPDATE, assert DELETE/TRUNCATE/REFERENCES/TRIGGER absent) — the 0257 pattern.
- **The equivalence pin is permanent.** `tests/shop-versions-equivalence.test.ts` (golden frozen before the change) + `tests/counts-onhand-equivalence.test.ts`: with no shop versions, every pack, price, depletion (live and dated), flat content, cost, order-unit and on-hand number is byte-identical. The golden is regenerated only with a written reason.
- **Dynamic Pars (D3):** an auto value carries the PACK EPOCH it was computed in (`auto_*_pack_epoch`). `sku_pack_epochs` is bumped (monotonic, by trigger) on every change of the pack a shop effectively receives — its own version made or retired, the global one replaced while it rides it — and any other epoch retires the value at READ time; back to default is a new epoch, so a stale value is never resurrected. The walk and its submission resolve through ONE loader (`loadPackAwareOverlay`). A machine write without `packEpoch` throws. A human par is never touched.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs(agents): the shop-versions law (0259–0260)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 14: Apply runbook — sim → prod dry-run with rollback → prod → deploy → 0260 → stamp

**Gate:** all of these must hold:
- CC has reviewed the PR (Astra review to APPROVE per spec §7);
- CI is green;
- Juan gives the word for each production step.

Use the Supabase MCP. The sim project is the one `scripts/sim/dev-sim.mjs` points at; prod is `bgcvurheqzylyfehqgzh`.

- [ ] **Step 1: Pre-flight on prod (read-only).** First confirm that Phase 1's `0257_step_up_catalog_window_and_grants` is applied, because the Tier E routes read its column: `select version, name from supabase_migrations.schema_migrations order by version desc limit 5;`. Then:

```sql
select count(*) from public.sku_pack_levels;
select count(*) from (select sku_id from public.sku_pack_levels where active group by sku_id) x;
select count(*) from (select sku_id, effective_from, active from public.sku_pack_levels group by 1,2,3) x;
select count(*) from public.vendor_price_history where recorded_at is null;  -- must be 0 (Task 6 PO unification)
select count(*) from (select sku_id from public.sku_pack_levels where active group by sku_id, label having count(*) > 1) x;  -- must be 0
select count(*) from public.location_sku_settings where auto_weekday_par is not null or auto_weekend_par is not null;  -- expect 0 (SHADOW)
-- D1 REPAIR-WINDOW REPORT (decision d; Astra 2a r2#8): every BUSINESS DATE in the cron's repair
-- window (T-3 .. T-1, ET) whose depletion will move, per SKU, with EVERY chain boundary after it.
-- A date D moves when a global chain changed after the end of D: today the repair re-resolves D
-- through the current chain; after 0259 it resolves through the chain in force on D. Paste the rows
-- into the PR; zero rows = nothing moves.
with days as (
  select d::date as business_date
    from generate_series((now() at time zone 'America/New_York')::date - 3,
                         (now() at time zone 'America/New_York')::date - 1, interval '1 day') d
), boundaries as (
  select distinct sku_id, effective_from as changed_at
    from public.sku_pack_levels
   where effective_from >= ((now() at time zone 'America/New_York')::date - 3)::timestamp at time zone 'America/New_York'
)
select b.sku_id, vi.name, d.business_date,
       array_agg(distinct b.changed_at order by b.changed_at) as boundaries_after_that_day
  from days d
  join boundaries b on b.changed_at >= ((d.business_date + 1)::timestamp at time zone 'America/New_York')
  join public.vendor_items vi on vi.id = b.sku_id
 group by b.sku_id, vi.name, d.business_date
 order by b.sku_id, d.business_date;
```

Record the numbers and the report in the PR. Two outcomes are a STOP:
- A non-zero `recorded_at is null`: ask Juan before unifying the PO price order.
- A non-zero auto count: the stamp backfill is then load-bearing, so verify it in Step 2's VERIFY.

- [ ] **Step 2: Sim apply 0259.** Use `apply_migration` (name `0259_sku_shop_versions`, the file body), then run every VERIFY query in the 0259 header, including the privilege-ceiling, D3-epoch and trigger queries. Expected: as annotated. Version rows = the pre-flight group count; zero levels without a version; service_role holds only SELECT/INSERT/UPDATE on all three new tables. Then run the invoice-lane check (Task 6 Step 7) and expect `invoice lane check: OK`.

- [ ] **Step 3: Sim smoke.** Run `node scripts/sim/dev-sim.mjs`. First check Task 15 Step 5 browser-walk items 1–5 with **no** shop versions: the numbers on `/admin/menu-costing`, `/ordering`, `/operations/counts` and the receiving door must match production's screens for the same data. Then create a shop version through the API (signed-in GM on the sim, after the step-up prompt):

```bash
curl -s -X POST http://localhost:3100/api/admin/catalog/sku/<SKU_ID>/pack \
  -H "content-type: application/json" -H "cookie: <sim session cookie>" \
  -d '{"locationId":"<SHOP_ID>","expectedLiveVersionId":null,"levels":[{"label":"case","containsQty":4,"containsIndex":1,"containsMeasureUnit":null},{"label":"bag","containsQty":10,"containsIndex":null,"containsMeasureUnit":"lb"}]}'
```

Expected: `201 {"versionId":…}`. `/ordering` at that shop now shows the new order unit for that SKU; the other shop does not.

Then verify the D1 boundary:
1. Trigger the sales cron for yesterday (`GET /api/cron/toast-sales-pull?date=<yesterday>` with the sim cron secret).
2. Confirm that `toast_daily_depletion.direct_oz` for that SKU at that shop is unchanged from before the save:

```sql
select business_date, direct_oz from toast_daily_depletion where location_id = '<SHOP_ID>' and sku_id = '<SKU_ID>' order by business_date desc limit 3;
```

Finally, confirm the D2 boundary:
- A MoO with no membership at `<SHOP_ID>` gets `201` on the same call (a fresh `expectedLiveVersionId`).
- A GM of the OTHER shop gets `404`.

- [ ] **Step 4: Prod dry-run with rollback.** Run through `execute_sql` on prod, in this order:
1. `begin;`
2. the 0259 body **without** its own `begin;`/`commit;`
3. the VERIFY queries
4. `rollback;`

Expected: every VERIFY result as annotated, and the transaction rolls back. Confirm with `select to_regclass('public.sku_pack_versions');`, which must return `null`.

- [ ] **Step 5: Prod apply 0259** (Juan's word): `apply_migration` with name `0259_sku_shop_versions`. Re-run the VERIFY queries read-only.

- [ ] **Step 6: The snapshot proof.**
1. Export the prod snapshot (Task 1 Step 8 SQL) to `tmp/shop-versions-snapshot-after/`.
2. On the final branch commit, run `SHOP_VERSIONS_SNAPSHOT_DIR=tmp/shop-versions-snapshot-after SHOP_VERSIONS_SNAPSHOT_BASELINE=tmp/before.json npx vitest run tests/shop-versions-snapshot.test.ts`. Expected: 1 passed. The real catalog produces identical live numbers, and the dated day equals live unless Step 1's report listed a change after it.
3. If prod data moved between the two exports (new deliveries), re-take `before.json` on the Task 1 commit from the NEW export and compare again.

- [ ] **Step 7: Merge** (Juan clicks the production merge). Vercel deploys main.

- [ ] **Step 8: The A → B → C sequence check (Task 4 Step 2) on the sim, BEFORE applying 0260 there.** Expect `finalize sequence check: OK`. Then sim apply 0260 and run its VERIFY queries.

- [ ] **Step 9: Prod dry-run 0260 with rollback, then prod apply 0260** (Juan's word), then VERIFY: `is_nullable = 'NO'`, plus zero levels whose version has no `valid_from`.

- [ ] **Step 10: Stamp the headers** in a docs-only follow-up commit, directly on main as AGENTS.md allows for pure docs:
- Under each gate line, add `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '<name>')`, with the version read from `supabase_migrations.schema_migrations`.
- Update the AGENTS.md "Current state" lineage line to 0260.

---

## Task 15: Final verification

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: every file passes, 0 failed. `tests/shop-versions-snapshot.test.ts` reports skipped.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exactly the 6 known Leaflet `TS2307` errors, and nothing else.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npx next build`
Expected: lint clean; build succeeds.

- [ ] **Step 4: The golden is untouched**

Run: `git log --oneline -- tests/fixtures/shop-versions-golden.json`
Expected: exactly one commit (Task 1's).

- [ ] **Step 5: Sim browser walk (port 3100)**

Walk each layout: phone (390×844), tablet (820×1180) and desktop (1440×900), in en and es.
  1. `/admin/menu-costing`: every row's cost and status are the same as before the branch (screenshot both).
  2. `/ordering` at each shop: order units and suggestion quantities are unchanged.
  3. `/operations/counts` at each shop: count-sheet levels and on-hand are unchanged.
  4. `/operations/receiving`: the level pickers are unchanged; a received price lands as before (global, `location_id` null).
  5. `/admin/skus`: chain descriptors, $/oz and readiness are unchanged. As a MoO the legacy chain editor still saves. As a GM it saves a FIRST chain on a chainless SKU, and on a chained SKU it shows the translated `global_requires_moo` message (en and es). The same holds for Record price as an AGM.
  6. After creating a shop version (Task 14 Step 3 curl), the ordering walk and the count sheet at THAT shop show the new case, and the other shop shows the old one. A manual production of 1 case at that shop records the shop's ounces (`select input_oz from production_inputs order by created_at desc limit 1`). Back to default via `POST …/pack/back-to-default` restores the old case at that shop.
  7. A shop price via `POST …/price` changes `/ordering`'s PO price at that shop only. The next delivery at that shop with a price lands in the lane: run `select location_id, price_lane_id from vendor_price_history order by recorded_at desc limit 1` on the sim.

- [ ] **Step 6: Open the PR**
- Title: `feat(catalog): Phase 2a — shop versions of pack and price, one dated resolver, equivalence pin`.
- Body: list the migrations as NOT APPLIED, link this plan, and paste the Task 14 pre-flight numbers and the D1 repair-window report. End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
```

---

## Review response map (r2)

| Finding | Resolution |
|---|---|
| **D1 / Astra 2a#6** historical replay | Versions are effective-dated (`valid_from`/`valid_to`, Task 3). The resolver takes `asOf` (Task 2 `pickVersionsAsOf`, Task 5 `loadSkuPackResolutionAsOf`). Toast materialize + prior-day repair and ezCater resolve through `createDatedGraphs` at their business date (Task 5 Step 9). Test: a shop override created today leaves yesterday's rebuilt depletion at 4 oz (`tests/shop-versions-as-of.test.ts`). The golden anchors pin dated = live on a quiet day (Task 1). |
| **D2 / Astra 2a#7** MoO any shop | `catalogShopAllowed` (level ≥ 8 or a membership), used by every writer's `requireLocation` (Tasks 2, 9). Positive test for an unassigned MoO; refusal for a GM elsewhere (Task 9). Routes do no shop bind (Task 11 pin). |
| **D3 / Astra 2a#4, #5** auto-par invalidation | A monotonic pack EPOCH per (sku, shop) and an epoch stamp per slot (0259 table + trigger + columns + backfill, Task 3; r3). Read-time `autoPackStale` covers created, retired (never resurrected) and global-replaced. ONE `loadPackAwareOverlay` for `loadWalkerData` AND `submitParPass`, with a parity test (3 global, never 5 auto) and source pins. Nightly and readiness stamp too; the machine write requires `packEpoch` (Task 12). |
| **D5 / Astra 2a#2, #8** global boundary on existing writers, atomic | `save_sku_pack_version(p_first_only)` and `save_sku_global_price(p_first_only)` decide first-value under the SKU row lock with the insert (Task 3). The `/admin/skus` chain editor and Record price are moved onto them; `updateSku`'s flat pack fields use a compare-and-set UPDATE (Task 10). New writers use the same RPCs (Task 9). |
| Astra 2a#1 manual production | `skuContentOzAt` → `contentOzForScope`. Persisted-ounce test: 192 oz at the shop vs 384 oz elsewhere (Task 5 Steps 2 and 8, `tests/scoped-flat-consumers.test.ts`). |
| Astra 2a#11 surplus | Shop-scoped denominator via `loadSkuPackResolution` + `contentOzForScope` (Task 5 Step 8), pinned. |
| Astra 2a#12 truncation | `loadSkuPackResolution` is id-chunked (100) and paged with `selectAllRows`, as are the as-of versions/levels reads (Task 5 Step 3). |
| Astra 2a#9 receiving lane race | `record_receiving_prices` locks every SKU in id order, then picks lane-or-global and appends in one transaction (Task 3). Both receiving writes call it (Task 6 Step 4, pinned). |
| Astra 2a#10 store-copy mirror | The 0216 re-emit derives the copy's flat mirror from the chain it cloned (`update public.vendor_items set pack_format = v_root_label …`), pinned (Task 3). |
| Astra 2a#3 privilege ceiling | Every new table: revoke all (including service_role), grant SELECT/INSERT/UPDATE, then a DO guard asserting DELETE/TRUNCATE absent and the required set present (Task 3, 0257 pattern). The 2b request table does the same. |

## Review response map (r3 — Astra round 2)

| Finding | Resolution |
|---|---|
| 2a r2#1 prep "each" mixes two packs | `loadDerivedForItems` / `hydrateSkuInfo` take content AND units per pack from ONE selected pack (`unitsPerPackForScope`, Task 2). The prep conversion moves to `lib/production-units-shared.ts`; the test persists 1 each = 160 oz for a shop 4 × 10 lb case (Task 5). |
| 2a r2#2 stale flat-field payload | Below MoO, `updateSku` strips every protected pack field equal to what it read (it can never restore a MoO's concurrent change); a changed one must have been empty, compare-and-set on NULL (Task 10). |
| 2a r2#3 ezCater orders | The actual-order loop resolves through `datedGraphFor(locationId, order.event_date)`, pinned (Task 5). |
| 2a r2#4 first invoice | `record_receiving_prices` opens the shop's first lane under the SKU lock — never a global write — with a real-SQL check for the first invoice and the invoice after back-to-default (Tasks 3, 6). |
| 2a r2#5 window interval erased | 0260 re-dates the whole global timeline across versioned AND healed rows, asserts no overlap, and is proven by the A → B → C SQL sequence check (Task 4). |
| 2a r2#6 / 2b r2#6 mirror race | `sku_flat_mirror_apply` inside `save_sku_pack_version`'s locked transaction; every post-RPC sync is deleted, the legacy writer included (Tasks 3, 9, 10). |
| 2a r2#7 `sku_class` | `updateSku`'s select keeps `sku_class` and types it (Task 10). |
| 2a r2#8 affected dates | The pre-flight lists every affected T-3 business DATE per SKU with all later boundaries (Task 14). |
| 2b r2#4 back-to-default resurrects | Monotonic `sku_pack_epochs` (trigger), `auto_*_pack_epoch`; G → S → G tested (Tasks 3, 12). |
| 2b r2#5 pre-chain history | `sku_pack_versions_flat_baseline` records the flat pack before a first global chain; as-of resolves to it, tested (Tasks 2, 3, 5). |

## Review response map (r4 — Astra round 3)

| Finding | Resolution |
|---|---|
| 2a r3#1 first global value of a foreign shop's SKU | `skuOwnerAllowed` (pure, Task 2) + an owning-shop bind in `saveSkuPrice` / `preparePackVersionWrite` (Task 9) and in the legacy `recordSkuPrice` / `replaceSkuPackChain` (Task 10). A shared SKU follows the first-value rule; MoO+ any. Foreign-shop refusal tested for price AND pack. |
| Round 4: the costing export | The export carries the page's scope: `ExportLinks` gets `?location=`; `report-export` binds it exactly as the page does (another shop → 403) and loads that shop's board; the CSV's first line (and the PDF header) names "Prices: {shop}" / "Prices: global (all shops)"; the download control is labelled (en + es). Tested (Task 6b Step 3b). |
| 2a r3#2 costing board ignores shop prices | The lead's decision: the board gets a shop switcher defaulting through `resolveShopId`. The selected shop drives BOTH the graph/pack loaders and the price resolver; "All shops" is labelled as global prices. Scope pass-through tested (Task 6b). |
| 2b r3#1 an unknown pre-chain pack | The baseline trigger records an ALL-NULL flat pack too; null → chain tested (Tasks 3, 5). |
| Remark: prep save not exercised | The prep-each test now persists through `recordProductionFromPrep` and asserts the saved 160 oz (Task 5). |

## Open questions (new in r2)

1. **D1 scope.** Only PACKS are dated. Recipes and product resolution in a rebuilt past day stay current, as the shipped "current-recipe estimate" Toast law says. Dating recipes would be its own arc.
2. **Repair-window correction.** A GLOBAL chain changed inside the T-3 repair window now re-resolves those days through the pack in force that day, so their depletion moves to the corrected value on the next repair. That is deliberate and reported in the pre-flight (Task 14 Step 1).
3. **Unchained flat edits.** On an unchained SKU (no chain, flat fields only), a MoO's flat-field edit is not a version. D3 cannot see it, so an auto par computed before such an edit stands, which is today's behaviour. The fix is to give every SKU a chain, out of scope here.
4. **`avg_oz_per_each`** (the each weight) stays editable at its existing floor. It is weight evidence, not a pack, and is not gated by D5.

---

## Self-review against the spec (2a's share)

| Spec requirement | Where |
|---|---|
| §3 shop versions for SKU pack chain and price; `location_id NULL = global`; `based_on` recorded | Task 3 (0259 tables, `based_on_version_id`, `based_on_price_id`) |
| §3 resolution at the single resolver points, never a second time in a consumer | Tasks 2, 5, 6, 7 (routing table, the PO's private copy removed, readiness routed, production and surplus routed) |
| §3 "past counts, receipts and sales are never re-resolved" | D1: effective-dated versions, dated depletion graphs (Tasks 3, 5); receipts, counts and productions store ounces |
| §3 the precondition equivalence pin (fixture matrix + prod-shaped snapshot) | Task 1 (golden incl. flat content and dated menu oz; matrix; read-only snapshot), kept green by every later task |
| §3 back to default (retired, never deleted); history append-only and audited | Task 3 RPCs (`valid_to`); Task 9 (`sku.pack_version_retire`, `sku.price_lane_retire`) |
| §2 AGM/GM write their own shop only, lib bind; MoO+ any shop and global | Tasks 2, 9 (gates before I/O, D2 allowance, differential bind test); Task 10 (existing writers) |
| §2 GM/AGM may set a FIRST global value only | Task 3 (`p_first_only` under the lock); Tasks 9, 10 |
| §4 Tier E step-up for these edits | Task 11 |
| §8 resolver tests (shop beats global; retired falls back) and permission tests (bind holds when the route is bypassed) | Tasks 8, 9, 10 |
| §9 Dynamic Pars × pack version | Task 12 (D3, pinned, parity-tested) |
| Database hardening (deny-all RLS, privilege ceiling) | Task 3 |
| Restore from History | Task 9 `restoreSkuPackVersion` + route (UI in 2b) |
| Sourcing per shop surfaced on the item page | 2b (no new model needed: `product_primaries`, `location_sku_settings`) |
| Item page, preview, jobs, receiving-door request, i18n | 2b |

**Placeholder scan:** every step names exact files, exact replaced text, and complete new code. The only conditional instructions are explicit fallbacks with a command that decides them: a test file that may not exist; a lint-reported unused import.

**Type consistency:**
- `VersionScope`, `ResolvedPack.versionId`, `ScopedVersionRow.valid_from/valid_to`, `PreparedPackWrite`, `ParWriteColumnsInput.packEpoch`, `FlatPackSnapshot` and `unitsPerPackForScope` are each defined once (Tasks 2, 9, 12) and used with the same names throughout.
- `loadSkuPackChains(ids, scope, asOf?)` is the signature everywhere after Task 5.
- The RPC parameter names match the 0259 SQL: `p_sku, p_location, p_levels, p_expected_live, p_based_on, p_note, p_actor, p_first_only`; `p_unit_price, p_effective_date`; `p_rows`.
