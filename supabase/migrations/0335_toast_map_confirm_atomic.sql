-- Migration 0335_toast_map_confirm_atomic
-- AUTHORED 2026-11-16. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: CO-OPS bug audit wave W27, bug B230, found at 7494f738.
--   Plan: audit/plans/W27.md (B230); no W27 owner decision recorded — the plan's recommendation is built.
--
-- WHAT:
--   confirm_toast_mapping(p_map_id, p_location_id, p_actor): the Toast menu map "Confirm" in ONE transaction.
--   Before it, lib/admin/toast-map.ts confirmMapping read the rival rows for the same (shop, Toast item GUID),
--   deactivated each, then confirmed its own row — separate statements, no locks. Two managers confirming
--   rival candidates at once each deactivated the OTHER's row, then both confirms matched 0 rows (409 for both):
--   that GUID was left with NO active row, so its sales stopped mapping. A failed confirm after a successful
--   supersede stranded the rival the same way, with no audit row.
--   The function, in order:
--     1. the recipe-graph advisory lock 7258025800 (0258/0264). Every toast_menu_map write that changes `active`
--        already takes it at statement start (0264's shop_owned_lock trigger), BEFORE its row locks; taking it
--        first here keeps that order (graph lock → rows), so this function cannot deadlock against those
--        writers, and two confirms on any GUID queue on it.
--     2. every ACTIVE row on (shop, GUID) FOR UPDATE, in id order, then the target re-read under the lock:
--        gone / other shop → 'toast_map:not_found'; deactivated meanwhile (a rival confirm won) or its GUID
--        changed → 'toast_map:conflict'; no longer a candidate → 'toast_map:not_candidate'.
--     3. an active rival with disposition 'open_item' → 'toast_map:open_item_guid' (typed items are matched by
--        alias, never by GUID) — checked BEFORE any write, so nothing is deactivated.
--     4. supersede every other active row on (shop, GUID) (active = false), then confirm the target
--        (match_status 'confirmed', confirmed_by, confirmed_at). Returns { superseded, location_id }.
--   The race now ends with one confirmed, the other told 'conflict', and the GUID keeps exactly one active row.
--
-- EXISTING ROWS: untouched (no backfill). A GUID stranded by a past race stays as it is; a re-run of auto-match or a
--   manual map recovers it.
--
-- APP (same PR, W27): confirmMapping calls this function. Until it is applied (PGRST202 / 42883) the app falls back
--   to the pre-0335 statement sequence — the app keeps working; the race stays open until this file is applied.
--   manualMap (lib/admin/toast-map.ts, its supersede step) has the same shape and is NOT in this file (not in W27).
--
-- LOCK ORDER: graph advisory lock 7258025800 → toast_menu_map rows of ONE (shop, GUID), id order. rejectMapping /
--   unmapConfirmed / manualMap / runAutoMatch are single-statement writers; the ones that change `active` take the
--   graph lock first (0264 trigger), the others (match_status only) hold one row lock and wait on nothing after it.
--   No cycle. The partial unique index toast_map_uq_guid (0146) still enforces one confirmed row per GUID.
--
-- DEPENDS ON: 0146 (toast_menu_map), 0152 (disposition), 0226 ('open_item' disposition). 0264 is NOT required (the
--   advisory lock is taken either way).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select column_name from information_schema.columns where table_schema='public' and table_name='toast_menu_map'
--    and column_name in ('location_id','toast_item_guid','match_status','active','disposition','confirmed_by','confirmed_at'); -- 7 rows
--   select to_regprocedure('public.confirm_toast_mapping(uuid,uuid,uuid)');                    -- null (or this file's body on re-apply)
--
-- VERIFY AFTER APPLY:
--   select to_regprocedure('public.confirm_toast_mapping(uuid,uuid,uuid)');                    -- not null
--   select grantee from information_schema.routine_privileges
--    where routine_schema='public' and routine_name='confirm_toast_mapping' order by 1;        -- postgres, service_role only
--   Sim proof (two sessions confirming rival rows): scripts/sim/toast-map-0335-confirm-lock-check.mjs (CC, sim only; never run by the builder).
--
-- ROLLBACK: drop function public.confirm_toast_mapping(uuid,uuid,uuid);   (the app falls back to the old sequence)
-- PROOF: scripts/sql-harness-0335.mjs (PGlite, synthetic rows), pinned by tests/toast-map-confirm-migration.test.ts.
begin;

-- ── PRE-FLIGHT: what this file builds on ─────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.toast_menu_map') is null then
    raise exception '0335: public.toast_menu_map missing (0146)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'toast_menu_map'
        and column_name in ('location_id','toast_item_guid','match_status','active','disposition','confirmed_by','confirmed_at')) <> 7 then
    raise exception '0335: toast_menu_map is missing a 0146 / 0152 column';
  end if;
end $$;

-- ── 1. The one confirm writer ────────────────────────────────────────────────────────────────────────────────
create or replace function public.confirm_toast_mapping(p_map_id uuid, p_location_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_loc uuid;
  v_guid text;
  v_row public.toast_menu_map%rowtype;
  v_n integer := 0;
begin
  if p_map_id is null or p_location_id is null then
    raise exception 'toast_map:not_found' using errcode = 'P0001';
  end if;

  -- The graph lock FIRST: every active-changing toast_menu_map write takes it before its row locks (0264).
  perform pg_advisory_xact_lock(7258025800);

  select location_id, toast_item_guid into v_loc, v_guid from public.toast_menu_map where id = p_map_id;
  if v_loc is null or v_loc <> p_location_id then
    raise exception 'toast_map:not_found' using errcode = 'P0001';
  end if;

  -- Every ACTIVE row on this (shop, GUID), the target included, in id order (deterministic; two confirms queue).
  perform 1 from public.toast_menu_map
   where location_id = v_loc and toast_item_guid = v_guid and active
   order by id
     for update;

  -- Re-read the target under the lock.
  select * into v_row from public.toast_menu_map where id = p_map_id for update;
  if not found then
    raise exception 'toast_map:not_found' using errcode = 'P0001';
  end if;
  if not coalesce(v_row.active, false) or v_row.toast_item_guid is distinct from v_guid then
    raise exception 'toast_map:conflict' using errcode = 'P0001';     -- a rival confirm won, or the row moved
  end if;
  if v_row.match_status is distinct from 'candidate' then
    raise exception 'toast_map:not_candidate' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.toast_menu_map
              where location_id = v_loc and toast_item_guid = v_guid and active and id <> p_map_id
                and disposition = 'open_item') then
    raise exception 'toast_map:open_item_guid' using errcode = 'P0001';
  end if;

  update public.toast_menu_map set active = false
   where location_id = v_loc and toast_item_guid = v_guid and active and id <> p_map_id;
  get diagnostics v_n = row_count;

  update public.toast_menu_map
     set match_status = 'confirmed', confirmed_by = p_actor, confirmed_at = clock_timestamp()
   where id = p_map_id;

  return jsonb_build_object('superseded', v_n, 'location_id', v_loc);
end $$;

revoke all on function public.confirm_toast_mapping(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_toast_mapping(uuid, uuid, uuid) to service_role;

-- ── 2. Posture proof ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure := 'public.confirm_toast_mapping(uuid,uuid,uuid)'::regprocedure;
begin
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
    raise exception '0335: confirm_toast_mapping grant escaped';
  end if;
  if not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0335: service_role lacks EXECUTE on confirm_toast_mapping';
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
    raise exception '0335: PUBLIC holds EXECUTE on confirm_toast_mapping';
  end if;
  if not (select prosecdef from pg_proc where oid = f)
     or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0335: confirm_toast_mapping must be SECURITY DEFINER with a pinned search_path';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'confirm_toast_mapping') <> 1 then
    raise exception '0335: expected exactly one confirm_toast_mapping signature';
  end if;
end $$;
commit;
