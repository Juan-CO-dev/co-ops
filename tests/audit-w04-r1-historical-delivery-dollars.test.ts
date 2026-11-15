import { describe, expect, it } from "vitest";
import { receivedLineContribution, rootConversionOf, type ReceivedLineFacts } from "@/lib/admin/cost-shared";
import { resolvePacksAtPoints, type ScopedLevelRow, type ScopedVersionRow } from "@/lib/sku-versions-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

/**
 * Audit W04 fix round 1 (B043). Two bags received at a $60/case frozen line price when the case held
 * 6 x 80 oz (480 oz) are $20 of a case. That must stay $20 when TODAY's case is 4 bags (320 oz), and a
 * shop whose own pack is 3 bags (240 oz) received them as two thirds of ITS case ($40), whatever the
 * global default says. The conversion is the one in force at the delivery's shop when the line was written.
 */
const base: ReceivedLineFacts = {
  qty: 2, levelLabel: "bag", resolvedOz: 160, linePrice: 60, currentRootPrice: 48,
  contentOz: 480, rootLabel: "case", receivedRootOz: 480, receivedRootLabel: "case", receivedLevelsPerRoot: 6, priceIsPerLevel: false,
};

describe("W04 r1: a frozen delivery price converts through the pack in force when received", () => {
  it("a later case-size change does not move the historical dollars", () => {
    expect(receivedLineContribution({ ...base, contentOz: 320 })).toEqual({ oz: 160, dollars: 20 });
  });

  it("a shop-specific pack prices the line against that shop's case, not the global default", () => {
    expect(receivedLineContribution({ ...base, receivedRootOz: 240, receivedLevelsPerRoot: 3 })).toEqual({ oz: 160, dollars: 40 });
  });

  it("an inner-level line whose received conversion is unknown is unpriced, never today's guess", () => {
    expect(receivedLineContribution({ ...base, receivedRootOz: null, receivedRootLabel: null, receivedLevelsPerRoot: null })).toEqual({ oz: 160, dollars: null });
  });

  it("an unpriced line is valued at today's price over today's case (one consistent basis)", () => {
    expect(receivedLineContribution({ ...base, linePrice: null, contentOz: 320 })).toEqual({ oz: 160, dollars: 24 });
  });

  it("a root-level line counts whole packs at its own price", () => {
    expect(receivedLineContribution({ ...base, levelLabel: "case", resolvedOz: 960, contentOz: 320 })).toEqual({ oz: 960, dollars: 120 });
  });

  it("a legacy line with no stored oz reads the case size in force then", () => {
    expect(receivedLineContribution({ ...base, levelLabel: null, resolvedOz: null, qty: 1, contentOz: 320 })).toEqual({ oz: 480, dollars: 60 });
  });
});

const measures = new Map<string, MeasureUnitFactor>([["lb", { dimension: "weight", toBaseFactor: 16 }]]);
const level = (version: string, location: string | null, bags: number): ScopedLevelRow[] => [
  { id: `${version}-case`, sku_id: "sku", version_id: version, location_id: location, label: "case", contains_qty: bags, contains_level_id: `${version}-bag`, contains_measure_unit: null, display_ordinal: 0 },
  { id: `${version}-bag`, sku_id: "sku", version_id: version, location_id: location, label: "bag", contains_qty: 5, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1 },
];
const versions: ScopedVersionRow[] = [
  { id: "g1", sku_id: "sku", location_id: null, valid_from: "2026-01-01T00:00:00Z", valid_to: "2026-11-12T00:00:00Z" },
  { id: "g2", sku_id: "sku", location_id: null, valid_from: "2026-11-12T00:00:00Z", valid_to: null },
  { id: "s1", sku_id: "sku", location_id: "shopB", valid_from: "2026-06-01T00:00:00Z", valid_to: null },
];
const levels = [...level("g1", null, 6), ...level("g2", null, 4), ...level("s1", "shopB", 3)];
const flat = { pack_format: "case", eachContainerLabel: "bag", unitsPerPack: 4, eachSize: 5, eachMeasure: "lb", avgOzPerEach: null };

describe("W04 r1: the pack in force at each delivery line, per shop", () => {
  const packs = resolvePacksAtPoints(versions, levels, [
    { key: "before-edit", skuId: "sku", scope: "shopA", asOf: "2026-11-10T15:00:00Z" },
    { key: "after-edit", skuId: "sku", scope: "shopA", asOf: "2026-11-13T15:00:00Z" },
    { key: "shop-b", skuId: "sku", scope: "shopB", asOf: "2026-11-10T15:00:00Z" },
    { key: "before-any", skuId: "sku", scope: "shopA", asOf: "2025-01-01T00:00:00Z" },
  ]);
  it("picks the global version in force at the line's instant", () => {
    expect(rootConversionOf(flat, packs.get("before-edit"), measures, true)).toMatchObject({ rootOz: 480, rootLabel: "case" });
    expect(rootConversionOf(flat, packs.get("before-edit"), measures, true).levelsPerRoot.get("bag")).toBe(6);
    expect(rootConversionOf(flat, packs.get("after-edit"), measures, true)).toMatchObject({ rootOz: 320, rootLabel: "case" });
    expect(rootConversionOf(flat, packs.get("after-edit"), measures, true).levelsPerRoot.get("bag")).toBe(4);
  });
  it("a shop's own version answers for that shop's deliveries", () => {
    expect(rootConversionOf(flat, packs.get("shop-b"), measures, true)).toMatchObject({ rootOz: 240, rootLabel: "case" });
    expect(rootConversionOf(flat, packs.get("shop-b"), measures, true).levelsPerRoot.get("bag")).toBe(3);
  });
  it("before any version of a versioned SKU the conversion is unknown; a never-versioned SKU reads its flat pack", () => {
    expect(packs.has("before-any")).toBe(false);
    expect(rootConversionOf(flat, undefined, measures, true)).toEqual({ rootOz: null, rootLabel: null, levelsPerRoot: new Map() });
    expect(rootConversionOf(flat, undefined, measures, false)).toMatchObject({ rootOz: 320, rootLabel: "case" });
    expect(rootConversionOf(flat, undefined, measures, false).levelsPerRoot.get("bag")).toBe(4);
  });
});
