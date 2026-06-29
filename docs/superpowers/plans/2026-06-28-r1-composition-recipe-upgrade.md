# R1 — Composition→Recipe Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn C2's `item_components` BOM into the full oz / batch / yield recipe model — tracking type + batch yield on items, derived `content_oz` on SKUs, a measure-unit conversion registry, and a pure derivation engine — with admin-only entry and **no operator-flow change**.

**Architecture:** One additive migration (0097) + a post-deploy drop (0098 retiring `kind`). A new pure `lib/recipe-math.ts` engine (consumed by the SKU `content_oz` readout now; by R2 cost/yield later). Admin surfacing on SkuForm, the Global-tab item panel, MadeFromEditor, and a richer measure-unit add. Reads/writes go through the existing service-role admin libs; authority unchanged (SKU fields GM+, item-definition fields MoO+, measure-unit add MoO+).

**Tech Stack:** Next 16 App Router, React 19, Supabase Postgres 17 (custom-JWT + RLS, service-role admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n (flat dotted keys), migrations via Supabase MCP + captured to `supabase/migrations/`. No test framework → `tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit).

**Spec:** `docs/superpowers/specs/2026-06-28-r1-composition-recipe-upgrade-design.md`.
**Branch:** `claude/r1-composition-recipe-upgrade` off `origin/main` at `28ce094`.
**Prod ref:** `bgcvurheqzylyfehqgzh`.

---

## File Structure

**New:**
- `lib/recipe-math.ts` — pure derivation engine (`skuContentOz`, `componentPerUnitOz`, `itemPerUnitOz`, `packYieldForComponent` + `MeasureDimension`/`MeasureUnitFactor` types). No I/O, client-safe.
- `components/admin/skus/MeasureUnitSelect.tsx` — measure-unit dropdown whose MoO+ "+Add" collects label + dimension + factor (replaces RegistrySelect at the two each-measure spots).
- `supabase/migrations/0097_recipe_model_fields.sql` — captured additive migration.
- `supabase/migrations/0098_drop_items_kind.sql` — captured post-deploy drop.

**Modified:**
- `lib/types.ts` — `Item`: drop `kind`/`ItemKind`, add `trackingType`/`batchYield`/`ozPerParUnit` + `TrackingType` union.
- `lib/admin/skus.ts` — `SkuView`/`DbSkuRow`/`SKU_COLS` + `avgOzPerEach`; `createSku`/`updateSku` validate+write it; `loadMeasureUnits` returns the richer `MeasureUnitOption`; new `addMeasureUnit({label,dimension,toBaseFactor})`.
- `lib/admin/templates.ts` — drop `kind` from `addPrepItem`+`addRegistryItem` inserts; `ChecklistRegistryItem` + the 3 new fields; `loadChecklistAdminView` registry select+map + richer `measureUnits`; `updateRegistryItemDefinition` writes the 3 new item-only fields.
- `app/api/admin/checklist-templates/registry/[itemId]/route.ts` — pass the 3 new fields through.
- `app/api/admin/skus/measure-units/route.ts` — accept `{label,dimension,toBaseFactor}`.
- `components/admin/skus/SkuForm.tsx` — `avgOzPerEach` input (conditional) + computed `content_oz` readout; consume `MeasureUnitSelect`.
- `components/admin/templates/GlobalRegistryTab.tsx` — `RegistryRow` definition panel gains tracking-type select + batch-yield + oz-per-par-unit inputs; `MadeFromEditor` gets `batchYield`.
- `components/admin/templates/MadeFromEditor.tsx` — "per batch" relabel + per-unit (`qty/batchYield`) display + batch-yield read-out; consume `MeasureUnitSelect`.
- `lib/i18n/en.json` + `lib/i18n/es.json` — new keys.

---

## Task 1: Branch + additive migration 0097

**Files:**
- Create: `supabase/migrations/0097_recipe_model_fields.sql`

- [ ] **Step 1: Create the branch**

```bash
git fetch origin
git switch -c claude/r1-composition-recipe-upgrade origin/main
git log --oneline -1   # expect 28ce094 docs(R1): composition→recipe upgrade design
```

- [ ] **Step 2: Re-read the live schema before authoring (confirm-before-authoring)**

Run via Supabase MCP `execute_sql` on `bgcvurheqzylyfehqgzh` and confirm: `items` has `kind text NOT NULL DEFAULT 'manual'` and no `tracking_type`; `item_components` is empty; `vendor_items` has no `content_oz`/`avg_oz_per_each`; `measure_units` has 9 rows, no `dimension`/`to_base_factor`.

```sql
select column_name from information_schema.columns where table_name='items' and column_name in ('kind','tracking_type','batch_yield','oz_per_par_unit');
select count(*) from item_components;
select label from measure_units order by display_order;
```
Expected: `kind` present, the 3 new absent; `0`; the 9 labels.

- [ ] **Step 3: Apply migration 0097 via Supabase MCP `apply_migration`**

Name: `0097_recipe_model_fields`. **Additive only — does NOT touch `kind`** (new code omits it; the existing `DEFAULT 'manual'` keeps satisfying old code's inserts during the deploy window). The `DROP COLUMN kind` is the separate post-deploy 0098.

```sql
-- items: recipe-model axes
alter table items add column tracking_type text not null default 'portioned'
  check (tracking_type in ('on_hand','portioned','line'));
alter table items add column batch_yield numeric not null default 1
  check (batch_yield > 0);
alter table items add column oz_per_par_unit numeric;

-- vendor_items: oz per one each_measure unit (entered for count/volume; null for weight)
alter table vendor_items add column avg_oz_per_each numeric;

-- measure_units: dimension + factor to the dimension's base (weight→oz, volume→fl oz, count→each)
alter table measure_units add column dimension text;
alter table measure_units add column to_base_factor numeric;

update measure_units set dimension='weight', to_base_factor=1         where label='oz';
update measure_units set dimension='weight', to_base_factor=16        where label='lb';
update measure_units set dimension='weight', to_base_factor=0.035274  where label='gram';
update measure_units set dimension='weight', to_base_factor=35.27396  where label='kg';
update measure_units set dimension='volume', to_base_factor=1         where label='fl oz';
update measure_units set dimension='volume', to_base_factor=128       where label='gallon';
update measure_units set dimension='volume', to_base_factor=0.033814  where label='mL';
update measure_units set dimension='volume', to_base_factor=33.814    where label='liter';
update measure_units set dimension='count',  to_base_factor=1         where label='count';

-- lock them down now that the 9 are backfilled (new adds must supply both)
alter table measure_units alter column dimension set not null;
alter table measure_units add constraint measure_units_dimension_check
  check (dimension in ('weight','volume','count'));
alter table measure_units alter column to_base_factor set not null;
```

- [ ] **Step 4: Verify the migration landed**

```sql
select label, dimension, to_base_factor from measure_units order by display_order;
select column_name from information_schema.columns
  where table_name='items' and column_name in ('tracking_type','batch_yield','oz_per_par_unit');
select count(*) from items where tracking_type='portioned';  -- expect 45 (all defaulted)
```
Expected: 9 measures all with dimension+factor; the 3 item columns present; 45 items defaulted to `portioned`.

- [ ] **Step 5: Capture the migration file** (going-forward header)

Write `supabase/migrations/0097_recipe_model_fields.sql`:
```sql
-- Migration 0097_recipe_model_fields
-- Applied via Supabase MCP apply_migration on 2026-06-28.
-- Canonical reference: docs/superpowers/specs/2026-06-28-r1-composition-recipe-upgrade-design.md §5
-- R1 recipe model: items.tracking_type/batch_yield/oz_per_par_unit,
-- vendor_items.avg_oz_per_each, measure_units.dimension/to_base_factor (+ backfill).
-- NOTE: items.kind is intentionally NOT dropped here — that is the post-deploy
-- migration 0098 (avoids breaking old-code item inserts during the deploy window).

<the exact SQL from Step 3>
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0097_recipe_model_fields.sql
git commit -m "feat(R1): migration 0097 — recipe-model fields (additive)"
```

---

## Task 2: Pure derivation engine `lib/recipe-math.ts`

**Files:**
- Create: `lib/recipe-math.ts`
- Test: `scripts/_smoke_recipe_math.ts` (throwaway — deleted in Task 12)

- [ ] **Step 1: Write the failing smoke**

Create `scripts/_smoke_recipe_math.ts`:
```ts
import { skuContentOz, componentPerUnitOz, packYieldForComponent, type MeasureUnitFactor } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["count", { dimension: "count", toBaseFactor: 1 }],
  ["gallon", { dimension: "volume", toBaseFactor: 128 }],
]);

