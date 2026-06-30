# R2 — Cost & Yield + Converts-Into Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record SKU prices, derive per-unit/plate cost recursively through the BOM, show food-cost % against a hand-entered sell price, surface "case → N par-units" yield, and a transitive reverse "which items use this SKU" — admin-only, no operator-flow change.

**Architecture:** One additive migration (0099, `items.menu_price`). Pure cost functions extend `lib/recipe-math.ts` (consume R1's oz engine + prices). A new `lib/admin/cost.ts` holds the I/O (current-price loads, memoized recursive item-cost, reverse lookup, price recording). Cost is annotated onto the existing admin view + SKU pages; everything shows "—" until data exists.

**Tech Stack:** Next 16 App Router, React 19, Supabase Postgres 17 (custom-JWT + RLS, service-role admin writes), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n, migrations via Supabase MCP + captured. No test framework → `tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit). PostgREST returns `numeric` as strings → coerce with `Number(...)`/`toNum`.

**Spec:** `docs/superpowers/specs/2026-06-30-r2-cost-yield-design.md`.
**Branch:** `claude/r2-cost-yield` off `origin/main` at `f8e68e4`.
**Prod ref:** `bgcvurheqzylyfehqgzh`.

---

## File Structure

**New:**
- `lib/admin/cost.ts` — cost I/O layer: `loadCurrentSkuPrices`, `computeSkuCostPerOz`, `annotateComponentCosts`, `loadSkuUsageMap` (transitive reverse), `recordSkuPrice` (AGM+), `AdminCostError`.
- `app/api/admin/skus/[id]/price/route.ts` — POST record a price (AGM+, Tier A).
- `components/admin/skus/SkuCostPanel.tsx` — per-SKU expander: cost/oz + record-price form + recent prices + "used by" list. Reused by the global catalog + vendor-detail card.
- `supabase/migrations/0099_items_menu_price.sql` — captured.

**Modified:**
- `lib/recipe-math.ts` — add `skuCostPerOz`, `componentPerUnitCost`, `itemPerUnitCost`, `foodCostPct` (+ carry-forward comment).
- `lib/types.ts` — `Item` += `menuPrice: number | null`.
- `lib/admin/item-components.ts` — `ComponentView` += optional `perUnitCost?`/`packYield?` (annotation slots, not computed here).
- `lib/admin/templates.ts` — `ChecklistRegistryItem` += `menuPrice`; `loadChecklistAdminView` loads menu_price + annotates cost (calls cost.ts) → `itemCosts` on the view + cost-annotated `itemComponents`; `updateRegistryItemDefinition` writes `menu_price` (item-only).
- `app/api/admin/checklist-templates/registry/[itemId]/route.ts` — forward `menuPrice`.
- `components/admin/templates/GlobalRegistryTab.tsx` — `menu_price` input in the MoO+ definition panel; pass item cost into `MadeFromEditor`.
- `components/admin/templates/MadeFromEditor.tsx` — per-component cost + "case → N" yield; item total per-unit cost + food-cost %.
- `components/admin/skus/SkuCatalogClient.tsx` + `components/admin/skus/VendorSkusCard.tsx` — mount `SkuCostPanel` per row; thread the cost/usage props.
- `app/admin/skus/page.tsx` + `app/admin/vendors/[id]/page.tsx` — load prices + usage + cost/oz, pass down.
- `lib/admin/templates.ts` `ChecklistAdminView` — add `itemCosts` field.
- `lib/i18n/en.json` + `lib/i18n/es.json` — new keys.

---

## Task 1: Branch + additive migration 0099

**Files:** Create `supabase/migrations/0099_items_menu_price.sql`

- [ ] **Step 1: Branch**
```bash
git fetch origin
git switch -c claude/r2-cost-yield origin/main
git log --oneline -1   # expect f8e68e4 docs(R2): cost & yield + converts-into design
```

- [ ] **Step 2: Re-read live schema (confirm-before-authoring)** — via Supabase MCP `execute_sql` on `bgcvurheqzylyfehqgzh`:
```sql
select count(*) from information_schema.columns where table_name='items' and column_name='menu_price';
select column_name from information_schema.columns where table_name='vendor_price_history' order by ordinal_position;
```
Expected: `0` (no menu_price yet); vendor_price_history has `id, vendor_item_id, unit_price, effective_date, recorded_at, recorded_by`.

- [ ] **Step 3: Apply migration 0099 via Supabase MCP `apply_migration`** (name `0099_items_menu_price`):
```sql
alter table items add column menu_price numeric
  check (menu_price is null or menu_price > 0);
```

- [ ] **Step 4: Verify**
```sql
select count(*) from information_schema.columns where table_name='items' and column_name='menu_price';  -- expect 1
```

- [ ] **Step 5: Capture** `supabase/migrations/0099_items_menu_price.sql`:
```sql
-- Migration 0099_items_menu_price
-- Applied via Supabase MCP apply_migration on 2026-06-30.
-- Canonical reference: docs/superpowers/specs/2026-06-30-r2-cost-yield-design.md §3
-- R2: hand-entered sell price on items → food-cost % = per-unit cost ÷ menu_price.
alter table items add column menu_price numeric
  check (menu_price is null or menu_price > 0);
```

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/0099_items_menu_price.sql
git commit -m "feat(R2): migration 0099 — items.menu_price (additive)"
```

---

## Task 2: Cost functions in `lib/recipe-math.ts`

**Files:** Modify `lib/recipe-math.ts`; Test `scripts/_smoke_recipe_cost.ts` (throwaway, deleted Task 11)

- [ ] **Step 1: Re-read `lib/recipe-math.ts`** to confirm the R1 exports (`skuContentOz`, `componentPerUnitOz`, `itemPerUnitOz`, `packYieldForComponent`, `MeasureUnitFactor`) and the `itemPerUnitOz` sub-item `÷ batchYield` shape.

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_recipe_cost.ts`:
```ts
import { skuCostPerOz, componentPerUnitCost, foodCostPct, type MeasureUnitFactor } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["count", { dimension: "count", toBaseFactor: 1 }],
]);

