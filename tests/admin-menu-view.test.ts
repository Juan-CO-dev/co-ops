// Admin catering menu — view logic (lib/admin/catering/menu-view-shared.ts).
// The admin list groups rows EXACTLY as the customer order builder does (shared helpers in
// lib/portal/menu-order-shared.ts), so a manager sees the same "Sides" a customer sees.
import { describe, expect, it } from "vitest";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import { groupAdminRows } from "@/lib/admin/catering/menu-view-shared";

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
});
