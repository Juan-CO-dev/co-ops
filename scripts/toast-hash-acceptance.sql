-- Toast canonical content_hash (churn fix PR 1): READ-ONLY acceptance and recovery checks.
-- Procedure: docs/runbooks/toast-hash-canonical.md. Run by CC (Supabase MCP execute_sql), never by the app.
-- Replace the :params with literals. Every query is a SELECT; nothing here writes.
-- Executed against the real 0221 / 0225 / 0229 / 0239 SQL in PGlite by tests/toast-hash-acceptance-sql.test.ts
-- (each "-- @query <name>" section is one statement).

-- STORED CONTENT (both queries below carry the same "content" CTE, text for text): one jsonb per
-- snapshot holding everything stored for it, ignoring storage identity (toast_orders.id, content_hash,
-- every child's snapshot_id), array order (selection_units elements and each child table's rows are
-- sorted by their jsonb text, duplicates kept) and the synthetic ordinals of discounts and service
-- charges. jsonb compares objects key-order-free. Every other column is content, so a column added
-- later counts as content until someone decides otherwise. This is the cleanup plan's equivalence.
-- Two snapshots of one order with one modified_at and EQUAL content are churn. With different content
-- they are a real Toast edit that left modified_at unchanged (prod 2026-11-17: payment_status
-- AUTHORIZED -> CAPTURED at the nightly card batch capture), so they are reported, not failed.

-- @query churn
-- Metric A (instability; must return ZERO rows of kind CHURN or CHURN_NULL_MODIFIED). Every capture
-- membership whose run started in W = [:w_from, :w_to), partitioned by (shop, order, source
-- modified_at) across EVERY version seen in W (not only the first). One Toast version must be exactly
-- one snapshot inside W: A -> B1 -> B2 -> B1, where B1 and B2 share a modified_at and their stored
-- content, is caught here even when no row is inserted in W.
-- A partition with more than one snapshot is CHURN when two of its snapshots have equal stored content
-- (contents < snapshots), else EDIT_SAME_MODIFIED: every snapshot differs in stored content, a real edit
-- Toast made without moving modified_at (reported, not a failure).
-- modified_at NULL is its own partition and its own kinds (CHURN_NULL_MODIFIED, EDIT_NULL_MODIFIED),
-- never silently merged or dropped.
-- Runs of every status count: a failed run's pages still wrote memberships and snapshots.
with m as (
  select ro.location_id, ro.order_guid, ro.snapshot_id, o.modified_at, r.started_at, r.id as run_id
  from public.toast_capture_run_orders ro
  join public.toast_capture_runs r on r.id = ro.run_id
  join public.toast_orders o on o.id = ro.snapshot_id
  where r.started_at >= :w_from::timestamptz and r.started_at < :w_to::timestamptz
), multi as (
  select location_id, order_guid, modified_at
  from m group by location_id, order_guid, modified_at
  having count(distinct snapshot_id) > 1
), content_ids as (
  select distinct m.snapshot_id as id
  from m join multi g on g.location_id = m.location_id and g.order_guid = m.order_guid
                     and g.modified_at is not distinct from m.modified_at
), content as (
  select o.id, jsonb_build_object(
    'order', to_jsonb(o) - 'id' - 'content_hash' - 'selection_units',
    'selection_units', (select coalesce(jsonb_agg(u order by u::text), '[]'::jsonb) from jsonb_array_elements(o.selection_units) u),
    'checks', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
               from (select to_jsonb(c) - 'snapshot_id' as x from public.toast_order_checks c where c.snapshot_id = o.id) c),
    'discounts', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                  from (select to_jsonb(d) - 'snapshot_id' - 'ordinal' as x from public.toast_check_discounts d where d.snapshot_id = o.id) d),
    'service_charges', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                        from (select to_jsonb(s) - 'snapshot_id' - 'ordinal' as x from public.toast_check_service_charges s where s.snapshot_id = o.id) s),
    'payments', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                 from (select to_jsonb(p) - 'snapshot_id' as x from public.toast_payments p where p.snapshot_id = o.id) p)
  ) as content
  from public.toast_orders o
  where o.id in (select id from content_ids)
), contents as (
  select m.location_id, m.order_guid, m.modified_at, count(distinct c.content) as contents
  from (select distinct location_id, order_guid, modified_at, snapshot_id from m) m
  join multi g on g.location_id = m.location_id and g.order_guid = m.order_guid and g.modified_at is not distinct from m.modified_at
  join content c on c.id = m.snapshot_id
  group by m.location_id, m.order_guid, m.modified_at
)
select m.location_id, m.order_guid, m.modified_at,
       case when count(distinct m.snapshot_id) > k.contents
            then case when m.modified_at is null then 'CHURN_NULL_MODIFIED' else 'CHURN' end
            else case when m.modified_at is null then 'EDIT_NULL_MODIFIED' else 'EDIT_SAME_MODIFIED' end
       end as kind,
       count(distinct m.snapshot_id) as snapshots, k.contents, count(*) as memberships,
       string_agg(m.snapshot_id::text, ' > ' order by m.started_at, m.run_id) as sequence
