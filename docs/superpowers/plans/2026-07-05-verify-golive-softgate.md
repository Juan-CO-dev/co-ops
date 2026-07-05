# Verify → Go-Live Soft-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purely computed readiness badges ("Not ready" red / "Upstream gaps" amber / no badge when ready) + reasons across SKU catalog, vendor SKU cards, recipes list+builder, items Global tab, and admin-hub count pills. NO migration, NO write routes.

**Architecture:** Pure rule functions in a new client-safe `lib/readiness.ts` (single source of truth); server composition in a new `lib/admin/readiness-load.ts` reusing existing loaders; one shared `components/admin/StatusBadge.tsx`; per-page wiring. Spec: `docs/superpowers/specs/2026-07-05-verify-golive-softgate-design.md`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict + `noUncheckedIndexedAccess`, Supabase service-role loaders, Tailwind v4 tokens, i18n EN+ES via `lib/i18n/{en,es}.json`.

**Conventions (repo-wide, apply to every task):**
- No test framework exists — pure-rule verification is `scripts/readiness-rules-check.ts` run via `npx tsx` (no env needed). Gates per task: `npm run typecheck`; final task adds `npm run build`.
- PostgREST returns numerics as strings — coerce with a local `num()` helper (copy the pattern from `lib/admin/cost.ts:39-42`).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: all tasks commit to `claude/softgate-badges` (created in Task 0). Code merges via PR + CI, never direct push.
- Every task re-reads its target files before editing (confirm-before-authoring). Anchors below were verified 2026-07-05 at `753acf3`.

---

### Task 0: Branch setup

**Files:** none

- [ ] **Step 1:** From `C:\Users\conta\co-ops`, run:
```bash
git fetch origin main && git checkout -b claude/softgate-badges origin/main
```
Expected: new branch at `753acf3` or later.

---

### Task 1: Pure readiness rules + assertion script

**Files:**
- Create: `lib/readiness.ts`
- Create: `scripts/readiness-rules-check.ts`

- [ ] **Step 1: Write the assertion script FIRST (it will fail to import until Step 3)**

```ts
// scripts/readiness-rules-check.ts
// Pure-rule checks for lib/readiness.ts. No env, no network.
// Run: npx tsx scripts/readiness-rules-check.ts   (exit 0 = all pass)
import {
  skuPackComplete, skuReadiness, recipeOwnReadiness,
  composeRecipeReadiness, itemReadiness, KNOWN_REASONS,
} from "../lib/readiness";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures += 1; console.error(`FAIL ${name}`); }
  else console.log(`ok   ${name}`);
}

// ── SKU ──
check("pack complete", skuPackComplete({ unitsPerPack: 6, eachSize: 32, eachMeasure: "oz" }));
check("pack incomplete: no measure", !skuPackComplete({ unitsPerPack: 6, eachSize: 32, eachMeasure: null }));
check("pack incomplete: zero size", !skuPackComplete({ unitsPerPack: 6, eachSize: 0, eachMeasure: "oz" }));

const readySku = skuReadiness({ active: true, packComplete: true, hasPrice: true, deliveryCount: 3 });
check("sku ready", readySku !== null && readySku.status === "ready" && readySku.reasons.length === 0);
const gapSku = skuReadiness({ active: true, packComplete: false, hasPrice: false, deliveryCount: 0 });
check("sku all gaps", gapSku !== null && gapSku.status === "incomplete"
  && gapSku.reasons.map((r) => r.code).join(",") === "missing_pack,missing_price,no_delivery");
check("inactive sku → null (no badge)", skuReadiness({ active: false, packComplete: true, hasPrice: true, deliveryCount: 1 }) === null);
const noDel = skuReadiness({ active: true, packComplete: true, hasPrice: true, deliveryCount: 0 });
check("sku missing only delivery", noDel !== null && noDel.status === "incomplete"
  && noDel.reasons.length === 1 && noDel.reasons[0]?.code === "no_delivery");

// ── Recipe ──
const rOk = recipeOwnReadiness({ hasInputs: true, hasOutputs: true, batchYield: 4 });
check("recipe own ready", rOk.status === "ready");
const rBad = recipeOwnReadiness({ hasInputs: false, hasOutputs: true, batchYield: null });
check("recipe own gaps", rBad.status === "incomplete"
  && rBad.reasons.map((r) => r.code).join(",") === "no_inputs,no_batch_yield");
check("recipe zero yield is a gap", recipeOwnReadiness({ hasInputs: true, hasOutputs: true, batchYield: 0 }).status === "incomplete");

const upstream = composeRecipeReadiness(rOk, ["incomplete", "ready"], []);
check("recipe upstream amber", upstream.status === "upstream_gaps"
  && upstream.reasons[0]?.code === "not_ready_skus" && upstream.reasons[0]?.count === 1);
const redWins = composeRecipeReadiness(rBad, ["incomplete"], ["upstream_gaps"]);
check("red wins over amber", redWins.status === "incomplete");
check("red carries upstream reasons too", redWins.reasons.some((r) => r.code === "not_ready_skus")
  && redWins.reasons.some((r) => r.code === "not_ready_subitems"));
check("all ready inputs → ready", composeRecipeReadiness(rOk, ["ready"], ["ready"]).status === "ready");

// ── Item ──
const iOk = itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 32, soldDirectly: false, sellPortionComplete: true }, "ready");
check("item ready", iOk.status === "ready");
const iNoRecipe = itemReadiness({ hasProducingRecipe: false, ozPerParUnit: null, soldDirectly: true, sellPortionComplete: false }, null);
check("item all gaps", iNoRecipe.status === "incomplete"
  && iNoRecipe.reasons.map((r) => r.code).join(",") === "no_recipe,no_oz_per_par_unit,sell_incomplete");
const iUp = itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 32, soldDirectly: false, sellPortionComplete: true }, "incomplete");
check("item upstream via recipe", iUp.status === "upstream_gaps" && iUp.reasons[0]?.code === "upstream_recipe");
check("item upstream via amber recipe", itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 1, soldDirectly: false, sellPortionComplete: true }, "upstream_gaps").status === "upstream_gaps");
check("non-sold item ignores sell fields", itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 1, soldDirectly: false, sellPortionComplete: false }, "ready").status === "ready");

// ── Vocabulary closed set ──
check("KNOWN_REASONS has 12 codes", KNOWN_REASONS.length === 12);

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll readiness rule checks passed.");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/readiness-rules-check.ts`
Expected: FAIL — cannot find module `../lib/readiness`.

