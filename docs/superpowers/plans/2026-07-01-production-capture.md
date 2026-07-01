# Production Capture (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operational Production surface where KH+ logs a SKU→item conversion ("1 case → 4 pans") — depleting the SKU, crediting the item, refining the predicted yield — and the SKU catalog gains a real in-stock number (received − consumed). No AM-prep change.

**Architecture:** New `productions` table (migration 0101). New operational `lib/production.ts` (service-role + KH+ gate + location-bind, mirrors `lib/receiving.ts`). `loadSkuConsumption` in `lib/admin/cost.ts` (mirrors `loadSkuReceivingLedger`). A `/operations/production` page + cascading `ProductionForm` + dashboard tile; `SkuCostPanel` gains an In-stock line.

**Tech Stack:** Next 16 App Router (authed pages under `app/(authed)/`, async params `Promise<{}>`), React 19, Supabase (service-role + app-gate), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n. No test framework → `tsc` + `build` + throwaway tsx smokes (deleted). PostgREST numeric→string → `Number(...)`.

**Spec:** `docs/superpowers/specs/2026-07-01-production-capture-design.md`.
**Branch:** `claude/production-capture` off `origin/main` at `502c232`.
**Prod ref:** `bgcvurheqzylyfehqgzh`. **Authority:** `PRODUCE_MIN = 4` (key_holder+).

---

## File Structure
**New:** `lib/production.ts`; `app/api/operations/production/route.ts`; `app/api/operations/production/predict/route.ts`; `app/(authed)/operations/production/page.tsx`; `components/production/ProductionForm.tsx`; `components/production/ProductionTile.tsx`; `supabase/migrations/0101_productions.sql`.
**Modified:** `lib/admin/cost.ts` (`loadSkuConsumption`); `components/admin/skus/SkuCostPanel.tsx` (In-stock line); `app/admin/skus/page.tsx` + `app/admin/vendors/[id]/page.tsx` (thread `skuConsumption`); `components/admin/skus/SkuCatalogClient.tsx` + `components/admin/skus/VendorSkusCard.tsx` + `components/admin/vendors/VendorDetailClient.tsx` (thread); `app/(authed)/dashboard/page.tsx` (tile); `lib/i18n/en.json` + `lib/i18n/es.json`.

---

## Task 1: Branch + migration 0101

**Files:** Create `supabase/migrations/0101_productions.sql`

- [ ] **Step 1: Branch**
```bash
git fetch origin
git switch -c claude/production-capture origin/main
git log --oneline -1   # expect 502c232 docs(production): production capture (S1) design
```
- [ ] **Step 2: Re-read live schema** (MCP `execute_sql`): confirm `productions` does NOT exist.
```sql
select table_name from information_schema.tables where table_schema='public' and table_name='productions';
```
Expected: 0 rows.
- [ ] **Step 3: Apply migration 0101** via MCP `apply_migration` (name `0101_productions`):
```sql
create table productions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  produced_at timestamptz not null default now(),
  input_sku_id uuid not null references vendor_items(id),
  input_qty numeric not null check (input_qty > 0),
  output_item_id uuid not null references items(id),
  output_qty numeric not null check (output_qty > 0),
  notes text,
  created_by uuid
);
create index productions_input_sku_idx on productions(input_sku_id);
create index productions_output_item_idx on productions(output_item_id);
create index productions_location_idx on productions(location_id);

alter table productions enable row level security;
create policy productions_no_user_select on productions for select using (false);
create policy productions_no_user_insert on productions for insert with check (false);
create policy productions_no_user_update on productions for update using (false);
create policy productions_no_user_delete on productions for delete using (false);
```
- [ ] **Step 4: Verify**
```sql
select (select count(*) from information_schema.tables where table_name='productions') as tbl, (select count(*) from pg_policies where tablename='productions') as pol;
```
Expected: `1`, `4`.
- [ ] **Step 5: Capture** `supabase/migrations/0101_productions.sql`:
```sql
-- Migration 0101_productions
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-production-capture-design.md §4
-- S1 production capture: one SKU→item conversion per row (deplete SKU, credit item).
-- Deny-all RLS (service-role writes; app-layer KH+ gate + location-bind in lib/production.ts).

<the exact SQL from Step 3>
```
- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/0101_productions.sql
git commit -m "feat(production): migration 0101 — productions table"
```

---

## Task 2: `lib/production.ts` — the production data layer

**Files:** Create `lib/production.ts`; Test `scripts/_smoke_production.ts` (throwaway, deleted Task 9)

- [ ] **Step 1: Confirm-before-authoring** — read `lib/receiving.ts` (the `recordDelivery`/`loadReceivingFormData`/`loadRecentDeliveries` structure — service-role, `requireReceive`/`RECEIVE_MIN`, `actorLoc`, `lockLocationContext`, `num`, `audit`, `ReceivingError` — mirror ALL of it), `lib/admin/item-components.ts` (the `item_components` columns: `item_id, component_sku_id, component_item_id, quantity, unit`), `lib/recipe-math.ts` (`skuContentOz`), `lib/admin/cost.ts` (`loadCurrentSkuPrices`), and `lib/session.ts` (`AuthContext` — `user.id`/`user.role`/`locations`).

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_production.ts` (creates a temp item_components edge if needed, records a production, asserts, cleans up):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordProduction, predictOutput, loadProductionFormData, type RecordProductionInput } from "@/lib/production";

