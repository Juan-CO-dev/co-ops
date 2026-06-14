-- Migration 0065_closing_midday_report_ref
-- Applied via Supabase MCP apply_migration on 2026-06-14.
-- Canonical reference: lib/prep.ts autoCompleteClosingMidDayRef; C.42/C.43.
--
-- Adds a "Mid-day Prep" report-reference item (report_reference_type='mid_day_prep')
-- to Standard Closing v2 at both locations, mirroring the AM Prep / Opening verified
-- ref items. Auto-completed (with a count of finalized mid-day instances) when a
-- mid-day prep report finalizes — see autoCompleteClosingMidDayRef.

INSERT INTO checklist_template_items
  (template_id, station, display_order, label, description, min_role_level,
   required, expects_count, expects_photo, active, report_reference_type, translations)
VALUES
  ('876ba0f4-0b4f-4194-b82e-8fd84655222d', 'Closing Manager', 58, 'Mid-day Prep', NULL, 3,
   true, false, false, true, 'mid_day_prep', '{"es":{"label":"Preparación de mediodía"}}'::jsonb),
  ('da49d8ea-a1b2-4f11-b1bc-172dff9133a1', 'Closing Manager', 58, 'Mid-day Prep', NULL, 3,
   true, false, false, true, 'mid_day_prep', '{"es":{"label":"Preparación de mediodía"}}'::jsonb);

INSERT INTO audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
SELECT '16329556-900e-4cbb-b6e0-1829c6f4a6ed', 'cgs', 'checklist_template.update',
       'checklist_templates', i.template_id, false,
       jsonb_build_object(
         'phase', '3_module_1_c43_mid_day_prep',
         'reason', 'add Mid-day Prep report-reference item (auto-tick + count)',
         'migration', '0065_closing_midday_report_ref',
         'template_item_id', i.id,
         'report_reference_type', 'mid_day_prep'
       )
FROM checklist_template_items i
WHERE i.report_reference_type = 'mid_day_prep' AND i.label = 'Mid-day Prep';
