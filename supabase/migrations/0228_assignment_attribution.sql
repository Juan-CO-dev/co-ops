-- APPLIED TO PROD 2026-10-08 (schema_migrations version 20261008181702, name '0228_assignment_attribution'; sim first, version 20261008181433;
-- sim harness scripts/test-assignment-attribution.sql PASS, rolled back). 0228: attribution + higher-assigner override evidence. No permission expansion.
-- Task evidence is an append-only ledger: a retract must not overwrite the
-- original assignment's author/note, and must remain visible after active=false.
begin;
create table public.assignment_changes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.report_assignments(id),
  location_id uuid not null references public.locations(id),
  operational_date date not null,
  report_type public.report_type_enum not null,
  actor_id uuid not null references public.users(id),
  kind text not null check (kind in ('assign','retract')),
  reason_code text check (reason_code in ('coverage_change','unavailable','skill_fit','correction','other')),
  reason_note text check (length(reason_note)<=500),
  overridden_assigner_id uuid references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check (reason_code is distinct from 'other' or coalesce(reason_note ~ '[^[:space:]]',false)),
  check (overridden_assigner_id is null or reason_code is not null)
);
create index assignment_changes_board on public.assignment_changes(location_id,operational_date,created_at desc,id);
alter table public.assignment_changes enable row level security;
-- Explicit deny-all (house pattern, 0146): the definer RPC is the sole writer.
create policy assignment_changes_no_user_select on public.assignment_changes for select using (false);
create policy assignment_changes_no_user_insert on public.assignment_changes for insert with check (false);
create policy assignment_changes_no_user_update on public.assignment_changes for update using (false) with check (false);
create policy assignment_changes_no_user_delete on public.assignment_changes for delete using (false);
revoke all on public.assignment_changes from public,anon,authenticated,service_role;
grant select on public.assignment_changes to service_role;
alter table public.station_events
  add column reason_code text check (reason_code in ('coverage_change','unavailable','skill_fit','correction','other')),
  add column reason_note text check (length(reason_note)<=500),
  add column overridden_assigner_id uuid references public.users(id),
  add constraint station_events_other_note check (reason_code is distinct from 'other' or coalesce(reason_note ~ '[^[:space:]]',false)),
  add constraint station_events_override_reason check (overridden_assigner_id is null or reason_code is not null);

