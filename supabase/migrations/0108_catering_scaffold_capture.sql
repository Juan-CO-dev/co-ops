-- Migration 0108_catering_scaffold_capture
-- Captured retroactively 2026-07-16 from the live DB (project bgcvurheqzylyfehqgzh).
-- The catering CRM scaffold (catering_customers, catering_pipeline, catering_orders,
-- customer_feedback) was applied to the live database at an earlier point WITHOUT a
-- committed migration file. This records that pre-existing baseline for repo-ledger
-- honesty. DOCUMENTATION OF EFFECT — NOT re-applied (the objects already exist).
-- Wave 0 migrations 0109+ build on top of this baseline.
-- Canonical reference: CHIEF 03-PROJECTS/co-ops/2026-07-15-coops-catering-module-ground-truth.md

-- ===================== catering_customers =====================
CREATE TABLE public.catering_customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  company             text,
  contact_person      text,
  email               text,
  phone               text,
  primary_location_id uuid REFERENCES public.locations(id),
  notes               text,
  active              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  created_by          uuid REFERENCES public.users(id)
);
ALTER TABLE public.catering_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_customers_read ON public.catering_customers FOR SELECT
  USING (primary_location_id = ANY (public.current_user_locations()) OR public.current_user_role_level() >= 9);
CREATE POLICY catering_customers_insert ON public.catering_customers FOR INSERT
  WITH CHECK (primary_location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 6);
CREATE POLICY catering_customers_update ON public.catering_customers FOR UPDATE
  USING (primary_location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 6)
  WITH CHECK (primary_location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 6);
CREATE POLICY catering_customers_no_user_delete ON public.catering_customers FOR DELETE USING (false);

-- ===================== catering_pipeline (money col shown as ORIGINAL numeric; 0109 moves it to cents) =====================
CREATE TABLE public.catering_pipeline (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid REFERENCES public.catering_customers(id),
  contact_name      text NOT NULL,
  company           text,
  event_date        date,
  headcount         integer,
  estimated_revenue numeric,
  stage             text NOT NULL CHECK (stage IN ('inquiry','quote_sent','confirmed','completed','lost')),
  lead_source       text,
  location_id       uuid REFERENCES public.locations(id),
  notes             text,
  follow_up_date    date,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
ALTER TABLE public.catering_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_pipeline_read ON public.catering_pipeline FOR SELECT
  USING (location_id IS NULL OR location_id = ANY (public.current_user_locations()) OR public.current_user_role_level() >= 9);
CREATE POLICY catering_pipeline_insert ON public.catering_pipeline FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 6 AND (location_id IS NULL OR location_id = ANY (public.current_user_locations())));
CREATE POLICY catering_pipeline_update ON public.catering_pipeline FOR UPDATE
  USING (public.current_user_role_level() >= 6 AND (location_id IS NULL OR location_id = ANY (public.current_user_locations())))
  WITH CHECK (public.current_user_role_level() >= 6 AND (location_id IS NULL OR location_id = ANY (public.current_user_locations())));
CREATE POLICY catering_pipeline_no_user_delete ON public.catering_pipeline FOR DELETE USING (false);

-- ===================== catering_orders (money col shown as ORIGINAL numeric; 0109 moves it to cents) =====================
CREATE TABLE public.catering_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.catering_customers(id),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  order_date  date NOT NULL,
  amount      numeric,
  headcount   integer,
  items       text,
  rating      text CHECK (rating IN ('great','good','issue','problem')),
  notes       text,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.catering_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_orders_read ON public.catering_orders FOR SELECT
  USING (location_id = ANY (public.current_user_locations()) OR public.current_user_role_level() >= 9);
CREATE POLICY catering_orders_insert ON public.catering_orders FOR INSERT
  WITH CHECK (location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 6);
CREATE POLICY catering_orders_update ON public.catering_orders FOR UPDATE
  USING (location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 6)
  WITH CHECK (location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 6);
CREATE POLICY catering_orders_no_user_delete ON public.catering_orders FOR DELETE USING (false);

-- ===================== customer_feedback =====================
CREATE TABLE public.customer_feedback (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id            uuid REFERENCES public.locations(id),
  submitted_at           timestamptz DEFAULT now(),
  rating                 integer CHECK (rating >= 1 AND rating <= 5),
  category               text,
  comment                text,
  customer_email         text,
  customer_phone         text,
  follow_up_needed       boolean DEFAULT false,
  follow_up_assigned_to  uuid REFERENCES public.users(id),
  follow_up_completed_at timestamptz,
  follow_up_notes        text
);
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_feedback_read ON public.customer_feedback FOR SELECT
  USING (location_id = ANY (public.current_user_locations()) OR public.current_user_role_level() >= 9);
CREATE POLICY customer_feedback_insert ON public.customer_feedback FOR INSERT
  WITH CHECK (location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 3);
CREATE POLICY customer_feedback_update ON public.customer_feedback FOR UPDATE
  USING (location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 3)
  WITH CHECK (location_id = ANY (public.current_user_locations()) AND public.current_user_role_level() >= 3);
CREATE POLICY customer_feedback_no_user_delete ON public.customer_feedback FOR DELETE USING (false);
