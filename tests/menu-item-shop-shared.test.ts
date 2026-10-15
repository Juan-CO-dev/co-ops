/** Catalog Phase 3a — a menu item's shop overlay (pure): resolve, the gates, the patch parser, the Toast pool. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MENU_GLOBAL_WRITE_MIN, MENU_ITEM_SHOP_ERROR_CODES, MENU_SHOP_WRITE_MIN, applyMenuOverlayToEntities, menuPromoteGate, menuShopWriteGate,
  parseMenuItemShopRefusal, parseMenuShopPatch, resolveMenuItemForShop, type MenuItemShopSettingRow,
} from "@/lib/menu-item-shop-shared";

const g = { id: "m1", name: "Italian", nameEs: "Italiano", menuPrice: 12.5 };
const s = (over: Partial<MenuItemShopSettingRow>): MenuItemShopSettingRow => ({
  id: "ms", menu_item_id: "m1", location_id: "shop", based_on_setting_id: null, price: null, sold_here: true,
  name_override: null, name_override_es: null, valid_from: "2026-10-10T00:00:00Z", valid_to: null, active: true, created_by: null, ...over,
});

describe("resolveMenuItemForShop — field by field, the global row unless the shop says otherwise", () => {
  it("no overlay: exactly the global item", () => {
    expect(resolveMenuItemForShop(g, undefined)).toEqual({ id: "m1", name: "Italian", nameEs: "Italiano", typedPrice: 12.5, soldHere: true, settingId: null, overrides: { price: false, soldHere: false, name: false } });
  });
  it("price here, off here, name here", () => {
    expect(resolveMenuItemForShop(g, s({ price: "13.50" }))).toMatchObject({ typedPrice: 13.5, name: "Italian", overrides: { price: true } });
    expect(resolveMenuItemForShop(g, s({ sold_here: false }))).toMatchObject({ soldHere: false, typedPrice: 12.5, overrides: { soldHere: true } });
    expect(resolveMenuItemForShop(g, s({ name_override: "Italian (P St)" }))).toMatchObject({ name: "Italian (P St)", nameEs: null, overrides: { name: true } });
    expect(resolveMenuItemForShop(g, s({ name_override: "Italian (P St)", name_override_es: "Italiano (P St)" })).nameEs).toBe("Italiano (P St)");
  });
});

describe("gates (spec §2)", () => {
  it("floors", () => { expect([MENU_SHOP_WRITE_MIN, MENU_GLOBAL_WRITE_MIN]).toEqual([7, 8]); });
  it("a GM writes its own shop; another shop is 404; an AGM is 403", () => {
    expect(menuShopWriteGate({ role: "gm", level: 7, scopeAllowed: true })).toEqual({ ok: true });
    expect(menuShopWriteGate({ role: "gm", level: 7, scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(menuShopWriteGate({ role: "agm", level: 6, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
  it("the social media manager is refused by ROLE, not just by level (AGENTS.md 'LEVEL 6 IS NOT ONE THING')", () => {
    expect(menuShopWriteGate({ role: "social_media_mgr", level: 6, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(menuPromoteGate({ role: "social_media_mgr", level: 6 })).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
  it("promote is MoO+", () => {
    expect(menuPromoteGate({ role: "gm", level: 7 })).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(menuPromoteGate({ role: "agm", level: 6 })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(menuPromoteGate({ role: "moo", level: 8 })).toEqual({ ok: true });
  });
});

describe("named refusals — every SQL code 0263 raises is listed (each has its own en + es message)", () => {
  it("every 'menu_item_shop:<code>' in 0263 and every parser / gate code is a listed code", () => {
    const sql = readFileSync("supabase/migrations/0263_menu_item_shop_settings.sql", "utf8");
    const raised = [...new Set([...sql.matchAll(/'menu_item_shop:([a-z_]+)/g)].map((m) => m[1]!))];
    expect(raised.length).toBeGreaterThan(8);
    for (const c of [...raised, "invalid_menu_price", "invalid_name", "empty_setting", "forbidden", "not_found", "global_requires_moo"]) {
      expect(MENU_ITEM_SHOP_ERROR_CODES as readonly string[], c).toContain(c);
    }
    expect(parseMenuItemShopRefusal("ERROR: menu_item_shop:global_changed")).toBe("global_changed");
    expect(parseMenuItemShopRefusal("menu_item_shop:made_up")).toBeNull();
  });
});

describe("parseMenuShopPatch", () => {
  it("accepts a price, off here, names; trims names", () => {
    expect(parseMenuShopPatch({ price: 13.5, soldHere: true, nameOverride: " Italian (P St) ", nameOverrideEs: null }))
      .toEqual({ ok: true, patch: { price: 13.5, soldHere: true, nameOverride: "Italian (P St)", nameOverrideEs: null } });
    expect(parseMenuShopPatch({ price: null, soldHere: false })).toEqual({ ok: true, patch: { price: null, soldHere: false, nameOverride: null, nameOverrideEs: null } });
  });
  it("refuses a bad price, a non-boolean, a long name, and a patch that says nothing", () => {
    expect(parseMenuShopPatch({ price: 13.555, soldHere: true })).toEqual({ ok: false, code: "invalid_menu_price" });
    expect(parseMenuShopPatch({ price: null, soldHere: "no" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuShopPatch({ price: null, soldHere: true, nameOverride: "x".repeat(121) })).toEqual({ ok: false, code: "invalid_name" });
    expect(parseMenuShopPatch({ price: null, soldHere: true, nameOverride: "  " })).toEqual({ ok: false, code: "empty_setting" });
  });
});

describe("applyMenuOverlayToEntities — the Toast matcher pool for a shop", () => {
  const entities = [
    { kind: "menu_item" as const, id: "m1", name: "Italian", priceCents: 1250 },
    { kind: "menu_item" as const, id: "m2", name: "Pickles", priceCents: 225 },
    { kind: "item" as const, id: "i1", name: "Slaw", priceCents: null },
  ];
  it("no overlay = the global pool, unchanged", () => {
    expect(applyMenuOverlayToEntities(entities, new Map())).toEqual(entities);
  });
  it("off here leaves the pool; name and price here are what Toast is matched against", () => {
    const overlay = new Map([["m1", s({ price: 13.5, name_override: "Italian (P St)" })], ["m2", s({ id: "ms2", menu_item_id: "m2", sold_here: false })]]);
    expect(applyMenuOverlayToEntities(entities, overlay)).toEqual([
      { kind: "menu_item", id: "m1", name: "Italian (P St)", priceCents: 1350 },
      { kind: "item", id: "i1", name: "Slaw", priceCents: null },
    ]);
  });
});
