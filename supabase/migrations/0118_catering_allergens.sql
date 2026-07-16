-- Migration 0118_catering_allergens
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1A; D6 allergen matrix; XOR-FK shape = catering_order_items (0111).
-- A registry of universal allergen types (seeded inline — these are standard, NOT tenant-specific)
-- + an allergen matrix that attaches to the sellable spine leaves (items OR menu_items, exactly one
-- via XOR-FK). Allergen data is a SAFETY/liability artifact — edited at GM tier (L7, flagged) and
-- surfaced on labels/quotes with "unverified" when absent (absence != safe). Deny-all RLS.

CREATE TABLE public.catering_allergen_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  label_en      text NOT NULL,
  label_es      text,
  active        boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users(id)
);

ALTER TABLE public.catering_allergen_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_allergen_types_no_user_select ON public.catering_allergen_types FOR SELECT USING (false);
CREATE POLICY catering_allergen_types_no_user_insert ON public.catering_allergen_types FOR INSERT WITH CHECK (false);
CREATE POLICY catering_allergen_types_no_user_update ON public.catering_allergen_types FOR UPDATE USING (false);
CREATE POLICY catering_allergen_types_no_user_delete ON public.catering_allergen_types FOR DELETE USING (false);

-- Standard allergen registry (universal reference data, like measure_units — not tenant-specific).
INSERT INTO public.catering_allergen_types (slug, label_en, label_es, display_order) VALUES
  ('peanuts',    'Peanuts',      'Cacahuates',      10),
  ('tree_nuts',  'Tree Nuts',    'Frutos secos',    20),
  ('milk',       'Milk / Dairy', 'Leche / Lácteos', 30),
  ('eggs',       'Eggs',         'Huevo',           40),
  ('wheat',      'Wheat / Gluten','Trigo / Gluten',  50),
  ('soy',        'Soy',          'Soya',            60),
  ('fish',       'Fish',         'Pescado',         70),
  ('shellfish',  'Shellfish',    'Mariscos',        80),
  ('sesame',     'Sesame',       'Ajonjolí',        90)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE public.catering_allergens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          uuid REFERENCES public.items(id),
  menu_item_id     uuid REFERENCES public.menu_items(id),
  allergen_type_id uuid NOT NULL REFERENCES public.catering_allergen_types(id),
  presence         text NOT NULL DEFAULT 'contains' CHECK (presence IN ('contains','may_contain')),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users(id),
  CONSTRAINT catering_allergens_one_ref CHECK (
    (item_id IS NOT NULL AND menu_item_id IS NULL) OR (item_id IS NULL AND menu_item_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX catering_allergens_one_active
  ON public.catering_allergens (COALESCE(item_id, menu_item_id), allergen_type_id) WHERE active;

ALTER TABLE public.catering_allergens ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_allergens_no_user_select ON public.catering_allergens FOR SELECT USING (false);
CREATE POLICY catering_allergens_no_user_insert ON public.catering_allergens FOR INSERT WITH CHECK (false);
CREATE POLICY catering_allergens_no_user_update ON public.catering_allergens FOR UPDATE USING (false);
CREATE POLICY catering_allergens_no_user_delete ON public.catering_allergens FOR DELETE USING (false);
