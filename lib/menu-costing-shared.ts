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
 *  3. MASS-INCONSISTENT (a producing recipe declares more output weight than it
 *     has input weight): the flatten resolves and the prices are all there, so
 *     the board WOULD print a confident number — and that number is provably
 *     wrong. This is the third failure mode and it is the nastiest, because
 *     unlike 1 and 2 it has no natural tell. See the mass-balance section below.
 *
 * WHY A PARTIAL COST IS NEVER PRESENTED AS "THE COST": with any line unpriced
 * the true cost is strictly greater than what we can add up, so FC% and margin
 * derived from it would be optimistic in the one direction an owner must never
 * be misled. `cost` is non-null ONLY when the rollup is complete; the partial
 * subtotal is carried separately as `pricedCost` and must be rendered with a
 * "so far"-style label, never as the cost.
 */
import {
  batchInputOzForItem,
  perUnitSkuOzForItemFromGraph,
  perUnitSkuOzForMenuItemFromGraph,
  type GraphRecipe,
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
 * The six honest outcomes of costing one menu item. Ordered by how actionable
 * they are, which is also the board's default grouping (see compareMenuCostRows).
 */
export type MenuCostStatus =
  /** Flatten resolved and EVERY leaf SKU carries a price. `cost` is real. */
  | "costed"
  /** Flatten resolved; some leaves priced, some not. `cost` is null by design. */
  | "partial"
  /** Flatten resolved; NOT ONE leaf priced. The day-one state for most rows. */
  | "unpriced"
  /** A prep this item is built from declares more weight than it is made of — a DATA BUG. */
  | "inconsistent"
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
  /**
   * The mass-inconsistent PREP ITEMS this row is built from, sorted. Non-empty
   * only when status === "inconsistent"; it names exactly which recipe to go fix,
   * the same way `unpricedSkuIds` names exactly which SKU to go price. An
   * "inconsistent" badge without this list would be an accusation with no address.
   */
  inconsistentItemIds: string[];
}

const EMPTY_ROLLUP = (status: MenuCostStatus): MenuCostRollup => ({
  status,
  cost: null,
  pricedCost: 0,
  pricedLineCount: 0,
  unpricedLineCount: 0,
  unpricedSkuIds: [],
  inconsistentItemIds: [],
});

// ── Mass balance (debug finding D2) ──────────────────────────────────────────

/**
 * How far a producing recipe's DECLARED output weight may exceed its resolved
 * INPUT weight before the board refuses to cost anything built from it.
 *
 * ── The check is deliberately ONE-SIDED ──────────────────────────────────────
 * Output BELOW input is normal and carries no ceiling: cook-downs lose water
 * (caramelized onions run 4:1), and trim loss on a slicer or a head of lettuce
 * is real product that never reaches the pan. Those recipes are correct and must
 * keep costing. Output ABOVE input is the one direction that cannot happen in a
 * kitchen — a pan cannot weigh more than what went into it — so it is always a
 * data error, and the only question is how much slack to leave for rounding.
 *
 * 2% is that slack. It is a ROUNDING allowance, not a tolerance for reality:
 * oz_per_par_unit is human-entered to one decimal, slice weights are operational
 * estimates, and the arithmetic runs through float division — a correct row can
 * land a hair over 1.0. Nothing legitimate lands 5% over, and the defect this
 * check was written for lands between 4.2x and 113.8x, so the exact value of the
 * slack is not load-bearing; its DIRECTION is.
 */
export const MASS_BALANCE_TOLERANCE = 0.02;

/** One producing recipe's declared-vs-actual weight, in ounces per BATCH. */
export interface MassBalance {
  /** Σ over the recipe's ITEM outputs of yield × oz_per_par_unit (declared only). */
  declaredOz: number;
  /** Σ of the leaf-SKU ounces the flatten says go into one batch. */
  inputOz: number;
  /** declaredOz ÷ inputOz. > 1 + MASS_BALANCE_TOLERANCE is the violation. */
  ratio: number;
}

/** Violating items only — an item absent from this map is consistent or unjudgeable. */
export type MassBalanceIndex = ReadonlyMap<string, MassBalance>;

/**
 * Mass balance for the recipe producing ONE item, or null when the question
 * cannot honestly be asked: no producing recipe, an unresolvable flatten (that
 * is `unresolved`'s job, not this one), or NOT ONE output declaring an
 * oz_per_par_unit (an undeclared item has nothing to contradict).
 *
 * `declaredOz` sums only the outputs that DO declare a weight. When a recipe has
 * a mix, the sum is a LOWER BOUND on what the batch claims to produce — so the
 * comparison stays conservative: we flag only recipes whose declared-weight
 * outputs ALONE already outweigh the whole batch's inputs, and never a recipe
 * that might be fine once its undeclared siblings are filled in.
 */
