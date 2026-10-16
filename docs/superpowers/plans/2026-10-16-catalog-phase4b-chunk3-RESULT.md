# Catalog Phase 4b - review fixes and New item

Worktree: `C:\Users\conta\co-ops-cat-p4b`; branch `feat/catalog-phase4b-job-pages`, starting HEAD `4419b631`.
Changes are uncommitted. No push, merge, migration, deployment, or production data operation.

## Part A files

- `scripts/sim/launch-readiness/reset.ts`
- `scripts/sim/launch-readiness/lease.mjs`
- `tests/catalog-cleanup-dirty.test.ts`
- `tests/catalog-dirty-lease.test.ts`
- `tests/catalog-write-origin.test.ts`
- `tests/catalog-read-boundary.test.ts`
- `tests/helpers/catalog-read-boundary.ts`

Reset refuses catalog cleanup quarantine before any marker overwrite/clearance. Recovery requires explicit CC-owned complete catalog cleanup verification including swap-journal tables and the recorded prefix. Quarantine retries rename once, then leaves a PID-independent REFUSED record (directory fallback if file writes also fail). Route inventory covers all five requested extensions; static checks pin reviewed read imports and prohibit direct/bracket writes and unknown/mutating RPCs, with the stable swap snapshot as the sole RPC exception.

Failing-first: reset/lease run 3 failed /22 passed; extra refusal-file failure 1 failed /4 passed. Static-check suite initially failed importing its missing helper. Expanded Part A verification: 10 files /481 tests passed. Existing Node process lease contracts: 5 passed.

## Part B files

- `lib/catalog/jobs.ts`: batched authorized setup choices and correct per-shop use-in baselines.
- `lib/catalog/jobs-shared.ts`: client-safe job contracts and attempt state.
- `app/admin/catalog/new/item/page.tsx`
- `components/catalog/jobs/NewItemJob.tsx`
- `lib/shop-context-shared.ts`
- `lib/i18n/en.json`, `lib/i18n/es.json`
- `tests/catalog-jobs-ui.test.ts`
- `tests/catalog-jobs-views.test.ts`
- `tests/shop-context.test.ts`
- `tests/catalog-item-i18n.test.ts`
- `tests/step-up-tier-map.test.ts`
- This handoff document (covers both parts; attach to the Part B commit).

Loader/page failing-first: 4 failed /152 passed; subsequent loader/page/shop-context run 2 files /157 tests passed. The shop-context inventory now recognizes the explicit New item loader import as an indirect authorized resolver; its canonical query getter remains audited.

The New item page reuses PackSentenceEditor, uses Tier E for creation/setup and Tier B for inline vendors, keeps the request ID through edits and uncertain responses, and validates acknowledged identity before advancing. Replay opens the prior item with the bilingual edited-fields notice. Five independent setup cards retain per-shop outcomes, per-day partial results, explicit skip/resume and a refreshed server-read gate for uncertain writes. Use-in receives the correct owned/shared version baseline. Creation payloads are captured before the password dialog; a synchronous ref lock prevents double taps. New strings ship in English and Spanish.

## Assertion changes

Replaced the tautological test-local recover() test's four assertions (two assertClean throws, one no-throw, one marker-undefined) with production reset refusal, preserved marker bytes, zero marker writes and actionable recovery-message assertions.
The new-item loader's query-count assertion changes from 7 to 13 because the new setup data adds six batched queries. Existing count limit and no-write checks remain. No equivalence pins changed.
During the new UI test draft, four initial-render status checks (saved, unconfirmed, resume, skip) were replaced: those controls exist only after acknowledged creation, so the final tests exercise reducer transitions, partial day outcomes and refresh-before-retry instead. The five setup-name checks remain in both language renders.
The catalog i18n inventory now explicitly lists all 58 new keys and the step-up inventory explicitly pins the new component to B/E. Their equality assertions remain intact. No other existing assertion was removed.

## Final verification

Commands use npx.cmd because this PowerShell session blocks npx.ps1.

```powershell
npx.cmd vitest run tests/catalog-jobs tests/catalog-job- tests/catalog-cleanup-dirty.test.ts tests/catalog-dirty-lease.test.ts tests/catalog-read-boundary.test.ts tests/catalog-write-origin.test.ts tests/catalog-toast-link tests/catalog-item-i18n.test.ts tests/step-up-tier-map.test.ts tests/shop-context.test.ts tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
# PASS: 23 files / 719 tests.
node --test scripts/sim/launch-readiness/contracts/lease.test.mjs
# PASS: 5 tests.
npx.cmd next typegen
# PASS: Types generated successfully.
npx.cmd tsc --noEmit --incremental false
# PASS: exit 0, no diagnostics.
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000 --reporter=default --reporter=json --outputFile=scratch/chunk3-full-final.json
# Exit 1: 12,188 passed / 2 failed / 3 skipped (12,193).
# Files: 722 passed / 2 failed / 1 skipped (725); 290.84 seconds.
# Both failures are the subprocess environment failures listed below.
git diff --check
# PASS.
```

First full suite: 4 failed / 12,186 passed / 3 skipped (12,193); 4 failed files / 720 passed / 1 skipped. Two actionable failures were the new i18n and tier-map entries; both were fixed by extending explicit inventories, then passed in the 719-test focused run.

Sandbox/environment subprocess failures, separately: `tests/people-chunkE-review.test.ts` (BOH dry-run startup) and `tests/pm-criteria.test.ts` (seed startup) reached node:os/tsx `uv_os_get_passwd` ENOMEM before the expected missing-credentials exit. No application assertion was relaxed or test skipped to hide these failures. Both recur in the final full run. Isolated confirmation with `npx.cmd vitest run tests/people-chunkE-review.test.ts tests/pm-criteria.test.ts --pool=threads --no-cache --maxWorkers=1 --testTimeout=60000` also reports 37 passed / 2 failed with the same ENOMEM startup errors. The full suite is NOT all-green; there are zero remaining failures in the changed catalog suites. Logs: `scratch/chunk3-full-final.log`, `scratch/chunk3-full-final.json`, `scratch/chunk3-spawn-isolated.log` (ignored, available locally).

## Open risks / next gates

The page uses a single-column layout and minimum 44 px controls, verified by English/Spanish server-render tests. A real 375 px browser/keyboard walk, sim DB lifecycle walk and independent cross-family review remain CC-owned per BUILD chunk 8; no browser or real barcode capture is claimed. No production data or env files were read. The four equivalence pins and migrations are untouched. Scratch test logs are ignored; changes remain uncommitted for separate Part A and Part B commits.
