# Toast launch cutover — reduced implementation plan

Status: BUILD GO, cross-family APPROVED WITH CHANGES by Claude Opus + CC, 2026-10-07. Launch Tuesday 2026-10-13. Dedicated clone `C:/Users/conta/co-ops-reports-h1`, branch `feat/toast-cutover-depletion`. Leave edits uncommitted; no fetch, rebase, push, merge, deployment or production writes.

## Stage A — additive, ship first

Reuse tested full business-day capture. Pinger captures today then yesterday under one bounded deadline, with a database-serialized claim that skips running or finished-within-five-minutes runs. Failure never changes legacy sales success. Nightly captures T-1 through T-3 under a shared deadline; route explicitly exports maxDuration=300. Legacy pull, depletion and pars remain source of truth.

Stage A files: `lib/toast/capture.ts`, `lib/toast/capture-job.ts`, new `lib/toast/capture-intraday.ts`, `lib/toast-sales-pull-run.ts`, both `app/api/cron/toast-sales-{today,pull}/route.ts`, `supabase/migrations/0222_toast_cutover_depletion.sql`, `scripts/test-toast-capture{,-debounce}.sql`, `tests/toast-capture-{intraday,persistence,pull-integration}.test.ts`, and this plan. Preserve a Stage A patch before B/C touch shared files so CC can ship it separately. Ship the whole final additive 0222 once (B tables remain dormant); do not apply a partial migration and later change its contents under the same number.

Verify `npm.cmd test` and `npm.cmd run typecheck`; report results before Stage B edits.

## Stage B — coverage and depletion

Read latest published capture snapshots, checks and selection units with explicit complete/missing/stale coverage, including complete empty days. Map order dining GUID through toast_dining_options to reviewed sales_channel_map; never compare ad-hoc dining strings. Exclude deleted/voided/excess orders and invalid checks/selections. Surface stale config.

Migration 0222 adds plain per-location/date depletion, item attribution and coverage manifest (run_id, status, counts). One transaction replaces all three, including success with zero rows. No immutable generations. Never modify source production or capture history.

Whole item/day rule: sales count unless live prep was logged for that item on that day. Use Toast business dates for sales and ET calendar dates for production. While flattening sales, stop at every prep with logged production that day; production inputs count instead. Diagnose ancestor and descendant both logged. Production-only items count; revoked/superseded production does not suppress fallback. Preserve unknown/null taint.

One pure selector feeds counts, receiving, ordering loadSkuUsageRank, weights, pars and their coverage oracles. Preserve pars lane_start_at, trailing windows and shadow-only behavior; update prep-dependent reason tests.

Measure pointers absent from the latest completed full-day capture after recaptures. Report the metric always; `TOAST_CAPTURE_ABSENCE_REMOVAL=1` enables removal only after CC decides from evidence. Reader activation `DEPLETION_SOURCE=capture`; default legacy until CC passes the gate.

Read-only parity script feeds the same deriveSalesConsumption with old rows and capture rows for identical shop/dates. Compare only 2026-07-23 through 2026-10-06; older captures get completeness checks. Buckets: phantom, legacy-missed, note-descendant, edited-after-legacy-pull. Blocking whole-order-missing-without-evidence and unexplained shared-key mismatches must both be zero. Report differences before aggregation, never let cancelling totals conceal failures.

History: rebuild every completed captured closed day as a current-recipe estimate. Production evidence supplied by CC: zero sku_count_events and zero applied par moves. Preserve genuine gaps.

Verify unit suite + typecheck before Stage C wiring. Synthetic SQL harness must exercise real page/finish and atomic replace RPCs; CC runs database and read-only production parity gates.

## Stage C — reader cutover and retirement

Pulse units/checks from captured eligible orders; net sales (pre-tax), en+es, sums toast_order_checks.amount_cents for non-void/non-deleted checks on non-deleted/non-void/non-excess orders. No selection price or menu-group addition.

Collect raw catering candidates only in request memory. After successful finish in that request, classify through cached GUID/channel mapping and write existing restricted toast_catering_orders and existing intake path. No new PII table. Config stale/missing classification is degraded, never silently successful. Catering scan stops calling Toast.

Nightly order: all T-1..T-3 captures, then materialization, then pars. Pars require completed capture AND successful materialization for the exact date; row-existence/max-watermark is insufficient. Failure isolated and observable. Update job-watch registry before removing legacy jobs. Keep scheduler URLs/secrets compatible.

Delete legacy Orders API pull/writer code in the cutover changes. Keep legacy read-only evidence and default legacy reader flag until CC activation. Rollback: TOAST_ORDER_CAPTURE=0, Vercel instant rollback, then old deployment nightly ?date= backfill for gap days. Do not revoke legacy toast_sales_events write grants at launch.

Run requested full tests + typecheck, source-closure checks, and prepare final PR body and exact file lists. Independent cross-family code review, sim SQL, production parity and preview checks remain CC's deployment gates.

## Week 1–2 (explicitly deferred)

- 0223 week 1: modifiedDate/window cursor, durable backlog, lease/fencing, schema v2 (selection prices/menu groups), immutable derived generations, snapshot-linked catering projection.
- 0224 week 2/day 7+: revoke legacy toast_sales_events write grants after rollback window closes.
- 0220 belongs to CO CC's digest work; do not use or rewrite it.

## Risks and verification boundaries

No live DB schema or provider data is inspected here. SQL migration/harness authored locally and not applied by Astra. Mapping incompleteness and provider retention remain explicit coverage/gate findings. Full-day request volume and deployment duration require CC operational verification. No approval inferred from elapsed time or aggregate parity.
