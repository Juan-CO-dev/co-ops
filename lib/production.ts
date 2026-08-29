/**
 * Operational production-capture data layer (Item/Inventory Spine — S1, reshaped to
 * the header + production_inputs lines model, migration 0102). SERVER-ONLY,
 * service-role; app-layer KH+ (≥4) gate + location-bind IDOR (mirrors lib/receiving.ts).
 * Records SKU→item conversions: a `productions` header credits the item; one
 * `production_inputs` line per consumed SKU depletes it (consumption signal) and
 * feeds the running-average yield prediction. The standalone form still sends a
 * single input+output, so recordProduction writes exactly one input line.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import type { MeasureDimension } from "@/lib/recipe-math";

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

/**
 * Load the active measure-unit registry as a label→factor map, directly via
 * service-role. NOT via lib/admin/skus.loadMeasureUnits, which gates at AGM+ (≥6);
 * recordProduction runs at KH+ (≥4), so the gated helper would throw for a
 * key-holder. Same select shape as loadMeasureUnits.
 */
async function loadMeasuresMap(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("measure_units")
    .select("label, dimension, to_base_factor")
    .eq("active", true)
    .returns<Array<{ label: string; dimension: MeasureDimension; to_base_factor: number | string }>>();
  return new Map<string, MeasureUnitFactor>((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: Number(m.to_base_factor) }]));
}

/**
 * Which of these products are RETIRED (`products.active = false`) — rung ⓪ of the
 * resolution ladder, and the only rung this module is entitled to run.
 *
 * WHY A FLAG READ AND NOT `resolveProductMember` (AGENTS.md, product identity): the
 * ladder answers "WHICH vendor does this product mean", and production must never form
 * a second opinion about that — nor does it need one. The cook is holding a specific
 * pack; the amplifier fix (2026-08-20) exists precisely so ANY member of a live product
 * can be recorded, not only the resolved one. Rung ⓪ is different in kind: it is not a
 * member choice at all but a fact about the IDENTITY — "we do not buy this any more" —
 * and it is the one AGENTS.md names production among ("the STATUS stays the single
 * `unresolved` everywhere downstream — costing board, depletion, production, ordering").
 * Before this, production was the one such consumer that never read the flag.
 *
 * Returned as the RETIRED set, not the live set, so a dangling id (impossible under the
 * FK, but cheap to be right about) reads as live rather than silently blocking a valid
 * conversion. Batched — one query for every product in play, per the loadRecipeGraph law.
 */
async function loadRetiredProductIds(
  sb: ReturnType<typeof getServiceRoleClient>,
  productIds: string[],
): Promise<Set<string>> {
  const retired = new Set<string>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return retired;
  const { data, error } = await sb.from("products").select("id, active").in("id", ids)
    .returns<Array<{ id: string; active: boolean | null }>>();
  if (error) throw new Error(`loadRetiredProductIds: ${error.message}`);
  // `active ?? true` is lib/products.ts loadProductIndex's idiom: a null reads as live.
  for (const p of data ?? []) if ((p.active ?? true) === false) retired.add(p.id);
  return retired;
}

