/**
 * The resolution ladder (spec 2026-08-20, "Resolution"). ONE pure function decides
 * which member SKU a product means, and costing / depletion / production / ordering
 * all ask THIS one — never four private opinions.
 *
 *   (1) the location-flagged primary, if active
 *   (2) else the most-recently-RECEIVED active member
 *   (3) else any active member (stable tiebreak)
 *   (4) else honest `unresolved`
 */
import { describe, it, expect } from "vitest";
import { resolveProductMember, type ProductMember } from "@/lib/products-shared";

const member = (over: Partial<ProductMember> & { skuId: string }): ProductMember => ({
  vendorId: null,
  vendorName: null,
  active: true,
  avgOzPerEach: null,
  lastReceivedAt: null,
  ...over,
});

describe("resolveProductMember", () => {
  it("(1) the flagged primary wins when active", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "pfg",
      members: [member({ skuId: "baldor", lastReceivedAt: "2026-08-19T00:00:00Z" }), member({ skuId: "pfg" })],
    });
    expect(r).toEqual({ productId: "P", skuId: "pfg", rung: "primary", consideredSkuIds: ["baldor", "pfg"] });
  });

  it("(1) is SKIPPED when the flagged primary is inactive — it falls through, never fails", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "pfg",
      members: [
        member({ skuId: "pfg", active: false }),
        member({ skuId: "baldor", lastReceivedAt: "2026-08-19T00:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("baldor");
    expect(r.rung).toBe("recent");
  });

  it("(1) is SKIPPED when the flagged primary is not a member at all", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "ghost",
      members: [member({ skuId: "baldor" })],
    });
    expect(r.skuId).toBe("baldor");
    expect(r.rung).toBe("any");
  });

  it("(2) most-recently-RECEIVED active member, not most-recently-created", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [
        member({ skuId: "a", lastReceivedAt: "2026-08-01T00:00:00Z" }),
        member({ skuId: "b", lastReceivedAt: "2026-08-18T09:00:00Z" }),
        member({ skuId: "c", lastReceivedAt: "2026-08-18T08:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("b");
    expect(r.rung).toBe("recent");
  });

  it("(2) ignores INACTIVE members even when they were received most recently", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [
        member({ skuId: "dead", active: false, lastReceivedAt: "2026-08-20T00:00:00Z" }),
        member({ skuId: "live", lastReceivedAt: "2026-08-01T00:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("live");
  });

  it("(3) any active member when nothing was ever received — and the pick is STABLE", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [member({ skuId: "zeta" }), member({ skuId: "alpha" })],
    });
    expect(r.skuId).toBe("alpha");
    expect(r.rung).toBe("any");
    const flipped = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [member({ skuId: "alpha" }), member({ skuId: "zeta" })],
    });
    expect(flipped.skuId).toBe("alpha");
  });

  it("(3) breaks a received-at TIE on skuId rather than on row order", () => {
    const at = "2026-08-18T00:00:00Z";
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [member({ skuId: "zeta", lastReceivedAt: at }), member({ skuId: "alpha", lastReceivedAt: at })],
    });
    expect(r.skuId).toBe("alpha");
    expect(r.rung).toBe("recent");
  });

  it("(4) every member inactive -> unresolved, NOT a silent pick", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "a",
      members: [member({ skuId: "a", active: false }), member({ skuId: "b", active: false })],
    });
    expect(r).toEqual({ productId: "P", skuId: null, rung: "unresolved", consideredSkuIds: ["a", "b"] });
  });

  it("(4) no members at all -> unresolved", () => {
    const r = resolveProductMember({ productId: "P", primarySkuId: null, members: [] });
    expect(r.skuId).toBeNull();
    expect(r.rung).toBe("unresolved");
  });

  it("an unparseable lastReceivedAt is treated as NEVER received, never as now", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [
        member({ skuId: "bad", lastReceivedAt: "not-a-date" }),
        member({ skuId: "good", lastReceivedAt: "2026-01-01T00:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("good");
  });
});

import { productInputBasis, membersDisagreeOnUnitOz } from "@/lib/products-shared";
import { ozForRecipeInput, type MeasureUnitFactor } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["unit", { dimension: "count", toBaseFactor: 1 }],
]);

describe("productInputBasis (deviation D3 — measure-registry only)", () => {
  it("a count-denominated line reads the PRODUCT's unit_oz, not the member's", () => {
    const basis = productInputBasis(
      { productId: "P", unitOz: 1.2 },
      member({ skuId: "pfg", avgOzPerEach: null }),
    );
    expect(ozForRecipeInput(1, "unit", basis, measures)).toBe(1.2);
  });

  it("REGRESSION (seed 18): flipping the resolved member does NOT change the line's oz", () => {
    const product = { productId: "P", unitOz: 1.2 };
    const onBaldor = productInputBasis(product, member({ skuId: "baldor", avgOzPerEach: 1.2 }));
    const onPfg = productInputBasis(product, member({ skuId: "pfg", avgOzPerEach: null }));
    expect(ozForRecipeInput(1, "unit", onBaldor, measures))
      .toBe(ozForRecipeInput(1, "unit", onPfg, measures));
  });

  it("falls back to the member's avg_oz_per_each only when the product is unweighed", () => {
    const basis = productInputBasis({ productId: "P", unitOz: null }, member({ skuId: "b", avgOzPerEach: 1.2 }));
    expect(basis.avgOzPerEach).toBe(1.2);
  });

  it("a weight-denominated line is member-independent regardless", () => {
    const basis = productInputBasis({ productId: "P", unitOz: null }, null);
    expect(ozForRecipeInput(3, "oz", basis, measures)).toBe(3);
  });

  it("a PACK label refuses — 'case' is a per-vendor spelling a product cannot own", () => {
    const basis = productInputBasis({ productId: "P", unitOz: 1.2 }, member({ skuId: "b", avgOzPerEach: 1.2 }));
    expect(ozForRecipeInput(1, "case", basis, measures)).toBeNull();
  });

  it("unweighed product + no member weight -> null, never 0", () => {
    const basis = productInputBasis({ productId: "P", unitOz: null }, member({ skuId: "b", avgOzPerEach: null }));
    expect(ozForRecipeInput(1, "unit", basis, measures)).toBeNull();
  });
});

describe("membersDisagreeOnUnitOz", () => {
  it("1.2 vs 1.0 disagree", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "b", avgOzPerEach: 1.0 }),
    ])).toBe(true);
  });
  it("one known value cannot disagree with an unknown one", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "b", avgOzPerEach: null }),
    ])).toBe(false);
  });
  it("inactive members do not vote", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "dead", active: false, avgOzPerEach: 5 }),
    ])).toBe(false);
  });
  it("rounding-scale differences do not count as disagreement", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "b", avgOzPerEach: 1.21 }),
    ])).toBe(false);
  });
});
