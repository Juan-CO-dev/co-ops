-- AUTHORED ONLY 2026-10-07. NOT APPLIED. CC sim + review, then Juan's apply gate.
-- APPLIED TO PROD 2026-10-07 (schema_migrations version 20261007170451, name '0217_assignments_stations'). The line above is the authoring-time gate note, kept as history.
-- Phase 1: tenant stations, append-only staffing intervals, task assignment-down.
-- No station seed data and no Toast inference (phase 2). No production data edits.
-- Pre-0044 migrations are not in this clone. Refuse schema drift before writing.
begin;
do $$
declare c text;
begin
  foreach c in array array['id','report_type','location_id','operational_date','assigner_id','assignee_id','note','created_at','active'] loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='report_assignments' and column_name=c) then
      raise exception 'report_assignments missing expected column %', c;
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid='public.report_assignments'::regclass and contype='c'
    and pg_get_constraintdef(oid) ~ 'assigner_id <> assignee_id') then
    raise exception 'expected report_assignments no-self CHECK missing';
  end if;
end $$;
-- Existing union/migration evidence names these exact enum labels; IF NOT EXISTS
-- is safe on installations missing a label. New values are first USED after COMMIT.
alter type public.report_type_enum add value if not exists 'am_prep';
alter type public.report_type_enum add value if not exists 'mid_day_prep';
alter type public.report_type_enum add value if not exists 'cash_report';
alter type public.report_type_enum add value if not exists 'opening_report';
alter type public.report_type_enum add value if not exists 'receiving';
alter type public.report_type_enum add value if not exists 'counts';
alter type public.report_type_enum add value if not exists 'ordering';
alter type public.report_type_enum add value if not exists 'pm_report';

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  name_es text not null check (length(btrim(name_es)) between 1 and 100),
  sort integer not null default 0 check (sort between 0 and 10000),
  active boolean not null default true,
  unique(id, location_id)
);
create table public.station_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  location_id uuid not null references public.locations(id),
  business_date date not null,
  user_id uuid not null references public.users(id),
  station_id uuid,
  kind text not null check (kind in ('assign','claim','move','release')),
  actor_id uuid not null references public.users(id),
  at timestamptz not null default clock_timestamp(),
  -- 'move' alone cannot tell whether the user may change again. Preserve origin.
  source text check (source in ('assigned','claimed')),
  foreign key (station_id, location_id) references public.stations(id, location_id),
  check ((kind='release' and station_id is null and source is null)
    or (kind<>'release' and station_id is not null and source is not null)),
  check (kind<>'claim' or (source='claimed' and actor_id=user_id)),
  check (source is distinct from 'claimed' or actor_id=user_id),
  check (kind<>'assign' or source='assigned')
);
create index station_events_head on public.station_events(location_id,business_date,user_id,sequence desc);
create index stations_location on public.stations(location_id,sort);
alter table public.stations enable row level security;
alter table public.station_events enable row level security;
-- Deny-all RLS, 0203/0214 pattern. No user-facing policies.
revoke all on public.stations, public.station_events from public, anon, authenticated;
grant select, insert, update on public.stations to service_role;
grant select, insert on public.station_events to service_role;
revoke update, delete, truncate on public.station_events from service_role;
revoke delete, truncate on public.stations from service_role;
revoke all on sequence public.station_events_sequence_seq from public, anon, authenticated;
grant usage, select on sequence public.station_events_sequence_seq to service_role;

-- Staff JWTs can call PostgREST directly. Retire legacy direct assignment writes
-- (0058 permitted AGM inserts without app target-level validation); reads stay intact.
revoke insert, update, delete on public.report_assignments from public, anon, authenticated;
grant select, insert, update on public.report_assignments to service_role;
create unique index if not exists report_assignments_one_active_task
  on public.report_assignments(location_id,operational_date,assignee_id,report_type) where active;
-- Existing duplicates make index creation fail. Do NOT silently rewrite history.

-- Live role/location helper used only by service-role RPCs. Role SET is invariant.
create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text; v_level integer;
begin
  select role into v_role from public.users where id=p_user_id and active for share;
  v_level := case v_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8
    when 'gm' then 7 when 'agm' then 6 when 'catering_mgr' then 6 when 'prep_mgr' then 6
    when 'social_media_mgr' then 6 when 'shift_lead' then 5 when 'key_holder' then 4
    when 'trainer' then 4 when 'employee' then 3 when 'trainee' then 2
    when 'hired_not_yet_worked' then 1 when 'prospect' then 0 else null end;
  if v_level is null then raise exception 'assignee_unavailable'; end if;
  if v_level < 9 then
    perform 1 from public.user_locations where user_id=p_user_id and location_id=p_location_id and active for share;
    if not found then raise exception 'location_access_denied'; end if;
  end if;
  perform 1 from public.locations where id=p_location_id and active;
  if not found then raise exception 'location_access_denied'; end if;
  return v_level;
