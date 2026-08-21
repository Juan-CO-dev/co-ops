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
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { PageHeader } from "@/components/ui/PageHeader";
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

  const [skusRes, itemsRes, unitsRes, measuresRes, productsRes] = await Promise.all([
    sb
      .from("vendor_items")
      .select("id, name, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .eq("active", true)
      .eq("inventory_only", false) // exclude packaging/cleaning supplies from the ingredient picker
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
    // Products a recipe line may pin instead of one vendor's SKU (0179). Read the
    // same way every other picker on this page is; an error yields [] and the
    // product affordance simply does not render.
    //
    // `.eq("active", true)` is LOAD-BEARING, not tidiness (Juan's ruling A+,
    // 2026-08-21): a retired product refuses at the resolution ladder, so offering
    // one here would let an author pick an ingredient that reads `unresolved` the
    // moment it is saved. lib/recipes.ts assertProductLineIsValid refuses the write
    // anyway; this is the half that means nobody has to hit that refusal.
    sb
      .from("products")
      .select("id, name, unit_oz")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string; unit_oz: number | string | null }>>(),
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
  const products = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    unitOz: p.unit_oz != null ? Number(p.unit_oz) : null,
  }));
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
      <PageHeader
        title={serverT(lang, rk("recipes.new.title"))}
        subtitle={serverT(lang, rk("recipes.new.subtitle"))}
      />
      <RecipeBuilder
        recipe={null}
        skus={skus}
        items={items}
        products={products}
        unitOptions={unitOptions}
        measures={measures}
        level={level}
        defaultType={defaultType}
      />
    </div>
  );
}
