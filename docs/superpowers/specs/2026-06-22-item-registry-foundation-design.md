# Item Registry Foundation — Design (Item/Inventory Spine, Sub-project 1)

**Date:** 2026-06-22
**Arc:** Item/Inventory Spine — step 1 of 10. Parent architecture: `docs/superpowers/specs/2026-06-22-item-inventory-spine-architecture.md` (on main, `461ead4`).
**Goal:** Stand up the item-registry data model + backfill it from today's prep/opening lines — **entirely behind the scenes, zero change to operator flows.**
**Migration:** YES (DDL) + a separate idempotent backfill.

---

## Principle: additive + invisible

Everything here is additive. **Operator forms keep reading `prep_meta` exactly as today** — nothing reads the new `item_id` or the registry until sub-project 2. So even an imperfect backfill has **zero operator impact** and is fixable before any read is wired. Success = correct schema + correct backfill, verified by queries, not by behavior change.

## Scope

### In scope
1. **`items` table** (new) — the entity reports will reference.
2. **`item_components` table** (new, created **empty**) — the structured costing BOM (populated in a later slice).
3. **`item_id` bridge** — new nullable FK on `checklist_template_items`.
4. **Backfill** — one `items` row per distinct current prep/opening line, deduped; every contributing line linked via `item_id`; a merge manifest emitted.
5. **App-layer types** — `Item`, `ItemKind`, `ItemComponent` in `lib/types.ts` (shapes only; no consumers yet).

### Out of scope (later sub-projects)
- `vendor_items` changes (location_id, nullable vendor_id) + SKU creation — **not touched** (no SKUs created here).
- `par_levels` / per-location par — not touched.
- BOM population, composite/manual classification, promotion-to-global.
- Any registry read/edit by operator forms or admin UI.
- RLS for end-user access to the new tables beyond the deny-write default (no end-user reads needed yet; service-role only).

## Ground truth (verified live 2026-06-22)
- `checklist_template_items` has `vendor_item_id` (0 wired) — **left as-is**; we add a separate `item_id`. Cols incl. `station`, `label`, `description`, `translations` (jsonb), `prep_meta` (jsonb), `references_template_item_id`, `active`.
- AM-prep item ↔ its Opening Phase-2 mirror are linked by `opening_item.references_template_item_id = am_prep_item.id`. ~34 such pairs per location.
- Per location (MEP+EM): AM Prep v1 (38 active items), Mid-day Prep v1 (14), Opening v1 (78 incl. mirrors), Closing v2 (61). **Closing is out of the prep-item backfill** (cleaning tasks, not prep items) — see Backfill.
- `lib/types.ts`: `VendorItem`, `ParLevel` exist (camelCase). No `Item` type. Latest migration `0078`; this is **0079** (DDL).
- prep items: `prep_meta = {section, parValue, parUnit, specialInstruction, columns}`. Opening Phase-2: `{openingPhase2, section, parValue, parUnit}`.

## Schema

