/** Read-only, whole-universe batch for the catalog's per-shop data lane.
 * Never import a seed/CLI module into the page. Project only operational fields;
 * paginate every relation, throw on failed pages, and serialize authorized shops.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { AuthContext } from "@/lib/session";
import { etBusinessDate } from "@/lib/counts-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { evaluateWave7Tables, summarizeSkuDataShop, type LiveRow, type SkuDataShop } from "@/lib/sku-data-readiness";

// Same relation universe as parity. Inactive parents remain available for FK
// validation and graph resolution; filtering them during load invents missing pins.
const COLUMNS = {
  vendor_items: "id,name,vendor_id,product_id,location_id,active,pending_review,inventory_only,sku_class,pack_format,each_container_label,units_per_pack,each_size,each_measure,avg_oz_per_each,weight_class,weekday_par,weekend_par",
  vendors: "id,name,active,source_kind",
  locations: "id,name,active",
  location_sku_settings: "id,sku_id,location_id,active_override,weekday_par,weekend_par,auto_weekday_par,auto_weekend_par,auto_weekday_baseline_par,auto_weekend_baseline_par,auto_weekday_pack_epoch,auto_weekend_pack_epoch",
  sku_pack_epochs: "sku_id,location_id,epoch",
  sku_pack_levels: "id,sku_id,version_id,location_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,active",
  vendor_price_history: "id,vendor_item_id,unit_price,effective_date,recorded_at,location_id,price_lane_id",
  sku_price_lanes: "id,sku_id,location_id,active",
  measure_units: "id,label,dimension,to_base_factor,active",
  products: "id,name,active,unit_oz",
  product_primaries: "id,product_id,primary_sku_id,location_id",
  vendor_deliveries: "id,location_id,vendor_id,created_at",
  vendor_delivery_items: "id,vendor_item_id,delivery_id,created_at",
  recipes: "id,name,active,created_at,batch_yield",
  recipe_inputs: "id,recipe_id,quantity,unit,component_sku_id,component_item_id,component_product_id",
  recipe_outputs: "id,recipe_id,output_item_id,output_menu_item_id,yield",
  items: "id,name,oz_per_par_unit,default_par_unit",
  menu_items: "id,name",
  vendor_cutoffs: "id,vendor_id,location_id,active",
  vendor_delivery_rhythm: "id,vendor_id,location_id,active",
} as const;

/**
 * The TOTAL ORDER each table pages by (Astra full-branch r2 P2). `id` everywhere it exists;
 * sku_pack_epochs (0259) has NO id — its key is (sku_id, location_id) — and ordering a page by a
 * column that does not exist fails the whole load, which then reads as "unavailable". Every order
 * column is pinned against the real 0259 schema in tests/loader-schema-check.test.ts.
 */
export function readinessOrder(table: keyof typeof COLUMNS): readonly string[] {
  return table === "sku_pack_epochs" ? ["sku_id", "location_id"] : ["id"];
}
export const READINESS_COLUMNS: Readonly<Record<keyof typeof COLUMNS, string>> = COLUMNS;
/** Catalog Phase 3a: the live SHOP recipe versions and their lines (pinned against 0262 in the PGlite schema check). */
export const RECIPE_VERSION_COLUMNS = "id,recipe_id,location_id,valid_from,valid_to,active";
export const RECIPE_VERSION_LINE_COLUMNS = "id,version_id,recipe_id,quantity,unit,component_sku_id,component_item_id,component_product_id,display_order";

export async function loadSkuDataReadiness(actor: AuthContext, locationId?: string): Promise<SkuDataShop[]> {
  if (actor.level < 6) throw new Error("SKU_DATA_READINESS_FORBIDDEN");
  if (locationId && actor.level < 9 && !actor.locations.includes(locationId)) throw new Error("SKU_DATA_READINESS_FORBIDDEN");
  const visible = locationId ? new Set([locationId]) : actor.level >= 9 ? undefined : new Set(actor.locations);
  if (visible?.size === 0) return [];
  const sb = getServiceRoleClient();
  const loaded = await Promise.all((Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, string]>).map(async ([table, columns]) => [table,
    await selectAllRows<LiveRow>((from, to) => {
      let q = sb.from(table).select(columns);
      for (const col of readinessOrder(table)) q = q.order(col, { ascending: true });
      return q.range(from, to).returns<LiveRow[]>();
    }),
  ] as const));
  // CATALOG PHASE 3a (chunk-2 review P2): each shop's graph uses ITS resolved recipe — the LIVE shop recipe
  // versions and their lines (evaluateWave7Tables merges them per shop through the one pure rule). Paged, ordered
  // by id, id-chunked; a failed page throws (never a smaller graph).
  const shopRecipeVersions = await selectAllRows<LiveRow>((from, to) => sb.from("recipe_versions")
    .select(RECIPE_VERSION_COLUMNS).not("location_id", "is", null).eq("active", true)
    .order("id", { ascending: true }).range(from, to).returns<LiveRow[]>());
  const versionIds = shopRecipeVersions.map((v) => String(v.id));
  const versionLines: LiveRow[] = [];
  for (let i = 0; i < versionIds.length; i += 100) {
    const chunk = versionIds.slice(i, i + 100);
    versionLines.push(...await selectAllRows<LiveRow>((from, to) => sb.from("recipe_version_lines")
      .select(RECIPE_VERSION_LINE_COLUMNS).in("version_id", chunk)
      .order("id", { ascending: true }).range(from, to).returns<LiveRow[]>()));
  }
  const today = etBusinessDate(new Date().toISOString());
  const report = evaluateWave7Tables({ ...Object.fromEntries(loaded), recipe_versions: shopRecipeVersions, recipe_version_lines: versionLines },
    new Map(), addDaysEt(today, 1), today, visible);
  return report.shops.map(shop => summarizeSkuDataShop(shop.id, shop.name, Object.fromEntries(shop.rows.map(row => [row.id,
    { order: row.order, count: row.count, cost: row.cost, errands: row.errands },
  ]))));
}
