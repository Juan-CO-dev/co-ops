-- Migration 0334_people_shop_settings_pm_v2_switch_lock
-- AUTHORED 2026-11-16. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- APPLIED TO SIM 2026-11-16 (schema_migrations version 20261116074106, name '0334_people_shop_settings_pm_v2_switch_lock')
-- APPLIED TO PROD 2026-11-16 (schema_migrations version 20261116094357, name '0334_people_shop_settings_pm_v2_switch_lock')
-- Provenance: CO-OPS bug audit wave W25 (scheduling and 7shifts labor math), bug B219 (found at 7494f738).
--   Plan: the W25 build plan, B219.
--
-- WHAT
--   Re-emits save_people_shop_settings (0270, its only definer) with ONE added block: flipping the PM v2 switch
--   (p_pm_v2 differs from the stored value; no row = off) is refused 'pm_v2_moo_only' unless the actor is an
--   ACTIVE moo / owner / cgs (lib/people/access-shared.ts PM_V2_SWITCH_ROLES) — judged AFTER the per-shop advisory
--   lock and the FOR UPDATE read, on the LOCKED row. The app already refuses a GM's switch change, but it read the
--   switch BEFORE the RPC, outside any lock: a MoO turning PM v2 on between that read and the GM's save (the GM
--   changing only the prep position, sending the switch as they last saw it) was silently turned back off.
--   Same signature, `create or replace`: the 0270 grants and ACL stand (re-asserted below anyway). Nothing else in
--   the body changes (pinned as a line-subsequence of 0270 by tests/people-shop-settings-0334-migration.test.ts).
--   Not closed here (follow-up, a wire change): the mirror case — a MoO's switch toggle sends the prep position from
--   the card's view and can write back a GM's concurrent prep change. That needs per-field writes.
--
-- EXISTING ROWS: untouched. No data step.
--
-- APP COMPATIBILITY: the app works before and after this file, in either deploy order.
--   Before: the race stays open (the app's early check is the only guard). After, with the W25 code: the refusal is
--   a named 403 pm_v2_moo_only (lib/people/skills.ts RPC_CODES; its en + es message already exists). After, with
--   OLD code: the refusal surfaces as 500 write_failed (it used to be a silent wrong success).
-- ROLLBACK: re-run 0270's body for this function (create or replace from 0270). Nothing else to undo.
--
-- DEPENDS ON: 0270 (save_people_shop_settings, people_shop_settings, people_position_at_shop), 0233
--   (toast_link_actor_level). The live body must be 0270's (or this file's: re-applies cleanly).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where oid = 'public.save_people_shop_settings(uuid,uuid,boolean,uuid)'::regprocedure;
--     -- ec468c9002fe7f562827c94b751d17ad (0270) or 5f4188850bab073cec1ce8d07374aeb7 (this file)
--   (the DO block below asserts it and refuses otherwise; the fingerprint is md5 over the body with everything but
--    printable ASCII removed, so line endings and whitespace never matter)
--
-- VERIFY AFTER APPLY:
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where oid = 'public.save_people_shop_settings(uuid,uuid,boolean,uuid)'::regprocedure;   -- 5f4188850bab073cec1ce8d07374aeb7
--   select grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name = 'save_people_shop_settings' order by 1;                              -- postgres, service_role
--
-- PROOF: scripts/sql-harness-0334.mjs (PGlite, the real 0270 then this file; CI-pinned). The two-session race
--   (a GM save waiting on the advisory lock while a MoO's flip commits) is scripts/sim/people-0334-pm-v2-lock-check-management.mjs,
--   sim only, run by CC when applying this file.

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
declare v_live text;
begin
  if to_regprocedure('public.save_people_shop_settings(uuid,uuid,boolean,uuid)') is null
     or to_regclass('public.people_shop_settings') is null then
    raise exception '0334: 0270 (save_people_shop_settings, people_shop_settings) must be applied first';
  end if;
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live
    from pg_proc p where p.oid = 'public.save_people_shop_settings(uuid,uuid,boolean,uuid)'::regprocedure;
  if v_live is distinct from 'ec468c9002fe7f562827c94b751d17ad' and v_live is distinct from '5f4188850bab073cec1ce8d07374aeb7' then
    raise exception '0334: the live body of save_people_shop_settings (md5 %) is neither 0270''s nor this file''s — a later definer exists; re-emit from it. Refusing.', v_live;
  end if;
end $$;

-- ── save_people_shop_settings (re-emitted from 0270; B219 block added) ───────────────────────────
create or replace function public.save_people_shop_settings(p_actor uuid, p_location uuid, p_pm_v2 boolean, p_prep_position uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old public.people_shop_settings%rowtype; v_had boolean; v_role text;
begin
  if p_actor is null or p_location is null or p_pm_v2 is null then raise exception 'invalid_payload'; end if;
  -- One shop's settings saves are serialised BEFORE the read (Astra chunk E #6): `select … for update` locks
  -- nothing while the row does not exist yet, so two first saves could both insert and the loser hit 23505.
  perform pg_advisory_xact_lock(hashtextextended('people-shop-settings/' || p_location::text, 0));
  perform public.toast_link_actor_level(p_actor, p_location);
  if p_prep_position is not null then perform public.people_position_at_shop(p_prep_position, p_location); end if;
  select * into v_old from public.people_shop_settings where location_id = p_location for update;
  v_had := found;
  -- 0334 (B219): flipping the PM v2 switch is moo / owner / cgs only (PM_V2_SWITCH_ROLES), judged HERE on the
  -- LOCKED row (no row = off) — the app's earlier check read the switch before this lock, so a GM's save could
  -- write back the value a MoO had just changed.
  if p_pm_v2 is distinct from coalesce(case when v_had then v_old.pm_v2 end, false) then
    select u.role into v_role from public.users u where u.id = p_actor and u.active;
    if v_role is null or v_role not in ('moo', 'owner', 'cgs') then raise exception 'pm_v2_moo_only'; end if;
  end if;
  if v_had then
    update public.people_shop_settings
       set pm_v2 = p_pm_v2, prep_position_id = p_prep_position, updated_by = p_actor, updated_at = clock_timestamp()
     where location_id = p_location;
  else
    insert into public.people_shop_settings (location_id, pm_v2, prep_position_id, updated_by)
      values (p_location, p_pm_v2, p_prep_position, p_actor);
  end if;
  return jsonb_build_object(
    'before', case when v_had then jsonb_build_object('pm_v2', v_old.pm_v2, 'prep_position_id', v_old.prep_position_id) else null end,
    'after', jsonb_build_object('pm_v2', p_pm_v2, 'prep_position_id', p_prep_position));
end $$;

revoke all on function public.save_people_shop_settings(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.save_people_shop_settings(uuid, uuid, boolean, uuid) to service_role;

-- ── POST-CHECK ──────────────────────────────────────────────────────────────────────────────────
do $$
declare v_live text; f regprocedure := 'public.save_people_shop_settings(uuid,uuid,boolean,uuid)'::regprocedure;
begin
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p where p.oid = f;
  if v_live is distinct from '5f4188850bab073cec1ce8d07374aeb7' then
    raise exception '0334: save_people_shop_settings does not carry this file''s body after apply (md5 %)', v_live;
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0334: save_people_shop_settings must be executable by service_role only';
  end if;
end $$;

commit;
