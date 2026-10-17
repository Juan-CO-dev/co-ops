# Catalog Phase 4b chunk 6 RESULT

Baseline HEAD: `27874144`. Branch: `feat/catalog-phase4b-job-pages`.
Worktree: `C:\Users\conta\co-ops-cat-p4b`.
Changes are UNCOMMITTED. No push, merge, deployment, production access or migration.

## Delivered

Part A fixes all five supplied P3s. Reconciliation tests invoke production normalization and exact-name matching; the tier extractor test is load-bearing and mutation-probed. An explicit owner takes precedence over remembered-shop defaulting and is validated first. Chunk 4 RESULT records Aggie's corrected totals and labels the historical tsx cases host-flaky. Toast documents its keyed-remount teardown invariant.

Part B reopens owned recipes and sandwiches through their catalog pages. The server projects ownership and capabilities separately. Owned recipe versions write at null scope while graph, price, picker and readiness reads remain at the owner shop. Owned preview targets carry the owner; apply and the existing writer refuse a changed owner. Foreign/SMM access and shared-default GM restrictions remain tested. Owned ingredient refusals preserve position/name/reason. Shared 3b version/history/notice/provenance and menu-token paths retain their existing assertions.

Owned recipe pages compose the existing RecipeBuilder and Share component, preserving ownership selection and inline output creation. Successful legacy creation opens the returned catalog recipe at the committed scope; failed saves retain the draft. Legacy and catalog links preserve shop context, and ownership changes remount the body. Existing catalog pages remain registered in shop-context; no new page or resolver was introduced.

Owned sandwiches expose their own price, recipe link, owner-shop cost, Toast and Share. Price previews bind immutable owner and captured price, and the existing price writer checks owner again. Refusal/cancellation retains drafts; changed committed prices require explicit rebase; late responses cannot update a departed body.

The existing output UI could not change a batch recipe's sole output yield: remove/re-add is forbidden by the existing SQL. Chunk 6 therefore adds an explicit owned-batch yield edit to RecipeOutputRow and PATCH to the existing recipe outputs route. It uses Tier E, same-origin first, captured owner and the existing `write_owned_recipe` / `update_recipe_output_yield` writer. The nudge's Tier B path and telemetry remain unchanged. There is no new SQL or shared-recipe editing rule. Named yield refusals, edit label and menu-price refusals have bilingual copy.

## Part A files

