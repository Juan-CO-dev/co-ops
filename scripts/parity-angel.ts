/**
 * parity-angel — re-cost the Angel Spend §6.1 prep recipes with OUR engine and
 * Angel's own prices, and print the deltas.
 *
 * WHY: docs/angel-spend-insights.md §6 offers a ready-made regression suite for
 * a costing engine — the same 30-ish recipes, entered by hand into Angel, with
 * Angel's batch cost and cost-per-lb for each. Running co-ops' flatten over the
 * same builds with the same prices tells us whether our engine agrees with a
 * product an operator pays for, and WHERE it doesn't.
 *
 * The default historical-fixture mode reports diagnostic deltas without failing
 * on the delta. Live --wave7 / --readiness modes validate the configured target,
 * use fully paginated data, and fail on violated import/readiness invariants.
 *
 * Run with the react-server condition so the lib's `server-only` guard resolves
 * (the house pattern — cf. scripts/backfill-toast-depletion.ts):
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/parity-angel.ts
 * With the seed's target environment configured:
 *   npx tsx --conditions=react-server scripts/parity-angel.ts --target sim --wave7
 *   npx tsx --conditions=react-server scripts/parity-angel.ts --target sim --readiness --as-of 2026-09-11
 *
 * ── WHAT IS AND ISN'T A VALID ORACLE ────────────────────────────────────────
 *
 * §6.1 (RECIPE batch costs) is usable. §6.2 (MENU-ITEM costs) is NOT, and this
 * harness deliberately does not touch it: docs/seed/source/angel-reconciliation-
 * report.md §F.3 R4 rules it out as a parity oracle because those numbers bake
 * in the $35.95/lb pickles artifact, the uncosted sub roll, and uncosted
 * capicola. The reconciliation also corrects the pickles story itself (§C.3):
 * Angel's CSV export never emitted that $/lb — Angel's UI produced it by
 * dividing a case price by an assumed ~1 lb. So the number in §6.3's map is
 * known-bad, it is carried here as UNPRICED, and any recipe that touches that
 * SKU is excluded with the reason printed.
 *
 * Prices below are a hand-copied TEST FIXTURE from §6.3 — a frozen snapshot for
 * comparison arithmetic, never live price data, and nothing here writes to
 * vendor_price_history or anywhere else. This script is read-only.
 *
 * Where §6.3 names a SKU but states no usable number ("MISSING", a bare product
 * name, or "$22+"), the SKU is left UNPRICED rather than guessed. That makes
 * some recipes incomparable — which is the honest result and is reported as
 * such, exactly like the board's own `(N unpriced)` doctrine.
 */

import { pathToFileURL } from "node:url";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph } from "@/lib/prep-consumption-graph";
import { buildRecipeGraph, perUnitSkuOzForMenuItemFromGraph, type GraphRecipe, type ProductIndex } from "@/lib/prep-consumption-graph";
import { productInputBasis, resolveProductMember } from "@/lib/products-shared";
import { skuContentOz, type RecipeInputSku, type MeasureUnitFactor } from "@/lib/recipe-math";
import { buildPackChain, chainRootLabel, validateChainStructure, firstLabelMeasureCollision, type PackChainLevel } from "@/lib/pack-chain-shared";
import { resolveCountLineDim } from "@/lib/counts-shared";
import { resolveActive, resolvePar } from "@/lib/location-sku-shared";
import type { Wave7Snapshot } from "./seed/26-angel-wave7";
import { canonical, SOURCE } from "@/lib/angel-wave7";

