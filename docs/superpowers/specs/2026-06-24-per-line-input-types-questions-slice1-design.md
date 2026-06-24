# Per-line input types + non-inventory questions — Slice 1 Design

**Date:** 2026-06-24
**Arc:** Item/Inventory Spine — per-line input types + non-inventory Q&A (Slice 1 of 3)
**Depends on:** PR #88 merged (sections data-driven render + `prep_sections.shape`). This slice branches off main *after* #88 lands.
**Status:** draft, pending review

---

## The arc (3 slices)

1. **Slice 1 (this doc):** input type becomes **per-line** (section = the default for new lines); sections render **mixed** input types; admins can add **non-inventory "question" lines** (item_id NULL). The foundation.
2. **Slice 2:** **item-attached questions** — a question field on the item definition that propagates to its lines (reusing #86's `propagateItemDefinitionToLines`) and rides the item onto reports.
3. **Slice 3:** **standalone questions as searchable report tags** — extend `buildSearchCorpus` to index question text + answers at the established visibility hierarchy.

## Goal (Slice 1)

Make a prep section able to hold lines of **different input types** (a numeric count, a Yes/No, a free-text prompt) instead of one uniform shape — and give admins a way to **add a non-inventory question** (a line that is just a prompt + an answer slot, with no registry item behind it).

## Ground truth (why this is mostly wiring, not schema)

- **Non-inventory question lines already exist and work.** The seeded Misc items ("Meatball mix - ready?", "Cook Bacon?") are `item_id = NULL` lines with `yes_no` / `yes_no+free_text` inputs. Operators answer them daily; answers store in `prep_data.inputs` (`yesNo` / `freeText`); they surface on report drill-ins. `item_id` is nullable and null-safe on every read path.
- **Input type is already physically per-line.** Each line carries its own `prep_meta.columns`. #88 made the *render* read the **section's** shape uniformly; the per-line columns are there but the renderer ignores per-line differences. Slice 1 makes the renderer honor each line's own columns.
- **The only missing admin door:** since #84, "Add item" is registry-backed (`addPrepItem` always creates an `items` row + par override). There is **no admin path to create a question line** (item_id NULL). That path is new in Slice 1.

So Slice 1 = (a) a per-line input-type concept derived from the line's columns, (b) a render that honors heterogeneous lines, (c) an "Add question" admin path. **No migration.**

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

### C. "Add question" admin path

A new lib function + route + UI to add a **non-inventory** line:

```
addPrepQuestion(actor, {
  templateId, section, label, labelEs,
  inputType: LineInputType, includeNote?, minRoleLevel, required
}) → { templateItemId }
```

- Seeds the line via `seedPrepItem` with `columns = shapeToColumns(inputType, includeNote)`, `item_id = NULL`, and **no** `items` row / **no** `item_par_levels` row (the deliberate difference from `addPrepItem`).
- `parValue`/`parUnit` are NULL for questions.
- Honors the station/section invariant (seedPrepItem sets station = section).
- No Opening mirror (questions are answered per-list, not verified next-day) — see Open Decision D4.

UI: an **"Add question"** affordance on the location tab, alongside the existing add-line path — label (EN/ES), input-type picker (Yes/No [+note] · Free text · a numeric type), min-role (position dropdown), required. EN+ES i18n.

### D. Validation

Reuse #88's shape-driven validation, extended to per-line:
- numeric line → its shape's primary field required (if `required`)
- `yes_no` line → `yesNo` required
- `free_text` line → non-empty `freeText` required (if `required`); optional otherwise
A line's `required` flag already gates this.

### No migration

`item_id` is nullable; `prep_meta.columns` is per-line; answers already store in `prep_data`. Nothing schema-level changes in Slice 1.

## Testing

`npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit):
1. **Render parity:** the existing 6 sections still render byte-identically (homogeneous path unchanged). Re-run `scripts/check-prep-section-shape-parity.ts`.
2. **Mixed render:** a section with a numeric line + a yes/no line + a free-text line renders each control correctly; answers store + surface on the report drill-in.
3. **Add question:** `addPrepQuestion` creates an item_id NULL line with the chosen input type, no `items`/`item_par_levels` row; it renders + is answerable + submits.
Operator smoke (Juan, preview): add a question to a list, answer it, see it on the report.

## Open decisions (your review)

- **D1 — Input-type set.** Confirm line input types = `on_hand` / `portioned` / `line` (numeric) · `yes_no` (+ optional note) · **`free_text`** (pure text, NEW). Any other question type now (e.g. a numeric "reading" without par, like a temperature)? *Recommend: the 5 above; a par-less numeric reading can be a future addition.*
- **D2 — Who can add questions.** *Recommend:* a **standalone** question on a location's list = same gate as adding a local line today (AGM+ for that location). Item-attached questions (Slice 2) = MoO+ (item definition). Confirm the standalone gate.
- **D3 — Mixed render layout.** Confirm the "uniform sections keep the table; mixed sections render per-line control rows (no shared header)" approach. (A section flips to per-line rows the moment it holds a non-uniform line.)
- **D4 — Do AM-prep questions mirror to Opening?** *Recommend: no* for Slice 1 — questions are answered per-list, not verified next-day; the mirror stays inventory-only. (Revisit if you want a question to carry to the next-morning Opening verify.)
- **D5 — Per-line input-type storage.** *Recommend:* derive from `prep_meta.columns` (no migration; matches how Misc lines already work) rather than adding an explicit `prep_meta.inputType` field. Add the explicit field later only if it earns its keep.

## Out of scope (Slice 1)

- Item-attached questions (Slice 2) and standalone-as-searchable-tag (Slice 3).
- Changing a section's *default* shape (already shipped in #88 as edit-input-type).
- Questions on opening/closing checklists (this slice is prep; those checklists already have their own yes/no items).
