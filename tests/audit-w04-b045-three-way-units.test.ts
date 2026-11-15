import { describe, expect, it } from "vitest";
import { buildThreeWayLines, unitScaleFromChain, type SkuUnitScale } from "@/lib/po-match-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

/**
 * Audit W04/B045: ordered, received and billed quantities are compared in ONE unit (the SKU's
 * pack chain), and a unit that cannot be resolved leaves the flag off (advisory-null law).
 * Chain: case = 12 x each, each = 32 oz.
 */
const chain: PackChainLevel[] = [
  { id: "case", label: "case", containsQty: 12, containsLevelId: "each", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "each", label: "each", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
];
const scale = unitScaleFromChain(chain)!;
const scales = new Map<string, SkuUnitScale>([["x", scale]]);
const snap = (qty: number, unitLabel = "case") => [{ skuId: "x", name: "Sauce", itemNumber: null, qty, unitLabel, priceCents: null }];
const inv = (qty: number, unit: string | null) => [{ description: "Sauce", qty, unit, unitPriceCents: null, extendedCents: 1000 }];

describe("W04/B045 three-way compares one unit", () => {
  it("builds leaf counts per level from the chain (a single level is its own leaf, W04 r1)", () => {
    expect(scale.rootLabel).toBe("case");
    expect([...scale.leafPerLevel]).toEqual([["case", 12], ["each", 1]]);
    expect([...unitScaleFromChain([chain[1]!])!.leafPerLevel]).toEqual([["each", 1]]);
  });

  it("12 each received against 2 cases ordered is short", () => {
    const v = buildThreeWayLines(snap(2), [{ skuId: "x", qty: 12, level: "each" }], [], false, scales);
    expect(v.lines[0]!.flags).toContain("short_received");
  });

  it("24 each received against 2 cases ordered is not short", () => {
    const v = buildThreeWayLines(snap(2), [{ skuId: "x", qty: 24, level: "each" }], [], false, scales);
    expect(v.lines[0]!.flags).not.toContain("short_received");
  });

  it("12 each billed against 1 case received is not billed over received", () => {
    const v = buildThreeWayLines(snap(1), [{ skuId: "x", qty: 1, level: "case" }], inv(12, "EA"), true, scales);
    expect(v.lines[0]!.flags).toEqual([]);
    expect(v.lines[0]!.billedUnit).toBe("EA");
  });

  it("2 cases billed against 12 each received is billed over received", () => {
    const v = buildThreeWayLines(snap(1), [{ skuId: "x", qty: 12, level: "each" }], inv(2, "CS"), true, scales);
    expect(v.lines[0]!.flags).toContain("billed_over_received");
  });

  it("an unknown billed unit (or lb on a count chain) leaves the flag off", () => {
    for (const unit of [null, "LB", "pallet"]) {
      const v = buildThreeWayLines(snap(1), [{ skuId: "x", qty: 1, level: "case" }], inv(40, unit), true, scales);
      expect(v.lines[0]!.flags).not.toContain("billed_over_received");
    }
  });

  it("a SKU with no scale compares only the same unit on both sides (W04 r1: an unknown invoice unit is advisory-null)", () => {
    const v = buildThreeWayLines(snap(4), [{ skuId: "x", qty: 2, level: null }], inv(5, null), true);
    expect(v.lines[0]!.flags).toEqual(["short_received"]);
  });
});