- [ ] **Step 3: Write `lib/readiness.ts`**

```ts
/**
 * Readiness rules (verify → go-live soft-gate, spine sub-project #2).
 * CLIENT-SAFE + PURE — no I/O, no supabase. Single source of truth for what
 * "Ready" means per entity. Server composition lives in lib/admin/readiness-load.ts.
 *
 * Vocabulary: 'ready' (no badge) | 'incomplete' (own fields missing — red)
 * | 'upstream_gaps' (own fields fine, something consumed isn't ready — amber).
 * Red wins display precedence; reasons may carry both.
 * NOTE: deliberately NOT named "verify" — items.opening_verify owns that word.
 */

export type ReadinessStatus = "ready" | "incomplete" | "upstream_gaps";

/** Closed reason vocabulary — reconcile against readiness.reason.* i18n keys
 * in BOTH en.json and es.json (interpolated keys are grep-invisible). */
export const KNOWN_REASONS = [
  "missing_pack", "missing_price", "no_delivery",
  "no_inputs", "no_outputs", "no_batch_yield",
  "not_ready_skus", "not_ready_subitems",
  "no_recipe", "no_oz_per_par_unit", "sell_incomplete", "upstream_recipe",
] as const;
export type ReasonCode = (typeof KNOWN_REASONS)[number];

export interface Reason { code: ReasonCode; count?: number }
export interface Readiness { status: ReadinessStatus; reasons: Reason[] }

const READY: Readiness = { status: "ready", reasons: [] };

/** Pack definition complete: units_per_pack + each_size + each_measure all set. */
export function skuPackComplete(s: {
  unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null;
}): boolean {
  return (s.unitsPerPack ?? 0) > 0 && (s.eachSize ?? 0) > 0 && !!s.eachMeasure;
}

/** SKU is the graph root — own signals only. Inactive → null (no badge, excluded from rollups). */
export function skuReadiness(s: {
  active: boolean; packComplete: boolean; hasPrice: boolean; deliveryCount: number;
}): Readiness | null {
  if (!s.active) return null;
  const reasons: Reason[] = [];
  if (!s.packComplete) reasons.push({ code: "missing_pack" });
  if (!s.hasPrice) reasons.push({ code: "missing_price" });
  if (s.deliveryCount < 1) reasons.push({ code: "no_delivery" });
  return reasons.length === 0 ? READY : { status: "incomplete", reasons };
}

/** Recipe OWN fields only (inputs/outputs/batch_yield). */
export function recipeOwnReadiness(r: {
  hasInputs: boolean; hasOutputs: boolean; batchYield: number | null;
}): Readiness {
  const reasons: Reason[] = [];
  if (!r.hasInputs) reasons.push({ code: "no_inputs" });
  if (!r.hasOutputs) reasons.push({ code: "no_outputs" });
  if (!((r.batchYield ?? 0) > 0)) reasons.push({ code: "no_batch_yield" });
  return reasons.length === 0 ? READY : { status: "incomplete", reasons };
}

/** Two-level compose: own red wins; else any not-ready input → amber.
 * inputSkuStatuses / inputSubItemStatuses = readiness statuses of the recipe's
 * SKU inputs and sub-item-input CHAINS respectively (sub-item chain status =
 * that item's itemReadiness status, transitively computed by the loader). */
export function composeRecipeReadiness(
  own: Readiness,
  inputSkuStatuses: ReadinessStatus[],
  inputSubItemStatuses: ReadinessStatus[],
): Readiness {
  const badSkus = inputSkuStatuses.filter((s) => s !== "ready").length;
  const badSubs = inputSubItemStatuses.filter((s) => s !== "ready").length;
  const upstreamReasons: Reason[] = [];
  if (badSkus > 0) upstreamReasons.push({ code: "not_ready_skus", count: badSkus });
  if (badSubs > 0) upstreamReasons.push({ code: "not_ready_subitems", count: badSubs });
  if (own.status === "incomplete") {
    return { status: "incomplete", reasons: [...own.reasons, ...upstreamReasons] };
  }
  if (upstreamReasons.length > 0) return { status: "upstream_gaps", reasons: upstreamReasons };
  return READY;
}

/** Item: own gaps (no producing recipe / no oz basis / sold-directly incomplete),
 * else inherits amber from its producing recipe's status. */
export function itemReadiness(
  it: {
    hasProducingRecipe: boolean; ozPerParUnit: number | null;
    soldDirectly: boolean; sellPortionComplete: boolean;
  },
  producingRecipeStatus: ReadinessStatus | null,
): Readiness {
  const reasons: Reason[] = [];
  if (!it.hasProducingRecipe) reasons.push({ code: "no_recipe" });
  if (!((it.ozPerParUnit ?? 0) > 0)) reasons.push({ code: "no_oz_per_par_unit" });
  if (it.soldDirectly && !it.sellPortionComplete) reasons.push({ code: "sell_incomplete" });
  if (reasons.length > 0) return { status: "incomplete", reasons };
  if (producingRecipeStatus !== null && producingRecipeStatus !== "ready") {
    return { status: "upstream_gaps", reasons: [{ code: "upstream_recipe" }] };
  }
  return READY;
}
```

