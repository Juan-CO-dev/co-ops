-- 0216 receiving store runs / pending new items.
-- AUTHORED ONLY 2026-10-07. NOT APPLIED. Named CC/Juan approval gate before apply.
-- Preflight: inspect live vendors/vendor_items/sku_pack_levels columns and policy
-- definitions and routine_privileges; verify lineage 0215 before applying.
-- Existing vendors/vendor_items RLS policies and grants are unchanged (0058).
-- New writers are service-role ONLY, matching 0203/0211, with app role/location
-- checks and SQL row-scope validation. No history rewrite, deletion, or recipe
-- repinning: existing explicit recipe pins retain their established semantics.
-- Price provenance reuses 0177 vendor_price_history.source = 'store_run'.

alter table public.vendors add column source_kind text not null default 'vendor'
  check (source_kind in ('vendor', 'store'));
create unique index vendors_store_name_uq on public.vendors (lower(btrim(name)))
  where source_kind = 'store';
alter table public.vendor_items add column pending_review boolean not null default false;
alter table public.vendor_items add column receiving_request_id uuid null unique;
create index vendor_items_pending_review_ix on public.vendor_items(location_id, id)
  where pending_review and active;

create function public.receiving_create_store(p_name text, p_actor uuid, p_location uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_store public.vendors%rowtype;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 160 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.vendors(name, source_kind, active, created_by, updated_by)
    values (btrim(p_name), 'store', true, p_actor, p_actor)
    on conflict (lower(btrim(name))) where source_kind = 'store' do nothing
    returning * into v_store;
  if found then return jsonb_build_object('id', v_store.id, 'name', v_store.name, 'created', true); end if;
  select * into v_store from public.vendors where source_kind = 'store'
    and lower(btrim(name)) = lower(btrim(p_name)) for update;
  -- Never silently reactivate a deliberately retired store.
  if not v_store.active then raise exception 'store_inactive'; end if;
  return jsonb_build_object('id', v_store.id, 'name', v_store.name, 'created', false);
end;
$$;

-- Internal narrow membership writer. Locks the reference before checking singleton
-- state, so concurrent store runs cannot split one reference across products.
-- A colliding product NAME is not evidence of identity: choose a unique name rather
-- than merging unrelated ingredients because their labels happen to match.
create function public.receiving_store_product(p_reference uuid, p_actor uuid, p_location uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ref public.vendor_items%rowtype; v_product uuid; v_name text; v_unit_oz numeric;
begin
  select * into v_ref from public.vendor_items where id = p_reference and active
    and not pending_review and (location_id is null or location_id = p_location) for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_ref.product_id is not null then
    perform 1 from public.products where id = v_ref.product_id and active for share;
    if not found then raise exception 'product_inactive'; end if;
    return v_ref.product_id;
  end if;
  v_product := gen_random_uuid();
  v_name := v_ref.name;
  -- A volume conversion is not evidence of the mass of one count unit.
  if exists (select 1 from public.measure_units where label = v_ref.each_measure and dimension = 'count') then
    v_unit_oz := v_ref.avg_oz_per_each;
  end if;
  begin
    insert into public.products(id, name, unit_oz, unit_oz_class, unit_oz_source_note,
      unit_oz_established_at, unit_oz_established_by, created_by, updated_by)
    values (v_product, v_name, v_unit_oz, case when v_unit_oz is not null then v_ref.weight_class end,
      case when v_unit_oz is not null then v_ref.weight_source_note end,
      case when v_unit_oz is not null then v_ref.weight_established_at end,
      case when v_unit_oz is not null then v_ref.weight_established_by end, p_actor, p_actor);
  exception when unique_violation then
    insert into public.products(id, name, unit_oz, unit_oz_class, unit_oz_source_note,
      unit_oz_established_at, unit_oz_established_by, created_by, updated_by)
    values (v_product, v_name || ' [' || v_product::text || ']', v_unit_oz,
      case when v_unit_oz is not null then v_ref.weight_class end,
      case when v_unit_oz is not null then v_ref.weight_source_note end,
      case when v_unit_oz is not null then v_ref.weight_established_at end,
      case when v_unit_oz is not null then v_ref.weight_established_by end, p_actor, p_actor);
  end;
  update public.vendor_items set product_id = v_product, updated_by = p_actor,
    updated_at = now() where id = p_reference;
  return v_product;
end;
$$;

create function public.receiving_create_store_item(p_store uuid, p_location uuid, p_actor uuid,
  p_reference uuid, p_name text, p_unit text, p_content_oz numeric, p_request uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ref public.vendor_items%rowtype; v_id uuid; v_product uuid; v_map jsonb;
begin
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Per-store serialization also protects same-product lookup+insert from races.
  perform 1 from public.vendors where id = p_store and source_kind = 'store' and active for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_reference is null then
    if p_request is null or p_name is null or length(btrim(p_name)) not between 1 and 160
      or p_unit is null or length(btrim(p_unit)) not between 1 and 40
      or (p_content_oz is not null and (p_content_oz <= 0 or p_content_oz::text in ('NaN','Infinity','-Infinity'))) then
      raise exception 'invalid_pending_item' using errcode = '22023';
    end if;
    -- Stable UI request identity retries a lost response without merging unrelated
    -- products merely because their labels match. Reusing a key for changed input
    -- refuses rather than silently returning a SKU with different pack semantics.
    select * into v_ref from public.vendor_items where receiving_request_id = p_request;
    if found then
      if v_ref.vendor_id <> p_store or v_ref.location_id is distinct from p_location
        or v_ref.name <> btrim(p_name) or v_ref.unit <> btrim(p_unit)
        or v_ref.avg_oz_per_each is distinct from p_content_oz or not v_ref.active then
        raise exception 'request_conflict';
      end if;
      return jsonb_build_object('id', v_ref.id, 'created', false, 'product_id', v_ref.product_id);
    end if;
    -- Free-text count labels are pack labels, never invented measure registry units.
    -- Each entered count is one unit; oz stays unknown unless the operator knows it.
    insert into public.vendor_items(vendor_id, location_id, name, unit, pack_format,
      units_per_pack, each_size, each_measure, each_container_label, avg_oz_per_each,
      inventory_only, pending_review, active, created_by, updated_by, receiving_request_id)
    values (p_store, p_location, btrim(p_name), btrim(p_unit), btrim(p_unit), 1, 1,
      'count', btrim(p_unit), p_content_oz, true, true, true, p_actor, p_actor, p_request)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'created', true, 'product_id', null);
  end if;
  select * into v_ref from public.vendor_items where id = p_reference and active
    and (location_id is null or location_id = p_location) for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_ref.vendor_id = p_store then
    return jsonb_build_object('id', v_ref.id, 'created', false, 'product_id', v_ref.product_id);
  end if;
  if v_ref.pending_review then raise exception 'pending_reference'; end if;
  v_product := public.receiving_store_product(p_reference, p_actor, p_location);
  select id into v_id from public.vendor_items where vendor_id = p_store and active
    and not pending_review and product_id = v_product
    and (location_id is null or location_id = p_location)
    order by location_id nulls last, id limit 1;
  if found then return jsonb_build_object('id', v_id, 'created', false, 'product_id', v_product); end if;
  insert into public.vendor_items(vendor_id, location_id, name, unit, unit_size, category,
    pack_format, units_per_pack, each_size, each_measure, each_container_label,
    avg_oz_per_each, weight_class, weight_source_note, weight_established_at,
    weight_established_by, sku_class, price_basis, product_id, inventory_only,
    active, created_by, updated_by)
  values (p_store, p_location, v_ref.name, v_ref.unit, v_ref.unit_size, v_ref.category,
    v_ref.pack_format, v_ref.units_per_pack, v_ref.each_size, v_ref.each_measure,
    v_ref.each_container_label, v_ref.avg_oz_per_each, v_ref.weight_class,
    v_ref.weight_source_note, v_ref.weight_established_at, v_ref.weight_established_by,
    v_ref.sku_class, v_ref.price_basis, v_product, true, true, p_actor, p_actor)
  returning id into v_id;
  -- Clone the pointer graph as a single statement; never point into another SKU's
  -- chain. Lock active source levels so a simultaneous pack rewrite cannot mix sets.
  perform 1 from public.sku_pack_levels where sku_id = p_reference and active order by id for update;
  select jsonb_object_agg(id::text, gen_random_uuid()::text) into v_map
    from public.sku_pack_levels where sku_id = p_reference and active;
  insert into public.sku_pack_levels(id, sku_id, label, contains_qty, contains_level_id,
    contains_measure_unit, display_ordinal, effective_from, active, created_by)
  select (v_map->>id::text)::uuid, v_id, label, contains_qty,
    (v_map->>contains_level_id::text)::uuid, contains_measure_unit, display_ordinal,
    now(), true, p_actor from public.sku_pack_levels where sku_id = p_reference and active;
  return jsonb_build_object('id', v_id, 'created', true, 'product_id', v_product);
end;
$$;

-- Identity merge, not a delivery/history rewrite. Keeps this store's independent
-- prices and pack basis, and makes the received stock a member of the chosen product.
create function public.receiving_resolve_pending_item(p_sku uuid, p_reference uuid,
  p_location uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_sku public.vendor_items%rowtype; v_product uuid;
begin
  if p_sku = p_reference then raise exception 'invalid_reference' using errcode = '22023'; end if;
  -- Total row lock order avoids two review requests deadlocking on swapped ids.
  perform 1 from public.vendor_items where id in (p_sku, p_reference) order by id for update;
  select * into v_sku from public.vendor_items where id = p_sku and active
    and location_id = p_location and pending_review;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_sku.product_id is not null then raise exception 'already_member'; end if;
  perform 1 from public.vendors where id = v_sku.vendor_id and source_kind = 'store' and active;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_product := public.receiving_store_product(p_reference, p_actor, p_location);
  update public.vendor_items set product_id = v_product, pending_review = false,
    updated_at = now(), updated_by = p_actor where id = p_sku;
  return v_product;
end;
$$;

revoke all on function public.receiving_create_store(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.receiving_store_product(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.receiving_create_store_item(uuid,uuid,uuid,uuid,text,text,numeric,uuid) from public, anon, authenticated;
revoke all on function public.receiving_resolve_pending_item(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.receiving_create_store(text,uuid,uuid) to service_role;
grant execute on function public.receiving_store_product(uuid,uuid,uuid) to service_role;
grant execute on function public.receiving_create_store_item(uuid,uuid,uuid,uuid,text,text,numeric,uuid) to service_role;
grant execute on function public.receiving_resolve_pending_item(uuid,uuid,uuid,uuid) to service_role;
