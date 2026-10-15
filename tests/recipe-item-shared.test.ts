/** Catalog Phase 3b — the recipe / menu-item pages' pure surface. */
import { describe, expect, it } from "vitest";
import {
  historyLinkEndedSource, menuFormRevision, menuItemPageHref, noticesHref, pageClientKey, parseMenuChange, parseRecipeChange,
  recipeChangeTarget, recipeItemHref, recipeVersionLabel, scopedPickerSkus, lineEditStale, SHOP_CHANGES_HREF,
} from "@/lib/catalog/recipe-item-shared";
import { shopParamNames } from "@/lib/shop-context-shared";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { lineUnitChoices, lineUnitOptions } from "@/lib/recipe-line-shared";

const R = "7d0c1f2e-0000-4000-8000-000000000001";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const V = "7d0c1f2e-0000-4000-8000-0000000000aa";
const SKU = "7d0c1f2e-0000-4000-8000-000000000002";

describe("links land on the item", () => {
  it("recipe, menu item, notices, shop changes — plain, per shop, global", () => {
    expect(recipeItemHref(R)).toBe(`/admin/catalog/recipe/${R}`);
    expect(recipeItemHref(R, { shopId: SHOP })).toBe(`/admin/catalog/recipe/${R}?location=${SHOP}`);
    expect(recipeItemHref(R, { shopId: null })).toBe(`/admin/catalog/recipe/${R}?location=global`);
    expect(menuItemPageHref(R)).toBe(`/admin/catalog/menu-item/${R}`);
    expect(menuItemPageHref(R, { shopId: SHOP })).toBe(`/admin/catalog/menu-item/${R}?location=${SHOP}`);
    expect(noticesHref(SHOP)).toBe(`/admin/catalog/notices?location=${SHOP}`);
    expect(noticesHref()).toBe("/admin/catalog/notices");
    expect(SHOP_CHANGES_HREF).toBe("/admin/catalog/shop-changes");
  });
  it("the shop switcher's param is declared for both item pages (the notices page declares its own with the page, Task 10)", () => {
    expect(shopParamNames(`/admin/catalog/recipe/${R}`)).toEqual(["location"]);
    expect(shopParamNames(`/admin/catalog/menu-item/${R}`)).toEqual(["location"]);
    // the bare prefix is not an item page
    expect(shopParamNames("/admin/catalog/recipe/")).toEqual([]);
  });
  it("the client remounts per (kind, item, shop)", () => {
    expect(pageClientKey("recipe", R, SHOP)).toBe(`recipe:${R}:${SHOP}`);
    expect(pageClientKey("recipe", R, SHOP)).not.toBe(pageClientKey("recipe", R, null));
    expect(pageClientKey("recipe", R, null)).not.toBe(pageClientKey("menu", R, null));
  });
  it("the menu form's revision moves with every committed change — back to default included (Astra 3b r1#6)", () => {
    const item = { id: R, name: "Italian", nameEs: "Italiano", menuPrice: 12.5, section: "Subs" };
    const own = { settingId: "s1", price: 13.5, soldHere: false, nameOverride: null, nameOverrideEs: null, name: "Italian", nameEs: "Italiano", typedPrice: 13.5 };
    const back = { ...own, settingId: null, price: null, soldHere: true, typedPrice: 12.5 };
    expect(menuFormRevision({ item, here: own })).not.toBe(menuFormRevision({ item, here: back }));
    expect(menuFormRevision({ item, here: own })).toBe(menuFormRevision({ item, here: { ...own } }));
    expect(menuFormRevision({ item: { ...item, menuPrice: 14 }, here: back })).not.toBe(menuFormRevision({ item, here: back }));
    // a Spanish-only change moves it too
    expect(menuFormRevision({ item, here: { ...own, nameOverrideEs: "Italiana" } })).not.toBe(menuFormRevision({ item, here: own }));
  });
});

describe("what the header says", () => {
  it("global, a shop on the default, a shop's own, a shop's adopted copy", () => {
    expect(recipeVersionLabel({ scope: null, scopeName: null, hasOwn: false, adoptedFromShopName: null })).toEqual({ kind: "global" });
    expect(recipeVersionLabel({ scope: SHOP, scopeName: "P Street", hasOwn: false, adoptedFromShopName: null })).toEqual({ kind: "shop_default", shop: "P Street" });
    expect(recipeVersionLabel({ scope: SHOP, scopeName: "P Street", hasOwn: true, adoptedFromShopName: null })).toEqual({ kind: "shop_own", shop: "P Street" });
    expect(recipeVersionLabel({ scope: SHOP, scopeName: "P Street", hasOwn: true, adoptedFromShopName: "Capitol Hill" })).toEqual({ kind: "shop_adopted", shop: "P Street", from: "Capitol Hill" });
  });
});

