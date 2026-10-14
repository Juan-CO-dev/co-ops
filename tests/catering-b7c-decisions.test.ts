/**
 * B7c · Catering owner decisions (Juan, 2026-10-13): D-45 … D-49.
 * Pure helpers are unit-tested here; lib/route behaviour lives in
 * tests/catering-b7c-behaviour.test.ts (in-memory Supabase fake).
 */
import { describe, expect, it } from "vitest";
import {
  expandPackageLines,
  packageHeadcountMultiplier,
  type ExpandablePackage,
} from "@/lib/catering/quotes-shared";

// ── D-45 · per-head package Qty defaults to the headcount ───────────────────────────────
const lightLunch: ExpandablePackage = {
  id: "pkg-ll",
  labelEn: "Light Lunch",
  pricingMode: "per_head",
  priceCents: 1200,
  items: [{ itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 }],
};
const platter16: ExpandablePackage = {
  id: "pkg-16",
  labelEn: "16 pc platter",
  pricingMode: "per_platter",
  priceCents: 11500,
  items: [{ itemId: null, menuItemId: null, label: "Choose your subs", quantity: 16, unitPriceCents: 0 }],
};

describe("D-45 · per-head package Qty = headcount", () => {
  it("the multiplier is the headcount only for a per-head package with a whole headcount > 0", () => {
    expect(packageHeadcountMultiplier("per_head", "20")).toBe(20);
    expect(packageHeadcountMultiplier("per_head", " 7 ")).toBe(7);
    expect(packageHeadcountMultiplier("per_head", "")).toBe(1);
    expect(packageHeadcountMultiplier("per_head", "0")).toBe(1);
    expect(packageHeadcountMultiplier("per_head", "2.5")).toBe(1);
    expect(packageHeadcountMultiplier("per_head", "abc")).toBe(1);
    expect(packageHeadcountMultiplier("per_platter", "20")).toBe(1);
    expect(packageHeadcountMultiplier("fixed", "20")).toBe(1);
  });

  it("Light Lunch for 20 drops in at Qty 20 (the priced line and the pick line)", () => {
    const lines = expandPackageLines(lightLunch, "20");
    expect(lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ["Light Lunch", "20", "12"],
      ["Choose your sub", "20", ""],
    ]);
  });

  it("under a priced package line, the pick lines are display only (no package id, no reference)", () => {
    for (const pkg of [lightLunch, platter16]) {
      const [whole, ...picks] = expandPackageLines(pkg, "20");
      expect(whole).toMatchObject({ packageId: pkg.id, itemId: null, menuItemId: null });
      for (const p of picks) expect(p).toMatchObject({ packageId: null, itemId: null, menuItemId: null, unitPrice: "" });
    }
  });

  it("with no headcount yet, a per-head package still drops in at Qty 1", () => {
    expect(expandPackageLines(lightLunch, "").map((l) => l.quantity)).toEqual(["1", "1"]);
  });

  it("a fixed-count platter keeps its own count whatever the headcount", () => {
    const lines = expandPackageLines(platter16, "20");
    expect(lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ["16 pc platter", "1", "115"],
      ["Choose your subs", "16", ""],
    ]);
  });

  it("a per-head package with priced composition scales every line per person", () => {
    const boxed: ExpandablePackage = {
      id: "pkg-box",
      labelEn: "Boxed",
      pricingMode: "per_head",
      priceCents: 1500,
      items: [
        { itemId: null, menuItemId: "m-sub", label: "Sub", quantity: 1, unitPriceCents: 1000 },
        { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 0.5, unitPriceCents: 200 },
      ],
    };
    expect(expandPackageLines(boxed, "12").map((l) => [l.description, l.quantity, l.unitPrice, l.packageId])).toEqual([
      ["Sub", "12", "10", "pkg-box"],
      ["Chips", "6", "2", "pkg-box"],
    ]);
  });

  it("a per-head package with no composition is one priced line at the headcount", () => {
    const bare: ExpandablePackage = { id: "p", labelEn: "Bare", pricingMode: "per_head", priceCents: 900, items: [] };
    expect(expandPackageLines(bare, "15")).toEqual([
      { description: "Bare", quantity: "15", unitPrice: "9", itemId: null, menuItemId: null, packageId: "p" },
    ]);
  });
});
