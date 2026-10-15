-- Migration 0267_pm_evals_privacy
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review
-- Both PM tables are accessed only by service-role server loaders and writers.
-- Remove direct PostgREST access: self-read RLS cannot hide the manager-only note
-- column, and the old insert policies did not bind author_id/created_by to the JWT.

begin;

drop policy if exists pm_evals_insert on public.pm_employee_evals;
drop policy if exists pm_reports_insert on public.pm_reports;

revoke all privileges on table public.pm_employee_evals from public, anon, authenticated, service_role;
revoke all privileges on table public.pm_reports from public, anon, authenticated, service_role;
grant select, insert, update on table public.pm_employee_evals to service_role;
grant select, insert, update on table public.pm_reports to service_role;

do $$
declare t text;
begin
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
values (null, null, 'security.grants_change', 'pm_employee_evals', null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0267_pm_evals_privacy',
    'tables', jsonb_build_array('pm_employee_evals', 'pm_reports'),
    'postgrest', 'no privileges', 'service_role', 'SELECT, INSERT, UPDATE'));

commit;
