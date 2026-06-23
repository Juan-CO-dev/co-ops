# The Par Layer — Design (Item/Inventory Spine, Sub-project 2B)

**Date:** 2026-06-23
**Arc:** Item/Inventory Spine — step 2, slice **2B**. Parent arch: `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md`. Builds on 2A (PR #83, `27662e1`).
**Goal:** Turn the per-location item registry into a **global-canonical registry with a per-location/per-day par override layer**. One global item holds the canonical name + a *recommended* par; each location takes the recommendation, sets its own number, or (later) goes auto — per day of week. Rename once → every location updates. Fold in the pressing `addPrepItem` registry-backing fix.
**Migration:** YES — new `item_par_levels` table (DDL) + a separate idempotent backfill (dedup + cutover).

---

## The headline + the safety spine

2A made each location's prep lines read par + name from their *own* item row (87 location-owned items, 0 global). "Edit once everywhere" therefore holds **within** a location but not **across** locations: renaming "Veg mix" at MEP leaves EM untouched.

2B closes that gap. It introduces a **two-layer par model**:

- a **global item** (`items.location_id = NULL`) carrying the canonical **definition** (name, section) and a `default_par` that acts as the **system recommendation**, and
- an **`item_par_levels`** override layer keyed `(item_id, location_id, day_of_week)` carrying each location's actual `par_value` + a `par_mode` (`inherit` / `manual` / `auto`).

Because it re-points `checklist_template_items.item_id` on the **every-morning operator flow**, the safety spine is identical to 2A's: a committed, idempotent backfill seeds the override rows from each line's *current* resolved par, so the resolver returns **today's exact numbers** the day it ships. A committed **parity check** proves 0 drift before the cutover flips; edits only start changing displayed pars *after* cutover. Reversible by reverting the loader/resolver change.

## Scope

### In scope
1. **`item_par_levels` table** (new) — the per-location/per-day par override + `par_mode`.
2. **Global vs location-owned items** — `items.location_id = NULL` means global (canonical definition + recommendation); SET means location-owned (not yet adopted). No schema change to `items` (the column already exists); 2B gives it meaning + the backfill creates globals.
3. **Backfill** — dedup the 87 location items by normalized `(name, section)`: appears at **both** locations → one **global** item + two `item_par_levels` rows (`manual`, seeded from each location's current `default_par`); appears at **one** location → stays **location-owned** + one override row. Re-point every contributing line's `item_id`. Emit a merge manifest.
4. **Resolver cutover** — `resolveLineDefinition` resolves **name from the (global) item** and **par from the override layer**, day-aware, with the layered fallback. Loaders pass the operational day-of-week; submit snapshots freeze the resolved day-specific par.
5. **Admin editing**:
   - Per-location, per-day par grid + `par_mode` toggle → writes `item_par_levels` (**AGM+ ≥6**).
   - Global name/section/recommendation edit → writes the global `items` row (**MoO+ ≥8**).
   - Create a **location-owned** item (**AGM+**); **promote to global** = flip `location_id`→NULL (**MoO+**).
6. **`addPrepItem` registry-backing** — live-added prep items create a real `items` row (location-owned by default) + set `item_id` + seed one `item_par_levels` row, replacing the resolver fallback for new adds.

### Stays as-is (later slices)
- `section` + `special_instruction` stay line-level (full-definition-on-item is a later slice, per "full definition in slices").
- **SKU par** (`vendor_items` / dormant `par_levels`) — untouched; it gets a consumer in the ordering slice (step 4). 2B is **item par only**.
- `par_mode = 'auto'` resolves to the recommendation for now; Toast velocity wiring is step 9.
- Per-location *disable* of a shared item is already expressible via the line's `active = false` (lines are per-location) — no extra flag.

### Out of scope
BOM/composite items, food cost, yield, ordering, receiving, on-hand, global aggregate — all later spine steps.

## Ground truth (verified live 2026-06-23)
- `items`: 87 rows, **all location-owned** (`location_id` SET), 0 global, across 2 locations, 77 with `default_par`. Columns incl. `location_id` (nullable), `kind`, `name`, `name_es`, `section`, `default_par`, `default_par_unit`, `unit`, `active`, audit cols.
- `par_levels` (dormant, empty): `location_id NOT NULL`, `vendor_item_id NOT NULL`, `par_value NOT NULL`, `day_of_week int NULL`, `active`, `updated_at/by` — **SKU-shaped**, no `item_id`, no `created_at`. Left untouched.
- `lib/items.ts`: `resolveLineDefinition(line, item)` (name/par from item, fallback to prep_meta) + `loadItemDefns`. 2B extends this with overrides + day.
- `lib/prep.ts`: `loadAmPrepState` / `loadMidDayPrepState` batch-load items + apply `resolveLineDefinition`, return `templateItems` with overridden label/par. `submitAmPrep` / `submitMidDayPhase1` freeze the resolved `itemName`/`parValue` into the C.44 snapshot.
- `lib/opening.ts`: `loadOpeningState` resolves Phase-2 snapshot `par_value` from the linked item's `default_par`.
- `lib/admin/templates.ts`: `updatePrepItemContent` (par+name now write the item, 2A), `addPrepItem` (still creates lines with `prep_meta` par + **no `item_id`** — the fix target), `createOpeningMirror`/`deactivateOpeningMirror`/`setOpeningMirrorSection`/`resolveActiveOpeningTemplateId` (section + mirror paths, kept).

## Schema — `item_par_levels` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `item_id` | uuid NOT NULL | FK → items (global or location-owned). |
| `location_id` | uuid NOT NULL | FK → locations. The location this par applies to. |
| `day_of_week` | int NULL | 0–6 (0 = Sunday, matching JS `getDay()`); **NULL = all-days base**. CHECK `day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6`. |
| `par_value` | numeric NULL | the location's par for this item/day. NULL allowed (e.g. mode `inherit` carries no own number). |
| `par_unit` | text NULL | optional unit override; resolver falls back to `item.default_par_unit`. |
| `par_mode` | text NOT NULL | CHECK in (`inherit`,`manual`,`auto`); default `manual`. |
| `active` | boolean NOT NULL default true | append-only; never delete. |
| `created_at`/`created_by`/`updated_at`/`updated_by` | standard audit | |

- **Uniqueness:** partial unique indexes on active rows so one row per slot — `(item_id, location_id) WHERE day_of_week IS NULL AND active` and `(item_id, location_id, day_of_week) WHERE day_of_week IS NOT NULL AND active`. (Append-only: superseding an override deactivates the old row and inserts a new one, OR updates in place — implementer's call in the plan; in-place update is acceptable here because par overrides are config, not historical artifacts, and the C.44 snapshot freezes history independently.)
- Index `(item_id, location_id, active)` for resolver batch lookups.
- **RLS:** enable; `_no_user_delete USING(false)`; deny end-user insert/update (service-role + app-gate). No end-user read policy needed (loaders read via service-role).

## Resolver

Extend `lib/items.ts`. The resolver becomes day- and override-aware:

```
resolveLineDefinition(line, item, override) -> { name, nameEs, par, parUnit }
```
- `name` / `nameEs`: from `item` (global or local) when present; else fallback to line `label`/`translations.es.label` (logged — shouldn't fire post-backfill).
- `par`:
  - `override` present & `par_mode = 'manual'` → `override.par_value`.
  - `par_mode = 'auto'` → recommendation (`item.default_par`) for now (Toast later).
  - `par_mode = 'inherit'` or no override → `item.default_par` (the recommendation).
- `parUnit`: `override.par_unit ?? item.default_par_unit`.

**Day selection happens before the resolver** (in a small loader helper), choosing the override row for the operational `day_of_week`, falling back to the all-days (`NULL`) row:

```
pickOverride(overridesForItemLoc, dow) =
  overridesForItemLoc.find(o => o.day_of_week === dow)   // specific day
  ?? overridesForItemLoc.find(o => o.day_of_week === null) // all-days base
  ?? null
```

New batch loader `loadItemOverrides(service, itemIds, locationId)` → `Map<item_id, ItemOverride[]>` (all active rows for the items at that location). Loaders compute the operational `dow` from the operational date (same op-tz convention used elsewhere — `lib/i18n/format.ts` / the operational-day helpers), call `pickOverride`, then `resolveLineDefinition`.

## Loaders (read cutover)
- `loadAmPrepState` / `loadMidDayPrepState`: after loading items (`loadItemDefns`), also `loadItemOverrides` for the location, compute `dow` from the operational date, `pickOverride` per line, and `resolveLineDefinition(line, item, override)`. Surface the resolved name/par on the `ChecklistTemplateItem` exactly as 2A (override `label` / `prepMeta.parValue` / `prepMeta.parUnit`) so the client component is untouched.
- `loadOpeningState`: the Phase-2 snapshot `par_value` resolves the same way (override-aware, day from the opening's operational date) instead of `item.default_par` directly.

## Submit snapshots (C.44 history)
- `submitAmPrep` / `submitMidDayPhase1` / opening submit: `itemName` + `parValue` come from the resolved (override-aware, day-specific) value, so the frozen snapshot matches what was displayed. Section stays from `prep_meta.section`.

## Admin editing

### Per-location par + mode (AGM+ ≥6)
- A par surface (grid) in `/admin/checklist-templates` per item: an **all-days** value + optional **per-day** overrides, with a `par_mode` toggle (`inherit` / `manual` / `auto`). "Take the recommendation" = `inherit` (or `manual` seeded from the recommendation, then tweak).
- Writes `item_par_levels` (upsert the slot; append-only-friendly). Service-role + app-gate AGM+. Audit `item_par.update` with item_id, location_id, day_of_week, before/after (in metadata).

### Global definition (MoO+ ≥8)
- Editing the global item's `name` / `name_es` / `section` / `default_par` (the recommendation) writes the `items` row. **MoO+ only** — one edit hits every location. Audit `item.update`.
- (2A's `updatePrepItemContent` par+name path is re-pointed here: name → global item at MoO+; par → `item_par_levels` at AGM+. The 2A combined "content edit at GM+" splits along this authority line.)

### Create + promote (AGM+ create, MoO+ promote)
- **Create location-owned item** (AGM+): `addPrepItem` (and a registry-create path) inserts an `items` row with `location_id` SET, `kind='manual'`, sets the line's `item_id`, and seeds an all-days `item_par_levels` row (`manual`, the entered par).
- **Promote to global** (MoO+): flip a location-owned item's `location_id` → NULL; its existing override row(s) remain (origin location keeps its par); other locations may add their own overrides or inherit. Audit `item.promote_to_global`.

### `addPrepItem` registry-backing (the pressing fix)
Currently `addPrepItem` creates a line with `prep_meta` par and **no `item_id`** → new adds use the resolver fallback (work, but not registry-backed). 2B makes it create the item row + `item_id` + seed override (per "create location-owned item" above), so newly-added items get edit-once-everywhere + par-layer behavior immediately.

## Authorization / audit
- Par override + `par_mode` + create-location-item: **AGM+ (≥6)**, location-bound (IDOR: the location must be in the actor's authorized set).
- Global definition edit + promote-to-global: **MoO+ (≥8)** (company-level; all-locations blast radius).
- Step-up: par edits are Tier A content edits (per slice 1 convention); promotion/global-definition are higher-impact — Tier B step-up. (Confirm exact tier mapping in the plan against `lib/admin/step-up.ts`.)
- New audit actions: `item_par.update`, `item.promote_to_global` (+ existing `item.update`, `item.create`, `checklist_template_item.create`). Add to `lib/destructive-actions.ts` as needed.

## Backfill (separate, idempotent, verifiable — `scripts/backfill-par-layer.ts`)
1. **Resolve current state:** for every active prep/opening-Phase2 line with an `item_id`, read its current location item's `name`, `section`, `default_par`, `default_par_unit`.
2. **Dedup across locations** by normalized `(lower(trim(name)), section)`:
   - Key present at **both** locations → create (or reuse) **one global item** (`location_id = NULL`, name/section/`default_par` = the shared/representative value — when the two locations' pars differ, the global `default_par` = the **AM-prep/representative** value, divergence noted in the manifest), and create **two** `item_par_levels` rows (one per location, `manual`, `par_value` = that location's current `default_par`, `day_of_week = NULL`).
   - Key present at **one** location → keep the existing **location-owned** item; create **one** `item_par_levels` row (`manual`, current `default_par`, all-days).
3. **Re-point lines:** set each contributing line's `item_id` to the resolved global/local item.
4. **Manifest:** `{globalItemId|localItemId, name, section, locations:[{location_id, parValue, contributingLineIds}], mergeReason: 'cross_location_global' | 'single_location_local'}`.
5. **Idempotent:** re-running detects existing globals by `(lower(name), section, location_id IS NULL)` and existing override rows by slot; does not duplicate.
6. One summary `item.backfill` audit row + the manifest file (avoid hundreds of rows).

## Parity check (`scripts/check-par-layer-parity.ts`, committed, read-only)
For every active prep/opening-Phase2 line: compare the **pre-cutover displayed par** (today's `resolveLineDefinition` from the line's item `default_par`) against the **post-cutover resolved par** (global/local item + `pickOverride(all-days)` + mode). Expect **0 drift**. Also assert every line still has a resolvable item + override. Run before declaring the cutover safe (cutover is a no-op the day it ships).

## Verification
- `npx tsc --noEmit` + `npm run build` clean.
- Parity check returns **0 drift**.
- Throwaway smoke (deleted before commit): (a) set MEP's override for an item to a new value → MEP's AM-prep/mid-day/Opening show it, EM unchanged; (b) edit the **global** name → **both** locations show the new name (rename-once-everywhere across locations — the 2B headline); (c) set a Saturday per-day override → the resolver returns it on Saturday, the all-days value otherwise; (d) submit snapshot freezes the resolved day-specific par; (e) `addPrepItem` creates a registry item + override.
- Operator smoke (Juan, preview): AM-prep / mid-day / Opening render **identically to prod before any edit**; after a per-location par edit it shows on that location's lists only; after a global rename it shows on both; per-day override shows on the right day.

## Build order (for the plan)
1. Migration `0080_item_par_levels` (DDL + RLS) via MCP + captured file.
2. `lib/types.ts` — `ItemParLevel` / `ParMode` types; extend `ItemDefn`/resolver shapes.
3. Resolver: extend `resolveLineDefinition` (override arg) + `pickOverride` + `loadItemOverrides` in `lib/items.ts` (pure + batch loader).
4. Backfill `scripts/backfill-par-layer.ts` (dedup → globals + overrides → re-point → manifest), dry-run first; parity check `scripts/check-par-layer-parity.ts`.
5. Run dry-run → review manifest → run for real → parity 0.
6. Loader read cutover: `loadAmPrepState` / `loadMidDayPrepState` (overrides + day) → `loadOpeningState` Phase-2 par.
7. Submit-snapshot cutover: `submitAmPrep` / `submitMidDayPhase1` / opening submit (resolved day-specific par).
8. Admin: par grid + `par_mode` (AGM+) writing `item_par_levels`; global definition edit + promote (MoO+); split 2A's `updatePrepItemContent` authority; `addPrepItem` registry-backing; UI + i18n + audit actions.
9. Throwaway edit/rename/per-day/snapshot smoke (deleted).
10. Final gate: tsc + build + parity 0 + diff scoped.

## Deferred / next
- **2C:** mid-day add-from-registry picker.
- **Later slice:** `section` + `special_instruction` cut over to the item (full definition).
- **Step 3+:** vendors/SKU admin → ordering (SKU par earns its consumer) → receiving → on-hand → cost/yield → global aggregate → Toast auto-par (`par_mode='auto'` wakes up).
