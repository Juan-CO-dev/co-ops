-- 0265_sku_swaps.sql
-- AUTHORED 2026-10-16; FILE ONLY. Apply only after CC/Juan review.
-- APPLIED TO SIM 2026-10-16 (schema_migrations version 20261016104417, name 'sku_swaps')
-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016113105, name 'sku_swaps')
-- Authority is app-layer; SQL binds the preview, scope and graph integrity.
begin;
alter table public.product_primaries add column revision bigint not null default 0;
create function public.advance_product_primary_revision() returns trigger language plpgsql
set search_path = pg_catalog, public as $$ begin new.revision := old.revision + 1; return new; end $$;
create trigger product_primaries_revision before update on public.product_primaries
for each row execute function public.advance_product_primary_revision();
revoke all on function public.advance_product_primary_revision() from public, anon, authenticated, service_role;

create table public.sku_swaps (
 id uuid primary key default gen_random_uuid(), old_sku_id uuid not null references public.vendor_items(id),
 new_sku_id uuid not null references public.vendor_items(id), location_id uuid references public.locations(id),
 product_id uuid not null references public.products(id), temporary boolean not null,
 product_snapshot_before jsonb not null, product_snapshot_after jsonb not null, primary_before jsonb not null, primary_after jsonb not null,
 recipes jsonb not null, grouping_created boolean not null, default_created jsonb,
 note text, created_by uuid not null references public.users(id), created_at timestamptz not null default now()
);
create table public.sku_swap_ends (
 id uuid primary key default gen_random_uuid(), swap_id uuid not null unique references public.sku_swaps(id),
 outcome jsonb not null, created_by uuid not null references public.users(id), created_at timestamptz not null default now()
);
alter table public.sku_swaps enable row level security;
alter table public.sku_swap_ends enable row level security;
create policy sku_swaps_no_user_delete on public.sku_swaps for delete using(false);
create policy sku_swap_ends_no_user_delete on public.sku_swap_ends for delete using(false);
revoke all on public.sku_swaps, public.sku_swap_ends from public,anon,authenticated,service_role;
grant select on public.sku_swaps,public.sku_swap_ends to service_role;

create function public.sku_swap_product_snapshot(p_old uuid,p_new uuid,p_location uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog,public as $$
 with pid as (select coalesce((select product_id from public.vendor_items where id=p_old),
 (select product_id from public.vendor_items where id=p_new)) id)
 select jsonb_build_object('old_sku',(select to_jsonb(s) from public.vendor_items s where id=p_old),
 'new_sku',(select to_jsonb(s) from public.vendor_items s where id=p_new),
 'product',(select to_jsonb(p) from public.products p where id=pid.id),
 'scoped_primary',(select to_jsonb(p) from public.product_primaries p where product_id=pid.id and location_id is not distinct from p_location),
 'default_primary',(select to_jsonb(p) from public.product_primaries p where product_id=pid.id and location_id is null),
 'members',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.vendor_items s where product_id=pid.id),'[]'::jsonb),
 'settings',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.location_sku_settings s where (sku_id in(p_old,p_new) or sku_id in(select id from public.vendor_items where product_id=pid.id)) and location_id is not distinct from p_location),'[]'::jsonb),
 'vendors',coalesce((select jsonb_agg(to_jsonb(v) order by id) from public.vendors v where id in(select vendor_id from public.vendor_items where id in(p_old,p_new) or product_id=pid.id)),'[]'::jsonb),
 'receipts',coalesce((select jsonb_agg(jsonb_build_object('item',to_jsonb(di),'delivery',to_jsonb(d),'vendor',to_jsonb(v)) order by di.id)
 from public.vendor_delivery_items di join public.vendor_deliveries d on d.id=di.delivery_id
 join public.vendors v on v.id=d.vendor_id where (di.vendor_item_id in(p_old,p_new) or di.vendor_item_id in(select id from public.vendor_items where product_id=pid.id))
 and (p_location is null or d.location_id=p_location)),'[]'::jsonb),
 'packs',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.sku_pack_versions x where sku_id in(p_old,p_new) and (location_id is null or location_id=p_location)),'[]'::jsonb),
 'pack_levels',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.sku_pack_levels x where sku_id in(p_old,p_new) and (location_id is null or location_id=p_location)),'[]'::jsonb),
 'price_lanes',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.sku_price_lanes x where sku_id in(p_old,p_new) and location_id=p_location),'[]'::jsonb),
 'prices',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.vendor_price_history x where vendor_item_id in(p_old,p_new) and (location_id is null or location_id=p_location)),'[]'::jsonb),
 'measures',coalesce((select jsonb_agg(to_jsonb(x) order by label) from public.measure_units x),'[]'::jsonb),
 'location',(select to_jsonb(l) from public.locations l where id=p_location)) from pid;
