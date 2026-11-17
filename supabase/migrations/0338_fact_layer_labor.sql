-- Migration 0338_fact_layer_labor
-- AUTHORED 2026-11-17 (item 2 PR 2c, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO SIM 2026-11-17 (schema_migrations version 20261117104451), APPLIED TO PROD 2026-11-17 (schema_migrations version 20261117153617), name 'fact_layer_labor'. The line above is the authoring-time gate note, kept as history.
-- Plan: CHIEF item-02-LABOR-PLAN-r6.md (Astra r4/r5 findings cleared) + Astra r6's one P1, fixed here:
--   a stale UPCOMING 7shifts wage row must never override a corrected CURRENT wage after an incomplete
--   promotion. Supersession between the two lanes of one wage is decided BEFORE any date/role selection
--   (fact_wage_current_versions below): of a wage's eligible lanes (the current lane, live or retired; the
--   upcoming lane only while live) the one ASSERTED most recently is the wage's one version.
-- LABOR side only (2c). Apply AFTER 0337 (the SPLH read joins its order facts). Ships OFF: the labor pass
-- of the fact-build cron runs only with FACT_LAYER=1 AND FACT_LAYER_LABOR=1.
--
-- THE ONE EXCEPTION TO "NO TRIGGER ON A CAPTURE PATH": fact_wage_observations. The 7shifts reconciler
-- updates a wage IN PLACE (0268:394-397) and the old value is gone afterwards; a rebuilt week must still
-- price its dates with the wage version that held then. So two row triggers on sevenshifts_wages append
-- an observation on INSERT and on an UPDATE that changes (effective_date, wage_type, wage_cents, role_id,
-- upcoming, active) -- a retirement is an observation; the hourly last_seen_run refresh is not. The trigger
-- only INSERTS into an append-only table that no builder locks; the builder never locks sevenshifts_wages,
-- so no lock cycle exists. Seeded at cutover in the 0262 order: lock, copy, install, prove, commit.
--
-- WHAT A LABOR WEEK IS. The company payroll week, Sunday 00:00 ET .. next Sunday 00:00 ET, BOTH shops at
-- once (overtime past 40 h is company-wide, Juan 2026-11-16). A pure function of: the 7shifts punches and
-- Toast time entries intersecting it, every link, each involved person's newest wage observation, the
-- 7shifts labor settings, each shop-day's coverage evidence and settle phase, the day it is built through,
-- and the builder version. fact_labor_week_fingerprint is the ONE definition; the diff and the replace
-- RPC both call it. Money is NEVER stored: minutes, overtime minutes and the candidate rates are; the two
-- views (fully loaded, pure hourly), the Q5 fallback, salary and burden are priced at READ time.
begin;

do $$ begin
  if to_regclass('public.fact_day_coverage') is null or to_regclass('public.fact_order_check') is null
    or to_regprocedure('public.fact_sales_check_classes(uuid,date,date)') is null then
    raise exception '0338: apply 0337 (order facts) first'; end if;
  if to_regclass('public.sevenshifts_wages') is null or to_regclass('public.sevenshifts_time_punches') is null
    or to_regclass('public.sevenshifts_sync_runs') is null or to_regclass('public.sevenshifts_sync_run_ids') is null
    or to_regclass('public.sevenshifts_labor_settings') is null
    or to_regprocedure('public.reconcile_sevenshifts_user_snapshot(uuid,bigint,text,boolean,jsonb)') is null then
    raise exception '0338: missing 0268 (7shifts mirror)'; end if;
  if to_regclass('public.sevenshifts_location_links') is null or to_regclass('public.sevenshifts_user_links') is null
    or to_regclass('public.sevenshifts_user_links_one_live_user_shop') is null then
    raise exception '0338: missing 0269 links with 0301 per-shop indexes'; end if;
  if to_regclass('public.toast_time_entries') is null or to_regclass('public.toast_employee_links') is null then
    raise exception '0338: missing 0224 / 0233 Toast labor tables'; end if;
  if to_regclass('public.schedule_shop_settings') is null then raise exception '0338: missing 0274 schedule_shop_settings'; end if;
  if to_regclass('public.audit_log') is null then raise exception '0338: missing audit_log (save_labor_burden writes its own audit row)'; end if;
  if to_regclass('public.fact_wage_observations') is not null or to_regclass('public.labor_quarter') is not null then
    raise exception '0338: already applied'; end if;
end $$;

