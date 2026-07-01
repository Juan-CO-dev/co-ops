# Recipe Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recipes first-class — a two-tier recursive `recipes` entity (production → items, consumer → menu items) that owns SKU/sub-item inputs and item/menu outputs, with an `/admin/recipes` builder, container-vocabulary edge-labels, and the derivation engine repointed off `item_components` — all with zero operator-flow change.

**Architecture:** Repurpose the dormant 0-row `recipes` table + add polymorphic `recipe_inputs`/`recipe_outputs` + new `menu_items`. A new `lib/recipes.ts` data layer owns CRUD + a cycle guard. `lib/prep-consumption.ts` and `lib/admin/cost.ts` repoint to walk the recipe graph (item → its production recipe → inputs, recursing on sub-items), preserving `loadDerivedForItems`'s return shape so the prep panel is untouched. Fan-out (one recipe → many output items) allocates a batch's input oz across outputs by oz-share. Migrations run via Supabase MCP + captured as `supabase/migrations/010N_*.sql`.

**Tech Stack:** Next 16 App Router (admin at top-level `app/admin/`), Supabase Postgres 17 + custom-JWT RLS (service-role writes + app-layer gate), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n (`lib/i18n/{en,es}.json`).

**Branch:** `claude/recipe-stage` off `origin/main` (currently `471620c`). Single PR. CC is sole T0 reviewer + committer + runs the Supabase MCP migrations (0103, 0104). Subagents implement + never commit + never apply migrations. Model split: **Opus** on the engine repoint + fan-out allocation + the migrations/data-reparent + `lib/recipes.ts`; **Sonnet** on the builder UI, API routes, i18n, registry pickers.

**Spec:** `docs/superpowers/specs/2026-07-01-recipe-stage-design.md`

---

## File Structure

**New:**
- `supabase/migrations/0103_recipe_entities.sql` — repurpose `recipes` (+ columns) + create `recipe_inputs`, `recipe_outputs`, `menu_items` + deny-all RLS.
- `supabase/migrations/0104_reparent_composed_items.sql` — backfill: each item with `item_components` → a production recipe + inputs + outputs; add `menu_price` column to `menu_items` is already in 0103 (this file is data-only).
- `lib/recipes.ts` — recipe + menu-item data layer (types, list/detail loads, CRUD, input/output edges, cycle guard, authority floors).
- `app/admin/recipes/page.tsx` — recipe list (filter Production|Consumer|All).
- `app/admin/recipes/recipes-client.tsx` — client list + "New recipe".
- `app/admin/recipes/[id]/page.tsx` — server load of one recipe + form data.
- `components/admin/recipes/RecipeBuilder.tsx` — the adaptive builder form.
- `components/admin/recipes/RecipeInputRow.tsx`, `RecipeOutputRow.tsx` — edge rows.
- `app/api/admin/recipes/route.ts` (POST create), `app/api/admin/recipes/[id]/route.ts` (PATCH/DELETE), `app/api/admin/recipes/[id]/inputs/route.ts`, `.../outputs/route.ts`, `app/api/admin/menu-items/route.ts`.

**Modified:**
- `lib/prep-consumption.ts` — `perUnitSkuOzForItem` + `loadDerivedForItems` repoint to the recipe graph + fan-out allocation.
- `lib/admin/cost.ts` — `loadSkuUsageMap` repoint to recipe graph; add recipe-graph cost helper for the builder readout.
- `components/admin/templates/GlobalRegistryTab.tsx` — replace the `MadeFromEditor` expander with a "Production recipe →" link; drop the item menu_price editor.
- `app/admin/page.tsx` — add the Recipes hub card.
- `lib/i18n/en.json`, `lib/i18n/es.json` — `recipes.*` keys (parity).

**Absorbed (reads removed, files kept dormant for rollback):**
- `components/admin/templates/MadeFromEditor.tsx`, `lib/admin/item-components.ts`, `app/api/admin/items/[id]/components/*` — no longer wired; not deleted this PR.

---

## Task 1: Migration 0103 — recipe entity tables + branch

**Files:**
- Create: `supabase/migrations/0103_recipe_entities.sql`

- [ ] **Step 1: Create the branch**

```bash
git fetch origin main && git checkout -b claude/recipe-stage origin/main
```

- [ ] **Step 2: Verify current recipes RLS + confirm dormancy (CC runs, not subagent)**

Run via Supabase MCP `execute_sql` against project `bgcvurheqzylyfehqgzh`:

```sql
select policyname, cmd, qual, with_check from pg_policies where tablename='recipes' order by cmd;
select count(*) from recipes;  -- expect 0
```

Expected: `recipes` has policies; 0 rows. If any policy is `FOR ALL` on a write, note it — the new tables must use the split pattern regardless.

- [ ] **Step 3: Write the migration file**

```sql
-- Migration 0103_recipe_entities
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-recipe-stage-design.md §3
-- Recipe stage: repurpose the dormant 0-row `recipes` table into the two-tier
-- recipe hub (production|consumer) + polymorphic recipe_inputs/recipe_outputs
-- + new menu_items. Deny-all RLS (service-role writes; app-layer gate in lib/recipes.ts).

-- 1. Extend the dormant recipes table (0 rows → all adds are safe/no-backfill).
alter table recipes add column recipe_type text not null default 'production'
  check (recipe_type in ('production','consumer'));
alter table recipes alter column recipe_type drop default;  -- force explicit going forward
alter table recipes add column batch_yield numeric not null default 1 check (batch_yield > 0);
alter table recipes add column name_es text;
alter table recipes add column directions text;
alter table recipes add column directions_es text;
alter table recipes add column updated_by uuid;

-- 2. recipe_inputs — SKU XOR sub-item edge.
create table recipe_inputs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  component_sku_id uuid references vendor_items(id),
  component_item_id uuid references items(id),
  quantity numeric not null check (quantity > 0),
  unit text,
  each_container_label text,
  portioned boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint recipe_inputs_exactly_one_component
    check ((component_sku_id is not null) <> (component_item_id is not null))
);
create index recipe_inputs_recipe_idx on recipe_inputs(recipe_id);
create index recipe_inputs_sku_idx on recipe_inputs(component_sku_id);
create index recipe_inputs_item_idx on recipe_inputs(component_item_id);

-- 3. recipe_outputs — item XOR menu_item; fan-out = multiple rows.
create table recipe_outputs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  output_item_id uuid references items(id),
  output_menu_item_id uuid,  -- FK added after menu_items exists (below)
  yield numeric not null check (yield > 0),
  output_container_label text,
  oz_alloc_share numeric check (oz_alloc_share is null or oz_alloc_share > 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint recipe_outputs_exactly_one_target
    check ((output_item_id is not null) <> (output_menu_item_id is not null))
);
create index recipe_outputs_recipe_idx on recipe_outputs(recipe_id);
create index recipe_outputs_item_idx on recipe_outputs(output_item_id);
create index recipe_outputs_menu_item_idx on recipe_outputs(output_menu_item_id);

-- 4. menu_items — the sold leaf; menu_price moves here from items (0 items use it today).
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_es text,
  menu_price numeric check (menu_price is null or menu_price >= 0),
  toast_ref text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table recipe_outputs
  add constraint recipe_outputs_menu_item_fk
  foreign key (output_menu_item_id) references menu_items(id);

-- 5. Deny-all RLS (split per-op; service-role bypasses; app-layer gates writes).
alter table recipe_inputs enable row level security;
create policy recipe_inputs_no_user_select on recipe_inputs for select using (false);
create policy recipe_inputs_no_user_insert on recipe_inputs for insert with check (false);
create policy recipe_inputs_no_user_update on recipe_inputs for update using (false);
create policy recipe_inputs_no_user_delete on recipe_inputs for delete using (false);

alter table recipe_outputs enable row level security;
create policy recipe_outputs_no_user_select on recipe_outputs for select using (false);
create policy recipe_outputs_no_user_insert on recipe_outputs for insert with check (false);
create policy recipe_outputs_no_user_update on recipe_outputs for update using (false);
create policy recipe_outputs_no_user_delete on recipe_outputs for delete using (false);

alter table menu_items enable row level security;
create policy menu_items_no_user_select on menu_items for select using (false);
create policy menu_items_no_user_insert on menu_items for insert with check (false);
create policy menu_items_no_user_update on menu_items for update using (false);
create policy menu_items_no_user_delete on menu_items for delete using (false);
```

