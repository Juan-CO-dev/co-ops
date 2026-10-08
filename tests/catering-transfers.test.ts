import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/roles";
import { canTransferCatering, validTransferReason, shouldKeepManualLocation } from "@/lib/catering/transfers-shared";

describe("catering transfer authority and evidence", () => {
  it("admits catering manager and level 8+, excluding peer managers and GM", () => {
    expect(Object.values(ROLES).filter((role) => canTransferCatering(role.code)).map((role) => role.code))
      .toEqual(["cgs", "owner", "moo", "catering_mgr"]);
  });
  it("requires bounded other explanation and closed reasons", () => {
    expect(validTransferReason("other", "  ")).toBe(false);
    expect(validTransferReason("other", "Customer requested change")).toBe(true);
    expect(validTransferReason("capacity", null)).toBe(true);
    expect(validTransferReason("unknown", "reason")).toBe(false);
    expect(validTransferReason("other", "x".repeat(1001))).toBe(false);
  });
  it("preserves newer manual assignment, including equality and missing evidence", () => {
    expect(shouldKeepManualLocation("2026-10-08T12:00:00Z", "2026-10-08T11:00:00Z")).toBe(true);
    expect(shouldKeepManualLocation("2026-10-08T12:00:00Z", "2026-10-08T12:00:00Z")).toBe(true);
    expect(shouldKeepManualLocation("2026-10-08T12:00:00Z", null)).toBe(true);
    expect(shouldKeepManualLocation("2026-10-08T12:00:00Z", "2026-10-08T13:00:00Z")).toBe(false);
    expect(shouldKeepManualLocation(null, "2026-10-08T13:00:00Z")).toBe(false);
  });
});
