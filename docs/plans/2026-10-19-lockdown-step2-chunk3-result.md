# R7 chunk 3 + chunk-1 review fixes

Base: `59f2d8bf`; `feat/lockdown-step2`; `C:/Users/conta/co-ops-sol-sec`. Uncommitted for CC. No DB connections, migration applies, environment-file reads, 0277, pushes or merges.

## Implementation plan and checked contracts

The task supplied CC's review rulings and authorized CODE. Before implementation, read 0276, R7/rulings/manifest, written-report writers/routes/shared validator, checklist actor and guards, completion/error/reason paths, 0200 audit pattern, harness/parity tests, and installed Next route-handler guide. Plan: extend 0276's return/reuse/timestamp/ACL contracts and add an atomic report self-edit RPC; consume completion metadata and map errors; move report writes to a fresh verified actor; add SQL and app behavior tests; retain all read callers. Risk: service-only functions trust server-derived actor UUIDs and require existing service table DML. No independent new cross-family plan review receipt was produced here; CC's supplied decisions are the implementation contract and CC's final review remains required.

One source mismatch was identified and preserved explicitly: report list/detail loaders already use a service client with explicit read guards. They were not converted to another client. POST/PATCH formerly used authenticated clients solely for writes; those now resolve actor identity and call service writers.

## Review-item disposition

- P2-1: `checklist_write_completion` returns JSONB completion plus superseded IDs and actual timestamp-carry decision. `completeItem` consumes these for audit without an extra read. Tests cover zero/one/two prior heads and reject an audit-history query.
- P2-2: existing `extra_reasons` duplicate rejection retained and tested before PIN/RPC in `checklist-service-writers.test.ts`.
- P2-3: SQL reuses the original matching reason row; harness asserts original ID/text and count remains one.
- P2-4: explicit conflict mapping for completion set/cardinality; invalid payload/reasons and 22P02 map to 400; instance-open/authorization/item mismatch retain established outcomes. Invalid reason UUIDs are rejected before app reads/PIN/RPC. Conflict copy added in en/es and the PIN modal.
- P3: `pg_get_functiondef` asserts the parent lock is the first executable statement. Lock removal, status-read-before-lock, and open-check removal mutations cover all three writers. All 15 roles plus unknown cover integer floors 0..11; original cases retained. Actor tests independently exercise revoked, expired, mismatch and inactive states. SQL pins two-head no-carry, ignores caller confirmation time, returns stored timestamp, asserts helper EXECUTE and writes migration audit. Sim errors now print AssertionError/P0001 messages while other connection errors remain redacted.
- Chunk 3: report create binds actor identity, level and membership. Report update uses service-only SQL `written_report_update_self` with author + strict DB three-hour window and atomic edit_count increment. Exact 0/1 rowcount handling preserves the existing denial. SQL tests cover one microsecond inside, exact boundary, one microsecond outside, missing/non-author, ACL, and two queued increments. App tests cover spoofed author, level 2, foreign location, fresh session state and no authenticated mutation client.

## Changed/removed assertion ledger

- `tests/checklist-service-writers.test.ts`: cardinality-error HTTP expectations changed 500 -> 409 per CC ruling; completion-set expectation changed generic `concurrent_modification` -> explicit `completion_set_changed` and exact message. Completion mocks/shape assertions use JSONB rather than composite rows; batch remains composite. Toy item IDs changed to UUIDs to preserve valid-input intent under new preflight validation. Added error/session/audit checks; duplicate `extra_reasons` check retained. Audit metadata `prior_audit_read_failed` removed with the eliminated read; superseded IDs and carry assertions replace inference from read rows.
- `tests/closing-staff-participation.test.ts`: completion mock changed to JSONB; behavioral assertions unchanged.
- `tests/checklist-guarded-writers-migration.test.ts`: expected function list/count 4 -> 5 for report RPC; parity count 3300 -> 3492; lock mutation list expanded with read-before-lock. No assertions removed.
- `scripts/sql-harness-0276.mjs`: lock text-presence assertion strengthened to first executable statement from catalog definition. Legacy live-completion expectation separated from guarded completion solely for unknown-role level-0 fallback; known-role verdicts unchanged. Existing timestamp comparisons retained with added return-envelope checks. Original 3300 cases and all 720 null-actor cases retained; no coverage deleted.
- New `tests/written-report-service-writers.test.ts` adds library/route guards and exact rowcount behavior. Existing written-report read/shared tests unchanged.

