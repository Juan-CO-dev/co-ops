-- Migration 0051_opening_phase2_calc_redesign
-- Applied via Supabase MCP apply_migration on 2026-05-09.
-- Canonical reference: docs/SPEC_AMENDMENTS.md C.50 §2 (Per-section instance
-- state + Closer-count snapshot table) + lib/opening.ts loadOpeningState
-- create-path snapshot materialization + new loadOpeningCloserCountSnapshots
-- helper. Step 11 of PR 3 (branch claude/nice-wilson-398de1).

-- ─────────────────────────────────────────────────────────────────────────────
-- C.50 schema additions for the opening Phase 2 redesign.
--
-- Two new tables. NO backfill; NO audit emission for backfill (Step 11
-- simplification per Lock 1: existing column-level FK
-- `checklist_template_items.references_template_item_id` (added in migration
-- 0049, populated for all 68 Phase 2 items as of 2026-05-08) is canonical.
-- The earlier proposed `OpeningPhase2Meta.amPrepTemplateItemId` JSONB
-- duplication was dropped before Step 11 implementation per AGENTS.md
-- "verify against operational artifacts, not generic priors" — schema state
-- queried before code shipped, redundancy avoided.
--
-- 1) opening_closer_count_snapshots — captures the closer's per-item count
--    at the moment opener begins verification. Decoupled from yesterday's
--    closing's edit window per C.44 snapshot universe locking precedent
--    (historical reports preserve template state at submission time; same
--    principle applied to closer-count at opening boundary).
--
--    `closer_count` is NULLABLE per Step 11 Lock 3 sentinel handling.
--    Legitimate operational causes (forward note for Step 12 form design):
--      - closing_instance_id IS NULL → no AM Prep yesterday
--      - opening template item lacks references_template_item_id → item
--        not linked to AM Prep
--      - first day of platform → both NULL
--    When closer_count IS NULL, opener cannot section-verify the affected
--    section and must per-item recount.
--
--    FK semantic (AGENTS.md migration cross-reference): the column
--    `references_template_item_id` on checklist_template_items (migration
--    0049) is the canonical FK from opening Phase 2 item → AM Prep template
--    item. Snapshot materialization uses this column via the renamed
--    loadCloserCountSnapshots resolver (renamed from
--    loadCloserEstimateSnapshots in Step 11 to lock the C.50 semantic
--    correction in the type system; "estimate" → "count").
--
-- 2) opening_section_verifications — captures per-section verification at
--    submit time. Step 11 creates the table; Step 13 RPC rewrite (migration
--    0052) populates it. Append-only convention: NO UNIQUE constraint on
--    (instance, section); if opener un-verifies and re-verifies, both rows
--    preserved with timestamps. Latest verification = MAX(verified_at) per
--    (instance, section_key) at read time.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE opening_closer_count_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_instance_id      uuid NOT NULL REFERENCES checklist_instances(id),
  template_item_id         uuid NOT NULL REFERENCES checklist_template_items(id),
  closing_instance_id      uuid NULL REFERENCES checklist_instances(id),
  closer_count             numeric NULL,
  par_value                numeric NULL,
  par_unit                 text NULL,
  snapshot_taken_at        timestamptz NOT NULL DEFAULT NOW(),
  snapshot_by              uuid NULL REFERENCES users(id),
  UNIQUE (opening_instance_id, template_item_id)
);

COMMENT ON TABLE opening_closer_count_snapshots IS
  'C.50 §2 per-instance frozen closer-count for opening Phase 2 items. '
  'Materialized at opening instance creation via loadOpeningState create-path. '
  'closer_count NULL when no closing yesterday OR FK to AM Prep item is NULL. '
  'Decouples opening from closing edit window per C.44 snapshot universe locking precedent.';

ALTER TABLE opening_closer_count_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY ocs_read ON opening_closer_count_snapshots FOR SELECT
  USING (current_user_role_level() >= 3);

CREATE POLICY ocs_no_user_insert ON opening_closer_count_snapshots
  FOR INSERT WITH CHECK (false);

CREATE POLICY ocs_no_user_update ON opening_closer_count_snapshots
  FOR UPDATE USING (false);

CREATE POLICY ocs_no_user_delete ON opening_closer_count_snapshots
  FOR DELETE USING (false);

CREATE INDEX ocs_instance_idx
  ON opening_closer_count_snapshots(opening_instance_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE opening_section_verifications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_instance_id      uuid NOT NULL REFERENCES checklist_instances(id),
  section_key              text NOT NULL,
  verified_at              timestamptz NOT NULL DEFAULT NOW(),
  verified_by              uuid NOT NULL REFERENCES users(id)
  -- INTENTIONAL: no UNIQUE (opening_instance_id, section_key) constraint.
  -- Append-only per CO-OPS convention; if opener un-verifies and re-verifies,
  -- both rows preserved with timestamps. Latest verification is
  -- MAX(verified_at) per (instance, section_key) at read time.
);

COMMENT ON TABLE opening_section_verifications IS
  'C.50 §2 per-section verification rows. Populated by submit_opening_atomic '
  'Phase 2 dispatch path at submit time (not at tap time per Step 11 Lock 2). '
  'Append-only; latest verification is MAX(verified_at) per (instance, section_key).';

ALTER TABLE opening_section_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY osv_read ON opening_section_verifications FOR SELECT
  USING (current_user_role_level() >= 3);

CREATE POLICY osv_no_user_insert ON opening_section_verifications
  FOR INSERT WITH CHECK (false);

-- INTENTIONAL: no update/delete policies. Append-only enforced by absence +
-- service-role bypass for inserts via submit_opening_atomic RPC (Step 13).

CREATE INDEX osv_instance_idx
  ON opening_section_verifications(opening_instance_id);