/** content_oz (oz per pack) for one SKU, or null if not configured. */
async function skuContentOzById(skuId: string): Promise<number | null> {
  const sb = getServiceRoleClient();
  const { data: sku } = await sb.from("vendor_items").select("units_per_pack, each_size, each_measure, avg_oz_per_each").eq("id", skuId)
    .maybeSingle<{ units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>();
  if (!sku) return null;
  const measures = await loadMeasuresMap();
  return skuContentOz({ unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: num(sku.avg_oz_per_each) }, measures);
}

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
  /** SKU id → the items makeable from it (output items of active recipes that take the SKU). */
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

/** Items makeable from each SKU = output items of ACTIVE recipes that take the SKU
 *  as an input. Reads the canonical `recipes` graph (recipe_inputs → recipe →
 *  recipe_outputs), matching prep-consumption / cost / readiness. Previously read
 *  the legacy `item_components` graph, which diverged from recipes after migration
 *  0104 — so recipe-authored items were invisible to the manual production form.
 *
 *  THE AMPLIFIER FIX (multi-vendor audit P2, 2026-08-20): a recipe may pin a
 *  PRODUCT rather than one vendor's SKU (0179). A product-pinned recipe expands to
 *  EVERY member SKU here — because the cook standing at the bench with the backup
 *  vendor's ham is making the same thing, and before this the dropdown derived
 *  purely from pins so they simply could not record it. Both passes stay batched
 *  (`.in(...)`) — the loadRecipeGraph law applies to this module too.
 *
 *  …AND THE AMPLIFIER STOPS AT A RETIRED IDENTITY (wiring audit 2026-08-29). The
 *  expansion asked only "is this SKU a member of a product some recipe pins", never
 *  whether that product is still one the kitchen buys — and a retired product's members
 *  are normally still ACTIVE rows, so the gap was the normal case, not an edge. The
 *  dropdown therefore kept offering conversions off a discontinued identity forever,
 *  with no signal, while the costing board, readiness lane and order walk all read the
 *  same pin as `unresolved`. A retired product's pins are dropped here; the SKU-pin pass
 *  is untouched, so a SKU that a recipe names DIRECTLY still makes what it always made. */
async function loadSkuToItems(skuIds: string[]): Promise<Record<string, Array<{ itemId: string; name: string }>>> {
  const out: Record<string, Array<{ itemId: string; name: string }>> = {};
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  // Recipe inputs that consume one of these SKUs.
  const { data: ins } = await sb.from("recipe_inputs").select("recipe_id, component_sku_id").in("component_sku_id", skuIds).not("component_sku_id", "is", null)
    .returns<Array<{ recipe_id: string; component_sku_id: string }>>();

  // PRODUCT pass: which of these SKUs are members of a product, and which recipes
  // pin those products. One membership read + one pins read, both batched.
  const { data: memberRows } = await sb.from("vendor_items").select("id, product_id")
    .in("id", skuIds).not("product_id", "is", null)
    .returns<Array<{ id: string; product_id: string }>>();
  const membersByProduct = new Map<string, string[]>();
  for (const m of memberRows ?? []) {
    const list = membersByProduct.get(m.product_id) ?? [];
    list.push(m.id);
    membersByProduct.set(m.product_id, list);
  }
  const retiredProductIds = await loadRetiredProductIds(sb, [...membersByProduct.keys()]);
  const productIds = [...membersByProduct.keys()].filter((id) => !retiredProductIds.has(id));
  const productIns: Array<{ recipe_id: string; component_sku_id: string }> = [];
  if (productIds.length > 0) {
    const { data: pins } = await sb.from("recipe_inputs").select("recipe_id, component_product_id")
      .in("component_product_id", productIds)
      .returns<Array<{ recipe_id: string; component_product_id: string }>>();
    for (const p of pins ?? []) {
      for (const skuId of membersByProduct.get(p.component_product_id) ?? []) {
        // Flattened into the same shape the SKU pass produces, so ONE downstream
        // loop maps recipes to output items — no second, subtly different copy.
        productIns.push({ recipe_id: p.recipe_id, component_sku_id: skuId });
      }
    }
  }
  const allIns = [...(ins ?? []), ...productIns];

  const recipeIds = [...new Set(allIns.map((i) => i.recipe_id))];
  if (recipeIds.length === 0) return out;
  // Keep only ACTIVE recipes (inactive-edge rule, per readiness/consumption).
  const { data: activeRows } = await sb.from("recipes").select("id").in("id", recipeIds).eq("active", true).returns<Array<{ id: string }>>();
  const activeRecipes = new Set((activeRows ?? []).map((r) => r.id));
  if (activeRecipes.size === 0) return out;
  // Item outputs of those active recipes.
  const { data: outs } = await sb.from("recipe_outputs").select("recipe_id, output_item_id").in("recipe_id", [...activeRecipes]).not("output_item_id", "is", null)
    .returns<Array<{ recipe_id: string; output_item_id: string }>>();
  const itemsByRecipe = new Map<string, string[]>();
  for (const o of outs ?? []) { const l = itemsByRecipe.get(o.recipe_id) ?? []; l.push(o.output_item_id); itemsByRecipe.set(o.recipe_id, l); }
  const itemIds = [...new Set((outs ?? []).map((o) => o.output_item_id))];
  const nameById = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items } = await sb.from("items").select("id, name").in("id", itemIds).eq("active", true).returns<Array<{ id: string; name: string }>>();
    for (const it of items ?? []) nameById.set(it.id, it.name);
  }
  // For each SKU input into an active recipe, expose that recipe's output items.
  for (const i of allIns) {
    if (!activeRecipes.has(i.recipe_id)) continue;
    const list = out[i.component_sku_id] ?? (out[i.component_sku_id] = []);
    for (const itemId of itemsByRecipe.get(i.recipe_id) ?? []) {
      const name = nameById.get(itemId);
      if (!name) continue; // inactive item
      if (!list.some((x) => x.itemId === itemId)) list.push({ itemId, name });
    }
  }
  return out;
}

