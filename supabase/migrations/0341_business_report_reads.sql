-- Migration 0341_business_report_reads
-- AUTHORED 2026-11-17 (item 9 PR 9a, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Number: 0340 is taken by the payroll-shop WIP (e6f8ae17, 0340_labor_payroll_shop.sql), so this is 0341.
-- Apply AFTER 0337, 0338 and 0339 (all applied to prod 2026-11-17). Ships DARK: the app reads these only with
-- BUSINESS_REPORT=1 AND FACT_LAYER=1 AND FACT_LAYER_LABOR=1 (lib/business-report.ts), authorized before any call.
-- Plan: CHIEF item-09-FULL-REPORT-PLAN-r2.md (9a) + Astra r2 per CC's rulings.
--
-- READ-ONLY. No table, column, index, trigger or data change. Three STABLE definer reads over the ORDER and
-- LABOR facts, each bounded by one shop + a <= 31-day window (0232's sales_report_assert_window), executable
-- by service_role only:
--
--   business_report_check_cuts(shop, from, to)
--     Toast checks aggregated per (business date, OPENED quarter, channel, provider, the ORDER's server,
--     class). Classification at READ time through THE classifier (sales_report_class), the reviewed channel
--     map and ezcater_current_toast_links, exactly as 0337's fact_sales_check_classes and 0232's
--     sales_report_facts: an ezCater-linked Toast ring is 'ezcater_linked' and never a sale (double-count law).
--     Channel / provider derivation is 0232's sales_report_facts verbatim. Server label = 0248's rule (the
--     Toast FIRST name from this window's time entries, +-1 day, else the linked user's first name). Checks
--     over $5,000 are counted inside every total AND flagged (large_checks / large_cents; Juan's default).
--     The app recomposes these to sales_report_daily's day before showing any cut.
--   business_report_labor_quarters(shop, from, to, wage fallback)
--     Worked minutes per quarter (hourly, salaried presence) and the quarter's STRAIGHT-TIME hourly cost,
--     priced with fact_labor_cost's own rate rule (0339 `priced` CTE, copied verbatim and pinned by
--     tests/business-report-0341-migration.test.ts). Overtime is never spread to a quarter (it belongs to the
--     week: the day and week figures come from fact_labor_cost itself).
--   business_report_labor_people(shop, from, to, wage fallback)
--     Minutes, overtime minutes and straight-time cost per (payroll week, person, role, source, pay class).
--     The app shows minutes to a GM and cost only where lib/facts/labor-cost-shared.ts PERSON_COST_MIN allows
--     (MoO+ by default), and withholds overtime / cost of any week not rebuilt per shop (0339 ot_scope).
--     No wage RATE leaves: only sums of minutes x rate. No contact field.
begin;

do $$ begin
  if to_regclass('public.fact_order_check') is null or to_regprocedure('public.fact_sales_check_classes(uuid,date,date)') is null then
    raise exception '0341: apply 0337 (order facts) first'; end if;
  if to_regclass('public.labor_quarter') is null or to_regprocedure('public.fact_labor_cost(uuid,date,date,text)') is null then
    raise exception '0341: apply 0338 (labor facts) first'; end if;
  if to_regprocedure('public.fact_labor_ot_scope()') is null
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'labor_week_coverage' and column_name = 'ot_scope') then
    raise exception '0341: apply 0339 (overtime per shop) first'; end if;
  if to_regprocedure('public.sales_report_assert_window(uuid,date,date)') is null or to_regprocedure('public.sales_report_class(boolean,boolean,boolean,text,boolean)') is null then
    raise exception '0341: missing 0232 classifier / window guard'; end if;
  if to_regprocedure('public.business_report_check_cuts(uuid,date,date)') is not null then raise exception '0341: already applied'; end if;
end $$;

create function public.business_report_check_cuts(p_location_id uuid, p_from date, p_to date)
returns table(business_date date, quarter_start_at timestamptz, wall_quarter smallint, fold smallint, et_date date,
  channel text, provider text, server_guid text, server_label text, sale_class text,
  checks bigint, amount_cents bigint, amount_missing bigint, large_checks bigint, large_cents bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  return query
  with names as (
    select distinct on (t.employee_guid) t.employee_guid, t.employee_first_name
      from public.toast_time_entries t
     where t.location_id = p_location_id and t.business_date between p_from - 1 and p_to + 1
       and t.employee_first_name is not null and not t.deleted
     order by t.employee_guid, t.in_at desc
  ), f as (
    select c.business_date bd, c.opened_quarter_start_at qs, c.opened_wall_quarter wq, c.opened_fold fd, c.opened_et_date ed,
      case when m.reviewed_at is null or m.channel = 'Unknown' then 'unknown'
           when m.provider = 'gift_card' then 'gift_card'
           else m.channel end ch,
      case when m.reviewed_at is null or m.channel = 'Unknown' then null
           when m.channel = 'third_party' then coalesce(nullif(btrim(c.third_party_provider_name), ''), m.provider)
           else m.provider end pv,
      c.server_guid sg,
      public.sales_report_class(c.order_voided or c.check_voided, c.excess_food, m.reviewed_at is not null, m.provider, lk.check_guid is not null) sc,
      c.amount_cents amt
    from public.fact_order_check c
    left join public.toast_dining_options d on d.location_id = c.location_id and d.guid = c.dining_option_guid
    left join public.sales_channel_map m on m.dining_option_label = d.name
    left join (select distinct l.toast_snapshot_id, l.check_guid from public.ezcater_current_toast_links l
                where l.location_id = p_location_id and l.business_date between p_from and p_to) lk
      on lk.toast_snapshot_id = c.snapshot_id and lk.check_guid = c.check_guid
    where c.location_id = p_location_id and c.business_date between p_from and p_to
      and not c.order_deleted and not c.check_deleted
  )
  select f.bd, f.qs, f.wq, f.fd, f.ed, f.ch, f.pv, f.sg,
    max(coalesce(n.employee_first_name, substring(u.name from '\S+'))),
    f.sc, count(*)::bigint, coalesce(sum(f.amt), 0)::bigint, (count(*) filter (where f.amt is null))::bigint,
    (count(*) filter (where f.amt > 500000))::bigint, coalesce(sum(f.amt) filter (where f.amt > 500000), 0)::bigint
  from f
  left join names n on n.employee_guid = f.sg
  left join public.toast_employee_links el on el.location_id = p_location_id and el.employee_guid = f.sg and el.active
  left join public.users u on u.id = el.user_id
  group by f.bd, f.qs, f.wq, f.fd, f.ed, f.ch, f.pv, f.sg, f.sc
  order by f.bd, f.qs nulls last, f.ch, f.pv nulls first, f.sg nulls first, f.sc;
end $$;

-- The rate a labor_quarter row is priced at: fact_labor_cost's rule (0339 `priced` CTE), verbatim.
create function public.business_report_labor_quarters(p_location_id uuid, p_from date, p_to date, p_wage_fallback text)
returns table(business_date date, week_start date, quarter_start_at timestamptz, wall_quarter smallint, fold smallint,
  minutes bigint, hourly_minutes bigint, salaried_minutes bigint, straight_cents bigint, estimated_minutes bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_wage_fallback is null or p_wage_fallback not in ('first_known', 'dc_minimum') then raise exception 'fact_invalid_request'; end if;
  return query
  with priced as (
    select q.business_date bd, q.week_start ws, q.quarter_start_at qs, q.wall_quarter wq, q.fold fd, q.minutes m, q.pay_class pc,
      case when q.pay_class = 'salaried' then null
           when q.rate_basis in ('known', 'undated') then q.rate_cents
           when q.rate_basis = 'before_first_known' and p_wage_fallback = 'first_known' then q.carry_back_rate_cents
           else coalesce(s.estimated_hourly_cents, 1840) end rate,
      q.pay_class = 'hourly' and (q.rate_basis = 'none' or (q.rate_basis = 'before_first_known' and p_wage_fallback = 'dc_minimum')) est
    from public.labor_quarter q left join public.schedule_shop_settings s on s.location_id = q.location_id
    where q.location_id = p_location_id and q.business_date between p_from and p_to
  )
  select p.bd, min(p.ws), p.qs, min(p.wq)::smallint, min(p.fd)::smallint,
    sum(p.m)::bigint, coalesce(sum(p.m) filter (where p.pc = 'hourly'), 0)::bigint, coalesce(sum(p.m) filter (where p.pc = 'salaried'), 0)::bigint,
    round(coalesce(sum(p.m * p.rate) filter (where p.pc = 'hourly'), 0) / 60.0)::bigint,
    coalesce(sum(p.m) filter (where p.est), 0)::bigint
  from priced p
  group by p.bd, p.qs
  order by p.qs;
end $$;

create function public.business_report_labor_people(p_location_id uuid, p_from date, p_to date, p_wage_fallback text)
returns table(week_start date, person_key text, user_id uuid, person_label text, role_key bigint, source text, pay_class text,
  minutes bigint, ot_minutes bigint, straight_cents bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_wage_fallback is null or p_wage_fallback not in ('first_known', 'dc_minimum') then raise exception 'fact_invalid_request'; end if;
  return query
  with priced as (
    select q.week_start ws, q.person_key pk, q.user_id uid, q.role_key rk, q.source src, q.pay_class pc, q.minutes m, q.ot_minutes ot,
      case when q.pay_class = 'salaried' then null
           when q.rate_basis in ('known', 'undated') then q.rate_cents
           when q.rate_basis = 'before_first_known' and p_wage_fallback = 'first_known' then q.carry_back_rate_cents
           else coalesce(s.estimated_hourly_cents, 1840) end rate
    from public.labor_quarter q left join public.schedule_shop_settings s on s.location_id = q.location_id
    where q.location_id = p_location_id and q.business_date between p_from and p_to
  ), names as (
    select distinct on (t.employee_guid) t.employee_guid, t.employee_first_name
      from public.toast_time_entries t
     where t.location_id = p_location_id and t.business_date between p_from - 1 and p_to + 1
       and t.employee_first_name is not null and not t.deleted
     order by t.employee_guid, t.in_at desc
  )
  select p.ws, p.pk, p.uid,
    max(coalesce(substring(u.name from '\S+'), n.employee_first_name)),
    p.rk, p.src, p.pc, sum(p.m)::bigint, sum(p.ot)::bigint,
    case when p.pc = 'hourly' then round(coalesce(sum(p.m * p.rate), 0) / 60.0)::bigint end
  from priced p
  left join public.users u on u.id = p.uid
  left join names n on p.pk = 'toast:' || n.employee_guid
  group by p.ws, p.pk, p.uid, p.rk, p.src, p.pc
  order by p.ws, p.pk, p.rk, p.src, p.pc;
end $$;

-- CEILINGS: service_role EXECUTE only (the staff JWT is a PostgREST bearer, 0189); proved below.
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.business_report_check_cuts(uuid,date,date)'::regprocedure,
    'public.business_report_labor_quarters(uuid,date,date,text)'::regprocedure,
    'public.business_report_labor_people(uuid,date,date,text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.business_report_check_cuts(uuid,date,date)'::regprocedure,
    'public.business_report_labor_quarters(uuid,date,date,text)'::regprocedure,
    'public.business_report_labor_people(uuid,date,date,text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0341: RPC escape %', f; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