-- ── A. THE WAGE OBSERVATION LEDGER (append-only; the one non-derived fact table) ────────────────
create table public.fact_wage_observations (
  seq            bigserial   primary key,
  wage_row_id    uuid        not null,
  user_id        bigint      not null check (user_id > 0),
  wage_id        bigint      not null check (wage_id > 0),
  upcoming       boolean     not null,
  effective_date date,
  wage_type      text        not null check (wage_type in ('hourly', 'weekly_salary', 'annual_salary')),
  wage_cents     integer     not null check (wage_cents >= 0),
  role_id        bigint      check (role_id > 0),
  active         boolean     not null,
  observed_at    timestamptz not null default clock_timestamp(),
  -- seed = copied at cutover ("first observed at cutover"); retire = an UPDATE that flipped active off.
  source         text        not null check (source in ('seed', 'insert', 'update', 'retire'))
);
create index fact_wage_observations_lane on public.fact_wage_observations (user_id, wage_id, upcoming, seq);
comment on table public.fact_wage_observations is
  '0338: every version of every 7shifts wage row, appended by the sevenshifts_wages triggers (and the cutover seed). Append-only by grant: service_role SELECT only. THE exception to "facts are derived": the old value of an in-place wage correction cannot be rebuilt. Read through fact_wage_current_versions only.';

create function public.fact_wage_observe()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.fact_wage_observations (wage_row_id, user_id, wage_id, upcoming, effective_date, wage_type, wage_cents, role_id, active, source)
  values (new.id, new.user_id, new.wage_id, new.upcoming, new.effective_date, new.wage_type, new.wage_cents, new.role_id, new.active,
    case when tg_op = 'INSERT' then 'insert' when old.active and not new.active then 'retire' else 'update' end);
  return null;
end $$;

