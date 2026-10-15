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
