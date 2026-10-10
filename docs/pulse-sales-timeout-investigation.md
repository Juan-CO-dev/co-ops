# Mid-shift pulse Sales timeout investigation

Status: investigation complete; implementation awaiting the required cross-family plan review or explicit waiver. No code or migration has been changed. The two configured review seats could not connect (WinError 10013). Their failure records are adjacent to this file.

## Evidence and root cause

CC supplied production evidence: `GET /mid-shift` failed with `sales_report_daily: canceling statement due to statement timeout` at 06:54Z and 14:22Z on 2026-10-10. Authenticator timeout is 8 seconds. Sequential owner timings were 11.4 seconds for the first/cold one-day request, then 1.7 seconds for seven days and 1.8 seconds for 28 days. A 56-day request was correctly refused. These are supplied measurements, not measurements made in this clone.

`lib/pulse/sections.ts:640` builds a one-day range for today and a 28-day range from today minus 28 through yesterday. Comparison is off (`lib/sales-reports-shared.ts:143`). Each fits one <=31-day SQL window. On each uncached source load it issues:

| Calls | Window | Purpose |
| --- | --- | --- |
| 1 `sales_report_daily` | today | Summary |
| 5 `sales_report_breakdown` | today | Item, channel, discount, server, hour/weekday |
| 1 `sales_report_daily` | trailing 28 dates | Coverage denominator; all other summary fields are discarded |
| 1 `sales_report_breakdown` | trailing 28 dates | Hour/weekday heatmap and pace numerator |
| 2 `toast_modified_cursors` reads | shop | Optional report disclosure; pulse discards both |
| 1 `toast_capture_runs` read | today | Latest completed capture timestamp |

Total: **8 RPCs + 3 table reads = 11 requests**, not N individual weekday queries. The process-local source cache shares this work for 50 seconds (`lib/pulse/source-cache.ts:19`); it does not protect cold instances. Four calendar occurrences of today's weekday exist inside the trailing range; the denominator counts only those with completed captures. The numerator uses the existing hour/weekday breakdown, rounds each hourly average, then accumulates (`lib/pulse/baseline-shared.ts:31`). Preserve that behavior.

The application failure mechanism is proven by code: all eight datasets share one `Promise.all` (`lib/pulse/sections.ts:645`), so either baseline failure rejects the entire section. Calls omit `{ client: service }`, causing `lib/sales-reports.ts:92` and `:136` to create their own service client instead of using the pulse's abort wrapper. The seven-second section race (`lib/pulse/sections.ts:569`) therefore does not cancel these requests.

The strongest SQL suspect is **0239's all-history undated-refund path**, not a missing shop/date index. `supabase/migrations/0239_sales_true_net.sql:64` materializes refund facts; lines 73-76 admit undated payments on any order date <= report end and inspect accounting presence. The partial refund-date index cannot cover that NULL-date arm. The same query also materializes all selected check facts plus accounting (`:61`) and repeatedly extracts/casts accounting components (`:96`). That work is required for exact report uncertainty but not for the pulse's check-total display. The seven/28-day warm timings being similar is consistent with substantial history-dependent overhead; it does not prove a specific execution plan or relative cost. No production EXPLAIN was obtained.

## Schema and storage

0221 already defines `toast_order_latest_pointers_location_date(location_id,business_date)` at line 88, `toast_orders_location_date` at line 40, checks PK `(snapshot_id,check_guid)` at line 44, payments PK `(snapshot_id,payment_guid)` at line 63, partial `toast_payments_refund_date` at line 66, and capture-run `(location_id,business_date,status)` at line 29. Checks have no location/date columns. Latest pointers do not have a standalone snapshot index; whether adding one helps needs an actual plan. 0237 publishes new immutable payment snapshots through the same pointer path; it creates no sales aggregate. 0222's daily rollup stores SKU depletion ounces (`:61`), not sales money. 0239 adds nullable accounting JSON and refund allocation, with no index.

The proposed 0242 uses the existing indexes and adds only functions: **additional index size = 0 bytes; no rollup/backfill storage**. Function catalog storage is small but not measured. This avoids speculative index growth with the supplied database size of approximately 456/500 MB.

## Proposed PR body (not implemented)

Mid-shift Sales currently invokes the full accounting report for both today and the trailing baseline. A cold accounting read can exceed the production eight-second timeout, and baseline failure hides today's sales.

Add pulse-only read RPCs for today's displayed totals and the existing hourly baseline with completed-capture coverage. Preserve check eligibility, dated refunds, weekday math, and the Reports > Sales accounting path. Pass the pulse client through all readers and show an explicit unavailable-baseline state when its deadline expires. No new index or persisted rollup. Migration 0242 must be applied through CC/Juan's sim-first process before deploying the app change.

Planned verification: per-poll call counts, exact windows, scope-before-I/O, abort/timeout fallback, baseline parity and Reports > Sales parity; rollback-only SQL harness; full unit suite and typecheck. Representative cold database timings and query plans must be recorded by CC before claiming the performance acceptance criterion is met.

## Baseline validation

`npm.cmd test`: 430 files passed; 6,706 tests passed, one skipped (6,707 total). This verifies the unchanged starting code only. Test log: `pulse-sales-baseline-tests.log`.

`npm.cmd run typecheck`: failed on the unchanged starting code with six TS2307 errors: missing declarations for Leaflet marker-icon.png, marker-icon-2x.png and marker-shadow.png in `components/admin/catering/fulfillment/ZoneMap.tsx:24` and `components/order/DeliveryRouteMap.tsx:6`. Log: `pulse-sales-baseline-typecheck.log`. The shell wrapper's exit status was that of its final log-read command; the compiler output, not that wrapper status, is the result.

Branch: `fix/pulse-sales-timeout`. Clone: `C:/Users/conta/co-ops-pulsesales`. No git writes, pushes, merges, migration application, or production data access.