- [ ] **Step 4: Run checks + typecheck**

Run: `npx tsx scripts/readiness-rules-check.ts` → Expected: `All readiness rule checks passed.`
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/readiness.ts scripts/readiness-rules-check.ts
git commit -m "feat(readiness): pure readiness rules + assertion script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Server composition layer (`readiness-load.ts`) + `loadRecipes` batch_yield extension

**Files:**
- Create: `lib/admin/readiness-load.ts`
- Modify: `lib/recipes.ts:32-65` (`RecipeListRow` + `loadRecipes` — add `batchYield`)

**Pre-flight (ground truth):** via Supabase MCP `execute_sql`, run
`SELECT column_name FROM information_schema.columns WHERE table_name = 'items';`
and confirm the columns used below exist: `id, active, oz_per_par_unit, sold_directly, sell_portion, sell_portion_unit, menu_price`. If `active` does not exist on `items`, drop the `.eq("active", true)` filter and the active mapping below and note it in the commit body. Also confirm `recipes` has `active, batch_yield` and `recipe_inputs/recipe_outputs` columns match `lib/recipes.ts:227-234` usage (they were verified at `753acf3`).

- [ ] **Step 1: Extend `RecipeListRow` + `loadRecipes` in `lib/recipes.ts`**

In the interface (line 32-35), add `batchYield: number | null;`:
```ts
export interface RecipeListRow {
  id: string; name: string; recipeType: RecipeType; active: boolean;
  outputNames: string[]; hasInputs: boolean; hasOutputs: boolean;
  batchYield: number | null;
}
```
In `loadRecipes` (line 57), extend the select and the row type:
```ts
let q = sb.from("recipes").select("id, name, recipe_type, active, batch_yield").eq("active", true).order("name");
```
```ts
const { data, error } = await q.returns<Array<{ id: string; name: string; recipe_type: RecipeType; active: boolean; batch_yield: number | string | null }>>();
```
And in the return map (line 64), add `batchYield: num(r.batch_yield),` (the `num` helper already exists at `lib/recipes.ts:45-48`).

- [ ] **Step 2: Create `lib/admin/readiness-load.ts`**

