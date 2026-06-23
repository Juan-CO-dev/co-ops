# Sections First-Class + Display-Rename — Design (Item/Inventory Spine, sub-slice A)

**Date:** 2026-06-23
**Arc:** Item/Inventory Spine — admin, the "full definition" family. Builds on 2B′ (PR #84, the 3-tab checklist admin). Sibling of the next sub-slice B (full definition on the item: special_instruction / min_role / section-placement → item).
**Trigger:** Juan wants to rename section names. The clean architecture (no key-change landmine) is to make sections **first-class data** — same move items got — so the *label* is freely editable while a stable internal slug stays the reference.
**Migration:** YES — new `prep_sections` table + backfill the 6 enum sections. No changes to lines.

---

## Principle (Juan, locked)

**Location tabs = par + enable/disable ONLY. Everything else — name, translations, section, special instruction, min-role — is GLOBAL** (edited on the Global tab; GM+/MoO+). This slice delivers the *section* part of "global, editable" (renaming a section's label). [[project_item_inventory_spine]]

## Why first-class, not a key-rename or a label bolt-on

The section string (`"Cooks"`) is a **system key**: stamped into every line's `station` + `prep_meta.section`, into **frozen C.44 historical snapshots** (append-only — cannot be rewritten), into station-match gates, and into the hardcoded `columnsForSection` map (`lib/prep-sections.ts`). Renaming the *key* would require migrating all of those atomically and is impossible for the frozen snapshots.

So: keep the key as a **stable internal slug** and make the **display label** the editable thing. Modeling sections as first-class rows (slug + label + columns) means:
- **Rename** = edit the label. No migration; lines + snapshots untouched (they reference the slug).
- **Add a section** later = insert a row (works because the column set lives in the table, not a hardcoded map).
- Users never see or change a "key" — the slug is plumbing; the label is the real name.

Mirrors the items first-class move (implicit label-strings → rows with stable ids).

## Scope

### In scope
1. **`prep_sections` table** (new) — `slug` (stable, = today's enum strings), `label_en`, `label_es`, `columns` (jsonb array of PrepColumn), `display_order`, `active`, audit cols.
2. **Backfill** the 6 sections (Veg/Cooks/Sides/Sauces/Slicing/Misc) — slug = the current enum string, labels = today's display, `columns` = the current `SECTION_COLUMNS` map, order = the `PREP_SECTIONS` order, active=true.
3. **Label rendering** reads `prep_sections` (operator prep section headers + admin section labels) instead of the hardcoded `am_prep.section.<x>` / `admin.templates.section.<x>` i18n keys. The i18n keys stay as a last-resort fallback.
4. **`columnsForSection`** sources columns from the table (the add/seed path), keeping the hardcoded map only as a fallback. (Operator render is unaffected — it reads the per-line stored `prep_meta.columns`, set at seed time.)
5. **Admin rename UI** — a "Sections" area on the **Global tab**: edit each section's `label_en`/`label_es` (and `display_order`). **MoO+** (global definition; flag below).

### Stays as-is / deferred
- **Add/remove sections UI** — DEFERRED (table supports it; a small follow-up). This slice = rename labels only.
- **Lines / `station` / `prep_meta.section`** — unchanged; they keep referencing the slug. No migration.
- **`PrepSection` TS type** — stays the union of the 6 slugs for now (a later add/remove slice loosens it to `string`).
- Closing/opening **stations** (Walk-Out Verification, fridges) are NOT prep sections — out of scope.
- **Sub-slice B** (special_instruction / min_role / section-placement → item) — separate, next.

## Ground truth (verified live 2026-06-23)
- `lib/prep-sections.ts`: `PREP_SECTIONS` (6) + `SECTION_COLUMNS` (per-section PrepColumn[]) + `columnsForSection` (used by `addPrepItem`/`seedPrepItem`/`changePrepItemSection` at SEED time) + `isPrepSectionName`. Client-safe (no DB).
- Operator render: `components/prep/PrepSection.tsx` + section components resolve `sectionDisplay` = the line's template `station` translation, falling back to `t("am_prep.section.<lower>")` (C.38 system-key-vs-display seam). So a display layer already exists to hook the DB label into.
- Operator form reads stored `prep_meta.columns` per line (set at seed) — NOT `columnsForSection` live. So moving columns to the table only affects the seed/add path.
- Admin labels: `admin.templates.section.<Slug>` i18n keys (used in the par-grid section headers, the add-item section picker, the location-tab section headers).
- Lines store `station` + `prep_meta.section` = the enum string; C.44 snapshots freeze `prep_meta.section`.

## Schema — `prep_sections` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `slug` | text NOT NULL UNIQUE | the stable internal key (= today's enum string, e.g. `Cooks`). Never edited. |
| `label_en` | text NOT NULL | display name (editable). |
| `label_es` | text NULL | Spanish display (editable). |
| `columns` | jsonb NOT NULL | array of PrepColumn (e.g. `["par","on_hand","total"]`). |
| `display_order` | int NOT NULL default 0 | |
| `active` | boolean NOT NULL default true | disable, never delete. |
| `created_at`/`created_by`/`updated_at`/`updated_by` | standard audit | |

- Index `(active, display_order)`. RLS: enable; `_no_user_delete USING(false)`; deny end-user insert/update (service-role + app-gate). **Read:** sections labels are needed by the operator form — either allow authenticated read (labels are not sensitive) OR load them server-side and pass down. Decide in plan; lean **server-side load + pass down** (consistent with the loaders, no new client read policy).

## Architecture

- **`lib/prep-sections.ts`** gains a server loader `loadPrepSections(service)` → `Map<slug, {labelEn, labelEs, columns, order}>`. `columnsForSection` keeps its hardcoded map as a **fallback** but the seed/add path prefers the table when available. (Keep `prep-sections.ts` client-safe for the pure bits; the DB loader can live in a server module — e.g. `lib/prep-sections.server.ts` — to avoid pulling server deps into client imports.)
- **Operator render:** the prep loaders (`loadAmPrepState`/`loadMidDayPrepState`) include a `sectionLabels` map (slug → label in the user's language); `PrepSection.tsx`/section components prefer it over the i18n fallback. Section header = the DB label.
- **Admin:** the 3-tab Global tab gets a "Sections" panel listing the active sections (by `display_order`) with editable `label_en`/`label_es` (+ order). `loadChecklistAdminView` includes the sections list.

## Admin editing + authority
- New `setSectionLabel(actor, {slug, labelEn, labelEs, displayOrder?})` in `lib/admin/templates.ts` (or a `lib/admin/sections.ts`) → updates `prep_sections` by slug; audit `prep_section.update` (before/after in metadata).
- Route: `PATCH /api/admin/checklist-templates/sections/[slug]` → `setSectionLabel`. **MoO+ (≥8), Tier B** — global definition, all-locations blast radius (flag: confirm MoO+ vs GM+; matches "name edit = MoO+").
- New audit action `prep_section.update` in `lib/destructive-actions.ts`.

## Migration + backfill
- Migration `0082_prep_sections`: DDL + seed the 6 rows (slug/label/columns/order from `PREP_SECTIONS` + `SECTION_COLUMNS`). Idempotent seed (insert-if-absent by slug). Captured per the migration-file convention.

## Verification
- `tsc` + `next build` clean; migration applied + captured.
- Backfill: 6 active rows, slugs = the enum, columns match `SECTION_COLUMNS`.
- Operator smoke (preview): AM-prep / mid-day section headers render the DB label (identical to today before any rename, since seeded labels = current display). Rename a section's label on the Global tab → it shows on the operator prep headers + admin section headers + the location tabs, EN + ES; historical reports unaffected (frozen snapshots keep the slug, render via the label too). Columns/behavior unchanged.
- Authority: AGM sees no section-rename control; GM/MoO does (per the confirmed tier).

## Deferred / next
- **Add/remove sections UI** (the table supports it; loosen `PrepSection` to `string`, add a column-set picker).
- **Sub-slice B — full definition on the item:** `special_instruction` + `min_role` + section-*placement* → the item, edited on the Global tab (restores the line-detail editing 2B′ pulled off the location tab).
