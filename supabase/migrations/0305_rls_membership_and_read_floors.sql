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
--   C. B150 — the three checklist correction RPCs require an ACTIVE membership.
--      0287's checklist_revoke_completion / checklist_revoke_with_reason / checklist_mark_not_done checked
--      user_locations WITHOUT `active` ("parity with today's current_user_locations"), so a person removed
--      from a shop could still correct that shop's checklist entries. With section A the parity argument
--      points the other way. Re-emitted from 0287 with ONE changed line each (`... and active for share`);
--      level 8+ still needs no membership (0287's ruling, unchanged), and every other statement, the lock
--      order (instance FOR NO KEY UPDATE, then the completion), SECURITY INVOKER, the pinned search_path and
--      the service_role-only grants are 0287's. checklist_confirm_instance is NOT touched.
--
-- CODE: nothing in the application depends on this migration. The app already filters active memberships
--   (lib/session.ts, resolveChecklistWriteActor), so it behaves the same before and after the apply. The same
--   PR adds the app-side half of C (lib/checklists.ts binds the verified actor to the instance's shop before
--   calling the RPCs), which closes the app path on its own; either order of deploy and apply is safe.
--
-- DEPENDS ON: 0029 (the SECURITY DEFINER helpers), 0078 (user_locations.active), 0200 (current_user_id),
--   0113 / 0120 (the child read policies and the catering_*_loc oracles), 0189 (the level helper),
--   0287 (the three correction RPCs) and 0228 (assignment_author_level).
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
--   select proname, strpos(prosrc, 'location_id = v_instance.location_id for share') > 0 as is_0287
--     from pg_proc where pronamespace = 'public'::regnamespace
--      and proname in ('checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done');
--     -- three rows, all true (the pre-flight refuses any other definition)
--
-- VERIFY AFTER APPLY:
--   select prosrc from pg_proc where oid = 'public.current_user_locations()'::regprocedure;   -- "and active"
--   select grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'current_user_locations' order by 1;   -- unchanged
--   select tablename, qual from pg_policies where schemaname = 'public' and cmd = 'SELECT'
--    and tablename in ('catering_quote_items', 'catering_order_items', 'catering_pipeline_events');
--     -- every qual contains ">= (5)" in front of its catering_*_loc(...) = ANY (current_user_locations()) arm
--   select proname, strpos(prosrc, 'location_id = v_instance.location_id and active for share') > 0 as active_only
--     from pg_proc where pronamespace = 'public'::regnamespace
--      and proname in ('checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done');  -- all true
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done');
--     -- service_role (+ postgres) only
--   Run scripts/sim/checklist-0287-lock-check.mjs on the sim (the lock order is unchanged; this re-proves it).
--   select action, resource_table, metadata->>'bug' from public.audit_log
--    where metadata->>'migration' = '0305_rls_membership_and_read_floors' order by 3;           -- one row per section
--
-- ROLLBACK: re-create current_user_locations() without `and active` (re-opens B009; prefer fixing forward);
--   ALTER the three child policies back to 0113 / 0120's quals (re-opens B010); re-run 0287's three
--   `create function` bodies as `create or replace` (re-opens B150).
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- C. B150 — checklist correction RPCs: an ACTIVE membership (0287 re-emitted, one line each)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare f regprocedure; v record;
begin
  if to_regprocedure('public.checklist_revoke_completion(uuid,uuid)') is null
     or to_regprocedure('public.checklist_revoke_with_reason(uuid,uuid,text,text)') is null
     or to_regprocedure('public.checklist_mark_not_done(uuid,uuid,text)') is null
     or to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0305: 0287 (the checklist correction RPCs) and 0228 must be applied first';
  end if;
  foreach f in array array[
    'public.checklist_revoke_completion(uuid,uuid)'::regprocedure,
    'public.checklist_revoke_with_reason(uuid,uuid,text,text)'::regprocedure,
    'public.checklist_mark_not_done(uuid,uuid,text)'::regprocedure
  ] loop
    select prosecdef, prosrc into v from pg_proc where oid = f;
    -- Only 0287's body is replaced: a later re-emission must be re-synced into this file, never clobbered.
    if v.prosecdef or strpos(v.prosrc, 'where user_id = p_actor and location_id = v_instance.location_id for share') = 0
       or strpos(v.prosrc, 'for no key update') = 0 then
      raise exception '0305: % is not 0287''s definition: re-sync section C before applying', f;
    end if;
  end loop;
end $$;

create or replace function public.checklist_revoke_completion(p_completion uuid, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed bigint;
begin
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  -- Reference/prep identity is immutable after insert; refuse before target lock.
  select * into v_completion from public.checklist_completions where id = p_completion;
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for no key update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- 0305 (B150): an ACTIVE membership only. 0287 kept parity with the then-unfiltered current_user_locations().
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id and active for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if v_completion.completed_by is distinct from p_actor then raise exception 'not_self'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := floor(extract(epoch from (v_at - v_completion.completed_at)) * 1000)::bigint;
  if v_elapsed >= 60000 then raise exception 'outside_quick_window'
    using detail = jsonb_build_object('elapsed_ms', v_elapsed)::text; end if;

  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = 'error_tap'
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create or replace function public.checklist_revoke_with_reason(p_completion uuid, p_actor uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed bigint; v_note text;
begin
  v_note := btrim(coalesce(p_note, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if p_reason is null or p_reason not in ('not_actually_done', 'other') then raise exception 'invalid_payload'; end if;
  if p_reason = 'other' and v_note = '' then raise exception 'revocation_note_required'; end if;
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  -- Reference/prep identity is immutable after insert; refuse before target lock.
  select * into v_completion from public.checklist_completions where id = p_completion;
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for no key update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- 0305 (B150): an ACTIVE membership only. 0287 kept parity with the then-unfiltered current_user_locations().
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id and active for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if v_completion.completed_by is distinct from p_actor then raise exception 'not_self'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := floor(extract(epoch from (v_at - v_completion.completed_at)) * 1000)::bigint;
  if v_elapsed < 60000 then raise exception 'use_quick_revoke'; end if;
  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = p_reason, revocation_note = case when p_reason = 'other' then v_note else null end
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create or replace function public.checklist_mark_not_done(p_completion uuid, p_actor uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed bigint; v_note text;
begin
  v_note := btrim(coalesce(p_note, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if v_note = '' then raise exception 'revocation_note_required'; end if;
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  -- Reference/prep identity is immutable after insert; refuse before target lock.
  select * into v_completion from public.checklist_completions where id = p_completion;
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for no key update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- 0305 (B150): an ACTIVE membership only. 0287 kept parity with the then-unfiltered current_user_locations().
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id and active for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if v_completion.completed_by = p_actor then raise exception 'use_self_revoke'; end if;
  if v_level < 4 then raise exception 'role_level_insufficient'
    using detail = jsonb_build_object('required', 4, 'actual', v_level)::text; end if;
  v_completer_level := public.assignment_author_level(v_completion.completed_by);
  if v_completer_level is null then raise exception 'completer_not_found'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := floor(extract(epoch from (v_at - v_completion.completed_at)) * 1000)::bigint;
  if v_elapsed < 60000 then raise exception 'use_quick_revoke'; end if;
  if v_level < v_completer_level then raise exception 'revoke_hierarchy_violation'
    using detail = jsonb_build_object('actor_level', v_level, 'completer_level', v_completer_level)::text; end if;
  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = 'not_actually_done', revocation_note = v_note
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

revoke all on function public.checklist_revoke_completion(uuid,uuid) from public, anon, authenticated;
grant execute on function public.checklist_revoke_completion(uuid,uuid) to service_role;
revoke all on function public.checklist_revoke_with_reason(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.checklist_revoke_with_reason(uuid,uuid,text,text) to service_role;
revoke all on function public.checklist_mark_not_done(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.checklist_mark_not_done(uuid,uuid,text) to service_role;

do $$
declare f regprocedure; v_src text;
begin
  foreach f in array array[
    'public.checklist_revoke_completion(uuid,uuid)'::regprocedure,
    'public.checklist_revoke_with_reason(uuid,uuid,text,text)'::regprocedure,
    'public.checklist_mark_not_done(uuid,uuid,text)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0305: RPC execution grant escaped on %', f;
    end if;
    if exists(select 1 from pg_proc where oid = f and (prosecdef or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0305: RPC execution context escaped on %', f;
    end if;
    select prosrc into v_src from pg_proc where oid = f;
    if strpos(v_src, 'where user_id = p_actor and location_id = v_instance.location_id and active for share') = 0
       or strpos(v_src, 'location_id = v_instance.location_id for share') > 0 then
      raise exception '0305: % does not require an active membership after apply', f;
    end if;
  end loop;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
values (null, null, 'security.grants_change', 'checklist_completions', null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0305_rls_membership_and_read_floors',
    'bug', 'B150',
    'functions', jsonb_build_array('checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done'),
    'change', 'below level 8 a correction requires an ACTIVE membership at the instance''s shop (0287 accepted an inactive row)'));

commit;