-- The cutover (0262 order): lock the source, copy, install the triggers, prove -- all before COMMIT, so
-- no reconcile can land between the copy and the triggers. Seed order: by the row's first-seen run start
-- (a lane's rows follow one another, and a promoted current row is first seen after its upcoming row),
-- then retired before live, then id. That makes each lane's seeded head and each wage's last assertion
-- the ones the live triggers would have produced.
lock table public.sevenshifts_wages in share row exclusive mode;
do $$ declare w record; begin
  for w in select s.* from public.sevenshifts_wages s left join public.sevenshifts_sync_run_ids r on r.id = s.first_seen_run
           order by r.started_at nulls first, coalesce(s.retired_at, 'infinity'::timestamptz), s.id loop
    insert into public.fact_wage_observations (wage_row_id, user_id, wage_id, upcoming, effective_date, wage_type, wage_cents, role_id, active, source)
    values (w.id, w.user_id, w.wage_id, w.upcoming, w.effective_date, w.wage_type, w.wage_cents, w.role_id, w.active, 'seed');
  end loop;
end $$;
create trigger sevenshifts_wages_observe_insert after insert on public.sevenshifts_wages
  for each row execute function public.fact_wage_observe();
create trigger sevenshifts_wages_observe_update after update on public.sevenshifts_wages
  for each row when ((old.effective_date, old.wage_type, old.wage_cents, old.role_id, old.upcoming, old.active)
                     is distinct from (new.effective_date, new.wage_type, new.wage_cents, new.role_id, new.upcoming, new.active))
  execute function public.fact_wage_observe();
do $$ begin
  if (select count(*) from public.fact_wage_observations) <> (select count(*) from public.sevenshifts_wages)
    or exists (select w.id, w.user_id, w.wage_id, w.upcoming, w.effective_date, w.wage_type, w.wage_cents, w.role_id, w.active from public.sevenshifts_wages w
               except select o.wage_row_id, o.user_id, o.wage_id, o.upcoming, o.effective_date, o.wage_type, o.wage_cents, o.role_id, o.active
               from public.fact_wage_observations o) then
    raise exception '0338: wage seed is not row-for-row equal to sevenshifts_wages'; end if;
end $$;

-- STEP 1 (Astra r6 P1). One version per wage (user_id, wage_id), decided BEFORE date/role selection:
--   lane head  = the greatest-seq observation of (user_id, wage_id, upcoming) -- the newest row's latest
--                state (0268 inserts a lane row only when the lane has no live row; corrections update it);
--   eligible   = the current lane (live or retired) and the upcoming lane only while its head is live;
--   the version = the eligible lane ASSERTED most recently (greatest seq of a non-retire observation).
-- A promotion inserts the current row after the upcoming row was last asserted, so the current version
-- supersedes the upcoming one for every date and role, with or without the retirement (an incomplete
-- snapshot retires nothing, 0268:409-413). A retired upcoming lane is cancelled or promoted: never a version.
-- Step 2 (role, date, tie) is the pure pickWage (lib/facts/labor-wages-shared.ts).
create function public.fact_wage_current_versions(p_user_ids bigint[])
returns table(user_id bigint, wage_id bigint, upcoming boolean, effective_date date, wage_type text, wage_cents integer,
  role_id bigint, active boolean, seq bigint)
language sql stable security definer set search_path = pg_catalog, public as $$
  with lanes as (
    select o.user_id u, o.wage_id w, o.upcoming up, max(o.seq) head_seq, max(o.seq) filter (where o.source <> 'retire') asserted_seq
      from public.fact_wage_observations o where o.user_id = any(p_user_ids) group by o.user_id, o.wage_id, o.upcoming
  ), heads as (
    select h.user_id, h.wage_id, h.upcoming, h.effective_date, h.wage_type, h.wage_cents, h.role_id, h.active, h.seq, l.asserted_seq
      from lanes l join public.fact_wage_observations h on h.seq = l.head_seq
  ), ranked as (
    select heads.*, row_number() over (partition by heads.user_id, heads.wage_id order by heads.asserted_seq desc) rn
      from heads where not heads.upcoming or heads.active
  )
  select r.user_id, r.wage_id, r.upcoming, r.effective_date, r.wage_type, r.wage_cents, r.role_id, r.active, r.seq
    from ranked r where r.rn = 1 order by r.user_id, r.wage_id
$$;

-- ── B. THE DERIVED LABOR FACTS (rebuilt per company week; never appended to) ────────────────────
-- Build-time constants. lib/facts/labor-config-shared.ts carries the same numbers (pinned equal by
-- tests/fact-labor-config.test.ts); changing one bumps LABOR_BUILDER_VERSION, which rebuilds every week.
-- open_span (fix r2 P1, LABOR_OPEN_PUNCH_SPAN_HOURS): an OPEN punch (no clock-out) could run this long from its
-- clock-in, so every week the span [clock-in, clock-in + open_span) reaches reads it (frame, source,
-- fingerprint: one predicate), and the builder counts it on every day of that span. Fixed from clock-in, so
-- a week's set never moves with the clock; 24 h is past any real shift (10.5 h schedule maximum).
create function public.fact_labor_constants()
returns table(floor_day date, floor_week date, settle interval, ot_threshold_minutes integer, ot_multiplier numeric, read_window_days integer,
  open_span interval)
language sql immutable set search_path = pg_catalog, public as $$
  select date '2026-07-23', date '2026-07-19', interval '36 hours', 2400, 1.5::numeric, 90, interval '24 hours'
$$;

create table public.labor_quarter (
  location_id           uuid        not null references public.locations(id),
  quarter_start_at      timestamptz not null,
  person_key            text        not null check (person_key ~ '^(u:[0-9a-f-]{36}|ss:[1-9][0-9]{0,17}|toast:.{1,64})$'),
  source                text        not null check (source in ('7shifts', 'toast')),
  -- the 7shifts role_id (0268: role_id > 0), 0 = no role (Toast jobs have no role mapping: always 0)
  role_key              bigint      not null check (role_key >= 0),
  wall_quarter          smallint    not null check (wall_quarter between 0 and 95),
  fold                  smallint    not null check (fold in (0, 1)),
  business_date         date        not null,
  week_start            date        not null,
  user_id               uuid,
  minutes               smallint    not null check (minutes between 1 and 15),
  ot_minutes            smallint    not null check (ot_minutes between 0 and minutes),
  pay_class             text        not null check (pay_class in ('hourly', 'salaried')),
  rate_cents            integer     check (rate_cents >= 0),
  rate_basis            text        not null check (rate_basis in ('known', 'undated', 'before_first_known', 'none')),
  carry_back_rate_cents integer     check (carry_back_rate_cents >= 0),
  primary key (location_id, quarter_start_at, person_key, source, role_key),
  check ((user_id is not null) = (person_key like 'u:%') and (user_id is null or person_key = 'u:' || user_id::text)),
  -- Salaried minutes are presence: never priced here, never overtime.
  check (pay_class = 'hourly' or (ot_minutes = 0 and rate_cents is null and carry_back_rate_cents is null)),
  -- One price per row: a known rate, a carry-back for Q5, or nothing (priced at the shop estimate at read).
  check (pay_class = 'salaried' or ((rate_cents is not null) = (rate_basis in ('known', 'undated'))
    and (carry_back_rate_cents is not null) = (rate_basis = 'before_first_known')))
);
create index labor_quarter_week on public.labor_quarter (week_start);
create index labor_quarter_location_date on public.labor_quarter (location_id, business_date);
create table public.labor_day_coverage (
  location_id     uuid    not null references public.locations(id),
  business_date   date    not null,
  week_start      date    not null,
  state           text    not null check (state in ('covered', 'pending_settle', 'fallback_unverified', 'incomplete')),
  source          text    check (source in ('7shifts', 'toast')),
  evidence_run_id uuid,
  ss_minutes      integer not null check (ss_minutes >= 0),
  ss_people       integer not null check (ss_people >= 0),
  toast_minutes   integer not null check (toast_minutes >= 0),
  toast_people    integer not null check (toast_people >= 0),
  open_punches    integer not null check (open_punches >= 0),
  primary key (location_id, business_date),
  -- Coverage precedes numbers: covered only with ledger evidence; Toast is never 'covered'.
  check ((state = 'covered') = (evidence_run_id is not null)),
  check (state not in ('covered', 'pending_settle') or source = '7shifts'),
  check (state <> 'fallback_unverified' or source = 'toast')
);
create index labor_day_coverage_week on public.labor_day_coverage (week_start);
create table public.labor_week_coverage (
  week_start            date        primary key,
  source_fingerprint    text        not null check (source_fingerprint ~ '^[0-9a-f]{32}$'),
  builder_version       text        not null check (builder_version ~ '^labor-v[0-9]+$'),
  built_through         date        not null,
  ot_threshold_minutes  integer     not null check (ot_threshold_minutes > 0),
  ot_multiplier         numeric     not null check (ot_multiplier >= 1),
  ot_state              text        not null check (ot_state in ('assessed', 'lower_bound', 'week_open')),
  ot_identity_partial   integer     not null check (ot_identity_partial >= 0),
  ot_settings_disagree  boolean     not null,
  quarter_count         integer     not null check (quarter_count >= 0),
  day_count             integer     not null check (day_count >= 0),
  built_at              timestamptz not null default clock_timestamp(),
  check (extract(dow from week_start) = 0)
);
-- The wage-derived salaried weekly cost per linked shop (read only when the shop's salaried estimate is
-- blank: estimate_first). Null = no salaried wage found, never 0.
create table public.labor_week_salaried (
  week_start      date    not null,
  location_id     uuid    not null references public.locations(id),
  salaried_cents  bigint  check (salaried_cents >= 0),
  salaried_people integer not null check (salaried_people >= 0),
  primary key (week_start, location_id),
  check ((salaried_people = 0) = (salaried_cents is null))
);

-- THE FRAME: every shop-day of a week that is built. Shops = a live 7shifts location link, or Toast
-- time entries in the week. Days = [max(week, floor day), min(week + 6, yesterday ET)]. Evidence for a
-- linked shop-day = the EARLIEST finished ledger run whose time_punches result has a JSON-null
-- error_code, that started at least the settle time after the day ended, with the day inside its read
-- window. The run-level status is never read (it describes the whole run), nor sevenshifts_sync_state
-- (written before the ledger row). The ledger is append-only, so a day's evidence never changes once found.
create function public.fact_labor_week_days(p_week_start date)
returns table(location_id uuid, business_date date, linked boolean, evidence_run_id uuid, settled boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with k as (select * from public.fact_labor_constants()),
  b as (
    select (p_week_start::timestamp at time zone 'America/New_York') s, ((p_week_start + 7)::timestamp at time zone 'America/New_York') e,
      greatest(p_week_start, k.floor_day) d0, least(p_week_start + 6, (clock_timestamp() at time zone 'America/New_York')::date - 1) d1, k.settle, k.read_window_days, k.open_span
    from k
  ), shops as (
    select x.loc, bool_or(x.linked) linked from (
      select l.location_id loc, true linked from public.sevenshifts_location_links l where l.active
      union all
      select t.location_id, false from public.toast_time_entries t, b
       where not t.deleted and t.in_at < b.e and (t.out_at > b.s or (t.out_at is null and t.in_at + b.open_span > b.s))
    ) x group by x.loc
  ), d as (
    select shops.loc, shops.linked, g::date bd, ((g::date + 1)::timestamp at time zone 'America/New_York') day_end , b.settle, b.read_window_days
      from shops, b, generate_series(b.d0, b.d1, interval '1 day') g
  )
  select d.loc, d.bd, d.linked,
    case when d.linked then (select r.id from public.sevenshifts_sync_runs r
      where r.results -> 'time_punches' ? 'error_code' and jsonb_typeof(r.results -> 'time_punches' -> 'error_code') = 'null'
        and r.started_at >= d.day_end + d.settle
        and d.bd >= (r.started_at at time zone 'America/New_York')::date - d.read_window_days
      order by r.started_at, r.id limit 1) end,
    clock_timestamp() >= d.day_end + d.settle
  from d order by d.loc, d.bd
$$;

-- THE SOURCE of one week, read in ONE statement (one snapshot): what the builder builds from. Every
-- predicate is the fingerprint's. Ids travel as JSON numbers; the lib turns them into digit strings.
create function public.fact_labor_week_source(p_week_start date, p_builder_version text)
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
    select distinct p.user_id u from punches p
    union select l.sevenshifts_user_id from public.sevenshifts_user_links l where l.active
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
    'fingerprint', public.fact_labor_week_fingerprint(p_week_start, p_builder_version))
  );
