# Phase 3 — Module #1 Build #2 PR 1 — WIP Handoff

**For:** A fresh Claude Code session opening this branch cold to ship the seed scripts + integration phase that closes the AM Prep vertical slice. Read this first; it orients you in 5 minutes so you can be useful in the 6th.

**Date written:** 2026-05-04, mid-session handoff after the closing-client report-reference rendering commit.

**Read this in addition to** the standing project orientation: `docs/PHASE_3_BUILD_1_HANDOFF.md`, `docs/PHASE_3_BUILD_1.5_HANDOFF.md`, `docs/SPEC_AMENDMENTS.md`, and `AGENTS.md`. This handoff is scoped to Build #2 PR 1's WIP state on the branch.

---

## 1. Where we are

**Branch:** `claude/dreamy-tesla-a03563`. **10 WIP commits ahead of `main`** (this handoff doc commit makes it 11).

**Production state verified:** Supabase schema has migrations 0036–0041 applied. The closing template `min_role_level` was reconciled from 4 → 3 across all 100 production rows (50 items × 2 locations) with full audit forensic chain — including a corrective `audit.metadata_correction` row that fixes stale phase/reason metadata from the seed re-run. Closing finalize gate now correctly admits KH+ users (level >= 3) at lib + UI + RLS layers per C.41 reconciliation.

**Branch status:** all 10 commits passed CI gate on push (`build` job on GitHub Actions, branch protection on main requires this status check).

---

## 2. Full git log (commit hash + subject)

```
675e0a8 wip(prep): closing-client report-reference rendering — ReportReferenceItem + station branch + formatTime lift
4506c4c wip(prep): dashboard AM Prep tile + Reports section + loadAmPrepDashboardState
c80d1d1 wip(prep): /operations/am-prep page Server Component + page-level translation keys
e8432f0 wip(prep): Part 2 follow-up — language-aware time format + dead-key cleanup + status comment
83136fb wip(prep): Part 2 — AmPrepForm interactive logic (state, validation, submit, banners)
7c38c50 wip(prep): /api/prep/submit route — auth + validation + context resolution + lib delegation
04c2390 wip(prep): Part 1 — read-only structural skeleton (primitives + 6 sections + AmPrepForm shell)
b8de230 wip(gate): C.41 cleanup — caught one missed UI gate site in ChecklistItem + audit lesson
940ae4c wip(gate): C.41 reconciliation — closing finalize KH+ at level >= 3
f02f805 wip(prep): lib phase — types + validators + RPC wrapper + assignments CRUD
```

Each commit is a complete, coherent unit (lib phase, gate fix, gate cleanup, page-by-page build, follow-up cleanups). Squash-merge consolidates them at PR-merge time; the granular history is preserved in the squash commit's body for forensic traceability.

---

## 3. Architectural ground locked during this PR

### Spec amendments referenced

- **C.18** (refined) — Prep workflow architectural model. Two trigger paths preserved (`closing` + `manual`); per-item data shape now richer than originally scoped (PAR / ON HAND / BACK UP / TOTAL across 5 numeric sections + Misc Y/N flags + free-form notes).
- **C.19** (refined) — Closing as anchor; reports surface as items via `report_reference_type` column. Standard Closing v2 ships via Path A versioning (name suffix + active flag); v1 stays active for old instances.
- **C.20** (refined) — Opening report (semantic rename); surfaces via C.42 reports architecture.
- **C.41** — Level number divergence between DB+lib implementation and C.33 documented intent. **Build #2 PR 1 sub-finding + fix paragraph (added 2026-05-04)** documents the latent closing-finalize-gate bug + the surgical fix at level >= 3. Broader level-number restructure remains deferred to Module #2.
- **C.42** — Operational reports architecture. Two-surface model (dashboard tiles + reports hub); auto-completion mechanic with inline attribution; assignment-down via generic `report_assignments` table; custom-where-needed/reuse-where-natural data model.
- **C.43** — Mid-day prep multi-instance per day, numbered. Schema accommodates (`triggered_at` column added in migration 0038); not exercised in PR 1.
- **C.44** — PAR template editing by GM+ (admin tooling). Denormalized snapshot pattern locked: prep completion rows carry `prep_data.snapshot` per C.44 so historical reports stay accurate even after admin tool edits PAR/section/unit. Admin UI itself deferred to a follow-up PR.
- **C.45** (new, added 2026-05-04) — Capabilities-as-tags model: `is_trainee` and `is_trainer` are tags on user records, not roles. Implementation deferred to Module #2 user lifecycle work; canonical pattern for any future operational capability orthogonal to role-level seniority.

