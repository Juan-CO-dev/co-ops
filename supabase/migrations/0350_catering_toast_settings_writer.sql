-- Migration 0350_catering_toast_settings_writer
-- AUTHORED 2026-11-19 (item 21 PR 5, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word. Apply AFTER 0347 (it needs 0344's table and 0347's readiness probe; it does NOT need 0348).
-- NUMBER: 0347 is the highest on main and on prod; 0348 (item 21 PR 4) and 0349 (unit br-access) are claimed in
-- co-ops-wt/.mig-claims, so this file takes 0350 (claimed there by unit portal45).
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-21-PORTAL-CATERING-TOAST-PLAN-r3.md and
-- docs/runbooks/catering-toast.md ("Turning a shop on": settings had no app writer; CC flipped a shop's row by SQL).
--
-- WHAT THIS IS. The ONE writer of public.catering_toast_settings (0344), so a shop is turned on from the app's
-- settings card and never by SQL again.
--   set_catering_toast_settings(actor, shop, settings, expected_updated_at)
--     WHO: an active Owner, CGS or MoO, re-checked here on the locked users row (the card binds the same roles first).
--     WHAT: the shop's WHOLE row (all eight settings, nothing else: an unknown or missing key is refused), compared
--     with the row the person saw (`expected_updated_at`; NULL = no row yet): someone else's change in between is
--     refused `settings_moved`. A save that changes nothing is refused `no_change`.
--     REFUSED BY NAME, before 0344's CHECKs could answer with a constraint name:
--       forbidden, location_not_found, invalid_settings, settings_moved, no_change,
--       switch_needs_enabled             a dependent switch without `enabled`;
--       auto_needs_start_date            an automatic switch without auto_link_from_date (Juan answer 7);
--       origin_listing_needs_origin_link include_toast_origin_leads without origin_auto_link_enabled (0344);
--       link_step_not_installed          `enabled` while 0347's link step is not ready;
--       automatic_not_installed          ring_code_enabled / auto_link_enabled / origin_auto_link_enabled while the
--                                        house reconciler (0348) is not installed: a switch that nothing reads would
--                                        only look on.
--     LOCK: hashtext('ezcater-toast-reconcile') first, the lock the house reconciler re-reads the settings under, so a
--     switch turned off is either seen by a run or lands after it; then the actor row, then the settings row.
--     AUDIT: one row in the same transaction, `catering.toast_settings_update`, destructive (a person changes shared
--     operational config): the shop, and the settings before and after. No free text exists in a setting.
--   catering_toast_settings_ready()  what the card asks before it offers a switch: is the link step (0347) ready, and
--     is the house reconciler (0348) installed. The writer refuses on the same two facts; the card never guesses them.
-- Nothing else changes: the table keeps its deny-all RLS and its service-role SELECT ceiling (0344), every write is
-- this SECURITY DEFINER function, and no shop is switched by this file (no row is inserted).
-- Proof: scripts/sql-harness-0350.mjs (PGlite, the REAL 0344 file), CI-pinned by
-- tests/catering-toast-0350-migration.test.ts.

begin;

-- 0. Pre-flight: 0344's table and 0347's readiness probe are in place; the name is free.
do $$
begin
  if to_regclass('public.catering_toast_settings') is null then raise exception '0350: apply 0344 first'; end if;
  if to_regprocedure('public.catering_toast_link_ready()') is null then raise exception '0350: apply 0347 first'; end if;
  if to_regprocedure('public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)') is not null then
    raise exception '0350: set_catering_toast_settings already exists';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'catering_toast_settings'
        and column_name in ('location_id', 'enabled', 'ring_code_enabled', 'auto_link_enabled', 'origin_auto_link_enabled',
                            'include_toast_origin_leads', 'tolerance_cents', 'tolerance_pct', 'auto_link_from_date', 'updated_at')) <> 10 then
    raise exception '0350: catering_toast_settings is not the 0344 shape';
  end if;
end $$;

create function public.set_catering_toast_settings(p_actor_id uuid, p_location_id uuid, p_settings jsonb, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_role text; v_old public.catering_toast_settings%rowtype; v_new public.catering_toast_settings%rowtype;
  v_enabled boolean; v_codes boolean; v_auto boolean; v_origin boolean; v_list boolean; v_cents integer; v_pct numeric; v_from date;
  v_before jsonb; v_after jsonb;
  c_keys constant text[] := array['enabled', 'ring_code_enabled', 'auto_link_enabled', 'origin_auto_link_enabled',
                                  'include_toast_origin_leads', 'tolerance_cents', 'tolerance_pct', 'auto_link_from_date'];
begin
  -- The whole row, exactly these eight keys, each of its own type. Nothing else can ride in.
  if p_actor_id is null or p_location_id is null or p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or (select count(*) from jsonb_object_keys(p_settings)) <> 8
     or exists (select 1 from jsonb_object_keys(p_settings) k where k <> all (c_keys))
     or exists (select 1 from unnest(c_keys[1:5]) k where jsonb_typeof(p_settings->k) is distinct from 'boolean')
     or jsonb_typeof(p_settings->'tolerance_cents') is distinct from 'number' or jsonb_typeof(p_settings->'tolerance_pct') is distinct from 'number'
     or jsonb_typeof(p_settings->'auto_link_from_date') not in ('null', 'string')
     or (jsonb_typeof(p_settings->'auto_link_from_date') = 'string' and p_settings->>'auto_link_from_date' !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  if (p_settings->>'tolerance_cents')::numeric <> trunc((p_settings->>'tolerance_cents')::numeric)
     or (p_settings->>'tolerance_cents')::numeric not between 0 and 100000
     or (p_settings->>'tolerance_pct')::numeric not between 0 and 1
     or (p_settings->>'tolerance_pct')::numeric <> round((p_settings->>'tolerance_pct')::numeric, 3) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  v_enabled := (p_settings->>'enabled')::boolean;
  v_codes := (p_settings->>'ring_code_enabled')::boolean;
  v_auto := (p_settings->>'auto_link_enabled')::boolean;
  v_origin := (p_settings->>'origin_auto_link_enabled')::boolean;
  v_list := (p_settings->>'include_toast_origin_leads')::boolean;
  v_cents := (p_settings->>'tolerance_cents')::integer;
  v_pct := (p_settings->>'tolerance_pct')::numeric;
  begin
    v_from := (p_settings->>'auto_link_from_date')::date;
  exception when others then
    -- A string shaped like a date that is not one (2026-02-30).
    raise exception 'invalid_settings' using errcode = 'P0001';
  end;

  -- Lock order: the reconcile advisory lock FIRST (the house reconciler re-reads the settings under it), then the
  -- actor, then the settings row.
  perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));
  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null or v_role not in ('owner', 'cgs', 'moo') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.active) then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;

  select * into v_old from public.catering_toast_settings s where s.location_id = p_location_id for update;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'settings_moved' using errcode = 'P0001'; end if;

  -- The dependencies, by name.
  if not v_enabled and (v_codes or v_auto or v_origin or v_list) then raise exception 'switch_needs_enabled' using errcode = 'P0001'; end if;
  if (v_auto or v_origin) and v_from is null then raise exception 'auto_needs_start_date' using errcode = 'P0001'; end if;
  if v_list and not v_origin then raise exception 'origin_listing_needs_origin_link' using errcode = 'P0001'; end if;
  if v_enabled and not coalesce(public.catering_toast_link_ready(), false) then
    raise exception 'link_step_not_installed' using errcode = 'P0001';
  end if;
  if (v_codes or v_auto or v_origin) and to_regprocedure('public.reconcile_catering_toast(uuid,date,date)') is null then
    raise exception 'automatic_not_installed' using errcode = 'P0001';
  end if;

  if v_old.location_id is not null and v_old.enabled = v_enabled and v_old.ring_code_enabled = v_codes and v_old.auto_link_enabled = v_auto
     and v_old.origin_auto_link_enabled = v_origin and v_old.include_toast_origin_leads = v_list and v_old.tolerance_cents = v_cents
     and v_old.tolerance_pct = v_pct and v_old.auto_link_from_date is not distinct from v_from then
    raise exception 'no_change' using errcode = 'P0001';
  end if;

  insert into public.catering_toast_settings(location_id, enabled, ring_code_enabled, auto_link_enabled, origin_auto_link_enabled,
                                              include_toast_origin_leads, tolerance_cents, tolerance_pct, auto_link_from_date, updated_at)
    values (p_location_id, v_enabled, v_codes, v_auto, v_origin, v_list, v_cents, v_pct, v_from, clock_timestamp())
  on conflict (location_id) do update
    set enabled = excluded.enabled, ring_code_enabled = excluded.ring_code_enabled, auto_link_enabled = excluded.auto_link_enabled,
        origin_auto_link_enabled = excluded.origin_auto_link_enabled, include_toast_origin_leads = excluded.include_toast_origin_leads,
        tolerance_cents = excluded.tolerance_cents, tolerance_pct = excluded.tolerance_pct,
        auto_link_from_date = excluded.auto_link_from_date, updated_at = excluded.updated_at
  returning * into v_new;

  v_before := case when v_old.location_id is null then null else to_jsonb(v_old) - 'location_id' - 'updated_at' end;
  v_after := to_jsonb(v_new) - 'location_id' - 'updated_at';
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'catering.toast_settings_update', 'catering_toast_settings', p_location_id,
            jsonb_build_object('location_id', p_location_id, 'before', v_before, 'after', v_after), true);
  return to_jsonb(v_new);
