-- Migration 0115_catering_packages
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1A (KB foundation), D6/D21; template = categories deny-all RLS + catering_order_items XOR-FK (0111).
-- KB config: catering PACKAGES (config rows, integer cents, EN/ES display) + package line items
-- that reference the sellable spine leaves (items / menu_items) via the same XOR-FK as
-- catering_order_items — never re-model the menu. location_id NULL = global (template),
-- set = location-specific. Deny-all RLS: all reads/writes go through service-role admin lib.

CREATE TABLE public.catering_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid REFERENCES public.locations(id),
  slug            text NOT NULL,
  label_en        text NOT NULL,
  label_es        text,
  description_en  text,
  description_es  text,
  pricing_mode    text NOT NULL CHECK (pricing_mode IN ('per_head','per_platter','fixed')),
  price_cents     integer NOT NULL CHECK (price_cents >= 0),
  min_headcount   integer CHECK (min_headcount IS NULL OR min_headcount > 0),
  lead_time_hours integer CHECK (lead_time_hours IS NULL OR lead_time_hours >= 0),
  active          boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX catering_packages_one_active
  ON public.catering_packages (COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
  WHERE active;
CREATE INDEX catering_packages_active_order ON public.catering_packages (active, display_order);

ALTER TABLE public.catering_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_packages_no_user_select ON public.catering_packages FOR SELECT USING (false);
CREATE POLICY catering_packages_no_user_insert ON public.catering_packages FOR INSERT WITH CHECK (false);
CREATE POLICY catering_packages_no_user_update ON public.catering_packages FOR UPDATE USING (false);
CREATE POLICY catering_packages_no_user_delete ON public.catering_packages FOR DELETE USING (false);

CREATE TABLE public.catering_package_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id    uuid NOT NULL REFERENCES public.catering_packages(id),
  item_id       uuid REFERENCES public.items(id),
  menu_item_id  uuid REFERENCES public.menu_items(id),
  description   text,
  quantity      numeric NOT NULL CHECK (quantity > 0),
  display_order integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users(id),
  CONSTRAINT catering_package_items_one_ref CHECK (item_id IS NULL OR menu_item_id IS NULL)
);
CREATE INDEX catering_package_items_package ON public.catering_package_items (package_id, display_order);

ALTER TABLE public.catering_package_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_package_items_no_user_select ON public.catering_package_items FOR SELECT USING (false);
CREATE POLICY catering_package_items_no_user_insert ON public.catering_package_items FOR INSERT WITH CHECK (false);
CREATE POLICY catering_package_items_no_user_update ON public.catering_package_items FOR UPDATE USING (false);
CREATE POLICY catering_package_items_no_user_delete ON public.catering_package_items FOR DELETE USING (false);
