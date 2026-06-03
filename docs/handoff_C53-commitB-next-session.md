# Handoff — C.53 Commit B next session (written 2026-06-03)

Cold-you: you've been through compaction. You remember nothing reliable. **Do not trust this
handoff, the conversation summary, or any memory as ground truth.** Read git first. This doc
points you at the real artifacts; verify each one before acting. Every SHA, file path, and line
reference below is a claim to re-check against the working tree — the tree may have moved.

**Start the session with these, in order:**

```bash
git log --oneline -6                 # confirm main HEAD carries the hotfix
git status -sb                       # clean tree + which branch
git fetch origin && git status -sb   # confirm local main == origin/main
git branch -a                        # confirm claude/c53-phase2-commit-a still exists
```

If the SHAs below don't match `git log`, trust git, not this doc.

---

## 0. ✅ STATUS — Commit B SHIPPED; only the e2e smoke remains (updated 2026-06-03)

**The Triad A (A)-vs-(B) blocker that originally headed this doc is RESOLVED and the code is built.**
The decision: **(B) — pure-prep items survive into Phase 2.** The bug was upstream in the §10 split
predicate, not in Commit B's lanes. Precursor commit **`c689dfd`** ("revive Phase 2 prep tab via
dual-membership phase split") fixes it — an item can belong to both phases, so the Phase 2 prep tab
renders again and finalize has a real surface. All four lanes then shipped on top.

**What's on the branch `claude/c53-phase2-commit-b` (squash target for the PR):**
- `c689dfd` — precursor: §10 dual-membership phase split (revives the prep tab)
- `c945d13` + `58531b5` — Lane A: hydrate Phase 2 prep form from persisted phase2 saves (+ Review
  Gate #1 reasonCategory validation)
- `de2162d` — Lane B: per-row save UX + persistence-derived finalize gating
- `4ef41dd` — Lane C: repoint finalize to the two-route flow (per-item SAVE → FINALIZE)
- `53415fa` — Lane D migration **0057** (extends the `revocation_reason` CHECK for Phase 2 revoke).
  **Already applied to prod** — the DDL is live, not pending.
- `be12af5` — Lane D: Phase 2 per-item revoke lib (`revokePhase2Completion`)
- `49ec98e` — Lane D: revoke route + client dispatcher + reason modal + i18n + stale-header fix

**This branch merges BOTH Commit A and Commit B as one coupled unit.** The branch is stacked on
Commit A (`98e5e41` + `8e16dce`), so the PR carries Commit A's unmerged Phase 2 backend (the §8.4
SAVE/FINALIZE routes + RPC 0056) *together with* Commit B's UI rewire + revoke. They were gated in
isolation but have never run end-to-end together — that's what the smoke is for.

**Review Gate #2 (whole-diff read) is GREEN:** 22 files, +3,648/−218; seams (a) dead imports,
(b) `completionId` consistency, (c) i18n parity 443/443, (d) removed gates → all clean; fresh
`npm run build` exit 0. The 3 `opening.error.{not_self,revoke_conflict,revocation_reason_invalid}`
keys are intentionally audit/error-layer codes, NOT per-case display strings (revoke surfaces one
generic `opening.phase2.revoke.error` by design — Triad A ratified KEEP GENERIC).

**THE ONE THING STILL PENDING — the e2e smoke.** It runs against the PR preview (never production)
at a **real opening**, and it is **also Commit A's first real end-to-end exercise** (Commit A's
backend has only ever been synthetic/guard-verified). Gated on **Juan's session bench: 2 KH+ test
accounts + 1 non-KH+** (the non-KH+ exercises the revoke `not_self` 403 / self-only path) plus a
live opening instance to flow through per-item-save → finalize → revoke. Do NOT merge before the
smoke passes.

---

### Historical record — the original blocker (resolved by `c689dfd`, kept for forensics)

**Do not write Lane A/B/C/D code.** Review Gate #1 surfaced a hard cross-layer contradiction:
C.53 §10 (live on main) and Commit A's Phase 2 finalize backend assume **opposite** definitions
of what an `openingPhase2` item is. The §10 restructure folded all Phase 2 prep items into Phase 1;
Commit A's `submit_phase2_atomic` still validates them as needing Phase 2 completions. Net effect:
**the Phase 2 prep tab can never render, and finalize can never succeed.** Commit B (a rewire of
that tab) therefore has no surface to rewire.

