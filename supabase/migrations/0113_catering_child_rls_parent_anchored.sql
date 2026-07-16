-- Migration 0113_catering_child_rls_parent_anchored
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 D3/D4; SECURITY DEFINER helper pattern (current_user_*).
-- Security fix (pre-merge review of PR #122): catering_pipeline_events and
-- catering_order_items (0110/0111) originally gated RLS on a DENORMALIZED location_id
-- copied from the parent. That field is client-supplied on INSERT, so a level-6 user could
-- attach a child row to a parent at another location while setting location_id to their own
-- — an unvalidated write-target gap (not yet exploitable; no write code exists — but latent).
-- Fix: anchor authorization on the PARENT's authoritative location via SECURITY DEFINER
-- helpers, and drop the denormalized column. Also tightens null-location EVENT reads to
-- catering staff (>= 6) instead of any authenticated user (over-broad-read).

-- Parent-location helpers: SECURITY DEFINER bypasses RLS to read the parent's real location;
-- locked search_path; anon revoked — mirrors current_user_id / current_user_role_level.
CREATE FUNCTION public.catering_pipeline_loc(p_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT location_id FROM public.catering_pipeline WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.catering_pipeline_loc(uuid) FROM anon;

CREATE FUNCTION public.catering_order_loc(o_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT location_id FROM public.catering_orders WHERE id = o_id;
$$;
REVOKE EXECUTE ON FUNCTION public.catering_order_loc(uuid) FROM anon;

-- ===== catering_pipeline_events: re-anchor on the parent pipeline; drop denormalized column =====
DROP POLICY catering_pipeline_events_read ON public.catering_pipeline_events;
DROP POLICY catering_pipeline_events_insert ON public.catering_pipeline_events;
DROP POLICY catering_pipeline_events_no_user_update ON public.catering_pipeline_events;
DROP POLICY catering_pipeline_events_no_user_delete ON public.catering_pipeline_events;
ALTER TABLE public.catering_pipeline_events DROP COLUMN location_id;

CREATE POLICY catering_pipeline_events_read ON public.catering_pipeline_events FOR SELECT
  USING (
    public.current_user_role_level() >= 9
    OR public.catering_pipeline_loc(pipeline_id) = ANY (public.current_user_locations())
    OR (public.catering_pipeline_loc(pipeline_id) IS NULL AND public.current_user_role_level() >= 6)
  );
CREATE POLICY catering_pipeline_events_insert ON public.catering_pipeline_events FOR INSERT
  WITH CHECK (
    public.current_user_role_level() >= 6
    AND (
      public.catering_pipeline_loc(pipeline_id) IS NULL
      OR public.catering_pipeline_loc(pipeline_id) = ANY (public.current_user_locations())
    )
  );
CREATE POLICY catering_pipeline_events_no_user_update ON public.catering_pipeline_events FOR UPDATE USING (false);
CREATE POLICY catering_pipeline_events_no_user_delete ON public.catering_pipeline_events FOR DELETE USING (false);

-- ===== catering_order_items: re-anchor on the parent order; drop denormalized column =====
DROP POLICY catering_order_items_read ON public.catering_order_items;
DROP POLICY catering_order_items_insert ON public.catering_order_items;
DROP POLICY catering_order_items_no_user_update ON public.catering_order_items;
DROP POLICY catering_order_items_no_user_delete ON public.catering_order_items;
ALTER TABLE public.catering_order_items DROP COLUMN location_id;

CREATE POLICY catering_order_items_read ON public.catering_order_items FOR SELECT
  USING (
    public.current_user_role_level() >= 9
    OR public.catering_order_loc(order_id) = ANY (public.current_user_locations())
  );
CREATE POLICY catering_order_items_insert ON public.catering_order_items FOR INSERT
  WITH CHECK (
    public.current_user_role_level() >= 6
    AND public.catering_order_loc(order_id) = ANY (public.current_user_locations())
  );
CREATE POLICY catering_order_items_no_user_update ON public.catering_order_items FOR UPDATE USING (false);
CREATE POLICY catering_order_items_no_user_delete ON public.catering_order_items FOR DELETE USING (false);
