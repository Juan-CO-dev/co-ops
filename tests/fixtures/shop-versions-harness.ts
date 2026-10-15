/**
 * Catalog Phase 2a — THE EQUIVALENCE PIN's engine. One function computes every number the spec's
 * precondition names (spec §3, §8), per scope, through a small ResolverApi so the SAME
 * computation runs over today's loaders (Task 1 freezes the golden with them) and over the scoped
 * loaders (Tasks 5–6 change ONLY the `liveApi` lines marked TASK-5 / TASK-6).
 *
 * The numbers: pack chains per SKU (every pack consumer's input); the whole-catalog chain read
 * (counts); the current price and the PO's cents per SKU; per graph — live AND dated (a business
 * date after every boundary, which must equal live) — the hydrated skuPack, depletion oz per menu
 * item and prep item, cost per oz, the menu/prep cost rollups; the order-unit oz per SKU
 * (perOrderUnitOz — the ONLY pack/price input to the walk's suggestion and Dynamic Pars); and the
 * FLAT content oz that manual production and catering surplus divide by.
 */
import { createDatedGraphs, loadAllSkuPackChains, loadMeasures, loadRecipeGraph, loadSkuPackChains, loadSkuPackResolution } from "@/lib/prep-consumption";
import { contentOzForScope } from "@/lib/sku-versions-shared";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { rollupItemCost, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { perOrderUnitOz } from "@/lib/ordering";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export interface FlatPack { unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null }

/** The resolver surface the pin exercises. `scope` null = the global default. */
export interface ResolverApi {
  chains(skuIds: string[], scope: string | null): Promise<Map<string, PackChainLevel[]>>;
  allChains(scope: string | null): Promise<Map<string, PackChainLevel[]>>;
  prices(skuIds: string[], scope: string | null): Promise<Map<string, number>>;
  graph(scope: string | null): Promise<RecipeGraph>;
  datedGraph(scope: string | null, businessDate: string): Promise<RecipeGraph>;
  flatContent(flat: ReadonlyMap<string, FlatPack>, scope: string | null, measures: Map<string, MeasureUnitFactor>): Promise<Map<string, number | null>>;
}

/**
 * THE LIVE API. Task 1: today's loaders (unscoped; every shop reads the global answer, which is
 * exactly what "no shop versions" must keep producing). Task 5 and Task 6 replace the marked
 * lines with the scoped calls and change NOTHING else in this file.
 */
export const liveApi: ResolverApi = {
  chains: (skuIds, scope) => loadSkuPackChains(skuIds, scope),
  allChains: (scope) => loadAllSkuPackChains(scope),
  prices: (skuIds, _scope) => loadCurrentSkuPrices(skuIds), // TASK-6
  graph: (scope) => loadRecipeGraph(scope == null ? undefined : { locationId: scope }),
  datedGraph: (scope, businessDate) => createDatedGraphs({ locationId: scope })(businessDate),
  flatContent: async (flat, scope, measures) => {
    const packs = await loadSkuPackResolution([...flat.keys()], scope);
    return new Map([...flat].map(([id, f]) => [id, contentOzForScope(f, packs.get(id), measures)]));
  },
};

const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
function sorted<V>(m: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
/** The PO's dollars → cents rule (lib/purchase-orders.ts:840-845), spelled once here for the pin. */
function cents(d: number): number {
  return Math.round(Number((d * 100).toFixed(4)));
}
function shapeOf(r: Row): RecipeInputSku {
  return {
    packFormat: (r.pack_format as string | null) ?? null,
    eachContainerLabel: (r.each_container_label as string | null) ?? null,
    unitsPerPack: n(r.units_per_pack), eachSize: n(r.each_size),
    eachMeasure: (r.each_measure as string | null) ?? null, avgOzPerEach: n(r.avg_oz_per_each),
  };
}

export interface ScopeOutputs {
  chains: Record<string, PackChainLevel[]>;
  allChains: Record<string, PackChainLevel[]>;
  prices: Record<string, number>;
  priceCents: Record<string, number>;
  orderUnitOz: Record<string, number | null>;
  flatContentOz: Record<string, number | null>;
  graph: {
    skuPack: Record<string, RecipeInputSku>;
    menuOz: Record<string, Record<string, number>>;
    itemOz: Record<string, Record<string, number>>;
    costPerOz: Record<string, number | null>;
    menuCost: Record<string, unknown>;
    itemCost: Record<string, unknown>;
  };
  datedMenuOz: Record<string, Record<string, number>>;
  /** The optional second dated probe (a day INSIDE a superseded version; chunk-1 review). */
  datedProbe?: { day: string; menuOz: Record<string, Record<string, number>> };
}
export type EquivalenceOutputs = Record<string, ScopeOutputs>;

/** Every number, for "global" and for each shop id in `shopIds`. JSON-normalized. */
export async function computeOutputs(api: ResolverApi, tables: Tables, shopIds: readonly string[], datedDay: string, probeDay?: string): Promise<EquivalenceOutputs> {
  const skuRows = [...(tables.vendor_items ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const skuIds = skuRows.map((r) => String(r.id));
  const outputs = tables.recipe_outputs ?? [];
  const menuIds = [...new Set(outputs.map((o) => o.output_menu_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const itemIds = [...new Set(outputs.map((o) => o.output_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const measures = await loadMeasures();
  // Production's and surplus's own flat read: units_per_pack, each_size, each_measure, avg_oz_per_each.
  const flat = new Map(skuRows.map((r) => [String(r.id), { unitsPerPack: n(r.units_per_pack), eachSize: n(r.each_size), eachMeasure: (r.each_measure as string | null) ?? null, avgOzPerEach: n(r.avg_oz_per_each) }]));
  const out: EquivalenceOutputs = {};
  for (const label of ["global", ...shopIds]) {
    const scope = label === "global" ? null : label;
    const chains = await api.chains(skuIds, scope);
    const allChains = await api.allChains(scope);
    const prices = await api.prices(skuIds, scope);
    const graph = await api.graph(scope);
    const dated = await api.datedGraph(scope, datedDay);
    const probe = probeDay === undefined ? null : await api.datedGraph(scope, probeDay);
    const costPerOz = costPerOzFromGraph(graph, prices);
    out[label] = {
      chains: sorted(chains),
      allChains: sorted(allChains),
      prices: sorted(prices),
      priceCents: sorted(new Map([...prices].map(([id, d]) => [id, cents(d)]))),
      orderUnitOz: Object.fromEntries(skuRows.map((r) => {
        const id = String(r.id);
        // The shape carries the chain exactly as every real caller builds it
        // (lib/ordering.ts:862, :1555, :1892; lib/dynamic-pars.ts) — ozForRecipeInput walks it.
        const chain = chains.get(id) ?? null;
        return [id, perOrderUnitOz({ ...shapeOf(r), packChain: chain }, chain, measures)];
      })),
      flatContentOz: sorted(await api.flatContent(flat, scope, measures)),
      graph: {
        skuPack: sorted(graph.skuPack),
        menuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(graph, m))])),
        itemOz: Object.fromEntries(itemIds.map((i) => [i, sorted(perUnitSkuOzForItemFromGraph(graph, i))])),
        costPerOz: sorted(costPerOz),
        menuCost: Object.fromEntries(menuIds.map((m) => [m, rollupMenuItemCost(graph, m, costPerOz)])),
        itemCost: Object.fromEntries(itemIds.map((i) => [i, rollupItemCost(graph, i, costPerOz)])),
      },
      datedMenuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(dated, m))])),
      ...(probe && probeDay !== undefined ? { datedProbe: { day: probeDay, menuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(probe, m))])) } } : {}),
    };
  }
  return JSON.parse(JSON.stringify(out)) as EquivalenceOutputs;
}
