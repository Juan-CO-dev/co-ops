-- AUTHORED ONLY. Execute only in the SIM database after 0216 is applied there.
-- Never run against production. This harness inserts isolated fixtures inside a
-- transaction and rolls all of them back, even on an assertion error (ON_ERROR_STOP
-- closes the connection with an aborted transaction).
-- Example: psql <SIM connection supplied externally> -v ON_ERROR_STOP=1
--   -c "set co_ops.simulation = 'receiving-store-runs'" -f scripts/receiving-store-runs-sim.sql
-- No credential belongs in this file. No migration is applied by this script.
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_location uuid; v_other_location uuid; v_vendor uuid; v_store uuid;
  v_reference uuid; v_new uuid; v_product uuid; v_pending uuid;
  v_leaf uuid := gen_random_uuid(); v_root uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid(); v_result jsonb; v_replay jsonb;
  v_name text := 'receiving-sim-' || gen_random_uuid()::text;
  v_count integer;
begin
  assert current_setting('co_ops.simulation', true) = 'receiving-store-runs',
    'Explicit simulation session marker required; never run on production';
  select id into v_location from public.locations where active order by id limit 1;
  select id into v_other_location from public.locations where active and id <> v_location order by id limit 1;
  assert v_location is not null and v_other_location is not null, 'Requires two active SIM locations';
  assert exists (select 1 from public.measure_units where label = 'count' and dimension = 'count'), 'count registry contract';
  assert exists (select 1 from public.measure_units where label = 'oz' and dimension = 'weight'), 'oz registry contract';

  v_result := public.receiving_create_store(v_name, null, v_location);
  v_store := (v_result->>'id')::uuid;
  assert (v_result->>'created')::boolean, 'first store is new';
  v_replay := public.receiving_create_store(upper(v_name), null, v_location);
  assert (v_replay->>'id')::uuid = v_store and not (v_replay->>'created')::boolean, 'case-insensitive dedupe';

  insert into public.vendors(name, active) values (v_name || '-vendor', true) returning id into v_vendor;
  insert into public.vendor_items(vendor_id, location_id, name, pack_format,
    units_per_pack, each_size, each_measure, each_container_label, avg_oz_per_each, active)
  values (v_vendor, v_location, v_name || '-ingredient', 'case', 6, 8, 'oz', 'jar', null, true)
  returning id into v_reference;
  insert into public.sku_pack_levels(id, sku_id, label, contains_qty, contains_measure_unit, display_ordinal)
    values (v_leaf, v_reference, 'jar', 8, 'oz', 1);
  insert into public.sku_pack_levels(id, sku_id, label, contains_qty, contains_level_id, display_ordinal)
    values (v_root, v_reference, 'case', 6, v_leaf, 0);

  v_result := public.receiving_create_store_item(v_store, v_location, null, v_reference, null, null, null, null);
  v_new := (v_result->>'id')::uuid;
  v_product := (v_result->>'product_id')::uuid;
  assert v_new <> v_reference and v_product is not null, 'new store SKU and singleton grouping';
  assert (select product_id = v_product from public.vendor_items where id = v_reference), 'reference is a member';
  assert (select vendor_id = v_store and location_id = v_location and inventory_only
    and not pending_review and units_per_pack = 6 and each_size = 8 and each_measure = 'oz'
    and pack_format = 'case' and each_container_label = 'jar'
    from public.vendor_items where id = v_new), 'independent store SKU with copied basis';
  assert (select count(*) = 2 from public.sku_pack_levels where sku_id = v_new and active), 'whole chain copied';
  assert exists (select 1 from public.sku_pack_levels root join public.sku_pack_levels leaf
    on leaf.id = root.contains_level_id where root.sku_id = v_new and leaf.sku_id = v_new
    and root.label = 'case' and root.contains_qty = 6 and leaf.contains_qty = 8
    and leaf.contains_measure_unit = 'oz' and leaf.id <> v_leaf and root.id <> v_root), 'pointer graph remapped';
  v_replay := public.receiving_create_store_item(v_store, v_location, null, v_reference, null, null, null, null);
  assert (v_replay->>'id')::uuid = v_new and not (v_replay->>'created')::boolean, 'store product reuse';
  begin
    perform public.receiving_create_store_item(v_store, v_other_location, null, v_reference, null, null, null, null);
    raise exception 'Expected inaccessible reference to fail';
  exception when no_data_found then null;
  end;
  begin
    perform public.receiving_create_store_item(v_vendor, v_location, null, v_reference, null, null, null, null);
    raise exception 'Expected ordinary vendor to fail store writer';
  exception when no_data_found then null;
  end;

  v_result := public.receiving_create_store_item(v_store, v_location, null, null, v_name || '-new', 'jar', 12, v_request);
  v_pending := (v_result->>'id')::uuid;
  assert (select pending_review and product_id is null and inventory_only and each_measure = 'count'
    and units_per_pack = 1 and each_size = 1 and avg_oz_per_each = 12
    from public.vendor_items where id = v_pending), 'pending count basis resolves one jar to 12 oz';
  v_replay := public.receiving_create_store_item(v_store, v_location, null, null, v_name || '-new', 'jar', 12, v_request);
  assert (v_replay->>'id')::uuid = v_pending and not (v_replay->>'created')::boolean, 'pending request replay';
  begin
    perform public.receiving_create_store_item(v_store, v_location, null, null, v_name || '-new', 'jar', 13, v_request);
    raise exception 'Expected changed request payload to fail' using errcode = '22023';
  exception when raise_exception then null;
  end;
  assert public.receiving_resolve_pending_item(v_pending, v_reference, v_location, null) = v_product,
    'GM resolution joins reference identity';
  assert (select not pending_review and active and vendor_id = v_store and avg_oz_per_each = 12
    and product_id = v_product from public.vendor_items where id = v_pending), 'resolution preserves store basis and history identity';
  select count(*) into v_count from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in ('receiving_create_store', 'receiving_store_product',
      'receiving_create_store_item', 'receiving_resolve_pending_item') and grantee in ('PUBLIC','anon','authenticated');
  assert v_count = 0, 'RPCs must be service-only';
  raise notice 'Receiving store run simulation assertions passed; rolling back all fixtures';
end;
$$;
rollback;