function assert(label: string, got: unknown, want: unknown) {
  const ok = (got == null && want == null) || Math.abs(Number(got) - Number(want)) < 1e-6;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got=${got} want=${want}`);
  if (!ok) process.exitCode = 1;
}

// $48 case ÷ 512 oz = $0.09375/oz
assert("cost/oz", skuCostPerOz(48, 512), 0.09375);
assert("cost/oz null price", skuCostPerOz(null, 512), null);
assert("cost/oz zero content", skuCostPerOz(48, 0), null);
// SKU component: 32 oz/batch ÷ batchYield 4 = 8 oz/unit × $0.09375/oz = $0.75/unit
assert("component cost weight", componentPerUnitCost(
  { quantity: 32, unit: "oz", batchYield: 4, skuAvgOzPerEach: null, skuCostPerOz: 0.09375 },
  measures,
), 0.75);
// count component: 2 heads/batch × 13 oz/head ÷ 1 = 26 oz × $0.05/oz = $1.30
assert("component cost count", componentPerUnitCost(
  { quantity: 2, unit: "count", batchYield: 1, skuAvgOzPerEach: 13, skuCostPerOz: 0.05 },
  measures,
), 1.3);
assert("component cost null costPerOz", componentPerUnitCost(
  { quantity: 32, unit: "oz", batchYield: 4, skuAvgOzPerEach: null, skuCostPerOz: null },
  measures,
), null);
// food cost %: $0.75 cost ÷ $3.00 sell = 0.25
assert("food cost pct", foodCostPct(0.75, 3), 0.25);
assert("food cost pct null sell", foodCostPct(0.75, null), null);

console.log(`typeof cost/oz = ${typeof skuCostPerOz(48, 512)}`);
```

- [ ] **Step 3: Run — verify FAIL** (`npx tsx --env-file=.env.local scripts/_smoke_recipe_cost.ts` → cannot resolve the new exports).

- [ ] **Step 4: Append the cost functions to `lib/recipe-math.ts`** (after `packYieldForComponent`):
```ts
// ── Cost (R2) — ride the same per-batch ÷ batch_yield math as the oz functions. ──

/** Cost of ONE oz of a SKU = pack price ÷ content_oz. Null if price/content missing. */
export function skuCostPerOz(packPrice: number | null, contentOz: number | null): number | null {
  if (packPrice == null || contentOz == null || contentOz <= 0) return null;
  const v = packPrice / contentOz;
  return Number.isFinite(v) ? v : null;
}

/**
 * Cost of a SKU component per ONE par-unit = componentPerUnitOz × cost/oz.
 * (componentPerUnitOz already divides per-batch quantity by batch_yield.)
 */
export function componentPerUnitCost(
  args: {
    quantity: number;
    unit: string | null;
    batchYield: number;
    skuAvgOzPerEach: number | null;
    skuCostPerOz: number | null;
  },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (args.skuCostPerOz == null) return null;
  const perUnitOz = componentPerUnitOz(
    { quantity: args.quantity, unit: args.unit, batchYield: args.batchYield, skuAvgOzPerEach: args.skuAvgOzPerEach },
    measuresByLabel,
  );
  return perUnitOz == null ? null : perUnitOz * args.skuCostPerOz;
}

/**
 * Cost of inputs consumed per ONE par-unit of `item` = Σ component costs.
 * SKU components cost via `skuCostPerOzById`; sub-item components recurse via
 * `resolveSubItemPerUnitCost` and divide by `batchYield` — the SAME per-batch
 * semantics as `itemPerUnitOz` (component quantities are per-batch; this resolves
 * the R1 spec-prose carry-forward — the code was correct). Null if any component
 * cost is unresolved (UI shows "— incomplete").
 */
export function itemPerUnitCost(
  batchYield: number,
  components: Array<{
    quantity: number;
    unit: string | null;
    componentSkuId: string | null;
    componentItemId: string | null;
    skuAvgOzPerEach: number | null;
  }>,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  skuCostPerOzById: Map<string, number | null>,
  resolveSubItemPerUnitCost: (itemId: string) => number | null,
): number | null {
  if (!Number.isFinite(batchYield) || batchYield <= 0) return null;
  let sum = 0;
  for (const c of components) {
    let cost: number | null;
    if (c.componentSkuId != null) {
      cost = componentPerUnitCost(
        {
          quantity: c.quantity,
          unit: c.unit,
          batchYield,
          skuAvgOzPerEach: c.skuAvgOzPerEach,
          skuCostPerOz: skuCostPerOzById.get(c.componentSkuId) ?? null,
        },
        measuresByLabel,
      );
    } else if (c.componentItemId != null) {
      const sub = resolveSubItemPerUnitCost(c.componentItemId);
      cost = sub == null ? null : (c.quantity * sub) / batchYield;
    } else {
      cost = null;
    }
    if (cost == null) return null;
    sum += cost;
  }
  return sum;
}

/** Food-cost fraction = per-unit cost ÷ sell price (caller ×100 for %). */
export function foodCostPct(perUnitCost: number | null, menuPrice: number | null): number | null {
  if (perUnitCost == null || menuPrice == null || menuPrice <= 0) return null;
  return perUnitCost / menuPrice;
}
```

- [ ] **Step 5: Run smoke — verify all PASS** + `typeof cost/oz = number`.

- [ ] **Step 6: `npx tsc --noEmit`** — clean.

- [ ] **Step 7: Commit**
```bash
git add lib/recipe-math.ts scripts/_smoke_recipe_cost.ts
git commit -m "feat(R2): recipe-math cost functions (cost/oz, per-unit cost, food-cost %)"
```

---

## Task 3: `lib/admin/cost.ts` — price loads, item cost, reverse lookup, record price

**Files:** Create `lib/admin/cost.ts`

- [ ] **Step 1: Re-read** `lib/admin/skus.ts` (for `SkuView`, `MeasureUnitOption`, `toNum`, `getServiceRoleClient`, `AuthContext`, `getRoleLevel`, `audit` patterns) and `lib/admin/item-components.ts` (`ComponentView`, `wouldCreateCycle` BFS pattern).

- [ ] **Step 2: Create `lib/admin/cost.ts`**:
```ts
/**
 * Admin cost/yield data layer (Item/Inventory Spine — R2). SERVER-ONLY,
 * service-role; authority re-checked per write. Composes R1's pure recipe-math
 * with prices from the append-only vendor_price_history ledger.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { MeasureUnitOption } from "@/lib/admin/skus";
import type { ComponentView } from "@/lib/admin/item-components";
import {
  skuContentOz,
  skuCostPerOz,
  itemPerUnitCost,
  foodCostPct,
  packYieldForComponent,
  componentPerUnitOz,
  type MeasureUnitFactor,
} from "@/lib/recipe-math";

export const COST_READ_MIN = 6;  // AGM+ — view cost/yield
export const PRICE_WRITE_MIN = 6; // AGM+ — record a SKU price (operational invoice logging)

export class AdminCostError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCostError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminCostError(403, "forbidden", "Insufficient role level for this action");
  }
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Current pack price per SKU = latest vendor_price_history row (effective_date desc, recorded_at desc). */
export async function loadCurrentSkuPrices(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_price_history")
    .select("vendor_item_id, unit_price, effective_date, recorded_at")
    .in("vendor_item_id", skuIds)
    .order("effective_date", { ascending: false })
    .order("recorded_at", { ascending: false })
    .returns<Array<{ vendor_item_id: string; unit_price: number | string; effective_date: string; recorded_at: string | null }>>();
  if (error) throw new Error(`loadCurrentSkuPrices failed: ${error.message}`);
  for (const r of data ?? []) {
    if (!out.has(r.vendor_item_id)) {
      const p = num(r.unit_price);
      if (p != null) out.set(r.vendor_item_id, p);
    }
  }
  return out;
}

/** Recent prices for one SKU (for the panel's history list). */
export async function loadSkuPriceHistory(actor: AuthContext, skuId: string, limit = 5): Promise<Array<{ unitPrice: number; effectiveDate: string }>> {
  requireLevel(actor, COST_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_price_history")
    .select("unit_price, effective_date")
    .eq("vendor_item_id", skuId)
    .order("effective_date", { ascending: false })
    .limit(limit)
    .returns<Array<{ unit_price: number | string; effective_date: string }>>();
  if (error) throw new Error(`loadSkuPriceHistory failed: ${error.message}`);
  return (data ?? []).map((r) => ({ unitPrice: num(r.unit_price) ?? 0, effectiveDate: r.effective_date }));
}

/** cost/oz per SKU = current price ÷ content_oz (content_oz from SkuView inputs + measures). */
export function computeSkuCostPerOz(
  skus: Array<{ id: string; unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null }>,
  prices: Map<string, number>,
  measures: MeasureUnitOption[],
): Map<string, number | null> {
  const m = new Map<string, MeasureUnitFactor>(measures.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]));
  const out = new Map<string, number | null>();
  for (const s of skus) {
    const content = skuContentOz({ unitsPerPack: s.unitsPerPack, eachSize: s.eachSize, eachMeasure: s.eachMeasure, avgOzPerEach: s.avgOzPerEach }, m);
    out.set(s.id, skuCostPerOz(prices.get(s.id) ?? null, content));
  }
  return out;
}

/**
 * Annotate components with perUnitCost + packYield, and compute per-item cost.
 * Memoized + visited-set guarded recursion over sub-items. Mutates copies — returns
 * new ComponentView[] (with optional cost fields filled) + per-item cost map.
 */
export function annotateComponentCosts(args: {
  components: ComponentView[];
  items: Array<{ itemId: string; batchYield: number; menuPrice: number | null }>;
  skus: Array<{ id: string; unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null; contentOz?: number | null }>;
  skuCostPerOzById: Map<string, number | null>;
  skuContentOzById: Map<string, number | null>;
  skuAvgOzById: Map<string, number | null>;
  measures: MeasureUnitOption[];
}): { components: ComponentView[]; itemCosts: Map<string, { perUnitCost: number | null; foodCostPct: number | null }> } {
  const m = new Map<string, MeasureUnitFactor>(args.measures.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]));
  const byItem = new Map<string, ComponentView[]>();
  for (const c of args.components) {
    const list = byItem.get(c.itemId) ?? [];
    list.push(c);
    byItem.set(c.itemId, list);
  }
  const itemMeta = new Map(args.items.map((i) => [i.itemId, i]));
  const memo = new Map<string, number | null>();
  const visiting = new Set<string>();

  const perUnitCostOf = (itemId: string): number | null => {
    if (memo.has(itemId)) return memo.get(itemId)!;
    if (visiting.has(itemId)) return null; // defensive cycle guard
    visiting.add(itemId);
    const meta = itemMeta.get(itemId);
    const comps = byItem.get(itemId) ?? [];
    const cost = meta == null ? null : itemPerUnitCost(
      meta.batchYield,
      comps.map((c) => ({ quantity: c.quantity, unit: c.unit, componentSkuId: c.componentSkuId, componentItemId: c.componentItemId, skuAvgOzPerEach: c.componentSkuId ? (args.skuAvgOzById.get(c.componentSkuId) ?? null) : null })),
      m,
      args.skuCostPerOzById,
      perUnitCostOf,
    );
    visiting.delete(itemId);
    memo.set(itemId, cost);
    return cost;
  };

  // Per-item costs.
  const itemCosts = new Map<string, { perUnitCost: number | null; foodCostPct: number | null }>();
  for (const i of args.items) {
    const c = perUnitCostOf(i.itemId);
    itemCosts.set(i.itemId, { perUnitCost: c, foodCostPct: foodCostPct(c, i.menuPrice) });
  }

  // Per-component cost + yield (SKU components only; sub-item yield omitted in R2).
  const annotated = args.components.map((c) => {
    if (c.componentSkuId == null) return { ...c, perUnitCost: null, packYield: null };
    const batchYield = itemMeta.get(c.itemId)?.batchYield ?? 1;
    const costPerOz = args.skuCostPerOzById.get(c.componentSkuId) ?? null;
    const perUnitOz = componentPerUnitOz({ quantity: c.quantity, unit: c.unit, batchYield, skuAvgOzPerEach: args.skuAvgOzById.get(c.componentSkuId) ?? null }, m);
    const perUnitCost = costPerOz == null || perUnitOz == null ? null : perUnitOz * costPerOz;
    const packYield = packYieldForComponent(args.skuContentOzById.get(c.componentSkuId) ?? null, perUnitOz);
    return { ...c, perUnitCost, packYield };
  });

  return { components: annotated, itemCosts };
}

/** Transitive reverse: every item that uses `skuId` directly or through a sub-item. Names only. */
export async function loadSkuUsageMap(): Promise<Map<string, string[]>> {
  const sb = getServiceRoleClient();
  const { data: edges, error } = await sb
    .from("item_components")
    .select("item_id, component_sku_id, component_item_id")
    .returns<Array<{ item_id: string; component_sku_id: string | null; component_item_id: string | null }>>();
  if (error) throw new Error(`loadSkuUsageMap edges failed: ${error.message}`);
  // parentsOfItem: childItemId -> [parentItemId]; skuDirect: skuId -> [parentItemId]
  const parentsOfItem = new Map<string, string[]>();
  const skuDirect = new Map<string, Set<string>>();
  for (const e of edges ?? []) {
    if (e.component_item_id) {
      const list = parentsOfItem.get(e.component_item_id) ?? [];
      list.push(e.item_id);
      parentsOfItem.set(e.component_item_id, list);
    }
    if (e.component_sku_id) {
      const set = skuDirect.get(e.component_sku_id) ?? new Set<string>();
      set.add(e.item_id);
      skuDirect.set(e.component_sku_id, set);
    }
  }
  // For each sku, BFS upward from its direct parent items collecting all ancestors.
  const itemIdsToNames = new Map<string, string>();
  const allItemIds = new Set<string>();
  for (const set of skuDirect.values()) for (const id of set) allItemIds.add(id);
  for (const list of parentsOfItem.values()) for (const id of list) allItemIds.add(id);
  for (const k of parentsOfItem.keys()) allItemIds.add(k);
  if (allItemIds.size > 0) {
    const { data: items, error: iErr } = await sb.from("items").select("id, name").in("id", [...allItemIds]).returns<Array<{ id: string; name: string }>>();
    if (iErr) throw new Error(`loadSkuUsageMap names failed: ${iErr.message}`);
    for (const it of items ?? []) itemIdsToNames.set(it.id, it.name);
  }
  const out = new Map<string, string[]>();
  for (const [skuId, directParents] of skuDirect) {
    const reached = new Set<string>();
    const queue = [...directParents];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reached.has(cur)) continue;
      reached.add(cur);
      for (const p of parentsOfItem.get(cur) ?? []) queue.push(p);
    }
    out.set(skuId, [...reached].map((id) => itemIdsToNames.get(id) ?? "(item)").sort());
  }
  return out;
}

/** Record a SKU price into the append-only ledger (AGM+). */
export async function recordSkuPrice(
  actor: AuthContext,
  args: { skuId: string; unitPrice: number; effectiveDate: string },
): Promise<{ id: string }> {
  requireLevel(actor, PRICE_WRITE_MIN);
  if (!Number.isFinite(args.unitPrice) || args.unitPrice <= 0) {
    throw new AdminCostError(400, "invalid_price", "Price must be a positive number");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveDate) || Number.isNaN(Date.parse(args.effectiveDate))) {
    throw new AdminCostError(400, "invalid_date", "Effective date must be YYYY-MM-DD");
  }
  const sb = getServiceRoleClient();
  const { data: sku, error: sErr } = await sb.from("vendor_items").select("id").eq("id", args.skuId).eq("active", true).maybeSingle<{ id: string }>();
  if (sErr) throw new Error(`recordSkuPrice sku check failed: ${sErr.message}`);
  if (!sku) throw new AdminCostError(400, "invalid_sku", "SKU not found or inactive");

  const { data: inserted, error } = await sb
    .from("vendor_price_history")
    .insert({ vendor_item_id: args.skuId, unit_price: args.unitPrice, effective_date: args.effectiveDate, recorded_by: actor.user.id })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordSkuPrice insert failed: ${error.message}`);
  if (!inserted) throw new Error("recordSkuPrice returned no row");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: inserted.id,
    metadata: { vendor_item_id: args.skuId, unit_price: args.unitPrice, effective_date: args.effectiveDate },
    ipAddress: null, userAgent: null,
  });
  return { id: inserted.id };
}
```

- [ ] **Step 3: Add the optional cost fields to `ComponentView`** in `lib/admin/item-components.ts` (after `displayOrder`):
```ts
  /** R2 cost annotation (filled by lib/admin/cost.ts annotateComponentCosts; absent on the raw load). */
  perUnitCost?: number | null;
  packYield?: number | null;
