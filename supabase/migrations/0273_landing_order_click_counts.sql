-- Migration 0273_landing_order_click_counts
-- AUTHORED 2026-10-16. FILE ONLY, NOT APPLIED. CC/Juan own review and activation.
-- Provenance: approved landing phase-1 BUILD r4, A5 independent KPI counter.
-- REVISED 2026-10-18, landing v2 chunk 9: registry-backed attribution.
-- CC read-only evidence 2026-10-18: unapplied in prod bgcvurheqzylyfehqgzh
-- and sim jepgzucrvklhqpthowsc; registry/counter/function absent in both.
-- Self-contained: no dependency on 0274/0275 objects; manual apply may be out of order.
-- Derived increment-only aggregate exception; no operational history is modified.
-- Re-application is intentionally an error: fail-closed, not idempotent.

begin;

-- Opaque campaign/send codes only. Slots are lifetime allocations, including retired codes.
CREATE TABLE public.landing_ad_codes (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  slot smallint NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 1024),
  active boolean NOT NULL DEFAULT true,
  CHECK (code <> 'unattributed' OR active)
);
ALTER TABLE public.landing_ad_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY landing_ad_codes_read ON public.landing_ad_codes FOR SELECT USING (false);
CREATE POLICY landing_ad_codes_no_user_insert ON public.landing_ad_codes FOR INSERT WITH CHECK (false);
CREATE POLICY landing_ad_codes_no_user_update ON public.landing_ad_codes FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY landing_ad_codes_no_user_delete ON public.landing_ad_codes FOR DELETE USING (false);
REVOKE ALL ON TABLE public.landing_ad_codes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.landing_ad_codes TO service_role;
GRANT UPDATE (active) ON TABLE public.landing_ad_codes TO service_role;
INSERT INTO public.landing_ad_codes (code, slot) VALUES ('unattributed', 1), ('subsim-photo', 2);

CREATE TABLE public.landing_order_click_counts (
  day_utc date NOT NULL,
  store_key text NOT NULL CHECK (store_key IN ('capitol-hill', 'dupont')),
  ad_code text NOT NULL REFERENCES public.landing_ad_codes(code),
  click_count bigint NOT NULL CHECK (click_count > 0),
  PRIMARY KEY (day_utc, store_key, ad_code)
);
-- Expected advisor lint: unindexed_foreign_keys on ad_code. Parent rows are
-- never deleted or re-keyed (no DELETE/code-UPDATE grant); an index would add
-- write cost to the hot increment. Deliberately no supporting ad_code index.
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
  -- FOR SHARE conflicts with retirement's non-key UPDATE lock. The decision
  -- and increment therefore serialize against a concurrent active=false write.
  SELECT code INTO v_ad FROM public.landing_ad_codes
  WHERE code = p_ad_code AND active
  FOR SHARE;
  v_ad := COALESCE(v_ad, 'unattributed');
  INSERT INTO public.landing_order_click_counts (day_utc, store_key, ad_code, click_count)
  VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date, p_store_key, v_ad, 1)
  ON CONFLICT (day_utc, store_key, ad_code) DO UPDATE
  SET click_count = public.landing_order_click_counts.click_count + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.increment_landing_order_click(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_landing_order_click(text, text) TO service_role;

-- The definer's RLS exemption requires ownership of BOTH tables.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    where c.oid in ('public.landing_ad_codes'::regclass, 'public.landing_order_click_counts'::regclass)
      and c.relowner <> (select p.proowner from pg_catalog.pg_proc p
        where p.oid = 'public.increment_landing_order_click(text,text)'::regprocedure)
  ) then
    raise exception '0273: increment function must own both landing tables';
  end if;
end;
$$;

commit;
