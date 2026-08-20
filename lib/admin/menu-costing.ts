/**
 * Menu costing board data layer — SERVER-ONLY, service-role.
 *
 * The payoff screen's loader: every active menu_item, its menu price, its
 * rolled-up food cost, and an honest account of what is missing. Read-only —
 * this module writes nothing and has no mutation path.
 *
 * BATCH-LOADED, NEVER PER-NODE (the loadRecipeGraph law, AGENTS.md): ONE
 * loadRecipeGraph() for the whole recipe universe (6 fixed queries) + ONE
 * price read + ONE menu_items read + at most TWO name reads (the blocking SKUs
 * and the mass-inconsistent prep items, each skipped when that failure mode is
 * absent). Cost for 68 menu items costs the same number of queries as for one.
 *
 * COST/OZ COMES OFF THE GRAPH'S OWN SKU PACK DATA, on purpose. loadRecipeGraph
 * already hydrates every referenced SKU's pack fields AND its active pack chain
 * (lib/prep-consumption.ts loadSkuPack), so deriving content_oz from
 * graph.skuPack means the dollars ride exactly the same oz resolution as the
 * flatten — chain-aware, count-aware, same nulls in the same places. Going
 * through lib/admin/cost.ts's computeSkuCostPerOz instead would silently use
 * the LEGACY FLAT-FIELD path (it takes no packChain), and 50 of the 77
 * recipe-referenced SKUs in prod carry chains — the two would disagree.
 * (That chain-blindness is pre-existing on /admin/skus and /admin/vendors/[id];
 * flagged, deliberately not changed here — different surface, own PR.)
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { COST_READ_MIN, loadCurrentSkuPrices } from "@/lib/admin/cost";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import type { RecipeGraph } from "@/lib/prep-consumption-graph";
import { skuContentOz, skuCostPerOz } from "@/lib/recipe-math";
import {
  composeMenuCostRows,
  summarizeMenuCostRows,
  type MenuCostInput,
  type MenuCostRow,
  type MenuCostTotals,
} from "@/lib/menu-costing-shared";

/** AGM+ — same floor as every other cost read (lib/admin/cost.ts COST_READ_MIN). */
export const MENU_COSTING_READ_MIN = COST_READ_MIN;

export class MenuCostingError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "MenuCostingError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new MenuCostingError(403, "forbidden", "Insufficient role level for this action");
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * $/oz for every SKU the recipe universe references.
 *
 * null when the SKU has no current price OR no resolvable content_oz — the two
 * are indistinguishable downstream and both mean the same thing to the board:
 * this line cannot be costed, count it.
 */
export function costPerOzFromGraph(
  graph: RecipeGraph,
  prices: Map<string, number>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [skuId, pack] of graph.skuPack) {
    out.set(skuId, skuCostPerOz(prices.get(skuId) ?? null, skuContentOz(pack, graph.measures)));
  }
  return out;
}

export interface MenuCostingBoard {
  rows: MenuCostRow[];
  totals: MenuCostTotals;
  /** Display names for the SKUs blocking at least one row, so the UI can name them. */
  skuNames: Record<string, string>;
  /**
   * Display names (en + es) for the mass-inconsistent PREP ITEMS blocking at
   * least one row. Same job as skuNames on the other failure mode: the drawer
   * must be able to say WHICH recipe is out of balance, not just that one is.
   */
  itemNames: Record<string, { en: string; es: string | null }>;
}

/**
 * The whole board. On a system with no prices recorded yet this correctly
 * returns every row as `unpriced` with its full blocking-SKU count — that is
 * the designed day-one output, not a failure, and the counts fall as the price
 * ledger fills.
 */
export async function loadMenuCostingBoard(actor: AuthContext): Promise<MenuCostingBoard> {
  requireLevel(actor, MENU_COSTING_READ_MIN);
  const sb = getServiceRoleClient();

  const [graph, menuRes] = await Promise.all([
    loadRecipeGraph(),
    sb
      .from("menu_items")
      .select("id, name, name_es, section, menu_price")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null }>>(),
  ]);
  if (menuRes.error) throw new Error(`loadMenuCostingBoard menu_items: ${menuRes.error.message}`);

  const inputs: MenuCostInput[] = (menuRes.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    nameEs: m.name_es,
    section: m.section,
    menuPrice: num(m.menu_price),
  }));

  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()]);
  const rows = composeMenuCostRows(inputs, graph, costPerOzFromGraph(graph, prices));
  const totals = summarizeMenuCostRows(rows);

  const blocking = [...new Set(rows.flatMap((r) => r.rollup.unpricedSkuIds))];
  const broken = [...new Set(rows.flatMap((r) => r.rollup.inconsistentItemIds))];
  const skuNames: Record<string, string> = {};
  const itemNames: Record<string, { en: string; es: string | null }> = {};
  // Two name lookups, each skipped entirely when its failure mode is absent —
  // so a clean board still costs exactly the queries the header promises.
  const [skuRes, itemRes] = await Promise.all([
    blocking.length > 0
      ? sb.from("vendor_items").select("id, name").in("id", blocking).returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    broken.length > 0
      ? sb.from("items").select("id, name, name_es").in("id", broken).returns<Array<{ id: string; name: string; name_es: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; name_es: string | null }> }),
  ]);
  for (const s of skuRes.data ?? []) skuNames[s.id] = s.name;
  for (const i of itemRes.data ?? []) itemNames[i.id] = { en: i.name, es: i.name_es };

  return { rows, totals, skuNames, itemNames };
}
