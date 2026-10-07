import { describe, expect, it } from "vitest";
import { storeRootPackPrice, receivingPriceRows } from "@/lib/receiving-shared";
import { skuCostPerOz } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

const levels: PackChainLevel[] = [
  { id: "case", label: "case", containsQty: 4, containsLevelId: "jug", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "jug", label: "1 gal", containsQty: 1, containsLevelId: null, containsMeasureUnit: "gal", displayOrdinal: 1 },
];
describe("store received-level prices", () => {
  it("records a $6 gallon as $24 per four-gallon root pack", () => {
    const root = storeRootPackPrice(6, "1 gal", levels, "case");
    expect(root).toBe(24);
    expect(receivingPriceRows([{ skuId: "store-copy", unitPrice: root }], "2026-10-07", "actor", "store"))
      .toEqual([{ vendor_item_id: "store-copy", unit_price: 24, effective_date: "2026-10-07", recorded_by: "actor", source: "store_run" }]);
    // Known measured mass, not an assumption that liquid volume is food weight.
    expect(skuCostPerOz(root, 400)).toBe(0.06);
  });
  it("preserves root and count-only pending prices", () => {
    expect(storeRootPackPrice(24, "case", levels, "case")).toBe(24);
    expect(storeRootPackPrice(24, null, levels, "case")).toBe(24);
    expect(storeRootPackPrice(6, null, null, "jar")).toBe(6);
  });
  it("refuses unknown labels, bad chains, and nonfinite prices", () => {
    expect(storeRootPackPrice(6, "bottle", levels, "case")).toBeNull();
    expect(storeRootPackPrice(6, "each", null, "case")).toBeNull();
    expect(storeRootPackPrice(6, "1 gal", [levels[0]!], "case")).toBeNull();
    expect(storeRootPackPrice(6, "1 gal", [{ ...levels[0]!, containsQty: 0 }, levels[1]!], "case")).toBeNull();
    expect(storeRootPackPrice(Infinity, "case", levels, "case")).toBeNull();
  });
});
