# CO-OPS C.53–C.54 Phase 2 Build Doc v2 — RACI + Lane Map + Hotspots

> **For Triad A (Juan + Claude Chat):** B1 plan gate — v2 incorporates CC adversarial pass (2026-05-30) + Triad A adjudication. All five cracks folded. No code written yet. Lock before execution.

**Date:** 2026-05-30
**Source:** B1 kickoff from Juan (WhatsApp) + CC adversarial pass + Triad A adjudication
**Ground truth:** git HEAD `e27a00c`, `tsc --noEmit` PASS, tree clean
**Working dir:** `C:\Users\conta\co-ops`
**Workflow:** v5.3 LOCKED

---

## 1. Ground Truth Verification

```
git log --oneline -3:
e27a00c chore(infra): track orchestration tooling, ignore Flash run-state
85b3550 docs(handoff): C.53 next-session handoff
f4e110e docs(C.53): mark §10 shipped — stuck-shift class closed in production

git status -sb:   main...origin/main (clean, in sync)
tsc --noEmit:     PASS (zero errors)
```

- `SPEC_AMENDMENTS.md` §11.1: C.53 §10 SHIPPED; Phase 2 is next
- Migration 0054: `phase1_complete` + `phase2_complete` in status enum; `count_provenance` column; `opener_no_prior_data_reason` column — all exist
- Migration 0055 (`submit_phase1_atomic`): applied, live, Phase 1 writes the 8-key contract
- `lib/opening.ts`: `submitPhase2Atomic` stub exported (line 1914); `OpeningEntryPhase2` type defined (`lib/types.ts:832`)

---

## 2. What This Build Is

Adaptation-led (70-75% reuse). Three shipped patterns:

| Pattern | Source | Reused |
|---------|--------|--------|
| Claim / revert / hand-off | `lib/checklists.ts` — `revokeCompletion`, `revokeWithReason`, `tagActualCompleter`, `loadPickerCandidates` | Template-agnostic, bare `completionId + actor`, zero closing-coupling |
| Per-item save | `checklist_completions` row-per-item, same column set, semantics in `prep_data->phase2` | Same carrier Phase 1 uses for `phase1` |
| Read contract | `prep_data->phase1` 8-key contract from migration 0055 | Zero-drift confirmed; immutable input |

**Greenfield (~25%):** One RPC (`submit_phase2_atomic`) + one lib body swap (`submitPhase2Atomic`) + one route (`/api/opening/submit/phase2`) + Phase-2-aware per-item save endpoint.

**Not in scope — deferred to "C.52-full":** real-time subscriptions / live-sync. Phase 2 uses closing's model: each save persists independently, refresh to see other authors. No subscription layer. No single-owner gate. (Triad A adjudication #1.)

---

## 3. Architecture Decisions (Triad A Adjudication #2)

### A. SPLIT — per-item save is the §8.4 write path; finalize is read-only over it (v2.2 ruling)

**Question A adjudicated SPLIT (not dual-mode):** `submit_phase2_atomic` is **finalize-ONLY** (no `p_is_final` flag, no per-item-save mode inside it). The per-item **save** (claim/save) writes through a Phase-2-aware path (`POST/PUT /api/opening/prep/item` → SQL write function), NOT the legacy `/api/checklist/completions` route. **Revert** is the exception — it only sets `revoked_at` (no §8.4 write), so it reuses closing's legacy revoke routes (Question B).

The per-item save path:
- Writes `checklist_completions` rows with `prep_data->phase2` in the §8.4 **14-field** shape (12 core + `saved_at`/`saved_by`)
- Sources `ground_truth_count`/`prep_need` from the item's own `prep_data->phase1`; computes `delta_vs_prep_need`/`over_under_status` via the shared SQL helper `opening_phase2_compute_delta`
- Validates shape server-side (openerPrepped required; overPar/underPar reason gates)
- Returns the written completion for optimistic local state update

The finalize RPC (`submit_phase2_atomic`) reads these rows back, validates completeness over the **Model Y** universe, recomputes deltas authoritatively via the **same** shared helper, dispatches under-prep notifications, and advances status. Per-item save writes the contract; finalize reads and validates it. No two-write-paths-different-enforcement; no flag-gated dual-mode RPC.

