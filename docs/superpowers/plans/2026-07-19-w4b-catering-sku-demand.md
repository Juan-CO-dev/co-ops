# W4b — Catering SKU-Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatten catering prep-demand (W4a's ledger) into the raw SKUs it consumes — for BOTH extras (items) and subs (menu_items) — aggregate per (SKU, date) + a window rollup, compare against computed on-hand, and surface an advisory "SKU short → order ~N more" signal as a "Raw / SKU" tab on the W4a view.

**Architecture:** A new `perUnitSkuOzForMenuItem` (subs → SKU oz, via `recipe_outputs.output_menu_item_id`, reusing the existing item flatten for sub-items) + export the private `loadInStockPacks`. A new read lib `lib/catering/sku-demand.ts` derives-on-read over W4a's `catering_prep_demand` + the recipe graph + on-hand. A tab on the existing `/admin/catering/prep-demand` view renders it. **No new table/migration.** Dormant until catering recipes are authored.

**Tech Stack:** Next.js 16 (App Router, `params`/`searchParams` are Promises), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS), oz-native recipe math. Tests = `tsx` seeded smoke. Branch: `claude/w4b-catering-sku-demand`.

**Model tiering:** CC authors T1 (flatten + export — recipe-math core, touches shared libs CC owns) + T2 (sku-demand read lib) inline; Sonnet 4.6 on T3 (UI tab); Fable 5 on T4 (smoke). CC is SOLE reviewer + owns all git.

---

## Confirm-before-authoring — VERIFIED against live DB + code (2026-07-19)

- **`perUnitSkuOzForItem(itemId) → Promise<Map<sku_id, oz_per_unit>>`** EXISTS + exported (`lib/prep-consumption.ts:44`, full body read). Module-private helpers in the SAME file (reusable by the new fn): `loadMeasures()`, `loadSkuPack(skuIds)`, `loadItemOzPerPar(itemIds)`, `num()`; imports `ozForRecipeInput, skuContentOz, MeasureUnitFactor, RecipeInputSku` from `lib/recipe-math`.
- **`loadInStockPacks(skuIds, locationId) → Promise<Map<sku_id, packs>>`** is **PRIVATE** (`lib/production.ts:138`). **T1 exports it** (`async function` → `export async function`).
- **`skuContentOz(sku, measuresByLabel) → number|null`** exported (`lib/recipe-math.ts:30`). `PORTION_FRACTION` (`lib/catering/pricing-derivation.ts`) `{quarter:0.25, half:0.5, whole:1}`. `PREP_DEMAND_READ_MIN=6` exported from `lib/catering/prep-demand.ts`.
- **Schema:** `recipe_outputs` = `id, recipe_id, output_item_id, output_menu_item_id, yield, oz_alloc_share, display_order, ...`. `recipe_inputs` = `recipe_id, component_sku_id, component_item_id, quantity, unit, portioned, ...`. `recipes` = `batch_yield, recipe_type, active, ...`. `vendor_items` (SKU) = `id, name, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each, each_container_label, ...`. `vendor_delivery_items` = `delivery_id, vendor_item_id, qty_received, ...`. `measure_units` = `label, dimension, to_base_factor, active`.
- **W4a ledger `catering_prep_demand`** (migration 0137): read `status='reserved'` rows (`item_id`/`menu_item_id`/`choice_package_item_id`, `portion`, `qty`, `need_date`, `location_id`).
- **4 recipes** in prod (~5% authored; catering menu unauthored → flatten effectively dormant for catering). **NO new migration** — W4b is derive-on-read + one export + one new flatten fn + read lib + UI tab.

## File Structure

- **Modify** `lib/prep-consumption.ts` — add `perUnitSkuOzForMenuItem`; add `export` to `loadMeasures`.
- **Modify** `lib/production.ts` — add `export` to `loadInStockPacks`.
- **Create** `lib/catering/sku-demand.ts` — `loadCateringSkuDemand` + the view types.
- **Modify** `app/admin/catering/prep-demand/page.tsx` — also load `loadCateringSkuDemand`; pass to the client.
- **Modify** `components/admin/catering/prep-demand/PrepDemandClient.tsx` — a Prep / Raw-SKU tab toggle + the SKU table.
- **Modify** `lib/i18n/en.json` + `lib/i18n/es.json` — `admin.catering.prep_demand.sku.*` keys.
- **Create** `scripts/w4b-smoke.ts` — seeded flatten→SKU-demand smoke.

---

