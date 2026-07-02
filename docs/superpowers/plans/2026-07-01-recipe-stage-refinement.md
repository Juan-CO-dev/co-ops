# Recipe Stage Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Recipe builder usable for real authoring — SKU-derived container units (Case/Bottle/oz), a prepped-AND-sold-directly item, and draft-then-save-once creation — without changing any operator prep flow.

**Architecture:** One migration (0105) adds `vendor_items.each_container_label`, `items.sold_directly`/`sell_portion`/`sell_portion_unit`, and a `create_recipe_full` atomic RPC. A new pure `ozForRecipeInput` in `lib/recipe-math.ts` resolves SKU pack levels (Case/Bottle) to oz and the prep-consumption engine adopts it (parity-guarded on Hot Peppers). The builder becomes draft-then-Save for creation (in-memory → one atomic RPC call), keeps live editing for existing recipes, sources input units from the SKU pack + output units from the `units` registry, and the item admin gains a Sold-directly toggle.

**Tech Stack:** Next 16 App Router, Supabase Postgres 17 + custom-JWT RLS (service-role writes + app-layer gate), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n.

**Branch:** `claude/recipe-refinement` off `origin/main` (currently `ccc10bc`). Single PR. CC = sole T0 reviewer + committer + runs the Supabase MCP migration (0105). Subagents implement + never commit + never apply migrations. Model split: **Opus** Tasks 1–4 (migration+RPC, engine pack-conversion, SKU field, recipes lib); **Sonnet** Tasks 5–8 (routes, builder UI, item UX, i18n). Task 9 = CC verify + PR.

**Spec:** `docs/superpowers/specs/2026-07-01-recipe-stage-refinement-design.md`

**Correction to spec §6:** the engine IS modified (adds the pack-aware input-oz path). Operator-invisibility holds via the **Hot Peppers parity guard** (its rows are `unit='oz'` → fallback path → byte-identical 512), not by leaving the engine untouched.

---

## File Structure

**New:**
- `supabase/migrations/0105_recipe_refinement.sql` — the 3 columns + `create_recipe_full` RPC.
- `app/admin/recipes/new/page.tsx` — the draft-create builder route.
- `app/api/admin/recipes/full/route.ts` — atomic create endpoint.
- `app/api/admin/items/[itemId]/sold-directly/route.ts` — sold-directly toggle endpoint.

**Modified:**
- `lib/recipe-math.ts` — add pure `ozForRecipeInput` (pack-aware) + `RecipeInputSku` type.
- `lib/prep-consumption.ts` — SKU input branch uses `ozForRecipeInput`; `loadSkuAvg` → `loadSkuPack`.
- `lib/admin/skus.ts` — `each_container_label` on `SkuView`, `CreateSkuInput`, `createSku`, `updateSku`, select columns.
- `lib/recipes.ts` — `createRecipeFull` (validate + RPC) + `setItemSoldDirectly` + `RECIPE_READ_MIN` reuse.
- `lib/destructive-actions.ts` — add `item.set_sold_directly`.
- `components/admin/recipes/RecipeBuilder.tsx` — draft mode (no id → in-memory edges → one atomic Save); SKU-derived input unit picker; locked output-container dropdown.
- `components/admin/recipes/RecipeInputRow.tsx` / `RecipeOutputRow.tsx` — display the SKU pack level / registry container.
- `components/admin/recipes/RecipesClient.tsx` — "New recipe" routes to `/admin/recipes/new` (remove the inline barebones create).
- `components/admin/recipes/shared.ts` — add `item.set_sold_directly` error codes if any new ones.
- `components/admin/skus/SkuForm` (wherever SKU create/edit lives) — `each_container_label` field.
- `components/admin/templates/GlobalRegistryTab.tsx` — Sold-directly toggle + sell_portion + sell_portion_unit + menu_price (shown when sold_directly).
- `lib/i18n/en.json` + `es.json` — new keys.

---

## Task 1: Migration 0105 — columns + create_recipe_full RPC

**Files:** Create `supabase/migrations/0105_recipe_refinement.sql`

- [ ] **Step 1: Branch**
```bash
git fetch origin main && git checkout -b claude/recipe-refinement origin/main
```