describe("parseRecipeChange — the five recipe acts", () => {
  const line = { componentSkuId: SKU, quantity: 5, unit: "oz" };
  it("lines (shop or global), restore, back to default, adopt, promote", () => {
    expect(parseRecipeChange({ kind: "lines", target: { kind: "shop", shopId: SHOP }, op: { kind: "add", line } })).toEqual({
      ok: true,
      change: {
        kind: "lines", target: { kind: "shop", shopId: SHOP },
        op: { kind: "add", line: { componentSkuId: SKU, componentItemId: null, componentProductId: null, quantity: 5, unit: "oz", eachContainerLabel: null, portioned: false } },
      },
    });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "global" }, op: { kind: "add", line } })).toMatchObject({ ok: true, change: { kind: "lines", target: { kind: "global" } } });
    expect(parseRecipeChange({ kind: "restore", target: { kind: "shop", shopId: SHOP }, fromVersionId: V })).toEqual({ ok: true, change: { kind: "restore", target: { kind: "shop", shopId: SHOP }, fromVersionId: V } });
    expect(parseRecipeChange({ kind: "back_to_default", shopId: SHOP })).toEqual({ ok: true, change: { kind: "back_to_default", shopId: SHOP } });
    expect(parseRecipeChange({ kind: "adopt", shopId: SHOP, sourceVersionId: V })).toEqual({ ok: true, change: { kind: "adopt", shopId: SHOP, sourceVersionId: V } });
    expect(parseRecipeChange({ kind: "promote", sourceVersionId: V })).toEqual({ ok: true, change: { kind: "promote", sourceVersionId: V } });
  });
  it("refuses an unknown kind, a non-uuid id, a bad target, a bad line — each with its own code", () => {
    expect(parseRecipeChange(null)).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange([])).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "delete" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "adopt", shopId: "x", sourceVersionId: V })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "promote", sourceVersionId: "x" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "restore", target: { kind: "shop", shopId: SHOP }, fromVersionId: "nope" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "elsewhere" }, op: { kind: "add", line } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "global" }, op: { kind: "add", line: { componentSkuId: SKU, quantity: -1 } } })).toEqual({ ok: false, code: "invalid_quantity" });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "global" }, op: { kind: "add", line: { quantity: 1 } } })).toEqual({ ok: false, code: "invalid_component" });
  });
  it("the save target of each act", () => {
    expect(recipeChangeTarget({ kind: "back_to_default", shopId: SHOP })).toEqual({ kind: "shop", shopId: SHOP });
    expect(recipeChangeTarget({ kind: "adopt", shopId: SHOP, sourceVersionId: V })).toEqual({ kind: "shop", shopId: SHOP });
    expect(recipeChangeTarget({ kind: "promote", sourceVersionId: V })).toEqual({ kind: "global" });
    expect(recipeChangeTarget({ kind: "restore", target: { kind: "global" }, fromVersionId: V })).toEqual({ kind: "global" });
  });
});

describe("parseMenuChange — the four menu acts", () => {
  it("save, back to default, restore, promote", () => {
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { price: 13.5, soldHere: true } })).toEqual({ ok: true, change: { kind: "save", shopId: SHOP, patch: { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null } } });
    expect(parseMenuChange({ kind: "back_to_default", shopId: SHOP })).toEqual({ ok: true, change: { kind: "back_to_default", shopId: SHOP } });
    expect(parseMenuChange({ kind: "restore", shopId: SHOP, fromSettingId: V })).toEqual({ ok: true, change: { kind: "restore", shopId: SHOP, fromSettingId: V } });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["price"] })).toEqual({ ok: true, change: { kind: "promote", settingId: V, fields: ["price"] } });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["price", "name"] })).toEqual({ ok: true, change: { kind: "promote", settingId: V, fields: ["price", "name"] } });
  });
  it("refuses a promote of sold-here, an empty or repeated field list, a bad price, a bad name, an empty patch", () => {
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["sold_here"] })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: [] })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["price", "price"] })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { price: -2, soldHere: true } })).toEqual({ ok: false, code: "invalid_menu_price" });
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { nameOverride: 7 } })).toEqual({ ok: false, code: "invalid_name" });
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { soldHere: true } })).toEqual({ ok: false, code: "empty_setting" });
    expect(parseMenuChange({ kind: "save", shopId: "x", patch: { price: 13 } })).toEqual({ ok: false, code: "invalid_payload" });
  });
});

