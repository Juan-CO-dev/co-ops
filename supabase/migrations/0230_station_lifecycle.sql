-- AUTHORED ONLY 2026-10-08. NOT APPLIED. CC sim + review, then Juan's apply gate.
-- APPLIED TO PROD 2026-10-08 (schema_migrations version 20261008193621, name '0230_station_lifecycle'; sim first, version 20261008192908; harness PASS; prod rolled-back dry run PASS). CC review: checklist trigger made fail-open.
-- 0229 belongs to ezCater. No seed values, no restoration of released work.
-- Closing state is derived from the latest non-dropped closing instance for the
-- station business day. Its active section items must ALL have live completions.
-- Completion triggers share the station/day lock with claims and break writes.
begin;

-- Ground-truth preflight at application time; old base migrations are absent
-- from this clone. A mismatched schema must refuse, not partially install.
do $$ declare entry text; tab text; col text; begin
  foreach entry in array array[
    'checklist_instances.id','checklist_instances.location_id','checklist_instances.date',
    'checklist_instances.template_id','checklist_instances.dropped_at','checklist_instances.shift_start_at','checklist_instances.triggered_at',
    'checklist_templates.id','checklist_templates.type',
    'checklist_template_items.id','checklist_template_items.template_id','checklist_template_items.station','checklist_template_items.active',
    'checklist_completions.id','checklist_completions.instance_id','checklist_completions.template_item_id',
    'checklist_completions.completed_at','checklist_completions.revoked_at','checklist_completions.superseded_at',
    'toast_time_entries.user_id','toast_time_entries.in_at','toast_time_entries.out_at','toast_time_entries.deleted',
    'toast_time_entries.location_id','toast_time_entries.business_date','toast_time_entries.time_entry_guid',
    'report_assignments.created_at','report_assignments.assignee_id','report_assignments.active',
    'audit_log.actor_id','audit_log.actor_role','audit_log.action','audit_log.resource_table',
    'audit_log.resource_id','audit_log.metadata','audit_log.destructive'
  ] loop
    tab:=split_part(entry,'.',1); col:=split_part(entry,'.',2);
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=tab and column_name=col) then
      raise exception '0230: missing expected column %',entry;
    end if;
  end loop;
end $$;

alter table public.stations add column usually_closes_at time;
alter table public.station_positions add column usually_trims_at time,
  add constraint station_position_trim_after_first check (usually_trims_at is null or sort>1);
