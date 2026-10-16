# Catalog 4b: review fixes and chunk 5 result

Base: `34500311`. Branch: `feat/catalog-phase4b-job-pages`. Worktree: `C:\Users\conta\co-ops-cat-p4b`. All changes are UNCOMMITTED. No push, merge, migration, production access, or equivalence-pin changes.

## Delivered

Part A: New item has a compact bilingual pre-Create summary, explicit created status, real post-create render coverage, global Open item routing, and a six-character barcode guard. The recipe/version read test compares 1 and 12 recipes at exactly 13 queries. Reset permits ordinary/no markers through its quarantine guard; malformed null/false evidence fails closed with a generic inspection message, not a false catalog-quarantine claim. Aliased loader imports remain audited. BUILD describes the actual form order.

The two requested lint repairs were already in base 34500311: vendor refresh uses the render-time condition and the read-boundary helper uses `moduleName`. Verified, not presented as new fixes.

Part B: Swap vendor reviews recipe-line changes/refusals, primary followers, untouched shops, grouping, sandwich costs and ordering/par consequences. Confirmation sends the normalized request returned by preview unchanged, plus its token. Edits, scope changes and stale results invalidate confirmation. Owned sources offer only their owning shop. Adding a replacement authorizes the source on the New item server page and returns to a fixed internal route with the created replacement.

Share supports SKU, recipe and menu preview contracts, explicit dependency review, owner/token binding, and links prep blockers to their producing recipe. Producing-recipe metadata reuses existing batched reads. The SKU jobs strip exposes only approved actions and live temporary-swap banners. Back renders the writer's actual restored/retained outcomes and reloads the scoped journal; uncertain writes require journal reload before another review. Recipe/menu page mounting remains BUILD chunk 6, as specified; the reusable Share component and its three contracts are delivered here.

## Files by part

Part A only:

- `scripts/sim/launch-readiness/reset.ts`
- `tests/catalog-cleanup-dirty.test.ts`
- `tests/catalog-jobs-views.test.ts`
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-BUILD.md`
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-partA-fixes-NOTES.md`

Shared A/B (deliberate integration):

- `components/catalog/jobs/NewItemJob.tsx`: A summary/setup fixes; B return context/link.
- `lib/i18n/en.json`, `lib/i18n/es.json`: A messages and B job messages.
- `tests/catalog-jobs-ui.test.ts`: A actual summary/setup render; B return link.
- `tests/shop-context.test.ts`: A alias recognition; B dynamic Swap registration.
- `tests/catalog-item-i18n.test.ts`: explicit names for all 62 added A/B translation keys.

Part B only:

