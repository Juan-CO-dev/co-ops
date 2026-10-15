-- Catalog Phase 3a — 0262 real-SQL scenario. Run on the SIM ONLY (Task 12 Step 3) via execute_sql.
-- It ends with `raise exception 'recipe versions scenario: OK …'` so the whole transaction rolls back;
-- any other exception text is a failure.
do $$
declare
  v_actor   uuid;
  v_shop    uuid;
  v_other   uuid;
  v_recipe  uuid;
  v_sku     uuid;
  v_head0   uuid;
  v_res     jsonb;
  v_lines   jsonb;
  v_shop_v  uuid;
  v_head1   uuid;
  v_head2   uuid;
  v_product uuid;
  v_n       int;
  v_snap    jsonb;
  v_unrelated uuid;
  v_measure text;
  v_ri      public.recipe_inputs%rowtype;
begin
  select id into v_actor from public.users where active and role in ('owner', 'moo', 'cgs') order by id limit 1;
  select id into v_shop from public.locations where active order by id limit 1;
  select id into v_other from public.locations where active and id <> v_shop order by id limit 1;
  select r.id into v_recipe from public.recipes r
   where r.active and exists (select 1 from public.recipe_inputs ri where ri.recipe_id = r.id and ri.component_sku_id is not null)
   order by r.id limit 1;
  select component_sku_id into v_sku from public.recipe_inputs where recipe_id = v_recipe and component_sku_id is not null order by id limit 1;
  assert v_actor is not null and v_shop is not null and v_recipe is not null, 'scenario: sim has no actor / shop / recipe';
  select id into v_head0 from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  assert v_head0 is not null, 'scenario: no global baseline';

  -- (a) a shop version: the lines of the default with the first SKU line doubled.
  select jsonb_agg(jsonb_build_object('keep_id', ri.id, 'component_sku_id', ri.component_sku_id, 'component_item_id', ri.component_item_id,
           'component_product_id', ri.component_product_id,
           'quantity', case when ri.component_sku_id = v_sku then ri.quantity * 2 else ri.quantity end,
           'unit', ri.unit, 'each_container_label', ri.each_container_label, 'portioned', ri.portioned) order by ri.display_order, ri.id)
    into v_lines from public.recipe_inputs ri where ri.recipe_id = v_recipe;
  -- (a0) a save bound to a STALE dependency snapshot is refused before it writes anything.
  begin
    perform public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head0, 'scenario', v_actor, null, null, null,
                                       jsonb_set(public.recipe_change_snapshot(v_recipe, v_shop, v_lines), '{active_shops}', '[]'::jsonb));
    raise exception 'scenario: a stale snapshot was accepted';
  exception when others then
    if sqlerrm not like '%recipe_version:dependencies_changed%' then raise; end if;
  end;
  v_res := public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head0, 'scenario', v_actor, null, null, null,
                                      public.recipe_change_snapshot(v_recipe, v_shop, v_lines));
  v_shop_v := (v_res ->> 'version_id')::uuid;
  select count(*) into v_n from public.recipe_version_lines where version_id = v_shop_v;
  assert v_n = (select count(*) from public.recipe_inputs where recipe_id = v_recipe), 'scenario: shop version line count';
  assert (select based_on_version_id from public.recipe_versions where id = v_shop_v) = v_head0, 'scenario: shop based_on';

  -- (b) the same save again with a stale expectation (the shop now HAS a version) is refused.
  begin
    perform public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head0, null, v_actor, null, null, null,
                                       public.recipe_change_snapshot(v_recipe, v_shop, v_lines));
    raise exception 'scenario: stale save was accepted';
  exception when others then
    if sqlerrm not like '%recipe_version:version_changed%' then raise; end if;
  end;

  -- (c0) AUTHORSHIP (Astra 3a r4#1): the legacy builder's edit through the actor overload opens a version that
  -- records WHO, and retires its predecessor in the same name. (Runs first: later edits in this one transaction
  -- update that same head in place, by design.)
  set constraints all immediate;
  select * into v_ri from public.recipe_inputs where recipe_id = v_recipe and component_sku_id = v_sku order by id limit 1;
  perform public.update_recipe_input_atomic(v_ri.id, v_recipe, v_ri.component_sku_id, v_ri.component_item_id, v_ri.component_product_id,
    v_ri.quantity + 1, v_ri.unit, v_ri.each_container_label, v_ri.portioned,
    v_ri.component_sku_id, v_ri.component_item_id, v_ri.component_product_id, v_ri.quantity, v_ri.unit, v_ri.each_container_label, v_ri.portioned,
    v_actor);
  assert (select created_by from public.recipe_versions where recipe_id = v_recipe and location_id is null and active) = v_actor,
         'scenario: the legacy edit''s version records no author';
  assert (select retired_by from public.recipe_versions where id = v_head0) = v_actor, 'scenario: the retired head records no author';

  -- (c) a legacy GLOBAL line edit is journaled at statement end (constraints immediate stands in for COMMIT).
  set constraints all immediate;
  update public.recipe_inputs set quantity = quantity + 1 where recipe_id = v_recipe and component_sku_id = v_sku;
  select id into v_head1 from public.recipe_versions where recipe_id = v_recipe and location_id is null and active;
  assert v_head1 <> v_head0, 'scenario: the global edit opened no new head';
  assert (select valid_to from public.recipe_versions where id = v_head0) is not null, 'scenario: old head not closed';
  assert public.recipe_journal_lines_equal(v_recipe, v_head1), 'scenario: head lines differ from recipe_inputs';
  -- the shop version is untouched by the global edit
  assert (select active from public.recipe_versions where id = v_shop_v), 'scenario: shop version moved';

  -- (d) PROMOTE the shop's version: one transaction writes the new default AND returns the shop to it.
  v_res := public.save_recipe_version(v_recipe, null, '[]'::jsonb, v_head1, null, 'scenario promote', v_actor, null, null, v_shop_v,
                                      public.recipe_change_snapshot(v_recipe, null, v_lines));
  v_head2 := (v_res ->> 'version_id')::uuid;
  assert (v_res ->> 'returned_shop')::uuid = v_shop, 'scenario: promote did not name its source shop';
  assert not (select active from public.recipe_versions where id = v_shop_v), 'scenario: promote left the source shop on its own version';
  assert (select valid_to from public.recipe_versions where id = v_shop_v)
       = (select valid_from from public.recipe_versions where id = v_head2), 'scenario: source closed at a different instant than the default opened';
  assert (select promoted_from_version_id from public.recipe_versions where id = v_head2) = v_shop_v, 'scenario: promote lineage';
  assert public.recipe_journal_lines_equal(v_recipe, v_head2), 'scenario: promoted head differs from recipe_inputs';
  assert not exists (select 1 from public.recipe_versions where recipe_id = v_recipe and location_id = v_shop and active),
         'scenario: the source shop still has a live version';
  assert not (v_res -> 'changed_shops') @> to_jsonb(v_shop::text), 'scenario: the source shop was reported as changed';

  -- (e) back to default: a fresh shop version, then retired.
  v_res := public.save_recipe_version(v_recipe, v_shop, v_lines, null, v_head2, 'scenario', v_actor, null, null, null,
                                      public.recipe_change_snapshot(v_recipe, v_shop, v_lines));
  v_shop_v := (v_res ->> 'version_id')::uuid;
  begin
    perform public.retire_recipe_version(v_shop_v, v_shop, v_actor, jsonb_set(public.recipe_change_snapshot(v_recipe, v_shop, null), '{active_shops}', '[]'::jsonb));
    raise exception 'scenario: a stale-snapshot retire was accepted';
  exception when others then
    if sqlerrm not like '%recipe_version:dependencies_changed%' then raise; end if;
  end;
  perform public.retire_recipe_version(v_shop_v, v_shop, v_actor, public.recipe_change_snapshot(v_recipe, v_shop, null));
  assert not (select active from public.recipe_versions where id = v_shop_v), 'scenario: back to default did not retire';
  if v_other is not null then
    begin
      perform public.retire_recipe_version(v_shop_v, v_other, v_actor, public.recipe_change_snapshot(v_recipe, v_other, null));
      raise exception 'scenario: retire under the wrong shop was accepted';
    exception when others then
      if sqlerrm not like '%recipe_version:%' then raise; end if;
    end;
  end if;

  -- (f) the product rule holds for every line set: a product line in a vendor pack word is refused.
  select id into v_product from public.products where active order by id limit 1;
  if v_product is not null then
    begin
      perform public.save_recipe_version(v_recipe, v_shop, jsonb_build_array(jsonb_build_object(
                'component_product_id', v_product, 'quantity', 1, 'unit', 'case', 'portioned', false)),
              null, (select id from public.recipe_versions where recipe_id = v_recipe and location_id is null and active),
              null, v_actor, null, null, null,
              public.recipe_change_snapshot(v_recipe, v_shop, jsonb_build_array(jsonb_build_object('component_product_id', v_product))));
      raise exception 'scenario: a product line in a pack word was accepted';
    exception when others then
      if sqlerrm not like '%recipe_version:product_line_invalid:1%' then raise; end if; -- names the line
    end;
  end if;

  -- (g) SCOPED (lead decision (a)): an unrelated SKU's change leaves the snapshot alone; a closure SKU's change moves it.
  v_snap := public.recipe_change_snapshot(v_recipe, v_shop, v_lines);
  select vi.id into v_unrelated from public.vendor_items vi
   where vi.active
     and vi.id::text not in (select c.member_id from public.recipe_change_closure(v_recipe, v_shop, v_lines) c where c.member_kind = 'sku')
   order by vi.id limit 1;
  if v_unrelated is not null then
    update public.vendor_items set updated_at = now() + interval '1 second' where id = v_unrelated;
    assert public.recipe_change_snapshot(v_recipe, v_shop, v_lines) = v_snap, 'scenario: an unrelated SKU staled the snapshot';
  end if;
  update public.vendor_items set updated_at = now() + interval '2 seconds' where id = v_sku;
  assert public.recipe_change_snapshot(v_recipe, v_shop, v_lines) is distinct from v_snap, 'scenario: a closure SKU change did not move the snapshot';

  -- (h) FLAT-PACK MEASUREMENT is a dependency (Astra r3): a closure SKU's each_measure registry row moves the snapshot.
  select m.label into v_measure
    from public.vendor_items vi join public.measure_units m on m.label = vi.each_measure
   where vi.id::text in (select c.member_id from public.recipe_change_closure(v_recipe, v_shop, v_lines) c where c.member_kind = 'sku')
   order by m.label limit 1;
  if v_measure is not null then
    v_snap := public.recipe_change_snapshot(v_recipe, v_shop, v_lines);
    update public.measure_units set to_base_factor = to_base_factor * 2 where label = v_measure;
    assert public.recipe_change_snapshot(v_recipe, v_shop, v_lines) is distinct from v_snap, 'scenario: a flat-pack measure change did not move the snapshot';
  end if;

  -- (i) AN UNTOUCHED SHOP NEVER STALES A GLOBAL PREVIEW (Astra 3b r3#2): OTHER takes its own version naming a SKU
  -- nothing else here uses; a change to that SKU leaves the GLOBAL change's snapshot alone (OTHER is untouched by it).
  select vi.id into v_unrelated from public.vendor_items vi
   where vi.active
     and vi.id::text not in (select c.member_id from public.recipe_change_closure(v_recipe, null, v_lines) c where c.member_kind = 'sku')
   order by vi.id limit 1;
  if v_other is not null and v_unrelated is not null then
    perform public.save_recipe_version(v_recipe, v_other,
              jsonb_build_array(jsonb_build_object('component_sku_id', v_unrelated, 'quantity', 1, 'unit', 'oz', 'portioned', false)),
              null, (select id from public.recipe_versions where recipe_id = v_recipe and location_id is null and active),
              'scenario other', v_actor, null, null, null,
              public.recipe_change_snapshot(v_recipe, v_other, jsonb_build_array(jsonb_build_object('component_sku_id', v_unrelated))));
    v_snap := public.recipe_change_snapshot(v_recipe, null, v_lines);
    update public.vendor_items set updated_at = now() + interval '3 seconds' where id = v_unrelated;
    assert public.recipe_change_snapshot(v_recipe, null, v_lines) = v_snap, 'scenario: an untouched shop''s ingredient staled a global preview';
  end if;

  raise exception 'recipe versions scenario: OK (rolled back)';
end $$;