### B. Phase 2 item universe — explicit predicate (v2.2: Model Y — CORRECTED)

**v2.1's predicate was Model X (`openingPhase2 AND NOT in snapshot`) and was wrong logic.** Per spec C.53 §3 (1959-1997) + 1449 + 2173: the spot-check items and the Phase 2 prep items are the **same items**. Every `openingPhase2` item has a snapshot (closer_count mirrored from its 1:1 AM Prep item at materialization), is spot-checked in Phase 1 (which writes `prep_data->phase1` with `ground_truth_count`/`prep_need`), then prepped in Phase 2. Model X's "NOT in snapshot" set is empty on a normal day AND excludes exactly the items carrying the `prep_data->phase1` Phase 2 must read.

```
Phase 2 item := prep_meta.openingPhase2 == true
```

The RPC version (server-side equivalent):
```sql
-- Phase 2 universe for this instance's template: ALL openingPhase2 items.
-- (Snapshot membership is NOT a discriminator — see Model Y correction above.)
SELECT cti.id
FROM checklist_template_items cti
JOIN checklist_instances ci ON ci.id = p_opening_instance_id
WHERE cti.template_id = ci.template_id
  AND cti.prep_meta->>'openingPhase2' = 'true';
```

Finalize sources each item's `ground_truth_count`/`prep_need` from that item's own `prep_data->phase1` (written by Phase 1 submit). Finalize validates all items in this universe have a live Phase 2 completion before advancing status.

**Shipped-code carry-over (Commit B):** `opening-client.tsx:97-107` splits `phase2Items` using the same wrong Model-X predicate (`&& !closerSnapshotsMap.has(it.id)`), and `opening-client.tsx:301-335` reads `closerSnapshotsMap.get(phase2 item)` which is internally dead under that split. Both are latent (Phase 2 has never executed — Piece 4 short-circuits it). Commit B corrects the split to Model Y.

---

## 4. Lane Structure — Revised (CC Adversarial Finding #1 Applied)

v1 claimed Lane 1 was SEPARABLE from Lane 2. CC found three cracks: (a) tasks 1.2/1.5 share `lib/opening.ts` and are tsc-coupled across tier owners, (b) per-item save created a second §8.4 write path, (c) Phase 2 universe was undefined. All three folded.

**Revised structure: ONE compound lane, TWO commits.** All T0 goes to CC interactive. T1-flash covers i18n and types-only tasks (non-coupled, compile-independent).

### Commit A — RPC + Route + Lib + Per-Item Endpoint (T0, CC interactive)

The greenfield core. Ships the RPC migration, lib body swap, route, and per-item save endpoint — the full write path with §8.4 enforcement from first commit. Compiles and deploys independently (no UI). The Phase 2 route returns the standard `OpeningPhaseSubmitResult` shape whether called from per-item-save or finalize.