/**
 * received packs − consumed packs, per SKU (for the form's in-stock hint), scoped
 * to ONE location: SKUs are global but physical stock is per-location, so receipts
 * and productions are bound to `locationId` (mixing stores gave a wrong hint).
 * All three reads paginate past the 1000-row cap (they silently truncated → the
 * hint OVERSTATED stock as ledgers grew, hiding consumption past row 1000).
 * NOTE: consumed still uses qty_entered, whose unit varies by producer (manual
 * form = packs, prep panel = case/each/oz). For panel-created rows this mixes
 * units; the advisory hint is approximate. Fixing that (consume via input_oz ÷
 * content_oz) is a separate follow-up — see the audit backlog.
 */
export async function loadInStockPacks(skuIds: string[], locationId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  // Deliveries at this location → the delivery ids that scope receipt lines.
  const deliveryIds = (await selectAllRows<{ id: string }>(
    (from, to) => sb.from("vendor_deliveries").select("id").eq("location_id", locationId).order("id", { ascending: true }).range(from, to),
  )).map((d) => d.id);
  const recv = deliveryIds.length === 0 ? [] : await selectAllRows<{ vendor_item_id: string; qty_received: number | string }>(
    (from, to) => sb.from("vendor_delivery_items").select("vendor_item_id, qty_received").in("vendor_item_id", skuIds).in("delivery_id", deliveryIds).order("id", { ascending: true }).range(from, to),
  );
  const liveHdr = await selectAllRows<{ id: string }>(
    (from, to) => sb.from("productions").select("id").eq("location_id", locationId).is("superseded_at", null).is("revoked_at", null).order("id", { ascending: true }).range(from, to),
  );
  const liveIds = new Set(liveHdr.map((h) => h.id));
  const lines = await selectAllRows<{ production_id: string; input_sku_id: string; qty_entered: number | string | null }>(
    (from, to) => sb.from("production_inputs").select("production_id, input_sku_id, qty_entered").in("input_sku_id", skuIds).order("id", { ascending: true }).range(from, to),
  );
  for (const id of skuIds) out.set(id, 0);
  for (const r of recv) out.set(r.vendor_item_id, (out.get(r.vendor_item_id) ?? 0) + (num(r.qty_received) ?? 0));
  for (const l of lines) {
    if (!liveIds.has(l.production_id)) continue;
    out.set(l.input_sku_id, (out.get(l.input_sku_id) ?? 0) - (num(l.qty_entered) ?? 0));
  }
  return out;
}

