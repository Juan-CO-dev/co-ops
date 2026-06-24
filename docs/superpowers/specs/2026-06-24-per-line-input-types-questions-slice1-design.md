# Per-line input types + non-inventory questions — Slice 1 Design

**Date:** 2026-06-24
**Arc:** Item/Inventory Spine — per-line input types + non-inventory Q&A (Slice 1 of 3)
**Depends on:** PR #88 merged (sections data-driven render + `prep_sections.shape`). This slice branches off main *after* #88 lands.
**Status:** draft, pending review

---

## The arc (3 slices)

1. **Slice 1 (this doc):** input type becomes **per-line** (section = the default for new lines); sections render **mixed** input types; MoO+ can add **non-inventory section-attached questions** (global, propagate to every list with that section; `item_id` NULL). The foundation.
2. **Slice 2:** **item-attached questions** — a question field on the item definition that propagates to its lines (reusing #86's `propagateItemDefinitionToLines`) and rides the item onto reports. Also folds in the **item "include in Opening verification" toggle** (makes today's hard-wired inventory-item→Opening mirror a controllable, default-settable per-item setting).
3. **Slice 3:** **questions as searchable report tags** — extend `buildSearchCorpus` to index question text + answers at the established visibility hierarchy.

**Authority (Juan-locked):** all question creation — item-attached AND section-attached — is **MoO+ (≥8)**. Questions are definitional/structural content (the same layer as item definitions and section structure), not an AGM list-line. The "Add question" UI lives on the **Global tab**, not the location tab.

**Opening verification (Juan-locked):** questions are **NOT** part of Opening verification in this arc — the existing inventory-item→Opening mirror is unchanged in Slice 1, becomes a controllable per-item toggle in Slice 2, and verifying a *question* in Opening (a Y/N verify vs today's numeric recount) is a **future** capability we deliberately leave the door open for but do not build here.

## Goal (Slice 1)

Make a prep section able to hold lines of **different input types** (a numeric count, a Yes/No, a free-text prompt) instead of one uniform shape — and let MoO+ **add a non-inventory question to a section** (a prompt + an answer slot, no registry item), which appears on every prep list that includes that section.

## Ground truth (why this is mostly wiring, not schema)

- **Non-inventory question lines already exist and work.** The seeded Misc items ("Meatball mix - ready?", "Cook Bacon?") are `item_id = NULL` lines with `yes_no` / `yes_no+free_text` inputs. Operators answer them daily; answers store in `prep_data.inputs` (`yesNo` / `freeText`); they surface on report drill-ins. `item_id` is nullable and null-safe on every read path.
- **Input type is already physically per-line.** Each line carries its own `prep_meta.columns`. #88 made the *render* read the **section's** shape uniformly; the per-line columns are there but the renderer ignores per-line differences. Slice 1 makes the renderer honor each line's own columns.
- **The only missing admin door:** since #84, "Add item" is registry-backed (`addPrepItem` always creates an `items` row + par override). There is **no admin path to create a question line** (item_id NULL). That path is new in Slice 1.

So Slice 1 = (a) a per-line input-type concept derived from the line's columns, (b) a render that honors heterogeneous lines, (c) section-attached global questions. **Parts (a)+(b) need no migration** (`item_id` nullable + `prep_meta.columns` already per-line); **part (c) likely adds one small table** (`section_questions`, the canonical question definition that propagates to lines) — the one schema decision for the slice.

## Architecture

### A. Per-line input type

A line's input type is derived from its `prep_meta.columns` (already per-line) via a pure helper:

```
type LineInputType = "on_hand" | "portioned" | "line" | "yes_no" | "free_text";
shapeFromColumns(columns): LineInputType   // inverse of shapeToColumns
```

- `["par","on_hand","back_up","total"]` → `on_hand`; `…portioned…` → `portioned`; `…line…` → `line`
- `["yes_no"]` / `["yes_no","free_text"]` → `yes_no` (note column preserved separately)
- `["free_text"]` → `free_text` (NEW — a pure text question, no Yes/No)

`free_text` is a **new line input type** (not a section shape — sections still pick one of the 4 shapes as their default). `shapeToColumns` already produces `["free_text"]`? No — extend it / add a small map so `free_text` → `["free_text"]`.

**Section shape = the default for new lines.** When a line is added to a section it inherits the section's shape; the "Add question" path lets the operator pick a different input type for that line (override). **No schema change** — the override lives in the line's `prep_meta.columns`, exactly as Misc's items already do.

### B. Mixed-section rendering

Today `GenericPrepSection` renders every line in a section with the **section's** columns (uniform table). Slice 1: a section renders by **each line's own** input type.

- **Uniform section** (all active lines share the section's numeric shape): render the **table** exactly as today (shared column headers) — byte-identical to #88 for the existing 6.
- **Mixed section** (lines differ, or any non-numeric line present): render **per-line control rows** — each row shows its label + the control its own input type dictates (numeric cells inline, a Yes/No toggle, or a text box). No shared header row. `MiscSection` is the existing prior art for per-line controls.

Implementation: `AmPrepForm` decides per section: homogeneous-numeric → `GenericPrepSection` (table, unchanged); else → a new `MixedPrepSection` that maps each line to the right control by `shapeFromColumns(line.prep_meta.columns)` (reusing `PrepRow` for numeric lines and the Misc toggle/text controls for question lines). `computeTotal` + primary-required validation are already per-item and shape-driven (#88) — they extend to per-line by looking up the line's own shape instead of the section's.

Opening Phase-2 + mid-day already render per-line by grouping; they need no change.

### C. Section-attached questions (MoO+, global, propagating)

A question is **attached to a section** and is **global** — defined once (Global tab, MoO+) and appearing on every prep list that includes that section, across locations. This mirrors the `is_default` item pattern: define once → propagate to every list.

**Storage model — materialized lines (reuse, don't reinvent).** A section question propagates as actual `checklist_template_items` lines (`item_id` NULL) onto every prep template (am_prep + mid_day) that runs that section — exactly how default items propagate via the #84 machinery. Rationale: answers then store as normal `checklist_completions` and surface on report drill-ins with zero new plumbing (vs a virtual/injected model that would need net-new answer storage + report surfacing). Where the canonical question definition lives (a `section_questions` table keyed by section slug, vs an `items`-like row) is the **one schema choice for this slice** (see Build order) — but the propagated artifact is always a normal line.

```
addSectionQuestion(actor, {
  section, label, labelEs, inputType: LineInputType, includeNote?, minRoleLevel, required
}) → { questionId }   // then propagate a line onto every prep list with that section
```

- Each propagated line: `seedPrepItem` with `columns = shapeToColumns(inputType, includeNote)`, `item_id = NULL`, `parValue`/`parUnit` NULL, station = section (invariant held).
- **No** `items` row / **no** `item_par_levels` row — the deliberate difference from `addPrepItem`.
- Disable = deactivate the question → its propagated lines deactivate (append-only), edit-once.
- **No Opening mirror** (per the locked Opening-verification decision above).

UI: an **"Add question"** affordance on the **Global tab** (MoO+), in/near the Sections panel — pick the section, label (EN/ES), input-type picker (Yes/No [+note] · Free text · a numeric type), min-role (position dropdown), required. EN+ES i18n.

> **Scope note:** section-question propagation is the meatiest part of Slice 1. If it proves large at plan time, the clean split is **Slice 1a** = per-line input type + mixed render (A + B + D, the pure render foundation; the only mixed lines initially are the seeded Misc items) and **Slice 1b** = section-attached questions (C). Decide at plan time.

### D. Validation

Reuse #88's shape-driven validation, extended to per-line:
- numeric line → its shape's primary field required (if `required`)
- `yes_no` line → `yesNo` required
- `free_text` line → non-empty `freeText` required (if `required`); optional otherwise
A line's `required` flag already gates this.

### Migration footprint

The render foundation (per-line types + mixed render) needs **no migration** — `item_id` is nullable, `prep_meta.columns` is already per-line, answers already store in `prep_data`. The section-question canonical store (part C) likely adds **one small table** (`section_questions`: slug-keyed, label EN/ES, input type, min-role, required, active, audit) — propagated lines are normal `checklist_template_items`. Final call at plan time.

## Testing

`npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit):
1. **Render parity:** the existing 6 sections still render byte-identically (homogeneous path unchanged). Re-run `scripts/check-prep-section-shape-parity.ts`.
2. **Mixed render:** a section with a numeric line + a yes/no line + a free-text line renders each control correctly; answers store + surface on the report drill-in.
3. **Add section question:** `addSectionQuestion` propagates an `item_id` NULL line (chosen input type, no `items`/`item_par_levels` row) onto every prep list with that section; it renders + is answerable + submits; disable deactivates the propagated lines.
Operator smoke (Juan, preview): add a question to a section, see it on every list with that section, answer it, see it on the report.

## Resolved decisions (from review)

- **D1 — Input-type set ✅** = `on_hand` / `portioned` / `line` (numeric) · `yes_no` (+ optional note) · **`free_text`** (pure text, NEW). A par-less numeric "reading" (e.g. a temperature) is a future addition.
- **D2 — Who can add questions ✅ MoO+** (item-attached AND section-attached). Questions are definitional content; the "Add question" UI is on the **Global tab**.
- **D3 — Mixed render layout ✅** uniform sections keep the table; a section flips to per-line control rows the moment it holds a non-uniform line.
- **D4 — Opening verification ✅** questions are NOT in Opening verify in this arc (future). Slice 1 adds no mirror for questions; the inventory-item→Opening mirror is unchanged. The item "include-in-Opening-verification" toggle is a Slice 2 nicety.
- **D5 — Per-line input-type storage ✅** derive from `prep_meta.columns` (no migration); add an explicit field later only if it earns its keep.

## Build order (one slice, dependency-ordered task-commits)

1. `shapeFromColumns` + `free_text` line type in `lib/prep-sections.ts` (+ `shapeToColumns` handles `free_text`). No migration if section questions reuse a lightweight canonical store — **the one schema choice:** a `section_questions` table (slug-keyed) vs reusing an `items`-like row. Decide at plan time; lean `section_questions` (questions aren't items).
2. Mixed render: `MixedPrepSection` + `AmPrepForm` uniform-vs-mixed dispatch (parity-gated for the 6).
3. `addSectionQuestion` + propagation (mirror the default-item propagation) + disable/deactivate.
4. Global-tab "Add question" UI + EN/ES i18n.
5. Smokes + final gate.

## Out of scope (Slice 1)

- Item-attached questions + the item Opening-verification toggle (Slice 2); searchable questions (Slice 3).
- Verifying a question in Opening Phase-2 (future — door left open, not built).
- Changing a section's *default* shape (already shipped in #88 as edit-input-type).
- Questions on opening/closing checklists (this slice is prep; those checklists already have their own yes/no items).
