import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { catalogWriteError } from "@/lib/catalog/write-errors-shared";
import { SHOP_OWNED_ERROR_CODES, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";

class RouteError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

// Route catches stay unchanged: the database boundary returns their existing error class.
// Keep the trigger-reaching routes and their mapped write sites explicit.
const routes = [
  ["catering/menu/[id]", "catering/menu", "AdminCateringMenuError", "setCateringFlags update"],
  ["checklist-templates/[id]/items/[itemId]", "templates", "AdminTemplateError", "updatePrepItemContent item update"],
  ["checklist-templates/[id]/items/[itemId]/definition", "templates", "AdminTemplateError", "updatePrepItemContent item update"],
  ["checklist-templates/[id]/items/[itemId]/promote", "templates", "AdminTemplateError", "promoteItemToGlobal update failed"],
  ["checklist-templates/registry/[itemId]", "templates", "AdminTemplateError", "updateRegistryItemDefinition update failed"],
  ["checklist-templates/[id]/items", "templates", "AdminTemplateError", "addPrepItem item insert failed"],
  ["checklist-templates/registry/[itemId]/default", "templates", "AdminTemplateError", "setItemDefault update failed"],
  ["checklist-templates/registry", "templates", "AdminTemplateError", "addRegistryItem insert failed"],
  ["skus", "skus", "AdminSkuError", "createSku insert failed"],
  ["skus/[id]", "skus", "AdminSkuError", "updateSku failed"],
  ["toast-map/match", "toast-map", "AdminToastMapError", "toast-map candidate insert"],
  ["toast-map/match", "toast-map", "AdminToastMapError", "toast-map modifier candidate insert"],
  ["toast-map/manual", "toast-map", "AdminToastMapError", "toast-map manual insert"],
  ["toast-map/[id]", "toast-map", "AdminToastMapError", "toast-map supersede"],
  ["toast-map/[id]", "toast-map", "AdminToastMapError", "toast-map unmap"],
  ["toast-map/manual", "toast-map", "AdminToastMapError", "toast-map manual supersede"],
] as const;

describe("ownership refusal mapping on legacy catalog routes", () => {
  it.each(routes)("%s retains named 4xx for %s / %s / %s", (route, lib, errorClass, context) => {
    const source = readFileSync(`lib/admin/${lib}.ts`, "utf8");
    expect(source).toMatch(new RegExp(`catalogWriteError\\(\\w+, ${errorClass}, "${context}"\\)`));
    expect(readFileSync(`app/api/admin/${route}/route.ts`, "utf8")).toContain(`if (e instanceof ${errorClass}) return jsonError(e.status, e.code`);
  });
  it.each(SHOP_OWNED_ERROR_CODES)("maps %s through the route's existing domain class", code => {
    const error = catalogWriteError({ code: "P0001", message: `shop_owned:${code}` }, RouteError, "write");
    expect(error).toBeInstanceOf(RouteError);
    expect(error).toMatchObject({ code, status: expect.any(Number), message: code });
    expect((error as RouteError).status).toBeGreaterThanOrEqual(400);
    expect((error as RouteError).status).toBeLessThan(500);
  });
  it("maps busy and foreign-key errors without exposing database details", () => {
    expect(catalogWriteError({ message: "recipe_version:dependencies_busy" }, RouteError, "write"))
      .toMatchObject({ status: 409, code: "dependencies_busy", message: "dependencies_busy" });
    expect(catalogWriteError({ code: "23503", message: 'insert or update on table "recipe_inputs" violates foreign key constraint "recipe_inputs_component_sku_id_fkey"' }, RouteError, "write"))
      .toMatchObject({ status: 400, code: "invalid_component", message: "invalid_component" });
    expect(catalogWriteError(new ShopOwnedError(400, "output_other_shop"), RouteError, "write"))
      .toMatchObject({ status: 400, code: "output_other_shop" });
  });
  it.each(["shop_owned:unknown", "shop_owned:line_other_shop:0", "shop_owned:output_other_shop:1", "recipe_version:dependencies_busy:extra", "database offline"])("leaves unexpected error %s as a server failure", message => {
    expect(catalogWriteError({ message }, RouteError, "write")).not.toBeInstanceOf(RouteError);
  });
});

// These legacy endpoints journal new version lines even for an edit/removal.
const recipeRoutes = [
  ["recipes", "createRecipe"],
  ["recipes/[id]", "updateRecipe update_recipe_atomic"],
  ["recipes/[id]", "deactivateRecipe"],
  ["menu-items", "createMenuItem"],
  ["recipes/[id]/inputs", "addRecipeInput"],
  ["recipes/[id]/inputs/[inputId]", "updateRecipeInput"],
  ["recipes/[id]/outputs", "addRecipeOutput"],
  ["recipes/edges", "removeRecipeEdge"],
] as const;
it.each(recipeRoutes)("legacy %s maps its ownership refusal at %s", (route, context) => {
  expect(readFileSync("lib/recipes.ts", "utf8")).toMatch(new RegExp(`catalogWriteError\\(\\w+, RecipeError, "${context}"\\)`));
  expect(readFileSync(`app/api/admin/${route}/route.ts`, "utf8")).toContain("if (e instanceof RecipeError) return jsonError(e.status, e.code");
});

const cateringState = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: cateringState.from }) }));
vi.mock("@/lib/session", () => ({ requireSession: async () => ({ user: { id: "actor", role: "gm" } }) }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => ({ ok: true }) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
import { recipeVersionErrorFromRpc, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { menuShopErrorFromRpc, MenuShopError } from "@/lib/admin/menu-item-shop";

it.each([
  ["recipe versions", recipeVersionErrorFromRpc, RecipeVersionError],
  ["menu settings", menuShopErrorFromRpc, MenuShopError],
] as const)("%s keeps its domain class for trigger, FK and busy refusals", (_name, parse, ErrorClass) => {
  for (const [message, dbCode, status, code] of [
    ["shop_owned:output_other_shop", "P0001", 400, "output_other_shop"],
    ["recipe_version:dependencies_busy", "P0001", 409, "dependencies_busy"],
    ['insert or update on table "recipe_version_lines" violates foreign key constraint "recipe_version_lines_component_item_id_fkey"', "23503", 400, "invalid_component"],
  ] as const) {
    try { parse(message, dbCode); throw new Error("expected refusal"); } catch (error) {
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error).toMatchObject({ status, code });
    }
  }
});
it("retains ownership line position through the recipe-version mapper", () => {
  expect(() => recipeVersionErrorFromRpc("shop_owned:line_other_shop:2")).toThrowError(expect.objectContaining({
    status: 400, code: "line_other_shop", line: { position: 2, reason: "line_other_shop" },
  }));
});
it.each([
  ["catalog/recipe/[id]/lines", "RecipeVersionError"],
  ["catalog/recipe/[id]/restore", "RecipeVersionError"],
  ["catalog/recipe/[id]/back-to-default", "RecipeVersionError"],
  ["catalog/menu-item/[id]/shop", "MenuShopError"],
  ["catalog/menu-item/[id]/shop/restore", "MenuShopError"],
  ["catalog/menu-item/[id]/shop/back-to-default", "MenuShopError"],
])("%s returns the mapper's existing %s", (route, errorClass) => {
  expect(readFileSync(`app/api/admin/${route}/route.ts`, "utf8")).toContain(`if (e instanceof ${errorClass}) return jsonError(e.status, e.code`);
});

// Only the six actual component FKs describe an invalid client ingredient.
it.each(["recipe_inputs", "recipe_version_lines"])("%s maps only its component FK constraints", table => {
  for (const kind of ["sku", "item", "product"]) {
    const constraint = `${table}_component_${kind}_id_fkey`;
    const message = `insert or update on table "${table}" violates foreign key constraint "${constraint}"`;
    expect(catalogWriteError({ code: "23503", message }, RouteError, "write"))
      .toMatchObject({ status: 400, code: "invalid_component" });
  }
});
it.each([
  "recipes_created_by_fkey", "recipe_inputs_recipe_id_fkey", "recipe_version_lines_version_id_fkey",
  "other_component_sku_id_fkey", "recipe_inputs_component_sku_id_fkey_extra",
])("keeps unexpected FK %s in the server error for framework logging", constraint => {
  const message = `insert or update violates foreign key constraint "${constraint}"`;
  const error = catalogWriteError({ code: "23503", message }, RouteError, "write");
  expect(error).not.toBeInstanceOf(RouteError);
  expect(error.message).toBe(`write: ${message}`);
});

import { NextRequest } from "next/server";
import { PATCH as patchCatering } from "@/app/api/admin/catering/menu/[id]/route";
it("catering PATCH returns owned_not_catering as a named 400 through the real writer", async () => {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { catering_available: false, catering_only: false }, error: null }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({
      error: { code: "P0001", message: "shop_owned:owned_not_catering" }, count: null,
    }) }),
  };
  cateringState.from.mockReturnValue(chain);
  const response = await patchCatering(new NextRequest("http://localhost/api/admin/catering/menu/owned", {
    method: "PATCH", body: JSON.stringify({ kind: "menu_item", cateringAvailable: true }),
    headers: { "content-type": "application/json" },
  }), { params: Promise.resolve({ id: "owned" }) });
  expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ catering_available: true }), { count: "exact" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "owned_not_catering" });
});