describe("parseMenuChange — the promote's optional Spanish name (Astra chunk-1 review P2)", () => {
  it("PRESERVES a typed Spanish name (trimmed) so it reaches preview and apply", () => {
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["name"], nameEs: "  Italiano grande " }))
      .toEqual({ ok: true, change: { kind: "promote", settingId: V, fields: ["name"], nameEs: "Italiano grande" } });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["price", "name"], nameEs: "bad" }))
      .toEqual({ ok: true, change: { kind: "promote", settingId: V, fields: ["price", "name"], nameEs: "bad" } });
  });
  it("blank or absent = not typed; over 120 characters or not text = invalid_name; with a price-only promote = invalid_payload", () => {
    const blank = parseMenuChange({ kind: "promote", settingId: V, fields: ["name"], nameEs: "   " });
    expect(blank).toEqual({ ok: true, change: { kind: "promote", settingId: V, fields: ["name"] } });
    expect(blank.ok && blank.change.kind === "promote" && "nameEs" in blank.change).toBe(false);
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["name"], nameEs: "x".repeat(120) }).ok).toBe(true);
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["name"], nameEs: "x".repeat(121) })).toEqual({ ok: false, code: "invalid_name" });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["name"], nameEs: 7 })).toEqual({ ok: false, code: "invalid_name" });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["price"], nameEs: "Italiano" })).toEqual({ ok: false, code: "invalid_payload" });
  });
  it("a shop save may use the literal name \"bad\" (the sentinel class of Astra's P3)", () => {
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { nameOverride: "bad", nameOverrideEs: "bad" } }))
      .toEqual({ ok: true, change: { kind: "save", shopId: SHOP, patch: { price: null, soldHere: true, nameOverride: "bad", nameOverrideEs: "bad" } } });
  });
});

describe("an open edit keeps its baseline across a refresh (Astra 3b r5#1; lead decision: previews bind the change, Start over)", () => {
  const seen = { componentSkuId: "s1", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false };
  it("a changed line under the edit is stale; the same line is not", () => {
    expect(lineEditStale(seen, { ...seen })).toBe(false);
    expect(lineEditStale(seen, { ...seen, quantity: 5 })).toBe(true);
    expect(lineEditStale(seen, { ...seen, unit: "lb" })).toBe(true);
    expect(lineEditStale(seen, { ...seen, portioned: true })).toBe(true);
  });
});

describe("History reads the RECORDED end of an adoption link (lead decision: adoption_ended_from_version_id only)", () => {
  const byId = new Map<string, { locationId: string | null; adoptedFromVersionId: string | null }>([
    ["src", { locationId: "shop-src", adoptedFromVersionId: null }],
    ["copy", { locationId: "shop-here", adoptedFromVersionId: "src" }],
    ["plain", { locationId: "shop-here", adoptedFromVersionId: null }],
  ]);
  it("a row that ended a link names the source shop; any other row names nothing", () => {
    expect(historyLinkEndedSource({ adoptionEndedFromVersionId: "copy" }, byId)).toBe("shop-src");
    expect(historyLinkEndedSource({ adoptionEndedFromVersionId: null }, byId)).toBeNull();
    expect(historyLinkEndedSource({ adoptionEndedFromVersionId: "plain" }, byId)).toBeNull();
    expect(historyLinkEndedSource({ adoptionEndedFromVersionId: "unknown" }, byId)).toBeNull();
  });
});

describe("the picker speaks the SHOP's pack (Astra 3b r4#1)", () => {
  const measures = new Map([["lb", { dimension: "weight" as const, toBaseFactor: 16 }]]);
  const sku = { id: "s1", name: "Turkey", vendorName: null, packFormat: "case", eachContainerLabel: null, unitsPerPack: 1, eachSize: 30, eachMeasure: "lb", avgOzPerEach: null };
  const caseOf = (lb: number, label = "case") => [{ id: "c", label, containsQty: lb, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
  it("the shop's 40 lb case converts to 640 oz in the editor where the default's 30 lb gives 480 — the numbers the preview uses", () => {
    const [shop] = scopedPickerSkus([sku], new Map([["s1", { levels: caseOf(40) }]]));
    const [global] = scopedPickerSkus([sku], new Map([["s1", { levels: caseOf(30) }]]));
    expect(ozForRecipeInput(1, "case", shop!, measures)).toBe(640);
    expect(ozForRecipeInput(1, "case", global!, measures)).toBe(480);
    expect(scopedPickerSkus([sku], new Map())[0]!.packChain).toBeNull(); // no chain → the flat fields, as before
    expect(scopedPickerSkus([sku], new Map([["s1", { levels: [] }]]))[0]!.packChain).toBeNull();
  });
  it("the shop's own container labels are the ones offered", () => {
    const [shop] = scopedPickerSkus([sku], new Map([["s1", { levels: caseOf(40, "crate") }]]));
    const choices = lineUnitChoices("sku", shop!, ["oz", "lb"], null);
    expect(choices).toEqual(["crate", "lb", "oz"]);
    expect(lineUnitChoices("sku", sku, ["oz", "lb"], null)).toEqual(["case", "lb", "oz"]); // unchained: the flat labels, unchanged
    expect(lineUnitOptions("sku", shop!, ["oz", "lb"], new Set(), null, "crate").choices).toContain("crate");
  });
});