```ts
/**
 * Readiness server composition (soft-gate) — composes EXISTING loaders into
 * per-page readiness maps. SERVER-ONLY. Read-only; callers are pages already
 * behind their own role gates (admin layout ≥6 + per-page re-gate).
 * Rules live in lib/readiness.ts (pure). NO new schema.
 *
 * Failure posture: pages call these inside try/catch and render WITHOUT
 * badges on error — nudges must never take down a working admin page.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { loadSkus } from "@/lib/admin/skus";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import {
  skuPackComplete, skuReadiness, recipeOwnReadiness, composeRecipeReadiness,
  itemReadiness, type Readiness, type ReadinessStatus,
} from "@/lib/readiness";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Lightweight per-SKU delivery-line count (do NOT hydrate full ledgers for a count). */
export async function loadSkuDeliveryCounts(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_delivery_items")
    .select("vendor_item_id")
    .in("vendor_item_id", skuIds)
    .returns<Array<{ vendor_item_id: string }>>();
  if (error) throw new Error(`loadSkuDeliveryCounts: ${error.message}`);
  for (const r of data ?? []) out.set(r.vendor_item_id, (out.get(r.vendor_item_id) ?? 0) + 1);
  return out;
}

/** Readiness per ACTIVE SKU (inactive → absent from the map = no badge). */
export async function loadSkuReadinessMap(actor: AuthContext): Promise<Map<string, Readiness>> {
  const skus = await loadSkus(actor);
  const active = skus.filter((s) => s.active);
  const ids = active.map((s) => s.id);
  const [prices, deliveries] = await Promise.all([
    loadCurrentSkuPrices(ids), loadSkuDeliveryCounts(ids),
  ]);
  const out = new Map<string, Readiness>();
  for (const s of active) {
    const r = skuReadiness({
      active: true,
      packComplete: skuPackComplete(s),
      hasPrice: prices.has(s.id),
      deliveryCount: deliveries.get(s.id) ?? 0,
    });
    if (r) out.set(s.id, r);
  }
  return out;
}

interface GraphRows {
  recipes: Array<{ id: string; batch_yield: number | string | null }>;
  inputs: Array<{ recipe_id: string; component_sku_id: string | null; component_item_id: string | null }>;
  outputs: Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>;
  items: Array<{ id: string; oz_per_par_unit: number | string | null; sold_directly: boolean; sell_portion: number | string | null; sell_portion_unit: string | null; menu_price: number | string | null }>;
}

async function loadGraphRows(): Promise<GraphRows> {
  const sb = getServiceRoleClient();
  const [rRes, iRes, oRes, itRes] = await Promise.all([
    sb.from("recipes").select("id, batch_yield").eq("active", true)
      .returns<GraphRows["recipes"]>(),
    sb.from("recipe_inputs").select("recipe_id, component_sku_id, component_item_id")
      .returns<GraphRows["inputs"]>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id")
      .returns<GraphRows["outputs"]>(),
    sb.from("items").select("id, oz_per_par_unit, sold_directly, sell_portion, sell_portion_unit, menu_price").eq("active", true)
      .returns<GraphRows["items"]>(),
  ]);
  for (const [label, res] of [["recipes", rRes], ["recipe_inputs", iRes], ["recipe_outputs", oRes], ["items", itRes]] as const) {
    if (res.error) throw new Error(`loadGraphRows ${label}: ${res.error.message}`);
  }
  return { recipes: rRes.data ?? [], inputs: iRes.data ?? [], outputs: oRes.data ?? [], items: itRes.data ?? [] };
}

/**
 * Compute recipe + item readiness over the whole (small) graph in one pass.
 * Memoized recursion with a visiting-set cycle guard (graph is cycle-guarded
 * at write time via outputWouldCycle, but belt-and-braces here).
 */
export async function loadGraphReadiness(actor: AuthContext): Promise<{
  recipeReadiness: Map<string, Readiness>;
  itemReadiness: Map<string, Readiness>;
}> {
  const [skuStatus, g] = await Promise.all([loadSkuReadinessMap(actor), loadGraphRows()]);

  const inputsOfRecipe = new Map<string, GraphRows["inputs"]>();
  for (const i of g.inputs) {
    const l = inputsOfRecipe.get(i.recipe_id) ?? []; l.push(i); inputsOfRecipe.set(i.recipe_id, l);
  }
  const outputsOfRecipe = new Map<string, number>();
  const recipeOfItem = new Map<string, string>();
  for (const o of g.outputs) {
    outputsOfRecipe.set(o.recipe_id, (outputsOfRecipe.get(o.recipe_id) ?? 0) + 1);
    if (o.output_item_id) recipeOfItem.set(o.output_item_id, o.recipe_id);
  }
  const itemById = new Map(g.items.map((it) => [it.id, it]));

  const recipeMemo = new Map<string, Readiness>();
  const itemMemo = new Map<string, Readiness>();
  const visiting = new Set<string>(); // "r:<id>" / "i:<id>"

  function recipeStatus(recipeId: string, batchYield: number | null): Readiness {
    const memod = recipeMemo.get(recipeId);
    if (memod) return memod;
    const key = `r:${recipeId}`;
    if (visiting.has(key)) return { status: "ready", reasons: [] }; // cycle guard: don't recurse
    visiting.add(key);
    const ins = inputsOfRecipe.get(recipeId) ?? [];
    const own = recipeOwnReadiness({
      hasInputs: ins.length > 0,
      hasOutputs: (outputsOfRecipe.get(recipeId) ?? 0) > 0,
      batchYield,
    });
    const skuStatuses: ReadinessStatus[] = [];
    const subStatuses: ReadinessStatus[] = [];
    for (const i of ins) {
      if (i.component_sku_id) {
        // inactive SKU is absent from skuStatus → treat as not ready (it's out of play)
        skuStatuses.push(skuStatus.get(i.component_sku_id)?.status ?? "incomplete");
      } else if (i.component_item_id) {
        subStatuses.push(itemStatus(i.component_item_id).status);
      }
    }
    const composed = composeRecipeReadiness(own, skuStatuses, subStatuses);
    visiting.delete(key);
    recipeMemo.set(recipeId, composed);
    return composed;
  }

  function itemStatus(itemId: string): Readiness {
    const memod = itemMemo.get(itemId);
    if (memod) return memod;
    const key = `i:${itemId}`;
    if (visiting.has(key)) return { status: "ready", reasons: [] };
    visiting.add(key);
    const it = itemById.get(itemId);
    const producingRecipeId = recipeOfItem.get(itemId) ?? null;
    let producing: Readiness | null = null;
    if (producingRecipeId) {
      const rRow = g.recipes.find((r) => r.id === producingRecipeId);
      producing = rRow ? recipeStatus(producingRecipeId, num(rRow.batch_yield)) : null;
    }
    const sellPortionComplete = it
      ? (num(it.sell_portion) ?? 0) > 0 && !!it.sell_portion_unit && (num(it.menu_price) ?? 0) > 0
      : false;
    const result = itemReadiness(
      {
        hasProducingRecipe: producingRecipeId !== null,
        ozPerParUnit: it ? num(it.oz_per_par_unit) : null,
        soldDirectly: it?.sold_directly ?? false,
        sellPortionComplete,
      },
      producing?.status ?? null,
    );
    visiting.delete(key);
    itemMemo.set(itemId, result);
    return result;
  }

  const recipeReadiness = new Map<string, Readiness>();
  for (const r of g.recipes) recipeReadiness.set(r.id, recipeStatus(r.id, num(r.batch_yield)));
  const itemReadinessMap = new Map<string, Readiness>();
  for (const it of g.items) itemReadinessMap.set(it.id, itemStatus(it.id));
  return { recipeReadiness, itemReadiness: itemReadinessMap };
}

/** Hub rollups — computed ONLY for sections the viewer can see (caller filters). */
export async function countNotReady(actor: AuthContext): Promise<{
  skus: number; recipes: number; items: number;
}> {
  const [skuMap, graph] = await Promise.all([
    loadSkuReadinessMap(actor), loadGraphReadiness(actor),
  ]);
  const countBad = (m: Map<string, Readiness>) =>
    [...m.values()].filter((r) => r.status !== "ready").length;
  return {
    skus: countBad(skuMap),
    recipes: countBad(graph.recipeReadiness),
    items: countBad(graph.itemReadiness),
  };
}
```
Note: `countNotReady` calls `loadSkuReadinessMap` twice transitively (once directly, once inside `loadGraphReadiness`). Acceptable at this scale (~100 SKUs, 2 queries); do NOT prematurely optimize.

