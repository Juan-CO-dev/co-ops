# Registry Goes Live (par + name) — Design (Item/Inventory Spine, Sub-project 2A)

**Date:** 2026-06-23
**Arc:** Item/Inventory Spine — step 2, slice **2A** of 2A→2B→2C. Parent arch: `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md`. Builds on sub-project 1 (PR #82, `094c634`).
**Goal:** Make the **item registry the source of truth for prep-line par + name** — reports read them from the item, admin edits them on the item (so an edit shows on every list the item is on), and the slice-1/2 par-propagation helper retires.
**Migration:** None (uses the `items` table + `item_id` bridge from migration 0079).

---

## The headline + the safety spine

This is where the registry **stops being invisible**: editing one item's par/name updates AM-prep, mid-day, and Opening for that item — by construction, because they all reference the same item.

It touches the **every-morning operator read path**, so the safety spine is: the backfill made `item.default_par == prep_meta.parValue` and `item.name == label` for every linked line, so the cutover **renders identically the day it ships**. A pre-flight **equality check** proves that (flags any drift) before/at the flip; edits only start changing what's shown *after* cutover. The change is reads-source + admin-write-target only — reversible by reverting the loader change.

## Scope

### In scope — item owns **par + name**
- **`default_par` / `default_par_unit`** and **`name` / `name_es`** are resolved from the **item** (via `checklist_template_items.item_id`) in:
  1. `loadAmPrepState` + `loadMidDayPrepState` (lib/prep.ts) — the displayed name/par.
  2. `loadOpeningState` Phase-2 snapshot materialization (lib/opening.ts) — the `par_value` fed into `opening_closer_count_snapshots` (today sourced from the opening line's `prep_meta.parValue` mirror).
  3. The **C.44 submit snapshots** (`submitAmPrep`, `submitMidDayPhase1`, and the opening submit path) — `itemName` + `parValue` frozen from the resolved item, so history records what was shown.
- **Admin editing** (lib/admin/templates.ts): the editor's **par + name** fields write the **item** (resolve the line's `item_id` → update `items.default_par`/`default_par_unit`/`name`/`name_es`). One edit → every list.
- **Retire `propagateParToOpeningMirror`** + its call in `updatePrepItemContent` (redundant: the opening line reads the same item).
- A shared resolver `resolveLineDefinition(line, item)` so display + snapshot agree.

### Stays line-level for now (→ later slices; "full definition in slices" per Juan)
- `section` (+ the slice-2 `setOpeningMirrorSection` section-sync stays), `special_instruction`, `required`, `display_order`, `min_role_level`, structural add/remove. These keep their slice-1/2 line-level paths unchanged. A later slice (2A′ / folded into 2B) cuts `section` + `special_instruction` over to the item to reach **full definition**.

### Out of scope
Per-location par overrides, `par_mode`, the layered par resolver, SKU par — all **2B**. Mid-day add-from-registry picker — **2C**.

## Ground truth (verified live 2026-06-23)
- Every active prep + opening-Phase2 line has a non-null `item_id` (sub-project 1 backfill; 87 items / 174 lines). `item.default_par == prep_meta.parValue` and `item.name == label` today (backfill copied them; nothing has edited prep_meta since #82).
- `lib/prep.ts`: `loadAmPrepState` (line ~602) + `loadMidDayPrepState` load template items via `TEMPLATE_ITEM_COLUMNS` → `rowToTemplateItem` → `narrowPrepTemplateItem`; the form reads `prepMeta.parValue` + `label`. Submit builds the C.44 snapshot from `item.prepMeta` (`section`/`itemName`/`parValue`).
- `lib/opening.ts`: `loadOpeningState` (line ~619) builds `snapshotsJson` for Phase-2 items from `(it.prepMeta as OpeningPhase2Meta).parValue` (line ~702-714) → `create_opening_instance_atomic` → `opening_closer_count_snapshots`. The opening **par** is this mirror value (closer COUNT comes separately from the AM-prep completion). `CloserCountSnapshot.parValue` is "Par at AM Prep submission time."
- `lib/admin/templates.ts`: `updatePrepItemContent` edits `prep_meta` (par/instruction) + line `label`/`translations`, and calls `propagateParToOpeningMirror` on AM-prep par change. `setPrepItemMinRole`, `changePrepItemSection`, `setOpeningMirrorSection` exist (slice 2).
- `items` has `default_par`, `default_par_unit`, `name`, `name_es` (migration 0079). `item_id` FK on `checklist_template_items`.

## Architecture

### Resolver (new, lib)
```
resolveLineDefinition(line, item) -> { name, nameEs, par, parUnit }
```
- When `item` present: `name = item.name`, `nameEs = item.nameEs`, `par = item.defaultPar`, `parUnit = item.defaultParUnit`.
- Defensive fallback (item missing/null): the line's `prep_meta.parValue`/`parUnit` + `label`/`translations.es.label`. (Shouldn't fire for prep/opening lines post-backfill; logged if it does.)
- Pure function over an already-loaded line + item. Lives in lib/prep.ts (or a small lib/items.ts) — implementer's call; keep it pure + shared by loaders + submit.

### Loaders (read cutover)
- `loadAmPrepState` / `loadMidDayPrepState`: after loading template items, **batch-load the linked items** (`select ... from items where id in (item_ids)`), build an `itemById` map, and apply `resolveLineDefinition` so the `ChecklistTemplateItem` surfaced to the form carries the item's name/par. (Mechanically: override `label`/`prepMeta.parValue`/`prepMeta.parUnit` on the mapped item from the resolver, OR thread a resolved field — keep the form's existing prop shape so the client is untouched.)
- `loadOpeningState`: the `snapshotsJson` `par_value` for each Phase-2 item resolves from its linked item's `default_par` (batch-load items for the Phase-2 line `item_id`s) instead of `meta.parValue`.