- [ ] **Step 2: Write the migration file**
```sql
-- Migration 0105_recipe_refinement
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-recipe-stage-refinement-design.md
-- (1) SKU each-container label; (2) sold-directly item fields; (3) create_recipe_full atomic RPC.

-- 1. SKU each-container label ("Bottle") — one physical each-shape per SKU.
alter table vendor_items add column each_container_label text;

-- 2. Sold-directly production item (antipasta side): flag + sell portion + unit.
--    menu_price already exists on items (reused; was vestigial post-#107).
alter table items add column sold_directly boolean not null default false;
alter table items add column sell_portion numeric check (sell_portion is null or sell_portion > 0);
alter table items add column sell_portion_unit text;

-- 3. create_recipe_full — atomic header + inputs + outputs insert (draft-then-save-once).
--    App layer (lib/recipes.ts createRecipeFull) validates exactly-one + cycle guard BEFORE
--    calling this; the table CHECK constraints are the backstop (any bad row rolls back the txn).
--    SECURITY DEFINER + locked search_path; service-role only (revoke from anon/authenticated).
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb;
begin
  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by
  ) returning id into v_recipe_id;

  for r in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, quantity, unit, each_container_label, portioned, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'component_sku_id','')::uuid, nullif(r->>'component_item_id','')::uuid,
      (r->>'quantity')::numeric, nullif(r->>'unit',''), nullif(r->>'each_container_label',''),
      coalesce((r->>'portioned')::boolean, false), coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'output_item_id','')::uuid, nullif(r->>'output_menu_item_id','')::uuid,
      (r->>'yield')::numeric, nullif(r->>'output_container_label',''),
      coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  return v_recipe_id;
end $$;

revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from anon;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from authenticated;
grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
```

- [ ] **Step 3: CC applies the migration** via Supabase MCP `apply_migration` name `0105_recipe_refinement`. Verify:
```sql
select
 (select count(*) from information_schema.columns where table_name='vendor_items' and column_name='each_container_label') as sku_col,
 (select count(*) from information_schema.columns where table_name='items' and column_name in ('sold_directly','sell_portion','sell_portion_unit')) as item_cols,
 (select count(*) from pg_proc where proname='create_recipe_full') as rpc;
```
Expected: `sku_col=1, item_cols=3, rpc=1`.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0105_recipe_refinement.sql
git commit -m "$(printf 'feat(recipe-refinement): migration 0105 — SKU each-label, sold-directly item fields, create_recipe_full RPC\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Engine — pack-aware `ozForRecipeInput` (parity-guarded)

**Files:** Modify `lib/recipe-math.ts`, `lib/prep-consumption.ts`

**Context:** The engine currently converts a SKU input's `(quantity, unit)` → oz via `ozFromMeasure`, which only understands `measure_units` (oz/lb/fl oz). New recipes will store pack-level units (`Case`, `Bottle`). Add a pure `ozForRecipeInput` that resolves pack levels via the SKU's pack fields and falls back to `ozFromMeasure` for measure-unit inputs. Hot Peppers rows are `unit='oz'` → fallback → identical 512 → parity holds.

- [ ] **Step 1: Add the pure helper to `lib/recipe-math.ts`** (after `ozFromMeasure`)
```ts
export interface RecipeInputSku {
  packFormat: string | null;        // "Case"
  eachContainerLabel: string | null; // "Bottle"
  unitsPerPack: number | null;      // 4
  eachSize: number | null;          // 128
  eachMeasure: string | null;       // "oz"
  avgOzPerEach: number | null;
}

/**
 * oz consumed by `quantity` of a SKU expressed in `unit`, resolving SKU pack levels:
 *  - unit === sku.packFormat        → quantity × unitsPerPack × eachSize × ozPerMeasureUnit(eachMeasure)
 *  - unit === sku.eachContainerLabel → quantity × eachSize × ozPerMeasureUnit(eachMeasure)
 *  - else (a measure_units label)   → ozFromMeasure(quantity, unit, measures, avgOzPerEach)
 * Returns null if a required field is missing (caller renders "—").
 */
export function ozForRecipeInput(
  quantity: number,
  unit: string | null,
  sku: RecipeInputSku,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (!Number.isFinite(quantity) || unit == null) return null;
  const perEachOz = (): number | null => {
    if (sku.eachSize == null || sku.eachMeasure == null) return null;
    const m = measuresByLabel.get(sku.eachMeasure);
    if (!m) return null;
    const per = ozPerMeasureUnit(m, sku.avgOzPerEach); // ozPerMeasureUnit is already defined in this module (private) — call directly, no export needed
    return per == null ? null : sku.eachSize * per;
  };
  if (unit === sku.packFormat) {
    const each = perEachOz();
    if (each == null || sku.unitsPerPack == null) return null;
    return quantity * sku.unitsPerPack * each;
  }
  if (unit === sku.eachContainerLabel) {
    const each = perEachOz();
    return each == null ? null : quantity * each;
  }
  return ozFromMeasure(quantity, unit, measuresByLabel, sku.avgOzPerEach);
}
```
`ozForRecipeInput` is added to `lib/recipe-math.ts`, the SAME module where `ozPerMeasureUnit` is already defined — so it calls `ozPerMeasureUnit` and `ozFromMeasure` directly with no new exports. The file stays pure/client-safe (Task 6 imports `ozForRecipeInput` + `RecipeInputSku` client-side). Keep `skuContentOz`/`ozFromMeasure` unchanged.