### Key architectural commitments

- **Capabilities-as-tags model (C.45)** — `is_trainee`, `is_trainer` deferred to Module #2 implementation. Future capabilities (shift-supervisor delegation, cash-handling certification, etc.) follow this model rather than introducing additional role tiers.
- **Three-layer audit pattern (lib + RLS + UI)** — any role-level gate change must trigger a 3-layer grep sweep BEFORE declaring complete. The C.41 cleanup commit (b8de230) caught two gate sites that were missed in the initial reconciliation; AGENTS.md captures the durable lesson.
- **Audit-the-audit pattern (`audit.metadata_correction` action)** — append-only philosophy forbids UPDATE on existing audit_log rows; corrective rows are the canonical resolution path for stale audit metadata. The C.41 reconciliation seed re-run produced 2 stale-metadata audit rows; corrective row `66bd6c5a-7191-4918-b9bf-ea7df4993e15` references both with full forensic chain.
- **Seed audit metadata convention** — per-PR `phase` + `reason` strings hardcoded in the seed script, with a marker comment reminding the next editor to update them when re-running in a new PR context. AGENTS.md durable lesson "Audit metadata context attribution in seed scripts" captures the pattern.
- **Translate-from-day-one (C.37)** — every new UI string ships with EN + ES translation keys in the same PR. No partial-translation drift.
- **System-key vs display-string discipline (C.38)** — business keys (e.g., `prep_meta.section`, station names for grouping/matching) stay English source-of-truth; translation happens at render time only via `resolveTemplateItemContent` or section-component fallback i18n keys. `prepMeta.section` and `station` MUST stay in sync; `setPrepItemSection()` is the only sanctioned write helper, and `narrowPrepTemplateItem()` strict-throws on drift.
- **Language-aware time/date formatting** — canonical pattern across all 5 time-formatting sites (closing-page, closing-client, AmPrepForm, dashboard, ReportReferenceItem). `formatTime(iso, language)` with `language === "es" ? "es-US" : "en-US"`. Closing-client was the prior browser-locale outlier; lifted in commit 675e0a8 (also fixed a real Spanish-UX bug). AGENTS.md flags the 5-site threshold for lifting to `lib/i18n/format.ts` as the next cleanup pickup.

---

## 4. What's been shipped to the WIP branch

### Schema (already applied to production via Supabase MCP)

- **0036** — `report_type_enum` (single shared enum) + `checklist_template_items.{prep_meta, report_reference_type}` + partial index
- **0037** — `checklist_completions.prep_data` JSONB
- **0038** — `checklist_instances.{triggered_by_user_id, triggered_at}` + universal population in `getOrCreateInstance`
- **0039** — `report_assignments` table + RLS policies + 3 indexes (partial unique + 2 partial query)
- **0040** — `checklist_completions.auto_complete_meta` JSONB + partial index
- **0041** — `submit_am_prep_atomic` SECURITY DEFINER RPC for atomic submission (completions + submission row + instance confirm + closing auto-complete in one transaction)

### Lib phase (commit f02f805)

