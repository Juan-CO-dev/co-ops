/**
 * Menu costing rollup — PURE, client-safe (zero I/O, no server imports).
 *
 * The math behind the menu costing board (/admin/menu-costing): one rolled-up
 * food cost per menu_item, traversing the SAME flatten engine everything else
 * uses (lib/prep-consumption-graph.ts) — builds → recipes → nested recipes →
 * leaf SKUs — and pricing the leaves with cost/oz.
 *
 * THIS IS NOT A SECOND ENGINE. The oz math is entirely
 * perUnitSkuOzForMenuItemFromGraph / perUnitSkuOzForItemFromGraph; this module
 * only layers DOLLARS onto the oz map they already return, and reports the
 * result's completeness honestly. Count units (avg_oz_per_each), pack chains,
 * recipe→recipe nesting and fan-out shares are all resolved upstream and are
 * inherited here for free.
 *
 * ── The two failure modes are DIFFERENT and must never be conflated ──────────
 *
 *  1. OZ-UNRESOLVABLE (the flatten poisons to empty): an unknown SKU pack, an
 *     un-convertible unit, a dangling component, a cycle. The engine's law is
 *     all-or-nothing per entity — never partial (see prep-consumption-graph's
 *     header). We surface that as `unresolved`, NOT as $0 and NOT as "no
 *     recipe". A poisoned flatten and an unbuilt menu item look identical from
 *     the oz map alone (both empty), so we disambiguate with the graph's own
 *     index: graph.byOutputMenuItem.has(id) === "a recipe exists".
 *
 *  2. UNPRICED (a leaf SKU has no price): does NOT poison anything. Per the
 *     Angel-parity doctrine (docs/angel-spend-insights.md §2.2) a missing price
 *     makes that LINE unpriced and COUNTED — never a fabricated $0, never a
 *     blocked screen. The count rides along with every cost figure and counts
 *     down as prices land.
 *
 * A "line" here is a distinct LEAF SKU in the flattened rollup, not a row of
 * the recipe form. Angel counts unpriced lines of the recipe you are editing;
 * because we flatten to leaves, the leaf count is both the honest analogue and
 * the more useful one — it names exactly which SKUs to go price.
 *
 * WHY A PARTIAL COST IS NEVER PRESENTED AS "THE COST": with any line unpriced
 * the true cost is strictly greater than what we can add up, so FC% and margin
 * derived from it would be optimistic in the one direction an owner must never
 * be misled. `cost` is non-null ONLY when the rollup is complete; the partial
 * subtotal is carried separately as `pricedCost` and must be rendered with a
 * "so far"-style label, never as the cost.
 */
import {
  perUnitSkuOzForItemFromGraph,
  perUnitSkuOzForMenuItemFromGraph,
  type RecipeGraph,
} from "@/lib/prep-consumption-graph";

/**
 * Food-cost % ABOVE which a row gets danger treatment on the board.
 *
 * CONFIG-IN-CODE, deliberately: Angel ships a single hardcoded threshold with
 * no UI to change it (~30% observed — 43.9% flags red, 27.7% does not; see
 * docs/angel-spend-insights.md §1.2) and one number is the right amount of
 * configuration for one restaurant. When a second tenant needs a different
 * band, this becomes a tenant-DB row per the AGENTS.md tenant-config boundary
 * (code owns BEHAVIOR, the tenant DB owns VOCABULARY/CONTENT) — until then, a
 * named constant beats a settings table nobody edits.
 */
export const FOOD_COST_RED_THRESHOLD_PCT = 30;

/**
 * The five honest outcomes of costing one menu item. Ordered by how actionable
 * they are, which is also the board's default grouping (see compareMenuCostRows).
 */
export type MenuCostStatus =
  /** Flatten resolved and EVERY leaf SKU carries a price. `cost` is real. */
  | "costed"
  /** Flatten resolved; some leaves priced, some not. `cost` is null by design. */
  | "partial"
  /** Flatten resolved; NOT ONE leaf priced. The day-one state for most rows. */
  | "unpriced"
  /** A recipe exists but the oz flatten is unresolvable (poisoned) — a DATA BUG to fix. */
  | "unresolved"
  /** No producing/build recipe at all. Nothing to cost yet. */
  | "no_recipe";

