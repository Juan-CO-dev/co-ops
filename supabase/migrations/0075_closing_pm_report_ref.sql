-- Migration 0075_closing_pm_report_ref
-- Applied via Supabase MCP apply_migration on 2026-06-17.
-- Canonical reference: lib/pm-report.ts (PM report closing checklist reference item).

-- Add "PM Report submitted" report-reference item to the live Standard Closing v2 template
-- for both locations: MEP (54ce1029-400e-4a92-9c2b-0ccb3b031f0a) and EM (d2cced11-b167-49fa-bab6-86ec9bf4ff09).
--
-- Template IDs confirmed via live query (type='closing', active=true, newest):
--   MEP: 876ba0f4-0b4f-4194-b82e-8fd84655222d  (Standard Closing v2)
--   EM:  da49d8ea-a1b2-4f11-b1bc-172dff9133a1  (Standard Closing v2)
--
-- Shape mirrors sibling report-reference items (cash_report at display_order=59):
--   station='Closing Manager', min_role_level=3, required=true, active=true,
--   expects_count=false, expects_photo=false
--   display_order=60 (max existing was 59 — cash_report)
--
-- Translations JSONB shape confirmed from sibling items (es.label key only, no es.station override).

insert into public.checklist_template_items
  (template_id, label, station, min_role_level, required, active,
   display_order, expects_count, expects_photo, report_reference_type, translations)
values
  (
    '876ba0f4-0b4f-4194-b82e-8fd84655222d',
    'PM Report submitted',
    'Closing Manager',
    3,
    true,
    true,
    60,
    false,
    false,
    'pm_report',
    '{"es": {"label": "Reporte PM enviado"}}'::jsonb
  ),
  (
    'da49d8ea-a1b2-4f11-b1bc-172dff9133a1',
    'PM Report submitted',
    'Closing Manager',
    3,
    true,
    true,
    60,
    false,
    false,
    'pm_report',
    '{"es": {"label": "Reporte PM enviado"}}'::jsonb
  );
