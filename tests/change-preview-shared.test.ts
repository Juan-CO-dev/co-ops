/**
 * Catalog Phase 2b — "What this changes" (spec §4, §5 jobs 1 + 5, §8 "Preview tests"; lead D4): computed
 * for the ACTUAL save target, every affected shop listed with its pack and its par lane, conversion
 * offered only where that shop's effective pack changes and the par lives in the lane being changed.
 */
import { describe, expect, it } from "vitest";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  convertParQuantity, previewPackChange, previewPriceChange, previewToken, shopPriceStanding, type PreviewShopState,
} from "@/lib/catalog/change-preview-shared";
import { resolveCurrentPrices } from "@/lib/sku-versions-shared";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }]]);
const globalChain: PackChainLevel[] = [
  { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "b", label: "bag", containsQty: 80, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
];
const ownChain: PackChainLevel[] = [{ id: "o", label: "case", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
// It arrives differently now: 4 × 10 lb (the bag is now a "sack").
const newChain: PackChainLevel[] = [
  { id: "n0", label: "case", containsQty: 4, containsLevelId: "n1", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "n1", label: "sack", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
];
const pack = (chain: PackChainLevel[]): RecipeInputSku => ({ packFormat: "case", eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: chain });
const recipe = (id: string, menuId: string, inputs: GraphRecipe["inputs"]): GraphRecipe => ({
  recipeId: id, batchYield: 1, inputs,
  outputs: [{ outputItemId: null, outputMenuItemId: menuId, yield: 1, ozPerParUnit: null, parUnitLabel: null }],
});
const line = (quantity: number, unit: string) => ({ quantity, unit, componentSkuId: "t", componentItemId: null, componentProductId: null });
const graphFor = (p: RecipeInputSku) => buildRecipeGraph([
  recipe("r1", "m-oz", [line(4, "oz")]),
  recipe("r2", "m-case", [line(0.0125, "case")]),
  recipe("r3", "m-bag", [line(1, "bag")]),
], new Map([["t", p]]), measures);
const menuItems = [{ id: "m-oz", name: "By ounce", nameEs: null }, { id: "m-case", name: "By case", nameEs: "Por caja" }, { id: "m-bag", name: "By bag", nameEs: null }, { id: "m-none", name: "Unrelated", nameEs: null }];
const recipeLines = [{ recipeId: "r3", recipeName: "Bag sub", quantity: 1, unit: "bag" }, { recipeId: "r1", recipeName: "Oz sub", quantity: 4, unit: "oz" }];

type Lane = "human" | "auto" | "global" | "none";
function shop(id: string, opts: { own?: boolean; weekday: [number | null, Lane]; weekend?: [number | null, Lane]; ownPrice?: boolean; price?: number; globalDate?: string }): PreviewShopState {
  const p = pack(opts.own ? ownChain : globalChain);
  return {
    shopId: id, shopName: id === "A" ? "P Street" : "Cap Hill", basePack: p, ownPackVersion: opts.own === true, ownPriceLane: opts.ownPrice === true,
    priceHeads: {
      global: { value: 128, effectiveDate: opts.globalDate ?? "2026-10-01" },
      lane: opts.ownPrice ? { value: opts.price ?? 128, effectiveDate: "2026-10-01" } : null,
    },
    graph: graphFor(p), prices: new Map([["t", opts.price ?? 128]]),
    slots: [{ slot: "weekday", value: opts.weekday[0], lane: opts.weekday[1] }, { slot: "weekend", value: opts.weekend?.[0] ?? null, lane: opts.weekend?.[1] ?? "none" }],
    openOrders: [{ poId: `po-${id}`, displayCode: `${id}-1`, status: "placed", orderQty: 2, orderUnitLabel: "case", shopId: id, shopName: id }],
  };
}
const base = { skuId: "t", newChain, parStep: null, menuItems, recipeLines, liveVersionId: "gv", basedOnVersionId: null };

describe("a shop-only save (target = that shop)", () => {
  it("reaches only that shop, with its own before → after", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "human"] }), shop("B", { weekday: [3, "global"] })] });
    expect(p.changed).toBe(true);
    expect(p.shops.map((s) => s.shopId)).toEqual(["A"]);
    expect(p.unaffected.map((s) => s.shopId)).toEqual(["B"]);
    const a = p.shops[0]!;
    expect(a.orderUnitOz).toEqual({ before: 320, after: 640 });
    expect(a.costPerOz.before).toBeCloseTo(0.4, 12);
    expect(a.costPerOz.after).toBeCloseTo(0.2, 12);
    const byId = Object.fromEntries(a.menuItems.map((m) => [m.id, m]));
    expect(byId["m-oz"]!.after).toBeCloseTo(0.8, 10);
    expect(byId["m-bag"]!.after).toBeNull(); // its unit goes away → it stops costing
    expect(byId["m-none"]).toBeUndefined();
    expect(a.brokenLines.map((l) => l.recipeId)).toEqual(["r3"]);
    expect(a.openOrders.map((o) => o.displayCode)).toEqual(["A-1"]);
  });
  it("the shop's OWN par converts, bound to the value it was computed from", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "human"] })] });
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 3, to: 2 }]);
  });
  it("an INHERITED global par: the opt-in 'give this shop its own par' — the shop's slot is created, the global par untouched (2b r2#3)", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] })] });
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "global", status: "convertible", inherited: true, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 3, to: 2, inherited: true }]);
  });
  it("a MACHINE par (lead decision P2-2): it restarts — the shop uses the default par read in the new case — and the opt-in 'own par' is prefilled with the weight-keeping value", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [5, "auto"] })] });
    // auto 5 cases × 320 oz = 1600 oz; in the new 640-oz case that is 2.5 → 3 (whole-par step).
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "auto", status: "machine_par", inherited: true,
      current: 5, currentOz: 1600, keepOz: 3200, convertTo: 3, perOrderUnit: null, fallbackPar: 3, fallbackOz: 1920, fallbackIfConverted: null, unit: { before: "case", after: "case" } }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 5, to: 3, inherited: true, from: "auto" }]);
  });
  it("a machine par with NO default par to fall back to says so plainly (fallbackPar null) — the opt-in is still offered", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: null, weekend: null },
      shops: [shop("A", { weekday: [5, "auto"] })] });
    expect(p.pars[0]).toMatchObject({ status: "machine_par", fallbackPar: null, fallbackOz: null, convertTo: 3 });
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 5, to: 3, inherited: true, from: "auto" }]);
  });
  it("on a GLOBAL save a shop's machine par still restarts (fallback shown), but the shop-only opt-in is not offered there", () => {
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [5, "auto"] })] });
    expect(p.pars.find((r) => r.lane === "auto")).toMatchObject({ status: "machine_par", inherited: false, convertTo: null, fallbackPar: 3, fallbackOz: 1920 });
    expect(p.conversions.some((c) => c.from === "auto")).toBe(false);
  });
});