from m
join contents k on k.location_id = m.location_id and k.order_guid = m.order_guid and k.modified_at is not distinct from m.modified_at
group by m.location_id, m.order_guid, m.modified_at, k.contents
order by kind, location_id, order_guid, modified_at;

-- @query inserts
-- Metric B (inserts). Every snapshot FIRST SEEN in W (first membership's run start), per (shop, Toast
-- business day), classed against the same order's earlier snapshots:
--   churn              = an earlier snapshot with the same modified_at AND equal stored content was
--                        first seen INSIDE W (must be 0)
--   transition         = an earlier snapshot with the same modified_at AND equal stored content was first
--                        seen BEFORE W (the one allowed legacy -> canonical step, expected only in the
--                        first windows after deploy)
--   edit_same_modified = earlier snapshots with this modified_at exist, none with equal stored content
--                        (a real Toast edit that left modified_at unchanged, e.g. payment capture)
--   edit               = earlier snapshots exist, none with this modified_at (a real Toast edit)
--   new_order          = no earlier snapshot
-- SCOPED: first_seen is computed only for (a) snapshots with a membership in a run started in W (every
-- snapshot first seen in W has one) and (b) every snapshot of the same (shop, order) as a snapshot
-- first seen in W (the only rows the EXISTS clauses can match). A snapshot's min(started_at) does not
-- depend on which other snapshots are grouped, so the result equals the whole-table form, which
-- exceeded the Management API's ~120 s gateway on prod (the test proves the equality on fixtures).
-- (No line of these comments ends in a semicolon: the test splits statements on one.)
-- The expected change of B0 (f) for a (shop, day) = transition + edit_same_modified + edit + new_order.
with cand as (
  select distinct ro.snapshot_id
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  where r.started_at >= :w_from::timestamptz and r.started_at < :w_to::timestamptz
), cand_fs as (
  select ro.snapshot_id, min(r.started_at) as first_seen
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  where ro.snapshot_id in (select snapshot_id from cand) group by ro.snapshot_id
), fresh as (
  select o.id, o.location_id, o.order_guid, o.business_date, o.modified_at, f.first_seen
  from public.toast_orders o join cand_fs f on f.snapshot_id = o.id
  where f.first_seen >= :w_from::timestamptz and f.first_seen < :w_to::timestamptz
), peer_ids as (
  select p.id
  from public.toast_orders p join (select distinct location_id, order_guid from fresh) k
    on k.location_id = p.location_id and k.order_guid = p.order_guid
), first_seen as (
  select ro.snapshot_id, min(r.started_at) as first_seen
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  where ro.snapshot_id in (select id from peer_ids) group by ro.snapshot_id
), content_ids as (
  select distinct p.id
  from public.toast_orders p join fresh fr
    on fr.location_id = p.location_id and fr.order_guid = p.order_guid and p.modified_at is not distinct from fr.modified_at
), content as (
  select o.id, jsonb_build_object(
    'order', to_jsonb(o) - 'id' - 'content_hash' - 'selection_units',
    'selection_units', (select coalesce(jsonb_agg(u order by u::text), '[]'::jsonb) from jsonb_array_elements(o.selection_units) u),
    'checks', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
               from (select to_jsonb(c) - 'snapshot_id' as x from public.toast_order_checks c where c.snapshot_id = o.id) c),
    'discounts', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                  from (select to_jsonb(d) - 'snapshot_id' - 'ordinal' as x from public.toast_check_discounts d where d.snapshot_id = o.id) d),
    'service_charges', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                        from (select to_jsonb(s) - 'snapshot_id' - 'ordinal' as x from public.toast_check_service_charges s where s.snapshot_id = o.id) s),
    'payments', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                 from (select to_jsonb(p) - 'snapshot_id' as x from public.toast_payments p where p.snapshot_id = o.id) p)
  ) as content
  from public.toast_orders o
  where o.id in (select id from content_ids)
), classed as (
  select fr.location_id, fr.business_date,
    case
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id join content pc on pc.id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id) and p.modified_at is not distinct from fr.modified_at
                     and pf.first_seen >= :w_from::timestamptz and pc.content = fc.content) then 'churn'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id join content pc on pc.id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and pf.first_seen < :w_from::timestamptz and p.modified_at is not distinct from fr.modified_at
                     and pc.content = fc.content) then 'transition'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id) and p.modified_at is not distinct from fr.modified_at) then 'edit_same_modified'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id)) then 'edit'
      else 'new_order'
    end as kind
  from fresh fr join content fc on fc.id = fr.id
)
select location_id, business_date,
       count(*) filter (where kind = 'transition') as transition,
       count(*) filter (where kind = 'churn') as churn,
       count(*) filter (where kind = 'edit_same_modified') as edit_same_modified,
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
