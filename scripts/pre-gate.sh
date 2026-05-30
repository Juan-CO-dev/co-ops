#!/usr/bin/env bash
# CO-OPS pre-gate v5.3 — deterministic mechanical checks only
# Sequence: typecheck → lint → build (fail-fast)
# Passes/fails on check RESULTS ONLY. Wall-clock is NOT correctness.
# "Test suite pass" is explicitly NOT in this gate.
#
# Aggie invocation: terminal("bash scripts/pre-gate.sh", workdir="~/co-ops")
# Failure contract: exit ≠ 0 → unit never reaches CC → Aggie routes failure output
#   to authoring tier with this script's full stdout/stderr attached.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

START_TS=$(date +%s)
PASSED=true
FIRST_FAILURE=""
FIRST_FAILURE_CODE=0
declare -a FAILURES=()

echo "=== CO-OPS PRE-GATE v5.3 ==="
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ---- Step 1: Typecheck (tsc --noEmit) ----
echo "--- [1/3] typecheck (tsc --noEmit) ---"
TYPECHECK_RC=0
TYPECHECK_OUT=$(npx tsc --noEmit 2>&1) || TYPECHECK_RC=$?
if [ $TYPECHECK_RC -eq 0 ]; then
    echo "PASS: typecheck"
else
    PASSED=false
    FIRST_FAILURE="typecheck"
    FIRST_FAILURE_CODE=$TYPECHECK_RC
    FAILURES+=("typecheck")
    echo "$TYPECHECK_OUT"
    echo "FAIL: typecheck (exit $TYPECHECK_RC)"
fi

# ---- Step 2: Lint (eslint) ----
if $PASSED; then
    echo ""
    echo "--- [2/3] lint (eslint) ---"
    # Errors hard-block at 0. Warnings are gated against a ratcheting baseline:
    # eslint exits non-zero on any error OR when warnings exceed --max-warnings,
    # so $WARN_BASELINE catches NEW warnings as regressions without dying on the
    # pre-existing ones. The baseline only moves DOWN, and only by a deliberate
    # human act — the gate advises, it never writes the baseline (see block below).
    WARN_BASELINE_FILE="$REPO_ROOT/.pre-gate-warning-baseline"
    if [ -f "$WARN_BASELINE_FILE" ]; then
        WARN_BASELINE=$(cat "$WARN_BASELINE_FILE")
    else
        WARN_BASELINE=17
    fi

    LINT_RC=0
    LINT_OUT=$(npx eslint . --max-warnings "$WARN_BASELINE" 2>&1) || LINT_RC=$?

    # Best-effort parse of eslint's summary line for messaging + ratchet only.
    # The pass/fail verdict is driven by LINT_RC (eslint's own exit code); a parse
    # miss degrades the warning count we report and skips the ratchet, never the gate.
    LINT_SUMMARY=$(printf '%s\n' "$LINT_OUT" | grep -oE '\([0-9]+ errors?, [0-9]+ warnings?\)' | tail -1 || true)
    WARN_COUNT=$(printf '%s' "$LINT_SUMMARY" | grep -oE '[0-9]+ warning' | grep -oE '[0-9]+' || true)
    WARN_COUNT=${WARN_COUNT:-0}

    if [ $LINT_RC -eq 0 ]; then
        echo "PASS: lint (0 errors, ${WARN_COUNT} warnings ≤ ${WARN_BASELINE} baseline)"
        # Ratchet (advise-only): the gate NEVER writes the baseline itself —
        # mutating gate infra mid-check could ride an uncommitted file into
        # someone's commit. It only reports that the baseline COULD move down;
        # lowering it is a deliberate human act (edit the file + commit). The
        # baseline never moves up.
        if [ "$WARN_COUNT" -lt "$WARN_BASELINE" ]; then
            echo "RATCHET AVAILABLE: warnings are at ${WARN_COUNT}, below the ${WARN_BASELINE} baseline."
            echo "  To lock the gain, set ${WARN_BASELINE_FILE} to ${WARN_COUNT} and commit it."
        fi
    else
        PASSED=false
        if [ -z "$FIRST_FAILURE" ]; then
            FIRST_FAILURE="lint"
            FIRST_FAILURE_CODE=$LINT_RC
        fi
        FAILURES+=("lint")
        echo "$LINT_OUT"
        echo "FAIL: lint (exit ${LINT_RC}) — errors present OR warnings exceeded ${WARN_BASELINE} baseline"
    fi
fi

# ---- Step 3: Build (next build) ----
if $PASSED; then
    echo ""
    echo "--- [3/3] build (next build) ---"
    BUILD_RC=0
    BUILD_OUT=$(npx next build 2>&1) || BUILD_RC=$?
    if [ $BUILD_RC -eq 0 ]; then
        echo "PASS: build"
    else
        PASSED=false
        if [ -z "$FIRST_FAILURE" ]; then
            FIRST_FAILURE="build"
            FIRST_FAILURE_CODE=$BUILD_RC
        fi
        FAILURES+=("build")
        echo "$BUILD_OUT"
        echo "FAIL: build (exit ${BUILD_RC})"
    fi
fi

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo ""
echo "=== PRE-GATE COMPLETE ==="
echo "Duration: ${ELAPSED}s"

if $PASSED; then
    echo "Result:   ALL PASS"
    # Latency flag (non-blocking — for Aggie investigation, not correctness)
    BUDGET=180  # 3 min target
    if [ $ELAPSED -gt $BUDGET ]; then
        echo ""
        echo "⚠ LATENCY FLAG: pre-gate completed in ${ELAPSED}s (>${BUDGET}s budget)"
        echo "  Unit PASSED but exceeded latency target — Aggie to investigate:"
        echo "  oversized unit to split? runaway typecheck? slow build?"
    fi
else
    echo "Result:   FAILED"
    echo "Failed steps: ${FAILURES[*]}"
    # Explicit: non-zero exit routes to Aggie → authoring tier per failure contract
    exit $FIRST_FAILURE_CODE
fi

echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