| # | Task | Files | Hotspots |
|---|------|-------|----------|
| A.0 | Migration 0056 — shared SQL helper `opening_phase2_compute_delta(p_opener_prepped, p_prep_need) → (delta, over_under_status)` | In `0056` | Single source of truth for delta/status (0053:319-337 logic); IMMUTABLE; called by BOTH the per-item write fn AND finalize |
| A.1 | Migration `0056_create_submit_phase2_atomic_rpc.sql` — also holds the per-item write fn `save_phase2_item_atomic` (the §8.4 write) | New file | ⚠ §8.4 14-field contract WRITTEN by `save_phase2_item_atomic` (see §5); ⚠ NO auto-complete (C.54 §2.A; Discipline 1); ⚠ per-item write reads this item's `prep_data->phase1` for ground_truth/prep_need; ⚠ **Model Y universe** per §3.B (ALL openingPhase2 items); ⚠ `submit_phase2_atomic` is **finalize-ONLY** — reads phase2 rows, validates completeness, recomputes via A.0 helper, advances `phase1_complete → phase2_complete`, dispatches under-prep notifications per-item (0053:414-485 pattern); ⚠ audit counters; ⚠ both fns + A.0 SECURITY DEFINER + REVOKE anon/authenticated + GRANT service_role |
| A.2 | `lib/opening.ts`: replace `submitPhase2Atomic` stub with RPC invocation | Modify lines 1914–1930 | ⚠ Error translation (P0001 codes → OpeningError subclasses); ⚠ pre-flight: instance.status = `phase1_complete`; ⚠ per-item vs finalize mode dispatch |
| A.3 | `lib/opening.ts`: add `Phase2RpcResult` interface ONLY | Modify (same file as A.2) | ⚠ `OpeningPhase2NotEligibleError` ALREADY EXISTS (opening.ts:358, thrown at 1338) — reuse, do NOT recreate; ⚠ `Phase2RpcResult` mirrors `Phase1RpcResult` (opening.ts:1568); type-contract-lock with A.2; tsc-coupled → same commit |
| A.4 | `app/api/opening/submit/phase2/route.ts` | New file | Pattern: clone `phase1/route.ts`; swap phase guard to `phase2`; validate `OpeningEntryPhase2` shape; `openerPrepped` required; overPar/underPar reason gates per type; dispatches to `submitPhase2Atomic` |
| A.5 | `app/api/opening/prep/item/route.ts` — Phase-2-aware per-item save endpoint (thin; calls `save_phase2_item_atomic` from A.1) | New file | Writes single `checklist_completions` row with `prep_data->phase2` in §8.4 **14-field** shape (incl. `saved_at`/`saved_by` = saving actor + timestamp); delta/status from the A.0 shared helper (consumed in SQL, NOT re-derived in TS); validates shape server-side; returns completion row for optimistic update; audit `opening.phase2.item_saved` JS-side. NOT the finalize RPC, NOT the legacy `/api/checklist/completions` route |
| A.6 | Migration linter / CI gate for §8.4 enforcement | New: `scripts/phase2-discipline-check.sh` | Fails CI if: (a) `submit_phase2_atomic` RPC contains `closing_ix`/`auto_complete`/`v_auto_complete_id`, or (b) writes the 0050 blob shape `{openerActual, openerPrepped, overPar, underPar, closerEstimateSnapshot}`, or (c) writes the §8.4 contract without all fields present |
| A.7 | `lib/i18n/{en,es}.json`: Phase 2 error keys + notification copy — STABLE namespaces only (v2.2 Question D ruling) | Modify | Error keys → **`opening.error.*`** (e.g. `opening.error.phase2_not_eligible`, `opening.error.opener_prepped_missing`, per-item-save error keys); under-prep notification copy → **`notifications.*`**. MUST NOT write to `opening.phase2.*` (namespace in flux). The ~10 existing genuine-prep keys + `opening.phase2_prep.*` consolidation are deferred to Commit B |

**All A.x tasks ship in one commit.** A.2 and A.3 are same-file-coupled. A.4 imports A.2. A.5 imports A.2. A.6 is a guard file that runs in CI. A.7 is i18n-only.

### Commit B — Phase 2 Prep UI + Finalize Button + Integration (T0, CC interactive)

Ships the UI surface and wires it to Commit A's endpoints. The finalize button ships IN THIS COMMIT — no half-built surface.

