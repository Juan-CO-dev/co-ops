// Admin catering menu — view logic (lib/admin/catering/menu-view-shared.ts).
// The admin list groups rows EXACTLY as the customer order builder does (shared helpers in
// lib/portal/menu-order-shared.ts), so a manager sees the same "Sides" a customer sees.
import { describe, expect, it } from "vitest";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import { filterAdminRows, groupAdminRows, rowBadges, sectionSummary } from "@/lib/admin/catering/menu-view-shared";

function row(over: Partial<AdminMenuItem> & { name: string }): AdminMenuItem {
  return {
    id: over.name.toLowerCase().replace(/\s+/g, "-"),
    kind: "menu_item",
    nameEs: null,
    section: "Subs",
    menuPriceCents: 1000,
    cateringAvailable: true,
    cateringOnly: false,
    cateringPortionable: null,
    serves: null,
    seasonal: false,
    sizes: [],
    ...over,
  };
}

const CATALOG: AdminMenuItem[] = [
  row({ name: "Coke", section: "Drinks" }),
  row({ name: "24 Mixed Sodas", section: "Catering Drinks", cateringOnly: true, serves: 24 }),
  row({ name: "Deli Pickle", section: "Sides" }),
  row({ name: "Case of Mini Chips (24)", section: "Catering Sides", cateringOnly: true, serves: 24 }),
  row({ name: "Utz Original Chips", section: "Chips" }),
  row({ name: "Egg Salad", section: "Sides", kind: "item", nameEs: "Ensalada de huevo" }),
  row({ name: "Berger Cookies- Large", section: "Sweets" }),
  row({ name: "Crunchy Boi", section: "Subs", cateringPortionable: true }),
  row({ name: "Build Your Own Sub", section: "Build Your Own" }),
  row({ name: "Hidden Thing", section: "Gear", cateringAvailable: false }),
  row({ name: "No Section", section: null }),
];

describe("groupAdminRows", () => {
  it("merges Toast headings into one section per type, in customer order, mains keep their headings", () => {
    const groups = groupAdminRows(CATALOG);
    expect(groups.map((g) => g.label)).toEqual(["Drinks", "Sides", "Desserts", "Subs", "Build Your Own", "Gear", "More"]);
  });

  it("remembers which Toast sections fed a merged group", () => {
    const sides = groupAdminRows(CATALOG).find((g) => g.label === "Sides")!;
    expect(sides.rawSections).toEqual(["Sides", "Catering Sides", "Chips"]);
  });

  it("inside a section, catering-only rows come first; otherwise input order is kept", () => {
    const sides = groupAdminRows(CATALOG).find((g) => g.label === "Sides")!;
    expect(sides.rows.map((r) => r.name)).toEqual(["Case of Mini Chips (24)", "Deli Pickle", "Utz Original Chips", "Egg Salad"]);
  });

  it("drops nothing and never mutates the input", () => {
    const copy = CATALOG.map((r) => ({ ...r }));
    const total = groupAdminRows(CATALOG).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(CATALOG.length);
    expect(CATALOG).toEqual(copy);
  });

  it("an empty catalog yields no groups; raw sections are stored trimmed", () => {
    expect(groupAdminRows([])).toEqual([]);
    const g = groupAdminRows([row({ name: "Padded", section: " Sides " })]);
    expect(g[0]?.rawSections).toEqual(["Sides"]);
  });
});

describe("filterAdminRows", () => {
  it("chips", () => {
    const names = (chip: Parameters<typeof filterAdminRows>[1]["chip"]) => filterAdminRows(CATALOG, { chip, query: "" }).map((r) => r.name);
    expect(names("all")).toHaveLength(CATALOG.length);
    expect(names("hidden")).toEqual(["Hidden Thing"]);
    expect(names("on_menu")).not.toContain("Hidden Thing");
    expect(names("on_menu")).toHaveLength(CATALOG.length - 1);
    expect(names("toast")).not.toContain("Egg Salad");
    expect(names("catering")).toEqual(["Egg Salad"]);
  });

  it("search matches name and Spanish name, case-insensitive, trimmed", () => {
    expect(filterAdminRows(CATALOG, { chip: "all", query: "  coke " }).map((r) => r.name)).toEqual(["Coke"]);
    expect(filterAdminRows(CATALOG, { chip: "all", query: "ENSALADA" }).map((r) => r.name)).toEqual(["Egg Salad"]);
    expect(filterAdminRows(CATALOG, { chip: "all", query: "zzz" })).toEqual([]);
  });

  it("a whitespace-only query returns everything (same as empty)", () => {
    expect(filterAdminRows(CATALOG, { chip: "all", query: "   " })).toHaveLength(CATALOG.length);
  });

  it("chip and search combine", () => {
    expect(filterAdminRows(CATALOG, { chip: "hidden", query: "coke" })).toEqual([]);
    expect(filterAdminRows(CATALOG, { chip: "on_menu", query: "chips" }).map((r) => r.name)).toEqual(["Case of Mini Chips (24)", "Utz Original Chips"]);
  });

  it("empty groups disappear after filtering", () => {
    const groups = groupAdminRows(filterAdminRows(CATALOG, { chip: "all", query: "coke" }));
    expect(groups.map((g) => g.label)).toEqual(["Drinks"]);
  });
});

describe("sectionSummary", () => {
  it("counts rows customers can order against the total", () => {
    const gear = groupAdminRows(CATALOG).find((g) => g.label === "Gear")!;
    expect(sectionSummary(gear.rows)).toEqual({ on: 0, total: 1 });
    const sides = groupAdminRows(CATALOG).find((g) => g.label === "Sides")!;
    expect(sectionSummary(sides.rows)).toEqual({ on: 4, total: 4 });
  });
});

describe("rowBadges", () => {
  it("names the source, then the flags, in a fixed order", () => {
    expect(rowBadges(row({ name: "a" }))).toEqual(["toast_item"]);
    expect(rowBadges(row({ name: "b", kind: "item" }))).toEqual(["catering_item"]);
    expect(rowBadges(row({ name: "c", cateringOnly: true }))).toEqual(["toast_item", "catering_only"]);
    expect(rowBadges(row({ name: "d", kind: "item", cateringOnly: true, seasonal: true, cateringAvailable: false }))).toEqual([
      "catering_item",
      "catering_only",
      "seasonal",
      "hidden",
    ]);
  });
});
