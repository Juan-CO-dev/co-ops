-- Migration 0264_catalog_shop_owned
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review
-- Catalog Phase 4a, chunk 2. FILE ONLY; executable proof uses in-memory PGlite.
-- Existing recipes/menu_items remain shared; items/SKUs retain their existing owners.
-- No new tables; 0262/0263 history ceilings remain unchanged.
-- The old 16-argument update_recipe_input_atomic remains callable here. Its exact DROP
-- belongs to 0266_drop_recipe_input_16arg, after deployment READY and old requests drain.
-- Service-role RPCs rely on the app's role/location gate; triggers enforce graph integrity
-- even for legacy writers. Lock order: graph advisory lock, target, NOWAIT dependencies.
begin;
select pg_advisory_xact_lock(7258025800);
alter table public.recipes add column location_id uuid references public.locations(id);
alter table public.menu_items add column location_id uuid references public.locations(id);
-- Creation owner is permanent even when a shop later shares its SKU. Replays
-- stay in the original owner's namespace; global requests also deduplicate.
alter table public.vendor_items add column request_id uuid;
alter table public.vendor_items add column request_owner_location_id uuid references public.locations(id);
create unique index vendor_items_creation_request on public.vendor_items(request_owner_location_id, request_id)
  nulls not distinct where request_id is not null;
create index recipes_owner on public.recipes(location_id) where location_id is not null;
create index menu_items_owner on public.menu_items(location_id) where location_id is not null;

create or replace function public.shop_owned_owner_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if TG_TABLE_NAME = 'vendor_items' then
    if new.request_id is distinct from old.request_id
       or new.request_owner_location_id is distinct from old.request_owner_location_id then
      raise exception 'shop_owned:invalid_payload' using errcode='P0001';
    end if;
  end if;
  -- Promotion to shared is dependency-checked at commit. Entity owner moves and
  -- retroactively making a shared entity private are never a supported write.
  if new.location_id is not null and old.location_id is distinct from new.location_id then
    raise exception 'shop_owned:owner_is_set_at_creation' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger shop_owned_owner_guard before update of location_id on public.recipes
  for each row execute function public.shop_owned_owner_guard();
create trigger shop_owned_owner_guard before update of location_id on public.menu_items
  for each row execute function public.shop_owned_owner_guard();
create trigger shop_owned_owner_guard before update of location_id on public.items
  for each row execute function public.shop_owned_owner_guard();
create trigger shop_owned_owner_guard before update of location_id, request_id, request_owner_location_id on public.vendor_items
  for each row execute function public.shop_owned_owner_guard();

create or replace function public.shop_owned_graph_lock()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(7258025800);
  return null;
end $$;

