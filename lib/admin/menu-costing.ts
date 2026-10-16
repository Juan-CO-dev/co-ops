/**
 * Menu costing board data layer — SERVER-ONLY, service-role.
 *
 * The payoff screen's loader: every active menu_item, its menu price, its
 * rolled-up food cost, and an honest account of what is missing. Read-only —
 * this module writes nothing and has no mutation path.
 *
 * BATCH-LOADED, NEVER PER-NODE (the loadRecipeGraph law, AGENTS.md): ONE
 * loadRecipeGraph() for the whole recipe universe (6 fixed queries) + ONE
 * ingredient-price read + ONE menu_items read + THREE cache/crosswalk/location
 * reads + at most THREE name reads (the blocking SKUs,
 * and the prep items a row is waiting on — mass-inconsistent or never-weighed,
 * both in the same lookup — each skipped when that failure mode is absent).
 * Cost for 68 menu items costs the same number of queries as for one.
 *
 * COST/OZ COMES OFF THE GRAPH'S OWN SKU PACK DATA, on purpose. loadRecipeGraph
 * already hydrates every referenced SKU's pack fields AND its active pack chain
 * (lib/prep-consumption.ts loadSkuPack), so deriving content_oz from
 * graph.skuPack means the dollars ride exactly the same oz resolution as the
 * flatten — chain-aware, count-aware, same nulls in the same places.
 *
 * The chain-blindness this header used to flag on /admin/skus and
 * /admin/vendors/[id] — `computeSkuCostPerOz` calling `skuContentOz` with no
 * packChain — is FIXED (2026-08-21): that function now takes the chain map as a
 * required argument and both pages pass the one they already load. All three
 * derivations agree by construction.
 *
 * This board still derives from `graph.skuPack` rather than borrowing
 * lib/admin/cost.ts, and the reason is scope, not correctness: the graph hydrates
 * only the SKUs the RECIPE UNIVERSE references (64 of 182 live), which is exactly
 * this board's population and a subset of the catalog those screens list.
 */
import { compareMenuCostRows } from "@/lib/menu-costing-shared";
import { ownerVisible } from "@/lib/catalog/shop-owned-shared";
import "server-only";
import { loadCachedMenuPrices } from "@/lib/admin/menu-costing-toast";
import { resolveMenuPrice } from "@/lib/toast/in-store-prices-shared";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { COST_READ_MIN, loadCurrentSkuPrices } from "@/lib/admin/cost";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadLiveMenuItemShopSettings } from "@/lib/menu-item-shop";
import { resolveMenuItemForShop, type MenuItemShopSettingRow } from "@/lib/menu-item-shop-shared";
import { canReadReportLocation } from "@/lib/locations";
import type { VersionScope } from "@/lib/sku-versions-shared";
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

// $/oz for every SKU the recipe universe references — moved to the client-safe
// lib/menu-costing-shared.ts in catalog Phase 2b (the pure preview reuses THE costing formula).
export { costPerOzFromGraph } from "@/lib/menu-costing-shared";
import { costPerOzFromGraph } from "@/lib/menu-costing-shared";

export interface MenuCostingBoard {
  /** The shop this board was costed for (its packs AND prices); null = All shops, on GLOBAL prices. */
  scope: string | null;
  /** Shop view only: active menu items this shop has taken off its menu (never on the board's rows). */
  notSoldHere: Array<{ id: string; name: string; nameEs: string | null }>;
  toastFetchedAt: string | null;
  toastUnavailable: boolean;
  toastNotices: Array<{ locationName: string; reason: "unavailable" | "menu_missing" | "menu_not_set" }>;
  rows: MenuCostRow[];
  totals: MenuCostTotals;
  /** Display names for the SKUs blocking at least one row, so the UI can name them. */
  skuNames: Record<string, string>;
  /**
   * Display names (en + es) for the PREP ITEMS blocking at least one row —
   * mass-inconsistent AND never-weighed alike. Same job as skuNames on the price
   * failure mode: the drawer must be able to say WHICH recipe is out of balance
   * or WHICH prep needs a scale, not just that one is. One map covers both
   * because both lists are item ids and both drawers render the same lookup.
   */
  itemNames: Record<string, { en: string; es: string | null }>;
  /**
   * Display names (en + es) for the RETIRED PRODUCTS behind any `unresolved` row.
   * A separate map from `itemNames` because these are `products` ids, not `items`
   * ids — merging two registries into one lookup is how a name silently resolves
   * to the wrong row's label the first time the two collide.
   */
  productNames: Record<string, { en: string; es: string | null }>;
}

/**
 * The whole board. On a system with no prices recorded yet this correctly
 * returns every row as `unpriced` with its full blocking-SKU count — that is
 * the designed day-one output, not a failure, and the counts fall as the price
 * ledger fills.
 */
