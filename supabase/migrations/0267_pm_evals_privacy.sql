-- Migration 0267_pm_evals_privacy
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod; no code depends on it, so order is free).
-- Both PM tables are accessed only by service-role server loaders and writers.
-- Remove direct PostgREST access: self-read RLS cannot hide the manager-only note
-- column, and the old insert policies did not bind author_id/created_by to the JWT.
-- PRIVILEGE CEILING: service_role SELECT/INSERT/UPDATE only; no grants to PUBLIC,
-- anon or authenticated. RLS remains on with only no_user_update/no_user_delete
-- policies on each table. service_role must have BYPASSRLS for server writes.
-- WHO READS / WRITES: lib/pm-report.ts reads/writes both tables; lib/reports-hub.ts,
-- lib/reports-search.ts, lib/team-metrics.ts, lib/profiles.ts and lib/report-digests.ts
-- read them. lib/admin/week-card.ts, lib/assignment-taken.ts, lib/prep.ts,
-- lib/report-related.ts and lib/report-export.ts also read PM data via service_role.
-- PRE-FLIGHT (inspect live schema before apply; no database access from this clone):
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('pm_employee_evals', 'pm_reports') order by 1, 2, 3;
--   select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname in ('pm_employee_evals', 'pm_reports');
--   select tablename, policyname, cmd from pg_policies where schemaname = 'public'
--    and tablename in ('pm_employee_evals', 'pm_reports') order by 1, 2;
--   select schemaname, viewname from pg_views where schemaname = 'public'
--    and (definition ilike '%pm_employee_evals%' or definition ilike '%pm_reports%');
--   select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind in ('f', 'p')
--      and (pg_get_functiondef(p.oid) ilike '%pm_employee_evals%'
--        or pg_get_functiondef(p.oid) ilike '%pm_reports%');
--   select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'pm_%';
--   select rolname, rolbypassrls from pg_roles where rolname = 'service_role'; -- true
-- VERIFY AFTER APPLY:
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('pm_employee_evals', 'pm_reports') order by 1, 2, 3;
--     -- service_role INSERT/SELECT/UPDATE (+ owner); no anon/authenticated
--   select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname in ('pm_employee_evals', 'pm_reports'); -- both true
--   select tablename, policyname, cmd from pg_policies where schemaname = 'public'
--    and tablename in ('pm_employee_evals', 'pm_reports') order by 1, 2;
--     -- only each table's no_user_update and no_user_delete
--   select schemaname, viewname from pg_views where schemaname = 'public'
--    and (definition ilike '%pm_employee_evals%' or definition ilike '%pm_reports%'); -- inspect any rows
--   select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind in ('f', 'p')
--      and (pg_get_functiondef(p.oid) ilike '%pm_employee_evals%'
--      or pg_get_functiondef(p.oid) ilike '%pm_reports%'); -- inspect any rows
--   select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'pm_%'; -- 0 rows
--   select rolname, rolbypassrls from pg_roles where rolname = 'service_role'; -- true

begin;

drop policy if exists pm_evals_insert on public.pm_employee_evals;
drop policy if exists pm_evals_read_self on public.pm_employee_evals;
drop policy if exists pm_evals_read_mgr on public.pm_employee_evals;
drop policy if exists pm_reports_insert on public.pm_reports;
drop policy if exists pm_reports_read on public.pm_reports;

revoke all privileges on table public.pm_employee_evals from public, anon, authenticated, service_role;
revoke all privileges on table public.pm_reports from public, anon, authenticated, service_role;
grant select, insert, update on table public.pm_employee_evals to service_role;
grant select, insert, update on table public.pm_reports to service_role;

do $$
declare t text;
begin
  if not (select rolbypassrls from pg_roles where rolname = 'service_role') then
    raise exception '0267: service_role must bypass RLS';
  end if;
  foreach t in array array['pm_employee_evals', 'pm_reports'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '0267: RLS disabled on %', t;
    end if;
    if has_any_column_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_any_column_privilege('authenticated', format('public.%I', t), 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_table_privilege('anon', format('public.%I', t), 'DELETE, TRUNCATE, TRIGGER')
       or has_table_privilege('authenticated', format('public.%I', t), 'DELETE, TRUNCATE, TRIGGER') then
      raise exception '0267: PostgREST role can access %', t;
    end if;
    if not (has_table_privilege('service_role', format('public.%I', t), 'SELECT')
            and has_table_privilege('service_role', format('public.%I', t), 'INSERT')
            and has_table_privilege('service_role', format('public.%I', t), 'UPDATE'))
       or has_table_privilege('service_role', format('public.%I', t), 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception '0267: service_role outside SELECT/INSERT/UPDATE ceiling on %', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.pm_employee_evals', 'note', 'SELECT') then
    raise exception '0267: authenticated can select pm_employee_evals.note';
  end if;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
select null, null, 'security.grants_change', t, null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0267_pm_evals_privacy',
    'postgrest', 'no privileges', 'service_role', 'SELECT, INSERT, UPDATE')
from (values ('pm_employee_evals'), ('pm_reports')) as changed(t);

commit;
