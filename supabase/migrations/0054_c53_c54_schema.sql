-- Migration 0054_c53_c54_schema
-- Created 2026-05-26. NOT YET APPLIED — apply via Supabase MCP apply_migration
-- or Supabase dashboard SQL editor before any downstream work touches these
-- tables/columns.
-- Canonical references:
--   - docs/SPEC_AMENDMENTS.md C.53 §3 (Phase 3 setup state — new tables), §6 (Migration impact)
--   - docs/SPEC_AMENDMENTS.md C.54 §4 (provenance marker column shape + attestation column)
--   - lib/types.ts (OpeningEntryPhase3, C54Provenance, OpeningSetupItemKey,
--     OpeningSetupUnverifiedReason, OpeningNoPriorDataReason)
--   - lib/checklist-rows.ts (CompletionRow extended with countProvenance)
--   - app/(authed)/operations/opening/phase-router.tsx (status → phase mapping)
--   - AGENTS.md durable lessons:
--       "Pre-INSERT pg_enum query for enum-constrained columns"
--   - Migration 0046 (existing checklist_instances.status CHECK constraint)
--   - Migration 0053 (prior opening migration; header convention + RLS patterns)
--
-- Phase 1 of C.53 implementation sequencing (schema first). Blocks all downstream
-- phases: Phase 3 seed data, Phase 3 UI, Phase 1/2 component restructure, RPCs,
-- and integration.

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Extends checklist_instances.status CHECK to add 'phase1_complete' + 'phase2_complete'
-- 2. Creates opening_setup_items table (Phase 3 setup item definitions)
-- 3. Creates opening_setup_verifications table (Phase 3 per-instance verifications)
-- 4. Adds opener_no_prior_data_reason column to checklist_instances (C.54 attestation)
-- 5. Adds count_provenance column to checklist_completions (C.54 provenance marker)
-- 6. Enables RLS on new tables with appropriate policies
--
-- Safe for repeat apply: uses IF NOT EXISTS / DROP ... IF EXISTS patterns.
-- No data migration — all new columns are nullable; existing rows carry NULL
-- provenance per C.54 §3 sub-decision 5 (no retroactive backfill).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend checklist_instances status constraint
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE checklist_instances
  DROP CONSTRAINT IF EXISTS checklist_instances_status_check;

