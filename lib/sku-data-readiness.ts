/** SKU data readiness: pure extension of the readiness vocabulary. No I/O.
 * Journey rules extracted from scripts/parity-angel.ts:211-224 (r3).
 * Existing product/recipe Readiness semantics remain unchanged.
 */
import { buildRecipeGraph, perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type GraphRecipe, type ProductIndex } from "@/lib/prep-consumption-graph";
import { productInputBasis, resolveProductMember } from "@/lib/products-shared";
import { skuContentOz, type RecipeInputSku, type MeasureUnitFactor } from "@/lib/recipe-math";
import { buildPackChain, chainRootLabel, validateChainStructure, firstLabelMeasureCollision, type PackChainLevel } from "@/lib/pack-chain-shared";
import { resolveCountLineDim } from "@/lib/counts-shared";
import { resolveActive, resolvePar } from "@/lib/location-sku-shared";

export const DATA_ERRAND_CODES = ["no_price", "price_stale", "no_countable_chain", "raw_pack_contents_missing", "weight_estimate", "no_par", "no_rhythm", "no_vendor", "no_order_unit", "recipe_unresolved"] as const;
export type DataErrandCode = typeof DATA_ERRAND_CODES[number];
export const JOURNEYS = ["order", "count", "cost"] as const;
export type Journey = typeof JOURNEYS[number];
export type JourneyState = "usable" | "degraded" | "blocked";
export type DataErrand =
  | { code: Exclude<DataErrandCode, "recipe_unresolved">; blocks: Journey[]; degrades: Journey[] }
  | { code: "recipe_unresolved"; blocks: []; degrades: ["cost"]; recipes: string[] };
export interface SkuDataReadiness { order: JourneyState; count: JourneyState; cost: JourneyState; errands: DataErrand[] }
export interface SkuDataReadinessInput {
  sku: RecipeInputSku & { skuClass: string | null; weightClass: string | null };
  headPrice: { value: number | null; effectiveDate: string | null } | null;
  par: number | null;
  rhythmPresent: boolean;
  vendorActive: boolean;
  unresolvedRecipes: readonly string[];
  asOf: string;
  measures: Map<string, MeasureUnitFactor>;
}

/** Preserve r3's asymmetry: missing raw ounces degrades COUNT, blocks COST;
 * missing supply chain blocks COUNT only. An estimate never changes supply COUNT.
 * A zero par is configured. Price age is >30 days, never >=30.
 */
export function skuDataReadiness(input: SkuDataReadinessInput): SkuDataReadiness {
  const { sku, headPrice, par, rhythmPresent, vendorActive, unresolvedRecipes, asOf } = input;
  const supply = sku.skuClass != null && sku.skuClass !== "raw";
  const levels = sku.packChain ?? [], chain = buildPackChain(levels);
  const root = chainRootLabel(chain);
  const measures = input.measures;
  const structural = levels.length > 0 && levels.every(l => l.containsQty > 0 && Number.isFinite(l.containsQty))
    && !firstLabelMeasureCollision(levels.map(l => l.label), new Set(measures.keys())) && validateChainStructure(chain, measures).ok;
  const countable = structural && root != null && resolveCountLineDim({ levelLabel: root, qty: 1, partialFraction: null }, sku, measures).ok;
  const mass = skuContentOz(sku, measures), rawPackMissing = !supply && !(mass != null && mass > 0);
  const uncertain = ["ESTIMATE", "SPEC"].includes(String(sku.weightClass)) || (sku.avgOzPerEach != null && !["OPERATIONAL", "INVOICE_DERIVED", "ESTIMATE", "SPEC"].includes(String(sku.weightClass)));
  const age = headPrice?.effectiveDate ? Math.floor((Date.parse(asOf) - Date.parse(headPrice.effectiveDate)) / 86400000) : null;
  const errands: DataErrand[] = [];
  const add = (code: Exclude<DataErrandCode, "recipe_unresolved">, blocks: Journey[], degrades: Journey[] = []) => errands.push({ code, blocks, degrades });
  if (!(headPrice?.value != null && headPrice.value > 0)) add("no_price", ["cost"]);
  if (age != null && age > 30) add("price_stale", [], ["cost"]);
  if (supply && !countable) add("no_countable_chain", ["count"]);
  if (rawPackMissing) add("raw_pack_contents_missing", ["cost"], ["order", "count"]);
  if (uncertain) add("weight_estimate", [], supply ? ["cost"] : ["count", "cost"]);
  if (par == null) add("no_par", ["order"]);
  if (!rhythmPresent) add("no_rhythm", [], ["order"]);
  if (!vendorActive) add("no_vendor", ["order"]);
  if (!(root ?? sku.packFormat)?.trim()) add("no_order_unit", ["order"]);
  if (unresolvedRecipes.length) errands.push({ code: "recipe_unresolved", blocks: [], degrades: ["cost"], recipes: [...new Set(unresolvedRecipes)].sort() });
  const state = (journey: Journey): JourneyState => errands.some(e => e.blocks.some(j => j === journey)) ? "blocked" : errands.some(e => e.degrades.some(j => j === journey)) ? "degraded" : "usable";
  return { order: state("order"), count: state("count"), cost: state("cost"), errands };
}

