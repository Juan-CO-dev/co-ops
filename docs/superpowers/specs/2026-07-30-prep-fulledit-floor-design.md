# Prep Full-Edit Floor — design (PR-1 of the checklist full-edit arc)

> Council-derived: `.claude/council/2026-07-30-checklist-fulledit/report.md` (6/6 seats).
> Owner mandate (2026-07-30): "the checklist and reports template needs to be able to
> FULLY EDIT, ADD AND REMOVE ANYTHING AND EVERYTHING from those checklists and reports."
> Prep evolves IN PLACE (unanimous council ruling — prep never gets publish-versioning).
> NO MIGRATION: every edit lands on existing storage (label, translations JSONB,
> prep_meta JSONB, display_order, section_questions).

## The problem

After hotfix #214 the questions RENDER again, but they are still not EDITABLE:

- Label edits exist only as registry writes (`/definition` route, ≥8): editing a linked
  question line's "label" renames the ITEM ("Meatballs"), not the question — the write
  path has the mirror-image of the read bug #214 fixed. Unlinked lines get a 409.
- `LocationChecklistTab` has NO per-line edit drawer — ParGrid + disable only. No UI
  for description, special instruction, translations, reorder, input type, or unlink.
- Section questions are add + disable only (no `updateSectionQuestion` exists).
- A line linked to a deactivated item still renders the dead registry name.
- Closing auto-complete machinery means an empty AM prep is invisible — no surface
  ever says "the opener saved nothing today."

## The write-side label law (mirrors the shipped read law)

`resolveLineDefinition` (read, #214): question-shaped or unlinked → line's own label;
else registry item name. This spec adds the WRITE half, enforced in
`updatePrepItemContent` and the `/definition` path:

| Line | label / labelEs edit writes |
|---|---|
| question-shaped (columns ∋ yes_no \| free_text), linked or not | LINE: `label` + `translations.es.label` — the question is edited in place; the item link is untouched |
| inventory-shaped, linked | REGISTRY: `items.name` / `name_es` (edit-once-everywhere, unchanged) |
| inventory-shaped, unlinked | LINE: `label` + `translations.es.label` (replaces today's 409 — blocking a label edit never fixed linkage; the Doctor flags needs-link separately) |

The shape test routes through the single `isQuestionShapedColumns` predicate (#214 C1).

## Scope — six cuts, one PR

### A. Write-law core (`lib/admin/templates.ts`)
Extend `updatePrepItemContent`: when the line is question-shaped OR unlinked, `label`
→ line `label` column, `labelEs` → `mergeEsTranslation` (extend its patch shape with
`label`). Registry write only for linked inventory lines. `parValue`/`parUnit` on a
question-shaped line: reject with 400 `question_line_has_no_par` (questions carry no
par; ParGrid is hidden for them in the UI). Audit before/after unchanged.

### B. Per-line edit drawer (`LocationChecklistTab`)
Each line row gains an Edit affordance opening an inline drawer (same expand pattern
as ParGrid, Tier A, ≥7 for content per the existing route gates):
- label/question (en + es) — the law above decides where it lands
- description (en + es), special instruction (en + es)
- reorder: up/down buttons swapping `displayOrder` with the adjacent line in the same
  section (two PATCHes through the existing `displayOrder` field; no new API)
- unlink (Tier B, ≥7): sets `item_id = null` — display falls to line label by the
  read law; par overrides orphan harmlessly (ParGrid hides when unlinked)
- input type (Tier B, ≥7): deliberate conversion — see C
Question-shaped lines hide the par column display; inventory lines keep ParGrid.

### C. Per-line input-type toggle (deliberate conversion)
New PATCH `/[id]/items/[itemId]/input-type` (≥7, Tier B) → new
`setPrepItemInputType`: body `{ inputType: "yes_no" | "free_text" | "numeric" }`.
- yes_no → columns `["yes_no"]` (+ keep `free_text` if currently held)
- free_text → columns `["free_text"]`
- numeric → columns = `shapeToColumns(sectionDef.shape === "yes_no" ? "on_hand" :
  sectionDef.shape, keepNote)` — a numeric line in a yes_no-shaped section (Misc)
  gets the on_hand column set; MixedPrepSection renders per-line (verified by the
  #214 adversarial review: `isUniform` goes false and every line renders its own
  shape sanely).
The INPUT-TYPE FREEZE (#214) blocks *implicit* conversion only; this route is the
*explicit* one. Converting inventory→question prefills the line label with the
current resolved display name so the question never starts blank. Mirror rows
(openingPhase2) are rejected 400 (`mirror_rows_sealed`).

### D. Section-question edit-in-place (`SectionsTab`)
New `updateSectionQuestion` + PATCH `/section-questions/{id}` (≥8, Tier B):
`{ label?, labelEs?, minRoleLevel?, required?, inputType?, includeNote? }`. Writes
the `section_questions` row in place (prep live-edit law), then re-propagates to its
active lines (by `section_question_id`): label/labelEs → line label/translations,
required/minRole → line columns, inputType/includeNote → line `prep_meta.columns`
re-derived from the QUESTION's own input type (this is deliberate — the freeze
protects against section-shape side effects, not question edits). Same treatment for
item questions: `updateItemQuestion` + PATCH `/item-questions/{id}`, propagating by
`item_question_id`. SectionsTab question rows gain an edit affordance beside disable.

### E. Deactivated-item fallback (`lib/items.ts`)
`ItemDefn` gains `active: boolean`; `loadItemDefns` selects it; `resolveLineDefinition`
treats a linked-but-inactive item as absent (falls to line label/prep_meta — the
existing no-item branch, minus the console.warn noise for this case). Test-pinned.

### F. AM-prep gap signal (closing confirmation)
On the closing page load (server side), when the operational day's AM-prep instance
exists with ZERO submitted completions, pass an advisory flag; closing-client renders
a dismissable warning pill near the finalize affordance: "AM Prep had 0 items saved
today — check with the opener." Advisory only; never blocks finalize (council: no
hard gate on AM prep). No schema — a count query on the existing instance.

## Explicitly OUT (deferred per council)
- Closing/opening input-type authoring (PR-2, own spec — the honest-answer-storage
  decision lives there).
- Read-only prep view in the builder + Doctor drift checks (PR-3/4).
- Separate `question` field (v2 trigger: a par+question hybrid line materializes).
- Prep publish-versioning (never, per unanimous ruling).
- Batch drag-reorder (up/down suffices at prep's line counts).

## Testing
- Write-law unit pins (new `tests/admin-prep-content-law.test.ts`): question-shaped
  linked → line write shape; inventory linked → registry write shape; unlinked →
  line write; par-on-question → 400. (Pure decision helper extracted so the law is
  testable without a DB — `resolvePrepLabelWriteTarget(line): "line" | "item"`.)
- Input-type derivation pins: each conversion's resulting columns, mirror rejection.
- resolveLineDefinition inactive-item pin (extends `items-line-definition.test.ts`).
- Gauntlet: full suite + tsc + build + adversarial review before PR.