type LiveRow = Record<string, unknown>;
export type LiveTables = Record<string, LiveRow[]>;
type JourneyState = "usable" | "degraded" | "blocked";
interface LiveLaunchRow {
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
export function evaluateWave7Tables(tables: LiveTables, overrides = new Map<string, Wave7Snapshot>(), asOf = "2026-09-11"): Wave7ReadinessReport {
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
  for (const shop of liveRows(tables, "locations").filter(r => r.active !== false)) {
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
    const dependencies = new Set<string>(), degraded = new Set<string>(), recipeResults: LiveRecipeResult[] = [];
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
        if (flat.size === 0) for (const id of ids) degraded.add(id);
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
      const supply = sku.sku_class != null && sku.sku_class !== "raw", levels = basis.packChain ?? [], chain = buildPackChain(levels);
      const root = chainRootLabel(chain), structural = levels.length > 0 && levels.every(l => l.containsQty > 0 && Number.isFinite(l.containsQty)) && !firstLabelMeasureCollision(levels.map(l => l.label), new Set(measures.keys())) && validateChainStructure(chain, measures).ok;
      const countable = structural && root != null && resolveCountLineDim({ levelLabel: root, qty: 1, partialFraction: null }, basis, measures).ok;
      const mass = skuContentOz(basis, measures), rawPackMissing = !supply && !(mass != null && mass > 0);
      const head = prices.get(id), price = liveNum(head?.unit_price), unpriced = !(price != null && price > 0);
      const date = liveText(head?.effective_date), ageAt = (at: string) => date ? Math.floor((Date.parse(at) - Date.parse(date)) / 86400000) : null;
      const age = ageAt(asOf), presentAge = ageAt(new Date().toISOString().slice(0, 10));
      const uncertain = ["ESTIMATE", "SPEC"].includes(String(sku.weight_class)) || (liveNum(sku.avg_oz_per_each) != null && !["OPERATIONAL", "INVOICE_DERIVED", "ESTIMATE", "SPEC"].includes(String(sku.weight_class)));
      const scheduled = ["vendor_cutoffs", "vendor_delivery_rhythm"].every(table => liveRows(tables, table).some(r => r.vendor_id === sku.vendor_id && (r.location_id == null || r.location_id === shopId) && r.active !== false));
      const orderUnit = root ?? liveText(sku.pack_format);
      const order: JourneyState = !orderUnit?.trim() || par == null || vendors.get(String(sku.vendor_id))?.active !== true ? "blocked" : scheduled && !rawPackMissing ? "usable" : "degraded";
      const count: JourneyState = supply ? countable ? "usable" : "blocked" : rawPackMissing || uncertain ? "degraded" : "usable";
      const cost: JourneyState = unpriced || rawPackMissing ? "blocked" : uncertain || (age != null && age > 30) || degraded.has(id) ? "degraded" : "usable";
      launch.push({ id, name: String(sku.name), unpriced, chainless: supply && !countable, estimate: sku.weight_class === "ESTIMATE", rawPackMissing, order, count, cost, age, presentAge, consumerBasis: JSON.stringify({ basis, price }) });
    }
    report.shops.push({ id: shopId, name: String(shop.name), rows: launch, recipes: recipeResults, products: productReport });
  }
  return report;
}

export async function loadWave7ReadinessTables(sb: ReturnType<typeof getServiceRoleClient>): Promise<LiveTables> {
  const { loadAll } = await import("./seed/26-angel-wave7");
  const names = ["vendor_items", "vendors", "locations", "location_sku_settings", "sku_pack_levels", "vendor_price_history", "measure_units", "products", "product_primaries", "vendor_deliveries", "vendor_delivery_items", "recipes", "recipe_inputs", "recipe_outputs", "items", "menu_items", "vendor_cutoffs", "vendor_delivery_rhythm"];
  const loaded = await Promise.all(names.map(async table => [table, await loadAll(sb, table)] as const));
  return Object.fromEntries(loaded);
}

export async function evaluateWave7Readiness(sb: ReturnType<typeof getServiceRoleClient>, overrides = new Map<string, Wave7Snapshot>(), asOf = "2026-09-11"): Promise<Wave7ReadinessReport> {
  return evaluateWave7Tables(await loadWave7ReadinessTables(sb), overrides, asOf);
}

/** Compare every loaded row, including history and unselected SKUs. Only the exact
 * verified RPC result snapshots and their predecessor-chain deactivations may differ.
 * Concurrent unrelated edits are an explicit failed verification, never hidden drift. */
