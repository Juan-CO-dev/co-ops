# Triad A Architecture Lock — submit_phase1_atomic (C.53 Phase 1 + C.54 fold) — v2

**From:** Juan + Claude Chat (Triad A)
**To:** Aggie → B1 (pipe to Claude Code for the RACI build doc)
**Status:** LOCKED. Supersedes v1. Aggie's adversarial pass (advpass v1) found one real gap; it's folded in below (Finding 1 → responsibility 1 refinement). Cleared for B1.

---

## What submit_phase1_atomic is

The verification phase. Opener confirms each station's state, resolves spot-check counts (recounting where closer data is missing), the server computes ground truth and prep need, and the C.54 fold fires here because this is where "no prior closing data" gets detected, attested, and signaled. Status: `open → phase1_complete`.

Scope: ONE RPC, Phase 1 only. Phase 2 (prep) and Phase 3 (setup + auto-complete decoupling) are separate, later. Do not let decomposition pull Phase 2/3 work into this.

## The ten responsibilities

1. **Verification gate** — every station's cleanliness/temp/ready items completed; every spot-check item resolved. **Resolution rule (refined per advpass Finding 1):**
   - A spot-check item **with a non-NULL `closer_count`** may be resolved by **section-verify OR recount**.
   - A spot-check item **with NULL `closer_count`** (no closing data) can **ONLY** be resolved by `opener_recount`. **Section-verify is NOT a valid resolution path for a NULL-closer item** — you cannot verify-as-correct a count that doesn't exist. The RPC raises `P0001 'null_source_requires_recount'` if a NULL-closer spot-check item arrives section-verified but without `opener_recount`.
   - Self-gates on `instance.status = 'open'`, raises `P0001 'phase1_not_eligible'` otherwise.
   - **Why this framing matters:** it makes the C.54 fold airtight. Because every NULL-closer item *must* be recounted, every missing-closing-data situation *necessarily* produces a recount → necessarily fires NULL-source detection → necessarily triggers attestation + provenance + notification. There is no path for missing-data to pass Phase 1 without the accountability signal firing. (v1's "section-verified OR recount" left a hole where a NULL-source item could pass via section-verify, compute `ground_truth = NULL` / `prep_need = NULL`, hand Phase 2 an unresolvable item, AND silently skip the entire C.54 fold. Closed.)
2. **Section verifications population** — INSERT one row per verified section to `opening_section_verifications` (append-only; multi-toggle collapsed to final state at submit).
3. **Per-item completion INSERTs** — Phase 1 completions with `prep_data->phase1` JSONB (phase=1, spot_check_status, opener_recount nullable, ground_truth_count, prep_need, + countValue/photoId/notes for non-spot-check items).
4. **Server-side compute** — `ground_truth = openerRecount IF NOT NULL ELSE closer_count IF section_verified ELSE NULL`; `prep_need = MAX(0, par − ground_truth)`. (Matches C.50 §8.3 server-canonical compute. With responsibility 1's refined gate, a NULL `ground_truth` can no longer escape Phase 1 via a NULL-closer item — it must have been recounted.)
5. **C.54 NULL-source detection (per-item)** — if a completion has `opener_recount IS NOT NULL` AND its `closer_count` (from opening_closer_count_snapshots) IS NULL → that completion's `count_provenance = 'reconstructed_morning'`; otherwise `'closer_captured'`.
6. **C.54 attestation (per-instance)** — if ANY item triggered NULL-source detection, require `p_opener_no_prior_data_reason` (`planned_closure` | `missed_or_unknown`); raise `P0001 'provenance_required'` if missing; write the single value to `checklist_instances.opener_no_prior_data_reason`.
7. **C.54 missing-closing notification (per-instance, single)** — when NULL-source detected, dispatch ONE notification per C.48 routing (MoO + Owner + KH+ at location, DISTINCT, priority urgent), action `opening.submitted_with_no_prior_closing_data`, body carries the attested cause. **B1 dispatch note (Aggie's lean, for Claude Code to confirm):** prefer Pattern A — set a `v_has_null_source` flag during the entries loop, dispatch ONCE after the loop. The notification is about the instance's aggregate state, not any single item, so it lives after the loop, not bent out of 0053's per-item under-prep dispatch. This is a "how" call — Claude Code confirms the mechanism against the real 0053 code in B1.
8. **C.46 chain-edit path** — original-submission provenance is canonical. Chain edits do NOT retract the notification and do NOT rewrite the original completion's `count_provenance`. (Append-only; original is the audit record.)
9. **Status transition** — `open → phase1_complete`. Single UPDATE with `WHERE status = 'open'` for race safety.
10. **Audit emission** — `opening.phase1_submit` row with metadata (stations_verified, temps_recorded, items_section_verified, items_recounted, total_recount_delta, null_source_count, provenance_markers_set).

## The decisions locked in Triad A

1. **Ten responsibilities** as above, including the responsibility-1 refinement (NULL-closer items are recount-only).
2. **SECURITY DEFINER recipient resolution:** mirror 0053's role-IN-list pattern for the C.48 recipient lookup (current_user_role_level() can't resolve inside SECURITY DEFINER — no JWT claims). Claude Code confirms the exact mechanism against real 0053 in B1.
3. **Notification naming:** spec-verbatim `opening.submitted_with_no_prior_closing_data` (dot-namespaced, per C.54). Not snake_case.
4. **No range-gating on Phase 1 recounts.** A recount is the opener's authoritative ground-truth observation. The only Phase 1 gates are the verification gate (resp. 1) and the attestation (resp. 6).
5. **Fold shape:** per-ITEM provenance markers, per-INSTANCE single attestation + single notification. The cause of missing data is a property of the whole prior-night situation, not per-item.
6. **New error code from advpass:** `null_source_requires_recount` (P0001), raised when a NULL-closer spot-check item is section-verified without a recount. Needs an i18n key (swarm lane) and a lib typed-error branch.

## Build context (artifacts, not conclusions)

- LIVE schema: migration 0054 applied & verified (opening_setup_items/verifications tables, count_provenance on checklist_completions, opener_no_prior_data_reason on checklist_instances, status enum extended). Repo clean at HEAD `44f7641`.
- Type contract frozen: OpeningEntryPhase1 in lib/types.ts.
- Reference pattern: 0053 submit_opening_atomic (server-canonical compute, audit, notification dispatch, C.46 update path, recipient resolution).
- Canonical spec: SPEC_AMENDMENTS.md C.53 §3/§5/§6, C.54 §2/§3/§4, C.50 §8.3/§8.4.

## Adversarial pass result (advpass v1)

Aggie swung genuinely. One real finding (NULL-source gate gap → folded into resp. 1), one B1 note (dispatch pattern → folded into resp. 7). Everything else — fold shape, no-range-gating, SECURITY DEFINER resolution, per-item provenance, C.46 path, audit shape, status transition — survived the swing. Lock is sound.

## Next: B1

Aggie pipes this v2 lock to Claude Code to co-produce the RACI build doc (`coops_C53-C54_phase1_builddoc_B-to-A_v1`): Claude Code's tasks, Aggie's tasks, swarm tasks (i18n keys incl. the new error code), ordering, coupled-vs-parallel lanes. That doc returns to Triad A for the plan gate before any code. Remember: B1 is talk through the pipe; B2 execution is interactive-through-Juan.
