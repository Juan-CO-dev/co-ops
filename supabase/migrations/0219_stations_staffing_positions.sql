-- AUTHORED ONLY 2026-10-07. NOT APPLIED. CC sim first, then Juan's production gate.
-- APPLIED TO PROD 2026-10-07 (schema_migrations version 20261007225800, name '0219_stations_staffing_positions'; sim first, version 20261007224611; seed 42 stations + sauces run after it on both). The line above is the authoring-time gate note, kept as history.
-- Closing sections own stations.active; managers own staffed and positions.
begin;
alter table public.stations alter column name_es drop not null;
create unique index stations_location_name on public.stations(location_id, name);
alter table public.stations add column staffed boolean not null default true;

create table public.station_positions (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null,
  location_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  name_es text check (name_es is null or length(btrim(name_es)) between 1 and 100),
  duty text check (duty is null or length(btrim(duty)) <= 500),
  duty_es text check (duty_es is null or length(btrim(duty_es)) <= 500),
  sort smallint not null default 1 check (sort between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (station_id, location_id) references public.stations(id, location_id),
  unique(station_id, name), unique(id, station_id, location_id)
);
create index station_positions_order on public.station_positions(station_id, active, sort, id);
alter table public.station_positions enable row level security;
revoke all on public.station_positions from public, anon, authenticated;
grant select, insert, update on public.station_positions to service_role;
revoke delete, truncate on public.station_positions from service_role;

alter table public.station_events add column position_id uuid;
alter table public.station_events add constraint station_events_position_station_fk
  foreign key (position_id, station_id, location_id)
  references public.station_positions(id, station_id, location_id);
alter table public.station_events add constraint station_events_position_required
  check (station_id is null or position_id is not null) not valid;
-- Existing 0217 rows may have no position. New writes always supply one.

-- Replaces the 0217 signature so callers cannot bypass position capacity.
drop function public.write_station_event(uuid,uuid,uuid,uuid,boolean);
create function public.write_station_event(
  p_actor_id uuid, p_user_id uuid, p_location_id uuid,
  p_station_id uuid, p_position_id uuid, p_manage boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_day date := public.station_business_date(p_location_id);
  v_actor integer; v_target integer; v_previous public.station_events%rowtype;
  v_id uuid; v_kind text; v_source text;
begin
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
  insert into public.station_events(location_id,business_date,user_id,station_id,position_id,kind,actor_id,source,at)
    values(p_location_id,v_day,p_user_id,p_station_id,p_position_id,v_kind,p_actor_id,v_source,clock_timestamp())
    returning id into v_id;
  return jsonb_build_object('id',v_id,'changed',true);
end $$;
revoke all on function public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean) to service_role;
do $$ begin
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public'
    and routine_name='write_station_event' and privilege_type='EXECUTE'
    and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception 'station RPC execution grant escaped';
  end if;
  if exists(select 1 from information_schema.role_table_grants where table_schema='public'
    and table_name='station_positions' and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception 'station positions grant escaped';
  end if;
end $$;
commit;