- [ ] **Step 3: Typecheck + rules check**

Run: `npm run typecheck` → clean. Run: `npx tsx scripts/readiness-rules-check.ts` → all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/admin/readiness-load.ts lib/recipes.ts
git commit -m "feat(readiness): server composition layer + loadRecipes batch_yield

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: StatusBadge component + i18n keys (EN+ES)

**Files:**
- Create: `components/admin/StatusBadge.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json` (add `readiness.*` keys)

- [ ] **Step 1: Create `components/admin/StatusBadge.tsx`**

```tsx
"use client";

/**
 * StatusBadge — shared soft-gate badge (first shared badge extraction).
 * Gaps-only: render ONLY for 'incomplete' (red) / 'upstream_gaps' (amber);
 * ready entities render nothing (callers skip). Red classes mirror the
 * shipped recipes.badge.incomplete chip (RecipesClient.tsx).
 */
import { useTranslation } from "@/lib/i18n/provider";
import type { Reason } from "@/lib/readiness";
import type { TranslationKey } from "@/lib/i18n/types";

const CLS = {
  incomplete: "rounded bg-co-cta/15 px-2 py-0.5 text-xs font-bold text-co-cta",
  upstream_gaps: "rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700",
} as const;

export function StatusBadge({ status }: { status: keyof typeof CLS }) {
  const { t } = useTranslation();
  return (
    <span className={CLS[status]}>
      {t(status === "incomplete" ? "readiness.badge.not_ready" : "readiness.badge.upstream")}
    </span>
  );
}

/** Short inline reasons line, e.g. "Missing: no price · no delivery received". */
export function ReadinessReasons({ reasons }: { reasons: Reason[] }) {
  const { t } = useTranslation();
  if (reasons.length === 0) return null;
  const parts = reasons.map((r) =>
    t(`readiness.reason.${r.code}` as TranslationKey, r.count != null ? { count: r.count } : undefined),
  );
  return (
    <p className="mt-0.5 text-xs text-co-text-muted">
      {t("readiness.reasons_prefix")} {parts.join(" · ")}
    </p>
  );
}
```
(If `t()`'s signature rejects `undefined` params, call it as two branches — verify against `lib/i18n/provider.tsx` before finalizing.)

- [ ] **Step 2: Add i18n keys — EN (`lib/i18n/en.json`), alphabetical-neighbor placement near `recipes.*`**

```json
"readiness.badge.not_ready": "Not ready",
"readiness.badge.upstream": "Upstream gaps",
"readiness.reasons_prefix": "Missing:",
"readiness.reason.missing_pack": "pack/size incomplete",
"readiness.reason.missing_price": "no price",
"readiness.reason.no_delivery": "no delivery received",
"readiness.reason.no_inputs": "no inputs",
"readiness.reason.no_outputs": "no outputs",
"readiness.reason.no_batch_yield": "no batch yield",
"readiness.reason.not_ready_skus": "{count} not-ready SKU(s)",
"readiness.reason.not_ready_subitems": "{count} not-ready sub-item(s)",
"readiness.reason.no_recipe": "no recipe — cost/traceability incomplete",
"readiness.reason.no_oz_per_par_unit": "oz per par unit not set",
"readiness.reason.sell_incomplete": "sold-directly missing portion/price",
"readiness.reason.upstream_recipe": "its recipe isn't ready",
"readiness.hub.count": "{count} not ready"
```

- [ ] **Step 3: Add ES keys (`lib/i18n/es.json`) — tú-form, operational register**

```json
"readiness.badge.not_ready": "No listo",
"readiness.badge.upstream": "Faltas arriba",
"readiness.reasons_prefix": "Falta:",
"readiness.reason.missing_pack": "empaque/tamaño incompleto",
"readiness.reason.missing_price": "sin precio",
"readiness.reason.no_delivery": "sin entrega recibida",
"readiness.reason.no_inputs": "sin ingredientes",
"readiness.reason.no_outputs": "sin productos",
"readiness.reason.no_batch_yield": "sin rendimiento de lote",
"readiness.reason.not_ready_skus": "{count} SKU(s) no listos",
"readiness.reason.not_ready_subitems": "{count} sub-artículo(s) no listos",
"readiness.reason.no_recipe": "sin receta — costo/trazabilidad incompletos",
"readiness.reason.no_oz_per_par_unit": "oz por unidad de par sin definir",
"readiness.reason.sell_incomplete": "venta directa sin porción/precio",
"readiness.reason.upstream_recipe": "su receta no está lista",
"readiness.hub.count": "{count} sin alistar"
```

- [ ] **Step 4: Reconcile the KNOWN_REASONS set against BOTH JSONs (the #107 lesson)**

Run this check (add nothing to the repo — one-liner):
```bash
npx tsx -e "import {KNOWN_REASONS} from './lib/readiness'; import en from './lib/i18n/en.json'; import es from './lib/i18n/es.json'; const miss=(j:Record<string,string>,n:string)=>KNOWN_REASONS.filter(c=>!(('readiness.reason.'+c) in j)).forEach(c=>{console.error(n+' missing '+c); process.exitCode=1;}); miss(en,'en'); miss(es,'es'); console.log('reconciled');"
```
Expected: `reconciled`, exit 0.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → clean (this also proves the new keys entered `TranslationKey`).
```bash
git add components/admin/StatusBadge.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(readiness): StatusBadge component + EN/ES readiness keys

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: SKU surfaces (catalog + vendor SKU cards)

**Files:**
- Modify: `app/admin/skus/page.tsx` (compute readiness from data ALREADY loaded)
- Modify: `components/admin/skus/SkuCatalogClient.tsx` (prop + badge in `CatalogRow`, badge site ~line 263)
- Modify: `app/admin/vendors/[id]/page.tsx` (same computation)
- Modify: `components/admin/vendors/VendorDetailClient.tsx` (thread prop)
- Modify: `components/admin/skus/VendorSkusCard.tsx` (prop + badge in `SkuRow`, badge site ~line 234)

Both pages ALREADY load `prices` and the full `ledgerMap` — compute readiness inline from those; do NOT call `loadSkuDeliveryCounts` here.

- [ ] **Step 1: In `app/admin/skus/page.tsx`**, after `ledgerMap` is built, add (imports: `skuPackComplete, skuReadiness, type Readiness` from `@/lib/readiness`):

```ts
const skuReadinessMap: Record<string, Readiness> = {};
for (const s of skus) {
  const r = skuReadiness({
    active: s.active,
    packComplete: skuPackComplete(s),
    hasPrice: prices.has(s.id),
    deliveryCount: ledgerMap.get(s.id)?.deliveries.length ?? 0,
  });
  if (r && r.status !== "ready") skuReadinessMap[s.id] = r;
}
```
Pass `skuReadiness={skuReadinessMap}` to `<SkuCatalogClient …>`. (Gaps-only: ready/inactive SKUs are absent → client renders nothing.)

- [ ] **Step 2: In `SkuCatalogClient.tsx`**, add to props: `skuReadiness: Record<string, Readiness>;` (import `type Readiness` from `@/lib/readiness`, `StatusBadge, ReadinessReasons` from `@/components/admin/StatusBadge`). Thread `readiness={skuReadiness[s.id] ?? null}` into `CatalogRow`, and inside `CatalogRow` render next to the existing Inactive pill (~line 263):

```tsx
{readiness ? <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} /> : null}
```
and below the meta line:
```tsx
{readiness ? <ReadinessReasons reasons={readiness.reasons} /> : null}
```

- [ ] **Step 3: Repeat for the vendor detail path** — same computation block in `app/admin/vendors/[id]/page.tsx`, prop `skuReadiness` through `VendorDetailClient` (add to its props and pass down to `<VendorSkusCard …>`), badge + reasons in `SkuRow` next to the Inactive pill (~`VendorSkusCard.tsx:234`). Re-read each file's actual prop plumbing before editing — `VendorSkusCard` receives `skus` via `VendorDetailClient.tsx:105`.

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` → clean. Run `npm run dev`, load `/admin/skus` signed in as a ≥6 user, confirm badges render on gap SKUs and NOT on ready/inactive ones.
```bash
git add app/admin/skus/page.tsx components/admin/skus/SkuCatalogClient.tsx "app/admin/vendors/[id]/page.tsx" components/admin/vendors/VendorDetailClient.tsx components/admin/skus/VendorSkusCard.tsx
git commit -m "feat(readiness): SKU badges on catalog + vendor SKU cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Recipes list + builder

**Files:**
- Modify: `app/admin/recipes/page.tsx` (load `loadGraphReadiness`, pass map)
- Modify: `components/admin/recipes/RecipesClient.tsx:78-82` (replace the two-state badge)
- Modify: `app/admin/recipes/[id]/page.tsx` + `components/admin/recipes/RecipeBuilder.tsx` ("What's missing" line, LIVE mode only)

- [ ] **Step 1: In `app/admin/recipes/page.tsx`**, wrap in the failure posture:

```ts
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import type { Readiness } from "@/lib/readiness";
// after loadRecipes:
let recipeReadiness: Record<string, Readiness> = {};
try {
  const g = await loadGraphReadiness(auth);
  recipeReadiness = Object.fromEntries(
    [...g.recipeReadiness.entries()].filter(([, r]) => r.status !== "ready"),
  );
} catch (e) {
  console.error("readiness load failed (rendering without badges)", e);
}
```
Pass `readiness={recipeReadiness}` to `<RecipesClient …>`.

- [ ] **Step 2: In `RecipesClient.tsx`**, add prop `readiness: Record<string, Readiness>;` and REPLACE lines 78-82 (the `!r.hasInputs || !r.hasOutputs` chip) with:

```tsx
{readiness[r.id] ? (
  <StatusBadge status={readiness[r.id]!.status as "incomplete" | "upstream_gaps"} />
) : null}
```
(The old `recipes.badge.incomplete` key stays in the JSONs — other locales/history reference it; just no longer rendered here.) Add `<ReadinessReasons reasons={…} />` under the outputs line when a readiness entry exists.

- [ ] **Step 3: Recipe detail "What's missing" line.** Re-read `app/admin/recipes/[id]/page.tsx` and `RecipeBuilder.tsx` props first. In the page, compute this recipe's readiness via `loadGraphReadiness` (same try/catch posture), pass `readiness={g.recipeReadiness.get(id) ?? null}` (pass even when ready — builder skips rendering). In `RecipeBuilder` LIVE mode (not the `new/` draft mode), render at the top when `readiness && readiness.status !== "ready"`:

```tsx
<div className="mt-3 rounded-lg border-2 border-co-border bg-co-surface p-3">
  <div className="flex items-center gap-2">
    <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} />
  </div>
  <ReadinessReasons reasons={readiness.reasons} />
