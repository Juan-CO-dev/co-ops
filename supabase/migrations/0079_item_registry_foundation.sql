-- Migration 0079_item_registry_foundation
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: docs/superpowers/specs/2026-06-22-item-registry-foundation-design.md
-- (Item/Inventory Spine sub-project 1 — registry foundation, behind the scenes.)

CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES public.locations(id),
  kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('sku_direct','composite','manual')),
  name text NOT NULL,
  name_es text,
  section text,
  default_par numeric,
  default_par_unit text,
  unit text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX items_location_active_idx ON public.items (location_id, active);
CREATE INDEX items_location_name_section_idx ON public.items (location_id, lower(name), section);

CREATE TABLE public.item_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id),
  component_sku_id uuid REFERENCES public.vendor_items(id),
  component_item_id uuid REFERENCES public.items(id),
  quantity numeric NOT NULL,
  unit text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT item_components_exactly_one_ref CHECK (
    ((component_sku_id IS NOT NULL)::int + (component_item_id IS NOT NULL)::int) = 1
  )
);
CREATE INDEX item_components_item_idx ON public.item_components (item_id);

ALTER TABLE public.checklist_template_items
  ADD COLUMN item_id uuid REFERENCES public.items(id);
CREATE INDEX checklist_template_items_item_id_idx ON public.checklist_template_items (item_id);

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_no_user_insert ON public.items FOR INSERT WITH CHECK (false);
CREATE POLICY items_no_user_update ON public.items FOR UPDATE USING (false);
CREATE POLICY items_no_user_delete ON public.items FOR DELETE USING (false);

CREATE POLICY item_components_no_user_insert ON public.item_components FOR INSERT WITH CHECK (false);
CREATE POLICY item_components_no_user_update ON public.item_components FOR UPDATE USING (false);
CREATE POLICY item_components_no_user_delete ON public.item_components FOR DELETE USING (false);
