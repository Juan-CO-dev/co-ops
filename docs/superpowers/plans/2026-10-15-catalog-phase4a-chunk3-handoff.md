# Catalog Phase 4a — Chunk 3 handoff

Basis: approved `2026-10-15-catalog-phase4a-BUILD.md`, Chunk 3, and the lead's chunk-3 dispatch including Aggie r3. Worktree `C:\Users\conta\co-ops-astra-p4`, branch `feat/catalog-p4a`, starting HEAD `a59d4870`. All chunk-3 changes are uncommitted. No fetch, rebase, push, merge, deployment, or real database access.

## Delivery

The prerequisite landed before production reader edits: `seedOperationalBaseline` extends the in-memory real 0258–0263 chain with packs, prices, a shop recipe version, a menu overlay, and count events/lines. Pack/price/version/overlay rows use real RPCs; count definitions come directly from migration 0160. `persistedCatalogRows` reads persisted SQL rows into the existing PostgREST transport adapter. The equivalence test captures production composition before applying actual 0264 with triggers enabled, then compares serialized costing, depletion, ordering-pack, count-catalog/status and census-anchor outputs byte for byte. No frozen golden was regenerated. Non-vacuity assertions pin 16/32 oz packs, $8/$24 prices, 4/6 oz depletion and 32 oz count anchors.

Operational recipe ownership is projected through the existing graph and resolved-input boundaries, with all-scope impact reads remaining inclusive. Shared-data golden coverage remains in force. Readiness handles both ordinary and preloaded composition and the Wave 7 data panel. Organization-wide cost/audit views use the owner's graph and price scope for owned subjects.

The newly shipped 3b page loaders touched are `loadRecipeItemView` in `lib/catalog/recipe-item.ts` and `loadMenuItemPageView` in `lib/catalog/menu-item-page.ts`. Owned records are visible only in their owner's view. Legacy builder pages authorize their scope, reload scoped picker data on navigation, and key the builder by identity and scope. Output-item eligibility is separate from ingredient visibility. The existing raw default-line editor in `loadRecipe` remains the explicit AGENTS.md legacy-builder exception; operational readers use the common resolver.

SKU visibility is enforced in the common product index, walk/par/count rosters, nightly demand/skipped runs, historical suggestions, receiving validation and barcode operations. The global store-copy compatibility exception remains; it does not admit ordinary owned members. Guide editor data remains complete, while its shop read is scoped; authoritative reconciliation retains owner labels. Staff/portal catering pickers filter all reference lanes and omit hidden references instead of inventing fallback items.

Aggie r3 P3-1: corrected the stale chunk-2 footer to record committed `093f2d4a` and r3 acceptance. P3-2: actual PGlite INSERT and UPDATE tests prove `owned_not_catering`, rollback, and the shared-menu positive control.

## Deferred ledger — unchanged

- **P3-b:** direction-blind scan on items/SKUs — now narrowed, but the items/vendor_items “who cites this” sweep still keys off `r.active`, so deactivating a recipe is what removes the edge. Retained for the Chunk 4/7 or release packet; no migration change here.
- **P3-g:** release preflight counts remain CC-supplied read-only evidence from 2026-10-15, not measured by Astra: 0 global version lines citing an owned item/SKU; 0 shop version lines citing a foreign-shop item/SKU; 0 owned items with `is_default`; 0 owned items with `catering_available`. Retained for release re-check, with real-session contention still a CC gate.
- P3-f (DELETE no longer an event), the P3-d breadth caveat, and the item-level catering limitation remain as previously ruled. No new SQL enforcement is claimed.
- Owned editing capabilities, job engines, swaps, sharing UI and release gates remain their approved later chunks/4b scope. Existing SQL remains files only.

## Verification

