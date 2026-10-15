/**
 * "WHAT THIS CHANGES" — the preview every pack or price save shows first (catalog Phase 2b; spec
 * §4 "What this changes", §5 jobs 1 + 5; lead decision D4). PURE: the server hands in one state per
 * shop (its effective pack, graph, prices, D3-stamped par lanes, open orders); this works out the
 * knock-ons FOR THE ACTUAL SAVE TARGET:
 *   · { kind: "shop", shopId } — exactly that shop;
 *   · { kind: "global" }       — every shop riding the global pack (a shop with its own live version
 *                                 is listed as untouched).
 *
 * It never decides for the human. Where a par stored in order units would change meaning, it says
 * so per lane and offers a conversion ONLY where that shop's effective pack changes AND the par lives
 * in the lane being changed. Every offered conversion carries the value it was computed from
 * (`expected`); the save refuses if that value moved (apply_sku_pack_change, 0261).
 */
import { perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { ozForRecipeInput, skuContentOz, skuCostPerOz, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { ParLane } from "@/lib/location-sku-shared";

export type PreviewTarget = { kind: "shop"; shopId: string } | { kind: "global" };
export type ParSlotName = "weekday" | "weekend";

export interface PreviewMenuItem { id: string; name: string; nameEs: string | null }
export interface PreviewRecipeLine { recipeId: string; recipeName: string; quantity: number; unit: string | null }
export interface PreviewOpenOrder { poId: string; displayCode: string; status: string; orderQty: number; orderUnitLabel: string | null; shopId: string; shopName: string }
export interface MenuItemDelta { id: string; name: string; nameEs: string | null; before: number | null; after: number | null }

/** One shop as it stands today, for one SKU (the server fills this through the 2a resolvers). */
export interface PreviewShopState {
  shopId: string;
  shopName: string;
  /** The pack this shop effectively receives NOW: its own live version, else the global one. */
  basePack: RecipeInputSku;
  /** This shop has its OWN live pack version — a global save does not reach it. */
  ownPackVersion: boolean;
  /** This shop has its OWN live price lane — a global price does not reach it. */
  ownPriceLane: boolean;
  /**
   * The newest row of each price sequence a save could append to (resolveCurrentPrices' order:
   * effective_date desc, then recorded_at desc): the GLOBAL head, and this shop's live LANE head.
   */
  priceHeads: { global: PriceHead | null; lane: PriceHead | null };
  /** This shop's graph (its pack versions) and its current prices. */
  graph: RecipeGraph;
  prices: ReadonlyMap<string, number>;
  /** Each day-class's par here and the lane that answers it (from the D3-stamped overlay). */
  slots: ReadonlyArray<{ slot: ParSlotName; value: number | null; lane: ParLane }>;
  openOrders: readonly PreviewOpenOrder[];
}

export type ParRowStatus = "convertible" | "global_par_shared" | "machine_par" | "no_weight";

export interface PreviewParRow {
  /** null = the GLOBAL par lane (vendor_items); a shop id = that shop's own par (location_sku_settings). */
  locationId: string | null;
  /** The shops this number governs (a global row: every shop inheriting it). */
  shops: string[];
  slot: ParSlotName;
  lane: ParLane;
  status: ParRowStatus;
  /**
   * true = the opt-in "give this shop its own par" (2b r2#3): the shop inherits the global par today;
   * converting CREATES the shop's own slot from the converted value and leaves the global par alone.
   */
  inherited: boolean;
  current: number;
  currentOz: number | null;
  keepOz: number | null;
  convertTo: number | null;
}

/**
 * A conversion the preview OFFERS, bound to the value it was computed from. `inherited` = create the
 * shop's own par slot (which must still be EMPTY) from the value the shop answered with: the
 * inherited GLOBAL par (`from` absent), or the shop's own AUTO par (`from: "auto"` — the machine
 * value this save's pack-epoch bump retires, D3). apply_sku_pack_change (0261) re-checks `expected`
 * against exactly that source.
 */
export interface ParConversion { locationId: string | null; slot: ParSlotName; expected: number; to: number; inherited?: true; from?: "auto" }

/** One conversion's identity (target lane + slot + the bound values) — the client's choice set and the server's match. */
export function conversionKey(c: ParConversion): string {
  return `${c.locationId ?? "global"}|${c.slot}|${c.expected}|${c.to}${c.inherited ? `|inherited${c.from === "auto" ? ":auto" : ""}` : ""}`;
}

export interface PackShopDelta {
  shopId: string;
  shopName: string;
  orderUnit: { before: string | null; after: string | null };
  orderUnitOz: { before: number | null; after: number | null };
  costPerOz: { before: number | null; after: number | null };
  menuItems: MenuItemDelta[];
  brokenLines: PreviewRecipeLine[];
  openOrders: PreviewOpenOrder[];
}

export interface PackPreview {
  kind: "pack";
  target: PreviewTarget;
  changed: boolean;
  /** The live version of the TARGET scope the preview was computed against (the save's expected_live). */
  liveVersionId: string | null;
  /** A shop's FIRST own version is based on the global one it replaces. */
  basedOnVersionId: string | null;
  shops: PackShopDelta[];
  unaffected: Array<{ shopId: string; shopName: string }>;
  pars: PreviewParRow[];
  conversions: ParConversion[];
  /**
   * The dependency snapshot (0261 sku_pack_change_snapshot), taken BEFORE the preview was computed:
   * each reached shop's own live version, pack epoch and par lanes, the global version and pars, the
   * active shops. apply_sku_pack_change recomputes it UNDER THE SKU LOCK and refuses any difference.
   */
  snapshot: unknown;
  /** previewToken(…) — set by the server; a save must present it. */
  token: string;
}

/** The current head of a price sequence: its value and its effective date (YYYY-MM-DD). */
export interface PriceHead { value: number; effectiveDate: string }

export interface PriceShopDelta {
  shopId: string;
  shopName: string;
  /** Will the saved row be this shop's CURRENT price? (false = a back-dated row: history only) */
  becomesCurrent: boolean;
  price: { before: number | null; after: number | null };
  costPerOz: { before: number | null; after: number | null };
  menuItems: MenuItemDelta[];
}

export interface PricePreview {
  kind: "price";
  target: PreviewTarget;
  newPrice: number;
  /** The date the price takes effect — part of the preview, its token, and the save. */
  effectiveDate: string;
  shops: PriceShopDelta[];
  unaffected: Array<{ shopId: string; shopName: string }>;
  token: string;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * The par, re-expressed in the new order unit, rounded to the par step (par_step, else 1 for a
 * whole par and 0.5 for a fractional one), never below one step for a par above zero. Null when
 * either unit has no honest ounce — then only "keep" is possible.
 */
export function convertParQuantity(par: number, beforeOz: number | null, afterOz: number | null, parStep: number | null): number | null {
  if (beforeOz == null || afterOz == null || !(afterOz > 0) || !(beforeOz > 0)) return null;
  if (par === 0) return 0;
  const step = parStep != null && parStep > 0 ? parStep : Number.isInteger(par) ? 1 : 0.5;
  const raw = (par * beforeOz) / afterOz;
  return round4(Math.max(step, Math.round(raw / step) * step));
}

/**
 * A short, deterministic digest (FNV-1a, 32-bit, hex) of what a preview showed. Not a security
 * boundary — the server recomputes the preview and compares digests, so a save made against a
 * different target, live version, chain or set of offered conversions is refused as stale.
 */
export function previewToken(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function sameChain(a: readonly PackChainLevel[], b: readonly PackChainLevel[]): boolean {
  const sig = (c: readonly PackChainLevel[]) => {
    const byId = new Map(c.map((l) => [l.id, l]));
    return c.map((l) => `${l.label.trim()}|${l.containsQty}|${l.containsLevelId ? byId.get(l.containsLevelId)?.label.trim() ?? "?" : `=${l.containsMeasureUnit ?? ""}`}`).sort().join(";");
  };
  return sig(a) === sig(b);
}

const chainOf = (p: RecipeInputSku): PackChainLevel[] | null => (p.packChain && p.packChain.length > 0 ? p.packChain : null);

function menuDeltas(
  skuId: string,
  before: RecipeGraph,
  after: RecipeGraph,
  costBefore: Map<string, number | null>,
  costAfter: Map<string, number | null>,
  menuItems: readonly PreviewMenuItem[],
): MenuItemDelta[] {
  const out: MenuItemDelta[] = [];
  for (const m of menuItems) {
    const ozBefore = perUnitSkuOzForMenuItemFromGraph(before, m.id);
    const ozAfter = perUnitSkuOzForMenuItemFromGraph(after, m.id);
    const touched = ozBefore.has(skuId) || ozAfter.has(skuId) || (ozBefore.size > 0 && ozAfter.size === 0);
    if (!touched) continue;
    out.push({
      id: m.id, name: m.name, nameEs: m.nameEs,
      before: rollupMenuItemCost(before, m.id, costBefore).cost,
      after: rollupMenuItemCost(after, m.id, costAfter).cost,
    });
  }
  return out;
}

function withPack(graph: RecipeGraph, skuId: string, p: RecipeInputSku): RecipeGraph {
  return { ...graph, skuPack: new Map(graph.skuPack).set(skuId, p) };
}

function shopPackDelta(
  skuId: string,
  s: PreviewShopState,
  newChain: PackChainLevel[],
  menuItems: readonly PreviewMenuItem[],
  recipeLines: readonly PreviewRecipeLine[],
): PackShopDelta {
  const m = s.graph.measures;
  const newPack: RecipeInputSku = { ...s.basePack, packChain: newChain };
  const price = s.prices.get(skuId) ?? null;
  const before = s.graph.skuPack.has(skuId) ? s.graph : withPack(s.graph, skuId, s.basePack);
  const after = withPack(s.graph, skuId, newPack);
  return {
    shopId: s.shopId,
    shopName: s.shopName,
    orderUnit: { before: orderUnitLabel(s.basePack.packFormat, chainOf(s.basePack)), after: orderUnitLabel(s.basePack.packFormat, newChain) },
    orderUnitOz: { before: perOrderUnitOz(s.basePack, chainOf(s.basePack), m), after: perOrderUnitOz(newPack, newChain, m) },
    costPerOz: { before: skuCostPerOz(price, skuContentOz(s.basePack, m)), after: skuCostPerOz(price, skuContentOz(newPack, m)) },
    menuItems: menuDeltas(skuId, before, after, costPerOzFromGraph(before, s.prices), costPerOzFromGraph(after, s.prices), menuItems),
    brokenLines: recipeLines.filter((l) =>
      ozForRecipeInput(l.quantity, l.unit, s.basePack, m) != null && ozForRecipeInput(l.quantity, l.unit, newPack, m) == null),
    openOrders: [...s.openOrders],
  };
}

function parRow(
  locationId: string | null, shops: string[], slot: ParSlotName, lane: ParLane, status: ParRowStatus,
  current: number, beforeOz: number | null, afterOz: number | null, convertTo: number | null, inherited = false,
): PreviewParRow {
  return {
    locationId, shops, slot, lane, status, inherited, current,
    currentOz: beforeOz == null ? null : round4(current * beforeOz),
    keepOz: afterOz == null ? null : round4(current * afterOz),
    convertTo: status === "convertible" ? convertTo : null,
  };
}

export function previewPackChange(input: {
  skuId: string;
  target: PreviewTarget;
  /** The pack the TARGET has today (a shop: its effective pack; global: the global pack). */
  targetBasePack: RecipeInputSku;
  newChain: PackChainLevel[];
  /** Every active shop, in display order (the global target needs them all to know who it reaches). */
  shops: readonly PreviewShopState[];
  /** The global par per day-class (vendor_items). */
  globalPars: { weekday: number | null; weekend: number | null };
  parStep: number | null;
  menuItems: readonly PreviewMenuItem[];
  /** Recipe lines that name THIS SKU directly (active recipes). */
  recipeLines: readonly PreviewRecipeLine[];
  liveVersionId: string | null;
  basedOnVersionId: string | null;
}): Omit<PackPreview, "token" | "snapshot"> {
  const target = input.target;
  const affected = target.kind === "shop"
    ? input.shops.filter((s) => s.shopId === target.shopId)
    : input.shops.filter((s) => !s.ownPackVersion);
  const unaffected = input.shops.filter((s) => !affected.includes(s)).map((s) => ({ shopId: s.shopId, shopName: s.shopName }));
  const changed = !sameChain(input.targetBasePack.packChain ?? [], input.newChain);
  const shell = { kind: "pack" as const, target, changed, liveVersionId: input.liveVersionId, basedOnVersionId: input.basedOnVersionId, unaffected };
  if (!changed) return { ...shell, shops: [], pars: [], conversions: [] };

  const deltas = affected.map((s) => shopPackDelta(input.skuId, s, input.newChain, input.menuItems, input.recipeLines));
  const pars: PreviewParRow[] = [];

  // Per affected shop: its own (human) par converts; an inherited global par on a SHOP-only save is
  // the opt-in "give this shop its own par" (the global par is untouched); the machine's par is
  // named (D3 retires it once the pack changes).
  affected.forEach((s, i) => {
    const { before: beforeOz, after: afterOz } = deltas[i]!.orderUnitOz;
    if (beforeOz === afterOz) return;
    for (const sl of s.slots) {
      if (sl.value == null || !(sl.value > 0)) continue;
      if (sl.lane === "global" && target.kind === "global") continue; // the global lane, below
      if (sl.lane === "human") {
        const to = convertParQuantity(sl.value, beforeOz, afterOz, input.parStep);
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "human", to == null ? "no_weight" : "convertible", sl.value, beforeOz, afterOz, to));
      } else if (sl.lane === "auto") {
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "auto", "machine_par", sl.value, beforeOz, afterOz, null));
      } else if (sl.lane === "global") {
        const to = convertParQuantity(sl.value, beforeOz, afterOz, input.parStep);
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "global", to == null ? "no_weight" : "convertible", sl.value, beforeOz, afterOz, to, true));
      }
    }
  });

  // A global save: the global par converts only if EVERY shop whose resolved par DEPENDS on it rides
  // the global pack. A dependent is a shop answered by the global lane, or by an AUTO value — an auto
  // stands only while its baseline equals the global par, so converting the global par would move
  // that shop too (Astra 2b r2#1). A dependent with its own case would get a number re-expressed in
  // a case it never bought, so the global row is then named, never converted.
  if (target.kind === "global") {
    for (const slot of ["weekend", "weekday"] as const) {
      const value = input.globalPars[slot];
      if (value == null || !(value > 0)) continue;
      const inheriting = input.shops.filter((s) => {
        const lane = s.slots.find((x) => x.slot === slot)?.lane;
        return lane === "global" || lane === "auto";
      });
      if (inheriting.length === 0) continue;
      const m = inheriting[0]!.graph.measures;
      const newPack: RecipeInputSku = { ...input.targetBasePack, packChain: input.newChain };
      const beforeOz = perOrderUnitOz(input.targetBasePack, chainOf(input.targetBasePack), m);
      const afterOz = perOrderUnitOz(newPack, input.newChain, m);
      if (beforeOz === afterOz) continue;
      const shared = inheriting.some((s) => s.ownPackVersion);
      const to = shared ? null : convertParQuantity(value, beforeOz, afterOz, input.parStep);
      const status: ParRowStatus = shared ? "global_par_shared" : to == null ? "no_weight" : "convertible";
      pars.push(parRow(null, inheriting.map((s) => s.shopName), slot, "global", status, value, beforeOz, afterOz, to));
    }
  }

  const conversions: ParConversion[] = pars
    .filter((p) => p.status === "convertible" && p.convertTo != null)
    .map((p) => (p.inherited
      ? { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo!, inherited: true as const }
      : { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo! }));
  return { ...shell, shops: deltas, pars, conversions };
}

