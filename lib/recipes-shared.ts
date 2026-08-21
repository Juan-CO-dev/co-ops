/**
 * Recipes — CLIENT-SAFE shared surface (level constants + view types only;
 * no I/O, no server imports). Split from lib/recipes.ts on 2026-07-23 when the
 * new `server-only` guard on lib/supabase-server.ts surfaced that
 * RecipesClient.tsx's import of RECIPE_WRITE_MIN was dragging the service-role
 * module into the client bundle graph (PR #165 CI catch — second chain found).
 *
 * Server-side recipe logic stays in lib/recipes.ts, which re-exports this
 * surface so server consumers (API routes, pages) are unchanged.
 */

export const RECIPE_READ_MIN = 6;
export const RECIPE_WRITE_MIN = 7;
export const RECIPE_DELETE_MIN = 8;
export const MENU_PRICE_MIN = 8;

export type RecipeType = "production" | "consumer";

/** Which of the THREE component targets a recipe line names (0179). */
export type RecipeInputKind = "sku" | "item" | "product";

export interface RecipeInputView {
  id: string; componentSkuId: string | null; componentItemId: string | null;
  componentProductId: string | null;
  /**
   * The target's own name. A product line resolves through the PRODUCTS lookup —
   * without it a re-pointed line renders "(item)", which is both wrong and silent.
   */
  componentName: string;
  /** Discriminator so the builder can render the product chip without re-deriving it. */
  kind: RecipeInputKind;
  /**
   * The pinned target is DISCONTINUED — a retired product (`products.active =
   * false`) or a deactivated vendor SKU (Juan's ruling A+, 2026-08-21: "the recipe
   * should be loud too, so that they know they have a discontinued sku in the recipe
   * that needs to be updated").
   *
   * ONE flag for both kinds, because the errand is one errand: re-point this line.
   * `kind` already says which registry to go to. What it does NOT say is what the
   * line does today — those differ, deliberately: a retired PRODUCT refuses at the
   * resolution ladder, while a deactivated SKU still resolves (loadSkuPack includes
   * inactive SKUs for historical replay). The badge is loud for both; only the
   * readiness lane distinguishes the red one from the amber one.
   *
   * Never true for an item line: `items` retirement is not part of this ruling.
   */
  componentRetired: boolean;
  quantity: number; unit: string | null;
  eachContainerLabel: string | null; portioned: boolean; displayOrder: number;
}
export interface RecipeOutputView {
  id: string; outputItemId: string | null; outputMenuItemId: string | null;
  outputName: string; yield: number; outputContainerLabel: string | null;
  ozAllocShare: number | null; displayOrder: number;
}
export interface RecipeView {
  id: string; name: string; nameEs: string | null; recipeType: RecipeType;
  batchYield: number; directions: string | null; directionsEs: string | null;
  active: boolean; inputs: RecipeInputView[]; outputs: RecipeOutputView[];
}
export interface RecipeListRow {
  id: string; name: string; recipeType: RecipeType; active: boolean;
  outputNames: string[]; hasInputs: boolean; hasOutputs: boolean;
  batchYield: number | null;
}
