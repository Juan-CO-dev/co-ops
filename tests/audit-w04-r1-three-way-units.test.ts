import { describe, expect, it } from "vitest";
import { buildThreeWayLines, flatPackChain, unitScaleFromChain, type SkuUnitScale } from "@/lib/po-match-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

/**
 * Audit W04 fix round 1 (B045). Every three-way comparison is made in ONE unit or not at all:
 * single-level chains convert known measures (a case of 16 lb billed "16 LB" is one case), vendor
 * aliases (EA / ea / each / ct) resolve, and a unit nothing can resolve leaves the flag off even
 * for a SKU with no chain (advisory-null), instead of comparing raw numbers.
 */
const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["count", { dimension: "count", toBaseFactor: 1 }],
]);
const snap = (qty: number, unitLabel: string | null = "case") => [{ skuId: "x", name: "Item", itemNumber: null, qty, unitLabel, priceCents: null }];
const inv = (qty: number, unit: string | null) => [{ description: "Item", qty, unit, unitPriceCents: null, extendedCents: 1000 }];
const recv = (qty: number, level: string | null = "case") => [{ skuId: "x", qty, level }];
const flags = (scale: SkuUnitScale | null, ordered: number, received: number, billed: number, unit: string | null, level: string | null = "case") =>
  buildThreeWayLines(snap(ordered), recv(received, level), inv(billed, unit), true, scale ? new Map([["x", scale]]) : new Map()).lines[0]!.flags;

describe("W04 r1: single-level chains compare known measures", () => {
  const caseOf16Lb: PackChainLevel[] = [{ id: "case", label: "case", containsQty: 16, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
  const scale = unitScaleFromChain(caseOf16Lb, measures)!;
  it("a single-level chain has a scale", () => expect(scale).not.toBeNull());
  it("one case received, billed 16 LB, is not over-billed", () => expect(flags(scale, 1, 1, 16, "LB")).toEqual([]));
  it("one case received, billed 256 oz, is not over-billed", () => expect(flags(scale, 1, 1, 256, "oz")).toEqual([]));
  it("one case received, billed 32 lbs, is over-billed", () => expect(flags(scale, 1, 1, 32, "lbs")).toContain("billed_over_received"));
});

describe("W04 r1: vendor unit aliases resolve", () => {
  const caseOf12Each: PackChainLevel[] = [
    { id: "case", label: "case", containsQty: 12, containsLevelId: "each", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "each", label: "each", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
  const scale = unitScaleFromChain(caseOf12Each, measures)!;
  it.each(["EA", "ea", "each", "Each", "EACH", "ct"])("12 %s against one case received is equal (no flag)", (unit) => {
    expect(flags(scale, 1, 1, 12, unit)).toEqual([]);
  });
  it.each(["EA", "ea", "each", "ct"])("24 %s against one case received is over-billed", (unit) => {
    expect(flags(scale, 1, 1, 24, unit)).toContain("billed_over_received");
  });
  it("a single-level count case (12 count) resolves EA through the count measure", () => {
    const countCase = unitScaleFromChain([{ id: "case", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "count", displayOrdinal: 0 }], measures)!;
    expect(flags(countCase, 1, 1, 12, "EA")).toEqual([]);
    expect(flags(countCase, 1, 1, 24, "EA")).toContain("billed_over_received");
  });
  it("a count unit on a weight-only chain stays unresolved (flag off)", () => {
    const caseOf16Lb = unitScaleFromChain([{ id: "case", label: "case", containsQty: 16, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }], measures)!;
    expect(flags(caseOf16Lb, 1, 1, 99, "EA")).toEqual([]);
  });
});

describe("W04 r1: a SKU with no resolvable chain never compares incompatible units", () => {
  it("an unknown invoice unit leaves billed_over_received off", () => {
    for (const unit of [null, "LB", "pallet"]) expect(flags(null, 1, 1, 40, unit, null)).not.toContain("billed_over_received");
  });
  it("the same unit on both sides still compares (case codes and an unlabelled door count are the root)", () => {
    expect(flags(null, 1, 1, 3, "CS", null)).toContain("billed_over_received");
    expect(flags(null, 4, 2, 2, "case", null)).toContain("short_received");
  });
  it("different units with no chain to relate them compare nothing", () => {
    expect(flags(null, 4, 2, 2, "bag", "each")).toEqual([]);
  });
});

describe("W04 r1: a flat-only SKU's pack becomes a chain", () => {
  it("6 x 5 lb case: two bags (10 lb) received against one case ordered is short; 30 lb billed for one case is equal", () => {
    const chain = flatPackChain({ pack_format: "Case", each_container_label: "bag", units_per_pack: 6, each_size: 5, each_measure: "lb" })!;
    const scale = unitScaleFromChain(chain, measures)!;
    expect(flags(scale, 1, 2, 10, "lb", "bag")).toEqual(["short_received"]);
    expect(flags(scale, 1, 2, 30, "lb", "bag")).toEqual(["billed_over_received", "short_received"]);
    expect(flags(scale, 1, 1, 30, "lb", null)).toEqual([]);
    expect(flags(scale, 1, 1, 7, "bags", null)).toContain("billed_over_received");
  });
  it("a flat pack missing its size has no chain", () => {
    expect(flatPackChain({ pack_format: "Case", each_container_label: null, units_per_pack: 6, each_size: null, each_measure: null })).toBeNull();
  });
});
