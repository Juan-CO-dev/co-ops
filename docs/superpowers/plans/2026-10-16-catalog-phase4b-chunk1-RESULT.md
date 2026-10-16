# Catalog Phase 4b chunk 1 handoff

Scope: approved BUILD r2 chunk 1 only. Branch `feat/catalog-phase4b-job-pages`, base `d28ec084`, worktree `C:\Users\conta\co-ops-cat-p4b`. All changes uncommitted. No push, merge, deployment, environment-file access/change, migration or database execution.

## Changes and counts

- Explicit inventory: 39 route files / 40 handlers, unchanged. 28 mutation handlers + 12 reads (11 read-only files plus swap GET).
- Unguarded mutations: 18 -> 0. Guarded mutations: 10 -> 28. All 18 add the existing same-origin guard before params/body/session work. Existing tiers, role floors, parsing and library calls remain unchanged; item-type comment now says Tier E.
- Public previews: five HTTP boundaries project recursive allowlists, including request/token and visible consequences. Internal snapshots/unknown nested fields cannot cross HTTP. Engines and evidence hashing are unchanged. No current page/component calls these engines; future page props must use the pure public DTO.
- Inner/outer cleanup: returned or thrown retirement failure, failed verification or remaining active identities/pending swaps persist DIRTY before returning/rethrowing. Next catalog entry uses the existing clean guard. Success never clears DIRTY. Marker-write failure escapes report assembly and quarantines the lease (preserved owner evidence, no automatic stale reclaim). Recovery is CC-owned complete cleanup verification and intentional clearance; no recovery/clear command added.
- 253 tests added: 153 origin/inventory/read tests, 72 older HTTP contract cases, five preview projections, 21 cleanup cases and two quarantine cases. Existing management-runner assertions extended.

## Failing-first evidence

| Task | Command | Before fix | After fix |
| --- | --- | --- | --- |
| Origin family | `npx.cmd vitest run tests/catalog-write-origin.test.ts --maxWorkers=2` | 72 failed / 81 passed: four bad/missing origins on each of 18 unguarded mutations | 153 passed |
| Valid-payload origin + existing HTTP contracts | `npx.cmd vitest run tests/catalog-job-http-routes.test.ts --maxWorkers=2` | 18 failed / 164 passed after completing preview mock shapes | 182 passed |
| Public previews | `npx.cmd vitest run tests/catalog-job-preview.test.ts --maxWorkers=2` | 5 failed: internal evidence leaked | 5 passed |
| DIRTY cleanup | `npx.cmd vitest run tests/catalog-cleanup-dirty.test.ts --maxWorkers=2` | Initial 15 failed / 3 passed; pending-swap follow-up 1 failed / 18 passed | Final 21 passed |
| Failed-marker lease quarantine | `npx.cmd vitest run tests/catalog-dirty-lease.test.ts --maxWorkers=2` | 2 failed (quarantine missing) | 2 passed |

Positive controls were written with their negative cases; passing controls are not claimed as failing tests. Seven pre-existing apply tests then failed in the first full run because their request helper omitted Origin; adding its same-origin header restored all 18 recipe-route tests without altering assertions.

## Verification

```text
npx.cmd vitest run tests/catalog-job-routes.test.ts tests/catalog-job-http-routes.test.ts tests/new-sandwich.test.ts tests/new-item.test.ts tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/catalog-legacy-pointers.test.ts tests/catalog-management-runner.test.ts --maxWorkers=2
BEFORE: 8 files / 221 passed
AFTER:  8 files / 293 passed

npx.cmd vitest run tests/catalog-write-origin.test.ts tests/catalog-job-preview.test.ts tests/catalog-cleanup-dirty.test.ts tests/catalog-management-runner.test.ts tests/catalog-job-http-routes.test.ts tests/swap-vendor.test.ts tests/share.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/shop-context.test.ts --maxWorkers=2
PASS: 10 files / 589 tests (includes all 139 shop-context tests)

npx.cmd vitest run tests/catalog-recipe-routes.test.ts tests/catalog-write-origin.test.ts tests/catalog-cleanup-dirty.test.ts tests/catalog-dirty-lease.test.ts tests/catalog-management-runner.test.ts --maxWorkers=2
PASS: 5 files / 204 tests, after final cleanup and fixture changes

npx.cmd tsc --noEmit --incremental false
PASS: exit 0 on final source including lease quarantine

git diff --check
PASS
```