export async function loadMenuCostingBoard(actor: AuthContext, opts: { scope?: VersionScope } = {}): Promise<MenuCostingBoard> {
  requireLevel(actor, MENU_COSTING_READ_MIN);
  // CATALOG PHASE 2a (lead decision): the board is costed FOR A SHOP — its pack versions and product
  // resolution (the graph) AND its prices (its lane, else global). null = All shops = global prices.
  const scope = opts.scope ?? null;
  if (scope !== null && !canReadReportLocation({ role: actor.user.role, locations: actor.locations }, scope)) {
    throw new MenuCostingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();

  const [graph, menuRes, toast] = await Promise.all([
    loadRecipeGraph(scope === null ? undefined : { locationId: scope }),
    sb
      .from("menu_items")
      .select("id, name, name_es, section, menu_price, price_same_as_id, catering_available, location_id")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; price_same_as_id: string | null; catering_available: boolean; location_id: string | null }>>(),
    loadCachedMenuPrices(),
  ]);
  if (menuRes.error) throw new Error(`loadMenuCostingBoard menu_items: ${menuRes.error.message}`);

  // CATALOG PHASE 3a (0263): a SHOP view reads each menu item THROUGH ITS SHOP OVERLAY — its price here,
  // its name here, whether it is sold here (resolveMenuItemForShop, the one rule). "All shops" (scope
  // null) reads the global rows exactly as before; with no overlay rows a shop view is identical too.
  const menuRows = (menuRes.data ?? []).filter(m => scope === null || ownerVisible(m.location_id, scope));
  const overlay = scope === null ? new Map<string, MenuItemShopSettingRow>() : await loadLiveMenuItemShopSettings(scope);
  const here = (m: { id: string; name: string; name_es: string | null; menu_price: number | string | null }) =>
    resolveMenuItemForShop({ id: m.id, name: m.name, nameEs: m.name_es, menuPrice: num(m.menu_price) }, overlay.get(m.id));
  const menuById = new Map(menuRows.map((m) => [m.id, m]));
  const notSoldHere = menuRows.filter((m) => !here(m).soldHere)
    .map((m) => ({ id: m.id, name: here(m).name, nameEs: here(m).nameEs }));
  const inputs: MenuCostInput[] = menuRows.filter((m) => here(m).soldHere).map((m) => {
    const parent = m.price_same_as_id ? menuById.get(m.price_same_as_id) : undefined;
    const mine = here(m);
    const parentHere = parent ? here(parent) : null;
    const resolved = resolveMenuPrice({
      typedPrice: mine.typedPrice, toastPrices: toast.prices.get(m.id) ?? [], hasZeroPriceModifier: toast.zeroPriceModifierItems.has(m.id),
      sameAs: parent && parentHere ? { typedPrice: parentHere.typedPrice, toastPrices: toast.prices.get(parent.id) ?? [] } : null,
    });
    return { id: m.id, name: mine.name, nameEs: mine.nameEs, section: m.section,
      ...resolved, cateringAvailable: m.catering_available, menuPrice: resolved.effectivePrice, typedPrice: mine.typedPrice,
      sameAsName: parentHere?.name ?? null, sameAsNameEs: parentHere?.nameEs ?? null };
  });

  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()], scope);
  const scopes = new Map<string | null, { graph: typeof graph; costs: ReturnType<typeof costPerOzFromGraph> }>();
  scopes.set(scope, { graph, costs: costPerOzFromGraph(graph, prices) });
  if (scope === null) await Promise.all([...new Set(menuRows.map(m => m.location_id).filter((id): id is string => id != null))].map(async owner => {
    const ownedGraph = await loadRecipeGraph({ locationId: owner });
    const ownedPrices = await loadCurrentSkuPrices([...ownedGraph.skuPack.keys()], owner);
    scopes.set(owner, { graph: ownedGraph, costs: costPerOzFromGraph(ownedGraph, ownedPrices) });
  }));
  const rows = inputs.flatMap(input => {
    const resolved = scopes.get(scope ?? menuById.get(input.id)?.location_id ?? null)!;
    return composeMenuCostRows([input], resolved.graph, resolved.costs);
  }).sort(compareMenuCostRows);
  const totals = summarizeMenuCostRows(rows);

  const blocking = [...new Set(rows.flatMap((r) => r.rollup.unpricedSkuIds))];
  const broken = [
    ...new Set(rows.flatMap((r) => [...r.rollup.inconsistentItemIds, ...r.rollup.unweighedItemIds])),
  ];
  // Retired products behind any `unresolved` row (Juan's ruling A+, 2026-08-21).
  // Zero today and zero on any board with no retired product — the lookup is
  // skipped entirely, so the tripwire costs nothing until it fires.
  const retired = [...new Set(rows.flatMap((r) => r.rollup.retiredProductIds))];
  const skuNames: Record<string, string> = {};
  const itemNames: Record<string, { en: string; es: string | null }> = {};
  const productNames: Record<string, { en: string; es: string | null }> = {};
  // Three name lookups, each skipped entirely when its failure mode is absent —
  // so a clean board still costs exactly the queries the header promises.
  const [skuRes, itemRes, productRes] = await Promise.all([
    blocking.length > 0
      ? sb.from("vendor_items").select("id, name").in("id", blocking).returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    broken.length > 0
      ? sb.from("items").select("id, name, name_es").in("id", broken).returns<Array<{ id: string; name: string; name_es: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; name_es: string | null }> }),
    retired.length > 0
      ? sb.from("products").select("id, name, name_es").in("id", retired).returns<Array<{ id: string; name: string; name_es: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; name_es: string | null }> }),
  ]);
  for (const s of skuRes.data ?? []) skuNames[s.id] = s.name;
  for (const i of itemRes.data ?? []) itemNames[i.id] = { en: i.name, es: i.name_es };
  for (const p of productRes.data ?? []) productNames[p.id] = { en: p.name, es: p.name_es };

  return { scope, notSoldHere, rows, totals, skuNames, itemNames, productNames, toastFetchedAt: toast.fetchedAt, toastUnavailable: toast.unavailable, toastNotices: toast.notices };
}
