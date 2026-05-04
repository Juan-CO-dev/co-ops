# Phase 3 — Module #1 Build #2 PR 3 — Handoff

**For:** A fresh Claude Code session opening this branch cold to ship Build #2 PR 3 (C.46 implementation: post-submission updates with chained attribution for AM Prep). Read this first; it orients you in 5 minutes so you can be useful in the 6th.

**Date written:** 2026-05-04, after Build #2 PR 1 + PR 2 merged to main and C.46 architecture was locked between sessions.

**Read this in addition to** the standing project orientation: `docs/PHASE_3_BUILD_1_HANDOFF.md`, `docs/PHASE_3_BUILD_1.5_HANDOFF.md`, `docs/PHASE_3_BUILD_2_PR_1_WIP_HANDOFF.md`, `docs/SPEC_AMENDMENTS.md`, and `AGENTS.md`. This handoff is scoped to Build #2 PR 3 — implementation of C.46 — opening cold against a clean main.

---

## 1. Where we are

**Main HEAD:** `3cc856d` (Build #2 PR 2: TZ canonical lift + required-fields validation, squash-merged 2026-05-04).

```
3cc856d Build #2 PR 2: TZ canonical lift + required-fields validation (#32)
dc85e7e Build #2 PR 1: AM Prep vertical slice + Standard Closing v2 (#31)
e72c6f0 docs(amendments): C.18-C.20 updates + C.42-C.44 (Build #2 architectural ground)
```

**Build #2 status:**
- ✅ **PR 1** — AM Prep vertical slice + Standard Closing v2 — shipped
- ✅ **PR 2** — TZ canonical lift + required-fields validation — shipped
- 🟢 **PR 3** — **C.46 implementation: post-submission updates with chained attribution for AM Prep — this PR**

**Branches eligible for cleanup** (Juan handles `git push origin --delete` from outside the worktree at his convenience; harmless on remote until then):
- `claude/dreamy-tesla-a03563` (Build #2 PR 1)
- `claude/build-2-pr-2-required-fields-and-tz` (Build #2 PR 2)

**This handoff lives on** `claude/build-2-pr-3-handoff` — you are reading it from there. Once you start implementation, create a fresh branch off main `3cc856d`; do NOT pick up from this handoff branch (which only carries docs) or from the prior PR branches.

**C.46 architecture is locked.** Full text in `docs/SPEC_AMENDMENTS.md` C.46. Read that next; it is the canonical reference for every implementation decision in this PR.

---

## 2. What's left for Build #2 PR 3

C.46 architecture is locked. Implementation is mechanical given the locked decisions. Phases:

### Phase 1 — Schema migration

Add to `checklist_completions` and `checklist_submissions`:

```sql
ALTER TABLE checklist_completions ADD COLUMN original_completion_id UUID NULL
  REFERENCES checklist_completions(id);
ALTER TABLE checklist_completions ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE checklist_submissions ADD COLUMN original_submission_id UUID NULL
  REFERENCES checklist_submissions(id);
ALTER TABLE checklist_submissions ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;
```

`original_*_id` is NULL for chain heads (the original submission/completion); FK for every update.
`edit_count` is 0 for original, 1–3 for updates (cap enforced in RPC, not via CHECK constraint — keeping the constraint at app layer aligns with how Build #2 PR 1 handled level gates).

Apply via Supabase MCP `apply_migration` tool. Migration name suggestion: `0042_c46_edit_chain_columns`. Reference the migration shape from existing 0036–0041 (each lives in `supabase/migrations/` per Phase 1 Session A's convention).

Index considerations: the chain-query hot path is "find all submissions in chain" — a partial index on `(original_submission_id) WHERE original_submission_id IS NOT NULL` keeps the chain-rebuild query cheap. Same for completions if needed.

### Phase 2 — RPC update

Extend `submit_am_prep_atomic` with an `is_update: boolean` parameter (default `false`). Two branches:

- **`is_update = false`** — existing behavior. No code change.
- **`is_update = true`** — new branch:
  - Validate edit cap: `(SELECT MAX(edit_count) FROM checklist_submissions WHERE id = original OR original_submission_id = original)` must be `< 3`. If at 3, raise `edit_limit_exceeded` (RPC-side error → API maps to 422).
  - Validate access predicate (called pre-RPC at the API layer; defensive duplicate at RPC layer is optional — see "three-layer audit pattern" reminder in §3).
  - Create new completion rows linked to original chain via `original_completion_id`.
  - Create new submission row with `edit_count = max + 1`.
  - Emit `report.update` audit row inside the transaction (same pattern as the existing audit emission in the RPC).
  - DO NOT change instance status (stays `confirmed` since the original set it).
  - DO NOT touch the closing checklist's auto-complete row (preserves A4 dynamic-read pattern — closing reads the chain at render time).

Apply as a new migration `0043_c46_submit_am_prep_atomic_with_update` (or extend 0041 — depends on whether the project convention prefers single-RPC-evolution-via-CREATE-OR-REPLACE or new-RPC-per-version; check Phase 1 conventions).

### Phase 3 — Lib changes

**`lib/checklists.ts`** — new helpers:
- `canEditReport(actor, originalSubmitterId, closingStatus, currentEditCount): { canEdit: boolean; reason?: string }` — implements C.46 A1 access rules. Pure function; no DB side effects. Returns `canEdit: false` with a reason string when access is denied (used by callers to surface the right typed error).
- `loadChecklistChainAttribution(service, originalSubmissionId, language): Promise<ChainAttribution>` — chain-query helper for closing-side dynamic rendering (per A4). Returns the resolved chain (`[{ submitterName, submittedAt, editCount }]`) ready to render via translations. One DB query + N user-name lookups (cached or join-resolved per existing closing-page pattern).

**`lib/prep.ts`** — extend `submitAmPrep`:
- New signature accepts `isUpdate: boolean` (defaults to `false`).
- Pre-RPC access check via `canEditReport`. Throws `ChecklistEditAccessDeniedError` if denied.
- Pre-RPC edit cap check (or rely on RPC-side validation; pick the layer that gives cleanest error mapping). Throws `ChecklistEditLimitExceededError` if cap exceeded.
- Two new typed errors:
  ```ts
  export class ChecklistEditLimitExceededError extends PrepError {
    constructor(public readonly originalSubmissionId: string) {
      super(`...`, "edit_limit_exceeded");
    }
  }
  export class ChecklistEditAccessDeniedError extends PrepError {
    constructor(public readonly reason: string) {
      super(`...`, "edit_access_denied");
    }
  }
  ```
- Existing typed errors (`PrepRoleViolationError`, `PrepInstanceNotOpenError`, `PrepAutoCompleteError`, `PrepShapeError`, `PrepInvariantError`) still apply where their semantics still hold.

**`lib/report-assignments.ts`** — no changes expected unless edit-access derivation needs to read the assignment row to identify "original submitter" (use the existing `loadAssignmentForToday` if so).

### Phase 4 — API route extension

**`app/api/prep/submit/route.ts`** — extend POST handler:
- Body schema accepts optional `isUpdate: boolean` (defaults to `false`).
- New error code mapping in `app/api/prep/_helpers.ts mapPrepError`:
  - `ChecklistEditLimitExceededError` → 422 with `code: "edit_limit_exceeded"`
  - `ChecklistEditAccessDeniedError` → 403 with `code: "edit_access_denied"`

### Phase 5 — UI changes

**`components/prep/AmPrepForm.tsx`** — add edit mode rendering:
- New prop: `mode: "submit" | "edit"` (or derive from `isReadOnly` + a new `canEdit` boolean prop).
- When `mode === "edit"`:
  - Pre-populate `initialRawValues` from current chain-resolved values (server provides via the page's data load)
  - CTA label: `"Update AM Prep"` (new translation key `am_prep.submit.button_update`)
  - Banner above form: "Editing AM Prep submitted by [name] at [time]" (new translation key `am_prep.banner.editing`)
  - Cancel button explicit: returns to read-only mode without saving. Existing discard pattern from PR 1 carries the visual/accessibility shape.
  - On update success: banner becomes the chained attribution (new translation keys for the chained form — see "translations" below).
- Submit handler: extends with `isUpdate: mode === "edit"` in the POST body.

**`app/(authed)/operations/am-prep/page.tsx`** — Server Component:
- Resolve "should this user see edit mode?" via URL param (`?edit=true`) + `canEditReport` predicate.
- If edit mode requested AND access granted: load chain-resolved values + pass `mode="edit"` to AmPrepForm.
- If edit mode requested AND access denied: redirect to the read-only view + flash a Toast or banner explaining (or just silently render read-only — pick the lighter path).
- Default: read-only mode (existing behavior).

**`app/(authed)/dashboard/page.tsx`** AmPrepTile:
- Edit affordance for original submitter only (per A2). Predicate: `state.todayInstance?.confirmedBy === actor.userId && operational.todayInstance?.status === "open"`.
- Tap navigates to `/operations/am-prep?location=<id>&edit=true`.
- New CTA label "Edit AM Prep" (new translation key) replaces "View AM Prep" when edit affordance fires.

**`components/ReportReferenceItem.tsx`** (closing-side):
- Edit affordance for KH+ users (or original submitter while open) — per A2.
- Tap navigates to `/operations/am-prep?location=<id>&edit=true`.
- Chained attribution rendering: read the AM Prep submission chain via `loadChecklistChainAttribution` (server-side; called by closing-page's loader); render as comma-separated chain. New translation keys for the chained form.

**`closing-client.tsx`** — minimal change (passes through whatever the page-level loader resolves; no client-side chain query).

### Phase 6 — Translations (per C.37 translate-from-day-one)

New keys (en + es), at minimum:

```
am_prep.submit.button_update
am_prep.banner.editing
am_prep.banner.read_only_with_updates  (or extend existing am_prep.banner.read_only)
am_prep.error.edit_limit_exceeded
am_prep.error.edit_access_denied
dashboard.am_prep.cta_edit
closing.report_ref.attribution_with_updates  (or extend existing closing.report_ref.attribution)
```

Spanish equivalents per the existing dialect convention (operational/practical, tú-form imperatives where applicable).

The chained attribution string is a render-time concatenation, not a single template string, because the chain length varies (1 to 4 entries). Build via JS (not via a single t() call) — consult AGENTS.md "system-key vs display-string discipline" if any matching/grouping logic depends on the rendered string.

### Phase 7 — Audit emission updates

`report.update` action (per A7). Confirm it lands on `lib/destructive-actions.ts` `DESTRUCTIVE_ACTIONS` list so `audit()` auto-derives `destructive=true`. Metadata shape per A7 verbatim. Emitted from inside the RPC transaction (atomic with the chain write).

### Phase 8 — Verification + smoke

Per AGENTS.md three-layer audit pattern: lib + RLS + UI.
- **Lib gates:** `canEditReport` returns the right answer for every cell of (actor role, closing status, original submitter relationship, current edit_count).
- **RLS:** the RPC runs as `SECURITY DEFINER` (existing 0041 pattern), so RLS bypass is intentional. New schema columns inherit existing RLS policies on parent tables; verify via Supabase MCP that no new RLS site needs explicit policy.
- **UI:** Edit affordance only renders when `canEditReport` returns canEdit=true. Three-layer grep sweep before declaring complete (per AGENTS.md durable lesson — every role-level gate change must trigger 3-layer review).

Smoke against the PR's preview URL (NOT production — per AGENTS.md preview URL discipline).

---

## 3. Architectural ground locked

### Spec amendments referenced

- **C.46** (full architecture) — `docs/SPEC_AMENDMENTS.md` C.46 is the canonical reference. Read it cover-to-cover before implementing. All 9 sub-decisions (A1–A9) lock the access rules, schema, RPC, audit, UI, and generalization commitment.
- **C.18** (refined) — section-aware prep data model + 32-required semantic per Build #2 PR 2 Bug D.
- **C.19** — Path A versioning; closing as anchor with auto-complete. C.46 explicitly preserves A4: closing's auto-complete row stays in place; the chain reads dynamically.
- **C.41 sub-finding + fix** — KH+ = `level >= 3`. C.46 A1 references this.
- **C.42** — operational reports architecture. C.46 generalization commitment (A9) flows from C.42's pluggable-report-type framing.
- **C.45** — capabilities-as-tags model. Out of scope for PR 3 (still deferred to Module #2).
- **§2.5** — immutable completions / supersede-by-recency. C.46 A5/A6 implements this for AM Prep specifically.

### Architectural commitments to preserve

- **Three-layer audit pattern (lib + RLS + UI)** — every role-level gate change must trigger a 3-layer grep sweep. C.46 introduces a new gate (`canEditReport`); ensure it fires at all 3 layers.
- **Audit-the-audit pattern (`audit.metadata_correction`)** — append-only philosophy. Do not UPDATE existing audit rows; if the new RPC's metadata strings need correction, write a corrective row.
- **System-key vs display-string discipline (C.38)** — chain attribution rendered via translated names but matched/keyed by user_id and submission_id (system keys). Don't introduce render-string-as-key shortcuts.
- **Translate-from-day-one (C.37)** — every new UI string ships with EN + ES in the same PR. The chained-attribution rendering may need careful Spanish handling (comma-separated lists, "Submitted by X, updated by Y" reads differently in Spanish — confirm with Juan post-implementation if the literal translation reads off).
- **Language-aware time/date formatting** — use `lib/i18n/format.ts formatTime` (canonical helper from Build #2 PR 2). Never inline `toLocaleTimeString` again.
- **Convergent seed scripts must gate `main()` behind direct-invocation check** — only relevant if PR 3 adds a new seed. C.46 implementation likely doesn't need a seed; data structure is operator-generated, not template-seeded.
- **Smoke-test instructions must point to the PR's preview URL, not production** — explicit in PR description; both Bug C and PR 1's false-positive bugs traced back to violating this.

---

## 4. Production identifiers (carry-forward)

| Resource | Value |
|---|---|
| Repo | `https://github.com/Juan-CO-dev/co-ops` |
| Production URL | `https://co-ops-ashy.vercel.app` |
| Supabase project ref | `bgcvurheqzylyfehqgzh` |
| MEP location id | `54ce1029-400e-4a92-9c2b-0ccb3b031f0a` |
| EM location id | `d2cced11-b167-49fa-bab6-86ec9bf4ff09` |
| MEP AM Prep template (Standard AM Prep v1) | `6f3a9f2b-e73c-4621-a28b-688bd1bc3973` |
| EM AM Prep template (Standard AM Prep v1) | `ca917675-877c-4d1a-b86d-3114e2295678` |
| MEP Standard Closing v2 template | `876ba0f4-0b4f-4194-b82e-8fd84655222d` |
| EM Standard Closing v2 template | `da49d8ea-a1b2-4f11-b1bc-172dff9133a1` |
| MEP Standard Closing v1 (preserved, active=true) | `764eba7a-975d-4a53-b386-952a15cb2d9e` |
| EM Standard Closing v1 (preserved, active=true) | `b67c9fda-ee22-48f7-9bf5-01054e6ecf6d` |
| MEP AM Prep report-reference item in v2 closing | `3dc30891-ceec-43e7-a2f4-52c455daf2b3` |
| Juan (cgs, level 8) | `16329556-900e-4cbb-b6e0-1829c6f4a6ed` |
| Pete (owner, level 7) | `73ac4b61-ff87-4db6-b338-9098dfe3f295` |
| Cristian (moo, level 6.5) | `0d467b64-6865-461b-b4fd-f3a17c3a056f` |

PR 3's schema migration will add columns to existing tables; no new template/instance/audit IDs to capture pre-implementation.

---

## 5. Working rhythm to preserve

Same 8-point cadence Build #1, #1.5, #2 PR 1, and #2 PR 2 established. Future-Claude should preserve it:

1. **Surface architectural decisions before code.** C.46 is locked; you don't re-debate. But surface implementation alternatives (e.g., RPC migration shape) before code.
2. **Surface code before commit.** Review gate at end of each phase. Catches issues before they enter git history.
3. **Single commit per phase through CI gate.** Schema migration → one commit. RPC extension → one commit. Lib changes → one commit. API → one commit. UI → one commit (or split AmPrepForm vs Dashboard tile vs ReportReferenceItem). Squash-merge consolidates at PR-merge time.
4. **Capture amendments in `docs/SPEC_AMENDMENTS.md`** when reality diverges from spec. C.46 may need refinement during implementation; surface amendments rather than silent deviation.
5. **Translate-from-day-one (C.37).** Every new UI string ships with EN + ES keys in the same PR. No deferred translation.
6. **System-key vs display-string discipline (C.38).** Business keys English source-of-truth; translation only at render.
7. **Three-layer audit pattern (lib + RLS + UI)** for any role-level changes. Grep sweep before declaring complete.
8. **Audit-the-audit pattern (`audit.metadata_correction`)** for stale audit metadata corrections.

---

## 6. Pickup paths for next session

### Path A (lean) — read this handoff, ship C.46 implementation per locked architecture

1. Read this handoff doc end-to-end
2. Read `docs/SPEC_AMENDMENTS.md` C.46 cover-to-cover (the substance of the architecture)
3. Read `AGENTS.md` durable lessons accumulated through PR 1 + PR 2 (especially three-layer audit pattern, formatTime canonical, preview URL discipline)
4. Open `lib/prep.ts submitAmPrep` to understand the existing RPC wrapper shape
5. Open `components/prep/AmPrepForm.tsx` to understand the existing form shape (read-only banner, success banner, validation, submit handler)
6. Open `components/ReportReferenceItem.tsx` to understand closing-side rendering (already does dynamic read for auto-complete attribution)
7. Open existing migrations 0036, 0040, 0041 for reference shape (column adds, RPC creation)
8. Surface the schema migration plan to Juan first (column shapes + index suggestion); apply via Supabase MCP
9. Surface the RPC migration plan; apply
10. Lib + API + UI phases in order, committing after each
11. Open PR with smoke-test checklist pointing to the PR's preview URL
12. Squash-merge on clean smoke

### Path B — alternative direction Juan locks at session open

If Juan opens the next session with a different direction:
- Defer C.46 to a later PR (e.g., ship C.44 admin tooling first)
- Do v1 Standard Closing flip-to-inactive cleanup as a small separate PR before C.46
- Tackle MiscSection conditional YES/NO render if Image 1's notes-sink item ever lands first
- Lift `formatDateLabel` to `lib/i18n/format.ts` (currently 1 site in dashboard; revisit when 2nd site needs it per AGENTS.md threshold convention)

The PR 3 candidates from Build #2 PR 2's session-end summary (open backlog):
- **C.46** ← my recommendation (architecture is locked; implementation is mechanical)
- **C.44 admin tooling** (substantial PR; design conversation needed first)
- **v1 Standard Closing flip-to-inactive cleanup** (small)
- **MiscSection conditional YES/NO render** (~5 LOC; only needed if section-notes-sink item lands)
- **`formatDateLabel` lift** (small cleanup)

---

## 7. Files to open early in the next session

In suggested order:

1. **This handoff doc** — `docs/PHASE_3_BUILD_2_PR_3_HANDOFF.md`
2. `docs/SPEC_AMENDMENTS.md` — read C.46 cover-to-cover; skim C.18 / C.19 / C.41 sub-finding / C.42 / C.45 / §2.5 for context
3. `AGENTS.md` — full read; especially the durable lessons added during PR 1 + PR 2 (three-layer audit pattern, audit-the-audit pattern, language-aware time/date formatting canonical, preview URL discipline, MiscSection always renders YES/NO toggle pair, C.44 admin tooling translation handling, loadAmPrepState single-prep-template assumption, convergent seed scripts must gate main())
4. `lib/prep.ts` — study `submitAmPrep` (existing RPC wrapper to extend), `loadAmPrepState` + `loadAmPrepDashboardState` (read-loaders that may need chain-aware extensions for edit-mode initialValues), typed errors namespace
5. `lib/checklists.ts` — existing role+status gate functions (`revokeWithReason`, `tagActualCompleter`); the new `canEditReport` will live here alongside them, sharing the same patterns
6. `components/prep/AmPrepForm.tsx` — current form behavior (banners, validation, submit); useful to plan edit-mode extensions
7. `components/ReportReferenceItem.tsx` — closing-side, needs edit affordance + chained attribution rendering
8. `app/(authed)/dashboard/page.tsx` AmPrepTile — current tile rendering; needs edit affordance for original submitter
9. `app/api/prep/submit/route.ts` + `app/api/prep/_helpers.ts` — current API surface to extend
10. Existing migrations `supabase/migrations/0036_*.sql` through `0041_*.sql` for migration shape reference

---

## 8. Branch creation guidance

**DO** create a fresh branch off `main` `3cc856d`:

```bash
git checkout main
git pull origin main
git checkout -b claude/build-2-pr-3-c46-edit-with-attribution
```

**DO NOT** pick up from:
- `claude/dreamy-tesla-a03563` (Build #2 PR 1 — merged, eligible for cleanup)
- `claude/build-2-pr-2-required-fields-and-tz` (Build #2 PR 2 — merged, eligible for cleanup)
- `claude/build-2-pr-3-handoff` (this branch — only carries the handoff doc + C.46 amendment expansion; merge it via the same PR or rebase its commits into the implementation PR)

**Recommended:** start the implementation branch with the handoff branch's commits (cherry-pick or rebase), so the C.46 expansion lands together with the implementation. OR open the handoff branch as a tiny doc-only PR first, merge it, then start implementation off the new main.

---

## 9. PR scope clarity

**Build #2 PR 3 ships:**
- C.46 implementation for AM Prep specifically (schema + RPC + lib + API + UI + translations + audit)

**Build #2 PR 3 does NOT ship:**
- Generalization to other report types (Cash Report, Opening Report, Mid-day Prep, Special Report, Training Report) — they inherit C.46 in their own implementation PRs
- v1 Standard Closing flip-to-inactive — separate small PR
- C.44 admin tooling — separate substantial PR
- MiscSection conditional YES/NO render — separate small PR if/when needed

The amendment in `docs/SPEC_AMENDMENTS.md` C.46 is the canonical pattern; future report-type PRs reference it as locked architecture without re-debating.

---

## 10. The unwritten contract (preserved from prior handoffs)

Build #2 PR 1 + PR 2 shipped clean because Juan's operational wisdom met clean software architecture at the right cadence. PR 3 should preserve that cadence:

- Surface decisions before code (C.46 already locked; surface implementation alternatives where they exist)
- Push back on bad assumptions in real time
- Capture amendments when reality diverges from spec
- Ship through the CI gate
- No shortcuts

The system gets better when this contract holds. Don't break it under deadline pressure or perceived shortcuts — the savings are illusory and the cost compounds. Slow is smooth, smooth is fast.

---

*End of handoff. C.46 architecture is locked in `docs/SPEC_AMENDMENTS.md`; implementation is mechanical given the locked decisions; the next Claude Code session opens cold against this handoff + the amendment and ships PR 3 cleanly.*