The four equivalence files and migrations have no diff. Mechanical comparison against HEAD confirms each older mutation route contains only the guard addition and requested comment correction. No existing expect assertion was removed or changed.

## Full suite

```text
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
EXIT 1
Test Files: 2 failed | 712 passed | 1 skipped (715)
Tests:      2 failed | 12086 passed | 3 skipped (12091)
Duration:   308.10 seconds
```

The first full run had 9 failed / 12079 passed / 3 skipped; seven were the missing-Origin fixture issue fixed before this final full rerun. The final two are runtime failures detailed below. The requested zero-failure result was NOT achieved.

Raw command logs, including origin/HTTP failing-first evidence and both full runs, are archived under `scratch/catalog-phase4b-chunk1/` in this worktree. The preview and cleanup failing-first evidence above was recorded in the agent tool results.

The two existing subprocess tests in `tests/pm-criteria.test.ts` and `tests/people-chunkE-review.test.ts` reproducibly fail inside tsx startup before either script executes:

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
at Object.userInfo (node:os:305:11)
at node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs
```

Independent `node` invocation of `require('node:os').userInfo()` reproduces `ERR_SYSTEM_ERROR uv_os_get_passwd ENOMEM` without tsx or application code. No assertion, application code, installed dependency or environment workaround was applied for this host/runtime failure.

## Deviations and follow-up

No implementation scope deviation. Runner lease quarantine is the task's required fail-closed marker-write plumbing. No existing assertions changed; only five placeholder preview mock results became realistic public DTOs, and the existing recipe-route request helper now includes Origin. The zero-failure full-suite requirement is blocked by the two Node/tsx startup failures; rerun the exact command in CC's working runtime.

Sibling admin-family same-origin inventory/hardening is a separate follow-up (vendors, products, recipes, SKUs and other admin mutation families); none expanded here. CC cross-family code review remains the handoff gate. No live sim/DB verification claimed.

## Files changed

- `app/api/admin/catalog/item-type/[id]/route.ts`
- `app/api/admin/catalog/menu-item/[id]/apply/route.ts`
- `app/api/admin/catalog/menu-item/[id]/share/preview/route.ts`
- `app/api/admin/catalog/menu-item/[id]/shop/back-to-default/route.ts`
- `app/api/admin/catalog/menu-item/[id]/shop/restore/route.ts`
- `app/api/admin/catalog/menu-item/[id]/shop/route.ts`
- `app/api/admin/catalog/recipe/[id]/apply/route.ts`
- `app/api/admin/catalog/recipe/[id]/back-to-default/route.ts`
- `app/api/admin/catalog/recipe/[id]/lines/route.ts`
- `app/api/admin/catalog/recipe/[id]/restore/route.ts`
- `app/api/admin/catalog/recipe/[id]/share/preview/route.ts`
- `app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts`
- `app/api/admin/catalog/sku/[id]/pack/apply/route.ts`
- `app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts`
- `app/api/admin/catalog/sku/[id]/pack/restore/route.ts`
- `app/api/admin/catalog/sku/[id]/pack/route.ts`
- `app/api/admin/catalog/sku/[id]/price-basis/route.ts`
- `app/api/admin/catalog/sku/[id]/price/apply/route.ts`
- `app/api/admin/catalog/sku/[id]/price/back-to-default/route.ts`
- `app/api/admin/catalog/sku/[id]/price/route.ts`
- `app/api/admin/catalog/sku/[id]/share/preview/route.ts`
- `app/api/admin/catalog/sku/[id]/swap/preview/route.ts`
- `app/api/admin/catalog/swaps/[swapId]/back-to-normal/preview/route.ts`
- `lib/catalog/job-preview-shared.ts`
- `scripts/catalog-jobs/cleanup.mjs`
- `scripts/catalog-jobs/concurrency.mjs`
- `scripts/sim/catalog/catalog.ts`
- `scripts/sim/launch-readiness/lease.mjs`
- `scripts/sim/launch-readiness/run.ts`
- `tests/catalog-cleanup-dirty.test.ts`
- `tests/catalog-dirty-lease.test.ts`
- `tests/catalog-job-http-routes.test.ts`
- `tests/catalog-job-preview.test.ts`
- `tests/catalog-management-runner.test.ts`
- `tests/catalog-recipe-routes.test.ts`
- `tests/catalog-write-origin.test.ts`