- `lib/admin/recipe-builder-data.ts`
- `components/catalog/ToastLinkSection.tsx`
- `tests/new-sandwich-reconcile.test.ts`
- `tests/catalog-jobs-views.test.ts`
- `tests/step-up-tier-map.test.ts` (also Part B)
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk4-RESULT.md`

## Part B files

- `app/admin/catalog/recipe/[id]/page.tsx`
- `app/admin/catalog/menu-item/[id]/page.tsx`
- `app/admin/recipes/[id]/page.tsx`
- `app/api/admin/recipes/[id]/outputs/route.ts`
- `components/admin/recipes/RecipeBuilder.tsx`
- `components/admin/recipes/RecipeOutputRow.tsx`
- `components/admin/recipes/shared.ts`
- `components/catalog/RecipeItemClient.tsx`
- `components/catalog/OwnedSandwichClient.tsx`
- `lib/admin/recipe-versions.ts`
- `lib/admin/menu-prices.ts`
- `lib/catalog/recipe-item.ts`
- `lib/catalog/menu-item-page.ts`
- `lib/catalog/recipe-item-shared.ts`
- `lib/catalog/recipe-preview-shared.ts`
- `lib/recipes.ts`
- `lib/i18n/en.json`, `lib/i18n/es.json`
- `tests/catalog-recipe-server.test.ts`
- `tests/catalog-recipe-routes.test.ts`
- `tests/catalog-recipe-i18n.test.ts`
- `tests/catalog-item-i18n.test.ts`
- `tests/legacy-recipe-line-boundary.test.ts`
- `tests/catalog-owned-menu-page.test.ts`
- `tests/catalog-owned-menu-ui.test.ts`
- `tests/shop-owned-menu-price.test.ts`
- `tests/owned-recipe-reopen.test.ts`
- `tests/owned-recipe-yield.test.ts`
- `tests/recipe-builder-reopen-ui.test.ts`
- `tests/recipe-output-yield-ui.test.ts`
- Shared Part A/B: `tests/step-up-tier-map.test.ts`
- This RESULT, `2026-10-16-catalog-phase4b-chunk6-WORKPLAN.md` and `2026-10-16-catalog-phase4b-chunk6-menu-WORKPLAN.md`.

## Every changed assertion

Existing assertions changed:

1. `new-sandwich-reconcile`: removed the tautological normalization loop. Three production cases assert padded submitted names reconcile to the exact persisted name and lowercase alternatives return `name_taken`.
2. `step-up-tier-map`: replaced the always-nonempty object assertion with exact production `extract()` output for single/double/template-quoted A calls. The fixture injects paths/read content into the actual extractor. Part B adds exactly `OwnedSandwichClient: ["E"]` to the client map. No tier was removed or lowered.
3. `legacy-recipe-line-boundary`: the banner source pin now requires `recipeItemHref(recipe.id, { shopId: context.scope })` instead of the unscoped call. Runtime reopen tests also verify the exact scoped destination.
4. `catalog-item-i18n`: REQUIRED adds the two named menu-price messages, direct yield-edit label and ambiguous-output message. Existing presence/placeholder/no-stray assertions now cover these four keys; none was relaxed.

All remaining assertions are additions; existing shared 3b assertions and all four equivalence files/expected values are unchanged:

- `catalog-jobs-views`: explicit owner beats remembered shop; returned shops narrow to owner; global disabled; resolver not called. Foreign and inactive owners both return 404 without remembered-shop fallback.
- `catalog-recipe-server`: owner DTO, owner-shop read scope, owned edit/share capabilities, no shared edit/version actions, null/default head, own picker SKU included and foreign excluded, no other-shop versions/notices, MoO Share capability. Null/foreign read scopes and foreign actor return no owned view; SMM refuses. Owned preview reaches only owner, uses default head/no inherited baseline, applies through exactly one owner-bound RPC. Share between preview/apply refuses even for MoO with no RPC. Shared identity cannot masquerade as owned; foreign/SMM previews refuse; shop-version edits of owned identity refuse. Writer refuses a captured owned save after Share. Foreign ingredient preview carries position, name and reason.
- `catalog-recipe-routes`: owned restore target survives parsing through preview and apply; preview needs no step-up; apply uses E and exact token. Missing owner refuses before preview; ownership-change refusal remains HTTP 409 with its code.
- `catalog-owned-menu-page`: owner DTO and capabilities, owner-shop graph/price calls, no shared overlay/history capability; foreign/null scope and SMM denied. Owned preview sides/margins/scope; exact owner/price-bound save; Share between preview/save refuses with no mutation; foreign preview denied; stale price baseline refused; shared behavior stays covered by existing server tests.
- `shop-owned-menu-price`: captured-owner MoO write after Share returns `ownership_changed`, leaves price unchanged and writes nothing.
- `catalog-owned-menu-ui`: exact owner/price preview payload; exact preview token/change and E apply; cancellation sends no apply; refusal retains typed price and shows named alert; committed price change disables preview until explicit rebase; typed edit invalidates preview; late preview/apply after teardown ignored; only approved price/Toast/Share controls shown; recipe href carries owner scope.
- `owned-recipe-reopen`: both catalog/legacy routes produce the existing builder with owner location, owned outputs/SKUs/readiness; catalog and graph loaders receive owner scope; catalog owned path excludes shared client; legacy catalog href includes owner. Shared page retains 3b client and avoids owned builder loads. Server false capabilities disable editing/Share.
- `recipe-builder-reopen-ui`: empty owned-output inventory opens inline creation; adding draft output makes no standalone write; full save includes owner, trimmed/bilingual inline output and yield; navigation uses returned ID and committed shop. Failed save does not navigate and keeps name/output. Owning GM can edit inputs/output; shared GM inputs remain read-only; server capability can deny both. Direct yield callback uses E, exact PATCH owner/item/yield, refresh on success, no write on cancelled step-up; disclosure stays open while editing yield.
- `recipe-output-yield-ui`: in-place yield callback receives the typed number and closes after success; refusal retains typed yield and named alert; invalid zero never writes and reports invalid yield; read-only rows have no edit buttons.
- `owned-recipe-yield`: PATCH returns success, E enforced, exact guarded RPC owner/recipe/operation/output/yield, no direct table writes, audit source/location recorded. Cross-origin fails before session; stale edit window prevents RPC. Missing body fields/null owner/string yield/bad output ID refuse before RPC. Shared-after-edit MoO, foreign GM and SMM refuse. `not_batch_recipe`, `ambiguous_output`, `recipe_inactive` remain HTTP 409, do not audit and map to named messages.
- `catalog-recipe-i18n`: ownership/foreign-line/two price errors map to exact named keys present in en/es, with no usted. Existing key/placeholder checks remain.

## Failing-first and mutation evidence

- Part A owner precedence: 3 failing cases before fix. Tier mutation dropping `unlisted.tsx`: all 3 quote-style cases failed, 10 passed; mutation restored. Part A final: 4 files / 66 passed; lint clean.
- Owned recipe server: initial 5 failures / 35 passes; subsequent foreign-line preview test failed before ownership validation. Writer race test checks the lower writer separately.
- Owned menu: initial 5 failures before implementation; final server/writer and interaction runs passed.
- Reopen pages: 3/4 initially failed. Direct yield row: 3 failures before UI implementation. New yield endpoint/library: 7 failures before implementation. Named yield-message mapping: 3 failures before correction.
- Named catalog messages and new E registration: 5 failures before mapping/registration.

## Verification

Final frozen-tree outcomes follow. Raw logs and JSON reports are in `.tmp/catalog-chunk6/` and are not for staging.

Focused command uses `npx.cmd vitest run` with the suites in `focused.log` and `--pool=threads --no-cache --maxWorkers=3 --testTimeout=60000`: **27 files / 990 tests passed**. It includes inventory, read-boundary, shop-context, tier-map, four untouched equivalence suites and real local PGlite mutation/reopen proofs. PowerShell's stderr redirection reported shell exit 1 for expected fixture stderr despite Vitest's all-passed JSON; subsequent runs use cmd redirection to preserve native status.

After the final yield refusal mappings, focused yield/UI/i18n: **4 files / 264 tests passed**, exit 0 (`yield-final.log`).

Focused suites: `catalog-jobs-views`, `catalog-owned-menu-page`, `catalog-owned-menu-ui`, `catalog-read-boundary`, `catalog-recipe-i18n`, `catalog-recipe-line-reads`, `catalog-recipe-navigation`, `catalog-recipe-routes`, `catalog-recipe-server`, `catalog-recipe-ui`, `catalog-toast-link-interaction`, `catalog-write-origin`, `counts-onhand-equivalence`, `new-sandwich-reconcile`, `owned-recipe-reopen`, `owned-recipe-yield`, `recipe-builder-page-scope`, `recipe-builder-reopen-ui`, `recipe-versions-equivalence`, `shop-context`, `shop-owned-equivalence`, `shop-owned-full-route-pglite`, `shop-owned-menu-price`, `shop-owned-recipe-mutations-pglite`, `shop-versions-equivalence`, `step-up-tier-map`, `yield-stats-server` (all `tests/<name>.test.ts`). Inventory is exercised by read-boundary/write-origin/shop-context.

Final `npx.cmd next typegen` and `npx.cmd tsc --noEmit --incremental false` both passed, exit 0 (`tsc-final.log`).

Changed-file ESLint is evaluated with the same ESLint/config and each original absolute file path: baseline text from `git show HEAD:<file>`, working tree through `lintFiles`, new files baseline zero. Final command `node .tmp/catalog-chunk6/lint-delta.mjs`: **33 files, 0 errors / 15 warnings before and after, delta zero**, exit 0 (`lint-delta.json`).

`git diff --check` passed. Migration and equivalence-file diffs are empty.

Full requested command: `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000 --reporter=default --reporter=json --outputFile=.tmp/catalog-chunk6/full-suite-final.json`.

**Final full run: 741 passed / 2 failed / 1 skipped files (744); 12,360 passed / 2 failed / 3 skipped tests (12,365), exit 1, 360.39 seconds.** Both failures are the host startup cases below; no catalog/integration test failed.

Earlier full run: 738 passed / 5 failed / 1 skipped files; 12,355 passed / 7 failed / 3 skipped tests. Besides the two host failures, it caught the new i18n keys missing from the explicit inventory, the stale unscoped legacy-link pin, and three named yield-mapping tests while their fix was in flight. These were fixed, then confirmed by the 264-test focused run, the 37-test integration run (`integration-fixes.log`, exit 0), and the frozen final full run above.

### Known tsx ENOMEM spawns (separate)

Both **failed in the final full run**, before their target scripts started:

- `tests/people-chunkE-review.test.ts:130`: BOH dry run, tsx temporary-directory initialization, `uv_os_get_passwd`, `ENOMEM (-4057)`.
- `tests/pm-criteria.test.ts:140`: criteria seed dry run, the same tsx startup failure.

These are the known host-flaky cases, counted as failures above, not passes. No database was accessed by either failed spawn.

### 375 px evidence

Real React initial markup, compiled app Tailwind, headless Chromium at **375x812**, English and Spanish. Six states: owned recipe, owned sandwich, open yield editor. All document/body widths are 375; recipe's 12 controls are 44 px; sandwich's four controls are 44 px and its wrapped recipe link 60 px; open-yield editor's three controls are 44 px. Spanish screenshots inspected. The inherited Directions target was increased from 20 to 44 px after measurement.

Commands: `npx.cmd vitest run --config .tmp/catalog-chunk6/browser.config.mjs --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000` (**2 files / 3 tests passed**); `node .tmp/catalog-chunk6/browser-smoke.mjs` (**exit 0**). Evidence: HTML, PNGs, scripts and `browser-results.json`. Network was blocked; intended Segoe UI fallback used. Open editor initial state was injected into the real renderer. This proves layout, not hydration or authenticated sim E2E.

## Review and remaining limits

Integration checked against relevant catalog classes: BC-001/004 owner binding and two-direction gates, BC-003 step-up coverage, BC-006/010 bounded added owner reads, BC-007 owner/price compare-and-set, BC-013 null write versus owner-shop visibility semantics, and BC-014 unchanged closed audit action shape. CC's independent cross-family review remains required before any commit/merge.

No sim/prod credentials or environment files were read. Authenticated sim walks remain BUILD chunk 8; this handoff makes no live-schema or browser-workflow claim. The broader 4b deferrals remain durable sandwich replay, broader vendor/item-number uniqueness and Catering Toast-tab retirement; sibling legacy admin same-origin coverage remains a separate follow-up. The new yield PATCH itself checks same origin.
