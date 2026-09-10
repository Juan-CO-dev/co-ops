-- Migration 0201_angel_wave7_apply_bundle
-- AUTHORED 2026-09-10; NOT APPLIED. CC applies to sim, then production on Juan's word.
-- Provenance: reviewed wave7-angel-import-plan.RESPONSE.md sections 4, 5, 7 and 9;
-- CC decision: one service-role-only transactional writer for seed 26.
-- No data is imported by applying this migration. The RPC records ONE destructive
-- sku.angel_import audit row per operation; historical prices/chains remain intact.
-- No app role can execute either function (0132/0189 explicit revoke law).
begin;

create or replace function public.angel_wave7_snapshot(p_sku_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_sku jsonb; v_vendor jsonb; v_chain jsonb; v_price jsonb;
begin
  if p_sku_id is null then
    -- Actual deployed schema, not a fixture: caller validates every required column/type.
    return jsonb_build_object('capability', 'angel-wave7-atomic-v1', 'columns', (
      select jsonb_agg(jsonb_build_object('table_name', table_name,
        'column_name', column_name, 'data_type', data_type, 'udt_name', udt_name)
        order by table_name, ordinal_position)
      from information_schema.columns where table_schema = 'public'
        and table_name in ('vendor_items','vendors','sku_pack_levels',
          'vendor_price_history','audit_log','measure_units')));
  end if;
  select to_jsonb(s) into v_sku from public.vendor_items s where id = p_sku_id;
  select to_jsonb(v) into v_vendor from public.vendors v where id = (v_sku->>'vendor_id')::uuid;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb) into v_chain
    from public.sku_pack_levels c where sku_id = p_sku_id and active;
  select to_jsonb(p) into v_price from public.vendor_price_history p
    where vendor_item_id = p_sku_id
    order by effective_date desc, recorded_at desc, id desc limit 1;
  return jsonb_build_object('sku',v_sku,'vendor',v_vendor,'chain',v_chain,'price',v_price);
end $$;

