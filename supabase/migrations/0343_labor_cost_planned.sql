-- Migration 0343_labor_cost_planned
-- AUTHORED 2026-11-18 (board two labor views PR 1, CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Apply AFTER 0340 (labor_payroll_shops; labor-v3 deployed). Nothing reads the new function until SCHEDULE_LABOR_VIEWS=1.
-- Plan: CHIEF item-02-BOARD-TWO-VIEWS-PLAN-r4.md, with Astra r4's P1 + P2 per CC's rulings (the projected readiness
-- and the projected denominator live in the shared TS contract, lib/facts/labor-cost-shared.ts and
-- lib/business-report-shared.ts; SQL returns components and counts only, as before).
--
-- WHY. The schedule board must stop pricing labor itself: a projected day and the same day once settled must run
-- through ONE SQL body and ONE TS pricer. So fact_labor_cost's body (0340) moves into
--   fact_labor_cost_planned(p_location_id, p_from, p_to, p_wage_fallback, p_plan jsonb)
-- and the public fact_labor_cost(uuid, date, date, text) keeps its signature and its 23 columns and calls it with
-- no plan. With no plan the answer is 0340's, row for row (tests/fact-labor-0343-migration.test.ts reads it
-- before and after this file on a built week).
--
-- THE PLAN (this shop only; every key optional, every value an array):
--   mask      the dates whose population IS the plan. A masked date drops EVERY labor_quarter row of this shop for
--             that date, every person (planned rows replace, never union: Astra r3 P1-1). A masked date with no
--             rows is a planned zero-hour day. Masked dates leave the coverage counts (covered / pending /
--             fallback / incomplete / missing / open punches) and are counted in the new days_planned.
--   rows      planned minutes: {person_key, business_date (in the mask), minutes, pay_class, rate_cents,
--             rate_basis, carry_back_rate_cents}: labor_quarter's own rate fields, priced by the same CASE.
--   ot        overtime minutes per (person_key, business_date) for every day FROM THE FIRST MASKED DATE of a
--             payroll week to its end, retained fact days included. From that date on, this shop's stored
--             ot_minutes are ignored and this list is used (the 40 h counter is chronological: replacing
--             Wednesday moves Thursday); the days BEFORE the week's first masked date keep their stored overtime
--             (nothing planned can reach back), so they stay the facts, byte for byte.
--             The caller counts it with the builder's own counter (lib/facts/labor-week-shared.ts createOtCounter).
--   salaried  {week_start, salaried_cents, salaried_people, unplaced_people, missing_wage_people} for this shop,
--             used ONLY for a week with no stored labor_week_salaried row (precedence: the shop's estimate, the
--             stored row, this row, unknown). It is allocateSalaried's row (lib/facts/labor-payroll-shared.ts),
--             coalesced into the same columns, so the share rounding and the three gap counts are 0340's.
--   only      the dates of [p_from, p_to] to price (a non-contiguous set: the board's "actual so far" and
--             "projected rest" are never blended). Absent = every date of the range. A week with none returns no row.
-- New OUT columns (planned function only): days_planned, salary_projected, and ot_planned = the row's days reach
-- the week's first masked date, so its overtime is (in part) the plan's count.
-- ot_state is still the STORED week's (a future week reads 'unbuilt'): what a projection may show is decided by
-- the shared pricer's projected readiness, never here.
-- Refused fact_invalid_request: a plan with p_location_id null, or while fact_labor_ot_scope() is not per_shop; a
-- malformed plan; a row outside the mask; a mask date outside the request's payroll weeks; an overtime entry
-- above that person-day's hourly minutes, before its week's first masked date, or twice; a salaried row that is not a
-- Sunday of the request, twice, or whose cents contradict its gap counts; `only` empty or outside the range.
--
-- NOT IN THIS FILE (plan r4 "Migration" step 2): the burden "follow the company" row. It changes
-- save_labor_burden's contract and ships with its route and card (PR 2), type-coupled, in its own migration.
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regclass('public.labor_payroll_shops');                                                    -- present (0340)
--   select to_regprocedure('public.fact_labor_cost_planned(uuid,date,date,text,jsonb)');                 -- null
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.fact_labor_cost(uuid,date,date,text)'::regprocedure; -- 1e1a7837cecca4af0da43395e5e79c49
begin;