export interface MenuCostRollup {
  status: MenuCostStatus;
  /**
   * The complete rolled-up cost. NON-NULL ONLY when status === "costed" — an
   * incomplete rollup has no honest single number (see the module header).
   */
  cost: number | null;
  /** Σ of the lines we COULD price. A lower bound on the true cost, never "the cost". */
  pricedCost: number;
  /** Distinct leaf SKUs that resolved to both oz AND a price. */
  pricedLineCount: number;
  /** Distinct leaf SKUs that resolved to oz but have NO price — the `(N unpriced)` badge. */
  unpricedLineCount: number;
  /** Which SKUs those are, sorted, so the UI/report can name them. */
  unpricedSkuIds: string[];
}

const EMPTY_ROLLUP = (status: MenuCostStatus): MenuCostRollup => ({
  status,
  cost: null,
  pricedCost: 0,
  pricedLineCount: 0,
  unpricedLineCount: 0,
  unpricedSkuIds: [],
});

/**
 * Layer dollars onto an already-resolved per-unit SKU-oz map.
 *
 * `costPerOzBySku` missing a key and mapping it to null mean the SAME thing —
 * no price — because that is what both producers do: computeSkuCostPerOz sets
 * null for a SKU with no price OR no content_oz, and a SKU absent from the
 * price ledger never gets an entry at all. Treating them identically is what
 * keeps a missing price from silently becoming $0.
 */
function rollupFromPerUnitOz(
  perUnitOz: Map<string, number>,
  costPerOzBySku: Map<string, number | null>,
): MenuCostRollup {
  let pricedCost = 0;
  let pricedLineCount = 0;
  const unpricedSkuIds: string[] = [];

  for (const [skuId, oz] of perUnitOz) {
    const costPerOz = costPerOzBySku.get(skuId) ?? null;
    if (costPerOz == null || !Number.isFinite(costPerOz)) {
      unpricedSkuIds.push(skuId);
      continue;
    }
    pricedCost += oz * costPerOz;
    pricedLineCount += 1;
  }
  unpricedSkuIds.sort();

  const unpricedLineCount = unpricedSkuIds.length;
  const status: MenuCostStatus =
    unpricedLineCount === 0 ? "costed" : pricedLineCount === 0 ? "unpriced" : "partial";

  return {
    status,
    cost: status === "costed" ? pricedCost : null,
    pricedCost,
    pricedLineCount,
    unpricedLineCount,
    unpricedSkuIds,
  };
}

/**
 * Cost of ONE unit of a MENU_ITEM (a sub/side as sold), flattened to leaf SKUs.
 *
 * The empty oz map is ambiguous by itself (poisoned flatten vs no recipe), so
 * the graph's own output index decides which — see the module header, failure
 * mode 1.
 */
export function rollupMenuItemCost(
  graph: RecipeGraph,
  menuItemId: string,
  costPerOzBySku: Map<string, number | null>,
): MenuCostRollup {
  if (!graph.byOutputMenuItem.has(menuItemId)) return EMPTY_ROLLUP("no_recipe");
  const perUnitOz = perUnitSkuOzForMenuItemFromGraph(graph, menuItemId);
  if (perUnitOz.size === 0) return EMPTY_ROLLUP("unresolved");
  return rollupFromPerUnitOz(perUnitOz, costPerOzBySku);
}

/**
 * Cost of ONE par-unit of an ITEM (a prep). Same semantics as the menu variant;
 * used by the Angel parity harness, which re-costs PREP recipes (§6.1), and
 * available to any future per-recipe cost readout.
 */
export function rollupItemCost(
  graph: RecipeGraph,
  itemId: string,
  costPerOzBySku: Map<string, number | null>,
): MenuCostRollup {
  if (!graph.byOutputItem.has(itemId)) return EMPTY_ROLLUP("no_recipe");
  const perUnitOz = perUnitSkuOzForItemFromGraph(graph, itemId);
  if (perUnitOz.size === 0) return EMPTY_ROLLUP("unresolved");
  return rollupFromPerUnitOz(perUnitOz, costPerOzBySku);
}

// ── Board rows ───────────────────────────────────────────────────────────────

/** What the loader hands the pure composer — one active menu_item. */
export interface MenuCostInput {
  id: string;
  name: string;
  nameEs: string | null;
  section: string | null;
  /** menu_items.menu_price in DOLLARS (numeric in PG); null when unset. */
  menuPrice: number | null;
}

export interface MenuCostRow extends MenuCostInput {
  rollup: MenuCostRollup;
  /** (cost ÷ menu price) × 100. Null unless the rollup is COMPLETE and price > 0. */
  foodCostPct: number | null;
  /** menu price − cost. Null unless the rollup is COMPLETE. */
  marginDollars: number | null;
  /** FC% strictly above the threshold → danger treatment. */
  overThreshold: boolean;
}

