/**
 * Unit spine — lib/roles.ts authorization primitives (pure).
 * Pins: the strict-greater canActOn law (admin cannot act on peer/senior),
 * the universal 4-digit PIN lock, level ordering sanity.
 */
import { describe, it, expect } from "vitest";
import { ROLES, getRoleLevel, canActOn, minPinLength, type RoleCode } from "@/lib/roles";

describe("canActOn — strict-greater law", () => {
  it("higher level acts on lower", () => {
    expect(canActOn("cgs", "gm")).toBe(true);
    expect(canActOn("gm", "shift_lead")).toBe(true);
  });

  it("NEVER on a peer at the same level (the admin-peer rule)", () => {
    for (const a of Object.keys(ROLES) as RoleCode[]) {
      for (const b of Object.keys(ROLES) as RoleCode[]) {
        if (getRoleLevel(a) === getRoleLevel(b)) {
          expect(canActOn(a, b)).toBe(false);
        }
      }
    }
  });

  it("never upward, and never on self", () => {
    expect(canActOn("gm", "cgs")).toBe(false);
    for (const r of Object.keys(ROLES) as RoleCode[]) {
      expect(canActOn(r, r)).toBe(false);
    }
  });
});

describe("role registry invariants", () => {
  it("minPinLength is 4 for every role (Toast/7shifts parity — locked Phase 2 S1)", () => {
    for (const r of Object.keys(ROLES) as RoleCode[]) {
      expect(minPinLength(r)).toBe(4);
    }
  });

  it("cgs sits at the top (10); prospect is the floor (0); no negatives", () => {
    const levels = (Object.keys(ROLES) as RoleCode[]).map(getRoleLevel);
    expect(Math.max(...levels)).toBe(getRoleLevel("cgs"));
    expect(getRoleLevel("cgs")).toBe(10);
    expect(getRoleLevel("prospect")).toBe(0);
    for (const l of levels) expect(l).toBeGreaterThanOrEqual(0);
  });

  it("all-locations threshold (9) semantics: owner+cgs clear it; moo+gm do not", () => {
    // lib/locations.ts ALL_LOCATIONS_THRESHOLD = 9 (company-level vs location-scoped).
    expect(getRoleLevel("cgs")).toBeGreaterThanOrEqual(9);
    expect(getRoleLevel("owner")).toBeGreaterThanOrEqual(9);
    expect(getRoleLevel("moo")).toBeLessThan(9);
    expect(getRoleLevel("gm")).toBeLessThan(9);
  });

  it("the ladder as renumbered: gm=7, agm-tier=6, SL=5, KH/trainer=4, employee=3", () => {
    expect(getRoleLevel("gm")).toBe(7);
    expect(getRoleLevel("agm")).toBe(6);
    expect(getRoleLevel("shift_lead")).toBe(5);
    expect(getRoleLevel("key_holder")).toBe(4);
    expect(getRoleLevel("trainer")).toBe(4);
    expect(getRoleLevel("employee")).toBe(3);
  });
});
