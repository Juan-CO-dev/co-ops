# Production-in-Prep Fold (S1-via-prep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold SKU→item production capture into the Opening Phase-2 and Mid-day Phase-2 prep saves — when a prepper records what they made, the system derives the SKU consumption from the recipe (multi-SKU + composites), shows it pre-filled + editable, and records it idempotently (supersede on re-save, reverse on revoke); the SKU **In stock (est.)** number moves.

**Architecture:** Reshape S1's single-input `productions` into a header + `production_inputs` lines model (0 rows, safe). A recursive derive engine flattens `item_components` to leaf-SKU oz-per-par-unit (mirrors `itemPerUnitOz`'s per-batch÷batch_yield recursion). A shared `recordProductionFromPrep` helper hangs off both Phase-2 per-item saves; a shared `ProductionConsumptionPanel` renders the collapsed "Uses: …" summary + tap-to-expand editable per-SKU rows. Authorization inherits the prep save.

**Tech Stack:** Next 16 App Router, Supabase (service-role + app-gate + custom-JWT RLS), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n. No test framework → `tsc` + `build` + throwaway tsx smokes (deleted). PostgREST numeric→string → `Number(...)`.

**Spec:** `docs/superpowers/specs/2026-07-01-production-in-prep-fold-design.md`.
**Branch:** continue `claude/production-capture` (PR #106, absorbing S1). **Prod ref:** `bgcvurheqzylyfehqgzh`.

---

## File Structure
**New:**
- `supabase/migrations/0102_production_header_lines.sql` — reshape productions + production_inputs.
- `lib/prep-consumption.ts` — the derive engine (`skuConsumptionForItem`, `perUnitSkuOzForItem`) + `recordProductionFromPrep` / `reverseProductionForPrep` helpers.
- `components/production/ProductionConsumptionPanel.tsx` — shared collapsed/expandable consumption UI.

**Modified:**
- `lib/production.ts` — reshape `recordProduction` to header+lines; update `loadInStockPacks`, `loadRecentProductions`, `loadProductionFormData` reads.
- `lib/admin/cost.ts` — `loadSkuConsumption` sums `production_inputs.input_oz`.
- `lib/opening.ts` — `loadOpeningState` returns `derivedForItem`; `savePhase2Item` accepts `confirmedConsumption` + calls helper; `revokePhase2Completion` reverses.
- `app/api/opening/prep/item/route.ts` — pass `confirmedConsumption` through.
- `components/opening/OpeningPrepEntry.tsx` — render the panel.
- `lib/prep.ts` — `loadMidDayPrepState` returns `derivedForItem`; thread `itemId`; `saveMidDayPhase2Item` accepts `confirmedConsumption` + calls helper; mid-day revoke reverses.
- `app/api/prep/mid-day/phase2/item/route.ts` — pass `confirmedConsumption`.
- `components/MidDayPhase2Form.tsx` — carry `itemId` + render the panel.
- `app/(authed)/operations/mid-day/page.tsx` — thread `itemId` into the form item shape.
- `app/(authed)/dashboard/page.tsx` — drop the ProductionTile.
- `lib/i18n/en.json` + `lib/i18n/es.json` — panel keys.

---

## Task 1: Migration 0102 — header + lines reshape

**Files:** Create `supabase/migrations/0102_production_header_lines.sql`

- [ ] **Step 1: Confirm 0 rows** (MCP `execute_sql`): `select count(*) as n from productions;` → expect `0`. If not 0, STOP and escalate (the reshape assumes empty).
- [ ] **Step 2: Apply migration 0102** via MCP `apply_migration` (name `0102_production_header_lines`):
```sql
-- Reshape productions to a header; move the input to a lines table (multi-SKU).
alter table productions drop column input_sku_id;
alter table productions drop column input_qty;
alter table productions add column source text not null default 'manual'
  check (source in ('opening_p2','mid_day_p2','manual'));
alter table productions alter column source drop default;
alter table productions add column instance_id uuid references checklist_instances(id);
alter table productions add column template_item_id uuid references checklist_template_items(id);
alter table productions add column superseded_at timestamptz;
alter table productions add column revoked_at timestamptz;

create table production_inputs (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions(id) on delete cascade,
  input_sku_id uuid not null references vendor_items(id),
  input_oz numeric not null check (input_oz > 0),
  qty_entered numeric,
  unit_entered text,
  derived_oz numeric
);
create index production_inputs_production_idx on production_inputs(production_id);
create index production_inputs_sku_idx on production_inputs(input_sku_id);
-- live-header lookup for idempotency + consumption sums
create index productions_prep_live_idx on productions(instance_id, template_item_id)
  where superseded_at is null and revoked_at is null;

alter table production_inputs enable row level security;
create policy production_inputs_no_user_select on production_inputs for select using (false);
create policy production_inputs_no_user_insert on production_inputs for insert with check (false);
create policy production_inputs_no_user_update on production_inputs for update using (false);
create policy production_inputs_no_user_delete on production_inputs for delete using (false);
```
- [ ] **Step 3: Verify**
```sql
select
  (select count(*) from information_schema.columns where table_name='productions' and column_name in ('source','instance_id','template_item_id','superseded_at','revoked_at')) as hdr_cols,
  (select count(*) from information_schema.columns where table_name='productions' and column_name in ('input_sku_id','input_qty')) as dropped,
  (select count(*) from information_schema.tables where table_name='production_inputs') as lines_tbl,
  (select count(*) from pg_policies where tablename='production_inputs') as lines_pol;
```
Expected: `5`, `0`, `1`, `4`.
- [ ] **Step 4: Capture** `supabase/migrations/0102_production_header_lines.sql` with the going-forward header:
```
-- Migration 0102_production_header_lines
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-production-in-prep-fold-design.md §5
-- Reshape S1's single-input productions (0 rows) into a header + production_inputs lines
-- model: one prep-save conversion event → N leaf-SKU depletions. instance_id/template_item_id
-- link + superseded_at/revoked_at drive prep-save idempotency (§6). Deny-all RLS on lines.
```
followed by the exact SQL from Step 2.
- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0102_production_header_lines.sql
git commit -m "feat(production): migration 0102 — header + production_inputs lines"
```

---

## Task 2: Derive engine — `skuConsumptionForItem` (recursive flatten)

**Files:** Create `lib/prep-consumption.ts`; Test `scripts/_smoke_prepconsumption.ts` (throwaway, deleted Task 10)

- [ ] **Step 1: Confirm-before-authoring** — read `lib/recipe-math.ts` (`componentPerUnitOz`, `itemPerUnitOz` — the per-batch÷`batchYield` semantics; sub-item recursion scales by `quantity / batchYield`), `lib/admin/item-components.ts` (`item_components` columns: `item_id, component_sku_id, component_item_id, quantity, unit`; the `wouldCreateCycle` BFS shape), and `lib/production.ts` (`num`, `getServiceRoleClient`, the SKU pack columns `units_per_pack/each_size/each_measure/avg_oz_per_each`). Confirm `items` has `batch_yield` and `measure_units` has `label/dimension/to_base_factor`.

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_prepconsumption.ts`:
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { skuConsumptionForItem } from "@/lib/prep-consumption";

function log(l: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${l} ${extra}`); if (!ok) process.exitCode = 1; }

void (async () => {
  const sb = getServiceRoleClient();
  // pick an item that HAS at least one item_components SKU edge
  const { data: edge } = await sb.from("item_components").select("item_id, component_sku_id").not("component_sku_id", "is", null).limit(1).maybeSingle<{ item_id: string; component_sku_id: string }>();
  if (!edge) { console.log("no SKU-edge item to test"); return; }
  const map = await skuConsumptionForItem(edge.item_id, 2);
  log("returns a Map", map instanceof Map);
  log("includes the edge's SKU (or item recipe incomplete → empty)", map.size === 0 || map.has(edge.component_sku_id), JSON.stringify([...map.entries()]));
  for (const [, oz] of map) log("oz is a finite number", Number.isFinite(oz), String(oz));
})();
```

- [ ] **Step 3: Run — verify FAIL** (`npx tsx --env-file=.env.local scripts/_smoke_prepconsumption.ts` → module missing).

- [ ] **Step 4: Create `lib/prep-consumption.ts`** (the engine only — helpers added Task 4):
```ts
/**
 * Prep-consumption engine (Item/Inventory Spine — production-in-prep fold). SERVER-ONLY,
 * service-role. Recursively flattens an item's item_components recipe to leaf-SKU oz consumed
 * per par-unit, mirroring lib/recipe-math.ts itemPerUnitOz's per-batch ÷ batch_yield semantics —
 * but ACCUMULATING PER LEAF SKU instead of summing. Returns oz-per-output-unit; callers scale.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ozFromMeasure, type MeasureUnitFactor } from "@/lib/recipe-math";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

interface ItemNode { batchYield: number | null; components: Array<{ quantity: number; unit: string | null; componentSkuId: string | null; componentItemId: string | null }>; }

async function loadMeasures(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("measure_units").select("label, dimension, to_base_factor").returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  return new Map((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
}

async function loadSkuAvg(skuIds: string[]): Promise<Map<string, number | null>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("vendor_items").select("id, avg_oz_per_each").in("id", skuIds).returns<Array<{ id: string; avg_oz_per_each: number | string | null }>>();
  return new Map((data ?? []).map((s) => [s.id, num(s.avg_oz_per_each)]));
}

/**
 * Per-leaf-SKU oz consumed for ONE par-unit of `itemId`. Recurses through composites,
 * scaling a sub-item's map by (edge.quantity / parent.batchYield). Cycle-guarded by a
 * visited set (returns partial-then-empty on a cycle rather than looping). Returns an
 * empty Map when the recipe is incomplete (missing batch_yield, unresolved measure, etc.) —
 * an incomplete-recipe item is simply non-convertible.
 */
export async function perUnitSkuOzForItem(itemId: string): Promise<Map<string, number>> {
  const sb = getServiceRoleClient();
  const measures = await loadMeasures();
  const nodeCache = new Map<string, ItemNode | null>();

  async function loadNode(id: string): Promise<ItemNode | null> {
    if (nodeCache.has(id)) return nodeCache.get(id) ?? null;
    const { data: item } = await sb.from("items").select("batch_yield").eq("id", id).maybeSingle<{ batch_yield: number | string | null }>();
    const { data: comps } = await sb.from("item_components").select("quantity, unit, component_sku_id, component_item_id").eq("item_id", id).returns<Array<{ quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null }>>();
    const node: ItemNode = {
      batchYield: item ? num(item.batch_yield) : null,
      components: (comps ?? []).map((c) => ({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id })),
    };
    nodeCache.set(id, node);
    return node;
  }

  // Gather all SKU ids across the reachable tree for one avg-oz batch load.
  const skuIds = new Set<string>();
  async function collectSkus(id: string, seen: Set<string>): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);
    const node = await loadNode(id);
    if (!node) return;
    for (const c of node.components) {
      if (c.componentSkuId) skuIds.add(c.componentSkuId);
      else if (c.componentItemId) await collectSkus(c.componentItemId, seen);
    }
  }
  await collectSkus(itemId, new Set());
  const skuAvg = await loadSkuAvg([...skuIds]);

  function recurse(id: string, visiting: Set<string>): Map<string, number> | null {
    if (visiting.has(id)) return null; // cycle
    const node = nodeCache.get(id) ?? null;
    if (!node || node.batchYield == null || node.batchYield <= 0) return null;
    const out = new Map<string, number>();
    const nextVisiting = new Set(visiting).add(id);
    for (const c of node.components) {
      if (c.componentSkuId != null) {
        const oz = ozFromMeasure(c.quantity, c.unit, measures, skuAvg.get(c.componentSkuId) ?? null);
        if (oz == null) return null;
        const perUnit = oz / node.batchYield;
        out.set(c.componentSkuId, (out.get(c.componentSkuId) ?? 0) + perUnit);
      } else if (c.componentItemId != null) {
        const subMap = recurse(c.componentItemId, nextVisiting);
        if (subMap == null) return null;
        const scale = c.quantity / node.batchYield;
        for (const [sku, oz] of subMap) out.set(sku, (out.get(sku) ?? 0) + oz * scale);
      } else {
        return null;
      }
    }
    return out;
  }

  return recurse(itemId, new Set()) ?? new Map();
}

/** Per-leaf-SKU oz consumed for `outputQty` par-units of `itemId`. */
export async function skuConsumptionForItem(itemId: string, outputQty: number): Promise<Map<string, number>> {
  if (!Number.isFinite(outputQty) || outputQty <= 0) return new Map();
  const perUnit = await perUnitSkuOzForItem(itemId);
  const out = new Map<string, number>();
  for (const [sku, oz] of perUnit) out.set(sku, oz * outputQty);
  return out;
}
```

- [ ] **Step 5: Run smoke — all PASS.** **Step 6: `npx tsc --noEmit`** — clean.
- [ ] **Step 7: Commit**
```bash
git add lib/prep-consumption.ts scripts/_smoke_prepconsumption.ts
git commit -m "feat(production): recursive SKU-consumption derive engine"
```

---

## Task 3: Reshape `lib/production.ts` + `loadSkuConsumption` to header+lines

**Files:** Modify `lib/production.ts`, `lib/admin/cost.ts`

- [ ] **Step 1: Confirm-before-authoring** — re-read the CURRENT `lib/production.ts` (`recordProduction`, `loadInStockPacks`, `loadRecentProductions`, `loadProductionFormData` — all reference the now-dropped `input_sku_id`/`input_qty` columns) and `lib/admin/cost.ts` `loadSkuConsumption` (reads `productions.input_sku_id/input_qty`). Also re-read the just-written `lib/prep-consumption.ts` for the shared `num` pattern.

- [ ] **Step 2: Rewrite `recordProduction`** (`lib/production.ts`) to write a header + one line (single-SKU manual path). Replace the body's insert block so it:
  1. validates as today (SKU active, item active, `item_components` edge exists → `invalid_conversion`, positive qtys),
  2. resolves the consumed oz for the single SKU = `input_qty × content_oz(sku)` (reuse the `skuContentOz` + measures pattern already in `loadSkuConsumption`),
  3. inserts a `productions` header `{ location_id, output_item_id: input.outputItemId, output_qty: input.outputQty, source: 'manual', notes, created_by }`,
  4. inserts one `production_inputs` `{ production_id, input_sku_id, input_oz, qty_entered: input.inputQty, unit_entered: null, derived_oz: null }`,
  5. audits `production.recorded` with the same metadata + `source: 'manual'`.
  Keep `RecordProductionInput` unchanged (the standalone form still sends single input+output qty).

- [ ] **Step 3: Update the reads** in `lib/production.ts`:
  - `loadInStockPacks` — the consumed side must read `production_inputs` joined to live headers, in **oz then back to packs**? No — keep the form hint in PACKS: sum `qty_entered` from `production_inputs` for live (`superseded_at is null and revoked_at is null`) headers whose SKU matches. Query `production_inputs` `select input_sku_id, qty_entered, production_id` filtered `.in("input_sku_id", skuIds)`, then filter to live headers (load `productions` ids where live) — subtract `qty_entered` per SKU. (received packs still from `vendor_delivery_items.qty_received`.)
  - `loadRecentProductions` — read `productions` headers (live) for the location; for the display line, load each header's `production_inputs` and show the first/aggregate SKU name(s). Keep the `ProductionView` shape but `skuName` becomes the joined input SKU name(s) (comma-join if multiple); `inputQty` becomes the summed `qty_entered` (or drop it from the line — keep for single-input compatibility).
  - `loadProductionFormData` — unchanged except it calls the updated `loadInStockPacks`.

- [ ] **Step 4: Update `loadSkuConsumption`** (`lib/admin/cost.ts`): sum `production_inputs.input_oz` (oz) and `input_oz × cost/oz` ($) over **live** headers only. Replace the current `productions.input_sku_id/input_qty × content_oz` computation:
```ts
// live-header ids
const { data: liveHdr } = await sb.from("productions").select("id").is("superseded_at", null).is("revoked_at", null).returns<Array<{ id: string }>>();
const liveIds = new Set((liveHdr ?? []).map((h) => h.id));
const { data: lines } = await sb.from("production_inputs").select("production_id, input_sku_id, input_oz").in("input_sku_id", skuIds).returns<Array<{ production_id: string; input_sku_id: string; input_oz: number | string }>>();
const prices = await loadCurrentSkuPrices(skuIds); // Map<skuId, price-per-pack>; need cost/oz
// cost/oz per SKU = price ÷ content_oz (reuse the measures + skuContentOz already computed in this fn)
for (const id of skuIds) out.set(id, { consumedOz: 0, consumedDollars: 0 });
for (const l of lines ?? []) {
  if (!liveIds.has(l.production_id)) continue;
  const c = out.get(l.input_sku_id); if (!c) continue;
  const oz = num(l.input_oz) ?? 0;
  c.consumedOz += oz;
  const costPerOz = /* costPerOzById.get(l.input_sku_id) */ null;
  if (costPerOz != null) c.consumedDollars += oz * costPerOz;
}
```
Confirm-before-authoring: the existing `loadSkuConsumption` already builds `contentOzById` + `prices`; derive `costPerOzById = price ÷ contentOz` per SKU and use it for the `$` line. Keep the `SkuConsumption` interface + signature identical (Task 8 of the S1 slice already threads it to the panel).

- [ ] **Step 5: Extend the smoke** `scripts/_smoke_production.ts` was deleted in S1 — write a fresh throwaway `scripts/_smoke_prod_reshape.ts` that: inserts a header+line via `recordProduction` (needs a real SKU→item edge; create temp if none), asserts a `productions` header + a `production_inputs` line land, asserts `loadSkuConsumption` returns `consumedOz > 0` for that SKU, then cleans up (delete header → cascade deletes the line). Run — PASS.
- [ ] **Step 6: `npx tsc --noEmit`** — clean. **Step 7: Commit**
```bash
git add lib/production.ts lib/admin/cost.ts scripts/_smoke_prod_reshape.ts
git commit -m "feat(production): reshape record + consumption to header+lines"
```

---

## Task 4: `recordProductionFromPrep` + `reverseProductionForPrep` (idempotency)

**Files:** Modify `lib/prep-consumption.ts`; Test `scripts/_smoke_prepfold.ts` (throwaway)

- [ ] **Step 1: Add to `lib/prep-consumption.ts`** the helper + reverse (append below the engine):
```ts
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export interface ConfirmedInput { skuId: string; qtyOz: number; qtyEntered: number | null; unitEntered: string | null; derivedOz: number | null; }
export interface RecordFromPrepInput {
  locationId: string; instanceId: string; templateItemId: string;
  outputItemId: string; outputQty: number;
  confirmedConsumption: ConfirmedInput[];
  source: "opening_p2" | "mid_day_p2";
}

/**
 * Record a prep conversion idempotently: supersede any live production header for
 * (instanceId, templateItemId), then insert a fresh header + one line per confirmed SKU.
 * No-op-safe: an empty confirmedConsumption still supersedes the prior (so a corrected
 * prep with no convertible inputs clears the old depletion). Authorization is the CALLER's
 * (the prep-save gate) — this helper does NOT re-gate role.
 */
export async function recordProductionFromPrep(actor: AuthContext, input: RecordFromPrepInput): Promise<{ productionId: string | null }> {
  const sb = getServiceRoleClient();
  // 1. supersede prior live header for this (instance, template_item)
  await sb.from("productions").update({ superseded_at: new Date().toISOString() })
    .eq("instance_id", input.instanceId).eq("template_item_id", input.templateItemId)
    .is("superseded_at", null).is("revoked_at", null);
  const positive = input.confirmedConsumption.filter((c) => Number.isFinite(c.qtyOz) && c.qtyOz > 0);
  if (positive.length === 0) return { productionId: null };
  // 2. insert fresh header
  const { data: hdr, error: hErr } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: input.outputQty,
    source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordProductionFromPrep header: ${hErr.message}`);
  if (!hdr) throw new Error("recordProductionFromPrep header returned no row");
  // 3. insert lines
  const { error: lErr } = await sb.from("production_inputs").insert(positive.map((c) => ({
    production_id: hdr.id, input_sku_id: c.skuId, input_oz: c.qtyOz,
    qty_entered: c.qtyEntered, unit_entered: c.unitEntered, derived_oz: c.derivedOz,
  })));
  if (lErr) throw new Error(`recordProductionFromPrep lines: ${lErr.message}`);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "production.recorded", resourceTable: "productions", resourceId: hdr.id, metadata: { source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, output_item_id: input.outputItemId, output_qty: input.outputQty, sku_count: positive.length }, ipAddress: null, userAgent: null });
  return { productionId: hdr.id };
}

