# B/C merge resolution onto reviewed Stage A

> Historical merge-pass record. Build pass 2 supersedes the writer retirement,
> degraded-day rejection and per-day backfill behavior described below. The current
> [operator runbook](../../runbooks/toast-order-capture.md) documents flag-off legacy
> writers, flag-only cutover/rollback, diagnostics, and the bounded rebuild. The four
> committed cutover logs were removed; fresh validation is reported in the handoff.

Branch: `feat/toast-cutover-bc` in `C:/Users/conta/co-ops-reports-h1`.
Base: reviewed Stage A `7cad2da`, PR #401. All edits left uncommitted. No staging, commit, push, merge, schema application, deployment or flag change. The index still lists conflicts until CC stages the resolved working files.

## The 13 conflicts

| File | Resolution |
| --- | --- |
| `supabase/migrations/0222_toast_cutover_depletion.sql` | Exact HEAD bytes, except SIM header version corrected to `20261008011108`. |
| `scripts/test-toast-capture.sql` | Exact HEAD bytes. |
| `scripts/test-toast-capture-debounce.sql` | Exact HEAD bytes. |
| `lib/toast/capture.ts` | Retained HEAD's explicit claim intervals and one identical page transport retry, including `capture_page_transport_failed`. Added B/C in-memory catering accumulation once after successful persistence, catering only after finish, and catering status on debounce reads. The reviewed RPC still owns two-minute stale-claim recovery. |
| `lib/toast/capture-intraday.ts` | Retained the shared 45-second/remaining-time bound and five-minute today/one-hour yesterday intervals. Included B/C catering/incomplete-day health. |
| `lib/toast/capture-job.ts` | B/C typed completion and catering results with HEAD's 150-second shared nightly cap. Further capped by remaining route time minus ten seconds; no provider work when exhausted. Manual cap remains 60 seconds. Legacy-ledger parity remains an operator gate after writer retirement. |
| `lib/toast-sales-pull-run.ts` | Kept reduced Stage C capture → materialize → pars ordering and reader flag gate. Passed remaining route time and cancellation into capture. A degraded publication cannot authorize pars. |
| `app/api/cron/toast-sales-today/route.ts` | Kept capture-only Stage C health/reporting with HEAD's `min(45 seconds, remaining route time - 10 seconds)` cap and `maxDuration=120`. |
| `tests/toast-capture-intraday.test.ts` | Retained HEAD's interval and exhausted/short-route budget assertions. |
| `tests/toast-capture-persistence.test.ts` | Combined HEAD retry/interval tests with B/C post-finish catering, degraded status and debounce evidence. |
| `tests/toast-capture-pull-integration.test.ts` | Kept B/C sequence/exact-day gating tests; added remaining-route-time and degraded-publication cases. HEAD's shared-deadline behavior is also exercised in the capture-job tests. |
| `docs/runbooks/toast-order-capture.md` | Combined final B/C rollout and coverage contract with pass-2 intervals, retry policy, storage estimate and today/yesterday backfill caveat. Reconciled superseded rollout instructions and recorded final SIM provenance. |
| `docs/superpowers/plans/2026-10-07-toast-cutover-depletion.md` | Preserved the reduced plan, removed the duplicate BOM heading, recorded the merge contract and current branch. |

`scripts/sim-revert-0222.sql` was not conflicted and was verified byte-for-byte against HEAD. It remains the original-version revert, not an instruction to revert the final SIM application.

## Final 0222 adaptations

`lib/catering/toast-sales.ts` publishes all required signals in the atomic replacement: suspect check count is `suspectedCatering.length`, suspect quantity is the sum of its check quantities, and counted quantity is the sum of `soldLines.quantity`, exactly matching the legacy materializer formulas. Capture no longer writes the legacy signal table as a separate side effect; audit and resolution-flip observations remain.

Diagnostics include unmapped units, excluded live selection units (including reviewed catering exclusions), poisoned recipe IDs, a SHA-256 fingerprint of confirmed active Toast crosswalk rows, and the missing-pointer order count even with absence removal disabled. Aggregates retain the independent consumption flatten so the unchanged RPC can calculate `attribution_mismatch_sku_count` rather than always comparing attribution with itself. Existing unresolved nonzero item attribution still refuses publication.

Stale dining configuration publishes `degraded` with `toast_capture_config_degraded`; identified poisoned menu recipes also degrade coverage. Nightly pars cannot run on that publication. The backfill script counts degraded results as failures and reports their status/reason.

`lib/toast/effective-depletion.ts` selects all three coverage signals and validates current successful capture coverage. `lib/dynamic-pars.ts` uses those signals only for `DEPLETION_SOURCE=capture`; its legacy signal query, lane start, trailing windows and shadow behavior remain available under the default flag.

Other merge follow-ups: the nightly route passes its absolute 300-second deadline and request signal; route-budget and daily-catchup expectations reflect the final Stage C call. Added executable materialization tests for signals, empty days, stale config, poison diagnostics, catering exclusions, independent attribution amounts and refused publication. Extended coverage tests for signal fields and stale/degraded rejection.

## Verification and remaining gates

Full `npm.cmd test`: 290 files passed; 4,896 tests passed, one skipped. `npm.cmd run typecheck`: passed. Logs are at the clone root (`test-cutover.log`, `typecheck-cutover.log`). Git emitted an inaccessible global-ignore warning; no test assertion failed in the final run.

Protected-SQL byte comparisons passed with only the permitted header substitution. No conflict markers remain in source, tests, docs or SQL. `git diff --check` found no whitespace errors.

CC still owns staging/commit and independent review, SIM execution of the preserved harnesses, production parity/history gates, preview checks and reader activation. No live SQL/provider or production verification was performed here. B/C retires the legacy writer as specified by the reduced plan; the default legacy readers become stale if CC leaves that intermediate deployment unactivated indefinitely. Do not backfill today/yesterday while the pinger runs.
