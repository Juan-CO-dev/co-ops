-- Migration 0163_hard_gate_and_spine_floor
-- STAGED in PR; prod apply deferred to Juan's go — but apply BEFORE merging the code
-- (the #191 apply-first protocol). The NEW code (the confirmInstance hard-gate branch,
-- the gate_tier / set_report_ref / ref_track publish ops, the reference pickers) READS
-- checklist_template_items.hard_gate + ref_track_item_completion; the OLD code never
-- reads or writes them, so applying 0163 before merge is a no-op on the running app and
-- cannot break anything (see APPLY-FIRST-SAFE below).
-- Canonical reference: docs/superpowers/specs/2026-07-28-template-builder-design.md
--                      (§3 GATE TIERS owner-ruled, §4 THE SPINE-LINK LAW, §5 CROSS-LIST
--                      REFERENCES & GATES, council-ratified 2026-07-28) + the
--                      orchestrator's adjudicated PR-4 design.
--
-- PR-4 of the Template Builder arc: REFERENCES & GATES. This migration adds the two
-- new per-line columns the builder writes (both additive, both NOT NULL DEFAULT false
-- so every legacy row reads as "off") and DOCUMENTS the spine-link DB floor as a
-- DEFERRED block (see THE NOT-VALID-CHECK HAZARD below — it cannot ship live today
-- without breaking the es-fill campaign on the 34 legacy unlinked count rows).
--
-- ── COLUMNS (additive; both default false) ─────────────────────────────────────────
-- hard_gate boolean NOT NULL DEFAULT false:
--   The owner-ruled per-line NO-OVERRIDE gate (spec §3). When true on an ACTIVE item,
--   confirmInstance blocks finalization until that item is live-completed — no written-
--   reason path (the cash-deposit pattern generalized to any line of any list). Setting
--   it in the builder is a STRUCTURAL edit → it versions (a gate_tier publish op).
--   Guardrail lives in the UI (Tier-A step-up + plain warning); the column is a plain
--   flag. Legacy rows = false (no behavior change; the existing cash_report special
--   case in confirmInstance is UNCHANGED — folding cash into hard_gate is a DATA change
--   the owner decides, not this migration; NO seed here).
-- ref_track_item_completion boolean NOT NULL DEFAULT false:
--   The ONE new reference mechanism (spec §5). When true on a NON-mirror item that also
--   carries references_template_item_id, reconcileClosingReportRefs auto-ticks THIS item
--   when the specifically-referenced item has a live completion on today's instance of
--   its template lineage (date-aware resolution). Gating the new reconcile read on this
--   flag (NOT merely on references_template_item_id being set) keeps it from colliding
--   with the opening Phase-2 mirror's existing use of references_template_item_id
--   (lib/opening.ts loadCloserCountSnapshot). Legacy rows = false.
--
-- references_template_item_id on NON-mirror rows becomes LEGAL by this change: the
-- column already exists (migration 0049, mirror-only until now) with an ON DELETE SET
-- NULL FK to checklist_template_items(id) — a set_report_ref/ref_track publish op may
-- now populate it on a closing item pointing at an opening item. No schema change is
-- needed for that (the FK already tolerates any checklist_template_items row); the
-- seal that keeps mirrors read-only keys on prep_meta.openingPhase2, not on references.
--
-- ── APPLY-FIRST-SAFE (the #191 protocol) ───────────────────────────────────────────
-- Additive columns, both DEFAULT false: every legacy row reads exactly as it did pre-
-- 0163 (no hard gate, no ref-track). The OLD code selects neither column and never
-- writes them, so applying 0163 first is a no-op on the live app. The NEW code REQUIRES
-- the columns → migration applies before the code merges.
--
-- ── VERIFIED AGAINST LIVE SCHEMA (2026-07-28, project bgcvurheqzylyfehqgzh) ──────────
-- item_id FK: A REAL FK ALREADY EXISTS —
--     checklist_template_items_item_id_fkey  FOREIGN KEY (item_id) REFERENCES items(id)
-- but WITHOUT ON DELETE SET NULL (defaults to NO ACTION). The brief asked to ADD the FK
-- if MISSING; it is not missing. Changing the delete action requires DROP + re-ADD of a
-- VALIDATED constraint (a heavier, non-additive op) and NO ACTION is operationally safe
-- here (items are append-only — deactivated via active=false, never hard-deleted; see
-- AGENTS.md append-only law), so the delete-action change is DEFERRED (documented below),
-- not shipped in this additive migration.
-- references_template_item_id FK: already ON DELETE SET NULL (no change).
--
-- ── THE NOT-VALID-CHECK HAZARD — why the spine-link CHECK is DEFERRED ────────────────
-- The design (spec §4) wants a DB floor:
--     CHECK ((NOT expects_count) OR (item_id IS NOT NULL OR vendor_item_id IS NOT NULL))
--     NOT VALID   -- validate new/updated rows only, tolerate legacy
-- Postgres enforces a NOT VALID CHECK on any UPDATE to ANY column of a legacy row (not
-- just inserts). Live query at migration authoring time:
--     34 ACTIVE expects_count rows exist, ALL of them unlinked (item_id + vendor_item_id
--     both NULL) — the entire legacy needs-link backlog the Doctor flags.
-- The es-fill campaign (fillItemTranslations) UPDATEs `translations` on exactly these
-- rows. With the CHECK live, that UPDATE would violate it and 500 — the CHECK as stated
-- BREAKS the es-fill campaign on precisely the rows the Doctor is driving managers to
-- fix. Per the orchestrator pre-ruling, the hard enforcement is shipped in the SERVER
-- LIB ONLY for this PR (copyItemsToVersion + the add path already require a spine link
-- on count-bearing lines at write time; PR-4 re-verifies the gate_tier/reference ops
-- cannot bypass it), and the DB CHECK is DEFERRED to after the needs-link backlog clears.
--
-- ── DEFERRED (enable in a follow-up AFTER the needs-link backlog reaches 0) ──────────
-- When `SELECT count(*) FROM checklist_template_items WHERE expects_count AND item_id IS
-- NULL AND vendor_item_id IS NULL` reaches 0 (or the surviving rows are backfilled to a
-- placeholder item), enable the DB floor:
--
--   ALTER TABLE checklist_template_items
--     ADD CONSTRAINT checklist_template_items_count_link_ck
--     CHECK ((NOT expects_count) OR (item_id IS NOT NULL OR vendor_item_id IS NOT NULL))
--     NOT VALID;
--   -- then, once every legacy row is linked, VALIDATE it:
--   -- ALTER TABLE checklist_template_items VALIDATE CONSTRAINT checklist_template_items_count_link_ck;
--
-- And, if the owner wants item deletions to null the link rather than block:
--   ALTER TABLE checklist_template_items DROP CONSTRAINT checklist_template_items_item_id_fkey;
--   ALTER TABLE checklist_template_items
--     ADD CONSTRAINT checklist_template_items_item_id_fkey
--     FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL NOT VALID;
--   -- ALTER TABLE checklist_template_items VALIDATE CONSTRAINT checklist_template_items_item_id_fkey;
--
-- Additive only; NO backfill (legacy rows intentionally stay hard_gate/ref_track false).

BEGIN;

ALTER TABLE checklist_template_items
  ADD COLUMN IF NOT EXISTS hard_gate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ref_track_item_completion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN checklist_template_items.hard_gate IS
  'PR-4 (spec §3): owner-ruled per-line NO-OVERRIDE gate. When true on an active item, '
  'confirmInstance blocks finalization until it is live-completed (no written-reason '
  'path) — the cash-deposit pattern generalized to any line of any list. Structural: '
  'set via the gate_tier publish op (versions). Legacy rows = false. The cash_report '
  'special case in confirmInstance is unchanged (folding it into hard_gate is a data '
  'decision for the owner, not seeded here).';
COMMENT ON COLUMN checklist_template_items.ref_track_item_completion IS
  'PR-4 (spec §5): the ONE new reference mechanism. When true on a non-mirror item that '
  'also carries references_template_item_id, reconcileClosingReportRefs auto-ticks this '
  'item when the referenced item has a live completion on today''s instance of its '
  'template lineage (date-aware). Gated on THIS flag (not on references_template_item_id '
  'alone) to avoid colliding with the opening Phase-2 mirror''s use of that column. '
  'Legacy rows = false.';

COMMIT;
