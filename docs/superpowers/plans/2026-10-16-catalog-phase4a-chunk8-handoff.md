# Catalog Phase 4a Chunk 8 handoff

> Custody (corrected by CC 2026-10-16, Aggie chunk-8 P2-1): these changes are COMMITTED in 8355d7d3 on feat/catalog-p4a; the frozen revision's full suite is 10,423 passed (the 10,421 figure was the pre-credential-isolation tree).

Worktree: `C:\Users\conta\co-ops-astra-p4`; branch `feat/catalog-p4a`; HEAD/baseline `35748f42e974a3f7fc81dc1687e5bc1e929bd6ef`. All task changes are committed in 8355d7d3. No fetch, push, merge, deployment, credential inspection or real database operation was performed.

## Reviewable change sets

1. Chunk-7 fixes: `2026-10-16-catalog-phase4a-chunk7-review-fixes.md` lists the nine origin-guarded routes, safe diagnostics, setup message keys, encoding/count guard, UUID cap, Back authority tests and corrected historical evidence.
2. Chunk-8 evidence tooling: `scripts/catalog-jobs/management-api.mjs`, `concurrency.mjs`, `sim-scenario.sql`; catalog suite in the actual F4 runner; local transport/SQL tests; `scripts/catalog-release-preflight.sql`; 0265 stale-preview regression; gated `0266_drop_recipe_input_16arg.sql` and exact-signature/stamp tests. Release decisions and remaining product contracts are in `2026-10-16-catalog-phase4a-release-packet.md`.

## CC execution

Use the reviewed candidate in a provisioned SIM checkout with Node 22, valid `.env.sim`, no forbidden Next autoload env files, a clean F4 lease/dirty-marker state and reviewed 0264/0265 already applied to SIM. Supply the existing private `SIM_PIN_MARCUS` control and `SIM_CATALOG_PASSWORD` for that persona without printing either. The Management client reads `~/.supabase-token` itself; no token CLI argument or pasted token is needed. It refuses every project ref except `jepgzucrvklhqpthowsc` before reading the token or sending requests.

```sh
node --import tsx scripts/sim/launch-readiness/target.ts build
node --import tsx scripts/sim/launch-readiness/run.ts --suite catalog --fixture catalog-isolated
# Repeat after the first successful, reviewed run:
node --import tsx scripts/sim/launch-readiness/run.ts --suite catalog --fixture catalog-isolated --repeat 3
```

This is the entry point for Management API concurrency; do not invoke it outside F4. Each request POSTs SQL to `https://api.supabase.com/v1/projects/jepgzucrvklhqpthowsc/database/query` in its own connection/transaction. The holder writes then sleeps seven seconds inside its transaction; the racer starts about two seconds later. Blocking checks require observed not-granted locks and elapsed-time evidence. NOWAIT checks require the exact refusal and a successful released-lock control. Report success depends on zero failed assertions, not mere process completion or audit timestamps.

The explicit additive fixture is necessary because the existing full-reset manifest predates catalog append-only histories. F4 verifies the server and personas, then the suite creates uniquely prefixed records and retires only those records. Requests settle before retirement; failure to clean up fails the run. The fixture is reported as `catalog-isolated`, with restore `not-required`, never as a successful cold-empty reset. Existing broad reset behavior is unchanged. Capture F4's manifest and `catalog-contracts-<attempt>.json` under its `.artifacts/<run-id>/` directory, plus the precise reviewed candidate identity.

Scenarios: duplicate normalized vendor numbers; HTTP request-id replay with one committed identity; share versus owned edit in both controlled orders and stress; Back versus primary choice in both orders and stress (including the actual primary HTTP route); exact inherited restoration after default changes; immediate busy refusal and successful control for a held dependency; rollback marker, identity counts and exact refusal/postconditions. The local 0265 regression captures an affected product-primary closure before the revision column exists, applies the real migration, proves exact SQL refusal/application 409 without mutation, then proves a fresh snapshot saves.

## Verification

Local verification (all test commands exit 0):

- `node scripts/sql-harness-0262.mjs` and `node scripts/sql-harness-0263.mjs`: PASS.
- Explicit 0264/0265 group: 9 files / 91 tests PASS (selection below).
- Final touched/adjacent run: 15 files / 529 tests PASS (selection below), with `--pool=threads --no-cache --maxWorkers=3`.
- `npx vitest run --pool=threads --no-cache --maxWorkers=3`: 664 files passed / 1 skipped; 10,421 tests passed / 3 skipped; ZERO failures; 469.30 seconds.
- Earlier focused evidence: chunk-7 fixes 4 files / 164 tests; release gates 5 files / 88 tests; final concurrency/isolation group 3 files / 132 tests, all PASS.
- `npx tsc --noEmit --incremental false`: PASS, exit 0, no diagnostics.
- `npm run build`: PASS, exit 0; production compilation, TypeScript checking and route generation complete.

Final focused selection:

```text
tests/catalog-0265-stale-preview.test.ts
tests/catalog-job-http-routes.test.ts
tests/catalog-management-runner.test.ts
tests/catalog-release-preflight.test.ts
tests/catalog-sim-scenario.test.ts
tests/drop-recipe-input-16arg-migration.test.ts
tests/i18n-encoding.test.ts
tests/location-bind-differential.test.ts
tests/new-item.test.ts
tests/shop-owned-write-errors.test.ts
tests/sim-evidence.test.ts
tests/sim-isolation.test.ts
tests/sku-swaps-migration.test.ts
tests/step-up-tier-map.test.ts
tests/swap-vendor.test.ts
```

0264/0265 selection: `shop-owned-migration`, `shop-owned-pglite`, `shop-owned-review-pglite`, `shop-owned-recipe-mutations-pglite`, `shop-owned-full-route-pglite`, `shop-owned-sql-equivalence`, `new-item-pglite`, `sku-swaps-migration`, `sku-swaps-pglite` (each `tests/<name>.test.ts`), same Vitest flags. Logs are local `tmp/chunk8-{full-suite,focused,0264-0265,harness-0262,harness-0263,tsc,build}.log`. The full suite emitted a nonfatal permission warning for the host global Git ignore file. These are local PGlite/unit results, not real PostgreSQL concurrency evidence. The final focused run covers the credential-isolation change finalized while the full suite was running.

## Review and remaining gates

Author checks cover BC-001/004/005 (Back authority and two-direction origin gates), BC-018 (message-key existence), BC-019 (committed-state evidence), BC-030/060 (actual migration SQL versus fixture assumptions), BC-007/037 (positive mutations and race postconditions), BC-038 (0266 deployment sequence), BC-042 (full-suite amended-tree checks), BC-043 (CC independent verification), BC-057/058 (bounded transport and cleanup after failure), and BC-064 (separating local evidence from unexecuted SIM gates). These are author checks, not cross-family approval.

Pending CC: cross-family review, real F4/SIM concurrency execution, live migration lineage and preflight, production approval/apply, READY/drain, then 0266. Pending 4b: guided pages/browser acceptance, older catalog-write origin policy, sandwich retry reconciliation, and swap preview payload/load assessment. 0264/0265/0266 remain files-only in this session.