alter table public.station_events alter column actor_id drop not null;
alter table public.station_events drop constraint station_events_reason_code_check;
alter table public.station_events add constraint station_events_reason_code_check check
  (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','station_closed','clocked_out','on_break'));
alter table public.station_events add column prior_position_id uuid references public.station_positions(id),
  add column effective_at timestamptz,
  add constraint station_events_system_actor check (actor_id is not null or
    coalesce((kind='release' and reason_code in ('station_closed','clocked_out') and effective_at is not null),false)),
  add constraint station_events_system_reason check (reason_code not in ('station_closed','clocked_out','on_break') or
    (kind='release' and station_id is null and position_id is null and source is null and overridden_assigner_id is null));
alter table public.assignment_changes alter column actor_id drop not null;
alter table public.assignment_changes drop constraint assignment_changes_kind_check;
alter table public.assignment_changes drop constraint assignment_changes_reason_code_check;
alter table public.assignment_changes add constraint assignment_changes_kind_check check (kind in ('assign','retract','auto_release')),
  add constraint assignment_changes_reason_code_check check
    (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','clocked_out')),
  add column subject_user_id uuid references public.users(id),
  add column effective_at timestamptz,
  add constraint assignment_changes_system_actor check
    ((kind='auto_release' and actor_id is null and reason_code is not distinct from 'clocked_out' and subject_user_id is not null and effective_at is not null and overridden_assigner_id is null)
      or (kind<>'auto_release' and actor_id is not null and reason_code is distinct from 'clocked_out'));

create table public.station_break_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  location_id uuid not null references public.locations(id), business_date date not null,
  user_id uuid not null references public.users(id), actor_id uuid references public.users(id),
  on_break boolean not null, at timestamptz not null default clock_timestamp(),
  reason_code text,
  check ((actor_id is not null and reason_code is null) or
    (actor_id is null and not on_break and reason_code is not distinct from 'clocked_out'))
);
create index station_break_events_head on public.station_break_events(location_id,business_date,user_id,sequence desc);
-- Records departures even when no explicit assignment existed. This prevents
-- historical 'taken' report attribution from restoring work on re-clock-in.
create table public.station_departures (
  location_id uuid not null references public.locations(id), business_date date not null,
  user_id uuid not null references public.users(id), out_at timestamptz not null,
  primary key(location_id,business_date,user_id,out_at)
);
alter table public.station_break_events enable row level security;
alter table public.station_departures enable row level security;
create policy station_break_events_no_user_select on public.station_break_events for select using(false);
create policy station_break_events_no_user_insert on public.station_break_events for insert with check(false);
create policy station_break_events_no_user_update on public.station_break_events for update using(false) with check(false);
create policy station_break_events_no_user_delete on public.station_break_events for delete using(false);
create policy station_departures_no_user_select on public.station_departures for select using(false);
create policy station_departures_no_user_insert on public.station_departures for insert with check(false);
create policy station_departures_no_user_update on public.station_departures for update using(false) with check(false);
create policy station_departures_no_user_delete on public.station_departures for delete using(false);
revoke all on public.station_break_events,public.station_departures from public,anon,authenticated,service_role;
grant select on public.station_break_events,public.station_departures to service_role;
revoke all on sequence public.station_break_events_sequence_seq from public,anon,authenticated,service_role;

create function public.station_closures(p_location_id uuid,p_day date)
returns table(station_id uuid,closed_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,public as $$
  with instance as (
    select i.id,i.template_id from public.checklist_instances i
    join public.checklist_templates t on t.id=i.template_id
    where i.location_id=p_location_id and i.date=p_day and t.type='closing' and i.dropped_at is null
    order by i.shift_start_at desc nulls last,i.triggered_at desc nulls last,i.id desc limit 1
  )
  select s.id,max(c.completed_at)
  from instance i join public.checklist_template_items ti on ti.template_id=i.template_id and ti.active
  join public.stations s on s.location_id=p_location_id and s.name=btrim(ti.station) and s.active
  left join public.checklist_completions c on c.instance_id=i.id and c.template_item_id=ti.id
    and c.revoked_at is null and c.superseded_at is null
  group by s.id having count(*)>0 and bool_and(c.id is not null)
$$;

-- Latest Toast shift wins; any still-open shift conservatively prevents release.
-- Never infer identity from names, never use a deleted/future time entry.
create function public.station_clocked_out(p_location_id uuid,p_day date)
returns table(user_id uuid,out_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,public as $$
  with latest as (
    select distinct on (e.user_id) e.user_id,e.out_at
    from public.toast_time_entries e where e.location_id=p_location_id and e.business_date=p_day
      and not e.deleted and e.user_id is not null and e.in_at<=clock_timestamp()
    order by e.user_id,e.in_at desc,e.out_at desc nulls first,e.time_entry_guid
  ) select l.user_id,l.out_at from latest l where l.out_at<=clock_timestamp()
    and not exists(select 1 from public.toast_time_entries e where e.location_id=p_location_id
      and e.business_date=p_day and e.user_id=l.user_id and not e.deleted and e.in_at<=clock_timestamp() and e.out_at is null)
$$;

-- SQL observations use the same fail-open audit doctrine as lib/audit.ts.
create function public.station_lifecycle_audit(p_action text,p_table text,p_id uuid,p_metadata jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_action not in ('station.system_release','assignment.system_release') then raise exception 'invalid_payload'; end if;
  begin
    insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
      values(null,null,p_action,p_table,p_id,p_metadata,false);
  exception when others then raise warning 'station lifecycle audit failed'; end;
end $$;

create function public.release_closed_stations(p_location_id uuid,p_day date)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||p_day::text,0));
  for r in select h.*,c.closed_at from (
    select distinct on (user_id) * from public.station_events
    where location_id=p_location_id and business_date=p_day order by user_id,sequence desc
  ) h join public.station_closures(p_location_id,p_day) c on c.station_id=h.station_id loop
    insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
      values(p_location_id,p_day,r.user_id,'release',null,'station_closed',r.position_id,r.closed_at) returning id into v_id;
    perform public.station_lifecycle_audit('station.system_release','station_events',v_id,
      jsonb_build_object('reason','station_closed','location_id',p_location_id,'business_date',p_day,'user_id',r.user_id,'position_id',r.position_id));
  end loop;
end $$;

create function public.reconcile_station_lifecycle(p_location_id uuid,p_day date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; h record; a record; v_id uuid; v_station_day date;
begin
  if p_day is null or p_day<>(clock_timestamp() at time zone 'America/New_York')::date then raise exception 'invalid_payload'; end if;
  v_station_day:=public.station_business_date(p_location_id);
  -- Chronological lock order when a closing spans midnight.
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_station_day::text,0));
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||p_day::text,0));
  perform public.release_closed_stations(p_location_id,v_station_day);
  for r in select * from public.station_clocked_out(p_location_id,p_day) loop
    insert into public.station_departures(location_id,business_date,user_id,out_at)
      values(p_location_id,p_day,r.user_id,r.out_at) on conflict do nothing;
    -- Do not retrospectively erase a human change made after the departure.
    select * into h from public.station_events where location_id=p_location_id
      and business_date=v_station_day and user_id=r.user_id order by sequence desc limit 1;
    if (h.station_id is not null or (h.reason_code='on_break' and h.prior_position_id is not null)) and h.at<=r.out_at then
      insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
        values(p_location_id,v_station_day,r.user_id,'release',null,'clocked_out',coalesce(h.position_id,h.prior_position_id),r.out_at) returning id into v_id;
      perform public.station_lifecycle_audit('station.system_release','station_events',v_id,
        jsonb_build_object('reason','clocked_out','location_id',p_location_id,'user_id',r.user_id,'position_id',h.position_id,'out_at',r.out_at));
    end if;
    -- Leaving ends a break, too. A later re-clock-in starts free, not on break.
    if coalesce((select b.on_break and b.at<=r.out_at from public.station_break_events b
      where b.location_id=p_location_id and b.business_date=v_station_day and b.user_id=r.user_id order by b.sequence desc limit 1),false) then
      insert into public.station_break_events(location_id,business_date,user_id,actor_id,on_break,reason_code)
        values(p_location_id,v_station_day,r.user_id,null,false,'clocked_out');
    end if;
    -- An active daily assignment is the existing model's open work contract.
    -- Report history is never mutated; only this delegation is retired.
    for a in update public.report_assignments set active=false where location_id=p_location_id
      and operational_date=p_day and assignee_id=r.user_id and active and created_at<=r.out_at returning * loop
      insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,subject_user_id,effective_at)
        values(a.id,p_location_id,p_day,a.report_type,null,'auto_release','clocked_out',r.user_id,r.out_at) returning id into v_id;
      perform public.station_lifecycle_audit('assignment.system_release','assignment_changes',v_id,
        jsonb_build_object('reason','clocked_out','assignment_id',a.id,'location_id',p_location_id,'user_id',r.user_id,'out_at',r.out_at));
    end loop;
  end loop;
  return jsonb_build_object('ok',true);
