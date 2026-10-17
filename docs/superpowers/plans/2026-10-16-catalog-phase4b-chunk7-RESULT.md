# Catalog Phase 4b — Part A corrections and chunk 7

Branch: `feat/catalog-phase4b-job-pages`, baseline/HEAD `db8f26676280ef8ad43b7fa78eb37ce4631c6166`. Worktree: `C:\Users\conta\co-ops-cat-p4b`. Changes remain UNCOMMITTED. No push, merge, deployment, database mutation, migration or equivalence-pin edit.

## Delivered

Part A: SKU Share accepts its real `{ shared: true }` response, displays success and refreshes. Success interactions exercise SKU, recipe and menu response shapes. The barcode minimum-length refusal has its own English/Spanish message. Swap offers optional English/Spanish names only when the preview creates a product, defaults to the original SKU name, invalidates confirmation on edits and clears naming state when the replacement changes. The existing parser/engine already support these fields; no engine/SQL change or P3-2 deviation was needed. Chunk 5's handoff now correctly says 14 post-create assertion statements per language.

Part B: GM+ hub cards open New item/New sandwich through the existing authorized remembered-shop resolver. Costing has a role-gated “+ New sandwich”; the recipe list has scoped New recipe/New sandwich links. A GM on a default list omits global creation scope and enters the authorized shop flow; MoO+ retains explicit global. Existing legacy SKU shop selectors and recipe Only at/Share surfaces are preserved and exercised by the focused suites.

Costing SKU problems open the exact item, selected shop and price job. Prep problems retain their exact registry-item anchor and selected shop. Catalog SKU edges open the item page at the catalog's authorized scope. Product registry links retain their existing item-specific expansion/anchor.

Order-guide placed and unplaced SKUs use the existing translated Only at label. Initial server render and GET reload use the same bounded shop-name loader, including retired shop names; absent metadata produces no invented label or raw UUID. Complete guide saves still include every shop's lines. The compatibility `ownership` map remains alongside `onlyAt`.

The manager guide now explains all jobs in English and Spanish (tú): separate vendor/item/setup/Toast saves; replay versus reconciliation; partial/unconfirmed setup; Share; and restored versus retained Back edits. AGENTS and disclosure doctrine describe implemented behavior without claiming a live sim walk. Existing 0264/0265/0266 applied-header provenance and “correlation only, never replay” wording remain intact.

## Files by part

Part A:

