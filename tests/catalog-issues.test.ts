/**
 * Unit spine — lib/admin/catalog-shared.ts (Items Master Catalog issue
 * classifier). Pins the four issue rules (no_recipe / no_sku_path / not_sold /
 * toast_unmapped), the happy path, and the package/menu_item exemptions.
 */
import { describe, it, expect } from "vitest";
import { classifyCatalogIssues, type CatalogIssueInput } from "@/lib/admin/catalog-shared";

/** A clean, fully-wired sold item: recipe, ready SKU path, mapped, sold. */
function cleanItem(over: Partial<CatalogIssueInput> = {}): CatalogIssueInput {
  return {
    kind: "item",
    active: true,
    soldDirectly: true,
    sizesCount: 0,
    usedInMenuItems: 0,
    usedInPackages: 0,
    hasRecipe: true,
    readinessReady: true,
    toastGuids: 1,
    ...over,
  };
}

describe("classifyCatalogIssues — happy path", () => {
  it("a fully-wired sold item has no issues", () => {
    expect(classifyCatalogIssues(cleanItem())).toEqual([]);
  });
  it("a fully-wired menu_item has no issues", () => {
    expect(
      classifyCatalogIssues({
        kind: "menu_item", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: true, readinessReady: true, toastGuids: 2,
      }),
    ).toEqual([]);
  });
  it("a fully-wired package has no issues", () => {
    expect(
      classifyCatalogIssues({
        kind: "package", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: false, readinessReady: true, toastGuids: 1,
      }),
    ).toEqual([]);
  });
});

describe("classifyCatalogIssues — no_recipe", () => {
  it("flags an item lacking a producing recipe", () => {
    // not_sold also fires here (no sizes/uses, not sold) — assert membership.
    expect(classifyCatalogIssues(cleanItem({ hasRecipe: false, soldDirectly: false }))).toContain("no_recipe");
  });
  it("flags a menu_item lacking a build recipe", () => {
    expect(
      classifyCatalogIssues({
        kind: "menu_item", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: false, readinessReady: true, toastGuids: 1,
      }),
    ).toEqual(["no_recipe"]);
  });
  it("NEVER flags a package for no_recipe even with no recipe", () => {
    expect(
      classifyCatalogIssues({
        kind: "package", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: false, readinessReady: true, toastGuids: 1,
      }),
    ).not.toContain("no_recipe");
  });
});

describe("classifyCatalogIssues — no_sku_path", () => {
  it("flags an item with a recipe but unready SKU path", () => {
    expect(classifyCatalogIssues(cleanItem({ readinessReady: false }))).toContain("no_sku_path");
  });
  it("does NOT flag no_sku_path when the item has no recipe (that's no_recipe's job)", () => {
    expect(
      classifyCatalogIssues(cleanItem({ hasRecipe: false, readinessReady: false, soldDirectly: false })),
    ).not.toContain("no_sku_path");
  });
  it("is items-only — a menu_item is never no_sku_path", () => {
    expect(
      classifyCatalogIssues({
        kind: "menu_item", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: true, readinessReady: false, toastGuids: 1,
      }),
    ).not.toContain("no_sku_path");
  });
});

describe("classifyCatalogIssues — not_sold", () => {
  it("flags a prep item with no sizes, no menu/package uses, not sold directly", () => {
    expect(
      classifyCatalogIssues(cleanItem({ soldDirectly: false })),
    ).toContain("not_sold");
  });
  it("does NOT flag when used by a menu_item", () => {
    expect(
      classifyCatalogIssues(cleanItem({ soldDirectly: false, usedInMenuItems: 1 })),
    ).not.toContain("not_sold");
  });
  it("does NOT flag when used by a package", () => {
    expect(
      classifyCatalogIssues(cleanItem({ soldDirectly: false, usedInPackages: 1 })),
    ).not.toContain("not_sold");
  });
  it("does NOT flag when it has catering sizes", () => {
    expect(
      classifyCatalogIssues(cleanItem({ soldDirectly: false, sizesCount: 2 })),
    ).not.toContain("not_sold");
  });
  it("is items-only — a menu_item is never not_sold", () => {
    expect(
      classifyCatalogIssues({
        kind: "menu_item", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: true, readinessReady: true, toastGuids: 1,
      }),
    ).not.toContain("not_sold");
  });
});

describe("classifyCatalogIssues — toast_unmapped", () => {
  it("flags an active sold_directly item with 0 confirmed GUIDs", () => {
    expect(classifyCatalogIssues(cleanItem({ toastGuids: 0 }))).toContain("toast_unmapped");
  });
  it("flags an active menu_item with 0 GUIDs", () => {
    expect(
      classifyCatalogIssues({
        kind: "menu_item", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: true, readinessReady: true, toastGuids: 0,
      }),
    ).toContain("toast_unmapped");
  });
  it("flags an active package with 0 GUIDs", () => {
    expect(
      classifyCatalogIssues({
        kind: "package", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: false, readinessReady: true, toastGuids: 0,
      }),
    ).toContain("toast_unmapped");
  });
  it("does NOT flag a non-sold prep item (not sellable) with 0 GUIDs", () => {
    expect(
      classifyCatalogIssues(cleanItem({ soldDirectly: false, toastGuids: 0, usedInMenuItems: 1 })),
    ).not.toContain("toast_unmapped");
  });
  it("does NOT flag an INACTIVE sold item with 0 GUIDs", () => {
    expect(
      classifyCatalogIssues(cleanItem({ active: false, toastGuids: 0 })),
    ).not.toContain("toast_unmapped");
  });
});

describe("classifyCatalogIssues — retype_suggested (SKU Builder streamline §3)", () => {
  it("flags a sold_as_is item that has a producing recipe", () => {
    expect(
      classifyCatalogIssues(cleanItem({ itemType: "sold_as_is", hasRecipe: true })),
    ).toContain("retype_suggested");
  });
  it("does NOT flag a sold_as_is item with no producing recipe", () => {
    expect(
      classifyCatalogIssues(cleanItem({ itemType: "sold_as_is", hasRecipe: false, soldDirectly: false })),
    ).not.toContain("retype_suggested");
  });
  it("does NOT flag a prepped item even with a recipe", () => {
    expect(
      classifyCatalogIssues(cleanItem({ itemType: "prepped", hasRecipe: true })),
    ).not.toContain("retype_suggested");
  });
  it("does NOT flag an on_hand item", () => {
    expect(
      classifyCatalogIssues(cleanItem({ itemType: "on_hand", hasRecipe: true })),
    ).not.toContain("retype_suggested");
  });
  it("is items-only — a menu_item is never retype_suggested", () => {
    expect(
      classifyCatalogIssues({
        kind: "menu_item", active: true, soldDirectly: false, sizesCount: 0,
        usedInMenuItems: 0, usedInPackages: 0, hasRecipe: true, readinessReady: true, toastGuids: 1,
      }),
    ).not.toContain("retype_suggested");
  });
  it("treats a missing itemType as never retype_suggested (menu_items/packages)", () => {
    expect(
      classifyCatalogIssues(cleanItem({ itemType: null, hasRecipe: true })),
    ).not.toContain("retype_suggested");
  });
});
