# Units Registry + Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make par units a first-class registry with a dropdown (+ MoO+ add-new), normalize the existing drift, and make the unit an item-global attribute (par grid shows it read-only).

**Architecture:** New `units` table seeded with the 8 canonical units; a normalize backfill maps existing free-text par_unit values (across items/overrides/lines) to canonical labels; unit selection becomes a `<select>` on item create/edit + add-local; the resolver sources the unit from `item.default_par_unit` only (par grid unit read-only; `item_par_levels.par_unit` goes vestigial).

**Tech Stack:** Next 16 App Router, Supabase Postgres 17 (service-role admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens. No test framework — `tsc --noEmit` + `next build` + throwaway tsx smokes (deleted before commit). Migrations via Supabase MCP (prod ref `bgcvurheqzylyfehqgzh`) + captured.

**Branch:** `claude/units-registry` (off main `2a98c39`; spec `33d4b3f`).

**Spec:** `docs/superpowers/specs/2026-06-23-units-registry-design.md` — re-read before each task.

**Canonical units + normalize map:** `1/3 Pan` (← `1/3 pan`,`1/3rd pan`,`3rd Pan`), `Quart` (← `QT`), `Bottle` (← `BTL`), `Piece` (← `Piece`), `Bag` (← `BAG`), `Logs` (← `LOGS`), `Min` (← `min`), `Bundle` (new, no existing mapping).

---

### Task 1: Migration 0084 — `units` table + seed + audit action

**Files:** MCP `apply_migration` (name `units`) → Create `supabase/migrations/0084_units.sql`; Modify `lib/destructive-actions.ts`.

- [ ] **Step 1:** Confirm latest migration is 0083, else renumber.
- [ ] **Step 2:** Apply DDL + seed:
```sql
create table public.units (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index units_active_order on public.units (active, display_order);
alter table public.units enable row level security;
create policy units_no_user_select on public.units for select using (false);
create policy units_no_user_insert on public.units for insert with check (false);
create policy units_no_user_update on public.units for update using (false) with check (false);
create policy units_no_user_delete on public.units for delete using (false);

insert into public.units (label, display_order) values
  ('1/3 Pan',1),('Quart',2),('Bottle',3),('Piece',4),('Bag',5),('Logs',6),('Min',7),('Bundle',8)
on conflict (label) do nothing;
```
- [ ] **Step 3:** Verify 8 rows, RLS on, 4 deny policies. Capture `supabase/migrations/0084_units.sql`.
- [ ] **Step 4:** Add audit action `unit.create` to `lib/destructive-actions.ts`.
- [ ] **Step 5:** `npx tsc --noEmit`; commit.

---

### Task 2: Normalize backfill (committed script) + run

**Files:** Create `scripts/backfill-units-normalize.ts` (idempotent, `--dry-run`).

- [ ] **Step 1: Re-read** an existing backfill script (`scripts/backfill-par-layer.ts`) for the service-role client + idempotency + `pathToFileURL` main-gate idioms.
- [ ] **Step 2: Write the script** — a canonical map:
```ts
const CANON: Record<string, string> = {
  "1/3 pan": "1/3 Pan", "1/3rd pan": "1/3 Pan", "3rd pan": "1/3 Pan",
  "qt": "Quart", "btl": "Bottle", "piece": "Piece", "bag": "Bag", "logs": "Logs", "min": "Min",
};
const canon = (raw: string): string | null => CANON[raw.trim().toLowerCase()] ?? null;
```
Apply to all 3 columns: `items.default_par_unit`, `item_par_levels.par_unit`, `checklist_template_items.prep_meta.parUnit` (the last is jsonb — update `prep_meta` with the canonical parUnit). For each row whose current value maps to a canonical that DIFFERS, update it. Idempotent: rows already canonical are skipped (canon(canonical) returns the same, no-op). Log a per-column summary of changes. `--dry-run` computes + logs, no writes. Unmapped values (none expected) → log + leave untouched.
- [ ] **Step 3:** `tsc`; commit (do NOT run yet — Task 2.5 runs it).

---

### Task 2.5: Run the normalize backfill (orchestrator gate)
> Controller-run.
- [ ] Dry-run → review the change summary. Real run. Re-run (idempotent → 0 changes). Verify the distinct-units query returns only canonical labels.

---

### Task 3: Lib — loadUnits, view.units, resolver unit→item-only, addUnit

**Files:** Create `lib/units.server.ts`; Modify `lib/items.ts` (resolver), `lib/admin/templates.ts` (`loadChecklistAdminView` + `setItemPar` + `addUnit`).

- [ ] **Step 1: Re-read** `lib/items.ts resolveLineDefinition` (the `parUnit = override?.parUnit ?? item.defaultParUnit` line) + `setItemPar` (writes `par_unit`) + `loadChecklistAdminView`.
- [ ] **Step 2: `lib/units.server.ts`** `loadUnits(service) → { label: string }[]` (active, by display_order). (Header SERVER-ONLY convention per `lib/prep-sections.server.ts`.)
- [ ] **Step 3: Resolver** — `resolveLineDefinition` parUnit becomes `item.defaultParUnit` (drop the `override?.parUnit ??`). Unit is item-global now.
- [ ] **Step 4: `setItemPar`** — stop writing `par_unit` (insert `par_unit: null`); drop `parUnit` from its args (or accept + ignore). The par override carries only value/mode now.
- [ ] **Step 5: `loadChecklistAdminView`** — add `units: { label: string }[]` (from `loadUnits`).
- [ ] **Step 6: `addUnit(actor, { label })`** — validate non-empty + not duplicate (case-insensitive) → insert `units` row (display_order = max+1); audit `unit.create`. (Route gates MoO+.)
- [ ] **Step 7:** `tsc`; commit.

---

### Task 4: Route — add-new-unit (MoO+)

**Files:** Create `app/api/admin/checklist-templates/units/route.ts`.
- [ ] POST handler: self-gate `requireSession → level ≥ 8 (MoO+) → assertStepUp("B") → parse { label } → addUnit → try/catch AdminTemplateError`. Validate `label` non-empty string.
- [ ] `tsc` + `build`; commit.

---

### Task 5: UI — unit dropdowns + par-grid read-only unit + add-new

**Files:** Modify `components/admin/templates/GlobalRegistryTab.tsx` (RegistryRow + AddGlobalItem unit → select + add-new), `components/admin/templates/AddPrepItemForm.tsx` (unit → select), `components/admin/templates/ParGrid.tsx` (unit read-only), `ChecklistTabs.tsx` (pass units), `lib/i18n/{en,es}.json`.

- [ ] **Step 1: Re-read** the current unit (`parUnit`/`recommendedParUnit`) text inputs in those components + how `view` props thread (sections is the model).
- [ ] **Step 2:** Thread `units` from `loadChecklistAdminView` → `ChecklistTabs` → `GlobalRegistryTab` (+ its rows) + `LocationChecklistTab` → `ParGrid`/`AddPrepItemForm`.
- [ ] **Step 3: RegistryRow + AddGlobalItem** — the unit field becomes a `<select>` (options = `units.label`, value = label; include a blank "—"). Plus an **add-new-unit** affordance (MoO+ only): a small "+ Add unit" that prompts for a label → `POST /units` → `router.refresh()`. (Inline near the unit select, or a tiny units control at the top of the Global tab — implementer's call; gate MoO+.)
- [ ] **Step 4: ParGrid** — remove the editable `parUnit` input; show the item's unit as read-only context (passed in) or omit. Stop sending `parUnit` in the `savePar` PATCH.
- [ ] **Step 5: AddPrepItemForm** — unit `<select>` from `units`.
- [ ] **Step 6:** i18n EN+ES (add-unit label/prompt, any new strings; reuse `field.par_unit`). `tsc` + `build`; commit.

---

### Task 6: Smoke + final gate
- [ ] **Step 1: Throwaway smoke** (deleted): `loadUnits` returns 8; `addUnit` inserts + audits; `loadChecklistAdminView` surfaces units; resolver returns the item's unit. Delete.
- [ ] **Step 2:** Confirm the distinct-units query (3 columns) returns only canonical labels. `tsc` + `build` clean; no `_smoke_*` staged.
- [ ] **Step 3:** Push; PR with the smoke plan (prep sheets show normalized units; item create/edit unit is a dropdown; MoO+ adds a unit → in the dropdown; par grid unit read-only). Hold for Juan's preview smoke.

## Self-review notes
- Spec coverage: table+seed (T1), normalize (T2/2.5), lib+resolver+addUnit (T3), route (T4), UI (T5), verification (T6). ✓
- Operator render reads the normalized stored string — no operator-side code change beyond the values being cleaned. ✓
- Unit is item-global: resolver drops the override-unit branch; par grid unit read-only; `item_par_levels.par_unit` vestigial (stop writing). Confirm no other reader of `item_par_levels.par_unit` exists (grep) before dropping. ✓
- Authority: add-unit MoO+; pick-unit follows the item-definition gate (create GM+/edit MoO+) — no new gating beyond /units.
- Confirm-before-authoring: T2 re-reads the jsonb prep_meta update; T3 greps for `par_unit` readers before making it vestigial.
