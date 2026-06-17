-- Migration 0071_standardize_fridge_temp_labels
-- Applied via Supabase MCP apply_migration on 2026-06-16.
-- Wave 2 Maintenance Log (Task 3): standardize fridge temp-item display labels
-- across the opening + closing reports to a single canonical form per fridge
-- ("<Fridge Name> temp (≤41°F)", EN + ES). Label-only — item ids, stations,
-- and expects_count are preserved (the system key for "is a fridge temp item"
-- is expects_count=true, NOT the label; see AGENTS.md system-key vs display-string).
-- Fixes the prior ambiguity where Walk-In / Crunchy Boi / 3rd-Party opening
-- items all shared "Station fridge holding temp (≤41°F)". Mapping is driven by
-- the maintenance_equipment registry (item ids), not fragile label matching.
-- NOTE: these labels are ALSO hardcoded in seed-opening-template-v1.ts and
-- seed-closing-template-v2-c49-additions.ts (marker comments added in the same
-- PR). Those seeds are convergent; a re-run with stale constants would revert
-- this standardization — update the constants (and verify the script's
-- idempotency match key) before any re-run.

WITH names(en_name, es_name) AS (
  VALUES
    ('Walk-In Fridge', 'Refri walk-in'),
    ('3-Door Fridge', 'Refri de 3 puertas'),
    ('Sauce Fridge', 'Refri de salsas'),
    ('Deli Display Fridge', 'Refri de exhibición de fiambres'),
    ('Crunchy Boi Fridge', 'Refri Crunchy Boi'),
    ('FOH Drinks Fridge', 'Refri de bebidas del frente'),
    ('Back-Line Drinks Fridge', 'Refri de bebidas de la línea trasera'),
    ('3rd-Party Fridge', 'Refri de terceros')
),
target_items AS (
  SELECT me.opening_temp_item_id AS item_id, n.en_name, n.es_name
  FROM maintenance_equipment me JOIN names n ON n.en_name = me.name
  WHERE me.kind = 'fridge' AND me.opening_temp_item_id IS NOT NULL
  UNION ALL
  SELECT me.closing_temp_item_id AS item_id, n.en_name, n.es_name
  FROM maintenance_equipment me JOIN names n ON n.en_name = me.name
  WHERE me.kind = 'fridge' AND me.closing_temp_item_id IS NOT NULL
)
UPDATE checklist_template_items cti
SET
  label = ti.en_name || ' temp (≤41°F)',
  translations = coalesce(cti.translations, '{}'::jsonb)
    || jsonb_build_object(
         'es',
         coalesce(cti.translations -> 'es', '{}'::jsonb)
           || jsonb_build_object('label', ti.es_name || ' temp (≤41°F)')
       )
FROM target_items ti
WHERE cti.id = ti.item_id;

INSERT INTO audit_log (actor_id, actor_role, action, resource_table, resource_id, before_state, after_state, metadata, destructive)
VALUES (
  '16329556-900e-4cbb-b6e0-1829c6f4a6ed',
  'cgs',
  'checklist_template.update',
  'checklist_template_items',
  NULL,
  NULL,
  NULL,
  jsonb_build_object(
    'actor_context', 'migration_apply',
    'migration', '0071_standardize_fridge_temp_labels',
    'phase', '3_wave_2_maintenance_log',
    'reason', 'Standardize fridge temp-item labels to "<Fridge Name> temp (≤41°F)" (EN+ES) across opening + closing reports for cross-report naming consistency (Juan: fully-identical option).',
    'affected_item_count', 32,
    'canonical_names', jsonb_build_array('Walk-In Fridge','3-Door Fridge','Sauce Fridge','Deli Display Fridge','Crunchy Boi Fridge','FOH Drinks Fridge','Back-Line Drinks Fridge','3rd-Party Fridge'),
    'label_only', true,
    'ip_address', null,
    'user_agent', null
  ),
  false
);