- [ ] **Step 4: CC applies the migration**

CC (not a subagent) applies via Supabase MCP `apply_migration` with name `0103_recipe_entities` and the body above. Verify with:

```sql
select column_name from information_schema.columns where table_name='recipes' and column_name in ('recipe_type','batch_yield','name_es','directions');
select count(*) from recipe_inputs; select count(*) from recipe_outputs; select count(*) from menu_items;
```

Expected: 4 recipes columns present; three counts = 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0103_recipe_entities.sql
git commit -m "$(cat <<'EOF'
feat(recipes): migration 0103 — recipe entities (recipes+inputs+outputs+menu_items)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration 0104 — reparent composed items

**Files:**
- Create: `supabase/migrations/0104_reparent_composed_items.sql`

**Context:** Today the only composition is the Hot Peppers item (1 `item_components` row). This migration is written generically (handles N composed items) but touches 1 row in prod. For each item that has ≥1 `item_components` row: create one `production` recipe (batch_yield = the item's `batch_yield`), copy its `item_components` into `recipe_inputs`, and create one `recipe_outputs` row → the item (yield = the item's `batch_yield`, so per-unit oz is byte-identical post-repoint). `menu_price` needs no data move (0 items use it).

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 0104_reparent_composed_items
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-recipe-stage-design.md §6
-- Reparent every item with item_components into a production recipe (+inputs+outputs).
-- yield = the item's batch_yield so the repointed engine's per-unit oz is identical.

with composed as (
  select distinct i.id as item_id, i.name, i.name_es, coalesce(i.batch_yield,1) as by_
  from items i join item_components ic on ic.item_id = i.id
),
new_recipe as (
  insert into recipes (id, name, name_es, recipe_type, batch_yield, active, created_by)
  select gen_random_uuid(), c.name, c.name_es, 'production', c.by_, true, null
  from composed c
  returning id, name
)
-- map recipe back to item by name (names are unique enough for the 1-row reparent;
-- verified pre-apply). Insert inputs + a single output per composed item.
, mapped as (
  select nr.id as recipe_id, c.item_id, c.by_
  from new_recipe nr join composed c on c.name = nr.name
)
, ins_inputs as (
  insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, quantity, unit, display_order, created_by)
  select m.recipe_id, ic.component_sku_id, ic.component_item_id, ic.quantity, ic.unit, ic.display_order, null
  from mapped m join item_components ic on ic.item_id = m.item_id
  returning 1
)
insert into recipe_outputs (recipe_id, output_item_id, yield, output_container_label, display_order, created_by)
select m.recipe_id, m.item_id, m.by_, (select default_par_unit from items where id = m.item_id), 0, null
from mapped m;
```

- [ ] **Step 2: CC pre-verifies name-uniqueness of composed items, then applies**

CC runs (guards the name-join assumption in the CTE):

```sql
select name, count(*) from items i where exists (select 1 from item_components ic where ic.item_id=i.id) group by name having count(*)>1;
```

Expected: 0 rows (no duplicate names among composed items). If any, CC rewrites the migration to map by a temp id column instead of name before applying. Then CC applies via `apply_migration` name `0104_reparent_composed_items`.

- [ ] **Step 3: Verify the reparent landed**

```sql
select r.id, r.name, r.recipe_type, r.batch_yield,
  (select count(*) from recipe_inputs ri where ri.recipe_id=r.id) as inputs,
  (select count(*) from recipe_outputs ro where ro.recipe_id=r.id) as outputs
