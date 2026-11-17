-- Migration 0339_fact_labor_ot_per_shop
-- AUTHORED 2026-11-17 (CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Apply AFTER 0338 (applied to prod 2026-11-17, schema_migrations version 20261117153617), then deploy the
-- app commit that bumps LABOR_BUILDER_VERSION to labor-v2 (see docs/runbooks/fact-layer-labor.md section 1b).
--
-- JUAN 2026-11-17: the two shops are SEPARATE companies (separate LLCs), and the payroll week turns over at
-- MIDNIGHT Saturday -> Sunday. So overtime is counted PER EMPLOYER: hours past 40 in a Sunday-Saturday week,
-- separately per shop. A person working at both shops gets overtime only from hours past 40 within ONE shop.
-- (0338 counted the 40 h company-wide across both shops, on Juan's 2026-11-16 answer; this replaces it.)
--
-- The WEEK BOUNDARY is unchanged and already right: 0338 frames a week as Sunday 00:00 ET .. next Sunday
-- 00:00 ET by CALENDAR date (p_week_start::timestamp at time zone 'America/New_York'), and the builder files
-- each minute by its ET calendar date, never a business day: a Saturday close's after-midnight minutes are
-- the next week's (tests/fact-labor-ot-per-shop.test.ts, tests/fact-labor-0339-migration.test.ts).
--
-- WHAT CHANGES (nothing else; the build unit stays one payroll week, both shops in one transaction):
--   1. fact_labor_ot_scope(): THE overtime scope, 'per_shop' (lib/facts/labor-config-shared.ts
--      LABOR_OT_SCOPE carries the same value, pinned equal by tests/fact-labor-config.test.ts). 'company' is
--      the other legal value, for a future employer whose shops are one company: changing it is a new
--      migration AND a LABOR_BUILDER_VERSION bump, never a runtime switch.
--   2. labor_week_coverage.ot_scope: the scope each built week WAS BUILT WITH. Existing rows: builder
--      labor-v1 = 'company' (0338's builder); any later version = 'per_shop' (a deploy that reached prod
--      before this file built per shop). No default afterwards: the writer names it.
--   3. fact_replace_labor_week (re-emitted from 0338): the payload's week row must name the scope in force
--      (an old deployment's payload has none: fact_payload_mismatch, which the pass treats as raced, writes
--      nothing), and the coverage row records it.
--   4. fact_labor_cost (re-emitted from 0338): the overtime premium's BLENDED rate is per (person, week,
--      SHOP) on a per_shop week (the premium is the employer's: one shop's payroll never blends the other
--      shop's rates), per (person, week) on a company week, so a week not yet rebuilt still prices as it was
--      built.
-- The new builder version (labor-v2) changes every week's fingerprint, so the next passes rebuild every
-- built week; until then a labor-v1 week reads as it was built (company), labelled by its ot_scope.
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regclass('public.labor_week_coverage'), to_regprocedure('public.fact_labor_cost(uuid,date,date,text)');  -- both present
--   select count(*) from information_schema.columns where table_name = 'labor_week_coverage' and column_name = 'ot_scope';  -- 0
--   select proname, md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where proname in ('fact_replace_labor_week', 'fact_labor_cost');   -- the two 0338 fingerprints in the DO block below
--   select builder_version, count(*) from public.labor_week_coverage group by 1;  -- report: every one is rebuilt
begin;

do $$ declare r record; v_live text; begin
  if to_regclass('public.labor_week_coverage') is null
    or to_regprocedure('public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.fact_labor_cost(uuid,date,date,text)') is null
    or to_regprocedure('public.fact_labor_constants()') is null then
    raise exception '0339: apply 0338 first'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'labor_week_coverage' and column_name = 'ot_scope')
    or to_regprocedure('public.fact_labor_ot_scope()') is not null then
    raise exception '0339: already applied'; end if;
  -- The live bodies this file re-emits must be 0338's (a later definer would be silently overwritten).
  for r in select * from (values
      ('public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)', '5d43409f88a981e383d9210e54c36701'),
      ('public.fact_labor_cost(uuid,date,date,text)', '8e690275ca642bbc0c8c085a1cc9ad8e')
    ) as t(sig, source_md5)
  loop
    select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_live is distinct from r.source_md5 then
      raise exception '0339: the live body of % (md5 %) is not its 0338 definition -- a later definer exists; re-emit from it. Refusing.', r.sig, v_live;
    end if;
  end loop;
end $$;

-- ── 1. THE overtime scope ──────────────────────────────────────────────────────────────────────
create function public.fact_labor_ot_scope()
returns text language sql immutable set search_path = pg_catalog, public as $$
  select 'per_shop'::text
$$;

-- ── 2. the scope each built week was built with ─────────────────────────────────────────────────
alter table public.labor_week_coverage add column ot_scope text not null default 'company'
  constraint labor_week_coverage_ot_scope_check check (ot_scope in ('company', 'per_shop'));
update public.labor_week_coverage set ot_scope = case when builder_version = 'labor-v1' then 'company' else 'per_shop' end;
alter table public.labor_week_coverage alter column ot_scope drop default;

-- ── 3. THE writer (re-emitted from 0338; changes: the ot_scope check and column) ─────────────────
create or replace function public.fact_replace_labor_week(p_week_start date, p_builder_version text, p_fingerprint text,
  p_quarters jsonb, p_days jsonb, p_week jsonb, p_salaried jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_today date := (clock_timestamp() at time zone 'America/New_York')::date;
  v_floor date; v_floor_week date; v_through date; v_from date;
  v_quarters integer; v_days integer;
begin
  if p_week_start is null or p_builder_version is null or p_fingerprint is null
    or jsonb_typeof(p_quarters) is distinct from 'array' or jsonb_typeof(p_days) is distinct from 'array'
    or jsonb_typeof(p_week) is distinct from 'object' or jsonb_typeof(p_salaried) is distinct from 'array' then
    raise exception 'fact_invalid_payload'; end if;
  select floor_day, floor_week into v_floor, v_floor_week from public.fact_labor_constants();
  if extract(dow from p_week_start) <> 0 or p_week_start < v_floor_week then raise exception 'fact_invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fact:labor:' || p_week_start::text, 0));
  v_from := greatest(p_week_start, v_floor);
  v_through := least(p_week_start + 6, v_today - 1);
  if v_through < v_from then raise exception 'fact_open_day'; end if;
  if exists (select 1 from jsonb_to_recordset(p_quarters) q(business_date date) where q.business_date >= v_today)
    or exists (select 1 from jsonb_to_recordset(p_days) d(business_date date) where d.business_date >= v_today) then
    raise exception 'fact_open_day'; end if;
  if public.fact_labor_week_fingerprint(p_week_start, p_builder_version) is distinct from p_fingerprint then
    raise exception 'fact_stale'; end if;

  -- The days ARE the frame (both ways), and the state follows the evidence.
  if (select count(*) from jsonb_array_elements(p_days)) <> (select count(*) from public.fact_labor_week_days(p_week_start))
    or exists (select d.location_id, d.business_date from jsonb_to_recordset(p_days) d(location_id uuid, business_date date)
               except select f.location_id, f.business_date from public.fact_labor_week_days(p_week_start) f)
    or exists (select 1 from jsonb_to_recordset(p_days) d(location_id uuid, business_date date, state text, evidence_run_id uuid, week_start date)
               join public.fact_labor_week_days(p_week_start) f on f.location_id = d.location_id and f.business_date = d.business_date
               where d.week_start is distinct from p_week_start
                  or (d.state = 'covered') is distinct from (f.linked and f.evidence_run_id is not null)
                  or (d.state = 'covered' and d.evidence_run_id is distinct from f.evidence_run_id)
                  or (d.state = 'pending_settle') is distinct from (f.linked and f.evidence_run_id is null and not f.settled))
    -- Every quarter sits on a frame day, in this week, under that day's one source.
    or exists (select 1 from jsonb_to_recordset(p_quarters) q(location_id uuid, business_date date, source text, week_start date)
               left join jsonb_to_recordset(p_days) d(location_id uuid, business_date date, source text)
                 on d.location_id = q.location_id and d.business_date = q.business_date
               where q.week_start is distinct from p_week_start or d.source is distinct from q.source)
    or (p_week ->> 'week_start')::date is distinct from p_week_start or (p_week ->> 'built_through')::date is distinct from v_through
    -- 0339: the overtime was counted in the scope in force (an old deployment's payload names none).
    or (p_week ->> 'ot_scope') is distinct from public.fact_labor_ot_scope()
    -- The salaried rows are exactly the linked shops.
    or (select count(*) from jsonb_array_elements(p_salaried))
         <> (select count(distinct f.location_id) from public.fact_labor_week_days(p_week_start) f where f.linked)
    or exists (select s.location_id from jsonb_to_recordset(p_salaried) s(location_id uuid)
               except select f.location_id from public.fact_labor_week_days(p_week_start) f where f.linked) then
    raise exception 'fact_payload_mismatch'; end if;

  delete from public.labor_quarter where week_start = p_week_start;
  delete from public.labor_day_coverage where week_start = p_week_start;
  delete from public.labor_week_salaried where week_start = p_week_start;
  insert into public.labor_quarter select * from jsonb_populate_recordset(null::public.labor_quarter, p_quarters);
  insert into public.labor_day_coverage select * from jsonb_populate_recordset(null::public.labor_day_coverage, p_days);
  insert into public.labor_week_salaried
    select * from jsonb_populate_recordset(null::public.labor_week_salaried,
      (select coalesce(jsonb_agg(e || jsonb_build_object('week_start', p_week_start)), '[]'::jsonb) from jsonb_array_elements(p_salaried) e));
  select count(*) into v_quarters from public.labor_quarter where week_start = p_week_start;
  select count(*) into v_days from public.labor_day_coverage where week_start = p_week_start;
  insert into public.labor_week_coverage as c (week_start, source_fingerprint, builder_version, built_through, ot_threshold_minutes, ot_multiplier,
    ot_state, ot_identity_partial, ot_settings_disagree, quarter_count, day_count, built_at, ot_scope)
  select p_week_start, p_fingerprint, p_builder_version, v_through, k.ot_threshold_minutes, k.ot_multiplier,
    p_week ->> 'ot_state', (p_week ->> 'ot_identity_partial')::integer, (p_week ->> 'ot_settings_disagree')::boolean, v_quarters, v_days, clock_timestamp(),
    public.fact_labor_ot_scope()
  from public.fact_labor_constants() k
  on conflict (week_start) do update set source_fingerprint = excluded.source_fingerprint, builder_version = excluded.builder_version,
    built_through = excluded.built_through, ot_threshold_minutes = excluded.ot_threshold_minutes, ot_multiplier = excluded.ot_multiplier,
    ot_state = excluded.ot_state, ot_identity_partial = excluded.ot_identity_partial, ot_settings_disagree = excluded.ot_settings_disagree,
    quarter_count = excluded.quarter_count, day_count = excluded.day_count, built_at = excluded.built_at, ot_scope = excluded.ot_scope;
  return jsonb_build_object('week_start', p_week_start, 'quarters', v_quarters, 'days', v_days, 'ot_state', p_week ->> 'ot_state');
end $$;

-- ── 4. COST COMPONENTS (re-emitted from 0338; change: the premium's blended rate follows the week's ot_scope)
--   overtime premium = 0.5 x the BLENDED rate x overtime minutes / 60, on the shop and day the overtime
--     minutes fell. Blended = sum(minutes x rate) / sum(minutes) over every hourly row of that person in
--     that week AT THAT SHOP on a per_shop week (each shop is its own employer), at both shops on a company
--     week (a week built by labor-v1, until it is rebuilt). Everything else is 0338's, unchanged.
create or replace function public.fact_labor_cost(p_location_id uuid, p_from date, p_to date, p_wage_fallback text)
returns table(week_start date, location_id uuid, hourly_straight_cents bigint, ot_premium_cents bigint, salaried_cents bigint,
  salary_basis text, burden_pct numeric, burden_basis text, estimated_rate_minutes bigint, hourly_minutes bigint, ot_minutes bigint,
  salaried_minutes bigint, ot_state text, range_days integer, days_covered integer, days_pending integer, days_fallback integer,
  days_incomplete integer, days_missing integer, open_punches integer)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_floor date;
begin
  select floor_day into v_floor from public.fact_labor_constants();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_from < v_floor
    or p_wage_fallback is null or p_wage_fallback not in ('first_known', 'dc_minimum') then
    raise exception 'fact_invalid_request'; end if;
  return query
  with weeks as (
    select g::date w from generate_series(p_from - extract(dow from p_from)::integer, p_to, interval '7 days') g
  ), shops as (
    select l.id loc from public.locations l
     where l.id = p_location_id
        or (p_location_id is null and exists (select 1 from public.labor_day_coverage c where c.location_id = l.id and c.week_start in (select weeks.w from weeks)))
  ), priced as (
    select q.week_start ws, q.location_id loc, q.person_key pk, q.business_date bd, q.minutes m, q.ot_minutes ot, q.pay_class pc,
      case when q.pay_class = 'salaried' then null
           when q.rate_basis in ('known', 'undated') then q.rate_cents
           when q.rate_basis = 'before_first_known' and p_wage_fallback = 'first_known' then q.carry_back_rate_cents
           else coalesce(s.estimated_hourly_cents, 1840) end rate,
      q.pay_class = 'hourly' and (q.rate_basis = 'none' or (q.rate_basis = 'before_first_known' and p_wage_fallback = 'dc_minimum')) est,
      -- 0339: the employer the overtime belongs to: the shop on a per_shop week, nobody (company) otherwise.
      case when wsc.ot_scope = 'company' then null else q.location_id end emp
    from public.labor_quarter q left join public.schedule_shop_settings s on s.location_id = q.location_id
    left join public.labor_week_coverage wsc on wsc.week_start = q.week_start
    where q.week_start in (select weeks.w from weeks)
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
    group by p.ws, p.loc
  ), grid as (
    select weeks.w, shops.loc, (least(weeks.w + 6, p_to) - greatest(weeks.w, p_from) + 1) rd from weeks, shops
  )
  select g.w, g.loc, coalesce(a.straight, 0), coalesce(a.prem, 0),
    case when s.estimated_salaried_weekly_cents is not null then round(s.estimated_salaried_weekly_cents * g.rd / 7.0)::bigint
         when ws.salaried_cents is not null then round(ws.salaried_cents * g.rd / 7.0)::bigint end,
    case when s.estimated_salaried_weekly_cents is not null then 'estimate' when ws.salaried_cents is not null then 'wages' else 'unknown' end,
    bf.burden_pct, bf.burden_basis,
    coalesce(a.est_m, 0), coalesce(a.hm, 0), coalesce(a.otm, 0), coalesce(a.sm, 0),
    coalesce(wc.ot_state, 'unbuilt'), g.rd,
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'covered'),
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'pending_settle'),
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'fallback_unverified'),
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'incomplete'),
    g.rd - (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to)),
    (select coalesce(sum(c.open_punches), 0)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to))
  from grid g
  left join agg a on a.ws = g.w and a.loc = g.loc
  left join public.schedule_shop_settings s on s.location_id = g.loc
  left join public.labor_week_salaried ws on ws.week_start = g.w and ws.location_id = g.loc
  left join public.labor_week_coverage wc on wc.week_start = g.w
  cross join lateral public.fact_labor_burden_for(g.loc, g.w) bf
  order by g.w, g.loc;