describe("a size with no honest ounce (no_weight)", () => {
  it("names the par, offers keep only, and converts nothing", () => {
    const m = new Map(measures).set("each", { dimension: "count", toBaseFactor: 1 });
    const countChain: PackChainLevel[] = [{ id: "e", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 0 }];
    const a = shop("A", { weekday: [3, "human"] });
    const withMeasures = { ...a, graph: { ...a.graph, measures: m } };
    const p = previewPackChange({ ...base, newChain: countChain, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [withMeasures] });
    expect(p.changed).toBe(true);
    expect(p.shops[0]!.orderUnitOz).toEqual({ before: 320, after: null });
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "no_weight", inherited: false, current: 3, currentOz: 960, keepOz: null, convertTo: null,
      perOrderUnit: { before: { qty: 320, unit: "oz" }, after: { qty: 12, unit: "each" } }, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } }]);
    expect(p.conversions).toEqual([]);
  });
});

describe("what counts as 'the order unit changed' (chunk-1 review P2-1)", () => {
  const each = new Map(measures).set("each", { dimension: "count", toBaseFactor: 1 });
  const countCase = (n: number): PackChainLevel[] => [{ id: `e${n}`, label: "case", containsQty: n, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 0 }];
  const countShop = (chain: PackChainLevel[]) => {
    const a = shop("A", { weekday: [3, "human"] });
    const p0 = pack(chain);
    return { ...a, basePack: p0, graph: { ...buildRecipeGraph([], new Map([["t", p0]]), each) } };
  };
  it("a count-ending case with NO weight whose count changes (1000 each → 500 each) gets a row: the par now means a different count", () => {
    const p = previewPackChange({ ...base, newChain: countCase(500), target: { kind: "shop", shopId: "A" }, targetBasePack: pack(countCase(1000)),
      globalPars: { weekday: null, weekend: null }, shops: [countShop(countCase(1000))] });
    expect(p.shops[0]!.orderUnitOz).toEqual({ before: null, after: null });
    expect(p.pars).toEqual([expect.objectContaining({ status: "no_weight", current: 3, convertTo: null,
      perOrderUnit: { before: { qty: 1000, unit: "each" }, after: { qty: 500, unit: "each" } } })]);
    expect(p.conversions).toEqual([]);
  });
  it("…and the SAME count under a new name is no par change (nothing to ask)", () => {
    const renamed: PackChainLevel[] = [{ id: "r", label: "box", containsQty: 1000, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 0 }];
    const p = previewPackChange({ ...base, newChain: renamed, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(countCase(1000)),
      globalPars: { weekday: null, weekend: null }, shops: [countShop(countCase(1000))] });
    expect(p.changed).toBe(true);
    expect(p.pars).toEqual([]);
  });
  it("float noise is not a change: 3 × 0.1 lb against 0.3 lb asks nothing (never === on floats)", () => {
    const tenths: PackChainLevel[] = [
      { id: "t0", label: "case", containsQty: 3, containsLevelId: "t1", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "t1", label: "pouch", containsQty: 0.1, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
    ];
    const whole: PackChainLevel[] = [{ id: "w", label: "case", containsQty: 0.3, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
    expect(3 * 0.1 * 16).not.toBe(0.3 * 16); // the noise is real
    const a = shop("A", { weekday: [3, "human"] });
    const p = previewPackChange({ ...base, newChain: whole, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(tenths), globalPars: { weekday: null, weekend: null },
      shops: [{ ...a, basePack: pack(tenths), graph: graphFor(pack(tenths)) }] });
    expect(p.changed).toBe(true);
    expect(p.pars).toEqual([]);
  });
});

describe("chunk-2 review: every save restarts the machine par; units are the row's own", () => {
  const twoBy20: PackChainLevel[] = [
    { id: "x0", label: "case", containsQty: 2, containsLevelId: "x1", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "x1", label: "sack", containsQty: 20, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  ];
  const fourBy10 = newChain; // 4 × 10 lb = 640 oz, the same amount as 2 × 20 lb
  it("P2-1: the case means the same amount (4 × 10 lb → 2 × 20 lb) — the human par asks nothing, but the auto par still restarts (the epoch bumps on every version)", () => {
    const a = { ...shop("A", { weekday: [5, "auto"], weekend: [2, "human"] }), basePack: pack(fourBy10), graph: graphFor(pack(fourBy10)) };
    const p = previewPackChange({ ...base, newChain: twoBy20, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(fourBy10), globalPars: { weekday: 3, weekend: null }, shops: [a] });
    expect(p.changed).toBe(true);
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "auto", status: "machine_par", inherited: true,
      current: 5, currentOz: 3200, keepOz: 3200, convertTo: 5, perOrderUnit: null, fallbackPar: 3, fallbackOz: 1920,
      fallbackIfConverted: null, unit: { before: "case", after: "case" } }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 5, to: 5, inherited: true, from: "auto" }]);
  });
  it("P3a: a renamed order unit — numbers in the new size carry the NEW unit; the global row carries the GLOBAL pack's unit", () => {
    const box: PackChainLevel[] = [
      { id: "b0", label: "box", containsQty: 4, containsLevelId: "b1", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b1", label: "sack", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
    ];
    const p = previewPackChange({ ...base, newChain: box, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] }), shop("B", { weekday: [3, "global"] })] });
    expect(p.pars).toEqual([expect.objectContaining({ locationId: null, convertTo: 2, unit: { before: "case", after: "box" } })]);
  });
  it("P3b: on a global save a restarting machine par falls back to the CONVERTED global par if that conversion is accepted", () => {
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [5, "auto"] }), shop("B", { weekday: [3, "global"] })] });
    const machine = p.pars.find((r) => r.status === "machine_par")!;
    expect(machine).toMatchObject({ fallbackPar: 3, fallbackOz: 1920, fallbackIfConverted: { par: 2, oz: 1280 } });
    expect(p.conversions).toEqual([{ locationId: null, slot: "weekday", expected: 3, to: 2 }]);
  });
});