- `lib/types.ts` extensions: `ReportType`, `ReportAssignment`, `PrepSection`, `PrepColumn`, `PrepMeta`, `PrepInputs`, `PrepSnapshot`, `PrepData`, `AutoCompleteMeta`. Extended `ChecklistTemplateItem`, `ChecklistInstance`, `ChecklistCompletion`.
- `lib/prep.ts` (full rewrite, 1100+ lines) — runtime validators (`isReportType`, `isPrepSection`, `isPrepColumn`, `isPrepMeta`, `isPrepData`, `isPrepInputs`), errors, narrowing helpers (`narrowPrepTemplateItem`, `narrowPrepCompletion`), write helpers (`setPrepItemSection`, `setPrepItemMeta`, `seedPrepItem`), read loaders (`loadAmPrepState`, `loadAssignmentForToday`, `resolveClosingReportRefItemId`, `loadAmPrepDashboardState`), submission orchestration (`submitAmPrep`).
- `lib/report-assignments.ts` (new, 439 lines) — generic CRUD across all report types (createAssignment, deactivateAssignment, listAssignmentsForUser, listAssignmentsForLocation), strict-greater app-layer enforcement.
- `AM_PREP_BASE_LEVEL = 3`, `ASSIGNMENT_BASE_LEVEL = 3` per C.41 reconciliation.

### C.41 reconciliation (commits 940ae4c + b8de230)

- Closing finalize gate: `actor.level >= 4` → `>= 3` at all 4 sites (closing-client `canFinalize`, lib/checklists.ts `revokeWithReason` + `tagActualCompleter`, lib/prep.ts `AM_PREP_BASE_LEVEL`).
- Seed default `minRoleLevel`: 4 → 3 (create + sync paths). Production seed re-run propagated to 100 rows.
- Cleanup commit caught 2 missed UI gate sites (`ChecklistItem.tsx:406`, `lib/report-assignments.ts:54`) + 7 stale-comment sites; added AGENTS.md durable lesson on three-layer audits.
- Spec amendments: C.41 sub-finding + fix paragraph (preserved original divergence framing); C.45 (new) capabilities-as-tags model.
- Audit forensic chain: corrective `audit.metadata_correction` row `66bd6c5a-7191-4918-b9bf-ea7df4993e15` references the 2 stale-metadata seed-rerun audit rows with full context.

### API route (commit 7c38c50)

- `app/api/prep/submit/route.ts` (222 lines) — POST handler with auth → parse → validate → context resolution (instance load + location lock + closingReportRefItemId + activeAssignmentId) → lib delegation. Hand-rolled validation, UUID format checks, lib error → HTTP status mapping table.
- `app/api/prep/_helpers.ts` (81 lines) — `mapPrepError(err: PrepError): NextResponse`.
- 422 for `prep_auto_complete_failed` semantic ("syntactically valid, precondition not met"); 409 for concurrent confirm; 403 for role + location violations; 400 for shape errors.

### Components phase

#### Part 1 (commit 04c2390) — read-only structural skeleton

- `components/prep/types.ts` — `RawPrepInputs` (numeric fields as strings during typing).
- `components/prep/PrepNumericCell.tsx` — shared numeric input primitive (`type="text" + inputMode="decimal"`, no spinner, tabular-nums, mobile-first sizing).
- `components/prep/PrepRow.tsx` — generic row primitive: label + read-only PAR cell + N input cells via CSS grid.
- `components/prep/PrepSection.tsx` — generic section wrapper: Mustard-deep accent header + column header strip + empty-state branch.
- `components/prep/sections/{Veg,Cooks,Sides,Sauces,Slicing,Misc}Section.tsx` — six section components with per-section column shapes.
- `components/prep/AmPrepForm.tsx` (Part 1 stub) — section grouping by `prepMeta.section`, mounts 6 sections in canonical order.
- 64 new translation keys across en + es (`am_prep.column.*`, `am_prep.row.*`, `am_prep.misc.*`, `am_prep.section.*`).

#### Part 2 (commit 83136fb) + follow-up (commit e8432f0) — interactive logic