end $$;

-- ── CEILINGS: the scope function is internal (like fact_labor_constants); the re-emitted RPCs keep 0338's
-- service_role-only EXECUTE (create or replace keeps the ACL; re-asserted and proved here) ──────────
revoke all on function public.fact_labor_ot_scope() from public, anon, authenticated, service_role;
do $$ declare f regprocedure; begin
  foreach f in array array['public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
                           'public.fact_labor_cost(uuid,date,date,text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare f regprocedure; p text; begin
  if has_function_privilege('service_role', 'public.fact_labor_ot_scope()', 'EXECUTE') or has_function_privilege('anon', 'public.fact_labor_ot_scope()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fact_labor_ot_scope()', 'EXECUTE') then raise exception '0339: internal function escape fact_labor_ot_scope'; end if;
  foreach f in array array['public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
                           'public.fact_labor_cost(uuid,date,date,text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0339: RPC escape %', f; end if;
  end loop;
  -- labor_week_coverage keeps 0338's ceiling (service_role SELECT only).
  if not has_table_privilege('service_role', 'public.labor_week_coverage', 'SELECT') then raise exception '0339: labor_week_coverage lacks service_role SELECT'; end if;
  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.labor_week_coverage', p) then raise exception '0339: service_role holds % on labor_week_coverage', p; end if;
  end loop;
  if exists (select 1 from public.labor_week_coverage where ot_scope is null) then raise exception '0339: a week has no ot_scope'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