-- Validate final state, not the transient gap between a recipe and its output insert.
-- Historical version lines are immutable evidence and are deliberately not revalidated.
create or replace function public.shop_owned_check_recipe(p_recipe uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_scope uuid; v_line record; v_output record; v_component uuid;
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.recipes where id=p_recipe for share nowait;
  if not found then return; end if;
  if v_owner is not null and exists(select 1 from public.recipe_versions where recipe_id=p_recipe and location_id is not null and active) then
    raise exception 'shop_owned:recipe_has_no_shop_versions' using errcode='P0001';
  end if;
  for v_scope in select null::uuid union select location_id from public.recipe_versions where recipe_id=p_recipe and active and location_id is not null loop
    perform public.recipe_change_lock(p_recipe,coalesce(v_owner,v_scope),null);
  end loop;
  for v_line in
    select x.*, row_number() over (partition by scope order by display_order,id) as position from (
      select id, component_sku_id,component_item_id,display_order,v_owner as scope from public.recipe_inputs where recipe_id=p_recipe
      union all
      select l.id,l.component_sku_id,l.component_item_id,l.display_order,v.location_id
        from public.recipe_version_lines l join public.recipe_versions v on v.id=l.version_id
        where v.recipe_id=p_recipe and v.active and v.location_id is not null
    ) x
  loop
    if v_line.component_sku_id is not null then
      select location_id into v_component from public.vendor_items where id=v_line.component_sku_id for share nowait;
    elsif v_line.component_item_id is not null then
      select location_id into v_component from public.items where id=v_line.component_item_id for share nowait;
    else v_component:=null;
    end if;
    -- Existing shared citations are read-compatible. shop_owned_integrity checks
    -- new/changed global citations separately; scoped citations always enforce visibility.
    if v_line.scope is not null and v_component is not null and v_component is distinct from v_line.scope then
      raise exception 'shop_owned:line_other_shop:%',v_line.position using errcode='P0001';
    end if;
  end loop;
  for v_output in select * from public.recipe_outputs where recipe_id=p_recipe order by id loop
    if v_output.output_item_id is not null then
      select location_id into v_component from public.items where id=v_output.output_item_id for share nowait;
    else
      select location_id into v_component from public.menu_items where id=v_output.output_menu_item_id for share nowait;
    end if;
    if v_owner is distinct from v_component and (v_owner is not null or v_output.output_menu_item_id is not null) then
      if v_owner is null then raise exception 'shop_owned:global_recipe_makes_shop_item' using errcode='P0001'; end if;
      raise exception 'shop_owned:output_other_shop' using errcode='P0001';
    end if;
  end loop;
exception when lock_not_available then
  raise exception 'recipe_version:dependencies_busy' using errcode='P0001';
end $$;

create or replace function public.shop_owned_integrity()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_owner uuid; v_recipe uuid; v_row jsonb; v_column text; v_changed boolean := false;
begin
  -- UPDATE OF also fires for x=x. Do not revalidate historical citations unless
  -- a citation/ownership field actually changed. Arguments mirror the trigger columns.
  if tg_op='UPDATE' then
    foreach v_column in array tg_argv loop
      -- Dropping active membership never introduces an edge. Other changed
      -- ownership/citation columns still validate, even alongside deactivation.
      if v_column='active' then
        v_changed := v_changed or (to_jsonb(old)->'active'='false'::jsonb and to_jsonb(new)->'active'='true'::jsonb);
      else
        v_changed := v_changed or (to_jsonb(old)->v_column is distinct from to_jsonb(new)->v_column);
      end if;
    end loop;
    if not v_changed then return null; end if;
  end if;
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id:=(v_row->>'id')::uuid;
  -- Read compatibility only: inspect the newly written citation, not every
  -- historical global edge in its recipe. Promotion must check all live edges.
  -- Read final rows so deferred checks permit atomic sharing and superseding.
  if tg_table_name in ('recipes','recipe_inputs','recipe_outputs','recipe_versions','recipe_version_lines') and tg_op<>'DELETE' then
    for v_row in
      select jsonb_build_object('sku',i.component_sku_id,'item',i.component_item_id) from public.recipe_inputs i
        join public.recipes r on r.id=i.recipe_id where r.location_id is null
        and ((tg_table_name='recipe_inputs' and i.id=v_id) or (tg_table_name='recipes' and r.id=v_id))
      union all
      select jsonb_build_object('sku',l.component_sku_id,'item',l.component_item_id) from public.recipe_version_lines l
        join public.recipe_versions v on v.id=l.version_id join public.recipes r on r.id=v.recipe_id
        where coalesce(r.location_id,v.location_id) is null
        and ((tg_table_name='recipe_version_lines' and l.id=v_id)
          or (tg_table_name='recipe_versions' and v.id=v_id and v.active)
          or (tg_table_name='recipes' and r.id=v_id and v.active))
    loop
      if exists(select 1 from public.items where id=(v_row->>'item')::uuid and location_id is not null) then
        raise exception 'shop_owned:uses_shop_only_item' using errcode='P0001';
      end if;
      if exists(select 1 from public.vendor_items where id=(v_row->>'sku')::uuid and location_id is not null) then
        raise exception 'shop_owned:uses_other_shop_sku' using errcode='P0001';
      end if;
    end loop;
    if exists(select 1 from public.recipe_outputs o join public.recipes r on r.id=o.recipe_id
      left join public.items i on i.id=o.output_item_id left join public.menu_items m on m.id=o.output_menu_item_id
      where r.location_id is null and (i.location_id is not null or m.location_id is not null)
      and ((tg_table_name='recipe_outputs' and o.id=v_id) or (tg_table_name='recipes' and r.id=v_id))) then
      raise exception 'shop_owned:global_recipe_makes_shop_item' using errcode='P0001';
    end if;
  end if;
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='items' and exists(select 1 from public.items where id=v_id and location_id is not null and is_default) then
    raise exception 'shop_owned:invalid_payload' using errcode='P0001';
  end if;
  if tg_table_name in ('recipe_inputs','recipe_outputs','recipe_versions','recipe_version_lines') then
    perform public.shop_owned_check_recipe((v_row->>'recipe_id')::uuid);
    if tg_op='UPDATE' and old.recipe_id is distinct from new.recipe_id then perform public.shop_owned_check_recipe(old.recipe_id); end if;
  elsif tg_table_name='recipes' then
    perform public.shop_owned_check_recipe(v_id);
  elsif tg_table_name in ('items','vendor_items','menu_items')
    and (tg_op<>'UPDATE' or to_jsonb(old)->'location_id' is distinct from to_jsonb(new)->'location_id') then
    for v_recipe in
      select r.id from public.recipes r where r.active and (
        exists(select 1 from public.recipe_inputs i where i.recipe_id=r.id and (i.component_sku_id=v_id or i.component_item_id=v_id))
        or exists(select 1 from public.recipe_version_lines l join public.recipe_versions v on v.id=l.version_id
          where v.recipe_id=r.id and v.active and (l.component_sku_id=v_id or l.component_item_id=v_id))
        or exists(select 1 from public.recipe_outputs o where o.recipe_id=r.id and (o.output_item_id=v_id or o.output_menu_item_id=v_id))) order by r.id
    loop perform public.shop_owned_check_recipe(v_recipe); end loop;
  end if;
  if tg_table_name in ('menu_items','menu_item_shop_settings','toast_menu_map','toast_map_effects','toast_open_item_aliases','items','vendor_items') then
    if exists(select 1 from public.menu_item_shop_settings s join public.menu_items m on m.id=s.menu_item_id where s.active and m.location_id is not null
      and (m.id=v_id or s.id=v_id)) then
      raise exception 'shop_owned:menu_item_has_no_shop_settings' using errcode='P0001';
    end if;
    if exists(select 1 from public.menu_items m where m.id=v_id and m.location_id is not null and m.catering_available) then
      raise exception 'shop_owned:owned_not_catering' using errcode='P0001';
    end if;
    if exists(select 1 from public.toast_menu_map t
      left join public.menu_items m on m.id=t.menu_item_id left join public.items i on i.id=t.item_id
      left join public.vendor_items s on s.id=t.sku_id
      where t.active and (t.id=v_id or m.id=v_id or i.id=v_id or s.id=v_id)
        and ((m.location_id is not null and m.location_id is distinct from t.location_id)
          or (i.location_id is not null and i.location_id is distinct from t.location_id)
          or (s.location_id is not null and s.location_id is distinct from t.location_id))) then
      raise exception 'shop_owned:toast_other_shop' using errcode='P0001';
    end if;
    if exists(select 1 from public.toast_map_effects e join public.toast_menu_map t on t.id=e.map_id
      left join public.menu_items m on m.id=e.menu_item_id left join public.items i on i.id=e.item_id
      left join public.vendor_items s on s.id=e.sku_id
      where e.active and t.active and (e.id=v_id or t.id=v_id or m.id=v_id or i.id=v_id or s.id=v_id)
        and ((m.location_id is not null and m.location_id is distinct from t.location_id)
          or (i.location_id is not null and i.location_id is distinct from t.location_id)
          or (s.location_id is not null and s.location_id is distinct from t.location_id)))
      or exists(select 1 from public.toast_open_item_aliases a
        left join public.menu_items m on m.id=a.menu_item_id left join public.items i on i.id=a.item_id
        where a.active and (a.id=v_id or m.id=v_id or i.id=v_id)
          and ((m.location_id is not null and m.location_id is distinct from a.location_id)
            or (i.location_id is not null and i.location_id is distinct from a.location_id))) then
      raise exception 'shop_owned:toast_other_shop' using errcode='P0001';
    end if;
  end if;
  return null;
end $$;

-- Operational name/price/weight writes do not enter the ownership graph at all.
-- Active flags are citation membership: reactivation must revalidate its edges.
do $$ declare t record; events text; args text; begin
  for t in select * from (values
    ('recipes','location_id, active',true),
    ('recipe_inputs','recipe_id, component_sku_id, component_item_id, component_product_id',false),
    ('recipe_outputs','recipe_id, output_item_id, output_menu_item_id',false),
    ('recipe_versions','recipe_id, location_id, active',false),
    ('recipe_version_lines','version_id, recipe_id, location_id, component_sku_id, component_item_id, component_product_id',false),
    ('items','location_id, is_default',true),
    ('vendor_items','location_id',true),
    ('menu_items','location_id, catering_available',true),
    ('menu_item_shop_settings','menu_item_id, location_id, active',false),
    ('toast_menu_map','location_id, menu_item_id, item_id, sku_id, active',false),
    ('toast_map_effects','map_id, menu_item_id, item_id, sku_id, active',false),
    ('toast_open_item_aliases','location_id, menu_item_id, item_id, active',false)
  ) as surface(name,cols,entity) loop
    events := 'insert or update of '||t.cols||case when t.entity then ' or delete' else '' end;
    select string_agg(quote_literal(btrim(c)),',') into args from unnest(string_to_array(t.cols,',')) c;
    execute format('create trigger shop_owned_lock before %s on public.%I for each statement execute function public.shop_owned_graph_lock()',events,t.name);
    execute format('create constraint trigger shop_owned_integrity after %s on public.%I deferrable initially deferred for each row execute function public.shop_owned_integrity(%s)',events,t.name,args);
  end loop;
end $$;

-- 0262 create_recipe_full preserved; private owner-at-insert variant.
create or replace function public.shop_owned_create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid, p_location_id uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb; v_item_id uuid; v_clash uuid;
begin
  -- 0258 (Astra r2 #1): the recipe-graph write lock FIRST, so this output write serialises with
  -- every recipe-line write and every other output write (lib/recipe-graph-shared.ts).
  perform pg_advisory_xact_lock(7258025800);
  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).
  perform set_config('app.recipe_journal_actor', coalesce(p_created_by::text, ''), true);
  -- ── 0187 BLOCK A: serialise on every ITEM this call is about to produce ────
  -- Taken BEFORE the recipes insert, so the whole write is inside the lock and a
  -- concurrent caller naming the same item waits for our COMMIT rather than reading
  -- around it. Ordered by item id to give a deterministic acquisition order — two
  -- calls naming the same pair of items in opposite orders would otherwise deadlock.
  for v_item_id in
    select distinct nullif(value->>'output_item_id','')::uuid
    from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)
    where nullif(value->>'output_item_id','') is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('recipe_active_producer:' || v_item_id::text, 0));

    -- Now re-ask, inside the lock, the question lib/recipes.ts asked outside it.
    select ro.recipe_id into v_clash
    from recipe_outputs ro
    join recipes rc on rc.id = ro.recipe_id
    where ro.output_item_id = v_item_id and rc.active = true
    limit 1;

    if v_clash is not null then
      raise exception 'duplicate_active_producer'
        using errcode = 'P0001',
              detail  = format('item %s already has an active producing recipe (%s)', v_item_id, v_clash);
    end if;
  end loop;
  -- ── end 0187 BLOCK A ───────────────────────────────────────────────────────

  -- 0215 batch-vs-bottle (ruling H): batch_mode requires exactly ONE output, and it must be an
  -- ITEM output (a menu-item output has no bulk container). Refused here, in the only transaction
  -- that can see the header and its outputs together.
  if coalesce((p_header->>'batch_mode')::boolean, false) then
    if jsonb_array_length(coalesce(p_outputs,'[]'::jsonb)) <> 1
       or nullif(coalesce(p_outputs,'[]'::jsonb)->0->>'output_item_id','') is null then
      raise exception 'batch_mode_single_output'
        using errcode = 'P0001',
              detail  = 'a batch_mode recipe needs exactly one ITEM output';
    end if;
  end if;
  if (p_header->>'shelf_life_days') is not null and (p_header->>'shelf_life_days')::integer <= 0 then
    raise exception 'invalid_shelf_life_days' using errcode = 'P0001';
  end if;
  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by, batch_mode, shelf_life_days, location_id)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by,
    coalesce((p_header->>'batch_mode')::boolean, false), coalesce((p_header->>'shelf_life_days')::integer, 5), p_location_id
  ) returning id into v_recipe_id;

  for r in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'component_sku_id','')::uuid, nullif(r->>'component_item_id','')::uuid,
      nullif(r->>'component_product_id','')::uuid,
      (r->>'quantity')::numeric, nullif(r->>'unit',''), nullif(r->>'each_container_label',''),
      coalesce((r->>'portioned')::boolean, false), coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'output_item_id','')::uuid, nullif(r->>'output_menu_item_id','')::uuid,
      (r->>'yield')::numeric, nullif(r->>'output_container_label',''),
      coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  -- 0258 (Astra r2 #1): inside the lock, with this call's inputs AND outputs written, refuse an
  -- ITEM output that the new recipe's own inputs already reach (recipe_output_would_cycle).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)
    where nullif(value->>'output_item_id','') is not null
      and public.recipe_output_would_cycle(v_recipe_id, nullif(value->>'output_item_id','')::uuid)
  ) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  -- 0262: the same refusal in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)
    where nullif(value->>'output_item_id','') is not null
      and public.recipe_shops_output_would_cycle(v_recipe_id, nullif(value->>'output_item_id','')::uuid)
  ) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  return v_recipe_id;