- `components/catalog/ShareWithEveryShop.tsx`
- `components/catalog/jobs/SwapVendorJob.tsx`
- `lib/catalog/jobs-shared.ts`
- `lib/i18n/en.json`, `lib/i18n/es.json`
- `tests/catalog-share-back-interaction.test.ts`
- `tests/catalog-jobs-shared.test.ts`
- `tests/catalog-item-i18n.test.ts`
- `tests/catalog-swap-job-client.test.ts`
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk5-RESULT.md`

Part B:

- `lib/admin/sections.ts`
- `app/admin/items/page.tsx`
- `app/admin/menu-costing/page.tsx`
- `app/admin/recipes/page.tsx`
- `components/admin/catalog/CatalogClient.tsx`
- `components/admin/menu-costing/MenuCostingClient.tsx`
- `components/admin/recipes/RecipesClient.tsx`
- `lib/order-guides.ts`
- `app/admin/vendors/[id]/page.tsx`
- `app/api/admin/vendors/[id]/order-guide/route.ts`
- `components/admin/vendors/OrderGuidePanel.tsx`
- `tests/catalog-entry-navigation.test.ts` (new)
- `tests/catalog-deep-links.test.ts`
- `tests/catalog-guide-shop-names.test.ts` (new)
- `tests/catalog-guide-ownership-interaction.test.ts` (new)
- `tests/catalog-guide-initial-page.test.ts` (new)
- `tests/order-guide-route.test.ts`
- `docs/guides/manager-guide.md`
- `AGENTS.md`
- `docs/DISCLOSURE_DOCTRINE.md`

Task records: `2026-10-16-catalog-phase4b-chunk7-WORKPLAN.md` and this RESULT, both under `docs/superpowers/plans/`.

## Every changed assertion

No assertion present at the baseline was removed or weakened. Changed baseline expectations are the order-guide GET response's additive `onlyAt: {}` field and three deep-link expressions updated to require the new scoped destinations. All four equivalence files remain untouched.

Part A additions:

1. `catalog-share-back-interaction`: three success cases (SKU/recipe/menu); each asserts translated success status, no alert, and one router refresh (nine evaluated assertions). The harness accepts a kind parameter; existing request/refusal/cancel/Back assertions are unchanged.
2. `catalog-jobs-shared`: `invalid_barcode` maps to `catalog.error.invalid_barcode` (one assertion).
3. `catalog-item-i18n`: REQUIRED adds exactly `catalog.error.invalid_barcode`, `catalog.jobs.swap.product_name`, and `catalog.jobs.swap.product_name_es`. Existing nonempty, placeholder, no-stray and duplicate-key assertions now cover them; none changed.
4. `catalog-swap-job-client`: original default name is visible; name edit removes confirmation; next preview submits both edited names; an existing-product preview offers no naming field (four assertion statements).

Part B additions/changes:

5. `catalog-entry-navigation` (28 tests, 55 evaluated expectations): hub jobs present for GM/MoO, absent for AGM/SMM including elevated supplied SMM level (five); scoped production-recipe href, sandwich href, wrapping and 44px anchors for GM shop/MoO global/GM unspecified in en/es (24); exact costing SKU price href and absence of legacy list href in en/es (four); elevated SMM has neither creation link (two); actual expanded CatalogClient edge has exact item/shop href and no legacy list in en/es (four); actual async costing page shows GM shop/MoO global hrefs and hides the CTA for AGM/SMM in en/es (eight); permitted costing CTA has plus-prefixed translated label (four); inconsistent/unweighed prep warnings preserve exact item anchor and shop in en/es (four). Three source-string checks introduced during this task were replaced with these production-path tests before final validation.
6. `catalog-guide-shop-names` (four tests, seven assertions): map placed/unplaced/retired owners while omitting shared/legacy/missing owners; one read for a small batch; no read and empty map for shared/absent metadata; deduplicated 100/100/1 batches with 201 distinct owners; read failure throws rather than returning misleading empty metadata.
7. `catalog-guide-initial-page` (four tests, 12 evaluated assertions): real page and guide/name loaders project both shops' owner labels, both placed rows, exact unplaced bucket and correct edit gate for GM/AGM; missing metadata keeps both rows with empty onlyAt; key holder is redirected before client access. This replaces three task-local source-string checks.
8. `catalog-guide-ownership-interaction` (six tests, 23 evaluated assertions): en/es render all three initial owner labels (six); absent metadata omits labels and retains bucket/all three rows (three); en/es placement/save sends all three SKU IDs, preserves expectedUpdatedAt, reloads the unscoped full-guide URL and displays all three fresh labels (12); read-only view retains label and exposes no write controls (two).
9. `order-guide-route`: existing exact KH GET body gains `onlyAt: {}`; one new test asserts both owner labels, unchanged complete guide, unscoped guide-loader arguments and both already-loaded SKU rows passed to the label loader (four added assertions).
10. `catalog-deep-links`: three existing assertions now require the catalog's `skuItemHref(r.id, { shopId: shopScope })`, costing's `skuItemHref(id, { shopId: scope, job: "price" })`, and the scoped prep callback `id => prepItemHref(id, scope ?? undefined)`. The old expectations required legacy SKU-list helpers or a scope-dropping prep callback. Other assertions remain unchanged; actual rendered destinations are additionally covered in entry-navigation.

## Failing-first evidence

- Part A red run reproduced the SKU success failure, barcode generic fallback, missing translations and missing product-name input. It reported six failed / 30 passed tests, including a duplicate newly added barcode test subsequently deduplicated. Green before deduplication: 44/44 across five files; final aggregate covers the deduplicated suite. Recipe/menu real success controls already passed on the old acknowledgement logic.
- Entry first run: 10 failed / three passed before implementation. Follow-up exact prep-scope tests: four failed / 24 passed before the scope correction. Final local entry/navigation/SKU-selector run: five files / 89 passed.
- Guide first run: nine failed / one passed; one failure also identified an incorrect flat-key lookup in the new test harness, corrected before green. Final local guide run after real-page coverage and bilingual reload coverage: six files / 38 passed. Full-guide/save assertions were not relaxed.
- First typecheck: Next typegen passed; tsc reported two `noUncheckedIndexedAccess` errors in guarded guide-label lookup expressions. Corrected the guarded expressions and reran verification.
- First aggregate focused run: 1,595 passed / two failed tests. Both failures were the old source-string destination expectations in `catalog-deep-links`; inspection found its third old prep callback expectation in the same failing test. Updated all three to require the intended scoped destination, without editing any equivalence pin.
- First changed-file lint found six new test-harness `react/no-children-prop` errors and four pre-existing CatalogClient hook errors. Corrected all six test errors; an exact HEAD-source ESLint comparison confirms the same four CatalogClient diagnostics at baseline.
- File readback caught two newly added Spanish accents damaged by shell input encoding; corrected through Unicode-safe patching before final validation.
- First full run: 748 files; 12,406 passed / five failed / three pending. Three failures were guide shape/reading-level regressions: the new section preceded Start here, used the wrong Spanish heading convention, and English scored grade 7.1 after the heading fix. Moved the section after Night and before Manager tools, used `### En español`, and rewrote the English in plain short sentences. The initial 13 guide checks passed unchanged. A second full run exposed the scheduling section-boundary assumption; the final placement preserves it. A subsequent guide-only run caught CRLF conversion, corrected by restoring LF without changing assertions. All 18 guide-related files / 169 tests now pass unchanged. The remaining two failures were the tsx startup cases below. Full suite rerun uses the same flags; original report preserved as `.tmp/chunk7-full-initial.json`.

## Verification

Machine-readable evidence is under ignored `.tmp/chunk7-*`; no temporary viewport test remains in `tests/`.

