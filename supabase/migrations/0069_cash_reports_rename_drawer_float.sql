-- Migration 0069_cash_reports_rename_drawer_float
-- Applied via Supabase MCP apply_migration on 2026-06-16.
-- Money model correction (Juan): count the WHOLE drawer; deposit = drawer − $200 float;
-- over/short = deposit − projected. Rename columns to match.

ALTER TABLE public.cash_reports RENAME COLUMN register_count_cents TO drawer_total_cents;
ALTER TABLE public.cash_reports RENAME COLUMN register_target_cents TO float_cents;
