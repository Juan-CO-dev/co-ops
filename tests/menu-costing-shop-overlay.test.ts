/**
 * Catalog Phase 3a — the costing board's shop view reads the menu overlay; other shops and "All shops"
 * do not move; the Toast matcher passes the shop to its pool.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadMenuCostingBoard } from "@/lib/admin/menu-costing";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => {
  const t = buildRecipeVersionsFixture();
  const row = (id: string, menuItem: string, over: Record<string, unknown>) => ({
    id, menu_item_id: menuItem, location_id: LOC, based_on_setting_id: null, price: null, sold_here: true,
    name_override: null, name_override_es: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_by: null, ...over,
  });
  t.menu_item_shop_settings = [
    row("ms-1", "m-italian", { price: 13.5, name_override: "Italian (P St)" }),
    row("ms-2", "m-pickle-side", { sold_here: false }),
  ];
  current = createFakeDb(t);
});
afterEach(() => { current = null; });

const pick = (rows: Array<{ id: string; name: string; menuPrice: number | null; priceSource?: string | null; sameAsName?: string | null }>) =>
  Object.fromEntries(rows.map((r) => [r.id, { name: r.name, price: r.menuPrice, source: r.priceSource ?? null, sameAs: r.sameAsName ?? null }]));

describe("the board's shop view reads each menu item through its shop overlay", () => {
  it("LOC: the Italian at $13.50 under its name here; the lunch Italian inherits it; the pickle side is off the board", async () => {
    const board = await loadMenuCostingBoard(OWNER_ACTOR, { scope: LOC });
    const rows = pick(board.rows);
    expect(rows["m-italian"]).toEqual({ name: "Italian (P St)", price: 13.5, source: "typed", sameAs: null });
    expect(rows["m-italian-lunch"]).toMatchObject({ price: 13.5, source: "same_as", sameAs: "Italian (P St)" });
    expect(rows["m-pickle-side"]).toBeUndefined();
    expect(board.notSoldHere).toEqual([{ id: "m-pickle-side", name: "Pickle side", nameEs: "Pepinillos" }]);
  });
  it("OTHER and All shops do not move", async () => {
    for (const scope of [OTHER, null]) {
      const board = await loadMenuCostingBoard(OWNER_ACTOR, scope === null ? {} : { scope });
      const rows = pick(board.rows);
      expect(rows["m-italian"]).toMatchObject({ name: "Italian", price: 12.5 });
      expect(rows["m-pickle-side"]).toMatchObject({ price: 2.25 });
      expect(board.notSoldHere).toEqual([]);
    }
  });
});

describe("the Toast matcher's pool is the shop's", () => {
  it("auto-match and drift pass the shop to loadEntities; the global views do not", () => {
    const src = readFileSync("lib/admin/toast-map.ts", "utf8");
    expect(src.match(/loadEntities\(false, locationId\)/g)?.length).toBe(2);
    expect(src).toContain("await loadEntities(true, locationId);");
    expect(src).toContain("applyMenuOverlayToEntities(entities, await loadLiveMenuItemShopSettings(locationId))");
  });
});
