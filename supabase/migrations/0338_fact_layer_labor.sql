-- Migration 0338_fact_layer_labor
-- AUTHORED 2026-11-17 (item 2 PR 2c, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
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

-- ── CEILINGS ────────────────────────────────────────────────────────────────────────────────────
do $$ declare t text; f regprocedure; begin
  foreach t in array array['fact_wage_observations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  revoke all on sequence public.fact_wage_observations_seq_seq from public, anon, authenticated, service_role;
  revoke all on function public.fact_wage_observe() from public, anon, authenticated, service_role;
  foreach f in array array[
    'public.fact_wage_current_versions(bigint[])'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
