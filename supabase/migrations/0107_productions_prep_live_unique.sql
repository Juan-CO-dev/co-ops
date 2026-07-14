-- Migration 0107_productions_prep_live_unique
-- Applied via Supabase MCP apply_migration on 2026-07-13.
-- Canonical reference: 2026-07-11 dual-repo audit (backlog item 10);
--   lib/prep-consumption.ts recordProductionFromPrep.
--
-- productions_prep_live_idx was a PLAIN partial index — no DB backstop against two
-- live headers for the same (instance_id, template_item_id). recordProductionFromPrep
-- supersede-then-inserts on that key; a failed or racing supersede could leave two
-- live headers -> loadSkuConsumption / loadInStockPacks double-count depletion. Make it
-- UNIQUE. Verified 0 existing duplicate live groups pre-apply. Manual productions
-- (instance_id NULL) are unaffected — NULLs are distinct in a unique index.
drop index if exists public.productions_prep_live_idx;
create unique index productions_prep_live_idx
  on public.productions (instance_id, template_item_id)
  where (superseded_at is null and revoked_at is null);