create or replace function public.angel_wave7_apply_bundle(
  p_sku_id uuid, p_operation_id uuid, p_price_id uuid,
  p_expected jsonb, p_bundle jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_before jsonb; v_after jsonb; v_existing jsonb; v_chain jsonb;
  v_node jsonb; v_root jsonb; v_weight jsonb; v_seen uuid[] := '{}';
  v_id uuid; v_next uuid; v_count integer; v_roots integer; v_units numeric := 1;
  v_leaf_size numeric; v_leaf_measure text; v_price numeric; v_date date;
  v_now timestamptz; v_expected_after jsonb; v_new_price jsonb; v_written integer;
begin
  if p_sku_id is null or p_operation_id is null or p_price_id is null
    or jsonb_typeof(p_expected) is distinct from 'object'
    or jsonb_typeof(p_bundle) is distinct from 'object'
    or p_bundle->>'source' is distinct from 'angel-wave7-2026-09-10'
    or nullif(p_bundle->>'revision','') is null then
    raise exception 'SOURCE_PAYLOAD_DRIFT';
  end if;

  -- Ordinary app chain writers do not lock the parent. Brief table write locks
  -- close that hole and block price inserts between our head check and commit.
  -- Always acquire in this order; the seed calls one bundle per transaction.
  lock table public.sku_pack_levels, public.vendor_price_history in share row exclusive mode;
  perform 1 from public.vendor_items where id = p_sku_id for update;
  if not found then return jsonb_build_object('status','SKU_UNRESOLVED'); end if;
  perform 1 from public.vendors where id = (
    select vendor_id from public.vendor_items where id = p_sku_id) for share;
  v_before := public.angel_wave7_snapshot(p_sku_id);

  select metadata into v_existing from public.audit_log where id = p_operation_id;
  if found then
    if v_existing->'bundle' is distinct from p_bundle
      or v_existing->>'price_id' is distinct from p_price_id::text
      or v_existing->>'sku_id' is distinct from p_sku_id::text
      or v_existing->'expected' is distinct from p_expected then
      return jsonb_build_object('status','SOURCE_PAYLOAD_DRIFT');
    end if;
    if v_existing->'result' is distinct from v_before then
      return jsonb_build_object('status','PACK_SHAPE_CHANGED');
    end if;
    return jsonb_build_object('status','ALREADY_CORRECT','snapshot',v_before);
  end if;
  if v_before is distinct from p_expected then
    return jsonb_build_object('status','PACK_SHAPE_CHANGED');
  end if;
  if (v_before#>>'{sku,active}')::boolean is distinct from true then
    return jsonb_build_object('status','SKU_UNRESOLVED');
  end if;
  if (v_before#>>'{vendor,active}')::boolean is distinct from true then
    return jsonb_build_object('status','VENDOR_UNREGISTERED');
  end if;
  if exists(select 1 from public.vendor_price_history where id = p_price_id) then
    return jsonb_build_object('status','SOURCE_PAYLOAD_DRIFT');
  end if;
  v_price := (p_bundle#>>'{price,unit_price}')::numeric;
  v_date := (p_bundle#>>'{price,effective_date}')::date;
  if v_price is null or v_price <= 0 or v_price::text in ('NaN','Infinity','-Infinity')
    or v_date is null or nullif(p_bundle#>>'{price,source_note}','') is null then
    raise exception 'INVALID_SOURCE_DATA';
  end if;
  if (v_before#>>'{price,effective_date}')::date > v_date then
    return jsonb_build_object('status','NEWER_PRICE_EXISTS');
  end if;
  if p_bundle->>'previous_price_id' is not null
    and p_bundle->>'previous_price_id' is distinct from v_before#>>'{price,id}' then
    return jsonb_build_object('status','PACK_SHAPE_CHANGED');
  end if;
  if v_before#>>'{price,source}' = p_bundle->>'source'
    and p_bundle->>'previous_price_id' is null then
    return jsonb_build_object('status','SOURCE_PAYLOAD_DRIFT');
  end if;
  v_chain := nullif(p_bundle->'chain','null'::jsonb);
  v_weight := nullif(p_bundle->'weight','null'::jsonb);
  if v_weight is not null then
    if v_before#>>'{sku,weight_class}' = 'OPERATIONAL' then
      return jsonb_build_object('status','OPERATIONAL_KEEP_LIVE');
    end if;
    if v_before#>>'{sku,avg_oz_per_each}' is not null
      and coalesce(v_before#>>'{sku,weight_class}','') not in ('ESTIMATE','SPEC') then
      return jsonb_build_object('status',case when v_before#>>'{sku,weight_class}' = 'INVOICE_DERIVED'
        then 'SOURCE_PAYLOAD_DRIFT' else 'WEIGHT_EVIDENCE_UNCLASSIFIED' end);
    end if;
    if (v_weight->>'avg_oz_per_each')::numeric is null
      or (v_weight->>'avg_oz_per_each')::numeric <= 0
      or (v_weight->>'avg_oz_per_each')::numeric::text in ('NaN','Infinity','-Infinity')
      or nullif(v_weight->>'weight_source_note','') is null
      or (v_weight->>'weight_established_at')::timestamptz is null then
      raise exception 'INVALID_SOURCE_DATA';
    end if;
  end if;

  if v_chain is not null then
    if jsonb_typeof(v_chain) <> 'array' or jsonb_array_length(v_chain) = 0 then
      raise exception 'INVALID_CHAIN';
    end if;
    v_count := jsonb_array_length(v_chain);
    if (select count(distinct x->>'id') from jsonb_array_elements(v_chain) x) <> v_count
      or (select count(distinct x->>'label') from jsonb_array_elements(v_chain) x) <> v_count then
      raise exception 'INVALID_CHAIN';
    end if;
    for v_node in select value from jsonb_array_elements(v_chain) loop
      if nullif(btrim(v_node->>'label'),'') is null
        or v_node->>'label' <> btrim(v_node->>'label')
        or (v_node->>'contains_qty')::numeric is null
        or (v_node->>'contains_qty')::numeric <= 0
        or (v_node->>'contains_qty')::numeric::text in ('NaN','Infinity','-Infinity')
        or num_nonnulls(v_node->>'contains_level_id',v_node->>'contains_measure_unit') <> 1
        or exists(select 1 from public.measure_units where active and label = v_node->>'label') then
        raise exception 'INVALID_CHAIN';
      end if;
    end loop;
    select count(*) into v_roots from jsonb_array_elements(v_chain) x
      where not exists(select 1 from jsonb_array_elements(v_chain) y
        where y->>'contains_level_id' = x->>'id');
    if v_roots <> 1 then raise exception 'INVALID_CHAIN'; end if;
    select x into v_root from jsonb_array_elements(v_chain) x
      where not exists(select 1 from jsonb_array_elements(v_chain) y
        where y->>'contains_level_id' = x->>'id');
    v_node := v_root;
    loop
      v_id := (v_node->>'id')::uuid;
      if v_id is null or v_id = any(v_seen) then raise exception 'INVALID_CHAIN'; end if;
      v_seen := array_append(v_seen,v_id);
      v_next := (v_node->>'contains_level_id')::uuid;
      if v_next is null then
        v_leaf_size := (v_node->>'contains_qty')::numeric;
        v_leaf_measure := v_node->>'contains_measure_unit';
        if not exists(select 1 from public.measure_units where active and label = v_leaf_measure)
          or cardinality(v_seen) <> v_count then raise exception 'INVALID_CHAIN'; end if;
        if coalesce(v_before#>>'{sku,sku_class}','raw') = 'raw' and exists(
          select 1 from public.measure_units where label = v_leaf_measure and dimension <> 'weight')
          and coalesce((v_weight->>'avg_oz_per_each')::numeric,
            (v_before#>>'{sku,avg_oz_per_each}')::numeric,0) <= 0 then
          raise exception 'INVALID_CHAIN: raw leaf needs ounce basis';
        end if;
        exit;
      end if;
      v_units := v_units * (v_node->>'contains_qty')::numeric;
      select x into v_node from jsonb_array_elements(v_chain) x where (x->>'id')::uuid = v_next;
      if v_node is null then raise exception 'INVALID_CHAIN'; end if;
    end loop;
    -- Legacy units_per_pack is integer. A fractional middle tier cannot mirror honestly.
    if v_units <> trunc(v_units) or v_units > 2147483647 then raise exception 'INVALID_CHAIN'; end if;
  end if;

  v_now := clock_timestamp();
  v_expected_after := v_before->'sku';
  if v_chain is not null then
    update public.sku_pack_levels set active = false where sku_id = p_sku_id and active;
    insert into public.sku_pack_levels
      (id,sku_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)
    select (x->>'id')::uuid,p_sku_id,x->>'label',(x->>'contains_qty')::numeric,
      (x->>'contains_level_id')::uuid,x->>'contains_measure_unit',
      coalesce((x->>'display_ordinal')::integer,0),v_now,true,null
      from jsonb_array_elements(v_chain) x;
    v_expected_after := v_expected_after || jsonb_build_object(
      'pack_format',coalesce(v_before#>>'{sku,pack_format}',v_root->>'label'),
      'units_per_pack',v_units,'each_size',v_leaf_size,'each_measure',v_leaf_measure);
  end if;
  if v_weight is not null then
    v_expected_after := v_expected_after || jsonb_build_object(
      'avg_oz_per_each',(v_weight->>'avg_oz_per_each')::numeric,'weight_class','INVOICE_DERIVED',
      'weight_source_note',v_weight->>'weight_source_note',
      'weight_established_at',(v_weight->>'weight_established_at')::timestamptz,'weight_established_by',null);
  end if;
  if v_chain is not null or v_weight is not null then
    update public.vendor_items set
      pack_format = v_expected_after->>'pack_format',
      units_per_pack = (v_expected_after->>'units_per_pack')::integer,
      each_size = (v_expected_after->>'each_size')::numeric, each_measure = v_expected_after->>'each_measure',
      avg_oz_per_each = (v_expected_after->>'avg_oz_per_each')::numeric,
      weight_class = v_expected_after->>'weight_class', weight_source_note = v_expected_after->>'weight_source_note',
      weight_established_at = (v_expected_after->>'weight_established_at')::timestamptz,
      weight_established_by = (v_expected_after->>'weight_established_by')::uuid
      where id = p_sku_id;
    get diagnostics v_written = row_count;
    if v_written <> 1 then raise exception 'PACK_SHAPE_CHANGED'; end if;
  end if;
  insert into public.vendor_price_history
    (id,vendor_item_id,unit_price,effective_date,recorded_at,recorded_by,source,source_note)
    values(p_price_id,p_sku_id,v_price,v_date,v_now,null,p_bundle->>'source',p_bundle#>>'{price,source_note}')
    returning to_jsonb(vendor_price_history) into v_new_price;
  v_after := public.angel_wave7_snapshot(p_sku_id);
  if (v_new_price->>'unit_price')::numeric is distinct from v_price
    or v_after->'price' is distinct from v_new_price
    or v_after->'sku' is distinct from v_expected_after
    or v_after->'vendor' is distinct from v_before->'vendor' then
    raise exception 'PACK_SHAPE_CHANGED: post-write verification failed';
  end if;
  if v_chain is null and v_after->'chain' is distinct from v_before->'chain' then
    raise exception 'PACK_SHAPE_CHANGED: untouched chain changed';
  end if;
  if v_chain is not null and (
    jsonb_array_length(v_after->'chain') <> jsonb_array_length(v_chain)
    or exists(select 1 from jsonb_array_elements(v_chain) x where not exists(
      select 1 from jsonb_array_elements(v_after->'chain') y where y @> x))) then
    raise exception 'INVALID_CHAIN: post-write verification failed';
  end if;
  -- Audit is transactional here: failure MUST abort this SKU bundle.
  insert into public.audit_log(id,actor_id,actor_role,action,resource_table,resource_id,destructive,metadata)
    values(p_operation_id,null,null,'sku.angel_import','vendor_items',p_sku_id,true,
      jsonb_build_object('actor_context','seed_apply','source',p_bundle->>'source',
        'operation_id',p_operation_id,'price_id',p_price_id,'sku_id',p_sku_id,
        'expected',p_expected,'bundle',p_bundle,'result',v_after));
  return jsonb_build_object('status','APPLIED','snapshot',v_after);
end $$;

revoke all on function public.angel_wave7_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.angel_wave7_apply_bundle(uuid,uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.angel_wave7_snapshot(uuid) to service_role;
grant execute on function public.angel_wave7_apply_bundle(uuid,uuid,uuid,jsonb,jsonb) to service_role;
do $$ begin
  if exists(select 1 from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name in ('angel_wave7_snapshot','angel_wave7_apply_bundle')
    and grantee in ('PUBLIC','anon','authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0201: unexpected Angel RPC execute grant';
  end if;
end $$;
commit;