describe("a save for everyone (target = global)", () => {
  it("every shop riding the global pack is affected; a shop with its own version is untouched", () => {
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: 4 },
      shops: [shop("A", { weekday: [5, "human"], weekend: [4, "global"] }), shop("B", { own: true, weekday: [3, "global"], weekend: [4, "global"] })] });
    expect(p.shops.map((s) => s.shopId)).toEqual(["A"]);
    expect(p.unaffected).toEqual([{ shopId: "B", shopName: "Cap Hill" }]);
    // A's own weekday par converts; the global weekend par is shared with B (whose case is NOT changing) → not converted.
    expect(p.pars.map((r) => [r.locationId, r.slot, r.status])).toEqual([["A", "weekday", "convertible"], [null, "weekend", "global_par_shared"], [null, "weekday", "global_par_shared"]]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 5, to: 3 }]);
  });
  it("the global par converts when every shop inheriting it rides the global pack", () => {
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] }), shop("B", { weekday: [3, "global"] })] });
    expect(p.pars).toEqual([{ locationId: null, shops: ["P Street", "Cap Hill"], slot: "weekday", lane: "global", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } }]);
    expect(p.conversions).toEqual([{ locationId: null, slot: "weekday", expected: 3, to: 2 }]);
    expect(p.shops.flatMap((s) => s.openOrders.map((o) => o.displayCode))).toEqual(["A-1", "B-1"]);
  });
});

