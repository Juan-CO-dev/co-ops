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

import Link from "next/link";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { RECIPE_READ_MIN } from "@/lib/recipes";
import { shopParamFor, searchParamValues } from "@/lib/shop-context-shared";
import { loadRecipeBuilderCatalog, loadRecipeBuilderScope } from "@/lib/admin/recipe-builder-data";
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
  const requested = shopParamFor("/admin/recipes/new", searchParamValues(sp));
  if (requested === undefined && new Set(auth.locations).size !== 1) {
    if (level < 7 || auth.user.role === "social_media_mgr") redirect("/dashboard");
    const { data: shops, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name").returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`builder shops: ${error.message}`);
    const choices = (shops ?? []).filter(shop => catalogShopAllowed({level, locations: auth.locations}, shop.id));
    return <div>
      <PageHeader title={serverT(lang, rk("recipes.new.title"))} subtitle={serverT(lang, "catalog.error.location_required")} />
      <div className="flex flex-wrap gap-3">
        {choices.map(shop => <Link key={shop.id} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border p-3" href={`/admin/recipes/new?location=${encodeURIComponent(shop.id)}&type=${defaultType}`}>{shop.name}</Link>)}
        {level >= 8 ? <Link className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border p-3" href={`/admin/recipes/new?location=global&type=${defaultType}`}>{serverT(lang, "catalog.item.shop_global")}</Link> : null}
      </div>
    </div>;
  }
  const context = await loadRecipeBuilderScope(auth, requested, true);
  const catalog = await loadRecipeBuilderCatalog(auth, context.scope, context.scope);

  return (
    <div>
      <PageHeader
        title={serverT(lang, rk("recipes.new.title"))}
        subtitle={serverT(lang, rk("recipes.new.subtitle"))}
      />
      <RecipeBuilder
        key={`new:${context.scope ?? "global"}`}
        locationId={context.scope}
        scopeOptions={context.shops}
        allowGlobalScope={context.allowGlobal}
        outputItems={catalog.outputItems}
        recipe={null}
        skus={catalog.skus}
        items={catalog.items}
        products={catalog.products}
        unitOptions={catalog.unitOptions}
        measures={catalog.measures}
        activeMeasureLabels={catalog.activeMeasureLabels}
        level={level}
        defaultType={defaultType}
      />
    </div>
  );
}