end $$;

-- THE fingerprint of one company week (both shops): punches and Toast entries intersecting it (a moved
-- punch leaves the old week's set and joins the new one, so both rebuild), every link row, each involved
-- 7shifts account's newest wage observation, the 7shifts overtime settings the advisory reads, the
-- frame (shops, days, evidence, settle phase: a day leaving its settle window rebuilds), the day the
-- week is built through, and the builder version. Instants hash as epoch seconds (never session text).
-- fact_labor_week_source returns it in the SAME statement as the source rows, so the builder's input and
-- the fingerprint it sends are one snapshot; the replace RPC recomputes it under the week lock.
create function public.fact_labor_week_fingerprint(p_week_start date, p_builder_version text)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_s timestamptz := p_week_start::timestamp at time zone 'America/New_York';
  v_e timestamptz := (p_week_start + 7)::timestamp at time zone 'America/New_York';
  v_floor date; v_span interval; v_through date; v_punch text; v_toast text; v_links text; v_wages text; v_settings text; v_days text;
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
                         union select l.sevenshifts_user_id from public.sevenshifts_user_links l where l.active)
     group by w.user_id) o;
  select md5(string_agg(concat_ws(':', s.company_id, coalesce(s.daily_ot_threshold::text, '-'), coalesce(s.premium_ot_threshold::text, '-'),
           coalesce(s.consecutive_days_threshold::text, '-')), ',' order by s.company_id)) into v_settings from public.sevenshifts_labor_settings s;
  select md5(string_agg(concat_ws(':', f.location_id, f.business_date, f.linked, coalesce(f.evidence_run_id::text, '-'), f.settled), ',' order by f.location_id, f.business_date))
    into v_days from public.fact_labor_week_days(p_week_start) f;
  return md5(concat_ws('|', 'v:' || p_builder_version, 'w:' || p_week_start, 't:' || coalesce(v_through::text, 'none'),
    'p:' || coalesce(v_punch, 'none'), 'x:' || coalesce(v_toast, 'none'), 'l:' || coalesce(v_links, 'none'), 'g:' || coalesce(v_wages, 'none'),
    's:' || coalesce(v_settings, 'none'), 'd:' || coalesce(v_days, 'none')));