### Submit snapshots (C.44 history)
- `submitAmPrep` / `submitMidDayPhase1` / opening submit: the frozen `itemName`/`parValue` come from `resolveLineDefinition` (the item), so the snapshot matches what was displayed. (Section stays from `prepMeta.section` for now.)

### Admin editing (lib/admin/templates.ts)
- `updatePrepItemContent`: the **par + name** branch resolves `line.item_id` → updates `items` (`default_par`/`default_par_unit`/`name`/`name_es` + `updated_by`/`updated_at`). The line's `prep_meta.parValue`/`label` are no longer the write target for these fields. Other fields (special instruction, required, display order) still write the line. Audit `checklist_template_item.update` gains `item_id` + which item-fields changed.
- **Remove** `propagateParToOpeningMirror` + its call (dead once par is item-sourced). Keep `resolveActiveOpeningTemplateId` only if still used by section-sync; otherwise remove. `setOpeningMirrorSection` stays (section is still line-level + mirrored this slice).
- UI (`PrepItemEditPanel`): the par + name (EN/ES) inputs now save to the item; a small "edits this item everywhere it's used" affordance/label so the GM knows the scope. Special-instruction/required stay as-is.

### Pre-flight equality check
- A committed check (script or a loader-time dev assertion) querying: for every active prep/opening-Phase2 line, `item.default_par IS DISTINCT FROM (prep_meta->>'parValue')::numeric` OR `item.name <> label`. Expect **0 rows** before cutover. Run it as part of verification; if non-zero, re-sync (re-run the sub-project-1 backfill is idempotent) before flipping.

## Data flow — a par edit (post-cutover)
1. GM edits "Veg leafy mix" par 6→8 in `/admin/checklist-templates`.
2. `updatePrepItemContent` resolves the line's `item_id` → `items.default_par = 8`.
3. Next AM-prep load: `resolveLineDefinition` returns par 8 (from the item). Mid-day + Opening for that item: par 8 too (same item). Edit-once-everywhere. ✓
4. On submit, the C.44 snapshot freezes par 8. Yesterday's reports keep their frozen values.

## Authorization / audit
- Admin editing stays GM+ (≥7), Tier A content edit (per slice 1). Item writes are service-role + app-gated, same as today. Audit `checklist_template_item.update` records `item_id` + changed item-fields + before/after (in metadata, per the established `audit()` shape).

## Verification
- `tsc --noEmit` + `next build` clean.
- **Equality check returns 0** (cutover is a no-op today).
- Throwaway smoke (deleted): edit an item's `default_par`/`name` → `loadAmPrepState`/`loadMidDayPrepState`/`loadOpeningState` for every list carrying that item reflect the new value; a second list updates without a second edit (edit-once-everywhere); the submit snapshot freezes the resolved value.
- Operator smoke (Juan, preview): AM-prep / mid-day / Opening render identically to prod **before** any edit; after editing an item's par in admin, it shows on all its lists.

## Build order (for the plan)
1. `resolveLineDefinition` resolver (pure, + unit-ish smoke).
2. Equality-check script (`scripts/check-item-prepmeta-parity.ts`, committed) → run, expect 0.
3. Loader read cutover: `loadAmPrepState` + `loadMidDayPrepState` (batch-load items + resolve).
4. Loader read cutover: `loadOpeningState` Phase-2 `par_value` from item.
5. Submit-snapshot cutover: `submitAmPrep` / `submitMidDayPhase1` / opening submit.
6. Admin editing: `updatePrepItemContent` par+name → item; retire `propagateParToOpeningMirror`; UI label.
7. Throwaway edit-once-everywhere smoke (deleted before commit).
8. Final gate: tsc + build + equality check 0 + diff scoped.

## Deferred / next
- **2A′ (or folded into 2B):** cut `section` + `special_instruction` over to the item → **full definition** owned by the item (line keeps only placement).
- **2B:** par layer — per-location/per-day item par + SKU par (two distinct pars per Juan) + `par_mode` + layered resolver, AGM+.
- **2C:** mid-day add-from-registry picker.
