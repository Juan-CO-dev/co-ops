/**
 * /admin/recipes/new — Draft recipe creation page. Server component.
 *
 * Loads the builder's picker universe (lib/admin/recipe-builder-data.ts, shared with
 * [id]/page.tsx) and renders RecipeBuilder in draft mode (recipe=null). On Save,
 * RecipeBuilder POSTs to /api/admin/recipes/full.
 *
 * searchParams may carry ?type=production|consumer to pre-select recipe type.
 * Gate: >= RECIPE_READ_MIN (6, AGM+).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { RECIPE_READ_MIN } from "@/lib/recipes";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { PageHeader } from "@/components/ui/PageHeader";
import type { RecipeType } from "@/lib/recipes";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";

const rk = (k: string): TranslationKey => k as TranslationKey;

export default async function AdminRecipesNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawType = typeof sp["type"] === "string" ? sp["type"] : undefined;
  const defaultType: RecipeType = rawType === "consumer" ? "consumer" : "production";

  const auth = await requireSessionFromHeaders("/admin/recipes/new");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");

  const lang = auth.user.language;
  const catalog = await loadRecipeBuilderCatalog();

  return (
    <div>
      <PageHeader
        title={serverT(lang, rk("recipes.new.title"))}
        subtitle={serverT(lang, rk("recipes.new.subtitle"))}
      />
      <RecipeBuilder
        recipe={null}
        skus={catalog.skus}
        items={catalog.items}
        products={catalog.products}
        unitOptions={catalog.unitOptions}
        measures={catalog.measures}
        level={level}
        defaultType={defaultType}
      />
    </div>
  );
}
