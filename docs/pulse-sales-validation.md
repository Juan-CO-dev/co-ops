# Pulse sales validation / CC handoff

Branch `fix/pulse-sales-timeout`, clone `C:/Users/conta/co-ops-pulsesales`. Changes are uncommitted. Migration 0242 is authored, not applied. CC reviewed the implementation plan; the unavailable network review seats were explicitly waived for this task.

## Rollback-only sim harness

After CC applies 0242 to **sim**, run with the migration-owner connection through the normal credential mechanism (never paste credentials into a command or log):

```powershell
psql -X -v ON_ERROR_STOP=1 -f scripts/test-pulse-sales.sql
```

The harness requires the established sim sentinel and empty synthetic date windows. All fixtures and temporary functions roll back. On an error, ON_ERROR_STOP ends the connection, rolling back the open transaction. It checks consumed-field parity against 0239, 28-day hourly and coverage parity, empty coverage, old-sale refunds, NULL dated refund amounts, excluded classes, selection discounts, obsolete snapshots, service-only grants, pinned search paths and window guards. It prints JSON row outputs of **both new RPCs and sales_report_daily for the same shop/day**. It has not been executed in this clone: `psql` is unavailable. SQL correctness remains a sim gate, not a claimed pass.

## Read-only timing and plans

Use representative sim volume first. Run each cold measurement on a separately cold/restored sim or report it honestly as warm; a new connection alone does not clear PostgreSQL/OS caches. Never flush production caches. Record database size, selected shop/date, row counts, wall time, shared hit/read buffers, and plan. Capture all seven calls, not just the baseline. The acceptance targets are today under the 7-second section/8-second database budget and baseline under its independent 3-second budget; these are **targets, not measurements**.

In psql, set `shop` and `day` to the chosen sim shop UUID and business date, then:

```sql
\timing on
begin read only;
set local statement_timeout = '8s';
explain (analyze, buffers, verbose, settings)
select public.pulse_sales_today(:'shop'::uuid, :'day'::date, :'day'::date);
explain (analyze, buffers, verbose, settings)
select public.pulse_sales_baseline(:'shop'::uuid, :'day'::date-28, :'day'::date-1);
select public.pulse_sales_today(:'shop'::uuid, :'day'::date, :'day'::date);
select public.pulse_sales_baseline(:'shop'::uuid, :'day'::date-28, :'day'::date-1);
-- Repeat this EXPLAIN for item, channel, discount, server, hour_weekday.
explain (analyze, buffers, verbose, settings)
select public.sales_report_breakdown(:'shop'::uuid, :'day'::date, :'day'::date, 'item');
rollback;
```

PL/pgSQL outer EXPLAIN gives elapsed time/buffers but hides internal scan nodes. For actual scan attribution, use the session's `auto_explain` nested-statement facility on sim when available, or EXPLAIN the inner SELECTs copied from 0242 with bound literals substituted for `p_location_id`, `p_from`, `p_to`. Do not call an outer Result node proof of index usage. For the facts path:

```sql
begin read only;
set local statement_timeout = '8s';
explain (analyze, buffers, verbose)
select * from public.sales_report_facts(:'shop'::uuid, :'day'::date, :'day'::date);
explain (analyze, buffers, verbose)
select * from public.sales_report_facts(:'shop'::uuid, :'day'::date-28, :'day'::date-1);
explain (analyze, buffers, verbose)
select pm.snapshot_id, pm.check_guid
from public.toast_payments pm
join public.toast_orders o on o.id=pm.snapshot_id and o.location_id=:'shop'::uuid
join public.toast_order_latest_pointers p on p.location_id=o.location_id
  and p.order_guid=o.order_guid and p.snapshot_id=o.id
where pm.refund_business_date between :'day'::date and :'day'::date;
rollback;
```

Expected paths are in 0242's header. The refund probe above isolates candidate lookup, not the complete classifier cost; also inspect the full refund SELECT. `ezcater_current_toast_links` expands through current `ezcater_toast_links` (partial `ezcater_toast_links_order` / `ezcater_toast_links_selection`), `ezcater_orders_pkey`, `catering_pipeline_pkey`, latest Toast pointers and check PKs. The link table has no dedicated shop/date index in 0229; a filtered scan is possible. The partial payment refund-date index bounds candidates across shops by refund date, then the order PK/shop filter and pointer `(location_id,order_guid)` PK test the current snapshot. No original-sale-date bound may be added: it would lose old-sale refunds.

The 0239 undated-refund all-history arm is omitted entirely from Pulse. Reports > Sales retains its uncertainty semantics. Five one-day breakdown fact reads remain; no additional index/storage is allocated. Capture max timestamp scans matching shop/day/completed runs, not an indexed finished_at ordering.

## Review checks

Self-check applied relevant catalog classes BC-001/004/025 (role and shop before I/O), BC-006/010 (windowed aggregates, no history refund arm), BC-008 (existing ET/ISO buckets), BC-009 (latest snapshots/deleted/class exclusions), BC-013/031 (check totals and refund dates; hourly rounding and distinct coverage), BC-019/030 (source reread; sim execution still pending), BC-032/040 (baseline failure explicit, today errors propagate). CC remains the cross-family code reviewer; this is not an independent review claim.
