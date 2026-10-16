/** Catalog Phase 3a — the menu overlay write gates hold inside the lib, before any I/O. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import {
  MenuShopError, loadMenuItemShopHistory, restoreMenuItemShopSetting, retireMenuItemShopSetting, saveMenuItemShopSetting,
} from "@/lib/admin/menu-item-shop";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const PATCH = { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null };

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof MenuShopError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("GM writes only its own shops' menu; MoO any shop", () => {
  it("a GM of LOC cannot set OTHER's price, retire or restore OTHER's row (404, before I/O)", async () => {
    expect(await refused(saveMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: OTHER, expectedSettingId: null, patch: PATCH }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(retireMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: OTHER, settingId: "s" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(restoreMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: OTHER, fromSettingId: "s", expectedSettingId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("an AGM cannot set any shop's menu", async () => {
    expect(await refused(saveMenuItemShopSetting(actor("agm", 6, [LOC]), { menuItemId: "m-italian", locationId: LOC, expectedSettingId: null, patch: PATCH }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("an UNASSIGNED MoO passes the gate for OTHER — it reaches the RPC (which the stand-in lacks)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const p = saveMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", locationId: OTHER, expectedSettingId: null, patch: PATCH });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(MenuShopError);
  });
  it("retire refuses a row of another menu item", async () => {
    const t = buildRecipeVersionsFixture();
    t.menu_item_shop_settings = [{ id: "ms", menu_item_id: "m-pickle-side", location_id: LOC, based_on_setting_id: null, price: 3, sold_here: true,
      name_override: null, name_override_es: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_by: null }];
    current = createFakeDb(t);
    // A stand-in snapshot: the stand-in database has no rpc(), and this refusal comes from the row read after it.
    expect(await refused(retireMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", locationId: LOC, settingId: "ms", snapshot: { test: true } }))).toEqual({ status: 404, code: "not_found" });
  });
});

describe("the role rule and the named refusals", () => {
  it("the history read: an AGM (6) reads; the social media manager (also 6) is refused by ROLE, before any I/O", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    expect(Array.isArray(await loadMenuItemShopHistory(actor("agm", 6, [LOC]), "m-italian", LOC))).toBe(true);
    current = null;
    expect(await refused(loadMenuItemShopHistory(actor("social_media_mgr", 6, [LOC]), "m-italian", LOC))).toEqual({ status: 403, code: "forbidden" });
  });
  it("every code the writers map has its own en + es message (MENU_ITEM_SHOP_ERROR_CODES)", async () => {
    const { MENU_ITEM_SHOP_ERROR_CODES } = await import("@/lib/menu-item-shop-shared");
    const { readFileSync } = await import("node:fs");
    const rpc = /const RPC_STATUS: Record<string, number> = \{([\s\S]*?)\};/.exec(readFileSync("lib/admin/menu-item-shop.ts", "utf8"))![1]!;
    for (const c of [...rpc.matchAll(/([a-z_]+):/g)].map((m) => m[1]!)) expect(MENU_ITEM_SHOP_ERROR_CODES as readonly string[], c).toContain(c);
  });
});

import { RPC_STATUS, SHOP_OWNED_ERROR_CODES } from "@/lib/catalog/shop-owned-shared";
import { menuShopErrorFromRpc } from "@/lib/admin/menu-item-shop";
describe("ownership transport mapping", () => {
 it.each(SHOP_OWNED_ERROR_CODES)("maps ownership %s from shared statuses", code => {
  expect(() => menuShopErrorFromRpc(`shop_owned:${code}`)).toThrow(expect.objectContaining({ name: "MenuShopError", code, status: RPC_STATUS[code] }));
 });
 it("retains a one-based ownership line", () => {
  expect(() => menuShopErrorFromRpc("shop_owned:line_other_shop:3")).toThrow(expect.objectContaining({ status: 400, line: expect.objectContaining({ position: 3, reason: "line_other_shop" }) }));
 });
 it("retains its native namespace", () => {
  expect(() => menuShopErrorFromRpc("menu_item_shop:dependencies_busy")).toThrow(expect.objectContaining({ status: 409, code: "dependencies_busy" }));
 });
});
