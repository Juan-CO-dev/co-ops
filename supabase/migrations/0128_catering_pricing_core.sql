-- Migration 0128_catering_pricing_core
-- Applied via Supabase MCP apply_migration on 2026-07-18.
-- Canonical reference: docs/superpowers/specs/2026-07-18-w1a-catering-pricing-core-design.md
--                      + lib/catering/pricing-derivation.ts
--
-- W1a: the catering price-derivation substrate. Subs live in menu_items (one entity,
-- catering-tagged); extras in items (existing 0123 flags). A per-location rate table drives
-- derivation. Prices are derived on read, never stored — this migration is schema only.

-- 1. menu_items: catering tags + portion + section (mirror the items 0123 flags).
ALTER TABLE public.menu_items
  ADD COLUMN catering_available boolean NOT NULL DEFAULT false,
  ADD COLUMN catering_only boolean NOT NULL DEFAULT false,
  ADD COLUMN catering_portionable boolean NOT NULL DEFAULT false,
  ADD COLUMN section text;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_catering_only_implies_available
  CHECK (NOT catering_only OR catering_available);

CREATE INDEX menu_items_catering_available
  ON public.menu_items (catering_available) WHERE catering_available;

-- 2. catering_rate_rules: catering price as a fraction of regular (bps), most-specific-wins.
--    Distinct from catering_pricing_rules (that is the charge stack: tax/gratuity/service/deposit).
CREATE TABLE public.catering_rate_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES public.locations(id),
  scope        text NOT NULL CHECK (scope IN ('location','section','item','menu_item')),
  scope_ref    text,  -- null for 'location'; section name for 'section'; entity id (text) for item/menu_item
  rate_bps     integer NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 30000),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.users(id)
);

-- One active rule per (location, scope, scope_ref) — COALESCE the nullable ref (mirrors
-- catering_packages_one_active). scope='location' has scope_ref NULL -> coalesced to ''.
CREATE UNIQUE INDEX catering_rate_rules_one_active
  ON public.catering_rate_rules (location_id, scope, COALESCE(scope_ref, ''))
  WHERE active;

ALTER TABLE public.catering_rate_rules ENABLE ROW LEVEL SECURITY;
-- Deny-all to end users; service-role only (the lib is the authority), like the other catering-KB tables.

-- 3. catering_quote_items.portion — the snapshot line's chosen portion (subs).
ALTER TABLE public.catering_quote_items
  ADD COLUMN portion text
  CHECK (portion IS NULL OR portion IN ('quarter','half','whole'));
