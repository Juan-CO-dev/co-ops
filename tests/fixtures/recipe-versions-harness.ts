/**
 * Catalog Phase 3a — THE RECIPE / MENU EQUIVALENCE PIN's engine. One function computes every number
 * the spec's precondition names for recipes and menu items (spec §3, §8), per scope, through the
 * public loaders: live graph oz + costs, the dated graph of each business date, and the menu costing
 * board. The API is the shipped one — Tasks 5–6 change what is UNDER it, never this file.
 */
import { createDatedGraphs, loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, loadMenuCostingBoard } from "@/lib/admin/menu-costing";
import { rollupItemCost, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface RecipeResolverApi {
  graph(scope: string | null): Promise<RecipeGraph>;
  datedGraph(scope: string | null, businessDate: string): Promise<RecipeGraph>;
  prices(skuIds: string[], scope: string | null): Promise<Map<string, number>>;
  board(actor: AuthContext, scope: string | null): ReturnType<typeof loadMenuCostingBoard>;
}

export const liveRecipeApi: RecipeResolverApi = {
  graph: (scope) => loadRecipeGraph(scope == null ? undefined : { locationId: scope }),
  datedGraph: (scope, businessDate) => createDatedGraphs({ locationId: scope })(businessDate),
  prices: (skuIds, scope) => loadCurrentSkuPrices(skuIds, scope),
  board: (actor, scope) => loadMenuCostingBoard(actor, scope == null ? {} : { scope }),
};

/** The viewer for the board: an owner (level 9) reads every shop. */
export const OWNER_ACTOR = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;

function sorted<V>(m: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface RecipeScopeOutputs {
  menuOz: Record<string, Record<string, number>>;
  itemOz: Record<string, Record<string, number>>;
  costPerOz: Record<string, number | null>;
  menuCost: Record<string, unknown>;
  itemCost: Record<string, unknown>;
  datedMenuOz: Record<string, Record<string, Record<string, number>>>;
  board: { rows: unknown[]; totals: unknown };
}
export type RecipeEquivalenceOutputs = Record<string, RecipeScopeOutputs>;

/** Every number, for "global" and each shop in `shopIds`. JSON-normalized. */
export async function computeRecipeOutputs(
  api: RecipeResolverApi, tables: Tables, shopIds: readonly string[], days: readonly string[],
): Promise<RecipeEquivalenceOutputs> {
  const outputs = tables.recipe_outputs ?? [];
  const menuIds = [...new Set(outputs.map((o) => o.output_menu_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const itemIds = [...new Set(outputs.map((o) => o.output_item_id).filter((v): v is string => typeof v === "string"))].sort();
  const out: RecipeEquivalenceOutputs = {};
  for (const label of ["global", ...shopIds]) {
    const scope = label === "global" ? null : label;
    const graph = await api.graph(scope);
    const prices = await api.prices([...graph.skuPack.keys()], scope);
    const costPerOz = costPerOzFromGraph(graph, prices);
    const datedMenuOz: RecipeScopeOutputs["datedMenuOz"] = {};
    for (const day of days) {
      const dated = await api.datedGraph(scope, day);
      datedMenuOz[day] = Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(dated, m))]));
    }
    const board = await api.board(OWNER_ACTOR, scope);
    out[label] = {
      menuOz: Object.fromEntries(menuIds.map((m) => [m, sorted(perUnitSkuOzForMenuItemFromGraph(graph, m))])),
      itemOz: Object.fromEntries(itemIds.map((i) => [i, sorted(perUnitSkuOzForItemFromGraph(graph, i))])),
      costPerOz: sorted(costPerOz),
      menuCost: Object.fromEntries(menuIds.map((m) => [m, rollupMenuItemCost(graph, m, costPerOz)])),
      itemCost: Object.fromEntries(itemIds.map((i) => [i, rollupItemCost(graph, i, costPerOz)])),
      datedMenuOz,
      board: {
        rows: board.rows.map((r) => ({
          id: r.id, name: r.name, nameEs: r.nameEs, section: r.section, menuPrice: r.menuPrice, typedPrice: r.typedPrice ?? null,
          priceSource: r.priceSource ?? null, foodCostPct: r.foodCostPct, marginDollars: r.marginDollars,
          overThreshold: r.overThreshold, rollup: r.rollup,
        })),
        totals: board.totals,
      },
    };
  }
  return JSON.parse(JSON.stringify(out)) as RecipeEquivalenceOutputs;
}

// ── THE DIRECT LINE READERS (chunk-1 review P2-2): every reader that reads recipe_inputs itself, outside the
// graph — the ones Task 6b routes through the one resolver. Frozen BEFORE 6b, so the reroute is proven to move
// no number while no shop version exists. Per shop where the reader is (or will be) shop-aware.
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import { loadSkuUsageMap } from "@/lib/admin/cost";
import { loadProductItemLinks } from "@/lib/admin/product-item-links";
import { loadDemandSources } from "@/lib/ordering";
import { loadProductionFormData, recordProduction } from "@/lib/production";
import { listProducts } from "@/lib/products";
import { getServiceRoleClient } from "@/lib/supabase-server";

export interface LineReaderOutputs {
  readiness: { recipes: Record<string, unknown>; items: Record<string, unknown> };
  skuUsage: Record<string, string[]>;
  productLinks: unknown;
  productPins: Array<{ id: string; pinned: unknown }>;
  demandSources: { activeRefsBySku: Record<string, number>; removedSourcesBySku: Record<string, string[]> };
  /** shop → the production picker's SKU → items map. */
  productionPicker: Record<string, unknown>;
  /** shop → "sku>item" → accepted | the ProductionError code (the conversion check). */
  conversions: Record<string, Record<string, string>>;
}

/** The conversion pairs the check is asked about: every SKU line × every item output, in id order. */
function conversionPairs(tables: Tables): Array<[string, string]> {
  const skus = [...new Set((tables.vendor_items ?? []).filter((s) => s.active !== false).map((s) => String(s.id)))].sort();
  const items = [...new Set((tables.recipe_outputs ?? []).map((o) => o.output_item_id).filter((v): v is string => typeof v === "string"))].sort();
  return skus.flatMap((s) => items.map((i) => [s, i] as [string, string]));
}

export async function computeLineReaderOutputs(tables: Tables, shopIds: readonly string[]): Promise<LineReaderOutputs> {
  const readiness = await loadGraphReadiness(OWNER_ACTOR, null);
  const skuUsage = await loadSkuUsageMap();
  const productLinks = await loadProductItemLinks(OWNER_ACTOR);
  const products = await listProducts(OWNER_ACTOR);
  const skus = (tables.vendor_items ?? []).map((s) => ({ id: String(s.id), product_id: (s.product_id as string | null | undefined) ?? null }));
  // The walk's demand sources are per shop since 6b; with no shop version every shop answers as the default did.
  const demand = await loadDemandSources(getServiceRoleClient(), skus, shopIds[0]!);
  const productionPicker: Record<string, unknown> = {};
  const conversions: Record<string, Record<string, string>> = {};
  for (const shop of shopIds) {
    productionPicker[shop] = (await loadProductionFormData(OWNER_ACTOR, shop)).skuToItems;
  }
  // The check LAST: an accepted conversion writes a production into the in-memory stand-in.
  for (const shop of shopIds) {
    const out: Record<string, string> = {};
    for (const [sku, item] of conversionPairs(tables)) {
      try {
        await recordProduction(OWNER_ACTOR, { locationId: shop, inputSkuId: sku, outputItemId: item, inputQty: 1, outputQty: 1, notes: null });
        out[`${sku}>${item}`] = "accepted";
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        out[`${sku}>${item}`] = typeof code === "string" ? code : `error:${(e as Error).message}`;
      }
    }
    conversions[shop] = out;
  }
  return JSON.parse(JSON.stringify({
    readiness: { recipes: sorted(readiness.recipeReadiness), items: sorted(readiness.itemReadiness) },
    skuUsage: sorted(skuUsage),
    productLinks,
    productPins: products.map((p) => ({ id: p.id, pinned: p.pinnedRecipes })),
    demandSources: { activeRefsBySku: sorted(demand.activeRefsBySku), removedSourcesBySku: sorted(demand.removedSourcesBySku) },
    productionPicker,
    conversions,
  })) as LineReaderOutputs;
}