## Task 1: `perUnitSkuOzForMenuItem` + export on-hand (CC)

**Files:** Modify `lib/prep-consumption.ts` (add the fn + export `loadMeasures`); Modify `lib/production.ts` (export `loadInStockPacks`).

**Context:** A menu_item is a recipe OUTPUT via `output_menu_item_id` (filtered out of the item machinery's `outputs`, which only loads `output_item_id`), so the sub flatten needs its own top-level — but it reuses the existing `perUnitSkuOzForItem` for component *sub-items* and the private `loadMeasures`/`loadSkuPack`/`loadItemOzPerPar`/`num` helpers in the same file. Additive — does not touch `perUnitSkuOzForItem`.

- [ ] **Step 1: Export `loadInStockPacks`** — in `lib/production.ts:138` change:
```ts
async function loadInStockPacks(skuIds: string[], locationId: string): Promise<Map<string, number>> {
```
to:
```ts
export async function loadInStockPacks(skuIds: string[], locationId: string): Promise<Map<string, number>> {
```

- [ ] **Step 2: Export `loadMeasures`** — in `lib/prep-consumption.ts:18` change `async function loadMeasures(` → `export async function loadMeasures(`.

- [ ] **Step 3: Add `perUnitSkuOzForMenuItem`** to `lib/prep-consumption.ts` (after `perUnitSkuOzForItem`):
```ts
/**
 * Per-one-unit leaf-SKU oz for a MENU_ITEM (sub) — the sub-shop analog of perUnitSkuOzForItem.
 * A menu_item is a recipe OUTPUT via recipe_outputs.output_menu_item_id (which the item engine's
 * output list filters out), so this handles the top-level recipe itself, then reuses
 * perUnitSkuOzForItem for any component sub-ITEMS. Returns oz-per-one-sub; empty Map when the sub
 * has no recipe OR any input can't be resolved (non-decomposable — mirrors perUnitSkuOzForItem).
 */
export async function perUnitSkuOzForMenuItem(menuItemId: string): Promise<Map<string, number>> {
  const sb = getServiceRoleClient();
  const { data: outRow } = await sb
    .from("recipe_outputs")
    .select("recipe_id, yield")
    .eq("output_menu_item_id", menuItemId)
    .limit(1)
    .maybeSingle<{ recipe_id: string; yield: number | string }>();
  if (!outRow) return new Map();
  const recipeId = outRow.recipe_id;
  const myYield = num(outRow.yield) ?? 0;
  if (myYield <= 0) return new Map();

  const measures = await loadMeasures();
  const { data: rec } = await sb.from("recipes").select("batch_yield").eq("id", recipeId).maybeSingle<{ batch_yield: number | string | null }>();
  const batchYield = rec ? num(rec.batch_yield) : null;
  if (batchYield == null || batchYield <= 0) return new Map();

  const { data: ins } = await sb
    .from("recipe_inputs")
    .select("quantity, unit, component_sku_id, component_item_id")
    .eq("recipe_id", recipeId)
    .returns<Array<{ quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null }>>();
  const inputs = (ins ?? []).map((c) => ({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id }));

  // Fan-out share: this sub's oz-weight / total oz-weight across ALL outputs (items + menu_items).
  // menu_items carry no oz_per_par_unit → weight defaults to yield; item outputs use oz_per_par_unit×yield.
  const { data: allOuts } = await sb
    .from("recipe_outputs")
    .select("output_item_id, output_menu_item_id, yield")
    .eq("recipe_id", recipeId)
    .returns<Array<{ output_item_id: string | null; output_menu_item_id: string | null; yield: number | string }>>();
  const outList = allOuts ?? [];
  const outItemIds = outList.filter((o) => o.output_item_id).map((o) => o.output_item_id!);
  const ozPar = await loadItemOzPerPar(outItemIds);
  let totalWeight = 0;
  let myWeight = 0;
  for (const o of outList) {
    const y = num(o.yield) ?? 0;
    const w = o.output_item_id ? (ozPar.get(o.output_item_id) ?? null) : null;
    const ozWeight = w != null && w > 0 ? y * w : y;
    if (ozWeight > 0) totalWeight += ozWeight;
    if (o.output_menu_item_id === menuItemId) myWeight = ozWeight > 0 ? ozWeight : 0;
  }
  const share = totalWeight > 0 ? myWeight / totalWeight : 1 / Math.max(outList.length, 1);

  // Batch oz per leaf SKU: SKU inputs directly; sub-ITEM inputs flatten via the item engine.
  const skuIds = inputs.filter((c) => c.componentSkuId != null).map((c) => c.componentSkuId!);
  const skuPack = await loadSkuPack(skuIds);
  const batch = new Map<string, number>();
  for (const c of inputs) {
    if (c.componentSkuId != null) {
      const sku = skuPack.get(c.componentSkuId);
      const oz = sku ? ozForRecipeInput(c.quantity, c.unit, sku, measures) : null;
      if (oz == null) return new Map();
      batch.set(c.componentSkuId, (batch.get(c.componentSkuId) ?? 0) + oz);
    } else if (c.componentItemId != null) {
      const subPerUnit = await perUnitSkuOzForItem(c.componentItemId);
      if (subPerUnit.size === 0) return new Map();
      for (const [sku, oz] of subPerUnit) batch.set(sku, (batch.get(sku) ?? 0) + oz * c.quantity);
    } else {
      return new Map();
    }
  }

  const out = new Map<string, number>();
  for (const [sku, oz] of batch) out.set(sku, (oz * share) / myYield);
  return out;
}
```

- [ ] **Step 4: Typecheck + commit**
```bash
npm run typecheck
git add lib/prep-consumption.ts lib/production.ts
git commit -m "feat(w4b): perUnitSkuOzForMenuItem (sub->SKU flatten) + export loadInStockPacks/loadMeasures"
```

---

## Task 2: `lib/catering/sku-demand.ts` — the read/derive lib (CC)

**Files:** Create `lib/catering/sku-demand.ts`.

**Context:** Reads W4a's reserved prep-demand, flattens each item/sub line to SKU-oz (memoized per distinct ref, portion-scaled), aggregates per (SKU, date) + window rollup, resolves SKU names + content-oz, compares to on-hand, computes shortfall + suggested order. Advisory; read-only; `level ≥6`.

- [ ] **Step 1: Header + types + the loader**
```ts
/**
 * W4b catering SKU-demand — SERVER-ONLY, service-role. The SKU layer of the catering↔inventory
 * moat: flattens W4a's reserved prep-demand (items + subs) into the raw SKUs it consumes, aggregates
 * per (SKU, date) + a window rollup, and compares to computed on-hand for an advisory "order more"
 * signal. Advisory only (on-hand is received−used, not a count). DORMANT until catering recipes exist.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { PORTION_FRACTION, type Portion } from "@/lib/catering/pricing-derivation";
import { PREP_DEMAND_READ_MIN } from "@/lib/catering/prep-demand";
import { perUnitSkuOzForItem, perUnitSkuOzForMenuItem, loadMeasures } from "@/lib/prep-consumption";
import { loadInStockPacks } from "@/lib/production";
import { skuContentOz } from "@/lib/recipe-math";

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("sku-demand: insufficient role level");
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export interface SkuDemandCell { needDate: string; oz: number }
export interface SkuDemandRow {
  skuId: string;
  skuName: string;
  contentOz: number | null;      // null when pack fields incomplete → oz-only display
  byDate: SkuDemandCell[];       // per-date demand oz (the "when")
  totalOz: number;               // window rollup demand (the "how much")
  totalPacks: number | null;     // totalOz / contentOz
  onHandPacks: number;           // computed on-hand (advisory, received − used)
  onHandOz: number | null;       // onHandPacks × contentOz
  shortfallOz: number | null;    // max(0, totalOz − onHandOz); null when contentOz unknown
  suggestOrderPacks: number | null; // ceil(shortfallOz / contentOz)
  short: boolean;                // shortfallOz > 0
}
export interface CateringSkuDemand {
  rows: SkuDemandRow[];
  unresolvedChoiceLines: number; // choice slots — can't flatten (caption)
  noRecipeLines: number;         // item/sub refs with no/incomplete recipe (caption)
}

export async function loadCateringSkuDemand(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<CateringSkuDemand> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("catering_prep_demand")
    .select("item_id, menu_item_id, choice_package_item_id, portion, qty, need_date")
    .eq("location_id", args.locationId)
    .eq("status", "reserved")
    .gte("need_date", args.from)
    .lte("need_date", args.to)
    .returns<Array<{ item_id: string | null; menu_item_id: string | null; choice_package_item_id: string | null; portion: Portion | null; qty: number | string; need_date: string }>>();
  if (error) throw new Error(`loadCateringSkuDemand: ${error.message}`);
  const demandRows = rows ?? [];

  // Flatten each line to SKU oz, memoized per distinct item/sub ref (the flatten is per-ref).
  const perUnitCache = new Map<string, Map<string, number>>(); // "item:id" | "menu_item:id" -> {sku->oz/unit}
  const skuOzByDate = new Map<string, Map<string, number>>();   // skuId -> (need_date -> oz)
  let unresolvedChoiceLines = 0;
  let noRecipeLines = 0;

  for (const r of demandRows) {
    if (r.choice_package_item_id) { unresolvedChoiceLines++; continue; }
    const isItem = r.item_id != null;
    const refId = (r.item_id ?? r.menu_item_id)!;
    const cacheKey = `${isItem ? "item" : "menu_item"}:${refId}`;
    let perUnit = perUnitCache.get(cacheKey);
    if (!perUnit) {
      perUnit = isItem ? await perUnitSkuOzForItem(refId) : await perUnitSkuOzForMenuItem(refId);
      perUnitCache.set(cacheKey, perUnit);
    }
    if (perUnit.size === 0) { noRecipeLines++; continue; }
    const qty = num(r.qty) ?? 0;
    const scale = qty * (r.portion ? PORTION_FRACTION[r.portion] : 1);
    if (scale <= 0) continue;
    for (const [sku, ozPerUnit] of perUnit) {
      const byDate = skuOzByDate.get(sku) ?? new Map<string, number>();
      byDate.set(r.need_date, (byDate.get(r.need_date) ?? 0) + ozPerUnit * scale);
      skuOzByDate.set(sku, byDate);
    }
  }

  const skuIds = [...skuOzByDate.keys()];
  if (skuIds.length === 0) return { rows: [], unresolvedChoiceLines, noRecipeLines };

  // Resolve SKU name + content-oz + on-hand.
  const measures = await loadMeasures();
  const { data: skuRows } = await sb
    .from("vendor_items")
    .select("id, name, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; name: string; pack_format: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const skuMeta = new Map<string, { name: string; contentOz: number | null }>();
  for (const s of skuRows ?? []) {
    const contentOz = skuContentOz(
      { packFormat: s.pack_format, eachContainerLabel: null, unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) },
      measures,
    );
    skuMeta.set(s.id, { name: s.name, contentOz });
  }
  const onHand = await loadInStockPacks(skuIds, args.locationId); // packs (advisory)

  const out: SkuDemandRow[] = [];
  for (const [skuId, byDateMap] of skuOzByDate) {
    const meta = skuMeta.get(skuId);
    const name = meta?.name ?? "SKU";
    const contentOz = meta?.contentOz ?? null;
    const byDate: SkuDemandCell[] = [...byDateMap.entries()].map(([needDate, oz]) => ({ needDate, oz })).sort((a, b) => a.needDate.localeCompare(b.needDate));
    const totalOz = byDate.reduce((s, c) => s + c.oz, 0);
    const onHandPacks = onHand.get(skuId) ?? 0;
    const totalPacks = contentOz != null && contentOz > 0 ? totalOz / contentOz : null;
    const onHandOz = contentOz != null && contentOz > 0 ? onHandPacks * contentOz : null;
    const shortfallOz = onHandOz != null ? Math.max(0, totalOz - onHandOz) : null;
    const suggestOrderPacks = shortfallOz != null && shortfallOz > 0 && contentOz != null && contentOz > 0 ? Math.ceil(shortfallOz / contentOz) : null;
    out.push({ skuId, skuName: name, contentOz, byDate, totalOz, totalPacks, onHandPacks, onHandOz, shortfallOz, suggestOrderPacks, short: shortfallOz != null && shortfallOz > 0 });
  }
  out.sort((a, b) => a.skuName.localeCompare(b.skuName));
  return { rows: out, unresolvedChoiceLines, noRecipeLines };
}
```

- [ ] **Step 2: Typecheck + commit**
```bash
npm run typecheck
git add lib/catering/sku-demand.ts
git commit -m "feat(w4b): sku-demand read lib — flatten prep-demand -> SKU oz + on-hand shortfall + order-more"
```

---

## Task 3: UI — "Raw / SKU" tab on the prep-demand view (Sonnet)

**Files:** Modify `app/admin/catering/prep-demand/page.tsx`; Modify `components/admin/catering/prep-demand/PrepDemandClient.tsx`; Modify `lib/i18n/en.json` + `lib/i18n/es.json`.

**Context (read first):** the existing `app/admin/catering/prep-demand/page.tsx` (server gate + location/window + `loadCateringPrepDemand`) and `components/admin/catering/prep-demand/PrepDemandClient.tsx` (the `.co-*` visual system, `useTranslation`, `formatDateLabel`, the per-day rendering). Contracts:
- `loadCateringSkuDemand(auth, {locationId, from, to}) → CateringSkuDemand` = `{ rows: SkuDemandRow[], unresolvedChoiceLines, noRecipeLines }`; `SkuDemandRow` = `{ skuId, skuName, contentOz, byDate: {needDate, oz}[], totalOz, totalPacks, onHandPacks, onHandOz, shortfallOz, suggestOrderPacks, short }` (from `lib/catering/sku-demand.ts`).

- [ ] **Step 1:** In `page.tsx`, when a `locationId` exists, ALSO call `loadCateringSkuDemand(auth, { locationId, from, to })` (alongside the existing `loadCateringPrepDemand`) and pass `skuDemand={skuDemand}` to `<PrepDemandClient>`.
- [ ] **Step 2:** In `PrepDemandClient.tsx`, add a **two-tab toggle** ("Prep" | "Raw / SKU") above the current day-list. "Prep" renders the existing W4a content unchanged. "Raw / SKU" renders `skuDemand`:
  - A per-SKU list: `skuName` + the window `totalOz` (and `totalPacks` when non-null; else "oz only — pack size unknown"); a per-date sub-line (`byDate`: "Fri 192 oz · Sat 96 oz") using `formatDateLabel`; when `short`, an amber chip "on hand ~{onHandPacks} packs (approx) · short ~{suggestOrderPacks ?? shortfallOz} → order more"; ALWAYS caption on-hand as approximate.
  - Captions when `unresolvedChoiceLines > 0` ("{n} unresolved choice lines not included") and `noRecipeLines > 0` ("{n} demand lines have no recipe — not decomposed").
  - Empty state when `rows` is empty ("no SKU demand — recipes not yet authored").
  - Tab state is local `useState` (no `useSearchParams`); location/window controls stay shared above both tabs.
- [ ] **Step 3:** i18n — add `admin.catering.prep_demand.sku.*` keys to BOTH `lib/i18n/en.json` and `lib/i18n/es.json` (EN + ES, tú-form) for every new visible string + ARIA: `tab_prep`, `tab_sku`, `total_oz` (`{oz}`), `total_packs` (`{packs}`), `oz_only`, `on_hand_approx` (`{packs}`), `short_order` (`{packs}`), `unresolved_choice` (`{n}`), `no_recipe` (`{n}`), `empty`, per-date labels. One key per string.
- [ ] **Step 4: Build gate + commit**
```bash
npm run build
git add app/admin/catering/prep-demand components/admin/catering/prep-demand lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w4b): Raw/SKU tab on the catering prep-demand view + i18n"
```

---

## Task 4: Seeded smoke (Fable)

**Files:** Create `scripts/w4b-smoke.ts`.

**Context:** Mirror `scripts/w4a-smoke.ts` structure (service-role, seed → drive REAL lib → assert → hard-delete in `finally`, zero residue, `w4b-smoke: PASS`, plain `main().catch()`). Run: `npx tsx --env-file=.env.local scripts/w4b-smoke.ts`. Minimal actor: load a real cgs user, cast `{ user: { id, role }, locations: [] } as unknown as AuthContext`. This smoke must author real recipes.

- [ ] **Step 1: Seed (capture every id)** at a real active location:
  - **SKU A** (`vendor_items`): pack fields so `content_oz` resolves — e.g. `units_per_pack=1, each_size=80, each_measure='oz', pack_format` set (→ content_oz 80). Also seed a measure_unit 'oz' if not present (check `measure_units` for label 'oz' with dimension 'weight', to_base_factor 1 — it should exist; if not, seed it and track for cleanup).
  - **SKU B** (`vendor_items`): pack fields INCOMPLETE (e.g. `units_per_pack=null`) so `content_oz` is null (exercises the oz-only path).
  - **On-hand:** a `vendor_deliveries` + `vendor_delivery_items` at the location: SKU A `qty_received=1` (→ on-hand 1 pack = 80 oz). Check the deliveries table's NOT NULL cols.
  - **Item extra** (`items`, catering_available) + a recipe: `recipes(recipe_type,batch_yield=1)` + `recipe_inputs(component_sku_id=SKU A, quantity=2, unit='oz')` + `recipe_outputs(output_item_id=item, yield=1)` → per-unit = 2 oz of SKU A.
  - **Sub** (`menu_items`, catering_available) + a recipe: `recipes(batch_yield=1)` + `recipe_inputs(component_sku_id=SKU B, quantity=3, unit='oz')` + `recipe_outputs(output_menu_item_id=sub, yield=1)` → per-unit = 3 oz of SKU B.
  - A confirmed lead + accepted quote (`event_date=NEED_DATE` fixed, e.g. "2026-08-20") + `catering_quote_items`: item qty 4; sub qty 6 portion 'half'; (optional) a package/choice line to exercise the choice caption.
  - `reservePrepDemand(actor, pipelineId)` (W4a) to populate the ledger.
- [ ] **Step 2: Assert `loadCateringSkuDemand(actor, {locationId, from: NEED_DATE, to: NEED_DATE})`:**
  - SKU A row (from the item extra): `totalOz = 4 × 2 = 8`; `contentOz=80`; `onHandPacks=1`, `onHandOz=80`; `shortfallOz=0` (8 < 80), `short=false`.
  - SKU B row (from the sub, half-portion): `totalOz = 6 × 0.5 × 3 = 9`; `contentOz=null` (incomplete pack) → `totalPacks=null`, `onHandOz=null`, `shortfallOz=null`, `suggestOrderPacks=null`, `short=false` (oz-only path).
  - Assert an OVER/short case too: either bump the item qty so SKU A demand > 80 (e.g. qty 50 → 100 oz > 80 → short 20, suggestOrderPacks = ceil(20/80)=1), OR seed on-hand 0 — pick one and assert `short=true` + `suggestOrderPacks` math. (Recommend: seed the item qty high enough, OR a second assertion pass.)
  - If a choice line was seeded: `unresolvedChoiceLines === 1`.
- [ ] **Step 3: Cleanup** — hard-delete in FK-safe order (catering_prep_demand by pipeline_id → quote_items → quote → any package rows → recipe_inputs/recipe_outputs → recipes → vendor_delivery_items → vendor_deliveries → vendor_items → menu_items → items → pipeline; + any measure_unit you seeded). Verify zero residue. Print `w4b-smoke: PASS`.
- [ ] **Step 4: Commit**
```bash
git add scripts/w4b-smoke.ts
git commit -m "test(w4b): seeded flatten -> SKU-demand smoke (PASS, zero residue)"
```

---

## Task 5: Final gates + PR

- [ ] **Step 1:** `npm run build` → PASS. `npm run typecheck` → PASS. `npx eslint` new/changed files → clean.
- [ ] **Step 2:** `npx tsx --env-file=.env.local scripts/w4b-smoke.ts` → PASS, zero residue.
- [ ] **Step 3:** CC recurring-bug-class checklist: read-only + level≥6 (reuse gate); no writes; bounded loaders (memoized per distinct ref, window+location scoped); on-hand honesty flags; no migration; `searchParams` awaited; the new flatten doesn't alter `perUnitSkuOzForItem`.
- [ ] **Step 4:** Open the PR (verify `gh pr view --json state`; don't chain branch-delete). Title: `feat(w4b): catering SKU-demand`. Body: the sub-flatten + SKU-demand aggregation + on-hand shortfall + order-more, the advisory/dormant posture, and deferred (W4c surplus; SKU-par/PO write; choice-slot flatten).

---

## Self-Review (against the spec)

**Spec coverage:** §3 flatten (item + new sub) + aggregation → T1 + T2. §4 on-hand shortfall (window rollup, oz basis, approximate, content-oz-unknown → oz-only) → T2 (the row math). §5 order-more suggestion + SKU-par deferred → T2 (`suggestOrderPacks`) + not-built. §6 Raw/SKU tab → T3. §7 dormancy/captions/memoize/read-only → T2 (captions + per-ref cache) + T3 (empty state). §8 testing → T4. §9 confirm-before-authoring → top + T1 (the export + the verbatim-mirrored flatten).

**Placeholder scan:** T3 (UI) gives contracts + mirror-ref (existing PrepDemandClient) not verbatim JSX — deliberate, matching prior UI tasks. T1/T2 have complete code.

**Type consistency:** `perUnitSkuOzForMenuItem` (T1) + `loadInStockPacks`/`loadMeasures` exports consumed in T2; `SkuDemandRow`/`SkuDemandCell`/`CateringSkuDemand`/`loadCateringSkuDemand` defined once (T2) + consumed in T3/T4; `skuContentOz` shape matches `RecipeInputSku` fields; `PORTION_FRACTION`/`PREP_DEMAND_READ_MIN` reused (verified exports).