end $$;

create function public.write_station_break(p_actor_id uuid,p_user_id uuid,p_location_id uuid,p_on_break boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_day date:=public.station_business_date(p_location_id); v_actor integer; v_target integer;
  v_previous public.station_break_events%rowtype; h public.station_events%rowtype; v_id uuid;
begin
  if p_on_break is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
  v_actor:=public.assignment_user_level(p_actor_id,p_location_id);
  v_target:=public.assignment_user_level(p_user_id,p_location_id);
  if p_actor_id<>p_user_id and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'; end if;
  select * into v_previous from public.station_break_events where location_id=p_location_id
    and business_date=v_day and user_id=p_user_id order by sequence desc limit 1;
  if coalesce(v_previous.on_break,false)=p_on_break then
    return jsonb_build_object('id',v_previous.id,'changed',false);
  end if;
  insert into public.station_break_events(location_id,business_date,user_id,actor_id,on_break)
    values(p_location_id,v_day,p_user_id,p_actor_id,p_on_break) returning id into v_id;
  if p_on_break then
    select * into h from public.station_events where location_id=p_location_id and business_date=v_day and user_id=p_user_id order by sequence desc limit 1;
    if h.station_id is not null then
      insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
        values(p_location_id,v_day,p_user_id,'release',p_actor_id,'on_break',h.position_id,clock_timestamp());
    end if;
  end if;
  return jsonb_build_object('id',v_id,'changed',true);
end $$;

-- A BEFORE trigger takes the lock before the completion becomes visible; the
-- AFTER trigger observes the full new state, including revocation/supersession.
-- Reopening needs no write: station_closures immediately ceases to return it.
create function public.checklist_station_lifecycle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location uuid; v_day date;
begin
  select i.location_id,i.date into v_location,v_day from public.checklist_instances i
    join public.checklist_templates t on t.id=i.template_id where i.id=new.instance_id and t.type='closing';
  if v_location is not null and v_day=public.station_business_date(v_location) then
    perform pg_advisory_xact_lock(hashtextextended('station/day/'||v_location::text||'/'||v_day::text,0));
    -- Fail-open (CC review): a station release must never block a closing-checklist
    -- check-off; reconcile_station_lifecycle (10-minute tick) re-runs the same release.
    if tg_when='AFTER' then
      begin
        perform public.release_closed_stations(v_location,v_day);
      exception when others then
        raise warning 'station lifecycle release deferred: %', sqlerrm;
      end;
    end if;
  end if;
  return new;
end $$;
create trigger checklist_station_lifecycle_lock before insert or update of revoked_at,superseded_at on public.checklist_completions
  for each row execute function public.checklist_station_lifecycle();
create trigger checklist_station_lifecycle_release after insert or update of revoked_at,superseded_at on public.checklist_completions
  for each row execute function public.checklist_station_lifecycle();

-- Existing write RPC bodies follow, with only lifecycle guards added; arguments
-- and defaults remain exactly those of 0228.

create or replace function public.write_task_assignment(p_actor_id uuid,p_location_id uuid,p_user_id uuid,p_task text,p_note text,p_assignment_id uuid,p_reason_code text default null,p_reason_note text default null)
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
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
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
  if exists(select 1 from public.station_clocked_out(p_location_id,v_day) where user_id=v_user) then raise exception 'clocked_out'; end if;
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


create or replace function public.write_station_event(
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
    if exists(select 1 from public.station_closures(p_location_id,v_day) where station_id=p_station_id) then raise exception 'station_closed'; end if;
    if coalesce((select on_break from public.station_break_events where location_id=p_location_id and business_date=v_day and user_id=p_user_id order by sequence desc limit 1),false) then raise exception 'on_break'; end if;
    if exists(select 1 from public.station_clocked_out(p_location_id,(clock_timestamp() at time zone 'America/New_York')::date) where user_id=p_user_id) then raise exception 'clocked_out'; end if;
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


-- Definer helpers are private even on Supabase's default ACLs.
do $$ declare f regprocedure; r text; tab text; begin
  foreach f in array array[
    'public.station_closures(uuid,date)'::regprocedure,
    'public.station_clocked_out(uuid,date)'::regprocedure,
    'public.station_lifecycle_audit(text,text,uuid,jsonb)'::regprocedure,
    'public.release_closed_stations(uuid,date)'::regprocedure,
    'public.reconcile_station_lifecycle(uuid,date)'::regprocedure,
    'public.write_station_break(uuid,uuid,uuid,boolean)'::regprocedure,
    'public.checklist_station_lifecycle()'::regprocedure,
    'public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean,text,text)'::regprocedure,
    'public.write_task_assignment(uuid,uuid,uuid,text,text,uuid,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not has_function_privilege('service_role',f,'EXECUTE') then raise exception '0230: RPC grant escaped'; end if;
  end loop;
  foreach tab in array array['station_break_events','station_departures'] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r,'public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r,'public.'||tab,'INSERT,UPDATE,REFERENCES')
        or (r<>'service_role' and has_any_column_privilege(r,'public.'||tab,'SELECT')) then
        raise exception '0230: lifecycle ledger grant escaped';
      end if;
    end loop;
  end loop;
end $$;
commit;
