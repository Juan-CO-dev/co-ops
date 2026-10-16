# Catalog Phase 4a chunk 4 handoff

Base/HEAD: `bb82512d`; branch `feat/catalog-p4a`; worktree `C:\Users\conta\co-ops-astra-p4`. 90 changed/new paths (including this handoff and work log). ALL changes are uncommitted and unstaged. Nothing fetched, pushed, merged, deployed or applied to a real database.

## Change set 1: chunk-3 review fixes

Captured before chunk-4 implementation at `C:\Users\conta\AppData\Local\Temp\catalog-p4a-chunk3-review-fixes.patch` (61,350 bytes). This is the separate review-fix checkpoint; the final working tree contains both change sets. The final i18n allowlist assertion additionally registers the owner-label key.

- P2-1: `onlyAtShopName` in catalog/costing DTOs, owner NAME attribution in org catalog, All-shops menu costing, recipes and weights; en/es `catalog.only_at_shop`. Existing SKU/guide name labels retained. Files: `lib/admin/catalog{,-shared}.ts`, `lib/admin/menu-costing.ts`, `lib/menu-costing-shared.ts`, `lib/weights.ts`, corresponding catalog/menu-costing/recipes/weights clients.
- P2-2: `lib/admin/readiness-scope-shared.ts`, `readiness-load.ts`, hub and SKU page now attribute not-ready SKUs by scope, including synthetic owned SKU coverage. SKU readiness navigation resolves explicit shop scope.
- P3-1: SQL equivalence gate pins all 28 expected enabled table/trigger pairs.
- P3-2: RecipeBuilder fieldset retains original width/margin classes plus `min-w-0 border-0 p-0`, pinned by rendered-markup test. Browser 375 px check remains for lead.
- P3-3: replaced all four operational-consumer source assertions with observable mock-client behavior (product members, par universes, walker indexes, barcode binding). The separate recipe-builder page navigation source pin remains as a wiring assertion; it is not claimed as browser navigation coverage.
- P3-4: quote validation rejects every owned item/menu item with `catering_owned_item_refused` (catalog retains `owned_not_catering`), with en/es; batch-prep producer discovery filters ownership before loading outputs of visible producers.
- P3-5: org-wide views perform a full graph and sometimes price load per distinct owning shop, bounded by eight shops. Latency is unmeasured. Preserve this note in the release packet.

## Change set 2: five approved chunk-4 tasks

1. SKU, recipe, full-recipe and menu creation preserve explicit scope. Omitted scope infers only one membership; global creation requires MoO+. SKU update/deactivate, price-basis and menu-price writes bind the observed owner null-safely and refuse zero affected rows. Create-time ownership; share-to-global is the only transition; a MoO move path is a 4b/5 candidate. Menu price permits the owning GM, preserves shared MoO and Tier E. Main files: `lib/admin/skus.ts`, `lib/catalog/sku-item.ts`, `lib/admin/menu-prices.ts`, `lib/recipes.ts`, corresponding API routes and SKU UI.
2. Registry creation and shop loading are explicit; owned prep definitions cannot become defaults or propagate globally. Authorized scope choices and en/es flow through the items page/form/client. Successful creation navigates to that shop registry. Main files: `lib/admin/templates.ts`, `lib/admin/items.ts`, `lib/admin/product-item-links{,-shared}.ts`, registry routes and items components.
3. Registry definition edits authorize owner and bind UPDATE to that owner before propagation. ItemRow definition capability is separate from default-management controls. Registry Tier B is unchanged.
4. Owned recipe header/input/output/yield/batch paths authorize owner. `write_owned_recipe` in file-only migration 0264 holds the graph lock, checks expected owner and edge identity, dispatches existing writers, and rechecks graph ownership. Service-role execution only. Owned default version writes also bind expected owner. Shared global input edits remain MoO-only; route mappings preserve named/positional refusals. Main files: `lib/recipes.ts`, `lib/admin/recipe-versions.ts`, recipe routes, `supabase/migrations/0264_catalog_shop_owned.sql`.
5. Legacy recipe pages use scoped data. RecipeBuilder offers authorized scope and atomic inline prep-item creation when no eligible output exists. Shared prep remains an ingredient, not an owned output. Add-menu-output passes the recipe owner explicitly. Existing post-create destination remains. Main files: legacy recipe pages, `lib/admin/recipe-builder-data.ts`, `lib/recipes-shared.ts`, RecipeBuilder and full route.