### `items` (new)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `location_id` | uuid NULL | FK → locations. NULL = global default; SET = location-owned. (Backfill sets it — every backfilled item is location-owned.) |
| `kind` | text NOT NULL | CHECK in (`sku_direct`,`composite`,`manual`); **default `manual`** (backfill can't classify). |
| `name` | text NOT NULL | EN source-of-truth. |
| `name_es` | text NULL | ES translation (parity with the app's translate-from-day-one norm). |
| `section` | text NULL | the prep section (system key), nullable for non-prep items. |
| `default_par` | numeric NULL | registry default par (seeded from `prep_meta.parValue`). |
| `default_par_unit` | text NULL | seeded from `prep_meta.parUnit`. |
| `unit` | text NULL | unit of the item (reserved; mostly null at backfill). |
| `notes` | text NULL | |
| `active` | boolean NOT NULL default true | disable/enable; never delete. |
| `created_at`/`created_by`/`updated_at`/`updated_by` | standard audit | |

Index: `(location_id, active)`; `(location_id, lower(name), section)` to support the backfill's dedup + future lookups.

### `item_components` (new, empty)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `item_id` | uuid NOT NULL | FK → items (parent). |
| `component_sku_id` | uuid NULL | FK → vendor_items. |
| `component_item_id` | uuid NULL | FK → items (sub-item). |
| `quantity` | numeric NOT NULL | |
| `unit` | text NULL | |
| `display_order` | integer NOT NULL default 0 | |
| audit cols | | |
- **CHECK:** exactly one of `component_sku_id` / `component_item_id` is non-null.
- No rows created this slice. (BOM authoring is a later slice.)

### `checklist_template_items.item_id` (new column)
- `item_id` uuid NULL, FK → items. The bridge. Nullable (closing/cleaning lines may stay null).

### RLS
- Both new tables: enable RLS; `_no_user_delete USING(false)`; deny end-user insert/update (service-role only — admin/system writes per the established pattern). No end-user read policy needed yet (no client reads the registry this slice). `checklist_template_items` RLS unchanged (adding a column doesn't change policies).

## Backfill (separate, idempotent, verifiable)

A one-shot, **re-runnable** backfill (a `tsx` script run via service-role, OR a data-only migration — see Approaches). For each **location** independently:

1. **Gather source lines:** active `checklist_template_items` whose template is `type='prep'` (am_prep + mid_day) OR `type='opening'` Phase-2 items (`prep_meta.openingPhase2 = true`). Closing/cleaning lines are excluded (not prep items).
2. **Dedup into distinct items:**
   - **Sure pair:** an Opening Phase-2 item and the AM-prep item it references (`references_template_item_id`) = ONE item.
   - **Name+section match:** a mid-day (or other) line whose **normalized** key `(lower(trim(name)), section, location)` matches an already-created item = the SAME item (link, don't duplicate). Normalization is conservative (trim + lowercase exact); no fuzzy matching.
   - Otherwise = a new distinct item.
3. **Create `items` rows:** one per distinct item — `name` (EN from `label`/translations), `name_es` (from `translations.es.label`), `section` (from `prep_meta.section` / `station`), `default_par`/`default_par_unit` (from `prep_meta`), `location_id` = the location, `kind='manual'`, `active=true`, `created_by` = the running admin/system actor.
4. **Link lines:** set `checklist_template_items.item_id` on every contributing line.
5. **Emit a merge manifest:** a structured log (written to a file or printed) of every collapse — `{itemId, name, section, location, contributingLineIds:[...], mergeReason: 'am_prep_opening_fk' | 'name_section_match' | 'standalone'}` — for human eyeball.
6. **Idempotent:** re-running detects already-linked lines (item_id set) + existing items by key and does not duplicate. Safe to run, verify, re-run.

**Conflict-resolution rule when merged lines disagree** (e.g., AM-prep par 6 vs a mid-day "same" item par 4): the item's `default_par` takes the **AM-prep** value when present (AM-prep is the canonical prep baseline per the operational model), else the first-seen; the divergence is noted in the manifest. (Per-location/per-list par nuance is sub-project 2's par layer; this is just the seed default.)

## Verification (no behavior change to assert)
- `tsc` + `next build` clean (types added, no consumers).
- Backfill correctness queries:
  - Every active prep/opening Phase-2 line has a non-null `item_id`.
  - Every AM-prep↔Opening FK pair shares one `item_id`.
  - No two items share the normalized `(location, lower(name), section)` key (dedup worked).
  - `items` count ≈ distinct expected (spot-check against the manifest).
  - `item_components` is empty; `prep_meta` untouched; operator loaders unaffected (AM-prep/Opening pages still render identically — quick smoke).
- The merge manifest is reviewed (Juan/CC eyeball) before the slice is considered "blessed."

## Approaches (backfill mechanism)
- **A — `tsx` backfill script** (`scripts/backfill-item-registry.ts`, committed, idempotent, emits manifest). **Recommended:** reviewable, re-runnable, emits the manifest, easy to verify in steps. Mirrors the existing seed-script pattern.
- **B — data-only migration.** Runs once via MCP. Less reviewable/re-runnable; manifest harder. Reject.
- **C — split into two slices** (DDL slice, then backfill slice). Possible, but they're tightly coupled and the backfill is the verification of the DDL — keep as one PR with DDL task(s) then backfill task(s). 

## Files
- Migration `0079_item_registry_foundation.sql` (DDL: items, item_components, item_id column, RLS) — applied via Supabase MCP + captured in `supabase/migrations/`.
- `lib/types.ts` — add `ItemKind`, `Item`, `ItemComponent`.
- `scripts/backfill-item-registry.ts` (committed — it's a real, re-runnable data tool, not a throwaway smoke).
- `lib/destructive-actions.ts` — add `item.create` (+ maybe `item.backfill`) audit action(s).

## Authority / audit
- Backfill runs service-role (system/admin), `created_by` = Juan (the invoking admin) or a system sentinel. Emits a `item.create` audit per item (or one summary `item.backfill` row with counts + manifest reference — decide in plan; lean: one summary row + the manifest file, to avoid hundreds of audit rows).

## Build order (for the plan)
1. `lib/destructive-actions.ts` — add the audit action(s).
2. Migration `0079` (DDL) via MCP + capture file. Verify tables/column/RLS live.
3. `lib/types.ts` — `ItemKind`/`Item`/`ItemComponent`.
4. `scripts/backfill-item-registry.ts` — dedup + create + link + manifest, idempotent. Dry-run mode first.
5. Run backfill dry-run → review manifest → run for real → correctness queries.
6. Operator-flow smoke (AM-prep/Opening still render identically).
7. Final gate: tsc + build + manifest reviewed + diff scoped.

## Deferred / next
Sub-project 2: registry-driven editing + par layer (admin edits items; reports read par from the registry; retire slices 1–2 propagation; mid-day "add from existing" picker).
