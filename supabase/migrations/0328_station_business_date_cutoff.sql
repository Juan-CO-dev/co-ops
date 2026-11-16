-- Migration 0328_station_business_date_cutoff
-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first, prod on Juan's word.
-- Provenance: bug audit wave W21 ("Floor pulse, stations and handoff notes"), bug B116.
--   Reviewed plan: audit/plans/W21.md (B116). Owner decision W21-1 (b): the business-day cutoff
--   is 01:00 ET (not the plan's proposed 04:00).
-- WHAT:
--   1. station_business_date_at(uuid, timestamptz) (NEW): 0217's station_business_date rule at an
--      explicit instant, plus ONE addition. An open closing still holds its own day across midnight
--      (shift_start_at + 16 h, unchanged), but ONLY until 01:00 ET wall-clock time on the morning
--      after its date: `(p_at at time zone 'America/New_York') < (i.date + 1)::timestamp + interval
--      '1 hour'`. Local time is compared with local time, so the cutoff is DST-safe (on the fall-back
--      night it flips at the FIRST 01:00 and never flips back). After the cutoff the ET calendar day
--      wins, so the morning crew always works on the new day: a station claim is no longer refused
--      `station_closed` by last night's fully-checked closing, and is no longer written under
--      yesterday's date, where it vanished from the board once the closing was confirmed (B116).
--   2. station_business_date(uuid) <- 0217: SAME signature, same STABLE SECURITY DEFINER SQL body
--      shape, same grants; the body now delegates to station_business_date_at(p_location_id, now()).
--      Every caller (write_station_event / write_station_break / write_task_assignment's guard,
--      reconcile_station_lifecycle, the checklist_station_lifecycle trigger, 0233's whos_here,
--      lib/assignments.ts loadShiftBoard, scripts/guide-test/reset-*.sql) calls it unchanged.
-- SIDE EFFECT (named): a closer still checking items off after 01:00 ET no longer triggers the 0230
--   station release for yesterday (the trigger compares against station_business_date, which is now
--   today). Nobody is on yesterday's floor by then and yesterday's history is unchanged. Any station
--   change a closer makes after 01:00 is filed under the new day. Auto-release of a forgotten closing
--   (0314: not before 07:00 ET the morning after) is untouched.
-- DATA: none changed. station_events is append-only; claims written under the old day stay as history.
-- LOCK ORDER: no new lock; both functions are read-only (STABLE).
-- ROLLOUT: SQL only, no app change. The app keeps working before and after apply (every reader
--   goes through the station_business_date RPC). Read-only check before apply (results are history):
--     -- morning station events filed under the previous day (B116)
--     select location_id, business_date, count(*) from public.station_events
--      where (at at time zone 'America/New_York')::date > business_date
--        and (at at time zone 'America/New_York')::time >= time '01:00'
--      group by 1, 2 order by 2 desc;
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.station_business_date(uuid)'::regprocedure), 'station_business_date_at') > 0; -- t
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('station_business_date', 'station_business_date_at'); -- service_role (+ postgres)
--   Run scripts/sql-harness-0328.mjs (offline) and scripts/sim/stations-0328-cutoff-check-management.mjs
--   (sim only, CC). Re-run scripts/test-station-lifecycle.sql and scripts/test-whos-here.sql on sim.
-- ROLLBACK: forward-only. Re-emit 0217's station_business_date body in a NEW migration; never
--   rewrite history.
begin;

do $$
declare v_def text;
begin
  if to_regprocedure('public.station_business_date(uuid)') is null then
    raise exception '0328: expected station_business_date(uuid) (0217)';
  end if;
  if to_regprocedure('public.station_business_date_at(uuid,timestamptz)') is not null then
    raise exception '0328: station_business_date_at already exists';
  end if;
  v_def := pg_get_functiondef('public.station_business_date(uuid)'::regprocedure);
  if strpos(v_def, 'i.shift_start_at + interval ''16 hours'' > now()') = 0
     or strpos(v_def, 't.type=''closing'' and i.status=''open''') = 0 then
    raise exception '0328: station_business_date drifted from 0217';
  end if;
  foreach v_def in array array['checklist_instances.location_id', 'checklist_instances.template_id', 'checklist_instances.status',
    'checklist_instances.shift_start_at', 'checklist_instances.date', 'checklist_templates.type'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public'
        and table_name = split_part(v_def, '.', 1) and column_name = split_part(v_def, '.', 2)) then
      raise exception '0328: missing expected column %', v_def;
    end if;
  end loop;
end $$;

-- ==========================================================================================
-- 1. station_business_date_at (NEW): 0217's rule at an explicit instant + the 01:00 ET cutoff
-- ==========================================================================================
-- Station shifts follow a still-live closing across midnight. Reuse C.48's
-- shift_start_at + 16-hour expiry (0046), and stop following it at 01:00 ET the next morning (B116).
create function public.station_business_date_at(p_location_id uuid, p_at timestamptz)
returns date language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select i.date from public.checklist_instances i
    join public.checklist_templates t on t.id=i.template_id
    where i.location_id=p_location_id and t.type='closing' and i.status='open'
      and i.shift_start_at <= p_at and i.shift_start_at + interval '16 hours' > p_at
      and i.date <= (p_at at time zone 'America/New_York')::date
      -- W21/B116 (owner decision W21-1 b): an open closing holds its day only until 01:00 ET
      -- (wall clock) on the morning after its date.
      and (p_at at time zone 'America/New_York') < (i.date + 1)::timestamp + interval '1 hour'
    order by i.date desc, i.shift_start_at desc limit 1),
    (p_at at time zone 'America/New_York')::date)
$$;

-- ==========================================================================================
-- 2. station_business_date <- 0217: same signature, delegates at now()
-- ==========================================================================================
create or replace function public.station_business_date(p_location_id uuid)
returns date language sql stable security definer set search_path=pg_catalog,public as $$
  select public.station_business_date_at(p_location_id, now())
$$;

revoke all on function public.station_business_date_at(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.station_business_date(uuid) from public, anon, authenticated;
grant execute on function public.station_business_date_at(uuid,timestamptz) to service_role;
grant execute on function public.station_business_date(uuid) to service_role;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.station_business_date(uuid)'::regprocedure,
    'public.station_business_date_at(uuid,timestamptz)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0328: RPC execution grant escaped for %', f;
    end if;
    if exists (select 1 from pg_proc where oid = f and (not prosecdef or provolatile <> 's' or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0328: RPC execution context escaped for %', f;
    end if;
  end loop;
end $$;

INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'station_events', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0328_station_business_date_cutoff',
    'change', 'an open closing holds the station business day only until 01:00 ET the morning after its date',
    'bugs', jsonb_build_array('B116')));
commit;
