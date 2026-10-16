import { expect, it } from "vitest";
import { shareConfirmation, shareProducerHref, backOutcomeKey, readBackResult } from "@/lib/catalog/share-back-shared";

const common = { name: "Prep", ownerShopId: "owner", ownerShopName: "Shop", token: "reviewed" };
const recipe = { ...common, recipeId: "recipe", shopOnlyItems: [{ id: "item", name: "Item" }], shopOnlySkus: [{ id: "sku", name: "SKU" }], makesSandwich: null, blockedBy: [] };
it("binds exact owner, token and explicitly reviewed dependency ids", () => {
  expect(shareConfirmation("recipe", recipe, ["sku"], ["item"])).toEqual({ expectedOwner: "owner", previewToken: "reviewed", shareSkuIds: ["sku"], shareItemIds: ["item"] });
  expect(shareConfirmation("recipe", recipe, [], ["item"])).toBeNull();
  expect(shareConfirmation("recipe", recipe, ["sku", "foreign"], ["item"])).toBeNull();
  expect(shareConfirmation("recipe", { ...recipe, ownerShopId: "changed", token: "fresh" }, ["sku"], ["item"])).toMatchObject({ expectedOwner: "changed", previewToken: "fresh" });
});
it("sends required empty arrays and no unrelated fields for each kind", () => {
  expect(shareConfirmation("sku", { ...common, skuId: "sku", usedIn: [], ownerKeepsOwnPack: false, ownerKeepsOwnPrice: false }, [], [])).toEqual({ expectedOwner: "owner", previewToken: "reviewed" });
  expect(shareConfirmation("menu-item", { ...common, menuItemId: "menu", nameEs: null, price: null, recipes: [], shopOnlyItems: [], shopOnlySkus: [], blockedBy: [] }, [], [])).toEqual({ expectedOwner: "owner", previewToken: "reviewed", shareSkuIds: [] });
});
it("blocks sandwich recipes and unresolved prep dependencies", () => {
  expect(shareConfirmation("recipe", { ...recipe, makesSandwich: { id: "menu", name: "Menu" } }, ["sku"], ["item"])).toBeNull();
  expect(shareConfirmation("recipe", { ...recipe, blockedBy: [{ id: "prep", name: "Prep", shopName: "Shop", kind: "item", producers: [] }] }, ["sku"], ["item"])).toBeNull();
});
it("routes prep blockers to their producing recipe with explicit owner/global scope", () => {
  expect(shareProducerHref({ id: "prep", ownerLocationId: "shop" })).toBe("/admin/catalog/recipe/prep?location=shop");
  expect(shareProducerHref({ id: "prep", ownerLocationId: null })).toBe("/admin/catalog/recipe/prep?location=global");
});
it("accepts actual Back outcomes, including edits retained after preview", () => {
  const actual = { back: [], kept: ["later-edit"], primary: "changed_since", grouping: "kept" };
  expect(readBackResult(actual)).toEqual(actual);
  expect(readBackResult({ ok: true })).toBeNull();
  expect(backOutcomeKey("changed_since")).toBe("catalog.jobs.back.outcome_changed_since");
  expect(backOutcomeKey("unchanged")).toBe("catalog.jobs.back.outcome_none");
  expect(backOutcomeKey("unexpected server code")).toBe("catalog.jobs.back.outcome_unknown");
});
it("requires reviewed menu output items even though its route derives their IDs", () => {
  const menu = { ...common, menuItemId: "menu", nameEs: "Menú", price: 12, recipes: [], shopOnlyItems: [{ id: "output", name: "Output" }], shopOnlySkus: [], blockedBy: [] };
  expect(shareConfirmation("menu-item", menu, [], [])).toBeNull();
  expect(shareConfirmation("menu-item", menu, [], ["output"])).toEqual({ expectedOwner: "owner", previewToken: "reviewed", shareSkuIds: [] });
});
