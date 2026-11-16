-- Migration 0314_closing_release_floor_midday_create
-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first, prod on Juan's word.
-- Provenance: bug audit wave W13 ("Checklist submissions accepting the wrong checklist or
--   day"), bugs B075, B076 (backstop), B178. Reviewed plan: audit/plans/W13.md (migration B).
--   Owner decision W13-1 (b): the earliest auto-release of a forgotten closing is 07:00 ET.
-- WHAT:
--   1. release_overdue_closings(uuid[]) <- 0046, ADDITIONS ONLY: besides the 16 h rule, an open
--      closing is never auto-released before 07:00 ET on the morning AFTER its own date
--      (`(date + 1) 07:00` read as America/New_York wall-clock time, DST-safe). B075: the
--      16 h clock starts at the first page view, so a closing opened at 06:00 was released at
--      22:00 the same night, mid-shift. B076: a future-dated closing can no longer be released
--      before its day. A closing first opened at 15:00 or later behaves exactly as before (its
--      16 h is already past 07:00 next morning). The audit row gains `release_not_before`.
--      `shift_start_at` itself is unchanged (people/scheduling readers use it).
--   2. create_mid_day_prep_instance_atomic (NEW, B178): count + insert of a mid-day prep
--      instance under one transaction-scoped advisory lock per (template, shop, date), the
--      date pinned to the ET calendar day in SQL (`date_not_today`), the template checked to be
--      that shop's active mid-day prep (`template_mismatch`). Returns {ok:true,id} or
--      {ok:false,reason:'cap_reached',cap}. The count stays per template_id, exactly as the
--      app's count-then-insert counted it. SECURITY DEFINER, service_role only.
-- LOCK ORDER: the new RPC takes only its own advisory lock, then inserts one instance row; it
--   never locks an AM / closing instance or a completion (AGENTS.md global order untouched).
--   release_overdue_closings takes no new lock.
-- ROLLOUT: SQL first or together. The app (W13 PR) calls the new RPC and, until this migration
--   is applied, falls back to its old count-then-insert (logged `[mid-day create 0314_missing]`),
--   so nothing breaks before apply. The release floor needs no app change; pg_cron keeps calling
--   release_overdue_closings(NULL). Read-only checks before apply (results are history; any
--   change to them is an owner decision):
--     -- closings the system released on their own ET date (B075)
--     select ci.location_id, ci.date, ci.shift_start_at, a.created_at from checklist_instances ci
--       join audit_log a on a.resource_id = ci.id and a.action = 'closing.released_unfinalized'
--      where ci.finalized_at_actor_type = 'system_auto'
--        and (a.created_at at time zone 'America/New_York')::date = ci.date;
--     -- future-dated closings (B076)
--     select ci.id, ci.location_id, ci.date, ci.status, ci.created_at from checklist_instances ci
--       join checklist_templates ct on ct.id = ci.template_id and ct.type = 'closing'
--      where ci.date > (ci.created_at at time zone 'America/New_York')::date;
--     -- mid-day days over the cap (B178)
--     select template_id, location_id, date, count(*) from checklist_instances
--      where allows_multiple_per_day group by 1, 2, 3 having count(*) > 2;
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.release_overdue_closings(uuid[])'::regprocedure), 'v_release_floor_hour') > 0; -- t
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('release_overdue_closings', 'create_mid_day_prep_instance_atomic'); -- service_role (+ postgres)
--   Run scripts/sql-harness-0314.mjs (offline) and scripts/sim/checklist-0314-midday-cap-lock-check-management.mjs
--   (sim only, CC: the two-session cap proof).
-- ROLLBACK: forward-only. Re-emit 0046's release body in a NEW migration (the app keeps working
--   without the RPC only after its fallback is restored); never rewrite history.
begin;

do $$
declare v_def text;
begin
  if to_regprocedure('public.release_overdue_closings(uuid[])') is null then
    raise exception '0314: expected release_overdue_closings(uuid[])';
  end if;
  v_def := pg_get_functiondef('public.release_overdue_closings(uuid[])'::regprocedure);
  if strpos(v_def, 'v_grace_hours constant integer := 16') = 0
     or strpos(v_def, '''closing.released_unfinalized''') = 0 then
    raise exception '0314: release_overdue_closings drifted from 0046';
  end if;
  if strpos(v_def, 'v_release_floor_hour') > 0 then
    raise exception '0314: release floor already present';
  end if;
  if to_regprocedure('public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer)') is not null then
    raise exception '0314: create_mid_day_prep_instance_atomic already exists';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'checklist_instances' and column_name = 'allows_multiple_per_day') then
    raise exception '0314: checklist_instances.allows_multiple_per_day missing (0059)';
  end if;
end $$;

