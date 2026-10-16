# Catalog Phase 4a Chunk 7 handoff

Worktree: `C:\Users\conta\co-ops-astra-p4`; branch `feat/catalog-p4a`; implementation baseline `0cb4988a`. CC committed the implementation as `712a57c3` and the remaining AGENTS.md rules as `35748f42`. These describe the committed chunk-7 state; chunk-8 work starts at `35748f42` and remains uncommitted. No deployment, SIM or production operation is established by this handoff. Migrations remain files only.

## Change sets

1. Chunk 6 review fixes: `2026-10-16-catalog-phase4a-chunk6-review-fixes.md` records UTF-8 repair/guards, explicit replay, request-factory lifecycle and expanded table ceilings. This documented change set was included in `712a57c3` with chunk 7.
2. Chunk 7: job/setup/share/swap/Toast/Back HTTP adapters, scoped journal reads, route tier and ownership/refusal contracts, destructive swap audit vocabulary, translated disclosure and the concrete 4b contract below. Route details: `chunk7-routes.md`. Execution plan: `2026-10-16-catalog-phase4a-chunk7-worklog.md`.

## Concrete 4b contract

- **Scope and capabilities:** owner identity is separate from version-write scope and cost scope. Owned recipes write their default (`scope:null`) with an expected owner; costs/pickers use the owner shop. Shared shop edits use that shop as write/cost scope. Creation uses `creationScope` / `newThingScopeGate`: GM at an authorized shop; global creation MoO+. Omitted creation scope can infer exactly one authorized membership; multiple choices require selection. Explicit null is global intent. Use the existing pure ownership gates and role codes, not a UI-only level check. Share requires MoO+. Operational level-6 readers may view the journal; social-media role is excluded. Choose shops from the server-authorized list and preserve selected shop identity through navigation.
- **Item creation:** `CreatedItem = {skuId, ownerLocationId, replayed}`. The route adds localized replay disclosure. On `replayed:true`, latest form changes were NOT applied: open the returned item to edit. Initialize `newItemFormRequest()` per opened form, retain its ID across uncertain failures/retries, and replace the factory on acknowledged success (including replay) before another create. Do not reuse the prior success identity for a new item.
- **Setup:** `SetupResult = {step, ok, detail}` for `par | order_days | guide_line | use_in | barcode`. Setup is not part of item creation. Per-day rhythm results are independent commits/refusals; retry only failed days. A guide `generic` outcome with `lineSaved:null` and `refreshRequired:true` is unconfirmed, not proof that nothing saved. Show `catalog.setup.guide_unconfirmed`, refresh the complete guide and reconcile before retrying. A known refused line has `lineSaved:false`; `guideCreated` can still be true.
- **Guide integration:** editor lines use `skuId`, not a guessed SKU property. Read/save the complete guide, never a shop-filtered guide as an editable baseline. Keep ownership metadata through save/create reconciliation; hold busy until authoritative reload. The shop read view may filter; the editor remains whole.
- **Sandwich:** preview returns normalized `request` and production-resolver `cost`; create returns committed `{recipeId, menuItemId}`. Toast is a later confirmed action using Tier A, separate from the Tier E catalog job. The Catering Toast tab is unchanged.
- **Sharing:** previews carry `ownerShopId`, `ownerShopName`, `snapshot` and `token`. SKU previews include consumers and owner pack/price preservation. Recipe/menu previews include produced `shopOnlyItems`, dependency `shopOnlySkus`, and `blockedBy`; recipe previews also identify `makesSandwich`. Submit `expectedOwner`, `previewToken` and the explicit dependency identity arrays the route requires. A shop-only prep ingredient blocker points to its producing recipe; do not offer direct item promotion. Ownership creation/share authority is app-layer; SQL binds ownership and graph integrity.
- **Swap:** preview returns normalized `request`, token-bound product/recipe evidence, direct recipe changes with before/after/converted, refused recipe positions, primary followers, untouched shops and menu cost deltas. `ordering = {scope, primarySkuId, parsChanged:false, messageKey}` states that ordering follows the replacement and existing par values are unchanged; check the replacement pack. Submit the normalized request plus `previewToken`. Start returns `{swapId, productId, versions}`. Tokens check staleness; libraries and locked SQL reauthorize/recompare.
- **Back:** preview returns `{swapId, oldSku, newSku, shopId, shopName, startedAt, goingBack, kept, primary, token}`. Submit the token; result `{back, kept, primary, grouping}` is authoritative after locked evaluation. Later independent edits remain kept. Do not call them restored. Journal GET returns a plain `{swaps}` envelope; liveness is immutable starts minus end rows, queried by shop/item before transfer with bounded completion-ID batches.
- **Errors:** named refusals retain status/code, localized message and available field/positional line details. Ownership uses the single `RPC_STATUS` map; recipe/menu namespaces retain their own mappings. Unknown exceptions are generic and never expose SQL/internal exception text. Tier E applies to catalog writes, A to Toast; existing registry stays B. Preview and journal reads do not stamp clocks.
- **Disclosure:** keep replay, unconfirmed-save, invalid-line and retained-edit notices visible (D2). New guided pages must still satisfy D1-D10; HTTP/PGlite tests are not browser evidence.

