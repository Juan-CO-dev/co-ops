import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeDb } from "./fake-supabase";
const h = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(), audit: vi.fn(), rpc: vi.fn() }));
let db: FakeDb;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: h.step }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
import * as route from "@/app/api/admin/recipes/[id]/outputs/route";
import { updateRecipeOutputYield } from "@/lib/recipes";
import { resolveErrorKey } from "@/components/admin/recipes/shared";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recipe = id(1), owner = id(2), item = id(3);
const gm = { user: { id: id(4), role: "gm" }, role: "gm", level: 7, locations: [owner] } as AuthContext;
const body = { outputItemId: item, expectedOwner: owner, yield: 3 };
const input = { recipeId: recipe, outputItemId: item, yield: 3, context: { source: "recipe_builder", expectedOwner: owner } } as const;
const request = (value: unknown = body, origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/recipes/${recipe}/outputs`, {
  method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value),
});
beforeEach(() => {
  vi.clearAllMocks();
  h.session.mockResolvedValue(gm); h.step.mockReturnValue({ ok: true });
  h.rpc.mockReturnValue({ data: { output_id: id(5), before: 1, after: 3 }, error: null });
  db = fakeSupabase({ recipes: [{ id: recipe, location_id: owner, active: true }] }, { write_owned_recipe: h.rpc });
});
it("edits a sole owned batch output through its existing RPC with Tier E and an audited source", async () => {
  const res = await route.PATCH(request(), { params: Promise.resolve({ id: recipe }) });
  expect(res.status).toBe(200);
  expect(h.step).toHaveBeenCalledWith(gm, "E");
  expect(h.rpc).toHaveBeenCalledWith(expect.objectContaining({ p_expected_owner: owner, p_recipe_id: recipe,
    p_operation: "update_recipe_output_yield", p_payload: expect.objectContaining({ p_output_item_id: item, p_yield: 3 }) }), expect.anything());
  expect(db.writes).toEqual([]);
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "recipe_output.update", metadata: expect.objectContaining({ source: "recipe_builder", location_id: owner }) }));
});
it("refuses cross-origin before session or body and expired edit windows before writing", async () => {
  expect((await route.PATCH(request(body, "http://foreign.example"), { params: Promise.resolve({ id: recipe }) })).status).toBe(403);
  expect(h.session).not.toHaveBeenCalled();
  h.step.mockReturnValue({ ok: false, code: "step_up_stale" });
  expect((await route.PATCH(request(), { params: Promise.resolve({ id: recipe }) })).status).toBe(403);
  expect(h.rpc).not.toHaveBeenCalled();
});
it.each([{}, { ...body, expectedOwner: null }, { ...body, yield: "3" }, { ...body, outputItemId: "bad" }])("refuses malformed editor input", async value => {
  expect((await route.PATCH(request(value), { params: Promise.resolve({ id: recipe }) })).status).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();
});
it("refuses shared-after-preview even for MoO and refuses foreign managers or SMM", async () => {
  db.tables.recipes![0]!.location_id = null;
  await expect(updateRecipeOutputYield({ ...gm, user: { ...gm.user, role: "moo" }, role: "moo", level: 8 }, input)).rejects.toMatchObject({ code: "ownership_changed" });
  db.tables.recipes![0]!.location_id = owner;
  await expect(updateRecipeOutputYield({ ...gm, locations: [id(6)] }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(updateRecipeOutputYield({ ...gm, user: { ...gm.user, role: "social_media_mgr" } }, input)).rejects.toMatchObject({ code: "forbidden" });
  expect(h.rpc).not.toHaveBeenCalled();
});
it.each([["not_batch_recipe", "yield.error.not_batch_recipe"], ["ambiguous_output", "recipes.error.ambiguous_output"],
  ["recipe_inactive", "catalog.error.recipe_inactive"]])("preserves the named yield refusal %s", async (code, key) => {
  h.rpc.mockReturnValue({ data: null, error: { code: "P0001", message: code } });
  const res = await route.PATCH(request(), { params: Promise.resolve({ id: recipe }) });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code });
  expect(h.audit).not.toHaveBeenCalled();
  expect(resolveErrorKey(code!)).toBe(key);
});
