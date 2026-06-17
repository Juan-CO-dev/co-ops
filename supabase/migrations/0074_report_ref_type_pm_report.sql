-- Migration 0074_report_ref_type_pm_report
-- Applied via Supabase MCP apply_migration on 2026-06-17.
-- Canonical reference: lib/pm-report.ts (PM report closing checklist reference).

-- Add 'pm_report' to the report_type_enum Postgres enum.
-- NOTE: The column checklist_template_items.report_reference_type is typed as
-- report_type_enum (not 'report_reference_type' — that is only the column name).
-- Confirmed via pg_attribute + pg_type query before authoring.
-- Enum value additions must be applied alone in their own transaction
-- (cannot be used in the same transaction they are added in Postgres).
-- Applied as a standalone migration for this reason.
-- Prior values: am_prep, mid_day_prep, cash_report, opening_report, training_report, special_report.

alter type public.report_type_enum add value if not exists 'pm_report';
