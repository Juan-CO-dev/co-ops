# Prep Template Editor — Design (C.44 Admin Module 3, Slice 1)

**Date:** 2026-06-21
**Module:** C.44 admin capstone, Module 3 (Checklist/Prep Templates), **slice 1 of N**
**Builds on:** Admin Foundation (#78) + User Management (#79)
**Gate:** `checklist-templates` section = level ≥ 7 (GM+)
**Migration:** NONE

---

## Goal

Let GM+ (level ≥ 7) view the prep templates and edit their items **in place** — par
targets, special instructions, labels/descriptions, display order, required flag, and
(with re-auth) minimum role level — **without a developer running a seed script.** First
operator-facing write surface for operational config.

## Scope (locked with Juan, 2026-06-21)

Decisions captured via two AskUserQuestion rounds:

1. **First-cycle deliverable:** Viewer + safe in-place edits (not read-only-only; not full editor).
2. **Template type first:** Prep (AM + mid-day). Opening/closing deferred to a later slice.
3. **"PARs" means:** prep-sheet pars (`prep_meta.parValue`) — belongs in THIS module. Vendor-ordering pars (`par_levels`) stay in the later Vendors+Pars module.
4. **Edit semantics:** Live in-place. The edit updates the active template; the next instance picks it up. History stays frozen via C.44 snapshots.
5. **Par propagation:** YES — an AM-prep par edit also updates the linked Opening Phase-2 item's mirrored par.
6. **Min role level:** IN scope, but authorization-affecting → requires Tier-B step-up (fresh password). Content edits stay Tier A.

### In scope (editable, id-preserving, live)

Per prep template item, editable in EN **and** ES together (editing English-only would
recreate the C.37 partial-translation gap):

| Field | Storage | Tier |
|---|---|---|
| par value | `prep_meta.parValue` | A |
| par unit | `prep_meta.parUnit` | A |
| special instruction (EN) | `prep_meta.specialInstruction` | A |
| special instruction (ES) | `translations.es.specialInstruction` | A |
| label (EN) | `label` column | A |
| label (ES) | `translations.es.label` | A |
| description (EN) | `description` column | A |
| description (ES) | `translations.es.description` | A |
| display order | `display_order` column | A |
| required | `required` column | A |
| **min role level** | `min_role_level` column | **B** |

### Out of scope (deferred to later slices)

- Adding / removing items
- Creating new template versions (Path A) — not needed; all in-scope edits are id-preserving
- Changing an item's `section` or `columns[]` (form-mechanics changes; `setPrepItemSection` territory)
- Opening / closing (cleaning-style) templates
- `expects_count` / `expects_photo`, vendor links, `report_reference_type` / `references_template_item_id` editing
- Vendor-ordering pars (`par_levels`) — Vendors+Pars module

## Ground truth (verified live, 2026-06-21)

- `checklist_templates`: no `version` column — versioning is the `active` + `created_at`
  "Path A" convention. Columns: id, location_id, type, name, description, active,
  single_submission_only, reminder_time, created_at, created_by, updated_at,
  submission_gate_predicate, edit_gate_predicate, prep_subtype.
- `checklist_template_items`: id, template_id, station, display_order, label, description,
  min_role_level (numeric, default 3), required, expects_count, expects_photo,
  vendor_item_id, active, translations (jsonb), prep_meta (jsonb), report_reference_type
  (enum), references_template_item_id (uuid).
- Per location (MEP + EM): Standard Closing v2 (61 active, v1 inactive), Standard Opening
  v1 (78), Standard AM Prep v1 (38), Standard Mid-day Prep v1 (14). Prep templates are
  `type='prep'` disambiguated by `prep_subtype IN ('am_prep','mid_day_prep')`.
- `prep_meta.section` MUST equal the item's `station` (invariant; `lib/prep.ts`
  `narrowPrepTemplateItem` throws on drift; `setPrepItemMeta` asserts station match before
  writing). The editor never touches `section`/`station`, so the invariant is preserved by
  construction.
- Opening Phase-2 items carry `OpeningPhase2Meta` (`parValue`, `parUnit` mirrored from AM
  Prep at seed time) and `references_template_item_id` pointing at their source AM-prep
  item. The AGENTS.md note "when AM Prep par changes via future C.44 admin tooling, the
  seed's UPDATE-on-drift path mirrors the new par into the opening Phase 2 item's parValue"
  is exactly the propagation this slice implements.
- `lib/admin/sections.ts`: `checklist-templates` minLevel 7; outer `/admin` gate ≥ 6.
- `lib/destructive-actions.ts`: has `checklist_template.create`,
  `checklist_template.delete_or_deactivate`, `checklist_template_item.delete` — but NOT
  `checklist_template_item.update` (this slice adds it).

## Architecture

Mirrors the shipped admin modules (service-role data layer + app-layer gating; routes
self-gate because they live outside `app/admin/layout.tsx`).

### Files

