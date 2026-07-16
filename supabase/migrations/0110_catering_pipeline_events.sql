-- Migration 0110_catering_pipeline_events
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 D3; append-only pattern lib/cash.ts:146-210.
-- Wave 0: stage transitions become append-only events (the lead row stays a mutable
-- CRM row per D3). location_id is denormalized from the parent pipeline for clean RLS
-- scoping (avoids the fragile embedded-select-in-RLS pattern). The stage CHECK already
-- exists on catering_pipeline (verified live) — not re-added here.

CREATE TABLE public.catering_pipeline_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.catering_pipeline(id),
  location_id uuid REFERENCES public.locations(id),
  from_stage  text CHECK (from_stage IS NULL OR from_stage IN ('inquiry','quote_sent','confirmed','completed','lost')),
  to_stage    text NOT NULL CHECK (to_stage IN ('inquiry','quote_sent','confirmed','completed','lost')),
  note        text,
  actor_id    uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX catering_pipeline_events_pipeline ON public.catering_pipeline_events (pipeline_id, created_at);

ALTER TABLE public.catering_pipeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY catering_pipeline_events_read ON public.catering_pipeline_events FOR SELECT
  USING (location_id IS NULL OR location_id = ANY (public.current_user_locations()) OR public.current_user_role_level() >= 9);

CREATE POLICY catering_pipeline_events_insert ON public.catering_pipeline_events FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 6 AND (location_id IS NULL OR location_id = ANY (public.current_user_locations())));

CREATE POLICY catering_pipeline_events_no_user_update ON public.catering_pipeline_events FOR UPDATE USING (false);
CREATE POLICY catering_pipeline_events_no_user_delete ON public.catering_pipeline_events FOR DELETE USING (false);
