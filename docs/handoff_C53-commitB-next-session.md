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

## TEST FIXTURES — REMOVE AT FULL LAUNCH

Durable test accounts seeded for Commit B Phase 2 smoke (`scripts/seed-test-accounts.ts`), location
`d2cced11` (EM). Juan ruled: keep until full-system launch, scrub then (append-only — `active=false`,
not delete). **Current live 4-digit PINs** (KH1 + PREP were reset during the C.55 smoke; KH2 unchanged):

| Account | Role code | Current PIN | Notes |
|---|---|---|---|
| ZZ_TEST_KH1 | `key_holder` | **4417** | reset during C.55 smoke (was 4829) |
| ZZ_TEST_KH2 | `key_holder` | 7394 | unchanged |
| ZZ_TEST_PREP | `trainee` | **4413** | reset during C.55 smoke (was 1506) |

**Levels resolve from the role code at runtime — do NOT read a fixed number off this table.** Post-C.41
renumber (`lib/roles.ts`), `key_holder` = level 4, `trainee` = level 3. The seed script
(`scripts/seed-test-accounts.ts`) still prints pre-renumber labels (key_holder "level 3", trainee
"level 2") in its console output — those are stale and should be ignored; the accounts store only the
role code, so they always resolve to current levels.

**C.55 scratch scripts** (left in `scripts/`, safe to delete anytime — service-role smoke tooling,
not wired into the app): `c55-diag.ts`, `c55-roles-check.ts`, `c55-smoke-seed.ts`,
`c55-smoke-survey.ts`, `c55-smoke-check2.ts`, `c55-smoke-check3.ts`, `c55-smoke-cleanup.ts`,
`c55-seed-now.ts`, `c55-cleanup-orphans.ts`. All write only to test completions / test fixtures.

### C.53 Phase 2 e2e smoke artifacts (2026-06-04) — LAUNCH-PURGE DEBT

The C.53 Phase 2 multi-actor e2e smoke (`scripts/c53-phase2-smoke.ts`, **11/11 pass**) ran on a
dedicated throwaway sentinel-date instance so no real ops opening was mutated. Finalize permanently
advanced it to `phase2_complete` (append-only, irreversible) — so it's purge debt, not cleanable:

- **Sentinel test instance `f66e0668-cad7-4382-aefa-f11424d8542f`** — EM (`d2cced11`), **date
  `2099-12-31`** (sentinel — findable + distinct from any real opening), status `phase2_complete`.
  Carries 78 Phase-1 completions (34 spot-check contract + 44 plain) + 34 closer-count snapshots +
  39 Phase-2 completions (**all soft-revoked** post-smoke; 0 live).
- **2 `under_par_alert` notifications** + recipient rows (two finalize runs; first-run instance
  `c5ebbeb1` was hard-deleted on re-run, leaving one orphan notification → harmless).
- **Pre-existing (NOT this smoke):** 8 ZZ_TEST Phase-2 completions on real instance `dde30257`
  (2026-06-03, Commit B dev "synthetic+guard verified" testing). Predate this session; noted for
  completeness.
- **Scratch script** `scripts/c53-phase2-smoke.ts` (kept local/untracked like the C.55 scripts).
- **PIN note:** the smoke reset ZZ_TEST PINs to **KH1=1471, KH2=2582, PREP=3693** (supersedes the
  C.55 values in the table above). Throwaway; reset/disable at launch.

**Purge at launch:** `checklist_instances.date = '2099-12-31'` → cascade its completions/snapshots;
the ZZ_TEST accounts above; the smoke `under_par_alert` notifications.

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
