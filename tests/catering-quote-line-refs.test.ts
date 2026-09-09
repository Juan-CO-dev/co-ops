/**
 * Unit spine — `reclassifyQuoteLineRefs` (PR fix/quote-builder-item-kind, 2026-09-09).
 *
 * `catering_quote_items.item_id` → items, `menu_item_id` → menu_items. The staff quote builder
 * wrote every à-la-carte pick's id into `itemId` regardless of the pick's kind, so a menu item
 * ("Case of Assorted Chips (24)") landed a menu_items id in item_id and the line insert failed
 * its FK AFTER the header was written. The server now reclassifies against the ids it can see
 * and refuses, naming the line, when an id exists on neither side. These pin that pure step.
 */
import { describe, expect, it } from "vitest";
import { reclassifyQuoteLineRefs } from "@/lib/catering/quotes-shared";

const known = { itemIds: new Set(["item-A", "item-B"]), menuItemIds: new Set(["menu-X", "menu-Y"]) };

describe("reclassifyQuoteLineRefs", () => {
  it("returns correctly-placed references untouched, with identity preserved", () => {
    const a = { itemId: "item-A", menuItemId: null, description: "Napkins" };
    const b = { itemId: null, menuItemId: "menu-X", description: "Chips" };
    const c = { itemId: null, menuItemId: null, description: "Hand-typed" };
    const r = reclassifyQuoteLineRefs([a, b, c], known);
    expect(r.lines[0]).toBe(a);
    expect(r.lines[1]).toBe(b);
    expect(r.lines[2]).toBe(c);
    expect(r.moved).toBe(0);
    expect(r.unknown).toEqual([]);
  });

  it("moves a menu_items id that arrived in itemId onto menuItemId (the walk's defect)", () => {
    const bad = { itemId: "menu-X", menuItemId: null, description: "Case of Assorted Chips (24)" };
    const r = reclassifyQuoteLineRefs([bad], known);
    expect(r.lines[0]).toEqual({ itemId: null, menuItemId: "menu-X", description: "Case of Assorted Chips (24)" });
    expect(r.lines[0]).not.toBe(bad);
    expect(r.moved).toBe(1);
    expect(r.unknown).toEqual([]);
  });

  it("moves an items id that arrived in menuItemId onto itemId (symmetric)", () => {
    const r = reclassifyQuoteLineRefs([{ itemId: null, menuItemId: "item-B" }], known);
    expect(r.lines[0]).toEqual({ itemId: "item-B", menuItemId: null });
    expect(r.moved).toBe(1);
  });

  it("reports an id found on neither side by line index and field, and never drops the line", () => {
    const r = reclassifyQuoteLineRefs(
      [{ itemId: "item-A", menuItemId: null }, { itemId: "ghost", menuItemId: null }, { itemId: null, menuItemId: "phantom" }],
      known,
    );
    expect(r.lines).toHaveLength(3);
    expect(r.unknown).toEqual([
      { index: 1, field: "itemId", id: "ghost" },
      { index: 2, field: "menuItemId", id: "phantom" },
    ]);
    expect(r.moved).toBe(0);
  });

  it("is a no-op on an empty set of lines", () => {
    expect(reclassifyQuoteLineRefs([], known)).toEqual({ lines: [], moved: 0, unknown: [] });
  });
});
