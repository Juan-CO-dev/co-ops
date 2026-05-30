# Handoff — C.53 next session (written 2026-05-30)

Cold-you: you've been through compaction. You remember nothing reliable. **Do not trust this
handoff, the conversation summary, or any memory as ground truth.** Read git first. This doc
points you at the real artifacts; verify each one before acting on it. Every SHA, file path,
and line reference below is a claim you should re-check against the working tree, because the
tree may have moved since this was written.

**Start the session by running these, in order:**

```bash
git log --oneline -8          # confirm HEAD + the three tonight commits are present
git status -sb                # confirm clean-ish tree + which untracked files remain
git fetch origin && git status -sb   # confirm local == origin/main (no drift)
```

If the SHAs below don't match what `git log` shows, trust git, not this doc.

---

## 1. Ground-truth state (as of 2026-05-30, verify against git)

**origin/main HEAD: `f4e110e`.** Local was in sync with origin/main at handoff (no ahead/behind).

`git log --oneline -5` at write time:

```
f4e110e docs(C.53): mark §10 shipped — stuck-shift class closed in production
42562d3 feat(opening): C.53 §10 Lane B — section-verify header for spot-check stations
899061f feat(opening): C.53 §10 — absorb spot-check items into Phase 1
8024087 fix(pre-gate): repair warnings threshold + set -e capture; track gate in git
f93250d fix(lint): resolve react/markup + prefer-const errors (Flash batch)
```

**The three commits that shipped tonight:**

- **`899061f`** — Lane A. Absorbed spot-check items into Phase 1: phase split (spot-check items
  now in `phase1Items`), tick-gate scoped to exclude spot-check items, `phase1Complete` gained
  the `spotCheckResolved` conjunct, empty Phase 2 tab hidden. Also persisted the build doc
  `docs/coops_C53-C54_phase3_builddoc_B-to-A_v1.md`. Touches `opening-client.tsx`.
- **`42562d3`** — Lane B. `OpeningVerificationStation` renders `OpeningSectionVerify` in place of
  the tick button on spot-check cards (render-by-content via `closerSnapshotsMap.has`); flag B
  port `sectionHasUnrecountedNull` keeps the disjunctive client gate consistent with the RPC's
  `null_source_requires_recount`; section toggle keyed on `prep_meta.section` (C.38); `sectionVerifications`
  init repointed to `phase1Items` spot-check sections (flag A). Two files: `OpeningVerificationStation.tsx`
  + `opening-client.tsx` callsite (tsc-coupled).
- **`f4e110e`** — docs. Marked C.53 §10 SHIPPED in `SPEC_AMENDMENTS.md` — added §11.1, updated §11 header.

**Deployed live:** all three are on `origin/main`, deployed to production at `co-ops-ashy.vercel.app`.
CI `build` was GREEN on `42562d3` and on `f4e110e`; Vercel production deploy `success`
(`HR4htkRa5VBtfCkfaVhhNgXujc9B`) on the feature HEAD. Re-confirm with
`gh run list --branch main --limit 3` if in doubt.

---

## 2. What's done — C.53 §10 restructure

Spot-check items (snapshot-bearing, `prep_meta.openingPhase2=true`, in the closer-count-snapshot
universe) are now **absorbed into Phase 1**: the opener verifies/recounts them on the Phase 1
verification tab via per-station section-verify CTAs + per-item recount affordance, instead of
the legacy Phase 2 prep submit path.