-- ==========================================================================================
-- 1. release_overdue_closings <- 0046 (W13/B075 + B076): the morning-after floor
-- ==========================================================================================
CREATE OR REPLACE FUNCTION public.release_overdue_closings(p_location_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inst RECORD;
  v_count integer := 0;
  v_grace_hours constant integer := 16;
  -- 0314 (W13/B075, owner decision W13-1 b): never before 07:00 ET on the day after the closing's date.
  v_release_floor_hour constant integer := 7;
BEGIN
  FOR v_inst IN
    SELECT ci.id, ci.template_id, ci.location_id, ci.date, ci.shift_start_at
    FROM checklist_instances ci
    JOIN checklist_templates ct ON ct.id = ci.template_id
    WHERE ci.status = 'open'
      AND ct.type = 'closing'
      AND ci.shift_start_at IS NOT NULL
      AND ci.shift_start_at < (now() - (v_grace_hours || ' hours')::interval)
      -- 0314 (W13/B075 + B076): the 16 h clock starts at the first page view; a closing is
      -- also never released before the floor hour (ET wall clock) on the morning after its day.
      AND now() >= (((ci.date + 1)::timestamp + make_interval(hours => v_release_floor_hour)) AT TIME ZONE 'America/New_York')
      AND (p_location_ids IS NULL OR ci.location_id = ANY(p_location_ids))
  LOOP
    UPDATE checklist_instances
    SET status = 'auto_finalized',
        finalized_at_actor_type = 'system_auto'
    WHERE id = v_inst.id
      AND status = 'open';

    IF FOUND THEN
      INSERT INTO audit_log (
        actor_id, actor_role, action, resource_table, resource_id,
        before_state, after_state, metadata, destructive
      )
      VALUES (
        NULL, NULL,
        'closing.released_unfinalized',
        'checklist_instances',
        v_inst.id,
        jsonb_build_object('status', 'open'),
        jsonb_build_object(
          'status', 'auto_finalized',
          'finalized_at_actor_type', 'system_auto'
        ),
        jsonb_build_object(
          'release_source', 'system_auto',
          'template_id', v_inst.template_id,
          'location_id', v_inst.location_id,
          'date', v_inst.date,
          'shift_start_at', v_inst.shift_start_at,
          'grace_hours', v_grace_hours,
          'released_at', now(),
          'notification_pending', true,
          'ip_address', NULL,
          'user_agent', NULL
        )
        -- 0314: the floor this release cleared (ET wall clock, as a timestamptz).
        || jsonb_build_object('release_not_before',
          (((v_inst.date + 1)::timestamp + make_interval(hours => v_release_floor_hour)) AT TIME ZONE 'America/New_York')),
        true
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_overdue_closings(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_overdue_closings(uuid[]) TO service_role;

-- ==========================================================================================
-- 2. create_mid_day_prep_instance_atomic (NEW, W13/B178)
-- ==========================================================================================
create function public.create_mid_day_prep_instance_atomic(
  p_template_id uuid, p_location_id uuid, p_date date, p_actor_id uuid, p_cap integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_n integer;
  v_id uuid;
  v_at timestamptz;
begin
  if p_cap is null or p_cap < 1 or p_cap > 10 then raise exception 'invalid_cap'; end if;
  if p_template_id is null or p_location_id is null or p_actor_id is null then raise exception 'invalid_payload'; end if;
  -- The operational day is the ET calendar day (the dashboard's etCalendarDate).
  if p_date is distinct from v_today then raise exception 'date_not_today'; end if;
  if not exists (select 1 from public.checklist_templates
      where id = p_template_id and location_id = p_location_id and active
        and type = 'prep' and prep_subtype = 'mid_day_prep') then
    raise exception 'template_mismatch';
  end if;
  -- One writer per (template, shop, day): the count and the insert see the same rows.
  perform pg_advisory_xact_lock(hashtextextended(
    'mid_day_prep/' || p_template_id::text || '/' || p_location_id::text || '/' || p_date::text, 0));
  select count(*) into v_n from public.checklist_instances
    where template_id = p_template_id and location_id = p_location_id and date = p_date;
  if v_n >= p_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_reached', 'cap', p_cap);
  end if;
  v_at := clock_timestamp();
  insert into public.checklist_instances (template_id, location_id, date, shift_start_at, status,
      triggered_by_user_id, triggered_at, allows_multiple_per_day)
    values (p_template_id, p_location_id, p_date, v_at, 'open', p_actor_id, v_at, true)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer) from public, anon, authenticated;
grant execute on function public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer) to service_role;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.release_overdue_closings(uuid[])'::regprocedure,
    'public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0314: RPC execution grant escaped for %', f;
    end if;
    if exists (select 1 from pg_proc where oid = f and (not prosecdef or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0314: RPC execution context escaped for %', f;
    end if;
  end loop;
end $$;

INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'checklist_instances', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0314_closing_release_floor_midday_create',
    'change', 'closing auto-release waits for 07:00 ET the morning after its day; mid-day prep create is one locked RPC',
    'bugs', jsonb_build_array('B075', 'B076', 'B178')));
commit;
