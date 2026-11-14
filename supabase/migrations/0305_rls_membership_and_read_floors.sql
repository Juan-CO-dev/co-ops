-- Migration 0305_rls_membership_and_read_floors
-- AUTHORED 2026-11-14. NOT YET APPLIED — FILE ONLY. Apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: the 2026-11-14 bug audit (found at commit 7494f738), fix wave W05 "Database access rules and
--   shop binding". One file for the wave's SQL; each section names its bug id.
--
-- ── WHY THIS LAYER ──────────────────────────────────────────────────────────────────────────────────────
-- The staff JWT carries `role:'authenticated'` and is a valid PostgREST bearer (AGENTS.md, Database & RLS).
-- Every app-layer check is invisible on that path: only RLS quals, table grants and function grants stand.
-- Pre-flight against the repo 2026-11-14: the app reads none of the tables below through a user-context
-- client that depends on the predicates changed here (catering and checklist corrections are service-role;
-- nothing reads opening_setup_items), so this changes what a cookie + curl can reach, not what a screen shows.
--
-- WHAT:
--   A. B009 — current_user_locations() counts ACTIVE memberships only.
--      The helper behind every location-scoped policy never filtered `user_locations.active` (0078 added the
--      column and said "No RLS change"), so taking a person off a shop (admin_user_set_locations sets
--      active = false and revokes sessions) left that shop's rows readable on the curl path after their next
--      sign-in. Re-emitted with `AND active`; same signature, STABLE, SECURITY DEFINER, pinned search_path
--      and grants (authenticated + service_role; never anon / PUBLIC). An untouched member is unaffected.
--
-- CODE: nothing in the application depends on this migration. The app already filters active memberships
--   (lib/session.ts, resolveChecklistWriteActor), so it behaves the same before and after the apply.
--
-- DEPENDS ON: 0029 (the SECURITY DEFINER helpers), 0078 (user_locations.active), 0200 (current_user_id).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select pg_get_functiondef('public.current_user_locations()'::regprocedure);
--     -- the unfiltered body: array_agg(location_id) from user_locations where user_id = current_user_id()
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'current_user_locations' order by 1;
--     -- authenticated, service_role (+ postgres); never anon / PUBLIC
--   select count(*) from public.user_locations where not active;   -- the memberships this closes
--
-- VERIFY AFTER APPLY:
--   select prosrc from pg_proc where oid = 'public.current_user_locations()'::regprocedure;   -- "and active"
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'current_user_locations' order by 1;   -- unchanged
--   select action, resource_table, metadata->>'bug' from public.audit_log
--    where metadata->>'migration' = '0305_rls_membership_and_read_floors' order by 3;           -- one row per section
--
-- ROLLBACK: re-create current_user_locations() without `and active` (re-opens B009; prefer fixing forward).
--   Nothing here drops data.

begin;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- A. B009 — current_user_locations(): active memberships only
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v record;
begin
  if to_regprocedure('public.current_user_locations()') is null or to_regprocedure('public.current_user_id()') is null then
    raise exception '0305: the RLS helpers current_user_locations() / current_user_id() must exist';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_locations' and column_name = 'active') then
    raise exception '0305: 0078 (user_locations.active) must be applied first';
  end if;
  select p.prorettype::regtype::text as ret, p.prosecdef, p.prosrc into v
    from pg_proc p where p.oid = 'public.current_user_locations()'::regprocedure;
  if v.prosrc ~* '\mactive\M' then
    raise exception '0305: already applied (current_user_locations() already filters active)';
  end if;
  -- The live helper must be the one this file replaces: uuid[], SECURITY DEFINER, reading user_locations for
  -- current_user_id(). Anything else is drift this file was not written against.
  if v.ret <> 'uuid[]' or not v.prosecdef or v.prosrc !~* 'user_locations' or v.prosrc !~* 'current_user_id\(\)' then
    raise exception '0305: current_user_locations() is not the expected helper (returns %, definer %): refusing', v.ret, v.prosecdef;
  end if;
end $$;

create or replace function public.current_user_locations()
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(location_id), array[]::uuid[])
  from public.user_locations
  where user_id = public.current_user_id()
    and active
$$;

-- CREATE OR REPLACE keeps the ACL; the posture is re-asserted so the guard below proves it either way.
-- `authenticated` keeps EXECUTE because RLS quals call the helper (AGENTS.md: the current_user_* exception).
revoke all on function public.current_user_locations() from public, anon;
grant execute on function public.current_user_locations() to authenticated, service_role;

do $$
declare
  f regprocedure := 'public.current_user_locations()'::regprocedure;
  v record;
begin
  select p.prosecdef, p.provolatile, p.proconfig, p.prosrc into v from pg_proc p where p.oid = f;
  if v.prosrc !~* 'where user_id = public\.current_user_id\(\)\s+and active' then
    raise exception '0305: current_user_locations() does not filter active memberships after apply';
  end if;
  if not v.prosecdef or v.provolatile <> 's'
     or not coalesce(v.proconfig @> array['search_path=pg_catalog, public'], false) then
    raise exception '0305: current_user_locations() must stay STABLE SECURITY DEFINER with a pinned search_path';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0305: current_user_locations() grants escaped (want authenticated + service_role, never anon)';
  end if;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
values (null, null, 'security.grants_change', 'user_locations', null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0305_rls_membership_and_read_floors',
    'bug', 'B009', 'function', 'public.current_user_locations()',
    'change', 'counts active user_locations rows only: a removed shop membership no longer opens location-scoped RLS'));

commit;