from recipes r where r.recipe_type='production';
```

Expected: 1 recipe "Hot Peppers", 1 input (the 512 oz SKU), 1 output (the Hot Peppers item), batch_yield 1.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0104_reparent_composed_items.sql
git commit -m "$(cat <<'EOF'
feat(recipes): migration 0104 — reparent composed items into production recipes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `lib/recipes.ts` — recipe + menu-item data layer

**Files:**
- Create: `lib/recipes.ts`

**Context:** Mirror the shape of `lib/admin/item-components.ts` (service-role, per-action `requireLevel`, `AuthContext` actor, `num`/`normalizeUnit` helpers, audit on writes). Authority floors: `RECIPE_READ_MIN = 6` (AGM+ view), `RECIPE_WRITE_MIN = 7` (GM+ create/edit inputs/outputs/directions/yields), `MENU_PRICE_MIN = 8` (MoO+ sets menu_price). PostgREST returns numeric as strings — coerce with `num`.

- [ ] **Step 1: Types + guards + list load**

```ts
/**
 * Recipe stage data layer (Derivation Spine #1). SERVER-ONLY, service-role;
 * authority re-checked per action (the lib is the authority). Two tiers via
 * recipe_type: 'production' (→ items) | 'consumer' (→ menu_items). See spec §3.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const RECIPE_READ_MIN = 6;
export const RECIPE_WRITE_MIN = 7;
export const MENU_PRICE_MIN = 8;

export type RecipeType = "production" | "consumer";

export interface RecipeInputView {
  id: string; componentSkuId: string | null; componentItemId: string | null;
  componentName: string; quantity: number; unit: string | null;
  eachContainerLabel: string | null; portioned: boolean; displayOrder: number;
}
export interface RecipeOutputView {
  id: string; outputItemId: string | null; outputMenuItemId: string | null;
  outputName: string; yield: number; outputContainerLabel: string | null;
  ozAllocShare: number | null; displayOrder: number;
}
export interface RecipeView {
  id: string; name: string; nameEs: string | null; recipeType: RecipeType;
  batchYield: number; directions: string | null; directionsEs: string | null;
  active: boolean; inputs: RecipeInputView[]; outputs: RecipeOutputView[];
}
export interface RecipeListRow {
  id: string; name: string; recipeType: RecipeType; active: boolean;
  outputNames: string[];
}

export class RecipeError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code); this.name = "RecipeError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new RecipeError(403, "forbidden");
}
function num(v: number | string | null): number | null {
  if (v === null) return null; const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function normStr(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null; const t = s.trim(); return t || null;
}

/** List recipes (≥6), optional type filter, with hydrated output names. */
export async function loadRecipes(actor: AuthContext, type?: RecipeType): Promise<RecipeListRow[]> {
  requireLevel(actor, RECIPE_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb.from("recipes").select("id, name, recipe_type, active").eq("active", true).order("name");
  if (type) q = q.eq("recipe_type", type);
  const { data, error } = await q.returns<Array<{ id: string; name: string; recipe_type: RecipeType; active: boolean }>>();
  if (error) throw new Error(`loadRecipes: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id);
  const outNames = await outputNamesByRecipe(ids);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, recipeType: r.recipe_type, active: r.active, outputNames: outNames.get(r.id) ?? [] }));
}
```

- [ ] **Step 2: Detail load + output-name hydration + menu-item helpers**

```ts
async function outputNamesByRecipe(recipeIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (recipeIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: rows } = await sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id")
    .in("recipe_id", recipeIds).returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>>();
  const itemIds = [...new Set((rows ?? []).map((r) => r.output_item_id).filter((v): v is string => !!v))];
  const menuIds = [...new Set((rows ?? []).map((r) => r.output_menu_item_id).filter((v): v is string => !!v))];
  const itemNames = await namesById("items", itemIds);
  const menuNames = await namesById("menu_items", menuIds);
  for (const r of rows ?? []) {
    const list = out.get(r.recipe_id) ?? [];
    list.push(r.output_item_id ? (itemNames.get(r.output_item_id) ?? "(item)") : (menuNames.get(r.output_menu_item_id ?? "") ?? "(menu item)"));
    out.set(r.recipe_id, list);
  }
  return out;
}
async function namesById(table: "items" | "menu_items" | "vendor_items", ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>(); if (ids.length === 0) return m;
  const sb = getServiceRoleClient();
  const { data } = await sb.from(table).select("id, name").in("id", ids).returns<Array<{ id: string; name: string }>>();
  for (const r of data ?? []) m.set(r.id, r.name); return m;
}

/** Full recipe with hydrated inputs + outputs (≥6). */
export async function loadRecipe(actor: AuthContext, recipeId: string): Promise<RecipeView | null> {
  requireLevel(actor, RECIPE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: r } = await sb.from("recipes").select("id, name, name_es, recipe_type, batch_yield, directions, directions_es, active").eq("id", recipeId)
    .maybeSingle<{ id: string; name: string; name_es: string | null; recipe_type: RecipeType; batch_yield: number | string; directions: string | null; directions_es: string | null; active: boolean }>();
  if (!r) return null;
  const { data: inRows } = await sb.from("recipe_inputs").select("*").eq("recipe_id", recipeId).order("display_order")
    .returns<Array<{ id: string; component_sku_id: string | null; component_item_id: string | null; quantity: number | string; unit: string | null; each_container_label: string | null; portioned: boolean; display_order: number }>>();
  const { data: outRows } = await sb.from("recipe_outputs").select("*").eq("recipe_id", recipeId).order("display_order")
    .returns<Array<{ id: string; output_item_id: string | null; output_menu_item_id: string | null; yield: number | string; output_container_label: string | null; oz_alloc_share: number | string | null; display_order: number }>>();
  const skuNames = await namesById("vendor_items", (inRows ?? []).map((x) => x.component_sku_id).filter((v): v is string => !!v));
  const subNames = await namesById("items", (inRows ?? []).map((x) => x.component_item_id).filter((v): v is string => !!v));
  const outItemNames = await namesById("items", (outRows ?? []).map((x) => x.output_item_id).filter((v): v is string => !!v));
  const outMenuNames = await namesById("menu_items", (outRows ?? []).map((x) => x.output_menu_item_id).filter((v): v is string => !!v));
  return {
    id: r.id, name: r.name, nameEs: r.name_es, recipeType: r.recipe_type, batchYield: num(r.batch_yield) ?? 1,
    directions: r.directions, directionsEs: r.directions_es, active: r.active,
    inputs: (inRows ?? []).map((x) => ({ id: x.id, componentSkuId: x.component_sku_id, componentItemId: x.component_item_id,
      componentName: x.component_sku_id ? (skuNames.get(x.component_sku_id) ?? "(sku)") : (subNames.get(x.component_item_id ?? "") ?? "(item)"),
      quantity: num(x.quantity) ?? 0, unit: x.unit, eachContainerLabel: x.each_container_label, portioned: x.portioned, displayOrder: x.display_order })),
    outputs: (outRows ?? []).map((x) => ({ id: x.id, outputItemId: x.output_item_id, outputMenuItemId: x.output_menu_item_id,
      outputName: x.output_item_id ? (outItemNames.get(x.output_item_id) ?? "(item)") : (outMenuNames.get(x.output_menu_item_id ?? "") ?? "(menu item)"),
      yield: num(x.yield) ?? 1, outputContainerLabel: x.output_container_label, ozAllocShare: num(x.oz_alloc_share), displayOrder: x.display_order })),
  };
}
```

- [ ] **Step 3: Create/update/deactivate recipe + menu item**

```ts
export async function createRecipe(actor: AuthContext, input: { name: string; nameEs?: string | null; recipeType: RecipeType; batchYield: number; directions?: string | null; directionsEs?: string | null }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (!normStr(input.name)) throw new RecipeError(400, "invalid_name");
  if (!Number.isFinite(input.batchYield) || input.batchYield <= 0) throw new RecipeError(400, "invalid_batch_yield");
  if (input.recipeType !== "production" && input.recipeType !== "consumer") throw new RecipeError(400, "invalid_type");
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("recipes").insert({ name: normStr(input.name), name_es: normStr(input.nameEs), recipe_type: input.recipeType, batch_yield: input.batchYield, directions: normStr(input.directions), directions_es: normStr(input.directionsEs), active: true, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`createRecipe: ${error.message}`);
  if (!data) throw new Error("createRecipe returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.create", resourceTable: "recipes", resourceId: data.id, metadata: { name: input.name, recipe_type: input.recipeType, batch_yield: input.batchYield }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

export async function updateRecipe(actor: AuthContext, id: string, patch: { name?: string; nameEs?: string | null; batchYield?: number; directions?: string | null; directionsEs?: string | null }): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.user.id };
  if (patch.name !== undefined) { if (!normStr(patch.name)) throw new RecipeError(400, "invalid_name"); upd.name = normStr(patch.name); }
  if (patch.nameEs !== undefined) upd.name_es = normStr(patch.nameEs);
  if (patch.batchYield !== undefined) { if (!(patch.batchYield > 0)) throw new RecipeError(400, "invalid_batch_yield"); upd.batch_yield = patch.batchYield; }
  if (patch.directions !== undefined) upd.directions = normStr(patch.directions);
  if (patch.directionsEs !== undefined) upd.directions_es = normStr(patch.directionsEs);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("recipes").update(upd, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`updateRecipe: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "recipe_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.update", resourceTable: "recipes", resourceId: id, metadata: { patch }, ipAddress: null, userAgent: null });
}