-- Historical authors need not still be active or members of this shop. Current
-- role rank alone decides override evidence; normal actor/target gates stay live.
create function public.assignment_author_level(p_user_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text;
begin
  select role into v_role from public.users where id=p_user_id for share;
  return case v_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8
    when 'gm' then 7 when 'agm' then 6 when 'catering_mgr' then 6 when 'prep_mgr' then 6
    when 'social_media_mgr' then 6 when 'shift_lead' then 5 when 'key_holder' then 4
    when 'trainer' then 4 when 'employee' then 3 when 'trainee' then 2
    when 'hired_not_yet_worked' then 1 when 'prospect' then 0 else null end;
end $$;
-- Retire old signatures: no default-argument overload can bypass the reason gate.
drop function public.write_task_assignment(uuid,uuid,uuid,text,text,uuid);
drop function public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean);
create function public.write_task_assignment(p_actor_id uuid,p_location_id uuid,p_user_id uuid,p_task text,p_note text,p_assignment_id uuid,p_reason_code text default null,p_reason_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := (clock_timestamp() at time zone 'America/New_York')::date;
  v_actor integer; v_target integer; v_user uuid := p_user_id; v_task text := p_task;
  v_row public.report_assignments%rowtype; v_id uuid; v_overridden uuid;
begin
  if (p_reason_code is not null and p_reason_code not in ('coverage_change','unavailable','skill_fit','correction','other'))
    or length(coalesce(p_reason_note,''))>500
    or (p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)) then
    raise exception 'invalid_payload';
  end if;
  v_actor := public.assignment_user_level(p_actor_id,p_location_id);
  if v_actor<4 then raise exception 'role_insufficient'; end if;
  if p_assignment_id is not null then
    select * into v_row from public.report_assignments where id=p_assignment_id and location_id=p_location_id for update;
    if not found then raise exception 'assignment_not_found'; end if;
    -- Past operational days are immutable accountability history.
    if v_row.operational_date < public.station_business_date(p_location_id) then
      raise exception 'assignment_not_found';
    end if;
    if not v_row.active then return jsonb_build_object('id',p_assignment_id,'changed',false); end if;
    if public.assignment_author_level(v_row.assigner_id)>v_actor then
      v_overridden := v_row.assigner_id;
      if p_reason_code is null then raise exception 'override_reason_required'; end if;
    end if;
    -- Retraction is not assigning up: only actor authority and row shop matter.
    update public.report_assignments set active=false where id=p_assignment_id and active returning id into v_id;
    if v_id is not null then
      insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,reason_note,overridden_assigner_id)
      values(v_id,p_location_id,v_row.operational_date,v_row.report_type,p_actor_id,'retract',p_reason_code,nullif(btrim(p_reason_note),''),v_overridden);
    end if;
    return jsonb_build_object('id',p_assignment_id,'changed',v_id is not null,
      'overridden_assigner_id',v_overridden,'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
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
  insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,reason_note)
    values(v_id,p_location_id,v_day,v_task::public.report_type_enum,p_actor_id,'assign',p_reason_code,nullif(btrim(p_reason_note),''));
  return jsonb_build_object('id',v_id,'changed',true,'overridden_assigner_id',null,
    'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
end $$;

create function public.write_station_event(
  p_actor_id uuid, p_user_id uuid, p_location_id uuid,
  p_station_id uuid, p_position_id uuid, p_manage boolean default false, p_reason_code text default null, p_reason_note text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := public.station_business_date(p_location_id);
  v_actor integer; v_target integer; v_previous public.station_events%rowtype;
  v_id uuid; v_kind text; v_source text; v_overridden uuid;
begin
  if (p_reason_code is not null and p_reason_code not in ('coverage_change','unavailable','skill_fit','correction','other'))
    or length(coalesce(p_reason_note,''))>500
    or (p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)) then
    raise exception 'invalid_payload';
  end if;
  -- One shop/day lock serializes capacity checks across different people.
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
  v_actor := public.assignment_user_level(p_actor_id,p_location_id);
  v_target := public.assignment_user_level(p_user_id,p_location_id);
  if (p_manage or p_actor_id <> p_user_id) and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'; end if;
  select * into v_previous from public.station_events
    where location_id=p_location_id and business_date=v_day and user_id=p_user_id
    order by sequence desc limit 1;
  if p_actor_id=p_user_id and v_previous.station_id is not null and v_previous.source='assigned' then
    raise exception 'station_locked';
  end if;
  if (p_station_id is null) <> (p_position_id is null) then raise exception 'invalid_payload'; end if;
  if p_station_id is not null then
    perform 1 from public.stations s join public.station_positions p
      on p.station_id=s.id and p.location_id=s.location_id
      where s.id=p_station_id and s.location_id=p_location_id and s.active and s.staffed
        and p.id=p_position_id and p.active for share of s,p;
    if not found then raise exception 'station_unavailable'; end if;
  end if;
  v_source := case when p_station_id is null then null when p_actor_id=p_user_id then 'claimed' else 'assigned' end;
  if v_previous.id is not null and v_previous.station_id is not distinct from p_station_id
    and v_previous.position_id is not distinct from p_position_id
    and v_previous.source is not distinct from v_source then
    return jsonb_build_object('id',v_previous.id,'changed',false);
  end if;
  if v_previous.station_id is not null and v_previous.source='assigned'
    and public.assignment_author_level(v_previous.actor_id)>v_actor then
    v_overridden := v_previous.actor_id;
    if p_reason_code is null then raise exception 'override_reason_required'; end if;
  end if;
  if p_position_id is not null and exists (
    select 1 from public.station_events e
    where e.location_id=p_location_id and e.business_date=v_day and e.position_id=p_position_id
      and e.user_id<>p_user_id and e.id=(select h.id from public.station_events h
        where h.location_id=e.location_id and h.business_date=e.business_date
          and h.user_id=e.user_id order by h.sequence desc limit 1)
  ) then raise exception 'position_taken'; end if;
  v_kind := case when p_station_id is null then 'release'
    when v_previous.station_id is not null then 'move'
    when p_actor_id=p_user_id then 'claim' else 'assign' end;
  insert into public.station_events(location_id,business_date,user_id,station_id,position_id,kind,actor_id,source,at,reason_code,reason_note,overridden_assigner_id)
    values(p_location_id,v_day,p_user_id,p_station_id,p_position_id,v_kind,p_actor_id,v_source,clock_timestamp(),p_reason_code,nullif(btrim(p_reason_note),''),v_overridden)
    returning id into v_id;
  return jsonb_build_object('id',v_id,'changed',true,'overridden_assigner_id',v_overridden,
    'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
end $$;

revoke all on function public.assignment_author_level(uuid) from public,anon,authenticated;
grant execute on function public.assignment_author_level(uuid) to service_role;
revoke all on function public.write_task_assignment(uuid,uuid,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.write_task_assignment(uuid,uuid,uuid,text,text,uuid,text,text) to service_role;
revoke all on function public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean,text,text) to service_role;
do $$ declare f regprocedure; r text; begin
  foreach f in array array['public.assignment_author_level(uuid)'::regprocedure,
    'public.write_task_assignment(uuid,uuid,uuid,text,text,uuid,text,text)'::regprocedure,
    'public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean,text,text)'::regprocedure] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not has_function_privilege('service_role',f,'EXECUTE') then raise exception '0228: RPC grant escaped'; end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(r,'public.assignment_changes','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r,'public.assignment_changes','INSERT,UPDATE,REFERENCES')
      or (r<>'service_role' and has_any_column_privilege(r,'public.assignment_changes','SELECT')) then
      raise exception '0228: assignment evidence grant escaped';
    end if;
  end loop;
end $$;
commit;
