# Sections First-Class + Display-Rename Implementation Plan (sub-slice A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make prep sections first-class data (`prep_sections`: stable slug + editable EN/ES label + columns + order) so a section's *label* can be renamed on the Global tab (MoO+) without ever touching the system key, lines, or frozen snapshots. Rename-only; the table is built so add/remove is a small follow-up.

**Architecture:** Backfill the 6 enum sections into `prep_sections` (slug = today's string, labels = today's display, columns = the current map) → no-op render. Operator prep section headers + admin section labels resolve from the table (server-loaded, passed down), falling back to the existing `am_prep.section.<x>` i18n keys. `columnsForSection` sources from the table at seed-time (operator form unaffected — reads stored per-line columns). Rename writes the label by slug.

**Tech Stack:** Next 16 App Router, Supabase Postgres 17 (service-role admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens. No test framework — `tsc --noEmit` + `next build` + throwaway tsx smokes (deleted before commit). Migrations via Supabase MCP (prod ref `bgcvurheqzylyfehqgzh`) + captured.

**Branch:** `claude/sections-first-class` (off main `b1b33d6`; spec `e0a4520`).

**Spec:** `docs/superpowers/specs/2026-06-23-sections-first-class-design.md` — re-read before each task.

---

### Task 1: Migration 0082 — `prep_sections` table + seed + audit action

**Files:** MCP `apply_migration` (name `prep_sections`) → Create `supabase/migrations/0082_prep_sections.sql`; Modify `lib/destructive-actions.ts`.

- [ ] **Step 1: Confirm latest migration is 0081**, else renumber.
- [ ] **Step 2: Apply DDL + idempotent seed**

```sql
create table public.prep_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label_en text not null,
  label_es text null,
  columns jsonb not null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index prep_sections_active_order on public.prep_sections (active, display_order);

alter table public.prep_sections enable row level security;
-- Labels are not sensitive but no end-user write; reads go via service-role
-- loaders (spec decision). Deny all end-user DML; split per-op (never FOR ALL).
create policy prep_sections_no_user_select on public.prep_sections for select using (false);
create policy prep_sections_no_user_insert on public.prep_sections for insert with check (false);
create policy prep_sections_no_user_update on public.prep_sections for update using (false) with check (false);
create policy prep_sections_no_user_delete on public.prep_sections for delete using (false);

-- Seed the 6 enum sections (slug = today's string; columns = current SECTION_COLUMNS;
-- order = PREP_SECTIONS order). Idempotent: skip slugs that already exist.
insert into public.prep_sections (slug, label_en, label_es, columns, display_order)
values
  ('Veg','Veg',null,'["par","on_hand","back_up","total"]',1),
  ('Cooks','Cooks',null,'["par","on_hand","total"]',2),
  ('Sides','Sides',null,'["par","portioned","back_up","total"]',3),
  ('Sauces','Sauces',null,'["par","line","back_up","total"]',4),
  ('Slicing','Slicing',null,'["par","line","back_up","total"]',5),
  ('Misc','Misc',null,'["yes_no"]',6)
on conflict (slug) do nothing;
```
(label_es null = falls back to label_en / the i18n key, matching today's behavior where ES sections used the `am_prep.section.<x>` ES key. If those ES keys have real Spanish, seed label_es from them — check `lib/i18n/es.json` `am_prep.section.*` and seed the ES values so ES users see no change.)

- [ ] **Step 3: Verify** — 6 rows, slugs = the enum, columns match `SECTION_COLUMNS`, RLS on, 4 deny policies.
- [ ] **Step 4: Capture** `supabase/migrations/0082_prep_sections.sql` (going-forward header + canonical ref to `lib/prep-sections.server.ts`).
- [ ] **Step 5:** Add audit action `prep_section.update` to `lib/destructive-actions.ts`.
- [ ] **Step 6:** `npx tsc --noEmit`; commit.

> NOTE on ES seed: re-read `lib/i18n/es.json` `am_prep.section.*` — if Veg/Cooks/etc. have distinct Spanish, seed `label_es` from them so the cutover is a true no-op for ES users. If they're identical to EN, leave null.

---

### Task 2: Lib — section loader + label writer + columns source

**Files:** Create `lib/prep-sections.server.ts`; Modify `lib/prep-sections.ts` (columns fallback), `lib/types.ts` (PrepSectionDefn), `lib/admin/templates.ts` (or new `lib/admin/sections.ts`) for `setSectionLabel`.

- [ ] **Step 1: Re-read** `lib/prep-sections.ts` (`SECTION_COLUMNS`, `columnsForSection`), `lib/admin/templates.ts` (the `audit()` shape + IDOR helpers + how routes call the lib).

- [ ] **Step 2: Types** — in `lib/types.ts`:
```ts
export interface PrepSectionDefn {
  slug: string;
  labelEn: string;
  labelEs: string | null;
  columns: PrepColumn[];
  displayOrder: number;
}
```

- [ ] **Step 3: `lib/prep-sections.server.ts`** (server-only; keeps `prep-sections.ts` client-safe):
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrepColumn } from "@/lib/types";
import type { PrepSectionDefn } from "@/lib/types";

/** Load active prep sections by slug (service-role). */
export async function loadPrepSections(service: SupabaseClient): Promise<Map<string, PrepSectionDefn>> {
  const { data, error } = await service
    .from("prep_sections").select("slug, label_en, label_es, columns, display_order")
    .eq("active", true).order("display_order", { ascending: true });
  if (error) throw new Error(`loadPrepSections: ${error.message}`);
  const map = new Map<string, PrepSectionDefn>();
  for (const r of (data ?? []) as Array<{ slug: string; label_en: string; label_es: string | null; columns: PrepColumn[]; display_order: number }>) {
    map.set(r.slug, { slug: r.slug, labelEn: r.label_en, labelEs: r.label_es, columns: r.columns, displayOrder: r.display_order });
  }
  return map;
}
```

- [ ] **Step 4: `columnsForSection` table source** — at the seed/add path (`addPrepItem`/`seedPrepItem`/`changePrepItemSection`), prefer the table's `columns` for the section when available, falling back to the hardcoded `SECTION_COLUMNS`. Simplest: a server helper `columnsForSectionFromDb(sections: Map, section, includeNote)` that reads the loaded map, else `columnsForSection`. Keep the pure `columnsForSection` as the fallback (don't break client imports).

- [ ] **Step 5: `setSectionLabel`** (in `lib/admin/templates.ts` or `lib/admin/sections.ts`):
```ts
export async function setSectionLabel(
  actor: AuthContext,
  args: { slug: string; labelEn: string; labelEs: string | null; displayOrder?: number },
): Promise<void>
```
- Validate `labelEn` non-empty (400 invalid_label). Read the section by slug (404 if absent). Update `label_en`/`label_es`/(`display_order` if provided) + `updated_by`/`updated_at`. Audit `prep_section.update` with before/after in metadata. (No location IDOR — sections are global; route gates MoO+.)

- [ ] **Step 6:** `npx tsc --noEmit`; commit.

---

### Task 3: Loaders — surface section labels + admin sections list

**Files:** Modify `lib/prep.ts` (`loadAmPrepState`, `loadMidDayPrepState`), `lib/admin/templates.ts` (`loadChecklistAdminView` + `ChecklistAdminView`).

- [ ] **Step 1: Re-read** `loadAmPrepState`/`loadMidDayPrepState` return shapes + `loadChecklistAdminView`.

- [ ] **Step 2: Prep loaders** — call `loadPrepSections(service)` and include in the returned state a `sectionLabels: Record<string, { en: string; es: string | null }>` (slug → labels). (The client picks by language.) Keep it additive — don't disturb existing fields.

- [ ] **Step 3: `loadChecklistAdminView`** — add `sections: PrepSectionDefn[]` (the active sections, by display_order) to the return + the `ChecklistAdminView` interface. (Re-uses `loadPrepSections`.)

- [ ] **Step 4:** `npx tsc --noEmit`; commit.

---

### Task 4: Operator render — section headers prefer the DB label

**Files:** Modify `components/prep/AmPrepForm.tsx` + the section components (`components/prep/sections/{Veg,Cooks,Sides,Sauces,Slicing,Misc}Section.tsx`) + the mid-day form if it renders sections.

**Context (re-read):** each section component computes `sectionDisplay` (`resolved.station` translation → `t("am_prep.section.<x>")` fallback) and passes it to `<PrepSection sectionDisplay=...>`. Thread the loader's `sectionLabels` through and prefer it.

- [ ] **Step 1: Re-read** `AmPrepForm.tsx` (how it groups by section + renders each `<XSection>`) + one section component's `sectionDisplay` logic + the mid-day form.

- [ ] **Step 2:** Thread `sectionLabels` from the form (it gets it from the loader state) to each section component. In each component's `sectionDisplay` computation, prefer `sectionLabels[slug]?.[language === "es" ? "es" : "en"] ?? sectionLabels[slug]?.en ?? <existing fallback>`. (Define a tiny shared helper `resolveSectionLabel(sectionLabels, slug, language, fallback)` to avoid 6 copies.)

- [ ] **Step 3:** Verify the empty/`aria` strings still work (they use `sectionDisplay`). `tsc` + `build`. Commit.

> The seeded labels equal today's display, so this renders identically until someone renames — confirm in the smoke.

---

### Task 5: Route — section label rename (MoO+)

**Files:** Create `app/api/admin/checklist-templates/sections/[slug]/route.ts`.

- [ ] **Step 1:** PATCH handler mirroring the established self-gate pattern: `requireSession → ROLES[role].level >= 8 (MoO+) → assertStepUp("B") → parse {labelEn, labelEs, displayOrder?} → setSectionLabel → try/catch AdminTemplateError`. Validate `labelEn` is a non-empty string.
- [ ] **Step 2:** `tsc` + `build`. Commit.

---

### Task 6: Admin UI — Sections panel on the Global tab

**Files:** Modify `components/admin/templates/GlobalRegistryTab.tsx` (or a new `SectionsPanel.tsx` it renders) + `components/admin/templates/ChecklistTabs.tsx` (pass `sections`) + `lib/i18n/{en,es}.json`.

- [ ] **Step 1: Re-read** `GlobalRegistryTab.tsx` + how `ChecklistTabs` passes the view.
- [ ] **Step 2:** Add a "Sections" panel at the top of the Global tab (above the registry items): list `view.sections` by order, each with editable `label_en` + `label_es` inputs + a Save → `PATCH /api/admin/checklist-templates/sections/[slug]` (Tier B). Gate: visible/editable only at `actorLevel >= 8` (MoO+); read-only below. A small "renames this section everywhere, all locations" note.
- [ ] **Step 3:** Thread `sections` from `ChecklistTabs` into `GlobalRegistryTab`. i18n EN+ES for the new strings (panel title, label fields, blast-radius note).
- [ ] **Step 4:** `tsc` + `build`. Commit.

---

### Task 7: Smoke + final gate

- [ ] **Step 1: Throwaway smoke** (deleted): `loadPrepSections` returns 6; `setSectionLabel` updates a label by slug + audits; `loadAmPrepState`/`loadChecklistAdminView` surface the labels. Delete the smoke.
- [ ] **Step 2:** `tsc` + `build` clean; no `_smoke_*` staged.
- [ ] **Step 3:** Push; PR with the smoke plan: section headers render identically before any rename; rename a section's label on the Global tab (MoO+) → shows on operator prep headers (EN + ES) + admin section headers + location tabs; historical reports unaffected; AGM sees no rename control. Hold for Juan's preview smoke.

## Self-review notes
- Spec coverage: table+seed (T1), loader+writer+columns (T2), label surfacing (T3), operator render (T4), route (T5), admin UI (T6), verification (T7). ✓
- No-op safety: seeded labels = today's display → renders identically until a rename. Operator columns read stored `prep_meta.columns` (untouched). ✓
- Append-only: rename edits the label in place (config, not history); slug never changes; frozen snapshots reference the slug and render via the label. ✓
- Confirm-before-authoring: T2/T4 re-read the columns path + the section-component `sectionDisplay` seam; T1 re-reads the ES i18n section keys to seed `label_es` for a true no-op.
- Authority: section rename MoO+ (≥8, Tier B), per Juan.
