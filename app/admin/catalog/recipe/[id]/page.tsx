/**
 * /admin/catalog/recipe/[id] — the connected RECIPE page (catalog Phase 3b; spec §4).
 * Server component: the admin layout holds the auth boundary, the level-6 floor and StepUpProvider; this page
 * re-gates defensively. Reads are org-wide (level 6+, the social media manager refused by ROLE in the lib —
 * loadRecipeItemView — and sent to the dashboard). `?location=global` shows the default; `?location=<shop>` any
 * active shop (a shop the viewer can't change reads, with a way forward to one they can); no parameter → the one
 * resolver over the shops the viewer may work in (catalogShopAllowed: a membership, or MoO+ for every shop), else
 * the default. The client is KEYED by (recipe, scope), so a shop switch remounts it.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { loadRecipeItemView } from "@/lib/catalog/recipe-item";
import { pageClientKey } from "@/lib/catalog/recipe-item-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_VERSION_READ_MIN } from "@/lib/recipe-versions-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecipeItemClient } from "@/components/catalog/RecipeItemClient";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
import { loadRecipe } from "@/lib/recipes";
import { loadRecipeBuilderCatalog, loadRecipePrepSections } from "@/lib/admin/recipe-builder-data";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import { formatCents, formatQuantity } from "@/lib/i18n/format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CatalogRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const auth = await requireSessionFromHeaders("/admin");
  if (auth.level < RECIPE_VERSION_READ_MIN) redirect("/dashboard");

  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name").order("id")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`catalog recipe page locations: ${error.message}`);
  const active = (locs ?? []).map((l) => l.id);
  // The shops this viewer works in (the writers' rule, D2): a membership, or MoO+ for every active shop.
  const mine = active.filter((l) => catalogShopAllowed(auth, l));
  const explicit = shopParamFor(`/admin/catalog/recipe/${id}`, searchParamValues(sp));
  const scope = explicit === "global" ? null
    : explicit && mine.includes(explicit) ? await resolveShopId(mine, explicit)
    // Another active shop's version reads (org-wide), read-only — the page offers "Change it for <your shop>".
    : explicit && active.includes(explicit) ? explicit
    : mine.length > 0 ? await resolveShopId(mine, null) : null;

  let view;
  try {
    view = await loadRecipeItemView(auth, id, scope);
  } catch (e) {
    if (e instanceof RecipeVersionError && e.status === 404) notFound();
    if (e instanceof RecipeVersionError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  if (!view) notFound();
  const lang = auth.user.language;
  // Owned recipes write the null/default version, but ALL read universes remain at their owner shop.
  // Reuse the shipped editor and Share UI; the shared 3b version editor below stays separate.
  let ownedEditor = null;
  if (view.owner) {
    const ownerScope = view.owner.locationId;
    const recipe = await loadRecipe(auth, id);
    if (!recipe || recipe.ownerLocationId !== ownerScope) notFound();
    const [catalog, prepSections, graph] = await Promise.all([
      loadRecipeBuilderCatalog(auth, ownerScope, ownerScope),
      loadRecipePrepSections(auth),
      loadGraphReadiness(auth, ownerScope),
    ]);
    ownedEditor = <div key={`owned:${id}:${ownerScope}`} className="min-w-0 space-y-4">
      <p className="break-words text-sm">{serverT(lang, "catalog.only_at_shop", { shop: view.owner.name })}</p>
      <RecipeBuilder recipe={recipe} locationId={ownerScope} canWrite={view.can.editOwned === true}
        level={auth.level} skus={catalog.skus} items={catalog.items} outputItems={catalog.outputItems}
        products={catalog.products} unitOptions={catalog.unitOptions} measures={catalog.measures}
        activeMeasureLabels={catalog.activeMeasureLabels} prepSections={prepSections}
        readiness={graph.recipeReadiness.get(id) ?? null} />
      <ul className="min-w-0 space-y-2">
        {view.makes.map(output => <li key={output.id} className="break-words text-sm">
          {lang === "es" && output.nameEs ? output.nameEs : output.name}{" · "}
          {serverT(lang, "catalog.recipe.yield", { n: formatQuantity(output.yield, lang) })}{" · "}
          {serverT(lang, "catalog.recipe.cost_here", { cost: output.costHere === null ? "—" : formatCents(Math.round(output.costHere * 100), lang) })}
        </li>)}
      </ul>
      <ShareWithEveryShop kind="recipe" id={id} canShare={view.can.share === true} />
    </div>;
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <PageHeader
        title={lang === "es" && view.recipe.nameEs ? view.recipe.nameEs : view.recipe.name}
        subtitle={serverT(lang, view.recipe.recipeType === "production" ? "catalog.recipe.kind.production" : "catalog.recipe.kind.consumer")}
      />
      {/* ONE client per (recipe, shop): a ?location= switch REMOUNTS it, so no draft or preview from the previous
          shop survives into this one. */}
      {ownedEditor ?? <RecipeItemClient key={pageClientKey("recipe", view.recipe.id, view.scope)} view={view} />}
    </div>
  );
}
