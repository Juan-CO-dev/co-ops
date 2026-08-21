/**
 * The two-grain model (spec 2026-08-20, "On-hand"): per-SKU ledgers remain the
 * source of truth; the PRODUCT grain is their sum. Juan: "not just 'we have ham' —
 * 300 oz of ham: 200 PFG + 100 Boar's Head."
 *
 * The completeness rule is lifted from MenuCostRollup (lib/menu-costing-shared.ts):
 * `totalOz` is NON-NULL only when EVERY member resolved; `knownOz` is the sum of what
 * we could resolve and is a lower bound, never "the total". A partial sum presented as
 * a total is a fabricated number, which the advisory-null law forbids.
 */
import { describe, it, expect } from "vitest";
import { rollupProductGrain, rollupUsageByProduct } from "@/lib/products-shared";

describe("rollupProductGrain", () => {
  it("sums the members when every one resolved", () => {
    expect(rollupProductGrain({
      productId: "HAM",
      members: [{ skuId: "pfg", oz: 200 }, { skuId: "bh", oz: 100 }],
    })).toEqual({
      productId: "HAM", totalOz: 300, knownOz: 300, knownMemberCount: 2, unknownSkuIds: [],
    });
  });

  it("ONE unresolved member nulls the total but keeps the honest lower bound", () => {
    expect(rollupProductGrain({
      productId: "HAM",
      members: [{ skuId: "pfg", oz: 200 }, { skuId: "bh", oz: null }],
    })).toEqual({
      productId: "HAM", totalOz: null, knownOz: 200, knownMemberCount: 1, unknownSkuIds: ["bh"],
    });
  });

  it("REGRESSION (audit P2): mirrored twin drift NETS at product grain", () => {
    // The live failure: pin dead + receive the other -> A reads OVER, B reads SHORT,
    // and nothing nets them. At product grain the two cancel to the truth.
    const r = rollupProductGrain({
      productId: "HAM",
      members: [{ skuId: "dead-pin", oz: 140 }, { skuId: "really-bought", oz: -40 }],
    });
    expect(r.totalOz).toBe(100);
  });

  it("no members -> total null, not 0", () => {
    expect(rollupProductGrain({ productId: "X", members: [] })).toEqual({
      productId: "X", totalOz: null, knownOz: 0, knownMemberCount: 0, unknownSkuIds: [],
    });
  });

  it("unknownSkuIds is sorted, so the UI names them in a stable order", () => {
    const r = rollupProductGrain({
      productId: "X",
      members: [{ skuId: "zeta", oz: null }, { skuId: "alpha", oz: null }],
    });
    expect(r.unknownSkuIds).toEqual(["alpha", "zeta"]);
  });

  it("a non-finite member oz is treated as UNKNOWN, never summed", () => {
    const r = rollupProductGrain({
      productId: "X",
      members: [{ skuId: "a", oz: 10 }, { skuId: "b", oz: Number.NaN }],
    });
    expect(r.totalOz).toBeNull();
    expect(r.knownOz).toBe(10);
    expect(r.unknownSkuIds).toEqual(["b"]);
  });
});

describe("rollupUsageByProduct (deviation D9)", () => {
  it("members SHARE the product's summed usage, so a backup no longer sorts last", () => {
    const out = rollupUsageByProduct(
      new Map([["pfg", 900]]),                      // all usage on the pinned twin
      new Map([["pfg", "HAM"], ["baldor", "HAM"]]), // both are HAM
    );
    expect(out.get("pfg")).toBe(900);
    expect(out.get("baldor")).toBe(900);
  });

  it("a productless SKU keeps its own usage untouched", () => {
    const out = rollupUsageByProduct(new Map([["solo", 12]]), new Map());
    expect(out.get("solo")).toBe(12);
  });

  it("a product with ZERO total leaves its members ABSENT, so `?? -Infinity` still sorts them last", () => {
    const out = rollupUsageByProduct(new Map(), new Map([["a", "P"], ["b", "P"]]));
    expect(out.has("a")).toBe(false);
    expect(out.has("b")).toBe(false);
  });

  it("does not mutate the input map", () => {
    const src = new Map([["pfg", 900]]);
    rollupUsageByProduct(src, new Map([["pfg", "HAM"], ["baldor", "HAM"]]));
    expect(src.has("baldor")).toBe(false);
  });
});