export function verifyWave7Scope(before: LiveTables, after: LiveTables, appliedSnapshots: Map<string, Wave7Snapshot>, operationIds = new Set<string>()): void {
  const expected = new Map<string, Map<string, LiveRow>>();
  if (Object.keys(before).sort().join() !== Object.keys(after).sort().join()) throw new Error("WAVE7_SCOPE_TABLES_CHANGED");
  for (const [table, rows] of Object.entries(before)) expected.set(table, liveIndex(rows));
  const requireTable = (table: string) => {
    const rows = expected.get(table); if (!rows) throw new Error(`WAVE7_SCOPE_TABLE_MISSING: ${table}`); return rows;
  };
  const skus = requireTable("vendor_items"), chains = requireTable("sku_pack_levels"), prices = requireTable("vendor_price_history");
  for (const [skuId, snapshot] of appliedSnapshots) {
    if (liveId(snapshot.sku) !== skuId || !skus.has(skuId)) throw new Error("WAVE7_SCOPE_UNKNOWN_SKU");
    skus.set(skuId, snapshot.sku);
    const replacement = liveIndex(snapshot.chain);
    for (const [id, row] of chains) if (row.sku_id === skuId && row.active === true && !replacement.has(id)) chains.set(id, { ...row, active: false });
    for (const [id, row] of replacement) {
      if (row.sku_id !== skuId || row.active !== true) throw new Error("WAVE7_SCOPE_CHAIN_OWNER");
      const old = chains.get(id);
      if (old && canonical(old) !== canonical(row)) throw new Error("WAVE7_SCOPE_CHAIN_HISTORY_CHANGED");
      chains.set(id, row);
    }
    if (snapshot.price) {
      const id = liveId(snapshot.price), old = prices.get(id);
      if (snapshot.price.vendor_item_id !== skuId || (old && canonical(old) !== canonical(snapshot.price))) throw new Error("WAVE7_SCOPE_PRICE_HISTORY_CHANGED");
      if (!old && snapshot.price.source !== SOURCE) throw new Error("WAVE7_SCOPE_PRICE_SOURCE");
      prices.set(id, snapshot.price);
    }
  }
  for (const [table, rows] of Object.entries(after)) {
    const actual = liveIndex(rows), planned = requireTable(table);
    // Audit is optional in the supplied table universe. Its old rows are immutable;
    // new rows must exactly exhaust the caller's expected operation IDs.
    if (table === "audit_log") {
      for (const [id, row] of actual) if (!planned.has(id)) {
        if (!operationIds.has(id) || row.action !== "sku.angel_import") throw new Error("WAVE7_SCOPE_UNEXPECTED_AUDIT");
        planned.set(id, row);
      }
      for (const id of operationIds) if (!actual.has(id)) throw new Error("WAVE7_SCOPE_MISSING_AUDIT");
    }
    if (canonical([...planned.values()].sort((a, b) => liveId(a).localeCompare(liveId(b)))) !== canonical([...actual.values()].sort((a, b) => liveId(a).localeCompare(liveId(b))))) throw new Error(`WAVE7_SCOPE_CHANGED: ${table}`);
  }
}

export function printWave7Comparison(before: Wave7ReadinessReport, after: Wave7ReadinessReport, label = "projected"): void {
  if (before.asOf !== after.asOf) throw new Error("READINESS_DATE_MISMATCH");
  console.log(`PER-SHOP ERRANDS / MATRIX — ${label}; evaluation ${after.asOf}`);
  console.log(`Complete table counts: ${JSON.stringify(after.counts)}`);
  for (const shop of after.shops) {
    const prior = before.shops.find(s => s.id === shop.id); if (!prior) throw new Error("READINESS_SCOPE_CHANGED");
    if (prior.rows.map(r => r.id).sort().join() !== shop.rows.map(r => r.id).sort().join()) throw new Error("READINESS_DENOMINATOR_CHANGED");
    console.log(`${shop.name}: ${prior.rows.length} → ${shop.rows.length} launch SKUs`);
    for (const [metric, title] of [["unpriced", "Errand 1 / unpriced"], ["chainless", "Errand 2 / chain-less supplies"], ["rawPackMissing", "Errand 4 / raw pack ounces missing"], ["estimate", "Errand 6 / actual unit ESTIMATE"]] as const) {
      const old = prior.rows.filter(r => r[metric]), next = shop.rows.filter(r => r[metric]), closed = old.filter(r => !next.some(n => n.id === r.id));
      console.log(`  ${title}: ${old.length} → ${next.length}; closed: ${closed.map(r => r.name).join(", ") || "none"}; remaining: ${next.map(r => r.name).join(", ") || "none"}`);
    }
    for (const journey of ["order", "count", "cost"] as const) {
      console.log(`  ${journey.toUpperCase()}: ${["usable", "degraded", "blocked"].map(state => `${state} ${prior.rows.filter(r => r[journey] === state).length} → ${shop.rows.filter(r => r[journey] === state).length}`).join("; ")}`);
      for (const row of shop.rows) { const old = prior.rows.find(r => r.id === row.id)!; if (old[journey] !== row[journey]) console.log(`    ${row.name}: ${old[journey]} → ${row[journey]}`); }
    }
    console.log("  PRICE AGE — evaluation date / today (days)");
    for (const row of shop.rows.filter(r => r.age != null)) console.log(`    ${row.name}: ${row.age} / ${row.presentAge}`);
    console.log("  NAMED RECIPE EFFECTS — batch dollars / resolved input ounces");
    const changed = new Set(shop.rows.filter(r => prior.rows.find(p => p.id === r.id)?.consumerBasis !== r.consumerBasis).map(r => r.id));
    for (const recipe of shop.recipes) {
      const old = prior.recipes.find(r => r.id === recipe.id); if (!old) throw new Error("RECIPE_SCOPE_CHANGED");
      if (old.cost !== recipe.cost || old.oz !== recipe.oz) {
        const causes = recipe.dependencies.filter(id => changed.has(id));
        if (!causes.length) throw new Error(`UNEXPLAINED_RECIPE_CHANGE: ${recipe.name}`);
        console.log(`    ${recipe.name}: $${fmt(old.cost)} → $${fmt(recipe.cost)}; ${fmt(old.oz)} oz → ${fmt(recipe.oz)} oz; changed inputs: ${causes.map(id => shop.rows.find(r => r.id === id)!.name).join(", ")}`);
      }
    }
    console.log("  PRODUCT CONSUMERS — selected member / portion ounces (product units preserved)");
    for (const product of shop.products) {
      const old = prior.products.find(p => p.id === product.id); if (!old) throw new Error("PRODUCT_SCOPE_CHANGED");
      if (old.skuId !== product.skuId) throw new Error(`PRODUCT_RESOLUTION_CHANGED: ${product.name}`);
      console.log(`    ${product.name}: ${product.sku ?? "unresolved"}; ${fmt(old.basis)} → ${fmt(product.basis)} oz${old.basis !== product.basis ? " — MEMBER WEIGHT FALLBACK EFFECT" : ""}`);
    }
  }
  console.log("Errands overlap; closures are not summed. Physical counts and failure/concurrency injection require separate sim evidence.");
}

