-- Executed only by the leased F4 SIM Management-API runner, after 0264/0265.
-- Inner subtransaction rolls back all synthetic identities. The outer transaction
-- also rolls back. Only the exact deliberate marker is accepted, never any error.
begin;
set local statement_timeout='30s';
do $$
declare a uuid; s uuid; k uuid; n uuid; r jsonb; p jsonb; rs jsonb; sw jsonb;
  before_ids jsonb; after_ids jsonb; marker boolean := false;
begin
  select id into a from public.users where active order by id limit 1;
  select id into s from public.locations where active order by id limit 1;
  assert a is not null and s is not null, 'catalog fixture prerequisites missing';
  select jsonb_build_array((select count(*) from vendor_items),(select count(*) from recipes),
    (select count(*) from menu_items),(select count(*) from recipe_versions),
    (select count(*) from sku_swaps),(select count(*) from sku_swap_ends)) into before_ids;
  begin
    k := (create_catalog_sku(jsonb_build_object('name','F4 rollback old '||gen_random_uuid()),null,null,a,null)->>'id')::uuid;
    n := (create_catalog_sku(jsonb_build_object('name','F4 rollback new '||gen_random_uuid()),null,null,a,null)->>'id')::uuid;
    r := create_shop_sandwich(jsonb_build_object('name','F4 rollback sandwich '||gen_random_uuid(),'menu_price',12),
      jsonb_build_object('name','F4 rollback recipe','recipe_type','consumer','batch_yield',1),
      jsonb_build_array(jsonb_build_object('component_sku_id',k,'quantity',4,'unit','oz','portioned',false)),a,null);
    p := sku_swap_product_snapshot(k,n,s);
    rs := sku_swap_recipe_snapshot(k,n,s);
    select jsonb_agg(x || jsonb_build_object('replacement_lines',
      (select jsonb_agg(l || jsonb_build_object('component_sku_id',case when l->>'component_sku_id'=k::text then n::text else l->>'component_sku_id' end)) from jsonb_array_elements(x->'lines') l)))
      into rs from jsonb_array_elements(rs) x;
    sw := start_sku_swap(k,n,s,a,p,rs,true,null);
    assert (select count(*) from sku_swaps where id=(sw->>'swap_id')::uuid)=1, 'swap did not persist';
    assert end_sku_swap((sw->>'swap_id')::uuid,a)->>'primary'='restored', 'restore failed';
    assert (select count(*) from sku_swap_ends where swap_id=(sw->>'swap_id')::uuid)=1, 'end did not persist';
    assert not exists(select 1 from recipe_versions where recipe_id=(r->>'id')::uuid and location_id=s and active), 'inheritance not restored';
    begin
      perform end_sku_swap((sw->>'swap_id')::uuid,a);
      raise exception 'expected_not_live_missing';
    exception when raise_exception then
      if sqlerrm <> 'swap:not_live' then raise; end if;
    end;
    assert (select count(*) from sku_swap_ends where swap_id=(sw->>'swap_id')::uuid)=1, 'refusal mutated end journal';
    raise exception 'catalog_rollback_marker';
  exception when raise_exception then
    if sqlerrm <> 'catalog_rollback_marker' then raise; end if;
    marker := true;
  end;
  select jsonb_build_array((select count(*) from vendor_items),(select count(*) from recipes),
    (select count(*) from menu_items),(select count(*) from recipe_versions),
    (select count(*) from sku_swaps),(select count(*) from sku_swap_ends)) into after_ids;
  assert marker and before_ids=after_ids, 'rollback identity counts changed';
end $$;
rollback;
select 'catalog_rollback_marker' as marker, true as identity_counts_unchanged;
