-- Migration 0109_catering_money_cents
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 D2; house money model lib/i18n/format.ts (toCents/formatCents).
-- Wave 0 scaffold repair: catering money moves to the house integer-cents model.
-- Tables are empty (0 rows) so drop+add is clean — no backfill, no data loss.

ALTER TABLE public.catering_pipeline DROP COLUMN estimated_revenue;
ALTER TABLE public.catering_pipeline ADD COLUMN estimated_revenue_cents integer
  CHECK (estimated_revenue_cents IS NULL OR estimated_revenue_cents >= 0);

ALTER TABLE public.catering_orders DROP COLUMN amount;
ALTER TABLE public.catering_orders ADD COLUMN amount_cents integer
  CHECK (amount_cents IS NULL OR amount_cents >= 0);
