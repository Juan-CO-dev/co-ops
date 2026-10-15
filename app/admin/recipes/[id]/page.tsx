/**
 * /admin/recipes/[id] — Recipe detail + builder page. Server component.
 *
 * Loads the recipe + the builder's picker universe (lib/admin/recipe-builder-data.ts, shared
 * with /new) + readiness + the catering flags of its menu outputs. Gate: >= RECIPE_READ_MIN (6).
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipe, RECIPE_READ_MIN } from "@/lib/recipes";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import type { Readiness } from "@/lib/readiness";
import { RECIPE_WRITE_MIN } from "@/lib/recipes-shared";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { RecipeCateringFlags, type RecipeMenuOutputFlags } from "@/components/admin/recipes/RecipeCateringFlags";

export default async function AdminRecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const auth = await requireSessionFromHeaders("/admin/recipes");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");

  const sb = getServiceRoleClient();
  const [recipe, catalog] = await Promise.all([loadRecipe(auth, id), loadRecipeBuilderCatalog()]);
  if (!recipe) notFound();

  // Catering flags for this recipe's MENU_ITEM outputs (piece 2) — batch load
  // the current flag columns for every sub the recipe produces.
  const menuOutputIds = [
    ...new Set(recipe.outputs.map((o) => o.outputMenuItemId).filter((v): v is string => v != null)),
  ];
  let cateringFlags: RecipeMenuOutputFlags[] = [];
  if (menuOutputIds.length > 0) {
    const { data: flagRows } = await sb
      .from("menu_items")
      .select("id, name, catering_available, catering_only, catering_portionable, serves, seasonal")
      .in("id", menuOutputIds)
      .returns<Array<{
        id: string; name: string; catering_available: boolean; catering_only: boolean;
        catering_portionable: boolean | null; serves: number | string | null; seasonal: boolean;
      }>>();
    cateringFlags = (flagRows ?? []).map((r) => ({
      menuItemId: r.id,
      name: r.name,
      cateringAvailable: r.catering_available,
      cateringOnly: r.catering_only,
      cateringPortionable: r.catering_portionable ?? false,
      serves: r.serves == null ? null : Number(r.serves),
      seasonal: r.seasonal,
    }));
  }

  let readiness: Readiness | null = null;
  try {
    const g = await loadGraphReadiness(auth);
    readiness = g.recipeReadiness.get(id) ?? null;
  } catch (e) {
    console.error("readiness load failed (rendering without banner)", e);
  }

  return (
    <div>
      <RecipeBuilder
        recipe={recipe}
        skus={catalog.skus}
        items={catalog.items}
        products={catalog.products}
        unitOptions={catalog.unitOptions}
        measures={catalog.measures}
        activeMeasureLabels={catalog.activeMeasureLabels}
        level={level}
        readiness={readiness}
      />
      {menuOutputIds.length > 0 ? (
        <RecipeCateringFlags outputs={cateringFlags} canEdit={level >= RECIPE_WRITE_MIN} />
      ) : null}
    </div>
  );
}