/** Serializable page payload: only authorized shops, only launch SKUs. */
export interface SkuDataShop { id: string; name: string; bySku: Record<string, SkuDataReadiness>; counts: Record<Journey, Record<JourneyState, number>> }
export function summarizeSkuDataShop(id: string, name: string, bySku: Record<string, SkuDataReadiness>): SkuDataShop {
  const counts = { order: { usable: 0, degraded: 0, blocked: 0 }, count: { usable: 0, degraded: 0, blocked: 0 }, cost: { usable: 0, degraded: 0, blocked: 0 } };
  for (const row of Object.values(bySku)) for (const journey of JOURNEYS) counts[journey][row[journey]]++;
  return { id, name, bySku, counts };
}
export function worstSkuDataReadiness(rows: SkuDataReadiness[]): Pick<SkuDataReadiness, Journey> | null {
  if (!rows.length) return null;
  const state = (j: Journey): JourneyState => rows.some(r => r[j] === "blocked") ? "blocked" : rows.some(r => r[j] === "degraded") ? "degraded" : "usable";
  return { order: state("order"), count: state("count"), cost: state("cost") };
}

interface ReadinessSnapshot { sku: LiveRow; chain: LiveRow[]; price: LiveRow | null }
export type LiveRow = Record<string, unknown>;
export type LiveTables = Record<string, LiveRow[]>;
interface LiveLaunchRow extends SkuDataReadiness {
  id: string; name: string; unpriced: boolean; chainless: boolean; estimate: boolean;
  rawPackMissing: boolean; order: JourneyState; count: JourneyState; cost: JourneyState;
  age: number | null; presentAge: number | null; consumerBasis: string;
}
interface LiveRecipeResult { id: string; name: string; cost: number | null; oz: number | null; dependencies: string[] }
export interface Wave7ReadinessReport {
  asOf: string;
  shops: Array<{ id: string; name: string; rows: LiveLaunchRow[]; recipes: LiveRecipeResult[]; products: Array<{ id: string; name: string; skuId: string | null; sku: string | null; basis: number | null }> }>;
  counts: Record<string, number>;
}

function liveText(value: unknown): string | null { return typeof value === "string" ? value : null; }
function liveNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function liveId(row: LiveRow): string {
  const id = liveText(row.id); if (!id) throw new Error("SCHEMA_MISMATCH: missing row id"); return id;
}
function liveRows(tables: LiveTables, table: string): LiveRow[] {
  const rows = tables[table]; if (!rows) throw new Error(`INCOMPLETE_GRAPH: ${table} was not loaded`); return rows;
}
function liveIndex(rows: LiveRow[]): Map<string, LiveRow> {
  const index = new Map(rows.map(r => [liveId(r), r]));
  if (index.size !== rows.length) throw new Error("INCOMPLETE_GRAPH: duplicate row ids");
  return index;
}
function liveChain(rows: LiveRow[]): PackChainLevel[] {
  return rows.map(r => ({ id: liveId(r), label: String(r.label), containsQty: liveNum(r.contains_qty) ?? 0,
    containsLevelId: liveText(r.contains_level_id), containsMeasureUnit: liveText(r.contains_measure_unit), displayOrdinal: liveNum(r.display_ordinal) ?? 0 }));
}
function liveBasis(row: LiveRow, chain: LiveRow[]): RecipeInputSku {
  return { packFormat: liveText(row.pack_format), eachContainerLabel: liveText(row.each_container_label),
    unitsPerPack: liveNum(row.units_per_pack), eachSize: liveNum(row.each_size), eachMeasure: liveText(row.each_measure),
    avgOzPerEach: liveNum(row.avg_oz_per_each), packChain: liveChain(chain) };
}
function liveHead(rows: LiveRow[]): LiveRow | null {
  return [...rows].sort((a, b) => {
    for (const key of ["effective_date", "recorded_at", "id"]) {
      const d = String(b[key] ?? "").localeCompare(String(a[key] ?? "")); if (d) return d;
    }
    return 0;
  })[0] ?? null;
}

