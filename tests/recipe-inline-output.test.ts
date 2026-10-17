import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRecipeFull, type RecipeDraft } from "@/lib/recipes";
import { POST } from "@/app/api/admin/recipes/full/route";
import type { AuthContext } from "@/lib/session";

const state = vi.hoisted(() => ({ rpc: vi.fn(), actor: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc: state.rpc, from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "shop" }, error: null }) }; return q; } }) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/session", () => ({ requireSession: async () => state.actor }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => ({ ok: true }) }));
const SHOP = "10000000-0000-0000-0000-000000000001";
const OTHER = "10000000-0000-0000-0000-000000000002";
const actor = { user: { id: "20000000-0000-0000-0000-000000000001", role: "gm" }, locations: [SHOP] } as AuthContext;
const draft = (): RecipeDraft => ({
  locationId: SHOP, name: "Shop prep", recipeType: "production", batchYield: 1, batchMode: true,
  inputs: [{ componentSkuId: "30000000-0000-0000-0000-000000000001", quantity: 2, unit: "oz" }],
  outputs: [{ newItem: { name: " Prep output ", nameEs: " Preparado ", section: "sauces", recommendedPar: 2,
    recommendedParUnit: "quart", specialInstruction: " Chill ", specialInstructionEs: " Enfría ", required: true, minRoleLevel: 2 }, yield: 3 }],
});
beforeEach(() => {
  state.actor = actor;
  state.rpc.mockReset().mockResolvedValue({ data: { id: "recipe-created", output_item_ids: ["item-created"] }, error: null });
});

describe("owned inline output payload", () => {
  it("creates through one atomic RPC and returns committed identities", async () => {
    expect(await createRecipeFull(actor, draft())).toEqual({ id: "recipe-created", outputItemIds: ["item-created"] });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith("create_shop_recipe", expect.objectContaining({
      p_location_id: SHOP, p_created_by: actor.user.id,
      p_outputs: [expect.objectContaining({ output_item_id: null, output_menu_item_id: null, yield: 3,
        new_item: { name: "Prep output", name_es: "Preparado", section: "sauces", recommended_par: 2,
          recommended_par_unit: "quart", special_instructions: "Chill", special_instructions_es: "Enfría", required: true, min_role_level: 2 } })],
    }));
  });
  it.each(["outputItemId", "outputMenuItemId"] as const)("refuses newItem combined with %s before I/O", async key => {
    const d = draft(); d.batchMode = false; d.outputs[0]![key] = "existing";
    await expect(createRecipeFull(actor, d)).rejects.toMatchObject({ status: 400, code: "invalid_output" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("refuses invalid registry par %s before serialization", async par => {
    const d = draft(); d.outputs[0]!.newItem!.recommendedPar = par;
    await expect(createRecipeFull(actor, d)).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("refuses foreign and explicit global scope for a GM before I/O", async () => {
    await expect(createRecipeFull(actor, { ...draft(), locationId: OTHER })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(createRecipeFull(actor, { ...draft(), locationId: null })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["nameEs", "recommendedParUnit", "specialInstruction", "specialInstructionEs", "minRoleLevel", "required"])("refuses malformed inline field %s", async key => {
    const d = draft();
    Object.assign(d.outputs[0]!.newItem!, { [key]: {} });
    await expect(createRecipeFull(actor, d)).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["bad", [], 1, false])("refuses a non-object inline definition %j", async malformed => {
    const d = draft();
    Object.assign(d.outputs[0]!, { newItem: malformed });
    await expect(createRecipeFull(actor, d)).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("resolves an omitted scope to the GM sole shop for inline creation", async () => {
    const d = draft(); delete d.locationId;
    await expect(createRecipeFull(actor, d)).resolves.toEqual({ id: "recipe-created", outputItemIds: ["item-created"] });
    expect(state.rpc).toHaveBeenCalledWith("create_shop_recipe", expect.objectContaining({ p_location_id: SHOP }));
  });
  it("keeps the full HTTP id key and adds committed output identities", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/recipes/full", { method: "POST", body: JSON.stringify(draft()), headers: { origin: "http://localhost", "content-type": "application/json" } }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "recipe-created", outputItemIds: ["item-created"] });
    expect(state.rpc).toHaveBeenCalledWith("create_shop_recipe", expect.objectContaining({ p_outputs: [expect.objectContaining({ new_item: expect.objectContaining({ name: "Prep output" }) })] }));
  });
  it("preserves positional ownership refusals through HTTP", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "shop_owned:line_other_shop:1" } });
    const response = await POST(new NextRequest("http://localhost/api/admin/recipes/full", { method: "POST", body: JSON.stringify(draft()), headers: { origin: "http://localhost", "content-type": "application/json" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "line_other_shop", line: { position: 1, reason: "line_other_shop" } });
  });
});

// Missing cited identities must produce a client refusal, including the inline atomic path.
it.each([
  ["23503", "recipe_inputs_component_sku_id_fkey", 400, "invalid_component"],
  ["P0001", "recipe_version:dependencies_busy", 409, "dependencies_busy"],
] as const)("maps %s / %s through the full recipe HTTP route", async (dbCode, message, status, code) => {
  state.rpc.mockResolvedValue({ data: null, error: { code: dbCode, message } });
  const response = await POST(new NextRequest("http://localhost/api/admin/recipes/full", {
    method: "POST", body: JSON.stringify(draft()), headers: { origin: "http://localhost", "content-type": "application/json" },
  }));
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code });
});

it("rethrows an unrelated FK with its constraint for server logging and a framework 500", async () => {
  const message = 'insert or update violates foreign key constraint "recipes_created_by_fkey"';
  state.rpc.mockResolvedValue({ data: null, error: { code: "23503", message } });
  await expect(POST(new NextRequest("http://localhost/api/admin/recipes/full", {
    method: "POST", body: JSON.stringify(draft()), headers: { origin: "http://localhost", "content-type": "application/json" },
  }))).rejects.toThrow(`createRecipeFull rpc: ${message}`);
});
