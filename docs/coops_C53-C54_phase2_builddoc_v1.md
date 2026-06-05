# CO-OPS C.53–C.54 Phase 2 Build Doc v1 — RACI + Lane Map + Hotspots

> **For Triad A (Juan + Claude Chat):** B1 plan gate — review tier tags, lane structure, discipline accounting, and done-condition. No code written yet. Lock before execution.

**Date:** 2026-05-30
**Source:** B1 kickoff from Juan (WhatsApp), ground-truth verified against git HEAD `e27a00c`
**Working dir:** `C:\Users\conta\co-ops`
**Workflow:** v5.3 LOCKED — read-ground-truth → plan → gate → build → first-eyes → Triad A code-gate → smoke → commit → push

---

## 1. Ground Truth Verification (run before this doc, results captured)

```
git log --oneline -3:
e27a00c chore(infra): track orchestration tooling, ignore Flash run-state
85b3550 docs(handoff): C.53 next-session handoff
f4e110e docs(C.53): mark §10 shipped — stuck-shift class closed in production

git status -sb:
## main...origin/main   (clean, in sync)

tsc --noEmit: PASS (zero errors)
```

- `SPEC_AMENDMENTS.md` §11.1: C.53 §10 SHIPPED; Phase 2 is the next loop
- `checklist_instances.status` includes `phase1_complete` and `phase2_complete` (migration 0054)
- `checklist_completions.count_provenance` column exists (migration 0054)
- `checklist_instances.opener_no_prior_data_reason` column exists (migration 0054)

---

## 2. What This Build Is

**Adaptation-led (70-75% reuse, 25-30% greenfield).** Three shipped patterns applied:

| Pattern | Source | Reused as-is |
|---------|--------|--------------|
| Claim / revert / hand-off | `lib/checklists.ts` → `revokeCompletion`, `revokeWithReason`, `tagActualCompleter`, `loadPickerCandidates` | Template-agnostic, bare `completionId + actor`, zero closing-coupling |
| Per-item save | `checklist_completions` row-per-item, same column set, semantics in `prep_data->phase2` | Same carrier Phase 1 uses for `phase1` |
| Read contract | `prep_data->phase1` 8 keys from migration 0055 (lines 388-397) | Zero-drift confirmed; treated as immutable input |

**Greenfield (25%):** One bounded RPC (`submit_phase2_atomic`) + one thin route (`/api/opening/submit/phase2/route.ts`) + stubbed lib body swap (`submitPhase2Atomic` in `lib/opening.ts`).

---

## 3. Lane Structure Decision — Coupling Test RUN, Not Asserted

### Coupling test

**Question:** Can the RPC migration + `submitPhase2Atomic` lib body swap + `/api/opening/submit/phase2/route.ts` compile and pass pre-gate standalone, without the Phase 2 UI surface existing?

**Test executed 2026-05-30:**

1. **Existing codebase passes `tsc --noEmit`:** ✅ confirmed
2. **`submitPhase2Atomic` stub already exported from `lib/opening.ts`** (line 1914): ✅ compiles
3. **`OpeningEntryPhase2` type already defined in `lib/types.ts`** (line 832): ✅ compiles
4. **New route would import only from existing compiling modules:**
   - `submitPhase2Atomic` from `@/lib/opening` — exported
   - `OpeningError` from `@/lib/opening` — exported
   - `requireSession` from `@/lib/session` — exists
   - `getServiceRoleClient` from `@/lib/supabase-server` — exists
   - `extractIp`, `jsonError`, `jsonOk`, `parseJsonBody` from `@/lib/api-helpers` — exist
   - `lockLocationContext` from `@/lib/locations` — exists
   - `mapOpeningError` from `../../_helpers` — exists
   - **No component import needed:** ✅
5. **RPC migration is SQL** — does not participate in TypeScript compilation: ✅

**Result: SEPARABLE.** RPC + route compiles standalone. Lane structure: TWO LANES.

### Lane assignments

| Lane | What | Tier | Rationale |
|------|------|------|-----------|
| **Lane 1 (A)** | `submit_phase2_atomic` RPC migration + `submitPhase2Atomic` lib body swap + `app/api/opening/submit/phase2/route.ts` | **T0 (Claude Code)** | Carries both hard disciplines (§8.4 contract, no-auto-complete); the dangerous ~25% greenfield; isolated for clean first-eyes pass |
| **Lane 2 (B)** | Phase 2 prep UI surface — claim/revert/save affordances on `OpeningPrepEntry` / new `OpeningPrepPhase2` component | **T1 (Flash-direct, Aggie-orch)** | Reuse-driven — copy the `closing-client.tsx:365-460` callback pattern; claim/revert buttons + per-item save + multiplayer display |
| **Integration commit** | Wire Lane 2's UI to Lane 1's route + form-to-lane routing in `opening-client.tsx` | **T0 (CC interactive)** | Coupled surface: UI → route handoff touches both lanes' consumers |