- [ ] **Step 2: Write the parity smoke FIRST, run PRE-change**

Create `scripts/_smoke_recipe_parity.ts`:
```ts
import { perUnitSkuOzForItem } from "@/lib/prep-consumption";
const HOT_PEPPERS = "9195bf47-4a74-466b-97f7-27718fbb79bb";
async function main() {
  const m = await perUnitSkuOzForItem(HOT_PEPPERS);
  console.log("perUnitSkuOz:", JSON.stringify([...m.entries()]));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local scripts/_smoke_recipe_parity.ts`
Record output. Expected: `perUnitSkuOz: [["e56351dd-8fd0-4f1e-ae3c-fa030ecba713",512]]`.

- [ ] **Step 3: Repoint the SKU branch in `lib/prep-consumption.ts`**

Replace `loadSkuAvg` with `loadSkuPack` (loads the full pack per SKU):
```ts
import { ozForRecipeInput, type RecipeInputSku } from "@/lib/recipe-math"; // add to existing import

async function loadSkuPack(skuIds: string[]): Promise<Map<string, RecipeInputSku>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  return new Map((data ?? []).map((s) => [s.id, {
    packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
    unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
    avgOzPerEach: num(s.avg_oz_per_each),
  }]));
}
```
In `perUnitSkuOzForItem`: rename the `skuAvg` local to `skuPack` and set `const skuPack = await loadSkuPack([...skuIds]);`. In `batchOz`, change the SKU branch:
```ts
if (c.componentSkuId != null) {
  const sku = skuPack.get(c.componentSkuId);
  const oz = sku ? ozForRecipeInput(c.quantity, c.unit, sku, measures) : null;
  if (oz == null) return null;
  out.set(c.componentSkuId, (out.get(c.componentSkuId) ?? 0) + oz);
}
```
Leave the sub-item branch + allocation logic unchanged.

- [ ] **Step 4: Run the parity smoke AGAIN (post-change)** — MUST be byte-identical `[["e56351dd-8fd0-4f1e-ae3c-fa030ecba713",512]]`. If different → STOP, report BLOCKED.

- [ ] **Step 5: `npx tsc --noEmit` clean, delete the smoke, commit**
```bash
rm -f scripts/_smoke_recipe_parity.ts
git add lib/recipe-math.ts lib/prep-consumption.ts
git commit -m "$(printf 'feat(recipe-refinement): pack-aware ozForRecipeInput; engine resolves Case/Bottle input units\n\nParity-proven byte-identical (512) on Hot Peppers (unit=oz fallback path).\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: SKU `each_container_label`

**Files:** Modify `lib/admin/skus.ts`, and the SKU create/edit component.

**Context:** Read `lib/admin/skus.ts` first — confirm `SkuView`, `CreateSkuInput`, `UpdateSkuChanges` (or equivalent), the SELECT column list (line ~176), `createSku` (~415), `updateSku` (~489), and the row→view mapper (~222). Add `eachContainerLabel` everywhere the pack fields already flow.

- [ ] **Step 1: Add to the types + select + mapper + create + update**
- `SkuView`: add `eachContainerLabel: string | null`.
- SELECT column string: add `each_container_label`.
- row→view mapper: `eachContainerLabel: r.each_container_label`.
- `CreateSkuInput` + `UpdateSkuChanges`: add `eachContainerLabel?: string | null`.
- `createSku` insert: `each_container_label: normalizeOptional(input.eachContainerLabel)`.
- `updateSku`: `if (changes.eachContainerLabel !== undefined) update.each_container_label = normalizeOptional(changes.eachContainerLabel);`
- The row type for the DB read: add `each_container_label: string | null`.

- [ ] **Step 2: Add the field to the SKU form UI** — find the component rendering the SKU create/edit form (grep `pack_format` / `eachSize` in `components/admin/skus`), add a text input for `eachContainerLabel` (label e.g. "Each container (Bottle)") next to the pack fields, wired into the same submit payload. i18n key `admin.skus.each_container_label`.

- [ ] **Step 3: `npx tsc --noEmit` + `npm run build` clean, commit**
```bash
git add lib/admin/skus.ts components/admin/skus
git commit -m "$(printf 'feat(recipe-refinement): SKU each_container_label (Bottle) on create/edit\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: `lib/recipes.ts` — createRecipeFull + setItemSoldDirectly

