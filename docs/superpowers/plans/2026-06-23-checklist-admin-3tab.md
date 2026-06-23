# 3-Tab Checklist Admin Implementation Plan (Spine 2B′)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restructure the prep-checklist admin into a 3-tab IA (Global registry/default + one tab per location) with a capability ladder (AGM+ location par/enable-disable, GM+ add-to-registry, MoO+ defaults/definitions) and default-flag inheritance.

**Architecture:** Builds on the 2B engine (global items + `item_par_levels` + day-aware resolver — unchanged). Adds `items.is_default` (default-template membership) + propagation; new aggregate admin loader; capability-gated routes; checklist-first navigation with a Global tab (registry) and per-location tabs (par + enable/disable). Replaces the single `PrepItemEditPanel` mixed-authority UX.

**Tech Stack:** Next 16 App Router, Supabase Postgres 17 (service-role admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens. No test framework — `tsc --noEmit` + `next build` + throwaway tsx smokes (deleted before commit). Migrations via Supabase MCP (prod ref `bgcvurheqzylyfehqgzh`) + captured.

**Branch:** `claude/par-layer` (PR #84) — additional commits; the 2B engine commits stay.

**Spec:** `docs/superpowers/specs/2026-06-23-checklist-admin-3tab-design.md` — re-read before each task.

---

### Task 1: Migration 0081 — `items.is_default` + backfill + audit action

**Files:** MCP `apply_migration` (name `items_is_default`) + Create `supabase/migrations/0081_items_is_default.sql`; Modify `lib/destructive-actions.ts`.

- [ ] **Step 1: Confirm latest migration is 0080**, else renumber.
- [ ] **Step 2: Apply DDL + backfill in one migration**

```sql
alter table public.items add column is_default boolean not null default false;
-- Backfill: every existing GLOBAL item is currently part of the default set
-- (keeps today's behavior — all global items propagate by default).
update public.items set is_default = true where location_id is null and active;
```

- [ ] **Step 3: Verify** — `select count(*) filter (where is_default) from items where location_id is null;` should equal the active-global count (43 + Chicken Cutlet = 44).
- [ ] **Step 4: Capture** `supabase/migrations/0081_items_is_default.sql` with the going-forward header + canonical reference to `lib/admin/templates.ts setItemDefault`.
- [ ] **Step 5:** Add audit action `item.set_default` to `lib/destructive-actions.ts` (near the 2B `item_par.update` / `item.promote_to_global` entries).
- [ ] **Step 6:** `npx tsc --noEmit`; commit.

---

### Task 2: Lib — default propagation, registry add, enable-at-location

**Files:** Modify `lib/admin/templates.ts` (+ `lib/types.ts` add `isDefault` to `Item`).

**Context (re-read):** `addPrepItem` (creates a NEW item + line + override + opening mirror), `removePrepItem` (deactivates a line + opening mirror), `createOpeningMirror`, `setItemPar`, `promoteItemToGlobal`, `loadAuthorizedPrepTemplate`, `resolveActiveOpeningTemplateId`, `seedPrepItem`, `getPrepTemplateDetail`. Reuse them.

- [ ] **Step 1: Re-read** the functions above + how a line links an item (`item_id`) + the opening-mirror `references_template_item_id` linkage.

- [ ] **Step 2: `setItemDefault` (MoO+ at route) — toggle + propagate**

```ts
export async function setItemDefault(
  actor: AuthContext,
  args: { itemId: string; isDefault: boolean },
): Promise<{ propagatedLocationIds: string[] }>
```
- Read the item (must be global — `location_id IS NULL`; else 409 `not_global`). 404 if missing/inactive.
- `UPDATE items SET is_default = args.isDefault, updated_by, updated_at`.
- **If turning ON:** for every active location, ensure an active AM-prep line linking this item exists; where missing, create one (link the existing global item — NOT a new item) on that location's active am-prep template + its Opening mirror (reuse `createOpeningMirror` with the item id). Seed an all-days `item_par_levels` row per location only if absent (inherit mode is fine — resolver falls back to the recommendation). Return the location ids propagated to.
- **If turning OFF:** do NOT deactivate existing location lines (append-only; locations keep what they run). Just flip the flag. Return [].
- Audit `item.set_default` with before/after + propagatedLocationIds.

- [ ] **Step 3: `addRegistryItem` (GM+ at route) — create a global item, no location line**

```ts
export async function addRegistryItem(
  actor: AuthContext,
  args: { name: string; nameEs: string | null; section: PrepSection;
          recommendedPar: number | null; recommendedParUnit: string | null; isDefault: boolean },
): Promise<{ itemId: string; propagatedLocationIds: string[] }>
```
- Validate name non-empty, section valid, par ≥0 or null.
- INSERT `items` (location_id NULL = global, kind 'manual', name/name_es/section/default_par/default_par_unit, is_default, created_by). 
- If `isDefault` → run the same propagation as `setItemDefault` ON (create lines + mirrors + overrides at all locations). Else no lines (à-la-carte; locations enable later).
- Audit `item.create` (metadata: scope global, is_default, propagated).

- [ ] **Step 4: `enableRegistryItemAtLocation` (AGM+ at route) — link an existing global item onto a location**

```ts
export async function enableRegistryItemAtLocation(
  actor: AuthContext,
  args: { locationId: string; subtype: "am_prep" | "mid_day_prep"; itemId: string },
): Promise<{ lineId: string; openingMirrorId: string | null }>
```
- IDOR: `locationId` in actor's authorized set (or all-locations). The item must be a global registry item (`location_id IS NULL`, active) — else 409.
- Resolve the location's active template for `subtype`. If an active line already links this item there → idempotent no-op (return it).
- Create a line on that template linking the EXISTING item (set `item_id`, copy section from the item; do NOT create a new item). For `am_prep`, also create the Opening mirror (reuse `createOpeningMirror` with the item id). Seed an all-days `item_par_levels` (inherit) for the location if absent.
- Audit `checklist_template_item.create` (metadata: enabled_from_registry true, item_id).

- [ ] **Step 5: Disable = reuse `removePrepItem`** (already deactivates the line + opening mirror). The location-tab route calls it (re-gated AGM+ in Task 4). No new lib fn.

- [ ] **Step 6:** Add `isDefault` to the `Item` type (`lib/types.ts`). `npx tsc --noEmit`; commit.

---

### Task 3: Lib — `loadChecklistAdminView` aggregate loader

**Files:** Modify `lib/admin/templates.ts`.

- [ ] **Step 1:** Build the aggregate loader the tabbed page needs:

```ts
export interface ChecklistAdminView {
  subtype: "am_prep" | "mid_day_prep";
  actorLevel: number;
  registry: Array<{ itemId: string; name: string; nameEs: string | null; section: string | null;
                    recommendedPar: number | null; recommendedParUnit: string | null; isDefault: boolean }>;
  locations: Array<{ locationId: string; name: string; code: string; templateId: string | null;
                     items: ChecklistTemplateItem[]; parContext: Record<string, PrepLineParContext>;
                     enabledItemIds: string[] }>;
}
export async function loadChecklistAdminView(
  actor: AuthContext, subtype: "am_prep" | "mid_day_prep",
): Promise<ChecklistAdminView>
```
- `registry` = all active global items (`location_id IS NULL`) grouped/sorted by section (the pool the Global tab shows; `isDefault` marks default members).
- `locations` = each accessible location (respect `isAllLocationsAccess` + `auth.locations`): resolve its active template for `subtype`, reuse `getPrepTemplateDetail`'s item+parContext logic (extract a shared helper if cleaner), and `enabledItemIds` = the item ids the location currently runs (active lines).
- `actorLevel` from `ROLES[actor.user.role].level`.

- [ ] **Step 2:** `npx tsc --noEmit`; commit.

---

### Task 4: Routes — capability-gated registry + default + enable/disable

**Files:** new + modified route handlers under `app/api/admin/checklist-templates/...`. Re-read the existing 2B routes first.

- [ ] **Step 1:** New `POST .../registry` (or `.../items/registry`) → `addRegistryItem` — **GM+ (≥7)**, Tier B.
- [ ] **Step 2:** New `PATCH .../items/[itemId]/default` → `setItemDefault` — **MoO+ (≥8)**, Tier B.
- [ ] **Step 3:** New `POST .../[id]/items/enable` (body: itemId) → `enableRegistryItemAtLocation` — **AGM+ (≥6)**, Tier A. (`[id]` = the location's template id; or carry locationId+subtype — implementer's call, keep IDOR via `loadAuthorizedPrepTemplate`.)
- [ ] **Step 4:** Re-gate existing routes to the locked ladder: `definition` MoO+ (≥8) ✓ already; `par` AGM+ (≥6) ✓ already; `promote` MoO+ ✓; the main content PATCH (line content) — keep GM+ (≥7); **the existing add-item `POST .../[id]/items` (currently ≥6 from 2B): split** — brand-new-item creation is now `addRegistryItem` (GM+); the old per-location addPrepItem path is superseded by enable-from-registry (AGM+). Decide: keep `addPrepItem` for "GM+ adds a new item AND places it" or retire it in favor of addRegistryItem + enable. Simplest: repoint the add-item route to `addRegistryItem` (GM+) and rely on propagation/enable for placement. Confirm during implementation; keep `removePrepItem` (disable) reachable from the location tab at AGM+ (re-gate its route to ≥6).
- [ ] **Step 5:** i18n error codes (`not_global`, etc.) + audit wired. `tsc` + `build`; commit.

---

### Task 5: UI — checklist-first nav + 3-tab page (Global + per-location)

**Files:** rewrite `app/admin/checklist-templates/page.tsx` (list → checklist types); new tabbed page; new `GlobalRegistryTab` + `LocationChecklistTab` components; retire/repoint `PrepItemEditPanel`/`PrepTemplateEditor` into the location tab; `lib/i18n/{en,es}.json`.

- [ ] **Step 1:** List page → list the **checklist types** (AM Prep, Mid-day) instead of per-location templates; each links to the tabbed page for that subtype.
- [ ] **Step 2:** Tabbed page (`/admin/checklist-templates/[subtype]` or `?subtype=`): loads `loadChecklistAdminView`; renders tabs **Global | <each location>** (client tab switcher). Default tab = Global for ≥7, else the actor's first location.
- [ ] **Step 3:** **GlobalRegistryTab** — registry items grouped by section: name + recommended par + section + **default toggle** (MoO+ → `…/items/[itemId]/default`), **edit definition** (MoO+ → `…/items/[itemId]/definition`), **add new item** (GM+ → `…/registry`). "Edits here apply to every location" banner. Gate controls by `actorLevel` (toggle/definition ≥8, add ≥7; below that, read-only registry view).
- [ ] **Step 4:** **LocationChecklistTab** (one per location) — items this location runs, each with the **par grid** (all-days + per-day + `par_mode`, AGM+ → `…/par`) and a **disable** button (AGM+ → DELETE). An **enable-from-registry** picker (AGM+ → `…/enable`) listing registry items not yet enabled here. Item **name read-only** with "edit in Global" pointer. "Affects only <location>" note. Reuse the 2B par-grid UI; drop the global-definition + promote controls from the location tab (they live in Global).
- [ ] **Step 5:** i18n EN+ES for all new strings (tabs, banners, default toggle, add-item form, enable picker, notes). `tsc` + `build`; commit.

---

### Task 6: Smoke + final gate

- [ ] **Step 1:** Throwaway smoke (deleted): `setItemDefault(on)` propagates lines to both locations; `enableRegistryItemAtLocation` links an existing item at one location only; `removePrepItem` disables at one location only; `addRegistryItem` creates a global item (+ propagates if default); par override still per-location/day. Delete the smoke.
- [ ] **Step 2:** Parity check still 0 (engine unchanged).
- [ ] **Step 3:** `tsc` + `build` clean; no `_smoke_*` staged.
- [ ] **Step 4:** Push; the PR #84 description gets an addendum (the 3-tab smoke steps from the spec). Hold for Juan's preview smoke.

## Self-review notes
- Spec coverage: IA (T5), capability ladder (T4 gates), default flag + propagate (T1/T2), registry add (T2/T4), enable/disable (T2/T4/T5), definitions (existing 2B route reused). ✓
- Engine untouched: resolver / `item_par_levels` / loaders / submit snapshots unchanged — parity must stay 0. ✓
- Confirm-before-authoring: T2/T4 re-read the add/remove/mirror primitives + existing routes; the add-item route re-gating is explicitly flagged to confirm.
- Append-only: disable = deactivate line; un-default keeps lines; no deletes.