async function liveWave7Main(args: string[]): Promise<void> {
  const seed = await import("./seed/26-angel-wave7");
  if (args.includes("--execute")) throw new Error("Parity is read-only");
  const config = seed.validateTarget(args), sb = seed.createWave7Client(config);
  if (args.includes("--wave7")) await seed.runWave7Verification(args);
  const overrides = new Map<string, Wave7Snapshot>();
  const audit = (await seed.loadAll(sb, "audit_log", "id,action,metadata,occurred_at", { column: "action", value: "sku.angel_import" })).filter(r => (r.metadata as LiveRow | null)?.source === SOURCE).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || liveId(a).localeCompare(liveId(b)));
  for (const row of audit) {
    const metadata = row.metadata as LiveRow | null;
    const expected = metadata?.expected as Wave7Snapshot | undefined;
    if (!expected?.sku || !Array.isArray(expected.chain)) throw new Error("WAVE7_BASELINE_MISSING: audit expected snapshot");
    const id = liveId(expected.sku); if (!overrides.has(id)) overrides.set(id, expected);
  }
  const asOf = args.includes("--as-of") ? args[args.indexOf("--as-of") + 1] : "2026-09-11";
  if (!asOf) throw new Error("INVALID_AS_OF");
  const tables = await loadWave7ReadinessTables(sb);
  const before = evaluateWave7Tables(tables, overrides, asOf), after = evaluateWave7Tables(tables, undefined, asOf);
  printWave7Comparison(before, after, audit.length ? "verified live versus reconstructed pre-wave baseline" : "no wave-7 operations recorded; current → current");
  console.log("NOTHING WAS WRITTEN — read-only live parity");
}

/** Angel's published batch cost + cost-per-lb (docs/angel-spend-insights.md §6.1). */
interface AngelRecipe {
  /** Angel's label for the recipe. */
  angel: string;
  batchCost: number;
  /** Angel's cost per FINISHED lb; null where Angel printed "—". */
  perLb: number | null;
  /** The co-ops recipes.name that models it; null = we don't have this recipe. */
  coops: string | null;
  /** Non-null → excluded from delta comparison, with this printed reason. */
  excluded?: string;
}

const ZERO_PLACEHOLDER =
  "$0.00 placeholder in Angel — main ingredient absent from its catalog (§5)";
const PARTIAL_COST = "Angel row is a PARTIAL cost (<50% of mass costed) (§5)";