ALTER TABLE checklist_instances
  ADD CONSTRAINT checklist_instances_status_check
  CHECK (status IN (
    'open',
    'phase1_complete',
    'phase2_complete',
    'confirmed',
    'incomplete_confirmed',
    'auto_finalized'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Opening setup items table (template-like; seed data initially)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opening_setup_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id                uuid NULL,  -- FK deferred — regions table not yet in production; forward-looking per comment below
  location_id              uuid NULL REFERENCES locations(id),
  item_label               text NOT NULL,
  item_type                text NOT NULL CHECK (item_type IN ('boolean', 'quantitative_range')),
  min_value                numeric NULL,
  max_value                numeric NULL,
  unit                     text NULL,
  applies_to_stations      text[] NOT NULL,
  verification_scope       text NOT NULL CHECK (verification_scope IN ('shared', 'per_station')),
  display_order            int NOT NULL,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE opening_setup_items IS 'C.53 Phase 3 — setup item definitions (seed data initially; region/location scoping reserved for future activation).';
COMMENT ON COLUMN opening_setup_items.item_type IS 'boolean = tap-confirm CTA; quantitative_range = numeric input with min/max bounds.';
COMMENT ON COLUMN opening_setup_items.verification_scope IS 'shared = one verification covers all stations; per_station = verified independently per station.';
COMMENT ON COLUMN opening_setup_items.applies_to_stations IS 'Array of station_keys this item applies to. Known values: station_cooks, station_veg, station_sauces, station_slicing, station_cold.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Opening setup verifications table (per-instance append-only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opening_setup_verifications (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_instance_id        uuid NOT NULL REFERENCES checklist_instances(id),
  setup_item_id              uuid NOT NULL REFERENCES opening_setup_items(id),
  station_key                text NULL,
  verified_at                timestamptz NOT NULL DEFAULT NOW(),
  verified_by                uuid NOT NULL REFERENCES users(id),
  verified_value             numeric NULL,
  in_range                   boolean NULL,
  unverified_reason_category text NULL,
  unverified_reason_text     text NULL
);

COMMENT ON TABLE opening_setup_verifications IS 'C.53 Phase 3 — per-instance setup verification state (append-only).';
COMMENT ON COLUMN opening_setup_verifications.station_key IS 'Populated for per_station verification_scope; NULL for shared.';
COMMENT ON COLUMN opening_setup_verifications.verified_value IS 'Populated for quantitative_range; the numeric value opener entered.';
COMMENT ON COLUMN opening_setup_verifications.in_range IS 'Computed at verification time: true when verified_value within [min_value, max_value]. NULL for boolean items.';
COMMENT ON COLUMN opening_setup_verifications.unverified_reason_category IS 'Present when item is intentionally left unverified at submit (triggers incomplete_confirmed transition).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Attestation column (C.54 §2.C / §4)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE checklist_instances
  ADD COLUMN IF NOT EXISTS opener_no_prior_data_reason text
  CHECK (opener_no_prior_data_reason IN ('planned_closure', 'missed_or_unknown'));

COMMENT ON COLUMN checklist_instances.opener_no_prior_data_reason IS 'C.54 §2.C — opener attestation when NULL-source detection fires at Phase 1 submit. NULL when no NULL-source detected; populated only when the attestation prompt fired.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Provenance column (C.54 §4, option i — dedicated column)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE checklist_completions
  ADD COLUMN IF NOT EXISTS count_provenance text
  CHECK (count_provenance IN ('closer_captured', 'reconstructed_morning'));

COMMENT ON COLUMN checklist_completions.count_provenance IS 'C.54 §4 — per-completion provenance marker distinguishing closing-captured counts from morning-reconstructed counts. Set at submit time. NULL on historical completions (no retroactive backfill per C.54 §3 sub-decision 5).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — opening_setup_items (read-only for all authenticated, write for KH+)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE opening_setup_items ENABLE ROW LEVEL SECURITY;

-- Setup items are template-like; all authenticated users can read.
DROP POLICY IF EXISTS opening_setup_items_select_policy ON opening_setup_items;
CREATE POLICY opening_setup_items_select_policy
  ON opening_setup_items
  FOR SELECT
  USING (true);

-- Only KH+ (role_level >= 3) can manage setup item definitions.
-- Uses the existing current_user_role_level() helper from migration 0024.
DROP POLICY IF EXISTS opening_setup_items_insert_policy ON opening_setup_items;
CREATE POLICY opening_setup_items_insert_policy
  ON opening_setup_items
  FOR INSERT
  WITH CHECK (current_user_role_level() >= 3);

DROP POLICY IF EXISTS opening_setup_items_update_policy ON opening_setup_items;
CREATE POLICY opening_setup_items_update_policy
  ON opening_setup_items
  FOR UPDATE
  USING (current_user_role_level() >= 3);

DROP POLICY IF EXISTS opening_setup_items_delete_policy ON opening_setup_items;
CREATE POLICY opening_setup_items_delete_policy
  ON opening_setup_items
  FOR DELETE
  USING (current_user_role_level() >= 3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — opening_setup_verifications (append-only write for the opening actor)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE opening_setup_verifications ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read verification state (read-only for dashboards).
DROP POLICY IF EXISTS opening_setup_verifications_select_policy ON opening_setup_verifications;
CREATE POLICY opening_setup_verifications_select_policy
  ON opening_setup_verifications
  FOR SELECT
  USING (true);

-- KH+ at the instance's location can insert verifications (Phase 3 submit path).
-- The RPC is SECURITY DEFINER so this policy is the defense-in-depth layer;
-- the primary gate is inside submit_phase3_atomic.
DROP POLICY IF EXISTS opening_setup_verifications_insert_policy ON opening_setup_verifications;
CREATE POLICY opening_setup_verifications_insert_policy
  ON opening_setup_verifications
  FOR INSERT
  WITH CHECK (
    current_user_role_level() >= 3
    AND EXISTS (
      SELECT 1 FROM checklist_instances ci
      WHERE ci.id = opening_instance_id
      AND ci.location_id IN (
        SELECT location_id FROM user_locations
        WHERE user_id = current_user_id()
      )
    )
  );

-- Verifications are append-only — no update or delete policies.
-- Chain edits to verification state go through the RPC's update path,
-- not direct table access.