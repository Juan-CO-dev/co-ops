-- Migration 0353_station_day_flags
-- AUTHORED 2026-11-21. NOT YET APPLIED - sim first, prod on Juan's word.
-- Provenance: nav PR 6 "Day engine, facts" (CHIEF nav-PR6-PLAN-r3.md section 4; nav-PR6-LEAD-RULINGS-r1.md
--   rulings 1a-1c, 6 and B1, B3; nav-SPEC-r5.md 3.3.8).
-- WHAT:
--   1. stations.starts_mid_day (boolean, default false): "closing this station starts mid-day prep". At most ONE
--      marked station per shop, active or not (unique partial index stations_one_mid_day_trigger). Unmarked, the day
--      engine falls back to its default trigger (the earliest usual close time, then the first close by event).
--   2. stations.not_phase_station (boolean, default false): "not a phase station": its close does not move the day
--      (for example a closing manager's checklist section). The Dashboard's loader sends floor = isFloorStation(...)
--      AND NOT not_phase_station.
--   3. Backfill of not_phase_station (ruling 1b, a DATA rule, never a name): true for every station whose section in
--      its shop's EFFECTIVE closing template holds AT LEAST ONE active report-reference item. The effective template is
--      picked as the closing-station sync picks it (lib/closing-stations.ts): type 'closing', active, effective_from
--      null or <= the ET date at apply, newest effective_from (nulls last), then newest created_at. A shop with no
--      active closing template is left unmarked. The loader applies the SAME rule in code until this file is applied
--      (lib/day-plan-load-shared.ts notPhaseSections; a twin test pins the two equal), so applying it moves nothing.
--      The backfill runs once; later template edits never re-run it (a GM decides on Station setup from then on).
--   4. set_station_mid_day_trigger(actor, location, station, on) and set_station_not_phase(actor, location, station,
--      on): SECURITY DEFINER writers, service_role only. Both lock the shop's locations row FIRST (two GMs choosing at
--      once are serialized there), check the actor (station_setup_actor_ok: active, level 7+, and below 8 an active
--      membership of the shop; mirrors saveStationTiming), and require the station to exist at the shop and be ACTIVE
--      (station_unavailable). The floor-station check (isFloorStation) is the app's, before the call (ruling B3); no
--      SQL spelling of it exists (ruling 6).
--      * mid-day: on = clear the shop's other marked station, THEN mark this one (a non-deferrable unique index is
--        checked row by row, so one UPDATE that turns A off and B on can fail on row order; PostgREST cannot run two
--        statements in one transaction). A station marked not_phase_station is refused (station_not_phase). off =
--        clear this station only. Returns {changed, previous_station_id}. A unique_violation (reachable only by a
--        writer that skipped the lock) is re-raised as mid_day_trigger_conflict.
--      * not-phase: sets the flag; setting it on the marked trigger also clears starts_mid_day in the same statement
--        (one station cannot be both). Returns {changed, cleared_mid_day}.
--   5. station_setup_actor_ok(actor, location): the shared who-check, executable by NOBODY (only the two definer
--      functions, which run as its owner, call it).
--   Both flags survive the closing-station sync: its update payload never names them (pinned in
--   tests/closing-stations.test.ts). A deactivated marked station keeps its flag; the loader sends active rows only.
-- DATA: two new columns (metadata-only on this ~20-row table); the backfill marks the stations named by the
--   pre-check below. One audit_log row (action station.not_phase_station, actor_context migration_apply) lists them.
-- LOCK ORDER: locations row (FOR UPDATE) -> stations rows. Nothing else takes a locations row lock before a stations
--   write; the closing-station sync and the station config writers take no locations lock, so no cycle.
-- ROLLOUT: the app works before and after apply. Before: the flag read sees the missing columns as "not installed"
--   and the loader applies the backfill's rule in code; Station setup shows no toggle and the route answers 503
--   station_flags_unavailable. After: the columns decide. Read-only pre-check (run before apply; expected live, per
--   CHIEF 2026-11-21-sch-prebuild-checks.md: exactly two rows, Closing Manager at Capitol Hill and at P Street):
--     with eff as (
--       select distinct on (t.location_id) t.location_id, t.id from public.checklist_templates t
--        where t.type = 'closing' and t.active
--          and (t.effective_from is null or t.effective_from <= (now() at time zone 'America/New_York')::date)
--        order by t.location_id, t.effective_from desc nulls last, t.created_at desc)
--     select s.location_id, s.name from public.stations s join eff on eff.location_id = s.location_id
--      where exists (select 1 from public.checklist_template_items ti where ti.template_id = eff.id and ti.active
--                     and btrim(ti.station) = s.name and ti.report_reference_type is not null)
--      order by 1, 2;
-- VERIFY AFTER APPLY:
--   select l.code, s.name from public.stations s join public.locations l on l.id = s.location_id
--    where s.not_phase_station order by 1, 2;                               -- the same two rows as the pre-check
--   select count(*) from public.stations where starts_mid_day;             -- 0
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('set_station_mid_day_trigger', 'set_station_not_phase', 'station_setup_actor_ok'); -- service_role (+ postgres) on the two writers only
--   Run scripts/sql-harness-0353.mjs (offline) and scripts/sim/stations-0353-two-sessions.mjs (sim only, CC).
-- ROLLBACK: forward-only. Drop the functions and columns in a NEW migration; never rewrite history.
begin;

