/**
 * /admin/recipes/[id] — Recipe detail + builder page. Server component.
 *
 * Loads recipe + SKU list (with pack fields for oz derivation) + active items +
 * units registry + measure_units map. Gate: >= RECIPE_READ_MIN (6, AGM+).
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipe, RECIPE_READ_MIN } from "@/lib/recipes";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import type { Readiness } from "@/lib/readiness";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

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

  const [recipe, skusRes, itemsRes, unitsRes, measuresRes] = await Promise.all([
    loadRecipe(auth, id),
    sb
      .from("vendor_items")
      .select("id, name, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .eq("active", true)
      .order("name")
      .returns<Array<{
        id: string; name: string;
        pack_format: string | null;
        each_container_label: string | null;
        units_per_pack: number | string | null;
        each_size: number | string | null;
        each_measure: string | null;
        avg_oz_per_each: number | string | null;
      }>>(),
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
    sb
      .from("measure_units")
      .select("label, dimension, to_base_factor")
      .returns<Array<{ label: string; dimension: string; to_base_factor: number | string }>>(),
  ]);

  if (!recipe) notFound();

  let readiness: Readiness | null = null;
  try {
    const g = await loadGraphReadiness(auth);
    readiness = g.recipeReadiness.get(id) ?? null;
  } catch (e) {
    console.error("readiness load failed (rendering without banner)", e);
  }

  const skus = (skusRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    packFormat: s.pack_format ?? null,
    eachContainerLabel: s.each_container_label ?? null,
    unitsPerPack: s.units_per_pack != null ? Number(s.units_per_pack) : null,
    eachSize: s.each_size != null ? Number(s.each_size) : null,
    eachMeasure: s.each_measure ?? null,
    avgOzPerEach: s.avg_oz_per_each != null ? Number(s.avg_oz_per_each) : null,
  }));
  const items = (itemsRes.data ?? []).map((i) => ({ id: i.id, name: i.name }));
  const unitOptions = (unitsRes.data ?? []).map((u) => ({
    id: u.id,
    label: u.label,
  }));
  const measures = new Map<string, MeasureUnitFactor>(
    (measuresRes.data ?? []).map((m) => [
      m.label,
      {
        dimension: m.dimension as MeasureUnitFactor["dimension"],
        toBaseFactor: Number(m.to_base_factor),
      },
    ]),
  );

  return (
    <div>
      <AdminBackLink />
      <RecipeBuilder
        recipe={recipe}
        skus={skus}
        items={items}
        unitOptions={unitOptions}
        measures={measures}
        level={level}
        readiness={readiness}
      />
    </div>
  );
}
