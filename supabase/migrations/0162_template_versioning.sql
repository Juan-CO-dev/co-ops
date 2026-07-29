-- Migration 0162_template_versioning
-- STAGED in PR; prod apply deferred to Juan's go — but apply BEFORE merging the code
-- (the #191 apply-first protocol). The NEW code (publishTemplateVersion + the
-- date-aware resolver sweep) REQUIRES these columns; the OLD code never reads or
-- writes them, so applying 0162 before merge is a no-op on the running app and
-- cannot break anything (see APPLY-FIRST-SAFE below).
-- Canonical reference: docs/superpowers/specs/2026-07-28-template-builder-design.md
--                      (§1 THE RECONCILIATION CONTRACT + §10 PR-3, council-ratified
--                      2026-07-28) + the orchestrator's adjudicated design.
--
-- PR-3 of the Template Builder arc: THE PUBLISH ENGINE. Every publish mints a NEW
-- checklist_templates row (a new version) that takes effect NEXT OPERATIONAL DAY.
-- History is immutable by construction: instances bind template_id at creation and
-- a version's item rows are never touched. This migration adds the date-aware
-- versioning columns + the resolution/uniqueness indexes that make it correct.
--
-- ── THE INVARIANT (adjudication a) ────────────────────────────────────────────────
-- A lineage (location_id, type, prep_subtype, name) may have MULTIPLE active rows
-- (a currently-effective version + a pending next-day version). DATE-AWARE
-- RESOLUTION is the ONLY correctness mechanism — the app picks the newest active
-- version whose effective date is on-or-before the operational date:
--     WHERE active AND (effective_from IS NULL OR effective_from <= :opDate)
--     ORDER BY effective_from DESC NULLS LAST, created_at DESC
--     LIMIT 1
-- Correctness NEVER depends on retirement sweeps. Retirements are hygiene, not
-- the resolution rule.
--
-- ── COLUMNS ───────────────────────────────────────────────────────────────────────
-- effective_from date NULL:
--   NULL  = "always effective" (every legacy row — there is exactly ONE per lineage
--           today, so NULL rows never collide under the partial-unique below).
--   date  = the operational day the version goes live. A publish always sets it
--           (today for apply-now, tomorrow for the default next-day publish).
-- supersedes_template_id uuid NULL REFERENCES checklist_templates(id) ON DELETE SET
--   NULL: the source version a mint replaced (lineage story; forensic, not resolution).
--
-- ── UNIQUENESS (ORCHESTRATOR CORRECTION to the scout's name-only DDL) ──────────────
-- The design's both-active window (current + pending SHARE the name) VIOLATES a
-- name-only partial-unique. The active uniqueness index MUST include effective_from:
-- distinct effective_from rows coexist (current vs pending); a double-publish to the
-- SAME effective date is blocked (correct — you can't publish two versions live the
-- same morning). NULL effective_from rows are distinct under PG NULL semantics — a
-- second NULL-effective row for a lineage would be allowed, but that never happens:
-- legacy has exactly one NULL per lineage and every publish sets a concrete date, so
-- no two NULL-effective rows for one lineage can ever be produced by this code path.
--
-- ── APPLY-FIRST-SAFE (the #191 protocol) ──────────────────────────────────────────
-- Additive columns default NULL; every legacy row reads as "always effective" — the
-- resolver's NULLS-LAST ordering treats a NULL exactly as the pre-0162 most-recent-
-- active pick did (one active row per lineage → identical result). The OLD code
-- selects `id`/`name` and never touches these columns, so applying 0162 first is a
-- no-op on the live app. The NEW code REQUIRES the columns → migration applies
-- before the code merges.
--
-- Additive only; NO backfill (legacy rows intentionally stay effective_from NULL).

BEGIN;

ALTER TABLE checklist_templates
  ADD COLUMN IF NOT EXISTS effective_from date NULL,
  ADD COLUMN IF NOT EXISTS supersedes_template_id uuid NULL
    REFERENCES checklist_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN checklist_templates.effective_from IS
  'Operational day this version goes live. NULL = always effective (legacy rows). '
  'Date-aware resolution (0162): newest active row with effective_from <= opDate, '
  'ORDER BY effective_from DESC NULLS LAST, created_at DESC.';
COMMENT ON COLUMN checklist_templates.supersedes_template_id IS
  'The source template version this row was minted to replace (publish lineage). '
  'Forensic only — not part of resolution. ON DELETE SET NULL.';

-- Drop the name-only unique that blocks same-name versioning.
-- Reversibility: the dropped constraint was
--   CONSTRAINT checklist_templates_location_id_type_name_key UNIQUE (location_id, type, name)
-- (backed by a btree index of the same name). To restore, recreate that exact
-- UNIQUE — but only after collapsing any multi-active lineage back to one row.
ALTER TABLE checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_location_id_type_name_key;

-- Active-uniqueness including effective_from (see ORCHESTRATOR CORRECTION above):
-- current + pending coexist (distinct effective_from); same-effective-date double
-- publish is blocked; prep_subtype keeps am_prep vs mid_day_prep distinct within a
-- location's prep lineage.
--
-- ⚠ COALESCE, not a bare (prep_subtype) — adversarial review H2: prep_subtype is
-- NULL for every non-prep type (0059 CHECK), and Postgres default NULL semantics
-- treat NULL index entries as DISTINCT, so a bare-column index would enforce
-- NOTHING for opening/closing (the only types the publish engine serves) — a
-- concurrent double-publish would silently double-activate. COALESCE('') makes
-- the NULL subtype a real comparable value; the lineage query's .is(null) form
-- is unaffected (the index is a guard, not a lookup contract).
CREATE UNIQUE INDEX IF NOT EXISTS checklist_templates_active_name_ef_uk
  ON checklist_templates (location_id, type, name, (COALESCE(prep_subtype, '')), effective_from)
  WHERE active;

-- Resolution accelerator for the date-aware lineage pick.
CREATE INDEX IF NOT EXISTS checklist_templates_resolve_idx
  ON checklist_templates (location_id, type, active, effective_from DESC);

COMMIT;