| # | Task | Files | Hotspots |
|---|------|-------|----------|
| B.1 | `OpeningPrepPhase2.tsx` — per-item claim button + "claimed by" display | New component | Reuse `closing-client.tsx`:365–460 callback patterns (revoke/revokeWithReason); claim = POST to `/api/opening/prep/item` with `completed_by` + `count_provenance='closer_captured'` |
| B.2 | Per-item revert button (quick-window silent + post-window reason) | `OpeningPrepPhase2.tsx` | Reuse closing's `handleItemRevoke` (lines 357-398) + `handleItemRevokeWithReason` (lines 404-444); 60s policy glue — closing already has the silent vs reason paths, just not the timer-based gate between them. Closing's `QUICK_WINDOW_MS` constant is defined in `lib/checklists.ts:229` |
| B.3 | Per-item save: openerPrepped input + overPar/underPar modals | `OpeningPrepPhase2.tsx` | Reuse existing modals (`OverParModal`, `UnderParModal`); per-item save writes via `PUT /api/opening/prep/item` updating the existing completion row with §8.4 fields |
| B.4 | Finalize button + submit orchestration | `OpeningPrepPhase2.tsx` + `opening-client.tsx` | Dispatches to `/api/opening/submit/phase2` with all entries; validates all items in Phase 2 universe are saved; advances instance to `phase2_complete`; surfaces notification dispatch feedback |
| B.5 | Wire form routing: instance at `phase1_complete` → Phase 2 tab active | `opening-client.tsx` | Status routing: `open` → Phase 1 tab; `phase1_complete` → Phase 2 tab; `phase2_complete` → final (Phase 3 pending) |
| B.6 | Piece 4 guardrail resolution | `submit/route.ts`:489 | **Resolved: legacy route deprecated for Phase 2.** After Commit A ships, the legacy `/api/opening/submit/route.ts` Piece 4 guardrail (`phase2_pending_next_release`) is kept as defense-in-depth for stale clients, but Phase 2 submit is routed to `/api/opening/submit/phase2`. The legacy route's Phase 2 entry path is inert — Phase 2 entries never reach it because the form dispatches to the per-phase route post-Commit B.5. **Verified 2026-05-30:** Piece 4 fails safe. If a stale client hits the legacy route with Phase 2 entries while the instance is at `phase1_complete`, the guardrail at line 489 fires BEFORE RPC dispatch — returns 200 with `code: 'phase2_pending_next_release'`. The legacy RPC (and its §8.4-bypassing write path) is never reached. For any other non-open status, the legacy RPC's `WHERE status='open'` filter rejects with `OpeningInstanceNotOpenError`. The two-write-path bug cannot be triggered through the legacy route. Defense-in-depth confirmed correct. |
| B.7 | Phase 2 UI i18n | `lib/i18n/{en,es}.json` | Keys: claim/revert/save affordances, "claimed by" label, finalize button, under-prep notification copy (audience-register split: modal capture copy vs notification shorthand) |

**All B.x tasks ship in one commit.** B.4 couples B.1–B.3 through the finalize dispatch. B.5 couples B.4 through form routing.