const ANGEL_RECIPES: AngelRecipe[] = [
  { angel: "Garlic Aioli (fixed)", batchCost: 41.02, perLb: 2.34, coops: "Garlic Mayo (Aioli)" },
  { angel: "Cholula Mayo", batchCost: 6.75, perLb: 2.60, coops: "Cholula Mayo" },
  { angel: "Russian Dressing", batchCost: 16.58, perLb: 4.28, coops: null },
  { angel: "Honey Chili Aioli", batchCost: 9.97, perLb: 2.23, coops: "Honey Chili Aioli" },
  { angel: "Caesar Dressing", batchCost: 4.85, perLb: 2.35, coops: "Cesear Dressing" },
  { angel: "Mustard Aioli", batchCost: 6.51, perLb: 2.16, coops: "Mustard Aioli" },
  { angel: "Green Goddess", batchCost: 3.34, perLb: 1.43, coops: "Green Goddess" },
  { angel: "Cannoli Cream", batchCost: 9.74, perLb: 2.97, coops: "Cannoli Cream" },
  { angel: "Garlic Bread Compound Butter", batchCost: 5.35, perLb: 2.26, coops: "Garlic Bread / Compound Butter" },
  { angel: "Egg Salad", batchCost: 9.85, perLb: 2.36, coops: "Egg Salad" },
  { angel: "Tuna Salad", batchCost: 29.70, perLb: 2.50, coops: "Tuna Salad" },
  { angel: "Chicken Salad", batchCost: 34.08, perLb: 5.24, coops: "Chicken Salad" },
  { angel: "Coleslaw", batchCost: 3.64, perLb: 0.57, coops: null, excluded: PARTIAL_COST },
  { angel: "French Onion Dip", batchCost: 13.39, perLb: 1.27, coops: "French Onion Dip" },
  { angel: "Caramelized Onions", batchCost: 4.79, perLb: 2.18, coops: "Caramelized Onions" },
  { angel: "Marinara", batchCost: 11.45, perLb: 0.83, coops: "Marinara" },
  { angel: "Vodka Sauce", batchCost: 10.36, perLb: 1.53, coops: "Vodka Sauce" },
  { angel: "Meatballs", batchCost: 34.79, perLb: 3.08, coops: "Meatballs" },
  { angel: "Meatball Spice Mix", batchCost: 0.77, perLb: 4.54, coops: "Meatball Spice Mix" },
  { angel: "Turkey Jus", batchCost: 0.00, perLb: null, coops: null, excluded: ZERO_PLACEHOLDER },
  { angel: "Beef Jus", batchCost: 4.12, perLb: 0.32, coops: "Beef Jus" },
  { angel: "Italian Salsa Verde", batchCost: 11.95, perLb: 9.96, coops: "Italian Salsa Verde" },
  { angel: "Cranberry Sauce", batchCost: 0.00, perLb: null, coops: null, excluded: ZERO_PLACEHOLDER },
  { angel: "Cornbread Mayo", batchCost: 4.57, perLb: 1.00, coops: null, excluded: PARTIAL_COST },
  { angel: "Vegan SDT Aioli", batchCost: 0.42, perLb: 0.16, coops: null, excluded: PARTIAL_COST },
  { angel: "House MSG", batchCost: 1.27, perLb: 3.33, coops: null },
  { angel: "House Quickle", batchCost: 4.56, perLb: 0.52, coops: null },
  { angel: "Toasted Red Chili Flakes", batchCost: 0.00, perLb: null, coops: null, excluded: ZERO_PLACEHOLDER },
  { angel: "Roasted Mushrooms", batchCost: 0.50, perLb: 0.25, coops: null, excluded: PARTIAL_COST },
  { angel: "Corn Esquite", batchCost: 2.52, perLb: 0.66, coops: null, excluded: PARTIAL_COST },
  { angel: "Strata Base", batchCost: 1.33, perLb: 0.34, coops: null },
  { angel: "Breakfast Strata", batchCost: 2.47, perLb: 1.07, coops: null },
  { angel: "Strata Supreme", batchCost: 3.17, perLb: 1.33, coops: null },
  { angel: "Blackforest Breadpudding", batchCost: 1.30, perLb: 0.25, coops: null, excluded: PARTIAL_COST },
  { angel: "Pesto", batchCost: 6.70, perLb: 5.36, coops: null },
  { angel: "Chicken Cutlet (APPROX)", batchCost: 17.44, perLb: 1.45, coops: "Chicken Cutlet (approximate)" },
];

/**
 * Angel's derived $/lb per co-ops SKU name (docs/angel-spend-insights.md §6.3).
 * A SKU absent from this map is UNPRICED for the run — §6.3 either marks it
 * MISSING or names an Angel product without stating a number. Never guessed.
 */
