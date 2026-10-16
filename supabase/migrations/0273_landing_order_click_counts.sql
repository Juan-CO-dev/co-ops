-- Migration 0273_landing_order_click_counts
-- AUTHORED 2026-10-16. FILE ONLY, NOT APPLIED. CC/Juan own review and activation.
-- Provenance: approved landing phase-1 BUILD r4, A5 independent KPI counter.
-- Derived increment-only aggregate exception; no operational history is modified.

CREATE TABLE public.landing_order_click_counts (
  day_utc date NOT NULL,
  store_key text NOT NULL CHECK (store_key IN ('capitol-hill', 'dupont')),
  ad_code text NOT NULL CHECK (ad_code IN ('subsim-photo', 'unattributed')),
  click_count bigint NOT NULL CHECK (click_count > 0),
  PRIMARY KEY (day_utc, store_key, ad_code)
);
ALTER TABLE public.landing_order_click_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY landing_order_click_counts_read ON public.landing_order_click_counts FOR SELECT USING (false);
CREATE POLICY landing_order_click_counts_no_user_insert ON public.landing_order_click_counts FOR INSERT WITH CHECK (false);
CREATE POLICY landing_order_click_counts_no_user_update ON public.landing_order_click_counts FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY landing_order_click_counts_no_user_delete ON public.landing_order_click_counts FOR DELETE USING (false);
REVOKE ALL ON TABLE public.landing_order_click_counts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.landing_order_click_counts TO service_role;

CREATE FUNCTION public.increment_landing_order_click(p_store_key text, p_ad_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ad text;
BEGIN
  IF p_store_key IS NULL OR p_store_key NOT IN ('capitol-hill', 'dupont') THEN
    RAISE EXCEPTION 'invalid_store' USING ERRCODE = '22023';
  END IF;
  IF p_ad_code IS NULL OR length(p_ad_code) > 64 THEN
    RAISE EXCEPTION 'invalid_ad' USING ERRCODE = '22023';
  END IF;
  v_ad := CASE WHEN p_ad_code IN ('subsim-photo', 'unattributed') THEN p_ad_code ELSE 'unattributed' END;
  INSERT INTO public.landing_order_click_counts (day_utc, store_key, ad_code, click_count)
  VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date, p_store_key, v_ad, 1)
  ON CONFLICT (day_utc, store_key, ad_code) DO UPDATE
  SET click_count = public.landing_order_click_counts.click_count + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.increment_landing_order_click(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_landing_order_click(text, text) TO service_role;
