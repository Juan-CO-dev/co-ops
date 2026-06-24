# Full Definition on the Item — Design (Item/Inventory Spine, sub-slice B)

**Date:** 2026-06-23
**Arc:** Item/Inventory Spine — the "full definition" family. Builds on 2B′ (3-tab admin, #84) + sub-slice A (sections first-class, #85).
**Trigger:** The 2B′ 3-tab move stripped the location tab to **par + enable/disable** (Juan's rule: "anything other than par and enable/disable is global only"). That left **special instruction, required, min-role, and section-placement** with **no edit home** — currently view-frozen. This slice restores their editing on the **Global tab**, applied everywhere.
**Migration:** YES — add 4 canonical columns to `items` + backfill from existing lines.

---

## Principle (Juan, locked)
**Location tabs = par + enable/disable ONLY. Everything else is GLOBAL** (Global tab). This slice moves the *editing* of special instruction / required / min-role / section onto the item (Global tab), applying to every location.

## Approach (Juan-chosen): item canonical + propagate to lines

These fields are read by **operator + core gating** code that runs across opening/closing/prep and reads them **per line** (`min_role_level` drives completion gating in `lib/checklists.ts`; `special_instruction`/`station` flow through `resolveTemplateItemContent`). A literal "move columns + re-point reads" would refactor that core gating and create an item-backed-vs-not split-brain. So instead:

- The **item carries the canonical value** (new columns) — the source for new-line inheritance + the Global-tab edit target.
- A Global-tab edit **writes the item canonical AND propagates the value to every active line of that item** (all locations + opening mirrors).
- **Operator + gating reads stay per-line, unchanged** (low-risk). Newly-enabled/propagated lines **inherit from the item canonical**.

Same propagation pattern as `setItemDefault` (2B′). Append-only-friendly: line propagation is in-place config update; frozen C.44 snapshots are untouched.

## Scope

### In scope — these item fields, Global-tab editing + propagation
1. **`special_instruction` + `special_instruction_es`** — prep instruction (today `prep_meta.specialInstruction` + `translations.es.specialInstruction`).
2. **`required`** — must-complete flag (today `checklist_template_items.required`).
3. **`min_role_level`** — who-can-complete floor (today `checklist_template_items.min_role_level`; read by core gating).
4. **section-placement (re-section)** — moving an item to a different section. `items.section` already exists; this propagates a section change to every line (station + `prep_meta.section` + **re-derived columns** from `prep_sections`) + opening mirrors.

### Read/gating paths — UNCHANGED
Operator render (PrepRow, section components), `resolveTemplateItemContent`, and the completion gating in `lib/checklists.ts` keep reading the **line** values. This slice only adds an item canonical + a propagating write path + new-line inheritance.

### Out of scope / deferred
- Add/remove sections UI (the other remaining piece; `prep_sections` supports it).
- Per-location overrides of these fields (they're global by Juan's rule — no per-location special instruction/min-role).
- Vendors/SKU, ordering, etc. (later spine steps).

## Ground truth (verified live 2026-06-23)
- `items` (migrations 0079/0081): id, location_id, kind, name, name_es, **section**, default_par, default_par_unit, unit, notes, is_default, active, audit. **No** special_instruction / min_role / required yet.
- `min_role_level` read per-line across `lib/checklists.ts` (completion gate `actor.level < item.min_role_level` → ChecklistRoleViolationError; finalize role-sufficiency; picker candidate filter) — opening/closing/prep. Must stay line-sourced.
- `special_instruction` resolved via `lib/i18n/content.ts resolveTemplateItemContent` (prep_meta.specialInstruction + es) — operator + closing render.
- `required` is `checklist_template_items.required`.
- Section change today = `changePrepItemSection` (lib/admin/templates.ts) — was on the location tab (now stripped); re-derives `prep_meta.columns` + syncs the opening mirror. Generalize it to all the item's lines across locations.
- New-line creation: `ensureItemLineOnTemplate` / `addPrepItem` set `specialInstruction: null`, `min_role_level` via `resolveDefaultMinRole` (sibling-read), `required: false` — these become **inherit from the item canonical**.
- Columns now sourced from `prep_sections` (sub-slice A) — section re-derive reads the table.

## Schema — `items` new columns (migration 0083)
| Column | Type | Notes |
|---|---|---|
| `special_instruction` | text NULL | canonical EN prep instruction. |
| `special_instruction_es` | text NULL | canonical ES. |
| `min_role_level` | int NULL | canonical who-can-complete floor (NULL = no item canonical; new lines fall back to a default). |
| `required` | boolean NOT NULL default false | canonical must-complete. |

Backfill: for each item, copy from a **representative active line** (prefer the AM-prep line, else any active line): `special_instruction` ← `prep_meta.specialInstruction`, `special_instruction_es` ← `translations.es.specialInstruction`, `min_role_level` ← line `min_role_level`, `required` ← line `required`. (`section` already on items from SP1.) No-op for reads (lines unchanged).

## Architecture

### Lib — extend the item-definition write + propagate
- Extend `updateRegistryItemDefinition` (or a sibling `setItemFullDefinition`) in `lib/admin/templates.ts` to accept `specialInstruction`/`specialInstructionEs`/`required`/`minRoleLevel`/`section`. It:
  1. Updates the **item** canonical columns.
  2. **Propagates to every active line** of the item (all locations + opening mirrors): `special_instruction`/`es` → `prep_meta.specialInstruction` + `translations.es.specialInstruction`; `required` → line `required`; `min_role_level` → line `min_role_level`; `section` → station + `prep_meta.section` + **re-derived `prep_meta.columns`** (reuse the `changePrepItemSection` re-derive + mirror-sync logic, generalized across the item's lines).
  3. Audits `item.update` with the changed fields + propagated line count.
- New-line inheritance: `ensureItemLineOnTemplate` + `addPrepItem` copy the item's canonical `special_instruction`/`min_role_level`/`required` (replacing `null`/`resolveDefaultMinRole`/`false`). `addRegistryItem` accepts these at create time (so GM+ create sets the full definition).

### Route — Global-tab definition (MoO+)
- Extend `PATCH /api/admin/checklist-templates/registry/[itemId]` (the item-keyed definition route, MoO+ ≥8, Tier B) to accept the new fields → the extended writer. **Authority flag below.**

### UI — Global-tab item definition
- The Global tab's item-edit (RegistryRow) gains: special instruction EN/ES, required checkbox, min-role input, section select (re-section). A "applies to this item on every location" note. Save → the extended definition route.

## Authorization (locked — Juan: "GMs add one time, MoO+ manages")
The rule across the registry: **CREATE = GM+ (≥7); EDIT/manage = MoO+ (≥8).**
- **Create (GM+):** `addRegistryItem` stays GM+ and is **extended to accept the full definition at create time** — name/name_es, section, recommended par/unit, **special_instruction/es, required, min_role**, is_default. A GM stands up a complete item once.
- **Edit (MoO+):** the Global-tab item-definition edit (name/par + the new special_instruction/required/min_role/section) is **MoO+**, via the item-keyed definition route (already MoO+). Consistent with the shipped definition-edit / set-default / promote / section-rename (all MoO+).

This matches everything already shipped — no re-gating of existing routes; only `addRegistryItem` gains the extra create-time fields (still GM+), and the MoO+ definition route gains the extra edit fields.

## Verification
- `tsc` + `next build` clean; migration 0083 applied + captured.
- Backfill: every item's canonical = its representative line's values (no-op for reads).
- Throwaway smoke (deleted): edit special instruction / required / min-role on the Global tab → propagates to ALL the item's lines (both locations + opening mirror); operator AM-prep/mid-day/closing render + completion gating reflect it; re-section an item → all its lines move section + columns re-derive + mirror follows; frozen historical snapshots unaffected; a newly-enabled line inherits the item canonical.
- Operator smoke (Juan, preview): set a special instruction on an item (Global tab) → shows on both locations' prep sheets; change min-role → gating changes everywhere; re-section an item → it moves on every list.

## Build order (for the plan)
1. Migration 0083 (items += 4 cols) + backfill from representative lines + capture.
2. Lib: extend the definition writer + propagation (special_instruction/required/min_role scalar propagation + section re-derive generalized) + new-line inheritance (ensureItemLineOnTemplate/addPrepItem/addRegistryItem).
3. Route: extend the registry definition PATCH to accept the fields.
4. UI: Global-tab item-edit fields (special instruction EN/ES, required, min-role, section) + i18n.
5. Throwaway smoke + final gate.

## Deferred / next
- **Add/remove sections UI** (the remaining "section" piece).
- Then vendors/SKU admin → ordering → receiving → on-hand → cost/yield → global aggregate → Toast auto-par.
