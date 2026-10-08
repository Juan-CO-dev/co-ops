# PR title

Capture Toast order-level sales with resumable twelve-month backfill

# PR body

The existing Toast pull retains selection/depletion data but loses order/check/payment money and attribution. This adds append-only, PII-excluding order snapshots to the shared manual/nightly/same-day pull, with normalized checks, named discounts (including selections/modifiers), service charges, payments, refund dates/tips, and order/payment server GUIDs. Sales UI remains deferred until financial reconciliation.

Migration 0221 is **authored only**. Page RPCs deduplicate immutable snapshots and stage run membership; finalization verifies a terminal short page before publishing. Latest reads use completed runs and source modification order. Capture failures preserve successful depletion work while withholding healthy heartbeats, allowing the existing job-watch alert cadence to detect failures.

The operator script probes 2025-10-01 per shop, then backfills **2025-07-23 through 2026-07-22, newest first**, paced with bounded 429 backoff. Restart skips completed dates and retries unfinished dates from page one. Config caches paginate all response headers. Channel seeds import actual legacy labels as Unknown plus the supplied Uber Eats example; classifications remain pending CC/Juan review.

## Change map

| File:line | Change |
|---|---|
| `docs/superpowers/plans/2026-10-07-reports-sales.md:5` | Approved scope/rulings supersede the earlier full-UI proposal. |
| `supabase/migrations/0221_toast_order_capture.sql:7` | Manifest, order versions, typed children, caches and DB channel vocabulary. |
| `supabase/migrations/0221_toast_order_capture.sql:78` | Completed-only latest snapshot view. |
| `supabase/migrations/0221_toast_order_capture.sql:85` | Idempotent page transaction and completion RPC; restrictive RLS/grants/self-check. |
| `lib/toast/capture-shared.ts:46` | Explicit field allowlist; cents/UTC normalization; named discounts, reasons and refunds. |
| `lib/toast/capture-runner.ts:6` | Request pacing/429 retry, complete-page orchestration, safe errors and date window. |
| `lib/toast/capture.ts:24` | Manual role/location guard, config refresh, trusted system capture, manifest resume and probe. |
| `lib/toast/client.ts:86` | Config continuation headers and Retry-After metadata; existing toastGet return contract preserved. |
| `lib/catering/toast-sales.ts:223` | Capture alongside selection ingestion; propagate failure through system/debounce paths. |
| `lib/toast-sales-pull-run.ts:115` | Capture failure count and healthy status without suppressing depletion. |
| `app/api/cron/toast-sales-pull/route.ts:47` | Nightly unhealthy heartbeat. |
| `app/api/cron/toast-sales-today/route.ts:45` | Pinger unhealthy heartbeat. |
| `lib/daily-catchup.ts:67` | Catch-up cannot mask a failed capture with cron.success. |
| `scripts/backfill-toast-orders.ts:5` | Probe, label export, resumable backfill, graceful stop, safe direct-invocation guard. |
| `scripts/test-toast-capture.sql:1` | Rollback-only sim SQL assertions. |
| `docs/runbooks/toast-order-capture.md:1` | Operator commands, deployment sequence and evidence limits. |
| `tests/toast-capture-shared.test.ts:1` | Money/dates/discounts/refunds/status/PII fixtures. |
| `tests/toast-capture-runner.test.ts:1` | Page completion/failure, retry bounds, date range and location guard. |
| `tests/toast-capture-persistence.test.ts:1` | Manifest resume, scoped writes and fixture refusal. |
| `tests/toast-capture-pull-integration.test.ts:1` | Capture failure health and continued depletion. |
| `tests/toast-capture-system-trigger.test.ts:1` | System-trigger/debounce failures and location bind. |
| `tests/toast-client.test.ts:100` | Updated fixture response-envelope assertion. |
| `tests/daily-catchup.test.ts:1`, `tests/job-watch-run.test.ts:1` | Updated healthy-result fixtures and failed-capture catch-up coverage. |

## Validation

```text
npm.cmd test
PASS: 272 files; 4,741 passed, 1 skipped (4,742 total); exit 0.

npm.cmd run typecheck
PASS: exit 0.

bash scripts/phase2-discipline-check.sh
PASS: exit 0.
bash scripts/phase2-discipline-check.sh supabase/migrations/0215_batch_vs_bottle.sql
PASS: exit 0.

git diff --check
PASS: exit 0.

npm.cmd run build
FAILED: next/font could not fetch DM Sans from fonts.googleapis.com.
Training trace check not run because the build did not complete.
```

Test processes used local `XDG_CONFIG_HOME` and `GIT_CONFIG_GLOBAL=NUL` overrides to avoid the sandbox-denied global Git ignore path. No global configuration was changed. The first full run had one source-contract assertion failure after the client response-envelope change; updating that assertion produced the passing full run above.

## Rollout / open evidence

- CC cross-family code review, sim migration and SQL harness are still required. No local psql; actual DB grants/transactions are not claimed executed. No production schema query was available in this session; confirm existing locations/legacy ledger columns before applying the seed.
- Apply 0221 before deploying the capture callers. Probe API access/retention at both shops; review actual channel-label export (approximately 29 per dispatch) and mark mappings reviewed. No live Toast/DB/backfill commands were executed by this author.
- Business-date pulls do not discover late changes to old dates automatically. Re-pulls capture their separate refund dates; modified-time/payment discovery and money reconciliation remain prerequisites for the full Sales UI.
- Capture follows legacy selection ingestion; a failure before that point delays capture until retry/backfill. A process-wide limiter is not a distributed limiter: run one backfill process; concurrent cron pressure relies on 429 backoff.
- `toast_daily_data` remains untouched, recorded as dead per CC's evidence. Shared report pagination and pulse modifier totals remain outside this PR.

Branch: `feat/reports-sales`. Worktree: `C:/Users/conta/co-ops-reports-h1`. All changes uncommitted for CC; no fetch, rebase, commit, push, merge, deployment or production mutation.
