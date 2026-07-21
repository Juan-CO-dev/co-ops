-- Migration 0140_catering_prep_demand_released_at
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Canonical reference: lib/catering/surplus.ts + lib/catering/prep-demand.ts releasePrepDemand.

-- W4c-a surplus signal: stamp when a reservation releases, so surplus can be classified by the
-- 72h prep-start window (need_date − released_at). Nullable; set by releasePrepDemand. RLS unchanged
-- (catering_prep_demand policies are column-agnostic; writes are service-role).

ALTER TABLE public.catering_prep_demand
  ADD COLUMN released_at timestamptz;