do $$ declare v_live text; begin
  if to_regclass('public.labor_payroll_shops') is null or to_regprocedure('public.fact_labor_ot_scope()') is null then
    raise exception '0343: apply 0340 first'; end if;
  if to_regprocedure('public.fact_labor_cost_planned(uuid,date,date,text,jsonb)') is not null then raise exception '0343: already applied'; end if;
  -- The live body this file moves must be its 0340 definition (a later definer would be silently overwritten).
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p
   where p.oid = to_regprocedure('public.fact_labor_cost(uuid,date,date,text)');
  if v_live is distinct from '1e1a7837cecca4af0da43395e5e79c49' then
    raise exception '0343: the live body of public.fact_labor_cost(uuid,date,date,text) (md5 %) is not its 0340 definition -- a later definer exists; re-emit from it. Refusing.', v_live;
  end if;
end $$;

-- ── THE body (0340's fact_labor_cost, taking a plan) ────────────────────────────────────────────────
create function public.fact_labor_cost_planned(p_location_id uuid, p_from date, p_to date, p_wage_fallback text, p_plan jsonb)
returns table(week_start date, location_id uuid, hourly_straight_cents bigint, ot_premium_cents bigint, salaried_cents bigint,
  salary_basis text, burden_pct numeric, burden_basis text, estimated_rate_minutes bigint, hourly_minutes bigint, ot_minutes bigint,
  salaried_minutes bigint, ot_state text, range_days integer, days_covered integer, days_pending integer, days_fallback integer,
  days_incomplete integer, days_missing integer, open_punches integer,
  salaried_people integer, salary_unplaced_people integer, salary_missing_wage_people integer,
  days_planned integer, salary_projected boolean, ot_planned boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_floor date;
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_mask date[] := '{}'::date[]; v_plan_weeks date[] := '{}'::date[]; v_first date[] := '{}'::date[]; v_only date[];
  v_rows jsonb := '[]'::jsonb; v_ot jsonb := '[]'::jsonb; v_sal jsonb := '[]'::jsonb;
  v_w0 date; v_w1 date;
begin
  select floor_day into v_floor from public.fact_labor_constants();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_from < v_floor
    or p_wage_fallback is null or p_wage_fallback not in ('first_known', 'dc_minimum') then
    raise exception 'fact_invalid_request'; end if;
  -- The request's payroll weeks: the Sunday on or before p_from through the Saturday on or after p_to.
  v_w0 := p_from - extract(dow from p_from)::integer;
  v_w1 := p_to - extract(dow from p_to)::integer + 6;

  -- The plan: parsed and checked whole before anything is priced. Any shape or cast error is the one named refusal.
  if jsonb_typeof(v_plan) = 'null' then v_plan := '{}'::jsonb; end if;
  begin
    if jsonb_typeof(v_plan) <> 'object'
      or exists (select 1 from jsonb_each(v_plan) e where e.key not in ('mask', 'rows', 'ot', 'salaried', 'only') or jsonb_typeof(e.value) <> 'array') then
      raise exception 'fact_invalid_request'; end if;
    v_mask := array(select distinct (e #>> '{}')::date d from jsonb_array_elements(coalesce(v_plan -> 'mask', '[]'::jsonb)) e order by d);
    -- The payroll weeks that hold a masked date, and (same index) each one's FIRST masked date.
    v_plan_weeks := array(select distinct m - extract(dow from m)::integer w from unnest(v_mask) m order by w);
    v_first := array(select min(m) from unnest(v_mask) m group by m - extract(dow from m)::integer order by m - extract(dow from m)::integer);
    v_rows := coalesce(v_plan -> 'rows', '[]'::jsonb);
    v_ot := coalesce(v_plan -> 'ot', '[]'::jsonb);
    v_sal := coalesce(v_plan -> 'salaried', '[]'::jsonb);
    if v_plan ? 'only' then
      v_only := array(select distinct (e #>> '{}')::date d from jsonb_array_elements(v_plan -> 'only') e order by d);
    end if;
    if cardinality(v_mask) > 0 or jsonb_array_length(v_rows) > 0 or jsonb_array_length(v_ot) > 0 or jsonb_array_length(v_sal) > 0 or v_only is not null then
      -- A plan is one shop's, and its overtime is counted per shop (0339's scope in force).
      if p_location_id is null or public.fact_labor_ot_scope() <> 'per_shop' then raise exception 'fact_invalid_request'; end if;
    end if;
    if exists (select 1 from unnest(v_mask) m where m is null or m < v_w0 or m > v_w1)
      or (v_only is not null and (cardinality(v_only) = 0 or exists (select 1 from unnest(v_only) o where o is null or o < p_from or o > p_to))) then
      raise exception 'fact_invalid_request'; end if;
    -- Planned rows: on a masked date, with labor_quarter's own one-price-per-row rule.
    if exists (select 1 from jsonb_to_recordset(v_rows) r(person_key text, business_date date, minutes integer, pay_class text, rate_cents integer, rate_basis text, carry_back_rate_cents integer)
      where r.person_key is null or r.person_key !~ '^(u:[0-9a-f-]{36}|ss:[1-9][0-9]{0,17}|toast:.{1,64})$'
         or r.business_date is null or r.business_date <> all(v_mask)
         or r.minutes is null or r.minutes < 1 or r.minutes > 1440
         or r.pay_class is null or r.pay_class not in ('hourly', 'salaried')
         or r.rate_basis is null or r.rate_basis not in ('known', 'undated', 'before_first_known', 'none')
         or r.rate_cents < 0 or r.carry_back_rate_cents < 0
         or (r.pay_class = 'salaried' and (r.rate_cents is not null or r.carry_back_rate_cents is not null))
         or (r.pay_class = 'hourly' and ((r.rate_cents is not null) <> (r.rate_basis in ('known', 'undated'))
              or (r.carry_back_rate_cents is not null) <> (r.rate_basis = 'before_first_known')))) then
      raise exception 'fact_invalid_request'; end if;
    -- Overtime: only from its payroll week's first masked date on, once per person-day, never above that day's
    -- hourly minutes in the SELECTED population (the plan on a masked date, the facts on a retained one).
    if exists (select 1 from jsonb_to_recordset(v_ot) o(person_key text, business_date date, ot_minutes integer)
      where o.person_key is null or o.business_date is null or o.ot_minutes is null or o.ot_minutes < 0
         or (o.business_date - extract(dow from o.business_date)::integer) <> all(v_plan_weeks)
         or o.business_date < v_first[array_position(v_plan_weeks, o.business_date - extract(dow from o.business_date)::integer)]
         or o.ot_minutes > case when o.business_date = any(v_mask)
              then coalesce((select sum(r.minutes) from jsonb_to_recordset(v_rows) r(person_key text, business_date date, minutes integer, pay_class text)
                              where r.person_key = o.person_key and r.business_date = o.business_date and r.pay_class = 'hourly'), 0)
              else coalesce((select sum(q.minutes) from public.labor_quarter q
                              where q.location_id = p_location_id and q.business_date = o.business_date and q.person_key = o.person_key and q.pay_class = 'hourly'), 0) end)
      or exists (select 1 from jsonb_to_recordset(v_ot) o(person_key text, business_date date) group by o.person_key, o.business_date having count(*) > 1) then
      raise exception 'fact_invalid_request'; end if;
    -- Salaried rows: one per Sunday of the request, labor_week_salaried's own cents rule (never a partial total).
    if exists (select 1 from jsonb_to_recordset(v_sal) s(week_start date, salaried_cents bigint, salaried_people integer, unplaced_people integer, missing_wage_people integer)
      where s.week_start is null or extract(dow from s.week_start) <> 0 or s.week_start < v_w0 or s.week_start > v_w1
         or s.salaried_people is null or s.unplaced_people is null or s.missing_wage_people is null
         or s.salaried_people < 0 or s.unplaced_people < 0 or s.missing_wage_people < 0 or s.salaried_cents < 0
         or (s.salaried_cents is null) <> (s.salaried_people = 0 or s.unplaced_people > 0 or s.missing_wage_people > 0))
      or exists (select 1 from jsonb_to_recordset(v_sal) s(week_start date) group by s.week_start having count(*) > 1) then
      raise exception 'fact_invalid_request'; end if;
  exception when others then
    raise exception 'fact_invalid_request';
  end;

  return query
  with weeks as (
    select g::date w from generate_series(p_from - extract(dow from p_from)::integer, p_to, interval '7 days') g
  ), shops as (
    select l.id loc from public.locations l
     where l.id = p_location_id
        or (p_location_id is null and exists (select 1 from public.labor_day_coverage c where c.location_id = l.id and c.week_start in (select weeks.w from weeks)))
  ), priced as (
    -- The facts, minus this shop's masked dates; from a week's first masked date on, this shop's stored overtime
    -- is ignored (no plan week: the array lookup is NULL and the stored overtime stands).
    select q.week_start ws, q.location_id loc, q.person_key pk, q.business_date bd, q.minutes::integer m,
      case when q.location_id = p_location_id and q.business_date >= v_first[array_position(v_plan_weeks, q.week_start)] then 0 else q.ot_minutes::integer end ot, q.pay_class pc,
      case when q.pay_class = 'salaried' then null
           when q.rate_basis in ('known', 'undated') then q.rate_cents
           when q.rate_basis = 'before_first_known' and p_wage_fallback = 'first_known' then q.carry_back_rate_cents
           else coalesce(s.estimated_hourly_cents, 1840) end rate,
      q.pay_class = 'hourly' and (q.rate_basis = 'none' or (q.rate_basis = 'before_first_known' and p_wage_fallback = 'dc_minimum')) est,
      -- 0339: the employer the overtime belongs to: the shop on a per_shop week, nobody (company) otherwise.
      -- A week this shop plans is always counted per shop (the plan's overtime list is).
      case when wsc.ot_scope = 'company' and not (q.location_id = p_location_id and q.week_start = any(v_plan_weeks)) then null else q.location_id end emp
    from public.labor_quarter q left join public.schedule_shop_settings s on s.location_id = q.location_id
    left join public.labor_week_coverage wsc on wsc.week_start = q.week_start
    where q.week_start in (select weeks.w from weeks)
      and not (q.location_id = p_location_id and q.business_date = any(v_mask))
    union all
    -- The planned rows of the masked dates: the same rate CASE, this shop's estimate.
    select r.business_date - extract(dow from r.business_date)::integer, p_location_id, r.person_key, r.business_date, r.minutes, 0, r.pay_class,
      case when r.pay_class = 'salaried' then null
           when r.rate_basis in ('known', 'undated') then r.rate_cents
           when r.rate_basis = 'before_first_known' and p_wage_fallback = 'first_known' then r.carry_back_rate_cents
           else coalesce(s.estimated_hourly_cents, 1840) end,
      r.pay_class = 'hourly' and (r.rate_basis = 'none' or (r.rate_basis = 'before_first_known' and p_wage_fallback = 'dc_minimum')),
      p_location_id
    from jsonb_to_recordset(v_rows) r(person_key text, business_date date, minutes integer, pay_class text, rate_cents integer, rate_basis text, carry_back_rate_cents integer)
    left join public.schedule_shop_settings s on s.location_id = p_location_id
    union all
    -- The plan's overtime, as rows of no minutes (they add nothing to straight time or to the blended rate).
    select o.business_date - extract(dow from o.business_date)::integer, p_location_id, o.person_key, o.business_date, 0, o.ot_minutes, 'hourly',
      null::integer, false, p_location_id
    from jsonb_to_recordset(v_ot) o(person_key text, business_date date, ot_minutes integer)
  ), blended as (
    select priced.pk, priced.ws, priced.emp, sum(priced.m * priced.rate)::numeric / nullif(sum(priced.m), 0) r
      from priced where priced.pc = 'hourly' group by priced.pk, priced.ws, priced.emp
  ), agg as (
    select p.ws, p.loc,
      round(coalesce(sum(p.m * p.rate) filter (where p.pc = 'hourly'), 0) / 60.0)::bigint straight,
      round(coalesce(sum(0.5 * b.r * p.ot) filter (where p.pc = 'hourly'), 0) / 60.0)::bigint prem,
      coalesce(sum(p.m) filter (where p.est), 0)::bigint est_m,
      coalesce(sum(p.m) filter (where p.pc = 'hourly'), 0)::bigint hm,
      coalesce(sum(p.ot), 0)::bigint otm,
      coalesce(sum(p.m) filter (where p.pc = 'salaried'), 0)::bigint sm
    from priced p left join blended b on b.pk = p.pk and b.ws = p.ws and b.emp is not distinct from p.emp
    where p.bd between p_from and p_to and p.loc in (select shops.loc from shops)
      and (v_only is null or p.bd = any(v_only))
    group by p.ws, p.loc
  ), grid as (
    select weeks.w, shops.loc,
      case when v_only is null then (least(weeks.w + 6, p_to) - greatest(weeks.w, p_from) + 1)
           else (select count(*)::integer from unnest(v_only) o where o between greatest(weeks.w, p_from) and least(weeks.w + 6, p_to)) end rd,
      -- the last day this row prices (a masked date after it cannot reach its overtime)
      case when v_only is null then least(weeks.w + 6, p_to)
           else (select max(o) from unnest(v_only) o where o between greatest(weeks.w, p_from) and least(weeks.w + 6, p_to)) end last_day
    from weeks, shops
  )
  select g.w, g.loc, coalesce(a.straight, 0), coalesce(a.prem, 0),
    case when s.estimated_salaried_weekly_cents is not null then round(s.estimated_salaried_weekly_cents * g.rd / 7.0)::bigint
         when ws.salaried_cents is not null then round(ws.salaried_cents * g.rd / 7.0)::bigint end,
    case when s.estimated_salaried_weekly_cents is not null then 'estimate' when ws.salaried_cents is not null then 'wages'
         when ws.unplaced_people > 0 or ws.missing_wage_people > 0 then 'incomplete' else 'unknown' end,
    bf.burden_pct, bf.burden_basis,
    coalesce(a.est_m, 0), coalesce(a.hm, 0), coalesce(a.otm, 0), coalesce(a.sm, 0),
    coalesce(wc.ot_state, 'unbuilt'), g.rd,
    dc.covered, dc.pending, dc.fallback, dc.incomplete, g.rd - dp.n - dc.n, dc.open_n,
    coalesce(ws.salaried_people, 0), coalesce(ws.unplaced_people, 0), coalesce(ws.missing_wage_people, 0),
    dp.n, (s.estimated_salaried_weekly_cents is null and ws0.week_start is null and ps.week_start is not null),
    coalesce(v_first[array_position(v_plan_weeks, g.w)] <= g.last_day, false)
  from grid g
  left join agg a on a.ws = g.w and a.loc = g.loc
  left join public.schedule_shop_settings s on s.location_id = g.loc
  left join public.labor_week_salaried ws0 on ws0.week_start = g.w and ws0.location_id = g.loc
  -- The plan's salaried row, only for a week with no stored row (a stored NULL total is never replaced).
  left join jsonb_to_recordset(v_sal) ps(week_start date, salaried_cents bigint, salaried_people integer, unplaced_people integer, missing_wage_people integer)
    on ps.week_start = g.w and ws0.week_start is null
  cross join lateral (select
      case when ws0.week_start is not null then ws0.salaried_cents else ps.salaried_cents end salaried_cents,
      case when ws0.week_start is not null then ws0.salaried_people else ps.salaried_people end salaried_people,
      case when ws0.week_start is not null then ws0.unplaced_people else ps.unplaced_people end unplaced_people,
      case when ws0.week_start is not null then ws0.missing_wage_people else ps.missing_wage_people end missing_wage_people) ws
  left join public.labor_week_coverage wc on wc.week_start = g.w
  cross join lateral public.fact_labor_burden_for(g.loc, g.w) bf
  -- The coverage of the days that are NOT planned (a masked day's stored state says nothing about its plan).
  cross join lateral (select
      (count(*) filter (where c.state = 'covered'))::integer covered, (count(*) filter (where c.state = 'pending_settle'))::integer pending,
      (count(*) filter (where c.state = 'fallback_unverified'))::integer fallback, (count(*) filter (where c.state = 'incomplete'))::integer incomplete,
      count(*)::integer n, coalesce(sum(c.open_punches), 0)::integer open_n
    from public.labor_day_coverage c
    where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to)
      and c.business_date <> all(v_mask) and (v_only is null or c.business_date = any(v_only))) dc
  cross join lateral (select count(*)::integer n from unnest(v_mask) m
    where m between greatest(g.w, p_from) and least(g.w + 6, p_to) and (v_only is null or m = any(v_only))) dp
  where v_only is null or g.rd > 0
  order by g.w, g.loc;
end $$;

-- ── The public read: 0340's signature and 23 columns, no plan ────────────────────────────────────────
create or replace function public.fact_labor_cost(p_location_id uuid, p_from date, p_to date, p_wage_fallback text)
returns table(week_start date, location_id uuid, hourly_straight_cents bigint, ot_premium_cents bigint, salaried_cents bigint,
  salary_basis text, burden_pct numeric, burden_basis text, estimated_rate_minutes bigint, hourly_minutes bigint, ot_minutes bigint,
  salaried_minutes bigint, ot_state text, range_days integer, days_covered integer, days_pending integer, days_fallback integer,
  days_incomplete integer, days_missing integer, open_punches integer,
  salaried_people integer, salary_unplaced_people integer, salary_missing_wage_people integer)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.week_start, c.location_id, c.hourly_straight_cents, c.ot_premium_cents, c.salaried_cents, c.salary_basis, c.burden_pct, c.burden_basis,
    c.estimated_rate_minutes, c.hourly_minutes, c.ot_minutes, c.salaried_minutes, c.ot_state, c.range_days, c.days_covered, c.days_pending,
    c.days_fallback, c.days_incomplete, c.days_missing, c.open_punches, c.salaried_people, c.salary_unplaced_people, c.salary_missing_wage_people
  from public.fact_labor_cost_planned(p_location_id, p_from, p_to, p_wage_fallback, null) c
  order by c.week_start, c.location_id
$$;

-- ── CEILINGS: both reads service_role only (the public one re-proved after the replace) ──────────────
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.fact_labor_cost(uuid,date,date,text)'::regprocedure,
    'public.fact_labor_cost_planned(uuid,date,date,text,jsonb)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.fact_labor_cost(uuid,date,date,text)'::regprocedure,
    'public.fact_labor_cost_planned(uuid,date,date,text,jsonb)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0343: RPC escape %', f; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
