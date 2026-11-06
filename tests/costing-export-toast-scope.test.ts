import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture } from "./fixtures/recipe-versions-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadMenuCostingBoard } from "@/lib/admin/menu-costing";

import { loadExportTable } from "@/lib/report-export";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const h = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
let tables: ReturnType<typeof buildRecipeVersionsFixture>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = buildRecipeVersionsFixture();
  tables.locations = [A, B].map((id, i) => ({ id, name: `Shop ${i}`, active: true, toast_restaurant_guid: `restaurant-${i}`, toast_in_store_menu_name: "Counter" }));
  tables.toast_menu_map = [A, B].map(location_id => ({ location_id, menu_item_id: "m-pickle-side", toast_item_guid: "pickle", active: true, match_status: "confirmed", is_modifier: false }));
  tables.toast_menu_cache = [4, 5].map((price, i) => ({ restaurant_guid: `restaurant-${i}`, fetched_at: "2026-11-01T12:00:00Z", payload: { menus: [{ name: "Counter", menuGroups: [{ menuItems: [{ guid: "pickle", price }] }] }] } }));
  tables.menu_item_shop_settings = [{ id: "setting", menu_item_id: "m-pickle-side", location_id: A, price: 4, sold_here: false, name_override: null, name_override_es: null, active: true, valid_to: null, valid_from: "2026-11-01T12:00:00Z" }];
  h.db.mockImplementation(() => createFakeDb(tables).client);
});

it("shop exports use only their Toast fallback; global keeps the cross-shop minimum and varies", async () => {
  tables.menu_item_shop_settings = [];
  tables.menu_items!.find(row => row.id === "m-pickle-side")!.menu_price = null;
  const agm = { ...OWNER_ACTOR, user: { ...OWNER_ACTOR.user, role: "agm" as const }, level: 6, locations: [A, B] };
  for (const [location, cents] of [[A, 400], [B, 500], [undefined, 400], ["global", 400]] as const) {
    const exported = await loadExportTable(agm, "costing", { location });
    expect(exported.rows.find(row => row.menu_item_id === "m-pickle-side")?.menu_price).toBe(cents);
    const board = await loadMenuCostingBoard(agm, { scope: location === "global" ? null : location });
    expect(board.rows.find(row => row.id === "m-pickle-side")?.toastPriceVaries).toEqual(location === undefined || location === "global" ? { min: 400, max: 500 } : null);
  }
});
it("an item mapped only at the other shop stays unpriced in this shop's export", async () => {
  tables.menu_item_shop_settings = [];
  tables.menu_items!.find(row => row.id === "m-pickle-side")!.menu_price = null;
  tables.toast_menu_map = tables.toast_menu_map!.filter(row => row.location_id === B);
  const here = await loadExportTable(OWNER_ACTOR, "costing", { location: A });
  expect(here.rows.find(row => row.menu_item_id === "m-pickle-side")?.menu_price).toBeNull();
  const global = await loadExportTable(OWNER_ACTOR, "costing", {});
  expect(global.rows.find(row => row.menu_item_id === "m-pickle-side")?.menu_price).toBe(500);
});