- `app/admin/catalog/new/item/page.tsx`
- `app/admin/catalog/sku/[id]/page.tsx`
- `app/admin/catalog/sku/[id]/swap/page.tsx`
- `components/catalog/SkuItemClient.tsx`
- `components/catalog/jobs/SwapVendorJob.tsx`
- `components/catalog/ShareWithEveryShop.tsx`
- `components/catalog/ItemJobsStrip.tsx`
- `lib/catalog/swap-job-shared.ts`
- `lib/catalog/swap-return-shared.ts`
- `lib/catalog/share-back-shared.ts`
- `lib/catalog/share.ts`
- `lib/catalog/job-preview-shared.ts`
- `tests/catalog-job-pages.test.ts`
- `tests/catalog-swap-return.test.ts`
- `tests/catalog-swap-job.test.ts`
- `tests/catalog-swap-job-ui.test.ts`
- `tests/catalog-swap-job-client.test.ts`
- `tests/catalog-share-back-shared.test.ts`
- `tests/catalog-share-back-ui.test.ts`
- `tests/catalog-share-back-interaction.test.ts`
- `tests/catalog-job-preview.test.ts`
- `tests/share.test.ts`
- `tests/step-up-tier-map.test.ts`
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk5-SWAP-NOTES.md`

Task-wide records: `docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk5-WORKPLAN.md` and this RESULT.

## Changed assertions

No existing assertion was removed or weakened. Existing suites changed as follows:

1. `catalog-jobs-views`: four added assertion statements check projected recipe count, all first overrides' global baseline IDs, no writes, and exact query counts `[13,13]` for 1 vs 12 recipes.
2. `catalog-cleanup-dirty`: six added statements, parameterized over two cases each: no/ordinary marker reaches normal prerequisite validation and recording without a DB call; null/false yields the generic unreadable-marker refusal, unchanged marker bytes and zero side effects.
3. `catalog-jobs-ui`: four summary assertions per language (translated heading, seven fields, summary before Create); ten post-create assertions per language (created status, global link, five sections, each of five headings, 44px controls/labels, barcode minimum, one-column classes). Three B assertions verify exact scoped swap-return URL, created-item URL and translated return label.
4. `shop-context`: three alias-recognition assertions (aliased Item, normal Sandwich, unrelated import). Existing bidirectional audit now recognizes aliased/multiple named loader imports including Swap and includes the concrete dynamic Swap sample URL. No production literal `[id]` entry added.
5. `catalog-item-i18n`: explicit REQUIRED list adds exactly 62 new keys. Existing parity, nonempty, no-stray and duplicate-key assertions are unchanged.
6. `catalog-job-preview`: recipe blocker fixture now includes producer id/name/owner. The existing full DTO equality consequently requires those nested fields for both recipe and menu projections; unknown-field stripping assertions remain unchanged.
7. `share`: one added producer mapping assertion in the existing prep-blocker test requires the recipe identity/name/owner. Existing refusal and unchanged-owner assertions remain.
8. `step-up-tier-map`: whole-map expected value gains exactly three E clients: SwapVendorJob, ShareWithEveryShop, ItemJobsStrip. Existing exact-map comparisons remain.

All new suites are additive; their complete assertion contracts:

- `catalog-swap-return` (2 tests): accepts a single UUID only, rejects arrays/arbitrary URLs/absent context; exact original shop/global route with created replacement.
- `catalog-job-pages` (5): valid return context calls the source authorization loader and reaches the client; inaccessible source becomes notFound; invalid/absent context does not add reads; owned SKU global version view loads jobs in owner shop; inactive history remains readable with no active-job read.
- `catalog-swap-job` (5): exact normalized confirmation/token and identity; saved preview cleared; delayed/stale generations ignored; canceled/scope-invalidated unlock writes nothing; stale refusal requires new preview; refused lines cannot confirm; malformed success/transport loss is uncertain.
- `catalog-swap-job-ui` (8, en/es): all recipe/refusal/follower/shop/quantity/cost/grouping consequences; no raw keys; wrap-safe/single-column layout and 44px controls; global only permanent; Add item retains original identity/global scope; shop offers both modes without unauthorized global; owned source excludes other shops/global.
- `catalog-swap-job-client` (4): actual handlers post preview then exactly one E write with the returned request/token despite duplicate click; edit clears confirmation; delayed response after navigation cannot repopulate; stale step-up forgets authorization and does not retry; canceled password sends no write and preserves review.
- `catalog-share-back-shared` (6): exact owner/token/selected IDs, missing/foreign dependency rejection, fresh owner binding, required empty arrays and kind-specific fields, blocked sandwich/prep refusal, owner/global producer links, actual Back result validation and translated unchanged/changed/unknown outcomes, explicit menu output selection even though its writer derives those IDs.
- `catalog-share-back-ui` (8, en/es): dependencies/producer links, predicted versus actual retained Back outcomes, both sandwich names/menu price/producing recipes, read-only AGM banner without actions, translated labels and 44px targets.
- `catalog-share-back-interaction` (6): exact E share request after explicit selection; stale/ownership refusal clears preview; canceled step-up writes nothing; old-identity delayed preview ignored; Back submits token, renders actual retained result and reloads `shopId` journal; uncertain Back refuses another preview until reload.

## Failing-first evidence

- A: 6 failed / 54 passed before summary/post-create/malformed-marker fixes; then 205 passed. Injected per-row loader read and old restrictive alias regex each failed their focused probe, with original bytes restored. Probe output decoding failed, so only exit status/byte restoration are claimed. Detailed evidence is in Part A NOTES.
- Swap: missing-module reds before implementation; owned-source scope regression reproduced in both languages (2 failed / 6 passed), then 17 passed.
- Share/Back: initial 3 failed assertions plus missing-module reds; follow-up 4 failed / 16 passed for unchanged outcome, sandwich preview en/es, and uncertain Back reload guard; then 39 passed.
- Parent integration: server-page tests first caught missing return/helper and jobs integration, then the inactive-history regression; all 7 page/return tests passed after fixes.
- Combined first pass: 1,453 passed / 2 failed exposed missing explicit translation inventory and missing NewItem return-prop plumbing. Both fixed; corrected combined run passes 1,455. The first typecheck caught the same missing prop. No assertions were relaxed.

## Final verification

```text
npx.cmd vitest run tests/catalog- tests/swap tests/share.test.ts tests/sku-swaps tests/shop-context.test.ts tests/step-up-tier-map.test.ts tests/shop-owned-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
PASS: 62 files / 1,455 tests; exit 0.
Includes inventory, read-boundary, shop-context, tier-map, engine and all four equivalence suites.
Inventory: 170; read-boundary: 8; shop-context: 146; tier-map: 13, all passed.
Equivalence: shop-owned 27, shop-versions 10, recipe-versions 8, counts-onhand 48, all passed and unchanged.