- **`lib/admin/templates.ts`** (new) — service-role data layer.
  - `listPrepTemplates(service, locationId)` → the active AM + mid-day prep templates with
    active-item counts.
  - `getPrepTemplateDetail(service, templateId)` → template + items (via
    `TEMPLATE_ITEM_COLUMNS` + `rowToTemplateItem` + `narrowPrepTemplateItem`), grouped-ready
    (ordered by display_order). Asserts the template is `type='prep'` (guards against an id
    pointing at opening/closing).
  - `updatePrepItemContent(service, { actor, templateId, itemId, patch })` — content fields
    (par/unit/specialInstruction/label/description/displayOrder/required + translations).
    Loads the existing row, merges, writes: `prep_meta` via the invariant-safe path (build
    next `PrepMeta` preserving `section`/`columns`, call `setPrepItemMeta`), top-level
    columns + `translations` via a direct UPDATE. Audits `checklist_template_item.update`
    with before/after. If the item is `am_prep` and par/unit changed, calls
    `propagateParToOpeningMirror`.
  - `setPrepItemMinRole(service, { actor, templateId, itemId, minRoleLevel })` — Tier-B
    path. Validates `minRoleLevel` is a sane level (3–8 decimal-aware). Direct UPDATE +
    audit.
  - `propagateParToOpeningMirror(service, { actor, amPrepItemId, locationId, parValue, parUnit })`
    — find active-opening-template items where `references_template_item_id = amPrepItemId`
    (same location); update their `prep_meta.parValue/parUnit` mirror (preserve
    `openingPhase2`/`section`). Returns the propagated item ids for audit metadata.
  - `AdminTemplateError(status, code)` → routes map to `jsonError`.
- **`app/admin/checklist-templates/page.tsx`** (replace stub) — Server Component; re-gate
  level ≥ 7 (redirect `/dashboard` if <7); per-location switcher (`?location=`,
  authorized via the same location-context lock used elsewhere); lists the AM + mid-day
  prep templates with item counts + links to detail.
- **`app/admin/checklist-templates/[templateId]/page.tsx`** (new) — Server Component; loads
  detail; renders items grouped by section with the client editor.
- **`components/admin/templates/`** (new) — `PrepTemplateEditor` (section-grouped list),
  `PrepItemEditPanel` (inline expand: EN/ES fields, par/unit/instruction/order/required),
  min-role control firing `requestStepUp("B")` before its PATCH; content saves fire
  `requestStepUp("A")`. Pessimistic, error-surfacing, GM+-gated affordances.
- **API** (all self-gate `requireSession → level≥7 → assertStepUp(tier)`):
  - `GET /api/admin/templates` — list (no step-up).
  - `GET /api/admin/templates/[templateId]` — detail (no step-up).
  - `PATCH /api/admin/templates/[templateId]/items/[itemId]` — content edit (Tier A).
  - `PATCH /api/admin/templates/[templateId]/items/[itemId]/min-role` — min role (Tier B).
- **`lib/destructive-actions.ts`** — add `checklist_template_item.update`.
- **`lib/i18n/{en,es}.json`** — `admin.templates.*` keys at parity.

### Why separate routes for min-role

Content edits (Tier A) and the authorization-affecting min-role change (Tier B) split onto
separate routes/controls so the UX is honest: the min-role control re-prompts for the
password; the content save uses the existing session unlock. Same split User Management
used for profile-edit (Tier A) vs role-change (Tier B). One save button mixing tiers would
surprise the user mid-edit.

### Why reuse `setPrepItemMeta`

`lib/prep.ts setPrepItemMeta` asserts `meta.section === existing.station` before writing
`prep_meta`, so routing par/instruction edits through it preserves the station/section sync
invariant by construction. We never expose `section` editing this slice, so the assertion
always passes; if a future bug tried to drift them, this throws rather than corrupting.

## Data flow — a par edit

1. GM opens `/admin/checklist-templates?location=<MEP>` → sees AM Prep v1 + Mid-day Prep v1.
2. Opens AM Prep detail → items grouped by section; expands "Veg — leafy mix" (par 6).
3. Edits par 6 → 8, saves. Client has a Tier-A unlock (or `requestStepUp("A")` first).
4. `PATCH .../items/[itemId]` → route self-gates → `updatePrepItemContent`:
   - loads item, builds next `PrepMeta` (`parValue: 8`, section/columns preserved),
     `setPrepItemMeta` writes `prep_meta`.
   - audits `checklist_template_item.update` (before `{parValue:6}`, after `{parValue:8}`).
   - item is `am_prep` + par changed → `propagateParToOpeningMirror`: the Opening Phase-2
     "Veg — leafy mix" item (linked via `references_template_item_id`) gets its mirror par
     set to 8; propagated id folded into the audit metadata.
5. Next AM-prep instance load shows par 8; the Opening verification fallback shows 8.
   Yesterday's submitted reports still show 6 (C.44 snapshot).

## Authorization model