export async function deactivateRecipe(actor: AuthContext, id: string): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("recipes").update({ active: false, updated_at: new Date().toISOString(), updated_by: actor.user.id }, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`deactivateRecipe: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "recipe_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.deactivate", resourceTable: "recipes", resourceId: id, metadata: {}, ipAddress: null, userAgent: null });
}

export async function createMenuItem(actor: AuthContext, input: { name: string; nameEs?: string | null; menuPrice?: number | null }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (input.menuPrice != null) requireLevel(actor, MENU_PRICE_MIN);
  if (!normStr(input.name)) throw new RecipeError(400, "invalid_name");
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("menu_items").insert({ name: normStr(input.name), name_es: normStr(input.nameEs), menu_price: input.menuPrice ?? null, active: true, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`createMenuItem: ${error.message}`);
  if (!data) throw new Error("createMenuItem returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "menu_item.create", resourceTable: "menu_items", resourceId: data.id, metadata: { name: input.name }, ipAddress: null, userAgent: null });
  return { id: data.id };
}
```

- [ ] **Step 4: Input/output edge writes + cycle guard**

```ts
/** Adding output item `childItemId` to recipe R would cycle iff a SKU-free walk of
 * the recipe graph from childItemId's recipe reaches an input item already feeding R.
 * Simplified guard: reject if childItemId is (transitively) an input of the recipe. */
async function outputWouldCycle(recipeId: string, childItemId: string): Promise<boolean> {
  const sb = getServiceRoleClient();
  // item -> recipe (by output), recipe -> input items. Walk item edges.
  const { data: outs } = await sb.from("recipe_outputs").select("recipe_id, output_item_id").not("output_item_id", "is", null).returns<Array<{ recipe_id: string; output_item_id: string }>>();
  const { data: ins } = await sb.from("recipe_inputs").select("recipe_id, component_item_id").not("component_item_id", "is", null).returns<Array<{ recipe_id: string; component_item_id: string }>>();
  const recipeOfItem = new Map<string, string>(); for (const o of outs ?? []) recipeOfItem.set(o.output_item_id, o.recipe_id);
  const inputItemsOfRecipe = new Map<string, string[]>(); for (const i of ins ?? []) { const l = inputItemsOfRecipe.get(i.recipe_id) ?? []; l.push(i.component_item_id); inputItemsOfRecipe.set(i.recipe_id, l); }
  // Does recipeId (transitively) consume childItemId?
  const seen = new Set<string>(); const queue = [recipeId];
  while (queue.length) { const r = queue.shift()!; if (seen.has(r)) continue; seen.add(r);
    for (const it of inputItemsOfRecipe.get(r) ?? []) { if (it === childItemId) return true; const cr = recipeOfItem.get(it); if (cr) queue.push(cr); } }
  return false;
}

export async function addRecipeInput(actor: AuthContext, input: { recipeId: string; componentSkuId?: string | null; componentItemId?: string | null; quantity: number; unit?: string | null; eachContainerLabel?: string | null; portioned?: boolean }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const skuId = input.componentSkuId ?? null, itemId = input.componentItemId ?? null;
  if ((skuId === null) === (itemId === null)) throw new RecipeError(400, "invalid_component");
  if (!(input.quantity > 0)) throw new RecipeError(400, "invalid_quantity");
  const sb = getServiceRoleClient();
  const { data: max } = await sb.from("recipe_inputs").select("display_order").eq("recipe_id", input.recipeId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const { data, error } = await sb.from("recipe_inputs").insert({ recipe_id: input.recipeId, component_sku_id: skuId, component_item_id: itemId, quantity: input.quantity, unit: normStr(input.unit), each_container_label: normStr(input.eachContainerLabel), portioned: input.portioned ?? false, display_order: (max?.display_order ?? 0) + 1, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`addRecipeInput: ${error.message}`);
  if (!data) throw new Error("addRecipeInput returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_input.add", resourceTable: "recipe_inputs", resourceId: data.id, metadata: { recipe_id: input.recipeId, component_sku_id: skuId, component_item_id: itemId, quantity: input.quantity }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

export async function addRecipeOutput(actor: AuthContext, input: { recipeId: string; outputItemId?: string | null; outputMenuItemId?: string | null; yield: number; outputContainerLabel?: string | null }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const itemId = input.outputItemId ?? null, menuId = input.outputMenuItemId ?? null;
  if ((itemId === null) === (menuId === null)) throw new RecipeError(400, "invalid_output");
  if (!(input.yield > 0)) throw new RecipeError(400, "invalid_yield");
  if (itemId !== null && await outputWouldCycle(input.recipeId, itemId)) throw new RecipeError(400, "would_create_cycle");
  const sb = getServiceRoleClient();
  const { data: max } = await sb.from("recipe_outputs").select("display_order").eq("recipe_id", input.recipeId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const { data, error } = await sb.from("recipe_outputs").insert({ recipe_id: input.recipeId, output_item_id: itemId, output_menu_item_id: menuId, yield: input.yield, output_container_label: normStr(input.outputContainerLabel), display_order: (max?.display_order ?? 0) + 1, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`addRecipeOutput: ${error.message}`);
  if (!data) throw new Error("addRecipeOutput returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_output.add", resourceTable: "recipe_outputs", resourceId: data.id, metadata: { recipe_id: input.recipeId, output_item_id: itemId, output_menu_item_id: menuId, yield: input.yield }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

export async function removeRecipeEdge(actor: AuthContext, args: { table: "recipe_inputs" | "recipe_outputs"; id: string }): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { data: before } = await sb.from(args.table).select("*").eq("id", args.id).maybeSingle<Record<string, unknown>>();
  if (!before) throw new RecipeError(404, "edge_not_found");
  const { error, count } = await sb.from(args.table).delete({ count: "exact" }).eq("id", args.id);
  if (error) throw new Error(`removeRecipeEdge: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "edge_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: `${args.table === "recipe_inputs" ? "recipe_input" : "recipe_output"}.remove`, resourceTable: args.table, resourceId: args.id, metadata: { before }, ipAddress: null, userAgent: null });
}
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit`
Expected: clean (no errors in `lib/recipes.ts`).

```bash
git add lib/recipes.ts
git commit -m "$(cat <<'EOF'
feat(recipes): lib/recipes.ts — recipe + menu-item data layer (CRUD + edges + cycle guard)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Engine repoint — `lib/prep-consumption.ts` reads the recipe graph

