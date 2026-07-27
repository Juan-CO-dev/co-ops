-- Migration 0159_sku_pack_levels
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-27-sku-pack-hierarchy-design.md
--                      (COUNCIL DESIGN LOCKS L1-L8) + lib/pack-chain-shared.ts (the walk)
--                      + lib/admin/pack-chain.ts (the sole write path).
--
-- The per-SKU unit chain (Shape 1). The middle purchase tier has NO storage today:
-- vendor_items.units_per_pack conflates case->log and flat->roll; each_container_label
-- is a dead hook (0/161 filled). This table stores an arbitrary-depth chain per SKU so
-- recipes, receiving, and counts may speak ANY level by label. The conversion spine
-- (lib/pack-chain-shared.ts walkChainToOz) walks it POINTER-directed (follow
-- contains_level_id), terminating in a weight-dim measure_unit (or count/volume with
-- the SKU's avg_oz_per_each fallback, mirroring recipe-math ozPerMeasureUnit).
--
-- COUNCIL LOCKS honored here:
--   L1  split link columns: contains_level_id XOR contains_measure_unit (CHECK
--       num_nonnulls = 1); the walk is pointer-directed; display_ordinal is DISPLAY
--       ONLY (never drives the walk -- the builder's detached-sibling trap). Label
--       uniqueness per SKU (partial WHERE active). Label ∉ measure_units labels is
--       enforced APP-LAYER (lib/admin/pack-chain.ts) since it's a cross-table rule.
--   L3  history: chain rows carry effective_from + active and are superseded as a SET
--       (the lib rewrites the whole chain, deactivating all prior rows in one pass).
--       Receiving/count lines persist resolved_oz at write time (PR 2); the spine is
--       date-blind and reads stored oz.
--   L4  per-location variance = separate location-scoped vendor_items rows (existing
--       law) each carrying their own chain; NO location_id on this table.
--
-- NO backfill in this migration -- backfill is the STAGED seed scripts/seed/13-pack-chains.ts
-- (24 SKUs need owner input + labels need canonicalization review; the 3-level deli
-- candidates are flagged CHAIN UNVERIFIED, not silently invented).
--
-- Flat vendor_items fields (units_per_pack/each_size/each_measure/avg_oz_per_each/
-- each_container_label) STAY FUNCTIONAL as the legacy path -- nothing breaks pre-backfill.

CREATE TABLE public.sku_pack_levels (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id                 uuid NOT NULL REFERENCES public.vendor_items(id),
  label                  text NOT NULL,
  contains_qty           numeric NOT NULL CHECK (contains_qty > 0),
  -- L1 split link: EXACTLY ONE of the two is set. A pointer to the next level
  -- down (this container holds contains_qty of THAT level) OR a terminal measure
  -- unit (this container holds contains_qty of that weight/count/volume unit).
  contains_level_id      uuid NULL REFERENCES public.sku_pack_levels(id),
  contains_measure_unit  text NULL,  -- label from measure_units (leaf termination)
  -- DISPLAY ONLY (L1): ordering for the editor. The walk NEVER uses this -- it
  -- follows contains_level_id. A chain entered with detached sibling ordinals
  -- must fail reachability (lib validation), never silently mis-walk.
  display_ordinal        integer NOT NULL DEFAULT 0,
  effective_from         timestamptz NOT NULL DEFAULT now(),
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL REFERENCES public.users(id),
  CONSTRAINT sku_pack_levels_one_link CHECK (
    num_nonnulls(contains_level_id, contains_measure_unit) = 1
  )
);

-- One active label per SKU (append-only supersede replaces the whole active set).
CREATE UNIQUE INDEX sku_pack_levels_sku_label_active
  ON public.sku_pack_levels (sku_id, label) WHERE active;
-- The load: active chain rows for a set of SKUs (batch loader law).
CREATE INDEX sku_pack_levels_sku_active
  ON public.sku_pack_levels (sku_id) WHERE active;

ALTER TABLE public.sku_pack_levels ENABLE ROW LEVEL SECURITY;
-- Deny-all triad (house pattern, mirrors sku_pack_formats / measure_units): NO select
-- policy at all (service-role reads bypass RLS; end users never read this table
-- directly). Writes are service-role only -- lib/admin/pack-chain.ts is the authority.
CREATE POLICY sku_pack_levels_no_user_select ON public.sku_pack_levels FOR SELECT USING (false);
CREATE POLICY sku_pack_levels_no_user_insert ON public.sku_pack_levels FOR INSERT WITH CHECK (false);
CREATE POLICY sku_pack_levels_no_user_update ON public.sku_pack_levels FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY sku_pack_levels_no_user_delete ON public.sku_pack_levels FOR DELETE USING (false);

COMMENT ON TABLE public.sku_pack_levels IS
  'Per-SKU purchase-unit chain (pack hierarchy, 0159). Pointer-directed (contains_level_id) with a weight/count/volume leaf (contains_measure_unit). display_ordinal is DISPLAY ONLY. Append-only: superseded as a SET (active=false). Walk: lib/pack-chain-shared.ts. Write path: lib/admin/pack-chain.ts.';
