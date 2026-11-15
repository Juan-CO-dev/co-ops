/**
 * W08/B054 — the three legacy item writers (sold-directly, item type, catering flags) read the
 * row's owner shop, refuse another shop's OWN row with 404, and bind the UPDATE to that owner.
 * Shared rows (location_id null) keep today's GM floor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, OWNED } from "./fixtures/shop-owned-fixture";
import { LOC } from "./fixtures/recipe-versions-fixture";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { setItemSoldDirectly } from "@/lib/recipes";
import { setItemType } from "@/lib/admin/catalog";
import { setCateringFlags } from "@/lib/admin/catering/menu";

const gm = { user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: [LOC] } as unknown as AuthContext;
let tables: ReturnType<typeof buildShopOwnedFixture>;

beforeEach(() => {
  tables = buildShopOwnedFixture();
  const foreign = tables.items!.find(r => r.id === OWNED[1].item)!;
  Object.assign(foreign, { sold_directly: true, sell_portion: 4, sell_portion_unit: "oz", item_type: "prepped",
    catering_available: false, catering_only: false, seasonal: false });
  const mine = tables.items!.find(r => r.id === OWNED[0].item)!;
  Object.assign(mine, { item_type: "prepped", catering_available: false, catering_only: false, seasonal: false });
  const shared = tables.items!.find(r => r.id === "i-slaw")!;
  Object.assign(shared, { item_type: "prepped", catering_available: false, catering_only: false, seasonal: false });
  for (const m of tables.menu_items!) Object.assign(m, { catering_only: false, catering_portionable: false, serves: null });
  current = createFakeDb(tables);
});

const row = (table: string, id: string) => tables[table]!.find(r => r.id === id)!;

describe("W08/B054 legacy item writers bind the owner shop", () => {
  it("setItemSoldDirectly refuses the other shop's owned item", async () => {
    await expect(setItemSoldDirectly(gm, { itemId: OWNED[1].item, soldDirectly: false }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(row("items", OWNED[1].item)).toMatchObject({ sold_directly: true, sell_portion: 4, sell_portion_unit: "oz" });
  });

  it("setItemType refuses the other shop's owned item", async () => {
    await expect(setItemType(gm, { itemId: OWNED[1].item, itemType: "on_hand" }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(row("items", OWNED[1].item).item_type).toBe("prepped");
  });

  it("setCateringFlags refuses the other shop's owned item and menu item", async () => {
    await expect(setCateringFlags(gm, "item", OWNED[1].item, { seasonal: true }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(setCateringFlags(gm, "menu_item", OWNED[1].menu, { serves: 4 }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(row("items", OWNED[1].item).seasonal).toBe(false);
    expect(row("menu_items", OWNED[1].menu).serves).toBeNull();
  });

  it("own-shop owned and shared items still accept the edit", async () => {
    await setItemSoldDirectly(gm, { itemId: OWNED[0].item, soldDirectly: true, sellPortion: 2, sellPortionUnit: "oz" });
    await setItemSoldDirectly(gm, { itemId: "i-slaw", soldDirectly: true, sellPortion: 3, sellPortionUnit: "oz" });
    expect(row("items", OWNED[0].item)).toMatchObject({ sold_directly: true, sell_portion: 2 });
    expect(row("items", "i-slaw")).toMatchObject({ sold_directly: true, sell_portion: 3 });

    await setItemType(gm, { itemId: OWNED[0].item, itemType: "on_hand" });
    await setItemType(gm, { itemId: "i-slaw", itemType: "sold_as_is" });
    expect(row("items", OWNED[0].item).item_type).toBe("on_hand");
    expect(row("items", "i-slaw").item_type).toBe("sold_as_is");

    await setCateringFlags(gm, "item", OWNED[0].item, { seasonal: true });
    await setCateringFlags(gm, "item", "i-slaw", { seasonal: true });
    await setCateringFlags(gm, "menu_item", OWNED[0].menu, { serves: 4 });
    await setCateringFlags(gm, "menu_item", "m-italian", { serves: 6 });
    expect(row("items", OWNED[0].item).seasonal).toBe(true);
    expect(row("items", "i-slaw").seasonal).toBe(true);
    expect(row("menu_items", OWNED[0].menu).serves).toBe(4);
    expect(row("menu_items", "m-italian").serves).toBe(6);
  });

  it("MoO may edit either shop's owned item", async () => {
    const moo = { user: { id: "u-moo", role: "moo" }, role: "moo", level: 8, locations: [LOC] } as unknown as AuthContext;
    await setItemType(moo, { itemId: OWNED[1].item, itemType: "on_hand" });
    expect(row("items", OWNED[1].item).item_type).toBe("on_hand");
  });
});
