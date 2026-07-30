# Prep Builder Overview + Prep Doctor — design (PR-3/4 of the checklist full-edit arc)

> Council-derived: `.claude/council/2026-07-30-checklist-fulledit/report.md` §D3 (6/6 seats).
> Sibling specs: PR-1 = `2026-07-30-prep-fulledit-floor-design.md` (the prep editor evolves
> in place); PR-2 = closing/opening input types (the builder).
> NO MIGRATION: pure derive-on-read over existing storage (checklist_template_items,
> prep_meta JSONB, translations JSONB, items.name_es) + pure classifiers.

## The ruling (§D3 adjudication)

The template builder governs closing/opening (version-every-publish). PREP deliberately
stays in its own editor (unanimous — prep live-edits, never versions). This PR gives the
builder ONE PLACE TO SEE EVERYTHING: a **READ-ONLY** prep overview per location + prep
Doctor findings. It is kept **cheap and LAST**; its real payload is the Doctor checks
(input-type drift across locations, needs-link, untranslated), NOT the view.

- **NO edit affordances.** Every prep edit deep-links to the existing prep editor page
  (`/admin/checklist-templates/{am_prep|mid_day_prep}` → `ChecklistTabs`). The overview is
  a summary, not a second editor.
- Prep findings are **advisory** and fixed elsewhere → they render in the prep block ONLY,
  and are NEVER folded into the closing/opening `TemplateDoctorReport` totals (mirroring how
  `orphanedMirrors` stays out of `issueCount`).

## The projection shape (read-only)

For each **actor-visible location × prep subtype** (`am_prep` + `mid_day_prep`), the ACTIVE
prep template (resolved date-aware, exactly `resolveActivePrepTemplateId`'s single row) is
projected to its ACTIVE lines, each carrying:

- `displayLabel` — **THE READ LAW** (`resolveLineDefinition` + `loadItemDefns`): question-
  shaped or unlinked → the line's own label; a linked+ACTIVE inventory line → the registry
  item name; a linked-but-DEACTIVATED item → line label. Never the raw label for a linked
  live inventory line.
- `section` (the prep_meta.section slug), `inputType` (`shapeFromColumns(prep_meta.columns)`),
  `linked` (item_id non-null), `questionShaped` (`isQuestionShapedColumns`), `esMissing`
  (no `translations.es.label` AND — for linked inventory lines — no `items.name_es`).

Lines group by section (ordered by displayOrder). Compact projection types + the classifiers
live in the CLIENT-SAFE shared module (`prep-overview-shared.ts`), zero I/O.

## The three classifiers (pure, unit-tested)

a. **`classifyPrepInputTypeDrift(templates)`** — the same line IDENTITY present at BOTH
   locations for the same subtype (identity = `item_id` when linked, else normalized-
   lowercase label) with DIFFERENT derived input types → findings
   `{subtype, identityLabel, perLocation:[{locationId, inputType}]}`. Identity by item_id
   BEATS label (two lines that share a link but drifted labels still pair). Only reports
   when the subtype has exactly the two locations and the identity appears at both.

b. **`classifyPrepNeedsLink(template)`** — active INVENTORY-shaped (non-question) lines with
   `item_id === null` → `{lineId, label}[]`. Question lines are EXCLUDED (a question carries
   no par/link; its label is the question).

c. **`prepEsFill(template)`** — `{filled, total}` over active NON-mirror lines (prep lines are
   never mirrors, but the guard mirrors the closing Doctor's `esFillCount` convention). A line
   is "filled" when its resolved es label exists (line `translations.es.label`, or — for a
   linked inventory line — the registry `items.name_es`).

## Where it mounts

A separate server-loaded, collapsed `CollapsibleSection` block on the BUILDER page
(closing + opening), rendered BELOW the closing/opening Doctor + editor. Per location ×
subtype: the sections/lines with badges (input-type chip, needs-link warn chip, es-missing
chip) + a "Managed in the Prep Editor" header + a deep link to the subtype's editor. The
drift/needs-link/untranslated findings render as advisory chips in the same block. Light —
a read-only summary.

## Explicitly OUT (deferred per council)
- Any EDIT affordance in the overview — every fix deep-links to the prep editor (PR-1).
- Prep publish-versioning (never, per unanimous ruling).
- mid_day / am DIVERGENCE HANDLING beyond LISTING both subtypes (no reconcile between
  subtypes; the drift classifier compares the SAME subtype across locations only).
- Prep par overlays / on-hand / demand (those are the operator + catering surfaces).
- Folding prep findings into the closing/opening Doctor totals.