**Files:** Modify `lib/recipes.ts`, `lib/destructive-actions.ts`

- [ ] **Step 1: `createRecipeFull` (validate in TS, insert via RPC)**
```ts
export interface RecipeDraftInput { componentSkuId?: string | null; componentItemId?: string | null; quantity: number; unit?: string | null; eachContainerLabel?: string | null; portioned?: boolean; }
export interface RecipeDraftOutput { outputItemId?: string | null; outputMenuItemId?: string | null; yield: number; outputContainerLabel?: string | null; }
export interface RecipeDraft {
  name: string; nameEs?: string | null; recipeType: RecipeType; batchYield: number;
  directions?: string | null; directionsEs?: string | null;
  inputs: RecipeDraftInput[]; outputs: RecipeDraftOutput[];
}

export async function createRecipeFull(actor: AuthContext, draft: RecipeDraft): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (!normStr(draft.name)) throw new RecipeError(400, "invalid_name");
  if (!(draft.batchYield > 0)) throw new RecipeError(400, "invalid_batch_yield");
  if (draft.recipeType !== "production" && draft.recipeType !== "consumer") throw new RecipeError(400, "invalid_type");
  if (draft.inputs.length === 0 || draft.outputs.length === 0) throw new RecipeError(400, "incomplete_recipe");
  for (const i of draft.inputs) {
    const sku = i.componentSkuId ?? null, it = i.componentItemId ?? null;
    if ((sku === null) === (it === null)) throw new RecipeError(400, "invalid_component");
    if (!(i.quantity > 0)) throw new RecipeError(400, "invalid_quantity");
  }
  for (const o of draft.outputs) {
    const it = o.outputItemId ?? null, mi = o.outputMenuItemId ?? null;
    if ((it === null) === (mi === null)) throw new RecipeError(400, "invalid_output");
    if (!(o.yield > 0)) throw new RecipeError(400, "invalid_yield");
    // Cycle guard: output item must not be transitively consumed by any input item's recipe chain.
    // On create the recipe has no id yet; a cycle can only form if an output item is (transitively)
    // an input to a recipe that (transitively) outputs another of this draft's output items. Reuse
    // the existing walk against the LIVE graph for each output item vs each input item.
    if (it !== null) {
      for (const i of draft.inputs) {
        if (i.componentItemId && await draftWouldCycle(it, i.componentItemId)) {
          throw new RecipeError(400, "would_create_cycle");
        }
      }
    }
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("create_recipe_full", {
    p_header: { name: normStr(draft.name), name_es: normStr(draft.nameEs), recipe_type: draft.recipeType, batch_yield: draft.batchYield, directions: normStr(draft.directions), directions_es: normStr(draft.directionsEs) },
    p_inputs: draft.inputs.map((i, idx) => ({ component_sku_id: i.componentSkuId ?? null, component_item_id: i.componentItemId ?? null, quantity: i.quantity, unit: normStr(i.unit), each_container_label: normStr(i.eachContainerLabel), portioned: i.portioned ?? false, display_order: idx })),
    p_outputs: draft.outputs.map((o, idx) => ({ output_item_id: o.outputItemId ?? null, output_menu_item_id: o.outputMenuItemId ?? null, yield: o.yield, output_container_label: normStr(o.outputContainerLabel), display_order: idx })),
    p_created_by: actor.user.id,
  });
  if (error) throw new Error(`createRecipeFull rpc: ${error.message}`);
  const id = typeof data === "string" ? data : (data as { id?: string } | null)?.id;
  if (!id) throw new Error("createRecipeFull returned no id");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.create", resourceTable: "recipes", resourceId: id, metadata: { name: draft.name, recipe_type: draft.recipeType, batch_yield: draft.batchYield, input_count: draft.inputs.length, output_count: draft.outputs.length, atomic: true }, ipAddress: null, userAgent: null });
  return { id };
}
```
Add a `draftWouldCycle(outputItemId, inputItemId)` helper — same graph walk as `outputWouldCycle` but checks whether `outputItemId` is reachable as an input of `inputItemId`'s recipe chain (i.e. would consuming `inputItemId` while producing `outputItemId` close a loop). Reuse the existing `outputWouldCycle` body pattern (load recipe_outputs+recipe_inputs, BFS). If simplest, generalize `outputWouldCycle` to `async function itemConsumesTransitively(startItemId, targetItemId)` and call it both places.

