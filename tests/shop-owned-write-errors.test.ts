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
    expect(catalogWriteError({ code: "23503", message: "private_fk_constraint" }, RouteError, "write"))
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

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("unexpected database access"); } }));
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
    ["missing_component_fkey", "23503", 400, "invalid_component"],
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