describe("a shop with its OWN pack whose AUTO par rests on the global par (Astra 2b r2#1)", () => {
  it("is a dependent: the global par is NOT converted, and the shop is never 'untouched' with a changed par", () => {
    // A inherits the global 3; B keeps its own case but its auto par 5 stands only while the global par is 3.
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] }), shop("B", { own: true, weekday: [5, "auto"] })] });
    expect(p.unaffected).toEqual([{ shopId: "B", shopName: "Cap Hill" }]);
    expect(p.pars.map((r) => [r.locationId, r.slot, r.status, r.shops])).toEqual([[null, "weekday", "global_par_shared", ["P Street", "Cap Hill"]]]);
    expect(p.conversions).toEqual([]); // so B's resolved par (5) cannot change: its label "untouched" stays true
  });
});

describe("nothing changes", () => {
  it("an identical chain changes nothing and asks nothing", () => {
    const p = previewPackChange({ ...base, newChain: globalChain, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] })] });
    expect(p.changed).toBe(false);
    expect(p.shops).toEqual([]);
    expect(p.pars).toEqual([]);
    expect(p.conversions).toEqual([]);
  });
});

describe("previewPriceChange — per target", () => {
  it("a global price reaches every shop without its own price; a shop price reaches that shop", () => {
    const shops = [shop("A", { weekday: [3, "global"] }), shop("B", { weekday: [3, "global"], ownPrice: true, price: 150 })];
    const g = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops, newPrice: 160, effectiveDate: "2026-10-16", menuItems });
    expect(g.shops.map((s) => s.shopId)).toEqual(["A"]);
    expect(g.unaffected.map((s) => s.shopId)).toEqual(["B"]);
    expect(g.shops[0]!.price).toEqual({ before: 128, after: 160 });
    expect(g.shops[0]!.costPerOz.after).toBeCloseTo(0.5, 12);
    expect(g.shops[0]!.menuItems.find((m) => m.id === "m-oz")!.after).toBeCloseTo(2, 10);
    const s = previewPriceChange({ skuId: "t", target: { kind: "shop", shopId: "B" }, shops, newPrice: 160, effectiveDate: "2026-10-16", menuItems });
    expect(s.shops.map((x) => [x.shopId, x.price.before])).toEqual([["B", 150]]);
  });
  it("the EFFECTIVE DATE decides (Astra 2b r3#2): a price dated before the current one changes nothing today", () => {
    // The current global price is $100, dated Oct 15. A save of $80 dated Oct 14 is history, not today's price.
    const shops = [{ ...shop("A", { weekday: [3, "global"], globalDate: "2026-10-15" }), prices: new Map([["t", 100]]) }];
    shops[0]!.priceHeads = { global: { value: 100, effectiveDate: "2026-10-15" }, lane: null };
    const back = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops, newPrice: 80, effectiveDate: "2026-10-14", menuItems });
    expect(back.shops[0]).toMatchObject({ becomesCurrent: false, price: { before: 100, after: 100 } });
    expect(back.shops[0]!.menuItems.every((m) => m.before === m.after)).toBe(true);
    const same = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops, newPrice: 80, effectiveDate: "2026-10-15", menuItems });
    expect(same.shops[0]).toMatchObject({ becomesCurrent: true, price: { before: 100, after: 80 } }); // same date: the newer row wins
  });
  it("a shop's FIRST own price opens its lane, so even a back-dated one becomes that shop's current price", () => {
    const shops = [shop("A", { weekday: [3, "global"], globalDate: "2026-10-15" })];
    const p = previewPriceChange({ skuId: "t", target: { kind: "shop", shopId: "A" }, shops, newPrice: 80, effectiveDate: "2026-10-14", menuItems });
    expect(p.shops[0]).toMatchObject({ becomesCurrent: true, price: { after: 80 } });
  });
});