/**
 * Derive FC% / margin / threshold for one row.
 *
 * Both derived figures gate on `rollup.cost` being non-null — i.e. on a
 * COMPLETE rollup. A food-cost % computed from a partial cost understates the
 * true percentage, which is the flattering direction, so it is exactly the
 * number an owner must never be shown by accident.
 */
export function toMenuCostRow(input: MenuCostInput, rollup: MenuCostRollup): MenuCostRow {
  const cost = rollup.cost;
  const price = input.menuPrice;
  const foodCostPct = cost != null && price != null && price > 0 ? (cost / price) * 100 : null;
  const marginDollars = cost != null && price != null ? price - cost : null;
  return {
    ...input,
    rollup,
    foodCostPct,
    marginDollars,
    overThreshold: foodCostPct != null && foodCostPct > FOOD_COST_RED_THRESHOLD_PCT,
  };
}

/** Default grouping: fully-costed rows first, then the ones nearest to being costable. */
const STATUS_RANK: Record<MenuCostStatus, number> = {
  costed: 0,
  partial: 1,
  unpriced: 2,
  unresolved: 3,
  no_recipe: 4,
};

/**
 * The board's default order.
 *
 *  - COSTED rows first, FC% descending — the worst margin is the first thing an
 *    owner should see (Angel's payoff-screen behavior).
 *  - Then PARTIAL, fewest-unpriced first: those are the rows one or two price
 *    entries away from going live, so the ordering doubles as a work queue.
 *  - Then UNPRICED, then UNRESOLVED (a data bug, not a price gap), then
 *    NO_RECIPE — each alphabetical.
 *
 * A costed row with no menu price has a null FC%; it sorts to the END of the
 * costed group rather than the top, because null is not "worst".
 */
export function compareMenuCostRows(a: MenuCostRow, b: MenuCostRow): number {
  const rank = STATUS_RANK[a.rollup.status] - STATUS_RANK[b.rollup.status];
  if (rank !== 0) return rank;

  if (a.rollup.status === "costed") {
    if (a.foodCostPct == null && b.foodCostPct != null) return 1;
    if (a.foodCostPct != null && b.foodCostPct == null) return -1;
    if (a.foodCostPct != null && b.foodCostPct != null && a.foodCostPct !== b.foodCostPct) {
      return b.foodCostPct - a.foodCostPct;
    }
  } else if (a.rollup.status === "partial") {
    const d = a.rollup.unpricedLineCount - b.rollup.unpricedLineCount;
    if (d !== 0) return d;
  }
  return a.name.localeCompare(b.name);
}

/** Compose + sort the whole board. Pure: same inputs, same rows, every time. */
export function composeMenuCostRows(
  inputs: MenuCostInput[],
  graph: RecipeGraph,
  costPerOzBySku: Map<string, number | null>,
): MenuCostRow[] {
  return inputs
    .map((input) => toMenuCostRow(input, rollupMenuItemCost(graph, input.id, costPerOzBySku)))
    .sort(compareMenuCostRows);
}

/** Board-level counts for the header line + the collapsed-section counts (D5). */
export interface MenuCostTotals {
  rowCount: number;
  costedCount: number;
  partialCount: number;
  unpricedCount: number;
  unresolvedCount: number;
  noRecipeCount: number;
  overThresholdCount: number;
  /** Distinct SKUs blocking at least one row — the "go price these" number. */
  blockingSkuCount: number;
}

export function summarizeMenuCostRows(rows: MenuCostRow[]): MenuCostTotals {
  const blocking = new Set<string>();
  const totals: MenuCostTotals = {
    rowCount: rows.length,
    costedCount: 0,
    partialCount: 0,
    unpricedCount: 0,
    unresolvedCount: 0,
    noRecipeCount: 0,
    overThresholdCount: 0,
    blockingSkuCount: 0,
  };
  for (const r of rows) {
    if (r.rollup.status === "costed") totals.costedCount += 1;
    else if (r.rollup.status === "partial") totals.partialCount += 1;
    else if (r.rollup.status === "unpriced") totals.unpricedCount += 1;
    else if (r.rollup.status === "unresolved") totals.unresolvedCount += 1;
    else totals.noRecipeCount += 1;
    if (r.overThreshold) totals.overThresholdCount += 1;
    for (const skuId of r.rollup.unpricedSkuIds) blocking.add(skuId);
  }
  totals.blockingSkuCount = blocking.size;
  return totals;
}