function log(l: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${l} ${extra}`); if (!ok) process.exitCode = 1; }

void (async () => {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: sku } = await sb.from("vendor_items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: item } = await sb.from("items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!loc || !sku || !item) { console.log("missing fixtures", { loc, sku, item }); return; }
  const { data: cgs } = await sb.from("users").select("id, role").eq("role", "cgs").limit(1).maybeSingle<{ id: string; role: string }>();
  const actor = { user: { id: cgs!.id, role: cgs!.role }, locations: [] as string[] } as any;

  // Ensure an item_components edge sku→item exists (temp, cleaned up).
  const { data: existingEdge } = await sb.from("item_components").select("id").eq("item_id", item.id).eq("component_sku_id", sku.id).maybeSingle<{ id: string }>();
  let tempEdgeId: string | null = null;
  if (!existingEdge) {
    const { data: ins } = await sb.from("item_components").insert({ item_id: item.id, component_sku_id: sku.id, quantity: 1, unit: "oz", display_order: 99 }).select("id").maybeSingle<{ id: string }>();
    tempEdgeId = ins?.id ?? null;
  }

  const input: RecordProductionInput = { locationId: loc.id, inputSkuId: sku.id, inputQty: 1, outputItemId: item.id, outputQty: 4 };
  const { productionId } = await recordProduction(actor, input);
  log("production created", !!productionId, productionId);

  const pred = await predictOutput(actor, { inputSkuId: sku.id, outputItemId: item.id, inputQty: 2 });
  log("predict after 1 obs = 2×(4/1)=8", pred.predicted === 8, `predicted=${pred.predicted}`);

  const form = await loadProductionFormData(actor, loc.id);
  log("form skus present", form.skus.length >= 1);
  log("skuToItems maps our sku→item", (form.skuToItems[sku.id] ?? []).some((it) => it.itemId === item.id), JSON.stringify(form.skuToItems[sku.id] ?? []));

  // cleanup
  await sb.from("productions").delete().eq("id", productionId);
  if (tempEdgeId) await sb.from("item_components").delete().eq("id", tempEdgeId);
  console.log("cleaned up");
})();
```

- [ ] **Step 3: Run — verify FAIL** (`npx tsx --env-file=.env.local scripts/_smoke_production.ts` → module missing).

- [ ] **Step 4: Create `lib/production.ts`**:
```ts
/**
 * Operational production-capture data layer (Item/Inventory Spine — S1). SERVER-ONLY,
 * service-role; app-layer KH+ (≥4) gate + location-bind IDOR (mirrors lib/receiving.ts).
 * Records SKU→item conversions: depletes the SKU (consumption signal), credits the item,
 * and feeds the running-average yield prediction.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const PRODUCE_MIN = 4; // key_holder+

export class ProductionError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "ProductionError";
  }
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireProduce(actor: AuthContext): void {
  if (getRoleLevel(actor.user.role) < PRODUCE_MIN) throw new ProductionError(403, "forbidden", "Insufficient role level to log production");
}
function actorLoc(actor: AuthContext): LocationActor { return { role: actor.user.role, locations: actor.locations }; }

export interface RecordProductionInput {
  locationId: string;
  inputSkuId: string;
  inputQty: number;
  outputItemId: string;
  outputQty: number;
  notes?: string | null;
}
export interface ProductionFormData {
  skus: Array<{ id: string; name: string; inStockPacks: number }>;
  /** SKU id → the items makeable from it (direct item_components reverse edge). */
  skuToItems: Record<string, Array<{ itemId: string; name: string }>>;
}
export interface ProductionView {
  id: string;
  producedAt: string;
  skuName: string;
  itemName: string;
  inputQty: number;
  outputQty: number;
}

/** Items makeable from each SKU = item_components rows with component_sku_id set. */
async function loadSkuToItems(skuIds: string[]): Promise<Record<string, Array<{ itemId: string; name: string }>>> {
  const out: Record<string, Array<{ itemId: string; name: string }>> = {};
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: edges } = await sb.from("item_components").select("item_id, component_sku_id").in("component_sku_id", skuIds).not("component_sku_id", "is", null)
    .returns<Array<{ item_id: string; component_sku_id: string }>>();
  const itemIds = [...new Set((edges ?? []).map((e) => e.item_id))];
  const nameById = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items } = await sb.from("items").select("id, name").in("id", itemIds).eq("active", true).returns<Array<{ id: string; name: string }>>();
    for (const it of items ?? []) nameById.set(it.id, it.name);
  }
  for (const e of edges ?? []) {
    const name = nameById.get(e.item_id);
    if (!name) continue; // inactive item
    const list = out[e.component_sku_id] ?? (out[e.component_sku_id] = []);
    if (!list.some((x) => x.itemId === e.item_id)) list.push({ itemId: e.item_id, name });
  }
  return out;
}

/** received packs − consumed packs, per SKU (for the form's in-stock hint). */
async function loadInStockPacks(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: recv } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received").in("vendor_item_id", skuIds).returns<Array<{ vendor_item_id: string; qty_received: number | string }>>();
  const { data: cons } = await sb.from("productions").select("input_sku_id, input_qty").in("input_sku_id", skuIds).returns<Array<{ input_sku_id: string; input_qty: number | string }>>();
  for (const id of skuIds) out.set(id, 0);
  for (const r of recv ?? []) out.set(r.vendor_item_id, (out.get(r.vendor_item_id) ?? 0) + (num(r.qty_received) ?? 0));
  for (const c of cons ?? []) out.set(c.input_sku_id, (out.get(c.input_sku_id) ?? 0) - (num(c.input_qty) ?? 0));
  return out;
}

export async function loadProductionFormData(actor: AuthContext, locationId: string): Promise<ProductionFormData> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`loadProductionFormData skus: ${error.message}`);
  const ids = (skus ?? []).map((s) => s.id);
  const [skuToItems, inStock] = await Promise.all([loadSkuToItems(ids), loadInStockPacks(ids)]);
  return {
    skus: (skus ?? []).map((s) => ({ id: s.id, name: s.name, inStockPacks: inStock.get(s.id) ?? 0 })),
    skuToItems,
  };
}

/** Advisory: predicted output for a (sku→item) pair at inputQty = inputQty × mean(output/input) over past productions; null if none. */
export async function predictOutput(actor: AuthContext, args: { inputSkuId: string; outputItemId: string; inputQty: number }): Promise<{ predicted: number | null }> {
  requireProduce(actor);
  if (!Number.isFinite(args.inputQty) || args.inputQty <= 0) return { predicted: null };
  const sb = getServiceRoleClient();
  const { data: past } = await sb.from("productions").select("input_qty, output_qty").eq("input_sku_id", args.inputSkuId).eq("output_item_id", args.outputItemId)
    .returns<Array<{ input_qty: number | string; output_qty: number | string }>>();
  const ratios = (past ?? []).map((p) => { const i = num(p.input_qty) ?? 0; const o = num(p.output_qty) ?? 0; return i > 0 ? o / i : null; }).filter((r): r is number => r != null);
  if (ratios.length === 0) return { predicted: null };
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return { predicted: args.inputQty * mean };
}

export async function recordProduction(actor: AuthContext, input: RecordProductionInput): Promise<{ productionId: string }> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new ProductionError(404, "not_found", "Location not found");
  if (!Number.isFinite(input.inputQty) || input.inputQty <= 0) throw new ProductionError(400, "invalid_input_qty", "Input qty must be positive");
  if (!Number.isFinite(input.outputQty) || input.outputQty <= 0) throw new ProductionError(400, "invalid_output_qty", "Output qty must be positive");
  const sb = getServiceRoleClient();
  const { data: sku } = await sb.from("vendor_items").select("id").eq("id", input.inputSkuId).eq("active", true).maybeSingle<{ id: string }>();
  if (!sku) throw new ProductionError(400, "invalid_sku", "SKU not found or inactive");
  const { data: item } = await sb.from("items").select("id").eq("id", input.outputItemId).eq("active", true).maybeSingle<{ id: string }>();
  if (!item) throw new ProductionError(400, "invalid_item", "Item not found or inactive");
  const { data: edge } = await sb.from("item_components").select("id").eq("item_id", input.outputItemId).eq("component_sku_id", input.inputSkuId).maybeSingle<{ id: string }>();
  if (!edge) throw new ProductionError(400, "invalid_conversion", "That item is not made from that SKU");

  const { data: row, error } = await sb.from("productions").insert({
    location_id: input.locationId, input_sku_id: input.inputSkuId, input_qty: input.inputQty,
    output_item_id: input.outputItemId, output_qty: input.outputQty, notes: input.notes?.trim() || null, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordProduction insert: ${error.message}`);
  if (!row) throw new Error("recordProduction returned no row");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "production.recorded",
    resourceTable: "productions", resourceId: row.id,
    metadata: { location_id: input.locationId, input_sku_id: input.inputSkuId, input_qty: input.inputQty, output_item_id: input.outputItemId, output_qty: input.outputQty, observed_yield: input.outputQty / input.inputQty },
    ipAddress: null, userAgent: null,
  });
  return { productionId: row.id };
}

