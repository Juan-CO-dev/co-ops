/** Catalog Phase 3a — the recipe and menu-overlay routes: Tier E, a level-7 floor outside, the lib inside, explicit fields. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = {
  "app/api/admin/catalog/recipe/[id]/lines/route.ts": ["saveRecipeLines(", "RecipeVersionError", "RECIPE_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/recipe/[id]/restore/route.ts": ["restoreRecipeVersion(", "RecipeVersionError", "RECIPE_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/recipe/[id]/back-to-default/route.ts": ["retireShopRecipeVersion(", "RecipeVersionError", "RECIPE_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/menu-item/[id]/shop/route.ts": ["saveMenuItemShopSetting(", "MenuShopError", "MENU_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/menu-item/[id]/shop/back-to-default/route.ts": ["retireMenuItemShopSetting(", "MenuShopError", "MENU_SHOP_WRITE_MIN"],
  "app/api/admin/catalog/menu-item/[id]/shop/restore/route.ts": ["restoreMenuItemShopSetting(", "MenuShopError", "MENU_SHOP_WRITE_MIN"],
} as const;

describe.each(Object.entries(ROUTES))("%s", (file, [call, errorClass, floor]) => {
  const src = readFileSync(file, "utf8");
  it("asserts Tier E after the session and a level-7 outer floor", () => {
    expect(src).toContain('assertStepUp(ctx, "E")');
    expect(src).toContain(`ctx.level < ${floor}`);
    expect(src.indexOf("requireSession(")).toBeLessThan(src.indexOf('assertStepUp(ctx, "E")'));
  });
  it("delegates the real gate to the lib (no shop bind of its own) and maps its typed error", () => {
    expect(src).toContain(call);
    expect(src).toContain(`instanceof ${errorClass}`);
    expect(src).not.toContain("lockLocationContext");
    expect(src).not.toContain("consumeStepUpGrant");
  });
  it("accepts uuids only", () => {
    expect(src).toContain("UUID_RE");
  });
});
