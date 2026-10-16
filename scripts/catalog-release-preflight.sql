-- CC-operated, read-only release evidence. Run before 0264/0265 and again after
-- their approved apply. Missing pre-apply objects are reported, never inferred.
-- A nonzero cross-shop count pauses release for Juan; zero-only rows are disclosed.
-- No store-copy exception: every owned SKU participates in the count gate.
begin transaction read only;

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema='public' and
 ((table_name in ('recipes','menu_items','vendor_items','items') and column_name in ('location_id','request_id','request_owner_location_id'))
 or table_name in ('sku_swaps','sku_swap_ends')
 or (table_name='product_primaries' and column_name='revision'))
order by table_name,ordinal_position;

select wanted.name, count(p.oid)::integer as overloads_present
from (values ('create_catalog_sku'),('create_shop_recipe'),('create_shop_sandwich'),
 ('save_owned_recipe_version'),('share_catalog_entity'),('share_shop_sku'),('share_shop_recipe'),
 ('share_shop_menu_item'),('share_shop_item'),('start_sku_swap'),('end_sku_swap'),
 ('sku_swap_product_snapshot'),('sku_swap_recipe_snapshot'),('update_recipe_input_atomic'),
 ('catalog_share_snapshot'),('catalog_share_recipe_ids'),('write_owned_recipe'),('advance_product_primary_revision')) wanted(name)
left join pg_proc p on p.proname=wanted.name and p.pronamespace='public'::regnamespace
group by wanted.name order by wanted.name;

select p.oid::regprocedure::text as signature, p.prosecdef as security_definer, p.proconfig as settings,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p where p.pronamespace='public'::regnamespace and
 (p.proname like 'shop_owned_%' or p.proname in ('create_catalog_sku','create_shop_recipe','create_shop_sandwich',
 'save_owned_recipe_version','share_catalog_entity','share_shop_sku','share_shop_recipe','share_shop_menu_item','share_shop_item',
 'start_sku_swap','end_sku_swap','sku_swap_product_snapshot','sku_swap_recipe_snapshot','update_recipe_input_atomic',
 'catalog_share_snapshot','catalog_share_recipe_ids','write_owned_recipe','advance_product_primary_revision'))
order by signature;

select c.relname, c.relrowsecurity, roles.role, privileges.privilege,
 has_table_privilege(roles.role,c.oid,privileges.privilege) as allowed
from pg_class c cross join (values ('anon'),('authenticated'),('service_role')) roles(role)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(privilege)
where c.relnamespace='public'::regnamespace and c.relname in ('sku_swaps','sku_swap_ends')
order by c.relname,roles.role,privileges.privilege;

select c.conrelid::regclass::text as table_name, c.conname, c.contype, c.convalidated,
 pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.connamespace='public'::regnamespace and c.conrelid in
 (select oid from pg_class where relnamespace='public'::regnamespace and relname in
 ('vendor_items','products','product_primaries','recipe_versions','recipe_version_lines','sku_swaps','sku_swap_ends'))
order by table_name,c.conname;
select tablename,indexname,indexdef from pg_indexes where schemaname='public'
and tablename in ('vendor_items','products','product_primaries','recipe_versions','sku_swaps','sku_swap_ends') order by tablename,indexname;
select t.tgrelid::regclass::text as table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
from pg_trigger t where not t.tgisinternal and (t.tgname like 'shop_owned_%' or t.tgname='product_primaries_revision')
order by table_name,t.tgname;

-- Existing foreign-owned references: owner extraction works both before and after
-- 0264 adds recipes/menu_items.location_id. Historical global citations are disclosed.
with edges as (
 select 'recipe_inputs'::text surface,i.id,(to_jsonb(r)->>'location_id')::uuid scope,
 coalesce(s.location_id,it.location_id) owner
 from recipe_inputs i join recipes r on r.id=i.recipe_id
 left join vendor_items s on s.id=i.component_sku_id left join items it on it.id=i.component_item_id
 union all
 select 'recipe_version_lines',l.id,coalesce((to_jsonb(r)->>'location_id')::uuid,v.location_id),coalesce(s.location_id,it.location_id)
 from recipe_version_lines l join recipe_versions v on v.id=l.version_id join recipes r on r.id=v.recipe_id
 left join vendor_items s on s.id=l.component_sku_id left join items it on it.id=l.component_item_id where v.active
 union all
 select 'recipe_outputs',o.id,(to_jsonb(r)->>'location_id')::uuid,coalesce(it.location_id,(to_jsonb(m)->>'location_id')::uuid)
 from recipe_outputs o join recipes r on r.id=o.recipe_id left join items it on it.id=o.output_item_id
 left join menu_items m on m.id=o.output_menu_item_id
 union all
 select 'toast_menu_map',t.id,t.location_id,coalesce(s.location_id,it.location_id,(to_jsonb(m)->>'location_id')::uuid)
 from toast_menu_map t left join vendor_items s on s.id=t.sku_id left join items it on it.id=t.item_id
 left join menu_items m on m.id=t.menu_item_id where t.active
 union all
 select 'toast_map_effects',e.id,t.location_id,coalesce(s.location_id,it.location_id,(to_jsonb(m)->>'location_id')::uuid)
 from toast_map_effects e join toast_menu_map t on t.id=e.map_id left join vendor_items s on s.id=e.sku_id
 left join items it on it.id=e.item_id left join menu_items m on m.id=e.menu_item_id where e.active and t.active
 union all
 select 'toast_open_item_aliases',a.id,a.location_id,coalesce(it.location_id,(to_jsonb(m)->>'location_id')::uuid)
 from toast_open_item_aliases a left join items it on it.id=a.item_id left join menu_items m on m.id=a.menu_item_id where a.active
 union all
 select 'product_primaries',p.id,p.location_id,s.location_id from product_primaries p join vendor_items s on s.id=p.primary_sku_id
)
select surface,scope,owner,count(*)::integer as foreign_owned_references
from edges where owner is not null and owner is distinct from scope group by surface,scope,owner order by surface,scope,owner;

-- All events in the last 30 days, including superseded events. Do not silently
-- limit this to current heads or exclude store copies. IDs/aggregates only.
with foreign_counts as (
 select l.qty,l.resolved_oz
 from public.sku_count_lines l join public.sku_count_events e on e.id=l.count_event_id
 join public.vendor_items s on s.id=l.sku_id
 where e.counted_at >= now()-interval '30 days' and s.location_id is not null
 and s.location_id is distinct from e.location_id
)
select count(*)::integer as cross_shop_count_rows,
 count(*) filter (where qty>0 or resolved_oz>0)::integer as nonzero_cross_shop_count_rows,
 count(*) filter (where qty>0 or resolved_oz>0)>0 as blocking_nonzero_count_gate
from foreign_counts;
rollback;