**Lane 1 ships first** (isolated, reviewable on its own). Lane 2 follows. Integration commit binds them.

---

## 4. Per-Task Tier Tags + Hotspot Map

### Lane 1 — RPC + Route + Lib (T0, Claude Code interactive)

| # | Task | Files | Tier | Hotspot flags |
|---|------|-------|------|---------------|
| 1.1 | Migration `0056_create_submit_phase2_atomic_rpc.sql` | New file | **T0** | ⚠ §8.4 contract write — DO NOT transcribe 0050 blob; ⚠ no auto-complete branch (C.54 §2.A — Phase 3 owns); ⚠ read `prep_data->phase1` contract (8 keys from 0055:388–397); ⚠ C.54 §9 "preserved-from-prior" sweep on ALL branches; ⚠ status advance `phase1_complete → phase2_complete` |
| 1.2 | `lib/opening.ts`: replace `submitPhase2Atomic` stub body with real RPC invocation | Modify: lines 1914–1930 | **T0** | ⚠ Phase1RpcResult shape mirrors must stay in-sync; ⚠ error translation (P0001 codes from RPC → OpeningError subclasses); ⚠ pre-flight: instance.status === 'phase1_complete' guard |
| 1.3 | `app/api/opening/submit/phase2/route.ts` | New file | **T0** | Pattern: clone Phase 1 route (`phase1/route.ts`); swap phase guard to 'phase2'; swap stub to `submitPhase2Atomic`; add phase2 entry shape validation (openerPrepped required, overPar/underPar nullable, reason gate) |
| 1.4 | `lib/i18n/{en,es}.json`: Phase 2 route error keys | Modify | **T1-flash** | Pure copy-i18n: error codes → translation keys. `phase2_not_eligible`, `opener_prepped_missing` |
| 1.5 | `lib/opening.ts`: `OpeningPhase2NotEligibleError` subclass + `Phase2RpcResult` interface | Modify | **T1-flash** | Type-only; mirrors `Phase1RpcResult` shape |

**Shared-surface coupling in Lane 1:** Task 1.2 and 1.3 share the `submitPhase2Atomic` signature — tsc-coupled. Must ship in same commit.

### Lane 2 — Phase 2 Prep UI (T1, Flash-direct + Aggie-orch)

| # | Task | Files | Tier | Hotspot flags |
|---|------|-------|------|---------------|
| 2.1 | `OpeningPrepPhase2.tsx` — new component wrapping per-item claim/revert/save | New file | **T1-flash** | Reuse `closing-client.tsx`:365–460 callback pattern; use `revokeCompletion`/`revokeWithReason` APIs; per-item `checklist_completions` INSERT/UPDATE via existing `/api/checklist/completions` route |
| 2.2 | Per-item claim button + "claimed by" display | `OpeningPrepPhase2.tsx` | **T1-flash** | Multi-author display: who claimed what; claim = write `count_provenance='closer_captured'` + `completed_by` + `completed_at` to `checklist_completions` |
| 2.3 | Per-item revert button (quick-window silent, post-window with reason) | `OpeningPrepPhase2.tsx` | **T1-flash** | Reuse `closing-client.tsx`:404-444 `handleItemRevokeWithReason`; 60s window for silent self-untick; post-60s requires reason |
| 2.4 | Per-item save: openerPrepped input + overPar/underPar modals | `OpeningPrepPhase2.tsx` | **T1-flash** | Reuse existing modals (`OverParModal`, `UnderParModal`); semver from 0053 RPC's per-item gate logic |
| 2.5 | Real-time subscription: stale-while-revalidate + optimistic update | `OpeningPrepPhase2.tsx` | **T1-flash** | `useEffect` subscription on `checklist_completions` for instance; merge into local state; last-write-wins per-item |
| 2.6 | i18n: Phase 2 UI keys | `lib/i18n/{en,es}.json` | **T1-flash** | `opening.phase2.claim`, `opening.phase2.revert`, `opening.phase2.revert_reason_title`, etc. |

### Integration (T0, CC interactive)

| # | Task | Files | Tier | Hotspot flags |
|---|------|-------|------|---------------|
| I.1 | Wire Phase 2 form submit to new route | `app/(authed)/operations/opening/opening-client.tsx` | **T0** | ⚠ `handlePhase2Submit` dispatches to `/api/opening/submit/phase2`; ⚠ instance status routing (phase1_complete → Phase 2 tab active) |
| I.2 | Piece 4 guardrail removal — legacy route `phase2_pending_next_release` | `submit/route.ts`:489 | **T0** | After Phase 2 route ships, remove the Piece 4 defensive branch; legacy route becomes phase-agnostic again OR deprecated |
| I.3 | Finalize button: advance `phase1_complete → phase2_complete` | `OpeningPrepPhase2.tsx` + `opening-client.tsx` | **T0** | ⚠ Dispatches to `submitPhase2Atomic`; ⚠ under-prep notification dispatch per-item; ⚠ delta computation + audit counter write |