The **d49d1504 stuck-shift class is closed in the UI.** Before tonight, the no-prior-data Phase 1
path was wired but dormant (RPC/lib/route correct at the data layer, but the form's `phase1Items`
didn't contain spot-check items, so the attestation/recount UI never rendered). The restructure
put spot-check items in `phase1Items`, which activates all the dormant wiring.

**FT.1 operational smoke (Juan, against the real `d49d1504` EM instance) PASSED:** no-prior-data
opener flowed through the new `/phase1` path (not legacy `/submit`), attestation/recount rendered
and resolved, submit succeeded, and surfaced `phase2_pending_next_release` — the Piece 4 guardrail
behaving correctly (honest seam, not a defect).

**Canonical record: `docs/SPEC_AMENDMENTS.md` §11.1** (and the §11 header). Read it before
anything else in this area — it has the shipped commits, the deploy IDs, and the FT.1 result.
`d49d1504` itself stays preserved `open` per C.54 §8 "do not touch" — the *class* is closed for
new shifts; the captured artifact is not mutated.

---

## 3. The next loop — Phase 2 submit RPC + `/submit/phase2` route

**This is its own loop, not a continuation of §10.** Fresh read-ground-truth → plan → gate cycle.

**What it is:** the Phase 2 prep submit path. Today, Phase 1 submit transitions the instance to
`phase1_complete` and the legacy `/submit` route detects that state and returns 200 with
`code: 'phase2_pending_next_release'` (the Piece 4 guardrail in
`app/api/opening/submit/route.ts`). **That seam is the entry point** — Phase 2 submit is the
surface that replaces "pending next release" with a real Phase 2 RPC + route.

**The one coupling you already know about — the `prep_data.phase1` contract.** The Phase 1 RPC
(`submit_phase1_atomic`, migration `0055_create_submit_phase1_atomic_rpc`) persists a
`prep_data->phase1` JSONB with **8 keys** that the future Phase 2 RPC's reader MUST be checked
against. From the 0055 header (verify against the file — `supabase/migrations/0055_create_submit_phase1_atomic_rpc.sql`,
the `v_prep_data_phase1 := jsonb_build_object(...)` block):

1. `prep_data->'phase1'->>'phase'` — always `1`
2. `prep_data->'phase1'->>'closer_count'` — numeric or null
3. `prep_data->'phase1'->>'opener_recount'` — numeric or null
4. `prep_data->'phase1'->>'section_verified'` — boolean
5. `prep_data->'phase1'->>'ground_truth_count'` — numeric, NOT NULL on spot-check items
6. `prep_data->'phase1'->>'prep_need'` — numeric or null (null when par_value is null)
7. `prep_data->'phase1'->>'par_value'` — numeric or null
8. `prep_data->'phase1'->>'spot_check_status'` — `'flagged_recount'` | `'matched_via_section_verify'`

Phase 2's RPC reads this to source `ground_truth_count` + `prep_need` when computing
`delta_vs_prep_need`. **Any rename of these keys is a Phase 2 break** and requires the
coupled-commit discipline (AGENTS.md "wire-shape coupling at architectural level, not
conversational level"). When you build the Phase 2 reader, diff its key reads against this list
first.

**Pre-build discipline for this loop (from the C.54 §9 lesson):** audit every `submit_phase[1-3]_atomic`
branch carrying "preserved from prior" / "unchanged from X" comments against C.50/C.54's
NULL-source-as-valid-state assumptions before trusting them. The d49d1504 bug was exactly a
"preserved from 0050" branch that C.50 had silently invalidated.

---

## 4. Queued / deferred — don't let these evaporate

- **FT.2 — i18n re-namespace (Flash-eligible, non-blocking).** `OpeningSectionVerify` and the
  recount section still read `opening.phase2.*` keys while living in Phase 1 chrome:
  `opening.phase2.section_verify_cta`, `opening.phase2.section_verified_button`,
  `opening.phase2.section_disabled_null_items`, `opening.phase2.recount_label`. Rename →
  `opening.section_verify.*` / `opening.recount.*` across `lib/i18n/{en,es}.json` + callsites.
  Pure rename, no behavior change. Verify the exact key set by grepping `opening.phase2.` in
  `components/opening/` before handing to Flash. Also noted in SPEC_AMENDMENTS.md §11.1.

- **Untracked infra files needing a git decision** (`git status` will show these):
  - `scripts/flash-dispatch.py`, `scripts/escape-log.py`, `docs/route_to_model.py` → **track**
    (real tooling, belongs in the repo). Add + commit.
  - `scripts/.flash-batch-results.json` → **gitignore** (run artifact, not source). Add a
    `.gitignore` entry; do not commit the file.
  - These were intentionally NOT swept into tonight's commits (staged files explicitly). Make the
    call early next session so they stop showing up as noise in every `git status`.

- **Branch-protection posture question (flagged for conscious decision).** Tonight both feature
  pushes went directly to `main` via the admin path — the remote logged "Bypassed rule violations
  — Required status check 'build' is expected" because the `build` gate runs *after* the push on
  main, not as a pre-merge block (`enforce_admins: false`). Post-push builds came back green, so
  the gate was honored, just not as a block. **Open question:** keep defaulting to
  direct-push-admin (fast, solo-dev, gate-runs-after), or move to PR-with-CI (gate blocks before
  merge)? Currently defaulting to the first. Not decided — raise with Juan when it next matters
  (e.g., when team access lands, per the Phase 3 CI-gate AGENTS.md entry).

---

## 5. Operating context

- **Workflow: v5.3 (locked).** Details in memory (`orchestration_framework_v4.md`, MEMORY.md).
  You are Tier 0 main coder + sole semantic reviewer of all non-CC code. Triad A = Juan + Claude
  Chat, locks gate-protecting decisions. No edit-through-pipe, no self-approve, no concurrent
  sessions.
- **The loop:** read-ground-truth → plan → gate → build → first-eyes (Juan's REPL) → Triad A
  code-gate trace → smoke → commit → push. Push is post-smoke; the smoke ("I watched it work
  against a live instance"), not the commit, is the done-condition.
- **`scripts/pre-gate.sh` is the working gate:** typecheck (tsc --noEmit) → lint (eslint) → build
  (next build), fail-fast. **Errors block at 0; warnings ratchet at baseline 17 (advise-only,
  don't let it creep).** See the `project_pregate_warnings_threshold_defect.md` memory — the
  threshold is gate-protecting, do NOT retune it unilaterally; that's Triad A.

---

## 6. One durable lesson from tonight — read git before trusting any summary

Tonight, **read-ground-truth-first caught a stale-memory error at nearly every step.** The
environment header said "Is a git repository: false" (wrong — it's a repo on `main`). The summary
implied work-states that I re-verified against `git status` / `git diff` / `grep` before acting,
and the verification mattered each time: confirming the actual two-file diff rather than the
remembered one; confirming declaration order (`phase1Items`/`closerSnapshotsMap` before the
repointed `useState`); finding the *second*, dormant line-791 consumer reading the same
`sectionVerifications` map (a total-coupling edge the summary didn't mention); confirming the five
restructure consequences were all actually present in the code; and — the load-bearing one — the
whole d49d1504 bug class was itself a "preserved from prior" RPC branch that a later amendment had
silently invalidated, i.e. a stale-memory error baked into *production*.

The discipline that works: **the codebase + git history are the canonical operational artifact.
Memory and summaries are pointers to verify, not facts to act on.** So, cold-you: before you trust
this handoff — including this very sentence — run `git log`, `git status`, and read
`SPEC_AMENDMENTS.md §11.1`. If any of it contradicts what's on disk, the disk wins. Start every
session by reading reality, then plan.