end $$;

-- Station shifts follow a still-live closing across midnight. Reuse C.48's
-- shift_start_at + 16-hour expiry (0046), never invent a calendar cutoff.
create or replace function public.station_business_date(p_location_id uuid)
returns date language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select i.date from public.checklist_instances i
    join public.checklist_templates t on t.id=i.template_id
    where i.location_id=p_location_id and t.type='closing' and i.status='open'
      and i.shift_start_at <= now() and i.shift_start_at + interval '16 hours' > now()
      and i.date <= (now() at time zone 'America/New_York')::date
    order by i.date desc, i.shift_start_at desc limit 1),
    (now() at time zone 'America/New_York')::date)
$$;

create or replace function public.write_station_event(p_actor_id uuid,p_user_id uuid,p_location_id uuid,p_station_id uuid,p_manage boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := public.station_business_date(p_location_id);
  v_actor integer; v_target integer; v_previous public.station_events%rowtype;
  v_id uuid; v_kind text; v_source text;
begin
  -- All requests for one person's day serialize, including the empty-head case.
  perform pg_advisory_xact_lock(hashtextextended('station/'||p_location_id::text||'/'||v_day::text||'/'||p_user_id::text,0));
  v_actor := public.assignment_user_level(p_actor_id,p_location_id);
  v_target := public.assignment_user_level(p_user_id,p_location_id);
  if (p_manage or p_actor_id <> p_user_id) and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'; end if;
  select * into v_previous from public.station_events
    where location_id=p_location_id and business_date=v_day and user_id=p_user_id order by sequence desc limit 1;
  if p_actor_id=p_user_id and v_previous.station_id is not null and v_previous.source='assigned' then
    raise exception 'station_locked';
  end if;
  if p_station_id is not null then
    perform 1 from public.stations where id=p_station_id and location_id=p_location_id and active for share;
    if not found then raise exception 'station_unavailable'; end if;
  end if;
  v_source := case when p_station_id is null then null when p_actor_id=p_user_id then 'claimed' else 'assigned' end;
  if v_previous.id is not null and v_previous.station_id is not distinct from p_station_id
     and v_previous.source is not distinct from v_source then
    return jsonb_build_object('id',v_previous.id,'changed',false);
  end if;
  v_kind := case when p_station_id is null then 'release'
    when v_previous.station_id is not null then 'move'
    when p_actor_id=p_user_id then 'claim' else 'assign' end;
  insert into public.station_events(location_id,business_date,user_id,station_id,kind,actor_id,source,at)
    values(p_location_id,v_day,p_user_id,p_station_id,v_kind,p_actor_id,v_source,clock_timestamp()) returning id into v_id;
  return jsonb_build_object('id',v_id,'changed',true);
end $$;

create or replace function public.write_task_assignment(p_actor_id uuid,p_location_id uuid,p_user_id uuid,p_task text,p_note text,p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := (clock_timestamp() at time zone 'America/New_York')::date;
  v_actor integer; v_target integer; v_user uuid := p_user_id; v_task text := p_task;
  v_row public.report_assignments%rowtype; v_id uuid;
begin
  v_actor := public.assignment_user_level(p_actor_id,p_location_id);
  if v_actor<4 then raise exception 'role_insufficient'; end if;
  if p_assignment_id is not null then
    select * into v_row from public.report_assignments where id=p_assignment_id and location_id=p_location_id for update;
    if not found then raise exception 'assignment_not_found'; end if;
    -- Past operational days are immutable accountability history.
    if v_row.operational_date < public.station_business_date(p_location_id) then
      raise exception 'assignment_not_found';
    end if;
    -- Retraction is not assigning up: only actor authority and row shop matter.
    update public.report_assignments set active=false where id=p_assignment_id and active returning id into v_id;
    return jsonb_build_object('id',p_assignment_id,'changed',v_id is not null);
  end if;
  if v_task is null or v_task not in ('am_prep','mid_day_prep','cash_report','opening_report','receiving','counts','ordering','pm_report') or v_user is null or length(p_note)>1000 then
    raise exception 'invalid_payload';
  end if;
  if v_user=p_actor_id then raise exception 'self_assignment'; end if;
  v_target := public.assignment_user_level(v_user,p_location_id);
  if v_target>v_actor then raise exception 'role_insufficient'; end if;
  -- Parenthesized: PL/pgSQL reads an IF condition only up to the FIRST "then" token, so a bare
  -- CASE ... THEN inside the condition is cut in half (sim apply 2026-10-07: syntax error).
  if v_target < (case when v_task in ('am_prep','mid_day_prep','opening_report') then 3 else 4 end) then
    raise exception 'role_insufficient';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task/'||p_location_id::text||'/'||v_day::text||'/'||v_user::text||'/'||v_task,0));
  select id into v_id from public.report_assignments where location_id=p_location_id and operational_date=v_day
    and assignee_id=v_user and report_type::text=v_task and active;
  if v_id is not null then return jsonb_build_object('id',v_id,'changed',false); end if;
  insert into public.report_assignments(report_type,location_id,operational_date,assigner_id,assignee_id,note,active)
    values(v_task::public.report_type_enum,p_location_id,v_day,p_actor_id,v_user,nullif(btrim(p_note),''),true) returning id into v_id;
  return jsonb_build_object('id',v_id,'changed',true);
end $$;

revoke all on function public.assignment_user_level(uuid,uuid) from public,anon,authenticated;
revoke all on function public.station_business_date(uuid) from public,anon,authenticated;
revoke all on function public.write_station_event(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.write_task_assignment(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.assignment_user_level(uuid,uuid) to service_role;
grant execute on function public.station_business_date(uuid) to service_role;
grant execute on function public.write_station_event(uuid,uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.write_task_assignment(uuid,uuid,uuid,text,text,uuid) to service_role;
do $$
begin
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public'
    and routine_name in ('assignment_user_level','station_business_date','write_station_event','write_task_assignment')
    and privilege_type='EXECUTE' and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception 'assignment RPC execution grant escaped';
  end if;
end $$;
-- Closing manual work retains each item's floor; instance creation is employee+.
-- Evidence: Foundation Spec v1.3 checklist_completions_insert plus PHASE_1_RLS_AUDIT
-- Test 1. Keep the original policies; these INSERT-only alternatives reproduce every
-- attribution/location/open guard and additionally bind item to instance/template.
-- No template data, UPDATE or DELETE permission changes. AUTHORED, NOT APPLIED.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'checklist_completions' and policyname = 'checklist_completions_insert' and cmd = 'INSERT')
    or not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'checklist_instances' and policyname = 'checklist_instances_insert' and cmd = 'INSERT') then
    raise exception 'closing participation requires known baseline INSERT policies';
  end if;
end $$;
create policy checklist_instances_insert_closing_staff on public.checklist_instances
  for insert to authenticated with check (
    public.current_user_id() is not null
    and public.current_user_role_level() >= 3
    and location_id = any(public.current_user_locations())
    and status = 'open'
    and date = (now() at time zone 'America/New_York')::date
    and exists (select 1 from public.checklist_templates t
      where t.id = checklist_instances.template_id and t.location_id = checklist_instances.location_id
        and t.type = 'closing' and t.active)
  );
create policy checklist_completions_insert_closing_staff on public.checklist_completions
  for insert to authenticated with check (
    completed_by = public.current_user_id()
    and public.current_user_role_level() >= 2
    and exists (
      select 1 from public.checklist_instances i
      join public.checklist_templates t on t.id = i.template_id
      join public.checklist_template_items ti on ti.template_id = i.template_id
      where i.id = checklist_completions.instance_id
        and ti.id = checklist_completions.template_item_id
        and i.location_id = any(public.current_user_locations())
        and i.status = 'open' and t.type = 'closing' and ti.active
        and public.current_user_role_level() >= ti.min_role_level
        and ti.report_reference_type is null
        and not (coalesce(ti.ref_track_item_completion, false) and ti.references_template_item_id is not null)
    )
  );

-- Report navigation: MoO (8) can read both shops; GM (7) remains shop-bound.
-- Source qualifiers: 0058_role_model_renumber.sql (checklist + written),
-- 0067_cash_reports.sql (cash), 0072_pm_report_tables.sql (PM + manager evals).
-- Only the location/global-read branch changes; written visibility and KH floors stay.
-- Config/admin remain at 9: checklist_templates, checklist_template_items,
-- maintenance_tickets, shifts_daily_data and shift_overlays. Neither shifts table
-- backs the Reports hub/trends. The hub's template metadata reads use service-role.
-- Also unchanged: shift_overlay_corrections, training_reports, report_views and
-- prep_list_resolutions (no readers in the approved report surfaces).
-- Assert the exact SELECT policy manifest; never silently skip a missing policy.
do $$
declare r record;
begin
  for r in select * from (values
    ('checklist_completions', 'checklist_completions_read'),
    ('checklist_incomplete_reasons', 'checklist_incomplete_reasons_read'),
    ('checklist_instances', 'checklist_instances_read'),
    ('checklist_submissions', 'checklist_submissions_read'),
    ('written_reports', 'written_reports_read'),
    ('cash_reports', 'cash_reports_read'),
    ('pm_reports', 'pm_reports_read'),
    ('pm_employee_evals', 'pm_evals_read_mgr')
  ) as expected(table_name, policy_name) loop
    if not exists (select 1 from pg_policies where schemaname='public'
      and tablename=r.table_name and policyname=r.policy_name and cmd='SELECT') then
      raise exception 'expected report SELECT policy missing: %.%', r.table_name, r.policy_name;
    end if;
  end loop;
end $$;

alter policy checklist_completions_read on public.checklist_completions
  using (exists (select 1 from public.checklist_instances i
    where ((i.id = checklist_completions.instance_id)
      and ((i.location_id = any (public.current_user_locations())) or (public.current_user_role_level() >= 8)))));
alter policy checklist_incomplete_reasons_read on public.checklist_incomplete_reasons
  using (exists (select 1 from public.checklist_instances i
    where ((i.id = checklist_incomplete_reasons.instance_id)
      and ((i.location_id = any (public.current_user_locations())) or (public.current_user_role_level() >= 8)))));
alter policy checklist_instances_read on public.checklist_instances
  using ((location_id = any (public.current_user_locations())) or (public.current_user_role_level() >= 8));
alter policy checklist_submissions_read on public.checklist_submissions
  using (exists (select 1 from public.checklist_instances i
    where ((i.id = checklist_submissions.instance_id)
      and ((i.location_id = any (public.current_user_locations())) or (public.current_user_role_level() >= 8)))));
alter policy written_reports_read on public.written_reports
  using ((public.current_user_role_level() >= visibility_min_level)
    and ((location_id is null) or (location_id = any (public.current_user_locations())) or (public.current_user_role_level() >= 8)));
alter policy cash_reports_read on public.cash_reports using (
  public.current_user_role_level() >= 4 and
  (location_id = any(public.current_user_locations()) or public.current_user_role_level() >= 8));
alter policy pm_reports_read on public.pm_reports using (
  public.current_user_role_level() >= 4 and
  (location_id = any(public.current_user_locations()) or public.current_user_role_level() >= 8));
alter policy pm_evals_read_mgr on public.pm_employee_evals using (
  public.current_user_role_level() >= 4 and
  (location_id = any(public.current_user_locations()) or public.current_user_role_level() >= 8));

-- Compare the full deparsed expressions, preserving every parenthesis/operator.
-- A fixed search_path makes pg_policies' qualification deterministic; only layout
-- whitespace/case is normalized, never the live expression used by ALTER POLICY.
set local search_path = pg_catalog, public;
do $$
declare r record; v_qual text;
begin
  for r in select * from (values
    ('checklist_completions', 'checklist_completions_read',
      '(EXISTS ( SELECT 1 FROM checklist_instances i WHERE ((i.id = checklist_completions.instance_id) AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))))'),
    ('checklist_incomplete_reasons', 'checklist_incomplete_reasons_read',
      '(EXISTS ( SELECT 1 FROM checklist_instances i WHERE ((i.id = checklist_incomplete_reasons.instance_id) AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))))'),
    ('checklist_instances', 'checklist_instances_read',
      '((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8))'),
    ('checklist_submissions', 'checklist_submissions_read',
      '(EXISTS ( SELECT 1 FROM checklist_instances i WHERE ((i.id = checklist_submissions.instance_id) AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))))'),
    ('written_reports', 'written_reports_read',
      '((current_user_role_level() >= visibility_min_level) AND ((location_id IS NULL) OR (location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))'),
    ('cash_reports', 'cash_reports_read',
      '((current_user_role_level() >= 4) AND ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))'),
    ('pm_reports', 'pm_reports_read',
      '((current_user_role_level() >= 4) AND ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))'),
    ('pm_employee_evals', 'pm_evals_read_mgr',
      '((current_user_role_level() >= 4) AND ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 8)))')
  ) as expected(table_name, policy_name, expression) loop
    select qual into v_qual from pg_policies where schemaname='public'
      and tablename=r.table_name and policyname=r.policy_name and cmd='SELECT';
    -- Postgres stores the level literals as "(8)::numeric" (current_user_role_level() returns
    -- numeric; sim probe 2026-10-07), so strip that cast before comparing to the expected text.
    if v_qual is null
        or translate(lower(regexp_replace(v_qual, '\((\d+)\)::numeric', '\1', 'g')), E' \t\n\r', '')
        is distinct from translate(lower(r.expression), E' \t\n\r', '') then
      raise exception 'report policy expression mismatch: %.%: %', r.table_name, r.policy_name, v_qual;
    end if;
  end loop;
end $$;

commit;

-- Sim acceptance: concurrent claim vs assign (assigned must remain locked);
-- concurrent task create (one active row), retract then stale submit (denied),
-- cross-shop actor/target/station (denied), peer assignment (allowed), upward/self
-- task assignment (denied). Check RLS/grants including report_assignments columns.
-- Snapshot schema/pg_enum and constraint definitions before apply; no live-schema
-- query or simulation was available while authoring this file.
