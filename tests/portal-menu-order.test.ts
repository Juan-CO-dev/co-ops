// Order-builder section ordering (lib/portal/menu-order-shared.ts).
//
// Juan's rule (2026-09-03, first-live test): customers pick PACKAGES first, then DRINKS,
// then SIDES, then DESSERTS, and à la carte (subs / build-your-own / everything else) last.
// The catalog has no category column — the section heading is classified heuristically,
// exactly the way the coverage meter already did it inside the page.
import { describe, expect, it } from "vitest";
import { catForSection, orderSections, SECTION_RANK } from "@/lib/portal/menu-order-shared";

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

describe("orderSections", () => {
  it("drinks → sides → sweets → à la carte, stable within a rank", () => {
    const input = [
      { label: "Subs" },
      { label: "Sweets" },
      { label: "Chips" },
      { label: "Drinks" },
      { label: "Sides" },
      { label: "Catering Drinks" },
      { label: "Build Your Own" },
    ];
    expect(orderSections(input).map((g) => g.label)).toEqual([
      "Drinks",
      "Catering Drinks",
      "Chips",
      "Sides",
      "Sweets",
      "Subs",
      "Build Your Own",
    ]);
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