**Files:**
- Modify: `lib/prep-consumption.ts:33-96` (`perUnitSkuOzForItem`, `skuConsumptionForItem`), and `loadDerivedForItems:115-150` (only the `perUnitSkuOzForItem` source changes; the DerivedSku hydration is unchanged).

**Context (the critical, operator-invisible task):** Today `perUnitSkuOzForItem(itemId)` reads `items.batch_yield` + `item_components`. Repoint it to: find the production recipe whose `recipe_outputs.output_item_id = itemId`; sum that recipe's inputs to **batch-level** oz per SKU (recursing on `component_item_id` sub-items); then **allocate** the batch oz to this output by oz-share and divide by the output's yield. Single-output recipes reduce to today's math exactly (share = 1; per-unit = batchOz / yield, and yield = old batch_yield). Return shape (`Map<skuId, ozPerOutputUnit>`) is unchanged, so `loadDerivedForItems` and the prep panel are untouched.

- [ ] **Step 1: Write the parity smoke FIRST (captures today's number before the repoint)**

Create `scripts/_smoke_recipe_parity.ts`:

```ts
import { perUnitSkuOzForItem } from "@/lib/prep-consumption";
// Hot Peppers item id from prod (Task 2 verify): 9195bf47-4a74-466b-97f7-27718fbb79bb
const HOT_PEPPERS = "9195bf47-4a74-466b-97f7-27718fbb79bb";
async function main() {
  const m = await perUnitSkuOzForItem(HOT_PEPPERS);
  console.log("perUnitSkuOz:", JSON.stringify([...m.entries()]));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run BEFORE the repoint: `npx tsx --env-file=.env.local scripts/_smoke_recipe_parity.ts`
Expected (pre-repoint, reads item_components): `[["e56351dd-8fd0-4f1e-ae3c-fa030ecba713", 512]]` (512 oz of the SKU per 1 unit, batch_yield 1). **Record this exact output.**

- [ ] **Step 2: Repoint `perUnitSkuOzForItem` to the recipe graph with fan-out allocation**

Replace the body of `perUnitSkuOzForItem` (lib/prep-consumption.ts:33-88) with:

```ts
interface RecipeNode {
  recipeId: string; batchYield: number | null;
  inputs: Array<{ quantity: number; unit: string | null; componentSkuId: string | null; componentItemId: string | null }>;
  outputs: Array<{ outputItemId: string; yield: number; ozWeight: number }>; // ozWeight = yield × oz_per_par_unit (fallback yield)
}

export async function perUnitSkuOzForItem(itemId: string): Promise<Map<string, number>> {
  const sb = getServiceRoleClient();
  const measures = await loadMeasures();
  const recipeByOutputItem = new Map<string, RecipeNode | null>();

  async function loadRecipeForOutputItem(outItemId: string): Promise<RecipeNode | null> {
    if (recipeByOutputItem.has(outItemId)) return recipeByOutputItem.get(outItemId) ?? null;
    // Find the production recipe that outputs this item.
    const { data: outRow } = await sb.from("recipe_outputs").select("recipe_id").eq("output_item_id", outItemId).limit(1).maybeSingle<{ recipe_id: string }>();
    if (!outRow) { recipeByOutputItem.set(outItemId, null); return null; }
    const recipeId = outRow.recipe_id;
    const { data: rec } = await sb.from("recipes").select("batch_yield").eq("id", recipeId).maybeSingle<{ batch_yield: number | string | null }>();
    const { data: ins } = await sb.from("recipe_inputs").select("quantity, unit, component_sku_id, component_item_id").eq("recipe_id", recipeId)
      .returns<Array<{ quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null }>>();
    const { data: outs } = await sb.from("recipe_outputs").select("output_item_id, yield").eq("recipe_id", recipeId).not("output_item_id", "is", null)
      .returns<Array<{ output_item_id: string; yield: number | string }>>();
    const outItemIds = (outs ?? []).map((o) => o.output_item_id);
    const ozPar = await loadItemOzPerPar(outItemIds);
    const node: RecipeNode = {
      recipeId, batchYield: rec ? num(rec.batch_yield) : null,
      inputs: (ins ?? []).map((c) => ({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id })),
      outputs: (outs ?? []).map((o) => { const y = num(o.yield) ?? 0; const w = (ozPar.get(o.output_item_id) ?? null); return { outputItemId: o.output_item_id, yield: y, ozWeight: w != null && w > 0 ? y * w : y }; }),
    };
    recipeByOutputItem.set(outItemId, node);
    return node;
  }

  // Collect leaf SKU ids for avg-oz hydration (walk the graph).
  const skuIds = new Set<string>();
  async function collect(outItemId: string, seen: Set<string>): Promise<void> {
    if (seen.has(outItemId)) return; seen.add(outItemId);
    const node = await loadRecipeForOutputItem(outItemId); if (!node) return;
    for (const c of node.inputs) { if (c.componentSkuId) skuIds.add(c.componentSkuId); else if (c.componentItemId) await collect(c.componentItemId, seen); }
  }
  await collect(itemId, new Set());
  const skuAvg = await loadSkuAvg([...skuIds]);

  // Batch-level oz per SKU for a recipe (recurses into sub-item inputs), before allocation.
  function batchOz(outItemId: string, visiting: Set<string>): Map<string, number> | null {
    if (visiting.has(outItemId)) return null;
    const node = recipeByOutputItem.get(outItemId) ?? null;
    if (!node || node.batchYield == null || node.batchYield <= 0) return null;
    const next = new Set(visiting).add(outItemId);
    const out = new Map<string, number>();
    for (const c of node.inputs) {
      if (c.componentSkuId != null) {
        const oz = ozFromMeasure(c.quantity, c.unit, measures, skuAvg.get(c.componentSkuId) ?? null);
        if (oz == null) return null;
        out.set(c.componentSkuId, (out.get(c.componentSkuId) ?? 0) + oz);
      } else if (c.componentItemId != null) {
        const subPerUnit = perUnitFromNode(c.componentItemId, next); // oz per 1 sub-item unit
        if (subPerUnit == null) return null;
        for (const [sku, oz] of subPerUnit) out.set(sku, (out.get(sku) ?? 0) + oz * c.quantity);
      } else return null;
    }
    return out;
  }

  // Per-ONE-output-unit oz for outItemId: allocate its recipe's batch oz by oz-share, ÷ yield.
  function perUnitFromNode(outItemId: string, visiting: Set<string>): Map<string, number> | null {
    const node = recipeByOutputItem.get(outItemId) ?? null;
    if (!node) return null;
    const batch = batchOz(outItemId, visiting);
    if (batch == null) return null;
    const totalWeight = node.outputs.reduce((s, o) => s + (o.ozWeight > 0 ? o.ozWeight : 0), 0);
    const me = node.outputs.find((o) => o.outputItemId === outItemId);
    if (!me || me.yield <= 0) return null;
    const share = totalWeight > 0 ? (me.ozWeight > 0 ? me.ozWeight : 0) / totalWeight : 1 / Math.max(node.outputs.length, 1);
    const out = new Map<string, number>();
    for (const [sku, oz] of batch) out.set(sku, (oz * share) / me.yield);
    return out;
  }

  return perUnitFromNode(itemId, new Set()) ?? new Map();
}

/** oz_per_par_unit per item (for fan-out allocation weight). */
async function loadItemOzPerPar(itemIds: string[]): Promise<Map<string, number | null>> {
  if (itemIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("items").select("id, oz_per_par_unit").in("id", itemIds).returns<Array<{ id: string; oz_per_par_unit: number | string | null }>>();
  return new Map((data ?? []).map((r) => [r.id, num(r.oz_per_par_unit)]));
}
```

Keep the existing `num`, `loadMeasures`, `loadSkuAvg`, `skuConsumptionForItem`, `loadDerivedForItems`, `recordProductionFromPrep`, `reverseProductionForPrep`, `DerivedSku`/`ConfirmedInput`/`RecordFromPrepInput` unchanged. Remove the now-unused `ItemNode` interface + old `loadNode`/`collectSkus`/`recurse` closures.

- [ ] **Step 3: Run the parity smoke AGAIN (post-repoint, reads recipe graph)**

Run: `npx tsx --env-file=.env.local scripts/_smoke_recipe_parity.ts`
Expected: **byte-identical** to Step 1 — `[["e56351dd-8fd0-4f1e-ae3c-fa030ecba713", 512]]`. If it differs, the repoint changed the derived number → STOP and reconcile before committing (the whole point is operator-invisibility).

- [ ] **Step 4: Verify types + delete the smoke**

Run: `npx tsc --noEmit`
Expected: clean.
```bash
git rm -f scripts/_smoke_recipe_parity.ts 2>/dev/null; rm -f scripts/_smoke_recipe_parity.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/prep-consumption.ts
git commit -m "$(cat <<'EOF'
feat(recipes): repoint prep-consumption engine to the recipe graph + fan-out allocation

perUnitSkuOzForItem now walks recipe_outputs→recipe→recipe_inputs (recursing on
sub-items) and allocates batch oz across fan-out outputs by oz-share ÷ yield.
loadDerivedForItems return shape unchanged → prep panel untouched. Parity-proven
byte-identical on Hot Peppers pre/post cutover.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Repoint `lib/admin/cost.ts` — `loadSkuUsageMap` to the recipe graph

**Files:**
- Modify: `lib/admin/cost.ts:165-209` (`loadSkuUsageMap`).

**Context:** `loadSkuUsageMap` reads `item_components` edges to build "which items use this SKU." Repoint it to the recipe graph: a SKU is used by a recipe (via `recipe_inputs.component_sku_id`); that recipe's output items are the direct users; sub-item inputs chain upward. `annotateComponentCosts` stays as-is for now (it operates on `ComponentView[]` passed in; the builder will supply recipe-derived cost in Task 7's readout, out of scope here). `loadSkuConsumption` is unchanged (reads `production_inputs`, not `item_components`).

- [ ] **Step 1: Repoint `loadSkuUsageMap`**

Replace `loadSkuUsageMap` body with a recipe-graph walk:

```ts
/** Transitive reverse over the RECIPE graph: every output item that uses `skuId`
 * directly (recipe_inputs.component_sku_id) or through a sub-item input. Names only. */
export async function loadSkuUsageMap(): Promise<Map<string, string[]>> {
  const sb = getServiceRoleClient();
  const { data: ins, error: e1 } = await sb.from("recipe_inputs").select("recipe_id, component_sku_id, component_item_id")
    .returns<Array<{ recipe_id: string; component_sku_id: string | null; component_item_id: string | null }>>();
  if (e1) throw new Error(`loadSkuUsageMap inputs: ${e1.message}`);
  const { data: outs, error: e2 } = await sb.from("recipe_outputs").select("recipe_id, output_item_id").not("output_item_id", "is", null)
    .returns<Array<{ recipe_id: string; output_item_id: string }>>();
  if (e2) throw new Error(`loadSkuUsageMap outputs: ${e2.message}`);

  const outItemsOfRecipe = new Map<string, string[]>();
  for (const o of outs ?? []) { const l = outItemsOfRecipe.get(o.recipe_id) ?? []; l.push(o.output_item_id); outItemsOfRecipe.set(o.recipe_id, l); }
  const recipeOfItem = new Map<string, string>(); for (const o of outs ?? []) recipeOfItem.set(o.output_item_id, o.recipe_id);
  // recipes directly using a SKU, and recipes using a sub-item.
  const recipesUsingSku = new Map<string, Set<string>>();
  const recipesUsingItem = new Map<string, Set<string>>();
  for (const i of ins ?? []) {
    if (i.component_sku_id) { const s = recipesUsingSku.get(i.component_sku_id) ?? new Set(); s.add(i.recipe_id); recipesUsingSku.set(i.component_sku_id, s); }
    if (i.component_item_id) { const s = recipesUsingItem.get(i.component_item_id) ?? new Set(); s.add(i.recipe_id); recipesUsingItem.set(i.component_item_id, s); }
  }

  // For a SKU: BFS from recipes using it → their output items → recipes using those items → …
  const allItemIds = new Set<string>();
  const reachedItemsPerSku = new Map<string, Set<string>>();
  for (const [skuId, seedRecipes] of recipesUsingSku) {
    const reached = new Set<string>(); const rq = [...seedRecipes]; const seenR = new Set<string>();
    while (rq.length) { const r = rq.shift()!; if (seenR.has(r)) continue; seenR.add(r);
      for (const it of outItemsOfRecipe.get(r) ?? []) { reached.add(it); allItemIds.add(it);
        for (const up of recipesUsingItem.get(it) ?? []) rq.push(up); } }
    reachedItemsPerSku.set(skuId, reached);
  }
  const names = await namesOfItems([...allItemIds]);
  const out = new Map<string, string[]>();
  for (const [skuId, items] of reachedItemsPerSku) out.set(skuId, [...items].map((id) => names.get(id) ?? "(item)").sort());
  return out;
}

async function namesOfItems(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>(); if (ids.length === 0) return m;
  const sb = getServiceRoleClient();
  const { data } = await sb.from("items").select("id, name").in("id", ids).returns<Array<{ id: string; name: string }>>();
  for (const r of data ?? []) m.set(r.id, r.name); return m;
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit`
Expected: clean.
```bash
git add lib/admin/cost.ts
git commit -m "$(cat <<'EOF'
feat(recipes): repoint loadSkuUsageMap to the recipe graph

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: API routes — recipes + menu-items

**Files:**
- Create: `app/api/admin/recipes/route.ts`, `app/api/admin/recipes/[id]/route.ts`, `app/api/admin/recipes/[id]/inputs/route.ts`, `app/api/admin/recipes/[id]/outputs/route.ts`, `app/api/admin/recipes/edges/route.ts` (DELETE an edge), `app/api/admin/menu-items/route.ts`.

**Context:** Follow the self-gating pattern used by existing admin routes: `requireSession(req, "<path>")` → (the lib's `requireLevel` enforces the role floor and throws `RecipeError` with a `status`/`code`) → map `RecipeError` to `jsonError(err.status, err.code)`, else `jsonError(500, "internal_error")`. Use `jsonOk`. Admin routes must include the path in `requireSession` so step-up auto-clear behaves (isAdminPath covers `/api/admin/*` per the C.44 fix). No `assertStepUp` needed unless we mark these Tier B — recipes are config edits; keep parity with SKU-catalog routes (no step-up). Read `app/api/admin/skus/route.ts` for the exact import shape before writing.

- [ ] **Step 1: POST /api/admin/recipes (create) + a shared error mapper**

```ts
// app/api/admin/recipes/route.ts
import { requireSession } from "@/lib/session";
import { jsonOk, jsonError, parseJsonBody } from "@/lib/api-helpers";
import { createRecipe, RecipeError, type RecipeType } from "@/lib/recipes";

// NOTE: match the exact req type + requireSession signature in app/api/admin/skus/route.ts
// (NextRequest vs Request, and whether it returns NextResponse) — do NOT cast.
export async function POST(req: Request) {
  const auth = await requireSession(req, "/api/admin/recipes");
  if (auth instanceof Response) return auth;
  const body = await parseJsonBody<{ name?: string; nameEs?: string | null; recipeType?: RecipeType; batchYield?: number; directions?: string | null; directionsEs?: string | null }>(req);
  if (!body) return jsonError(400, "invalid_body");
  try {
    const r = await createRecipe(auth, { name: body.name ?? "", nameEs: body.nameEs ?? null, recipeType: (body.recipeType ?? "production"), batchYield: Number(body.batchYield), directions: body.directions ?? null, directionsEs: body.directionsEs ?? null });
    return jsonOk({ id: r.id }, 201);
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    return jsonError(500, "internal_error");
  }
}
```

- [ ] **Step 2: [id] PATCH/DELETE, inputs POST, outputs POST, edges DELETE, menu-items POST**

Follow the identical wrapper pattern for each (params are `Promise<{ id: string }>` in Next 16 — `const { id } = await params;`):
- `app/api/admin/recipes/[id]/route.ts`: `PATCH` → `updateRecipe(auth, id, body)`; `DELETE` → `deactivateRecipe(auth, id)`.
- `app/api/admin/recipes/[id]/inputs/route.ts`: `POST` → `addRecipeInput(auth, { recipeId: id, ...body })`.
- `app/api/admin/recipes/[id]/outputs/route.ts`: `POST` → `addRecipeOutput(auth, { recipeId: id, ...body })`.
- `app/api/admin/recipes/edges/route.ts`: `DELETE` → body `{ table, id }` → `removeRecipeEdge(auth, { table, id })` (validate `table` ∈ the two literals).
- `app/api/admin/menu-items/route.ts`: `POST` → `createMenuItem(auth, body)`.

Each maps `RecipeError` → `jsonError(status, code)`, else 500. Each passes its own path to `requireSession`.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: clean.
```bash
git add app/api/admin/recipes app/api/admin/menu-items
git commit -m "$(cat <<'EOF'
feat(recipes): admin API routes — recipes CRUD + edges + menu-items

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Recipe builder UI — `/admin/recipes` list + detail

**Files:**
- Create: `app/admin/recipes/page.tsx`, `app/admin/recipes/recipes-client.tsx`, `app/admin/recipes/[id]/page.tsx`, `components/admin/recipes/RecipeBuilder.tsx`, `components/admin/recipes/RecipeInputRow.tsx`, `components/admin/recipes/RecipeOutputRow.tsx`.

**Context:** Mirror the existing admin surfaces — read `app/admin/skus/page.tsx` + `app/admin/skus/skus-client.tsx` (if present) + `components/admin/skus/RegistrySelect.tsx` + `MeasureUnitSelect.tsx` for the exact server-load → client-component → fetch-to-API pattern, the Tailwind token classes, and `useTranslation()`. Reuse `RegistrySelect`/`MeasureUnitSelect` for the container-label + unit pickers. The server page calls `requireSessionFromHeaders("/admin/recipes")` and gates `getRoleLevel(role) >= RECIPE_READ_MIN` (redirect if below), loads via `loadRecipes` / `loadRecipe`, plus the SKU list + item list + `units` registry for the pickers.

- [ ] **Step 1: List page (server) + client**

`app/admin/recipes/page.tsx`: server component — auth + role gate, `loadRecipes(auth)`, render `<RecipesClient recipes={...} />`. `recipes-client.tsx`: filter chip Production|Consumer|All (client-side over the loaded rows), a row per recipe linking to `/admin/recipes/[id]`, and a "New recipe" control that POSTs `/api/admin/recipes` (name + type + batchYield) then routes to the new id. Use the `AdminBackLink` + card-grid classes from `app/admin/skus/page.tsx`. **Soft-gate (spec §7):** each list row shows a light "incomplete" badge when the recipe has 0 inputs OR 0 outputs (derive from `RecipeListRow` — extend `loadRecipes` to also return `hasInputs`/`hasOutputs` booleans, or count via the same `outputNamesByRecipe` pass + a parallel inputs-exist query). Never blocks; purely a nudge.

- [ ] **Step 2: Detail page (server) loads recipe + picker data**

`app/admin/recipes/[id]/page.tsx`: `const { id } = await params;` → auth + gate → `loadRecipe(auth, id)` (404 → `notFound()`), plus load SKUs (`loadSkus` from `lib/admin/skus`), items (active `items` id+name), and the `units` registry (for container labels). Pass all to `<RecipeBuilder recipe={...} skus={...} items={...} unitOptions={...} level={level} />`.

- [ ] **Step 3: `RecipeBuilder.tsx` — the adaptive form**

Client component. Header fields (name, name_es, recipe_type read-only after create, batch_yield, directions collapsible) PATCH `/api/admin/recipes/[id]` on blur. CONSUMES section renders `RecipeInputRow`s + "⊕ add SKU" / "⊕ add production item" (POST `.../inputs`); a SKU input shows a `RegistrySelect` for `each_container_label` from `units`. PRODUCES section: for `recipe_type==='production'`, `RecipeOutputRow`s (pick existing item + yield + `output_container_label` from `units`) with "⊕ add output item" (fan-out); for `'consumer'`, a single menu-item output (pick existing menu_item OR create one via `/api/admin/menu-items` then `.../outputs`). LIVE READOUT: render `1 <purchaseUnit> → <yield> <outputContainerLabel>` per output from the current edges, with **oz shown alongside** (call a small client cost/oz echo or show the input-derived oz if available; the authoritative derivation is server-side — the readout is a friendly echo of the labels + quantities). Removing an edge → DELETE `/api/admin/recipes/edges`.

- [ ] **Step 4: `RecipeInputRow.tsx` + `RecipeOutputRow.tsx`**

Presentational rows binding one edge's fields to inputs + a remove button; call the parent's onChange/onRemove. Match the field classes from `MadeFromEditor.tsx` (read it for the row layout + remove-affordance pattern) — this is the surface being replaced, so its UX is the reference.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build (watch for `useSearchParams` Suspense — wrap if used).
```bash
git add app/admin/recipes components/admin/recipes
git commit -m "$(cat <<'EOF'
feat(recipes): /admin/recipes builder — list + adaptive production/consumer form

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Absorb MadeFromEditor + admin hub card + drop item menu_price editor

**Files:**
- Modify: `components/admin/templates/GlobalRegistryTab.tsx`, `app/admin/page.tsx`.

**Context:** `GlobalRegistryTab` currently mounts `MadeFromEditor` (item_components) and a menu_price editor on items. Replace the `MadeFromEditor` expander with a link/button "Production recipe →" that routes to `/admin/recipes` (filtered to the item's recipe if one exists — pass the item name as a query hint, or just link to the list). Remove the item menu_price input (menu_price now lives on menu_items; 0 items use it). Do NOT delete `MadeFromEditor.tsx` / `lib/admin/item-components.ts` / their routes — leave them dormant for rollback.

- [ ] **Step 1: Repoint GlobalRegistryTab**

Read `components/admin/templates/GlobalRegistryTab.tsx`; find the `MadeFromEditor` mount + the menu_price field; replace the editor with a `Link href="/admin/recipes"` styled as the existing row-action, and delete the menu_price input + its handler/state. Keep everything else.

- [ ] **Step 2: Add the Recipes hub card**

In `app/admin/page.tsx`, add a card to the grid (mirror the SKUs card): title "Recipes", href `/admin/recipes`, one-line description, gated to `level >= 6` (RECIPE_READ_MIN). Match the existing card component + i18n key pattern.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.
```bash
git add components/admin/templates/GlobalRegistryTab.tsx app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat(recipes): absorb MadeFromEditor into /admin/recipes; add hub card; drop item menu_price editor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: i18n — `recipes.*` EN + ES parity

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`.

**Context:** Every visible string + ARIA label from Tasks 7–8 gets a `recipes.*` key in BOTH files. tú-form ES. Also `nav`/hub card key + audit-free (config edits, no audit-label needs). Read the last-added namespace in `en.json` for placement + style.

- [ ] **Step 1: Add keys to both files**

Add (at minimum) keys for: builder title, Production/Consumer/All filter, New recipe, Consumes, Produces, add SKU, add production item, add output item, each-container, output-container, yield, batch yield, directions, live-readout template, remove, menu item, menu price, hub card title/description, and every error code surfaced (`recipes.error.invalid_name`, `.invalid_batch_yield`, `.invalid_component`, `.invalid_output`, `.would_create_cycle`, `.forbidden`, `.generic`). Keys identical in both files; ES values translated (tú-form).

- [ ] **Step 2: Verify parity + commit**

Run a parity check (both files must have identical key sets):
```bash
node -e "const a=require('./lib/i18n/en.json'),b=require('./lib/i18n/es.json');const ka=Object.keys(a).filter(k=>k.startsWith('recipes')).sort(),kb=Object.keys(b).filter(k=>k.startsWith('recipes')).sort();const miss=ka.filter(k=>!kb.includes(k)).concat(kb.filter(k=>!ka.includes(k)));console.log(miss.length?('MISMATCH: '+miss.join(',')):'PARITY OK')"
```
Expected: `PARITY OK`. (If keys are nested rather than flat-dotted, adapt the check to the file's actual shape — read it first.)
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "$(cat <<'EOF'
feat(recipes): i18n recipes.* keys (EN+ES parity, tú-form)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification + operator-invisibility smoke + PR

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 2: Operator-invisibility smoke (CC)**

Confirm the prep panel path is unchanged: `loadDerivedForItems([HOT_PEPPERS])` returns a `DerivedSku[]` with the same SKU + `perUnitOz: 512`. Create + run a throwaway `scripts/_smoke_derived.ts` (same pattern as Task 4), verify, delete it. The Opening/Mid-day P2 pages read only through this loader, so identical output = identical operator render.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin claude/recipe-stage
gh pr create --title "Recipe stage — two-tier recipe entity + engine repoint (derivation spine #1)" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-01-recipe-stage-design.md.

Two-tier recursive recipe entity (production → items, consumer → menu items):
migrations 0103/0104 (recipes+inputs+outputs+menu_items; reparent Hot Peppers),
lib/recipes.ts data layer, /admin/recipes builder, engine repoint behind
loadDerivedForItems (parity-proven byte-identical → zero operator change),
fan-out oz-share allocation, menu_price → menu_items, EN/ES parity.

Preview URL is in the Vercel comment below — smoke there, not prod.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI**

Run: `gh pr checks` (poll until the `build` check passes). Hand off to Juan for preview smoke → merge.

---

## Notes for the executor
- **CC applies migrations 0103 + 0104 via Supabase MCP** (`apply_migration`), not subagents; CC is the sole committer.
- **Confirm-before-authoring:** each subagent re-reads its target file's current state before writing (esp. Task 4 the engine, Task 7 the admin patterns, Task 8 GlobalRegistryTab).
- **The parity gate in Task 4 Step 3 is load-bearing** — a non-identical Hot Peppers number means the repoint changed operator-visible derivation; do not commit past it until reconciled.
- **PostgREST numeric → string:** always coerce with `num`/`Number` (avg_oz_per_each, quantities, yields, oz_per_par_unit).
- **Fan-out weight = `yield × items.oz_per_par_unit`** (fallback to yield when oz_per_par_unit is null); single-output recipes reduce to `batchOz / yield` = today's math.
