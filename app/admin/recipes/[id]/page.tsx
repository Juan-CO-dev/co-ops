/**
 * /admin/recipes/[id] — Recipe detail + builder page. Server component.
 *
 * Loads the recipe + the builder's picker universe (lib/admin/recipe-builder-data.ts, shared
 * with /new) + readiness + the catering flags of its menu outputs. Gate: >= RECIPE_READ_MIN (6).
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { recipeItemHref } from "@/lib/catalog/recipe-item-shared";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipe, RECIPE_READ_MIN } from "@/lib/recipes";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import { shopParamFor, searchParamValues } from "@/lib/shop-context-shared";
import { loadRecipePrepSections, loadRecipeBuilderCatalog, loadRecipeBuilderScope } from "@/lib/admin/recipe-builder-data";
import type { Readiness } from "@/lib/readiness";
import { RECIPE_WRITE_MIN } from "@/lib/recipes-shared";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { RecipeCateringFlags, type RecipeMenuOutputFlags } from "@/components/admin/recipes/RecipeCateringFlags";

export default async function AdminRecipeDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;

  const auth = await requireSessionFromHeaders("/admin/recipes");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");

  const sb = getServiceRoleClient();
  const recipe = await loadRecipe(auth, id);
  if (!recipe) notFound();
  const sp = await searchParams;
  const context = await loadRecipeBuilderScope(auth, shopParamFor(`/admin/recipes/${id}`, searchParamValues(sp)), false, recipe.ownerLocationId);
  const catalog = await loadRecipeBuilderCatalog(auth, context.scope, recipe.ownerLocationId ?? null);

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
    const g = await loadGraphReadiness(auth, context.scope);
    readiness = g.recipeReadiness.get(id) ?? null;
  } catch (e) {
    console.error("readiness load failed (rendering without banner)", e);
  }

  const lang = auth.user.language;
  return (
    <div>
      {/* Catalog Phase 3b: each shop's own ingredients and amounts live on the catalog recipe page; a GM changes
          its shop's version there (the lines below are the default's, the Director of Operations'). */}
      <div className="mx-auto mt-2 w-full max-w-3xl rounded-lg border-2 border-co-border bg-co-surface p-3">
        <Link href={recipeItemHref(recipe.id)} className="inline-flex min-h-[44px] max-w-full items-center break-words text-sm font-bold text-co-text underline">
          {serverT(lang, "recipes.catalog_link")}
        </Link>
        <p className="min-w-0 break-words text-xs text-co-text-muted">{serverT(lang, "recipes.catalog_link_hint")}</p>
      </div>
      <RecipeBuilder
        key={`${recipe.id}:${context.scope ?? "global"}`}
        locationId={context.scope}
        scopeOptions={context.shops}
        allowGlobalScope={context.allowGlobal}
        outputItems={catalog.outputItems}
        prepSections={await loadRecipePrepSections(auth)}
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
