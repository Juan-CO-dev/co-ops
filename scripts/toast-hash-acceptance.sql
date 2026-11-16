-- Toast canonical content_hash (churn fix PR 1): READ-ONLY acceptance and recovery checks.
-- Procedure: docs/runbooks/toast-hash-canonical.md. Run by CC (Supabase MCP execute_sql), never by the app.
-- Replace the :params with literals. Every query is a SELECT; nothing here writes.
-- Executed against the real 0221 / 0225 / 0229 / 0239 SQL in PGlite by tests/toast-hash-acceptance-sql.test.ts
-- (each "-- @query <name>" section is one statement).

-- @query churn
-- Metric A (instability; must return ZERO rows). Every capture membership whose run started in
-- W = [:w_from, :w_to), partitioned by (shop, order, source modified_at) across EVERY version seen in W
-- (not only the first). One Toast version must be exactly one snapshot inside W: A -> B1 -> B2 -> B1,
-- where B1 and B2 share a modified_at, is caught here even when no row is inserted in W.
-- modified_at NULL is its own partition and its own kind (never silently merged or dropped).
-- Runs of every status count: a failed run's pages still wrote memberships and snapshots.
with m as (
  select ro.location_id, ro.order_guid, ro.snapshot_id, o.modified_at, r.started_at, r.id as run_id
  from public.toast_capture_run_orders ro
  join public.toast_capture_runs r on r.id = ro.run_id
  join public.toast_orders o on o.id = ro.snapshot_id
  where r.started_at >= :w_from::timestamptz and r.started_at < :w_to::timestamptz
)
select location_id, order_guid, modified_at,
       case when modified_at is null then 'CHURN_NULL_MODIFIED' else 'CHURN' end as kind,
       count(distinct snapshot_id) as snapshots, count(*) as memberships,
       string_agg(snapshot_id::text, ' > ' order by started_at, run_id) as sequence
from m
group by location_id, order_guid, modified_at
having count(distinct snapshot_id) > 1
order by kind, location_id, order_guid, modified_at;

-- @query inserts
-- Metric B (inserts). Every snapshot FIRST SEEN in W (first membership's run start), per (shop, Toast
-- business day), classed against the same order's earlier snapshots:
--   transition = an earlier snapshot with the same modified_at was first seen BEFORE W (the one allowed
--                legacy -> canonical step, expected only in the first windows after deploy)
--   churn      = an earlier snapshot with the same modified_at was first seen INSIDE W (must be 0)
--   edit       = earlier snapshots exist, none with this modified_at (a real Toast edit)
--   new_order  = no earlier snapshot
-- (No line of these comments ends in a semicolon: the test splits statements on one.)
-- The expected change of B0 (f) for a (shop, day) = transition + edit + new_order of that row.
with first_seen as (
  select ro.snapshot_id, min(r.started_at) as first_seen
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  group by ro.snapshot_id
), fresh as (
  select o.id, o.location_id, o.order_guid, o.business_date, o.modified_at, f.first_seen
  from public.toast_orders o join first_seen f on f.snapshot_id = o.id
  where f.first_seen >= :w_from::timestamptz and f.first_seen < :w_to::timestamptz
), classed as (
  select fr.location_id, fr.business_date,
    case
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id) and p.modified_at is not distinct from fr.modified_at
                     and pf.first_seen >= :w_from::timestamptz) then 'churn'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and pf.first_seen < :w_from::timestamptz and p.modified_at is not distinct from fr.modified_at) then 'transition'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id)) then 'edit'
      else 'new_order'
    end as kind
  from fresh fr
)
select location_id, business_date,
       count(*) filter (where kind = 'transition') as transition,
       count(*) filter (where kind = 'churn') as churn,
       count(*) filter (where kind = 'edit') as edit,
       count(*) filter (where kind = 'new_order') as new_order
from classed
group by location_id, business_date
order by location_id, business_date;

-- @query coverage
-- The window is only evidence if it is not empty: orders captured in 3+ distinct runs in W, per shop
-- (gate: >= 200 in total, both shops present, today and yesterday both captured).
with m as (
  select ro.location_id, ro.order_guid, ro.business_date, ro.run_id
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  where r.started_at >= :w_from::timestamptz and r.started_at < :w_to::timestamptz
)
select location_id,
       count(*) filter (where runs >= 3) as orders_captured_3_plus,
       count(*) as orders_seen,
       count(distinct business_date) as business_days
from (select location_id, order_guid, business_date, count(distinct run_id) as runs from m group by 1, 2, 3) x
group by location_id
order by location_id;

-- @query comparisons
-- Recovery check (Astra r2 P1): pass 2 retires every current shadow row of an order it republishes
-- (0229:205) and inserts the new rows WITHOUT reconciled_day_sales_oz (0229:237); only
-- record_ezcater_reconciled_comparison writes it (0229:257). After recovery, every event date in
-- [:r1, :c] (C = last covered date) must have missing = 0 and oz equal to B0 (e). Dates in (:c, :r2]
-- are the DEFERRED list: missing > 0 is expected there until a nightly covers them.
select event_date,
       case when event_date <= :c::date then 'covered' else 'deferred' end as status,
       count(*) as current_rows,
       count(*) filter (where reconciled_day_sales_oz is null) as missing,
       sum(reconciled_day_sales_oz) as reconciled_day_sales_oz
from public.ezcater_shadow_depletion
where is_current and event_date between :r1::date and :r2::date
group by event_date
order by event_date;