export async function loadProductionFormData(actor: AuthContext, locationId: string): Promise<ProductionFormData> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`loadProductionFormData skus: ${error.message}`);
  const ids = (skus ?? []).map((s) => s.id);
  const [skuToItems, inStock] = await Promise.all([loadSkuToItems(ids), loadInStockPacks(ids, locationId)]);
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
  // Live headers producing this item, each with its input line(s) for this SKU.
  const { data: hdrs } = await sb.from("productions").select("id, output_qty").eq("output_item_id", args.outputItemId).is("superseded_at", null).is("revoked_at", null)
    .returns<Array<{ id: string; output_qty: number | string }>>();
  const hdrList = hdrs ?? [];
  if (hdrList.length === 0) return { predicted: null };
  const outputById = new Map(hdrList.map((h) => [h.id, num(h.output_qty) ?? 0]));
  const { data: lines } = await sb.from("production_inputs").select("production_id, qty_entered").eq("input_sku_id", args.inputSkuId).in("production_id", [...outputById.keys()])
    .returns<Array<{ production_id: string; qty_entered: number | string | null }>>();
  // Sum this SKU's input qty per header, pair with that header's output.
  const inByHdr = new Map<string, number>();
  for (const l of lines ?? []) inByHdr.set(l.production_id, (inByHdr.get(l.production_id) ?? 0) + (num(l.qty_entered) ?? 0));
  const ratios: number[] = [];
  for (const [hid, i] of inByHdr) { const o = outputById.get(hid) ?? 0; if (i > 0) ratios.push(o / i); }
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
  const { data: sku } = await sb.from("vendor_items").select("id, product_id").eq("id", input.inputSkuId).eq("active", true)
    .maybeSingle<{ id: string; product_id: string | null }>();
  if (!sku) throw new ProductionError(400, "invalid_sku", "SKU not found or inactive");
  const { data: item } = await sb.from("items").select("id").eq("id", input.outputItemId).eq("active", true).maybeSingle<{ id: string }>();
  if (!item) throw new ProductionError(400, "invalid_item", "Item not found or inactive");
  // Valid conversion = an ACTIVE recipe that takes this SKU as an input AND outputs
  // this item (canonical recipes graph; was the legacy item_components edge). Two-step
  // (not an embedded filter) per the AGENTS.md RLS/embedded-select note.
  const { data: inRows } = await sb.from("recipe_inputs").select("recipe_id").eq("component_sku_id", input.inputSkuId)
    .returns<Array<{ recipe_id: string }>>();
  // A recipe pinning this SKU's PRODUCT counts as a valid conversion for EVERY
  // member (0179) — the same expansion loadSkuToItems does for the dropdown, so a
  // cook offered the backup SKU does not then hit `invalid_conversion` on submit.
  // …unless the PRODUCT is retired, which is rung ⓪ and refuses (see
  // loadRetiredProductIds). The two authorities are tracked SEPARATELY rather than
  // merged into one id set, because the answer to "why was this refused" differs: a
  // direct SKU pin is unaffected by any product's retirement, and only a conversion
  // that the retired pin ALONE would have authorised gets the named refusal.
  let productRecipeIds: string[] = [];
  let productRetired = false;
  if (sku.product_id != null) {
    productRetired = (await loadRetiredProductIds(sb, [sku.product_id])).has(sku.product_id);
    const { data: pinRows } = await sb.from("recipe_inputs").select("recipe_id").eq("component_product_id", sku.product_id)
      .returns<Array<{ recipe_id: string }>>();
    productRecipeIds = (pinRows ?? []).map((r) => r.recipe_id);
  }
  const skuPinnedRecipeIds = new Set((inRows ?? []).map((r) => r.recipe_id));
  const productPinnedRecipeIds = new Set(productRecipeIds);
  const candidateSourceIds = [...new Set([...skuPinnedRecipeIds, ...productPinnedRecipeIds])];
  let validBySkuPin = false;
  let validByProductPin = false;
  if (candidateSourceIds.length > 0) {
    const { data: outRows } = await sb.from("recipe_outputs").select("recipe_id").eq("output_item_id", input.outputItemId).in("recipe_id", candidateSourceIds)
      .returns<Array<{ recipe_id: string }>>();
    const candidateRecipeIds = [...new Set((outRows ?? []).map((r) => r.recipe_id))];
    if (candidateRecipeIds.length > 0) {
      // No `.limit(1)`: WHICH active recipe answered decides the error message below,
      // so the set is needed, not merely its emptiness. It is bounded by the recipes
      // that both consume this SKU/product and output this item — a handful.
      const { data: active } = await sb.from("recipes").select("id").in("id", candidateRecipeIds).eq("active", true)
        .returns<Array<{ id: string }>>();
      for (const r of active ?? []) {
        if (skuPinnedRecipeIds.has(r.id)) validBySkuPin = true;
        if (productPinnedRecipeIds.has(r.id)) validByProductPin = true;
      }
    }
  }
  if (!(validBySkuPin || (validByProductPin && !productRetired))) {
    // LOUD, AND IT NAMES THE ERRAND (Juan's retirement ruling A+): "discontinued" sends
    // the manager to the recipe or the products page, where `invalid_conversion` would
    // have sent a cook hunting a SKU/item mismatch that does not exist. The dropdown no
    // longer offers this, so in practice it catches a page loaded before the retirement
    // — which is exactly the case a silent success would have recorded.
    if (validByProductPin && productRetired) {
      throw new ProductionError(409, "retired_product", "That product is discontinued");
    }
    throw new ProductionError(400, "invalid_conversion", "That item is not made from that SKU");
  }

  // Resolve consumed oz for the single SKU line: inputQty (packs) × content_oz (oz/pack).
  const contentOz = await skuContentOzById(input.inputSkuId);
  if (contentOz == null) throw new ProductionError(400, "invalid_conversion", "SKU has no oz content configured");
  const inputOz = input.inputQty * contentOz;

  // 1) header
  const { data: row, error } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: input.outputQty,
    source: "manual", notes: input.notes?.trim() || null, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordProduction header insert: ${error.message}`);
  if (!row) throw new Error("recordProduction returned no row");

  // 2) one input line
  const { error: lineErr } = await sb.from("production_inputs").insert({
    production_id: row.id, input_sku_id: input.inputSkuId, input_oz: inputOz,
    qty_entered: input.inputQty, unit_entered: null, derived_oz: null,
  });
  if (lineErr) throw new Error(`recordProduction line insert: ${lineErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "production.recorded",
    resourceTable: "productions", resourceId: row.id,
    metadata: { location_id: input.locationId, source: "manual", input_sku_id: input.inputSkuId, input_qty: input.inputQty, input_oz: inputOz, output_item_id: input.outputItemId, output_qty: input.outputQty, observed_yield: input.outputQty / input.inputQty },
    ipAddress: null, userAgent: null,
  });
  return { productionId: row.id };
}

