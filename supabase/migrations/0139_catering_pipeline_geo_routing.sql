-- Migration 0139_catering_pipeline_geo_routing
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Canonical reference: lib/catering/fulfillment-routing.ts + lib/portal/draft.ts createDraftFromIntake.

-- FR-b customer fulfillment routing: persist the geocoded pin + auto-routed marker on the lead.
-- location_id already carries the resolved fulfilling node (no new FK). Leads are mutable intake,
-- so plain nullable columns. RLS unchanged: catering_pipeline policies are column-agnostic and
-- intake writes are service-role (createDraftFromIntake).

ALTER TABLE public.catering_pipeline
  ADD COLUMN geo_lat            double precision,
  ADD COLUMN geo_lng            double precision,
  ADD COLUMN fulfillment_routed boolean NOT NULL DEFAULT false;