- Full unfiltered suite: `npx vitest run --pool=threads --no-cache --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=<TEMP>/catalog-p4a-chunk3-final.json` exited 0: **635 files passed, 1 skipped; 9,922 tests passed, 3 skipped, ZERO failures** (445.54 seconds). All eight declared Chunk-3 reds pass. JSON report has `success: true` and `numFailedTests: 0`.
- `node scripts/sql-harness-0262.mjs` and `node scripts/sql-harness-0263.mjs`: both PASS, exit 0.
- `npx vitest run tests/shop-owned-migration.test.ts tests/shop-owned-pglite.test.ts tests/shop-owned-review-pglite.test.ts tests/shop-owned-sql-equivalence.test.ts --pool=threads --no-cache --maxWorkers=2`: 4 files, 41 tests PASS, exit 0.
- Touched suites passed throughout implementation, including recipe/readiness/preview, builder/page scope, guides, catering, products, barcode, weights and operational consumers. After the full run, the count-rejection fixture gained its required `partialFraction: null` field; `npx vitest run tests/shop-owned-operational-consumers.test.ts --pool=threads --no-cache --maxWorkers=2` then passed all 12 tests. No production code changed after the full run began.
- `npx tsc --noEmit --incremental false`: final run PASS, exit 0, zero diagnostics.
- `git diff --check`: PASS. HEAD remains `a59d4870`; staging area empty.

Logs and the JSON report are in the local TEMP directory, prefixed `catalog-p4a-chunk3-`; they are not repository artifacts.

## Deviations and limits

The initially requested unrestricted full-suite command was attempted, then stopped after host saturation; it produced no final totals. The successful full run adds only a two-worker resource cap and reporters, with no test filters. An intermediate typecheck found the missing test-fixture field above; it was corrected and rechecked.

Supporting enforcement also covers the count writer (reject before creating an event), Toast's manual consumption picker route, direct 3b previews, and owner-scoped weight costing. These close alternate entry points into the requested scoped consumers. The guide DTO carries an ownership map rather than a single display-label property. No migration or frozen golden changed.

No browser smoke or real-session contention test was performed. Server-page invocation and component source contracts cover scope navigation/remount wiring; interactive acceptance and CC's independent cross-family review remain release gates. Database verification was PGlite only, never SIM or PROD.

## Files

Exact changed/new paths follow; all are uncommitted.

- `app/admin/recipes/[id]/page.tsx`
- `app/admin/recipes/new/page.tsx`
- `app/admin/vendors/[id]/page.tsx`
- `app/api/admin/toast-sales/consumption/route.ts`
- `app/api/admin/vendors/[id]/order-guide/route.ts`
- `components/admin/recipes/RecipeBuilder.tsx`
- `components/admin/vendors/OrderGuidePanel.tsx`
- `docs/superpowers/plans/2026-10-15-catalog-phase4a-chunk2-handoff.md`
- `docs/superpowers/plans/2026-10-15-catalog-phase4a-chunk3-handoff.md`
- `lib/admin/catalog.ts`
- `lib/admin/menu-costing.ts`
- `lib/admin/readiness-load.ts`
- `lib/admin/recipe-builder-data.ts`
- `lib/admin/toast-map.ts`
- `lib/barcodes.ts`
- `lib/catalog/menu-item-page.ts`
- `lib/catalog/recipe-item.ts`
- `lib/catering/menu.ts`
- `lib/counts.ts`
- `lib/counts-read-refs.ts`
- `lib/dynamic-pars.ts`
- `lib/dynamic-pars-walker.ts`
- `lib/order-guides.ts`
- `lib/ordering.ts`
- `lib/portal/menu.ts`
- `lib/prep-consumption.ts`
- `lib/products.ts`
- `lib/receiving.ts`
- `lib/recipes.ts`
- `lib/recipes-shared.ts`
- `lib/shop-context-shared.ts`
- `lib/sku-data-readiness.ts`
- `lib/sku-data-readiness-load.ts`
- `lib/weights.ts`
- `tests/audit-1008-batch-location.test.ts`
- `tests/barcodes-db.test.ts`
- `tests/catalog-recipe-server.test.ts`
- `tests/fixtures/shop-owned-pglite.ts`
- `tests/order-guide-route.test.ts`
- `tests/recipe-builder-page-scope.test.ts`
- `tests/recipe-builder-scope.test.ts`
- `tests/shop-owned-catering-scope.test.ts`
- `tests/shop-owned-equivalence.test.ts`
- `tests/shop-owned-guide-scope.test.ts`
- `tests/shop-owned-operational-consumers.test.ts`
- `tests/shop-owned-review-pglite.test.ts`
- `tests/shop-owned-sql-equivalence.test.ts`
- `tests/shop-owned-toast-picker-route.test.ts`
- `tests/shop-owned-weights.test.ts`
- `tests/sku-data-readiness-shop-versions.test.ts`
