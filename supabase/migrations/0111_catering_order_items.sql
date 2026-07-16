-- Migration 0111_catering_order_items
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 D4; inventory spine items/menu_items (0103).
-- Wave 0: real line items linked to the items/menu_items spine (the catering_orders.items
-- text blob stays as a human note). location_id denormalized from the parent order for
-- RLS. Append-only (money rows immutable — draft-edit semantics are a Wave 1 concern).
-- Also adds catering_orders.pipeline_id (won -> order link). At most one of item/menu_item.

ALTER TABLE public.catering_orders
  ADD COLUMN pipeline_id uuid REFERENCES public.catering_pipeline(id);

CREATE TABLE public.catering_order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.catering_orders(id),
  location_id      uuid NOT NULL REFERENCES public.locations(id),
  item_id          uuid REFERENCES public.items(id),
  menu_item_id     uuid REFERENCES public.menu_items(id),
  description      text,
  quantity         numeric NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users(id),
  CONSTRAINT catering_order_items_one_ref CHECK (item_id IS NULL OR menu_item_id IS NULL)
);

CREATE INDEX catering_order_items_order ON public.catering_order_items (order_id, display_order);

ALTER TABLE public.catering_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY catering_order_items_read ON public.catering_order_items FOR SELECT
  USING (location_id = ANY (public.current_user_locations()) OR public.current_user_role_level() >= 9);

CREATE POLICY catering_order_items_insert ON public.catering_order_items FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 6 AND location_id = ANY (public.current_user_locations()));

CREATE POLICY catering_order_items_no_user_update ON public.catering_order_items FOR UPDATE USING (false);
CREATE POLICY catering_order_items_no_user_delete ON public.catering_order_items FOR DELETE USING (false);