/** Reverse (revoke) the live production for a prep (instance, template_item) — e.g. on completion revoke. */
export async function reverseProductionForPrep(actor: AuthContext, args: { instanceId: string; templateItemId: string }): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: live } = await sb.from("productions").select("id").eq("instance_id", args.instanceId).eq("template_item_id", args.templateItemId).is("superseded_at", null).is("revoked_at", null).maybeSingle<{ id: string }>();
  if (!live) return;
  await sb.from("productions").update({ revoked_at: new Date().toISOString() }).eq("id", live.id);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "production.revoked", resourceTable: "productions", resourceId: live.id, metadata: { instance_id: args.instanceId, template_item_id: args.templateItemId }, ipAddress: null, userAgent: null });
}
```
Note: `new Date().toISOString()` is fine in server lib code (NOT a workflow script). Confirm `audit` accepts the `production.revoked` action string (it's free-form; add to any destructive-action registry only if the codebase requires it — check `lib/destructive-actions.ts` and add `production.recorded`/`production.revoked` there if absent, otherwise leave).

- [ ] **Step 2: Smoke `scripts/_smoke_prepfold.ts`** — pick a real (instance, template_item, item with SKU edge); call `recordProductionFromPrep` twice with different qtyOz (assert only ONE live header, second superseded); assert `loadSkuConsumption` reflects the SECOND value not the sum; call `reverseProductionForPrep` (assert consumption returns to 0 for that SKU delta); cleanup. Run — PASS.
- [ ] **Step 3: `npx tsc --noEmit`** — clean. **Step 4: Commit**
```bash
git add lib/prep-consumption.ts scripts/_smoke_prepfold.ts
git commit -m "feat(production): recordProductionFromPrep + reverse (idempotent by instance+item)"
```

---

## Task 5: i18n (EN + ES) — panel keys

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Add EN keys** (before the final `}`, comma the prior last line):
```json
"production.panel.uses": "Uses",
"production.panel.confirm_cue": "tap to confirm usage",
"production.panel.per_sku": "{name}",
"production.panel.unit_case": "Case",
"production.panel.unit_each": "Each",
"production.panel.none": "No recipe linked — nothing to deplete."
```
- [ ] **Step 2: Add ES keys** (tú-form):
```json
"production.panel.uses": "Usa",
"production.panel.confirm_cue": "toca para confirmar",
"production.panel.per_sku": "{name}",
"production.panel.unit_case": "Caja",
"production.panel.unit_each": "Unidad",
"production.panel.none": "Sin receta vinculada — nada que descontar."
```
- [ ] **Step 3: Parity**
```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=new Set(Object.keys(es));const m=a.filter(k=>!b.has(k));const r=Object.keys(es).filter(k=>!new Set(a).has(k));console.log(m.length||r.length?('MISS:'+m.join(',')+'|EXTRA:'+r.join(',')):'parity ok '+a.length)"
```
Expected: `parity ok …`.
- [ ] **Step 4: Commit**
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(production): i18n for consumption panel"
```