/**
 * THE REAL SELECTION RULE applied to the row a save would append (Astra 2b r3#2): the newest
 * effective date wins, and on a tie the newest recorded row (this one) wins. So the new row becomes
 * current iff there is no head yet, or its date is on or after the head's.
 */
export function priceBecomesCurrent(effectiveDate: string, head: PriceHead | null): boolean {
  return head == null || effectiveDate >= head.effectiveDate;
}

export function previewPriceChange(input: {
  skuId: string;
  target: PreviewTarget;
  shops: readonly PreviewShopState[];
  newPrice: number;
  effectiveDate: string;
  menuItems: readonly PreviewMenuItem[];
}): Omit<PricePreview, "token"> {
  const target = input.target;
  const affected = target.kind === "shop"
    ? input.shops.filter((s) => s.shopId === target.shopId)
    : input.shops.filter((s) => !s.ownPriceLane);
  return {
    kind: "price",
    target,
    newPrice: input.newPrice,
    effectiveDate: input.effectiveDate,
    unaffected: input.shops.filter((s) => !affected.includes(s)).map((s) => ({ shopId: s.shopId, shopName: s.shopName })),
    shops: affected.map((s) => {
      const m = s.graph.measures;
      const graph = s.graph.skuPack.has(input.skuId) ? s.graph : withPack(s.graph, input.skuId, s.basePack);
      const before = s.prices.get(input.skuId) ?? null;
      // The sequence this save appends to: the global one (a global save), or the shop's lane — and a
      // shop with no live lane gets a NEW lane whose only row is this one, so it is current regardless.
      const head = target.kind === "global" ? s.priceHeads.global : s.ownPriceLane ? s.priceHeads.lane : null;
      const becomesCurrent = priceBecomesCurrent(input.effectiveDate, head);
      const after = becomesCurrent ? input.newPrice : before;
      const afterPrices = becomesCurrent ? new Map(s.prices).set(input.skuId, input.newPrice) : new Map(s.prices);
      const content = skuContentOz(s.basePack, m);
      return {
        shopId: s.shopId,
        shopName: s.shopName,
        becomesCurrent,
        price: { before, after },
        costPerOz: { before: skuCostPerOz(before, content), after: skuCostPerOz(after, content) },
        menuItems: menuDeltas(input.skuId, graph, graph, costPerOzFromGraph(graph, s.prices), costPerOzFromGraph(graph, afterPrices), input.menuItems),
      };
    }),
  };
}
