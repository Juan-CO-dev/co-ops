> **⚠ SUPERSEDED — 2026-06-13.** Commit A merged into main as part of C.53 Phase 2 / Commit B via PR #50 (`7a4ef2e`); the feature branch `claude/c53-phase2-commit-a` is historical. Retained for context only — do not execute its build steps. Current state + remaining scope: `docs/REMAINING_SCOPE.md`.

# Handoff — C.53 Phase 2 §8.4 SAVE + FINALIZE (Commit A)

**Status:** Commit A committed to feature branch `claude/c53-phase2-commit-a` @ `7709df0`.
Synthetic-verified + guard-verified. **Real end-to-end smoke PENDING — this is the merge gate.**

**Date:** 2026-05-31

---

## Where we are

Commit A lands the Phase 2 §8.4 write + finalize path (SPLIT architecture):

- **SAVE** — `POST /api/opening/prep/item` → `savePhase2Item` → `save_phase2_item_atomic` (migration 0056). One prep item's phase2 completion, 14-field §8.4 shape, append-only (supersede-then-INSERT, [D1]). Returns written completion + server-computed delta/status.
- **FINALIZE** — `POST /api/opening/submit/phase2` → `submitPhase2Atomic` → `submit_phase2_atomic`. Takes only `instanceId` (no entries — per-item saves persist beforehand). Validates completeness over the Model Y universe, recomputes deltas authoritatively, dispatches under-prep notifications, advances `phase1_complete → phase2_complete`.
- Single-source delta helper `opening_phase2_compute_delta` (IMMUTABLE) called by both save + finalize.
- Disciplines: [D1] append-only supersede-then-INSERT; [D2] `count_provenance` mirrored from phase1; [D3] finalize chain-edit inert error; [D4] finalize re-sources from FROZEN `prep_data->phase1`. NO opening→closing auto-complete (C.54 §2.A; deliberately NOT inherited from 0050/0053).
- CI guard `scripts/phase2-discipline-check.sh` wired into `.github/workflows/build.yml` — asserts no auto-complete branch symbols + §8.4 12-core contract present.

Migration 0056 applied to PROD via Supabase MCP 2026-05-31 (header marked applied).

## Verification status

| Layer | Result |
|---|---|
| pre-gate (typecheck + lint + next build) | ALL PASS (2026-05-31) |
| phase2-discipline-check | PASS |
| Synthetic happy-path smoke (BEGIN/ROLLBACK, rolled back) | GREEN |

**Synthetic smoke covered:** 14-field §8.4 write; shared-helper deltas (over `+5`, under `-4`, par-null → `null`); par-null path; [D1] supersede; finalize recompute + counters (32 normal / 1 over / 1 under); status `phase1_complete → phase2_complete`; under-par notification dispatch (3 MoO+ recipients).

**Explicitly SYNTHETIC input:** the 8-key `prep_data->phase1` contract was manufactured for all 34 Model Y universe items. This proves Phase 2's **internal** soundness — NOT real cross-phase integration.

## The merge gate — real fresh-opening cross-phase e2e smoke

**Do NOT merge Commit A to main until this passes.**

The 0056 RPC requires `completions.prep_data->'phase1'` on every Model Y item or it raises `phase1_not_resolved`. Per migration 0055, `prep_data->phase1` is written ONLY for items with a non-null `spotCheckStatus`.

**Why 0335959d cannot serve as the smoke instance:** it is the only real `phase1_complete` instance in prod (MEP, real submission 2026-05-30 06:23:39 UTC), but its submission predates the §10 Lane A/B activation (`899061f` + `42562d3`, committed ~06:35–06:38 UTC) by ~12 minutes. It ran on pre-activation code, so all 44 completions have **NULL `prep_data`** — it can't feed the Phase 2 RPC.

**What's needed:** a NEW opening instance on current deployed code. The current form sends `spotCheckStatus: "matched_via_section_verify"`, which populates `prep_data->phase1` for the spot-check universe — satisfying the 0056 read contract.

## Next session done-condition

Run the fresh-opening cross-phase (Phase 1 → Phase 2) end-to-end smoke:

1. Create a fresh opening instance on current deployed code.
2. Submit Phase 1 (writes `prep_data->phase1` for the spot-check universe).
3. Run Phase 2 per-item saves + finalize, reading the real `prep_data->phase1`.
4. Verify the full chain end-to-end (not synthetic input).

That smoke is the gate before `claude/c53-phase2-commit-a` merges to main.

## Context cross-refs

- §10 Phase 1 restructure is SHIPPED + live (Lane A `899061f` + Lane B `42562d3`, 2026-05-30; §11 marked shipped `f4e110e` with FT.1 smoke passing). NOT dormant — the old "next-loop activation" premise was stale.
- Build docs: `docs/coops_C53-C54_phase2_builddoc_v2.md` (canonical v2.2).
- Migration: `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql`.
- Lib: `lib/opening.ts` (`savePhase2Item`, `submitPhase2Atomic`).