</div>
```

- [ ] **Step 4: Verify + commit**

`npm run typecheck` clean; dev-server check on `/admin/recipes` (badges match expectations: a recipe missing yield shows red; a complete recipe over a gap SKU shows amber).
```bash
git add app/admin/recipes components/admin/recipes
git commit -m "feat(readiness): three-state recipe badges + builder what's-missing line

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Items — Global registry tab

**Files:**
- Modify: `app/admin/checklist-templates/[subtype]/page.tsx` (load item readiness)
- Modify: `components/admin/templates/ChecklistTabs.tsx` (thread prop)
- Modify: `components/admin/templates/GlobalRegistryTab.tsx` (badge next to Default badge ~line 928; reasons inside the expanded edit panel ~line 950)

- [ ] **Step 1:** In the `[subtype]` page, after `loadChecklistAdminView`, load `loadGraphReadiness(auth)` in the same try/catch posture as Task 5 and build `itemReadiness: Record<string, Readiness>` (gaps-only filter). Pass to `<ChecklistTabs view={view} itemReadiness={itemReadiness} />`.

- [ ] **Step 2:** `ChecklistTabs`: add prop `itemReadiness: Record<string, Readiness>;` and forward it to `<GlobalRegistryTab … itemReadiness={itemReadiness} />` (line ~65). LocationChecklistTab is NOT touched.