function assert(label: string, got: unknown, want: unknown) {
  const ok = Math.abs(Number(got) - Number(want)) < 1e-6 || got === want;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got=${got} want=${want}`);
  if (!ok) process.exitCode = 1;
}

// content_oz — weight (mayo Case·4·128 oz = 512), lb (4·8 lb = 512), count (lettuce 24·1·avg)
assert("mayo oz", skuContentOz({ unitsPerPack: 4, eachSize: 128, eachMeasure: "oz", avgOzPerEach: null }, measures), 512);
assert("mayo lb", skuContentOz({ unitsPerPack: 4, eachSize: 8, eachMeasure: "lb", avgOzPerEach: null }, measures), 512);
assert("lettuce count", skuContentOz({ unitsPerPack: 24, eachSize: 1, eachMeasure: "count", avgOzPerEach: 13 }, measures), 312);
assert("oil gallon", skuContentOz({ unitsPerPack: 4, eachSize: 1, eachMeasure: "gallon", avgOzPerEach: 120 }, measures), 480);
// missing avg for count → null; missing pack field → null; unknown measure → null
assert("count no avg → null", skuContentOz({ unitsPerPack: 24, eachSize: 1, eachMeasure: "count", avgOzPerEach: null }, measures), null);
assert("no eachSize → null", skuContentOz({ unitsPerPack: 4, eachSize: null, eachMeasure: "oz", avgOzPerEach: null }, measures), null);
assert("unknown measure → null", skuContentOz({ unitsPerPack: 4, eachSize: 1, eachMeasure: "qt", avgOzPerEach: null }, measures), null);

// per-unit oz: 32 oz of a weight SKU per batch, batchYield 4 → 8 oz/unit
assert("perUnitOz weight", componentPerUnitOz({ quantity: 32, unit: "oz", batchYield: 4, skuAvgOzPerEach: null }, measures), 8);
// count component: 2 heads per batch × 13 oz/head ÷ batchYield 1 = 26
assert("perUnitOz count", componentPerUnitOz({ quantity: 2, unit: "count", batchYield: 1, skuAvgOzPerEach: 13 }, measures), 26);
// pack yield: content 512 oz, perUnitOz 8 → 64 par-units per pack
assert("packYield", packYieldForComponent(512, 8), 64);
assert("packYield null perUnit", packYieldForComponent(512, 0), null);

const typed = skuContentOz({ unitsPerPack: 4, eachSize: 128, eachMeasure: "oz", avgOzPerEach: null }, measures);
console.log(`typeof content_oz = ${typeof typed}`);  // must be "number"
```

- [ ] **Step 2: Run it — verify it fails (module not found)**

```bash
npx tsx --env-file=.env.local scripts/_smoke_recipe_math.ts
```
Expected: FAIL — cannot resolve `@/lib/recipe-math`.

- [ ] **Step 3: Implement `lib/recipe-math.ts`**

```ts
/**
 * Pure recipe-math engine (Item/Inventory Spine — R1). No I/O, client-safe.
 *
 * Two oz-conversions (see spec §2): SKU→oz (content_oz, via avg_oz_per_each) and
 * the recipe per-unit math (per-batch ÷ batch_yield, in oz). Weight measures
 * convert via the registry's to_base_factor; count/volume measures use the SKU's
 * entered avg_oz_per_each. Consumed by the SKU content_oz readout now (R1) and by
 * cost/yield (R2). Every function returns null when an input is missing rather
 * than guessing — callers render "—".
 */

export type MeasureDimension = "weight" | "volume" | "count";

export interface MeasureUnitFactor {
  dimension: MeasureDimension;
  /** Factor to the dimension's canonical base (weight→oz, volume→fl oz, count→each). */
  toBaseFactor: number;
}

/** oz contributed by ONE each_measure unit: weight → factor (→oz); count/volume → the SKU's avg. */
function ozPerMeasureUnit(
  measure: MeasureUnitFactor,
  avgOzPerEach: number | null,
): number | null {
  if (measure.dimension === "weight") return measure.toBaseFactor;
  return avgOzPerEach != null && Number.isFinite(avgOzPerEach) ? avgOzPerEach : null;
}

/** Total usable ounces per pack. Null if any required input is missing. */
export function skuContentOz(
  sku: {
    unitsPerPack: number | null;
    eachSize: number | null;
    eachMeasure: string | null;
    avgOzPerEach: number | null;
  },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  const { unitsPerPack, eachSize, eachMeasure, avgOzPerEach } = sku;
  if (unitsPerPack == null || eachSize == null || eachMeasure == null) return null;
  const m = measuresByLabel.get(eachMeasure);
  if (!m) return null;
  const ozPerUnit = ozPerMeasureUnit(m, avgOzPerEach);
  if (ozPerUnit == null) return null;
  const total = unitsPerPack * eachSize * ozPerUnit;
  return Number.isFinite(total) ? total : null;
}

/** Convert a quantity in `unit` to oz; weight → ×factor, count/volume → ×avgFallback. */
export function ozFromMeasure(
  quantity: number,
  unit: string | null,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  avgFallback: number | null,
): number | null {
  if (!Number.isFinite(quantity) || unit == null) return null;
  const m = measuresByLabel.get(unit);
  if (!m) return null;
  const ozPerUnit = ozPerMeasureUnit(m, avgFallback);
  if (ozPerUnit == null) return null;
  return quantity * ozPerUnit;
}

/** oz of a SKU component consumed per ONE par-unit = (component oz ÷ batch_yield). */
export function componentPerUnitOz(
  args: { quantity: number; unit: string | null; batchYield: number; skuAvgOzPerEach: number | null },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (!Number.isFinite(args.batchYield) || args.batchYield <= 0) return null;
  const oz = ozFromMeasure(args.quantity, args.unit, measuresByLabel, args.skuAvgOzPerEach);
  return oz == null ? null : oz / args.batchYield;
}

/**
 * oz of inputs consumed per ONE par-unit of `item` = Σ component per-unit oz.
 * Sub-item components resolve via `resolveSubItemPerUnitOz` (the caller handles
 * recursion + memoization; R2 wires this). Returns null if any component is
 * unresolved (so the caller can show "incomplete recipe").
 */
export function itemPerUnitOz(
  batchYield: number,
  components: Array<{
    quantity: number;
    unit: string | null;
    componentSkuId: string | null;
    componentItemId: string | null;
    skuAvgOzPerEach: number | null;
  }>,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  resolveSubItemPerUnitOz: (itemId: string) => number | null,
): number | null {
  if (!Number.isFinite(batchYield) || batchYield <= 0) return null;
  let sum = 0;
  for (const c of components) {
    let oz: number | null;
    if (c.componentSkuId != null) {
      oz = componentPerUnitOz(
        { quantity: c.quantity, unit: c.unit, batchYield, skuAvgOzPerEach: c.skuAvgOzPerEach },
        measuresByLabel,
      );
    } else if (c.componentItemId != null) {
      const sub = resolveSubItemPerUnitOz(c.componentItemId);
      oz = sub == null || !Number.isFinite(batchYield) ? null : (c.quantity * sub) / batchYield;
    } else {
      oz = null;
    }
    if (oz == null) return null;
    sum += oz;
  }
  return sum;
}

/** "This pack makes ≈ N par-units" = content_oz ÷ per-unit oz. Null if perUnitOz ≤ 0. */
export function packYieldForComponent(contentOz: number | null, perUnitOz: number | null): number | null {
  if (contentOz == null || perUnitOz == null || perUnitOz <= 0) return null;
  return contentOz / perUnitOz;
}
```

- [ ] **Step 4: Run the smoke — verify all PASS**

```bash
npx tsx --env-file=.env.local scripts/_smoke_recipe_math.ts
```
Expected: every line `PASS`, and `typeof content_oz = number`. Exit 0.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit** (the smoke is committed temporarily; deleted in Task 12)

```bash
git add lib/recipe-math.ts scripts/_smoke_recipe_math.ts
git commit -m "feat(R1): pure recipe-math engine (content_oz, per-unit oz, pack yield)"
```

---

## Task 3: `Item` type — drop `kind`, add the recipe axes

**Files:**
- Modify: `lib/types.ts:146-178`

- [ ] **Step 1: Re-read `lib/types.ts:144-180`** to confirm the current `ItemKind`/`Item` shape (matches the citations below).

- [ ] **Step 2: Replace the `ItemKind` type + `Item.kind` field**

Delete:
```ts
export type ItemKind = "sku_direct" | "composite" | "manual";
```
Add in its place:
```ts
/** How an item is counted / depletes (migration 0097). Consumed by R4 counting. */
export type TrackingType = "on_hand" | "portioned" | "line";
```

In `interface Item`, delete the line `kind: ItemKind;` and add (next to `unit`):
```ts
  /** How it's counted / depletes (migration 0097); R4 consumes it. */
  trackingType: TrackingType;
  /** How many of the item's par-units one batch/composition makes (migration 0097). */
  batchYield: number;
  /** ≈ oz when a full default_par_unit of the FINISHED item (migration 0097); R4 consumes it. */
  ozPerParUnit: number | null;
```

- [ ] **Step 3: Typecheck — expect errors at every `kind` consumer**

```bash
npx tsc --noEmit
```
Expected: errors in `lib/admin/templates.ts` (and any other reader that maps `kind`). These are fixed in Task 4+. If a reader OTHER than templates.ts/skus.ts/item-components.ts surfaces, note it for that task.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(R1): Item type — drop kind, add trackingType/batchYield/ozPerParUnit"
```

---

## Task 4: SKU layer — `avg_oz_per_each` + richer measure registry

**Files:**
- Modify: `lib/admin/skus.ts`

- [ ] **Step 1: Re-read `lib/admin/skus.ts`** — confirm `SkuView` (40-56), `DbSkuRow` (139-153), `SKU_COLS` (155-156), `loadMeasureUnits` (262-264) → `loadRegistry`, `addMeasureUnit` (320-322) → `addRegistryLabel`, `createSku` (339), `updateSku` (411).

- [ ] **Step 2: Add the measure-unit option type + `avg_oz_per_each` to the SKU shapes**

Add near the top types (after `RegistryOption`):
```ts
import type { MeasureDimension } from "@/lib/recipe-math";

/** A measure-unit registry option carrying its conversion data (R1). */
export interface MeasureUnitOption {
  id: string;
  label: string;
  dimension: MeasureDimension;
  toBaseFactor: number;
}
```
In `SkuView` add after `eachMeasure`:
```ts
  avgOzPerEach: number | null; // oz per one each_measure unit (count/volume); null for weight
```
In `DbSkuRow` add after `each_measure`:
```ts
  avg_oz_per_each: number | string | null;
```
In `SKU_COLS` append `, avg_oz_per_each`.
In `hydrateSkus`' return mapping add after `eachMeasure: r.each_measure,`:
```ts
    avgOzPerEach: toNum(r.avg_oz_per_each),
```

- [ ] **Step 3: Add `avg_oz_per_each` normalize + write it in create/update**

Add a normalizer near `normalizeEachSize`:
```ts
/** avg_oz_per_each: null clears; a value must be a positive number. */
function normalizeAvgOzPerEach(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v <= 0) {
    throw new AdminSkuError(400, "invalid_avg_oz_per_each", "Average oz per each must be a positive number");
  }
  return v;
}
```
In `CreateSkuInput` + `UpdateSkuChanges` add `avgOzPerEach?: number | null;`.
In `createSku`'s insert object add `avg_oz_per_each: normalizeAvgOzPerEach(input.avgOzPerEach),`.
In `updateSku`'s change-diff block add:
```ts
  if (changes.avgOzPerEach !== undefined) update.avg_oz_per_each = normalizeAvgOzPerEach(changes.avgOzPerEach);
