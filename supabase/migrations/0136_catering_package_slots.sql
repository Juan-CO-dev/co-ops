-- Migration 0136_catering_package_slots
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/superpowers/specs/2026-07-19-w1b-catering-package-builder-design.md
--                      + lib/admin/catering/packages.ts
--
-- W1b: a package line is a locked FIXED item (spine-linked ref) or an interchangeable CHOICE SLOT
-- (pick N from a designated eligible group). slot_type discriminates; the eligible group lives in
-- catering_package_slot_options.

-- 1. slot_type on the line: 'fixed' (a specific/locked item) | 'choice' (a pick-N slot).
ALTER TABLE public.catering_package_items
  ADD COLUMN slot_type text NOT NULL DEFAULT 'fixed'
  CHECK (slot_type IN ('fixed','choice'));

-- 2. The eligible options for a choice slot. An option is ALWAYS a concrete item (exactly one FK).
CREATE TABLE public.catering_package_slot_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_item_id  uuid NOT NULL REFERENCES public.catering_package_items(id),
  item_id          uuid REFERENCES public.items(id),
  menu_item_id     uuid REFERENCES public.menu_items(id),
  display_order    integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users(id),
  CONSTRAINT catering_package_slot_options_one_ref CHECK ((item_id IS NULL) <> (menu_item_id IS NULL))
);

CREATE INDEX catering_package_slot_options_package_item
  ON public.catering_package_slot_options (package_item_id) WHERE active;

ALTER TABLE public.catering_package_slot_options ENABLE ROW LEVEL SECURITY;
-- Deny-all to end users; service-role only (the lib is the authority), like the other catering-KB tables.