- [ ] **Step 3:** `GlobalRegistryTab`: accept the prop, thread to each item row component; render inside the name `<span>` after the Default badge (~line 928-932):

```tsx
{itemReadiness[item.itemId] ? (
  <span className="ml-2">
    <StatusBadge status={itemReadiness[item.itemId]!.status as "incomplete" | "upstream_gaps"} />
  </span>
) : null}
```
And at the top of the expanded edit panel (`open && canEdit` block, ~line 950):
```tsx
{itemReadiness[item.itemId] ? <ReadinessReasons reasons={itemReadiness[item.itemId]!.reasons} /> : null}
```
NOTE: `GlobalRegistryTab` has internal row components — re-read the actual component decomposition and thread props accordingly; the row that renders `item.isDefault` badge is the target.

- [ ] **Step 4: Verify + commit**

`npm run typecheck`; dev check `/admin/checklist-templates/am_prep` Global tab (most of the 87 items will badge red "no recipe" — expected; that IS the nudge).
```bash
git add "app/admin/checklist-templates/[subtype]/page.tsx" components/admin/templates/ChecklistTabs.tsx components/admin/templates/GlobalRegistryTab.tsx
git commit -m "feat(readiness): item badges on the Global registry tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Admin hub count pills

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1:** In `AdminHubPage`, compute counts only when the viewer can see the relevant cards, with the failure posture:

```ts
import { countNotReady } from "@/lib/admin/readiness-load";