const ANGEL_PRICE_PER_LB: Record<string, number> = {
  // Deli / protein
  "Ham": 2.77,
  "Genoa": 4.39,
  "Pepperoni": 5.09,
  "Prosciutto": 12.95,
  "Turkey": 6.28,
  "Roast Beef": 8.69,               // proxy: LONDON BROIL
  "Chicken Breast": 1.59,
  "Ground Beef": 4.56,
  "Ground Pork": 2.24,
  "Tuna": 2.34,
  // Dairy
  "Provolone": 3.47,
  "Fresh Mozzarella": 3.69,
  "Shredded Mozz": 2.72,
  "Heavy Cream": 1.68,
  "Butter": 2.16,
  "Parmesan (Grated)": 3.46,
  // Produce
  "Tomatoes": 1.50,
  "Iceberg": 0.74,
  "Arugula": 4.13,
  "Basil": 10.34,
  "Parsley": 10.86,
  "Thyme": 35.19,                   // HIGH_PPL_REVIEW (reconciliation §C.2)
  "Onion (White)": 0.61,
  "Onion (red)": 0.67,
  "Garlic": 3.29,
  "Celery": 3.71,
  "Cucumber": 3.62,
  "Sweet Peppers": 10.25,           // §6.3 flags this one "suspicious, cross-check"
  "Hot Peppers": 8.95,
  "Banana Peppers": 8.75,
  "Roasted Red Peppers": 1.13,
  "Watermelon Radish": 2.88,
  // Pantry
  "Tomatoes Crushed (10#)": 0.80,
  "Tomato Paste": 1.50,
  "Duke's Mayo": 2.28,
  "Lemon Juice": 2.34,
  "Olive Oil": 4.69,
  "Balsamic Vin": 1.35,
  "Panko (Japanese)": 1.06,
  "Salt": 2.26,
  "Black peppercorn": 8.42,
  "Oregano": 12.80,
  "Onion Powder": 5.54,
  "Beef Base": 9.34,
};

/**
 * SKUs whose Angel figure is known-bad and must never be propagated. Present in
 * §6.3, deliberately absent from the price map above, and any recipe reaching
 * one is excluded from the deltas with this reason printed.
 */
const POISONED_SKUS: Record<string, string> = {
  "Pickle slices": "PICKLES CHIPS 1/4 — $35.95/lb is a case price mis-read as ~1 lb (insights §3.3, corrected in reconciliation §C.3)",
};

/** Prices whose arithmetic is right but whose propagation is misleading. */
const FLAGGED_PRICES: Record<string, string> = {
  "Thyme": "HIGH_PPL_REVIEW — $66.16/lb in the CSV vs $24.00/lb in the 2024 sheet; tiny herb packs (reconciliation §C.2)",
  "Sweet Peppers": "§6.3 annotates $10.25/lb as suspicious — cross-check before trusting",
  "Basil": "duplicate Angel rows disagree 89% ($10.34 vs $19.55/lb) — the picked row changes the answer (reconciliation §B.3)",
  "Oregano": "duplicate Angel rows disagree ($11.05 vs $16.27/lb) (reconciliation §B.3)",
};

const DELTA_FINDING_PCT = 10;

interface Row {
  angel: AngelRecipe;
  /** null = not comparable; the reason is in `note`. */
  coopsBatch: number | null;
  coopsPerLb: number | null;
  perLbBasis: "declared" | "inputs" | null;
  unpriced: string[];
  flagged: string[];
  note: string;
}

