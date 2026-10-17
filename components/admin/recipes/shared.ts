/**
 * Shared client helpers for the Recipes admin UI.
 * Re-exports postJson from vendors/shared and adds a recipe-scoped error resolver.
 */
import { SHOP_OWNED_ERROR_CODES } from "@/lib/catalog/shop-owned-shared";
import type { TranslationKey } from "@/lib/i18n/types";

export { postJson, type PostResult } from "@/components/admin/vendors/shared";

const SHOP_ERROR_CODES: ReadonlySet<string> = new Set([...SHOP_OWNED_ERROR_CODES, "dependencies_busy"]);

const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "invalid_name",
  "invalid_type",
  "invalid_batch_yield",
  "invalid_component",
  "invalid_quantity",
  "invalid_sku",
  "invalid_component_item",
  "invalid_output_item",
  "invalid_output_menu_item",
  "invalid_yield",
  "recipe_not_found",
  "not_found",
  "invalid_payload",
  "invalid_table",
  "step_up_required",
  "step_up_stale",
  "step_up_grant_required",
  "line_changed",
  // Added in recipe-refinement slice (createRecipeFull / setItemSoldDirectly / addRecipeOutput errors)
  "incomplete_recipe",
  "would_create_cycle",
  "invalid_output",
  "invalid_sell_portion",
  // 0215 batch vs bottle (lib/recipes.ts BATCH_MODE_RPC_ERRORS + the app-layer checks)
  "duplicate_active_producer",
  "edge_not_found",
  "batch_mode_single_output",
  "batch_mode_requires_output",
  "invalid_shelf_life_days",
  // Catalog Phase 1 — the line editor reaches these through add AND edit (the keys already exist).
  "invalid_component_product",
  "product_line_needs_measure_unit",
  // Catalog Phase 3b: the global recipe's lines are MoO+; a GM edits its shop's version on the catalog page.
  "global_requires_moo",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (code === "not_batch_recipe") return "yield.error.not_batch_recipe";
  if (code === "ambiguous_output") return "recipes.error.ambiguous_output";
  if (code === "recipe_inactive") return "catalog.error.recipe_inactive";
  if (SHOP_ERROR_CODES.has(code)) {
    return `catalog.error.${code}` as TranslationKey;
  }
  if (KNOWN_ERROR_CODES.has(code)) {
    return `recipes.error.${code}` as TranslationKey;
  }
  return "recipes.error.generic" as TranslationKey;
}
