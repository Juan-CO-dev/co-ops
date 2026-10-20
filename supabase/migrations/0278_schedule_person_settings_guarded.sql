-- Migration 0278_schedule_person_settings_guarded
-- AUTHORED 2026-10-20. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0274).
-- APPLIED TO SIM 2026-10-20 (by CC; sim schema_migrations version not recorded in this repo)
-- APPLIED TO PROD 2026-10-20 (schema_migrations version 20261020210710, name '0278_schedule_person_settings_guarded')
-- Provenance: primary / secondary position per person (feat/sched-primary-secondary, PR #497), Astra round-2 review
--   BC-007 (SHOULD-FIX, Juan approved the DB change 2026-10-20) and Juan's "GMs own their shop" ruling (2026-10-20).
--
-- WHY: the lib checked the expected head and merged the changed fields OUTSIDE the writer's per-person lock, so two
--   requests that read the same head could both pass and the later full-row insert erased the earlier change. And the
--   subject rule (a GM never sets their own or a GM-or-above's settings) lived only in the lib.
--
-- WHAT (no table change; every function SECURITY DEFINER, search_path pinned, EXECUTE for service_role only):
--   1. schedule_person_subject_check(actor, actor_level, user): the SQL twin of lib/scheduling/access-shared.ts
--      `personSettingsSubjectRefusal` — below MoO (actor level < 8) never oneself, never a subject at or above GM (7),
--      never a subject at or above the actor's own level → 'schedule_forbidden'. MoO+ unchanged.
--   2. record_schedule_person_settings (0274) RE-EMITTED with exactly one change: after the actor rule and the subject
--      lookup, the subject check (1). Same signature, same body otherwise, same grants.
--   3. save_schedule_person_settings(…, p_expected): the FULL-ROW write (the staff settings card). Under the SAME
--      per-person advisory lock 0274's writer takes, BEFORE its read: the latest row's id must equal p_expected (NULL =
--      the person has no row yet), else 'person_settings_moved'. Then it calls (2) inside that lock.
--   4. merge_schedule_person_positions(p_actor, p_location, p_user, p_expected, p_changes jsonb): the user screen's pickers.
--      Under the same lock: the latest row's id must equal p_expected (the row the pickers were loaded from; NULL = none),
--      else 'person_settings_moved' (Astra BC-007/042 — two valid changes merged blind can make an invalid row: an FOH
--      person given Register by A while B makes them BOH). On that unmoved head it replaces ONLY the changed fields —
--      `workType`, and the list
--      re-derived from the latest list when `primary` / `secondary` changed (the twin of lib/scheduling/
--      user-positions-shared.ts `mergePositionChanges` + position-rank-shared `withPrimarySecondary`: no primary → the
--      list is cleared; no secondary → [primary]; else [primary, secondary, …the latest tail minus both]). Every other
--      field (also_allowed, leader_setting, the soft range, full_time and its minimum, roster_include) is the latest
--      row's. A malformed p_changes is 'invalid_payload'. Then it calls (2) inside that lock.
--   The lock is pg_advisory_xact_lock('schedule-person/<shop>/<user>') — the one 0274's writer takes; a transaction
--   that already holds it re-acquires it, so (3) and (4) read and write under ONE lock.
--
-- REFUSALS (raise exception '<code>', P0001), every one a ScheduleErrorCode: schedule_forbidden, person_settings_moved,
--   invalid_payload, plus 0274's own.
--
-- ROLLOUT (Astra BC-007/038): apply 0278 to PROD BEFORE PR #497 merges — the lib has NO 0274 fallback for these writes
--   (without 0278 they refuse 'person_settings_unavailable').
--
-- VERIFY AFTER APPLY:
--   select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('schedule_person_subject_check', 'record_schedule_person_settings',
--    'save_schedule_person_settings', 'merge_schedule_person_positions');                       -- t, search_path pinned
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('schedule_person_subject_check', 'record_schedule_person_settings', 'save_schedule_person_settings',
--    'merge_schedule_person_positions') order by 1, 2;                                          -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)') is null
     or to_regclass('public.schedule_person_settings') is null then
    raise exception '0278: 0274 (schedule_person_settings + record_schedule_person_settings) must be applied first';
  end if;
  if to_regprocedure('public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)') is not null
     or to_regprocedure('public.merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb)') is not null
     or to_regprocedure('public.schedule_person_subject_check(uuid, integer, uuid)') is not null then
    raise exception '0278: already applied';
  end if;
end $$;

-- ── 1. THE SUBJECT RULE (the SQL twin of personSettingsSubjectRefusal) ───────────────────────────
create function public.schedule_person_subject_check(p_actor uuid, p_actor_level integer, p_user uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_subject integer;
begin
  if p_actor_level >= 8 then return; end if;
  v_subject := coalesce(public.assignment_author_level(p_user), 0);
  if p_user = p_actor or v_subject >= 7 or v_subject >= p_actor_level then raise exception 'schedule_forbidden'; end if;
end $$;

-- ── 2. 0274's writer, re-emitted: + the subject check (nothing else changed) ────────────────────
create or replace function public.record_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_work_type text, p_also_allowed text[],
  p_leader_setting text, p_cover_positions uuid[], p_soft_min_h numeric, p_soft_max_h numeric, p_full_time boolean,
  p_full_time_min_h numeric, p_roster_include boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_old public.schedule_person_settings%rowtype; v_had boolean; v_id uuid; v_pos uuid; v_level integer;
begin
  if p_actor is null or p_location is null or p_user is null or p_also_allowed is null or p_cover_positions is null or p_full_time is null then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-person/' || p_location::text || '/' || p_user::text, 0));
  v_level := public.schedule_actor_require(p_actor, p_location, 6);
  v_role := public.schedule_subject_at_shop(p_user, p_location);
  perform public.schedule_person_subject_check(p_actor, v_level, p_user);
  if (p_work_type is not null and p_work_type not in ('boh', 'foh', 'management'))
     or not (p_also_allowed <@ array['boh', 'foh']::text[]) or array_position(p_also_allowed, null) is not null
     or cardinality(p_also_allowed) <> (select count(distinct x) from unnest(p_also_allowed) x)
     or (p_leader_setting is not null and p_leader_setting not in ('opens', 'closes', 'mix'))
     or array_position(p_cover_positions, null) is not null
     or cardinality(p_cover_positions) <> (select count(distinct x) from unnest(p_cover_positions) x)
     or (p_soft_min_h is not null and (p_soft_min_h < 0 or p_soft_min_h > 80 or p_soft_min_h * 4 <> trunc(p_soft_min_h * 4)))
     or (p_soft_max_h is not null and (p_soft_max_h < 0 or p_soft_max_h > 80 or p_soft_max_h * 4 <> trunc(p_soft_max_h * 4)))
     or (p_soft_min_h is not null and p_soft_max_h is not null and p_soft_min_h > p_soft_max_h)
     or (p_full_time_min_h is not null and (p_full_time_min_h < 0 or p_full_time_min_h > 80 or p_full_time_min_h * 4 <> trunc(p_full_time_min_h * 4))) then
    raise exception 'invalid_payload';
  end if;
  if coalesce(p_roster_include, false) and v_role in ('cgs', 'social_media_mgr') then raise exception 'roster_include_refused'; end if;
  foreach v_pos in array p_cover_positions loop
    perform public.people_position_at_shop(v_pos, p_location);
  end loop;
  select * into v_old from public.schedule_person_settings where location_id = p_location and user_id = p_user
   order by created_at desc, id desc limit 1;
  v_had := found;
  insert into public.schedule_person_settings (location_id, user_id, work_type, also_allowed, leader_setting, cover_positions,
      soft_min_h, soft_max_h, full_time, full_time_min_h, roster_include, created_by)
    values (p_location, p_user, p_work_type, p_also_allowed, p_leader_setting, p_cover_positions, p_soft_min_h, p_soft_max_h,
      p_full_time, p_full_time_min_h, p_roster_include, p_actor)
    returning id into v_id;
  return jsonb_build_object('id', v_id,
    'before', case when v_had then to_jsonb(v_old) - 'id' - 'created_by' - 'created_at' - 'location_id' else null end,
    'after', jsonb_build_object('user_id', p_user, 'work_type', p_work_type, 'also_allowed', to_jsonb(p_also_allowed),
      'leader_setting', p_leader_setting, 'cover_positions', to_jsonb(p_cover_positions), 'soft_min_h', p_soft_min_h,
      'soft_max_h', p_soft_max_h, 'full_time', p_full_time, 'full_time_min_h', p_full_time_min_h, 'roster_include', p_roster_include));
end $$;

-- ── 3. The full-row write, the expected head checked under the lock ─────────────────────────────
create function public.save_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_expected uuid, p_work_type text,
  p_also_allowed text[], p_leader_setting text, p_cover_positions uuid[], p_soft_min_h numeric, p_soft_max_h numeric, p_full_time boolean,
  p_full_time_min_h numeric, p_roster_include boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_latest uuid;
begin
  if p_actor is null or p_location is null or p_user is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-person/' || p_location::text || '/' || p_user::text, 0));
  perform public.schedule_person_subject_check(p_actor, public.schedule_actor_require(p_actor, p_location, 6), p_user);
  select id into v_latest from public.schedule_person_settings where location_id = p_location and user_id = p_user
   order by created_at desc, id desc limit 1;
  if v_latest is distinct from p_expected then raise exception 'person_settings_moved'; end if;
  return public.record_schedule_person_settings(p_actor, p_location, p_user, p_work_type, p_also_allowed, p_leader_setting,
    p_cover_positions, p_soft_min_h, p_soft_max_h, p_full_time, p_full_time_min_h, p_roster_include);
end $$;

-- ── 4. The pickers' changes, merged onto the latest row under the lock ───────────────────────────
create function public.merge_schedule_person_positions(p_actor uuid, p_location uuid, p_user uuid, p_expected uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_old public.schedule_person_settings%rowtype; v_had boolean; v_key text; v_work text; v_list uuid[]; v_p uuid; v_s uuid;
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_actor is null or p_location is null or p_user is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'invalid_payload';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('workType', 'primary', 'secondary') then raise exception 'invalid_payload'; end if;
  end loop;
  if p_changes ? 'workType' and not (jsonb_typeof(p_changes -> 'workType') = 'null' or p_changes ->> 'workType' in ('boh', 'foh', 'management')) then
    raise exception 'invalid_payload';
  end if;
  foreach v_key in array array['primary', 'secondary'] loop
    if p_changes ? v_key and not (jsonb_typeof(p_changes -> v_key) = 'null'
       or (jsonb_typeof(p_changes -> v_key) = 'string' and (p_changes ->> v_key) ~ c_uuid)) then
      raise exception 'invalid_payload';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('schedule-person/' || p_location::text || '/' || p_user::text, 0));
  perform public.schedule_person_subject_check(p_actor, public.schedule_actor_require(p_actor, p_location, 6), p_user);
  select * into v_old from public.schedule_person_settings where location_id = p_location and user_id = p_user
   order by created_at desc, id desc limit 1;
  v_had := found;
  if (case when v_had then v_old.id else null end) is distinct from p_expected then raise exception 'person_settings_moved'; end if;
  v_work := case when p_changes ? 'workType' then p_changes ->> 'workType' when v_had then v_old.work_type else null end;
  v_list := case when v_had then v_old.cover_positions else '{}'::uuid[] end;
  if p_changes ? 'primary' or p_changes ? 'secondary' then
    v_p := case when p_changes ? 'primary' then (p_changes ->> 'primary')::uuid else v_list[1] end;
    v_s := case when p_changes ? 'secondary' then (p_changes ->> 'secondary')::uuid else v_list[2] end;
    if v_p is null then
      v_list := '{}'::uuid[];
    elsif v_s is null or v_s = v_p then
      v_list := array[v_p];
    else
      v_list := array[v_p, v_s] || coalesce((select array_agg(x order by n) from unnest(v_list[3:]) with ordinality u(x, n)
        where x <> v_p and x <> v_s), '{}'::uuid[]);
    end if;
  end if;
  return public.record_schedule_person_settings(p_actor, p_location, p_user, v_work,
    case when v_had then v_old.also_allowed else '{}'::text[] end, case when v_had then v_old.leader_setting else null end,
    v_list, case when v_had then v_old.soft_min_h else null end, case when v_had then v_old.soft_max_h else null end,
    case when v_had then v_old.full_time else false end, case when v_had then v_old.full_time_min_h else null end,
    case when v_had then v_old.roster_include else null end);
end $$;

-- ── GRANTS: service_role only (0274's posture) ─────────────────────────────────────────────────
revoke all on function public.schedule_person_subject_check(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean) from public, anon, authenticated;
revoke all on function public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean) from public, anon, authenticated;
revoke all on function public.merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.schedule_person_subject_check(uuid, integer, uuid) to service_role;
grant execute on function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean) to service_role;
grant execute on function public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean) to service_role;
grant execute on function public.merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;
