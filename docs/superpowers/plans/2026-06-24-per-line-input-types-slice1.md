# Per-line input types + section questions (Slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Each subagent re-reads its target files' current state before writing (confirm-before-authoring).

**Goal:** Make prep sections render lines of mixed input types (numeric / Yes-No / free-text), and let MoO+ add a non-inventory **section question** (global, propagates to every prep list with that section).

**Spec:** `docs/superpowers/specs/2026-06-24-per-line-input-types-questions-slice1-design.md`

**Ships as TWO PRs (operator-flow safety):**
- **PR A (foundation, this branch `claude/per-line-input-types-slice1`):** per-line input type + mixed-section render. **No migration.** Parity-gated — the existing 6 sections render byte-identically (the refactor is a no-op until questions exist). Tasks 1–4.
- **PR B (capability, new branch off updated main after A merges):** `section_questions` table + propagation + admin UI. Tasks 5–9.

The PR boundary is after Task 4's parity gate. Rebase off updated main before starting PR B (AGENTS.md squash-merge-between-PRs lesson).

**Tech:** Next 16, React 19, TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens. No test framework → `npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit). Migration (PR B) via Supabase MCP + captured as `supabase/migrations/0087_*.sql`.

---

## PR A — render foundation (no migration)

### Task 1: `shapeFromColumns` + `free_text` line type

**Files:** Modify `lib/prep-sections.ts`, `lib/types.ts`.

- [ ] **Step 1:** In `lib/types.ts`, add a `LineInputType` type: `export type LineInputType = "on_hand" | "portioned" | "line" | "yes_no" | "free_text";` (the section `PrepSectionShape` four + `free_text` for pure-text questions).
- [ ] **Step 2:** In `lib/prep-sections.ts`, extend `shapeToColumns` to accept `free_text` → `["free_text"]` (change its param type to `LineInputType`; `yes_no` keeps the includeNote branch). Add the inverse:

```ts
/** A line's input type, derived from its prep_meta.columns (the per-line source
 *  of truth). Inverse of shapeToColumns. */
export function shapeFromColumns(columns: PrepColumn[]): LineInputType {
  if (columns.includes("on_hand")) return "on_hand";
  if (columns.includes("portioned")) return "portioned";
  if (columns.includes("line")) return "line";
  if (columns.includes("yes_no")) return "yes_no";
  return "free_text"; // ["free_text"] or empty → text-only
}
```
- [ ] **Step 3:** `npx tsc --noEmit` clean. Commit.

### Task 2: `MixedPrepSection` component

**Files:** Create `components/prep/sections/MixedPrepSection.tsx`. Re-read `GenericPrepSection.tsx`, `MiscSection.tsx`, `PrepRow.tsx`, `PrepSection.tsx` first.

- [ ] **Step 1:** Build `MixedPrepSection` — same props as `GenericPrepSection` minus the single `shape`/`columns` (it renders heterogeneous lines). For each line, `shapeFromColumns(line.prep_meta.columns)` picks the control:
  - numeric (`on_hand`/`portioned`/`line`) → a `PrepRow` with that line's own columns (inputColumns + autoCalcTotal derived from the line's columns).
  - `yes_no` → the Misc-style toggle (+ free_text note if the line's columns include it).
  - `free_text` → a text box.
  Wrap in `<PrepSection>` with NO shared column headers (`columnHeaders={[]}`), each row self-describing. Reuse the control sub-pieces from `MiscSection`/`PrepRow` (extract shared bits if cleaner; don't duplicate logic).
- [ ] **Step 2:** `npx tsc --noEmit` clean. Commit.

### Task 3: `AmPrepForm` uniform-vs-mixed dispatch

**Files:** Modify `components/prep/AmPrepForm.tsx`. Re-read its current section-render map first.

- [ ] **Step 1:** Per section, decide homogeneity: a section is **uniform** if every active line's `shapeFromColumns(columns)` equals the section's shape AND is numeric (or the section is `yes_no` and all lines are yes_no) — i.e., today's case. Dispatch: uniform numeric → `GenericPrepSection` (unchanged); uniform `yes_no` → `MiscSection` (unchanged); else → `MixedPrepSection`. Keep `computeTotal`/validation shape lookups per-line (already shape-driven from #88 — switch the lookup key from section shape to the line's own `shapeFromColumns`).
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run build` clean. Commit.

### Task 4: PR-A parity gate

- [ ] **Step 1:** Re-run `scripts/check-prep-section-shape-parity.ts` → 0 mismatches.
- [ ] **Step 2:** Throwaway smoke (`scripts/_smoke_mixed_render.ts`, deleted after): construct an in-memory section with a numeric + a yes_no + a free_text line; assert the dispatch picks `MixedPrepSection` and each line maps to the right control via `shapeFromColumns`. Assert the 6 real sections all dispatch to their current renderer (uniform). Delete the script.
- [ ] **Step 3:** Open PR A. Body: parity proven; the refactor is a no-op for the live 6 (mixed render activates only once section questions exist in PR B). Juan smokes AM-prep renders identically. **Merge gate before PR B.**

---

## PR B — section questions (branch off updated main after A merges)

### Task 5: Migration 0087 — `section_questions` + `section_question_id`

**Files:** Apply via MCP (controller); capture `supabase/migrations/0087_section_questions.sql`.