**No independent-Lane-2 without finalize.** The save UI and finalize path land together (Triad A adjudication #4).

### T1-Flash Tasks (Compile-Independent, Non-Coupled)

These can ship alongside either commit or independently — types-only or pure-i18n, no tsc coupling to T0 work:

| # | Task | Tier | Rationale |
|---|------|------|-----------|
| F.1 | `lib/opening.ts`: `Phase2PrepData` interface (TypeScript mirror of §8.4 contract) | T1-flash | Type-only; no runtime behavior; compile-independent |
| F.2 | `lib/i18n/{en,es}.json`: Phase 2 UI content keys (non-error) | T1-flash | Pure i18n strings; no logic |
| F.3 | FT.2 i18n re-namespace (`opening.phase2.*` → `opening.section_verify.*` / `opening.recount.*`) | T1-flash | Pure rename; no behavior change; queued from C.53 handoff |

---

## 5. Two HARD Disciplines — Mechanized, Not Asserted (Triad A Adjudication #3)

### Discipline 1: NO auto-complete branch

**Source:** C.54 §2.A + Triad A ruling 2026-05-26.

`submit_phase2_atomic` MUST NOT contain an opening→closing auto-complete branch. Phase 3 owns it.

**Enforcement (mechanized):** Task A.6 deploys `scripts/phase2-discipline-check.sh`. This script runs in CI (`npm run build` or dedicated job) and **fails the build** if any of these symbols appear in the Phase 2 RPC migration: `closing_ix`, `auto_complete`, `v_auto_complete_id`, `Opening verified`, `resolveClosingOpeningVerifiedRefItemId`, `closingReportRefItemId`, `closingAutoCompleteId`. This is not reviewer-vigilance — CI blocks before merge.

### Discipline 2: Write §8.4 contract, NOT the 0050 blob

**0050 blob (DO NOT COPY):** `{openerActual, openerPrepped, overPar, underPar, closerEstimateSnapshot}` — pre-§8.4, post-C.50 obsolete.

**§8.4 contract (v2.2: 14 fields = 12 core + 2 provenance). 12-core shape from migration 0053:388-401; the 2 provenance fields are net-new for the SPLIT.**

0053:388-401 is the canonical live source for the **12 core fields** (no later migration rewrites it). The SPLIT's per-item collaborative save adds 2 C.52 provenance fields per spec C.53 §3 (1980-1994): `saved_at` + `saved_by`. 0053 has only 12 because it is the legacy *monolithic* submit (one submitter, no per-item provenance); the spec's 14 describes the collaborative model. **Copy the 12-core shape from 0053:388-401 ONLY — the jsonb_build_object block. Do NOT copy the auto-complete branch (lines 539-584).** This §8.4 jsonb is WRITTEN by the per-item save path (A.5), NOT by finalize (SPLIT — finalize reads it back).

```sql
jsonb_build_object(
  -- ── 12 core fields (shape from 0053:388-401) ──
  'phase', 2,
  'closer_count', v_closer_count,       -- read from this item's prep_data->phase1
  'spot_check_status', v_spot_check_status,  -- read from prep_data->phase1
  'opener_recount', v_opener_recount,   -- read from prep_data->phase1
  'ground_truth_count', v_ground_truth_count,  -- read from prep_data->phase1
  'prep_need', v_prep_need,             -- read from prep_data->phase1
  'opener_prepped', v_opener_prepped,   -- WRITTEN NOW (per-item save)
  'delta_vs_prep_need', v_delta,        -- COMPUTED via shared helper opening_phase2_compute_delta()
  'over_under_status', v_over_under_status,  -- COMPUTED via the SAME shared helper
  'over_under_reason_category', v_over_under_reason_category,  -- per-item capture
  'over_under_reason_text', v_over_under_reason_text,          -- per-item capture
  'directed_by', v_directed_by,         -- per-item capture
  -- ── 2 provenance fields (C.52 per-item save; net-new vs 0053) ──
  'saved_at', v_saved_at,               -- per-item-save timestamp
  'saved_by', v_saved_by                -- per-item-save actor (collaborative attribution)
)
```

All 14 fields persist even on happy path where delta=0. **Inverse-drift guard:** the canonical full set is 12 core + 2 provenance = 14. A future reader MUST NOT strip `saved_at`/`saved_by` to "match 0053" — 0053 is behind the collaborative model by design. The delta + over_under_status derivation is single-sourced in the SQL helper `opening_phase2_compute_delta(p_opener_prepped, p_prep_need)` — both the per-item write and finalize call it; never re-derive inline.

**Enforcement (mechanized):** Task A.6's CI script also greps the migration for the 0050 blob signature — if the literal `closerEstimateSnapshot` appears, CI fails. The script enforces the **12 core fields as a minimum-present invariant** in the §8.4 `jsonb_build_object('phase2', ...)` block (presence check, not exclusivity — `saved_at`/`saved_by` are expected additions and must NOT trip it). A comment in the script records that the canonical full set = 12 core + 2 provenance = 14, so no future reader strips the provenance fields to "match 0053" (inverse-drift guard).

### C.54 §9 "preserved-from-prior" sweep — ENUMERATED checklist

The doc provides the checklist, not a "audit all branches" directive:

| 0053 branch | Lines | Check against |
|-------------|-------|---------------|
| Phase 2 entry loop (per-item validation + compute) | ~280-400 | C.54 NULL-source-as-valid-state; C.53 three-phase restructure |
| Under-par notification dispatch | 414-485 | C.50 per-item dispatch; shifted to delta_vs_prep_need |
| Section-verification loop | 496-515 | NOT APPLICABLE to Phase 2 (Phase 1 owns section verifications); Phase 2 receives none |
| Status transition | 526-534 | `phase1_complete → phase2_complete` only; no `open → confirmed` shortcut |
| Auto-complete branch | 539-584 | **DO NOT CARRY.** Phase 3 owns. Discipline 1 above enforces |

---

## 6. Phase 1 Read Contract — 8 Keys Enumerated (Adjudication #5)

From migration 0055:372-383 (canonical). Phase 2's RPC reads these to source ground_truth_count + prep_need:

| # | Key | Type | Notes |
|---|-----|------|-------|
| 1 | `prep_data->'phase1'->>'phase'` | integer | Always `1` |
| 2 | `prep_data->'phase1'->>'closer_count'` | numeric / null | From opening_closer_count_snapshots |
| 3 | `prep_data->'phase1'->>'opener_recount'` | numeric / null | Opener's recount if item was flagged |
| 4 | `prep_data->'phase1'->>'section_verified'` | boolean | Was section-verify used for this item |
| 5 | `prep_data->'phase1'->>'ground_truth_count'` | numeric NOT NULL | Server-derived: COALESCE(opener_recount, closer_count) |
| 6 | `prep_data->'phase1'->>'prep_need'` | numeric / null | MAX(0, par − ground_truth); null when par is null |
| 7 | `prep_data->'phase1'->>'par_value'` | numeric / null | From snapshot; null on par-less items |
| 8 | `prep_data->'phase1'->>'spot_check_status'` | text | `flagged_recount` / `matched_via_section_verify` |

**Phase 2 RPC MUST read key 5 (ground_truth_count) and key 6 (prep_need) from this contract.** Any rename is a Phase 2 break per AGENTS.md coupled-commit discipline.

---

## 7. Phase 2 Entry Shape — Validation Rules (Adjudication #5)

From `lib/types.ts:832-868` (`OpeningEntryPhase2`). Server-side validation rules:

| Field | Rule |
|-------|------|
| `openerPrepped` | **Required.** Numeric, finite. Always present — even on par-null items |
| `deltaVsPrepNeed` | Optional. Client hint; server recomputes from `openerPrepped - prep_need`. NULL when `prepNeed` is NULL |
| `overPar` | Nullable. Present only when `openerPrepped > prepNeed`. `reasonCategory` required. `directedBy` required when `reasonCategory='management_directive'`. `freeText` required when `reasonCategory='other'` |
| `underPar` | Nullable. Present only when `openerPrepped < prepNeed`. `reasonCategory` required. `freeText` REQUIRED (always non-empty) |
| Reason categories | Over: `management_directive`, `clear_fridge_space`, `prevent_expiration`, `forecast_busy`, `bulk_efficiency`, `other`. Under: `ingredient_unavailable`, `equipment_issue`, `time_constraint`, `staff_shortage`, `other` |

---

## 8. Audit Emission Shape (Adjudication #5)

Per the Build #2 PR 3 lesson "RPC-side audit_log INSERTs must mirror the actual column shape" + migrations 0044/0048 precedent:

| Audit action | Emitted by | Timing | Metadata |
|--------------|------------|--------|----------|
| `opening.phase2.item_saved` | Per-item endpoint (A.5) | On each item claim/update | `{instanceId, templateItemId, completionId, phase: 2, isClaim (boolean)}` |
| `opening.phase2.submit` | Finalize RPC (A.1) | On successful submit | `{instanceId, completionIds: [...], atParCount, overPrepCount, underPrepCount, underParNotificationIds: [...]}` |
| `opening.phase2.revert` | **Revoke path** (legacy `/api/checklist/completions/[id]/revoke[-with-reason]`, reused per Question B — revert sets `revoked_at` only, no §8.4 write), NOT A.5 | On item revert | `{instanceId, templateItemId, completionId, reason (null | 'error_tap' | 'not_actually_done' | 'other'), window (quick | structured)}` |

All emitted JS-side via lib (mirrors Phase 1 audit emission pattern per 0055 header "original-path audit fires JS-side in lib/opening.ts").

---

## 9. Recorded Deferral

**Phase 1 edit re-entry coordination.** Chain-edit at `phase1_complete` could re-derive `ground_truth_count`/`prep_need` without changing status — invalidating Phase 2 deltas saved against old numbers. Currently no Phase 1 edit UI exists; contract frozen. **IF** a Phase 1 edit UI ships, delta-invalidation coordination must be designed then. Recorded as conscious deferral, not a gap.

**Real-time subscriptions / live-sync.** Deferred to "C.52-full" future item. Phase 2 uses closing's model: each save persists independently, refresh to see other authors. No subscription layer. (Triad A adjudication #1.)

---

## 10. Done-Condition

- [ ] No-prior-data opener flows Phase 1 → Phase 2 (instance at `phase1_complete`, Phase 2 tab active)
- [ ] Multiple actors can claim Phase 2 prep items (different users, same location)
- [ ] Claimed items show "claimed by [name]" to other actors
- [ ] Actors can save their claimed items (per-item save writes §8.4 contract via Phase-2-aware endpoint)
- [ ] Per-item save enforces §8.4 shape server-side (rejects malformed prep_data)
- [ ] Actors can revert their own items (quick-window silent, post-window structured reason)
- [ ] Finalize validates all Phase 2 universe items are saved (rejects incomplete submits)
- [ ] Finalize computes deltas: `delta_vs_prep_need = opener_prepped − prep_need` (server-authoritative)
- [ ] Finalize advances instance to `phase2_complete`
- [ ] Under-prep items dispatch N-per-item notifications (urgent, KH+ at location + MoO + Owner, DISTINCT)
- [ ] Over-prep items persist reason captures (overPar category + directedBy/freeText)
- [ ] `scripts/phase2-discipline-check.sh` PASSES in CI (no 0050 blob shape, no auto-complete symbols)
- [ ] Pre-gate green (tsc --noEmit + eslint + next build)
- [ ] Audit rows emitted for item saved, submit, revert per §8 shape
- [ ] Piece 4 guardrail preserved as defense-in-depth; legacy route no longer the Phase 2 path
- [ ] Juan's operational smoke against a real instance (FT.2 equivalent of FT.1)

---

## 11. Pre-Gate Current State

```
tsc --noEmit: PASS
eslint:       baseline 17 warnings (advise only)
next build:   deploy-verified green
```

---

## Appendix A: Revision Log

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-05-30 | Initial RACI doc. Lane 1/2 split, T0+T1-flash tiers, CC adversarial pass requested |
| v2 | 2026-05-30 | Folded CC adversarial findings + Triad A adjudication: (1) dropped realtime, (2) per-item §8.4 enforcement + Phase 2 universe defined, (3) mechanized discipline check, (4) finalize ships with save UI, (5) enumerated all spec gaps. Restructured to compound lane (2 commits, all T0). Added Phase 2 item universe predicate, 8-key contract enumeration, entry shape validation rules, audit emission shape, Piece 4 resolution |
| v2.1 | 2026-05-30 | Triad A plan gate: HOLD 1 resolved (12-field language consistent throughout — no stale references); HOLD 2 verified (0053:388-401 confirmed as live 12-field source, no superseding migration, copy-source annotated with "lines 388-401 ONLY — never auto-complete branch"); FLAG confirmed (Piece 4 fails safe — guardrail at line 489 blocks before RPC dispatch, two-write-path bug unreachable) |
| v2.2 | 2026-05-30 | **B2 execution gate — two confirm-before-authoring catches adjudicated by Juan, SUPERSEDING v2.1 + the earlier drift-fixes.** (1) **§3.B Phase 2 universe predicate corrected Model X → Model Y.** v2.1's predicate `openingPhase2 AND NOT in snapshot universe` was wrong *logic* (not a wrong join — the earlier LEFT-JOIN drift-fix is superseded; it treated the symptom). Per spec C.53 §3 (lines 1959-1997, 2173) + spec 1449: every `openingPhase2` item has a snapshot, so Model X's set is empty on a normal day AND excludes exactly the items carrying the `prep_data->phase1` that Phase 2 must read. Corrected: **Phase 2 universe = `openingPhase2 == true`** (the prep items, which ARE the spot-check items); finalize reads each item's `ground_truth_count`/`prep_need` from its own `prep_data->phase1`. Shipped `opening-client.tsx:97-107` carries the same latent error (dormant — Piece 4 short-circuits Phase 2); corrected in Commit B. (2) **§8.4 contract field set corrected 12 → 14.** The SPLIT (per-item collaborative save) requires `saved_at` + `saved_by` (C.52 per-item provenance — who prepped what, when), per spec C.53 §3 (1980-1994). 0053 has 12 because it is the legacy *monolithic* submit (one submitter, no per-item provenance); the spec's 14 describes the collaborative model being built. Canonical full set = 12 core (shape from 0053:388-401) + 2 provenance. (3) Architecture: Question A SPLIT (finalize-only RPC; per-item endpoint is the §8.4 write path); shared delta helper single-sourced in SQL; Question B revert via legacy revoke route; Question C direct-call route bypassing `submitOpening`; Question D Commit-A i18n in stable namespaces (`opening.error.*` / `notifications.*`), consolidation deferred to Commit B. Drift fixes: A.3 reuse existing error class (opening.ts:358) + add `Phase2RpcResult` only; B.2 `QUICK_WINDOW_MS` at checklists.ts:229; types.ts:826 doc "Phase 5"→"Phase 2". |

---

*Written 2026-05-30 by Aggie. Adversarial pass by CC (2026-05-30). Adjudication by Triad A. v2 locked for plan gate. No code written yet. Verify against git before trusting any line reference.*
