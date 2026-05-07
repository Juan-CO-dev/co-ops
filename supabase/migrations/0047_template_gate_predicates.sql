-- Captured retroactively 2026-05-06 from supabase.migrations table.
-- Functional equivalent of applied migration; may differ in whitespace
-- or transaction wrapping from original MCP apply_migration input.
-- Canonical reference: lib/checklists.ts (GatePredicate +
-- GatePredicateRequiresState types + evaluateGatePredicate evaluator;
-- the gate-predicate evaluator is the load-bearing consumer of the
-- two new JSONB columns. Both columns currently NULL on all templates
-- pending PR 4 concrete-predicate writes — back-compat-by-default).

-- ─────────────────────────────────────────────────────────────────────
-- Build #3 PR 1 — gate predicate JSONB on checklist_templates
-- Per BUILD_3_OPENING_REPORT_DESIGN.md §4.4 + locked decisions B.1, B.2.
-- All existing templates default to NULL (back-compat: NULL = no gate;
-- evaluator returns satisfied=true). PR 4 writes concrete predicates.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE checklist_templates
  ADD COLUMN submission_gate_predicate JSONB NULL,
  ADD COLUMN edit_gate_predicate JSONB NULL;

COMMENT ON COLUMN checklist_templates.submission_gate_predicate IS
  'Build #3 PR 1: predicate gating instance creation. NULL = no gate (back-compat default for all existing templates pre-PR-4). PR 4 writes concrete predicates. Shape: { requires_state: [{template_type, operational_date_offset, status_in[]}, ...] } with AND-semantics across clauses. Evaluator: lib/checklists.ts evaluateGatePredicate.';
COMMENT ON COLUMN checklist_templates.edit_gate_predicate IS
  'Build #3 PR 1: predicate gating instance edits (C.46 post-submission update path). Same shape as submission_gate_predicate. NULL = no gate. PR 1 ships the column + lib evaluator; PR 4 wires canEditReport to consume.';
