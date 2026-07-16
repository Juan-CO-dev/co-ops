-- Migration 0123_items_catering_flags
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering identity arc PR-2 (Juan-approved 2026-07-16, answer #2 —
-- catering menu = a flag on the item registry, one source of truth that still traces to
-- inventory/production, NOT a separate table).
--
-- catering_available: the item is offered à la carte on the catering menu (unit price seeds
-- from items.menu_price, overridable per quote line). catering_only: catering-available AND
-- hidden from the regular menu/sale surfaces. catering_only implies catering_available.

ALTER TABLE public.items
  ADD COLUMN catering_available boolean NOT NULL DEFAULT false,
  ADD COLUMN catering_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.items
  ADD CONSTRAINT items_catering_only_implies_available
  CHECK (NOT catering_only OR catering_available);

CREATE INDEX items_catering_available ON public.items (catering_available) WHERE catering_available;
