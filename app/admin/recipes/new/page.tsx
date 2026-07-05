/**
 * /admin/recipes/new — Draft recipe creation page. Server component.
 *
 * Loads the same picker data as [id]/page.tsx (SKUs with pack fields,
 * items, units registry, measures map). Renders RecipeBuilder in draft mode
 * (recipe=null). On Save, RecipeBuilder POSTs to /api/admin/recipes/full.
 *
 * searchParams may carry ?type=production|consumer to pre-select recipe type.
 * Gate: >= RECIPE_READ_MIN (6, AGM+).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { RECIPE_READ_MIN } from "@/lib/recipes";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
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
  const defaultType: RecipeType =
    rawType === "consumer" ? "consumer" : "production";

  const auth = await requireSessionFromHeaders("/admin/recipes/new");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");

  const lang = auth.user.language;
  const sb = getServiceRoleClient();

  const [skusRes, itemsRes, unitsRes, measuresRes] = await Promise.all([
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
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, rk("recipes.new.title"))}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, rk("recipes.new.subtitle"))}
      </p>
      <RecipeBuilder
        recipe={null}
        skus={skus}
        items={items}
        unitOptions={unitOptions}
        measures={measures}
        level={level}
        defaultType={defaultType}
      />
    </div>
  );
}