export function itemMassBalance(graph: RecipeGraph, itemId: string): MassBalance | null {
  const node = graph.byOutputItem.get(itemId);
  if (!node) return null;

  let declaredOz = 0;
  let anyDeclared = false;
  for (const o of node.outputs) {
    if (o.outputItemId == null || o.ozPerParUnit == null || o.ozPerParUnit <= 0 || o.yield <= 0) continue;
    declaredOz += o.yield * o.ozPerParUnit;
    anyDeclared = true;
  }
  if (!anyDeclared) return null;

  const inputOz = batchInputOzForItem(graph, itemId);
  if (inputOz == null || inputOz < 0) return null;
  // inputOz === 0 with a declared output weight is the extreme of the same
  // defect (weight out of nothing), so it is a violation, not a skip.
  return { declaredOz, inputOz, ratio: inputOz > 0 ? declaredOz / inputOz : Infinity };
}

function isViolation(b: MassBalance): boolean {
  return b.ratio > 1 + MASS_BALANCE_TOLERANCE;
}

/** Every mass-inconsistent producing recipe in the graph, keyed by the item it produces. */
export function massBalanceIndex(graph: RecipeGraph): MassBalanceIndex {
  const out = new Map<string, MassBalance>();
  for (const itemId of graph.byOutputItem.keys()) {
    const b = itemMassBalance(graph, itemId);
    if (b != null && isViolation(b)) out.set(itemId, b);
  }
  return out;
}

/**
 * Per-graph memo of massBalanceIndex.
 *
 * The index is a pure function of the graph, but building it re-flattens every
 * producing recipe — so computing it per ROW would turn one board render into
 * ~68 whole-universe flattens. Memoizing on the graph object keeps the rollup
 * functions' signatures free of a bookkeeping argument that a caller could
 * forget to pass (a guard you can silently omit is not a guard), at the cost of
 * one assumption: A RECIPE GRAPH IS NEVER MUTATED AFTER buildRecipeGraph. That
 * holds everywhere today — loadRecipeGraph builds one and hands it out read-only.
 * If you ever mutate a graph in place, this cache goes stale; build a new one.
 */
const BALANCE_CACHE = new WeakMap<RecipeGraph, MassBalanceIndex>();
function balanceFor(graph: RecipeGraph): MassBalanceIndex {
  let idx = BALANCE_CACHE.get(graph);
  if (idx === undefined) {
    idx = massBalanceIndex(graph);
    BALANCE_CACHE.set(graph, idx);
  }
  return idx;
}

/**
 * Every ITEM a recipe's cost flows through, transitively — the reach over which
 * one bad prep poisons a downstream number. Cycle-safe via the seen set (the
 * flatten engine reports a cycle as unresolved, so this only has to not hang).
 */
function collectItemRefs(graph: RecipeGraph, node: GraphRecipe, seen: Set<string>): void {
  for (const c of node.inputs) {
    const id = c.componentItemId;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    const sub = graph.byOutputItem.get(id);
    if (sub) collectItemRefs(graph, sub, seen);
  }
}

/** The mass-inconsistent items reached from `node`, sorted. Empty = nothing wrong. */
function inconsistentReach(graph: RecipeGraph, node: GraphRecipe, seed: string[] = []): string[] {
  const balance = balanceFor(graph);
  if (balance.size === 0) return [];
  const seen = new Set<string>(seed);
  collectItemRefs(graph, node, seen);
  return [...seen].filter((id) => balance.has(id)).sort();
}

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
    inconsistentItemIds: [],
  };
}

/**
 * An inconsistent rollup carries NO money at all — not even `pricedCost`.
 *
 * That is deliberate and it is the one place this differs from `partial`. A
 * partial row's subtotal is a true number about a smaller question ("what the
 * priced lines cost"); an inconsistent row's subtotal is a false number about
 * the right question, because every ounce feeding it came out of a flatten we
 * have just proven wrong. Publishing it under a "known so far" label would
 * launder a broken figure through an honest-sounding caveat. The row names the
 * recipe to fix instead.
 */
const INCONSISTENT_ROLLUP = (itemIds: string[]): MenuCostRollup => ({
  ...EMPTY_ROLLUP("inconsistent"),
  inconsistentItemIds: itemIds,
});

/**
 * Cost of ONE unit of a MENU_ITEM (a sub/side as sold), flattened to leaf SKUs.
 *
 * The empty oz map is ambiguous by itself (poisoned flatten vs no recipe), so
 * the graph's own output index decides which — see the module header, failure
 * mode 1.
 *
 * ORDER OF THE THREE REFUSALS, and why: no_recipe (there is nothing to cost) →
 * unresolved (there is something, but no ounces come out of it) → inconsistent
 * (ounces come out, and they are wrong). Each later check needs the earlier one
 * to have passed, so the sequence is forced rather than chosen.
 */
