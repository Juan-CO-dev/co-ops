-- Migration 0340_labor_payroll_shop
-- AUTHORED 2026-11-17 (CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Apply AFTER 0339 (applied to prod 2026-11-17, schema_migrations version 20261117235204), then deploy the app
-- commit that bumps LABOR_BUILDER_VERSION to labor-v3, then seed (docs/runbooks/fact-layer-labor.md section 1c).
-- Plan: CHIEF item-02-SALARY-PAYROLL-SHOP-PLAN-r2.md, with Astra r2's P1 + two P2s fixed in the same build.
--
-- JUAN 2026-11-17: the shops are SEPARATE LLC payrolls. P Street pays the owner, the director of operations
-- (MoO) and P Street's GM-and-down salaries; Capitol Hill pays the catering manager and Capitol Hill's
-- GM-and-down salaries. The CGS is not salaried. 0338's builder split a salary by the person's LINKS (an
-- account linked at both shops was halved), which put half of P Street's owner salary on Capitol Hill.
--
-- WHAT THIS ADDS
--   1. labor_payroll_shops: THE payroll shop, an explicit, dated, append-only assignment per 7SHIFTS ACCOUNT
--      (the wage is keyed by the account, 0338). disposition 'shop' (a shop with a live 7shifts location link)
--      or 'excluded' (a recorded decision: not on any shop's salaried payroll). In force for a week: the row
--      with the greatest valid_from <= the week start, then the greatest seq. A transfer is a later row; a
--      correction is a row on the same date (newest seq wins); nothing is updated or deleted.
--   2. save_labor_payroll_shop: its ONE writer (owner / CGS / MoO), optimistic on the account's newest row,
--      writing its own destructive labor_payroll_shop.save audit row (the note never enters it).
--   3. labor_week_salaried gains unplaced_people and missing_wage_people; cents are NULL exactly when nobody
--      is placed or any gap exists (never a partial total that looks complete).
--   4. Re-emits (live-body md5 guards below): fact_labor_week_source + fact_labor_week_fingerprint (0338: the
--      wage universe widened to every account with a non-hourly wage observation or an assignment row, and
--      every assignment row in the source and the fingerprint), fact_replace_labor_week (0339: refuses a
--      salaried payload without the two counts, i.e. an old deployment's: fact_payload_mismatch, which the
--      pass counts as raced), fact_labor_cost (0339: salary_basis 'incomplete', and the gap counts returned
--      whatever the basis, the 0274 estimate included). New OUT columns = drop + create, ACL re-proved.
--
-- The allocation itself is the pure lib/facts/labor-payroll-shared.ts allocateSalaried (links never enter it;
-- an assignment whose shop is not stored this week is unplaced before the wage is read: Astra r2 P2 #3).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.fact_labor_ot_scope()'), to_regclass('public.sevenshifts_users');   -- both present (0339, 0268)
--   select to_regclass('public.labor_payroll_shops');                                                    -- null
--   select proname, md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where proname in ('fact_labor_week_source','fact_labor_week_fingerprint','fact_replace_labor_week','fact_labor_cost'); -- the four below
--   select conname from pg_constraint where conrelid = 'public.labor_week_salaried'::regclass and contype = 'c'; -- includes labor_week_salaried_check
begin;

do $$ declare r record; v_live text; begin
  if to_regprocedure('public.fact_labor_ot_scope()') is null
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'labor_week_coverage' and column_name = 'ot_scope') then
    raise exception '0340: apply 0339 first'; end if;
  if to_regclass('public.sevenshifts_users') is null or to_regclass('public.sevenshifts_location_links') is null then
    raise exception '0340: missing 0268 / 0269 (7shifts users, location links)'; end if;
  if to_regclass('public.labor_payroll_shops') is not null then raise exception '0340: already applied'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.labor_week_salaried'::regclass and conname = 'labor_week_salaried_check') then
    raise exception '0340: labor_week_salaried_check (0338) not found'; end if;
  -- The live bodies this file re-emits must be their 0338 / 0339 definitions (a later definer would be silently overwritten).
  for r in select * from (values
      ('public.fact_labor_week_source(date,text)', 'b9ee5af2d16d3b5a8db6fe5a0032a5c8'),
      ('public.fact_labor_week_fingerprint(date,text)', '03b87f76815f0909e49a58e5002fde93'),
      ('public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)', '6bb74258c9e8e3a5a900175771e44564'),
      ('public.fact_labor_cost(uuid,date,date,text)', '3680875044a96c34b1cef6a14295653a')
    ) as t(sig, source_md5)
  loop
    select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_live is distinct from r.source_md5 then
      raise exception '0340: the live body of % (md5 %) is not its 0338/0339 definition -- a later definer exists; re-emit from it. Refusing.', r.sig, v_live;
    end if;
  end loop;
end $$;

-- ── 1. THE payroll shop (append-only) ─────────────────────────────────────────────────────────────
create table public.labor_payroll_shops (
  id                  uuid        primary key default gen_random_uuid(),
  seq                 bigserial   not null unique,
  sevenshifts_user_id bigint      not null check (sevenshifts_user_id > 0),
  location_id         uuid        references public.locations(id),
  disposition         text        not null check (disposition in ('shop', 'excluded')),
  valid_from          date        not null,
  note                text        check (char_length(note) <= 500),
  created_by          uuid        not null references public.users(id),
  created_at          timestamptz not null default clock_timestamp(),
  constraint labor_payroll_shops_location check ((disposition = 'shop') = (location_id is not null)),
  -- a payroll week starts on Sunday; nothing before the labor floor week (fact_labor_constants().floor_week)
  constraint labor_payroll_shops_valid_from check (extract(dow from valid_from) = 0 and valid_from >= date '2026-07-19')
);
create index labor_payroll_shops_lookup on public.labor_payroll_shops (sevenshifts_user_id, valid_from desc, seq desc);
comment on table public.labor_payroll_shops is
  '0340: THE payroll shop per 7shifts account (dated, append-only). The only authority for where a salary is counted; links never are. Written only by save_labor_payroll_shop. Deny-all RLS; service_role SELECT only.';

-- ── 2. its ONE writer ────────────────────────────────────────────────────────────────────────────
-- Refusals by name: labor_payroll_shop_forbidden (not an active owner / CGS / MoO), _invalid (shape),
-- _invalid_date (not a Sunday on or after the floor week), _unknown_account (not in the 7shifts mirror),
-- _moved (p_expected_seq is not the account's newest row), _invalid_destination (no live location link),
-- _note_required (excluding, or a valid_from before the current payroll week: it re-prices history).
create function public.save_labor_payroll_shop(p_actor uuid, p_account bigint, p_location_id uuid, p_disposition text,
  p_valid_from date, p_note text, p_expected_seq bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_role text; v_floor_week date; v_today date := (clock_timestamp() at time zone 'America/New_York')::date; v_week date;
  v_newest bigint; v_before jsonb; v_id uuid; v_seq bigint;
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('owner', 'cgs', 'moo') for share;
  end if;
  if v_role is null then raise exception 'labor_payroll_shop_forbidden'; end if;
  if p_account is null or p_account <= 0 or p_disposition is null or p_disposition not in ('shop', 'excluded')
    or (p_disposition = 'shop') is distinct from (p_location_id is not null) or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'labor_payroll_shop_invalid'; end if;
  select floor_week into v_floor_week from public.fact_labor_constants();
  if p_valid_from is null or extract(dow from p_valid_from) <> 0 or p_valid_from < v_floor_week then
    raise exception 'labor_payroll_shop_invalid_date'; end if;
  if not exists (select 1 from public.sevenshifts_users s where s.id = p_account) then
    raise exception 'labor_payroll_shop_unknown_account'; end if;
  -- Saves of one account queue, so each sees the previous one's row (and its audit "before").
  perform pg_advisory_xact_lock(hashtextextended('labor_payroll_shop:' || p_account::text, 0));
  select max(a.seq) into v_newest from public.labor_payroll_shops a where a.sevenshifts_user_id = p_account;
  if v_newest is distinct from p_expected_seq then raise exception 'labor_payroll_shop_moved'; end if;
  if p_disposition = 'shop' and not exists (select 1 from public.sevenshifts_location_links l where l.location_id = p_location_id and l.active) then
    raise exception 'labor_payroll_shop_invalid_destination'; end if;
  v_week := v_today - extract(dow from v_today)::integer;
  if (p_disposition = 'excluded' or p_valid_from < v_week) and btrim(coalesce(p_note, '')) = '' then
    raise exception 'labor_payroll_shop_note_required'; end if;
  select coalesce((select jsonb_build_object('disposition', a.disposition, 'location_id', a.location_id, 'valid_from', a.valid_from, 'seq', a.seq)
      from public.labor_payroll_shops a where a.sevenshifts_user_id = p_account and a.valid_from <= p_valid_from
      order by a.valid_from desc, a.seq desc limit 1), jsonb_build_object('disposition', 'none'))
    into v_before;
  insert into public.labor_payroll_shops (sevenshifts_user_id, location_id, disposition, valid_from, note, created_by)
  values (p_account, p_location_id, p_disposition, p_valid_from, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning id, seq into v_id, v_seq;
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, before_state, after_state, metadata, destructive)
  values (p_actor, v_role, 'labor_payroll_shop.save', 'labor_payroll_shops', v_id, v_before,
    jsonb_build_object('disposition', p_disposition, 'location_id', p_location_id, 'valid_from', p_valid_from, 'seq', v_seq),
    jsonb_build_object('sevenshifts_user_id', p_account, 'valid_from', p_valid_from, 'backdated', p_valid_from < v_week,
      'has_note', btrim(coalesce(p_note, '')) <> ''),
    true);
  return jsonb_build_object('id', v_id, 'seq', v_seq);
end $$;

-- ── 3. the salaried rows carry their gaps ──────────────────────────────────────────────────────────
alter table public.labor_week_salaried
  add column unplaced_people integer not null default 0 constraint labor_week_salaried_unplaced_check check (unplaced_people >= 0),
  add column missing_wage_people integer not null default 0 constraint labor_week_salaried_missing_check check (missing_wage_people >= 0);
alter table public.labor_week_salaried drop constraint labor_week_salaried_check;
-- NULL = unknown: nobody placed here, or any gap. Never a partial total. (Existing rows have no gaps: same rule as 0338.)
alter table public.labor_week_salaried add constraint labor_week_salaried_cents_known
  check ((salaried_cents is null) = (salaried_people = 0 or unplaced_people > 0 or missing_wage_people > 0));
-- No default afterwards: the writer names both counts.
alter table public.labor_week_salaried alter column unplaced_people drop default, alter column missing_wage_people drop default;

-- ── 4a. THE source (re-emitted from 0338; changes: the wage universe, and payroll_shops) ────────────
create or replace function public.fact_labor_week_source(p_week_start date, p_builder_version text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_s timestamptz := p_week_start::timestamp at time zone 'America/New_York';
  v_e timestamptz := (p_week_start + 7)::timestamp at time zone 'America/New_York';
  k record;
begin
  if p_week_start is null or p_builder_version is null or extract(dow from p_week_start) <> 0 then raise exception 'fact_invalid_request'; end if;
  select * into k from public.fact_labor_constants();
  return (
  with punches as (
    select p.id, p.user_id, p.location_id, p.role_id, p.clocked_in, p.clocked_out, p.break_minutes, p.deleted
      from public.sevenshifts_time_punches p
     where p.clocked_in < v_e and (p.clocked_out > v_s or (p.clocked_out is null and p.clocked_in + k.open_span > v_s))
  ), toast as (
    select t.location_id, t.time_entry_guid, t.employee_guid, t.user_id, t.in_at, t.out_at, t.deleted
      from public.toast_time_entries t where t.in_at < v_e and (t.out_at > v_s or (t.out_at is null and t.in_at + k.open_span > v_s))
  ), wage_users as (
    -- 0340: + every account that ever had a non-hourly wage, + every account with a payroll-shop row, so a
    -- salaried account is classified every week whether or not it punched or is linked.
    select distinct p.user_id u from punches p
    union select l.sevenshifts_user_id from public.sevenshifts_user_links l where l.active
    union select o.user_id from public.fact_wage_observations o where o.wage_type <> 'hourly'
    union select a.sevenshifts_user_id from public.labor_payroll_shops a
  )
  select jsonb_build_object(
    'week_start', p_week_start,
    'built_through', case when least(p_week_start + 6, (clock_timestamp() at time zone 'America/New_York')::date - 1) >= greatest(p_week_start, k.floor_day)
                          then least(p_week_start + 6, (clock_timestamp() at time zone 'America/New_York')::date - 1) end,
    'floor_day', k.floor_day,
    'days', coalesce((select jsonb_agg(to_jsonb(f) order by f.location_id, f.business_date) from public.fact_labor_week_days(p_week_start) f), '[]'::jsonb),
    'location_links', coalesce((select jsonb_agg(jsonb_build_object('location_id', l.location_id, 'sevenshifts_location_id', l.sevenshifts_location_id) order by l.location_id)
                       from public.sevenshifts_location_links l where l.active), '[]'::jsonb),
    'user_links', coalesce((select jsonb_agg(jsonb_build_object('sevenshifts_user_id', l.sevenshifts_user_id, 'user_id', l.user_id, 'linked_at_location_id', l.linked_at_location_id) order by l.id)
                   from public.sevenshifts_user_links l where l.active), '[]'::jsonb),
    'toast_links', coalesce((select jsonb_agg(jsonb_build_object('location_id', l.location_id, 'employee_guid', l.employee_guid, 'user_id', l.user_id) order by l.id)
                    from public.toast_employee_links l where l.active), '[]'::jsonb),
    'punches', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from punches p), '[]'::jsonb),
    'toast_entries', coalesce((select jsonb_agg(to_jsonb(t) order by t.location_id, t.time_entry_guid) from toast t), '[]'::jsonb),
    'wages', coalesce((select jsonb_agg(to_jsonb(w) order by w.user_id, w.wage_id)
               from public.fact_wage_current_versions(array(select wu.u from wage_users wu)) w), '[]'::jsonb),
    'labor_settings', coalesce((select jsonb_agg(jsonb_build_object('daily_ot_threshold', s.daily_ot_threshold, 'premium_ot_threshold', s.premium_ot_threshold,
                       'consecutive_days_threshold', s.consecutive_days_threshold) order by s.company_id) from public.sevenshifts_labor_settings s), '[]'::jsonb),
    -- 0340: every payroll-shop row (small; the builder picks the one in force at the week start).
    'payroll_shops', coalesce((select jsonb_agg(jsonb_build_object('seq', a.seq, 'sevenshifts_user_id', a.sevenshifts_user_id, 'location_id', a.location_id,
                       'disposition', a.disposition, 'valid_from', a.valid_from) order by a.seq) from public.labor_payroll_shops a), '[]'::jsonb),
    'fingerprint', public.fact_labor_week_fingerprint(p_week_start, p_builder_version))
  );
end $$;

-- ── 4b. THE fingerprint (re-emitted from 0338; changes: the same widened wage set, and every payroll-shop
-- row: a save restales every week, and saves are rare) ─────────────────────────────────────────────
create or replace function public.fact_labor_week_fingerprint(p_week_start date, p_builder_version text)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_s timestamptz := p_week_start::timestamp at time zone 'America/New_York';
  v_e timestamptz := (p_week_start + 7)::timestamp at time zone 'America/New_York';
  v_floor date; v_span interval; v_through date; v_punch text; v_toast text; v_links text; v_wages text; v_settings text; v_days text; v_payroll text;
begin
  if p_week_start is null or p_builder_version is null or extract(dow from p_week_start) <> 0 then raise exception 'fact_invalid_request'; end if;
  select floor_day, open_span into v_floor, v_span from public.fact_labor_constants();
  v_through := least(p_week_start + 6, (clock_timestamp() at time zone 'America/New_York')::date - 1);
  if v_through < greatest(p_week_start, v_floor) then v_through := null; end if;
  select md5(string_agg(concat_ws(':', p.id, p.user_id, coalesce(p.location_id::text, '-'), coalesce(p.role_id::text, '-'),
           extract(epoch from p.clocked_in), coalesce(extract(epoch from p.clocked_out)::text, '-'), coalesce(p.break_minutes::text, '-'), p.deleted), ',' order by p.id))
    into v_punch from public.sevenshifts_time_punches p
   where p.clocked_in < v_e and (p.clocked_out > v_s or (p.clocked_out is null and p.clocked_in + v_span > v_s));
  select md5(string_agg(concat_ws(':', t.location_id, t.time_entry_guid, t.employee_guid, coalesce(t.user_id::text, '-'),
           extract(epoch from t.in_at), coalesce(extract(epoch from t.out_at)::text, '-'), t.deleted), ',' order by t.location_id, t.time_entry_guid))
    into v_toast from public.toast_time_entries t where t.in_at < v_e and (t.out_at > v_s or (t.out_at is null and t.in_at + v_span > v_s));
  select md5(concat_ws('|',
    (select string_agg(l.id::text || ':' || l.active, ',' order by l.id) from public.sevenshifts_location_links l),
    (select string_agg(l.id::text || ':' || l.active, ',' order by l.id) from public.sevenshifts_user_links l),
    (select string_agg(l.id::text || ':' || l.active, ',' order by l.id) from public.toast_employee_links l))) into v_links;
  select md5(string_agg(o.user_id || ':' || o.s, ',' order by o.user_id)) into v_wages from (
    select w.user_id, max(w.seq) s from public.fact_wage_observations w
     where w.user_id in (select p.user_id from public.sevenshifts_time_punches p
                          where p.clocked_in < v_e and (p.clocked_out > v_s or (p.clocked_out is null and p.clocked_in + v_span > v_s))
                         union select l.sevenshifts_user_id from public.sevenshifts_user_links l where l.active
                         -- 0340: the source's widened wage set, the same predicates.
                         union select o2.user_id from public.fact_wage_observations o2 where o2.wage_type <> 'hourly'
                         union select a.sevenshifts_user_id from public.labor_payroll_shops a)
     group by w.user_id) o;
  select md5(string_agg(concat_ws(':', s.company_id, coalesce(s.daily_ot_threshold::text, '-'), coalesce(s.premium_ot_threshold::text, '-'),
           coalesce(s.consecutive_days_threshold::text, '-')), ',' order by s.company_id)) into v_settings from public.sevenshifts_labor_settings s;
  select md5(string_agg(concat_ws(':', f.location_id, f.business_date, f.linked, coalesce(f.evidence_run_id::text, '-'), f.settled), ',' order by f.location_id, f.business_date))
    into v_days from public.fact_labor_week_days(p_week_start) f;
  -- 0340: every payroll-shop row (append-only, so seq + content is the whole table's state).
  select md5(string_agg(concat_ws(':', a.seq, a.sevenshifts_user_id, coalesce(a.location_id::text, '-'), a.disposition, a.valid_from), ',' order by a.seq))
    into v_payroll from public.labor_payroll_shops a;
  return md5(concat_ws('|', 'v:' || p_builder_version, 'w:' || p_week_start, 't:' || coalesce(v_through::text, 'none'),
    'p:' || coalesce(v_punch, 'none'), 'x:' || coalesce(v_toast, 'none'), 'l:' || coalesce(v_links, 'none'), 'g:' || coalesce(v_wages, 'none'),
    's:' || coalesce(v_settings, 'none'), 'd:' || coalesce(v_days, 'none'), 'a:' || coalesce(v_payroll, 'none')));
end $$;

-- ── 4c. THE writer (re-emitted from 0339; change: the salaried rows must carry both gap counts, and the
-- unplaced count is one number for the week) ─────────────────────────────────────────────────────
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
               except select f.location_id from public.fact_labor_week_days(p_week_start) f where f.linked)
    -- 0340: every salaried row names both gap counts (an old deployment's payload names neither), and the
    -- unplaced count is the week's one number (an unplaced person nulls every stored shop).
    or exists (select 1 from jsonb_array_elements(p_salaried) e
               where jsonb_typeof(e -> 'unplaced_people') is distinct from 'number' or jsonb_typeof(e -> 'missing_wage_people') is distinct from 'number')
    or (select count(distinct e -> 'unplaced_people') from jsonb_array_elements(p_salaried) e) > 1 then
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

-- ── 4d. COST COMPONENTS (re-emitted from 0339; changes: salary_basis 'incomplete' = no estimate and the
-- week's wage-derived salary has a gap; three new OUT columns, returned WHATEVER the basis, so a gap shows
-- beside an estimate-based figure: salaried_people (placed here), salary_unplaced_people (the week's
-- unplaced accounts; the same number on every shop), salary_missing_wage_people (assigned here, no salary).
-- New OUT columns cannot be added by create or replace: drop + create in this transaction, ACL re-proved.
drop function public.fact_labor_cost(uuid, date, date, text);
create function public.fact_labor_cost(p_location_id uuid, p_from date, p_to date, p_wage_fallback text)
returns table(week_start date, location_id uuid, hourly_straight_cents bigint, ot_premium_cents bigint, salaried_cents bigint,
  salary_basis text, burden_pct numeric, burden_basis text, estimated_rate_minutes bigint, hourly_minutes bigint, ot_minutes bigint,
  salaried_minutes bigint, ot_state text, range_days integer, days_covered integer, days_pending integer, days_fallback integer,
  days_incomplete integer, days_missing integer, open_punches integer,
  salaried_people integer, salary_unplaced_people integer, salary_missing_wage_people integer)
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
    case when s.estimated_salaried_weekly_cents is not null then 'estimate' when ws.salaried_cents is not null then 'wages'
         when ws.unplaced_people > 0 or ws.missing_wage_people > 0 then 'incomplete' else 'unknown' end,
    bf.burden_pct, bf.burden_basis,
    coalesce(a.est_m, 0), coalesce(a.hm, 0), coalesce(a.otm, 0), coalesce(a.sm, 0),
    coalesce(wc.ot_state, 'unbuilt'), g.rd,
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'covered'),
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'pending_settle'),
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'fallback_unverified'),
    (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to) and c.state = 'incomplete'),
    g.rd - (select count(*)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to)),
    (select coalesce(sum(c.open_punches), 0)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to)),
    coalesce(ws.salaried_people, 0), coalesce(ws.unplaced_people, 0), coalesce(ws.missing_wage_people, 0)
  from grid g
  left join agg a on a.ws = g.w and a.loc = g.loc
  left join public.schedule_shop_settings s on s.location_id = g.loc
  left join public.labor_week_salaried ws on ws.week_start = g.w and ws.location_id = g.loc
  left join public.labor_week_coverage wc on wc.week_start = g.w
  cross join lateral public.fact_labor_burden_for(g.loc, g.w) bf
  order by g.w, g.loc;
