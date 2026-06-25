# Searchable question answers — Slice 3 Design (arc-final)

**Date:** 2026-06-25
**Arc:** Item/Inventory Spine — per-line input types + non-inventory Q&A (Slice 3 of 3, the last)
**Depends on:** Slices 1 + 2 shipped (#89/#90/#91/#92). Branches off updated main.
**Status:** draft, pending review

---

## Goal

Make question (and Misc) **answers** visible on the report drill-in and searchable in the Reports Hub. Today the question *label* is already searchable (it's a normal line label, indexed as an "item" corpus field), but yes/no + free-text **answers** are neither shown on the report nor indexed.

## Why it's two coupled halves (not just "extend buildSearchCorpus")

The search corpus has a hard safety contract: *never index a field the viewer can't see on the drill-in.* Ground truth: the report drill-in's `PrepValueRow` surfaces only `label / par / onHand / total` — yes/no + free-text answers are **not displayed**. So indexing answers without first surfacing them would breach the contract. Slice 3 therefore:

1. **Surfaces** yes/no + free-text answers on the report drill-in (a "Checks" area), then
2. **Indexes** them in `buildSearchCorpus`.

The answer data already lives in `prep_data.inputs` (`yesNo` / `freeText`) — nothing reads it onto reports yet. Same "make the stored data load-bearing on the consumer" shape as #88's render cutover.

## Decisions (Juan-locked)

- **Scope:** ALL yes/no + free-text answers — the new section/item questions AND the existing Misc items ("Meatball mix - ready? = Yes", "Cook Bacon? = Yes + note"). Consistent treatment; Misc answers stop being invisible/unsearchable.
- **Tier:** ALL answers visible to every report viewer (same as par/on-hand line data). Free-text answers are NOT extra-gated (unlike operator *notes*, which stay L5+). Simplest + uniform.

## Architecture

### A. Report drill-in shows answers (`lib/reports-hub.ts`)
The prep-value builder (where `PrepValueRow` is assembled from completions, ~line 1144) currently pushes only numeric lines (those whose `prep_data.inputs` carry `onHand`/`total`). Add a parallel **checks** extraction: for a completion whose `isPrepData(prep_data)` and whose `inputs` carry `yesNo` and/or `freeText`, build a check row.

```ts
interface ChecklistCheckRow {  // NEW
  label: string;
  yesNo: boolean | null;    // null when the line has no yes/no (free-text-only)
  freeText: string | null;  // the note / text answer, when present
}
```
- `ChecklistReportDetail` gains `checks: ChecklistCheckRow[]` (alongside `prepValues`).
- A line is a **check** when `inputs.yesNo !== undefined || inputs.freeText !== undefined`; a **prep value** when it carries numeric inputs (today's path). (A yes_no+note line is a single check row carrying both.)
- No tier gate (all report viewers), per the locked decision.

### B. Report drill-in UI renders the Checks area
The report detail component (the consumer of `ChecklistReportDetail.prepValues`) gains a **"Checks"** section rendering each check row: label + answer (Yes / No via `am_prep.misc.yes`/`.no`; free-text shown as the note). Renders only when `checks.length > 0`. Re-read the component at build time to match its styling (confirm-before-authoring).

### C. Search corpus indexes answers (`lib/reports-search.ts`)
In `buildSearchCorpus`, the checklist completions query (~line 154) currently selects `instance_id, completed_by, notes`. Add `template_item_id, prep_data`. For each completion carrying a yes/no or free-text answer, push an **answer** corpus field:
- text = the human answer for matching: the line label + the answer (e.g. `"Walk-in light out? Yes"`, or `"Cook Bacon? Yes — <free text>"`). Combining label+answer keeps a label-only search still matching AND gives the answer as snippet context.
- New `fieldKey: "answer"` on `SearchCorpusField` + a snippet label `reports.search.snippet_field.answer`.
- **All viewers** (no `showNotes` gate) — matches the drill-in visibility decision. The label→item field is already pushed (line 149); the new field adds the answer.
- Bind to the same `authorizedInstanceIds` set already enforced for completer/notes (no new disclosure surface).

### D. i18n
- Report UI: a `reports.detail.checks_heading` ("Checks" / "Chequeos" or similar), reuse `am_prep.misc.yes`/`.no`.
- `reports.search.snippet_field.answer` ("Answer" / "Respuesta").
- EN + ES parity.

### No migration
All answer data is already in `prep_data`; `section_question_id`/`item_question_id` already exist. Slice 3 is pure read-path (detail loader + UI + corpus). **No migration.**

## Testing
`npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit):
- Detail loader: a completed report with a yes/no answer + a free-text answer → `checks` carries them with correct label/yesNo/freeText; numeric lines still in `prepValues` (unchanged).
- Corpus: a report with a question answer → `buildSearchCorpus` includes an `answer` field containing the label+answer; a search for the answer text matches the report (snippet returned); a viewer below L5 still matches (answers are all-viewer, unlike notes).
- Render parity for numeric lines unchanged.
Operator smoke (Juan, preview): open a report with answered questions → see the Checks area; search the Reports Hub for an answer → the report surfaces.

## Open decisions (your review)
- **D1 — combined vs answer-only index text.** *Recommend:* index `"<label> <answer>"` (combined) so the answer carries question context in the snippet + a label search still hits. (Answer-only "Yes" would be noisy + context-free.) Flag if you'd rather index the bare answer.
- **D2 — numeric question answers.** A `free_text`/`yes_no` question is a "check"; a *numeric* question (on_hand/portioned/line input type with no par) currently flows through `prepValues` as a numeric row (par = null). *Recommend:* leave numeric question answers in `prepValues` (they already show as numbers) — the Checks area is for yes/no + free-text only. Confirm.

## Out of scope
- Postgres full-text search (the corpus stays the substring matcher).
- Re-tiering existing fields (notes stay L5+, etc.).
- This is the LAST slice of the per-line/Q&A arc; on merge the arc is complete and the spine resumes (vendors/SKU → ordering → …).