do $$
declare v_col text;
begin
  if to_regclass('public.stations') is null then
    raise exception '0353: expected public.stations';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stations' and column_name = 'starts_mid_day') then
    raise exception '0353: stations.starts_mid_day already exists';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stations' and column_name = 'not_phase_station') then
    raise exception '0353: stations.not_phase_station already exists';
  end if;
  if to_regprocedure('public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean)') is not null
     or to_regprocedure('public.set_station_not_phase(uuid,uuid,uuid,boolean)') is not null
     or to_regprocedure('public.station_setup_actor_ok(uuid,uuid)') is not null then
    raise exception '0353: a station flag function already exists';
  end if;
  foreach v_col in array array['stations.location_id', 'stations.name', 'stations.active', 'locations.active',
    'checklist_templates.location_id', 'checklist_templates.type', 'checklist_templates.active',
    'checklist_templates.effective_from', 'checklist_templates.created_at', 'checklist_template_items.template_id',
    'checklist_template_items.station', 'checklist_template_items.active', 'checklist_template_items.report_reference_type',
    'users.role', 'users.active', 'user_locations.user_id', 'user_locations.location_id', 'user_locations.active'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public'
        and table_name = split_part(v_col, '.', 1) and column_name = split_part(v_col, '.', 2)) then
      raise exception '0353: missing expected column %', v_col;
    end if;
  end loop;
end $$;

-- ==========================================================================================
-- 1-2. The two columns and the one-marked-station-per-shop index
-- ==========================================================================================
alter table public.stations
  add column starts_mid_day boolean not null default false,
  add column not_phase_station boolean not null default false;

create unique index stations_one_mid_day_trigger on public.stations (location_id) where starts_mid_day;

