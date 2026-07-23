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

export interface RecipeInputView {
  id: string; componentSkuId: string | null; componentItemId: string | null;
  componentName: string; quantity: number; unit: string | null;
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