export function rollupMenuItemCost(
  graph: RecipeGraph,
  menuItemId: string,
  costPerOzBySku: Map<string, number | null>,
): MenuCostRollup {
  const node = graph.byOutputMenuItem.get(menuItemId);
  if (!node) return EMPTY_ROLLUP("no_recipe");
  const perUnitOz = perUnitSkuOzForMenuItemFromGraph(graph, menuItemId);
  if (perUnitOz.size === 0) return EMPTY_ROLLUP("unresolved");
  const bad = inconsistentReach(graph, node);
  if (bad.length > 0) return INCONSISTENT_ROLLUP(bad);
  return rollupFromPerUnitOz(perUnitOz, costPerOzBySku);
}

/**
 * Cost of ONE par-unit of an ITEM (a prep). Same semantics as the menu variant;
 * used by the Angel parity harness, which re-costs PREP recipes (§6.1), and
 * available to any future per-recipe cost readout.
 *
 * The item's OWN recipe is inside the mass-balance reach here (it is seeded into
 * the walk), because for a prep the offending recipe usually IS its own.
 */
export function rollupItemCost(
  graph: RecipeGraph,
  itemId: string,
  costPerOzBySku: Map<string, number | null>,
): MenuCostRollup {
  const node = graph.byOutputItem.get(itemId);
  if (!node) return EMPTY_ROLLUP("no_recipe");
  const perUnitOz = perUnitSkuOzForItemFromGraph(graph, itemId);
  if (perUnitOz.size === 0) return EMPTY_ROLLUP("unresolved");
  const bad = inconsistentReach(graph, node, [itemId]);
  if (bad.length > 0) return INCONSISTENT_ROLLUP(bad);
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
  // INCONSISTENT ranks above UNRESOLVED, which is not the order "how close is
  // this to a number" would give. Both are data bugs, but an unresolved row
  // announces itself — it has shown a dash since the day it broke. An
  // inconsistent row showed a plausible dollar figure that an owner may already
  // have priced a menu against. The silent wrong answer outranks the loud
  // missing one.
  inconsistent: 3,
  unresolved: 4,
  no_recipe: 5,
};

/**
 * The board's default order.
 *
 *  - COSTED rows first, FC% descending — the worst margin is the first thing an
 *    owner should see (Angel's payoff-screen behavior).
 *  - Then PARTIAL, fewest-unpriced first: those are the rows one or two price
 *    entries away from going live, so the ordering doubles as a work queue.
 *  - Then UNPRICED, then INCONSISTENT and UNRESOLVED (data bugs, not price
 *    gaps — see STATUS_RANK for why inconsistent comes first), then NO_RECIPE —
 *    each alphabetical.
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
  inconsistentCount: number;
  unresolvedCount: number;
  noRecipeCount: number;
  overThresholdCount: number;
  /** Distinct SKUs blocking at least one row — the "go price these" number. */
  blockingSkuCount: number;
  /** Distinct PREP ITEMS whose recipe fails mass balance — the "go fix these" number. */
  inconsistentItemCount: number;
}

export function summarizeMenuCostRows(rows: MenuCostRow[]): MenuCostTotals {
  const blocking = new Set<string>();
  const broken = new Set<string>();
  const totals: MenuCostTotals = {
    rowCount: rows.length,
    costedCount: 0,
    partialCount: 0,
    unpricedCount: 0,
    inconsistentCount: 0,
    unresolvedCount: 0,
    noRecipeCount: 0,
    overThresholdCount: 0,
    blockingSkuCount: 0,
    inconsistentItemCount: 0,
  };
  for (const r of rows) {
    if (r.rollup.status === "costed") totals.costedCount += 1;
    else if (r.rollup.status === "partial") totals.partialCount += 1;
    else if (r.rollup.status === "unpriced") totals.unpricedCount += 1;
    else if (r.rollup.status === "inconsistent") totals.inconsistentCount += 1;
    else if (r.rollup.status === "unresolved") totals.unresolvedCount += 1;
    else totals.noRecipeCount += 1;
    if (r.overThreshold) totals.overThresholdCount += 1;
    for (const skuId of r.rollup.unpricedSkuIds) blocking.add(skuId);
    for (const itemId of r.rollup.inconsistentItemIds) broken.add(itemId);
  }
  totals.blockingSkuCount = blocking.size;
  totals.inconsistentItemCount = broken.size;
  return totals;
}
