import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn(() => ({ ok: true })) }));
import { requireSession } from "@/lib/session";
import { NextRequest } from "next/server";
import { POST as recipePost } from "@/app/api/admin/recipes/route";
import { POST as menuPost } from "@/app/api/admin/menu-items/route";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createRecipe, createMenuItem, updateRecipe, addRecipeInput, createRecipeFull } from "@/lib/recipes";
const SHOP = "00000000-0000-4000-8000-00000000a0a0";
const OTHER = "00000000-0000-4000-8000-00000000b0b0";
import type { AuthContext } from "@/lib/session";
const actor = { user: { id: "actor", role: "gm" }, level: 7, locations: [SHOP] } as unknown as AuthContext;
const rpc = vi.fn(async () => ({ data: "created", error: null }));
let fake: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(actor);
  fake = createFakeDb({ recipes: [{ id: "recipe", location_id: SHOP, active: true }], locations: [{ id: SHOP, active: true }],
    vendor_items: [{ id: "sku", active: true, location_id: SHOP }], measure_units: [] });
  vi.mocked(getServiceRoleClient).mockReturnValue({ ...fake.client, rpc } as never);
});
it.each(["recipe", "menu"])("refuses explicit global GM %s creation", async kind => {
  await expect(kind === "recipe" ? createRecipe(actor, { name: "R", recipeType: "production", batchYield: 1, locationId: null } as never)
    : createMenuItem(actor, { name: "M", locationId: null } as never)).rejects.toMatchObject({ code: "global_requires_moo" });
  expect(fake.writes).toEqual([]);
});
it("binds owned header mutation to its read owner", async () => {
  await updateRecipe(actor, "recipe", { name: "New" });
  expect(rpc).toHaveBeenCalledWith("write_owned_recipe", expect.objectContaining({ p_recipe_id: "recipe", p_expected_owner: SHOP, p_operation: "update_recipe_atomic" }));
});
it("refuses another shop's header before mutation", async () => {
  const foreign = { ...actor, locations: [OTHER] };
  await expect(updateRecipe(foreign as never, "recipe", { name: "New" })).rejects.toMatchObject({ code: "not_found" });
  expect(rpc).not.toHaveBeenCalled();
});
it("allows an owning GM to add a default input through an owner-bound writer", async () => {
  await expect(addRecipeInput(actor, { recipeId: "recipe", componentSkuId: "sku", quantity: 1 })).resolves.toEqual({ id: "created" });
  expect(rpc).toHaveBeenCalledWith("write_owned_recipe", expect.objectContaining({ p_expected_owner: SHOP, p_operation: "add_recipe_input_atomic" }));
});

it("infers sole shop ownership on omission and never silently creates globally", async () => {
  const created = await createRecipe(actor, { name: "New", recipeType: "production", batchYield: 1 });
  expect(created.id).toBeTruthy();
  expect(fake.writes.find(write => write.table === "recipes")?.rows[0]).toMatchObject({ location_id: SHOP });
});
it("requires explicit scope for multiple memberships", async () => {
  await expect(createMenuItem({ ...actor, locations: [SHOP, OTHER] }, { name: "New" })).rejects.toMatchObject({ code: "location_required" });
  expect(fake.writes).toEqual([]);
});
it("admits explicitly global creation only for an operational MoO", async () => {
  await createMenuItem({ ...actor, user: { ...actor.user, role: "moo" }, level: 8 }, { name: "Global", locationId: null, menuPrice: 12 });
  expect(fake.writes.find(write => write.table === "menu_items")?.rows[0]).toMatchObject({ location_id: null, menu_price: 12 });
});
it("allows an owned GM menu price at creation and excludes social-media role", async () => {
  await createMenuItem(actor, { name: "Owned", locationId: SHOP, menuPrice: 12 });
  expect(fake.writes.find(write => write.table === "menu_items")?.rows[0]).toMatchObject({ location_id: SHOP, menu_price: 12 });
  await expect(createRecipe({ ...actor, user: { ...actor.user, role: "social_media_mgr" } }, { name: "Denied", recipeType: "production", batchYield: 1, locationId: SHOP }))
    .rejects.toMatchObject({ code: "forbidden" });
});
it("maps stale owner refusal without retrying a shared write", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: "shop_owned:ownership_changed", code: "P0001" } } as never);
  await expect(updateRecipe(actor, "recipe", { name: "Changed" })).rejects.toMatchObject({ status: 409, code: "ownership_changed" });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("requires explicit global full recipe creation for a multi-shop MoO", async () => {
  await expect(createRecipeFull({ ...actor, user: { ...actor.user, role: "moo" }, locations: [SHOP, OTHER] }, {
    name: "Full", recipeType: "production", batchYield: 1,
    inputs: [{ componentSkuId: "sku", quantity: 1 }], outputs: [{ outputItemId: "item", yield: 1 }],
  })).rejects.toMatchObject({ code: "location_required" });
  expect(rpc).not.toHaveBeenCalled();
});

it.each([recipePost, menuPost])("preserves explicit global refusal through HTTP", async post => {
  const response = await post(new NextRequest("http://localhost/api/admin/recipes", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Global denied", recipeType: "production", batchYield: 1, locationId: null }) }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "global_requires_moo" });
  expect(fake.writes).toEqual([]);
});
it.each([recipePost, menuPost])("commits explicit owned creation through HTTP", async post => {
  const response = await post(new NextRequest("http://localhost/api/admin/recipes", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owned created", recipeType: "production", batchYield: 1, locationId: SHOP }) }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: expect.any(String) });
  expect(fake.writes[0]?.rows[0]).toMatchObject({ location_id: SHOP });
});
