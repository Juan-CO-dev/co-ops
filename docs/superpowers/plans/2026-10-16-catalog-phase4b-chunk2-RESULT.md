# Catalog Phase 4b — Chunk 2 result

Worktree: `C:\Users\conta\co-ops-cat-p4b`
Branch: `feat/catalog-phase4b-job-pages`
Starting base: `a06baf5d`. At final readback HEAD is `4db4efd0`: CC independently added the scratch-log ignore rule during this task (the intervening diff is `.gitignore` only). All Chunk 2 changes remain uncommitted; Astra made no commits. No push, merge, deployment, migration, env-file access or database operation.

## Changes

- `lib/catalog/jobs-shared.ts`: serializable page/Toast DTOs, scoped job links, independent setup-step/day outcomes, closed refusal mapping, stale-preview invalidation, complete-cost-only margins and food-cost percentage.
- `lib/catalog/jobs.ts`: authorized new-item/new-sandwich/swap loaders and item jobs-strip projection. Explicit global is distinct from remembered-shop omission; owner identity, null owned write scope, and owner-shop choices stay separate. Vendor/registry/guide/rhythm lists are paginated and variable ID filters use batches of 100.
- `lib/admin/recipe-builder-data.ts`: optional fourth argument `{ strict: true }` for jobs; paginates and scopes base reads, throws errors, and bounds dependency IDs. Existing callers retain their prior behavior.
- `lib/catalog/toast-link.ts`, `components/catalog/ToastLinkSection.tsx`, and the existing menu-item Toast route: authorized GET choices/status, shop-effective matching, claimed/rejected GUID exclusion, multiple links, explicit Tier A confirmation, refreshed links, stale-answer isolation, and distinct read versus unconfirmed-save feedback. Reads do not auto-match/write. No Catering Toast changes.
- Both dictionaries, explicit handler manifest, shop-context route coverage, and focused tests. No page is registered because this chunk introduces no page; the mixed Toast route now exports GET and POST. Inventory: 39 route files / 41 handlers / 28 mutations / 13 reads.

## Tests-first evidence

- Shared contracts/i18n: both suites failed for the absent module, then 13 tests passed.
- Page views: suite failed for absent `jobs.ts`, then 14 tests passed.
- Strict builder: 7 failures / 2 passes before implementation (truncation at 1,000 rows and six swallowed read errors); then 9/9 passed. Existing builder compatibility: 8/8 passed.
- Toast loader, GET, component: missing-module/missing-GET failures preceded implementation. Additional UUID refusal failed before fixing; search-confirmation reset and save-feedback cases both failed before fixing. Final Toast/manifest/shop run: 6 files / 317 tests passed.
- Full-suite integration caught the existing catalog translation inventory rejecting new keys; registered all 21 exact new keys in `tests/catalog-item-i18n.test.ts` without removing assertions. Its focused rerun with job i18n passed 2 files / 8 tests.

## Verification

```powershell
npx.cmd vitest run tests/catalog-jobs-shared.test.ts tests/catalog-jobs-i18n.test.ts --pool=threads --maxWorkers=2
# PASS: 2 files / 13 tests
npx.cmd vitest run tests/catalog-jobs-views.test.ts --pool=threads --no-cache --maxWorkers=3
# PASS: 1 file / 14 tests
npx.cmd vitest run tests/catalog-jobs-builder.test.ts tests/recipe-builder-page-scope.test.ts tests/recipe-builder-scope.test.ts tests/recipe-builder-markup.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
# PASS: 4 files / 17 tests
npx.cmd vitest run tests/catalog-toast-link.test.ts tests/catalog-toast-link-http.test.ts tests/catalog-toast-link-ui.test.ts tests/catalog-toast-link-interaction.test.ts tests/catalog-write-origin.test.ts tests/shop-context.test.ts --pool=threads --maxWorkers=2
# PASS: 6 files / 317 tests

# Exact plan baseline
npx.cmd vitest run tests/catalog-job-routes.test.ts tests/catalog-job-http-routes.test.ts tests/new-sandwich.test.ts tests/new-item.test.ts tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/catalog-legacy-pointers.test.ts tests/catalog-management-runner.test.ts --maxWorkers=2
# PASS: 8 files / 293 tests
npx.cmd vitest run tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/shop-context.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
# PASS: 3 files / 198 tests
npx.cmd tsc --noEmit --incremental false
# PASS: exit 0
git diff --check
# PASS
```

The four equivalence test files are unchanged (verified with `git diff -- <four paths>`). No existing assertion was removed. The route inventory's expected methods/counts are updated for GET.

Full-suite command:

```powershell
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
```

Actual raw result (676.84 seconds, exit 1): **719 files passed / 3 failed / 1 skipped (723); 12,146 tests passed / 3 failed / 3 skipped (12,152)**.

Failure dispositions, kept separate:

1. `tests/catalog-item-i18n.test.ts` — `no stray catalog.* key outside the list, in either language`: new job keys were missing from the explicit inventory. Fixed during the run and verified afterwards: 2 files / 8 tests passed. No assertion was removed or weakened. The raw full-suite total above still includes this earlier failure; no claim of a second full-suite run.
2. `tests/people-chunkE-review.test.ts:130` — plain-node/tsx no-credentials startup test.
3. `tests/pm-criteria.test.ts:140` — plain-node/tsx no-credentials startup test.

The latter two are the sandbox-only failures identified in CC's dispatch (CC independently reported their 39/39 local tests passing). Both failed before reaching the expected no-credentials guard, with the same output:

```text
SystemError [ERR_SYSTEM_ERROR]: A system error occurred:
uv_os_get_passwd returned ENOMEM (not enough memory)
at Object.userInfo (node:os:305:11)
at .../node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs:1:84
Node.js v22.20.0
```

Neither test nor its implementation was changed. The full run showed no other failures.

Final combined Chunk 2 check on the corrected tree: **11 files / 360 tests passed** (exit 0):

```powershell
npx.cmd vitest run tests/catalog-jobs-shared.test.ts tests/catalog-jobs-i18n.test.ts tests/catalog-jobs-builder.test.ts tests/catalog-jobs-views.test.ts tests/catalog-toast-link.test.ts tests/catalog-toast-link-http.test.ts tests/catalog-toast-link-ui.test.ts tests/catalog-toast-link-interaction.test.ts tests/catalog-write-origin.test.ts tests/shop-context.test.ts tests/catalog-item-i18n.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
```

## Open verification and handoff

- CC cross-family review remains required before commit/merge. This is implementation, not an independent review approval.
- Component markup checks cover bilingual labels and 44 px controls; 375 px browser layout, keyboard/focus and real Toast integration remain for the plan's Chunk 8 sim walks. No browser or live-system pass is claimed here.
- Subsequent chunks consume these loaders/components; no job pages or other Chunk 3–8 features were added.
- Plan-wide deferred items remain unchanged: durable sandwich replay, broader vendor/item-number uniqueness, Catering Toast-tab retirement, and sibling admin-family same-origin coverage.
