-- Migration 0116_catering_pricing_capacity
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering v1.3 slice 1A; D21 (charge stack), D17/D23 (capacity), D26 (holds).
-- Per-location operational config that slice 1B (capacity gate) and 1E (quotes/charge-stack) read:
-- pricing/tax rules (tax + gratuity + service-charge in basis points; deposit %), capacity policy
-- (max covers/events per day, min lead time — the Mode-A caps), and append-only blackout dates.
-- One active row per location for pricing + capacity (partial unique WHERE active). Deny-all RLS
-- (service-role loaders; the Mode-B reservation RPC will read these SECURITY DEFINER in 1B).

CREATE TABLE public.catering_pricing_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id        uuid NOT NULL REFERENCES public.locations(id),
  tax_rate_bps       integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  gratuity_bps       integer NOT NULL DEFAULT 0 CHECK (gratuity_bps BETWEEN 0 AND 10000),
  service_charge_bps integer NOT NULL DEFAULT 0 CHECK (service_charge_bps BETWEEN 0 AND 10000),
  deposit_pct_bps    integer NOT NULL DEFAULT 0 CHECK (deposit_pct_bps BETWEEN 0 AND 10000),
  tax_on_delivery    boolean NOT NULL DEFAULT true,
  tax_on_gratuity    boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX catering_pricing_rules_one_active_per_location
  ON public.catering_pricing_rules (location_id) WHERE active;

ALTER TABLE public.catering_pricing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_pricing_rules_no_user_select ON public.catering_pricing_rules FOR SELECT USING (false);
CREATE POLICY catering_pricing_rules_no_user_insert ON public.catering_pricing_rules FOR INSERT WITH CHECK (false);
CREATE POLICY catering_pricing_rules_no_user_update ON public.catering_pricing_rules FOR UPDATE USING (false);
CREATE POLICY catering_pricing_rules_no_user_delete ON public.catering_pricing_rules FOR DELETE USING (false);

CREATE TABLE public.catering_capacity_policy (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         uuid NOT NULL REFERENCES public.locations(id),
  max_covers_per_day  integer CHECK (max_covers_per_day IS NULL OR max_covers_per_day >= 0),
  max_events_per_day  integer CHECK (max_events_per_day IS NULL OR max_events_per_day >= 0),
  min_lead_time_hours integer CHECK (min_lead_time_hours IS NULL OR min_lead_time_hours >= 0),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX catering_capacity_policy_one_active_per_location
  ON public.catering_capacity_policy (location_id) WHERE active;

ALTER TABLE public.catering_capacity_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_capacity_policy_no_user_select ON public.catering_capacity_policy FOR SELECT USING (false);
CREATE POLICY catering_capacity_policy_no_user_insert ON public.catering_capacity_policy FOR INSERT WITH CHECK (false);
CREATE POLICY catering_capacity_policy_no_user_update ON public.catering_capacity_policy FOR UPDATE USING (false);
CREATE POLICY catering_capacity_policy_no_user_delete ON public.catering_capacity_policy FOR DELETE USING (false);

CREATE TABLE public.catering_blackout_dates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES public.locations(id),
  blackout_date date NOT NULL,
  reason        text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX catering_blackout_dates_one_active
  ON public.catering_blackout_dates (location_id, blackout_date) WHERE active;

ALTER TABLE public.catering_blackout_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_blackout_dates_no_user_select ON public.catering_blackout_dates FOR SELECT USING (false);
CREATE POLICY catering_blackout_dates_no_user_insert ON public.catering_blackout_dates FOR INSERT WITH CHECK (false);
CREATE POLICY catering_blackout_dates_no_user_update ON public.catering_blackout_dates FOR UPDATE USING (false);
CREATE POLICY catering_blackout_dates_no_user_delete ON public.catering_blackout_dates FOR DELETE USING (false);
