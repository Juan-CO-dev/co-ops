# Full Definition on the Item Implementation Plan (sub-slice B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restore Global-tab editing of an item's full definition — special instruction (EN/ES), required, min-role, and section-placement — applied to every location via propagation, with operator/gating read paths unchanged. Authority: **create = GM+, edit = MoO+** ("GMs add once, MoO+ manages").

**Architecture:** Items gain canonical columns (`special_instruction`/`_es`/`min_role_level`/`required`; `section` exists). A Global-tab edit (MoO+) writes the item canonical AND propagates each field to every active line of the item (all locations + opening mirrors); operator render + `lib/checklists.ts` gating keep reading line values (low-risk). Create (`addRegistryItem`, GM+) accepts the full definition; new lines (enable/propagate/add) inherit the item canonical.

**Tech Stack:** Next 16 App Router, Supabase Postgres 17 (service-role admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens. No test framework — `tsc --noEmit` + `next build` + throwaway tsx smokes (deleted before commit). Migrations via Supabase MCP (prod ref `bgcvurheqzylyfehqgzh`) + captured.

**Branch:** `claude/full-definition-on-item` (off main `f5edd84`; spec `74ef31e`).

**Spec:** `docs/superpowers/specs/2026-06-23-full-definition-on-item-design.md` — re-read before each task.

---

### Task 1: Migration 0083 — items full-definition columns + backfill

**Files:** MCP `apply_migration` (name `items_full_definition`) → Create `supabase/migrations/0083_items_full_definition.sql`; Modify `lib/types.ts` (`Item`).

- [ ] **Step 1: Confirm latest migration is 0082**, else renumber.
- [ ] **Step 2: Apply DDL + backfill** (backfill from each item's representative active line — prefer the am-prep line, else any active line):
```sql
alter table public.items add column special_instruction text null;
alter table public.items add column special_instruction_es text null;
alter table public.items add column min_role_level integer null;
alter table public.items add column required boolean not null default false;

-- Backfill canonical from a representative active line per item. Rank: am_prep
-- prep line first, then any prep line, then opening Phase-2 mirror, then any.
with ranked as (
  select cti.item_id,
         cti.prep_meta->>'specialInstruction' as si,
         cti.translations->'es'->>'specialInstruction' as si_es,
         cti.min_role_level, cti.required,
         row_number() over (
           partition by cti.item_id
           order by case
             when ct.type='prep' and ct.prep_subtype='am_prep' then 0
             when ct.type='prep' then 1
             when ct.type='opening' then 2 else 3 end,
           cti.created_at nulls last
         ) rn
  from checklist_template_items cti
  join checklist_templates ct on ct.id = cti.template_id
  where cti.item_id is not null and cti.active
)
update items i set
  special_instruction = r.si,
  special_instruction_es = r.si_es,
  min_role_level = r.min_role_level,
  required = coalesce(r.required, false)
from ranked r
where r.item_id = i.id and r.rn = 1;
```
(Verify `checklist_template_items` has a `created_at` — if not, drop the tiebreak. Confirm the `translations` ES path shape matches `resolveTemplateItemContent`.)

- [ ] **Step 3: Verify** — items' canonical populated; spot-check a few against their am-prep line. Capture `supabase/migrations/0083_items_full_definition.sql`.
- [ ] **Step 4:** `lib/types.ts` — add `specialInstruction`/`specialInstructionEs`/`minRoleLevel`/`required` to the `Item` interface.
- [ ] **Step 5:** `npx tsc --noEmit`; commit.

---

### Task 2: Lib — canonical write + propagation + new-line inheritance

**Files:** Modify `lib/admin/templates.ts`.

**Context (re-read):** `updateRegistryItemDefinition` (MoO+ edit — currently name/recommended-par), `addRegistryItem` (GM+ create), `changePrepItemSection` (the section re-derive + `setOpeningMirrorSection` logic to generalize), `setPrepItemSection`/`setPrepItemMeta` (lib/prep.ts), `ensureItemLineOnTemplate`/`resolveDefaultMinRole`/`addPrepItem` (new-line creation), `columnsForSection` + the `prep_sections` table (columns source).

- [ ] **Step 1: Re-read** all of the above + how a line's `prep_meta` (PrepMeta) vs an opening mirror's `prep_meta` (OpeningPhase2Meta) differ (section propagation must handle both shapes).

- [ ] **Step 2: `propagateItemDefinitionToLines`** (new private helper):
```ts
async function propagateItemDefinitionToLines(
  sb, itemId: string,
  changes: { specialInstruction?: string | null; specialInstructionEs?: string | null;
             required?: boolean; minRoleLevel?: number; section?: PrepSection },
): Promise<{ lineCount: number }>
```
- Load **all active lines** with `item_id = itemId` (across all templates/locations), with their template type/subtype + location.
- For each line apply the present changes:
  - `required` → line `required`.
  - `minRoleLevel` → line `min_role_level`.
  - `specialInstruction`/`specialInstructionEs` → `prep_meta.specialInstruction` (via `setPrepItemMeta` to preserve the station/section invariant) + `translations.es.specialInstruction` (merge, like `mergeEsTranslation`).
  - `section` → station + `prep_meta.section` + re-derived `prep_meta.columns` (reuse `changePrepItemSection`'s re-derive; for opening-mirror lines (`openingPhase2`) sync station + `prep_meta.section` only — NO prep-column re-derive; mirror columns aren't prep columns). Use `prep_sections` columns for the re-derive (sub-slice A) with the `columnsForSection` fallback.
- Return the count. (This generalizes `changePrepItemSection` from one template to the whole item; the per-am-prep-line mirror is itself an active item line, so it's covered by the same loop — handle its shape.)

- [ ] **Step 3: Extend `updateRegistryItemDefinition` (MoO+ edit)** — accept `specialInstruction`/`specialInstructionEs`/`required`/`minRoleLevel`/`section` in addition to name/par. Update the **item canonical** columns, then call `propagateItemDefinitionToLines` for the changed fields. Validate `section` (isPrepSectionName), `minRoleLevel` (0–10 int). Audit `item.update` with changed fields + propagated line count.

- [ ] **Step 4: Extend `addRegistryItem` (GM+ create)** — accept `specialInstruction`/`specialInstructionEs`/`required`/`minRoleLevel` (+ existing name/section/par/isDefault); set them on the new item canonical. (Propagation on create only matters if `isDefault` → the propagated lines should inherit; see Step 5.)

- [ ] **Step 5: New-line inheritance** — `ensureItemLineOnTemplate` + `addPrepItem` copy the item's canonical `special_instruction`/`special_instruction_es`/`min_role_level`/`required` onto the new line (replacing the current `null` / `resolveDefaultMinRole` / `false` defaults). `ensureItemLineOnTemplate` already loads the item fields — extend its `DefaultItemFields` to carry the canonical defs (or re-read the item). Keep `resolveDefaultMinRole` as the fallback only when the item canonical `min_role_level` is null.

- [ ] **Step 6:** `npx tsc --noEmit`; commit.

---

### Task 3: Route — extend the registry create + definition routes

**Files:** Modify `app/api/admin/checklist-templates/registry/route.ts` (POST, GM+) + `app/api/admin/checklist-templates/registry/[itemId]/route.ts` (PATCH, MoO+).

- [ ] **Step 1:** POST `/registry` (GM+ ≥7): parse + pass `specialInstruction`/`specialInstructionEs`/`required`/`minRoleLevel` into `addRegistryItem` (validate types; minRoleLevel 0–10 int).
- [ ] **Step 2:** PATCH `/registry/[itemId]` (MoO+ ≥8): parse + pass the same + `section` into `updateRegistryItemDefinition`. Keep the existing name/par fields.
- [ ] **Step 3:** `tsc` + `build`. Commit.

---

### Task 4: UI — Global-tab item definition fields + create form

**Files:** Modify `components/admin/templates/GlobalRegistryTab.tsx` (RegistryRow edit + AddGlobalItem create) + `lib/i18n/{en,es}.json`.

- [ ] **Step 1: Re-read** `GlobalRegistryTab.tsx` (RegistryRow edit form — currently name/par; AddGlobalItem create form).
- [ ] **Step 2: RegistryRow (MoO+ edit)** — add fields: special instruction EN/ES (textareas), required (checkbox), min-role (numeric), section (select from `sections` — re-section). Save → PATCH `/registry/[itemId]` with all fields. A note: "applies to this item on every location." (Section select reuses `view.sections` for labels via `sectionLabelByLang`.)
- [ ] **Step 3: AddGlobalItem (GM+ create)** — add the same fields (special instruction EN/ES, required, min-role) to the create form → POST `/registry`. (Section already in the create form.)
- [ ] **Step 4: i18n** EN+ES for any new strings (reuse existing `admin.templates.field.special_instruction`/`_es`/`required`/`min_role_level`/`section` where present; add the "applies everywhere" note).
- [ ] **Step 5:** `tsc` + `build`. Commit.

---

### Task 5: Smoke + final gate

- [ ] **Step 1: Throwaway smoke** (deleted): on an item, set special instruction / required / min-role via the edit path → all the item's active lines (both locations + opening mirror) updated; operator render + gating read the new values. Re-section an item → all its lines move section + prep columns re-derive + opening mirror follows; a mid-day line of the item also moves. A newly-enabled line inherits the item canonical. Frozen historical snapshots unaffected. Delete the smoke.
- [ ] **Step 2:** `tsc` + `build` clean; no `_smoke_*` staged.
- [ ] **Step 3:** Push; PR with the smoke plan (edit special instruction/required/min-role on the Global tab → shows + gates on both locations; re-section → item moves everywhere; create a new item with full definition as GM+). Hold for Juan's preview smoke.

## Self-review notes
- Spec coverage: migration+backfill (T1), canonical write + propagation + inheritance (T2), routes (T3), UI (T4), verification (T5). ✓
- Low-risk: operator + `lib/checklists.ts` gating read paths UNCHANGED; only admin write + new-line inheritance change. Propagation in-place; frozen snapshots untouched. ✓
- Authority: create = GM+ (`addRegistryItem` + POST /registry stay ≥7); edit = MoO+ (PATCH /registry/[itemId] stays ≥8). No existing route re-gated. ✓
- Confirm-before-authoring: T2 re-reads the PrepMeta vs OpeningPhase2Meta shapes (section propagation handles both), `created_at` presence for the backfill tiebreak, and the ES translations path.
- Section propagation is the complex part — it generalizes `changePrepItemSection` across all the item's lines + handles the mirror shape; the mirror is itself an item line so it's in the loop.