- [ ] **Step 2: `setItemSoldDirectly`**
```ts
export const SOLD_DIRECT_WRITE_MIN = 7; // GM+
export async function setItemSoldDirectly(actor: AuthContext, args: { itemId: string; soldDirectly: boolean; sellPortion?: number | null; sellPortionUnit?: string | null; menuPrice?: number | null }): Promise<void> {
  requireLevel(actor, SOLD_DIRECT_WRITE_MIN);
  if (args.menuPrice != null) requireLevel(actor, MENU_PRICE_MIN);
  const upd: Record<string, unknown> = { sold_directly: args.soldDirectly, updated_at: new Date().toISOString(), updated_by: actor.user.id };
  if (args.soldDirectly) {
    if (args.sellPortion != null && !(args.sellPortion > 0)) throw new RecipeError(400, "invalid_sell_portion");
    upd.sell_portion = args.sellPortion ?? null;
    upd.sell_portion_unit = normStr(args.sellPortionUnit);
    if (args.menuPrice !== undefined) upd.menu_price = args.menuPrice;
  } else {
    upd.sell_portion = null; upd.sell_portion_unit = null; // clear sell config when turned off; keep menu_price column as-is
  }
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("items").update(upd, { count: "exact" }).eq("id", args.itemId);
  if (error) throw new Error(`setItemSoldDirectly: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "item.set_sold_directly", resourceTable: "items", resourceId: args.itemId, metadata: { sold_directly: args.soldDirectly, sell_portion: args.sellPortion ?? null, sell_portion_unit: args.sellPortionUnit ?? null }, ipAddress: null, userAgent: null });
}
```
(Uses `items.updated_at`/`updated_by` — confirm those columns exist on `items`; from the R1 schema they do.)

- [ ] **Step 3: Register the new action** in `lib/destructive-actions.ts` — add `"item.set_sold_directly",` in the Item/inventory registry block (near `item.set_opening_verify`), with a one-line comment.

- [ ] **Step 4: `npx tsc --noEmit` clean, commit**
```bash
git add lib/recipes.ts lib/destructive-actions.ts
git commit -m "$(printf 'feat(recipe-refinement): createRecipeFull (atomic) + setItemSoldDirectly\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: API routes — atomic create + sold-directly

**Files:** Create `app/api/admin/recipes/full/route.ts`, `app/api/admin/items/[itemId]/sold-directly/route.ts`

**Context:** Match the exact self-gating idiom already used in `app/api/admin/recipes/route.ts` (requireSession → `ROLES[ctx.user.role].level < RECIPE_WRITE_MIN` floor → `assertStepUp(ctx, "B")` → try/catch mapping `RecipeError`). Read that file for the imports.

- [ ] **Step 1: `POST /api/admin/recipes/full`** — parse body `{ name, nameEs, recipeType, batchYield, directions, directionsEs, inputs: [...], outputs: [...] }`; gate + step-up as in `recipes/route.ts`; call `createRecipeFull(ctx, draft)` (coerce `batchYield`/`quantity`/`yield` with Number); return `jsonOk({ id }, 201)`; map `RecipeError`.

