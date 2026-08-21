/**
 * Admin cost/yield data layer (Item/Inventory Spine — R2). SERVER-ONLY,
 * service-role; authority re-checked per write. Composes R1's pure recipe-math
 * with prices from the append-only vendor_price_history ledger.
 *
 * ── EVERY content_oz IN THIS MODULE IS CHAIN-AWARE (2026-08-21) ──────────────
 *
 * `skuContentOz` resolves a SKU's ounces from its active PACK CHAIN when it has
 * one and falls back to the legacy flat trio (units_per_pack × each_size ×
 * oz-per-measure) only when it does not. Every derivation here used to omit the
 * chain, so all three numbers this module produces — the $/oz on /admin/skus and
 * /admin/vendors/[id], the received-oz ledger, and consumed dollars — rode the
 * LEGACY path while lib/admin/menu-costing.ts's board derived from
 * `graph.skuPack`, which carries the chain. Two derivations, one SKU.
 *
 * They agree in production TODAY (CC verified all 182 SKUs, 63 of them chained,
 * 2026-08-21: zero divergence) — but only because `replaceSkuPackChain` writes a
 * compensating flat-field mirror on every chain save. That mirror is explicitly a
 * stopgap, it is NON-FATAL on failure ("chain saved; flat fields stale"), and the
 * ordinary SKU edit path writes `units_per_pack` directly without touching the
 * chain. So the agreement is one failed sync or one flat-field edit away from
 * breaking, and when it breaks it is silent, permanent, and splits the cost board
 * from the catalog screens on the same SKU.
 *
 * The fix is to stop having two derivations: the chain is threaded in here, so
 * these screens ride the same oz resolution as the flatten and the board — same
 * nulls in the same places. `computeSkuCostPerOz` takes the chain map as a
 * REQUIRED argument on purpose; an optional one is exactly how the blindness
 * would come back the first time a new caller forgot it.
 *
 * NOT routed through the board's own `costPerOzFromGraph` instead, deliberately:
 * `graph.skuPack` only hydrates the SKUs the RECIPE UNIVERSE references (64 of
 * 182 live), and these screens list the whole catalog. Borrowing the board's map
 * would leave 118 SKUs uncosted on a page whose job is to cost them.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasureUnits } from "@/lib/admin/skus";
import { loadSkuPackChains } from "@/lib/prep-consumption";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
// The PURE half lives in cost-shared.ts (the house *-shared law) so the
// derivation is test-pinnable; re-exported here so server consumers' import
// paths are unchanged.
import { contentOzForSku } from "@/lib/admin/cost-shared";

export {
  computeSkuCostPerOz,
  contentOzForSku,
  measureFactorMap,
  type SkuChainMap,
  type SkuCostShape,
} from "@/lib/admin/cost-shared";

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
  // Paginate past PostgREST's 1000-row cap: vendor_price_history is append-only
  // and grows per delivery line, so a raw scan silently drops SKUs whose latest
  // price row falls past row 1000 → they read "unpriced" (wrong readiness/cost).
  // `id` is the unique tiebreaker that makes the newest-first order a total order.
  // (Follow-up: a DISTINCT ON (vendor_item_id) RPC avoids loading history at all.)
  const data = await selectAllRows<{ vendor_item_id: string; unit_price: number | string; effective_date: string; recorded_at: string | null }>(
    (from, to) => sb
      .from("vendor_price_history")
      .select("vendor_item_id, unit_price, effective_date, recorded_at")
      .in("vendor_item_id", skuIds)
      .order("effective_date", { ascending: false })
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  for (const r of data) {
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

/**
 * content_oz per SKU for this module's own loaders, chain-aware — the ONE
 * derivation `loadSkuReceivingLedger` and `loadSkuConsumption` share.
 *
 * They read their own `vendor_items` rows (they are called with a SKU id list,
 * not a hydrated SkuView[]), so they cannot take the pages' chain map; they load
 * it themselves. Two queries, both batched over the whole id list — never
 * per-SKU (the loadRecipeGraph law). The per-SKU math is `contentOzForSku` from
 * cost-shared, the same one `computeSkuCostPerOz` uses: the three dollar figures
 * this module produces must move together, because a $/oz that is chain-aware
 * while consumed-dollars is not would put two disagreeing numbers in the SAME
 * drawer.
 */
async function loadChainAwareContentOz(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  measuresMap: Map<string, MeasureUnitFactor>,
): Promise<Map<string, number | null>> {
  if (skuIds.length === 0) return new Map();
  const [{ data: skuRows }, chains] = await Promise.all([
    sb.from("vendor_items").select("id, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", skuIds)
      .returns<Array<{ id: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>(),
    loadSkuPackChains(skuIds),
  ]);
  return new Map<string, number | null>(
    (skuRows ?? []).map((s) => [
      s.id,
      contentOzForSku(
        { unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) },
        chains.get(s.id) ?? null,
        measuresMap,
      ),
    ]),
  );
}