end $$;

-- The two facts the writer's dependency refusals rest on, for the card (read-only).
create function public.catering_toast_settings_ready() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'link_step', coalesce(public.catering_toast_link_ready(), false),
    'automatic', to_regprocedure('public.reconcile_catering_toast(uuid,date,date)') is not null)
$$;

revoke all on function public.catering_toast_settings_ready() from public, anon, authenticated;
grant execute on function public.catering_toast_settings_ready() to service_role;
revoke all on function public.set_catering_toast_settings(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.set_catering_toast_settings(uuid, uuid, jsonb, timestamptz) to service_role;

-- The ceiling is 0344's and is asserted again: the table is written by this function alone.
do $$
declare p text;
begin
  if not has_table_privilege('service_role', 'public.catering_toast_settings', 'select') then raise exception 'ceiling: select missing'; end if;
  foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('service_role', 'public.catering_toast_settings', p) then raise exception 'ceiling: service_role holds %', p; end if;
    if has_table_privilege('authenticated', 'public.catering_toast_settings', p) or has_table_privilege('anon', 'public.catering_toast_settings', p) then
      raise exception 'ceiling: a user role holds %', p;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.catering_toast_settings', 'select') or has_table_privilege('anon', 'public.catering_toast_settings', 'select') then
    raise exception 'ceiling: a user role can read catering_toast_settings';
  end if;
  if has_function_privilege('authenticated', 'public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)', 'execute') then
    raise exception 'ceiling: a user role can execute set_catering_toast_settings';
  end if;
  if has_function_privilege('authenticated', 'public.catering_toast_settings_ready()', 'execute')
     or has_function_privilege('anon', 'public.catering_toast_settings_ready()', 'execute') then
    raise exception 'ceiling: a user role can execute catering_toast_settings_ready';
  end if;
end $$;

commit;

-- Verify after apply:
--   select has_function_privilege('service_role', 'public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)', 'execute'); -- true
--   select public.catering_toast_settings_ready();        -- {"link_step": true, "automatic": <true once 0348 is applied>}
--   select count(*) from public.catering_toast_settings;  -- unchanged (0 on prod today: this file switches no shop)