end $$;

-- ── CEILINGS: deny-all RLS, explicit DELETE denial, service_role SELECT only; RPCs service_role only ──
alter table public.labor_payroll_shops enable row level security;
create policy labor_payroll_shops_no_user_delete on public.labor_payroll_shops for delete using (false);
revoke all on public.labor_payroll_shops from public, anon, authenticated, service_role;
grant select on public.labor_payroll_shops to service_role;
revoke all on sequence public.labor_payroll_shops_seq_seq from public, anon, authenticated, service_role;
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.save_labor_payroll_shop(uuid,bigint,uuid,text,date,text,bigint)'::regprocedure,
    'public.fact_labor_week_source(date,text)'::regprocedure,
    'public.fact_labor_week_fingerprint(date,text)'::regprocedure,
    'public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.fact_labor_cost(uuid,date,date,text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare f regprocedure; p text; t text; begin
  foreach t in array array['labor_payroll_shops', 'labor_week_salaried'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0340: % lacks service_role SELECT', t; end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception '0340: service_role holds % on %', p, t; end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0340: PostgREST role holds % on %', p, t; end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.save_labor_payroll_shop(uuid,bigint,uuid,text,date,text,bigint)'::regprocedure,
    'public.fact_labor_week_source(date,text)'::regprocedure,
    'public.fact_labor_week_fingerprint(date,text)'::regprocedure,
    'public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.fact_labor_cost(uuid,date,date,text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0340: RPC escape %', f; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