New tests: `catalog-job-routes`, `recipe-builder-markup`, `shop-owned-catering-batch`, `shop-owned-full-route-pglite`, `shop-owned-menu-price`, `shop-owned-recipe-mutations-pglite`, `shop-owned-recipe-writes`, `shop-owned-registry`, `shop-owned-registry-ui`, `shop-owned-sku-writers`, `sku-creation-scope-ui`, `sku-readiness-page-scope` (all under `tests/`, `.test.ts`). Existing affected contract/permission/consumer suites updated. Frozen golden JSON is unchanged.

## Verification

TDD evidence: owner labels/readiness, writer scope/races, registry routes and markup were observed failing before implementation. Recipe mutation and HTTP-to-PGlite suites exercise actual persisted successes/refusals, not blanket exception acceptance. The full-route test creates inline output through the real RPC, reads identities, edits inputs/header/yield, and resolves owner-shop cost ($0.75) and readiness through production loaders; fixture readiness correctly reports its missing purchasing setup instead of claiming readiness.

- `node scripts/sql-harness-0262.mjs`: PASS, exit 0.
- `node scripts/sql-harness-0263.mjs`: PASS, exit 0.
- Six 0264/PGlite suites (`shop-owned-migration`, `shop-owned-pglite`, `shop-owned-review-pglite`, `shop-owned-sql-equivalence`, `shop-owned-recipe-mutations-pglite`, `shop-owned-full-route-pglite`): 46 passed, exit 0.
- Touched writer suites: 101 passed; UI/route group: 57 passed; final contract corrections: 228 passed. These overlap the full suite and are not additive.
- First full run: 6 failed, 10,004 passed, 3 skipped. Failures were stale source-contract assertions for owner-aware price/RPC dispatch and recognized location bind helpers, the new i18n key allowlist, and the now-populated positional error display name. Corrected without changing goldens or skipping failures. The subsequent report passed all tests, but the PowerShell command returned 1 despite the passing report and included expected test stderr; an additional identical run explicitly captured `VITEST_NATIVE_EXIT=0` (213.79 s), with the same passing counts.
- `npx vitest run --pool=threads --no-cache --maxWorkers=3` (default + JSON reporters): PASS, 647 files passed / 1 skipped; 10,010 tests passed / 3 skipped / ZERO failures, exit 0.
- `npx tsc --noEmit --incremental false`: zero new diagnostics; 6 pre-existing leaflet errors in a clean checkout (exit 2), independently reproduced by Aggie.
- `git diff --check`: clean (Git emits CRLF normalization notices).

Logs: `%TEMP%/catalog-p4a-chunk4-final.log`, `.json`; `%TEMP%/p4a-chunk4-tsc-final.log`; `%TEMP%/p4a-chunk4-sql0262.log`, `p4a-chunk4-sql0263.log`, `p4a-chunk4-0264.log`.

## Deviations and remaining review

0264 gains an owner-bound dispatch wrapper rather than modifying legacy SQL writers: it preserves existing validation/journal semantics while closing share-between-check-and-write races. Test coverage is split into focused writer/UI/PGlite suites rather than a new monolithic permissions suite; existing `shop-owned-permissions` remains in the full run. No migration was applied outside PGlite.

3b catalog-page editing, guided jobs, changed post-create redirects and both-page reopen acceptance remain 4b. Deferred chunk-3 P3-b/P3-g remain unchanged. No browser smoke or real-session concurrency claim; those remain lead/Chunk 8 verification. Cross-family final review and approval remain CC's responsibility; no review message was sent externally.

## Chunk-4 review corrections before Chunk 5

Owned-recipe authorization is lib-side by design; the service-role-only wrapper binds expected ownership and graph integrity. Malformed payload casts now raise `shop_owned:invalid_payload`. Migration 0264 remains file-only. SKU creation ownership is immutable except MoO+ share-to-global; the legacy editor shows the owner plainly and offers sharing. Org-wide SKU rows disclose their owning shop; explicit shop lists include shared plus own rows.
