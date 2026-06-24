# Add / Remove Sections + Data-Driven AM-Prep Render — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each subagent re-reads its target files' current state before writing (confirm-before-authoring).

**Goal:** Let MoO+ (level ≥ 8) add / disable / reorder prep sections, and make the operator AM-prep form render sections data-driven from `prep_sections` (shape + columns) instead of six hardcoded components.

**Architecture:** A `shape` column on `prep_sections` drives both the column set and the auto-total rule (no free composition). `PrepSection` loosens from a 6-value union to `string` (slug stays the system match key per C.38). One `GenericPrepSection` replaces the five numeric section components; `MiscSection` stays for yes/no. `AmPrepForm` iterates the loader's active sections by `display_order`. Opening Phase-2 + mid-day already render dynamically — untouched. Admin CRUD lives on the Global-tab Sections panel; disable cascades remaining items to Misc.

**Tech Stack:** Next 16 App Router, Supabase Postgres + custom-JWT/RLS (service-role for admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens. No test framework — verify with `npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit). Migration via Supabase MCP, captured as `supabase/migrations/0086_*.sql`.

**Spec:** `docs/superpowers/specs/2026-06-24-add-remove-sections-design.md`

**Branch:** `claude/add-remove-sections` (spec already committed at 1b97ee9).

**Authority (locked):** ALL section editing (rename/add/disable/reorder) = MoO+ only (level ≥ 8), Tier B step-up. Mirror the existing `app/api/admin/checklist-templates/sections/[slug]/route.ts` gate exactly.

---

### Task 1: Migration 0086 — `prep_sections.shape` + backfill + CHECK

**Files:**
- Create: `supabase/migrations/0086_prep_sections_shape.sql`
- Apply: via Supabase MCP `apply_migration` (name `0086_prep_sections_shape`, project ref `bgcvurheqzylyfehqgzh`)

- [ ] **Step 1: Apply the migration via MCP** (controller runs this — not the subagent)

```sql
alter table public.prep_sections add column shape text;

update public.prep_sections set shape = 'on_hand'   where slug in ('Veg','Cooks');
update public.prep_sections set shape = 'portioned' where slug = 'Sides';
update public.prep_sections set shape = 'line'      where slug in ('Sauces','Slicing');
update public.prep_sections set shape = 'yes_no'    where slug = 'Misc';

alter table public.prep_sections
  alter column shape set not null,
  add constraint prep_sections_shape_check
    check (shape in ('on_hand','portioned','line','yes_no'));
```

- [ ] **Step 2: Capture the migration file** with the going-forward header

```sql
-- Migration 0086_prep_sections_shape
-- Applied via Supabase MCP apply_migration on 2026-06-24.
-- Canonical reference: lib/prep-sections.ts (shapeToColumns / SECTION_SHAPES) +
--   docs/superpowers/specs/2026-06-24-add-remove-sections-design.md

-- Add/remove-sections slice: a section's `shape` drives BOTH its column set
-- and its auto-total rule (no free composition — a YAGNI footgun). `columns`
-- jsonb stays the stored convention (loaders read it) but is now DERIVED from
-- shape at write time via shapeToColumns(). The 6 seeded rows are backfilled
-- from their known shapes; each backfilled shape's derived columns equal the
-- seeded columns (parity-checked) so this is a no-op render. CHECK enforced
-- after backfill. RLS unchanged (deny-all; service-role loaders/writes).

-- <body matching the SQL applied above>
```

- [ ] **Step 3: Verify** — query the table, confirm all 6 rows have a non-null `shape` matching the table in the spec, and the CHECK constraint exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0086_prep_sections_shape.sql
git commit -m "feat(sections): migration 0086 — prep_sections.shape + backfill"
```

---

### Task 2: Shape helpers in `lib/prep-sections.ts` + loosen `PrepSection`

**Files:**
- Modify: `lib/types.ts` (loosen `PrepSection`; add `PrepSectionShape`; add `shape` to `PrepSectionDefn`)
- Modify: `lib/prep-sections.ts` (add shape helpers; remove `PREP_SECTIONS`/`SECTION_COLUMNS`/`columnsForSection`)
- Modify: `lib/prep-sections.server.ts` (`loadPrepSections` selects + returns `shape`)
- Audit: every `columnsForSection` / `PREP_SECTIONS` / `isPrepSectionName` call site

- [ ] **Step 1: `lib/types.ts`** — loosen the union, add the shape type, extend `PrepSectionDefn`

```ts
// PrepSection is now a free slug string (was a fixed 6-value union). The slug
// remains the system match key (C.38) — never match on the rendered label.
// Active slugs are validated at runtime against the loaded prep_sections set
// (isPrepSectionName), not by the type system.
export type PrepSection = string;

// A section's shape drives its column set + auto-total rule (migration 0086).
export type PrepSectionShape = "on_hand" | "portioned" | "line" | "yes_no";
```

Add `shape: PrepSectionShape;` to the `PrepSectionDefn` interface (alongside `slug`, `labelEn`, `labelEs`, `columns`, `displayOrder`).

- [ ] **Step 2: `lib/prep-sections.ts`** — replace the literal/map exports with shape-derived helpers

Remove `PREP_SECTIONS`, `SECTION_COLUMNS`, and `columnsForSection`. Add:

```ts
import type { PrepColumn, PrepSectionShape } from "@/lib/types";

/**
 * Column set per shape — the single source for a section's columns (migration
 * 0086 moved this off the old hardcoded SECTION_COLUMNS map keyed by slug).
 * Numeric shapes always carry par + primary + back_up + total. yes_no carries
 * the toggle (+ free_text note when includeNote). Returns a fresh array.
 */
export function shapeToColumns(shape: PrepSectionShape, includeNote = false): PrepColumn[] {
  switch (shape) {
    case "on_hand":   return ["par", "on_hand", "back_up", "total"];
    case "portioned": return ["par", "portioned", "back_up", "total"];
    case "line":      return ["par", "line", "back_up", "total"];
    case "yes_no":    return includeNote ? ["yes_no", "free_text"] : ["yes_no"];
  }
}

/**
 * Auto-total source fields for a numeric shape, or null for yes_no (no total).
 * primary = the operationally-always-reported field; secondary = back_up
 * (optional, treated as 0 when empty). Drives AmPrepForm.computeTotal + the
 * PrepRow read-only-total gate.
 */
export function totalSourcesForShape(
  shape: PrepSectionShape,
): { primary: "on_hand" | "portioned" | "line"; secondary: "back_up" } | null {
  switch (shape) {
    case "on_hand":   return { primary: "on_hand", secondary: "back_up" };
    case "portioned": return { primary: "portioned", secondary: "back_up" };
    case "line":      return { primary: "line", secondary: "back_up" };
    case "yes_no":    return null;
  }
}
```

Change `isPrepSectionName` to validate against a provided active-slug set (it can no longer use a static union):

```ts
/** True when `slug` is one of the active section slugs (runtime set, not a union). */
export function isPrepSectionName(slug: unknown, activeSlugs: ReadonlySet<string>): slug is string {
  return typeof slug === "string" && activeSlugs.has(slug);
}
```

Keep `resolveSectionLabel` and `sectionLabelByLang` unchanged.

- [ ] **Step 3: `lib/prep-sections.server.ts`** — select + return `shape`

Add `shape` to the select list and the `PrepSectionRow` interface, and set it on the returned `PrepSectionDefn`. (The interface gains `shape: PrepSectionShape`.)

- [ ] **Step 4: Audit + fix every call site.** Run `grep -rn "columnsForSection\|PREP_SECTIONS\|isPrepSectionName" lib/ app/ components/ scripts/`. For each:
  - `columnsForSection(section)` → `shapeToColumns(shape)` where `shape` comes from the loaded section def. In `lib/admin/templates.ts propagateItemDefinitionToLines` (the column re-derive site ~line 418) the section's columns come from `loadPrepSections` already — switch the fallback `columnsForSection` to `shapeToColumns(sectionDef.shape)`.
  - `isPrepSectionName(x)` (single-arg) → pass the active-slug set (build it once from `loadPrepSections` in server contexts; in `lib/prep.ts` validation-on-read, thread the set through).
  - Any import of the removed `PREP_SECTIONS` → derive the ordered slug list from `loadPrepSections` instead.
  - `seed-am-prep-template.ts` / `seed-mid-day-prep-template.ts` / `seed-opening-phase2-additions.ts` use literal section strings as data — those are fine (string literals satisfy `PrepSection = string`); only fix actual `columnsForSection`/`PREP_SECTIONS`/`isPrepSectionName` usages.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/prep-sections.ts lib/prep-sections.server.ts <fixed call sites>
git commit -m "refactor(sections): shape-derived columns; loosen PrepSection to slug"
```

---

### Task 3: `GenericPrepSection` component

**Files:**
- Create: `components/prep/sections/GenericPrepSection.tsx`
- Reference (read, don't change yet): `components/prep/sections/VegSection.tsx`, `SidesSection.tsx`, `MiscSection.tsx`, `components/prep/PrepRow.tsx`, `components/prep/PrepSection.tsx`

- [ ] **Step 1: Write `GenericPrepSection`** — a shape-driven numeric section. Re-read `VegSection.tsx` (the canonical numeric wrapper) and mirror its structure exactly, but take `shape` + `columns` as props instead of hardcoding `SECTION_KEY`/`INPUT_COLUMNS`.

Props:
```ts
export interface GenericPrepSectionProps {
  section: string;                       // slug (system key)
  shape: PrepSectionShape;               // numeric shape (caller routes yes_no to MiscSection)
  columns: PrepColumn[];                 // from the section def
  templateItems: ChecklistTemplateItem[];
  rawValues: Record<string, RawPrepInputs>;
  onChange: (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => void;
  disabled?: boolean;
  errors?: Record<string, Partial<Record<keyof RawPrepInputs, string>>>;
  sectionLabels?: Record<string, { en: string; es: string | null }>;
}
```

Behavior (copy from `VegSection`):
- `sectionDisplay` resolution: same three-tier fallback (DB label → first item's `resolveTemplateItemContent(...).station` → ... ). Since there's no per-section i18n key for arbitrary slugs, the final fallback is the slug itself (use `resolveSectionLabel(sectionLabels ?? {}, section, language, fallback)` where `fallback` is the first item's station else the slug).
- `columnHeaders`: build from `columns` using the existing `am_prep.column.<col>` keys — map each column in `columns` (skip none; numeric sections include `par` first). The header label for each col = `t("am_prep.column." + col)`. (Reuse `PrepRow`'s `COLUMN_TRANSLATION_KEY` shape — import or inline the same keys.)
- `inputColumns`: `columns` minus `par`/`yes_no`/`free_text` (the numeric input cells), matching `PrepRow`'s `inputColumns` type.
- `autoCalcTotal`: `columns.includes("total")` — pass to each `PrepRow` so the TOTAL cell is read-only (replaces PrepRow's hardcoded `SECTIONS_WITH_AUTO_TOTAL.has(section)`; see Task 4).
- Map `templateItems` → `<PrepRow>` exactly as VegSection does (guard `meta` non-null, pass label/par/specialInstruction/inputColumns/rawInputs/onChange/disabled/rowErrors), plus the new `autoCalcTotal` prop.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean (component compiles; not yet wired).

- [ ] **Step 3: Commit**

```bash
git add components/prep/sections/GenericPrepSection.tsx
git commit -m "feat(sections): GenericPrepSection (shape-driven numeric render)"
```

---

### Task 4: `PrepRow` auto-total gate from prop; `AmPrepForm` cutover

**Files:**
- Modify: `components/prep/PrepRow.tsx` (replace `SECTIONS_WITH_AUTO_TOTAL` with an `autoCalcTotal` prop)
- Modify: `components/prep/AmPrepForm.tsx` (iterate loader sections; dispatch by shape; derive total)
- Delete: `components/prep/sections/{VegSection,CooksSection,SidesSection,SaucesSection,SlicingSection}.tsx`
- Modify: `lib/prep.ts` (`loadAmPrepState` surfaces active sections ordered by `display_order`)
- Modify: `app/(authed)/operations/am-prep/page.tsx` (thread the ordered sections to the form if needed)

- [ ] **Step 1: `PrepRow.tsx`** — add `autoCalcTotal?: boolean` prop; replace `const isAutoCalcTotal = col === "total" && SECTIONS_WITH_AUTO_TOTAL.has(section)` with `const isAutoCalcTotal = col === "total" && !!autoCalcTotal`. Remove the `SECTIONS_WITH_AUTO_TOTAL` set. Keep `section` prop (still used for data attrs / aria). Update the JSDoc.

- [ ] **Step 2: `lib/prep.ts loadAmPrepState`** — surface the active sections, ordered. Re-read the loader's current return shape first. It already loads `sectionLabels` via `loadPrepSections`. Add an ordered array to the returned state, e.g. `sections: PrepSectionDefn[]` (active, sorted by `displayOrder`) — derived from the same `loadPrepSections` map (`Array.from(map.values()).sort((a,b)=>a.displayOrder-b.displayOrder)`). Mirror in `loadMidDayPrepState` ONLY if mid-day's page needs it — it doesn't (mid-day groups dynamically already), so scope this to AM-prep's loader/return type.

- [ ] **Step 3: `AmPrepForm.tsx` cutover.** Re-read the full component first. Changes:
  - Add `sections: PrepSectionDefn[]` to `AmPrepFormProps` (ordered active sections from the loader).
  - Remove the hardcoded `SECTION_ORDER` array. `itemsBySection`: initialize groups from `sections.map(s => s.slug)` instead of `SECTION_ORDER`; group items by `item.prepMeta.section` as today. (Items whose slug isn't in `sections` won't render — but disable cascades them to Misc first, so no active line points at an inactive slug. Defensively, drop+warn like the existing no-prepMeta branch.)
  - Replace `TOTAL_SOURCES` map + `computeTotal(section, raw)` with a shape-driven version: build a `Map<slug, PrepSectionShape>` from `sections`; `computeTotal` looks up the shape, calls `totalSourcesForShape(shape)`, returns `""` when null. Update `handleChange`'s auto-calc gate to `totalSourcesForShape(shapeBySlug.get(section)) != null && field !== "total"`.
  - Replace the six explicit `<VegSection>…<MiscSection>` JSX blocks with a `.map` over `sections` (already in display order): for each section, `shape === 'yes_no'` → `<MiscSection templateItems={itemsBySection.get(slug) ?? []} … sectionLabels={sectionLabels}/>`; else `<GenericPrepSection section={slug} shape={shape} columns={section.columns} templateItems={…} …/>`. Pass `rawValues`, `onChange={handleChange}`, `disabled={isReadOnly}`, `errors`, `sectionLabels` to each, matching today's props.
  - `validateRawValues`: it currently takes `sectionByItemId: Map<string, PrepSection>`. Keep that, but the per-section primary-required logic must derive the primary field from the section's shape instead of the hardcoded `section === "Misc"` / numeric switch. Pass a `shapeBySlug` map (or a `primaryFieldBySlug` map) into `validateRawValues`. For `yes_no` shape → require `yesNo`; for numeric shapes → require `totalSourcesForShape(shape).primary`. Re-read the current `validateRawValues` body and adapt the section-conditional in place (keep iterating `templateItems` — the PR-3 source-of-truth rule).
  - Remove the now-unused imports of the 5 deleted components.
  - Keep `MiscSection` import.

- [ ] **Step 4: Update `MiscSection.tsx`** — it currently hardcodes `SECTION_KEY = "Misc"`. It can stay Misc-specific (Misc is the only yes/no section today and the cascade sink), so minimal change: ensure it accepts the same `sectionLabels` prop and resolves its display via `resolveSectionLabel(sectionLabels, "Misc", language, fallback)`. If it already does (it took `sectionLabels` in #85), no change. Verify by reading it.

- [ ] **Step 5: Delete the 5 numeric components.**

```bash
git rm components/prep/sections/VegSection.tsx components/prep/sections/CooksSection.tsx components/prep/sections/SidesSection.tsx components/prep/sections/SaucesSection.tsx components/prep/sections/SlicingSection.tsx
```

- [ ] **Step 6: `app/(authed)/operations/am-prep/page.tsx`** — pass the loader's `sections` to `<AmPrepForm sections={state.sections} … />`. Re-read the page's current `<AmPrepForm>` props to confirm the call site.

- [ ] **Step 7: Verify** — `npx tsc --noEmit` + `npm run build` clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(sections): data-driven AM-prep render (GenericPrepSection)"
```

---

### Task 5: Parity gate (PARITY GATE — do not proceed past this until green)

**Files:**
- Create: `scripts/check-prep-section-shape-parity.ts` (committed, read-only)
- Create then DELETE: `scripts/_smoke_amprep_parity.ts` (throwaway)

- [ ] **Step 1: Committed parity check** `scripts/check-prep-section-shape-parity.ts` — for every active `prep_sections` row, assert `shapeToColumns(row.shape)` deep-equals `row.columns`. Print count + any mismatches. Exit 0 always (it's a check). `pathToFileURL(process.argv[1])` main-guard per AGENTS.md. Run: `npx tsx --env-file=.env.local scripts/check-prep-section-shape-parity.ts` — expect 0 mismatches for the 6.

- [ ] **Step 2: Throwaway render parity smoke** `scripts/_smoke_amprep_parity.ts` — load `loadAmPrepState` for both locations; assert the surfaced `sections` are exactly `[Veg, Cooks, Sides, Sauces, Slicing, Misc]` in that `display_order`, each with the expected shape + columns. (Render-tree byte-identity is verified by Juan's visual smoke; this asserts the data feeding the render is identical.) Run, confirm pass, then `rm scripts/_smoke_amprep_parity.ts`.

- [ ] **Step 3: Commit** the committed check only (throwaway already deleted).

```bash
git add scripts/check-prep-section-shape-parity.ts
git commit -m "test(sections): committed shape↔columns parity check"
```

**GATE:** Both checks pass (0 mismatches; section order/shape/columns identical). Do not proceed to admin work until green.

---

### Task 6: Admin lib — add / disable / reorder in `lib/admin/templates.ts`

**Files:**
- Modify: `lib/admin/templates.ts` (add `addPrepSection`, `disablePrepSection`, `reorderPrepSection`; export a `slugifySection` helper)
- Modify: `lib/destructive-actions.ts` (add `prep_section.create`, `prep_section.disable`, `prep_section.reorder`)

Re-read `setSectionLabel` (~line 2069) first and mirror its shape: service-role client, GLOBAL (no IDOR), `AdminTemplateError` for typed failures, `audit()` with before/after in metadata.

- [ ] **Step 1: `lib/destructive-actions.ts`** — add under the prep-section comment block:

```ts
  // — prep_section.create adds a section to the registry (MoO+, all-locations).
  "prep_section.create",
  // — prep_section.disable deactivates a section + cascades its active lines to Misc (MoO+).
  "prep_section.disable",
  // — prep_section.reorder swaps a section's display_order with a neighbor (MoO+).
  "prep_section.reorder",
```

- [ ] **Step 2: `slugifySection`** (exported pure helper)

```ts
/** Derive a stable, unique-able slug from an EN label: trim, collapse internal
 *  whitespace, strip non-alphanumerics, PascalCase-ish token. Empty → throws. */
export function slugifySection(labelEn: string): string {
  const token = labelEn
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  if (!token) throw new AdminTemplateError(400, "invalid_label", "Section label is empty after slugify");
  return token;
}
```

- [ ] **Step 3: `addPrepSection`** — insert active section at end. Signature `addPrepSection(actor, { labelEn, labelEs, shape, includeNote })`. Logic: slugify EN; check no existing row (active OR inactive) with that slug (dup → `AdminTemplateError(409, "section_exists")`); derive `columns = shapeToColumns(shape, includeNote)`; `display_order = (max active display_order) + 1`; insert `{slug, label_en, label_es, columns, shape, display_order, active:true, created_by, updated_by}`; audit `prep_section.create` with metadata `{slug, shape, columns, displayOrder}`. Validate `shape` ∈ the 4 values (throw `400 invalid_shape` otherwise).

- [ ] **Step 4: `disablePrepSection`** — cascade to Misc then deactivate. Signature `disablePrepSection(actor, { slug })`. Logic:
  - `slug === "Misc"` → `AdminTemplateError(400, "cannot_disable_misc")`.
  - Read the section row (active) → 404 if missing.
  - Find active lines in the section: query `checklist_template_items` where `active=true` and `prep_meta->>'section' = slug` (also catch `station = slug`). For each, set `prep_meta.section = 'Misc'`, `station = 'Misc'`, and re-derive `prep_meta.columns = shapeToColumns('yes_no')` (Misc's shape; mirror the column-re-derive pattern in `propagateItemDefinitionToLines`). Collect moved ids. Use `setPrepItemSection`/`setPrepItemMeta` if they preserve the invariant, else a direct service-role update — re-read those helpers to choose.
  - Flip the section `active=false` (`updated_by`/`updated_at`).
  - Audit `prep_section.disable` with metadata `{slug, moved_item_ids, moved_count, prior_display_order}`.
  - Check `rowCount`/`error` on every write (silent-denial rule).

- [ ] **Step 5: `reorderPrepSection`** — swap with neighbor. Signature `reorderPrepSection(actor, { slug, direction })`. Logic: load active sections ordered; find target index; compute neighbor (up = prev, down = next); if at edge → no-op return; swap the two rows' `display_order` (two updates); audit `prep_section.reorder` with `{slug, from_order, to_order, swapped_slug}`.

- [ ] **Step 6: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/templates.ts lib/destructive-actions.ts
git commit -m "feat(sections): admin lib add/disable(cascade)/reorder"
```

---

### Task 7: Routes — add / disable / reorder

**Files:**
- Create: `app/api/admin/checklist-templates/sections/route.ts` (POST add)
- Create: `app/api/admin/checklist-templates/sections/[slug]/disable/route.ts` (POST)
- Create: `app/api/admin/checklist-templates/sections/[slug]/reorder/route.ts` (PATCH)

Every handler mirrors the existing `sections/[slug]/route.ts` gate verbatim: `requireSession` → `ROLES[ctx.user.role].level < 8 → 403 forbidden` → `assertStepUp(ctx, "B")` → `AdminTemplateError` mapping.

- [ ] **Step 1: `sections/route.ts` POST** — parse `{labelEn, labelEs, shape, includeNote?}`; validate `labelEn` non-empty string, `shape` ∈ 4 values; call `addPrepSection`; return `jsonOk({ slug })`. `currentPath` = `/api/admin/checklist-templates/sections`.

- [ ] **Step 2: `sections/[slug]/disable/route.ts` POST** — `await params` for slug; call `disablePrepSection`; return `jsonOk({ movedCount })`.

- [ ] **Step 3: `sections/[slug]/reorder/route.ts` PATCH** — parse `{direction}` ∈ `{up,down}`; call `reorderPrepSection`; return `jsonOk({ ok: true })`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/checklist-templates/sections
git commit -m "feat(sections): add/disable/reorder routes (MoO+ + step-up)"
```

---

### Task 8: UI — Sections panel (add form + disable + reorder) + i18n

**Files:**
- Modify: `components/admin/templates/GlobalRegistryTab.tsx` (the Sections panel — re-read its current `SectionRow`/rename UI from #85)
- Modify: `lib/i18n/en.json` + `lib/i18n/es.json` (new keys)
- Reference: `loadChecklistAdminView` returns `sections: PrepSectionDefn[]` (now carrying `shape`)

- [ ] **Step 1: Re-read** `GlobalRegistryTab.tsx`'s Sections panel + `SectionRow` (the rename surface) to match styling/patterns.

- [ ] **Step 2: Reorder controls** — add ↑↓ buttons per active section row; on click POST/PATCH `…/sections/[slug]/reorder` with `{direction}`; on success `router.refresh()`. Hide ↑ on first row, ↓ on last (the route also no-ops at edges).

- [ ] **Step 3: Disable control** — a "Disable" affordance per row (hidden for `Misc`). On click, open a confirm dialog that:
  - Fetches/derives the count of active items in that section (the admin view already has registry items with section; count `registry.filter(r => r.section === slug && enabled-somewhere)` OR call the disable route which returns `movedCount` — simplest: show a generic warning + the route returns the actual moved count). Per spec the dialog must **list the items that will move and warn their input shape changes to Misc's yes/no.** Use the admin view's registry items filtered by `section === slug` to list names; if that list isn't readily available client-side, show the names from `registry` (which carries `name` + `section`).
  - On confirm → POST `…/sections/[slug]/disable` → `router.refresh()`.

- [ ] **Step 4: Add-section form** — a small form at the bottom of the Sections panel: EN label, ES label, shape `<select>` (On-hand / Portioned / Line / Yes-No), and a "add a note column" checkbox shown only when shape = Yes-No. On submit → POST `…/sections` → `router.refresh()` + clear form. Show `section_exists` / `invalid_label` / `invalid_shape` errors via the existing `resolveErrorKey` known-set in `components/admin/templates/shared.ts` (add the new codes there).

- [ ] **Step 5: i18n** — add EN+ES keys for: panel sub-labels, shape option labels, "add a note column", the disable confirm title/body/warning (with `{count}` + item list), add/disable/reorder button labels, and the new error codes. Spanish tú-form, operational register.

- [ ] **Step 6: Verify** — `npx tsc --noEmit` + `npm run build` clean.

- [ ] **Step 7: Commit**

```bash
git add components/admin/templates/GlobalRegistryTab.tsx components/admin/templates/shared.ts lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(sections): Sections panel add/disable/reorder UI + i18n"
```

---

### Task 9: Edit-once smoke + final gate

**Files:**
- Create then DELETE: `scripts/_smoke_sections_crud.ts` (throwaway)

- [ ] **Step 1: Throwaway CRUD smoke** `scripts/_smoke_sections_crud.ts` (run via `npx tsx --env-file=.env.local`, DELETED before commit):
  - **Add:** `addPrepSection` a throwaway `line`-shape section → `loadAmPrepState` surfaces it last, with derived columns `[par,line,back_up,total]`.
  - **Reorder:** move it up → `display_order` swap reflected in the loader order.
  - **Disable cascade:** seed a throwaway line into the section → `disablePrepSection` → the line's `prep_meta.section` = `Misc`, `columns` = `['yes_no']`, section `active=false`, audit row has `moved_item_ids`.
  - Clean up the throwaway rows (deactivate, append-only) so prod stays clean.
  - Delete the script.

- [ ] **Step 2: Final gate** — `npx tsc --noEmit` + `npm run build` clean. Re-run `scripts/check-prep-section-shape-parity.ts` → 0 mismatches.

- [ ] **Step 3: Open PR** (controller). Body includes the preview URL for Juan's operator smoke: AM-prep renders identically for the 6 BEFORE any edit; then add a test section / reorder / disable and verify it flows. PR body ends with the `🤖 Generated with [Claude Code]` line.

---

## Self-review notes (controller)

- **Spec coverage:** migration+backfill (T1), shape helpers + type loosening (T2), GenericPrepSection (T3), AM-prep cutover + PrepRow gate (T4), parity gate (T5), admin lib add/disable/reorder (T6), routes (T7), UI+i18n (T8), smoke+gate (T9). All spec sections A–F mapped.
- **Type consistency:** `PrepSectionShape` (4 values) used in `shapeToColumns`/`totalSourcesForShape`/`addPrepSection`/CHECK; `PrepSection = string`; `PrepSectionDefn` gains `shape`. `autoCalcTotal` prop replaces `SECTIONS_WITH_AUTO_TOTAL`.
- **Risk gates:** T5 parity is a hard stop before admin work; T4 is the only operator-flow-touching task and is parity-verified + Juan-smoked.
- **Confirm-before-authoring:** every render/loader/admin task re-reads its target's current state first (called out per task).
