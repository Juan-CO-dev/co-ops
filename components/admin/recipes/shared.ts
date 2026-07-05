/**
 * Shared client helpers for the Recipes admin UI.
 * Re-exports postJson from vendors/shared and adds a recipe-scoped error resolver.
 */
import type { TranslationKey } from "@/lib/i18n/types";

export { postJson, type PostResult } from "@/components/admin/vendors/shared";

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
  // Added in recipe-refinement slice (createRecipeFull / setItemSoldDirectly / addRecipeOutput errors)
  "incomplete_recipe",
  "would_create_cycle",
  "invalid_output",
  "invalid_sell_portion",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `recipes.error.${code}` as TranslationKey;
  }
  return "recipes.error.generic" as TranslationKey;
}
