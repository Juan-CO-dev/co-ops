import { describe, expect, it } from "vitest";
import { receivedLineContribution, rootConversionOf, type FlatPackFacts } from "@/lib/admin/cost-shared";
import type { ResolvedPack } from "@/lib/sku-versions-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

/**
 * Audit W04 fix round 2 (B043). A frozen root-pack price converts to the received level through the
 * CONTAINER COUNT of the pack in force then, never through weight estimates. Reviewer repro: a case of
 * 12 bottles, two bottles received (20 oz frozen) at $60/case is $10. Changing the SKU's average bottle
 * weight from 10 to 20 oz, or clearing it, must leave those dollars at $10.
 */
const measures = new Map<string, MeasureUnitFactor>([
  ["each", { dimension: "count", toBaseFactor: 1 }],
  ["fl oz", { dimension: "volume", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
]);
const lv = (id: string, label: string, qty: number, next: string | null, unit: string | null, ord: number): PackChainLevel =>
  ({ id, label, containsQty: qty, containsLevelId: next, containsMeasureUnit: unit, displayOrdinal: ord });
const pack = (levels: PackChainLevel[], flat?: ResolvedPack["flat"]): ResolvedPack =>
  ({ levels, versionId: "v1", locationId: null, effectiveFrom: "2026-01-01T00:00:00Z", ...(flat ? { flat } : {}) });
const flatFacts = (avg: number | null): FlatPackFacts =>
  ({ pack_format: "case", eachContainerLabel: "bottle", unitsPerPack: 12, eachSize: 1, eachMeasure: "each", avgOzPerEach: avg });

/** The ledger's dollars for one line, through the real conversion of the pack in force then. */
function dollarsFor(p: ResolvedPack | undefined, avg: number | null, qty: number, level: string, resolvedOz: number, price: number, hasVersions = true) {
  const then = rootConversionOf(flatFacts(avg), p, measures, hasVersions);
  return receivedLineContribution({
    qty, levelLabel: level, resolvedOz, linePrice: price, currentRootPrice: null,
    contentOz: then.rootOz, rootLabel: "case", receivedRootOz: then.rootOz, receivedRootLabel: then.rootLabel,
    receivedLevelsPerRoot: then.levelsPerRoot?.get(level) ?? null, priceIsPerLevel: false,
  }).dollars;
}

describe("W04 r2: count-chain dollars ride the historical container count", () => {
  const countCase = pack([lv("case", "case", 12, "bottle", null, 0), lv("bottle", "bottle", 1, null, "each", 1)]);
  it("two of twelve bottles at $60/case are $10 at a 10 oz average", () => {
    expect(dollarsFor(countCase, 10, 2, "bottle", 20, 60)).toBe(10);
  });
  it("changing the average bottle weight to 20 oz does not change the receipt's dollars", () => {
    expect(dollarsFor(countCase, 20, 2, "bottle", 20, 60)).toBe(10);
  });
  it("clearing the average does not unprice the receipt", () => {
    expect(dollarsFor(countCase, null, 2, "bottle", 20, 60)).toBe(10);
  });
  it("a single-level count case received in its leaf count converts by that count", () => {
    const single = pack([lv("case", "case", 12, null, "each", 0)]);
    expect(dollarsFor(single, 10, 3, "each", 30, 60)).toBe(15);
    expect(dollarsFor(single, 25, 3, "each", 30, 60)).toBe(15);
  });
});

describe("W04 r2: volume-chain dollars ride the historical container count", () => {
  const jugs = pack([lv("case", "case", 6, "jug", null, 0), lv("jug", "jug", 64, null, "fl oz", 1)]);
  it("three of six jugs at $30/case are $15 whatever the oz-per-fl-oz average", () => {
    expect(dollarsFor(jugs, 1.04, 3, "jug", 199.68, 30)).toBe(15);
    expect(dollarsFor(jugs, 0.9, 3, "jug", 199.68, 30)).toBe(15);
    expect(dollarsFor(jugs, null, 3, "jug", 199.68, 30)).toBe(15);
  });
});

describe("W04 r2: the container count is the one in force then", () => {
  it("a 12-bottle case then is 12 bottles even after today's case became 24", () => {
    const then12 = pack([lv("case", "case", 12, "bottle", null, 0), lv("bottle", "bottle", 1, null, "each", 1)]);
    expect(dollarsFor(then12, 10, 6, "bottle", 60, 60)).toBe(30);
  });
  it("a pre-chain flat baseline answers from its units per pack", () => {
    const baseline = pack([], { pack_format: "case", each_container_label: "bottle", units_per_pack: 12, each_size: 1, each_measure: "each" });
    expect(dollarsFor(baseline, 20, 2, "bottle", 20, 60)).toBe(10);
  });
  it("a never-versioned SKU answers from its flat pack", () => {
    expect(dollarsFor(undefined, 20, 2, "bottle", 20, 60, false)).toBe(10);
  });
  it("a level the pack in force then does not contain is unpriced, never guessed", () => {
    const countCase = pack([lv("case", "case", 12, "bottle", null, 0), lv("bottle", "bottle", 1, null, "each", 1)]);
    expect(dollarsFor(countCase, 10, 2, "sleeve", 20, 60)).toBeNull();
  });
  it("weight chains keep their container answer (two of six bags at $60 = $20)", () => {
    const bags = pack([lv("case", "case", 6, "bag", null, 0), lv("bag", "bag", 5, null, "lb", 1)]);
    expect(dollarsFor(bags, null, 2, "bag", 160, 60)).toBe(20);
    // an observed (weighed) frozen oz different from the nominal bag does not move the case fraction
    expect(dollarsFor(bags, null, 2, "bag", 150, 60)).toBe(20);
  });
});