```text
npx.cmd vitest run tests/catalog- tests/swap tests/share.test.ts tests/sku-swaps tests/order-guide tests/shop-owned-guide-scope.test.ts tests/sku-creation-scope-ui.test.ts tests/shop-context.test.ts tests/step-up-tier-map.test.ts tests/shop-owned-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000 --reporter=json --outputFile=.tmp/chunk7-focused-final.json
PASS: 75 files / 1,597 tests; exit 0.
Inventory (catalog-write-origin): 170; read-boundary: 8; shop-context: 146; tier-map: 13.
Unchanged equivalence pins: counts/onhand 48; recipe versions 8; shop-owned 27; shop versions 10.

npx.cmd vitest run guide --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
PASS: 18 files / 169 tests; exit 0. Existing reading-level, bilingual/shift-order and scheduling assertions unchanged.

npx.cmd next typegen
PASS: generated route types; exit 0.
npx.cmd tsc --noEmit --incremental false
PASS: exit 0, no diagnostics after correcting the two guarded lookups.

npx.cmd eslint --format json --output-file .tmp/chunk7-eslint-final.json -- <all 24 changed/new TS/TSX files>
EXIT 1: four errors, zero warnings, all in CatalogClient.
Exact HEAD-source baseline via ESLint --stdin --stdin-filename components/admin/catalog/CatalogClient.tsx:
EXIT 1: same four errors (two react-hooks/immutability, two react-hooks/refs), zero warnings.
Required diagnostic delta = 0. No new diagnostics; no suppression added.

git diff --check
PASS: exit 0 (line-ending notices only).
git diff --exit-code -- supabase/migrations tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts
PASS: exit 0; migrations and equivalence files unchanged.
```

```text
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000 --reporter=json --outputFile=.tmp/chunk7-full-final.json
EXIT 1: 748 files; 12,409 passed / two failed / three pending (12,414 total).
Only failures: the two known tsx ENOMEM startup cases listed below.
```

The full suite is not green. All other tests passed; no assertion was relaxed to exclude the startup failures. Final report: `.tmp/chunk7-full-final.json`. The second run (12,408 passed / three failed / three pending, before the final guide placement/line-ending correction) is preserved as `.tmp/chunk7-full-second.json`.

## Known tsx ENOMEM spawns (separate)

The two pre-existing no-database startup tests fail before either script reaches its own missing-credentials check:

- `tests/people-chunkE-review.test.ts`: `scripts/check-boh-positions.ts`.
- `tests/pm-criteria.test.ts`: `scripts/seed-pm-criteria.ts`.

Directly reproduced both with `node node_modules/tsx/dist/cli.mjs <script>`, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` explicitly blank in the child environment. Both exit 1 during tsx startup. No credentials read or database used. Full evidence: `.tmp/chunk7-tsx-startup.json`.

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
at Object.userInfo (node:os:305:11)
at node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs:1:84
errno: -4057; syscall: uv_os_get_passwd; Node.js v22.20.0
```

These failures are not suppressed, rebaselined or counted as passes.

## 375 px evidence

`npx.cmd vitest run tests/chunk7-viewport-temporary.test.ts --pool=threads --maxWorkers=1` exported fixtures (one passed); the temporary test was then removed. Guide fixtures used an isolated temporary configuration: `npx.cmd vitest run --config .tmp/chunk7-guide-vitest.config.ts .tmp/chunk7-guide-viewport.test.ts --pool=threads --maxWorkers=1` (one passed). `node .tmp/chunk7-viewport.cjs` exited zero. Real components and TranslationProvider, compiled `app/globals.css`, installed Playwright Chromium, 375×812 viewport, English and Spanish: Swap optional-name state, GM recipe entry links, and the editable guide with long placed/unplaced names and Only at labels, six fixtures total. All six measured `scrollWidth === 375`; every measured input/select/button/link was at least 44px high. The original-name default is visible in both swap fixtures. Screenshots and exact measurements: `.tmp/chunk7-viewport/*-375.png`, `.tmp/chunk7-viewport/metrics.json`; harness/notes remain under `.tmp`.

Limits: isolated SSR fixtures; swap naming state is injected. This proves measured layout for those fixtures, not hydration, authenticated navigation, live APIs, database writes, full admin shell, Toast or costing CTA layout. Live sim walks remain chunk 8 evidence. No photo retakes.

## Review and open risks

Integration checks applied BC-001/004 (scope and bidirectional role gates), BC-006/010 (bounded ownership reads), BC-013 (kind-specific success shape), BC-018/019 (translation inventory/docs), BC-030/041 (real page paths and persona cases), BC-032 (failed reads), and BC-043 (self-verification is not independent approval). These are implementation checks, not CC's cross-family approval. CC/Aggie's independent review remains required before merge.

Explicit deferred follow-ups remain: durable sandwich request replay; vendor/item-number uniqueness beyond cooperating jobs; Catering Toast-tab retirement (lead decision 6); sibling admin-family same-origin hardening. The current Toast tab is preserved. New-item client attempt identity still does not survive reopening. No further job feature is declared deferred here.