$$;

create function public.sku_swap_recipe_snapshot(p_old uuid,p_new uuid,p_location uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog,public as $$
 with pid as (select coalesce((select product_id from public.vendor_items where id=p_old),(select product_id from public.vendor_items where id=p_new)) id),
 affected as (select distinct l.line_recipe_id id from public.recipe_scope_lines(p_location) l, pid
 join public.products p on p.id=pid.id and p.active
 where l.line_sku_id=p_old or l.line_product_id=pid.id
 union select distinct line_recipe_id from public.recipe_scope_lines(p_location) where line_sku_id=p_old),
 heads as (select r.id, case when r.location_id is not null then null else p_location end write_scope, (select id from public.recipe_versions v where v.recipe_id=r.id and v.location_id is not distinct from (case when r.location_id is not null then null else p_location end) and active) own,
 (select id from public.recipe_versions v where v.recipe_id=r.id and (v.location_id is null or v.location_id=p_location) and active order by v.location_id nulls last limit 1) resolved
 from public.recipes r join affected a on a.id=r.id where r.active and (r.location_id is null or r.location_id=p_location)),
 data as (select h.*,coalesce((select jsonb_agg(jsonb_build_object('component_sku_id',l.component_sku_id,'component_item_id',l.component_item_id,
 'component_product_id',l.component_product_id,'quantity',l.quantity,'unit',l.unit,'each_container_label',l.each_container_label,'portioned',l.portioned) order by l.display_order,l.id)
 from public.recipe_version_lines l where l.version_id=h.resolved),'[]'::jsonb) lines from heads h)
 select coalesce(jsonb_agg(jsonb_build_object('recipe_id',id,'write_scope',write_scope,'version_id',resolved,'own_version_id',own,'lines',lines,
 'snapshot',public.recipe_change_snapshot(id,write_scope,lines)) order by id),'[]'::jsonb) from data;
$$;

create function public.start_sku_swap(p_old uuid,p_new uuid,p_location uuid,p_actor uuid,p_product_snapshot jsonb,
 p_recipes jsonb,p_temporary boolean,p_note text,p_product jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog,public as $$
declare
 v_old public.vendor_items%rowtype; v_new public.vendor_items%rowtype; v_product uuid; v_created boolean:=false;
 v_before jsonb; v_after jsonb; v_default jsonb; v_recipe jsonb; v_saved jsonb; v_results jsonb:='[]';
 v_constraint text; v_journal jsonb:='[]'; v_live jsonb; v_expected jsonb; v_id uuid:=gen_random_uuid();
begin
 if p_product_snapshot is null or jsonb_typeof(p_product_snapshot)<>'object' or p_recipes is null or jsonb_typeof(p_recipes)<>'array'
 or (p_temporary and p_location is null) or p_old is null or p_new is null or p_old=p_new or p_actor is null or p_temporary is null then raise exception 'swap:invalid_payload' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(7258025800);
 if exists(select 1 from public.sku_swaps s where s.temporary and s.location_id is not distinct from p_location
  and (s.old_sku_id in(p_old,p_new) or s.new_sku_id in(p_old,p_new))
  and not exists(select 1 from public.sku_swap_ends e where e.swap_id=s.id)) then raise exception 'swap:already_swapped' using errcode='P0001'; end if;
 perform 1 from public.measure_units order by label for share nowait;
 -- Product writers do not take the graph lock. NOWAIT prevents lock inversion.
 perform 1 from public.products where id in(select product_id from public.vendor_items where id in(p_old,p_new)) order by id for update nowait;
 perform 1 from public.product_primaries where product_id in(select product_id from public.vendor_items where id in(p_old,p_new)) order by id for update nowait;
 perform 1 from public.vendor_items where id in(p_old,p_new) or product_id in(select product_id from public.vendor_items where id in(p_old,p_new)) order by id for update nowait;
 perform 1 from public.locations where id=p_location for share nowait;
 perform 1 from public.vendors where id in(select vendor_id from public.vendor_items where id in(p_old,p_new) or product_id in(select product_id from public.vendor_items where id in(p_old,p_new))) order by id for share nowait;
 perform 1 from public.location_sku_settings where (sku_id in(p_old,p_new) or sku_id in(select id from public.vendor_items where product_id in(select product_id from public.vendor_items where id in(p_old,p_new)))) and location_id=p_location order by id for update nowait;
 if public.sku_swap_product_snapshot(p_old,p_new,p_location) is distinct from p_product_snapshot then raise exception 'swap:product_changed' using errcode='P0001'; end if;
 select * into v_old from public.vendor_items where id=p_old;
 select * into v_new from public.vendor_items where id=p_new;
 if v_old.id is null or v_new.id is null or not v_old.active or not v_new.active
 or (v_old.location_id is not null and v_old.location_id is distinct from p_location)
 or (v_new.location_id is not null and v_new.location_id is distinct from p_location)
 or (p_location is not null and not exists(select 1 from public.locations where id=p_location and active))
 or exists(select 1 from public.vendors where id=v_new.vendor_id and not active)
 or exists(select 1 from public.location_sku_settings where sku_id=p_new and location_id=p_location and active_override=false)
 then raise exception 'swap:replacement_ineligible' using errcode='P0001'; end if;
 if v_old.product_id is not null and v_new.product_id is not null and v_old.product_id<>v_new.product_id then raise exception 'swap:in_other_product' using errcode='P0001'; end if;
 for v_recipe in select value from jsonb_array_elements(p_recipes) loop
  perform public.recipe_change_lock((v_recipe->>'recipe_id')::uuid,(v_recipe->>'write_scope')::uuid,(v_recipe->'lines') || coalesce(v_recipe->'replacement_lines','[]'::jsonb));
 end loop;
 v_live:=public.sku_swap_recipe_snapshot(p_old,p_new,p_location);
 select coalesce(jsonb_agg(value-'replacement_lines' order by value->>'recipe_id'),'[]'::jsonb) into v_expected from jsonb_array_elements(p_recipes);
 if v_live is distinct from v_expected then raise exception 'swap:recipes_changed' using errcode='P0001'; end if;
 v_product:=coalesce(v_old.product_id,v_new.product_id);
 if v_product is null then
  insert into public.products(name,name_es,created_by,updated_by) values(coalesce(nullif(p_product->>'name',''),v_old.name),p_product->>'name_es',p_actor,p_actor) returning id into v_product;
  v_created:=true;
 elsif not exists(select 1 from public.products where id=v_product and active) then raise exception 'swap:replacement_ineligible' using errcode='P0001'; end if;
 v_before:=coalesce((select to_jsonb(p) from public.product_primaries p where product_id=v_product and location_id is not distinct from p_location),'null'::jsonb);
 update public.vendor_items set product_id=v_product where id in(p_old,p_new) and product_id is null;
 if p_location is not null and not exists(select 1 from public.product_primaries where product_id=v_product and location_id is null) then
  insert into public.product_primaries(product_id,primary_sku_id,updated_by) values(v_product,p_old,p_actor) returning to_jsonb(product_primaries) into v_default;
 end if;
 insert into public.product_primaries(product_id,location_id,primary_sku_id,note,updated_by)
 values(v_product,p_location,p_new,p_note,p_actor) on conflict(product_id,location_id) do update set primary_sku_id=excluded.primary_sku_id,note=excluded.note,updated_by=excluded.updated_by,updated_at=clock_timestamp()
 returning to_jsonb(product_primaries) into v_after;
 for v_recipe in select value from jsonb_array_elements(p_recipes) loop
  if jsonb_typeof(v_recipe->'replacement_lines') is distinct from 'array' then raise exception 'swap:invalid_payload' using errcode='P0001'; end if;
  if v_recipe->'lines'=v_recipe->'replacement_lines' then
   v_journal:=v_journal||jsonb_build_array(v_recipe||jsonb_build_object('unchanged',true,'after_version_id',v_recipe->>'own_version_id'));
   continue;
  end if;
  v_saved:=public.save_recipe_version((v_recipe->>'recipe_id')::uuid,(v_recipe->>'write_scope')::uuid,v_recipe->'replacement_lines',
   (v_recipe->>'own_version_id')::uuid,case when v_recipe->>'own_version_id' is null then (v_recipe->>'version_id')::uuid else null end,
   p_note,p_actor,null,null,null,public.recipe_change_snapshot((v_recipe->>'recipe_id')::uuid,(v_recipe->>'write_scope')::uuid,v_recipe->'replacement_lines'));
  v_results:=v_results||jsonb_build_array(jsonb_build_object('recipe_id',v_recipe->>'recipe_id','version_id',v_saved->>'version_id'));
  v_journal:=v_journal||jsonb_build_array(v_recipe||jsonb_build_object('after_version_id',v_saved->>'version_id'));
 end loop;
 insert into public.sku_swaps(id,old_sku_id,new_sku_id,location_id,product_id,temporary,product_snapshot_before,product_snapshot_after,primary_before,primary_after,recipes,grouping_created,default_created,note,created_by)
 values(v_id,p_old,p_new,p_location,v_product,p_temporary,p_product_snapshot,public.sku_swap_product_snapshot(p_old,p_new,p_location),v_before,v_after,v_journal,v_created,v_default,p_note,p_actor);
 return jsonb_build_object('swap_id',v_id,'product_id',v_product,'recipes',v_results);
exception when lock_not_available then raise exception 'swap:dependencies_busy' using errcode='P0001';
 when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'products_name_lower_uq' then raise exception 'swap:product_name_taken' using errcode='P0001'; end if;
  raise;
 when invalid_text_representation or numeric_value_out_of_range then raise exception 'swap:invalid_payload' using errcode='P0001';
end $$;

create function public.end_sku_swap(p_swap uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 s public.sku_swaps%rowtype; r jsonb; v_current uuid; v_default uuid; v_result jsonb;
 v_recipes jsonb:='[]'; v_primary text:='changed_since'; v_grouping text:='unchanged'; v_p jsonb;
 v_before jsonb; v_line jsonb; v_sku uuid;
begin
 if p_swap is null or p_actor is null then raise exception 'swap:invalid_payload' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(7258025800);
 select * into s from public.sku_swaps where id=p_swap for update;
 if not found then raise exception 'swap:not_found' using errcode='P0001'; end if;
 if exists(select 1 from public.sku_swap_ends where swap_id=p_swap) then raise exception 'swap:not_live' using errcode='P0001'; end if;
 if not s.temporary then raise exception 'swap:not_temporary' using errcode='P0001'; end if;
 perform 1 from public.products where id=s.product_id for update nowait;
 perform 1 from public.product_primaries where product_id=s.product_id order by id for update nowait;
 perform 1 from public.vendor_items where product_id=s.product_id or id in(s.old_sku_id,s.new_sku_id) order by id for update nowait;
 for r in select value from jsonb_array_elements(s.recipes) loop
  perform public.recipe_change_lock((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,r->'lines');
 end loop;
 for r in select value from jsonb_array_elements(s.recipes) loop
  if coalesce((r->>'unchanged')::boolean,false) then continue; end if;
  select id into v_current from public.recipe_versions where recipe_id=(r->>'recipe_id')::uuid and location_id is not distinct from (r->>'write_scope')::uuid and active;
  if v_current is distinct from (r->>'after_version_id')::uuid then
   v_recipes:=v_recipes||jsonb_build_array(jsonb_build_object('recipe_id',r->>'recipe_id','outcome','changed_since'));
   continue;
  end if;
  select id into v_default from public.recipe_versions where recipe_id=(r->>'recipe_id')::uuid and location_id is null and active;
  if r->>'write_scope' is not null and r->>'own_version_id' is null and v_default=(r->>'version_id')::uuid then
   perform public.retire_recipe_version(v_current,(r->>'write_scope')::uuid,p_actor,
     public.recipe_change_snapshot((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,r->'lines'));
  else
   -- A changed default cannot replace the exact inherited content saved at start.
   perform public.save_recipe_version((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,null,v_current,null,'Back to normal',p_actor,
    (r->>'version_id')::uuid,null,null,public.recipe_change_snapshot((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,r->'lines'));
  end if;
  v_recipes:=v_recipes||jsonb_build_array(jsonb_build_object('recipe_id',r->>'recipe_id','outcome','restored'));
 end loop;
 select to_jsonb(p) into v_p from public.product_primaries p where product_id=s.product_id and location_id is not distinct from s.location_id;
 if v_p->>'id'=s.primary_after->>'id' and v_p->>'revision'=s.primary_after->>'revision' then
  if s.primary_before='null'::jsonb then
   -- The exceptional deletion is restricted to the row this swap introduced, at its exact revision.
   delete from public.product_primaries where id=(s.primary_after->>'id')::uuid and revision=(s.primary_after->>'revision')::bigint;
  else
   update public.product_primaries set primary_sku_id=(s.primary_before->>'primary_sku_id')::uuid,
    note=s.primary_before->>'note',updated_by=(s.primary_before->>'updated_by')::uuid,updated_at=clock_timestamp()
    where id=(s.primary_after->>'id')::uuid and revision=(s.primary_after->>'revision')::bigint;
  end if;
  v_primary:='restored';
 end if;
 -- Any new reference, member, primary rechoice or recipe edit keeps the grouping.
 if s.grouping_created or s.product_snapshot_before->'old_sku'->>'product_id' is null or s.product_snapshot_before->'new_sku'->>'product_id' is null then
  v_grouping:='changed_since';
  if v_primary='restored'
   and (select to_jsonb(p) from public.products p where id=s.product_id) = s.product_snapshot_after->'product'
   and (select to_jsonb(v) from public.vendor_items v where id=s.old_sku_id) = s.product_snapshot_after->'old_sku'
   and (select to_jsonb(v) from public.vendor_items v where id=s.new_sku_id) = s.product_snapshot_after->'new_sku'
   and not exists(select 1 from jsonb_array_elements(v_recipes) x where x->>'outcome'='changed_since')
   and not exists(select 1 from public.product_primaries p where product_id=s.product_id and
      not coalesce(( (s.default_created is not null and p.id=(s.default_created->>'id')::uuid and p.revision=(s.default_created->>'revision')::bigint)
        or (to_jsonb(p)=s.product_snapshot_before->'default_primary')
        or (to_jsonb(p)-'revision'-'updated_at'=case when jsonb_typeof(s.primary_before)='object' then s.primary_before-'revision'-'updated_at' else null end) ),false))
   and (not s.grouping_created or (
     not exists(select 1 from public.vendor_items where product_id=s.product_id and id not in(s.old_sku_id,s.new_sku_id))
     and not exists(select 1 from public.recipe_inputs where component_product_id=s.product_id)
     and not exists(select 1 from public.recipe_version_lines l join public.recipe_versions v on v.id=l.version_id where v.active and l.component_product_id=s.product_id))) then
    if s.default_created is not null then
     delete from public.product_primaries where id=(s.default_created->>'id')::uuid and revision=(s.default_created->>'revision')::bigint;
    end if;
    for v_before in select value from jsonb_array_elements(jsonb_build_array(s.product_snapshot_before->'old_sku',s.product_snapshot_before->'new_sku')) loop
     if v_before->>'product_id' is null then
      update public.vendor_items set product_id=null where id=(v_before->>'id')::uuid and product_id=s.product_id;
     end if;
    end loop;
    if s.grouping_created then update public.products set active=false,updated_by=p_actor,updated_at=clock_timestamp() where id=s.product_id; end if;
    v_grouping:='restored';
  end if;
 end if;
 v_result:=jsonb_build_object('swap_id',p_swap,'recipes',v_recipes,'primary',v_primary,'grouping',v_grouping);
 insert into public.sku_swap_ends(swap_id,outcome,created_by) values(p_swap,v_result,p_actor);
 return v_result;
exception when lock_not_available then raise exception 'swap:dependencies_busy' using errcode='P0001';
end $$;
revoke all on function public.sku_swap_product_snapshot(uuid,uuid,uuid),public.sku_swap_recipe_snapshot(uuid,uuid,uuid),
 public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb),public.end_sku_swap(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sku_swap_product_snapshot(uuid,uuid,uuid),public.sku_swap_recipe_snapshot(uuid,uuid,uuid),
 public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb),public.end_sku_swap(uuid,uuid) to service_role;
commit;