/** Recompute from a complete universe; no fixed lane-1 counts or success subtraction. */
export function evaluateWave7Tables(tables: LiveTables, overrides = new Map<string, ReadinessSnapshot>(), asOf = "2026-09-11", today = asOf, visibleShopIds?: ReadonlySet<string>): Wave7ReadinessReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) throw new Error("INVALID_AS_OF");
  const skus = liveRows(tables, "vendor_items").map(r => overrides.get(liveId(r))?.sku ?? r);
  const skuIndex = liveIndex(skus), items = liveIndex(liveRows(tables, "items")), menus = liveIndex(liveRows(tables, "menu_items"));
  const vendors = liveIndex(liveRows(tables, "vendors")), products = liveRows(tables, "products"), productIds = new Set(products.map(liveId));
  const allRecipes = liveRows(tables, "recipes"), recipeIds = new Set(allRecipes.map(liveId));
  const recipes = allRecipes.filter(r => r.active === true).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || liveId(a).localeCompare(liveId(b)));
  const inputs = liveRows(tables, "recipe_inputs"), outputs = liveRows(tables, "recipe_outputs");
  const locationIds = new Set(liveRows(tables, "locations").map(liveId)), deliveryIds = new Set(liveRows(tables, "vendor_deliveries").map(liveId));
  for (const [table, fields] of [
    ["vendor_items", [["vendor_id", vendors], ["product_id", productIds], ["location_id", locationIds]]],
    ["location_sku_settings", [["sku_id", skuIndex], ["location_id", locationIds]]],
    ["sku_pack_levels", [["sku_id", skuIndex]]],
    ["vendor_price_history", [["vendor_item_id", skuIndex]]],
    ["vendor_delivery_items", [["vendor_item_id", skuIndex], ["delivery_id", deliveryIds]]],
    ["product_primaries", [["primary_sku_id", skuIndex], ["product_id", productIds], ["location_id", locationIds]]],
  ] as const) for (const row of liveRows(tables, table)) for (const [field, index] of fields) {
    if (row[field] != null && !index.has(String(row[field]))) throw new Error(`INCOMPLETE_GRAPH: ${table}.${field}`);
  }
  // Verify the complete relation universe before filtering retired recipes: a dropped
  // page must not become a plausible smaller dependency graph (LRA-004).
  for (const input of inputs) {
    if (!recipeIds.has(String(input.recipe_id))) throw new Error("INCOMPLETE_GRAPH: recipe input parent");
    for (const [field, index] of [["component_sku_id", skuIndex], ["component_item_id", items], ["component_product_id", productIds]] as const) {
      if (input[field] != null && !index.has(String(input[field]))) throw new Error(`INCOMPLETE_GRAPH: ${field}`);
    }
  }
  for (const output of outputs) {
    if (!recipeIds.has(String(output.recipe_id)) || (output.output_item_id != null && !items.has(String(output.output_item_id))) || (output.output_menu_item_id != null && !menus.has(String(output.output_menu_item_id)))) throw new Error("INCOMPLETE_GRAPH: recipe output");
  }
  const measures = new Map<string, MeasureUnitFactor>();
  for (const m of liveRows(tables, "measure_units").filter(r => r.active === true)) {
    if (!["weight", "volume", "count"].includes(String(m.dimension)) || !(Number(m.to_base_factor) > 0)) throw new Error("SCHEMA_MISMATCH: measure registry");
    measures.set(String(m.label), { dimension: m.dimension as MeasureUnitFactor["dimension"], toBaseFactor: Number(m.to_base_factor) });
  }
  const prices = new Map<string, LiveRow | null>(), bases = new Map<string, RecipeInputSku>();
  for (const sku of skus) {
    const id = liveId(sku), override = overrides.get(id);
    const chain = override?.chain ?? liveRows(tables, "sku_pack_levels").filter(r => r.sku_id === id && r.active === true);
    bases.set(id, liveBasis(sku, chain));
    prices.set(id, override ? override.price : liveHead(liveRows(tables, "vendor_price_history").filter(r => r.vendor_item_id === id)));
  }
  const graphRecipes: GraphRecipe[] = recipes.map(r => ({ recipeId: liveId(r), batchYield: liveNum(r.batch_yield),
    inputs: inputs.filter(i => i.recipe_id === r.id).map(i => ({ quantity: Number(i.quantity), unit: liveText(i.unit), componentSkuId: liveText(i.component_sku_id), componentItemId: liveText(i.component_item_id), componentProductId: liveText(i.component_product_id) })),
    outputs: outputs.filter(o => o.recipe_id === r.id).map(o => ({ outputItemId: liveText(o.output_item_id), outputMenuItemId: liveText(o.output_menu_item_id), yield: Number(o.yield), ozPerParUnit: liveNum(items.get(String(o.output_item_id))?.oz_per_par_unit), parUnitLabel: liveText(items.get(String(o.output_item_id))?.default_par_unit) })) }));
  const report: Wave7ReadinessReport = { asOf, shops: [], counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])) };
  for (const shop of liveRows(tables, "locations").filter(r => r.active !== false && (!visibleShopIds || visibleShopIds.has(liveId(r))))) {
    const shopId = liveId(shop), overlays = liveRows(tables, "location_sku_settings").filter(r => r.location_id === shopId);
    const overlayFor = (id: string) => overlays.find(r => r.sku_id === id);
    const active = (sku: LiveRow) => (sku.location_id == null || sku.location_id === shopId) && resolveActive(overlayFor(liveId(sku))?.active_override as boolean | null | undefined, sku.active === true);
    const productIndex: ProductIndex = { resolution: new Map(), basis: new Map() };
    const resolutions = new Map<string, ReturnType<typeof resolveProductMember>>(), productBases = new Map<string, RecipeInputSku>();
    const productReport: Wave7ReadinessReport["shops"][number]["products"] = [];
    const deliveries = new Set(liveRows(tables, "vendor_deliveries").filter(r => r.location_id === shopId).map(liveId));
    for (const product of products) {
      const id = liveId(product), members = skus.filter(s => s.product_id === id).map(s => ({ skuId: liveId(s), vendorId: liveText(s.vendor_id), vendorName: liveText(vendors.get(String(s.vendor_id))?.name), active: active(s), avgOzPerEach: liveNum(s.avg_oz_per_each),
        lastReceivedAt: liveRows(tables, "vendor_delivery_items").filter(l => l.vendor_item_id === s.id && deliveries.has(String(l.delivery_id))).map(l => String(l.created_at)).sort().at(-1) ?? null }));
      const primaries = liveRows(tables, "product_primaries").filter(p => p.product_id === id);
      const primary = primaries.find(p => p.location_id === shopId) ?? primaries.find(p => p.location_id == null);
      if (primary && !members.some(m => m.skuId === primary.primary_sku_id)) throw new Error("INCOMPLETE_GRAPH: product primary membership");
      const resolution = resolveProductMember({ productId: id, active: product.active === true, primarySkuId: liveText(primary?.primary_sku_id), members });
      const basis = productInputBasis({ productId: id, unitOz: liveNum(product.unit_oz) }, members.find(m => m.skuId === resolution.skuId) ?? null);
      resolutions.set(id, resolution); productBases.set(id, basis);
      productReport.push({ id, name: String(product.name), skuId: resolution.skuId, sku: liveText(skuIndex.get(resolution.skuId ?? "")?.name), basis: basis.avgOzPerEach });
    }
    productIndex.resolution = resolutions; productIndex.basis = productBases;
    const graph = buildRecipeGraph(graphRecipes, bases, measures, productIndex);
    const dependencies = new Set<string>(), degraded = new Map<string, Set<string>>(), recipeResults: LiveRecipeResult[] = [];
    const collect = (recipe: GraphRecipe, seen = new Set<string>()): Set<string> => {
      if (seen.has(recipe.recipeId)) return new Set(); seen.add(recipe.recipeId);
      const ids = new Set<string>();
      for (const input of recipe.inputs) {
        const sku = input.componentSkuId ?? (input.componentProductId ? resolutions.get(input.componentProductId)?.skuId : null);
        if (sku) ids.add(sku);
        const sub = input.componentItemId ? graph.byOutputItem.get(input.componentItemId) : null;
        if (sub) for (const id of collect(sub, seen)) ids.add(id);
      }
      return ids;
    };
    for (const recipe of graphRecipes) {
      const ids = collect(recipe); for (const id of ids) dependencies.add(id);
      for (const output of recipe.outputs) {
        const flat = output.outputItemId ? perUnitSkuOzForItemFromGraph(graph, output.outputItemId) : output.outputMenuItemId ? perUnitSkuOzForMenuItemFromGraph(graph, output.outputMenuItemId) : new Map<string, number>();
        let cost = 0, oz = 0, complete = flat.size > 0;
        if (flat.size === 0) for (const id of ids) {
          const names = degraded.get(id) ?? new Set<string>();
          names.add(String(allRecipes.find(r => r.id === recipe.recipeId)?.name));
          degraded.set(id, names);
        }
        for (const [id, qty] of flat) {
          oz += qty * output.yield;
          const mass = skuContentOz(bases.get(id)!, measures), price = liveNum(prices.get(id)?.unit_price);
          if (!(mass != null && mass > 0 && price != null && price > 0)) complete = false;
          else cost += qty * output.yield * price / mass;
        }
        const producer = output.outputItemId ? graph.byOutputItem.get(output.outputItemId) : graph.byOutputMenuItem.get(output.outputMenuItemId ?? "");
        // Runtime first-wins producers are reported once, never assigned a rival's cost.
        if (producer?.recipeId !== recipe.recipeId) continue;
        recipeResults.push({ id: `${recipe.recipeId}/${output.outputItemId ?? output.outputMenuItemId}`, name: `${String(allRecipes.find(r => r.id === recipe.recipeId)?.name)} / ${String(items.get(output.outputItemId ?? "")?.name ?? menus.get(output.outputMenuItemId ?? "")?.name ?? "output")}`,
          cost: complete ? cost : null, oz: flat.size ? oz : null, dependencies: [...ids] });
      }
    }
    const launch: LiveLaunchRow[] = [];
    const day = new Date(`${asOf}T12:00:00Z`).getUTCDay(), weekend = day === 5 || day === 6 || day === 0;
    for (const sku of skus.filter(active)) {
      const id = liveId(sku), overlay = overlayFor(id), basis = bases.get(id)!;
      const par = resolvePar(overlay ? { weekdayPar: liveNum(overlay.weekday_par), weekendPar: liveNum(overlay.weekend_par), autoWeekdayPar: liveNum(overlay.auto_weekday_par), autoWeekendPar: liveNum(overlay.auto_weekend_par), autoWeekdayBaselinePar: liveNum(overlay.auto_weekday_baseline_par), autoWeekendBaselinePar: liveNum(overlay.auto_weekend_baseline_par) } : null, { weekdayPar: liveNum(sku.weekday_par), weekendPar: liveNum(sku.weekend_par) }, weekend);
      if (!dependencies.has(id) && par == null && sku.inventory_only !== true) continue;
      const head = prices.get(id), price = liveNum(head?.unit_price);
      const date = liveText(head?.effective_date), ageAt = (at: string) => date ? Math.floor((Date.parse(at) - Date.parse(date)) / 86400000) : null;
      const scheduled = ["vendor_cutoffs", "vendor_delivery_rhythm"].every(table => liveRows(tables, table).some(r => r.vendor_id === sku.vendor_id && (r.location_id == null || r.location_id === shopId) && r.active !== false));
      const readiness = skuDataReadiness({ sku: { ...basis, skuClass: liveText(sku.sku_class), weightClass: liveText(sku.weight_class) },
        headPrice: { value: price, effectiveDate: date }, par, rhythmPresent: scheduled,
        vendorActive: vendors.get(String(sku.vendor_id))?.active === true, unresolvedRecipes: [...(degraded.get(id) ?? [])], asOf, measures });
      const has = (code: DataErrandCode) => readiness.errands.some(e => e.code === code);
      launch.push({ id, name: String(sku.name), unpriced: has("no_price"), chainless: has("no_countable_chain"), estimate: sku.weight_class === "ESTIMATE",
        rawPackMissing: has("raw_pack_contents_missing"), ...readiness, age: ageAt(asOf), presentAge: ageAt(today), consumerBasis: JSON.stringify({ basis, price }) });
    }
    report.shops.push({ id: shopId, name: String(shop.name), rows: launch, recipes: recipeResults, products: productReport });
  }
  return report;
}

