# Catalog Phase 4a chunk 5 handoff

Base/HEAD: `f8079557`; branch `feat/catalog-p4a`; worktree `C:\Users\conta\co-ops-astra-p4`. 32 changed/new paths, including this handoff and work log. All changes are uncommitted and unstaged. Nothing fetched, pushed, merged, deployed or applied to a real database.

## Change set 1: chunk-4 review fixes

Completed and checked before Chunk 5 implementation. Checkpoint patch: `%TEMP%/catalog-p4a-chunk4-review-fixes.patch` (16 paths, +103/-34). Seven focused suites / 54 tests passed. The final tree also corrects a stale owner-move source assertion discovered by the full suite and the remaining Chunk 4 task wording in BUILD.

- SKU ownership is create-time only. Non-null owner changes refuse `owner_is_set_at_creation`; MoO+ may share to global. SkuBuilder displays the owner and offers a share action, without a shop-to-shop selector. BUILD and the old handoff identify a MoO move path as a 4b/5 candidate.
- Org-wide SKU rows display `Only at <shop>` using the existing owner-name DTO. Shop views pass shared plus own rows. Rendered markup and actual page props are tested.
- `write_owned_recipe` maps malformed UUID/numeric casts to `shop_owned:invalid_payload`, with PGlite rollback tests. Owned-recipe authorization remains lib-side by design; service-role SQL binds ownership and graph integrity.
- Catering uses `catering_owned_item_refused` with en/es; catalog retains `owned_not_catering`.
- Old handoff corrected to 90 paths and zero new diagnostics / six pre-existing Leaflet errors in a clean checkout.

## Change set 2: Chunk 5 engines

**New item** — `lib/catalog/new-item-shared.ts`, `new-item.ts`: pure normalized parser, omission versus explicit global scope, atomic SKU + first pack + first price, committed SKU identity returned before setup. Pars, order days, complete guide edits, recipe usage and barcodes delegate to existing writers. Each order day has its own result. A committed empty guide followed by failed line save is disclosed. Unknown write outcomes require refresh before retry; a missing guide plus a forged existing section refuses before creation. Initial par setup uses an empty baseline and cannot overwrite existing settings.

**Sandwich** — `lib/catalog/new-sandwich-shared.ts`, `new-sandwich.ts`, `lib/prep-consumption.ts`: preview and save use the same normalized request, ownership/component rules and existing scoped graph/price/cost machinery. Explicit synthetic recipes hydrate new leaves and cannot collide with any persisted recipe, including hidden/retired ones. Atomic creation returns recipe/menu identities. Real PGlite tests compare preview and persisted shop cost, including different global/shop packs and prices.

**Toast** — `lib/admin/toast-map.ts`: shop-specific choices and a separate explicitly confirmed adapter to `manualMap`; entity ownership checked before rival mappings are superseded. Creation never maps Toast. Existing routes retain Tier A; Catering Toast UI is untouched.

**Sharing** — `lib/catalog/share.ts`: SKU impact uses `loadRecipeInputsAcrossScopes`, including version-only references. Recipe/menu previews use owned default live lines and disclose owned SKU/output dependencies, blockers and inactive producers that must travel with a sandwich. Every writer reauthorizes, recomputes the preview and passes its snapshot to the locked SQL dispatcher. Existing closed update audit actions record `share_to_global` metadata; no parallel audit vocabulary.

New tests: `new-item.test.ts`, `new-item-pglite.test.ts`, `new-sandwich.test.ts`, `share.test.ts`. Existing scope, ownership, i18n and source-contract suites updated. Frozen goldens unchanged.

## File-only SQL deviations

0264 gained two bounded consumer-driven additions beyond the plan's anticipated consumers-only work:

1. `create_catalog_sku` validates and persists `avgOzPerEach` atomically; the prior RPC silently discarded it. Required for count-leaf pack weight. Real PGlite proves persistence and invalid-weight rollback.
2. `catalog_share_snapshot` and `share_catalog_entity` wrap the existing share RPCs. Graph → target → existing dependency locks precede snapshot comparison. This closes changes that owner/SKU/item arrays alone cannot detect, including a newly added sandwich producer. Tests inject changes immediately before the RPC and prove `dependencies_changed` with every owner unchanged. Snapshot/dispatch are service-role only; the recipe-ID helper is not service-role callable.

No new migration number. 0264 is still authored, not applied. Its legacy share writers and existing signatures remain available. New-item uses the actual RPC payload and `{id}` response; it does not invent pack/price history IDs. Creation audit records initial facts on the committed SKU.

## Verification

TDD red runs preceded each implementation lane; review fixes, atomic weight persistence, partial outcomes and malformed guide refusal were observed failing before fixes.

- Review fixes: 7 suites / 54 tests passed.
- Touched + sharing + 0264 integration group: 16 suites / 134 tests passed, native exit 0.
- Final new-item/i18n group: 3 suites / 49 tests passed.
- Sandwich/graph/Toast group: 4 suites / 54 tests passed.
- `node scripts/sql-harness-0262.mjs`: PASS, native exit 0.
- `node scripts/sql-harness-0263.mjs`: PASS, native exit 0.
- First full run: 3 failing suites (2 failed tests; one suite failed collection), 10,070 passed / 3 skipped. Two stale source assertions expected the removed SKU-move bind and the old graph-construction expression; the third expected LF function delimiters in the catering file. Updated assertions to the approved behavior and restored LF; all three suites passed (28 tests). No tests skipped or goldens changed to resolve failures.
- `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --reporter=default --reporter=json`: PASS, 651 files passed / 1 skipped; **10,087 tests passed / 3 skipped / ZERO failures**, native exit 0 (203.43 s). This final run includes the final partial-outcome and malformed-guide regressions.
- `npx.cmd tsc --noEmit --incremental false`: PASS, no diagnostics, native exit 0. This local worktree already has ignored `next-env.d.ts`, including Next image declarations. This does not erase the six pre-existing clean-checkout Leaflet errors documented in the corrected chunk-4 handoff.
- `git diff --check`: PASS, exit 0. Index remains empty. Only en/es dictionaries changed among JSON files; frozen goldens remain unchanged.

Logs under `%TEMP%`: `p4-review-{red,final}.log`, `share-{red,tests}.log`, `p4a-chunk5-touched-sql.{log,json}`, `p4a-chunk5-sql0262.log`, `p4a-chunk5-sql0263.log`, `p4a-chunk5-full.{log,json}` (first run), `p4a-chunk5-full-fixes.log`, `p4a-chunk5-final.{log,json}`, `p4a-chunk5-tsc-final.log`.

## Remaining review and release notes

CC owns cross-family review and approval. No browser smoke, real Postgres/SIM/PROD execution or multi-session concurrency claim; browser 375px and real-session gates remain lead/Chunk 8 work. Org-wide graph/price waves and sharing preview latency are unmeasured. Existing SKU number serialization remains limited to job-RPC callers, not legacy/import writers. Guided pages, changed post-create redirects, and both-page reopen acceptance remain 4b; job/share route exposure remains the later route chunk.
