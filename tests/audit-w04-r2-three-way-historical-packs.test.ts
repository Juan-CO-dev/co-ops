import { describe, expect, it } from "vitest";
import { buildThreeWayLines, legScalesFromPacks, unitScaleFromChain } from "@/lib/po-match-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { ResolvedPack } from "@/lib/sku-versions-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

/**
 * Audit W04 fix round 2 (B045). Each leg of a three-way match is read through the pack in force when
 * THAT leg happened (order at confirm, receipt at the door, invoice when it arrived), never through
 * today's pack. Reviewer repro: one 12-bottle case ordered, 12 bottles received, one case billed is a
 * clean match. Reopening that PO after the case became 24 bottles must still be a clean match (no
 * false short_received / billed_over_received). When a leg's pack cannot be established the
 * comparison is suppressed, never flagged.
 */
const measures = new Map<string, MeasureUnitFactor>([
  ["fl oz", { dimension: "volume", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["count", { dimension: "count", toBaseFactor: 1 }],
]);
const bottles = (perCase: number): PackChainLevel[] => [
  { id: `case${perCase}`, label: "case", containsQty: perCase, containsLevelId: `bottle${perCase}`, containsMeasureUnit: null, displayOrdinal: 0 },
  { id: `bottle${perCase}`, label: "bottle", containsQty: 16.9, containsLevelId: null, containsMeasureUnit: "fl oz", displayOrdinal: 1 },
];
const packOf = (levels: PackChainLevel[]): ResolvedPack => ({ levels, versionId: "v", locationId: null, effectiveFrom: "2026-01-01T00:00:00Z" });

const snap = (qty: number, unitLabel = "case") => [{ skuId: "x", name: "Water", itemNumber: null, qty, unitLabel, priceCents: null }];
const recv = (qty: number, level: string | null) => [{ skuId: "x", qty, level }];
const inv = (qty: number, unit: string) => [{ description: "Water", qty, unit, unitPriceCents: null, extendedCents: 2400 }];

describe("W04 r2: reopening an old PO after a pack edit", () => {
  it("today's 24-bottle case is what produced the false flags (the bug, on the current-pack path)", () => {
    const today = unitScaleFromChain(bottles(24), measures)!;
    const flags = buildThreeWayLines(snap(1), recv(12, "bottle"), inv(1, "CS"), true, new Map([["x", today]])).lines[0]!.flags;
    expect(flags).toEqual(["billed_over_received", "short_received"]);
  });

  it("each leg read at its own time (all 12-bottle) is a clean match after the case became 24", () => {
    const legs = legScalesFromPacks({
      versioned: true, current: bottles(24),
      ordered: packOf(bottles(12)), received: packOf(bottles(12)), billed: packOf(bottles(12)),
    }, measures);
    const flags = buildThreeWayLines(snap(1), recv(12, "bottle"), inv(1, "CS"), true, new Map([["x", legs!]])).lines[0]!.flags;
    expect(flags).toEqual([]);
  });

  it("an order placed under the 12-bottle case and received after the change compares in bottles", () => {
    const legs = legScalesFromPacks({
      versioned: true, current: bottles(24),
      ordered: packOf(bottles(12)), received: packOf(bottles(24)), billed: packOf(bottles(24)),
    }, measures)!;
    // 2 cases of 12 ordered = 24 bottles; 1 case of 24 received = 24 bottles; 1 case of 24 billed.
    expect(buildThreeWayLines(snap(2), recv(1, "case"), inv(1, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual([]);
    // 3 cases of 12 ordered = 36 bottles against 24 received is genuinely short.
    expect(buildThreeWayLines(snap(3), recv(1, "case"), inv(1, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual(["short_received"]);
  });

  it("a real over-bill under the historical pack still flags", () => {
    const legs = legScalesFromPacks({
      versioned: true, current: bottles(24),
      ordered: packOf(bottles(12)), received: packOf(bottles(12)), billed: packOf(bottles(12)),
    }, measures)!;
    expect(buildThreeWayLines(snap(1), recv(12, "bottle"), inv(2, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual(["billed_over_received"]);
  });
});

describe("W04 r2: a leg whose historical units cannot be established compares nothing", () => {
  it("no pack in force at the order's time suppresses short_received", () => {
    const legs = legScalesFromPacks({ versioned: true, current: bottles(24), ordered: undefined, received: packOf(bottles(12)), billed: packOf(bottles(12)) }, measures)!;
    const flags = buildThreeWayLines(snap(5), recv(12, "bottle"), inv(1, "CS"), true, new Map([["x", legs]])).lines[0]!.flags;
    expect(flags).not.toContain("short_received");
    expect(flags).toEqual([]);
  });

  it("no pack in force at the invoice's time suppresses billed_over_received, even in the same unit", () => {
    const legs = legScalesFromPacks({ versioned: true, current: bottles(24), ordered: packOf(bottles(12)), received: packOf(bottles(12)), billed: undefined }, measures)!;
    expect(buildThreeWayLines(snap(1), recv(1, "case"), inv(9, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual([]);
  });

  it("legs whose leaves cannot be related (weight then, count now) compare nothing", () => {
    const weightCase: PackChainLevel[] = [{ id: "c", label: "case", containsQty: 30, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
    const countCase: PackChainLevel[] = [{ id: "c2", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "count", displayOrdinal: 0 }];
    const legs = legScalesFromPacks({ versioned: true, current: countCase, ordered: packOf(weightCase), received: packOf(countCase), billed: packOf(countCase) }, measures)!;
    expect(buildThreeWayLines(snap(4), recv(1, "case"), inv(1, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual([]);
  });

  it("a leaf that changed size relates through its measure (single-level count case 12 -> 24)", () => {
    const c12: PackChainLevel[] = [{ id: "a", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "count", displayOrdinal: 0 }];
    const c24: PackChainLevel[] = [{ id: "b", label: "case", containsQty: 24, containsLevelId: null, containsMeasureUnit: "count", displayOrdinal: 0 }];
    const legs = legScalesFromPacks({ versioned: true, current: c24, ordered: packOf(c12), received: packOf(c12), billed: packOf(c12) }, measures)!;
    expect(buildThreeWayLines(snap(1), recv(12, "ea"), inv(1, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual([]);
  });

  it("a pre-chain flat baseline answers for its leg", () => {
    const baseline: ResolvedPack = { levels: [], versionId: "b", locationId: null, effectiveFrom: "2025-01-01T00:00:00Z",
      flat: { pack_format: "case", each_container_label: "bottle", units_per_pack: 12, each_size: 16.9, each_measure: "fl oz" } };
    const legs = legScalesFromPacks({ versioned: true, current: bottles(24), ordered: baseline, received: baseline, billed: baseline }, measures)!;
    expect(buildThreeWayLines(snap(1), recv(12, "bottle"), inv(1, "CS"), true, new Map([["x", legs]])).lines[0]!.flags).toEqual([]);
  });
});

describe("W04 r2: a never-versioned SKU keeps its one current pack for every leg", () => {
  it("compares through the current chain", () => {
    const scale = legScalesFromPacks({ versioned: false, current: bottles(12), ordered: undefined, received: undefined, billed: undefined }, measures)!;
    expect(buildThreeWayLines(snap(1), recv(12, "bottle"), inv(1, "CS"), true, new Map([["x", scale]])).lines[0]!.flags).toEqual([]);
    expect(buildThreeWayLines(snap(2), recv(12, "bottle"), inv(1, "CS"), true, new Map([["x", scale]])).lines[0]!.flags).toEqual(["short_received"]);
  });
  it("with no pack at all it returns nothing (same-unit compare only, as before)", () => {
    expect(legScalesFromPacks({ versioned: false, current: null, ordered: undefined, received: undefined, billed: undefined }, measures)).toBeNull();
  });
});