**Proof — verified at every layer (read the producer, don't trust shapes):**
1. `lib/opening.ts:606-622` — create-path materializer builds a snapshot entry for **every**
   `openingPhase2` item (closer_count may be null).
2. `supabase/migrations/0052_…:~95-117` — RPC FOR-loop INSERTs a row for **every** `p_snapshots`
   element; `NULLIF` only nulls the column, the row still goes in.
3. `lib/opening.ts:1085-1117` `loadOpeningCloserCountSnapshots` — returns all rows, no null filter.
4. `opening-client.tsx:97-107` — `phase2Items = openingPhase2 AND NOT closerSnapshotsMap.has(id)`
   → **unconditionally empty.** The code says so itself at `opening-client.tsx:138`
   ("the now-always-empty phase2Items").
5. `0055_…phase1_atomic:427-428` — absorbed spot-check items write `prep_data->'phase1'`, never phase2.
6. `0056_…phase2_atomic:355-371` — finalize requires a live `prep_data ? 'phase2'` completion for
   **every** `openingPhase2` item → `phase2_incomplete` forever.

**Empirical confirmation (live prod, 2026-06-03):**
- Template `b2b42117` (Standard Opening v1 @ d2cced11): 78 active items, **34 `openingPhase2`, all 34
  AM-Prep-linked, 0 unlinked.**
- The 4 real `phase1_complete` instances (2026-05-31 → 06-03): each **34 phase1 / 0 phase2 / 34
  snapshot rows.** Finalize would need 34 phase2 completions, finds 0.
- **Model inversion proof:** pre-§10 confirmed instances (2026-05-08/09) carried **0 phase1 / 34
  phase2**; post-§10 instances carry **34 phase1 / 0 phase2**. Commit A's 0056 universe is a
  pre-§10 fossil — it was never re-verified against §10 (the exact "preserved-from-prior logic must
  be re-verified against amendments" lesson 0056's own header cites, missed on the universe def).

**The decision Triad A must make (Aggie + spec author needed):**
- **(A) Phase 2 prep is vestigial post-§10** (strongly indicated by the data: zero unlinked items,
  zero phase2 completions on any real instance, the model inversion). → Commit A's 0056 universe is
  wrong; Commit B should be abandoned or radically rescoped. `phase1_complete` may be the new
  terminal opener state.
- **(B) Pure-prep items should survive into Phase 2** → bug is upstream in the §10 materializer/split
  predicate, NOT in Commit B's lanes. But **zero unlinked items exist**, so Phase 2 stays empty for
  the live template even after the fix — (B) needs new template content to mean anything.

**Also flag:** the 4 recent instances appear **stuck at `phase1_complete`** with no wired forward
path in prod (main). Confirm whether that's an accepted terminal state or a new stuck-shift class.

**State at halt:** only reads + the 3 verification queries were done. No edits, no Lane code. Working
branch `claude/c53-phase2-commit-b` is stacked on Commit A (commits 98e5e41 + 8e16dce above main tip
32c0240) with zero net-new commits.

---

## 1. Ground-truth state (as of 2026-06-03, verify against git)

- **main HEAD: `f8dad95`** — the Phase 1 submit-wedge hotfix (squash-merged PR #45). **Live in
  production** (Vercel deploy `dpl_BVQ5Zwor…`, READY). The fix folded
  `phase1AlreadySubmitted = instance.status !== "open"` into the submit-enable gate and added a
  during-render spinner reset (prevInstanceStatus compare). Both the local `fix/…` branch and the
  remote ref are deleted; do not look for them.
- **Commit A is applied, verified, and UNMERGED** on branch **`claude/c53-phase2-commit-a`**
  (HEAD `ecb26f9` at last check). It adds the Phase 2 backend: per-item SAVE route
  `app/api/opening/prep/item/route.ts` + FINALIZE route `app/api/opening/submit/phase2/route.ts`.
  It is **file-disjoint from the hotfix** — Commit A never touched `opening-client.tsx`. It was 2
  commits ahead of the OLD base `e27a00c`; the hotfix is now on main, so the topology likely
  simplifies (see §3).

---

## 2. What Commit B actually is — a REWIRE, not a build

`components/opening/OpeningPrepEntry.tsx` is the **near-complete C.50 Phase 2 prep UI** (sections,
per-section verify, per-item recount, live prep_need preview, over/under-par modals, submit-gate
badges, NumericInput). The rendering layer is essentially done. **Commit B repoints the submit
wiring, it does not build a new surface.**

Today, `app/(authed)/operations/opening/opening-client.tsx`:
- renders `OpeningPrepEntry` (~lines 814-826),
- `handlePhase2Submit` (~566-650) POSTs to the **LEGACY batch route** `/api/opening/submit`, which
  returns the Piece 4 guardrail `phase2_pending_next_release` (surfaced ~834-845).

**Commit B repoints that from the batch route to Commit A's two-route flow:**
- per-item SAVE → `POST /api/opening/prep/item` (persists each entry before finalize), then
- FINALIZE → `POST /api/opening/submit/phase2` (body `{ instanceId }`, NO entries — it reads the
  persisted phase2 completions back, validates Model Y universe completeness, advances
  `phase1_complete → phase2_complete`).

Read Commit A's two route files on `claude/c53-phase2-commit-a` for the exact request/response
shapes and error codes (409 `phase2_not_eligible`, 422 `ground_truth_unresolved` /
`phase2_incomplete`) before wiring — don't trust the shapes from memory.

---

## 3. Branch topology (decided, but re-verify before acting)

Branch Commit B **off `claude/c53-phase2-commit-a`** (it needs Commit A's routes). It also needs
the hotfix, which is now on `main`. So the clean move is likely:

```bash
git checkout claude/c53-phase2-commit-a
git rebase main          # main now carries the hotfix; Commit A is file-disjoint, so low conflict risk
git checkout -b claude/c53-phase2-commit-b
```

Rebasing Commit A onto the post-hotfix main is preferable to merging a (now-deleted) hotfix branch
in. Because the two are file-disjoint, the rebase should be clean — but verify with
`git rebase main` and inspect, don't assume.

---

## 4. THE NEXT MOVE — Commit B altitude check (do this first, before any code)

The open decision: **is the batch-submit → per-item-save shift a clean mechanical rewire, or does
it pull in real UX work?** Specifically, does repointing force any of:

- **Save-state indicators** — per-item-save means each item can be individually saved/dirty/saved;
  the batch UI had one submit. Does the operator need per-item saved/saving feedback?
- **Partial-failure handling** — one item's save can 422 while others succeed (batch was all-or-
  nothing). What does the UI do when item 3 of 7 fails to save?
- **Finalize-gating** — FINALIZE requires all Model Y universe items persisted first. The submit
  button's enable condition changes from "form valid" to "all items saved AND valid."

If it's a clean rewire → small mechanical commit. If it pulls in the above → that's UX scope that
needs its own altitude/plan pass with Juan, not a silent expansion of Commit B. **Decide this
before writing code.** (read-ground-truth → altitude → plan → gate, per v5.3.)

---

## 5. Phase 2 e2e smoke is now unblocked (keep it SEPARATE from the hotfix)

Migration 0056's Phase 2 RPC REQUIRES `completions.prep_data->'phase1'` on every Model Y universe
item. **Four real `phase1_complete` instances now carry the full 8-key contract**, all at location
`d2cced11`:

- `0a605ce3` (2026-05-31)
- `a9b6bb01` (2026-06-01)
- `099877b9` (2026-06-02)
- `dde30257` (2026-06-03) ← the hotfix smoke instance; advanced open→phase1_complete with all 34
  spot-check items carrying the full contract

These unblock **hinge (a): a Phase 2 end-to-end smoke** once Commit B ships (a fresh opening on
current deployed code, flowed through Commit B's per-item-save + finalize). **Log that smoke
separately from the hotfix** — the hotfix is closed; the Phase 2 e2e is its own done-condition.

Also keep tracked-but-separate: the **"no submitted-✓ confirmation" UX item** (operator gets no
explicit success affirmation after Phase 1 submit beyond the button disabling). Not part of the
hotfix; surface it when Phase 2 UX work is on the table.

---

## 6. Operating context (unchanged)

- **Workflow v5.3 (locked).** You are Tier 0 main coder + sole semantic reviewer of all non-CC
  code. Triad A (Juan + Claude Chat) locks gate-protecting decisions. No edit-through-pipe, no
  self-approve, no concurrent sessions. Smoke (against the PR preview, never production) is the
  done-condition, not the commit.
- **`scripts/pre-gate.sh`:** tsc --noEmit → eslint → next build, fail-fast. Errors block at 0;
  warnings ratchet at baseline 17 (advise-only). The threshold is gate-protecting — do NOT retune
  unilaterally (Triad A). See `project_pregate_warnings_threshold_defect.md`.
- **Squash-merge convention.** Branch deletion via `gh api -X DELETE` (worktree-safe). Smoke
  against the PR preview URL, never production.

Cold-you: before trusting any sentence above — including this one — run `git log`, `git status`,
read Commit A's two route files on `claude/c53-phase2-commit-a`, and read
`OpeningPrepEntry.tsx` + `opening-client.tsx`'s `handlePhase2Submit`. If disk contradicts this doc,
disk wins.

---

## 7. Deferred items (tracked-but-out-of-scope — surface when Phase 2 UX work is on the table)

These are NOT bugs and NOT part of any current lane. They are real UX gaps logged so they don't
evaporate. Neither blocks Commit B; both want their own altitude pass when Phase 2 UX is the topic.

1. **Phase 1 revisit display gap.** A returning opener landing on a `phase1_complete` instance sees
   an EMPTY verify tab — the prior verify-beat state (per-section verify ticks, spot-check recounts)
   is not re-displayed. Nothing is lost: the data is server-side in `prep_data->phase1` completions;
   only the re-display is missing. Lane A deliberately did NOT take this on — the Phase 1 `values`
   seed reads no completions (loader caveat satisfied trivially), and rehydrating it is real read-
   only-rendering UX work, not a seed change. Symmetric to what Lane A built for Phase 2, but on the
   verify beat. (Origin: Lane A scope ruling, 2026-06-03.)

2. **No submitted-✓ confirmation.** The operator gets no explicit success affirmation after Phase 1
   submit beyond the submit button disabling (per the §10 hotfix close-out). Same gap will exist for
   Phase 2 finalize unless designed in. Surface when Phase 2 UX work is on the table.

3. **Expanded Phase 2 revoke vocabulary (Finding B — CAPTURE ONLY, do NOT build yet).** The shipped
   Lane D revoke vocabulary is `quick_reenter` (silent <60s self-revert sentinel) + `re_enter_count`
   (structured/post-window recount) + the inherited generic `other`. Smoke surfaced that the
   operational reality wants a richer set. The proposed expanded vocabulary, with its load-bearing
   semantic split:

   | Reason | Meaning | Did prep happen? |
   |---|---|---|
   | `re_enter_count` | Fix the number — entry is wrong, prep is fine | **YES** (entry wrong) |
   | `reassigned` | Someone else did it / mis-claimed — prep happened, wrong person | **YES** (wrong person) |
   | `out_of_stock` | Couldn't complete — missing ingredients | **NO** (prep did not happen) |
   | `unable_to_complete` | Abandoned mid-task | **NO** (prep did not happen) |
   | `other` | Free-text catch-all | — (note required) |

   The **"prep happened but the entry is wrong" (`re_enter_count`, `reassigned`) vs "prep did NOT
   happen" (`out_of_stock`, `unable_to_complete`)** split is operationally meaningful for the audit
   trail — it tells a reviewer whether the under-par state is a data-entry artifact or a real
   production shortfall. Implementation when picked up:
   - Additive migration extending the `checklist_completions_revocation_reason_check` CHECK — **same
     shape as migration 0057** (single `DO $$` block, atomic DROP-then-ADD, append the new literals
     to the existing `ARRAY[...]`; do NOT remove `quick_reenter`/`re_enter_count`/closing's three).
   - en/es i18n per reason (operational tú-form register, per C.37).
   - Modal options in the revoke reason form (Lane D's `RevokeReasonModal`).
   - Lib (`revokePhase2Completion`) re-validates `reason` as an OUTPUT after picking the path; the new
     values join the structured-path vocabulary. `note` required-when-`other` already enforced.
   (Origin: re-smoke Finding B, 2026-06-03. Document-only by Juan's directive — additive, no behavior
   change ships in Commit B.)

4. **NULL-source item's OWN Phase-2 ground-truth reads null for a second opener (Finding B family —
   CAPTURE ONLY, deferred; ratified by Juan during fix #7 gate, 2026-06-03).** A NULL-source spot-check
   item (snapshot exists with `closer_count IS NULL`) resolved by a Phase-1 recount reads
   `groundTruth = null` for its OWN Phase-2 prep beat when a second opener has no `prep_data.phase2` row
   yet — so the item shows "needs ground truth" in Phase 2 and the prepper must re-enter the recount.

   **Why this is safely deferrable (the proof, not just the symptom):**
   - **PRE-EXISTING.** The ground-truth read is `openerRecount !== null ? openerRecount : sectionVerified
     ? closerCount : null` (handlePhase2ItemSave + OpeningPrepEntry). For a NULL-source item, `closerCount`
     is `null`, so even a `sectionVerified=true` section yields `null` — the value can come ONLY from
     `openerRecount`. That `openerRecount` reads from **phase2Values** (hydrated from `prep_data.phase2`),
     which is empty for a fresh second opener. This was already true under the old derived seed (it also
     set the section `true`, and `closerCount` was still `null`). Fix #7 did not create it.
   - **NOT introduced and NOT woken by fix #7.** Fix #7 only changed the `sectionVerifications` SEED
     (section-verify read-back). It does NOT touch the `phase2Values.openerRecount` hydration path. So
     unlike the Finding A deferral — which a later fix *did* wake — this one lives in a distinct data
     path that fix #7 provably leaves untouched. The two are decoupled by construction.
   - **Fix shape (when picked up):** hydrate the Phase-1 recount into `phase2Values.openerRecount`, the
     same hydration shape as Finding D's Phase-1 recount hydration into the `values` map (read
     `prep_data.phase1.opener_recount` off the completion; populate the Phase-2 form seed). Small,
     mirrors an already-shipped pattern.
   (Origin: fix #7 surface, 2026-06-03. Document-only — fix #7 ships the section-verify seed; this
   phase2Values hydration is the separate, decoupled follow-up.)

---

## 8. TEST FIXTURES — REMOVE AT FULL LAUNCH

Seeded 2026-06-03 by Aggie for Commit B Phase 2 collaborative prep smoke. All scoped to
location `d2cced11` (EM). Durable fixtures per Juan's ruling — disable at full-system launch,
do NOT delete (preserves audit rows). Known-PIN accounts in prod; the PINs below are the
non-obvious seed values.

| Name | Email | Role | Level | KH+? | PIN | User ID |
|---|---|---|---|---|---|---|
| ZZ_TEST_KH1 | zz_test_kh1@co-ops.test | key_holder | 3 | yes | 4829 | `00b317a8-7041-4369-b8db-8f81f38b15d7` |
| ZZ_TEST_KH2 | zz_test_kh2@co-ops.test | key_holder | 3 | yes | 7394 | `bcd877c3-54e1-4f2a-ba6d-94ccdc03d097` |
| ZZ_TEST_PREP | zz_test_prep@co-ops.test | employee | 3 | yes | 1506 | `1a21ef12-6cb1-489f-87c2-0deee2157f54` |

**Cleanup:** set `active = false` or `role = 'trainee'` + `level = 0` at full launch.
Do NOT hard-delete — audit rows reference these IDs. Created via service_role direct insert;
audit_log row carries `action: user.create, metadata.reason: "Durable test fixtures for Commit B
Phase 2 collaborative prep smoke"`.
