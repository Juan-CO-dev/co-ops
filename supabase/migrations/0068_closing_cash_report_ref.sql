-- Migration 0068_closing_cash_report_ref
-- Applied via Supabase MCP apply_migration on 2026-06-16.
-- Canonical reference: lib/prep.ts reconcileClosingReportRefs (cash branch); C.42.
--
-- Adds a "Cash deposited" report-reference item (report_reference_type='cash_report')
-- to Standard Closing v2 at both locations, mirroring the Mid-day Prep / AM Prep /
-- Opening verified ref items. Auto-ticked (pull reconcile) when a live cash_report
-- exists for the same day — see reconcileClosingReportRefs cash branch.
-- display_order=59 places it immediately after Mid-day Prep (58).

INSERT INTO checklist_template_items
  (template_id, station, display_order, label, description, min_role_level,
   required, expects_count, expects_photo, active, report_reference_type, translations)
SELECT
  t.id,
  'Closing Manager',
  59,
  'Cash deposited',
  NULL,
  3,
  true,
  false,
  false,
  true,
  'cash_report',
  '{"es":{"label":"Efectivo depositado"}}'::jsonb
FROM checklist_templates t
WHERE t.id IN (
  '876ba0f4-0b4f-4194-b82e-8fd84655222d',
  'da49d8ea-a1b2-4f11-b1bc-172dff9133a1'
)
AND NOT EXISTS (
  SELECT 1 FROM checklist_template_items i
  WHERE i.template_id = t.id
    AND i.report_reference_type = 'cash_report'
);

INSERT INTO audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
SELECT '16329556-900e-4cbb-b6e0-1829c6f4a6ed', 'cgs', 'checklist_template.update',
       'checklist_templates', i.template_id, false,
       jsonb_build_object(
         'phase', '3_module_cash_deposit_task_12',
         'reason', 'add Cash deposited report-reference item (closing auto-tick)',
         'migration', '0068_closing_cash_report_ref',
         'template_item_id', i.id,
         'report_reference_type', 'cash_report'
       )
FROM checklist_template_items i
WHERE i.report_reference_type = 'cash_report' AND i.label = 'Cash deposited';