// after sections:
const wantsCounts = sections.some((s) => s.id === "skus" || s.id === "recipes" || s.id === "checklist-templates");
let counts: Record<string, number> = {};
if (wantsCounts) {
  try {
    const c = await countNotReady(auth);
    counts = { skus: c.skus, recipes: c.recipes, "checklist-templates": c.items };
  } catch (e) {
    console.error("hub readiness counts failed (rendering without pills)", e);
  }
}
```
In the card `<a>`, render after the label when `(counts[s.id] ?? 0) > 0`:
```tsx
<span className="ml-2 rounded bg-co-cta/15 px-2 py-0.5 text-xs font-bold text-co-cta">
  {serverT(lang, "readiness.hub.count", { count: counts[s.id]! })}
</span>
```
(Verify `serverT` supports params — grep `lib/i18n/server.ts`; the `{count}` interpolation pattern is repo-standard. `checklist-templates` is minLevel 7, `skus`/`recipes` are 6 — the `sections` filter already encodes visibility, so counts never leak to a viewer who can't open the card.)

- [ ] **Step 2: Verify + commit**

`npm run typecheck`; dev check `/admin` shows pills with plausible counts.
```bash
git add app/admin/page.tsx
git commit -m "feat(readiness): not-ready count pills on the admin hub

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full gates, count cross-check, PR

- [ ] **Step 1:** `npm run typecheck` && `npm run build` → both clean. `npx tsx scripts/readiness-rules-check.ts` → all pass.

- [ ] **Step 2: Cross-check hub counts against direct SQL** (throwaway — via Supabase MCP `execute_sql`, read-only):

```sql
-- SKUs not ready (active, missing pack OR price OR delivery)
SELECT count(*) FROM vendor_items vi
WHERE vi.active
  AND ( vi.units_per_pack IS NULL OR vi.units_per_pack <= 0
     OR vi.each_size IS NULL OR vi.each_size <= 0
     OR vi.each_measure IS NULL
     OR NOT EXISTS (SELECT 1 FROM vendor_price_history p WHERE p.vendor_item_id = vi.id)
     OR NOT EXISTS (SELECT 1 FROM vendor_delivery_items d WHERE d.vendor_item_id = vi.id) );
```
Compare with the hub's SKU pill (recipes/items counts involve the recursive walk — spot-check a couple of entities by hand instead: one recipe with a gap SKU should show amber, one item without a recipe should show red).

- [ ] **Step 3: Push + PR**

```bash
git push -u origin claude/softgate-badges
gh pr create --title "Verify → go-live soft-gate: computed readiness badges + hub counts" --body "$(cat <<'EOF'
## Summary
- Purely computed readiness (no migration, no write routes): SKU = pack+price+≥1 delivery; recipe = inputs+outputs+yield, amber when upstream SKUs/sub-items not ready; item = producing recipe + oz basis (+ sell fields when sold-directly), amber when its recipe isn't ready.
- Gaps-only badges (ready = quiet) via new shared StatusBadge; reasons line inline. EN+ES.
- Surfaces: /admin/skus, vendor SKU cards, /admin/recipes (+ builder what's-missing), Global registry tab, /admin hub count pills.
- Spec: docs/superpowers/specs/2026-07-05-verify-golive-softgate-design.md

## Test plan
- [ ] Preview URL (Vercel PR comment): /admin/skus — gap SKUs badge red w/ reasons; inactive SKUs show only "Inactive"
- [ ] /admin/recipes — own-gap recipes red, upstream-gap recipes amber; detail page shows what's-missing line
- [ ] /admin/checklist-templates/am_prep Global tab — items without recipes badge red
- [ ] /admin hub — count pills match; disappear at zero
- [ ] Operator surfaces untouched (AM/Opening/Mid-day unchanged)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Include the PREVIEW url (from the Vercel PR comment) when handing to Juan — never the prod URL.

---

## Self-review notes (spec coverage)

- Spec §rules → Task 1 (pure fns) ✓; §architecture → Task 2 ✓; §vocabulary/badging → Task 3 ✓; §surfaces 1-4 → Tasks 4-7 ✓; §i18n reconcile → Task 3 Step 4 ✓; §failure posture → try/catch in Tasks 5-7 + SKU pages compute from already-loaded data (no new failure mode) ✓; §testing → Task 1 script + Task 8 SQL cross-check + Juan preview smoke ✓; §non-goals — no vendor-entity readiness, no stored status, no operator changes ✓.
- Type consistency: `Readiness { status, reasons: Reason[] }` and `Reason { code, count? }` used identically in Tasks 1-7; `skuReadiness` prop name on both SKU clients; `itemReadiness`/`recipeReadiness` maps gaps-only-filtered at every page.
