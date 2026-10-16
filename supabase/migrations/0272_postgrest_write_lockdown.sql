-- Migration 0272_postgrest_write_lockdown
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod; no code depends on it).
-- The staff JWT is a valid PostgREST bearer. Astra's audit found no user-context
-- writer on these 42 tables; direct writes must therefore be closed at the DB.
-- Manifest by risk:
-- auth / catalog / integrations: announcement_acknowledgements, announcements,
--   locations, notification_recipients, par_levels, position_responsibilities,
--   positions, recipe_ingredients, recipe_steps, training_modules, training_progress,
--   user_locations, user_notification_prefs, vendor_items, vendors.
-- cash / receiving / catering money: cash_reports, catering_customers,
--   catering_order_items, catering_orders, catering_pipeline,
--   catering_pipeline_events, catering_quote_items, catering_quotes,
--   customer_feedback, report_photos, report_views, shift_overlay_corrections,
--   shift_overlays, tip_pool_distributions, tip_pools, vendor_deliveries,
--   vendor_orders.
-- checklist templates and content: checklist_template_items, checklist_templates,
--   deep_clean_assignments, deep_clean_tasks, opening_setup_items,
--   opening_setup_verifications.
-- dormant: lto_performance, maintenance_notes, maintenance_tickets, training_reports.
-- EXCLUDED STEP 2: checklist_instances, checklist_completions,
--   checklist_submissions, checklist_incomplete_reasons, written_reports.
-- PRE-FLIGHT (run read-only against live schema before applying):
--   select tablename, policyname, cmd, qual, with_check from pg_policies
--     where schemaname = 'public' order by tablename, policyname;
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--     where table_schema = 'public' order by table_name, grantee, privilege_type;
--   select table_name, column_name, grantee, privilege_type
--     from information_schema.column_privileges where table_schema = 'public'
--     order by table_name, column_name, grantee;
--   select rolname, rolbypassrls from pg_roles where rolname = 'service_role';
-- VERIFY AFTER APPLY: rerun the above queries; the 42 tables have no permissive
--   write policy or PostgREST write grant, retain all SELECT grants/policies,
--   and have exactly one security.grants_change audit row each for this migration.

begin;

create temporary table lockdown_0272 (table_name text primary key, drop_policies text[] not null) on commit drop;
insert into lockdown_0272 values
  ('announcement_acknowledgements', array['announcement_acks_insert']),
  ('announcements', array['announcements_insert','announcements_update']),
  ('cash_reports', array['cash_reports_insert']),
  ('catering_customers', array['catering_customers_insert','catering_customers_update']),
  ('catering_order_items', array['catering_order_items_insert']),
  ('catering_orders', array['catering_orders_insert','catering_orders_update']),
  ('catering_pipeline', array['catering_pipeline_insert','catering_pipeline_update']),
  ('catering_pipeline_events', array['catering_pipeline_events_insert']),
  ('catering_quote_items', array['catering_quote_items_insert']),
  ('catering_quotes', array['catering_quotes_insert']),
  ('checklist_template_items', array['checklist_template_items_insert','checklist_template_items_update']),
  ('checklist_templates', array['checklist_templates_insert','checklist_templates_update']),
  ('customer_feedback', array['customer_feedback_insert','customer_feedback_update']),
  ('deep_clean_assignments', array['deep_clean_assignments_insert','deep_clean_assignments_update']),
  ('deep_clean_tasks', array['deep_clean_tasks_insert','deep_clean_tasks_update']),
  ('locations', array['locations_insert','locations_update']),
  ('lto_performance', array['lto_performance_insert','lto_performance_update']),
  ('maintenance_notes', array['maintenance_notes_insert']),
  ('maintenance_tickets', array['maintenance_tickets_insert','maintenance_tickets_update']),
  ('notification_recipients', array['notification_recipients_update_self']),
  ('opening_setup_items', array['opening_setup_items_insert_policy']),
  ('opening_setup_verifications', array['opening_setup_verifications_insert_policy']),
  ('par_levels', array['par_levels_insert','par_levels_update']),
  ('position_responsibilities', array['position_responsibilities_insert','position_responsibilities_update']),
  ('positions', array['positions_insert','positions_update']),
  ('recipe_ingredients', array['recipe_ingredients_insert','recipe_ingredients_update']),
  ('recipe_steps', array['recipe_steps_insert','recipe_steps_update']),
  ('report_photos', array['report_photos_insert']),
  ('report_views', array['report_views_insert']),
  ('shift_overlay_corrections', array['shift_overlay_corrections_insert']),
  ('shift_overlays', array['shift_overlays_insert','shift_overlays_update_self']),
  ('tip_pool_distributions', array['tip_pool_distributions_insert','tip_pool_distributions_update']),
  ('tip_pools', array['tip_pools_insert','tip_pools_update']),
  ('training_modules', array['training_modules_insert','training_modules_update']),
  ('training_progress', array['training_progress_insert','training_progress_update']),
  ('training_reports', array['training_reports_insert','training_reports_update']),
  ('user_locations', array['user_locations_insert','user_locations_update']),
  ('user_notification_prefs', array['user_notification_prefs_insert','user_notification_prefs_update']),
  ('vendor_deliveries', array['vendor_deliveries_insert','vendor_deliveries_update']),
  ('vendor_items', array['vendor_items_insert','vendor_items_update']),
  ('vendor_orders', array['vendor_orders_insert','vendor_orders_update']),
  ('vendors', array['vendors_insert','vendors_update_trivial']);