- Outer `/admin` reachability: level ≥ 6 (foundation layout).
- Section page + every API route: level ≥ 7 (GM+), enforced independently (routes are
  outside the admin layout).
- Step-up: Tier A for content; Tier B for min-role. `assertStepUp(ctx, tier)` per route;
  `{ok:false, code}` → `jsonError(403, code)`.
- Service-role writes; RLS stays the end-user boundary. No `canActOn` (that's user-vs-user;
  template edits are gated purely by level + step-up).
- **Location-binding (IDOR):** templates are per-location. GM (7) and MoO (8) are
  location-scoped (`ALL_LOCATIONS_THRESHOLD = 9`); only Owner+ get all-locations. Every
  by-id loader/mutator MUST bind the resolved template's `location_id` to a location the
  actor is authorized for — gating the `?location=` param alone is insufficient (the
  recurring Reports-Hub / Mid-Shift by-id IDOR lesson). `getPrepTemplateDetail` resolves the
  template, then verifies its `location_id` ∈ actor's authorized locations (or actor level
  ≥ 9); the item PATCH routes re-resolve the item's template and apply the same bind before
  any write. Unauthorized location → 404 (not 403 — don't confirm existence).

## Audit

- New action `checklist_template_item.update` (destructive auto-derives true via the
  registry). `before_state`/`after_state` carry the changed fields only. Metadata carries
  `template_id`, `prep_subtype`, and (on propagation) `propagated_to_item_ids` +
  `par_before`/`par_after`. Never logs anything sensitive (template config is non-secret).
- Min-role change uses the same action with `metadata.field: "min_role_level"` +
  before/after level + `metadata.tier: "B"`.

## i18n

`admin.templates.*` EN + ES at parity — section page, detail, every field label, every
ARIA label, error strings. Spanish operational/tú-form per the C.37 convention. The
editable ES fields (item label/description/special instruction) write into
`translations.es.*` / `prep_meta.specialInstruction` — the editor surfaces both EN and ES
inputs so a GM edit can't create English-only drift.

## Error handling

- Unknown/non-prep `templateId` → 404 (`AdminTemplateError(404, "template_not_found")`).
- Unknown `itemId` (or not in this template) → 404.
- Step-up missing/stale → 403 `step_up_required` / `step_up_stale`.
- Invalid payload (par not a number/negative, min-role out of 3–8, label empty) →
  400 with `field`.
- Postgres UPDATE returning 0 rows (RLS/no-match) → explicit error, never silent success
  (per the Phase 1 silent-denial lesson — though service-role bypasses RLS, the 0-row check
  guards a bad id).
- `setPrepItemMeta` `PrepInvariantError` (would only fire on a section/station drift bug)
  → 500 surfaced, not swallowed.

## Testing

No test framework → `tsc --noEmit` + `next build` + throwaway `tsx` smokes
(`scripts/_smoke_*.ts`, run via `npx tsx --env-file=.env.local`, **deleted before commit,
never committed**). Smokes create disposable service-role test rows and hard-delete them
(test artifacts):

1. Create a throwaway `am_prep` template + one prep item (known `prep_meta`) + a throwaway
   `opening` template + one Phase-2 item whose `references_template_item_id` = the test
   prep item.
2. `updatePrepItemContent` par edit → read back: prep item par updated, `section`/`columns`
   preserved, `narrowPrepTemplateItem` still passes (invariant intact).
3. Propagation: the linked opening item's `prep_meta.parValue` mirror updated.
4. `setPrepItemMinRole` → read back min_role_level updated.
5. Audit rows emitted with before/after.
6. Hard-delete all test rows.

Juan preview-smoke (the real verification): bump a real par on preview → confirm it shows
on the next AM-prep load AND on the Opening verification fallback; confirm min-role change
forces a password re-prompt; confirm a non-GM can't reach the surface.

## Build order (for the plan)

1. `lib/destructive-actions.ts` — add `checklist_template_item.update`.
2. `lib/admin/templates.ts` — reads (`listPrepTemplates`, `getPrepTemplateDetail`).
3. `lib/admin/templates.ts` — `propagateParToOpeningMirror` + `updatePrepItemContent`.
4. `lib/admin/templates.ts` — `setPrepItemMinRole`.
5. API: list + detail (GET).
6. API: content PATCH (Tier A).
7. API: min-role PATCH (Tier B).
8. i18n `admin.templates.*` EN + ES.
9. UI: section page (list + location switcher).
10. UI: detail page + `PrepTemplateEditor` + `PrepItemEditPanel` (Tier A) + min-role control (Tier B).
11. Final gate: tsc + build + confirm no `_smoke_*` committed.

## Deferred / next slices

- Structural editor: add/remove items, new versions (Path A), `section`/`columns` changes.
- Opening/closing (cleaning-style) template editing.
- Then the rest of the admin capstone: Vendors+Pars → Locations → Audit viewer, plus the
  performance-band filter fast-follow.
