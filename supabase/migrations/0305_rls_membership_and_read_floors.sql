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
--   B. B010 — the catering CHILD tables take the parents' role floor.
--      0189 floored catering_pipeline / catering_orders / catering_customers reads at level 5 (the app's
--      *_READ_MIN) and 0120 did the same for catering_quotes, but the three child policies kept a bare
--      location predicate: a level-3 member could read their shop's quote lines (prices), order lines and
--      lead history with one curl, while the parent row itself returned nothing. Each child read is now
--        level >= 9  OR  (level >= 5 AND the PARENT's shop = ANY(current_user_locations()))
--      and catering_pipeline_events keeps its third arm unchanged (an unassigned lead's history: level >= 6).
--      ALTER POLICY only: names, the level-9 arm and the write side (0272: no user write at all) are untouched.
--
-- CODE: nothing in the application depends on this migration. The app already filters active memberships
--   (lib/session.ts, resolveChecklistWriteActor), so it behaves the same before and after the apply.
--
-- DEPENDS ON: 0029 (the SECURITY DEFINER helpers), 0078 (user_locations.active), 0200 (current_user_id),
--   0113 / 0120 (the child read policies and the catering_*_loc oracles), 0189 (the level helper).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select pg_get_functiondef('public.current_user_locations()'::regprocedure);
--     -- the unfiltered body: array_agg(location_id) from user_locations where user_id = current_user_id()
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'current_user_locations' order by 1;
--     -- authenticated, service_role (+ postgres); never anon / PUBLIC
--   select count(*) from public.user_locations where not active;   -- the memberships this closes
--   select tablename, policyname, cmd, roles, qual from pg_policies where schemaname = 'public'
--    and tablename in ('catering_quote_items', 'catering_order_items', 'catering_pipeline_events') order by 1, 2;
--     -- exactly ONE SELECT policy per table (<table>_read), its location arm NOT floored yet
--
-- VERIFY AFTER APPLY:
--   select prosrc from pg_proc where oid = 'public.current_user_locations()'::regprocedure;   -- "and active"
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'current_user_locations' order by 1;   -- unchanged
--   select tablename, qual from pg_policies where schemaname = 'public' and cmd = 'SELECT'
--    and tablename in ('catering_quote_items', 'catering_order_items', 'catering_pipeline_events');
--     -- every qual contains ">= (5)" in front of its catering_*_loc(...) = ANY (current_user_locations()) arm
--   select action, resource_table, metadata->>'bug' from public.audit_log
--    where metadata->>'migration' = '0305_rls_membership_and_read_floors' order by 3;           -- one row per section
--
-- ROLLBACK: re-create current_user_locations() without `and active` (re-opens B009; prefer fixing forward);
--   ALTER the three child policies back to 0113 / 0120's quals (re-opens B010).
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- B. B010 — catering child tables: the parents' role floor on the location arm
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  if to_regprocedure('public.catering_quote_loc(uuid)') is null or to_regprocedure('public.catering_order_loc(uuid)') is null
     or to_regprocedure('public.catering_pipeline_loc(uuid)') is null or to_regprocedure('public.current_user_role_level()') is null then
    raise exception '0305: 0113 / 0120 (the catering_*_loc oracles) and the level helper must exist';
  end if;
  for r in select * from (values ('catering_quote_items'), ('catering_order_items'), ('catering_pipeline_events')) t(tbl) loop
    if to_regclass(format('public.%I', r.tbl)) is null
       or not (select relrowsecurity from pg_class where oid = format('public.%I', r.tbl)::regclass) then
      raise exception '0305: public.% must exist with RLS enabled', r.tbl;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl
                    and policyname = r.tbl || '_read' and cmd = 'SELECT' and permissive = 'PERMISSIVE') then
      raise exception '0305: policy %_read (0113 / 0120) is missing on public.%: refusing', r.tbl, r.tbl;
    end if;
  end loop;
end $$;

alter policy catering_quote_items_read on public.catering_quote_items
  using (
    public.current_user_role_level() >= 9
    or (
      public.current_user_role_level() >= 5
      and public.catering_quote_loc(quote_id) = any (public.current_user_locations())
    )
  );

alter policy catering_order_items_read on public.catering_order_items
  using (
    public.current_user_role_level() >= 9
    or (
      public.current_user_role_level() >= 5
      and public.catering_order_loc(order_id) = any (public.current_user_locations())
    )
  );

-- The third arm is 0113's, unchanged: an unassigned lead's history stays with the catering-capable roles (6+).
alter policy catering_pipeline_events_read on public.catering_pipeline_events
  using (
    public.current_user_role_level() >= 9
    or (
      public.current_user_role_level() >= 5
      and public.catering_pipeline_loc(pipeline_id) = any (public.current_user_locations())
    )
    or (public.catering_pipeline_loc(pipeline_id) is null and public.current_user_role_level() >= 6)
  );

do $$
declare r record; v_qual text; v_others text;
begin
  for r in select * from (values ('catering_quote_items', 'catering_quote_loc'), ('catering_order_items', 'catering_order_loc'),
                                 ('catering_pipeline_events', 'catering_pipeline_loc')) t(tbl, oracle) loop
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = r.tbl and policyname = r.tbl || '_read';
    -- The floor sits IN FRONT OF the location arm (same conjunction), not merely somewhere in the qual.
    if v_qual !~ ('current_user_role_level\(\) >= \(?5\)?(::numeric)?\)? AND \(+(public\.)?' || r.oracle || '\(') then
      raise exception '0305: %_read does not floor its location arm at level 5 after apply (%)', r.tbl, v_qual;
    end if;
    -- Permissive policies OR-stack: a second SELECT (or ALL) policy would re-open what the floor closes.
    select string_agg(policyname, ', ' order by policyname) into v_others from pg_policies
     where schemaname = 'public' and tablename = r.tbl and permissive = 'PERMISSIVE'
       and cmd in ('SELECT', 'ALL') and policyname <> r.tbl || '_read';
    if v_others is not null then
      raise exception '0305: public.% has another permissive read policy (%): the floor would not hold', r.tbl, v_others;
    end if;
  end loop;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
select null, null, 'security.grants_change', t.tbl, null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0305_rls_membership_and_read_floors',
    'bug', 'B010', 'policy', t.tbl || '_read',
    'change', 'location arm floored at role level 5 (the parent table''s read floor); level-9 arm unchanged')
from (values ('catering_quote_items'), ('catering_order_items'), ('catering_pipeline_events')) t(tbl);

commit;