export async function loadRecentProductions(actor: AuthContext, locationId: string, limit = 20): Promise<ProductionView[]> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("productions").select("id, produced_at, output_item_id, output_qty")
    .eq("location_id", locationId).is("superseded_at", null).is("revoked_at", null)
    .order("produced_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; produced_at: string; output_item_id: string; output_qty: number | string }>>();
  if (error) throw new Error(`loadRecentProductions: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];

  // Input lines for these headers → skuName (comma-join) + summed input qty.
  const prodIds = list.map((r) => r.id);
  const { data: lines } = await sb.from("production_inputs").select("production_id, input_sku_id, qty_entered").in("production_id", prodIds)
    .returns<Array<{ production_id: string; input_sku_id: string; qty_entered: number | string | null }>>();
  const lineList = lines ?? [];
  const skuIds = [...new Set(lineList.map((l) => l.input_sku_id))];
  const itemIds = [...new Set(list.map((r) => r.output_item_id))];
  const [{ data: skus }, { data: items }] = await Promise.all([
    skuIds.length ? sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>(),
  ]);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));

  // Per-header: unique sku names (comma-joined) + summed qty_entered.
  const namesByHdr = new Map<string, string[]>();
  const qtyByHdr = new Map<string, number>();
  for (const l of lineList) {
    const nm = skuName.get(l.input_sku_id) ?? "(sku)";
    const arr = namesByHdr.get(l.production_id) ?? [];
    if (!arr.includes(nm)) arr.push(nm);
    namesByHdr.set(l.production_id, arr);
    qtyByHdr.set(l.production_id, (qtyByHdr.get(l.production_id) ?? 0) + (num(l.qty_entered) ?? 0));
  }

  return list.map((r) => ({
    id: r.id, producedAt: r.produced_at,
    skuName: (namesByHdr.get(r.id) ?? []).join(", ") || "(sku)",
    itemName: itemName.get(r.output_item_id) ?? "(item)",
    inputQty: qtyByHdr.get(r.id) ?? 0, outputQty: num(r.output_qty) ?? 0,
  }));
}