- [ ] **Step 2: `PATCH /api/admin/items/[itemId]/sold-directly`** — `const { itemId } = await params;` gate to `RECIPE_WRITE_MIN` + `assertStepUp(ctx, "B")`; body `{ soldDirectly, sellPortion?, sellPortionUnit?, menuPrice? }`; call `setItemSoldDirectly(ctx, { itemId, ... })`; return `jsonOk({ ok: true })`.

- [ ] **Step 3: `npx tsc --noEmit` + `npm run build` clean, commit**
```bash
git add app/api/admin/recipes/full app/api/admin/items
git commit -m "$(printf 'feat(recipe-refinement): API routes — atomic recipe create + item sold-directly\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Builder — draft-then-save + SKU-derived units + locked output dropdown

**Files:** Create `app/admin/recipes/new/page.tsx`; modify `components/admin/recipes/RecipeBuilder.tsx`, `RecipeInputRow.tsx`, `RecipeOutputRow.tsx`, `RecipesClient.tsx`.

**Context:** Read all four recipe components first. Current create flow: `RecipesClient` posts a barebones `/api/admin/recipes` then routes to the detail builder, which adds edges one-by-one live. New flow:

- [ ] **Step 1: `RecipesClient` — "New recipe" routes to `/admin/recipes/new`** (remove the inline create form + its `POST /api/admin/recipes` + state; the "New recipe" button becomes a `<Link href="/admin/recipes/new">` gated to `canWrite`). Keep the filter chips + list (incl. the soft incomplete badge — unchanged).

- [ ] **Step 2: `RecipeBuilder` gains a `mode: "draft" | "live"`** (or infer from a nullable `recipe` prop). In **draft** mode: header fields + inputs + outputs are held in React state (no API calls per edge); a single **Save** button (enabled once `inputs.length>=1 && outputs.length>=1 && name && batchYield>0`) POSTs the whole draft to `/api/admin/recipes/full`, then `router.push('/admin/recipes/'+id)`. In **live** mode (existing recipe): unchanged incremental behavior. Extract the input/output add-forms so both modes reuse them — in draft they push to local state, in live they POST + `router.refresh()`.

- [ ] **Step 3: `/admin/recipes/new/page.tsx`** (server) — auth + `RECIPE_READ_MIN` gate; load SKUs (id+name+pack fields: `pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each`), items (id+name), `units` registry, and a `type` searchParam default; render `<RecipeBuilder recipe={null} mode="draft" .../>`.

- [ ] **Step 4: SKU-derived input unit picker.** When a SKU input is being added/edited, the unit `<select>` options come from THAT SKU's pack: `[pack_format ("Case"), each_container_label ("Bottle"), each_measure ("oz")]` (filter out nulls; dedupe). Pass the SKU's pack fields through so the picker + the live readout can compute oz via the client mirror of `ozForRecipeInput` (import the pure fn from `lib/recipe-math` — it's client-safe). Store `unit` = the chosen label, `eachContainerLabel` = the SKU's each label.

- [ ] **Step 5: Locked output-container dropdown.** Output container is a `<select>` over the `units` registry options (passed from the server page), not free text. Store `outputContainerLabel` = chosen label.

- [ ] **Step 6: `RecipeInputRow`/`RecipeOutputRow`** — display the stored unit + container labels (no logic change beyond showing them). `npx tsc --noEmit` + `npm run build` clean; commit.
```bash
git add app/admin/recipes/new components/admin/recipes
git commit -m "$(printf 'feat(recipe-refinement): draft-then-save builder + SKU-derived input units + locked output containers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Item Sold-directly UX

**Files:** Modify `components/admin/templates/GlobalRegistryTab.tsx` (the item definition editor).

**Context:** Read `GlobalRegistryTab.tsx`'s `RegistryRow` definition editor (where item name/par/etc. are edited + saved). Add a Sold-directly section.

- [ ] **Step 1: Add the toggle + conditional fields** — a "Sold directly" checkbox; when checked, reveal `sell_portion` (number) + `sell_portion_unit` (select over the `units` registry — pass options in, or reuse RegistrySelect) + `menu_price` (number, only editable at MoO+ / `level >= 8`). The item's current `soldDirectly`/`sellPortion`/`sellPortionUnit`/`menuPrice` must be loaded into the registry view — extend the item registry loader's SELECT + view type to include these columns (find where the registry rows are loaded for GlobalRegistryTab and add the 4 fields).

