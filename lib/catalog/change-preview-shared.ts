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
import { buildPackChain, chainLeafUnitsPerRoot, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
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
  /**
   * The weight-keeping number in the new order unit: "convertible" — the conversion; "machine_par"
   * on a SHOP save — the prefilled opt-in "give this shop its own par" (the machine value restarts).
   */
  convertTo: number | null;
  /**
   * Set ONLY when an ounce side is unknown (a count-ending chain with no weight): what ONE order
   * unit holds before and after — "the par now means a different count" (1000 each → 500 each).
   */
  perOrderUnit: { before: OrderUnitCount | null; after: OrderUnitCount | null } | null;
  /**
   * "machine_par" only (lead decision, chunk-1 review P2-2): the new case bumps this shop's pack
   * epoch, which retires the machine par (D3). Until it recomputes, the shop uses the DEFAULT par —
   * this number, read in the new case (`fallbackOz`); null = there is no default par to fall back to.
   */
  fallbackPar: number | null;
  fallbackOz: number | null;
  /**
   * "machine_par" on a GLOBAL save only (chunk-2 review P3b): the default par this shop falls back to
   * IF the person also accepts the global par's conversion for this slot — the converted global par,
   * read in the new case. null = no global conversion is offered for this slot.
   */
  fallbackIfConverted: { par: number; oz: number | null } | null;
  /**
   * The ORDER UNIT each number on this row is counted in (chunk-2 review P3a): `current` in `before`;
   * `convertTo`, `fallbackPar` and `fallbackIfConverted` in `after` (the NEW order unit). A global row
   * uses the GLOBAL pack's unit, never one shop's.
   */
  unit: { before: string | null; after: string | null };
}

/** What one order unit holds, structurally: `qty` of the leaf `unit` (a case = 1000 each). */
export interface OrderUnitCount { qty: number; unit: string }

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
  /**
   * The PRICE snapshot (0261 sku_price_snapshot) the preview was computed on: the global head and each
   * reached shop's live lane + head. apply_sku_price_change re-takes it under the SKU lock and refuses
   * `price_changed` on any difference (full-branch r1 P2-2).
   */
  snapshot: unknown;
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

