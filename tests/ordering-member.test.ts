import { describe, expect, it } from "vitest";
import { orderableMemberRole } from "@/lib/ordering-member-shared";
import type { ProductMember } from "@/lib/products-shared";

const member = (skuId: string, patch: Partial<ProductMember> = {}): ProductMember => ({
  skuId, vendorId: skuId, vendorName: skuId, active: true, avgOzPerEach: 1,
  lastReceivedAt: null, sourceKind: "vendor", ...patch,
});

describe("orderable member badges", () => {
  it("keeps an implicit singleton solo and its newly grouped reference primary", () => {
    expect(orderableMemberRole("reference", null)).toBe("solo");
    const product = { primarySkuId: null, members: [member("reference"), member("store", { sourceKind: "store" })] };
    expect(orderableMemberRole("reference", product)).toBe("primary");
    expect(orderableMemberRole("store", product)).toBe("backup");
  });
  it("ignores inactive, pending and vendorless members when counting suppliers", () => {
    expect(orderableMemberRole("reference", { primarySkuId: "inactive", members: [
      member("reference"), member("inactive", { active: false }),
      member("pending", { pendingReview: true }), member("manual", { vendorId: null }),
      member("retired-vendor", { vendorActive: false }),
    ] })).toBe("primary");
  });
  it("preserves primary/backup distinction for two orderable regular vendors", () => {
    const product = { primarySkuId: "a", members: [member("a"), member("b")] };
    expect(orderableMemberRole("a", product)).toBe("primary");
    expect(orderableMemberRole("b", product)).toBe("backup");
  });
});