describe("the price head a save is compared against (chunk-1 review P3a/P3b)", () => {
  it("a shop save compares against the shop's LANE head, never the global one (their dates differ)", () => {
    // The lane's current row is dated Oct 10; the global head is dated Oct 20. A shop save dated Oct 15
    // is the shop's new price; compared (wrongly) against the global head it would be "history".
    const s0 = { ...shop("A", { weekday: [3, "global"], ownPrice: true, price: 150, globalDate: "2026-10-20" }) };
    s0.priceHeads = { global: { value: 128, effectiveDate: "2026-10-20" }, lane: { value: 150, effectiveDate: "2026-10-10" } };
    const p = previewPriceChange({ skuId: "t", target: { kind: "shop", shopId: "A" }, shops: [s0], newPrice: 160, effectiveDate: "2026-10-15", menuItems });
    expect(p.shops[0]).toMatchObject({ becomesCurrent: true, price: { before: 150, after: 160 } });
    // …and a GLOBAL save dated Oct 15 is history for a shop riding the global price (head Oct 20).
    const g0 = { ...shop("B", { weekday: [3, "global"], globalDate: "2026-10-20" }) };
    g0.priceHeads = { global: { value: 128, effectiveDate: "2026-10-20" }, lane: null };
    const g = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops: [g0], newPrice: 160, effectiveDate: "2026-10-15", menuItems });
    expect(g.shops[0]).toMatchObject({ becomesCurrent: false, price: { before: 128, after: 128 } });
  });
  it("a shop whose live lane has NO row of its own rides the global price: a global save is shown reaching it", () => {
    const rows = [{ id: "g1", vendor_item_id: "t", unit_price: 128, effective_date: "2026-10-01", recorded_at: "2026-10-01T00:00:00Z", location_id: null, price_lane_id: null }];
    const shopHead = resolveCurrentPrices(rows, new Map([["t", "lane-A"]])).get("t") ?? null; // a live lane, no row yet
    const globalHead = resolveCurrentPrices(rows, new Map()).get("t") ?? null;
    const standing = shopPriceStanding(shopHead, globalHead);
    expect(standing).toEqual({ ownPriceLane: false, priceHeads: { global: { value: 128, effectiveDate: "2026-10-01" }, lane: null } });
    const a = { ...shop("A", { weekday: [3, "global"] }), ...standing };
    const g = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops: [a], newPrice: 160, effectiveDate: "2026-10-16", menuItems });
    expect(g.shops.map((x) => [x.shopId, x.becomesCurrent])).toEqual([["A", true]]);
    expect(g.unaffected).toEqual([]);
    // With a row of its own the lane answers, and the shop is untouched by a global save.
    const own = [{ id: "l1", vendor_item_id: "t", unit_price: 150, effective_date: "2026-10-02", recorded_at: "2026-10-02T00:00:00Z", location_id: "A", price_lane_id: "lane-A" }, ...rows];
    const ownStanding = shopPriceStanding(resolveCurrentPrices(own, new Map([["t", "lane-A"]])).get("t") ?? null, globalHead);
    expect(ownStanding.ownPriceLane).toBe(true);
    const g2 = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops: [{ ...a, ...ownStanding }], newPrice: 160, effectiveDate: "2026-10-16", menuItems });
    expect(g2.unaffected.map((u) => u.shopId)).toEqual(["A"]);
  });
});

describe("previewToken — a save must present the preview it was shown", () => {
  it("changes when the target, the live version, the levels or an offered conversion changes", () => {
    const a = previewToken({ target: { kind: "global" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] });
    expect(previewToken({ target: { kind: "global" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] })).toBe(a);
    expect(previewToken({ target: { kind: "shop", shopId: "A" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] })).not.toBe(a);
    expect(previewToken({ target: { kind: "global" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 4, to: 2 }] })).not.toBe(a);
    expect(previewToken({ kind: "price", newPrice: 80, effectiveDate: "2026-10-14" })).not.toBe(previewToken({ kind: "price", newPrice: 80, effectiveDate: "2026-10-15" }));
  });
});

describe("convertParQuantity", () => {
  it("rounds to the par step (default 1 for a whole par, 0.5 for a half) and never below one step", () => {
    expect(convertParQuantity(3, 320, 640, null)).toBe(2);
    expect(convertParQuantity(1.5, 320, 640, null)).toBe(1);
    expect(convertParQuantity(1, 320, 6400, null)).toBe(1);
    expect(convertParQuantity(4, 320, 640, 0.25)).toBe(2);
    expect(convertParQuantity(0, 320, 640, null)).toBe(0);
    expect(convertParQuantity(3, null, 640, null)).toBeNull();
  });
});
