# Units Registry + Dropdown — Design (Item/Inventory Spine, units slice)

**Date:** 2026-06-23
**Arc:** Item/Inventory Spine — admin standardization. Builds on the 3-tab admin (#84), sections first-class (#85), full definition on the item (#86).
**Trigger:** Juan — par units are free text today and drift ("1/3 pan" / "1/3rd pan" / "3rd Pan" are the same unit; `QT`, `BTL` are inconsistent). Make units a **first-class registry** with a **dropdown** (+ add-new) so entry can't drift, and **normalize** the existing mismatches. General principle: enumerate recurring categorical free-text via registries.
**Migration:** YES — new `units` table + seed + normalize existing `par_unit` values.

---

## Decisions (Juan-locked)
- **Canonical units (spelled out):** `1/3 Pan`, `Quart`, `Bottle`, `Piece`, `Bag`, `Logs`, `Min`, `Bundle`. (Full words read clearer for staff.)
- **Add/curate units = MoO+ (≥8)**; GM+ and below **pick from the list** (no free entry).
- **Unit is a global item attribute** (not a per-location/par value), per "everything except par + enable/disable is global": the unit dropdown lives on the **item (Global tab)**; the par grid shows the item's unit **read-only** (no per-location unit override — prevents two locations drifting to different units for the same item).
- **Bundle** is seeded + available; it's used for meats (except turkey/roast beef which are 1/3 Pan). No existing value maps to Bundle automatically — Juan assigns it to the specific meat items via the unit dropdown after ship (we don't auto-detect "which items are meats").

## The drift (verified live 2026-06-23)
`1/3 pan`(10) + `1/3rd pan`(2) + `3rd Pan`(1) → **1/3 Pan**; `QT`(57) → **Quart**; `BTL`(61) → **Bottle**; `Piece`(6) → **Piece**; `BAG`(5) → **Bag**; `LOGS`(5) → **Logs**; `min`(2) → **Min**. (Only the three pan variants are a true same-thing collision; the rest are casing/spelling.)

## Scope

### In scope
1. **`units` table** (new): `id`, `label` (the canonical display = the stored value), `active`, `display_order`, audit. Seed the 8 canonical units.
2. **Normalize backfill:** map every existing `par_unit` string (in `items.default_par_unit`, `item_par_levels.par_unit`, `checklist_template_items.prep_meta.parUnit`) to its canonical label per the table above.
3. **Unit dropdown on the item (Global tab):** item create (`AddGlobalItem`) + edit (`RegistryRow`) — `default_par_unit` becomes a `<select>` from the registry. **Add-new-unit** affordance (MoO+) — inline "add a unit" that inserts a `units` row.
4. **Par grid:** show the item's unit **read-only** (drop the editable `parUnit` input). Resolver uses `item.default_par_unit` (drop the override-unit branch); `item_par_levels.par_unit` becomes vestigial (stop writing it).
5. **Add-local-item form** (`AddPrepItemForm`): unit `<select>` from the registry.

### Out of scope / deferred
- `vendor_items.unit` / `unit_size` (SKU units) — separate, in the vendors/ordering arc. (Could share the same registry later.)
- Add/remove **sections** UI (the other pending admin piece).
- Auto-assigning Bundle to meat items (Juan does it via the dropdown post-ship).
- Unit conversions (Quart→oz etc.) — far-future cost/yield concern.

## Ground truth (verified live)
- `par_unit` is free text in 3 places: `items.default_par_unit`, `item_par_levels.par_unit`, `checklist_template_items.prep_meta.parUnit`. Distinct values above.
- It's **display/data only** — NOT matched in gating/grouping logic — so storing the canonical label directly (no separate stable code) is safe (unlike sections, whose key is matched in code).
- Resolver `resolveLineDefinition` currently: `parUnit = override?.parUnit ?? item.defaultParUnit`. → becomes `item.defaultParUnit` (unit is item-global).
- Admin UI unit inputs today: `RegistryRow`/`AddGlobalItem` (recommendedParUnit/default_par_unit), `ParGrid` (parUnit), `AddPrepItemForm` (parUnit).
- Operator render shows the stored par + unit string (e.g. "6 Quart") — unaffected (reads the normalized stored value).

## Schema — `units` (new, migration 0084)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `label` | text NOT NULL UNIQUE | canonical display = the value stored in par_unit fields. |
| `active` | boolean NOT NULL default true | disable, never delete. |
| `display_order` | int NOT NULL default 0 | |
| audit cols | | |
- Seed the 8 canonical units. RLS: enable; `_no_user_delete USING(false)`; deny end-user DML (service-role + app-gate; loaders read via service-role).

## Architecture
- **`lib/units.server.ts`** `loadUnits(service)` → ordered active units (label list). (Pure helper if needed for client.)
- **Normalize backfill** (`scripts/backfill-units-normalize.ts`, committed, idempotent): a canonical map applied to the 3 par_unit columns. Re-runnable.
- **Resolver:** `resolveLineDefinition` parUnit → `item.defaultParUnit` (drop the override branch). `setItemPar`/the par grid stop writing `item_par_levels.par_unit`.
- **`loadChecklistAdminView`** returns `units: { label }[]` (active, ordered) for the dropdowns.
- **Admin write:** the item-definition routes (create GM+ / edit MoO+) already carry `recommendedParUnit`/`default_par_unit` — the value is now a registry label (validate it exists in `units`, or accept + the dropdown constrains). New `setUnit`/`addUnit` (MoO+) for the add-new affordance: `POST /api/admin/checklist-templates/units` → insert a `units` row; audit `unit.create`.

## Authorization
- Pick a unit (on item create/edit) — follows the item-definition gate (create GM+ / edit MoO+).
- **Add a new unit** to the registry — **MoO+ (≥8)**, Tier B. Audit `unit.create` (+ in `lib/destructive-actions.ts`).

## Verification
- `tsc` + `next build` clean; migration 0084 applied + captured; normalize backfill run (idempotent) → all par_unit values are canonical; distinct-units query returns only the 8.
- Operator smoke (Juan, preview): prep sheets show normalized units (e.g. all pan variants now "1/3 Pan", "Quart" not "QT"); item create/edit unit is a dropdown; add a new unit (MoO+) → appears in the dropdown; par grid shows the item's unit read-only.

## Build order (for the plan)
1. Migration 0084 (`units` + seed 8) + `unit.create` audit action + capture.
2. Normalize backfill script (map the 3 columns) + run.
3. Lib: `loadUnits`; `loadChecklistAdminView` returns units; resolver parUnit → item-only; stop writing `item_par_levels.par_unit`; `addUnit` (MoO+).
4. Route: `POST /units` (add-new, MoO+).
5. UI: unit `<select>` on `RegistryRow` + `AddGlobalItem` + `AddPrepItemForm`; par grid unit read-only; add-new-unit inline affordance; i18n.
6. Throwaway smoke + final gate.

## Deferred / next
- Add/remove **sections** UI. Then vendors/SKU admin (could fold SKU units into this registry) → ordering → …
