import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture } from "./fixtures/recipe-versions-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadMenuCostingBoard } from "@/lib/admin/menu-costing";
import { loadSandwiches } from "@/lib/admin/sandwiches";
import { filterSandwiches, sandwichProblems } from "@/lib/admin/sandwiches-shared";

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

it.each([A, B])("is exactly the legacy cost/price/margin rows at %s, plus off-here rows", async scope => {
  const old = await loadMenuCostingBoard(OWNER_ACTOR, { scope });
  const view = await loadSandwiches(OWNER_ACTOR, scope);
  expect(view.rows.filter(row => row.soldHere).map(row => row.id)).toEqual(old.rows.map(row => row.id));
  for (const row of old.rows) expect(view.rows.find(candidate => candidate.id === row.id)).toMatchObject(row);
  const pickle = view.rows.find(row => row.id === "m-pickle-side")!;
  expect(pickle).toMatchObject({ soldHere: scope !== A, menuPrice: scope === A ? 4 : 2.25, toastPriceCents: scope === A ? 400 : 500, toastStatus: scope === A ? "linked" : "price_differs" });
  expect(pickle.rollup.cost).not.toBeNull();
  expect(pickle.marginDollars).toBeCloseTo(pickle.menuPrice! - pickle.rollup.cost!);
  expect(pickle.marginPct).toBeCloseTo(pickle.marginDollars! / pickle.menuPrice! * 100);
  expect(view.globalPrices[pickle.id]).toBe(2.25);
});

it("uses only the selected shop's Toast fallback and same-as price", async () => {
  tables.menu_items!.find(row => row.id === "m-pickle-side")!.menu_price = null;
  tables.menu_items!.find(row => row.id === "m-italian-lunch")!.price_same_as_id = "m-pickle-side";
  tables.menu_item_shop_settings = [];
  for (const [scope, price] of [[A, 4], [B, 5]] as const) {
    const view = await loadSandwiches(OWNER_ACTOR, scope);
    expect(view.rows.find(row => row.id === "m-pickle-side")).toMatchObject({ menuPrice: price, toastStatus: "linked" });
    expect(view.rows.find(row => row.id === "m-italian-lunch")).toMatchObject({ menuPrice: price, toastStatus: "not_linked" });
  }
});

it("costs off-here rows with the selected shop's ingredient-price lane", async () => {
  tables.sku_price_lanes = [{ id: "lane-a", sku_id: "s-pickle", location_id: A, active: true }];
  tables.vendor_price_history!.push({ id: "shop-price", vendor_item_id: "s-pickle", unit_price: 6,
    effective_date: "2026-11-01", recorded_at: "2026-11-01T12:00:00Z", location_id: A, price_lane_id: "lane-a" });
  const a = (await loadSandwiches(OWNER_ACTOR, A)).rows.find(row => row.id === "m-pickle-side")!;
  const b = (await loadSandwiches(OWNER_ACTOR, B)).rows.find(row => row.id === "m-pickle-side")!;
  expect(a.rollup.cost).toBe(1.5);
  expect(b.rollup.cost).toBe(9.99 / 4);
  expect(a.marginDollars).toBe(2.5);
  expect(a.marginPct).toBe(62.5);
});

it("counts affected rows once while listing every cause; filters both names and sold-here", async () => {
  const view = await loadSandwiches(OWNER_ACTOR, A);
  const summary = sandwichProblems(view.rows);
  expect(summary.count).toBe(new Set(Object.values(summary.causes).flat().map(row => row.id)).size);
  expect(summary.causes.no_cost.length).toBeGreaterThan(0);
  expect(summary.causes.not_linked.length).toBeGreaterThan(0);
  expect(filterSandwiches(view.rows, "off", " pepinillos ").map(row => row.id)).toEqual(["m-pickle-side"]);
  expect(filterSandwiches(view.rows, "sold", "pepinillos")).toEqual([]);
  expect(filterSandwiches(view.rows, "all", "PEPINILLOS")).toHaveLength(1);
});

it("keeps mapping evidence independent of missing price caches", async () => {
  tables.toast_menu_cache = [];
  const view = await loadSandwiches(OWNER_ACTOR, A);
  expect(view.toastUnavailable).toBe(true);
  expect(view.rows.find(row => row.id === "m-pickle-side")?.toastStatus).toBe("linked");
  expect(view.rows.find(row => row.id === "m-italian")?.toastStatus).toBe("not_linked");
});

it("refuses SMM by role and foreign shops before I/O; keeps AGM read-only", async () => {
  await expect(loadSandwiches({ ...OWNER_ACTOR, user: { ...OWNER_ACTOR.user, role: "social_media_mgr" } }, A)).rejects.toMatchObject({ status: 403 });
  const agm = { ...OWNER_ACTOR, user: { ...OWNER_ACTOR.user, role: "agm" as const }, locations: [A] };
  await expect(loadSandwiches(agm, B)).rejects.toMatchObject({ status: 404 });
  await expect(loadSandwiches(OWNER_ACTOR, "global")).rejects.toMatchObject({ status: 404 });
  expect(h.db).not.toHaveBeenCalled();
  expect((await loadSandwiches(agm, A)).rows.every(row => !row.canEditPrice)).toBe(true);
});
