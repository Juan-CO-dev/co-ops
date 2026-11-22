-- Migration 0318_checklist_task_writers_any_shop_level8
-- AUTHORED 2026-11-15. NOT YET APPLIED — FILE ONLY. Apply via MCP after review (sim first, prod on Juan's word).
-- APPLIED TO SIM 2026-11-16 (schema_migrations version 20261116030149, name '0318_checklist_task_writers_any_shop_level8')
-- APPLIED TO PROD 2026-11-16 (schema_migrations version 20261116030336, name '0318_checklist_task_writers_any_shop_level8')
-- Provenance: the 2026-11-14 bug audit, follow-up wave W05B (after W05 / PR #545). Owner ruling, Juan 2026-11-15:
--   "we routinely do tasks at the shops depending on what's needed and who is available". Level 8+ (MoO, owner,
--   CGS) may mark checklist tasks done, submit batches and confirm instances at ANY shop without a membership row,
--   the rule W05 restored for tagActualCompleter and the one 0287 / 0305 already apply to the correction RPCs.
--   Below level 8 the ACTIVE membership stays required, exactly as today.
--
-- WHAT: public.checklist_actor_level(uuid, uuid) is RE-EMITTED from 0276 (the only migration that defines it). It is
--   the one shop / role gate of the three guarded checklist writers — checklist_write_completion,
--   checklist_submit_batch and checklist_confirm_instance (0276, confirm re-emitted by 0287 and, unapplied, 0288) —
--   and nothing else calls it (pinned in tests/audit-w05b-checklist-any-shop-migration.test.ts). One change:
--   the membership read runs only when the actor's level (0228's assignment_author_level) is below 8. Every line of
--   0276's body is kept, in order (pinned as a line-subsequence); the additions are the `if ... < 8 then` /
--   `end if;` pair around the membership read and one comment.
--   Unchanged: the active-user check comes first (an INACTIVE level-8+ actor is refused `not_authorized`); a
--   level-8+ actor still gets their level back, so the callers' own floors stand (write_completion: the item's
--   min_role_level; confirm: >= 3); SECURITY INVOKER, the pinned search_path, the signature and the service_role-only
--   EXECUTE grant. The callers are NOT re-emitted.
--
-- LOCK ORDER (AGENTS.md "Global checklist lock order", unchanged): each caller locks the instance row FIRST
--   (FOR UPDATE, 0276's established mode), then calls this helper, which takes the actor's users row FOR SHARE and,
--   below level 8 only, the membership row FOR SHARE. 0318 only REMOVES a lock for level 8+ (no user_locations row
--   is read or locked); it adds none and reorders none. assignment_author_level reads the same users row FOR SHARE
--   the line above already holds. No completion row is touched here, so the helper still never takes a parent after
--   a completion.
--
-- CODE (same PR): lib/checklists.ts worksShopTasks lets the same actors through before the RPC (completeItem,
--   submitBatch, confirmInstance and getOrCreateInstance's create branch), and the opening / closing / AM-prep /
--   mid-day pages and routes use canWorkShopTasks (lib/locations.ts). BEFORE this file is applied the app keeps
--   working: members are unaffected, and a level-8+ actor at a shop they are not a member of gets the existing
--   403 "role_level_insufficient" from the RPC on a tap, submit or confirm (nothing is written), as today. The
--   opening and prep phase RPCs (0215 / 0255 / 0290 / 0291) and save_am_prep_draft (0214) check no membership in
--   SQL, so they need no change here.
--
-- DEPENDS ON: 0228 (assignment_author_level), 0276 (checklist_actor_level and its callers), 0277 (the lockdown that
--   asserts this signature stays service_role-only). Independent of 0287 / 0288 / 0305.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select prosecdef, proconfig, strpos(prosrc, 'location_id = p_location and active for share') > 0 as is_0276,
--          strpos(prosrc, '0318') > 0 as already
--     from pg_proc where oid = 'public.checklist_actor_level(uuid,uuid)'::regprocedure;   -- f, {search_path=...}, t, f
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'checklist_actor_level' order by 1;  -- service_role (+ postgres)
--
-- VERIFY AFTER APPLY:
--   select strpos(prosrc, '< 8 then') > 0 from pg_proc where oid = 'public.checklist_actor_level(uuid,uuid)'::regprocedure;  -- t
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'checklist_actor_level' order by 1;  -- unchanged
--   select action, metadata->>'function' from public.audit_log
--    where metadata->>'migration' = '0318_checklist_task_writers_any_shop_level8';           -- one row
--   Smoke (sim): a MoO with no membership at a shop taps one closing item there -> 200; a GM of the other shop -> 403.
--   The lock order is unchanged; scripts/sim/checklist-0287-lock-check.mjs re-proves it when CC wants a two-session run.
--
-- ROLLBACK: re-run 0276's `create function public.checklist_actor_level` body as `create or replace` (level 8+ need a
--   membership again; the app then answers 403 for them at a non-member shop). Nothing here touches data.
--
-- Proof: scripts/sql-harness-0318.mjs (PGlite, the real 0228 + 0276 + 0287 confirm + this file), pinned in CI by
--   tests/audit-w05b-checklist-any-shop-migration.test.ts.

begin;

-- ── pre-flight ──────────────────────────────────────────────────────────────────────────────────────────
do $$
declare v record;
begin
  if to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0318: 0228 (assignment_author_level) must be applied first';
  end if;
  if to_regprocedure('public.checklist_actor_level(uuid,uuid)') is null
     or to_regprocedure('public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)') is null
     or to_regprocedure('public.checklist_submit_batch(uuid,uuid,uuid[])') is null
     or to_regprocedure('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])') is null then
    raise exception '0318: 0276 (checklist_actor_level and the guarded writers) must be applied first';
  end if;
  select prosecdef, prosrc into v from pg_proc where oid = 'public.checklist_actor_level(uuid,uuid)'::regprocedure;
  if strpos(v.prosrc, '0318') > 0 then
    raise exception '0318: already applied (checklist_actor_level already carries the level-8 arm)';
  end if;
  -- Only 0276's body is replaced: a later re-emission must be re-synced into this file, never clobbered.
  if v.prosecdef
     or strpos(v.prosrc, 'perform 1 from public.users where id = p_actor and active for share;') = 0
     or strpos(v.prosrc, 'perform 1 from public.user_locations where user_id = p_actor and location_id = p_location and active for share;') = 0
     or strpos(v.prosrc, 'v_level := public.assignment_author_level(p_actor);') = 0 then
    raise exception '0318: checklist_actor_level is not 0276''s definition: re-sync this file before applying';
  end if;
end $$;

-- ── checklist_actor_level: 0276's body, the membership read now below level 8 only ──────────────────────
create or replace function public.checklist_actor_level(p_actor uuid, p_location uuid)
returns integer language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_level integer;
begin
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  -- 0318 (W05B, Juan 2026-11-15): level 8+ (MoO, owner, CGS) work any shop's tasks without a membership row; below 8 the ACTIVE membership stays required.
  if coalesce(public.assignment_author_level(p_actor), 0) < 8 then
  perform 1 from public.user_locations where user_id = p_actor and location_id = p_location and active for share;
  if not found then raise exception 'not_authorized'; end if;
  end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  return v_level;
end $$;

revoke all on function public.checklist_actor_level(uuid,uuid) from public, anon, authenticated;
grant execute on function public.checklist_actor_level(uuid,uuid) to service_role;

-- ── post-apply guard ────────────────────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure := 'public.checklist_actor_level(uuid,uuid)'::regprocedure; v record;
begin
  select prosecdef, proconfig, prosrc into v from pg_proc where oid = f;
  if strpos(v.prosrc, 'if coalesce(public.assignment_author_level(p_actor), 0) < 8 then') = 0 then
    raise exception '0318: checklist_actor_level does not carry the level-8 arm after apply';
  end if;
  if v.prosecdef or not ('search_path=pg_catalog, public' = any(coalesce(v.proconfig, '{}'::text[]))) then
    raise exception '0318: checklist_actor_level must stay SECURITY INVOKER with the pinned search_path';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0318: checklist_actor_level grants escaped (want service_role only)';
  end if;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
values (null, null, 'security.grants_change', 'checklist_instances', null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0318_checklist_task_writers_any_shop_level8',
    'wave', 'W05B', 'function', 'public.checklist_actor_level(uuid,uuid)',
    'change', 'level 8+ (MoO, owner, CGS) complete, submit and confirm checklist tasks at any shop without a membership; below level 8 an active membership stays required'));

commit;