npx.cmd next typegen
PASS: route types generated.
npx.cmd tsc --noEmit --incremental false
PASS: exit 0, no diagnostics (after typegen).

npx.cmd eslint -- <all changed/untracked TS/TSX/MJS/CJS files>
PASS: exit 0, zero errors and warnings. Changed-file diagnostic delta <= 0.

git diff --check
PASS: exit 0; only Git line-ending conversion notices.
```

```text
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000 --reporter=json --outputFile=.tmp/chunk5-full-final.json
EXIT 1: 738 files; 12,305 passed / 2 failed / 3 pending out of 12,310.
The only failures are the two tsx ENOMEM startup cases listed below.
No catalog assertion failures remain. Source was unchanged throughout this final run.
```

Machine reports/logs are local ignored `.tmp/chunk5-focused-final.*`, `.tmp/chunk5-full-final.*`, `.tmp/chunk5-eslint-final.log`. The focused command also used the JSON reporter/outputFile for evidence capture; the test selection and execution flags above are exact.

## Known tsx ENOMEM spawns (separate from catalog assertions)

Both full runs failed the two pre-existing no-credentials startup tests below. Direct reproduction, with both database credential variables explicitly blank, exits 1 inside tsx before script execution:

- `tests/people-chunkE-review.test.ts`: `scripts/check-boh-positions.ts` startup.
- `tests/pm-criteria.test.ts`: `scripts/seed-pm-criteria.ts` startup.

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
at Object.userInfo (node:os:305:11)
at node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs
errno: -4057; syscall: uv_os_get_passwd; Node.js v22.20.0
```

These are recorded as failing, not counted as passing or suppressed. The initial full run also contained the two integration failures already fixed above: 738 files, 12,303 passed / 4 failed / 3 pending out of 12,310.

## Open risks

- Reload after uncertain New item creation loses its client-only request ID and can duplicate the item. Durable uniqueness/reconciliation beyond cooperating jobs remains BUILD chunk 7's explicit deferral.
- SSR/interaction tests prove the one-column class contract and 44px controls; no measured 375px browser viewport or live-sim walk was performed. Those remain final chunk-8 evidence, not claimed here.
- CC's independent cross-family review is pending. This is an uncommitted implementation handoff, not merge approval.
- Known tsx ENOMEM startup failures prevent claiming an entirely green full-suite gate in this environment.
