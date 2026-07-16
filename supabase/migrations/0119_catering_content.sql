-- Migration 0119_catering_content
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1A; D6 (FAQ), D26 (food-facts).
-- KB content tables (NOT columns on menu_items — keep content config/seed + template-deployable):
--   catering_faq       — Q/A content (EN/ES), optional location scope, the ambient-FAQ + concierge source.
--   catering_food_facts — flavor/story per sellable leaf (EN/ES). D26: FLAVOR ONLY, never a dietary/allergen
--                         claim (dietary/allergen truth lives in catering_allergens, the structured matrix).
-- Deny-all RLS (service-role lib). Both feed the same KB the portal ambient-FAQ + concierge will read.

CREATE TABLE public.catering_faq (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid REFERENCES public.locations(id),
  slug          text NOT NULL,
  question_en   text NOT NULL,
  question_es   text,
  answer_en     text NOT NULL,
  answer_es     text,
  active        boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX catering_faq_one_active
  ON public.catering_faq (COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), slug) WHERE active;

ALTER TABLE public.catering_faq ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_faq_no_user_select ON public.catering_faq FOR SELECT USING (false);
CREATE POLICY catering_faq_no_user_insert ON public.catering_faq FOR INSERT WITH CHECK (false);
CREATE POLICY catering_faq_no_user_update ON public.catering_faq FOR UPDATE USING (false);
CREATE POLICY catering_faq_no_user_delete ON public.catering_faq FOR DELETE USING (false);

CREATE TABLE public.catering_food_facts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid REFERENCES public.items(id),
  menu_item_id uuid REFERENCES public.menu_items(id),
  body_en      text NOT NULL,
  body_es      text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.users(id),
  CONSTRAINT catering_food_facts_one_ref CHECK (
    (item_id IS NOT NULL AND menu_item_id IS NULL) OR (item_id IS NULL AND menu_item_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX catering_food_facts_one_active
  ON public.catering_food_facts (COALESCE(item_id, menu_item_id)) WHERE active;

ALTER TABLE public.catering_food_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_food_facts_no_user_select ON public.catering_food_facts FOR SELECT USING (false);
CREATE POLICY catering_food_facts_no_user_insert ON public.catering_food_facts FOR INSERT WITH CHECK (false);
CREATE POLICY catering_food_facts_no_user_update ON public.catering_food_facts FOR UPDATE USING (false);
CREATE POLICY catering_food_facts_no_user_delete ON public.catering_food_facts FOR DELETE USING (false);
