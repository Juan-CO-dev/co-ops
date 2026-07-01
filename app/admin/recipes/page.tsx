/**
 * /admin/recipes — Recipe builder hub. Lists all recipes (production + consumer)
 * with type filter, completeness badges, and a New Recipe inline form.
 *
 * Server component: gate >= RECIPE_READ_MIN (6, AGM+). Defensive re-gate matches
 * the skus/page.tsx pattern — the admin layout owns the 6-floor, this page
 * re-gates 6 defensively.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadRecipes, RECIPE_READ_MIN } from "@/lib/recipes";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { RecipesClient } from "@/components/admin/recipes/RecipesClient";
import type { TranslationKey } from "@/lib/i18n/types";

/** Cast a recipes.* key to TranslationKey — keys are added in a separate i18n task. */
const rk = (k: string): TranslationKey => k as TranslationKey;

export default async function AdminRecipesPage() {
  const auth = await requireSessionFromHeaders("/admin/recipes");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const recipes = await loadRecipes(auth);

  return (
    <div>
      <AdminBackLink />
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, rk("recipes.hub.title"))}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, rk("recipes.hub.subtitle"))}
      </p>
      <RecipesClient recipes={recipes} level={level} />
    </div>
  );
}