- [ ] **Step 2: Save via `PATCH /api/admin/items/[itemId]/sold-directly`** — on save, POST the sold-directly payload (separate from the existing definition save, or folded in — keep it a distinct call to the new route for clarity). Use `useStepUp("B")` before the call (matches recipe writes).

- [ ] **Step 3: `npx tsc --noEmit` + `npm run build` clean; commit**
```bash
git add components/admin/templates/GlobalRegistryTab.tsx lib
git commit -m "$(printf 'feat(recipe-refinement): item Sold-directly toggle (portion + unit + menu_price)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: i18n

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Grep the new surfaces for referenced keys** (`app/admin/recipes/new`, the modified recipe components, GlobalRegistryTab's sold-directly section, the SKU form) — collect every new `recipes.*` / `admin.skus.each_container_label` / item sold-directly key + any new error codes added to `resolveErrorKey`'s `KNOWN_ERROR_CODES` (`incomplete_recipe`, `invalid_sell_portion`, `invalid_output` if used). Add ALL to both files, EN + tú-form ES.

- [ ] **Step 2: Parity check** (adapt the flat-key check from the prior i18n task; assert every new key present in both). Also confirm every code in the recipes `KNOWN_ERROR_CODES` set has a `recipes.error.<code>` key. `npx tsc --noEmit` + `npm run build` clean; commit.
```bash
git add lib/i18n/en.json lib/i18n/es.json components/admin/recipes/shared.ts
git commit -m "$(printf 'feat(recipe-refinement): i18n keys (EN+ES parity)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Final verify + operator-invisibility smoke + PR (CC)

- [ ] **Step 1:** `npx tsc --noEmit` + `npm run build` both clean.
- [ ] **Step 2: Operator-invisibility smoke** — throwaway `scripts/_smoke_derived.ts` calling `loadDerivedForItems(["9195bf47-4a74-466b-97f7-27718fbb79bb"])`; expect the Hot Peppers DerivedSku with `perUnitOz: 512`. Run, verify, delete.
- [ ] **Step 3: Atomic-create smoke (optional, CC)** — a throwaway script creating a 1-input/1-output production recipe via `createRecipeFull` (then deactivating it) to confirm the RPC commits header+edges atomically; delete the script + deactivate the test recipe.
- [ ] **Step 4: Push + PR**
```bash
git push -u origin claude/recipe-refinement
gh pr create --title "Recipe stage refinement — containers, sold-directly item, draft flow" --body "$(printf 'Implements docs/superpowers/specs/2026-07-01-recipe-stage-refinement-design.md (fast-follow to #107).\n\n- Migration 0105: vendor_items.each_container_label; items.sold_directly/sell_portion/sell_portion_unit; create_recipe_full atomic RPC.\n- Pack-aware ozForRecipeInput — engine resolves Case/Bottle input units (parity-proven 512 on Hot Peppers).\n- Draft-then-save-once recipe creation (/admin/recipes/new + atomic RPC); edit stays live.\n- SKU-derived input unit picker; locked output-container dropdown from units registry.\n- Sold-directly production item (flag + portion + menu_price); two-point ledger modeled (sale-time depletion fires when Toast lands, deferred).\n\nSmoke the preview URL in the Vercel comment, not prod.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')"
```
- [ ] **Step 5:** Poll `gh pr checks` until `build` passes; hand to Juan for preview smoke → merge.

---

## Notes for the executor
- **CC applies migration 0105 via Supabase MCP**; CC is sole committer.
- **Task 2 parity gate is load-bearing** — Hot Peppers must stay 512 (its rows are `unit='oz'` → `ozForRecipeInput` fallback). Non-identical → STOP.
- **Container units resolve to oz at the engine, not at author time** — store the human unit (`Bottle`) on the row; `ozForRecipeInput` converts. Do NOT pre-convert to oz on save (that would lose the operator-language display).
- **PostgREST numeric→string:** coerce with `num`/`Number` everywhere (each_size, quantities, yields, sell_portion, avg_oz_per_each).
- **Confirm-before-authoring:** each subagent re-reads its target files' current state (esp. Task 2 the engine, Task 3 skus.ts, Task 6 the four recipe components, Task 7 GlobalRegistryTab + the item registry loader).
