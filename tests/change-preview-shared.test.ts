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
  convertParQuantity, previewPackChange, previewPriceChange, previewToken, type PreviewShopState,
} from "@/lib/catalog/change-preview-shared";

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
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 3, to: 2 }]);
  });
  it("an INHERITED global par: the opt-in 'give this shop its own par' — the shop's slot is created, the global par untouched (2b r2#3)", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] })] });
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "global", status: "convertible", inherited: true, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 3, to: 2, inherited: true }]);
  });
  it("a machine par is named, never converted (D3 retires it)", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [5, "auto"] })] });
    expect(p.pars.map((r) => r.status)).toEqual(["machine_par"]);
    expect(p.conversions).toEqual([]);
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
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "no_weight", inherited: false, current: 3, currentOz: 960, keepOz: null, convertTo: null }]);
    expect(p.conversions).toEqual([]);
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
    expect(p.pars).toEqual([{ locationId: null, shops: ["P Street", "Cap Hill"], slot: "weekday", lane: "global", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 }]);
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
