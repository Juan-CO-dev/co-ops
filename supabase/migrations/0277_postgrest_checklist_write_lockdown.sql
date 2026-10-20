-- Migration 0277_postgrest_checklist_write_lockdown
-- AUTHORED 2026-10-19. FILE ONLY; NOT APPLIED. CC review -> sim -> prod on Juan's word.
-- Apply AFTER 0276 and the reviewed app cutover. No service_role ceiling (R4):
-- the 0276 SECURITY INVOKER functions depend on service_role retaining table DML.
-- Preserve all SELECT grants/policies and explicit false policies. This migration
-- closes only PUBLIC/anon/authenticated direct writes on these five tables.
-- Audit follows 0272 per table, plus one migration summary using the same action.
begin;

create temporary table lockdown_0277 (table_name text primary key, drop_policies text[] not null) on commit drop;
insert into lockdown_0277 values
  ('checklist_instances', array['checklist_instances_insert','checklist_instances_insert_closing_staff','checklist_instances_update']),
  ('checklist_completions', array['checklist_completions_insert','checklist_completions_insert_closing_staff']),
  ('checklist_submissions', array['checklist_submissions_insert']),
  ('checklist_incomplete_reasons', array['checklist_incomplete_reasons_insert']),
  ('written_reports', array['written_reports_insert','written_reports_update_self']);

-- Catalog ACL expansion includes PUBLIC and every grantee, grantor and grant option,
-- including column-only SELECT grants (information_schema role views omit PUBLIC).
-- The same view is evaluated before and after, comparing canonical JSON byte-for-byte.
create temporary view lockdown_0277_read_surface as
select m.table_name,
  jsonb_build_object(
    'policies', (select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname), '[]'::jsonb)
      from pg_policies p where p.schemaname = 'public' and p.tablename = m.table_name and p.cmd in ('SELECT','ALL')),
    'table_acl', (select coalesce(jsonb_agg(to_jsonb(a) order by a.grantor, a.grantee, a.privilege_type, a.is_grantable), '[]'::jsonb)
      from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.privilege_type = 'SELECT'),
    'column_acl', (select coalesce(jsonb_agg(jsonb_build_object('column', col.attname, 'acl', to_jsonb(a))
        order by col.attnum, a.grantor, a.grantee, a.privilege_type, a.is_grantable), '[]'::jsonb)
      from pg_attribute col cross join lateral aclexplode(col.attacl) a
      where col.attrelid = c.oid and col.attnum > 0 and not col.attisdropped and a.privilege_type = 'SELECT')
  )::text as snapshot
from lockdown_0277 m join pg_class c on c.oid = format('public.%I', m.table_name)::regclass;
create temporary table lockdown_0277_reads on commit drop as select * from lockdown_0277_read_surface;

-- Save the wider service-role rights too: there is no tightening of this role.
create temporary table lockdown_0277_service on commit drop as
select table_name, privilege, has_table_privilege('service_role', format('public.%I', table_name), privilege) as allowed
from lockdown_0277 cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege;

do $$
declare r record; p text; c record;
begin
  if (select count(*) from lockdown_0277) <> 5 then raise exception '0277: manifest must contain 5 tables'; end if;
  for r in select * from lockdown_0277 loop
    foreach p in array r.drop_policies loop
      execute format('drop policy if exists %I on public.%I', p, r.table_name);
    end loop;
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from public, anon, authenticated', r.table_name);
    -- Only INSERT/UPDATE/REFERENCES support column privileges in PostgreSQL.
    for c in select attname from pg_attribute where attrelid = format('public.%I', r.table_name)::regclass
      and attnum > 0 and not attisdropped loop
      execute format('revoke insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated', c.attname, r.table_name);
    end loop;
  end loop;
end $$;

-- ASSERTIONS: mutation harness injects escaped grants/policies immediately above.
do $$
declare r record; role_name text; obj text; signature text; f regprocedure;
begin
  if not coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) then
    raise exception '0277: service_role must bypass RLS';
  end if;
  foreach signature in array array[
    'public.checklist_actor_level(uuid,uuid)',
    'public.assignment_author_level(uuid)',
    'public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)',
    'public.checklist_submit_batch(uuid,uuid,uuid[])',
    'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])',
    'public.written_report_update_self(uuid,uuid,text,text,text,integer)'
  ] loop
    f := to_regprocedure(signature);
    if f is null then raise exception '0277: required 0276 function missing: %', signature; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0277: service_role lacks EXECUTE on %', signature;
    end if;
  end loop;
  -- PostgreSQL ARE uses \y for a word boundary (\b means backspace).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(checklist_(instances|completions|submissions|incomplete_reasons)|written_reports)\y'
  ) then
    raise exception '0277: PostgREST-callable definer writer remains';
  end if;
  for r in select * from lockdown_0277 loop
    obj := format('public.%I', r.table_name);
    if not (select relrowsecurity from pg_class where oid = obj::regclass) then
      raise exception '0277: RLS disabled on %', r.table_name;
    end if;
    if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.table_name
      and p.permissive = 'PERMISSIVE' and p.cmd in ('INSERT','UPDATE','DELETE','ALL')
      and ( 'public' = any(p.roles) or exists(select 1 from unnest(p.roles) policy_role
        where policy_role <> 'public' and (pg_has_role('anon', policy_role, 'MEMBER') or pg_has_role('authenticated', policy_role, 'MEMBER'))))
      and (case when p.cmd = 'INSERT' then coalesce(p.with_check, 'true') <> 'false'
                when p.cmd = 'DELETE' then coalesce(p.qual, 'true') <> 'false'
                else coalesce(p.qual, 'true') <> 'false' or coalesce(p.with_check, p.qual, 'true') <> 'false' end)) then
      raise exception '0277: permissive write policy remains on %', r.table_name;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name, obj, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        or has_any_column_privilege(role_name, obj, 'INSERT, UPDATE, REFERENCES') then
        raise exception '0277: PostgREST write grant remains on % for %', r.table_name, role_name;
      end if;
    end loop;
    -- Effective checks include privileges inherited from PUBLIC at both ACL levels.
    if not (has_table_privilege('service_role', obj, 'SELECT') and has_table_privilege('service_role', obj, 'INSERT')
      and has_table_privilege('service_role', obj, 'UPDATE')) or exists (
        select 1 from lockdown_0277_service b where b.table_name = r.table_name
          and b.allowed is distinct from has_table_privilege('service_role', obj, b.privilege)) then
      raise exception '0277: service_role DML changed on %', r.table_name;
    end if;
    if (select snapshot from lockdown_0277_reads where table_name = r.table_name) is distinct from
      (select snapshot from lockdown_0277_read_surface where table_name = r.table_name) then
      raise exception '0277: SELECT surface changed on %', r.table_name;
    end if;
  end loop;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
select null, null, 'security.grants_change', table_name, null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0277_postgrest_checklist_write_lockdown')
from lockdown_0277;
insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
select null, null, 'security.grants_change', 'schema_migrations', null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0277_postgrest_checklist_write_lockdown',
    'scope', 'checklist PostgREST direct-write lockdown',
    'affected_tables', jsonb_agg(table_name order by table_name))
from lockdown_0277;
-- Temporary views have no ON COMMIT DROP and must not depend on the dropped manifest.
drop view lockdown_0277_read_surface;
commit;