-- Preserve the exact pre-migration authenticated read surface for the 42 tables.
create temporary table lockdown_0272_reads on commit drop as
select table_name, has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') as allowed
from lockdown_0272;

do $$
declare r record; p text; c record;
begin
  if (select count(*) from lockdown_0272) <> 42 then
    raise exception '0272: manifest must contain 42 tables';
  end if;
  for r in select * from lockdown_0272 loop
    foreach p in array r.drop_policies loop
      execute format('drop policy if exists %I on public.%I', p, r.table_name);
    end loop;
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from public, anon, authenticated', r.table_name);
    -- Table REVOKE does not remove column ACLs. Revoke every column explicitly.
    for c in select attname from pg_attribute
      where attrelid = format('public.%I', r.table_name)::regclass
        and attnum > 0 and not attisdropped loop
      execute format('revoke insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated', c.attname, r.table_name);
    end loop;
  end loop;
end $$;

create policy opening_setup_items_no_user_insert on public.opening_setup_items
  for insert with check (false);
create policy opening_setup_verifications_no_user_insert on public.opening_setup_verifications
  for insert with check (false);
create policy opening_setup_verifications_no_user_update on public.opening_setup_verifications
  for update using (false) with check (false);
create policy opening_setup_verifications_no_user_delete on public.opening_setup_verifications
  for delete using (false);

do $$
declare r record; role_name text; obj text; f record;
begin
  if (select count(*) from lockdown_0272) <> 42 then
    raise exception '0272: manifest must contain 42 tables';
  end if;
  if not coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) then
    raise exception '0272: service_role must bypass RLS';
  end if;
  for r in select * from lockdown_0272 loop
    obj := format('public.%I', r.table_name);
    if not (select relrowsecurity from pg_class where oid = obj::regclass) then
      raise exception '0272: RLS disabled on %', r.table_name;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = r.table_name and permissive = 'PERMISSIVE'
      and cmd in ('INSERT','UPDATE','ALL')
      and (case when cmd = 'INSERT' then coalesce(with_check, 'true') <> 'false'
                else coalesce(qual, 'true') <> 'false'
                  or coalesce(with_check, qual, 'true') <> 'false' end)) then
      raise exception '0272: permissive write policy remains on %', r.table_name;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_any_column_privilege(role_name, obj, 'INSERT, UPDATE, REFERENCES')
         or has_table_privilege(role_name, obj, 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
        raise exception '0272: PostgREST write grant remains on % for %', r.table_name, role_name;
      end if;
    end loop;
    -- PUBLIC grants flow into both PostgREST roles, so the effective checks
    -- above also prove that PUBLIC has no write privilege at either level.
    if not (has_table_privilege('service_role', obj, 'SELECT')
      and has_table_privilege('service_role', obj, 'INSERT')
      and has_table_privilege('service_role', obj, 'UPDATE')) then
      -- service_role's wider rights (DELETE/TRUNCATE/…) are deliberately out of scope here:
      -- this migration only closes the PostgREST roles; tightening service_role is its own change.
      raise exception '0272: service_role lacks SELECT/INSERT/UPDATE on %', r.table_name;
    end if;
    -- DELETE is intentionally outside this ceiling: existing service paths may use it.
    if exists (select 1 from lockdown_0272_reads b where b.table_name = r.table_name
      and b.allowed and not has_table_privilege('authenticated', obj, 'SELECT')) then
      raise exception '0272: authenticated SELECT lost on %', r.table_name;
    end if;
    for f in select p.oid, format('%I.%I(%s)', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid)) as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prosrc ~* ('(^|[^a-z0-9_])' || r.table_name || '([^a-z0-9_]|$)')
        and p.prosrc ~* '(^|[^a-z0-9_])(insert|update)([^a-z0-9_]|$)' loop
      if has_function_privilege('anon', f.oid, 'EXECUTE')
        or has_function_privilege('authenticated', f.oid, 'EXECUTE')
        or exists (select 1 from aclexplode(coalesce((select proacl from pg_proc where oid = f.oid),
          acldefault('f', (select proowner from pg_proc where oid = f.oid)))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') then
        raise exception '0272: definer writer executable by PostgREST on %: %', r.table_name, f.signature;
      end if;
    end loop;
  end loop;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
select null, null, 'security.grants_change', table_name, null, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0272_postgrest_write_lockdown')
from lockdown_0272;

commit;
