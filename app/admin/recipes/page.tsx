/**
 * /admin/recipes — Recipe builder hub. Lists all recipes (production + consumer)
 * with type filter, completeness badges, and a New Recipe inline form.
 *
 * Server component: gate >= RECIPE_READ_MIN (6, AGM+). Defensive re-gate matches
 * the skus/page.tsx pattern — the admin layout owns the 6-floor, this page
 * re-gates 6 defensively.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadRecipes, RECIPE_READ_MIN } from "@/lib/recipes";
import { loadActiveShopsForReadiness, loadGraphReadiness } from "@/lib/admin/readiness-load";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import type { Readiness } from "@/lib/readiness";
import { RecipesClient } from "@/components/admin/recipes/RecipesClient";
import { PageHeader } from "@/components/ui/PageHeader";
import type { TranslationKey } from "@/lib/i18n/types";

/** Cast a recipes.* key to TranslationKey — keys are added in a separate i18n task. */
const rk = (k: string): TranslationKey => k as TranslationKey;

export default async function AdminRecipesPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/recipes");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;
  // ?location=<shop> shows THAT shop's readiness (its resolved recipes — lead decisions 4 and (c)); the hub's
  // attributed counts link here. Absent or "global" = the default, labelled.
  // Read through the shop-context getter and the one resolver (route contract, lib/shop-context-shared.ts). Absent
  // or "global" = the default — never the remembered shop: this list's scope is what the link asked for.
  const sp = await searchParams;
  const explicit = shopParamFor("/admin/recipes", searchParamValues(sp));
  const shops = await loadActiveShopsForReadiness();
  const scope = explicit && explicit !== "global" && shops.some((s) => s.id === explicit)
    ? await resolveShopId(shops.map((s) => s.id), explicit) : null;
  const scopeName = scope ? shops.find((s) => s.id === scope)?.name ?? null : null;

  const recipes = await loadRecipes(auth);

  let recipeReadiness: Record<string, Readiness> = {};
  try {
    const g = await loadGraphReadiness(auth, scope);
    recipeReadiness = Object.fromEntries(
      [...g.recipeReadiness.entries()].filter(([, r]) => r.status !== "ready"),
    );
  } catch (e) {
    console.error("readiness load failed (rendering without badges)", e);
  }

  return (
    <div>
      <PageHeader
        title={serverT(lang, rk("recipes.hub.title"))}
        subtitle={serverT(lang, rk("recipes.hub.subtitle"))}
      />
      <p className="mt-2 text-sm text-co-text-muted">
        {scope === null ? serverT(lang, "readiness.scope.default") : serverT(lang, "readiness.scope.shop", { shop: scopeName ?? "" })}
        {scope !== null ? <> · <Link href="/admin/recipes" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{serverT(lang, "readiness.scope.show_default")}</Link></> : null}
      </p>
      <RecipesClient recipes={recipes} level={level} role={auth.user.role} readiness={recipeReadiness} shopScope={scope} />
    </div>
  );
}
