-- Migration 0097_recipe_model_fields
-- Applied via Supabase MCP apply_migration on 2026-06-29.
-- Canonical reference: docs/superpowers/specs/2026-06-28-r1-composition-recipe-upgrade-design.md §5
-- R1 recipe model: items.tracking_type/batch_yield/oz_per_par_unit,
-- vendor_items.avg_oz_per_each, measure_units.dimension/to_base_factor (+ backfill).
-- NOTE: items.kind is intentionally NOT dropped here — that is the post-deploy
-- migration 0098 (avoids breaking old-code item inserts during the deploy window).

-- items: recipe-model axes
alter table items add column tracking_type text not null default 'portioned'
  check (tracking_type in ('on_hand','portioned','line'));
alter table items add column batch_yield numeric not null default 1
  check (batch_yield > 0);
alter table items add column oz_per_par_unit numeric;

-- vendor_items: oz per one each_measure unit (entered for count/volume; null for weight)
alter table vendor_items add column avg_oz_per_each numeric;

-- measure_units: dimension + factor to the dimension's base (weight→oz, volume→fl oz, count→each)
alter table measure_units add column dimension text;
alter table measure_units add column to_base_factor numeric;

update measure_units set dimension='weight', to_base_factor=1         where label='oz';
update measure_units set dimension='weight', to_base_factor=16        where label='lb';
update measure_units set dimension='weight', to_base_factor=0.035274  where label='gram';
update measure_units set dimension='weight', to_base_factor=35.27396  where label='kg';
update measure_units set dimension='volume', to_base_factor=1         where label='fl oz';
update measure_units set dimension='volume', to_base_factor=128       where label='gallon';
update measure_units set dimension='volume', to_base_factor=0.033814  where label='mL';
update measure_units set dimension='volume', to_base_factor=33.814    where label='liter';
update measure_units set dimension='count',  to_base_factor=1         where label='count';

-- lock them down now that the 9 are backfilled (new adds must supply both)
alter table measure_units alter column dimension set not null;
alter table measure_units add constraint measure_units_dimension_check
  check (dimension in ('weight','volume','count'));
alter table measure_units alter column to_base_factor set not null;