---

## Task 6: `ProductionConsumptionPanel` shared UI

**Files:** Create `components/production/ProductionConsumptionPanel.tsx`

**Contract (defined here; consumed by Tasks 7+8):** the panel is a controlled client component. Props:
```ts
export interface DerivedSku { skuId: string; skuName: string; perUnitOz: number; unitsPerPack: number | null; contentOz: number | null; }
export interface ConfirmedRow { skuId: string; qtyOz: number; qtyEntered: number | null; unitEntered: "case" | "each" | null; derivedOz: number; }
export function ProductionConsumptionPanel(props: {
  derived: DerivedSku[];          // per-one-output-unit, from the loader
  outputQty: number;              // current entered prepped qty
  value: ConfirmedRow[] | null;   // null = untouched (use derived defaults)
  onChange: (rows: ConfirmedRow[]) => void;
}): JSX.Element | null;
```

- [ ] **Step 1: Confirm-before-authoring** — read `components/production/ProductionForm.tsx` (the field classes + `useTranslation` idiom) and `lib/recipe-math.ts` `skuContentOz` (oz↔pack conversion: packs = oz / contentOz; eaches = oz / (contentOz / unitsPerPack)).
- [ ] **Step 2: Implement** — collapsed by default; returns `null` if `derived.length === 0`:
  - **Collapsed row (default):** a button styled with a co-gold hint tint + a chevron + the cue text `t("production.panel.confirm_cue")`, showing `t("production.panel.uses") + ": " + derived.map(d => \`${fmt(d)} ${d.skuName}\`).join(" · ")`, where `fmt(d)` scales `d.perUnitOz × outputQty` → the display unit (packs by default: `oz / contentOz`, rounded to 0.25). Tap toggles expanded.
  - **Expanded:** one row per `derived` SKU — the SKU name, a numeric input pre-filled with the scaled derived amount (in the row's current unit), and a Case⇄Each toggle (`t("production.panel.unit_case")`/`unit_each`). On any edit, compute `qtyOz` from the entered value + unit (case: `entered × contentOz`; each: `entered × (contentOz / unitsPerPack)`), and call `onChange` with the full `ConfirmedRow[]` (derived defaults for untouched rows, edited values for touched). `derivedOz = perUnitOz × outputQty`.
  - When `outputQty` changes and `value` is null (untouched), the displayed defaults rescale live; once the user edits (`value` non-null), their entries persist.
- [ ] **Step 3: `npx tsc --noEmit`** — clean. **Step 4: Commit**
```bash
git add components/production/ProductionConsumptionPanel.tsx
git commit -m "feat(production): shared consumption panel (collapsed + cue + case/each)"
```

---

## Task 7: Opening Phase-2 wiring

**Files:** Modify `lib/opening.ts`, `app/api/opening/prep/item/route.ts`, `components/opening/OpeningPrepEntry.tsx`

**Contract:** each convertible Phase-2 item gets `derived: DerivedSku[]` on its loaded shape; the per-item save carries `confirmedConsumption: ConfirmedInput[]`; save calls `recordProductionFromPrep({ source: 'opening_p2' })`; revoke calls `reverseProductionForPrep`.

- [ ] **Step 1: Confirm-before-authoring** — read `lib/opening.ts` around `loadOpeningState` (:620, the Phase-2 item shape + where `it.itemId` resolves, :687/:707), `savePhase2Item` (:2119, its args + the atomic RPC call + how it re-loads/validates), and `revokePhase2Completion` (:2290); read the route `app/api/opening/prep/item/route.ts` (the POST body + validation, ~:160); read `components/opening/OpeningPrepEntry.tsx` (the per-row render + how `openerPrepped` is entered + saved). Map the exact insertion points. **Surface any mismatch to CC before writing** (the atomic RPC boundary is the risk — the production write runs in the same server call AFTER the completion RPC succeeds; if the RPC fails, no production write).
- [ ] **Step 2: Loader** — in `loadOpeningState`, for each Phase-2 item with a resolvable `itemId`, compute `derived: DerivedSku[]` from `perUnitSkuOzForItem(itemId)` hydrated with SKU name + `units_per_pack` + `contentOz` (batch the SKU loads; skip items whose map is empty → `derived: []` = non-convertible). Add `derived` to the Phase-2 item wire type.
- [ ] **Step 3: Save** — extend `savePhase2Item` (+ its route body) to accept `confirmedConsumption?: ConfirmedInput[]`. AFTER the existing completion RPC succeeds, call `recordProductionFromPrep(actor, { locationId, instanceId, templateItemId, outputItemId: itemId, outputQty: openerPrepped, confirmedConsumption: confirmedConsumption ?? [], source: 'opening_p2' })`. If `itemId` is null / not convertible, skip.
- [ ] **Step 4: Revoke** — in `revokePhase2Completion`, after the completion revoke, call `reverseProductionForPrep(actor, { instanceId, templateItemId })`.
- [ ] **Step 5: UI** — in `OpeningPrepEntry.tsx`, render `<ProductionConsumptionPanel>` under the numeric input for convertible items; thread its `onChange` into the save payload's `confirmedConsumption`. Non-convertible items (`derived.length === 0`) render unchanged.
- [ ] **Step 6: `npx tsc --noEmit && npm run build`** — clean. **Step 7: Commit**
```bash
git add lib/opening.ts app/api/opening/prep/item/route.ts components/opening/OpeningPrepEntry.tsx
git commit -m "feat(production): fold conversion into Opening Phase-2 save"
```

---

## Task 8: Mid-day Phase-2 wiring

**Files:** Modify `lib/prep.ts`, `app/api/prep/mid-day/phase2/item/route.ts`, `components/MidDayPhase2Form.tsx`, `app/(authed)/operations/mid-day/page.tsx`

- [ ] **Step 1: Confirm-before-authoring** — read `lib/prep.ts` around `loadMidDayPrepState` (:817, where `t.itemId` resolves, :864) + `saveMidDayPhase2Item` (:1205, its re-load at :1222 + the atomic RPC + over/under) + the mid-day revoke path; read `components/MidDayPhase2Form.tsx` (`MidDayPhase2Item` shape at :31, the row render + Save); read `app/(authed)/operations/mid-day/page.tsx` (the item builder ~:156 that currently maps `item.id` but NOT `item.itemId`). **This flow drops `itemId` — thread it through.**
- [ ] **Step 2: Thread `itemId`** — add `itemId: string | null` to `MidDayPhase2Item` (`MidDayPhase2Form.tsx:31`) and populate it in the page builder (`mid-day/page.tsx`) from `state.templateItems`' `itemId`.
- [ ] **Step 3: Loader** — in `loadMidDayPrepState`, attach `derived: DerivedSku[]` per convertible item (same `perUnitSkuOzForItem` hydration as Task 7 Step 2 — extract the hydration into a shared `loadDerivedForItems(itemIds)` in `lib/prep-consumption.ts` and call it from both loaders to stay DRY).
- [ ] **Step 4: Save** — extend `saveMidDayPhase2Item` (+ route `app/api/prep/mid-day/phase2/item/route.ts`) to accept `confirmedConsumption?`, and after the completion RPC call `recordProductionFromPrep({ ..., outputQty: prepped, source: 'mid_day_p2' })`.
- [ ] **Step 5: Revoke** — wire the mid-day Phase-2 revoke (if one exists per the confirm read) to `reverseProductionForPrep`. If mid-day has no per-item revoke today, note it and skip (flag to CC).
- [ ] **Step 6: UI** — render `<ProductionConsumptionPanel>` in `MidDayPhase2Form.tsx` for convertible rows, threading `onChange` into the save payload. Non-convertible rows unchanged.
- [ ] **Step 7: `npx tsc --noEmit && npm run build`** — clean. **Step 8: Commit**
```bash
git add lib/prep.ts app/api/prep/mid-day/phase2/item/route.ts components/MidDayPhase2Form.tsx "app/(authed)/operations/mid-day/page.tsx"
git commit -m "feat(production): fold conversion into Mid-day Phase-2 save"
```

---

## Task 9: Demote the standalone surface

**Files:** Modify `app/(authed)/dashboard/page.tsx`

- [ ] **Step 1: Confirm-before-authoring** — re-read the dashboard ProductionTile wiring (the `{auth.level >= 4 ? <ProductionTile .../> : null}` block added in the S1 slice).
- [ ] **Step 2: Remove** the `<ProductionTile>` block + its import from `app/(authed)/dashboard/page.tsx`. Leave `/operations/production` reachable (the page + route stay; `recordProduction` already writes `source: 'manual'` from Task 3). Delete `components/production/ProductionTile.tsx` (now unused) — confirm no other importer via grep first.
- [ ] **Step 3: `npx tsc --noEmit && npm run build`** — clean. **Step 4: Commit**
```bash
git add "app/(authed)/dashboard/page.tsx"
git rm components/production/ProductionTile.tsx
git commit -m "feat(production): demote standalone surface (drop dashboard tile)"
```

---

## Task 10: Smoke sweep + PR

- [ ] **Step 1: Re-run** all throwaway smokes (`_smoke_prepconsumption.ts`, `_smoke_prod_reshape.ts`, `_smoke_prepfold.ts`) — all PASS.
- [ ] **Step 2: Ground-truth** — MCP: `select count(*) from productions;` and `select count(*) from production_inputs;` — confirm 0 orphans left by smokes.
- [ ] **Step 3: Delete smokes + commit**
```bash
git rm -f scripts/_smoke_prepconsumption.ts scripts/_smoke_prod_reshape.ts scripts/_smoke_prepfold.ts
git commit -m "chore(production): remove throwaway smokes"
```
- [ ] **Step 4: Final gate** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 5: Push + update PR #106** — retitle to "Production capture (S1 + fold into prep)" and append a fold section to the body:
```bash
git push
gh pr edit 106 --title "Production capture (S1 + fold into prep)"
```
- [ ] **Step 6: After Juan smokes + merges** — capture to memory + CHIEF; no post-deploy step (0102 applied at build).

---

## Self-Review

**Spec coverage:** §1 model → Tasks 2/4/7/8; §2 seams+helper → Tasks 4/7/8; §3 derive engine → Task 2; §4 panel UX + visual cue → Task 6; §5 migration 0102 → Task 1; §6 idempotency → Task 4; §7 loadSkuConsumption → Task 3; §8 standalone demotion → Tasks 3/9; §9 threading → Tasks 7/8; §10 the 7 open questions → resolved across Tasks 2 (Q1/Q2), 4 (Q3/Q5/Q6), 7 (Q7), 8 (Q4); §11 verification → Tasks 2/4/10. ✔

**Deviations (flagged):** (1) Tasks 7+8 are contract-and-confirm-read rather than fully literal for the atomic-RPC/route/form bodies — the interfaces (`recordProductionFromPrep`, `reverseProductionForPrep`, `DerivedSku`, `ProductionConsumptionPanel`) are fully defined in Tasks 2/4/6; the wiring reads the current RPC/form at build (the atomic-RPC boundary is the one genuine risk, flagged for CC review). (2) The production write runs immediately AFTER the completion RPC in the same server call, not inside the RPC transaction (§6 D-atomic-vs-after) — invariant: no production write without a committed completion; if a cleaner in-RPC path surfaces on the confirm read, take it.

**Placeholder scan:** the engine (Task 2), helper (Task 4), migration (Task 1), i18n (Task 5), panel contract (Task 6) are literal. Tasks 3/7/8 carry explicit deltas + confirm-reads, not "figure it out."

**Type consistency:** `DerivedSku`/`ConfirmedRow` (Task 6) ↔ `ConfirmedInput`/`RecordFromPrepInput` (Task 4) ↔ loader `derived` (Tasks 7/8). `perUnitSkuOzForItem`/`skuConsumptionForItem` (Task 2) ↔ loaders (Tasks 7/8). `SkuConsumption` unchanged (Task 3). `source` enum `'opening_p2'|'mid_day_p2'|'manual'` consistent across migration (Task 1), helper (Task 4), record (Task 3). One naming bridge to enforce at build: the panel's `ConfirmedRow.unitEntered: "case"|"each"` maps to the helper's `ConfirmedInput.unitEntered: string|null` — Tasks 7/8 convert the panel rows → helper inputs (compute `qtyOz`, pass `unitEntered` as the string).