end $$;
revoke all on function public.shop_owned_create_recipe_full(jsonb,jsonb,jsonb,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.create_shop_recipe(p_header jsonb,p_inputs jsonb,p_outputs jsonb,p_created_by uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_item uuid; v_output jsonb; v_definition jsonb; v_outputs jsonb:='[]'; v_items uuid[]:='{}'; v_output_owner uuid; v_input jsonb;
begin
  perform pg_advisory_xact_lock(7258025800);
  if p_location_id is not null then
    perform 1 from public.locations where id=p_location_id and active for share nowait;
    if not found then raise exception 'shop_owned:location_not_found' using errcode='P0001'; end if;
  end if;
  if jsonb_typeof(p_header) is distinct from 'object' or jsonb_typeof(p_inputs) is distinct from 'array'
    or jsonb_typeof(p_outputs) is distinct from 'array' then raise exception 'shop_owned:invalid_payload' using errcode='P0001'; end if;
  if nullif(btrim(p_header->>'name'),'') is null or char_length(btrim(p_header->>'name'))>120 then
    raise exception 'shop_owned:invalid_name' using errcode='P0001'; end if;
  if (p_header->>'recipe_type') not in ('production','consumer') or (p_header->>'recipe_type') is null then
    raise exception 'shop_owned:invalid_payload' using errcode='P0001'; end if;
  if jsonb_typeof(p_header->'batch_yield') is distinct from 'number' or coalesce((p_header->>'batch_yield')::numeric,0)<=0 then raise exception 'shop_owned:invalid_yield' using errcode='P0001'; end if;
  if jsonb_array_length(p_inputs)=0 or jsonb_array_length(p_outputs)=0 then raise exception 'shop_owned:incomplete_recipe' using errcode='P0001'; end if;
  for v_input in select value from jsonb_array_elements(p_inputs) loop
    if jsonb_typeof(v_input) is distinct from 'object' or jsonb_typeof(v_input->'quantity') is distinct from 'number'
      or (v_input->>'quantity')::numeric<=0 or num_nonnulls(nullif(v_input->>'component_sku_id',''),
        nullif(v_input->>'component_item_id',''),nullif(v_input->>'component_product_id',''))<>1 then
      raise exception 'shop_owned:invalid_payload' using errcode='P0001'; end if;
  end loop;
  for v_output in select value from jsonb_array_elements(p_outputs) loop
    if num_nonnulls(nullif(v_output->>'output_item_id',''),nullif(v_output->>'output_menu_item_id',''),nullif(v_output->'new_item','null'::jsonb))<>1 then
      raise exception 'shop_owned:invalid_payload' using errcode='P0001'; end if;
    if jsonb_typeof(v_output->'yield') is distinct from 'number' or coalesce((v_output->>'yield')::numeric,0)<=0 then raise exception 'shop_owned:invalid_yield' using errcode='P0001'; end if;
    if nullif(v_output->'new_item','null'::jsonb) is not null then
      if p_location_id is null then raise exception 'shop_owned:location_required' using errcode='P0001'; end if;
      v_definition:=v_output->'new_item';
      if jsonb_typeof(v_definition)<>'object' or nullif(btrim(v_definition->>'name'),'') is null
        or not exists(select 1 from public.prep_sections where slug=v_definition->>'section' and active)
        or (nullif(v_definition->'recommended_par','null'::jsonb) is not null and jsonb_typeof(v_definition->'recommended_par')<>'number')
        or coalesce((v_definition->>'recommended_par')::numeric,0)<0
        or ((v_definition->>'min_role_level') is not null and (v_definition->>'min_role_level')::integer not between 0 and 10) then
        raise exception 'shop_owned:invalid_payload' using errcode='P0001'; end if;
      insert into public.items(name,name_es,section,default_par,default_par_unit,special_instruction,special_instruction_es,
        required,min_role_level,location_id,is_default,created_by)
      values(btrim(v_definition->>'name'),nullif(btrim(v_definition->>'name_es'),''),v_definition->>'section',
        (v_definition->>'recommended_par')::numeric,nullif(btrim(v_definition->>'recommended_par_unit'),''),
        nullif(btrim(v_definition->>'special_instructions'),''),nullif(btrim(v_definition->>'special_instructions_es'),''),
        coalesce((v_definition->>'required')::boolean,false),(v_definition->>'min_role_level')::integer,p_location_id,false,p_created_by)
      returning id into v_item;
      v_output:=(v_output-'new_item')||jsonb_build_object('output_item_id',v_item);
    end if;
    if nullif(v_output->>'output_item_id','') is not null then
      v_items:=array_append(v_items,(v_output->>'output_item_id')::uuid);
      select location_id into v_output_owner from public.items where id=(v_output->>'output_item_id')::uuid for share nowait;
    else
      select location_id into v_output_owner from public.menu_items where id=(v_output->>'output_menu_item_id')::uuid for share nowait;
    end if;
    if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
    if v_output_owner is distinct from p_location_id then raise exception 'shop_owned:output_other_shop' using errcode='P0001'; end if;
    v_outputs:=v_outputs||jsonb_build_array(v_output);
  end loop;
  -- The reviewed 0262 writer retains producer uniqueness, cycles, batch output checks and journaling.
  v_id:=public.shop_owned_create_recipe_full(p_header,p_inputs,v_outputs,p_created_by,p_location_id);
  perform public.shop_owned_check_recipe(v_id);
  perform public.recipe_global_journal(v_id,p_created_by,null,null);
  return jsonb_build_object('id',v_id,'output_item_ids',to_jsonb(v_items));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'shop_owned:invalid_payload' using errcode='P0001';
end $$;

create or replace function public.save_owned_recipe_version(p_recipe_id uuid,p_expected_owner uuid,p_lines jsonb,p_expected_active_id uuid,p_actor uuid,p_expected_snapshot jsonb,
  p_restored_from uuid default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_result jsonb;
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.recipes where id=p_recipe_id for no key update;
  if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  v_result:=public.save_recipe_version(p_recipe_id,null,p_lines,p_expected_active_id,null,p_note,p_actor,p_restored_from,null,null,p_expected_snapshot);
  perform public.shop_owned_check_recipe(p_recipe_id);
  return v_result;
end $$;

create or replace function public.create_shop_sandwich(p_menu jsonb,p_header jsonb,p_inputs jsonb,p_actor uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_menu uuid; v_result jsonb;
begin
  perform pg_advisory_xact_lock(7258025800);
  if nullif(btrim(p_menu->>'name'),'') is null or char_length(btrim(p_menu->>'name'))>120 then raise exception 'shop_owned:invalid_name' using errcode='P0001'; end if;
  if coalesce((p_menu->>'menu_price')::numeric,0)<=0 or (p_menu->>'menu_price')::numeric>1000 then raise exception 'shop_owned:invalid_price' using errcode='P0001'; end if;
  if jsonb_typeof(p_menu->'menu_price') is distinct from 'number' then raise exception 'shop_owned:invalid_price' using errcode='P0001'; end if;
  if exists(select 1 from public.menu_items where active and lower(btrim(name))=lower(btrim(p_menu->>'name'))
    and (location_id is null or p_location_id is null or location_id=p_location_id)) then
    raise exception 'shop_owned:name_taken' using errcode='P0001'; end if;
  if p_location_id is not null and coalesce((p_menu->>'catering_available')::boolean,false) then raise exception 'shop_owned:owned_not_catering' using errcode='P0001'; end if;
  insert into public.menu_items(name,name_es,section,menu_price,catering_available,location_id,created_by)
    values(btrim(p_menu->>'name'),nullif(btrim(p_menu->>'name_es'),''),p_menu->>'section',(p_menu->>'menu_price')::numeric,
      coalesce((p_menu->>'catering_available')::boolean,false),p_location_id,p_actor) returning id into v_menu;
  v_result:=public.create_shop_recipe(p_header||jsonb_build_object('recipe_type','consumer','batch_mode',false,'batch_yield',1),p_inputs,
    jsonb_build_array(jsonb_build_object('output_menu_item_id',v_menu,'yield',1)),p_actor,p_location_id);
  return v_result||jsonb_build_object('menu_item_id',v_menu);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'shop_owned:invalid_payload' using errcode='P0001';
end $$;

create or replace function public.share_shop_sku(p_id uuid,p_expected_owner uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid;
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.vendor_items where id=p_id for update;
  if not found then raise exception 'shop_owned:sku_not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  update public.vendor_items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id;
  return jsonb_build_object('id',p_id);
end $$;

create or replace function public.share_shop_recipe(p_id uuid,p_expected_owner uuid,p_actor uuid,
  p_expected_items uuid[] default '{}',p_expected_skus uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_items uuid[]; v_skus uuid[];
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.recipes where id=p_id for no key update;
  if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  perform public.recipe_change_lock(p_id,v_owner,null);
  if exists(select 1 from public.recipe_outputs where recipe_id=p_id and output_menu_item_id is not null) then raise exception 'shop_owned:share_the_sandwich' using errcode='P0001'; end if;
  if exists(select 1 from public.recipe_inputs i join public.vendor_items s on s.id=i.component_sku_id where i.recipe_id=p_id and s.location_id is not null and s.location_id<>v_owner) then raise exception 'shop_owned:uses_other_shop_sku' using errcode='P0001'; end if;
  if exists(select 1 from public.recipe_inputs i join public.items t on t.id=i.component_item_id where i.recipe_id=p_id and t.location_id is not null) then raise exception 'shop_owned:uses_shop_only_item' using errcode='P0001'; end if;
  v_items:=array(select distinct o.output_item_id from public.recipe_outputs o join public.items i on i.id=o.output_item_id
    where o.recipe_id=p_id and i.location_id=v_owner order by 1);
  v_skus:=array(select distinct s.id from public.recipe_inputs i join public.vendor_items s on s.id=i.component_sku_id
    where i.recipe_id=p_id and s.location_id=v_owner order by 1);
  if v_items is distinct from array(select distinct x from unnest(coalesce(p_expected_items,'{}'::uuid[])) x order by x) then
    raise exception 'shop_owned:items_changed' using errcode='P0001'; end if;
  if v_skus is distinct from array(select distinct x from unnest(coalesce(p_expected_skus,'{}'::uuid[])) x order by x) then
    raise exception 'shop_owned:skus_changed' using errcode='P0001'; end if;
  update public.items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id=any(v_items);
  update public.vendor_items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id=any(v_skus);
  update public.recipes set location_id=null where id=p_id;
  perform public.shop_owned_check_recipe(p_id);
  return jsonb_build_object('id',p_id,'item_ids',to_jsonb(v_items),'sku_ids',to_jsonb(v_skus));
end $$;

create or replace function public.share_shop_menu_item(p_id uuid,p_expected_owner uuid,p_actor uuid,p_expected_skus uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_recipe uuid; v_recipes uuid[]; v_skus uuid[];
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.menu_items where id=p_id for update;
  if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  -- Include inactive producers too: later reactivation must not resurrect an
  -- owned recipe whose output was already shared by this operation.
  v_recipes:=array(select distinct r.id from public.recipes r join public.recipe_outputs o on o.recipe_id=r.id where o.output_menu_item_id=p_id order by r.id);
  if exists(select 1 from public.menu_items other join public.menu_items target on target.id=p_id
    where other.id<>p_id and other.active and other.location_id is null and lower(btrim(other.name))=lower(btrim(target.name))) then
    raise exception 'shop_owned:name_taken' using errcode='P0001'; end if;
  for v_recipe in select unnest(v_recipes) loop
    perform public.recipe_change_lock(v_recipe,v_owner,null);
    if exists(select 1 from public.recipe_inputs i join public.vendor_items s on s.id=i.component_sku_id where i.recipe_id=v_recipe and s.location_id is not null and s.location_id<>v_owner) then raise exception 'shop_owned:uses_other_shop_sku' using errcode='P0001'; end if;
    if exists(select 1 from public.recipe_inputs i join public.items t on t.id=i.component_item_id where i.recipe_id=v_recipe and t.location_id is not null) then raise exception 'shop_owned:uses_shop_only_item' using errcode='P0001'; end if;
  end loop;
  v_skus:=array(select distinct s.id from public.recipe_inputs i join public.vendor_items s on s.id=i.component_sku_id
    where i.recipe_id=any(v_recipes) and s.location_id=v_owner order by 1);
  if v_skus is distinct from array(select distinct x from unnest(coalesce(p_expected_skus,'{}'::uuid[])) x order by x) then
    raise exception 'shop_owned:skus_changed' using errcode='P0001'; end if;
  update public.vendor_items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id=any(v_skus);
  for v_recipe in select unnest(v_recipes) loop
    update public.items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id in(select output_item_id from public.recipe_outputs where recipe_id=v_recipe);
    update public.recipes set location_id=null where id=v_recipe;
  end loop;
  update public.menu_items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id;
  return jsonb_build_object('id',p_id,'recipe_ids',to_jsonb(v_recipes),'sku_ids',to_jsonb(v_skus));
end $$;

create or replace function public.share_shop_item(p_id uuid,p_expected_owner uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid;
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.items where id=p_id for update;
  if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  if exists(select 1 from public.recipe_outputs o join public.recipes r on r.id=o.recipe_id where o.output_item_id=p_id and r.active) then raise exception 'shop_owned:share_the_recipe' using errcode='P0001'; end if;
  update public.items set location_id=null,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id;
  return jsonb_build_object('id',p_id);
end $$;

revoke all on function public.shop_owned_owner_guard(),public.shop_owned_graph_lock(),public.shop_owned_integrity(),public.shop_owned_check_recipe(uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_shop_recipe(jsonb,jsonb,jsonb,uuid,uuid),public.save_owned_recipe_version(uuid,uuid,jsonb,uuid,uuid,jsonb,uuid,text),
  public.create_shop_sandwich(jsonb,jsonb,jsonb,uuid,uuid),public.share_shop_sku(uuid,uuid,uuid),public.share_shop_recipe(uuid,uuid,uuid,uuid[],uuid[]),
  public.share_shop_menu_item(uuid,uuid,uuid,uuid[]),public.share_shop_item(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_shop_recipe(jsonb,jsonb,jsonb,uuid,uuid),public.save_owned_recipe_version(uuid,uuid,jsonb,uuid,uuid,jsonb,uuid,text),
  public.create_shop_sandwich(jsonb,jsonb,jsonb,uuid,uuid),public.share_shop_sku(uuid,uuid,uuid),public.share_shop_recipe(uuid,uuid,uuid,uuid[],uuid[]),
  public.share_shop_menu_item(uuid,uuid,uuid,uuid[]),public.share_shop_item(uuid,uuid,uuid) to service_role;

-- Atomic job creation only. Legacy/edit/import writers do not participate in
-- this advisory lock, so this is intentionally not a global uniqueness claim.
create or replace function public.create_catalog_sku(
  p_sku jsonb, p_pack jsonb, p_price jsonb, p_actor uuid, p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_request uuid;
  v_replay record;
  v_vendor uuid;
  v_name text;
  v_number text;
  v_class text;
  v_basis text;
  v_avg numeric;
  v_price numeric;
  v_date date;
begin
  -- Same order as ownership/share writers; the INSERT graph trigger must never
  -- become our first graph lock after acquiring dependency rows.
  perform pg_advisory_xact_lock(7258025800::bigint);
  if p_sku is null or jsonb_typeof(p_sku) <> 'object'
     or p_actor is null or not exists (select 1 from public.users where id = p_actor) then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  if p_sku ? 'request_id' and jsonb_typeof(p_sku -> 'request_id') <> 'null' then
    if jsonb_typeof(p_sku -> 'request_id') <> 'string' then
      raise exception 'shop_owned:invalid_payload' using errcode='P0001';
    end if;
    begin
      v_request := (p_sku ->> 'request_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'shop_owned:invalid_payload' using errcode='P0001';
    end;
    perform pg_advisory_xact_lock(hashtextextended(
      'catalog_sku_request:' || coalesce(p_location_id::text, 'global') || ':' || v_request::text, 0));
    select id, location_id into v_replay from public.vendor_items
      where request_id=v_request and request_owner_location_id is not distinct from p_location_id;
    if found then
      return jsonb_build_object('id', v_replay.id, 'location_id', v_replay.location_id, 'replayed', true);
    end if;
  end if;
  if jsonb_typeof(p_sku -> 'name') is distinct from 'string'
     or coalesce(btrim(p_sku ->> 'name'), '') = '' then
    raise exception 'shop_owned:invalid_name' using errcode = 'P0001';
  end if;
  -- Ownership is supplied by the authorized caller, never a JSON override.
  if p_sku ? 'locationId' or p_sku ? 'location_id' then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_each(p_sku) j
              where j.key in ('vendorId', 'itemNumber', 'skuClass', 'priceBasis', 'notes')
                and jsonb_typeof(j.value) not in ('string', 'null')) then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  begin
    v_vendor := nullif(btrim(p_sku ->> 'vendorId'), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end;
  v_name := btrim(p_sku ->> 'name');
  v_number := nullif(btrim(p_sku ->> 'itemNumber'), '');
  v_class := coalesce(p_sku ->> 'skuClass', 'raw');
  v_basis := p_sku ->> 'priceBasis';
  -- The count-leaf weight is part of the atomic creation, not a later edit.
  if p_sku ? 'avgOzPerEach' and jsonb_typeof(p_sku -> 'avgOzPerEach') <> 'null' then
    if jsonb_typeof(p_sku -> 'avgOzPerEach') <> 'number' then
      raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
    end if;
    v_avg := (p_sku ->> 'avgOzPerEach')::numeric;
    if v_avg <= 0 or v_avg::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
    end if;
  end if;
  if v_class not in ('raw', 'packaging', 'cleaning', 'misc')
     or (v_basis is not null and v_basis not in ('per_case', 'per_each', 'per_lb', 'per_dozen', 'per_bundle')) then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  if p_location_id is not null then
    perform 1 from public.locations where id = p_location_id and active for share nowait;
    if not found then
      raise exception 'shop_owned:location_not_found' using errcode = 'P0001';
    end if;
  end if;
  if v_vendor is not null then
    perform 1 from public.vendors where id = v_vendor and active for share nowait;
    if not found then
      raise exception 'shop_owned:vendor_not_found' using errcode = 'P0001';
    end if;
  end if;
  if p_pack is not null and (jsonb_typeof(p_pack) <> 'object'
       or jsonb_typeof(p_pack -> 'levels') is distinct from 'array'
       or (p_pack ? 'note' and jsonb_typeof(p_pack -> 'note') not in ('string', 'null'))) then
    raise exception 'shop_owned:invalid_payload' using errcode = 'P0001';
  end if;
  if p_price is not null then
    if jsonb_typeof(p_price) <> 'object'
       or jsonb_typeof(p_price -> 'unitPrice') is distinct from 'number'
       or jsonb_typeof(p_price -> 'effectiveDate') is distinct from 'string'
       or (p_price ->> 'effectiveDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'shop_owned:invalid_price' using errcode = 'P0001';
    end if;
    begin
      v_price := (p_price ->> 'unitPrice')::numeric;
      v_date := (p_price ->> 'effectiveDate')::date;
    exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
      raise exception 'shop_owned:invalid_price' using errcode = 'P0001';
    end;
    if v_price <= 0 then
      raise exception 'shop_owned:invalid_price' using errcode = 'P0001';
    end if;
  end if;
  if v_number is not null then
    -- One lock across ALL shop scopes: a simultaneous shared creation must
    -- serialize against every owned creation with the same normalized number.
    perform pg_advisory_xact_lock(hashtextextended(
      'catalog_sku_number:' || coalesce(v_vendor::text, 'none') || ':' || lower(v_number), 0));
    if exists (select 1 from public.vendor_items vi
                where vi.active and vi.vendor_id is not distinct from v_vendor
                  and lower(btrim(vi.item_number)) = lower(v_number)
                  and (p_location_id is null or vi.location_id is null or vi.location_id = p_location_id)) then
      raise exception 'shop_owned:item_number_taken' using errcode = 'P0001';
    end if;
  end if;
  insert into public.vendor_items
    (id, vendor_id, location_id, request_id, request_owner_location_id, name, item_number, sku_class, price_basis, avg_oz_per_each,
     pack_format, notes, active, created_by, updated_by)
  values (v_id, v_vendor, p_location_id, v_request, p_location_id, v_name, v_number, v_class, v_basis, v_avg,
          'Each (no case)', nullif(btrim(p_sku ->> 'notes'), ''), true, p_actor, p_actor);
  -- Use the existing validators and history writers in this transaction. A
  -- failure at either step unwinds the row and every earlier initial value.
  if p_pack is not null then
    perform public.save_sku_pack_version(v_id, null, p_pack -> 'levels', null, null,
                                         p_pack ->> 'note', p_actor, true);
  end if;
  if p_price is not null then
    perform public.save_sku_global_price(v_id, v_price, v_date, p_actor, true);
  end if;
  return jsonb_build_object('id', v_id, 'location_id', p_location_id, 'replayed', false);
exception when lock_not_available then
  raise exception 'recipe_version:dependencies_busy' using errcode = 'P0001';
end;
$$;
revoke all on function public.create_catalog_sku(jsonb, jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_catalog_sku(jsonb, jsonb, jsonb, uuid, uuid) to service_role;

-- Chunk 4: preserve each legacy writer's validation/journal while binding the
-- owning shop under the same graph lock used by sharing. The service layer has
-- already authorized this owner; a share between read and write must refuse.
create or replace function public.write_owned_recipe(
  p_recipe_id uuid, p_expected_owner uuid, p_operation text, p_payload jsonb, p_actor uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_result jsonb; v_edge_recipe uuid;
begin
  perform pg_advisory_xact_lock(7258025800);
  select location_id into v_owner from public.recipes where id=p_recipe_id for no key update;
  if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  if p_operation in ('remove_recipe_output','remove_recipe_input_atomic','update_recipe_input_atomic') then
    if p_operation='remove_recipe_output' then
      select recipe_id into v_edge_recipe from public.recipe_outputs where id=(p_payload->>'p_output_id')::uuid for update;
    else
      select recipe_id into v_edge_recipe from public.recipe_inputs where id=(p_payload->>'p_input_id')::uuid for update;
    end if;
    if v_edge_recipe is distinct from p_recipe_id then raise exception 'edge_not_found' using errcode='P0001'; end if;
  end if;
  case p_operation
    when 'update_recipe_atomic' then
      perform public.update_recipe_atomic(p_recipe_id,p_payload->'p_patch',(p_payload->>'p_batch_mode')::boolean,p_actor);
      v_result := 'null'::jsonb;
    when 'add_recipe_input_atomic' then
      v_result := to_jsonb(public.add_recipe_input_atomic(p_recipe_id,
        (p_payload->>'p_component_sku_id')::uuid,(p_payload->>'p_component_item_id')::uuid,(p_payload->>'p_component_product_id')::uuid,
        (p_payload->>'p_quantity')::numeric,p_payload->>'p_unit',p_payload->>'p_each_container_label',(p_payload->>'p_portioned')::boolean,p_actor));
    when 'update_recipe_input_atomic' then
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_result from public.update_recipe_input_atomic(
        (p_payload->>'p_input_id')::uuid,p_recipe_id,
        (p_payload->>'p_component_sku_id')::uuid,(p_payload->>'p_component_item_id')::uuid,(p_payload->>'p_component_product_id')::uuid,
        (p_payload->>'p_quantity')::numeric,p_payload->>'p_unit',p_payload->>'p_each_container_label',(p_payload->>'p_portioned')::boolean,
        (p_payload->>'p_expected_component_sku_id')::uuid,(p_payload->>'p_expected_component_item_id')::uuid,(p_payload->>'p_expected_component_product_id')::uuid,
        (p_payload->>'p_expected_quantity')::numeric,p_payload->>'p_expected_unit',p_payload->>'p_expected_each_container_label',
        (p_payload->>'p_expected_portioned')::boolean,p_actor) r;
    when 'add_recipe_output' then
      v_result := to_jsonb(public.add_recipe_output(p_recipe_id,(p_payload->>'p_output_item_id')::uuid,
        (p_payload->>'p_output_menu_item_id')::uuid,(p_payload->>'p_yield')::numeric,p_payload->>'p_output_container_label',p_actor));
    when 'update_recipe_output_yield' then
      v_result := public.update_recipe_output_yield(p_recipe_id,(p_payload->>'p_output_item_id')::uuid,(p_payload->>'p_yield')::numeric,p_actor);
    when 'remove_recipe_output' then
      v_result := public.remove_recipe_output((p_payload->>'p_output_id')::uuid,p_actor);
    when 'remove_recipe_input_atomic' then
      v_result := public.remove_recipe_input_atomic((p_payload->>'p_input_id')::uuid,p_actor);
    else raise exception 'shop_owned:invalid_payload' using errcode='P0001';
  end case;
  perform public.shop_owned_check_recipe(p_recipe_id);
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'shop_owned:invalid_payload' using errcode='P0001';
end $$;
revoke all on function public.write_owned_recipe(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.write_owned_recipe(uuid,uuid,text,jsonb,uuid) to service_role;

-- Chunk 5: a preview binds more than the original owner's SKU/item sets. In
-- particular, a sandwich may gain another producer after preview. Preserve the
-- reviewed writers and wrap their dispatch with the existing graph/closure locks.
create or replace function public.catalog_share_recipe_ids(p_kind text,p_id uuid)
returns uuid[] language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct recipe_id order by recipe_id),'{}'::uuid[]) from (
    select p_id recipe_id where p_kind='recipe'
    union all select recipe_id from public.recipe_outputs where p_kind='menu_item' and output_menu_item_id=p_id
    union all select recipe_id from public.recipe_inputs where p_kind='sku' and component_sku_id=p_id
    union all select l.recipe_id from public.recipe_version_lines l join public.recipe_versions v on v.id=l.version_id
      where p_kind='sku' and l.component_sku_id=p_id and v.active and v.location_id is not null
  ) refs
$$;

create or replace function public.catalog_share_snapshot(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_target jsonb; v_recipes uuid[];
begin
  case p_kind
    when 'sku' then select to_jsonb(t) into v_target from public.vendor_items t where id=p_id;
    when 'recipe' then select to_jsonb(t) into v_target from public.recipes t where id=p_id;
    when 'menu_item' then select to_jsonb(t) into v_target from public.menu_items t where id=p_id;
    else raise exception 'shop_owned:invalid_payload' using errcode='P0001';
  end case;
  if v_target is null then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  v_recipes:=public.catalog_share_recipe_ids(p_kind,p_id);
  return jsonb_build_object('kind',p_kind,'target',v_target,
    'owner_shop',(select to_jsonb(l) from public.locations l where l.id=(v_target->>'location_id')::uuid),
    'recipes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'snapshot',public.recipe_change_snapshot(r.id,r.location_id,null)) order by r.id)
      from public.recipes r where r.id=any(v_recipes)),'[]'::jsonb),
    'packs',case when p_kind='sku' then (select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.sku_pack_versions v where v.sku_id=p_id) else '[]'::jsonb end,
    'price_lanes',case when p_kind='sku' then (select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.sku_price_lanes v where v.sku_id=p_id) else '[]'::jsonb end);
end $$;

create or replace function public.share_catalog_entity(p_kind text,p_id uuid,p_expected_owner uuid,p_expected_snapshot jsonb,
  p_expected_items uuid[],p_expected_skus uuid[],p_actor uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_recipe uuid; v_result jsonb;
begin
  perform pg_advisory_xact_lock(7258025800);
  case p_kind
    when 'sku' then select location_id into v_owner from public.vendor_items where id=p_id for update;
    when 'recipe' then select location_id into v_owner from public.recipes where id=p_id for no key update;
    when 'menu_item' then select location_id into v_owner from public.menu_items where id=p_id for update;
    else raise exception 'shop_owned:invalid_payload' using errcode='P0001';
  end case;
  if not found then raise exception 'shop_owned:not_found' using errcode='P0001'; end if;
  if v_owner is distinct from p_expected_owner then raise exception 'shop_owned:ownership_changed' using errcode='P0001'; end if;
  if v_owner is null then raise exception 'shop_owned:already_shared' using errcode='P0001'; end if;
  perform 1 from public.locations where id=v_owner for share nowait;
  for v_recipe in select unnest(public.catalog_share_recipe_ids(p_kind,p_id)) loop
    perform public.recipe_change_lock(v_recipe,(select location_id from public.recipes where id=v_recipe),null);
  end loop;
  if p_expected_snapshot is null or public.catalog_share_snapshot(p_kind,p_id) is distinct from p_expected_snapshot then
    raise exception 'recipe_version:dependencies_changed' using errcode='P0001';
  end if;
  case p_kind
    when 'sku' then v_result:=public.share_shop_sku(p_id,p_expected_owner,p_actor);
    when 'recipe' then v_result:=public.share_shop_recipe(p_id,p_expected_owner,p_actor,p_expected_items,p_expected_skus);
    when 'menu_item' then v_result:=public.share_shop_menu_item(p_id,p_expected_owner,p_actor,p_expected_skus);
  end case;
  return v_result;
exception when lock_not_available then
  raise exception 'recipe_version:dependencies_busy' using errcode='P0001';
end $$;
revoke all on function public.catalog_share_recipe_ids(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.catalog_share_snapshot(text,uuid),public.share_catalog_entity(text,uuid,uuid,jsonb,uuid[],uuid[],uuid) from public,anon,authenticated;
grant execute on function public.catalog_share_snapshot(text,uuid),public.share_catalog_entity(text,uuid,uuid,jsonb,uuid[],uuid[],uuid) to service_role;

commit;