```

- [ ] **Step 4: `loadMeasureUnits` returns the richer shape; split `addMeasureUnit` off the shared label-only helper**

Replace `loadMeasureUnits`:
```ts
export async function loadMeasureUnits(actor: AuthContext): Promise<MeasureUnitOption[]> {
  requireLevel(actor, SKU_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("measure_units")
    .select("id, label, dimension, to_base_factor")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<Array<{ id: string; label: string; dimension: MeasureDimension; to_base_factor: number | string }>>();
  if (error) throw new Error(`loadMeasureUnits failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    dimension: r.dimension,
    toBaseFactor: Number(r.to_base_factor),
  }));
}
```
Replace `addMeasureUnit` (it can no longer use the label-only `addRegistryLabel` — it must supply dimension+factor):
```ts
const MEASURE_DIMENSIONS: ReadonlySet<string> = new Set(["weight", "volume", "count"]);

export async function addMeasureUnit(
  actor: AuthContext,
  input: { label: string; dimension: string; toBaseFactor: number },
): Promise<MeasureUnitOption> {
  requireLevel(actor, SKU_REGISTRY_ADD_MIN);
  const label = input.label.trim();
  if (!label) throw new AdminSkuError(400, "invalid_label", "Label is required");
  if (!MEASURE_DIMENSIONS.has(input.dimension)) {
    throw new AdminSkuError(400, "invalid_dimension", "Dimension must be weight, volume, or count");
  }
  if (!Number.isFinite(input.toBaseFactor) || input.toBaseFactor <= 0) {
    throw new AdminSkuError(400, "invalid_factor", "Conversion factor must be a positive number");
  }
  const sb = getServiceRoleClient();
  const { data: existing, error: exErr } = await sb
    .from("measure_units")
    .select("id, label, dimension, to_base_factor, active")
    .eq("label", label)
    .maybeSingle<{ id: string; label: string; dimension: MeasureDimension; to_base_factor: number | string; active: boolean | null }>();
  if (exErr) throw new Error(`addMeasureUnit lookup failed: ${exErr.message}`);
  if (existing) {
    if (existing.active === false) {
      await sb.from("measure_units")
        .update({ active: true, dimension: input.dimension, to_base_factor: input.toBaseFactor, updated_by: actor.user.id, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return { id: existing.id, label: existing.label, dimension: existing.dimension, toBaseFactor: Number(existing.to_base_factor) };
  }
  const { data: maxRow } = await sb
    .from("measure_units").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const nextOrder = (maxRow?.display_order ?? 0) + 1;
  const { data: inserted, error } = await sb
    .from("measure_units")
    .insert({ label, dimension: input.dimension, to_base_factor: input.toBaseFactor, display_order: nextOrder, created_by: actor.user.id, updated_by: actor.user.id })
    .select("id, label, dimension, to_base_factor")
    .maybeSingle<{ id: string; label: string; dimension: MeasureDimension; to_base_factor: number | string }>();
  if (error) throw new Error(`addMeasureUnit insert failed: ${error.message}`);
  if (!inserted) throw new Error("addMeasureUnit returned no row");
  return { id: inserted.id, label: inserted.label, dimension: inserted.dimension, toBaseFactor: Number(inserted.to_base_factor) };
}
```
> `loadPackFormats`/`addPackFormat` keep using `loadRegistry`/`addRegistryLabel` unchanged.

- [ ] **Step 5: Typecheck** — fix any caller of the old `loadMeasureUnits` ({id,label}) / `addMeasureUnit(label)` surfaced.

```bash
npx tsc --noEmit
```
Expected: errors only where templates.ts consumes `measureUnits` (Task 6) and the measure-units route calls `addMeasureUnit` (Task 5). `MadeFromEditor`/`GlobalRegistryTab` props typed `{id,label}` still accept the richer objects structurally (extra fields OK), so no break there.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/skus.ts
git commit -m "feat(R1): SKU avg_oz_per_each + measure-unit dimension/factor registry"
```

---

## Task 5: measure-units route accepts dimension + factor

**Files:**
- Modify: `app/api/admin/skus/measure-units/route.ts`

- [ ] **Step 1: Re-read the route** — confirm its current POST handler shape (gate MoO+ → Tier B → `addMeasureUnit`, `AdminSkuError` → `jsonError`).

- [ ] **Step 2: Parse + forward the richer body**

Change the POST handler's body parse + call so it reads `label`, `dimension`, `toBaseFactor` and forwards them:
```ts
const body = await parseJsonBody<{ label?: unknown; dimension?: unknown; toBaseFactor?: unknown }>(req);
const label = typeof body?.label === "string" ? body.label : "";
const dimension = typeof body?.dimension === "string" ? body.dimension : "";
const toBaseFactor = typeof body?.toBaseFactor === "number" ? body.toBaseFactor : NaN;
const created = await addMeasureUnit(ctx, { label, dimension, toBaseFactor });
return jsonOk({ option: created });
```
(Keep the existing requireSession → `getRoleLevel >= 8` → `assertStepUp(ctx, "B")` gating and the `AdminSkuError` catch → `jsonError(e.status, e.code)`. Match the file's existing import + helper style exactly.)

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/skus/measure-units/route.ts
git commit -m "feat(R1): measure-units route accepts dimension + factor"
```

---

## Task 6: Item registry lib — drop `kind`, surface + write the recipe axes

**Files:**
- Modify: `lib/admin/templates.ts` (`addPrepItem:853`, `addRegistryItem:1761`, `ChecklistRegistryItem:1915`, `loadChecklistAdminView:1993`, `updateRegistryItemDefinition:2175`)

- [ ] **Step 1: Re-read each cited block** in `lib/admin/templates.ts` to confirm shapes before editing.

- [ ] **Step 2: Drop `kind` from the two item inserts**

In `addPrepItem` (~853) delete the `kind: "manual",` line from the `items` insert object. In `addRegistryItem` (~1761) delete the `kind: "manual",` line. (The DB `DEFAULT 'manual'` still fills the column until 0098 drops it.)

- [ ] **Step 3: Extend `ChecklistRegistryItem` (~1915)**

Add after `openingVerify`:
```ts
  /** How it's counted / depletes (migration 0097). */
  trackingType: TrackingType;
  /** Batch yield — par-units one batch makes (migration 0097). */
  batchYield: number;
  /** ≈ oz per full par-unit of the finished item (migration 0097). */
  ozPerParUnit: number | null;
```
Add `TrackingType` to the `@/lib/types` import.

- [ ] **Step 4: Load the new columns in `loadChecklistAdminView` (~2002)**

Add `tracking_type, batch_yield, oz_per_par_unit` to the registry `.select(...)` string and to the `.returns<...>()` row type. In the `registry` map (after `openingVerify: r.opening_verify,`) add:
```ts
    trackingType: (r.tracking_type ?? "portioned") as TrackingType,
    batchYield: Number(r.batch_yield ?? 1),
    ozPerParUnit: r.oz_per_par_unit == null ? null : Number(r.oz_per_par_unit),
```
(Numeric columns arrive as strings from PostgREST — coerce with `Number(...)`.)

- [ ] **Step 5: Write the 3 item-only fields in `updateRegistryItemDefinition` (~2175)**

These are **item-only** (lines don't carry them) → they go in `update`/`before`/`after` but **NOT** in `changes` (no `propagateItemDefinitionToLines`).

Extend the `args` type:
```ts
    trackingType?: string;
    batchYield?: number;
    ozPerParUnit?: number | null;
```
Add validation up-front (near the min-role check):
```ts
  if (args.trackingType !== undefined && !["on_hand", "portioned", "line"].includes(args.trackingType)) {
    throw new AdminTemplateError(400, "invalid_tracking_type", "Tracking type must be on_hand, portioned, or line");
  }
  if (args.batchYield !== undefined && (!Number.isFinite(args.batchYield) || args.batchYield <= 0)) {
    throw new AdminTemplateError(400, "invalid_batch_yield", "Batch yield must be a positive number");
  }
  if (args.ozPerParUnit !== undefined && args.ozPerParUnit !== null && (!Number.isFinite(args.ozPerParUnit) || args.ozPerParUnit <= 0)) {
    throw new AdminTemplateError(400, "invalid_oz_per_par_unit", "Oz per par unit must be a positive number or empty");
  }
```
Add the 3 columns to the item `.select(...)` read (so before/after capture the prior value) and its row type: `tracking_type, batch_yield, oz_per_par_unit`. Then after the existing `section` diff block add:
```ts
  if (args.trackingType !== undefined && args.trackingType !== item.tracking_type) {
    update.tracking_type = args.trackingType; before.tracking_type = item.tracking_type; after.tracking_type = args.trackingType;
  }
  if (args.batchYield !== undefined && args.batchYield !== Number(item.batch_yield)) {
    update.batch_yield = args.batchYield; before.batch_yield = Number(item.batch_yield); after.batch_yield = args.batchYield;
  }
  if (args.ozPerParUnit !== undefined) {
    const prev = item.oz_per_par_unit == null ? null : Number(item.oz_per_par_unit);
    if (args.ozPerParUnit !== prev) { update.oz_per_par_unit = args.ozPerParUnit; before.oz_per_par_unit = prev; after.oz_per_par_unit = args.ozPerParUnit; }
  }
```
(Add `tracking_type: string; batch_yield: number | string; oz_per_par_unit: number | string | null;` to the item read's `maybeSingle<{...}>` type.)

- [ ] **Step 6: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: clean (the `kind` errors from Task 3 are now resolved). If any OTHER file still reads `Item.kind`, fix it here (grep `\.kind` in lib — exclude `ComponentView.kind`).

- [ ] **Step 7: Commit**

```bash
git add lib/admin/templates.ts
git commit -m "feat(R1): registry lib — drop kind, surface + write trackingType/batchYield/ozPerParUnit"
```

---

## Task 7: registry/[itemId] route passes the recipe axes through

**Files:**
- Modify: `app/api/admin/checklist-templates/registry/[itemId]/route.ts`

- [ ] **Step 1: Re-read the route** — confirm the PATCH handler reads the definition fields off the body and calls `updateRegistryItemDefinition` (MoO+ → Tier B gate).

- [ ] **Step 2: Forward the 3 new fields**

In the body parse, add `trackingType` (string), `batchYield` (number), `ozPerParUnit` (number|null), and include them in the `updateRegistryItemDefinition(ctx, { ... })` args using the same `typeof`-narrowing the route already uses for `recommendedPar`/`minRoleLevel` (only include a key when present). Example additions:
```ts
...(typeof body?.trackingType === "string" ? { trackingType: body.trackingType } : {}),
...(typeof body?.batchYield === "number" ? { batchYield: body.batchYield } : {}),
...("ozPerParUnit" in (body ?? {}) ? { ozPerParUnit: typeof body?.ozPerParUnit === "number" ? body.ozPerParUnit : null } : {}),
```

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/checklist-templates/registry/[itemId]/route.ts"
git commit -m "feat(R1): registry route forwards trackingType/batchYield/ozPerParUnit"
```

---

## Task 8: `MeasureUnitSelect` component (richer add)

**Files:**
- Create: `components/admin/skus/MeasureUnitSelect.tsx`

- [ ] **Step 1: Re-read `components/admin/skus/RegistrySelect.tsx`** (the pattern to mirror) + `components/admin/templates/shared.ts` (`postJson`, `resolveErrorKey`).

- [ ] **Step 2: Implement `MeasureUnitSelect`**

Same dropdown UX as `RegistrySelect`, but the MoO+ "+Add" opens an inline 3-field form (label + dimension select + factor) instead of `window.prompt`, POSTing `{label,dimension,toBaseFactor}` to `/api/admin/skus/measure-units`.

```tsx
"use client";

/**
 * MeasureUnitSelect (R1) — measure-unit dropdown whose MoO+ "+Add" collects
 * label + dimension + to-base-factor (recipe-math needs both). Mirrors
 * RegistrySelect's dropdown; replaces it at the each-measure / made-from-measure
 * spots. value/onChange carry the measure LABEL.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "@/components/admin/templates/shared";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function MeasureUnitSelect({
  label,
  value,
  onChange,
  options,
  actorLevel,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ id: string; label: string }>;
  actorLevel: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canAdd = actorLevel >= 8; // MoO+

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [dimension, setDimension] = useState<"weight" | "volume" | "count">("weight");
  const [factor, setFactor] = useState("");

  const labels = options.map((o) => o.label);
  const valueMissing = value.trim() !== "" && !labels.includes(value);

  const add = async () => {
    if (busy) return;
    const lbl = newLabel.trim();
    const f = Number(factor);
    if (!lbl || !Number.isFinite(f) || f <= 0) { window.alert(t(resolveErrorKey("invalid_factor"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/skus/measure-units", { label: lbl, dimension, toBaseFactor: f }, "POST");
    setBusy(false);
    if (result.ok) {
      onChange(lbl);
      setOpen(false); setNewLabel(""); setFactor(""); setDimension("weight");
      router.refresh();
    } else {
      window.alert(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      <select className={fieldCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {valueMissing ? <option value={value}>{value}</option> : null}
        {labels.map((l) => (<option key={l} value={l}>{l}</option>))}
      </select>
      {canAdd ? (
        open ? (
          <div className="mt-2 flex flex-col gap-2 rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
            <input className={fieldCls} placeholder={t("admin.skus.measure.add_label")} value={newLabel} disabled={busy} onChange={(e) => setNewLabel(e.target.value)} />
            <select className={fieldCls} value={dimension} disabled={busy} onChange={(e) => setDimension(e.target.value as "weight" | "volume" | "count")}>
              <option value="weight">{t("admin.skus.measure.dimension_weight")}</option>
              <option value="volume">{t("admin.skus.measure.dimension_volume")}</option>
              <option value="count">{t("admin.skus.measure.dimension_count")}</option>
            </select>
            <input className={fieldCls} type="number" min={0} step="any" inputMode="decimal" placeholder={t("admin.skus.measure.add_factor")} value={factor} disabled={busy} onChange={(e) => setFactor(e.target.value)} />
            <p className="text-xs text-co-text-muted">{t("admin.skus.measure.factor_hint")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50">{t("admin.skus.cancel")}</button>
              <button type="button" disabled={busy} onClick={() => void add()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.skus.measure.add_submit")}</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
            {t("admin.skus.measure.add_button")}
          </button>
        )
      ) : null}
    </label>
  );
}
```

- [ ] **Step 3: Typecheck** (`npx tsc --noEmit`) — expect clean (keys added in Task 11; until then `t(...)` accepts any `TranslationKey`-typed string — add the keys in Task 11 before the final build).

- [ ] **Step 4: Commit**

```bash
git add components/admin/skus/MeasureUnitSelect.tsx
git commit -m "feat(R1): MeasureUnitSelect with dimension+factor add form"
```

---

## Task 9: SkuForm — `avg_oz_per_each` input + computed `content_oz` readout

**Files:**
- Modify: `components/admin/skus/SkuForm.tsx`

- [ ] **Step 1: Re-read `SkuForm.tsx`** — confirm props (57-90), the `eachMeasure` `RegistrySelect` (204-214), `SkuFormValues` (31-43), state (96-113), `submit` (124-139).

- [ ] **Step 2: Switch props + imports to the richer measure type, add `avgOzPerEach` to the payload**

- Change the import: `import type { MeasureUnitOption, SkuView } from "@/lib/admin/skus";` and `import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";` and `import { MeasureUnitSelect } from "./MeasureUnitSelect";` (keep `RegistrySelect` import for pack-format).
- Change the `measureUnits` prop type to `MeasureUnitOption[]`.
- Add `avgOzPerEach: number | null;` to `SkuFormValues`.

- [ ] **Step 3: Add state + the conditional input + the computed readout**

Add state near `eachMeasure`:
```ts
const [avgOzPerEach, setAvgOzPerEach] = useState(
  initial?.avgOzPerEach != null ? String(initial.avgOzPerEach) : "",
);
```
Build a measures map + the live content_oz (inside the component body, before `return`):
```ts
const measuresByLabel = new Map<string, MeasureUnitFactor>(
  measureUnits.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]),
);
const selectedMeasure = measureUnits.find((m) => m.label === eachMeasure) ?? null;
const isNonWeight = selectedMeasure != null && selectedMeasure.dimension !== "weight";
const liveContentOz = skuContentOz(
  { unitsPerPack: parseNum(unitsPerPack), eachSize: parseNum(eachSize), eachMeasure: eachMeasure.trim() || null, avgOzPerEach: parseNum(avgOzPerEach) },
  measuresByLabel,
);
```
Replace the `each_measure` `RegistrySelect` (204-214) with `MeasureUnitSelect`:
```tsx
<MeasureUnitSelect
  label={t("admin.skus.field.each_measure")}
  value={eachMeasure}
  onChange={setEachMeasure}
  options={measureUnits}
  actorLevel={actorLevel}
  disabled={busy}
/>
```
Directly after the `grid grid-cols-2` block that holds each_size + each_measure, add the conditional avg input + the readout:
```tsx
{isNonWeight ? (
  <Labeled label={t("admin.skus.field.avg_oz_per_each")}>
    <input className={fieldCls} type="number" min={0} step="any" inputMode="decimal" value={avgOzPerEach} disabled={busy} onChange={(e) => setAvgOzPerEach(e.target.value)} />
    <span className="mt-1 block text-xs text-co-text-muted">{t("admin.skus.avg_oz_per_each_hint")}</span>
  </Labeled>
) : null}
<p className="text-sm font-bold text-co-text">
  {t("admin.skus.content_oz_label")}:{" "}
  <span className="text-co-text-muted">
    {liveContentOz == null ? "—" : `≈ ${Math.round(liveContentOz)} oz`}
  </span>
</p>
```
In `submit`'s payload object add `avgOzPerEach: parseNum(avgOzPerEach),`.

- [ ] **Step 4: Typecheck + build** (keys land in Task 11; build at end of Task 11). For now:

```bash
npx tsc --noEmit
```
Expected: clean. (If callers of `SkuForm` pass `measureUnits` typed `RegistryOption[]`, they now need `MeasureUnitOption[]` — those callers receive the value from `loadMeasureUnits`, which Task 4 already upgraded; confirm the SKU page/card pass-through compiles, fixing the prop type at the call sites if flagged.)

- [ ] **Step 5: Commit**

```bash
git add components/admin/skus/SkuForm.tsx
git commit -m "feat(R1): SkuForm avg_oz_per_each input + computed content_oz readout"
```

---

## Task 10: Global-tab item panel + MadeFromEditor

**Files:**
- Modify: `components/admin/templates/GlobalRegistryTab.tsx` (`RegistryRow` ~797)
- Modify: `components/admin/templates/MadeFromEditor.tsx`

- [ ] **Step 1: Re-read `RegistryRow` (797-1074)** + `MadeFromEditor.tsx` (whole file).

- [ ] **Step 2: `RegistryRow` — state for the 3 new fields**

Add after the `minRole` state (~840):
```ts
const [trackingType, setTrackingType] = useState(item.trackingType);
const [batchYield, setBatchYield] = useState(item.batchYield.toString());
const [ozPerParUnit, setOzPerParUnit] = useState(item.ozPerParUnit != null ? String(item.ozPerParUnit) : "");
```

- [ ] **Step 3: `RegistryRow` — inputs in the definition `<section>`** (after the min-role block, ~1022, before the blast-radius note)

```tsx
<Labeled label={t("admin.templates.field.tracking_type")}>
  <select className={field} value={trackingType} onChange={(e) => setTrackingType(e.target.value as typeof trackingType)}>
    <option value="on_hand">{t("admin.templates.tracking_type.on_hand")}</option>
    <option value="portioned">{t("admin.templates.tracking_type.portioned")}</option>
    <option value="line">{t("admin.templates.tracking_type.line")}</option>
  </select>
</Labeled>
<Labeled label={t("admin.templates.field.batch_yield")}>
  <input className={field} type="number" min={0} step="any" inputMode="decimal" value={batchYield} onChange={(e) => setBatchYield(e.target.value)} />
  <span className="mt-1 block text-xs text-co-text-muted">{t("admin.templates.batch_yield_hint")}</span>
</Labeled>
<Labeled label={t("admin.templates.field.oz_per_par_unit")}>
  <input className={field} type="number" min={0} step="any" inputMode="decimal" value={ozPerParUnit} onChange={(e) => setOzPerParUnit(e.target.value)} />
  <span className="mt-1 block text-xs text-co-text-muted">{t("admin.templates.oz_per_par_unit_hint")}</span>
</Labeled>
```

- [ ] **Step 4: `RegistryRow` — include them in `saveDefinition`'s payload** (~890)

Add to the PATCH body object:
```ts
trackingType,
...(batchYield.trim() === "" ? {} : { batchYield: Number(batchYield) }),
ozPerParUnit: ozPerParUnit.trim() === "" ? null : Number(ozPerParUnit),
```

- [ ] **Step 5: `RegistryRow` — pass `batchYield` to `MadeFromEditor`** (~942)

Add the prop: `batchYield={item.batchYield}`.

- [ ] **Step 6: `MadeFromEditor` — accept `batchYield`, relabel "per batch", show per-unit, swap to MeasureUnitSelect**

- Add `batchYield: number;` to the props type + destructure.
- Replace the measure `RegistrySelect` (226-235) with `MeasureUnitSelect` (import it: `import { MeasureUnitSelect } from "@/components/admin/skus/MeasureUnitSelect";`):
```tsx
<MeasureUnitSelect
  label={t("admin.items.made_from.measure")}
  value={unit}
  onChange={setUnit}
  options={measureUnits}
  actorLevel={actorLevel}
/>
```
- Add a batch-yield read-out under the subtitle (~133):
```tsx
<p className="mt-1 text-xs text-co-text-muted">
  {t("admin.items.made_from.batch_yield_note", { n: String(batchYield) })}
</p>
```
- In `MadeFromRow`, change `qtyLabel` to show per-batch + per-unit. Pass `batchYield` to `MadeFromRow` (add to its props + the call at ~138). Replace `qtyLabel` (304):
```ts
const perUnit = batchYield > 0 ? component.quantity / batchYield : null;
const qtyLabel = `${component.quantity} ${component.unit ?? ""} ${component.componentName}`.replace(/\s+/g, " ").trim();
const perUnitLabel = perUnit == null ? null : `${t("admin.items.made_from.per_unit")}: ${Number(perUnit.toFixed(3))} ${component.unit ?? ""}`.trim();
```
and render `perUnitLabel` as a muted line under the qty line (next to the existing pack line, ~310):
```tsx
<p className="text-sm font-bold text-co-text">{qtyLabel}</p>
{perUnitLabel ? <p className="text-xs text-co-text-muted">{perUnitLabel}</p> : null}
```
Update the `MadeFromRow` heading to "per batch" semantics — change the add-form quantity label key (213) from `admin.items.made_from.quantity` to `admin.items.made_from.quantity_per_batch` (new key in Task 11).

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean (i18n keys validate after Task 11; structural types OK now).

- [ ] **Step 8: Commit**

```bash
git add components/admin/templates/GlobalRegistryTab.tsx components/admin/templates/MadeFromEditor.tsx
git commit -m "feat(R1): item panel tracking_type/batch_yield/oz_per_par_unit + per-batch BOM readout"
```

---

## Task 11: i18n (EN + ES parity)

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Re-read both files'** `admin.skus.*` and `admin.templates.*` and `admin.items.made_from.*` regions to place keys correctly + match style.

- [ ] **Step 2: Add EN keys** (`lib/i18n/en.json`)

```json
"admin.skus.field.avg_oz_per_each": "Avg oz per each",
"admin.skus.avg_oz_per_each_hint": "Average ounces in one — used because count/volume can't be weighed directly.",
"admin.skus.content_oz_label": "Total per pack",
"admin.skus.measure.add_button": "+ Add measure unit",
"admin.skus.measure.add_label": "Unit (e.g. quart)",
"admin.skus.measure.add_factor": "Factor to base",
"admin.skus.measure.factor_hint": "How many base units in one: weight→oz, volume→fl oz, count→each. (lb = 16, gallon = 128, count = 1.)",
"admin.skus.measure.add_submit": "Add unit",
"admin.skus.measure.dimension_weight": "Weight (base: oz)",
"admin.skus.measure.dimension_volume": "Volume (base: fl oz)",
"admin.skus.measure.dimension_count": "Count (base: each)",
"admin.skus.error.invalid_avg_oz_per_each": "Average oz per each must be a positive number.",
"admin.skus.error.invalid_dimension": "Pick a dimension (weight, volume, or count).",
"admin.skus.error.invalid_factor": "Conversion factor must be a positive number.",
"admin.templates.field.tracking_type": "Tracking type",
"admin.templates.tracking_type.on_hand": "On hand (counted as-is)",
"admin.templates.tracking_type.portioned": "Portioned (made by prep)",
"admin.templates.tracking_type.line": "Line",
"admin.templates.field.batch_yield": "Batch yield",
"admin.templates.batch_yield_hint": "How many par-units one batch of this recipe makes.",
"admin.templates.field.oz_per_par_unit": "Oz per full par-unit",
"admin.templates.oz_per_par_unit_hint": "≈ ounces when a full container (quart, 1/3 pan…) of the finished item is filled.",
"admin.templates.error.invalid_tracking_type": "Tracking type must be on hand, portioned, or line.",
"admin.templates.error.invalid_batch_yield": "Batch yield must be a positive number.",
"admin.templates.error.invalid_oz_per_par_unit": "Oz per par-unit must be a positive number or empty.",
"admin.items.made_from.batch_yield_note": "This recipe's batch makes {n} par-unit(s).",
"admin.items.made_from.quantity_per_batch": "Quantity per batch",
"admin.items.made_from.per_unit": "per unit"
```

- [ ] **Step 3: Add ES keys** (`lib/i18n/es.json`) — same keys, tú-form/operational ES:

```json
"admin.skus.field.avg_oz_per_each": "Oz promedio por unidad",
"admin.skus.avg_oz_per_each_hint": "Onzas promedio en una — porque conteo/volumen no se pesan directo.",
"admin.skus.content_oz_label": "Total por paquete",
"admin.skus.measure.add_button": "+ Agregar unidad de medida",
"admin.skus.measure.add_label": "Unidad (ej. cuarto)",
"admin.skus.measure.add_factor": "Factor a la base",
"admin.skus.measure.factor_hint": "Cuántas unidades base hay en una: peso→oz, volumen→fl oz, conteo→unidad. (lb = 16, galón = 128, conteo = 1.)",
"admin.skus.measure.add_submit": "Agregar unidad",
"admin.skus.measure.dimension_weight": "Peso (base: oz)",
"admin.skus.measure.dimension_volume": "Volumen (base: fl oz)",
"admin.skus.measure.dimension_count": "Conteo (base: unidad)",
"admin.skus.error.invalid_avg_oz_per_each": "El promedio de oz por unidad debe ser un número positivo.",
"admin.skus.error.invalid_dimension": "Elige una dimensión (peso, volumen o conteo).",
"admin.skus.error.invalid_factor": "El factor de conversión debe ser un número positivo.",
"admin.templates.field.tracking_type": "Tipo de control",
"admin.templates.tracking_type.on_hand": "En existencia (se cuenta tal cual)",
"admin.templates.tracking_type.portioned": "Porcionado (lo hace prep)",
"admin.templates.tracking_type.line": "Línea",
"admin.templates.field.batch_yield": "Rendimiento por lote",
"admin.templates.batch_yield_hint": "Cuántas unidades de par hace un lote de esta receta.",
"admin.templates.field.oz_per_par_unit": "Oz por unidad de par llena",
"admin.templates.oz_per_par_unit_hint": "≈ onzas cuando un recipiente lleno (cuarto, 1/3 pan…) del producto terminado.",
"admin.templates.error.invalid_tracking_type": "El tipo de control debe ser en existencia, porcionado o línea.",
"admin.templates.error.invalid_batch_yield": "El rendimiento por lote debe ser un número positivo.",
"admin.templates.error.invalid_oz_per_par_unit": "Las oz por unidad de par deben ser un número positivo o vacío.",
"admin.items.made_from.batch_yield_note": "El lote de esta receta hace {n} unidad(es) de par.",
"admin.items.made_from.quantity_per_batch": "Cantidad por lote",
"admin.items.made_from.per_unit": "por unidad"
```

- [ ] **Step 4: Confirm the made-from error resolver covers the new SKU error codes**

In `MadeFromEditor.tsx` `KNOWN_ERROR_CODES`, the measure-add errors surface via `MeasureUnitSelect`'s own `resolveErrorKey` (templates/shared), which maps to `admin.templates.error.*` — confirm `invalid_factor`/`invalid_dimension`/`invalid_label` resolve there (add to `admin.templates.error.*` if shared resolver expects that namespace). If `resolveErrorKey` in `templates/shared.ts` maps unknown→generic, add `invalid_factor`/`invalid_dimension` to its known set + the EN/ES `admin.templates.error.invalid_factor`/`invalid_dimension` keys (already added above under `admin.skus.error.*`; mirror into `admin.templates.error.*` if shared.ts uses that prefix — verify by reading `templates/shared.ts` `resolveErrorKey`).

- [ ] **Step 5: Verify i18n parity + full build**

```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=new Set(Object.keys(es));const miss=a.filter(k=>!b.has(k));console.log(miss.length? 'MISSING IN ES: '+miss.join(', '):'i18n parity OK ('+a.length+' keys)')"
npx tsc --noEmit && npm run build
```
Expected: `i18n parity OK`; tsc + build clean.

- [ ] **Step 6: Commit**

```bash
git add lib/i18n/en.json lib/i18n/es.json components/admin/templates/MadeFromEditor.tsx components/admin/templates/shared.ts
git commit -m "feat(R1): i18n EN+ES for recipe-model fields"
```

---

## Task 12: Smoke against live data, then delete the smoke

**Files:**
- Modify: `scripts/_smoke_recipe_math.ts` (extend, then delete)

- [ ] **Step 1: Extend the smoke to hit live data** — append a DB section that loads a real measure map + one weight SKU + asserts `skuContentOz` is a `number`:

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
const sb = getServiceRoleClient();
const { data: mu } = await sb.from("measure_units").select("label, dimension, to_base_factor").eq("active", true);
const liveMeasures = new Map((mu ?? []).map((m: any) => [m.label, { dimension: m.dimension, toBaseFactor: Number(m.to_base_factor) }]));
const { data: sku } = await sb.from("vendor_items").select("units_per_pack, each_size, each_measure, avg_oz_per_each").not("each_measure","is",null).limit(1).maybeSingle();
if (sku) {
  const oz = skuContentOz({ unitsPerPack: sku.units_per_pack, eachSize: sku.each_size==null?null:Number(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: sku.avg_oz_per_each==null?null:Number(sku.avg_oz_per_each) }, liveMeasures);
  console.log(`live SKU content_oz = ${oz} (typeof ${typeof oz})`);
}
```

- [ ] **Step 2: Run it**

```bash
npx tsx --env-file=.env.local scripts/_smoke_recipe_math.ts
```
Expected: all pure-math `PASS`; live line prints a number or `—`-equivalent `null` without throwing.

- [ ] **Step 3: Delete the smoke (never committed beyond Task 2/11) + commit the removal**

```bash
git rm scripts/_smoke_recipe_math.ts
git commit -m "chore(R1): remove throwaway recipe-math smoke"
```

---

## Task 13: PR + post-deploy `kind` drop (controller)

**Files:**
- Create: `supabase/migrations/0098_drop_items_kind.sql` (applied AFTER deploy)

- [ ] **Step 1: Final gate**

```bash
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 2: Push + open the PR** (preview URL in the body; smoke = AM-prep/mid-day/Opening render identical, then set a SKU's avg-oz + an item's batch-yield/tracking-type and confirm the readouts)

```bash
git push -u origin claude/r1-composition-recipe-upgrade
gh pr create --title "R1: composition→recipe upgrade" --body "$(cat <<'EOF'
Composition→recipe upgrade (spec 2026-06-28). Migration 0097 (additive):
items.tracking_type/batch_yield/oz_per_par_unit, vendor_items.avg_oz_per_each,
measure_units.dimension/to_base_factor. New lib/recipe-math.ts engine. Admin-only
entry (SkuForm content_oz readout + avg-oz; Global-tab tracking_type/batch_yield/
oz_per_par_unit; MeasureUnitSelect; MadeFromEditor per-batch readout). NO operator
change. `items.kind` retired (post-deploy migration 0098 drops the column).

Test (preview URL): AM-prep / mid-day / Opening render identical; then in admin set
a SKU's avg-oz-per-each (see "≈ N oz" readout) and an item's batch yield / tracking
type / oz-per-par-unit.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After Juan smokes + the PR merges + Vercel deploys** (new code no longer references `kind`), apply migration 0098 via Supabase MCP `apply_migration`:

Name `0098_drop_items_kind`:
```sql
alter table items drop column kind;
```

- [ ] **Step 4: Verify + capture 0098 + push to main** (pure-docs migration capture, direct-to-main allowed)

```sql
select column_name from information_schema.columns where table_name='items' and column_name='kind';  -- expect 0 rows
```
Write `supabase/migrations/0098_drop_items_kind.sql`:
```sql
-- Migration 0098_drop_items_kind
-- Applied via Supabase MCP apply_migration on <date>, AFTER R1 merged + deployed
-- (new code no longer inserts/reads items.kind). Canonical reference:
-- docs/superpowers/specs/2026-06-28-r1-composition-recipe-upgrade-design.md §8.
alter table items drop column kind;
```
```bash
git add supabase/migrations/0098_drop_items_kind.sql
git commit -m "chore(R1): capture migration 0098 — drop items.kind (post-deploy)"
git push origin main
```

---

## Self-Review

**Spec coverage:** §5 schema → Task 1 (+ 0098 drop in Task 13); §6 engine → Task 2; §7 SkuForm → Task 9, MadeFromEditor + Global-tab panel → Task 10, measure-unit add → Task 8; §8 retire kind → Tasks 3/6 (stop using) + Task 13 (drop); §10 verification → Tasks 2/11/12 + operator smoke in Task 13. content_oz derive-not-store → no column added (Task 1), computed in Task 2/9. ✔

**Deviations from spec (flagged, within T0 discretion):** (1) `kind` dropped post-deploy (0098) not at build, to avoid the deploy-window break; (2) batch_yield INPUT lives in the MoO+ definition panel (not MadeFromEditor) to keep authority clean — MadeFromEditor shows it read-only; (3) "case → N pans" yield view deferred to R2 per the roadmap — R1 builds+tests the engine and ships only the SKU-side content_oz readout.

**Placeholder scan:** none — every code step shows the code; SQL is literal; i18n keys are listed in full.

**Type consistency:** `MeasureUnitFactor`/`MeasureDimension` (recipe-math) ↔ `MeasureUnitOption` (skus.ts, extends with id+label) ↔ `loadMeasureUnits` return ↔ SkuForm/MadeFromEditor `{id,label}`-structural props. `TrackingType` (types.ts) ↔ `Item.trackingType` ↔ `ChecklistRegistryItem.trackingType` ↔ the route/lib string-validated `"on_hand"|"portioned"|"line"`. `avgOzPerEach` consistent across `SkuView`/`CreateSkuInput`/`UpdateSkuChanges`/`SkuFormValues`/the smoke. ✔