---

## 5. Two HARD Disciplines — Explicit Accounting

### Discipline 1: NO auto-complete branch

**Source:** C.54 §2.A + Triad A ruling 2026-05-26

Phase 2 submit RPC (`submit_phase2_atomic`) must NOT contain an opening→closing auto-complete branch. The 0053 legacy RPC's auto-complete (lines 539-584) is NOT inherited. Phase 3 owns opening→closing auto-complete.

**Verification at review time:** grep the new RPC for `closing_ix`, `auto_complete`, `v_auto_complete_id`, `Opening verified`. Must return zero hits.

### Discipline 2: Write §8.4 contract, NOT the 0050 blob

**Source:** B1 kickoff discipline 2 + C.50 §8.4 invariant

**0050 blob (DO NOT COPY):** `{openerActual, openerPrepped, overPar, underPar, closerEstimateSnapshot}` — pre-§8.4, post-C.50 redesign obsolete.

**0053 §8.4 contract (COPY this shape):** from migration 0053 lines 388-401:
```
phase: 2
closer_count
spot_check_status
opener_recount
ground_truth_count
prep_need
opener_prepped
delta_vs_prep_need
over_under_status          (at_par | over_prep | under_prep)
over_under_reason_category
over_under_reason_text
directed_by
```

All fields persist even on the happy path where delta=0.

**Verification at review time:** diff the new RPC's `jsonb_build_object` against migration 0053:388-401 — same field names, same order, same semantics.

### C.54 §9 "preserved-from-prior" sweep

**New RPC must be audited before first review.** Every branch carrying a comment like "preserved from 0053" or "unchanged from 0055" or "logic preserved from prior" must be re-verified against:
- C.54's NULL-source-as-valid-state assumption
- C.53's three-phase restructure (Phase 1 already wrote `prep_data->phase1`; Phase 2 reads it)
- No implicit dependency on a closing(N-1) existing

---

## 6. Recorded Deferral — Conscious, Not a Gap

**Phase 1 edit re-entry coordination.** The architecture permits a Phase 1 chain-edit at `phase1_complete` that would silently re-derive `ground_truth_count`/`prep_need` without changing status — which would invalidate Phase 2 deltas already saved against the old numbers.

- **Current state:** No Phase 1 edit UI exists; the chain-edit path has no UI trigger. Contract is frozen.
- **Deferral:** IF a Phase 1 edit UI ever ships, the delta-invalidation coordination must be designed at that point.
- **Recorded here** so it's a deliberate decision, not a latent production surprise.

---

## 7. Done-Condition (Behavioral Smoke, Not Commit)

- [ ] No-prior-data opener flows Phase 1 → Phase 2 (instance at `phase1_complete`, Phase 2 tab active)
- [ ] Multiple actors can claim Phase 2 prep items (different users, same location)
- [ ] Claimed items show "claimed by [name]" to other actors
- [ ] Actors can complete their claimed items (per-item save writes §8.4 contract)
- [ ] Actors can revert their own items (silent within 60s, with reason after)
- [ ] Finalize computes deltas correctly: `delta_vs_prep_need = opener_prepped − prep_need`
- [ ] Finalize advances instance to `phase2_complete`
- [ ] Under-prep items dispatch N-per-item notifications (urgent, KH+ at location + MoO + Owner)
- [ ] Over-prep items persist reason captures (overPar category + directedBy/freeText)
- [ ] Pre-gate green (tsc --noEmit + eslint + next build)
- [ ] Juan's operational smoke against a real instance (FT.2 equivalent of the d49d1504 FT.1)

---

## 8. Pre-Gate Current State

```
tsc --noEmit: PASS
eslint:       (pre-gate baseline 17 warnings — advise only, do not creep)
next build:   (deploy-verified green)
```

---

## 9. Operational Context

- **Workflow:** v5.3 LOCKED
- **Pipe for talk:** this doc → Triad A plan gate → execution through Juan's interactive CC
- **No self-approve:** Aggie wrote this; CC reviews it independently in the adversarial pass
- **Proprietary-by-default:** all CO-OPS code in this build; all T0 goes to cleared providers (CC + Aggie + Flash-direct on paid DeepSeek API)
- **Flash-direct dispatch:** `terminal("python scripts/flash-dispatch.py '<task>' '<filepath>'", workdir="~/co-ops")` — for Lane 2 tasks
- **Pre-gate invocation:** `bash scripts/pre-gate.sh` in `~/co-ops`

---

*Written 2026-05-30 by Aggie. Surfaced to Triad A for plan gate. No code written yet. Verify against git before trusting any line reference above.*
