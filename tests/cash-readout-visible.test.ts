import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { applyDenominationInput, cashReadoutVisible } from "@/lib/cash-shared";

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

describe("a legitimately counted $0 drawer (review P3)", () => {
  const d = { projected: "500", mode: "denomination" as const, handTotal: "", denoms: {} };
  it("typed zeroes count as an answer even though denoms never stores them", () => {
    expect(cashReadoutVisible(d)).toBe(false);
    expect(cashReadoutVisible({ ...d, enteredDenoms: ["2000"] })).toBe(true);
  });
  it("applyDenominationInput remembers a typed 0 without storing it", () => {
    const r = applyDenominationInput({}, [], "2000", "0");
    expect(r).toEqual({ denoms: {}, entered: ["2000"] });
    expect(cashReadoutVisible({ ...d, denoms: r.denoms, enteredDenoms: r.entered })).toBe(true);
  });
  it("clearing the field makes it untouched again", () => {
    const typed = applyDenominationInput({}, [], "2000", "0");
    const cleared = applyDenominationInput(typed.denoms, typed.entered, "2000", "");
    expect(cleared).toEqual({ denoms: {}, entered: [] });
    expect(cashReadoutVisible({ ...d, denoms: cleared.denoms, enteredDenoms: cleared.entered })).toBe(false);
  });
  it("positive counts store and track once; negatives are stripped; zero removes the stored count", () => {
    const a = applyDenominationInput({}, [], "500", "3");
    expect(a).toEqual({ denoms: { "500": 3 }, entered: ["500"] });
    expect(applyDenominationInput(a.denoms, a.entered, "500", "-4")).toEqual({ denoms: { "500": 4 }, entered: ["500"] });
    expect(applyDenominationInput(a.denoms, a.entered, "500", "0")).toEqual({ denoms: {}, entered: ["500"] });
    expect(applyDenominationInput(a.denoms, a.entered, "500", "2.9")).toEqual({ denoms: { "500": 2 }, entered: ["500"] });
  });
  it("a hand-total 0 already counts (non-empty string)", () => {
    expect(cashReadoutVisible({ projected: "500", mode: "hand", handTotal: "0", denoms: {} })).toBe(true);
  });
});

describe("cash-client gates the readout on cashReadoutVisible", () => {
  const src = readFileSync("app/(authed)/cash/cash-client.tsx", "utf8");
  it("wraps the deposit/over-short line", () => {
    expect(src).toMatch(/cashReadoutVisible\(\{ projected, mode, handTotal, denoms, enteredDenoms \}\) \? \(/);
    const at = src.indexOf("cashReadoutVisible({ projected");
    expect(src.slice(at, at + 400)).toContain("cash.readout.deposit");
  });
});