```

- [ ] **Step 4: `npx tsc --noEmit`** — clean.

- [ ] **Step 5: Commit**
```bash
git add lib/admin/cost.ts lib/admin/item-components.ts
git commit -m "feat(R2): cost data layer (prices, item cost, transitive reverse, record price)"
```

---

## Task 4: Price route `POST /api/admin/skus/[id]/price`

**Files:** Create `app/api/admin/skus/[id]/price/route.ts`

- [ ] **Step 1: Re-read** `app/api/admin/skus/[id]/route.ts` (gating/style to mirror) + `lib/api-helpers.ts` exports.

- [ ] **Step 2: Create the route** (AGM+ ≥6, Tier A):
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordSkuPrice, AdminCostError } from "@/lib/admin/cost";

// Record a SKU purchase price (append-only). AGM+ (≥6), Tier A.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/skus/${id}/price`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
  if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });

  try {
    const res = await recordSkuPrice(ctx, { skuId: id, unitPrice: b.unitPrice, effectiveDate: b.effectiveDate });
    return jsonOk({ id: res.id }, 201);
  } catch (e) {
    if (e instanceof AdminCostError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: `npx tsc --noEmit`** — clean. **Step 4: Commit**
```bash
git add "app/api/admin/skus/[id]/price/route.ts"
git commit -m "feat(R2): record-SKU-price route (AGM+)"
```

---

## Task 5: `menu_price` on the item (type + registry lib + route)

**Files:** Modify `lib/types.ts`, `lib/admin/templates.ts`, `app/api/admin/checklist-templates/registry/[itemId]/route.ts`

- [ ] **Step 1: Re-read** the `Item` interface in `lib/types.ts`; `ChecklistRegistryItem` + the registry select/map in `loadChecklistAdminView` + `updateRegistryItemDefinition` in `lib/admin/templates.ts`; the registry `[itemId]` route.

- [ ] **Step 2: `lib/types.ts`** — in `interface Item`, after `ozPerParUnit`, add:
```ts
  /** Hand-entered sell/menu price (migration 0099); drives food-cost % in R2. */
  menuPrice: number | null;
```

- [ ] **Step 3: `lib/admin/templates.ts` — `ChecklistRegistryItem`** add after `ozPerParUnit`:
```ts
  /** Sell price (migration 0099) for food-cost % (R2). */
  menuPrice: number | null;
```

- [ ] **Step 4: `loadChecklistAdminView` registry query** — append `, menu_price` to the `.select(...)`; add `menu_price: number | string | null` to the `.returns<...>()` row type; in the map add:
```ts
    menuPrice: r.menu_price == null ? null : Number(r.menu_price),
```

- [ ] **Step 5: `updateRegistryItemDefinition`** (item-only field, NOT propagated to lines):
  (a) args type += `menuPrice?: number | null;`
  (b) validation (near the others):
```ts
  if (args.menuPrice !== undefined && args.menuPrice !== null && (!Number.isFinite(args.menuPrice) || args.menuPrice <= 0)) {
    throw new AdminTemplateError(400, "invalid_menu_price", "Menu price must be a positive number or empty");
  }
```
  (c) append `, menu_price` to the item read `.select(...)` + `menu_price: number | string | null;` to its maybeSingle type.
  (d) after the `ozPerParUnit` diff block:
```ts
  if (args.menuPrice !== undefined) {
    const prev = item.menu_price == null ? null : Number(item.menu_price);
    if (args.menuPrice !== prev) { update.menu_price = args.menuPrice; before.menu_price = prev; after.menu_price = args.menuPrice; }
  }
```

- [ ] **Step 6: registry `[itemId]` route** — add `menuPrice?: number | null;` to the patch type + narrowing:
```ts
  if (b.menuPrice === null || typeof b.menuPrice === "number") patch.menuPrice = b.menuPrice as number | null;
```

- [ ] **Step 7: Confirm `promoteItemToGlobal` carries `menu_price`** — read it: it does `update({ location_id: null, ... })` in place on the same row, so `menu_price` is preserved automatically. Add a one-line comment there noting menu_price (and all item columns) ride the in-place flip. (No logic change.)

- [ ] **Step 8: `npx tsc --noEmit`** — clean. **Step 9: Commit**
```bash
git add lib/types.ts lib/admin/templates.ts "app/api/admin/checklist-templates/registry/[itemId]/route.ts"
git commit -m "feat(R2): items.menu_price — type, registry lib, route passthrough"
```

---

## Task 6: Annotate cost onto the admin view

**Files:** Modify `lib/admin/templates.ts` (`ChecklistAdminView` + `loadChecklistAdminView`)

- [ ] **Step 1: Re-read** `loadChecklistAdminView` end (where it builds `itemComponents`, `skuOptions`, `measureUnits`) + the `ChecklistAdminView` interface.

- [ ] **Step 2: `ChecklistAdminView`** add:
```ts
  /** Per-item derived cost (R2) — keyed by itemId. */
  itemCosts: Record<string, { perUnitCost: number | null; foodCostPct: number | null }>;
```

- [ ] **Step 3: In `loadChecklistAdminView`,** after `itemComponents` + the SKU options + measureUnits are loaded, compute cost. Load the SKU rows with pack inputs (the view already loads SKUs for options — extend that load to include `units_per_pack, each_size, each_measure, avg_oz_per_each`), load current prices, then annotate. Add imports at top: `import { loadCurrentSkuPrices, computeSkuCostPerOz, annotateComponentCosts } from "@/lib/admin/cost";`. Then:
```ts
  // ── R2 cost annotation ──
  const skuIdsInBom = [...new Set(itemComponents.map((c) => c.componentSkuId).filter((v): v is string => v !== null))];
  const { data: skuRows } = await sb
    .from("vendor_items")
    .select("id, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIdsInBom.length ? skuIdsInBom : ["00000000-0000-0000-0000-000000000000"])
    .returns<Array<{ id: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const skuInputs = (skuRows ?? []).map((s) => ({ id: s.id, unitsPerPack: s.units_per_pack, eachSize: s.each_size == null ? null : Number(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: s.avg_oz_per_each == null ? null : Number(s.avg_oz_per_each) }));
  const prices = await loadCurrentSkuPrices(skuIdsInBom);
  const costPerOzById = computeSkuCostPerOz(skuInputs, prices, measureUnitsFull);
  const contentOzById = new Map(skuInputs.map((s) => [s.id, (function () { return null as number | null; })()])); // replaced below
  // content_oz per sku for yield:
  const measuresMap = new Map(measureUnitsFull.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]));
  for (const s of skuInputs) contentOzById.set(s.id, (await import("@/lib/recipe-math")).skuContentOz({ unitsPerPack: s.unitsPerPack, eachSize: s.eachSize, eachMeasure: s.eachMeasure, avgOzPerEach: s.avgOzPerEach }, measuresMap));
  const avgOzById = new Map(skuInputs.map((s) => [s.id, s.avgOzPerEach]));
  const { components: annotatedComponents, itemCosts: itemCostsMap } = annotateComponentCosts({
    components: itemComponents,
    items: registry.map((r) => ({ itemId: r.itemId, batchYield: r.batchYield, menuPrice: r.menuPrice })),
    skus: skuInputs, skuCostPerOzById: costPerOzById, skuContentOzById: contentOzById, skuAvgOzById: avgOzById, measures: measureUnitsFull,
  });
  const itemCosts = Object.fromEntries(itemCostsMap);
```
> NOTE: `measureUnitsFull` = the `MeasureUnitOption[]` from `loadMeasureUnits` (the view already calls it for `measureUnits`; if it currently maps to `{id,label}` only, keep the full objects in a local `measureUnitsFull` and derive the `{id,label}` for the existing `measureUnits` field). Replace the awkward `await import` by adding `skuContentOz` to the top `@/lib/recipe-math` import and computing `contentOzById` with a plain loop (no dynamic import). Final return: set `itemComponents: annotatedComponents` and add `itemCosts`.

- [ ] **Step 4: Clean up** — ensure `skuContentOz` is a static import (not dynamic), `contentOzById` built with a simple loop, and the returned object uses `annotatedComponents` + `itemCosts`. Run `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**
```bash
git add lib/admin/templates.ts
git commit -m "feat(R2): annotate per-item cost + per-component cost/yield on the admin view"
```

---

## Task 7: MadeFromEditor — cost + yield display

**Files:** Modify `components/admin/templates/MadeFromEditor.tsx`, `components/admin/templates/GlobalRegistryTab.tsx`

- [ ] **Step 1: Re-read** both (the props `MadeFromEditor` takes + where `GlobalRegistryTab` renders it + has `itemCosts`).

- [ ] **Step 2: GlobalRegistryTab** — `ChecklistAdminView` now carries `itemCosts`; thread it: the tab receives `itemComponents` (now cost-annotated) + needs `itemCosts`. Add an `itemCosts` prop to `GlobalRegistryTab` (from the page) and pass the per-item cost to `MadeFromEditor`: add prop `cost={itemCosts[item.itemId] ?? null}` on the `<MadeFromEditor>` render. (Wire `itemCosts` from the page that renders `GlobalRegistryTab` — it already passes `view.*`; add `itemCosts={view.itemCosts}`.)

- [ ] **Step 3: MadeFromEditor** — add prop:
```ts
  cost: { perUnitCost: number | null; foodCostPct: number | null } | null;
```
Under the batch-yield note, add an item-cost summary line:
```tsx
<p className="mt-1 text-xs text-co-text-muted">
  {t("admin.items.made_from.unit_cost")}: {cost?.perUnitCost == null ? "—" : `$${cost.perUnitCost.toFixed(2)}`}
  {cost?.foodCostPct != null ? ` · ${t("admin.items.made_from.food_cost")}: ${Math.round(cost.foodCostPct * 100)}%` : ""}
</p>
```
In `MadeFromRow`, below the per-unit line, add the SKU-component cost + yield (the component now carries `perUnitCost`/`packYield`):
```tsx
{component.kind === "sku" && (component.perUnitCost != null || component.packYield != null) ? (
  <p className="text-xs text-co-text-muted">
    {component.perUnitCost != null ? `${t("admin.items.made_from.cost")}: $${component.perUnitCost.toFixed(2)}` : ""}
    {component.packYield != null ? ` · ${t("admin.items.made_from.yield")}: ${t("admin.items.made_from.case_makes", { n: String(Math.round(component.packYield)) })}` : ""}
  </p>
) : null}
```

- [ ] **Step 4: `npx tsc --noEmit`** — clean (i18n keys land Task 10). **Step 5: Commit**
```bash
git add components/admin/templates/MadeFromEditor.tsx components/admin/templates/GlobalRegistryTab.tsx
git commit -m "feat(R2): MadeFromEditor per-unit cost + food-cost % + case→N yield"
```

---

## Task 8: Global-tab `menu_price` input

**Files:** Modify `components/admin/templates/GlobalRegistryTab.tsx`

- [ ] **Step 1: Re-read** `RegistryRow` (the R1 state block + the definition `<section>` + `saveDefinition`).

- [ ] **Step 2: State** — after `ozPerParUnit` state:
```ts
const [menuPrice, setMenuPrice] = useState(item.menuPrice != null ? String(item.menuPrice) : "");
```

- [ ] **Step 3: Input** — after the `oz_per_par_unit` `<Labeled>` block:
```tsx
<Labeled label={t("admin.templates.field.menu_price")}>
  <input className={field} type="number" min={0} step="any" inputMode="decimal" value={menuPrice} onChange={(e) => setMenuPrice(e.target.value)} />
  <span className="mt-1 block text-xs text-co-text-muted">{t("admin.templates.menu_price_hint")}</span>
</Labeled>
```

- [ ] **Step 4: `saveDefinition` payload** — add:
```ts
menuPrice: menuPrice.trim() === "" ? null : Number(menuPrice),
```

- [ ] **Step 5: `npx tsc --noEmit`** — clean. **Step 6: Commit**
```bash
git add components/admin/templates/GlobalRegistryTab.tsx
git commit -m "feat(R2): menu_price input on the Global-tab item panel"
```

---

## Task 9: SKU page — cost/oz + record-price + used-by (`SkuCostPanel`)

**Files:** Create `components/admin/skus/SkuCostPanel.tsx`; Modify `components/admin/skus/SkuCatalogClient.tsx`, `components/admin/skus/VendorSkusCard.tsx`, `app/admin/skus/page.tsx`, `app/admin/vendors/[id]/page.tsx`

- [ ] **Step 1: Re-read** `SkuCatalogClient.tsx` (CatalogRow), `VendorSkusCard.tsx`, both page loaders, `components/admin/skus/shared.ts` (postJson/resolveErrorKey), and `app/admin/skus/page.tsx` to see how `measureUnits`/`skus` are loaded.

- [ ] **Step 2: Page loaders** — in `app/admin/skus/page.tsx` and `app/admin/vendors/[id]/page.tsx`, after loading `skus` + `measureUnits`, compute cost + usage and pass down:
```ts
import { loadCurrentSkuPrices, computeSkuCostPerOz, loadSkuUsageMap } from "@/lib/admin/cost";
// ...after skus + measureUnits are loaded:
const prices = await loadCurrentSkuPrices(skus.map((s) => s.id));
const costPerOz = computeSkuCostPerOz(skus, prices, measureUnits);
const usage = await loadSkuUsageMap();
const skuCost: Record<string, { currentPrice: number | null; costPerOz: number | null; usedBy: string[] }> =
  Object.fromEntries(skus.map((s) => [s.id, { currentPrice: prices.get(s.id) ?? null, costPerOz: costPerOz.get(s.id) ?? null, usedBy: usage.get(s.id) ?? [] }]));
```
Pass `skuCost={skuCost}` into `SkuCatalogClient` / `VendorSkusCard`.

- [ ] **Step 3: Create `components/admin/skus/SkuCostPanel.tsx`** (client):
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "./shared";

export interface SkuCostInfo { currentPrice: number | null; costPerOz: number | null; usedBy: string[]; }

export function SkuCostPanel({ skuId, cost, canRecord }: { skuId: string; cost: SkuCostInfo; canRecord: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const record = async () => {
    if (busy) return;
    setErr(null);
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) { setErr(t(resolveErrorKey("invalid_price"))); return; }
    if (!date) { setErr(t(resolveErrorKey("invalid_date"))); return; }
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const res = await postJson(`/api/admin/skus/${skuId}/price`, { unitPrice: p, effectiveDate: date }, "POST");
    setBusy(false);
    if (res.ok) { setPrice(""); setDate(""); setOpen(false); router.refresh(); }
    else setErr(t(resolveErrorKey(res.code)));
  };

  const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  return (
    <div className="mt-2 rounded-lg border-2 border-co-border bg-co-surface p-3 text-sm">
      <p className="text-co-text">
        {t("admin.skus.cost.per_oz")}: <span className="font-bold">{cost.costPerOz == null ? "—" : `$${cost.costPerOz.toFixed(4)}/oz`}</span>
        {cost.currentPrice != null ? <span className="text-co-text-muted"> · {t("admin.skus.cost.current")}: ${cost.currentPrice.toFixed(2)}</span> : null}
      </p>
      {cost.usedBy.length > 0 ? (
        <p className="mt-1 text-xs text-co-text-muted">{t("admin.skus.cost.used_by")}: {cost.usedBy.join(", ")}</p>
      ) : null}
      {canRecord ? (
        open ? (
          <div className="mt-2 flex flex-col gap-2">
            <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("admin.skus.cost.price_placeholder")} value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} />
            <input className={field} type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
            {err ? <p className="text-sm text-co-cta">{err}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => { setOpen(false); setErr(null); }} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50">{t("admin.skus.cancel")}</button>
              <button type="button" disabled={busy} onClick={() => void record()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.skus.cost.record")}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("admin.skus.cost.record")}</button>
        )
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `SkuCatalogClient`** — add prop `skuCost: Record<string, SkuCostInfo>` (import the type from `./SkuCostPanel`); render `<SkuCostPanel skuId={s.id} cost={skuCost[s.id] ?? {currentPrice:null,costPerOz:null,usedBy:[]}} canRecord={actorLevel >= 6} />` inside each non-editing `CatalogRow` (below the row content). Pass `skuCost` from the page.

- [ ] **Step 5: Wire into `VendorSkusCard`** — same: accept `skuCost` prop, render `SkuCostPanel` per SKU row. (Re-read the card to match its row structure.)

- [ ] **Step 6: `npx tsc --noEmit` + `npm run build`** — clean. **Step 7: Commit**
```bash
git add components/admin/skus/SkuCostPanel.tsx components/admin/skus/SkuCatalogClient.tsx components/admin/skus/VendorSkusCard.tsx app/admin/skus/page.tsx "app/admin/vendors/[id]/page.tsx"
git commit -m "feat(R2): SKU cost/oz + record-price + transitive used-by panel"
```

---

## Task 10: i18n (EN + ES parity)

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`; possibly `components/admin/skus/shared.ts` + `components/admin/templates/shared.ts` (error codes)

- [ ] **Step 1: Add the new error codes to the resolvers** — `components/admin/skus/shared.ts` `KNOWN_ERROR_CODES` += `"invalid_price"`, `"invalid_date"`, `"invalid_sku"`; `components/admin/templates/shared.ts` `KNOWN` += `"invalid_menu_price"`.

- [ ] **Step 2: EN keys** (`lib/i18n/en.json`):
```json
"admin.templates.field.menu_price": "Menu / sell price",
"admin.templates.menu_price_hint": "What you sell one of these for — drives food-cost %. Leave blank if not sold directly.",
"admin.templates.error.invalid_menu_price": "Menu price must be a positive number or empty.",
"admin.items.made_from.unit_cost": "Cost per unit",
"admin.items.made_from.food_cost": "Food cost",
"admin.items.made_from.cost": "Cost",
"admin.items.made_from.yield": "Yield",
"admin.items.made_from.case_makes": "1 pack → ≈ {n}",
"admin.skus.cost.per_oz": "Cost",
"admin.skus.cost.current": "Current",
"admin.skus.cost.used_by": "Used by",
"admin.skus.cost.record": "Record price",
"admin.skus.cost.price_placeholder": "Price per pack ($)",
"admin.skus.error.invalid_price": "Price must be a positive number.",
"admin.skus.error.invalid_date": "Pick a valid effective date.",
"admin.skus.error.invalid_sku": "SKU not found or inactive."
```

- [ ] **Step 3: ES keys** (`lib/i18n/es.json`, tú-form):
```json
"admin.templates.field.menu_price": "Precio de venta / menú",
"admin.templates.menu_price_hint": "A cuánto vendes uno — calcula el % de costo de alimento. Déjalo vacío si no se vende directo.",
"admin.templates.error.invalid_menu_price": "El precio de menú debe ser un número positivo o vacío.",
"admin.items.made_from.unit_cost": "Costo por unidad",
"admin.items.made_from.food_cost": "Costo de alimento",
"admin.items.made_from.cost": "Costo",
"admin.items.made_from.yield": "Rendimiento",
"admin.items.made_from.case_makes": "1 paquete → ≈ {n}",
"admin.skus.cost.per_oz": "Costo",
"admin.skus.cost.current": "Actual",
"admin.skus.cost.used_by": "Usado por",
"admin.skus.cost.record": "Registrar precio",
"admin.skus.cost.price_placeholder": "Precio por paquete ($)",
"admin.skus.error.invalid_price": "El precio debe ser un número positivo.",
"admin.skus.error.invalid_date": "Elige una fecha válida.",
"admin.skus.error.invalid_sku": "SKU no encontrado o inactivo."
```

- [ ] **Step 4: Parity + build**
```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=new Set(Object.keys(es));const m=a.filter(k=>!b.has(k));const r=Object.keys(es).filter(k=>!new Set(a).has(k));console.log(m.length||r.length?('MISS ES:'+m.join(',')+'|EXTRA ES:'+r.join(',')):'parity ok '+a.length)"
npx tsc --noEmit && npm run build
```
Expected: `parity ok …`; tsc + build clean.

- [ ] **Step 5: Commit**
```bash
git add lib/i18n/en.json lib/i18n/es.json components/admin/skus/shared.ts components/admin/templates/shared.ts
git commit -m "feat(R2): i18n EN+ES + error codes for cost/yield"
```

---

## Task 11: Live smoke, then delete

**Files:** `scripts/_smoke_recipe_cost.ts` (extend → delete)

- [ ] **Step 1: Extend** the smoke with a live section in an async IIFE (top-level await fails under tsx cjs):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadCurrentSkuPrices, loadSkuUsageMap } from "@/lib/admin/cost";
void (async () => {
  const sb = getServiceRoleClient();
  const { data: comp } = await sb.from("item_components").select("item_id, component_sku_id").limit(1).maybeSingle<{ item_id: string; component_sku_id: string | null }>();
  console.log("sample component:", comp);
  if (comp?.component_sku_id) {
    const prices = await loadCurrentSkuPrices([comp.component_sku_id]);
    console.log(`price for sku ${comp.component_sku_id}:`, prices.get(comp.component_sku_id) ?? "(none yet)");
  }
  const usage = await loadSkuUsageMap();
  console.log(`usage map size: ${usage.size}`);
})();
```

- [ ] **Step 2: Run** `npx tsx --env-file=.env.local scripts/_smoke_recipe_cost.ts` — pure asserts PASS; live section prints without throwing.

- [ ] **Step 3: Delete + commit**
```bash
git rm -f scripts/_smoke_recipe_cost.ts
git commit -m "chore(R2): remove throwaway cost smoke"
```

---

## Task 12: PR

- [ ] **Step 1: Final gate** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 2: Push + PR** (preview URL in the body; smoke = operator paths identical, then record a SKU price → cost/oz appears; set a menu_price + open Made-from → per-unit cost, food-cost %, case→N yield; check used-by):
```bash
git push -u origin claude/r2-cost-yield
gh pr create --title "R2: cost & yield + converts-into" --body "$(cat <<'EOF'
Cost & yield (spec 2026-06-30). Migration 0099 (items.menu_price, additive). Pure
recipe-math cost fns + lib/admin/cost.ts (prices, memoized recursive item cost,
transitive reverse, record-price AGM+). Surfaces: SKU cost/oz + record-price + used-by;
MadeFromEditor per-unit cost + food-cost % + case→N yield; Global-tab menu_price.
NO operator-flow change. Cost shows "—" until prices/content_oz/menu_price exist.

Test (preview URL): operator AM-prep/mid-day/Opening identical; record a SKU price →
cost/oz; set an item's menu_price + open "Made from" → per-unit cost, food-cost %, yield;
"used by" lists items transitively.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
- [ ] **Step 3: After Juan smokes + merges** — no post-deploy migration needed (0099 is fully additive). Done.

---

## Self-Review

**Spec coverage:** §3 schema → Task 1; §4a pure cost → Task 2; §4b/§4c cost.ts loaders + reverse + record → Tasks 3/4; §5 SKU surface → Task 9, MadeFromEditor → Task 7, Global-tab menu_price → Tasks 5/8; menu_price type/lib/route → Task 5; cost on view → Task 6; §6 verification → Tasks 2/10/11; i18n → Task 10. ✔

**Deviations (flagged, T0-discretion):** (1) reverse lookup returns item **names only** — the "via <sub-item>" path hint from spec §4b is deferred (simpler BFS, marginal value). (2) per-component yield is shown for **SKU components only** (sub-item yield omitted in R2). (3) cost annotated as **optional fields on `ComponentView`** (avoids a type-ripple) rather than a parallel map. (4) `menu_price` authority = MoO+ via the definition panel (per spec §8 flag; unchanged).

**Placeholder scan:** none — all code literal. (Task 6 Step 3 explicitly says to replace the dynamic `import()` with a static `skuContentOz` import + plain loop in Step 4; the implementer must not ship the dynamic-import sketch.)

**Type consistency:** `skuCostPerOz`/`componentPerUnitCost`/`itemPerUnitCost`/`foodCostPct` (recipe-math) ↔ cost.ts callers ↔ `ComponentView.perUnitCost?/packYield?` ↔ `ChecklistAdminView.itemCosts` ↔ MadeFromEditor `cost` prop ↔ `SkuCostInfo` (page → SkuCatalogClient/VendorSkusCard → SkuCostPanel). `menuPrice` consistent across `Item`/`ChecklistRegistryItem`/`updateRegistryItemDefinition`/route. ✔
