import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";

const mocks = vi.hoisted(() => ({ client: vi.fn(), audit: vi.fn(), session: vi.fn(), step: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: mocks.step }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: async () => buildRecipeGraph([], new Map(), new Map()) }));
vi.mock("@/lib/admin/cost", () => ({ COST_READ_MIN: 6, loadCurrentSkuPrices: async () => new Map() }));
import { loadMenuCostingBoard } from "@/lib/admin/menu-costing";
import { updateMenuPrice } from "@/lib/admin/menu-prices";
import { PATCH } from "@/app/api/admin/menu-items/[id]/price/route";
import { NextRequest } from "next/server";
const MENU_NAME = "Counter";
import { costingRows } from "@/lib/report-export-shared";

const id = "00000000-0000-0000-0000-000000000001";
const actor = { user: { id: "actor", role: "owner" } } as AuthContext;
let tables: Record<string, unknown[]>;
let failed: string | null;
let rejected: boolean;
let updateResult: { data: unknown[]; error: unknown };
let writes: unknown[];
let predicates: unknown[];
beforeEach(() => {
  vi.clearAllMocks(); failed = null; rejected = false; writes = []; predicates = [];
  updateResult = { data: [{ id }], error: null };
  const payload = (price: number) => ({ menus: [{ name: MENU_NAME, menuGroups: [{ menuItems: [{ guid: "sub", price }] }] }],
    modifierOptionReferences: { bacon: { guid: "bacon", price: 2 } } });
  tables = {
    menu_items: [{ id, name: "Sub", name_es: null, section: "Subs", menu_price: null, price_same_as_id: null },
      { id: "salad", name: "Salad", name_es: null, section: "Salads", menu_price: null, price_same_as_id: id }],
    toast_menu_map: ["a", "b"].map((location_id) => ({ location_id, menu_item_id: id, toast_item_guid: "sub", match_status: "confirmed", is_modifier: false })),
    toast_menu_cache: [{ restaurant_guid: "ra", payload: payload(12), fetched_at: "2026-10-01T12:00:00Z" },
      { restaurant_guid: "rb", payload: payload(13), fetched_at: "2026-10-02T12:00:00Z" }],
    locations: [{ id: "a", name: "Shop A", toast_restaurant_guid: "ra", toast_in_store_menu_name: MENU_NAME }, { id: "b", name: "Shop B", toast_restaurant_guid: "rb", toast_in_store_menu_name: MENU_NAME }],
  };
  mocks.client.mockReturnValue({ from: (table: string) => {
    let updating = false;
    let status: unknown;
    const result = () => {
      if (failed === table && rejected) return Promise.reject(new Error("private error details"));
      return Promise.resolve(updating ? updateResult : { data: (tables[table] ?? []).filter((row) => status === undefined || (row as { match_status: string }).match_status === status), error: failed === table ? { message: "private error" } : null });
    };
    const q = { select: () => q, eq: (...args: unknown[]) => { predicates.push(args); if (args[0] === "match_status") status = args[1]; return q; }, not: () => q,
      is: (...args: unknown[]) => { predicates.push(args); return q; }, order: () => q,
      update: (value: unknown) => { writes.push(value); updating = true; return q; },
      returns: result, maybeSingle: async () => ({ data: tables[table]?.[0] ?? null, error: failed === table ? {} : null }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => result().then(resolve, reject) };
    return q;
  } });
  mocks.session.mockResolvedValue(actor); mocks.step.mockReturnValue({ ok: true });
});

describe("cache-only costing loader", () => {
  it("joins by shop, uses lowest price, inherits one hop, and reports the oldest cache", async () => {
    const board = await loadMenuCostingBoard(actor);
    expect(board.rows.find((r) => r.id === id)).toMatchObject({ menuPrice: 12, priceSource: "toast", toastPriceVaries: { min: 1200, max: 1300 } });
    expect(board.rows.find((r) => r.id === "salad")).toMatchObject({ menuPrice: 12, priceSource: "same_as", sameAsName: "Sub" });
    expect(board.toastFetchedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(costingRows(board.rows).find((r) => r.menu_item_id === id)?.menu_price).toBe(1200);
  });
  it("uses the modifier lane and does not borrow an item's price from a different shop", async () => {
    tables.toast_menu_map = [
      { location_id: "a", menu_item_id: id, toast_item_guid: "bacon", match_status: "confirmed", is_modifier: true },
      { location_id: "a", menu_item_id: "salad", toast_item_guid: "elsewhere", match_status: "confirmed", is_modifier: false },
    ];
    tables.toast_menu_cache![1] = { restaurant_guid: "rb", fetched_at: "2026-10-02", payload: {
      menus: [{ name: MENU_NAME, menuGroups: [{ menuItems: [{ guid: "elsewhere", price: 99 }] }] }],
    } };
    const board = await loadMenuCostingBoard(actor);
    expect(board.rows.find((r) => r.id === id)?.menuPrice).toBe(2);
    expect(board.rows.find((r) => r.id === "salad")).toMatchObject({ menuPrice: 2, priceSource: "same_as", toastPriceCents: null });
  });
  it.each(["query", "rejection", "missing"])("keeps typed prices and typed-parent inheritance on %s failure", async (kind) => {
    tables.menu_items![0] = { ...(tables.menu_items![0] as object), menu_price: 15 };
    if (kind === "query" || kind === "rejection") { failed = "toast_menu_cache"; rejected = kind === "rejection"; }
    if (kind === "missing") tables.toast_menu_cache = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const board = await loadMenuCostingBoard(actor);
    expect(board.toastUnavailable).toBe(true);
    expect(board.rows.find((r) => r.id === id)?.menuPrice).toBe(15);
    expect(board.rows.find((r) => r.id === "salad")?.menuPrice).toBe(15);
    expect(warn).toHaveBeenCalledWith("menu_costing_toast_cache_unavailable"); warn.mockRestore();
  });
});

describe("price writer", () => {
  it("refuses lower levels and invalid prices before I/O", async () => {
    await expect(updateMenuPrice({ user: { role: "agm" } } as AuthContext, id, 1, null)).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateMenuPrice(actor, id, "1", null)).rejects.toMatchObject({ code: "invalid_menu_price" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("saves and audits before/after, including clearing", async () => {
    await updateMenuPrice(actor, id, 15.79, null);
    expect(writes[0]).toMatchObject({ menu_price: 15.79 });
    expect(predicates).toContainEqual(["menu_price", null]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "menu_item.update", metadata: expect.objectContaining({ before: { menu_price: null }, after: { menu_price: 15.79 } }) }));
    tables.menu_items![0] = { menu_price: 15.79 };
    await updateMenuPrice(actor, id, null, 15.79);
    expect(writes[1]).toMatchObject({ menu_price: null });
    expect(predicates).toContainEqual(["menu_price", 15.79]);
  });
  it("does not audit no-ops, lost updates or failed writes", async () => {
    await updateMenuPrice(actor, id, null, null); expect(writes).toHaveLength(0);
    updateResult.data = [];
    await expect(updateMenuPrice(actor, id, 10, null)).rejects.toMatchObject({ code: "menu_price_changed" });
    updateResult.error = {};
    await expect(updateMenuPrice(actor, id, 10, null)).rejects.toMatchObject({ code: "internal_error" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

function request(body: unknown) {
  return PATCH(new NextRequest(`http://localhost/api/admin/menu-items/${id}/price`, { method: "PATCH", headers: { origin: "http://localhost" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
describe("PATCH price", () => {
  it("requires session, GM floor, and the Tier E edit window", async () => {
    mocks.session.mockResolvedValue(new Response(null, { status: 401 })); expect((await request({ menuPrice: 1 })).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { role: "agm" } }); expect((await request({ menuPrice: 1 })).status).toBe(403);
    mocks.session.mockResolvedValue(actor); mocks.step.mockReturnValue({ ok: false, code: "step_up_stale" });
    expect((await request({ menuPrice: 1 })).status).toBe(403);
    expect(mocks.step).toHaveBeenCalledWith(actor, "E"); expect(writes).toHaveLength(0);
  });
  it.each([null, [], {}, { menuPrice: "12", expectedMenuPrice: null }, { menuPrice: 0, expectedMenuPrice: null }, { menuPrice: 1.001, expectedMenuPrice: null }])("rejects invalid body %j", async (body) => {
    expect((await request(body)).status).toBe(400); expect(writes).toHaveLength(0);
  });
  it("accepts dollars and explicit null", async () => {
    expect((await request({ menuPrice: 12, expectedMenuPrice: null })).status).toBe(200);
    tables.menu_items![0] = { menu_price: 12 };
    expect((await request({ menuPrice: null, expectedMenuPrice: 12 })).status).toBe(200);
    expect(writes).toHaveLength(2);
  });
});

it("loads only confirmed mappings and never imports the Toast API", async () => {
  tables.toast_menu_map = [
    { location_id: "a", menu_item_id: id, toast_item_guid: "bacon", is_modifier: true, match_status: "confirmed" },
    { location_id: "a", menu_item_id: id, toast_item_guid: "sub", is_modifier: false, match_status: "rejected" },
    { location_id: "b", menu_item_id: id, toast_item_guid: "sub", is_modifier: false, match_status: "pending" },
  ];
  expect((await loadMenuCostingBoard(actor)).rows.find((r) => r.id === id)?.menuPrice).toBe(2);
  expect(predicates).toContainEqual(["match_status", "confirmed"]);
  for (const path of ["lib/admin/menu-costing.ts", "lib/admin/menu-costing-toast.ts"]) {
    expect(readFileSync(path, "utf8")).not.toMatch(/@\/lib\/toast\/(?:client|menus)["']/);
  }
});
it.each(["missing", "malformed"])("keeps the healthy shop when the other cache is %s", async (kind) => {
  if (kind === "missing") tables.toast_menu_cache!.shift();
  else tables.toast_menu_cache![0] = { restaurant_guid: "ra", payload: {}, fetched_at: "2026-10-01" };
  const board = await loadMenuCostingBoard(actor);
  expect(board.rows.find((r) => r.id === id)?.menuPrice).toBe(13);
  expect(board.toastUnavailable).toBe(false);
  expect(board.toastNotices).toEqual([{ locationName: "Shop A", reason: "unavailable" }]);
  expect(board.toastFetchedAt).toBe("2026-10-02T12:00:00.000Z");
});
it("names a shop missing the in-store menu while keeping its modifier prices", async () => {
  tables.toast_menu_cache![0] = { restaurant_guid: "ra", fetched_at: "2026-10-01", payload: {
    menus: [{ name: "Delivery", menuGroups: [{ menuItems: [{ guid: "sub", price: 99 }] }] }],
    modifierOptionReferences: { bacon: { guid: "bacon", price: 2 } },
  } };
  tables.toast_menu_map!.push({ location_id: "a", menu_item_id: "salad", toast_item_guid: "bacon", is_modifier: true, match_status: "confirmed" });
  const board = await loadMenuCostingBoard(actor);
  expect(board.rows.find((r) => r.id === id)?.menuPrice).toBe(13);
  expect(board.rows.find((r) => r.id === "salad")?.menuPrice).toBe(2);
  expect(board.toastNotices).toEqual([{ locationName: "Shop A", reason: "menu_missing" }]);
});
it("refuses catering clears but accepts a typed replacement", async () => {
  tables.menu_items![0] = { menu_price: "12.00", catering_available: true };
  const response = await request({ menuPrice: null, expectedMenuPrice: 12 });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "menu_price_catering_required" });
  expect(writes).toHaveLength(0);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect((await request({ menuPrice: 13, expectedMenuPrice: 12 })).status).toBe(200);
});
it.each([null, 11])("refuses a stale tab with expected price %s before writing", async (expectedMenuPrice) => {
  tables.menu_items![0] = { menu_price: 12, catering_available: false };
  const response = await request({ menuPrice: 12, expectedMenuPrice });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "menu_price_changed" });
  expect(writes).toHaveLength(0);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("requires an explicit expected price", async () => {
  expect((await request({ menuPrice: 12 })).status).toBe(400);
});

it.each([null, "", "   "])("unset shop menu %s drops item prices but keeps modifiers", async (menuName) => {
  tables.locations![0] = { ...(tables.locations![0] as object), toast_in_store_menu_name: menuName };
  tables.toast_menu_map!.push({ location_id: "a", menu_item_id: "salad", toast_item_guid: "bacon", is_modifier: true, match_status: "confirmed" });
  const board = await loadMenuCostingBoard(actor);
  expect(board.rows.find(r => r.id === id)?.menuPrice).toBe(13);
  expect(board.rows.find(r => r.id === "salad")?.menuPrice).toBe(2);
  expect(board.toastNotices).toEqual([{ locationName: "Shop A", reason: "menu_not_set" }]);
});
it("uses per-shop menu names even when shops share a Toast restaurant", async () => {
  tables.locations![1] = { ...(tables.locations![1] as object), toast_restaurant_guid: "ra", toast_in_store_menu_name: "Other counter" };
  tables.toast_menu_map = [{ location_id: "a", menu_item_id: id, toast_item_guid: "sub", is_modifier: false, match_status: "confirmed" }];
  const payload = (tables.toast_menu_cache![0] as { payload: { menus: unknown[] } }).payload;
  payload.menus.push({ name: "Other counter", menuGroups: [{ menuItems: [{ guid: "sub", price: 4 }] }] });
  expect((await loadMenuCostingBoard(actor)).rows.find(r => r.id === id)?.menuPrice).toBe(12);
  tables.toast_menu_map.push({ location_id: "b", menu_item_id: id, toast_item_guid: "sub", is_modifier: false, match_status: "confirmed" });
  expect((await loadMenuCostingBoard(actor)).rows.find(r => r.id === id)?.toastPriceVaries).toEqual({ min: 400, max: 1200 });
});
it.each([
  ["confirmed", true, 0, true], ["pending", true, 0, false], ["rejected", true, 0, false],
  ["confirmed", false, 0, false], ["confirmed", true, -1, false], ["confirmed", true, 0.001, false],
] as const)("included uses confirmed modifier zero evidence (%s, %s, %s)", async (status, modifier, price, included) => {
  tables.menu_items![0] = { ...(tables.menu_items![0] as object), section: "Modifier builds" };
  tables.toast_menu_map = [{ location_id: "a", menu_item_id: id, toast_item_guid: "free", is_modifier: modifier, match_status: status }];
  tables.toast_menu_cache![0] = { restaurant_guid: "ra", fetched_at: "2026-10-01", payload: {
    menus: [], modifierOptionReferences: { free: { guid: "free", price } },
  } };
  expect((await loadMenuCostingBoard(actor)).rows.find(r => r.id === id)).toMatchObject({ menuPrice: null, includedInSubPrice: included });
});
