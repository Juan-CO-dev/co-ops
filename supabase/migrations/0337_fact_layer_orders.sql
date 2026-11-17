-- Migration 0337_fact_layer_orders
-- AUTHORED 2026-11-17 (item 2 PR 2a, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Plan: C:\co\audit\item2-plan-r3-orders.md (Astra r3: no P1) with Astra r3's two P2s folded in
-- (C:\co\audit\item2-astra-r3.md):
--   P2 #1  a zero-check order is valid: the replace RPC proves completeness against an explicit ORDER
--          MANIFEST (fact_order_snapshot), never against the fact rows, so an order with no check
--          (capture accepts checks: []) is published as a manifest row and the day is not refused.
--   P2 #2  the phase-2 line-price attachment table does NOT exist: line money comes only from the
--          snapshot's own inline fields (TOAST_LINE_PRICES); otherwise 'not covered' (null), never 0.
--          The fingerprint carries an attachment slot ('a:inline'); phase 2 re-emits
--          fact_order_day_fingerprint with the attachment digest AND bumps the builder version, which
--          changes every day's fingerprint, so the diff rebuilds everything under the new source.
-- ORDER side only (2a + 2b). Labor (2c) is not here.
--
-- WHAT A FACT DAY IS. A pure function of: the day's pointer set (order_guid:snapshot_id), the
-- immutable snapshots and children (0221: inserted ON CONFLICT DO NOTHING, children only when new),
-- the latest COMPLETED run (id, orders) chosen as the reader does (finished_at desc, id desc), that
-- run's membership (fixed once finished), and the builder version. fact_order_day_fingerprint is the
-- ONE definition; the diff and the replace RPC both call it.
-- NO TRIGGER, NO QUEUE, NO LOCK ON THE CAPTURE PATH (r3 P1 #2). Capture writes nothing here and locks
-- nothing here. The builder takes only a per-day advisory lock, then its own fact rows, then its own
-- coverage row; it READS pointers, runs and snapshots without locking them. 0237's 1 s lock_timeout
-- can never be tripped by this layer. A capture that commits mid-build leaves a stale fingerprint; the
-- next hourly diff rebuilds the day.
-- G1 WRITER CENSUS (tests/fact-layer-writer-census.test.ts pins it): the only writers of the source
-- relations are 0221/0239's toast_capture_page + toast_capture_finish, 0237's toast_modified_save
-- (inserts a run, then flips it to 'modified_completed' -- never 'completed' coverage), 0222's claim and
-- lib/toast/capture.ts (run status / catering_status columns only, which the fingerprint does not read).
-- No in-place update of a snapshot column the facts read exists. 0312's voided_at is customer_orders,
-- not a snapshot.
-- FACTS NEVER FK toast_orders: the duplicate-snapshot cleanup deletes snapshots. A fact row names its
-- snapshot_id as a plain value; a deleted snapshot changes the pointer set, so the day rebuilds.
-- DERIVED ROWS: rebuilt, never appended to (like par_auto_moves' non-'applied' rows). Written ONLY by
-- fact_replace_order_day (definer, owner). service_role holds SELECT only; DELETE/TRUNCATE asserted absent.
-- No names, no jsonb, no customer field in any fact table. Classification (sales_report_class, the
-- ezCater link, the channel map) is applied at READ time by the two read helpers below.
-- DOUBLE-COUNT LAW: the facts hold Toast checks only. An ezCater-linked check is classed
-- 'ezcater_linked' at read time through ezcater_current_toast_links, exactly as sales_report_facts does.
-- Portal / house catering orders have NO Toast link today (see the PR body); they never enter these
-- facts, so a hand-rung portal order counts once, as its Toast check.
-- Cron: 'fact-build' joins 0300's six-job union (hourly :40, behind FACT_LAYER=1; not in JOBS_REGISTRY).
begin;

do $$ declare v_jobs text[]; begin
  if to_regclass('public.toast_order_latest_pointers') is null or to_regclass('public.toast_capture_runs') is null
    or to_regclass('public.toast_capture_run_orders') is null or to_regclass('public.toast_orders') is null
    or to_regclass('public.toast_order_checks') is null or to_regclass('public.toast_payments') is null
    or to_regclass('public.toast_dining_options') is null or to_regclass('public.sales_channel_map') is null
    or to_regclass('public.ezcater_current_toast_links') is null then
    raise exception '0337: missing capture parents (0221/0229)'; end if;
  if to_regprocedure('public.sales_report_class(boolean,boolean,boolean,text,boolean)') is null
    or to_regprocedure('public.sales_report_assert_window(uuid,date,date)') is null then
    raise exception '0337: missing 0232 classifier / window guard'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='toast_order_checks' and column_name='accounting')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='toast_payments' and column_name='sales_refund_cents') then
    raise exception '0337: missing 0239 accounting columns'; end if;
  if to_regclass('public.fact_order_snapshot') is not null or to_regclass('public.fact_day_coverage') is not null then
    raise exception '0337: already applied'; end if;
  if to_regclass('public.cron_route_leases') is null or to_regprocedure('public.claim_cron_route(text)') is null then
    raise exception '0337: missing cron_route_leases / claim_cron_route'; end if;
  select array_agg(distinct m[1] order by m[1]) into v_jobs
    from pg_constraint c, lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z-]+)''', 'g') m
    where c.conrelid='public.cron_route_leases'::regclass and c.conname='cron_route_leases_job_check' and c.contype='c' and c.convalidated;
  if v_jobs is distinct from array['catering-inbox-delivery','meta-leads','schedule-draft','sevenshifts-sync','toast-catering-scan','toast-sales-today']::text[] then
    raise exception '0337: cron_route_leases_job_check is not the 0300 six-job union (%)', v_jobs; end if;
end $$;

-- The ORDER MANIFEST (Astra r3 P2 #1): one row per order of the day's pointer set, zero-check orders included.
create table public.fact_order_snapshot (
 location_id uuid not null references public.locations(id),
 business_date date not null,
 order_guid text not null,
 snapshot_id uuid not null,
 run_member boolean not null,
 check_count integer not null check(check_count >= 0),
 primary key(location_id,business_date,order_guid)
);
create table public.fact_order_check (
 location_id uuid not null,
 business_date date not null,
 order_guid text not null,
 check_guid text not null,
 snapshot_id uuid not null,
 opened_at timestamptz, paid_at timestamptz, closed_at timestamptz, promised_at timestamptz,
 opened_quarter_start_at timestamptz, opened_wall_quarter smallint check(opened_wall_quarter between 0 and 95),
 opened_fold smallint check(opened_fold in (0,1)), opened_et_date date,
 promised_quarter_start_at timestamptz, promised_wall_quarter smallint check(promised_wall_quarter between 0 and 95),
 promised_fold smallint check(promised_fold in (0,1)), promised_et_date date,
 order_voided boolean not null, order_deleted boolean not null, check_voided boolean not null, check_deleted boolean not null,
 excess_food boolean not null,
 dining_option_guid text, server_guid text, source text, revenue_center_guid text,
 third_party_provider_guid text, third_party_provider_name text,
 amount_cents bigint, tax_cents bigint, total_cents bigint,
 gross_cents bigint, discounts_comps_cents bigint, voids_cents bigint, service_charges_cents bigint, pre_refund_cents bigint,
 line_price_state text not null check(line_price_state in ('inline','unpriced')),
 line_net_cents bigint,
 source_complete boolean, net_complete boolean, gross_complete boolean, receipt_line_complete boolean,
 primary key(location_id,business_date,order_guid,check_guid),
 foreign key(location_id,business_date,order_guid) references public.fact_order_snapshot(location_id,business_date,order_guid),
 -- Unknown is never 0: an unpriced check carries no line money and no completeness verdict.
 check(line_price_state='inline' or (line_net_cents is null and source_complete is null and net_complete is null
   and gross_complete is null and receipt_line_complete is null)),
 check(line_price_state='unpriced' or (source_complete is not null and net_complete is not null
   and gross_complete is not null and receipt_line_complete is not null))
);
create table public.fact_order_line (
 location_id uuid not null,
 business_date date not null,
 order_guid text not null,
 check_guid text not null,
 selection_guid text not null,
 parent_selection_guid text,
 is_head boolean not null,
 voided boolean not null, deleted boolean not null,
 toast_item_guid text not null,
 quantity numeric not null,
 price_state text not null check(price_state in ('inline','not_covered')),
 net_cents bigint, gross_cents bigint, receipt_line_cents bigint, tax_cents bigint, discount_cents bigint,
 tax_inclusion text, selection_type text, deferred boolean,
 primary key(location_id,business_date,order_guid,check_guid,selection_guid),
 foreign key(location_id,business_date,order_guid,check_guid) references public.fact_order_check(location_id,business_date,order_guid,check_guid),
 check(price_state='inline' or (net_cents is null and gross_cents is null and receipt_line_cents is null and tax_cents is null
   and tax_inclusion is null and selection_type is null and deferred is null)),
 check(not is_head or parent_selection_guid is null)
);
create table public.fact_refund (
 location_id uuid not null,
 order_business_date date not null,
 order_guid text not null,
 payment_guid text not null,
 check_guid text not null,
 snapshot_id uuid not null,
 refund_business_date date,
 refund_status text, payment_status text,
 refund_cents bigint, refund_tip_cents bigint, sales_refund_cents bigint,
 check_accounting_present boolean not null,
 order_voided boolean not null, order_deleted boolean not null, check_voided boolean not null, check_deleted boolean not null,
 excess_food boolean not null, dining_option_guid text,
 primary key(location_id,order_business_date,order_guid,payment_guid),
 foreign key(location_id,order_business_date,order_guid,check_guid) references public.fact_order_check(location_id,business_date,order_guid,check_guid)
);
create index fact_refund_refund_date on public.fact_refund(location_id,refund_business_date) where refund_business_date is not null;
create index fact_refund_undated on public.fact_refund(location_id,order_business_date) where refund_business_date is null;
create table public.fact_day_coverage (
 location_id uuid not null references public.locations(id),
 business_date date not null,
 fact text not null check(fact in ('orders')),
 source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{32}$'),
 builder_version text not null check(builder_version ~ '^orders-v[0-9]+$'),
 state text not null check(state in ('covered','covered_zero','uncovered')),
 run_id uuid, run_orders integer check(run_orders >= 0),
 pointer_count integer not null check(pointer_count >= 0),
 missing_pointer_count integer check(missing_pointer_count >= 0),
 order_count integer not null check(order_count >= 0),
 check_count integer not null check(check_count >= 0),
 line_count integer not null check(line_count >= 0),
 refund_count integer not null check(refund_count >= 0),
 checks_inline_priced integer not null, checks_source_complete integer not null, checks_net_complete integer not null,
 checks_gross_complete integer not null, checks_receipt_line_complete integer not null,
 built_at timestamptz not null default clock_timestamp(),
 primary key(location_id,business_date,fact),
 -- Coverage precedes numbers: no completed run = uncovered, never zero.
 check((state='uncovered') = (run_id is null)),
 check((run_id is null) = (run_orders is null) and (run_id is null) = (missing_pointer_count is null)),
 check(state <> 'covered_zero' or pointer_count = 0)
);

-- THE fingerprint. 'a:inline' = line prices come from the snapshots' inline fields only (P2 #2).
create function public.fact_order_day_fingerprint(p_location_id uuid, p_business_date date, p_builder_version text)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_pointers text; v_run text;
begin
  if p_location_id is null or p_business_date is null or p_builder_version is null then raise exception 'fact_invalid_request'; end if;
  select md5(string_agg(p.order_guid || ':' || p.snapshot_id::text, ',' order by p.order_guid)) into v_pointers
    from public.toast_order_latest_pointers p where p.location_id = p_location_id and p.business_date = p_business_date;
  select r.id::text || ':' || r.orders into v_run from public.toast_capture_runs r
    where r.location_id = p_location_id and r.business_date = p_business_date and r.status = 'completed'
    order by r.finished_at desc, r.id desc limit 1;
  return md5(concat_ws('|', 'v:' || p_builder_version, 'p:' || coalesce(v_pointers, 'none'), 'r:' || coalesce(v_run, 'none'), 'a:inline'));
end $$;

-- The diff: every candidate day before ET today whose stored fingerprint differs or is missing.
-- Evaluated against current state on every pass. Candidates (review r1 #1, BC-061/BC-031: an older
-- order's late refund must never leave its day stale forever):
--   a pointer or a completed run in [floor, today);
--   EVERY stored coverage row, whatever its age: a day once built stays maintained after the floor
--     passes it (a modified capture that re-snapshots it is rebuilt);
--   an order day OLDER than the floor whose CURRENT snapshot carries a refund that reaches the
--     maintained window: dated on or after the floor (toast_payments_refund_date, 0221), or undated
--     refund evidence (0247's predicate and partial index), which the refund reader counts on every
--     window day. The rebuild writes its fact_refund rows, so fact_sales_refund_rows sees it.
create function public.fact_order_days_stale(p_floor date, p_limit integer, p_builder_version text)
returns table(day_location_id uuid, day_business_date date, day_fingerprint text, stored_fingerprint text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_today date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if p_floor is null or p_limit is null or p_limit < 1 or p_limit > 5000 or p_builder_version is null then
    raise exception 'fact_invalid_request'; end if;
  return query
  with days as (
    select p.location_id l, p.business_date d from public.toast_order_latest_pointers p where p.business_date >= p_floor and p.business_date < v_today
    union
    select r.location_id, r.business_date from public.toast_capture_runs r where r.status = 'completed' and r.business_date >= p_floor and r.business_date < v_today
    union
    select c.location_id, c.business_date from public.fact_day_coverage c where c.fact = 'orders' and c.business_date < v_today
    union
    select p.location_id, p.business_date from public.toast_payments pm
      join public.toast_orders o on o.id = pm.snapshot_id
      join public.toast_order_latest_pointers p on p.location_id = o.location_id and p.order_guid = o.order_guid and p.snapshot_id = pm.snapshot_id
     where pm.refund_business_date >= p_floor and p.business_date < p_floor
    union
    select p.location_id, p.business_date from public.toast_payments pm
      join public.toast_orders o on o.id = pm.snapshot_id
      join public.toast_order_latest_pointers p on p.location_id = o.location_id and p.order_guid = o.order_guid and p.snapshot_id = pm.snapshot_id
     where pm.refund_business_date is null and pm.sales_refund_cents is distinct from 0
       and (pm.refund_amount_cents is not null or pm.refund_status in ('PARTIAL', 'FULL'))
       and p.business_date < p_floor
  ), fp as (
    select days.l, days.d, public.fact_order_day_fingerprint(days.l, days.d, p_builder_version) f from days
  )
  select fp.l, fp.d, fp.f, c.source_fingerprint
    from fp left join public.fact_day_coverage c on c.location_id = fp.l and c.business_date = fp.d and c.fact = 'orders'
   where c.source_fingerprint is distinct from fp.f
   order by fp.d desc, fp.l
   limit p_limit;
end $$;

-- The ONE writer. Advisory day lock -> this day's fact rows -> this day's coverage row.
create function public.fact_replace_order_day(p_location_id uuid, p_business_date date, p_builder_version text, p_fingerprint text,
  p_orders jsonb, p_checks jsonb, p_lines jsonb, p_refunds jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_today date := (clock_timestamp() at time zone 'America/New_York')::date;
  v_run_id uuid; v_run_orders integer; v_pointer_count integer; v_missing integer; v_state text;
  v_orders jsonb; v_checks jsonb; v_lines jsonb; v_refunds jsonb; v_cov public.fact_day_coverage%rowtype;
  v_stamp jsonb := jsonb_build_object('location_id', p_location_id, 'business_date', p_business_date);
begin
  if p_location_id is null or p_business_date is null or p_builder_version is null or p_fingerprint is null
    or jsonb_typeof(p_orders) is distinct from 'array' or jsonb_typeof(p_checks) is distinct from 'array'
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_typeof(p_refunds) is distinct from 'array' then
    raise exception 'fact_invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fact:orders:' || p_location_id::text || ':' || p_business_date::text, 0));
  if p_business_date >= v_today then raise exception 'fact_open_day'; end if;
  if public.fact_order_day_fingerprint(p_location_id, p_business_date, p_builder_version) is distinct from p_fingerprint then
    raise exception 'fact_stale'; end if;
  -- The manifest IS the pointer set, both ways, no duplicates (zero-check orders included).
  if (select count(*) from jsonb_array_elements(p_orders))
       <> (select count(*) from public.toast_order_latest_pointers where location_id = p_location_id and business_date = p_business_date)
    or exists (select x.order_guid, x.snapshot_id from jsonb_to_recordset(p_orders) x(order_guid text, snapshot_id uuid)
               except select p.order_guid, p.snapshot_id from public.toast_order_latest_pointers p
               where p.location_id = p_location_id and p.business_date = p_business_date)
    or exists (select p.order_guid, p.snapshot_id from public.toast_order_latest_pointers p
               where p.location_id = p_location_id and p.business_date = p_business_date
               except select x.order_guid, x.snapshot_id from jsonb_to_recordset(p_orders) x(order_guid text, snapshot_id uuid)) then
    raise exception 'fact_stale'; end if;
  -- The checks ARE the manifest snapshots' checks, both ways, each under its own order.
  if (select count(*) from jsonb_array_elements(p_checks))
       <> (select count(*) from public.toast_order_checks c join jsonb_to_recordset(p_orders) x(order_guid text, snapshot_id uuid) on x.snapshot_id = c.snapshot_id)
    or exists (select x.order_guid, x.snapshot_id, x.check_guid from jsonb_to_recordset(p_checks) x(order_guid text, snapshot_id uuid, check_guid text)
               except select o.order_guid, c.snapshot_id, c.check_guid from public.toast_order_checks c
               join jsonb_to_recordset(p_orders) o(order_guid text, snapshot_id uuid) on o.snapshot_id = c.snapshot_id)
    or exists (select x.order_guid from jsonb_to_recordset(p_orders) x(order_guid text, snapshot_id uuid, check_count integer)
               where x.check_count is distinct from (select count(*) from public.toast_order_checks c where c.snapshot_id = x.snapshot_id))
    or exists (select 1 from jsonb_to_recordset(p_refunds) r(order_guid text, snapshot_id uuid)
               where not exists (select 1 from jsonb_to_recordset(p_orders) o(order_guid text, snapshot_id uuid)
                                 where o.order_guid = r.order_guid and o.snapshot_id = r.snapshot_id)) then
    raise exception 'fact_payload_mismatch'; end if;

  select r.id, r.orders into v_run_id, v_run_orders from public.toast_capture_runs r
    where r.location_id = p_location_id and r.business_date = p_business_date and r.status = 'completed'
    order by r.finished_at desc, r.id desc limit 1;
  select coalesce(jsonb_agg(e || v_stamp || jsonb_build_object('run_member', v_run_id is not null and exists (
           select 1 from public.toast_capture_run_orders ro where ro.run_id = v_run_id and ro.order_guid = e->>'order_guid'))), '[]'::jsonb)
    into v_orders from jsonb_array_elements(p_orders) e;
  select coalesce(jsonb_agg(e || v_stamp), '[]'::jsonb) into v_checks from jsonb_array_elements(p_checks) e;
  select coalesce(jsonb_agg(e || v_stamp), '[]'::jsonb) into v_lines from jsonb_array_elements(p_lines) e;
  select coalesce(jsonb_agg(e || jsonb_build_object('location_id', p_location_id, 'order_business_date', p_business_date)), '[]'::jsonb)
    into v_refunds from jsonb_array_elements(p_refunds) e;

  delete from public.fact_refund where location_id = p_location_id and order_business_date = p_business_date;
  delete from public.fact_order_line where location_id = p_location_id and business_date = p_business_date;
  delete from public.fact_order_check where location_id = p_location_id and business_date = p_business_date;
  delete from public.fact_order_snapshot where location_id = p_location_id and business_date = p_business_date;
  insert into public.fact_order_snapshot select * from jsonb_populate_recordset(null::public.fact_order_snapshot, v_orders);
  insert into public.fact_order_check select * from jsonb_populate_recordset(null::public.fact_order_check, v_checks);
  insert into public.fact_order_line select * from jsonb_populate_recordset(null::public.fact_order_line, v_lines);
  insert into public.fact_refund select * from jsonb_populate_recordset(null::public.fact_refund, v_refunds);

  select count(*) into v_pointer_count from public.toast_order_latest_pointers where location_id = p_location_id and business_date = p_business_date;
  if v_run_id is not null then
    select count(*) into v_missing from public.fact_order_snapshot where location_id = p_location_id and business_date = p_business_date and not run_member;
  end if;
  v_state := case when v_run_id is null then 'uncovered' when v_pointer_count = 0 then 'covered_zero' else 'covered' end;
  insert into public.fact_day_coverage as cov(location_id, business_date, fact, source_fingerprint, builder_version, state, run_id, run_orders,
    pointer_count, missing_pointer_count, order_count, check_count, line_count, refund_count, checks_inline_priced, checks_source_complete,
    checks_net_complete, checks_gross_complete, checks_receipt_line_complete, built_at)
  select p_location_id, p_business_date, 'orders', p_fingerprint, p_builder_version, v_state, v_run_id, v_run_orders, v_pointer_count, v_missing,
    jsonb_array_length(p_orders), count(*), jsonb_array_length(p_lines), jsonb_array_length(p_refunds),
    count(*) filter (where c.line_price_state = 'inline'), count(*) filter (where c.source_complete),
    count(*) filter (where c.net_complete), count(*) filter (where c.gross_complete), count(*) filter (where c.receipt_line_complete), clock_timestamp()
  from public.fact_order_check c where c.location_id = p_location_id and c.business_date = p_business_date
  on conflict (location_id, business_date, fact) do update set source_fingerprint = excluded.source_fingerprint,
    builder_version = excluded.builder_version, state = excluded.state, run_id = excluded.run_id, run_orders = excluded.run_orders,
    pointer_count = excluded.pointer_count, missing_pointer_count = excluded.missing_pointer_count, order_count = excluded.order_count,
    check_count = excluded.check_count, line_count = excluded.line_count, refund_count = excluded.refund_count,
    checks_inline_priced = excluded.checks_inline_priced, checks_source_complete = excluded.checks_source_complete,
    checks_net_complete = excluded.checks_net_complete, checks_gross_complete = excluded.checks_gross_complete,
    checks_receipt_line_complete = excluded.checks_receipt_line_complete, built_at = excluded.built_at
  returning * into v_cov;
  return jsonb_build_object('state', v_cov.state, 'orders', v_cov.order_count, 'checks', v_cov.check_count,
    'lines', v_cov.line_count, 'refunds', v_cov.refund_count, 'missing_pointer_count', v_cov.missing_pointer_count);
end $$;

-- READ helpers (parity probe and later rollups). Classification at READ time through THE classifier,
-- the reviewed channel map and the ezCater link, exactly as sales_report_facts (0232) and 0247's refunds.
create function public.fact_sales_check_classes(p_location_id uuid, p_from date, p_to date)
returns table(business_date date, order_guid text, check_guid text, sale_class text, amount_cents bigint, tax_cents bigint,
  gross_cents bigint, discounts_comps_cents bigint, voids_cents bigint, service_charges_cents bigint, pre_refund_cents bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  return query
  select f.business_date, f.order_guid, f.check_guid,
    public.sales_report_class(f.order_voided or f.check_voided, f.excess_food, m.reviewed_at is not null, m.provider, lk.check_guid is not null),
    f.amount_cents, f.tax_cents, f.gross_cents, f.discounts_comps_cents, f.voids_cents, f.service_charges_cents, f.pre_refund_cents
  from public.fact_order_check f
  left join public.toast_dining_options d on d.location_id = f.location_id and d.guid = f.dining_option_guid
  left join public.sales_channel_map m on m.dining_option_label = d.name
  left join (select distinct l.toast_snapshot_id, l.check_guid from public.ezcater_current_toast_links l
              where l.location_id = p_location_id and l.business_date between p_from and p_to) lk
    on lk.toast_snapshot_id = f.snapshot_id and lk.check_guid = f.check_guid
  where f.location_id = p_location_id and f.business_date between p_from and p_to
    and not f.order_deleted and not f.check_deleted;
end $$;

create function public.fact_sales_refund_rows(p_location_id uuid, p_from date, p_to date)
returns table(order_business_date date, refund_business_date date, refund_cents bigint, refund_tip_cents bigint, sales_refund_cents bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  return query
  select r.order_business_date, r.refund_business_date, r.refund_cents, r.refund_tip_cents, r.sales_refund_cents
  from public.fact_refund r
  left join public.toast_dining_options d on d.location_id = r.location_id and d.guid = r.dining_option_guid
  left join public.sales_channel_map m on m.dining_option_label = d.name
  where r.location_id = p_location_id
    and (r.refund_business_date between p_from and p_to or (r.refund_business_date is null and r.order_business_date <= p_to))
    and not r.order_deleted and not r.check_deleted
    and public.sales_report_class(r.order_voided or r.check_voided, r.excess_food, m.reviewed_at is not null, m.provider,
          exists (select 1 from public.ezcater_current_toast_links l where l.location_id = p_location_id
                   and l.business_date = r.order_business_date and l.toast_snapshot_id = r.snapshot_id and l.check_guid = r.check_guid)) = 'sale';
end $$;

-- The 0300 lease body with 'fact-build' added; no job is dropped.
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check(job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build'));
create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build') then raise exception 'invalid_cron_route'; end if;
  insert into public.cron_route_leases(job,lease_until) values(p_job,clock_timestamp()+interval '330 seconds')
  on conflict(job) do update set lease_until=clock_timestamp()+interval '330 seconds'
    where cron_route_leases.lease_until<=clock_timestamp() returning job into claimed;
  return claimed is not null;
end $$;

-- Ceilings: deny-all RLS, explicit DELETE denial, service_role SELECT only.
do $$ declare t text; f regprocedure; begin
  foreach t in array array['fact_order_snapshot','fact_order_check','fact_order_line','fact_refund','fact_day_coverage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  foreach f in array array[
    'public.fact_order_day_fingerprint(uuid,date,text)'::regprocedure,
    'public.fact_order_days_stale(date,integer,text)'::regprocedure,
    'public.fact_replace_order_day(uuid,date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.fact_sales_check_classes(uuid,date,date)'::regprocedure,
    'public.fact_sales_refund_rows(uuid,date,date)'::regprocedure,
    'public.claim_cron_route(text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare t text; f regprocedure; p text; begin
  foreach t in array array['fact_order_snapshot','fact_order_check','fact_order_line','fact_refund','fact_day_coverage'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0337: % lacks service_role SELECT', t; end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception '0337: service_role holds % on %', p, t; end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0337: PostgREST role holds % on %', p, t; end if;
    end loop;
  end loop;
  if exists(select 1 from information_schema.role_table_grants where table_schema='public'
     and table_name in ('fact_order_snapshot','fact_order_check','fact_order_line','fact_refund','fact_day_coverage')
     and (grantee in ('PUBLIC','anon','authenticated') or (grantee='service_role' and privilege_type <> 'SELECT'))) then
    raise exception '0337: unexpected fact table grant'; end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public'
     and routine_name in ('fact_order_day_fingerprint','fact_order_days_stale','fact_replace_order_day','fact_sales_check_classes','fact_sales_refund_rows','claim_cron_route')
     and grantee in ('PUBLIC','anon','authenticated')) then raise exception '0337: unexpected RPC grant'; end if;
  foreach f in array array[
    'public.fact_order_day_fingerprint(uuid,date,text)'::regprocedure,
    'public.fact_order_days_stale(date,integer,text)'::regprocedure,
    'public.fact_replace_order_day(uuid,date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.fact_sales_check_classes(uuid,date,date)'::regprocedure,
    'public.fact_sales_refund_rows(uuid,date,date)'::regprocedure,
    'public.claim_cron_route(text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0337: RPC escape %', f; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