## Deferred 4b integration

Re-read the actual delivered Phase 3b modules/commit before adapting owned recipe/menu page capabilities. Keep owner/write/cost scopes distinct through picker, history, preview and apply. Verify legacy and catalog reopen/edit journeys, including creation with no existing owned output items. The legacy full-recipe post-create redirect to the authorized catalog page remains 4b work. The implemented 4a add-menu-output contract binds the new menu item's ownership to the recipe; never attach a foreign/global output merely because it was visible as an ingredient. Verify `guideId`/`skuId` and ownership reconciliation rather than guessing DTOs. No guided-page layout or 375 px check is delivered here.

## Chunk 8 required carry-forward

Aggie Chunk 6 P3-3: capture a recipe/product-primary closure before real 0265 adds `product_primaries.revision`; apply 0265 in the harness; resubmit the stale snapshot and assert exact HTTP/application `dependencies_changed` (SQL `recipe_version:dependencies_changed` or appropriate menu namespace), no mutation, then successful fresh re-preview/apply. This is separate from the already-covered 0264 column-addition case. Also retain real multi-session concurrency/lock-contention schedules, F4 integration, 0266 exact-signature drop after READY/drain, release preflight and cross-family review under CC. PGlite alone does not prove PostgreSQL concurrency.

## Verification

Final checks all passed; no failing test waived:

- Reproducible focused evidence from Aggie's independent review at `712a57c3`: **25 files / 600 tests passed**, zero failures, exit 0. The earlier 602-test claim lacked a recorded selection and is withdrawn. Selection: `catalog-item-i18n`, `catalog-job-http-routes`, `i18n-encoding`, `location-bind-differential`, `menu-item-shop-permissions`, `new-item-pglite`, `new-item`, `recipe-versions-permissions`, `shop-owned-migration`, `sku-swaps-migration`, `sku-swaps-pglite`, `step-up-tier-map`, `swap-journal-scope`, `swap-permissions`, `swap-vendor`, `shop-owned-pglite`, `shop-owned-review-pglite`, `shop-owned-recipe-mutations-pglite`, `shop-owned-full-route-pglite`, `shop-owned-sql-equivalence`, `shop-owned-i18n`, `shop-owned-fixture`, `share`, `new-sandwich`, `swap-shared` (each under `tests/` with `.test.ts`). These are historical results, not chunk-8 results.
- `node scripts/sql-harness-0262.mjs`: PASS (all B/J/C/W/W2/P/S/V/O sections).
- `node scripts/sql-harness-0263.mjs`: PASS (all M1-M7 sections).
- Full suite: **659 files passed / 1 skipped; 10,387 tests passed / 3 skipped; ZERO failures**, native exit 0 (452.09 s). Log: `tmp/chunk7-full-suite.log`.
- TypeScript: native exit 0, zero diagnostics. The existing generated `next-env.d.ts` is present; no clean-checkout Leaflet exception is claimed. Log: `tmp/chunk7-tsc.log`.
- Historical `git diff --check`: PASS. The implementation is committed at `712a57c3`; AGENTS.md followed at `35748f42`. No migration file changed in chunk 7. Original `tests/catalog-job-routes.test.ts` has no content diff; new HTTP tests are separate.

```powershell
node scripts/sql-harness-0262.mjs
node scripts/sql-harness-0263.mjs
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3
npx.cmd tsc --noEmit --incremental false
git diff --check
```

The full test process emitted the known nonfatal sandbox warning about reading the user-level Git ignore file; native exit was 0. Raw evidence is under ignored `tmp/`, while this handoff and the review-fix/permission/route notes are reviewable source documents.

Open gates: CC cross-family review; 4b guided pages/navigation/browser acceptance; Chunk 8 real PostgreSQL concurrency and release checks, including the pre-0265 stale snapshot case above. Nothing here establishes SIM/PROD migration application or deployment.
