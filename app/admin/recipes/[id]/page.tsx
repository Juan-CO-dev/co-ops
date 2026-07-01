/**
 * /admin/recipes/[id] — Recipe detail + builder page. Server component.
 *
 * Loads recipe + SKU list (input picker) + active items list (input sub-items
 * AND production outputs) + units registry (container label pickers).
 * Gate: >= RECIPE_READ_MIN (6, AGM+).
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipe, RECIPE_READ_MIN } from "@/lib/recipes";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";

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

  const [recipe, skusRes, itemsRes, unitsRes] = await Promise.all([
    loadRecipe(auth, id),
    sb
      .from("vendor_items")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string }>>(),
    sb
      .from("items")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string }>>(),
    sb
      .from("units")
      .select("id, label")
      .order("label")
      .returns<Array<{ id: string; label: string }>>(),
  ]);

  if (!recipe) notFound();

  const skus = (skusRes.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const items = (itemsRes.data ?? []).map((i) => ({ id: i.id, name: i.name }));
  const unitOptions = (unitsRes.data ?? []).map((u) => ({
    id: u.id,
    label: u.label,
  }));

  return (
    <div>
      <AdminBackLink />
      <RecipeBuilder
        recipe={recipe}
        skus={skus}
        items={items}
        unitOptions={unitOptions}
        level={level}
      />
    </div>
  );
}
