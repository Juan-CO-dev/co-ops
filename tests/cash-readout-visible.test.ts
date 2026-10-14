import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { cashReadoutVisible } from "@/lib/cash-shared";

// B3 / #59: the cash page showed "Deposit -$200.00 - $200.00 short" before the
// closer had typed anything.
describe("cashReadoutVisible", () => {
  const base = { projected: "", mode: "hand" as const, handTotal: "", denoms: {} };

  it("is hidden on a fresh form", () => {
    expect(cashReadoutVisible(base)).toBe(false);
    expect(cashReadoutVisible({ ...base, mode: "denomination" })).toBe(false);
  });

  it("is hidden until BOTH projected and a drawer figure exist (hand)", () => {
    expect(cashReadoutVisible({ ...base, projected: "500" })).toBe(false);
    expect(cashReadoutVisible({ ...base, handTotal: "700" })).toBe(false);
    expect(cashReadoutVisible({ ...base, projected: "500", handTotal: "700" })).toBe(true);
  });

  it("treats whitespace as empty", () => {
    expect(cashReadoutVisible({ ...base, projected: "  ", handTotal: "700" })).toBe(false);
    expect(cashReadoutVisible({ ...base, projected: "500", handTotal: " " })).toBe(false);
  });

  it("a typed zero counts as entered (an honest empty drawer)", () => {
    expect(cashReadoutVisible({ ...base, projected: "0", handTotal: "0" })).toBe(true);
  });

  it("denomination mode needs projected plus at least one counted denomination", () => {
    const d = { ...base, mode: "denomination" as const, projected: "500" };
    expect(cashReadoutVisible(d)).toBe(false);
    expect(cashReadoutVisible({ ...d, denoms: { "2000": 3 } })).toBe(true);
  });

  it("ignores the hand total while in denomination mode (and vice versa)", () => {
    expect(
      cashReadoutVisible({ ...base, mode: "denomination", projected: "500", handTotal: "700" }),
    ).toBe(false);
    expect(
      cashReadoutVisible({ ...base, mode: "hand", projected: "500", denoms: { "2000": 3 } }),
    ).toBe(false);
  });
});

describe("cash-client gates the readout on cashReadoutVisible", () => {
  const src = readFileSync("app/(authed)/cash/cash-client.tsx", "utf8");
  it("wraps the deposit/over-short line", () => {
    expect(src).toMatch(/cashReadoutVisible\(\{ projected, mode, handTotal, denoms \}\) \? \(/);
    const at = src.indexOf("cashReadoutVisible({ projected");
    expect(src.slice(at, at + 400)).toContain("cash.readout.deposit");
  });
});
