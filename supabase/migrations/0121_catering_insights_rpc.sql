-- Migration 0121_catering_insights_rpc
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1F (feedback + trends); the GLOBAL server-side-SUM
-- rule (every catering money rollup is SQL SUM/RPC, never a client reduce — the 1000-row
-- truncation bug class, ties project_coops_audit_backlog_2026-07-11).
--
-- One round-trip aggregation for the catering insights read surface: pipeline stage counts,
-- live-quote status counts + value SUMs, revenue rollups (open pipeline / won / booked order
-- revenue), and catering feedback avg + count. Scoped by p_location_ids (NULL = all-locations
-- viewer). SECURITY DEFINER + REVOKE anon/PUBLIC mirrors the catering_*_loc helpers; the lib
-- passes the authenticated actor's location scope.

CREATE FUNCTION public.catering_insights(p_location_ids uuid[])
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'pipeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', stage, 'count', c) ORDER BY stage)
      FROM (
        SELECT stage, count(*)::int AS c
        FROM public.catering_pipeline
        WHERE (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
        GROUP BY stage
      ) s
    ), '[]'::jsonb),
    'quotes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', status, 'count', c, 'total_cents', tc) ORDER BY status)
      FROM (
        SELECT status, count(*)::int AS c, COALESCE(sum(total_cents), 0)::bigint AS tc
        FROM public.catering_quotes
        WHERE superseded_at IS NULL
          AND (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
        GROUP BY status
      ) q
    ), '[]'::jsonb),
    'revenue', jsonb_build_object(
      'pipeline_value_cents', COALESCE((
        SELECT sum(total_cents) FROM public.catering_quotes
        WHERE superseded_at IS NULL AND status IN ('draft', 'sent')
          AND (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
      ), 0),
      'won_value_cents', COALESCE((
        SELECT sum(total_cents) FROM public.catering_quotes
        WHERE superseded_at IS NULL AND status = 'accepted'
          AND (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
      ), 0),
      'order_revenue_cents', COALESCE((
        SELECT sum(amount_cents) FROM public.catering_orders
        WHERE (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
      ), 0)
    ),
    'feedback', jsonb_build_object(
      'average_rating', (
        SELECT round(avg(rating)::numeric, 2) FROM public.customer_feedback
        WHERE catering_order_id IS NOT NULL AND rating IS NOT NULL
          AND (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
      ),
      'count', (
        SELECT count(*)::int FROM public.customer_feedback
        WHERE catering_order_id IS NOT NULL
          AND (p_location_ids IS NULL OR location_id = ANY (p_location_ids))
      )
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.catering_insights(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.catering_insights(uuid[]) FROM PUBLIC;