- AmPrepForm full rewrite (470 lines): state ownership, dirty tracking via stableStringify comparison, validation (numeric parse + negative blocking + at-least-one-changed gate), submit handler invoking POST /api/prep/submit, success/read-only/error banners, discard-changes affordance, per-row + form-level error UI.
- 24 new translation keys (`am_prep.submit.*`, `am_prep.banner.*`, `am_prep.error.*`).
- Follow-up: language-aware time format, dead-key cleanup, defensive status-check comment, AGENTS.md "Language-aware time/date formatting" durable lesson.

### Page (commit c80d1d1)

- `app/(authed)/operations/am-prep/page.tsx` (244 lines) — Server Component. Auth → location validation → authorization gate (`AM_PREP_BASE_LEVEL` OR active assignment) → `loadAmPrepState` → `initialValues` derivation → AmPrepForm mount. Single file (no client wrapper). NoTemplateView empty state.
- 6 new translation keys (`am_prep.page.*`, `am_prep.no_template.*`).

### Dashboard tile (commit 4506c4c)

- `lib/prep.ts loadAmPrepDashboardState` — slim shape loader (template existence + today's instance + confirmedBy name + assignment with assignerName + isVisibleToActor predicate). Sub-KH+ assignment query short-circuits via `actor.level >= AM_PREP_BASE_LEVEL` gate.
- `app/(authed)/dashboard/page.tsx` — `ReportsSection` + `AmPrepTile` components. Three visual states matching today's instance status (not started / in progress / submitted), always-tappable, separate italic line for assignment indicator (assignerName + optional note). Reports section renders only when at least one tile visible.
- 13 new translation keys (`dashboard.reports.heading`, `dashboard.am_prep.*`).

### Closing-client report-reference rendering (commit 675e0a8 — most recent)

- `components/ReportReferenceItem.tsx` (NEW, 196 lines) — three-state component: live auto-complete (Brand Green check + inline attribution), empty pending tappable (navigate to /operations/am-prep), empty pending read-only.
- `closing-client.tsx` StationGroup branch on `templateItem.reportReferenceType` — single conditional. New `locationId` prop threaded through.
- `formatTime` lift in closing-client: was hardcoded `"en-US"`, now language-aware. Fixed a real Spanish-UX bug (Spanish users always saw English-format times in post-confirm banner).
- 5 new translation keys (`closing.report_ref.*`).
- AGENTS.md "Duplication watch" sub-paragraph updated: closing-client no longer the outlier; all 5 sites now language-aware; 5-site threshold hit, lift to `lib/i18n/format.ts` flagged for next pickup.

---

## 5. What's left

### Seed scripts

#### `scripts/seed-am-prep-template.ts` — Standard AM Prep v1

5 numeric sections + 1 Misc section, identical at MEP and EM. Convergent re-run pattern (per existing `seed-closing-template.ts`). Writes via `lib/prep.ts seedPrepItem` helper which guarantees `station` and `prep_meta.section` stay in sync per C.38 discipline.

**Item-level structure (Image 1 source):**

- **Veg** — columns `[par, on_hand, back_up, total]`:
  - Iceberg, par 7 min, unit "min" (or interpret as 7 minutes prep time? — verify with Juan in next session)
  - Onion, par 8, unit "QT"
  - Basil, par 3, unit "QT"
  - Radish, par 1, unit "QT"
  - Cucumber, par 3, unit "QT"
  - Tomato, par null, special_instruction "Prep Daily"

- **Cooks** — columns `[par, on_hand, total]`:
  - Vodka, par 4, unit "QT"
  - Marinara, par 6, unit "QT"
  - Compound Butter, par 2, unit "LOGS"
  - Caramelized onion, par 2, unit "QT"
  - Jus, par 4, unit "QT"

- **Sides** — columns `[par, portioned, back_up, total]`:
  - Tuna Salad, par 15
  - Egg Salad, par 12
  - Onion Dip, par 12
  - Chix Salad, par 12
  - Antipasto Pasta, par 12
  - Cannoli Cream, par 0.5, unit "BAG"

- **Sauces** — columns `[par, line, back_up, total]`:
  - Aioli, par 15, unit "BTL"
  - HC Aioli, par 4, unit "BTL"
  - HP Mayo, par 4, unit "BTL"
  - Mustard Aioli, par 4, unit "BTL"
  - Horsey Mayo, par 4, unit "BTL"
  - Salsa Verde, par 1, unit "BTL"
  - Dukes, par 3, unit "BTL"
  - Vin, par 6, unit "BTL"

- **Slicing** — columns `[par, line, back_up, total]`:
  - Turkey, par 5, unit "1/3 pan" (or interpret as 5 portions of 1/3 pan — verify)
  - Ham, par 15
  - Capicola, par 15
  - Pepperoni, par 12
  - Genoa, par 25
  - Provolone, par 25
  - Mortadella, par 4
  - Roast Beef, par 2, unit "1/3 pan"
  - Cheddar, par 6

- **Misc** — Y/N flags + free text:
  - Meatball mix - ready? (yes_no)
  - Meatballs - ready to cook? (yes_no)
  - Meatballs - for reheat? (yes_no)
  - Cook Bacon? (yes_no + free_text)
  - Free-form notes (free_text only — no Y/N; treated as a notes sink for the section)

**Item-level Spanish translations** populated via `translations` JSONB on each row. Section names mapped via `STATION_ES` (Veg → Verduras, Cooks → Cocidos, etc.) — already in `am_prep.section.*` i18n keys but the seed should populate the per-item `translations.es.station` so the page resolver picks them up via `resolveTemplateItemContent` per C.38.

**Min role level**: 3 (KH+ post-C.41) per the convention.

**Required**: true for all items (per current Image 1 — every line is operationally relevant).

**Audit metadata** (CRITICAL — update marker comment + strings before running per AGENTS.md "Audit metadata context attribution in seed scripts" lesson):
- `phase`: "3_module_1_build_2_pr_1"
- `reason`: "Standard AM Prep v1 — initial seed"

#### `scripts/seed-standard-closing-v2.ts` — Closing v2 with AM Prep report-reference swap

**Path A versioning per C.19:** do NOT edit Standard Closing v1. Create Standard Closing v2 in parallel; v1 stays active for old instances; v2 active for new instances. Both can be active simultaneously (closing-page resolver picks the most-recent-active by `created_at DESC`).

**Item swap:** v1's "Fill out AM Prep List" cleaning placeholder in the Closing Manager station → v2's `report_reference_type='am_prep'` item with:
- Same label "AM Prep List"
- `required: true`
- `min_role_level: 3`
- `report_reference_type: 'am_prep'`
- `prep_meta: null` (this is a report-reference, not a prep item)
- Translation: `translations.es.label = "Lista de Prep AM"`, `translations.es.station = "Gerente de cierre"` (matches existing v1 station translation)

**All other v1 items** copy unchanged into v2 — same labels, stations, min_role_level, required flags, translations. Use the existing `ITEMS` array from `scripts/seed-closing-template.ts` as the source.

**Audit metadata** (update strings before running):
- `phase`: "3_module_1_build_2_pr_1"
- `reason`: "Standard Closing v2 — AM Prep report-reference swap per C.42"

After v2 seeds successfully + v2 instances start being created on new closings, a future cleanup commit (out of scope for PR 1) can flip v1 to `active: false` once all open v1 instances have been confirmed.

### Production seed runs + verification

Both seeds run against production via `npx tsx --env-file=.env.local scripts/<script-name>.ts`. After each run, verify via Supabase MCP:
- AM Prep template: 32 items × 2 locations = 64 rows with `prep_meta` populated, `station` matching `prep_meta.section`, `min_role_level = 3`, `required = true`
- Standard Closing v2: 50 items × 2 locations = 100 rows; the AM Prep report-reference item has `report_reference_type = 'am_prep'`, all other items match v1
- Audit rows: one `checklist_template.create` per location per template (4 total) with the correct `phase` + `reason` metadata

### Final integration commit

After both seeds land cleanly: small commit that updates AGENTS.md / SPEC_AMENDMENTS.md if any new architectural decisions surfaced during seeding, plus any cleanup (lift `formatTime` to `lib/i18n/format.ts` per the AGENTS.md threshold note? Or defer to a follow-up). Then PR open.

### PR open + CI gate + smoke test

- Open PR via `gh pr create` against `main`
- CI build gate runs (already proven green on every push)
- Smoke test against `co-ops-ashy.vercel.app` preview deployment:
  - Dashboard renders with AM Prep tile (Juan as cgs/level 8 has base access — tile visible)
  - Tap AM Prep tile → /operations/am-prep page loads
  - Form renders with all 6 sections, mobile + desktop layouts work
  - Submit AM Prep → success banner + read-only flip
  - Navigate to /operations/closing → closing checklist now shows the auto-completed report-reference item with Brand Green check + attribution "Submitted by Juan at {time}"
  - Reload page → read-only banner persists
  - Spanish toggle: time format uses es-US per C.31 + AGENTS.md canonical pattern
- Squash-merge once smoke + CI both green

---

## 6. Production identifiers

| Resource | Value |
|---|---|
| Repo | `https://github.com/Juan-CO-dev/co-ops` |
| Production URL | `https://co-ops-ashy.vercel.app` |
| Supabase project ref | `bgcvurheqzylyfehqgzh` |
| MEP location id | `54ce1029-400e-4a92-9c2b-0ccb3b031f0a` |
| EM location id | `d2cced11-b167-49fa-bab6-86ec9bf4ff09` |
| Standard Closing v1 template at MEP | `764eba7a-975d-4a53-b386-952a15cb2d9e` |
| Standard Closing v1 template at EM | `b67c9fda-ee22-48f7-9bf5-01054e6ecf6d` |
| Juan (cgs, level 8) | `16329556-900e-4cbb-b6e0-1829c6f4a6ed` |
| Pete (owner, level 7) | `73ac4b61-ff87-4db6-b338-9098dfe3f295` |
| Cristian (moo, level 6.5) | `0d467b64-6865-461b-b4fd-f3a17c3a056f` |
| C.41 corrective audit row | `66bd6c5a-7191-4918-b9bf-ea7df4993e15` |
| Stale-metadata seed-rerun audit rows | MEP `593b2a38-d0c6-476d-bc49-748fc691da65`, EM `8611e98f-7aca-467a-ab2a-97bff21a7359` |

The Standard AM Prep v1 template IDs and Standard Closing v2 template IDs will be generated by the seeds; capture them in the seed script's stdout output (matches `seed-closing-template.ts` convention) and reference in the eventual squash-merge commit body.

---

## 7. Working rhythm to preserve

This branch was built with the same rhythm Build #1 + Build #1.5 established. Future-Claude should preserve it:

1. **Surface architectural decisions before code.** Alternatives + recommendation pattern. Lock decisions with Juan, then implement. The schema migration phase, lib phase, components Part 1/2 split, page, dashboard tile, and closing-client all followed this; rework was minimal because decisions locked clean before code.
2. **Surface code before commit.** Review gate at end of implementation, not after merge. Catches issues before they enter git history. Independent calls Claude makes during writing get explicitly flagged with rationale; Juan accepts or pushes back.
3. **Single commit per phase through CI gate.** Small, focused, reviewable. No bundling. The branch's 10 WIP commits each correspond to one coherent unit; squash-merge consolidates at PR-merge time.
4. **Capture amendments in `docs/SPEC_AMENDMENTS.md`** when reality diverges from spec. Build #2 PR 1 added C.45 (capabilities-as-tags); updated C.18, C.19, C.20, C.41 with sub-findings.
5. **Translate-from-day-one (C.37).** Every new UI string ships with EN + ES keys in the same PR. No deferred translation.
6. **System-key vs display-string discipline (C.38).** Business keys English source-of-truth; translation only at render. The `prepMeta.section` ↔ `station` invariant + `narrowPrepTemplateItem`'s strict-throw-on-drift implements this for prep items.
7. **Three-layer audit pattern (lib + RLS + UI)** for any role-level changes. Grep sweep before declaring complete. The C.41 reconciliation commit caught a UI gate site that the initial cleanup missed; AGENTS.md durable lesson now documents this.
8. **Audit-the-audit pattern (`audit.metadata_correction`)** for stale audit metadata corrections. Append-only philosophy forbids UPDATE on audit_log; corrective rows are the only path. The seed-script marker-comment convention prevents this from recurring.

---

## 8. Pickup paths for next session

### Path A (lean) — read this handoff, ship the seed scripts + integration

1. Read this handoff doc end-to-end
2. Read `docs/SPEC_AMENDMENTS.md` C.18, C.19, C.42, C.44 sections (the prep-architecture surface)
3. Open `scripts/seed-closing-template.ts` to study the convergent-seed + audit-emission pattern
4. Open `lib/prep.ts seedPrepItem` to study the write-helper that guarantees C.38 invariant
5. Write `scripts/seed-am-prep-template.ts` and surface for Juan's review before running against production
6. Write `scripts/seed-standard-closing-v2.ts` and surface for review
7. Run both seeds against production with audit-row spot-check after each
8. Verify the end-to-end flow via smoke test (dashboard tile → page form → submit → closing auto-complete)
9. Open PR; squash-merge after CI + smoke green

### Path B — alternative approach Juan wants to take

Surface the alternative if Juan opens the session with a different direction. Examples:
- Defer Standard Closing v2 to a separate follow-up PR (ship AM Prep without the auto-complete wiring; the `report_reference_type` rendering path stays dormant until v2 seeds)
- Add a smoke-test harness script before opening PR (similar pattern to `scripts/phase-2-audit-harness.ts`)
- Lift `formatTime` to `lib/i18n/format.ts` as the first commit of the next session (per the AGENTS.md threshold note — currently hits the 5-site lift trigger)

---

## 9. Files worth opening early in the next session

In suggested order:

1. **This handoff doc** — `docs/PHASE_3_BUILD_2_PR_1_WIP_HANDOFF.md`
2. `docs/SPEC_AMENDMENTS.md` — full read; especially C.18, C.19, C.41 (sub-finding + fix paragraph), C.42, C.44, C.45
3. `AGENTS.md` — full read; especially the durable lessons added during this PR ("Audit metadata context attribution in seed scripts", "Role-level gate audits must include UI-side gates", "Language-aware time/date formatting is the canonical pattern")
4. `scripts/seed-closing-template.ts` — study the convergent-seed + translations + audit-emission pattern; both new seed scripts inherit it
5. `lib/prep.ts` — study `seedPrepItem`, `setPrepItemSection`, `narrowPrepTemplateItem`, `submitAmPrep` (the lib's contract)
6. `components/prep/AmPrepForm.tsx` — current form behavior; useful to understand what the AM Prep template's items will render as
7. `app/(authed)/operations/closing/closing-client.tsx` — StationGroup branch on `reportReferenceType`; useful to understand what Standard Closing v2's swap will activate
8. `app/(authed)/dashboard/page.tsx` — AmPrepTile rendering; useful to understand how the tile drives users into the new flow

---

## 10. The unwritten contract (preserved from Build #1 handoff)

Build #2 PR 1 shipped 10 commits clean because Juan's operational wisdom met clean software architecture at the right cadence. Future sessions should preserve that cadence:

- Surface decisions before code
- Push back on bad assumptions in real time
- Capture amendments when reality diverges from spec
- Ship through the CI gate
- No shortcuts

The system gets better when this contract holds. Don't break it under deadline pressure or perceived shortcuts — the savings are illusory and the cost compounds. Slow is smooth, smooth is fast.

---

*End of WIP handoff. Build #2 PR 1's components + lib + API + page + dashboard + closing-client integration are shipped to the WIP branch; seed scripts + production seed runs + final integration + PR open close out the PR.*
