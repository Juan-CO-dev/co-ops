import { beforeEach, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeDb } from "./fake-supabase";
import type { AuthContext } from "@/lib/session";
let db: FakeDb;
const h = vi.hoisted(() => ({ graph: vi.fn(), prices: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: h.graph }));
vi.mock("@/lib/admin/cost", () => ({ loadCurrentSkuPrices: h.prices }));
vi.mock("@/lib/menu-costing-shared", () => ({ costPerOzFromGraph: () => new Map(), rollupMenuItemCost: () => ({ cost: 4 }) }));
vi.mock("@/lib/catalog/recipe-item", () => ({ loadActiveShops: async () => [{ id: A, name: "A" }, { id: B, name: "B" }] }));
vi.mock("@/lib/admin/menu-prices", () => ({ updateMenuPrice: h.write, MenuPriceError: class extends Error {} }));
import { loadMenuItemPageView, computeMenuPreview, applyMenuChange } from "@/lib/catalog/menu-item-page";
import { parseMenuChange } from "@/lib/catalog/recipe-item-shared";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const gm = { user: { id: "u", role: "gm" }, level: 7, locations: [A] } as AuthContext;
const change = { kind: "owned_price", expectedOwner: A, expectedPrice: 10, price: 12 } as const;
beforeEach(() => {
  vi.clearAllMocks(); h.graph.mockResolvedValue({ skuPack: new Map() }); h.prices.mockResolvedValue(new Map());
  db = fakeSupabase({ menu_items: [{ id: ID, name: "Sandwich", name_es: null, menu_price: 10, location_id: A, active: true }], recipe_outputs: [], toast_menu_map: [] });
});
it("owned GM reads owner shop costs and direct capabilities without shop settings", async () => {
  const view = await loadMenuItemPageView(gm, ID, A);
  expect(view?.owner).toEqual({ locationId: A, name: "A" });
  expect(view?.can).toMatchObject({ editOwned: true, share: false, editShop: false, promote: false, shopsToEdit: [] });
  expect(h.graph).toHaveBeenCalledWith({ locationId: A });
  expect(view?.history).toEqual([]);
});
it("null visibility and foreign membership do not expose an owned sandwich", async () => {
  expect(await loadMenuItemPageView(gm, ID, null)).toBeNull();
  expect(await loadMenuItemPageView({ ...gm, locations: [B] }, ID, A)).toBeNull();
  await expect(loadMenuItemPageView({ ...gm, level: 6, user: { ...gm.user, role: "social_media_mgr" } }, ID, A)).rejects.toMatchObject({ code: "forbidden" });
});
it("owned price parser binds owner and original price, rejecting absent or invalid baselines", () => {
  expect(parseMenuChange(change)).toEqual({ ok: true, change });
  expect(parseMenuChange({ ...change, expectedOwner: undefined }).ok).toBe(false);
  expect(parseMenuChange({ ...change, expectedPrice: -1 }).ok).toBe(false);
});
it("owned price preview costs the owning shop and forwards immutable owner and price baseline", async () => {
  const preview = await computeMenuPreview(gm, ID, change);
  expect(preview).toMatchObject({ kind: "owned_price", shopId: A, before: { price: 10 }, after: { price: 12 }, cost: 4 });
  await applyMenuChange(gm, ID, change, preview.token);
  expect(h.write).toHaveBeenCalledWith(gm, ID, 12, 10, A);
});
it("sharing after preview refuses even for MoO and never invokes the price writer", async () => {
  const moo = { ...gm, level: 8, user: { ...gm.user, role: "moo" as const } };
  const preview = await computeMenuPreview(moo, ID, change);
  db.tables.menu_items![0]!.location_id = null;
  await expect(applyMenuChange(moo, ID, change, preview.token)).rejects.toMatchObject({ code: "ownership_changed" });
  expect(h.write).not.toHaveBeenCalled();
});

it("foreign GM and SMM cannot preview an owned price, while MoO may share", async () => {
  await expect(computeMenuPreview({ ...gm, locations: [B] }, ID, change)).rejects.toMatchObject({ code: "not_found" });
  await expect(computeMenuPreview({ ...gm, level: 6, user: { ...gm.user, role: "social_media_mgr" } }, ID, change)).rejects.toMatchObject({ code: "forbidden" });
  const moo = { ...gm, level: 8, user: { ...gm.user, role: "moo" as const } };
  expect((await loadMenuItemPageView(moo, ID, A))?.can.share).toBe(true);
});

it("a moved price refuses the captured baseline without invoking a writer", async () => {
  db.tables.menu_items![0]!.menu_price = 11;
  await expect(computeMenuPreview(gm, ID, change)).rejects.toMatchObject({ code: "menu_price_changed" });
  expect(h.write).not.toHaveBeenCalled();
});

it.each([
  { kind: "save", shopId: A, patch: { price: 12, soldHere: true, nameOverride: null, nameOverrideEs: null } },
  { kind: "restore", shopId: A, fromSettingId: ID },
  { kind: "back_to_default", shopId: A },
] as const)("owned item refuses $kind preview and apply before settings/cost reads", async request => {
  await expect(computeMenuPreview(gm, ID, request)).rejects.toMatchObject({ status: 409, code: "menu_item_has_no_shop_settings" });
  await expect(applyMenuChange(gm, ID, request, "old-token")).rejects.toMatchObject({ status: 409, code: "menu_item_has_no_shop_settings" });
  expect(h.graph).not.toHaveBeenCalled();
  expect(h.write).not.toHaveBeenCalled();
});
