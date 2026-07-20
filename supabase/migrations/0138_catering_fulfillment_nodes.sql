-- Migration 0138_catering_fulfillment_nodes
-- Applied via Supabase MCP apply_migration on 2026-07-20.
-- Canonical reference: docs/superpowers/specs/2026-07-20-fr-a-fulfillment-nodes-design.md
--                      + lib/admin/catering/fulfillment.ts
--
-- FR-a: each catering-serving store's delivery zone = a center point + radius. One row per
-- store (a location with no row is not a catering node). Mutable config (lib upserts in place).

CREATE TABLE public.catering_fulfillment_nodes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id             uuid NOT NULL REFERENCES public.locations(id),
  lat                     double precision NOT NULL,
  lng                     double precision NOT NULL,
  delivery_radius_meters  integer NOT NULL CHECK (delivery_radius_meters > 0),
  offers_delivery         boolean NOT NULL DEFAULT true,
  offers_pickup           boolean NOT NULL DEFAULT true,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES public.users(id),
  CONSTRAINT catering_fulfillment_nodes_one_per_location UNIQUE (location_id)
);

ALTER TABLE public.catering_fulfillment_nodes ENABLE ROW LEVEL SECURITY;
-- Read: staff (>=5). FR-b's customer read is service-role (added there). Writes: service-role only.
CREATE POLICY catering_fulfillment_nodes_read ON public.catering_fulfillment_nodes FOR SELECT
  USING (public.current_user_role_level() >= 5);
CREATE POLICY catering_fulfillment_nodes_no_user_insert ON public.catering_fulfillment_nodes FOR INSERT WITH CHECK (false);
CREATE POLICY catering_fulfillment_nodes_no_user_update ON public.catering_fulfillment_nodes FOR UPDATE USING (false);
CREATE POLICY catering_fulfillment_nodes_no_user_delete ON public.catering_fulfillment_nodes FOR DELETE USING (false);
