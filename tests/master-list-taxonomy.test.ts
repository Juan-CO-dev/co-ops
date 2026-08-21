/**
 * Unit spine — The Master List pure derivations (piece 3):
 *  - deriveCatalogType: item item_type pass-through, menu_item made-vs-retail
 *    (has an active consumer build → made; else retail), package word, defaults.
 *  - needsLink: item-shaped (expects_count) lines with NEITHER a registry item
 *    NOR a SKU ref are the queue; everything else is out.
 *
 * Canonical reference: docs/superpowers/specs/2026-07-26-master-list-taxonomy-design.md
 */
import { describe, it, expect } from "vitest";
import {
  deriveCatalogType,
  ITEM_TYPES,
  SKU_CLASSES,
  isItemType,
  isSkuClass,
} from "@/lib/admin/catalog-shared";
import { needsLink, type NeedsLinkInput } from "@/lib/admin/needs-link-shared";

describe("deriveCatalogType — items", () => {
  it("passes through the stored item_type for each value", () => {
    expect(deriveCatalogType({ kind: "item", itemType: "prepped" })).toBe("prepped");
    expect(deriveCatalogType({ kind: "item", itemType: "on_hand" })).toBe("on_hand");
    expect(deriveCatalogType({ kind: "item", itemType: "sold_as_is" })).toBe("sold_as_is");
  });
  it("defaults a missing item_type to prepped (the DB column default)", () => {
    expect(deriveCatalogType({ kind: "item" })).toBe("prepped");
    expect(deriveCatalogType({ kind: "item", itemType: null })).toBe("prepped");
  });
});

describe("deriveCatalogType — menu_items (made vs retail is DERIVED)", () => {
  it("an active consumer build → made", () => {
    expect(deriveCatalogType({ kind: "menu_item", hasBuild: true })).toBe("made");
  });
  it("no build → retail (anything we did not make ourselves)", () => {
    expect(deriveCatalogType({ kind: "menu_item", hasBuild: false })).toBe("retail");
    expect(deriveCatalogType({ kind: "menu_item" })).toBe("retail");
  });
  it("ignores item_type for menu_items (they have no stored taxon)", () => {
    expect(deriveCatalogType({ kind: "menu_item", itemType: "prepped", hasBuild: true })).toBe("made");
  });
});

describe("deriveCatalogType — packages", () => {
  it("always the generic package word (compositions, not a taxon)", () => {
    expect(deriveCatalogType({ kind: "package" })).toBe("package");
    expect(deriveCatalogType({ kind: "package", hasBuild: true })).toBe("package");
  });
});

describe("taxonomy value sets + guards", () => {
  it("ITEM_TYPES is the three-value set matching migration 0157's CHECK", () => {
    expect([...ITEM_TYPES]).toEqual(["prepped", "on_hand", "sold_as_is"]);
  });
  it("SKU_CLASSES is the four-value set matching migration 0157's CHECK", () => {
    expect([...SKU_CLASSES]).toEqual(["raw", "packaging", "cleaning", "misc"]);
  });
  it("isItemType accepts legal values, rejects others", () => {
    expect(isItemType("prepped")).toBe(true);
    expect(isItemType("on_hand")).toBe(true);
    expect(isItemType("raw")).toBe(false); // that's a sku_class
    expect(isItemType(null)).toBe(false);
    expect(isItemType(3)).toBe(false);
  });
  it("isSkuClass accepts legal values, rejects others", () => {
    expect(isSkuClass("raw")).toBe(true);
    expect(isSkuClass("cleaning")).toBe(true);
    expect(isSkuClass("prepped")).toBe(false); // that's an item_type
    expect(isSkuClass(undefined)).toBe(false);
  });
});

describe("needsLink — the queue classifier", () => {
  const base: NeedsLinkInput = { expectsCount: true, itemId: null, vendorItemId: null, equipmentId: null };

  it("an unlinked count line (both refs null) needs link", () => {
    expect(needsLink(base)).toBe(true);
  });
  it("a task line (not a count line) never needs link, even with null refs", () => {
    expect(needsLink({ ...base, expectsCount: false })).toBe(false);
  });
  it("a count line already linked to an item is out of the queue", () => {
    expect(needsLink({ ...base, itemId: "item-1" })).toBe(false);
  });
  it("a count line already linked to a SKU is out of the queue", () => {
    expect(needsLink({ ...base, vendorItemId: "sku-1" })).toBe(false);
  });
  it("a count line with BOTH refs (defensive) is still out", () => {
    expect(needsLink({ expectsCount: true, itemId: "item-1", vendorItemId: "sku-1", equipmentId: null })).toBe(false);
  });

  // The 32-row false positive in one assertion: a fridge TEMPERATURE line was never
  // unlinked — the queue simply had no word for what it pointed at (0181).
  it("a count line linked to EQUIPMENT is out of the queue", () => {
    expect(needsLink({ ...base, equipmentId: "fridge-1" })).toBe(false);
  });

  it("ALL THREE refs null is the only needs-link shape", () => {
    expect(needsLink({ expectsCount: true, itemId: null, vendorItemId: null, equipmentId: null })).toBe(true);
  });
});
