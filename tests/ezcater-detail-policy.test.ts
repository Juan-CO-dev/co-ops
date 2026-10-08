import { describe, expect, it } from "vitest";
import { canReadCateringContact } from "@/lib/catering/ezcater-detail-shared";
import type { RoleCode } from "@/lib/roles";

describe("ezCater existing catering contact policy", () => {
  const actor = (role: RoleCode, active = true) => ({ role, active, locations: ["shop-a"] });
  it("allows shift leads at their shop, not a different shop or lower roles", () => {
    expect(canReadCateringContact(actor("shift_lead"), "shop-a")).toBe(true);
    expect(canReadCateringContact(actor("shift_lead"), "shop-b")).toBe(false);
    expect(canReadCateringContact(actor("key_holder"), "shop-a")).toBe(false);
    expect(canReadCateringContact(actor("gm"), "shop-b")).toBe(false);
  });
  it("allows catering manager and level 8 across shops, refuses inactive users", () => {
    for (const role of ["catering_mgr", "moo", "owner", "cgs"] as const) {
      expect(canReadCateringContact(actor(role), "shop-b")).toBe(true);
      expect(canReadCateringContact(actor(role, false), "shop-a")).toBe(false);
    }
  });
});