- [ ] **Step 1 (controller):** Apply:
```sql
create table public.section_questions (
  id uuid primary key default gen_random_uuid(),
  section_slug text not null references public.prep_sections(slug),
  label text not null,
  label_es text null,
  input_type text not null check (input_type in ('on_hand','portioned','line','yes_no','free_text')),
  include_note boolean not null default false,
  min_role_level integer null,
  required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
alter table public.section_questions enable row level security;
create policy section_questions_no_user_select on public.section_questions for select using (false);
create policy section_questions_no_user_insert on public.section_questions for insert with check (false);
create policy section_questions_no_user_update on public.section_questions for update using (false) with check (false);
create policy section_questions_no_user_delete on public.section_questions for delete using (false);

alter table public.checklist_template_items add column section_question_id uuid null references public.section_questions(id);
create index cti_section_question on public.checklist_template_items (section_question_id) where section_question_id is not null;
```
- [ ] **Step 2:** Capture the migration file with the going-forward header. Commit.

### Task 6: `addSectionQuestion` + propagation + disable

**Files:** Modify `lib/admin/templates.ts`, `lib/destructive-actions.ts`. Re-read `propagateDefaultItem` + `ensureItemLineOnTemplate` + `seedPrepItem` + `listPrepTemplates` first.

- [ ] **Step 1:** Add audit actions `section_question.create`, `section_question.disable` to `lib/destructive-actions.ts`.
- [ ] **Step 2:** `addSectionQuestion(actor, { sectionSlug, label, labelEs, inputType, includeNote, minRoleLevel, required })`: validate section exists + input_type; insert the `section_questions` row; then **propagate** — for every active location, for every active prep template (am_prep + mid_day) that runs that section, insert a question line (item_id NULL, section_question_id = the question, `columns = shapeToColumns(inputType, includeNote)`, parValue/parUnit NULL, station = sectionSlug, label/translations/min-role/required from the question), idempotent on `(template_id, section_question_id, active)`. Mirror `ensureItemLineOnTemplate`'s insert shape but with item_id NULL + section_question_id set + NO item/par rows + NO opening mirror. Audit `section_question.create` with the propagated line ids.
- [ ] **Step 3:** `disableSectionQuestion(actor, { questionId })`: deactivate the `section_questions` row + deactivate all its propagated lines (`section_question_id = questionId`, append-only). Audit `section_question.disable` with the deactivated line ids.
- [ ] **Step 4:** `loadChecklistAdminView` (or a sibling loader) returns active `section_questions` for the Global-tab UI.
- [ ] **Step 5:** `npx tsc --noEmit` clean. Commit.

### Task 7: Routes

**Files:** Create `app/api/admin/checklist-templates/section-questions/route.ts` (POST add) + `.../section-questions/[id]/route.ts` (DELETE disable). Mirror the existing `sections/[slug]` gate exactly: requireSession → `level < 8 → 403` → `assertStepUp("B")` → `AdminTemplateError` mapping.

- [ ] **Step 1:** POST add (body: sectionSlug, label, labelEs, inputType, includeNote, minRoleLevel, required). DELETE disable (id param).
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run build` clean. Commit.

### Task 8: Global-tab "Add question" UI + i18n

**Files:** Modify `components/admin/templates/GlobalRegistryTab.tsx`, `shared.ts`, `lib/i18n/{en,es}.json`. Re-read the Sections panel first.

- [ ] **Step 1:** A `SectionQuestions` panel/affordance on the Global tab (MoO+): list active questions (section + label + input type) with a disable control (confirm: "removes this question from every list with that section"); an Add form — section picker, label EN/ES, input-type picker (Yes-No [+note] · Free text · numeric), min-role (position dropdown), required. POST/DELETE via the routes; `router.refresh()`.
- [ ] **Step 2:** Register new error codes in `shared.ts` (`invalid_input_type`, etc.); add EN+ES i18n (tú-form). 
- [ ] **Step 3:** `npx tsc --noEmit` + `npm run build` clean. Commit.

### Task 9: Edit-once smoke + final gate

- [ ] **Step 1:** Throwaway smoke: `addSectionQuestion` on a section → assert a question line appears on every active prep list with that section (am_prep + mid_day, both locations), item_id NULL + section_question_id set + correct columns; answerable; `disableSectionQuestion` deactivates the question + all its lines. Clean up (deactivate/delete throwaway). Delete the script.
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run build` clean. Re-run parity check (0 mismatches).
- [ ] **Step 3:** Open PR B. Body includes preview URL: add a question to a section, see it on every list with that section, answer it, see it on the report; disable removes it everywhere.

---

## Self-review notes (controller)

- **Spec coverage:** per-line type (T1) + mixed render (T2/T3) + parity (T4) = PR A; section_questions table (T5) + propagate/disable (T6) + routes (T7) + UI/i18n (T8) + smoke (T9) = PR B.
- **Risk:** PR A is operator-flow but parity-gated + no-op for the 6. PR B adds the capability; propagation reuses the proven default-item pattern.
- **Confirm-before-authoring:** every render/propagation task re-reads its targets first (called out per task).
- **Out of scope (later slices):** item-attached questions + item Opening-verify toggle (Slice 2); searchable questions (Slice 3); question verification in Opening (future).
