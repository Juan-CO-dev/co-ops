# Add / Remove Sections (MoO+) + Data-Driven AM-Prep Render — Design

**Date:** 2026-06-24
**Sub-project:** Item/Inventory Spine — sections, final admin piece (follows #85 rename, #87 units)
**Parent arch:** `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md`
**Status:** approved (design), pending spec review

---

## Goal

Let MoO+ (level ≥ 8) **add a new prep section**, **disable** one, and **reorder** sections — and
make the operator AM-prep form render those sections **data-driven from the `prep_sections`
table** instead of a hardcoded set of six. This is the last admin piece before the vendors/SKU →
ordering arc.

## Why this is bigger than "an admin panel"

`prep_sections` (migration 0082) already stores `slug`, `label_en/es`, `columns` jsonb,
`display_order`, `active`. Rename (#85) reads the labels. But **adding a row would render
nowhere** today, because `components/prep/AmPrepForm.tsx` hardcodes the six sections in three
coupled places:

1. `SECTION_ORDER` — the six slugs, in order.
2. Six named components + explicit JSX (`<VegSection>`, `<CooksSection>`, …).
3. `TOTAL_SOURCES` (+ PrepRow's `SECTIONS_WITH_AUTO_TOTAL`) — per-section auto-total formula.

The other two section consumers — **Opening Phase-2** (`components/opening/OpeningPrepEntry.tsx`)
and **mid-day** (`app/(authed)/operations/mid-day/page.tsx`) — already group by
`prepMeta.section` and iterate dynamically, resolving labels via the DB-backed `sectionLabels`.
**They need no changes.** The cutover is scoped to `AmPrepForm` + its numeric section components
+ `PrepRow`'s auto-total gate + the loader surfacing the section list/order.

So this slice = **make AM-prep's render data-driven, then add the admin CRUD on top.**

---

## Architecture

### A. Section "shape" — the unambiguous renderer/total driver

Add `prep_sections.shape text` with CHECK in `('on_hand','portioned','line','yes_no')`.

The shape determines both the **column set** and the **auto-total rule**, eliminating free column
composition (a YAGNI footgun: combos like `yes_no + total` or no-primary are unrepresentable).

| Shape       | Columns (derived)                          | Primary (required) | Total            |
|-------------|--------------------------------------------|--------------------|------------------|
| `on_hand`   | `par, on_hand, back_up, total`             | `on_hand`          | primary + back_up |
| `portioned` | `par, portioned, back_up, total`           | `portioned`        | primary + back_up |
| `line`      | `par, line, back_up, total`                | `line`             | primary + back_up |
| `yes_no`    | `yes_no` (+ `free_text` if note enabled)   | `yes_no`           | n/a              |

`columns` jsonb stays the stored convention (loaders + `narrowPrepTemplateItem` read it), but it
becomes **derived from shape at write time** — `shapeToColumns(shape, includeNote)` is the single
source. The 6 existing rows are backfilled with the matching shape (migration 0086):

- `Veg` → `on_hand`, `Cooks` → `on_hand`, `Sides` → `portioned`,
  `Sauces` → `line`, `Slicing` → `line`, `Misc` → `yes_no`.

Backfill is a no-op render: each backfilled `shape`'s derived columns equal the seeded `columns`.
A committed parity check asserts `shapeToColumns(row.shape) deep-equals row.columns` for all 6.

### B. `PrepSection` type loosens to `string` (slug)

`lib/types.ts`: `type PrepSection = "Veg" | … | "Misc"` → `type PrepSection = string`.

The slug stays the **system match key** (C.38 discipline unchanged — never match on the rendered
label). Consequences:

- `lib/prep-sections.ts` `PREP_SECTIONS` (the literal array) + `SECTION_COLUMNS` (the hardcoded
  map) are **removed**. `columnsForSection` is replaced by `shapeToColumns(shape, includeNote)`.
- `isPrepSectionName(v)` changes meaning: "is `v` a known active section slug" — checked against
  the loaded section set, not a TS union. Callers that used it as a type guard re-narrow against
  the runtime set. (Audit all call sites; most are validation-on-read in `lib/prep.ts`.)
- `PrepColumn` union is unchanged.

### C. Generic AM-prep render

Replace the five numeric section components (`VegSection`, `CooksSection`, `SidesSection`,
`SaucesSection`, `SlicingSection`) with **one `GenericPrepSection`** driven by a section's
`shape` + `columns`. `MiscSection` stays as the yes/no renderer (selected when `shape === 'yes_no'`).

`AmPrepForm`:

- `SECTION_ORDER` (hardcoded array) → the **section list from the loader, ordered by
  `display_order`** (active sections only).
- The six explicit `<VegSection>…<MiscSection>` JSX blocks → a `.map()` over that ordered list,
  dispatching `shape === 'yes_no'` → `<MiscSection>`, else `<GenericPrepSection shape columns …>`.
- `TOTAL_SOURCES` map → `totalSourcesForShape(shape)` returning `{primary, secondary:'back_up'}`
  for numeric shapes, `null` for `yes_no`. `computeTotal` consumes that.
- `PrepRow`'s `SECTIONS_WITH_AUTO_TOTAL` set (which gates the read-only TOTAL cell) → derived
  from whether the section's columns include `total` (i.e., any numeric shape).
- Validation (`validateRawValues`) still iterates `templateItems` (source-of-truth, per the PR-3
  smoke lesson) — only the per-section primary-field lookup changes from a hardcoded switch to
  `shape`-derived primary.

**Loader change:** `loadAmPrepState` (and the AM-prep page) must surface the **active section
definitions ordered by `display_order`** (slug, labels, shape, columns) so the form can iterate
them. `lib/prep-sections.server.ts loadPrepSections` already returns this map ordered by
`display_order`; the loader threads it to the form as an ordered array. Items still group by
`prepMeta.section` (unchanged). An item whose section slug is no longer active (edge: disabled
mid-day) renders under Misc via the cascade (see E) — but since disable cascades items to Misc
first, no active line ever points at an inactive slug.

**Parity gate:** a throwaway smoke renders AM-prep for both locations and asserts the section
order, column headers, and per-row cells are byte-identical to the pre-cutover output for the six
seeded sections. Juan visually confirms on preview before merge.

### D. Admin — Sections panel (Global tab, MoO+ only)

The Global-tab Sections panel (today: rename only) gains, **all gated MoO+ (L ≥ 8)**:

- **Add section:** EN label + ES label + **shape picker** (On-hand / Portioned / Line / Yes-No,
  with a "add a note column" checkbox shown only for Yes-No). `slug` is auto-derived from the EN
  label (slugify: trim, collapse whitespace, strip non-alphanumerics to a stable token), **unique**,
  **immutable** once created (it's the system key stamped into lines). Dup-slug → error. New row
  appends at `max(display_order)+1` (then reorderable, see below).
- **Disable section:** **cascade re-section to Misc.** Any active lines in the section are moved to
  Misc (their `prep_meta.section` + `station` set to `Misc`; `columns` re-derived to Misc's shape),
  then the section row flips `active=false`. The confirm dialog **lists the items that will move
  and warns their input shape changes to Misc's yes/no** (the documented cascade trade-off — never
  silent). Misc itself cannot be disabled (it's the cascade sink). Append-only.
- **Reorder:** ↑↓ controls per active row, writing `display_order`. Swap-with-neighbor semantics
  (read both rows, swap their `display_order`, write both).

### E. Routes, authority, safety

All routes self-gate `requireSession → level < 8 → 403 → assertStepUp(Tier B)`, mirroring the
existing `sections/[slug]` rename route. Service-role writes (table denies end-user DML).

- `POST /api/admin/checklist-templates/sections` — add (MoO+). Body: `{labelEn, labelEs, shape,
  includeNote?}`. Slugifies, dup-guards, derives columns, inserts `active=true` at end.
- `PATCH /api/admin/checklist-templates/sections/[slug]` — **already exists** (rename). Extend to
  also accept `{action: 'disable'}` and `{action: 'reorder', direction: 'up'|'down'}`, OR add
  sibling routes `…/[slug]/disable` (POST) and `…/[slug]/reorder` (PATCH). **Decision: sibling
  routes** — keeps the rename PATCH body contract clean and each action's audit distinct.
  - `POST …/sections/[slug]/disable` — cascade + deactivate (MoO+). Returns moved item count.
  - `PATCH …/sections/[slug]/reorder` — `{direction}` swap (MoO+).

New audit actions in `lib/destructive-actions.ts` (auto-derive destructive via `isDestructive`):

- `prep_section.create` — metadata: slug, labels, shape, columns, display_order.
- `prep_section.disable` — metadata: slug, moved_item_ids[], moved_count, prior display_order.
- `prep_section.reorder` — metadata: slug, from_order, to_order, swapped_slug.

(Rename keeps the existing `prep_section.update`.)

### F. Migration 0086

```
alter table public.prep_sections add column shape text;
-- backfill the 6 from their known shapes
update ... set shape = 'on_hand'   where slug in ('Veg','Cooks');
update ... set shape = 'portioned' where slug = 'Sides';
update ... set shape = 'line'      where slug in ('Sauces','Slicing');
update ... set shape = 'yes_no'    where slug = 'Misc';
-- enforce after backfill
alter table public.prep_sections
  alter column shape set not null,
  add constraint prep_sections_shape_check
    check (shape in ('on_hand','portioned','line','yes_no'));
```

RLS unchanged (deny-all; service-role loaders/writes). Captured as
`supabase/migrations/0086_prep_sections_shape.sql` with the going-forward header.

---

## Data flow

```
MoO+ Add 'Grill' (shape=line)
  → POST /sections  → slugify 'Grill' → insert {slug:'Grill', shape:'line',
                       columns:['par','line','back_up','total'], display_order:7, active:true}
  → audit prep_section.create
Operator AM-prep next render
  → loadAmPrepState surfaces active sections by display_order  → [...6, Grill]
  → AmPrepForm.map → Grill shape='line' → <GenericPrepSection columns=[par,line,back_up,total]>
  → renders empty (no items yet) until a line is sectioned into Grill via item admin
```

```
MoO+ Disable 'Grill' (has 2 active lines)
  → confirm dialog lists the 2 items + "their input becomes Misc yes/no"
  → POST /sections/Grill/disable
       → move 2 lines: prep_meta.section/station → 'Misc', columns → ['yes_no']
       → prep_sections.Grill.active = false
  → audit prep_section.disable {moved_item_ids:[…], moved_count:2}
Operator render → Grill gone; the 2 items now appear under Misc as yes/no rows
```

## Error handling

- Add: dup slug → `409`/typed `AdminTemplateError` mapped to a known UI key; empty label → `400`.
- Disable Misc → `400` "cannot disable the Misc section."
- Reorder past an edge (up on first / down on last) → no-op success (button hidden anyway).
- All UPDATE writes check `rowCount`/`error` and surface explicitly (Phase 1 silent-denial rule;
  writes are service-role so RLS won't filter, but the error check stays).
- Cascade move + deactivate should be **atomic** where possible — both in one logical operation;
  if the move succeeds but deactivate fails, the section stays active with items in Misc
  (recoverable, not corrupting). Document; an RPC is overkill for this admin-frequency action.

## Testing

No framework → `npx tsc --noEmit` + `npm run build` clean + throwaway tsx smokes
(`scripts/_smoke_*.ts`, run via `npx tsx --env-file=.env.local`, **deleted before commit**):

1. **Parity smoke:** `shapeToColumns` for each of the 6 backfilled shapes deep-equals the seeded
   `columns`; AM-prep render order + headers + cells byte-identical pre/post cutover.
2. **Add smoke:** add a section via the data layer → `loadAmPrepState` surfaces it in order →
   `GenericPrepSection` would render its shape's columns.
3. **Disable cascade smoke:** seed a throwaway line into a throwaway section → disable → line's
   `prep_meta.section` = Misc, columns = `['yes_no']`, section `active=false`.
4. **Reorder smoke:** swap two sections → `display_order` reflects the swap → loader order changes.

Committed real-data tools: `scripts/check-prep-section-shape-parity.ts` (parity gate, read-only,
`pathToFileURL` main-guard). Operator smoke: Juan confirms AM-prep renders identically on preview
before any add, then adds a test section and sees it appear.

## Authority (Juan-locked)

Section editing — rename (#85), and now add / disable / reorder — is **MoO+ only (level ≥ 8)**.
AGM+/GM+ do not touch sections. (Items: GM+ adds to registry, AGM+ enables per location, MoO+
edits definitions — unchanged.)

## Out of scope (deferred)

- Per-location section enable/disable (sections are global today; no signal it's needed).
- Free column composition (fixed shapes only — deliberate).
- Editing a section's shape after creation (would re-shape existing items; defer until a real
  need — add-new + cascade covers the workflow).
- Re-section UI for individual items beyond the existing item-admin path (unchanged).

## Build order (one PR, dependency-ordered task-commits)

1. Migration 0086 (`shape` column + backfill + CHECK) + capture + parity check script (run, expect 0 drift).
2. `lib/prep-sections.ts`: `shapeToColumns` / `totalSourcesForShape` / shape types; remove
   `PREP_SECTIONS` + `SECTION_COLUMNS` + `columnsForSection`. Loosen `PrepSection` → string in
   `lib/types.ts`; fix `isPrepSectionName` + all call sites.
3. `GenericPrepSection` component; delete the 5 numeric components.
4. `AmPrepForm` cutover (iterate loader sections by order; dispatch shape; derive total) +
   `PrepRow` auto-total gate from columns. Loader surfaces ordered active sections.
5. Parity smoke (throwaway) — byte-identical for the 6. Gate before continuing.
6. Admin lib: `addPrepSection`, `disablePrepSection` (cascade), `reorderPrepSection` in
   `lib/admin/templates.ts`; audit actions in `lib/destructive-actions.ts`.
7. Routes: `POST /sections`, `POST /sections/[slug]/disable`, `PATCH /sections/[slug]/reorder` —
   self-gate MoO+ + step-up.
8. UI: Sections panel add-form (shape picker) + disable (confirm w/ moved-items warning) + ↑↓
   reorder. EN+ES i18n.
9. Edit-once smoke (throwaway) for add/disable/reorder. Final gate (tsc + build).