/** Two order-unit sizes are the same size — within float noise, never `===` on floats. */
export function sameOz(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** What ONE order unit holds, structurally (no weight needed): chained → leaf units per root; flat → units × size. */
export function orderUnitCount(p: RecipeInputSku, chain: readonly PackChainLevel[] | null): OrderUnitCount | null {
  if (chain && chain.length > 0) {
    const c = buildPackChain([...chain]);
    const qty = chainLeafUnitsPerRoot(c);
    const root = chainRootLabel(c);
    if (qty == null || root == null) return null;
    let cur = c.byLabel.get(root);
    const seen = new Set<string>();
    while (cur && cur.containsLevelId != null && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = c.byId.get(cur.containsLevelId);
    }
    const unit = cur != null && cur.containsLevelId == null ? cur.containsMeasureUnit : null;
    return unit == null ? null : { qty: round4(qty), unit };
  }
  if (p.eachSize == null || p.eachMeasure == null) return null;
  return { qty: round4((p.unitsPerPack ?? 1) * p.eachSize), unit: p.eachMeasure };
}

/**
 * Does the ORDER UNIT mean the same amount after the change? Both ounces known → compare them
 * (epsilon). An ounce side unknown (a count-ending chain with no weight) → the same only when what
 * one unit HOLDS is provably the same; anything unprovable is a change the person must see
 * (chunk-1 review P2-1: a case of 1000 each → 500 each is not "nothing").
 */
function sameOrderUnit(b: RowBasis): boolean {
  if (b.beforeOz != null && b.afterOz != null) return sameOz(b.beforeOz, b.afterOz);
  if (b.beforeOz != null || b.afterOz != null) return false;
  return b.before != null && b.after != null && b.before.unit === b.after.unit && sameOz(b.before.qty, b.after.qty);
}

interface RowBasis {
  beforeOz: number | null; afterOz: number | null; before: OrderUnitCount | null; after: OrderUnitCount | null;
  unit: { before: string | null; after: string | null };
}

function parRow(
  locationId: string | null, shops: string[], slot: ParSlotName, lane: ParLane, status: ParRowStatus,
  current: number, b: RowBasis, convertTo: number | null, inherited = false,
  fallback: { par: number | null } | null = null,
): PreviewParRow {
  const { beforeOz, afterOz } = b;
  return {
    locationId, shops, slot, lane, status, inherited, current,
    currentOz: beforeOz == null ? null : round4(current * beforeOz),
    keepOz: afterOz == null ? null : round4(current * afterOz),
    convertTo: status === "convertible" || status === "machine_par" ? convertTo : null,
    perOrderUnit: beforeOz == null || afterOz == null ? { before: b.before, after: b.after } : null,
    fallbackPar: fallback?.par ?? null,
    fallbackOz: fallback?.par != null && afterOz != null ? round4(fallback.par * afterOz) : null,
    fallbackIfConverted: null,
    unit: b.unit,
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
  /** Each machine-par row's unrounded new order-unit oz (for the converted-global fallback). */
  const rowAfterOz = new Map<PreviewParRow, number | null>();

  // Per affected shop: its own (human) par converts; an inherited global par on a SHOP-only save is
  // the opt-in "give this shop its own par" (the global par is untouched). The machine's par (lead
  // decision, chunk-1 review P2-2): the new case bumps the shop's pack epoch and RETIRES it (D3), so
  // the row says what really happens — until it recomputes, the shop uses the default par read in
  // the new case — and, on a SHOP save, offers "give this shop its own par" prefilled with the
  // weight-keeping value, through the same atomic apply (from: "auto").
  affected.forEach((s, i) => {
    const { before: beforeOz, after: afterOz } = deltas[i]!.orderUnitOz;
    const basis: RowBasis = {
      beforeOz, afterOz,
      before: orderUnitCount(s.basePack, chainOf(s.basePack)),
      after: orderUnitCount({ ...s.basePack, packChain: input.newChain }, input.newChain),
      unit: deltas[i]!.orderUnit,
    };
    const sameUnit = sameOrderUnit(basis);
    for (const sl of s.slots) {
      if (sl.value == null || !(sl.value > 0)) continue;
      if (sl.lane === "global" && target.kind === "global") continue; // the global lane, below
      // Chunk-2 review P2-1: EVERY saved version bumps the pack epoch of each shop it reaches (0259
      // sku_pack_epoch_bump), so a machine par restarts even when the case means the same amount
      // (4 × 10 lb → 2 × 20 lb). Its row is emitted before the "nothing to convert" skip.
      if (sameUnit && sl.lane !== "auto") continue;
      const to = convertParQuantity(sl.value, beforeOz, afterOz, input.parStep);
      if (sl.lane === "human") {
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "human", to == null ? "no_weight" : "convertible", sl.value, basis, to));
      } else if (sl.lane === "auto") {
        const ownPar = target.kind === "shop" ? to : null;
        const row = parRow(s.shopId, [s.shopName], sl.slot, "auto", "machine_par", sl.value, basis, ownPar, ownPar != null, { par: input.globalPars[sl.slot] });
        rowAfterOz.set(row, afterOz);
        pars.push(row);
      } else if (sl.lane === "global") {
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "global", to == null ? "no_weight" : "convertible", sl.value, basis, to, true));
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
      const basis: RowBasis = {
        beforeOz, afterOz,
        before: orderUnitCount(input.targetBasePack, chainOf(input.targetBasePack)), after: orderUnitCount(newPack, input.newChain),
        // The GLOBAL pack's own order unit — never one shop's (chunk-2 review P3a).
        unit: { before: orderUnitLabel(input.targetBasePack.packFormat, chainOf(input.targetBasePack)), after: orderUnitLabel(input.targetBasePack.packFormat, input.newChain) },
      };
      if (sameOrderUnit(basis)) continue;
      const shared = inheriting.some((s) => s.ownPackVersion);
      const to = shared ? null : convertParQuantity(value, beforeOz, afterOz, input.parStep);
      const status: ParRowStatus = shared ? "global_par_shared" : to == null ? "no_weight" : "convertible";
      pars.push(parRow(null, inheriting.map((s) => s.shopName), slot, "global", status, value, basis, to));
    }
  }

  // Chunk-2 review P3b: on a global save, a restarting machine par falls back to the GLOBAL par — the
  // converted one if the person also accepts the global conversion for that slot.
  if (target.kind === "global") {
    for (const row of pars) {
      if (row.status !== "machine_par") continue;
      const g = pars.find((p) => p.locationId === null && p.slot === row.slot && p.status === "convertible" && p.convertTo != null);
      if (!g) continue;
      // The shop's OWN new order-unit oz, carried through — never rebuilt from the rounded keepOz (P3d).
      const afterOz = rowAfterOz.get(row) ?? null;
      row.fallbackIfConverted = { par: g.convertTo!, oz: afterOz == null ? null : round4(g.convertTo! * afterOz) };
    }
  }

  const conversions: ParConversion[] = pars
    .filter((p) => (p.status === "convertible" || (p.status === "machine_par" && p.inherited)) && p.convertTo != null)
    .map((p): ParConversion => (p.status === "machine_par"
      ? { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo!, inherited: true, from: "auto" }
      : p.inherited
        ? { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo!, inherited: true }
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

/**
 * A shop's PRICE STANDING from the two resolved heads (lib/admin/cost.ts → resolveCurrentPrices).
 * The shop "has its own price" ONLY when its live lane answered with a row of ITS OWN (`laneId`): a
 * live lane with no row yet falls back to the global head, so a global price save still reaches it
 * (chunk-1 review P3b).
 */
export function shopPriceStanding(
  shopHead: { value: number; effectiveDate: string; laneId: string | null } | null,
  globalHead: { value: number; effectiveDate: string } | null,
): { ownPriceLane: boolean; priceHeads: { global: PriceHead | null; lane: PriceHead | null } } {
  const own = shopHead != null && shopHead.laneId != null;
  return {
    ownPriceLane: own,
    priceHeads: {
      global: globalHead ? { value: globalHead.value, effectiveDate: globalHead.effectiveDate } : null,
      lane: own ? { value: shopHead.value, effectiveDate: shopHead.effectiveDate } : null,
    },
  };
}

export function previewPriceChange(input: {
  skuId: string;
  target: PreviewTarget;
  shops: readonly PreviewShopState[];
  newPrice: number;
  effectiveDate: string;
  menuItems: readonly PreviewMenuItem[];
}): Omit<PricePreview, "token" | "snapshot"> {
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
