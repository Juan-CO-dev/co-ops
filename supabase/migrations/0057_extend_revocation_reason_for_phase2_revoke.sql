-- Migration 0057_extend_revocation_reason_for_phase2_revoke
-- Applied via Supabase MCP apply_migration (plugin:supabase:supabase) on 2026-06-03.
-- Canonical references:
--   - lib/opening.ts (revokePhase2Completion — Lane D of C.53 Phase 2 Commit B;
--     consumes the two new reason values)
--   - lib/checklists.ts revokeWithReason (closing revoke; owns the prior three values
--     'error_tap' / 'not_actually_done' / 'other' — left intact)
--   - docs/SPEC_AMENDMENTS.md C.53 §8.4 (Phase 2 per-item revoke)
--   - Migration 0032_checklist_completions_revocation_and_accountability
--     (added the original three-value revocation_reason CHECK constraint)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Extends the checklist_completions_revocation_reason_check CHECK constraint to
-- admit the two Phase-2-prep-specific revoke reasons in addition to closing's
-- existing three:
--
--   existing (closing, untouched): 'error_tap', 'not_actually_done', 'other'
--   new (opening Phase 2 prep):     'quick_reenter', 're_enter_count'
--
-- 'quick_reenter' is the SILENT quick-window (<60s self) revert sentinel; it is
-- written ONLY when a structured revoke is later required to name a reason, never
-- as a forensic claim of an error (distinct from closing's 'error_tap' so the
-- audit trail stays honest). 're_enter_count' is the structured/post-window
-- prep-recount reason. Both are prep-appropriate and must NOT reuse closing's
-- vocabulary.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ATOMICITY
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A bare DROP-then-ADD would leave a window in which the table carries NO
-- revocation_reason constraint. Both ALTERs are wrapped in a single DO block,
-- which PostgreSQL executes as ONE statement inside one (implicit or enclosing)
-- transaction. The drop and add therefore commit together or roll back together
-- with no intervening unconstrained window — independent of whether the migration
-- runner adds its own outer transaction. The BEGIN/END below are plpgsql block
-- delimiters, not transaction-control statements.

DO $$
BEGIN
  ALTER TABLE checklist_completions
    DROP CONSTRAINT checklist_completions_revocation_reason_check;

  ALTER TABLE checklist_completions
    ADD CONSTRAINT checklist_completions_revocation_reason_check
    CHECK (revocation_reason = ANY (ARRAY[
      'error_tap'::text,
      'not_actually_done'::text,
      'other'::text,
      'quick_reenter'::text,
      're_enter_count'::text
    ]));
END $$;