function fmt(v: number | null, dp = 2): string {
  return v == null ? "—" : v.toFixed(dp);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  console.log("");
  console.log("ANGEL PARITY HARNESS — co-ops engine vs Angel Spend §6.1");
  console.log("Prices: docs/angel-spend-insights.md §6.3 (hand-copied FIXTURE, not live data).");
  console.log("Oracle: §6.1 recipe batch costs. §6.2 menu-item costs are NOT used (bad oracle,");
  console.log("        reconciliation §F.3 R4). Read-only; nothing is written. Exit is always 0.");
  console.log("");

  // ── Resolve co-ops recipes → their output item + that output's yield ───────
  const { data: recRows, error: recErr } = await sb
    .from("recipes")
    .select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  if (recErr) throw new Error(`recipes read failed: ${recErr.message}`);

  const { data: outRows, error: outErr } = await sb
    .from("recipe_outputs")
    .select("recipe_id, output_item_id, yield")
    .not("output_item_id", "is", null)
    .returns<Array<{ recipe_id: string; output_item_id: string; yield: number | string }>>();
  if (outErr) throw new Error(`recipe_outputs read failed: ${outErr.message}`);

  const { data: itemRows, error: itemErr } = await sb
    .from("items")
    .select("id, name, oz_per_par_unit")
    .returns<Array<{ id: string; name: string; oz_per_par_unit: number | string | null }>>();
  if (itemErr) throw new Error(`items read failed: ${itemErr.message}`);

  const recipeIdByName = new Map(recRows?.map((r) => [r.name, r.id]) ?? []);
  const outputOfRecipe = new Map<string, { itemId: string; yield: number }>();
  for (const o of outRows ?? []) {
    if (outputOfRecipe.has(o.recipe_id)) continue; // first-wins, mirroring the graph index
    outputOfRecipe.set(o.recipe_id, { itemId: o.output_item_id, yield: Number(o.yield) });
  }
  const ozPerParUnitByItem = new Map(
    (itemRows ?? []).map((i) => [i.id, i.oz_per_par_unit == null ? null : Number(i.oz_per_par_unit)]),
  );

  // ── SKU name → id, so the fixture's per-lb prices can key by SKU id ────────
  const { data: skuRows, error: skuErr } = await sb
    .from("vendor_items")
    .select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  if (skuErr) throw new Error(`vendor_items read failed: ${skuErr.message}`);

  const skuNameById = new Map((skuRows ?? []).map((s) => [s.id, s.name]));
  const costPerOzBySku = new Map<string, number | null>();
  for (const s of skuRows ?? []) {
    const perLb = ANGEL_PRICE_PER_LB[s.name];
    costPerOzBySku.set(s.id, perLb == null ? null : perLb / 16);
  }

  const graph = await loadRecipeGraph();

  // ── Re-cost every mapped recipe ───────────────────────────────────────────
  const rows: Row[] = [];
  for (const angel of ANGEL_RECIPES) {
    const base: Row = {
      angel, coopsBatch: null, coopsPerLb: null, perLbBasis: null,
      unpriced: [], flagged: [], note: "",
    };

    if (angel.excluded) {
      rows.push({ ...base, note: `EXCLUDED — ${angel.excluded}` });
      continue;
    }
    if (angel.coops == null) {
      rows.push({ ...base, note: "not modelled in co-ops" });
      continue;
    }
    const recipeId = recipeIdByName.get(angel.coops);
    if (!recipeId) {
      rows.push({ ...base, note: `co-ops recipe "${angel.coops}" NOT FOUND` });
      continue;
    }
    const out = outputOfRecipe.get(recipeId);
    if (!out) {
      rows.push({ ...base, note: "co-ops recipe has no item output" });
      continue;
    }

    const perUnitOz = perUnitSkuOzForItemFromGraph(graph, out.itemId);
    if (perUnitOz.size === 0) {
      rows.push({ ...base, note: "UNRESOLVED — the oz flatten poisons (engine gap or SKU data gap)" });
      continue;
    }

    const poisoned: string[] = [];
    const unpriced: string[] = [];
    const flagged: string[] = [];
    let perUnitCost = 0;
    let perUnitInputOz = 0;

    for (const [skuId, oz] of perUnitOz) {
      const name = skuNameById.get(skuId) ?? skuId;
      perUnitInputOz += oz;
      if (POISONED_SKUS[name]) { poisoned.push(name); continue; }
      const costPerOz = costPerOzBySku.get(skuId) ?? null;
      if (costPerOz == null) { unpriced.push(name); continue; }
      if (FLAGGED_PRICES[name]) flagged.push(name);
      perUnitCost += oz * costPerOz;
    }

    if (poisoned.length > 0) {
      rows.push({
        ...base, unpriced, flagged,
        note: `EXCLUDED — pickle-contaminated: ${poisoned.map((p) => POISONED_SKUS[p]).join("; ")}`,
      });
      continue;
    }
    if (unpriced.length > 0) {
      rows.push({
        ...base, unpriced, flagged,
        note: `INCOMPARABLE — ${unpriced.length} unpriced: ${unpriced.sort().join(", ")}`,
      });
      continue;
    }

    // batchOz = perUnitOz x output yield (single-output recipes: share = 1).
    const batchCost = perUnitCost * out.yield;
    const declaredOzPerPar = ozPerParUnitByItem.get(out.itemId) ?? null;
    const finishedBatchOz =
      declaredOzPerPar != null && declaredOzPerPar > 0
        ? declaredOzPerPar * out.yield
        : perUnitInputOz * out.yield;
    rows.push({
      ...base,
      coopsBatch: batchCost,
      coopsPerLb: finishedBatchOz > 0 ? batchCost / (finishedBatchOz / 16) : null,
      perLbBasis: declaredOzPerPar != null && declaredOzPerPar > 0 ? "declared" : "inputs",
      unpriced, flagged,
      note: flagged.length > 0 ? `flagged price: ${[...new Set(flagged)].sort().join(", ")}` : "",
    });
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  const W = { name: 30, num: 10, delta: 9 };
  console.log("COMPARABLE ROWS");
  console.log(
    pad("Recipe", W.name) + padL("Angel $", W.num) + padL("co-ops $", W.num) +
    padL("Δ$", W.num) + padL("Δ%", W.delta) + padL("Angel $/lb", 12) + padL("ours $/lb", 11) + "  basis",
  );
  console.log("-".repeat(30 + 10 * 3 + 9 + 12 + 11 + 10));

  const comparable = rows.filter((r) => r.coopsBatch != null);
  const findings: string[] = [];
  for (const r of comparable) {
    const ours = r.coopsBatch!;
    const theirs = r.angel.batchCost;
    const d = ours - theirs;
    const dp = theirs !== 0 ? (d / theirs) * 100 : NaN;
    console.log(
      pad(r.angel.angel, W.name) + padL(fmt(theirs), W.num) + padL(fmt(ours), W.num) +
      padL((d >= 0 ? "+" : "") + fmt(d), W.num) +
      padL(Number.isFinite(dp) ? (dp >= 0 ? "+" : "") + dp.toFixed(1) + "%" : "—", W.delta) +
      padL(fmt(r.angel.perLb), 12) + padL(fmt(r.coopsPerLb), 11) + "  " + (r.perLbBasis ?? "—") +
      (r.note ? "  · " + r.note : ""),
    );
    if (Number.isFinite(dp) && Math.abs(dp) > DELTA_FINDING_PCT) {
      findings.push(`${r.angel.angel}: ${dp >= 0 ? "+" : ""}${dp.toFixed(1)}% (Angel $${fmt(theirs)} vs ours $${fmt(ours)})`);
    }
  }
  if (comparable.length === 0) console.log("  (none)");

  const incomparable = rows.filter((r) => r.coopsBatch == null && r.note.startsWith("INCOMPARABLE"));
  const excluded = rows.filter((r) => r.note.startsWith("EXCLUDED"));
  const unresolved = rows.filter((r) => r.note.startsWith("UNRESOLVED"));
  const absent = rows.filter((r) => r.coopsBatch == null && !r.note.startsWith("INCOMPARABLE") && !r.note.startsWith("EXCLUDED") && !r.note.startsWith("UNRESOLVED"));

  const section = (title: string, list: Row[]) => {
    console.log("");
    console.log(`${title} (${list.length})`);
    if (list.length === 0) { console.log("  (none)"); return; }
    for (const r of list) console.log("  " + pad(r.angel.angel, W.name) + " " + r.note);
  };

  section("EXCLUDED — documented bad Angel rows", excluded);
  section("UNRESOLVED — our flatten could not produce ounces", unresolved);
  section("INCOMPARABLE — our engine resolved, but the fixture has no price for some line", incomparable);
  section("NOT MODELLED in co-ops", absent);

  console.log("");
  console.log(`FINDINGS — deltas over ${DELTA_FINDING_PCT}% on clean rows (${findings.length})`);
  if (findings.length === 0) console.log("  (none)");
  for (const f of findings) console.log("  · " + f);

  console.log("");
  console.log("SUMMARY");
  console.log(`  ${ANGEL_RECIPES.length} Angel §6.1 rows · ${comparable.length} compared · ${findings.length} over-threshold`);
  console.log(`  ${excluded.length} excluded · ${unresolved.length} unresolved · ${incomparable.length} incomparable · ${absent.length} not modelled`);
  console.log("");
  console.log("NOTE ON $/lb BASIS: 'declared' uses items.oz_per_par_unit (a FINISHED weight,");
  console.log("  co-ops' equivalent of Angel's Weight per Unit — this is how cook-down is");
  console.log("  expressed). 'inputs' means that field is unset, so finished weight falls back");
  console.log("  to the raw input sum, which UNDERSTATES $/lb for anything that cooks down.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  (args.includes("--wave7") || args.includes("--readiness") ? liveWave7Main(args) : main()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
