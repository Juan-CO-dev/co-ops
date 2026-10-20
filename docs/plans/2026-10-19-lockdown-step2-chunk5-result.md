# Lockdown step 2: R8 and chunk-3 review fixes; Management API tooling

Base `7825ea4f29e542d1ada0f576c9715666bd38971a`, branch `feat/lockdown-step2`, worktree `C:/Users/conta/co-ops-sol-sec`. Uncommitted. No push, merge, external database writes, migration application, or `.env` access.

## Plan and contracts

Read the actor resolver, guarded writers, role helper, report read policy, parity fixture, harnesses, preflight and sim script before authoring. Implement CC's supplied R8/P3 instructions, preserve RPC signatures, extend local regressions, and provide separate Management API tools while retaining the pg tools. CC's supplied review/rulings authorize these fixes; no separate cross-family review receipt was obtained for the new code. CC review remains required.

R8 is the third documented intentional tightening over live RLS: membership rows must be active. The existing submission/reason and instance-update hole closures remain. The live-RLS oracle deliberately still permits inactive rows; app guards and 0276 refuse them.

## Files and behavior

- `lib/checklist-write-actor.ts`: fresh active-only memberships, preserving no global write override. All four chunk-2 checklist POST routes use this resolver; opening/prep paths retain active `ctx.locations`. No other raw membership replacement was found.
- `supabase/migrations/0276_checklist_guarded_writers.sql`: active membership under `FOR SHARE`; report UPDATE checks current actor active status, old-row visibility floor and null location OR active membership OR level >=8. Author and strict three-hour predicates remain; the counter increments in the same UPDATE. All signatures unchanged, so 0277 and both preflights retain their exact signatures.
- `lib/written-reports.ts`: comments describe the SQL edit gate.
- `tests/fixtures/checklist-write-parity.mjs`, `tests/checklist-write-guard.test.ts`, `tests/checklist-write-actor.test.ts`, `tests/checklist-service-writers.test.ts`, `tests/written-report-service-writers.test.ts`: independent inactive-membership dimension and five POST refusal regressions, including no mutation.
- `scripts/sql-harness-0276.mjs`, `tests/checklist-guarded-writers-migration.test.ts`: actual RLS/RPC parity, report demotion/removal/visibility/global-read cases, literal-only DECLARE defaults before parent locking, and function-call/subquery mutations for each of the three writers.
- `scripts/sim/checklist-0276-lock-check.mjs`: pg version retained; now requires a fresh tagged `--report` fixture and proves two queued edits both increment after real backend blocking.
- `scripts/supabase-management-query.mjs`, `scripts/preflight-0276-management.mjs`, `scripts/sim/checklist-0276-lock-check-management.mjs`, `tests/checklist-management-tools.test.ts`: separate API variants with env-only token, fixed endpoint, redacted failures, production refusal for lock proof, read-only any-ref preflight, owned fixtures, four races and append-only retirement. No direct DB URL required.
- `docs/plans/2026-10-19-lockdown-step2-ruling-r7.md`: explicit R8 supersession note; historical ruling text retained.

## Changed/removed assertion ledger

No existing test or safety assertion removed.

1. Actor query expectation now includes `active=true`; membership mocks honor that filter so inactive-row regressions fail without the implementation change.
2. Parity splits row existence from row activity. Live instance-create uses `liveInstanceCreate`; app instance-create remains `instanceCreate`. Confirmation divergence now permits inactive membership as well as a closed parent, and still asserts refusal only. Added completion/create divergence checks require inactive membership.
3. Matrix count changes 3,492 -> 4,392 and invalid-session/null-actor count 720 -> 1,440 because the membership-active dimension doubles the role/member/user-active/session/status cross-product. Other floor/template cases remain.
4. Harness's normal actor membership and foreign-author membership fixtures change false -> true. Those cases must reach success or wrong-author checks; inactive-row refusal is now independently covered in the parity matrix.
5. Report harness fixture adds real `location_id` and a visibility floor of 3; the prior null floor would correctly fail the new visibility predicate. Existing time-boundary, author, missing-row and counter assertions remain. Eight authorization cases each assert rowcount and counter preservation.
6. Lock-first assertion additionally inspects DECLARE initializers, permitting only literals and casts. Existing lock/read-before-lock/open mutations remain; six new mutations put calls/subqueries in declarations. Mutation-output expectations expanded accordingly.
7. Written-report library delegation test renamed to make SQL's current-visibility responsibility explicit; its assertion is unchanged. HTTP zero-row refusal remains the existing 403 `window_closed` response.
8. Pg sim script retains the three checklist proofs, adds report validation and both-increment assertions, and removes fixture UUIDs from console output. New API-tool tests are additive.

## Verification

- `npx.cmd tsc --noEmit`: PASS, exit 0, no diagnostics.
- `node scripts/sql-harness-0276.mjs`: PASS, 52,439 checks / 4,392 parity cases. Real multi-backend sim proof NOT RUN.
- `node scripts/sql-harness-0277.mjs`: PASS, 130 checks.
- `npx.cmd vitest run checklist opening prep closing written-report pin-confirm preflight --reporter=dot`: PASS, 49 files / 751 tests. Includes the migration tests running both harnesses. Expected injected opening failure/audit warnings appeared; no test failed.
- `npx.cmd vitest run tests/checklist-management-tools.test.ts --reporter=dot`: PASS, 11 tests, including full four-scenario mock execution, failure retirement and incompatible schema refusal before inserts.
- Final `npx.cmd tsc --noEmit`: PASS. An intermediate run found three TS2532 errors in new test mock-call indexing; optional indexing fixed them without weakening the expected-value assertions.
- `node --check` on both sim scripts, the API preflight/helper and the 0276 harness: PASS. `git diff --check`: PASS.

## Operator commands and remaining gates

CC supplies `SUPABASE_ACCESS_TOKEN` in the process environment; neither command loads `.env` or prints the token.

```text
node scripts/preflight-0276-management.mjs --ref=<project-ref>
node scripts/sim/checklist-0276-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
```

No unresolved product question. Real Management API execution, independent PostgreSQL lock evidence and PostgreSQL column-ACL behavior remain CC's sim gates. The runner retains tagged history and deactivates its own fixture configuration; an interrupted network request can require manual retirement. Preflight checks existence/EXECUTE, not deployed function-body equivalence: CC must apply the reviewed 0276 revision before proof. Existing revoke/tag/reference-writer concurrency exclusions remain. No full-repository suite rerun was requested or performed in this session.

Fixture definitions were checked against `docs/CO-OPS_Foundation_Spec_v1.3.md` and relevant migrations; no full live schema dump was available. The operator runner checks live columns, omitted required columns/defaults and enum labels before inserting. Transport result handling was cross-checked against [Supabase's postgres-meta query implementation](https://github.com/supabase/postgres-meta/blob/master/src/lib/db.ts), which returns the last nonempty result from a multi-statement request; trailing COMMIT therefore preserves preflight/racer result rows. This source check is not a substitute for CC's live API run.
