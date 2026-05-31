#!/usr/bin/env bash
# phase2-discipline-check.sh — CI gate for the two HARD disciplines of the
# C.53 Phase 2 build (build doc v2.2 §5). Blocks merge if the Phase 2 RPC
# migration violates either discipline.
#
#   Discipline 1 (NO auto-complete branch — C.54 §2.A): the Phase 2 RPC must NOT
#     contain the 0053 opening→closing auto-complete branch. Phase 3 owns it.
#     This is the C.54 §9 (d49d1504) bug-class guard.
#   Discipline 2 (Write the §8.4 contract, NOT the 0050 blob): the §8.4
#     jsonb_build_object('phase2', ...) write must carry all 12 CORE fields
#     (minimum-present invariant) and MUST NOT carry the 0050 blob signature.
#
# Inverse-drift guard: the canonical full §8.4 set = 12 core + 2 provenance
# (saved_at, saved_by) = 14. This script enforces the 12 core as a
# minimum-present invariant (presence, NOT exclusivity) — saved_at/saved_by are
# expected additions and must NOT be stripped to "match 0053".
#
# Usage:  scripts/phase2-discipline-check.sh [migration_file]
# Default target: supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql
# Exit 0 = pass; exit 1 = discipline violation (CI fails the build).

set -euo pipefail

MIGRATION="${1:-supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql}"

if [[ ! -f "$MIGRATION" ]]; then
  echo "FAIL: migration file not found: $MIGRATION" >&2
  exit 1
fi

fail=0

# ── Discipline 1 — banned auto-complete identifiers (0053 branch symbols) ──
# These are CODE IDENTIFIERS from 0053's auto-complete branch, not English
# prose. Hyphenated "auto-complete" in comments is fine; the underscore
# identifier `auto_complete` / the named CTE `closing_ix` / etc. are the ban.
BANNED=(
  "closing_ix"
  "auto_complete"
  "v_auto_complete_id"
  "Opening verified"
  "resolveClosingOpeningVerifiedRefItemId"
  "closingReportRefItemId"
  "closingAutoCompleteId"
)
for sym in "${BANNED[@]}"; do
  if grep -qF -- "$sym" "$MIGRATION"; then
    echo "FAIL [Discipline 1]: banned auto-complete symbol '$sym' present in $MIGRATION" >&2
    echo "  → Phase 3 owns opening→closing auto-complete (C.54 §2.A). Do NOT inherit the 0053 branch." >&2
    fail=1
  fi
done

# ── Discipline 2a — 0050 blob signature must be absent ──
if grep -qF -- "closerEstimateSnapshot" "$MIGRATION"; then
  echo "FAIL [Discipline 2]: 0050-blob signature 'closerEstimateSnapshot' present in $MIGRATION" >&2
  echo "  → Write the §8.4 contract (12 core + saved_at/saved_by), NOT the pre-§8.4 0050 blob." >&2
  fail=1
fi

# ── Discipline 2b — all 12 CORE §8.4 fields present (minimum-present) ──
CORE_FIELDS=(
  "'phase'"
  "'closer_count'"
  "'spot_check_status'"
  "'opener_recount'"
  "'ground_truth_count'"
  "'prep_need'"
  "'opener_prepped'"
  "'delta_vs_prep_need'"
  "'over_under_status'"
  "'over_under_reason_category'"
  "'over_under_reason_text'"
  "'directed_by'"
)
for field in "${CORE_FIELDS[@]}"; do
  if ! grep -qF -- "$field" "$MIGRATION"; then
    echo "FAIL [Discipline 2]: §8.4 core field $field missing from $MIGRATION" >&2
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "phase2-discipline-check: FAILED for $MIGRATION" >&2
  exit 1
fi

echo "phase2-discipline-check: PASS — $MIGRATION ($(basename "$MIGRATION"))"
echo "  Discipline 1: no auto-complete branch symbols."
echo "  Discipline 2: 12 core §8.4 fields present, no 0050 blob signature."
echo "  (Canonical full §8.4 set = 12 core + saved_at/saved_by = 14.)"
exit 0
