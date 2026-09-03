// Order-builder section ordering (lib/portal/menu-order-shared.ts).
//
// Juan's rules (2026-09-03, first-live test):
//  1. Customers pick PACKAGES first, then DRINKS, then SIDES, then DESSERTS, and à la carte
//     (subs / build-your-own / everything else) last.
//  2. Toast's split headings ("Drinks" vs "Catering Drinks", "Sides" vs "Catering Sides" vs
//     "Chips") merge into ONE section per type on the portal — no catalog edits, Toast names
//     untouched. Mains keep their own headings.
//  3. Inside a merged section the catering-size rows (catering_only) sit on top; à la carte
//     singles underneath.
import { describe, expect, it } from "vitest";
import { catForSection, orderSections, orderWithinSection, sectionLabel, SECTION_RANK } from "@/lib/portal/menu-order-shared";

describe("catForSection", () => {
  it("classifies the live section headings", () => {
    expect(catForSection("Drinks")).toBe("drink");
    expect(catForSection("Catering Drinks")).toBe("drink");
    expect(catForSection("Sides")).toBe("side");
    expect(catForSection("Catering Sides")).toBe("side");
    expect(catForSection("Chips")).toBe("side");
    expect(catForSection("Sweets")).toBe("sweet");
    expect(catForSection("Subs")).toBe("main");
    expect(catForSection("Build Your Own")).toBe("main");
    expect(catForSection("Gear")).toBe("main");
  });

  it("a missing heading is à la carte (main)", () => {
    expect(catForSection(null)).toBe("main");
    expect(catForSection(undefined)).toBe("main");
    expect(catForSection("")).toBe("main");
  });
});

describe("sectionLabel", () => {
  it("merges Toast's split headings into one portal section per type", () => {
    expect(sectionLabel("Drinks")).toBe("Drinks");
    expect(sectionLabel("Catering Drinks")).toBe("Drinks");
    expect(sectionLabel("Sides")).toBe("Sides");
    expect(sectionLabel("Catering Sides")).toBe("Sides");
    expect(sectionLabel("Chips")).toBe("Sides");
    expect(sectionLabel("Sweets")).toBe("Desserts");
  });

  it("mains keep their own heading; a missing heading reads as More", () => {
    expect(sectionLabel("Subs")).toBe("Subs");
    expect(sectionLabel("Build Your Own")).toBe("Build Your Own");
    expect(sectionLabel(null)).toBe("More");
  });

  it("merged labels classify back to their own type (ordering stays consistent)", () => {
    expect(catForSection(sectionLabel("Catering Drinks"))).toBe("drink");
    expect(catForSection(sectionLabel("Chips"))).toBe("side");
    expect(catForSection(sectionLabel("Sweets"))).toBe("sweet");
  });
});

describe("orderSections", () => {
  it("drinks → sides → desserts → à la carte, stable within a rank", () => {
    const input = [
      { label: "Subs" },
      { label: "Desserts" },
      { label: "Sides" },
      { label: "Drinks" },
      { label: "Build Your Own" },
    ];
    expect(orderSections(input).map((g) => g.label)).toEqual(["Drinks", "Sides", "Desserts", "Subs", "Build Your Own"]);
  });

  it("does not mutate the input", () => {
    const input = [{ label: "Subs" }, { label: "Drinks" }];
    orderSections(input);
    expect(input.map((g) => g.label)).toEqual(["Subs", "Drinks"]);
  });

  it("rank table pins the customer's decision order", () => {
    expect(SECTION_RANK.drink).toBeLessThan(SECTION_RANK.side);
    expect(SECTION_RANK.side).toBeLessThan(SECTION_RANK.sweet);
    expect(SECTION_RANK.sweet).toBeLessThan(SECTION_RANK.main);
  });
});

describe("orderWithinSection", () => {
  it("catering-size rows first, à la carte singles under them, stable otherwise", () => {
    const rows = [
      { name: "Coke", cateringOnly: false },
      { name: "24 Mixed Sodas", cateringOnly: true },
      { name: "Water Bottle", cateringOnly: false },
      { name: "Dozen Waters", cateringOnly: true },
    ];
    expect(orderWithinSection(rows).map((r) => r.name)).toEqual(["24 Mixed Sodas", "Dozen Waters", "Coke", "Water Bottle"]);
  });

  it("does not mutate the input", () => {
    const rows = [{ name: "a", cateringOnly: false }, { name: "b", cateringOnly: true }];
    orderWithinSection(rows);
    expect(rows.map((r) => r.name)).toEqual(["a", "b"]);
  });
});
