-- Migration 0117_catering_delivery_zones
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1A; D6 (delivery zones+fees).
-- Per-location delivery zones with a fee (integer cents) + optional minimum order. Read at
-- quote time (1E) and ambient-FAQ at address entry (Wave 2). Deny-all RLS (service-role lib).

CREATE TABLE public.catering_delivery_zones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES public.locations(id),
  slug            text NOT NULL,
  label_en        text NOT NULL,
  label_es        text,
  fee_cents       integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  min_order_cents integer CHECK (min_order_cents IS NULL OR min_order_cents >= 0),
  active          boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX catering_delivery_zones_one_active
  ON public.catering_delivery_zones (location_id, slug) WHERE active;

ALTER TABLE public.catering_delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_delivery_zones_no_user_select ON public.catering_delivery_zones FOR SELECT USING (false);
CREATE POLICY catering_delivery_zones_no_user_insert ON public.catering_delivery_zones FOR INSERT WITH CHECK (false);
CREATE POLICY catering_delivery_zones_no_user_update ON public.catering_delivery_zones FOR UPDATE USING (false);
CREATE POLICY catering_delivery_zones_no_user_delete ON public.catering_delivery_zones FOR DELETE USING (false);
