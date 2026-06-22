# Prep Structural Editor — Design (C.44 Admin Module 3, Slice 2)

**Date:** 2026-06-22
**Module:** C.44 admin capstone, Module 3 (Checklist/Prep Templates), **slice 2 of N**
**Builds on:** Prep Template Editor slice 1 (#80, `d2f2313`) + Admin Foundation (#78) + User Management (#79)
**Gate:** `checklist-templates` section = level ≥ 7 (GM+)
**Migration:** NONE

---

## Goal

Let GM+ (level ≥ 7) **structurally** edit prep templates — add items, remove items, change an
item's section — **in place, without a developer running a seed script.** Completes the prep
half of the templates module (slice 1 shipped viewer + in-place content edits).

## Scope (locked with Juan, 2026-06-22)

Decisions captured via one AskUserQuestion round + design approval:

1. **Slice scope:** prep-only (AM + mid-day). Opening/closing task-item editing → slice 3.
2. **Edit semantics:** live in-place. **No Path-A versioning** (see Finding below).
3. **Remove + mirror:** cascade — removing an AM-prep item deactivates its Opening mirror.
   **And symmetry:** add/remove/section-change all keep the Opening mirror in sync (not just edits).
4. **Add-item columns:** section drives columns (fixed per-section convention), not manual.
5. **Add-mirror default:** the "create Opening verification item" toggle defaults **ON** for
   AM-prep adds (opt-out for the items that shouldn't be verified at opening).

### Finding that reshaped the slice (verified live 2026-06-22)

- 68 Opening items mirror AM-prep items via `references_template_item_id`; FK is
  `ON DELETE SET NULL`. 10 closing items auto-complete via `report_reference_type` (5 types).
- AGENTS.md's "removals/structural = new Path-A version" rule was written for **hard deletes.**
  Under append-only **soft-delete (`active=false`) + C.44 snapshots**, in-place is safe (the row
  id persists → historical completions' FK intact). A full Path-A *re-version* of an AM-prep
  template would mint new item ids and **orphan all 68 Opening references** — so re-versioning is
  the dangerous path here, not the safe one. **Therefore: every structural op is an in-place
  mutation; no new versions.**

### In scope (all Tier B — structural = re-auth)

| Operation | Mechanism | Mirror effect (AM-prep only) |
|---|---|---|
| **Add prep item** | INSERT active row via `seedPrepItem` (columns from section convention) | toggle ON → also INSERT Opening Phase-2 mirror referencing the new item |
| **Remove prep item** | `active = false` (soft-delete, never DELETE) | cascade: deactivate the linked Opening mirror |
| **Change item section** | `setPrepItemSection` (syncs station+section) + re-derive columns from new section | update the mirror's mirrored `section` |

Mid-day prep items support add/remove/section-change but have **no** Opening mirror (only AM-prep mirrors).

### Out of scope (later slices / not needed)

- **Path-A versioning** — not needed (in-place is safe; re-versioning would orphan refs).
- **Reorder UI** — already shipped (slice 1's editable `display_order` field).
- **Manual column choice** — rejected; section drives columns.
- **Opening / closing (task-item) editing** — slice 3 (different shape + the report-ref /
  Phase-2 auto-completion blast radius).
- Changing `expects_count`/`expects_photo`, vendor links, `report_reference_type`,
  `references_template_item_id` (other than the managed mirror).

## Ground truth (verified live 2026-06-22)

- `checklist_template_items` cols: id, template_id, station, display_order, label, description,
  min_role_level (numeric default 3), required, expects_count, expects_photo, vendor_item_id,
  active, translations (jsonb), prep_meta (jsonb), report_reference_type (enum),
  references_template_item_id (uuid). **No unique constraint on (template_id, display_order)** —
  reordering/appending is unconstrained.
- FK `references_template_item_id → checklist_template_items(id) ON DELETE SET NULL`. We never
  hard-delete, so soft-deactivating a referenced AM-prep item leaves the mirror's FK pointing at
  an inactive row — hence the cascade rule.
- `prep_meta.section` MUST equal `station` (invariant; `lib/prep.ts narrowPrepTemplateItem` throws
  on drift; `setPrepItemSection` writes both atomically; `seedPrepItem` sets `station = section` by
  construction).
- Per-section column conventions (from `lib/types.ts` PrepColumn docs — the canonical map):
  - Veg: `["par","on_hand","back_up","total"]`
  - Cooks: `["par","on_hand","total"]`
  - Sides: `["par","portioned","back_up","total"]`
  - Sauces: `["par","line","back_up","total"]`
  - Slicing: `["par","line","back_up","total"]`
  - Misc: `["yes_no"]` (default) or `["yes_no","free_text"]` (when "include note field" chosen)
- Opening Phase-2 mirror item shape (`OpeningPhase2Meta`): `prep_meta = { openingPhase2: true,
  section, parValue, parUnit }`, `station = section`, `references_template_item_id = <am-prep item id>`.
- `lib/prep.ts` write helpers: `seedPrepItem(service, { templateId, displayOrder, section, label,
  description, minRoleLevel, required?, meta: Omit<PrepMeta,"section">, translations? }) →
  { templateItemId }`; `setPrepItemSection(service, { templateItemId, section })`.
- `lib/destructive-actions.ts` has `checklist_template_item.update`, `checklist_template_item.delete`
  — but NOT `checklist_template_item.create` (this slice adds it). `.delete` covers the soft-deactivate.
- `lib/admin/templates.ts` (slice 1): service-role data layer with `loadAuthorizedPrepTemplate`
  (IDOR bind, 404), `getPrepTemplateDetail`, `updatePrepItemContent`, `setPrepItemMinRole`, and the
  private `propagateParToOpeningMirror`. This slice extends it.
- API lives at `/api/admin/checklist-templates/[id]/...` (mirrors page path; `[id]`+`[itemId]` segments).

## Architecture

Extends slice 1's `lib/admin/templates.ts` + the existing route tree. Service-role data layer,
app-layer gating, routes self-gate (outside `app/admin/layout.tsx`).

### Data layer (`lib/admin/templates.ts`)

- **`syncOpeningMirror`** (private; generalizes slice-1's `propagateParToOpeningMirror`) — the single
  place that touches the Opening mirror, with three operations:
  - `create({ amPrepItemId, locationId, section, parValue, parUnit, label, translations,
    minRoleLevel, required })` → resolve active opening template at location; INSERT a Phase-2 item
    (`prep_meta = { openingPhase2:true, section, parValue, parUnit }`, `station=section`,
    `references_template_item_id = amPrepItemId`, label/translations mirrored, appended display_order);
    returns the mirror id (or null if no active opening template).
  - `deactivate({ amPrepItemId, locationId })` → set `active=false` on opening items whose
    `references_template_item_id = amPrepItemId` (active) at that location; returns affected ids.
  - `setSection({ amPrepItemId, locationId, section })` → update the mirror's `prep_meta.section`
    (and `station`) to the new section; returns affected ids.
  Slice-1's par propagation stays (or folds into a `setPar` op on this helper — implementer's call,
  keep behavior identical).
- **`addPrepItem(actor, { templateId, input })`** — `loadAuthorizedPrepTemplate` (IDOR + type=prep) →
  validate input (section ∈ 6 enum; label EN non-empty; par non-negative-or-null; minRole 0–10) →
  derive columns from section convention → `seedPrepItem` (appends `display_order = max+1`) →
  if template is `am_prep` AND `createOpeningMirror` → `syncOpeningMirror.create` →
  audit `checklist_template_item.create` (+ mirror id in metadata).
- **`removePrepItem(actor, { templateId, itemId })`** — `loadAuthorizedPrepTemplate` → load item
  (by id+template_id+active) → `active=false` → if `am_prep` → `syncOpeningMirror.deactivate` →
  audit `checklist_template_item.delete` (+ deactivated mirror ids).
- **`changePrepItemSection(actor, { templateId, itemId, section })`** — `loadAuthorizedPrepTemplate`
  → load item → `setPrepItemSection` (syncs station+section) → re-derive + write columns for the new
  section (merge into `prep_meta` via the existing prep_meta write path; preserve par/unit/specialInstruction)
  → if `am_prep` → `syncOpeningMirror.setSection` → audit `checklist_template_item.update`
  (metadata.field=`section`, before/after).
- **`SECTION_COLUMNS`** — exported const map (the per-section convention above) + a
  `columnsForSection(section, includeNote?)` helper. Single source so add + change-section agree.
- All new ops are **Tier B**. `AdminTemplateError` reused.

### API routes (under `/api/admin/checklist-templates/[id]`)

- `POST /items` — add item (Tier B). Body: `{ section, parValue, parUnit, label, labelEs,
  description, descriptionEs, specialInstruction, specialInstructionEs, minRoleLevel, required,
  includeNote?, createOpeningMirror? }`.
- `DELETE /items/[itemId]` — remove item (Tier B). (Method DELETE for clarity; soft-deactivates.)
- `PATCH /items/[itemId]/section` — change section (Tier B). Body: `{ section }`.

Each: `requireSession → level≥7 → assertStepUp("B") → AdminTemplateError → jsonError`. The lib
layer does the IDOR bind via `loadAuthorizedPrepTemplate`.

### UI (`components/admin/templates/`)

- `PrepTemplateEditor` gains an **"+ Add item"** affordance (one per section header, pre-selecting
  that section) → opens an `AddPrepItemForm` (section picker, par/unit, label/description/special-
  instruction EN+ES, min role, required, Misc "include note field", and for AM-prep templates the
  "create Opening verification item" checkbox default ON). Submits via `requestStepUp("B")` → POST.
- `PrepItemEditPanel` gains a **Remove** control (Tier B, confirm) and a **section** `<select>`
  (the 6 enum) wired to the section PATCH (Tier B). Both pessimistic, error-surfacing, `router.refresh()`.

## Authorization

- Section page + every route: level ≥ 7 (GM+), enforced independently.
- All structural ops: **Tier B** (`assertStepUp(ctx, "B")`).
- IDOR location-bind via `loadAuthorizedPrepTemplate` (GM/MoO location-scoped; `ALL_LOCATIONS_THRESHOLD=9`);
  unauthorized → 404. The mirror helper operates at the already-authorized `location_id`.
- Service-role writes; RLS stays the end-user boundary.

## Audit

- New action `checklist_template_item.create` (added to `lib/destructive-actions.ts`; destructive
  auto-derives). Metadata: `template_id`, `prep_subtype`, created item id, `created_opening_mirror_id`.
- Remove → `checklist_template_item.delete`; metadata: `template_id`, `prep_subtype`,
  `deactivated_mirror_ids`.
- Section change → `checklist_template_item.update`; metadata: `field:"section"`, before/after,
  `mirror_synced_ids`.
- Before/after live **inside `metadata`** (the `audit()` helper has no `beforeState`/`afterState`).
  No secrets (template config is non-secret).

## i18n

`admin.templates.*` extended EN + ES at parity — add-item form fields/labels, section picker,
remove confirm, Misc note toggle, the "create Opening verification item" label, new error codes
(`invalid_section`, `item_in_use` if any block path is added). Spanish operational/tú-form.

## Error handling

- Unknown/non-prep template or unauthorized location → 404 (via `loadAuthorizedPrepTemplate`).
- Unknown item → 404. Invalid section (not in enum) → 400 `invalid_section`. Invalid par/min-role
  → 400 (reuse slice-1 codes). Empty label → 400 `invalid_label`.
- No active opening template when creating a mirror → mirror create is a graceful no-op (returns
  null id); the add still succeeds. Same no-op posture as slice-1 propagation.
- Step-up missing/stale → 403 `step_up_required`/`step_up_stale`.
- `setPrepItemSection` `PrepInvariantError` (only on a drift bug) → 500, surfaced not swallowed.

## Testing

No framework → `tsc --noEmit` + `next build` + throwaway `tsx` smokes (`scripts/_smoke_*.ts`,
`npx tsx --env-file=.env.local`, **deleted before commit**). Smoke (disposable service-role rows,
hard-deleted after):

1. Create a disposable `am_prep` template + an `opening` template at a location.
2. `addPrepItem` (am_prep, createOpeningMirror=true) → read back: prep item exists with
   section-derived columns; an Opening mirror item exists referencing it
   (`references_template_item_id` set, `openingPhase2:true`, mirrored par/section).
3. `changePrepItemSection` → prep item section+station+columns updated; `narrowPrepTemplateItem`
   passes; mirror section updated.
4. `removePrepItem` → prep item `active=false`; mirror `active=false`.
5. Mid-day path: `addPrepItem` on a mid-day template creates NO mirror.
6. Audit rows emitted for create/update/delete. Hard-delete all test rows.

Juan preview-smoke: add a real prep item (toggle on) → appears on the next AM-prep load AND a
verification row appears on the Opening sheet; change its section → re-buckets in both; remove it →
gone from both; a non-GM can't reach the surface.

## Build order (for the plan)

1. `lib/destructive-actions.ts` — add `checklist_template_item.create`.
2. `lib/admin/templates.ts` — `SECTION_COLUMNS` + `columnsForSection`; generalize the mirror helper
   to `syncOpeningMirror` (create/deactivate/setSection), preserving slice-1 par propagation.
3. `lib/admin/templates.ts` — `addPrepItem` (+ mirror create).
4. `lib/admin/templates.ts` — `removePrepItem` (+ mirror deactivate).
5. `lib/admin/templates.ts` — `changePrepItemSection` (+ columns re-derive + mirror section). Smoke here.
6. API: `POST /items` (Tier B).
7. API: `DELETE /items/[itemId]` (Tier B).
8. API: `PATCH /items/[itemId]/section` (Tier B).
9. i18n `admin.templates.*` additions EN + ES.
10. UI: `AddPrepItemForm` + "+ Add item" affordance.
11. UI: Remove control + section picker on `PrepItemEditPanel`.
12. Final gate: tsc + build + no `_smoke_*` committed.

## Deferred / next

- Slice 3: opening/closing task-item editing (with the report-ref / Phase-2 auto-completion wiring).
- Then: Vendors+Pars → Locations → Audit viewer → performance-band filter fast-follow.
