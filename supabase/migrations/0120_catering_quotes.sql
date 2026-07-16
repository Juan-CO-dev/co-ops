-- Migration 0120_catering_quotes
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1E (money surface); D21 (charge stack —
-- gratuity != service charge; tax per location), D22 (quote expiry), D19 (append-only
-- money — a quote REVISION is a NEW immutable row, never an in-place edit), and
-- 0113/0114 (parent-anchored child RLS via a SECURITY DEFINER helper).
--
-- catering_quotes: the priced quote document. Append-only + versioned. createQuote writes
-- v1 (root_id NULL); reviseQuote sets the current row's superseded_at (service-role) and
-- inserts version+1 sharing root_id. A partial unique index enforces exactly one live
-- (non-superseded) revision per family. The FULL charge stack AND the bps rates used are
-- SNAPSHOTTED onto the row at compute time, so a later pricing-rule change never
-- retroactively alters a quote's math. The forward "superseded_by" pointer is intentionally
-- NOT a column (it would create a chicken-and-egg with the one-live unique index); the
-- successor is derivable as the same family's version+1.
--
-- The header carries its own authoritative location_id (like catering_pipeline), gated in
-- RLS. All real reads/writes go through the service-role lib with app-layer authz; RLS is
-- defense-in-depth. Money rows are append-only → no user UPDATE/DELETE (supersede is a
-- service-role write that bypasses RLS).

CREATE TABLE public.catering_quotes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_id               uuid REFERENCES public.catering_quotes(id),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  pipeline_id           uuid REFERENCES public.catering_pipeline(id),
  customer_id           uuid REFERENCES public.catering_customers(id),
  location_id           uuid NOT NULL REFERENCES public.locations(id),
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','accepted','declined','expired')),
  event_date            date,
  headcount             integer CHECK (headcount IS NULL OR headcount >= 0),
  is_delivery           boolean NOT NULL DEFAULT false,
  delivery_zone_id      uuid REFERENCES public.catering_delivery_zones(id),
  -- charge-stack snapshot (integer cents), all computed server-side
  subtotal_cents        integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  delivery_fee_cents    integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  service_charge_cents  integer NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0),
  gratuity_cents        integer NOT NULL DEFAULT 0 CHECK (gratuity_cents >= 0),
  tax_cents             integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents           integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  deposit_cents         integer NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  -- rate snapshot (bps + toggles) frozen at compute time (integrity)
  tax_rate_bps          integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  gratuity_bps          integer NOT NULL DEFAULT 0 CHECK (gratuity_bps BETWEEN 0 AND 10000),
  service_charge_bps    integer NOT NULL DEFAULT 0 CHECK (service_charge_bps BETWEEN 0 AND 10000),
  deposit_pct_bps       integer NOT NULL DEFAULT 0 CHECK (deposit_pct_bps BETWEEN 0 AND 10000),
  tax_on_delivery       boolean NOT NULL DEFAULT true,
  tax_on_gratuity       boolean NOT NULL DEFAULT false,
  expires_at            timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES public.users(id),
  sent_at               timestamptz,
  sent_by               uuid REFERENCES public.users(id),
  superseded_at         timestamptz
);
-- exactly one live (non-superseded) revision per quote family
CREATE UNIQUE INDEX catering_quotes_one_live_per_family
  ON public.catering_quotes (COALESCE(root_id, id)) WHERE superseded_at IS NULL;
CREATE INDEX catering_quotes_pipeline ON public.catering_quotes (pipeline_id);
CREATE INDEX catering_quotes_location_status ON public.catering_quotes (location_id, status);

ALTER TABLE public.catering_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_quotes_read ON public.catering_quotes FOR SELECT
  USING (
    public.current_user_role_level() >= 9
    OR (public.current_user_role_level() >= 5 AND location_id = ANY (public.current_user_locations()))
  );
CREATE POLICY catering_quotes_insert ON public.catering_quotes FOR INSERT
  WITH CHECK (
    public.current_user_role_level() >= 6
    AND location_id = ANY (public.current_user_locations())
  );
CREATE POLICY catering_quotes_no_user_update ON public.catering_quotes FOR UPDATE USING (false);
CREATE POLICY catering_quotes_no_user_delete ON public.catering_quotes FOR DELETE USING (false);

-- Parent-location helper: SECURITY DEFINER bypasses RLS to read the quote's real location;
-- locked search_path; anon + PUBLIC revoked — mirrors catering_order_loc (0113/0114) so anon
-- fails loudly if mis-invoked rather than inheriting EXECUTE via Supabase's default PUBLIC grant.
CREATE FUNCTION public.catering_quote_loc(q_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT location_id FROM public.catering_quotes WHERE id = q_id;
$$;
REVOKE EXECUTE ON FUNCTION public.catering_quote_loc(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.catering_quote_loc(uuid) FROM PUBLIC;

CREATE TABLE public.catering_quote_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         uuid NOT NULL REFERENCES public.catering_quotes(id),
  item_id          uuid REFERENCES public.items(id),
  menu_item_id     uuid REFERENCES public.menu_items(id),
  package_id       uuid REFERENCES public.catering_packages(id),
  description      text,
  quantity         numeric NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users(id),
  -- at most one spine ref (never re-model the menu); a line must be identifiable
  CONSTRAINT catering_quote_items_one_ref CHECK (item_id IS NULL OR menu_item_id IS NULL),
  CONSTRAINT catering_quote_items_identified
    CHECK (description IS NOT NULL OR item_id IS NOT NULL OR menu_item_id IS NOT NULL)
);
CREATE INDEX catering_quote_items_quote ON public.catering_quote_items (quote_id, display_order);

ALTER TABLE public.catering_quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_quote_items_read ON public.catering_quote_items FOR SELECT
  USING (
    public.current_user_role_level() >= 9
    OR public.catering_quote_loc(quote_id) = ANY (public.current_user_locations())
  );
CREATE POLICY catering_quote_items_insert ON public.catering_quote_items FOR INSERT
  WITH CHECK (
    public.current_user_role_level() >= 6
    AND public.catering_quote_loc(quote_id) = ANY (public.current_user_locations())
  );
CREATE POLICY catering_quote_items_no_user_update ON public.catering_quote_items FOR UPDATE USING (false);
CREATE POLICY catering_quote_items_no_user_delete ON public.catering_quote_items FOR DELETE USING (false);
