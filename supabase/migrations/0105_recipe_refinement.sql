-- Migration 0105_recipe_refinement
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-recipe-stage-refinement-design.md
-- (1) SKU each-container label; (2) sold-directly item fields; (3) create_recipe_full atomic RPC.

-- 1. SKU each-container label ("Bottle") — one physical each-shape per SKU.
alter table vendor_items add column each_container_label text;

-- 2. Sold-directly production item (antipasta side): flag + sell portion + unit.
--    menu_price already exists on items (reused; was vestigial post-#107).
alter table items add column sold_directly boolean not null default false;
alter table items add column sell_portion numeric check (sell_portion is null or sell_portion > 0);
alter table items add column sell_portion_unit text;

-- 3. create_recipe_full — atomic header + inputs + outputs insert (draft-then-save-once).
--    App layer (lib/recipes.ts createRecipeFull) validates exactly-one + cycle guard BEFORE
--    calling this; the table CHECK constraints are the backstop (any bad row rolls back the txn).
--    SECURITY DEFINER + locked search_path; service-role only (revoke from anon/authenticated).
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb;
begin
  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by
  ) returning id into v_recipe_id;

  for r in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, quantity, unit, each_container_label, portioned, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'component_sku_id','')::uuid, nullif(r->>'component_item_id','')::uuid,
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

  return v_recipe_id;
end $$;

revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from anon;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from authenticated;
grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