end $$;

-- The diff: every company week from the floor week through the week holding yesterday (ET) whose stored
-- fingerprint differs or is missing. Evaluated against current state on every pass; newest first.
create function public.fact_labor_weeks_stale(p_limit integer, p_builder_version text)
returns table(week_start date, week_fingerprint text, stored_fingerprint text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_yesterday date := (clock_timestamp() at time zone 'America/New_York')::date - 1; v_floor_week date;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 or p_builder_version is null then raise exception 'fact_invalid_request'; end if;
  select floor_week into v_floor_week from public.fact_labor_constants();
  return query
  with weeks as (
    select g::date w from generate_series(v_floor_week, v_yesterday - extract(dow from v_yesterday)::integer, interval '7 days') g
  ), fp as (
    select weeks.w, public.fact_labor_week_fingerprint(weeks.w, p_builder_version) f from weeks
  )
  select fp.w, fp.f, c.source_fingerprint from fp left join public.labor_week_coverage c on c.week_start = fp.w
   where c.source_fingerprint is distinct from fp.f order by fp.w desc limit p_limit;
end $$;

-- The ONE writer. Advisory week lock -> this week's fact rows -> this week's coverage rows. Recomputes the
-- fingerprint under the lock (a capture or sync that committed meanwhile = fact_stale), refuses an open
-- day, and proves the payload against the frame: the days ARE the frame, a covered day names the frame's
-- evidence, every quarter sits on a frame day under that day's one source. A repeat call is a no-op rebuild.
create function public.fact_replace_labor_week(p_week_start date, p_builder_version text, p_fingerprint text,
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
    ot_state, ot_identity_partial, ot_settings_disagree, quarter_count, day_count, built_at)
  select p_week_start, p_fingerprint, p_builder_version, v_through, k.ot_threshold_minutes, k.ot_multiplier,
    p_week ->> 'ot_state', (p_week ->> 'ot_identity_partial')::integer, (p_week ->> 'ot_settings_disagree')::boolean, v_quarters, v_days, clock_timestamp()
  from public.fact_labor_constants() k
  on conflict (week_start) do update set source_fingerprint = excluded.source_fingerprint, builder_version = excluded.builder_version,
    built_through = excluded.built_through, ot_threshold_minutes = excluded.ot_threshold_minutes, ot_multiplier = excluded.ot_multiplier,
    ot_state = excluded.ot_state, ot_identity_partial = excluded.ot_identity_partial, ot_settings_disagree = excluded.ot_settings_disagree,
    quarter_count = excluded.quarter_count, day_count = excluded.day_count, built_at = excluded.built_at;
  return jsonb_build_object('week_start', p_week_start, 'quarters', v_quarters, 'days', v_days, 'ot_state', p_week ->> 'ot_state');
end $$;

-- ── C. READ TIME: burden, cost components, SPLH (nothing here is stored; nothing rebuilds) ──────────
-- The burden % (employer payroll taxes + benefits), dated, company (location NULL) or per shop; a shop row
-- beats the company row; the newest valid_from <= week start wins. Append-only by grant; its ONE writer is
-- save_labor_burden (Owner / CGS / MoO). Not in any fingerprint: a backdated payroll row re-prices history,
-- so the writer records it itself (fix r1 P2): ONE destructive labor_burden.save audit row in the same
-- transaction, naming the actor, the scope and the value in force for that scope at valid_from before and
-- after. The note never enters the audit row (has_note only).
create table public.labor_burden_settings (
  id          uuid         primary key default gen_random_uuid(),
  location_id uuid         references public.locations(id),
  burden_pct  numeric(5,2) not null check (burden_pct >= 0 and burden_pct <= 50),
  valid_from  date         not null,
  source      text         not null check (source in ('estimated', 'payroll')),
  note        text         check (char_length(note) <= 500),
  created_by  uuid         not null references public.users(id),
  created_at  timestamptz  not null default clock_timestamp()
);
create index labor_burden_settings_lookup on public.labor_burden_settings (location_id, valid_from desc, created_at desc);

create function public.save_labor_burden(p_actor uuid, p_location_id uuid, p_burden_pct numeric, p_valid_from date, p_source text, p_note text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_role text; v_before jsonb; v_pct numeric(5,2);
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('owner', 'cgs', 'moo') for share;
  end if;
  if v_role is null then raise exception 'labor_burden_forbidden'; end if;
  if p_burden_pct is null or p_burden_pct < 0 or p_burden_pct > 50 or p_valid_from is null or p_source not in ('estimated', 'payroll')
    or char_length(coalesce(p_note, '')) > 500
    or (p_location_id is not null and not exists (select 1 from public.locations l where l.id = p_location_id)) then
    raise exception 'labor_burden_invalid'; end if;
  -- Saves of one scope queue, so each audit row's "before" is the value the previous save left.
  perform pg_advisory_xact_lock(hashtextextended('labor_burden:' || coalesce(p_location_id::text, 'company'), 0));
  -- Before = what this scope read at valid_from: a shop row, else the company row, else the 12% default.
  select coalesce((select jsonb_build_object('burden_pct', s.burden_pct, 'source', s.source, 'valid_from', s.valid_from,
            'scope', case when s.location_id is null then 'company' else 'shop' end, 'row_id', s.id)
          from public.labor_burden_settings s
         where (s.location_id = p_location_id or s.location_id is null) and s.valid_from <= p_valid_from
         order by (s.location_id is null), s.valid_from desc, s.created_at desc limit 1),
         jsonb_build_object('burden_pct', 12.00, 'source', 'estimated', 'scope', 'default'))
    into v_before;
  v_pct := round(p_burden_pct, 2);
  insert into public.labor_burden_settings (location_id, burden_pct, valid_from, source, note, created_by)
  values (p_location_id, v_pct, p_valid_from, p_source, nullif(p_note, ''), p_actor) returning id into v_id;
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, before_state, after_state, metadata, destructive)
  values (p_actor, v_role, 'labor_burden.save', 'labor_burden_settings', v_id, v_before,
    jsonb_build_object('burden_pct', v_pct, 'source', p_source, 'valid_from', p_valid_from, 'location_id', p_location_id),
    jsonb_build_object('scope', case when p_location_id is null then 'company' else 'shop' end, 'location_id', p_location_id,
      'valid_from', p_valid_from, 'has_note', coalesce(p_note, '') <> ''),
    true);
  return v_id;
end $$;

-- The burden in force for a shop's week: shop row, else company row, else the 12% default, `estimated`.
create function public.fact_labor_burden_for(p_location_id uuid, p_week_start date)
returns table(burden_pct numeric, burden_basis text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(b.burden_pct, 12.00), coalesce(b.source, 'estimated') from (select 1) one
  left join lateral (select s.burden_pct, s.source from public.labor_burden_settings s
     where (s.location_id = p_location_id or s.location_id is null) and s.valid_from <= p_week_start
     order by (s.location_id is null), s.valid_from desc, s.created_at desc limit 1) b on true
$$;

-- COST COMPONENTS per (payroll week, shop) for the days in [from, to] (at most 366 days, from >= the
-- history floor). One shop, or p_location_id NULL = every shop with labor in those weeks.
--   rate per hourly row: known / undated = its rate; before_first_known = the carried-back first wage
--     (Q5 'first_known') or the shop estimate ('dc_minimum'); none = the shop estimate (0274; 1840).
--   hourly straight = sum(minutes x rate) / 60.
--   overtime premium = 0.5 x the person-week's BLENDED rate (sum(minutes x rate) / sum(minutes), every
--     hourly row of that person in that week, both shops) x overtime minutes / 60, on the shop and day the
--     overtime minutes fell.
--   salaried = the shop's estimated weekly salary (0274, estimate_first), else the wage-derived weekly
--     cost (labor_week_salaried), else unknown; prorated by the range's days in the week / 7.
-- Coverage first: a week never built reads ot_state 'unbuilt'; day counts say what is missing; open_punches
-- counts the unclosed punches on the range's days (fix r1 P1): their hours are unknown, so the pricer
-- (lib/facts/labor-cost-shared.ts) withholds every % until they close.
create function public.fact_labor_cost(p_location_id uuid, p_from date, p_to date, p_wage_fallback text)
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
      q.pay_class = 'hourly' and (q.rate_basis = 'none' or (q.rate_basis = 'before_first_known' and p_wage_fallback = 'dc_minimum')) est
    from public.labor_quarter q left join public.schedule_shop_settings s on s.location_id = q.location_id
    where q.week_start in (select weeks.w from weeks)
  ), blended as (
    select priced.pk, priced.ws, sum(priced.m * priced.rate)::numeric / nullif(sum(priced.m), 0) r
      from priced where priced.pc = 'hourly' group by priced.pk, priced.ws
  ), agg as (
    select p.ws, p.loc,
      round(coalesce(sum(p.m * p.rate) filter (where p.pc = 'hourly'), 0) / 60.0)::bigint straight,
      round(coalesce(sum(0.5 * b.r * p.ot) filter (where p.pc = 'hourly'), 0) / 60.0)::bigint prem,
      coalesce(sum(p.m) filter (where p.est), 0)::bigint est_m,
      coalesce(sum(p.m) filter (where p.pc = 'hourly'), 0)::bigint hm,
      coalesce(sum(p.ot), 0)::bigint otm,
      coalesce(sum(p.m) filter (where p.pc = 'salaried'), 0)::bigint sm
    from priced p left join blended b on b.pk = p.pk and b.ws = p.ws
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

-- SALES PER LABOR HOUR inputs per (shop, quarter) over at most 31 days (the 0232 window guard): labor
-- minutes SUMMED PER QUARTER FIRST (a quarter with two roles or people never doubles its sales), joined
-- to the quarter's 'sale' checks through THE classifier (fact_sales_check_classes) on the chosen clock:
-- 'placed' (opened) or 'promised'. labor_minutes = every observed minute (hourly + salaried presence:
-- splh); hourly_minutes = hourly only (splh_hourly).
-- Fix r1 P2: checks are SELECTED by the chosen clock's ET date (never their Toast business date, which a
-- late close or a next-day promise leaves on another day), classified one business date at a time by the
-- canonical classifier, and every row stays inside [from, to] on that clock.
-- Coverage rides along on BOTH sides, unknown is never 0 (fix r1 P2): labor_minutes / hourly_minutes are
-- NULL on a day with no labor_day_coverage row (labor unbuilt), day_state says what a built day is;
-- sales_state is 'covered' only when every business date that can land a check on that clock day has
-- order facts covered (0337 fact_day_coverage covered | covered_zero): the day itself, the day before (a
-- check after midnight belongs to the previous business date), every business date that actually landed a
-- check there, and (fix r2 P2, promised clock only) every CAPTURED business date in the bounded lookback
-- [day - 14, day + 1] (LABOR_PROMISED_LOOKBACK_DAYS). "Captured" is read from the SOURCE, never from built
-- facts: a toast_capture_runs row (any status) or a toast_order_latest_pointers row for that shop and date,
-- i.e. a day the order fact layer has to build (fact_order_days_stale's own day set). So a Monday whose
-- order-fact build failed makes Wednesday's promised sales unknown even though no fact row of Monday exists.
-- Otherwise 'not_covered' and sales_cents / sale_checks are NULL. Stated limit: a check promised MORE than
-- 14 days after its business date counts only once that business date's facts are built (then `cand` finds
-- it); before that it is invisible here (catering lead time beyond two weeks).
create function public.fact_labor_splh(p_location_id uuid, p_from date, p_to date, p_clock text)
returns table(quarter_start_at timestamptz, business_date date, wall_quarter smallint, fold smallint, labor_minutes bigint,
  hourly_minutes bigint, sales_cents bigint, sale_checks bigint, day_state text, open_punches integer, sales_state text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_clock is null or p_clock not in ('placed', 'promised') then raise exception 'fact_invalid_request'; end if;
  return query
  with lab as (
    select q.quarter_start_at qs, min(q.business_date) bd, min(q.wall_quarter) wq, min(q.fold) fd,
      sum(q.minutes)::bigint lm, coalesce(sum(q.minutes) filter (where q.pay_class = 'hourly'), 0)::bigint hm
      from public.labor_quarter q where q.location_id = p_location_id and q.business_date between p_from and p_to group by q.quarter_start_at
  ), cand as (
    -- Every check whose chosen-clock date is in the window. Placed: business date = that date or the day
    -- before. Promised: placed on or before its promise, so its business date is at most the day after.
    select f.business_date fbd, f.order_guid og, f.check_guid cg,
      case when p_clock = 'placed' then f.opened_quarter_start_at else f.promised_quarter_start_at end qs,
      case when p_clock = 'placed' then f.opened_et_date else f.promised_et_date end bd,
      case when p_clock = 'placed' then f.opened_wall_quarter else f.promised_wall_quarter end wq,
      case when p_clock = 'placed' then f.opened_fold else f.promised_fold end fd
    from public.fact_order_check f
    where f.location_id = p_location_id
      and (case when p_clock = 'placed' then f.opened_et_date else f.promised_et_date end) between p_from and p_to
      and f.business_date <= p_to + 1
      and (p_clock = 'promised' or f.business_date >= p_from - 1)
  ), cls as (
    -- The canonical classifier, one business date at a time (its window guard holds for each call).
    select c.business_date, c.order_guid, c.check_guid, c.sale_class, c.amount_cents
      from (select distinct cand.fbd from cand) b
      cross join lateral public.fact_sales_check_classes(p_location_id, b.fbd, b.fbd) c
  ), sales as (
    select cand.qs, cand.bd, cand.wq, cand.fd, sum(cls.amount_cents)::bigint sc, count(*)::bigint n
      from cand join cls on cls.business_date = cand.fbd and cls.order_guid = cand.og and cls.check_guid = cand.cg
     where cls.sale_class = 'sale' and cand.qs is not null
     group by 1, 2, 3, 4
  ), captured as (
    -- Fix r2 P2: the business dates the SOURCE says exist (independent of any fact build), promised clock only.
    select r.business_date bd from public.toast_capture_runs r
     where p_clock = 'promised' and r.location_id = p_location_id and r.business_date between p_from - 14 and p_to + 1
    union
    select lp.business_date from public.toast_order_latest_pointers lp
     where p_clock = 'promised' and lp.location_id = p_location_id and lp.business_date between p_from - 14 and p_to + 1
  ), need as (
    -- The business dates each clock day depends on.
    select g::date d, g::date nb from generate_series(p_from, p_to, interval '1 day') g
    union select g::date, g::date - 1 from generate_series(p_from, p_to, interval '1 day') g
    union select cand.bd, cand.fbd from cand
    -- Promised: every captured business date in [day - 14, day + 1] (LABOR_PROMISED_LOOKBACK_DAYS).
    union select g::date, captured.bd from generate_series(p_from, p_to, interval '1 day') g
      join captured on captured.bd between g::date - 14 and g::date + 1
  ), cov as (
    select need.d, bool_and(coalesce(c.state in ('covered', 'covered_zero'), false)) ok
      from need left join public.fact_day_coverage c on c.location_id = p_location_id and c.business_date = need.nb and c.fact = 'orders'
     group by need.d
  ), j as (
    select coalesce(lab.qs, sales.qs) qs, coalesce(lab.bd, sales.bd) bd, coalesce(lab.wq, sales.wq) wq, coalesce(lab.fd, sales.fd) fd,
      lab.lm, lab.hm, sales.sc, sales.n
    from lab full join sales on sales.qs = lab.qs where coalesce(lab.qs, sales.qs) is not null
  )
  select j.qs, j.bd, j.wq::smallint, j.fd::smallint,
    case when d.location_id is not null then coalesce(j.lm, 0) end,
    case when d.location_id is not null then coalesce(j.hm, 0) end,
    case when cov.ok then coalesce(j.sc, 0) end,
    case when cov.ok then coalesce(j.n, 0) end,
    d.state, d.open_punches,
    case when cov.ok then 'covered' else 'not_covered' end
    from j
    left join public.labor_day_coverage d on d.location_id = p_location_id and d.business_date = j.bd
    left join cov on cov.d = j.bd
   where j.bd between p_from and p_to
   order by j.qs;
end $$;

-- ── CEILINGS: deny-all RLS, explicit DELETE denial, service_role SELECT only; RPCs service_role only ──
do $$ declare t text; f regprocedure; begin
  foreach t in array array['fact_wage_observations','labor_quarter','labor_day_coverage','labor_week_coverage','labor_week_salaried','labor_burden_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  revoke all on sequence public.fact_wage_observations_seq_seq from public, anon, authenticated, service_role;
  revoke all on function public.fact_wage_observe() from public, anon, authenticated, service_role;
  revoke all on function public.fact_labor_constants() from public, anon, authenticated, service_role;
  foreach f in array array[
    'public.fact_wage_current_versions(bigint[])'::regprocedure,
    'public.fact_labor_week_days(date)'::regprocedure,
    'public.fact_labor_week_source(date,text)'::regprocedure,
    'public.fact_labor_week_fingerprint(date,text)'::regprocedure,
    'public.fact_labor_weeks_stale(integer,text)'::regprocedure,
    'public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.save_labor_burden(uuid,uuid,numeric,date,text,text)'::regprocedure,
    'public.fact_labor_burden_for(uuid,date)'::regprocedure,
    'public.fact_labor_cost(uuid,date,date,text)'::regprocedure,
    'public.fact_labor_splh(uuid,date,date,text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare t text; f regprocedure; p text; begin
  foreach t in array array['fact_wage_observations','labor_quarter','labor_day_coverage','labor_week_coverage','labor_week_salaried','labor_burden_settings'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0338: % lacks service_role SELECT', t; end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception '0338: service_role holds % on %', p, t; end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0338: PostgREST role holds % on %', p, t; end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.fact_wage_observe()'::regprocedure, 'public.fact_labor_constants()'::regprocedure] loop
    if has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE') then raise exception '0338: internal function escape %', f; end if;
  end loop;
  foreach f in array array[
    'public.fact_wage_current_versions(bigint[])'::regprocedure,
    'public.fact_labor_week_days(date)'::regprocedure,
    'public.fact_labor_week_source(date,text)'::regprocedure,
    'public.fact_labor_week_fingerprint(date,text)'::regprocedure,
    'public.fact_labor_weeks_stale(integer,text)'::regprocedure,
    'public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.save_labor_burden(uuid,uuid,numeric,date,text,text)'::regprocedure,
    'public.fact_labor_burden_for(uuid,date)'::regprocedure,
    'public.fact_labor_cost(uuid,date,date,text)'::regprocedure,
    'public.fact_labor_splh(uuid,date,date,text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0338: RPC escape %', f; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