-- ==========================================================================================
-- 5. The shared who-check (mirrors saveStationTiming: active, level 7+, below 8 a membership)
-- ==========================================================================================
create function public.station_setup_actor_ok(p_actor_id uuid, p_location_id uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_role text; v_level integer;
begin
  select role into v_role from public.users where id = p_actor_id and active;
  v_level := case v_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8
    when 'gm' then 7 when 'agm' then 6 when 'catering_mgr' then 6 when 'prep_mgr' then 6
    when 'social_media_mgr' then 6 when 'shift_lead' then 5 when 'key_holder' then 4
    when 'trainer' then 4 when 'employee' then 3 when 'trainee' then 2
    when 'hired_not_yet_worked' then 1 when 'prospect' then 0 else null end;
  if v_level is null or v_level < 7 then return false; end if;
  if v_level < 8 then
    perform 1 from public.user_locations where user_id = p_actor_id and location_id = p_location_id and active;
    if not found then return false; end if;
  end if;
  return true;
end $$;

-- ==========================================================================================
-- 4a. "Closing this station starts mid-day prep"
-- ==========================================================================================
create function public.set_station_mid_day_trigger(p_actor_id uuid, p_location_id uuid, p_station_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_active boolean; v_not_phase boolean; v_prev uuid; v_changed boolean := false;
begin
  if p_actor_id is null or p_location_id is null or p_station_id is null or p_on is null then
    raise exception 'invalid_payload';
  end if;
  -- Lock first: two people choosing at once are serialized on the shop's row.
  perform 1 from public.locations where id = p_location_id and active for update;
  if not found then raise exception 'location_not_found'; end if;
  if not public.station_setup_actor_ok(p_actor_id, p_location_id) then raise exception 'role_insufficient'; end if;
  select active, not_phase_station into v_active, v_not_phase
    from public.stations where id = p_station_id and location_id = p_location_id for update;
  if not found or not v_active then raise exception 'station_unavailable'; end if;
  if p_on then
    if v_not_phase then raise exception 'station_not_phase'; end if;
    select id into v_prev from public.stations where location_id = p_location_id and starts_mid_day and id <> p_station_id;
    -- Clear, THEN set (the index is checked row by row).
    update public.stations set starts_mid_day = false where location_id = p_location_id and starts_mid_day and id <> p_station_id;
    update public.stations set starts_mid_day = true where id = p_station_id and location_id = p_location_id and not starts_mid_day;
    v_changed := found or v_prev is not null;
  else
    update public.stations set starts_mid_day = false where id = p_station_id and location_id = p_location_id and starts_mid_day;
    v_changed := found;
  end if;
  return jsonb_build_object('changed', v_changed, 'previous_station_id', v_prev);
exception when unique_violation then
  raise exception 'mid_day_trigger_conflict';
end $$;

-- ==========================================================================================
-- 4b. "Not a phase station"
-- ==========================================================================================
create function public.set_station_not_phase(p_actor_id uuid, p_location_id uuid, p_station_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_active boolean; v_not_phase boolean; v_mid_day boolean; v_cleared boolean := false; v_changed boolean := false;
begin
  if p_actor_id is null or p_location_id is null or p_station_id is null or p_on is null then
    raise exception 'invalid_payload';
  end if;
  perform 1 from public.locations where id = p_location_id and active for update;
  if not found then raise exception 'location_not_found'; end if;
  if not public.station_setup_actor_ok(p_actor_id, p_location_id) then raise exception 'role_insufficient'; end if;
  select active, not_phase_station, starts_mid_day into v_active, v_not_phase, v_mid_day
    from public.stations where id = p_station_id and location_id = p_location_id for update;
  if not found or not v_active then raise exception 'station_unavailable'; end if;
  v_cleared := p_on and v_mid_day;
  -- One statement: a station marked "not a phase station" can never stay the mid-day trigger.
  update public.stations
     set not_phase_station = p_on, starts_mid_day = case when p_on then false else starts_mid_day end
   where id = p_station_id and location_id = p_location_id
     and (not_phase_station is distinct from p_on or (p_on and starts_mid_day));
  v_changed := found;
  return jsonb_build_object('changed', v_changed, 'cleared_mid_day', v_cleared);
end $$;

-- ==========================================================================================
-- Grants: the two writers for service_role only; the helper for nobody
-- ==========================================================================================
revoke all on function public.station_setup_actor_ok(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.set_station_not_phase(uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.set_station_not_phase(uuid,uuid,uuid,boolean) to service_role;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean)'::regprocedure,
    'public.set_station_not_phase(uuid,uuid,uuid,boolean)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0353: RPC execution grant escaped for %', f;
    end if;
  end loop;
  f := 'public.station_setup_actor_ok(uuid,uuid)'::regprocedure;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
    or has_function_privilege('service_role', f, 'EXECUTE')
    or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0353: helper execution grant escaped for %', f;
  end if;
  if exists (select 1 from pg_proc where oid in ('public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean)'::regprocedure,
      'public.set_station_not_phase(uuid,uuid,uuid,boolean)'::regprocedure, 'public.station_setup_actor_ok(uuid,uuid)'::regprocedure)
      and (not prosecdef or not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
    raise exception '0353: RPC execution context escaped';
  end if;
end $$;

-- ==========================================================================================
-- 3. The backfill (ruling 1b) and the migration's one audit row
-- ==========================================================================================
do $$
declare v_marked uuid[];
begin
  with eff as (
    select distinct on (t.location_id) t.location_id, t.id
      from public.checklist_templates t
     where t.type = 'closing' and t.active
       and (t.effective_from is null or t.effective_from <= (now() at time zone 'America/New_York')::date)
     order by t.location_id, t.effective_from desc nulls last, t.created_at desc
  ), marked as (
    update public.stations s set not_phase_station = true
      from eff
     where s.location_id = eff.location_id
       and exists (select 1 from public.checklist_template_items ti
                    where ti.template_id = eff.id
                      and ti.active and btrim(ti.station) = s.name
                      and ti.report_reference_type is not null)
    returning s.id
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_marked from marked;

  INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
  VALUES (NULL, NULL, 'station.not_phase_station', 'stations', NULL, true,
    jsonb_build_object('actor_context', 'migration_apply', 'migration', '0353_station_day_flags',
      'change', 'stations.starts_mid_day and stations.not_phase_station added; not_phase_station backfilled for every station whose effective closing section holds at least one active report-reference item',
      'backfill_station_ids', to_jsonb(v_marked)));
end $$;
commit;
