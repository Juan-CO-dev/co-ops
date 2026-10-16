# Catalog Phase 4a Chunk 6 handoff

Worktree: `C:\Users\conta\co-ops-astra-p4`; branch `feat/catalog-p4a`; base `d2f05430`. All changes uncommitted. No fetch, push, merge, deployment, SIM or production operation. 0264/0265 are files only.

## Delivered

- Separate chunk-5 review fixes: see `2026-10-16-catalog-phase4a-chunk5-review-fixes.md`. New-item `request_id` is required in the application parser, owner-scoped replay-safe in SQL, generated once per form by `newItemFormRequest`. Helper privilege revoke and release/handoff details are pinned.
- 0265: mandatory product snapshot at every start, including zero recipes; scoped/default primary presence and metadata; membership, eligibility, packs/prices/measures/receipts; dependency-set comparison under graph locks; NOWAIT refusal for non-graph writer lock conflicts. Primary revision advances on every UPDATE, including same-SKU rechoices.
- `swap-shared.ts`: strict normalized request and pure quantity conversion. Measures carry; compatible pack labels carry; incompatible labels convert using the original pack; unknown/nonfinite/underflowing ounces refuse.
- `swap-vendor.ts`: authorized read-only previews, real graph cost comparison for direct lines and product followers, normalized request/token, atomic start and Back adapters, retained-edit results. Common product resolver proposals include explicit unsaved group eligibility and cannot shadow persisted products.
- Back restores saved resolved content. A changed inherited default produces a fresh shop version carrying the original content. Later recipe/primary edits survive. Primary metadata restores without rewinding revision; only rows introduced by the swap may be deleted. Grouping survives independent edits/references, including another shop choosing the new member.
- Named swap refusals have en/es keys and SQL-to-closed-list pins; duplicate active product names return `product_name_taken` with full rollback.

## Concrete chunk-7 / 4b contracts

`previewSkuSwap(actor, request)` returns `request`, `token`, `productSnapshot`, `recipeSnapshots`, direct `recipes` changes, `followsPrimary`, `refused`, `untouchedShops`, and menu `costs`. Send the returned normalized request unchanged to `startSkuSwap(actor, request, token)`. Product and recipe evidence is recomputed and rechecked; tokens are stale-state checks, never authorization.

SQL start signature: `start_sku_swap(p_old uuid, p_new uuid, p_location uuid, p_actor uuid, p_product_snapshot jsonb, p_recipes jsonb, p_temporary boolean, p_note text, p_product jsonb default null)`. Snapshot helpers both take `(p_old,p_new,p_location)`. Each recipe envelope contains `recipe_id`, `write_scope`, resolved `version_id`, `own_version_id`, before `lines`, dependency `snapshot`, and `replacement_lines`. Followers remain unchanged and do not get needless new versions.

`previewBackToNormal(actor, swapId)` returns `goingBack`, `kept`, primary outcome and token. `endSkuSwap(actor, swapId, token)` returns `{back, kept, primary, grouping}`; SQL's locked outcomes are authoritative if an edit races after preview. `loadLiveSwapsForItem` derives liveness from start rows without an end row.

Journal deviation: starts are immutable `sku_swaps`; completion appends one unique `sku_swap_ends` row. There is no mutable active flag. Both tables grant service_role SELECT only; SECURITY DEFINER RPCs own inserts. This strengthens the approved append-only requirement. Consumers must use the end ledger, not assume draft-plan columns.

Chunk 7 adds routes, session/step-up bindings and adjudicated swap-specific audit actions. Current engine audits use existing `vendor_item.update` with `operation: swap_start|swap_end`; audit is fail-open as elsewhere. It also handles new-item `generic` post-save outcomes with `lineSaved:null` and changes `uses_shop_only_item` copy to point to the producing recipe. 4b initializes `newItemFormRequest` once per opened form and retains it across retries. No guided UI was part of Chunk 6.

## Verification

All final checks passed:

- Touched tests: new-item/share + 0264 group, 10 files / 131 tests; root conversion/resolver/i18n group, 18 tests; engine SQL/graph tests, 7 tests. TDD failures were observed before implementations. Final full run includes the final 25 SQL contract/PGlite tests and duplicate-name rollback regression.
- `node scripts/sql-harness-0262.mjs`: PASS, exit 0.
- `node scripts/sql-harness-0263.mjs`: PASS, exit 0.
- `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3`: final run **655 files passed / 1 skipped; 10,139 tests passed / 3 skipped; zero failures**, exit 0, 242.68 s. This is the second full run, after the last named-refusal fix; the earlier full run also passed (10,138 tests).
- `npx.cmd tsc --noEmit --incremental false`: final run exit 0, zero diagnostics. This clone has generated `next-env.d.ts`; no six-error clean-checkout exception is claimed here.
- `git diff --check`: PASS.

Local ignored logs: `tmp/chunk6-final-full-suite.log`, `tmp/chunk6-final-tsc.log`. The test process emitted a nonfatal sandbox warning about reading the user's global Git ignore file; native exit was 0. No failing test is waived.

## Remaining gates

CC cross-family review; chunk-7 HTTP/UI integration; chunk-8 real multi-session concurrency and release gates. PGlite proves transaction outcomes but does not establish concurrent PostgreSQL schedules. No browser/375px check claimed. Production migration lineage/application remains CC/Juan's release work.