/** Transitive reverse over the RECIPE graph: every output item that uses `skuId`
 * directly (recipe_inputs.component_sku_id) or through a sub-item input. Names only.
 *
 * PRODUCT PINS COUNT FOR EVERY MEMBER (0179). A recipe that pins HAM genuinely uses
 * both hams — which one it means on a given day is the resolution's business, not
 * this map's. Without this, a re-pointed SKU drops out of its own usage map and the
 * SKU editor reports it as unused (the quiet reader). */
export async function loadSkuUsageMap(): Promise<Map<string, string[]>> {
  const sb = getServiceRoleClient();
  const { data: ins, error: e1 } = await sb.from("recipe_inputs").select("recipe_id, component_sku_id, component_item_id, component_product_id")
    .returns<Array<{ recipe_id: string; component_sku_id: string | null; component_item_id: string | null; component_product_id: string | null }>>();
  if (e1) throw new Error(`loadSkuUsageMap inputs: ${e1.message}`);
  const pinnedProductIds = [...new Set((ins ?? []).map((i) => i.component_product_id).filter((v): v is string => v != null))];
  const membersByProduct = new Map<string, string[]>();
  if (pinnedProductIds.length > 0) {
    const { data: members, error: mErr } = await sb.from("vendor_items").select("id, product_id")
      .in("product_id", pinnedProductIds)
      .returns<Array<{ id: string; product_id: string | null }>>();
    if (mErr) throw new Error(`loadSkuUsageMap members: ${mErr.message}`);
    for (const m of members ?? []) {
      if (m.product_id == null) continue;
      const list = membersByProduct.get(m.product_id) ?? [];
      list.push(m.id);
      membersByProduct.set(m.product_id, list);
    }
  }
  const { data: outs, error: e2 } = await sb.from("recipe_outputs").select("recipe_id, output_item_id").not("output_item_id", "is", null)
    .returns<Array<{ recipe_id: string; output_item_id: string }>>();
  if (e2) throw new Error(`loadSkuUsageMap outputs: ${e2.message}`);

  const outItemsOfRecipe = new Map<string, string[]>();
  for (const o of outs ?? []) { const l = outItemsOfRecipe.get(o.recipe_id) ?? []; l.push(o.output_item_id); outItemsOfRecipe.set(o.recipe_id, l); }
  const recipesUsingSku = new Map<string, Set<string>>();
  const recipesUsingItem = new Map<string, Set<string>>();
  for (const i of ins ?? []) {
    if (i.component_sku_id) { const s = recipesUsingSku.get(i.component_sku_id) ?? new Set(); s.add(i.recipe_id); recipesUsingSku.set(i.component_sku_id, s); }
    if (i.component_item_id) { const s = recipesUsingItem.get(i.component_item_id) ?? new Set(); s.add(i.recipe_id); recipesUsingItem.set(i.component_item_id, s); }
    if (i.component_product_id) {
      for (const skuId of membersByProduct.get(i.component_product_id) ?? []) {
        const s = recipesUsingSku.get(skuId) ?? new Set(); s.add(i.recipe_id); recipesUsingSku.set(skuId, s);
      }
    }
  }

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

export interface SkuReceivingLedger {
  receivedDollars: number;
  receivedOz: number;
  unpricedLineCount: number;
  missingOzLineCount: number;
  deliveries: Array<{ deliveryId: string; date: string; vendorName: string; qty: number; unitPrice: number | null }>;
}

/**
 * Per-SKU RECEIVED ledger (R3.5, AGM+): running $ + oz received to date + delivery
 * history. $ = Σ qty × (line price ?? current SKU price); oz = Σ qty × content_oz.
 * Lines missing a price / an oz basis are excluded and counted (honest under-count).
 * Received-to-date, NOT true on-hand (R4 = received − counted).
 */
export async function loadSkuReceivingLedger(actor: AuthContext, skuIds: string[]): Promise<Map<string, SkuReceivingLedger>> {
  requireLevel(actor, COST_READ_MIN);
  const out = new Map<string, SkuReceivingLedger>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();

  // Paginate: vendor_delivery_items grows with every receiving session; a raw
  // scan truncates at 1000 and silently under-counts received $/oz. Order by the
  // unique `id` for a stable total order across pages.
  const lines = await selectAllRows<{ vendor_item_id: string; delivery_id: string; qty_received: number | string; unit_price: number | string | null }>(
    (from, to) => sb
      .from("vendor_delivery_items")
      .select("vendor_item_id, delivery_id, qty_received, unit_price")
      .in("vendor_item_id", skuIds)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const prices = await loadCurrentSkuPrices(skuIds);
  const measures = await loadMeasureUnits(actor);
  const measuresMap = new Map<string, MeasureUnitFactor>(measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]));
  const contentOzById = await loadChainAwareContentOz(sb, skuIds, measuresMap);

  const deliveryIds = [...new Set(lines.map((l) => l.delivery_id))];
  const delMeta = new Map<string, { date: string; vendorName: string }>();
  if (deliveryIds.length > 0) {
    const { data: dels } = await sb.from("vendor_deliveries").select("id, delivery_date, vendor_id").in("id", deliveryIds).returns<Array<{ id: string; delivery_date: string; vendor_id: string }>>();
    const vendorIds = [...new Set((dels ?? []).map((d) => d.vendor_id))];
    const { data: vends } = vendorIds.length ? await sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>() : { data: [] as Array<{ id: string; name: string }> };
    const vName = new Map((vends ?? []).map((v) => [v.id, v.name]));
    for (const d of dels ?? []) delMeta.set(d.id, { date: d.delivery_date, vendorName: vName.get(d.vendor_id) ?? "(vendor)" });
  }

  for (const id of skuIds) out.set(id, { receivedDollars: 0, receivedOz: 0, unpricedLineCount: 0, missingOzLineCount: 0, deliveries: [] });

  for (const l of lines) {
    const led = out.get(l.vendor_item_id);
    if (!led) continue;
    const qty = num(l.qty_received) ?? 0;
    const linePrice = num(l.unit_price) ?? prices.get(l.vendor_item_id) ?? null;
    if (linePrice == null) led.unpricedLineCount += 1;
    else led.receivedDollars += qty * linePrice;
    const contentOz = contentOzById.get(l.vendor_item_id) ?? null;
    if (contentOz == null) led.missingOzLineCount += 1;
    else led.receivedOz += qty * contentOz;
    const meta = delMeta.get(l.delivery_id);
    led.deliveries.push({ deliveryId: l.delivery_id, date: meta?.date ?? "", vendorName: meta?.vendorName ?? "(vendor)", qty, unitPrice: num(l.unit_price) });
  }
  for (const led of out.values()) led.deliveries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

export interface SkuConsumption { consumedOz: number; consumedDollars: number; }

/**
 * Per-SKU consumption from production (S1, reshaped to header + production_inputs
 * lines): Σ input_oz (oz) over LIVE headers, and Σ input_oz × costPerOz ($) where
 * costPerOz = current pack price ÷ content_oz. Superseded/revoked headers excluded.
 */
export async function loadSkuConsumption(actor: AuthContext, skuIds: string[]): Promise<Map<string, SkuConsumption>> {
  requireLevel(actor, COST_READ_MIN);
  const out = new Map<string, SkuConsumption>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const prices = await loadCurrentSkuPrices(skuIds);
  const measures = await loadMeasureUnits(actor);
  const measuresMap = new Map<string, MeasureUnitFactor>(measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]));
  const contentOzById = await loadChainAwareContentOz(sb, skuIds, measuresMap);
  // costPerOz = price-per-pack ÷ content_oz; null if either missing or content <= 0.
  const costPerOzById = new Map<string, number | null>();
  for (const id of skuIds) {
    const price = prices.get(id) ?? null;
    const content = contentOzById.get(id) ?? null;
    costPerOzById.set(id, price != null && content != null && content > 0 ? price / content : null);
  }

  // Paginate both reads past the 1000-row cap. `productions` grows fastest of
  // all (one header per convertible prep item per prep save), so an unpaginated
  // scan is the first to truncate and silently under-count consumed oz/$.
  // (Follow-up: a SQL SUM(input_oz) GROUP BY input_sku_id over live headers
  //  would avoid hydrating every header + line on each admin cost load.)
  const liveHdr = await selectAllRows<{ id: string }>(
    (from, to) => sb.from("productions").select("id").is("superseded_at", null).is("revoked_at", null).order("id", { ascending: true }).range(from, to),
  );
  const liveIds = new Set(liveHdr.map((h) => h.id));
  const lines = await selectAllRows<{ production_id: string; input_sku_id: string; input_oz: number | string }>(
    (from, to) => sb.from("production_inputs").select("production_id, input_sku_id, input_oz").in("input_sku_id", skuIds).order("id", { ascending: true }).range(from, to),
  );

  for (const id of skuIds) out.set(id, { consumedOz: 0, consumedDollars: 0 });
  for (const l of lines) {
    if (!liveIds.has(l.production_id)) continue;
    const c = out.get(l.input_sku_id); if (!c) continue;
    const oz = num(l.input_oz) ?? 0;
    c.consumedOz += oz;
    const cpo = costPerOzById.get(l.input_sku_id) ?? null;
    if (cpo != null) c.consumedDollars += oz * cpo;
  }
  return out;
}
