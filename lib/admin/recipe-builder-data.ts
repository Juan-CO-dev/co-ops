/**
 * The picker universe both recipe builder pages load (/admin/recipes/[id] and /new) — ONE
 * loader so the two pages cannot drift (they carried byte-identical copies until catalog
 * Phase 1, 2026-10-15). Service-role reads with the same filters as before: active SKUs that
 * are not inventory-only, active items, ACTIVE products (load-bearing — a retired product
 * refuses at the resolution ladder, Juan's ruling A+, and assertProductLineIsValid refuses the
 * write anyway), the units registry and the measure registry. New: each SKU carries its
 * vendor's NAME so the searchable picker can say "Ham · Baldor · SKU".
 *
 * Errors keep the pages' old posture — a failed read yields an empty list — and a failed
 * vendors read only drops the names.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "@/components/admin/recipes/RecipeBuilder";

export interface RecipeBuilderCatalog {
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  products: RecipeBuilderProduct[];
  unitOptions: Array<{ id: string; label: string }>;
  /** EVERY measure (active or not), so a saved line in a retired unit still converts to oz. */
  measures: Map<string, MeasureUnitFactor>;
  /** The ACTIVE measure labels — the only ones the line editor offers (Astra full-branch #4). */
  activeMeasureLabels: string[];
}

export async function loadRecipeBuilderCatalog(): Promise<RecipeBuilderCatalog> {
  const sb = getServiceRoleClient();
  const [skusRes, itemsRes, unitsRes, measuresRes, productsRes, vendorsRes] = await Promise.all([
    sb
      .from("vendor_items")
      .select("id, name, vendor_id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .eq("active", true)
      .eq("inventory_only", false)
      .order("name")
      .returns<Array<{
        id: string; name: string; vendor_id: string | null;
        pack_format: string | null;
        each_container_label: string | null;
        units_per_pack: number | string | null;
        each_size: number | string | null;
        each_measure: string | null;
        avg_oz_per_each: number | string | null;
      }>>(),
    sb.from("items").select("id, name").eq("active", true).order("name").returns<Array<{ id: string; name: string }>>(),
    sb.from("units").select("id, label").order("label").returns<Array<{ id: string; label: string }>>(),
    sb
      .from("measure_units")
      .select("label, dimension, to_base_factor, active")
      .returns<Array<{ label: string; dimension: string; to_base_factor: number | string; active: boolean | null }>>(),
    sb
      .from("products")
      .select("id, name, unit_oz")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string; unit_oz: number | string | null }>>(),
    sb.from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>(),
  ]);

  const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]));
  const skus: RecipeBuilderSku[] = (skusRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    vendorName: s.vendor_id ? (vendorNameById.get(s.vendor_id) ?? null) : null,
    packFormat: s.pack_format ?? null,
    eachContainerLabel: s.each_container_label ?? null,
    unitsPerPack: s.units_per_pack != null ? Number(s.units_per_pack) : null,
    eachSize: s.each_size != null ? Number(s.each_size) : null,
    eachMeasure: s.each_measure ?? null,
    avgOzPerEach: s.avg_oz_per_each != null ? Number(s.avg_oz_per_each) : null,
  }));
  const items = (itemsRes.data ?? []).map((i) => ({ id: i.id, name: i.name }));
  const products: RecipeBuilderProduct[] = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    unitOz: p.unit_oz != null ? Number(p.unit_oz) : null,
  }));
  const unitOptions = (unitsRes.data ?? []).map((u) => ({ id: u.id, label: u.label }));
  const measures = new Map<string, MeasureUnitFactor>(
    (measuresRes.data ?? []).map((m) => [
      m.label,
      { dimension: m.dimension as MeasureUnitFactor["dimension"], toBaseFactor: Number(m.to_base_factor) },
    ]),
  );
  const activeMeasureLabels = (measuresRes.data ?? []).filter((m) => m.active === true).map((m) => m.label);
  return { skus, items, products, unitOptions, measures, activeMeasureLabels };
}
