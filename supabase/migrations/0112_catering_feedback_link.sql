-- Migration 0112_catering_feedback_link
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 D15.
-- Wave 0: catering satisfaction consolidates into customer_feedback via a nullable FK to
-- the catering order + the category='catering' convention. catering_orders.rating
-- (great/good/issue/problem) is deprecated: kept nullable, no longer written.

ALTER TABLE public.customer_feedback
  ADD COLUMN catering_order_id uuid REFERENCES public.catering_orders(id);

COMMENT ON COLUMN public.customer_feedback.catering_order_id IS
  'Catering satisfaction link (D15). Set with category=''catering''. Supersedes the deprecated catering_orders.rating.';