export async function loadRecentProductions(actor: AuthContext, locationId: string, limit = 20): Promise<ProductionView[]> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("productions").select("id, produced_at, input_sku_id, input_qty, output_item_id, output_qty")
    .eq("location_id", locationId).order("produced_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; produced_at: string; input_sku_id: string; input_qty: number | string; output_item_id: string; output_qty: number | string }>>();
  if (error) throw new Error(`loadRecentProductions: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];
  const skuIds = [...new Set(list.map((r) => r.input_sku_id))];
  const itemIds = [...new Set(list.map((r) => r.output_item_id))];
  const [{ data: skus }, { data: items }] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>(),
  ]);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  return list.map((r) => ({
    id: r.id, producedAt: r.produced_at, skuName: skuName.get(r.input_sku_id) ?? "(sku)", itemName: itemName.get(r.output_item_id) ?? "(item)",
    inputQty: num(r.input_qty) ?? 0, outputQty: num(r.output_qty) ?? 0,
  }));
}
```

- [ ] **Step 5: Run smoke — all PASS + "cleaned up".** **Step 6: `npx tsc --noEmit`** — clean.
- [ ] **Step 7: Commit**
```bash
git add lib/production.ts scripts/_smoke_production.ts
git commit -m "feat(production): production data layer (record, predict, form-data)"
```

---

## Task 3: `loadSkuConsumption` in `lib/admin/cost.ts`

**Files:** Modify `lib/admin/cost.ts`

- [ ] **Step 1: Re-read** `lib/admin/cost.ts` `loadSkuReceivingLedger` (the exact composition: `loadCurrentSkuPrices` + `loadMeasureUnits` + `skuContentOz` + `num`) — mirror it.

- [ ] **Step 2: Add** (near `loadSkuReceivingLedger`):
```ts
export interface SkuConsumption { consumedOz: number; consumedDollars: number; }

/**
 * Per-SKU consumption from production (S1): Σ input_qty × content_oz (oz) and × cost/oz ($).
 * (input_qty is in the SKU's pack unit; content_oz is oz-per-pack, so oz = input_qty × content_oz.)
 */
export async function loadSkuConsumption(actor: AuthContext, skuIds: string[]): Promise<Map<string, SkuConsumption>> {
  requireLevel(actor, COST_READ_MIN);
  const out = new Map<string, SkuConsumption>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: prod, error } = await sb.from("productions").select("input_sku_id, input_qty").in("input_sku_id", skuIds).returns<Array<{ input_sku_id: string; input_qty: number | string }>>();
  if (error) throw new Error(`loadSkuConsumption: ${error.message}`);
  const prices = await loadCurrentSkuPrices(skuIds);
  const measures = await loadMeasureUnits(actor);
  const measuresMap = new Map<string, MeasureUnitFactor>(measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]));
  const { data: skuRows } = await sb.from("vendor_items").select("id, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", skuIds)
    .returns<Array<{ id: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const contentOzById = new Map<string, number | null>((skuRows ?? []).map((s) => [s.id, skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) }, measuresMap)]));
  for (const id of skuIds) out.set(id, { consumedOz: 0, consumedDollars: 0 });
  for (const p of prod ?? []) {
    const c = out.get(p.input_sku_id); if (!c) continue;
    const qty = num(p.input_qty) ?? 0;
    const contentOz = contentOzById.get(p.input_sku_id) ?? null;
    const price = prices.get(p.input_sku_id) ?? null;
    if (contentOz != null) c.consumedOz += qty * contentOz;
    if (price != null) c.consumedDollars += qty * price;
  }
  return out;
}
```
- [ ] **Step 3: `npx tsc --noEmit`** — clean. **Step 4: Commit**
```bash
git add lib/admin/cost.ts
git commit -m "feat(production): loadSkuConsumption (consumed oz/\$ per SKU)"
```

---

## Task 4: Routes (record + predict)

**Files:** Create `app/api/operations/production/route.ts` + `app/api/operations/production/predict/route.ts`

- [ ] **Step 1: Re-read** `app/api/operations/receiving/route.ts` (gating pattern to mirror) + `lib/production.ts` signatures.
- [ ] **Step 2: `app/api/operations/production/route.ts`** (record, KH+ ≥4):
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordProduction, ProductionError, type RecordProductionInput } from "@/lib/production";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/production");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");
  const b = parsed as Partial<RecordProductionInput>;
  if (typeof b.locationId !== "string" || typeof b.inputSkuId !== "string" || typeof b.outputItemId !== "string" || typeof b.inputQty !== "number" || typeof b.outputQty !== "number") {
    return jsonError(400, "invalid_payload");
  }
  try {
    const res = await recordProduction(ctx, b as RecordProductionInput);
    return jsonOk({ productionId: res.productionId }, 201);
  } catch (e) {
    if (e instanceof ProductionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```
- [ ] **Step 3: `app/api/operations/production/predict/route.ts`** (advisory, KH+):
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { predictOutput, ProductionError } from "@/lib/production";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/production/predict");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");
  const b = parsed as { inputSkuId?: unknown; outputItemId?: unknown; inputQty?: unknown };
  if (typeof b.inputSkuId !== "string" || typeof b.outputItemId !== "string" || typeof b.inputQty !== "number") return jsonError(400, "invalid_payload");
  try {
    const res = await predictOutput(ctx, { inputSkuId: b.inputSkuId, outputItemId: b.outputItemId, inputQty: b.inputQty });
    return jsonOk({ predicted: res.predicted });
  } catch (e) {
    if (e instanceof ProductionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```
- [ ] **Step 4: `npx tsc --noEmit`** — clean. **Step 5: Commit**
```bash
git add app/api/operations/production/route.ts app/api/operations/production/predict/route.ts
git commit -m "feat(production): record + predict routes (KH+)"
```

---

## Task 5: i18n (EN + ES) — before the UI

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: EN keys**:
```json
"production.page.title": "Production",
"production.page.recent": "Recent production",
"production.page.none": "No production logged yet.",
"production.form.title": "Log a conversion",
"production.form.sku": "Raw item (SKU)",
"production.form.pick_sku": "Pick a SKU…",
"production.form.in_stock": "in stock",
"production.form.makes": "Makes",
"production.form.pick_item": "Pick what you made…",
"production.form.input_qty": "Amount used (packs)",
"production.form.predicted": "Predicted output",
"production.form.output_qty": "Amount made",
"production.form.notes": "Notes",
"production.form.submit": "Log production",
"production.recent.line": "{input} → {output}",
"production.error.invalid_payload": "Fill in the SKU, item, and amounts.",
"production.error.invalid_input_qty": "Amount used must be a positive number.",
"production.error.invalid_output_qty": "Amount made must be a positive number.",
"production.error.invalid_sku": "That SKU isn't available.",
"production.error.invalid_item": "That item isn't available.",
"production.error.invalid_conversion": "That item isn't made from that SKU.",
"production.error.not_found": "Not found.",
"production.error.forbidden": "You don't have permission to log production.",
"production.error.generic": "Something went wrong — try again.",
"dashboard.production.tile_label": "Production",
"dashboard.production.hint": "Log what you converted from raw stock.",
"dashboard.production.cta": "Log production",
"admin.skus.stock.in_stock": "In stock (est.)"
```
- [ ] **Step 2: ES keys** (tú-form):
```json
"production.page.title": "Producción",
"production.page.recent": "Producción reciente",
"production.page.none": "Aún no se ha registrado producción.",
"production.form.title": "Registrar una conversión",
"production.form.sku": "Materia prima (SKU)",
"production.form.pick_sku": "Elige un SKU…",
"production.form.in_stock": "en existencia",
"production.form.makes": "Hace",
"production.form.pick_item": "Elige lo que hiciste…",
"production.form.input_qty": "Cantidad usada (paquetes)",
"production.form.predicted": "Salida estimada",
"production.form.output_qty": "Cantidad hecha",
"production.form.notes": "Notas",
"production.form.submit": "Registrar producción",
"production.recent.line": "{input} → {output}",
"production.error.invalid_payload": "Llena el SKU, el artículo y las cantidades.",
"production.error.invalid_input_qty": "La cantidad usada debe ser un número positivo.",
"production.error.invalid_output_qty": "La cantidad hecha debe ser un número positivo.",
"production.error.invalid_sku": "Ese SKU no está disponible.",
"production.error.invalid_item": "Ese artículo no está disponible.",
"production.error.invalid_conversion": "Ese artículo no se hace de ese SKU.",
"production.error.not_found": "No encontrado.",
"production.error.forbidden": "No tienes permiso para registrar producción.",
"production.error.generic": "Algo salió mal — inténtalo de nuevo.",
"dashboard.production.tile_label": "Producción",
"dashboard.production.hint": "Registra lo que convertiste de la materia prima.",
"dashboard.production.cta": "Registrar producción",
"admin.skus.stock.in_stock": "En existencia (est.)"
```
- [ ] **Step 3: Parity**
```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=new Set(Object.keys(es));const m=a.filter(k=>!b.has(k));const r=Object.keys(es).filter(k=>!new Set(a).has(k));console.log(m.length||r.length?('MISS ES:'+m.join(',')+'|EXTRA ES:'+r.join(',')):'parity ok '+a.length)"
```
Expected: `parity ok …`.
- [ ] **Step 4: Commit**
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(production): i18n EN+ES"
```

---

## Task 6: `ProductionForm` client (SKU→item cascade + predict)

**Files:** Create `components/production/ProductionForm.tsx`

- [ ] **Step 1: Re-read** `components/receiving/ReceivingForm.tsx` (form pattern: `useTranslation`/`useRouter`/fetch-post/`j.code` error) + `lib/production.ts` `ProductionFormData`.
- [ ] **Step 2: Implement** — SKU `<select>`; when a SKU is chosen, the item `<select>` populates from `formData.skuToItems[skuId]`; input-qty; on (sku+item+inputQty) set, POST `/api/operations/production/predict` and show the predicted output as the editable default of the output field; notes; submit POSTs `/api/operations/production`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { ProductionFormData } from "@/lib/production";

const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

export function ProductionForm({ formData, locationId }: { formData: ProductionFormData; locationId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [skuId, setSkuId] = useState("");
  const [itemId, setItemId] = useState("");
  const [inputQty, setInputQty] = useState("");
  const [outputQty, setOutputQty] = useState("");
  const [predicted, setPredicted] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = skuId ? (formData.skuToItems[skuId] ?? []) : [];
  const num = (s: string): number | null => { const v = s.trim(); return v === "" ? null : Number(v); };

  const refreshPredict = async (sId: string, iId: string, qStr: string) => {
    const q = num(qStr);
    if (!sId || !iId || q == null || !(q > 0)) { setPredicted(null); return; }
    const res = await fetch("/api/operations/production/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputSkuId: sId, outputItemId: iId, inputQty: q }) });
    if (!res.ok) { setPredicted(null); return; }
    const j = await res.json().catch(() => ({ predicted: null }));
    const p = typeof j?.predicted === "number" ? j.predicted : null;
    setPredicted(p);
    if (p != null && outputQty.trim() === "") setOutputQty(String(Number(p.toFixed(2)))); // prefill only when empty
  };

  const canSubmit = skuId !== "" && itemId !== "" && num(inputQty) != null && num(outputQty) != null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    const res = await fetch("/api/operations/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId, inputSkuId: skuId, inputQty: Number(inputQty), outputItemId: itemId, outputQty: Number(outputQty), notes: notes.trim() || null }) });
    setBusy(false);
    if (res.ok) { router.refresh(); setSkuId(""); setItemId(""); setInputQty(""); setOutputQty(""); setPredicted(null); setNotes(""); }
    else { const j = await res.json().catch(() => ({} as { code?: string })); setErr(t(("production.error." + (j?.code ?? "generic")) as never)); }
  };

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("production.form.title")}</h2>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("production.form.sku")}</span>
        <select className={field} value={skuId} disabled={busy} onChange={(e) => { setSkuId(e.target.value); setItemId(""); setPredicted(null); }}>
          <option value="">{t("production.form.pick_sku")}</option>
          {formData.skus.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.inStockPacks} {t("production.form.in_stock")})</option>)}
        </select>
      </label>
      {skuId ? (
        <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("production.form.makes")}</span>
          <select className={field} value={itemId} disabled={busy} onChange={(e) => { setItemId(e.target.value); void refreshPredict(skuId, e.target.value, inputQty); }}>
            <option value="">{t("production.form.pick_item")}</option>
            {items.map((it) => <option key={it.itemId} value={it.itemId}>{it.name}</option>)}
          </select>
        </label>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block"><span className="text-sm font-bold text-co-text">{t("production.form.input_qty")}</span>
          <input className={field} type="number" min={0} step="any" inputMode="decimal" value={inputQty} disabled={busy} onChange={(e) => { setInputQty(e.target.value); void refreshPredict(skuId, itemId, e.target.value); }} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("production.form.output_qty")}{predicted != null ? ` · ${t("production.form.predicted")}: ${Number(predicted.toFixed(2))}` : ""}</span>
          <input className={field} type="number" min={0} step="any" inputMode="decimal" value={outputQty} disabled={busy} onChange={(e) => setOutputQty(e.target.value)} /></label>
      </div>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("production.form.notes")}</span>
        <textarea className={`${field} min-h-[60px] py-2`} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} /></label>
      {err ? <p className="mt-3 text-sm text-co-cta">{err}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("production.form.submit")}</button>
      </div>
    </div>
  );
}
```
- [ ] **Step 3: `npx tsc --noEmit`** — clean. **Step 4: Commit**
```bash
git add components/production/ProductionForm.tsx
git commit -m "feat(production): ProductionForm (SKU→item cascade + predicted output)"
```

---

## Task 7: Production page + dashboard tile

**Files:** Create `app/(authed)/operations/production/page.tsx` + `components/production/ProductionTile.tsx`; Modify `app/(authed)/dashboard/page.tsx`

- [ ] **Step 1: Re-read** `app/(authed)/operations/receiving/page.tsx` (page auth + recent list) + `components/receiving/ReceivingTile.tsx` + the dashboard `ReceivingTile` wiring (the `ReportsSection` gate `|| auth.level >= 4` + the per-location tile render).
- [ ] **Step 2: `app/(authed)/operations/production/page.tsx`** (mirror the receiving page):
```tsx
import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadProductionFormData, loadRecentProductions } from "@/lib/production";
import { ProductionForm } from "@/components/production/ProductionForm";
import { DashboardBackLink } from "@/components/DashboardBackLink";

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/production");
  const { location } = await searchParams;
  if (auth.level < 4) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");
  const lang = auth.user.language;
  const [formData, recent] = await Promise.all([loadProductionFormData(auth, location), loadRecentProductions(auth, location, 20)]);
  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "production.page.title")}</h1>
      <ProductionForm formData={formData} locationId={location} />
      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "production.page.recent")}</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "production.page.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {recent.map((p) => (
            <li key={p.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-co-text">{serverT(lang, "production.recent.line", { input: `${p.inputQty} ${p.skuName}`, output: `${p.outputQty} ${p.itemName}` })}</span>
                <span className="text-xs text-co-text-muted">{p.producedAt.slice(0, 10)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```
- [ ] **Step 3: `components/production/ProductionTile.tsx`** — copy `ReceivingTile.tsx` structure, swap keys to `dashboard.production.*` and the href to `/operations/production?location=${locationId}`.
- [ ] **Step 4: Dashboard** — import `ProductionTile`; render it right after `ReceivingTile` inside `ReportsSection`, gated `{auth.level >= 4 ? <ProductionTile language={language} locationId={selectedLocation.id} /> : null}` (the `ReportsSection` visibility already includes `|| auth.level >= 4` from R3).
- [ ] **Step 5: `npx tsc --noEmit && npm run build`** — clean. **Step 6: Commit**
```bash
git add "app/(authed)/operations/production/page.tsx" components/production/ProductionTile.tsx "app/(authed)/dashboard/page.tsx"
git commit -m "feat(production): /operations/production page + dashboard tile"
```

---

## Task 8: SkuCostPanel In-stock line + thread `skuConsumption`

**Files:** Modify `components/admin/skus/SkuCostPanel.tsx`, `app/admin/skus/page.tsx`, `app/admin/vendors/[id]/page.tsx`, `components/admin/skus/SkuCatalogClient.tsx`, `components/admin/skus/VendorSkusCard.tsx`, `components/admin/vendors/VendorDetailClient.tsx`

- [ ] **Step 1: Re-read** `SkuCostPanel.tsx` (the R3.5 `ledger` prop + Deliveries block), and how `skuLedger` threads from both pages + clients (Task mirrors that exactly with a parallel `skuConsumption`).

- [ ] **Step 2: SkuCostPanel** — import `import type { SkuConsumption } from "@/lib/admin/cost";`; add prop `consumption: SkuConsumption | null;`. Inside the existing `ledger && ...` Deliveries block (or right above it), add an **In stock** line using received (ledger) − consumed:
```tsx
{ledger ? (
  <p className="text-co-text">
    {t("admin.skus.stock.in_stock")}: <span className="font-bold">≈ {Math.round(ledger.receivedOz - (consumption?.consumedOz ?? 0))} oz</span>
    <span className="text-co-text-muted"> · ${(ledger.receivedDollars - (consumption?.consumedDollars ?? 0)).toFixed(2)}</span>
  </p>
) : null}
```
(Place it as the first line inside the `ledger`-guarded `<div className="mt-2 border-t-2 ...">`, above the `Received` line. If the In-stock line should show even when there are no deliveries but there IS consumption, keep it inside the existing `ledger && (deliveries.length>0 || receivedDollars>0)` guard — acceptable for this slice since consumption without any receipt is an edge case.)

- [ ] **Step 3: Thread from both pages** (`app/admin/skus/page.tsx`, `app/admin/vendors/[id]/page.tsx`): import `loadSkuConsumption`; after the `skuLedger` build add:
```ts
const consumptionMap = await loadSkuConsumption(auth, skus.map((s) => s.id));
const skuConsumption: Record<string, import("@/lib/admin/cost").SkuConsumption> = Object.fromEntries([...consumptionMap.entries()]);
```
pass `skuConsumption={skuConsumption}` to the client (`SkuCatalogClient` / `VendorDetailClient`).

- [ ] **Step 4: Thread through clients** — `SkuCatalogClient.tsx`, `VendorSkusCard.tsx`, `VendorDetailClient.tsx`: add prop `skuConsumption: Record<string, SkuConsumption>;` (import `SkuConsumption` from `@/lib/admin/cost`), and pass `consumption={skuConsumption[s.id] ?? null}` on each `<SkuCostPanel>` (mirror how `ledger={skuLedger[s.id] ?? null}` threads). In `VendorDetailClient`, pass `skuConsumption` down to `VendorSkusCard` next to `skuLedger`.

- [ ] **Step 5: `npx tsc --noEmit && npm run build`** — clean. **Step 6: Commit**
```bash
git add components/admin/skus/SkuCostPanel.tsx app/admin/skus/page.tsx "app/admin/vendors/[id]/page.tsx" components/admin/skus/SkuCatalogClient.tsx components/admin/skus/VendorSkusCard.tsx components/admin/vendors/VendorDetailClient.tsx
git commit -m "feat(production): SKU in-stock line (received − consumed)"
```

---

## Task 9: Smoke + delete

- [ ] **Step 1: Re-run** `npx tsx --env-file=.env.local scripts/_smoke_production.ts` — all PASS + "cleaned up".
- [ ] **Step 2: Delete + commit**
```bash
git rm -f scripts/_smoke_production.ts
git commit -m "chore(production): remove throwaway smoke"
```

---

## Task 10: PR

- [ ] **Step 1: Final gate** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 2: Push + PR**
```bash
git push -u origin claude/production-capture
gh pr create --title "Production capture (S1)" --body "$(cat <<'EOF'
Production capture (spec 2026-07-01), signal S1 of the consumption engine. Migration
0101 (productions). New lib/production.ts (KH+ + location-bind): SKU→item conversion
capture — pick SKU → items it makes → input qty → predicted output (running-avg yield)
→ confirm/edit; depletes SKU, credits item. loadSkuConsumption + a real In-stock line
(received − consumed) on the SKU panel. New /operations/production page + tile. NO
AM-prep change (folding into prep = follow-up).

Test (preview URL): AM-prep / mid-day / Opening / closing render identical. Then from the
Production tile: pick a SKU → the item it makes → enter amount used → see a predicted
output → confirm → it lands in recent production and the SKU's In-stock number on
/admin/skus drops.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
- [ ] **Step 3: After Juan smokes + merges** — no post-deploy step (0101 additive).

---

## Self-Review

**Spec coverage:** §2 flow → Task 6; §3 conversion effects → Task 2 (record) + §3a predict → Task 2; §4 schema → Task 1; §5 in-stock + `loadSkuConsumption` → Tasks 3/8; §6 lib → Task 2; §7 routes/page/tile → Tasks 4/7; §8 verification → Tasks 2/5/9. ✔

**Deviations (flagged):** (1) prediction from running-avg observed yield only (the §3a recipe-fallback is left as a null-return when no observations — the recipe-derived fallback is deferred to keep predictOutput simple; first conversion just seeds). (2) In-stock line renders inside the R3.5 `ledger`-guarded block (consumption-without-any-receipt is an edge case). (3) `loadInStockPacks` sums raw `qty_received − input_qty` in pack units for the form hint (received-packs − consumed-packs) — a coarse count, distinct from the oz/$ in-stock on the panel.

**Placeholder scan:** none — all code literal. Task 7 Step 3/4 (tile copy + dashboard wiring) + Task 8 threading are "mirror the R3/R3.5 pattern" confirm-before-authoring points.

**Type consistency:** `RecordProductionInput`/`ProductionFormData`/`ProductionView` (Task 2) ↔ routes (Task 4) ↔ form (Task 6) ↔ page (Task 7). `SkuConsumption` (Task 3) ↔ `SkuCostPanel` `consumption` prop (Task 8) ↔ page `skuConsumption` ↔ client threading. `PRODUCE_MIN=4` ↔ route `<4` ↔ page `auth.level<4` ↔ tile `>=4`. `num()` coercion throughout. ✔