## Verification

- `node scripts/sql-harness-0276.mjs`: PASS, 38,417 checks / 3,492 shared parity cases; real two-connection sim NOT RUN.
- `npx.cmd vitest run tests/written-report-service-writers.test.ts tests/written-reports-loader.test.ts tests/written-reports-shared.test.ts`: PASS, 3 files / 43 tests.
- `npx.cmd vitest run tests/checklist-write-guard.test.ts tests/checklist-write-actor.test.ts`: PASS, 10 tests.
- `npx.cmd tsc --noEmit`: PASS, exit 0, no diagnostics.
- `npx.cmd vitest run tests/checklist-service-writers.test.ts`: PASS, 77 tests (including corrected exact-message assertion).
- `git diff --check`: PASS.
- Full run: `npx.cmd vitest run --reporter=json --outputFile=.tmp-lockdown-chunk3-tests.json`: 14,643 passed, 6 failed, 7 pending/skipped. This run began before the final response-field assertion correction and under competing TypeScript load; it is NOT a green full-suite receipt.
- Failed-file rerun with `--maxWorkers=2`: 1,175 passed, 2 failed, 4 skipped. Admin-origin/scheduling assertion failures cleared; two script-startup failures persist. `schedule-h9-focus.test.ts` additionally fails its beforeAll hook with all four cases skipped.
- Environment reproductions: `node node_modules/tsx/dist/cli.mjs --version` fails in `os.userInfo` (`uv_os_get_passwd ENOMEM`) before script logic. This explains failures in `people-chunkE-review.test.ts:130` and `pm-criteria.test.ts:140`. `npx.cmd vitest run tests/schedule-h9-focus.test.ts --maxWorkers=1` fails esbuild fixture resolution with `Cannot read directory "..": Access is denied.` No unrelated assertions were weakened.
- `npx.cmd vitest run checklist opening prep closing written-report --maxWorkers=2 --reporter=json`: PASS, 44 files / 697 tests, zero failures/skips. Includes the final 0276 harness/mutation test.

A final gate caught an LF-only ACL mutation matcher after the SQL file acquired Windows CRLF; the harness now normalizes CRLF to LF before applying mutations. No assertion removed. Initial harness fixture used `edited_at` instead of `last_edited_at`; fixed and rerun passed. Initial exact-message test checked `message` rather than the actual `error` response field; corrected. PowerShell blocked `npx.ps1`, so verification uses `npx.cmd` without changing execution policy.

## PR draft / open gates

Title: Preserve checklist audit/retry contracts and cut written-report writes over to verified actors

Completion writes return their transaction's audit metadata, confirmation reuses prior reasons and owns its timestamp, and named refusals have explicit response mappings. Written reports now bind writes to a fresh verified actor; self-edits enforce the strict three-hour window and increment edit_count in one SQL UPDATE. 0276 remains file-only; reads are unchanged.

Follow-up ticket: serialize the existing revoke/revokeWithReason/markNotDoneByAuthority/tagActualCompleter/replaceLiveClosingRefCompletion paths and the prep single-submission lock race. Release scope is **replacement + confirm through 0276**. SECURITY INVOKER relies on service-role table DML and needs consideration in any future service ceiling.

Before any apply: CC must close P2 review findings and obtain a passing two-connection sim proof. PGlite's two queued report edits prove atomic SQL increments on one backend, not independent-backend concurrency. No sim fixture or connection was used here. CC cross-family final review, migration apply and deployment remain outside this task.
