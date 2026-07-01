-- Migration 0104_reparent_composed_items
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-recipe-stage-design.md §6
-- Reparent every item with item_components into a production recipe (+inputs+outputs).
-- yield = the item's batch_yield so the repointed engine's per-unit oz is identical.
-- Guarded pre-apply: no duplicate names among composed items (the recipe↔item join is by name).

with composed as (
  select distinct i.id as item_id, i.name, i.name_es, coalesce(i.batch_yield,1) as by_
  from items i join item_components ic on ic.item_id = i.id
),
new_recipe as (
  insert into recipes (id, name, name_es, recipe_type, batch_yield, active, created_by)
  select gen_random_uuid(), c.name, c.name_es, 'production', c.by_, true, null
  from composed c
  returning id, name
),
mapped as (
  select nr.id as recipe_id, c.item_id, c.by_
  from new_recipe nr join composed c on c.name = nr.name
),
ins_inputs as (
  insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, quantity, unit, display_order, created_by)
  select m.recipe_id, ic.component_sku_id, ic.component_item_id, ic.quantity, ic.unit, ic.display_order, null
  from mapped m join item_components ic on ic.item_id = m.item_id
  returning 1
)
insert into recipe_outputs (recipe_id, output_item_id, yield, output_container_label, display_order, created_by)
select m.recipe_id, m.item_id, m.by_, (select default_par_unit from items where id = m.item_id), 0, null
from mapped m;
