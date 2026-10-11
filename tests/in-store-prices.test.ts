import { describe, expect, it } from "vitest";
import { inStorePricesByGuid, resolveMenuPrice, isValidMenuPrice, hasInStoreMenu } from "@/lib/toast/in-store-prices-shared";

const MENU_NAME = "Counter";

describe("in-store menu walker", () => {
  const payload = { menus: [
    { name: "Delivery", menuGroups: [{ menuItems: [{ guid: "sub", price: 99 }] }] },
    { name: MENU_NAME, menuGroups: [{ menuItems: [{ guid: "sub", price: 15.79 }],
      menuGroups: [{ menuItems: [{ guid: "sub", price: 16 }, { guid: "free", price: 0 }] }] }] },
  ], modifierOptionReferences: { one: { guid: "bacon", price: 2 }, two: { guid: "sub", price: 1 }, three: { guid: "free", price: 0 } } };
  it("walks nested groups and all occurrences only in the exact in-store menu", () => {
    expect(inStorePricesByGuid(payload, MENU_NAME, "item").prices.get("sub")).toEqual([1579, 1600]);
    expect(inStorePricesByGuid(payload, MENU_NAME).prices.get("bacon")).toEqual([200]);
    expect(inStorePricesByGuid(payload, MENU_NAME, "modifier").prices.get("sub")).toEqual([100]);
    expect(inStorePricesByGuid(payload, MENU_NAME).prices.has("free")).toBe(false);
  });
  it.each([null, {}, { menus: "bad" }, { menus: [{ name: MENU_NAME, menuGroups: {} }] },
    { menus: [], modifierOptionReferences: [] }])("rejects malformed payloads", (payload) => {
    expect(() => inStorePricesByGuid(payload, MENU_NAME)).toThrow();
  });
  it("ignores missing/non-finite/nonpositive prices", () => {
    const menuItems = [undefined, null, NaN, Infinity, -1, 0, "2"].map((price, i) => ({ guid: String(i), price }));
    expect(inStorePricesByGuid({ menus: [{ name: MENU_NAME, menuGroups: [{ menuItems }] }] }, MENU_NAME).prices.size).toBe(0);
  });
});
describe("effective selling prices", () => {
  it("chooses the lowest across shops and discloses variation", () => {
    expect(resolveMenuPrice({ typedPrice: null, toastPrices: [1579, 1679, 1579] })).toMatchObject({
      effectivePrice: 15.79, priceSource: "toast", toastPriceVaries: { min: 1579, max: 1679 }, priceFlag: false,
    });
  });
  it.each([15.78, 15.80, 20])("typed %s wins and flags a cent or more", (typedPrice) => {
    expect(resolveMenuPrice({ typedPrice, toastPrices: [1579] })).toMatchObject({ effectivePrice: typedPrice, priceSource: "typed", priceFlag: true });
  });
  it("equal typed prices do not flag; identical shops do not vary", () => {
    expect(resolveMenuPrice({ typedPrice: 15.79, toastPrices: [1579, 1579] })).toMatchObject({ priceFlag: false, toastPriceVaries: null });
  });
  it("uses one-hop direct typed/Toast price only after the item's own price", () => {
    const sameAs = { typedPrice: 12, toastPrices: [1300] };
    expect(resolveMenuPrice({ typedPrice: null, toastPrices: [], sameAs })).toMatchObject({ effectivePrice: 12, priceSource: "same_as", priceFlag: false });
    expect(resolveMenuPrice({ typedPrice: null, toastPrices: [900], sameAs }).effectivePrice).toBe(9);
    expect(resolveMenuPrice({ typedPrice: null, toastPrices: [], sameAs: { typedPrice: null, toastPrices: [1300] } }).effectivePrice).toBe(13);
    const chained = { typedPrice: null, toastPrices: [], sameAs };
    expect(resolveMenuPrice({ typedPrice: null, toastPrices: [], sameAs: chained }).effectivePrice).toBeNull();
  });
  it("confirmed zero modifiers show included only without an effective price", () => {
    expect(resolveMenuPrice({ typedPrice: 0, toastPrices: [0], hasZeroPriceModifier: true })).toMatchObject({ effectivePrice: null, priceSource: null, includedInSubPrice: true });
    const displayOnly = { typedPrice: null, toastPrices: [], section: "Modifier builds" };
    expect(resolveMenuPrice(displayOnly).includedInSubPrice).toBe(false);
    for (const candidate of [{ typedPrice: 2, toastPrices: [] }, { typedPrice: null, toastPrices: [200] },
      { typedPrice: null, toastPrices: [], sameAs: { typedPrice: 2, toastPrices: [] } }]) {
      expect(resolveMenuPrice({ ...candidate, hasZeroPriceModifier: true }).includedInSubPrice).toBe(false);
    }
  });
  it.each([null, 0.01, 15.79, 19.99, 1000])("accepts valid edit %s", (value) => expect(isValidMenuPrice(value)).toBe(true));
  it.each([undefined, "12", true, 0, -1, 1000.01, 1.001, 1e-12, 1.00000000001, NaN, Infinity])("rejects invalid edit %s", (value) => expect(isValidMenuPrice(value)).toBe(false));
});

it("skips null and missing-guid entries without dropping valid prices", () => {
  expect(inStorePricesByGuid({ menus: [null, { name: MENU_NAME, menuGroups: [null, {
    menuItems: [null, {}, { price: 99 }, { guid: "sub", price: 12 }],
  }] }], modifierOptionReferences: { bad: null, missing: { price: 99 }, good: { guid: "bacon", price: 2 } } }, MENU_NAME).prices).toEqual(new Map([["sub", [1200]], ["bacon", [200]]]));
});

it("reports exact zero modifier GUIDs separately from positive prices", () => {
  const result = inStorePricesByGuid({ menus: [{ name: MENU_NAME, menuGroups: [{ menuItems: [{ guid: "item-zero", price: 0 }] }] }],
    modifierOptionReferences: Object.fromEntries([0, -1, 0.001, null, "0"].map((price, i) => [i, { guid: String(i), price }])) }, MENU_NAME);
  expect([...result.zeroPriceModifierGuids]).toEqual(["0"]);
  expect(result.prices.size).toBe(0);
});
it.each([null, "", "   "])("unset menu %s ignores items while retaining modifiers", (name) => {
  const payload = { menus: [{ name, menuGroups: [{ menuItems: [{ guid: "sub", price: 99 }] }] }],
    modifierOptionReferences: { option: { guid: "paid", price: 2 } } };
  expect(hasInStoreMenu(payload, name)).toBe(false);
  expect([...inStorePricesByGuid(payload, name).prices]).toEqual([["paid", [200]]]);
});
