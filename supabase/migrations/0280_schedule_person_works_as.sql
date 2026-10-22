-- Migration 0280_schedule_person_works_as
-- AUTHORED 2026-10-21. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0278).
-- Provenance: feat/schedule-works-as, CC-approved tmp/works-as-plan.md.
--
-- Per-shop floor role for off-floor accounts; account permissions remain unchanged.
-- Re-emits 0278's writers with p_works_as default null, preserving the actor, subject,
-- membership, expected-head and per-person lock guards. The partial position merge
-- carries the locked latest row's works_as only while the account remains off-floor. Audit before/after includes the new field.
-- Non-null overrides on floor accounts raise works_as_refused; invalid roles raise invalid_payload.
-- Remove the old record/save signatures before adding the default argument: no ambiguous overloads.
-- All writers retain SECURITY DEFINER, pinned search_path and service_role-only execution.

-- ROLLOUT: apply to prod BEFORE the code merges (code selects works_as; no fallback).
--
-- VERIFY AFTER APPLY:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'schedule_person_settings' and column_name = 'works_as'; -- text, YES
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.schedule_person_settings'::regclass and conname = 'schedule_person_settings_works_as_check';
--   select to_regprocedure('public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)'),
--    to_regprocedure('public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)'); -- both NULL
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('schedule_person_subject_check', 'record_schedule_person_settings',
--      'save_schedule_person_settings', 'merge_schedule_person_positions') order by 1, 2; -- service_role (+ postgres) only

begin;

-- PRE-FLIGHT
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'schedule_person_settings' and column_name = 'works_as') then
    raise exception '0280: already applied';
  end if;
  if to_regprocedure('public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)') is null
     or to_regprocedure('public.merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb)') is null then
    raise exception '0280: 0278 must be applied first';
  end if;
end $$;

alter table public.schedule_person_settings add column works_as text null
  constraint schedule_person_settings_works_as_check check (works_as in ('employee', 'trainer', 'key_holder', 'shift_lead'));
comment on column public.schedule_person_settings.works_as is 'Per-shop floor role for off-floor accounts; never changes account permissions. NULL uses the account role.';

drop function public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean);
drop function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean);

-- 1. Record: same authorization, plus the account-role restriction
create or replace function public.record_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_work_type text, p_also_allowed text[],
  p_leader_setting text, p_cover_positions uuid[], p_soft_min_h numeric, p_soft_max_h numeric, p_full_time boolean,
  p_full_time_min_h numeric, p_roster_include boolean, p_works_as text default null)
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
  if p_works_as is not null and v_role not in ('cgs', 'social_media_mgr', 'catering_mgr', 'prep_mgr') then
    raise exception 'works_as_refused';
  end if;
  if p_works_as is not null and p_works_as not in ('employee', 'trainer', 'key_holder', 'shift_lead') then
    raise exception 'invalid_payload';
  end if;
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
  if p_works_as is null and coalesce(p_roster_include, false) and v_role in ('cgs', 'social_media_mgr') then raise exception 'roster_include_refused'; end if;
  foreach v_pos in array p_cover_positions loop
    perform public.people_position_at_shop(v_pos, p_location);
  end loop;
  select * into v_old from public.schedule_person_settings where location_id = p_location and user_id = p_user
   order by created_at desc, id desc limit 1;
  v_had := found;
  insert into public.schedule_person_settings (location_id, user_id, work_type, also_allowed, leader_setting, cover_positions,
      soft_min_h, soft_max_h, full_time, full_time_min_h, roster_include, created_by, works_as)
    values (p_location, p_user, p_work_type, p_also_allowed, p_leader_setting, p_cover_positions, p_soft_min_h, p_soft_max_h,
      p_full_time, p_full_time_min_h, p_roster_include, p_actor, p_works_as)
    returning id into v_id;
  return jsonb_build_object('id', v_id,
    'before', case when v_had then to_jsonb(v_old) - 'id' - 'created_by' - 'created_at' - 'location_id' else null end,
    'after', jsonb_build_object('user_id', p_user, 'work_type', p_work_type, 'also_allowed', to_jsonb(p_also_allowed),
      'leader_setting', p_leader_setting, 'cover_positions', to_jsonb(p_cover_positions), 'soft_min_h', p_soft_min_h,
      'soft_max_h', p_soft_max_h, 'full_time', p_full_time, 'full_time_min_h', p_full_time_min_h, 'roster_include', p_roster_include, 'works_as', p_works_as));
end $$;

-- ── 2. The full-row write, the expected head checked under the lock ─────────────────────────────
create or replace function public.save_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_expected uuid, p_work_type text,
  p_also_allowed text[], p_leader_setting text, p_cover_positions uuid[], p_soft_min_h numeric, p_soft_max_h numeric, p_full_time boolean,
  p_full_time_min_h numeric, p_roster_include boolean, p_works_as text default null)
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
    p_cover_positions, p_soft_min_h, p_soft_max_h, p_full_time, p_full_time_min_h, p_roster_include, p_works_as);
end $$;

-- ── 3. The pickers' changes, merged onto the latest row under the lock ───────────────────────────
create or replace function public.merge_schedule_person_positions(p_actor uuid, p_location uuid, p_user uuid, p_expected uuid, p_changes jsonb)
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
    case when v_had then v_old.roster_include else null end, case when v_had and public.schedule_subject_at_shop(p_user, p_location) in ('cgs', 'social_media_mgr', 'catering_mgr', 'prep_mgr') then v_old.works_as else null end);
end $$;

-- ── GRANTS: service_role only (0274's posture) ─────────────────────────────────────────────────
revoke all on function public.schedule_person_subject_check(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean, text) from public, anon, authenticated;
revoke all on function public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean, text) from public, anon, authenticated;
revoke all on function public.merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.schedule_person_subject_check(uuid, integer, uuid) to service_role;
grant execute on function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean, text) to service_role;
grant execute on function public.save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean, text) to service_role;
grant execute on function public.merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;
