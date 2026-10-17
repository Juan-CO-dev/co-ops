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
import { selectAllRows } from "@/lib/supabase-paginate";
import type { AuthContext } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { catalogShopAllowed, assertScopeToken } from "@/lib/sku-versions-shared";
import { ownerVisible, creationScope, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { loadProductIndex } from "@/lib/products";
import { loadSkuPackChains } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "@/components/admin/recipes/RecipeBuilder";

export interface RecipeBuilderCatalog {
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  products: RecipeBuilderProduct[];
  outputItems: Array<{ id: string; name: string }>;
  prices: Map<string, number>;
  unitOptions: Array<{ id: string; label: string }>;
  /** EVERY measure (active or not), so a saved line in a retired unit still converts to oz. */
  measures: Map<string, MeasureUnitFactor>;
  /** The ACTIVE measure labels — the only ones the line editor offers (Astra full-branch #4). */
  activeMeasureLabels: string[];
}

type CatalogRead<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }> & {
  range(from: number, to: number): CatalogRead<T>;
  order(column: string): CatalogRead<T>;
};

/** Jobs opt into complete, fail-closed reads; existing builder callers keep their posture. */
export async function loadRecipeBuilderCatalog(actor: AuthContext, scope: string | null, outputOwner: string | null = null, options: { strict?: boolean } = {}): Promise<RecipeBuilderCatalog> {
  const level = getRoleLevel(actor.user.role);
  if (actor.user.role === "social_media_mgr" || level < 6 || (scope !== null && !catalogShopAllowed({ level, locations: actor.locations }, scope))) throw new ShopOwnedError(404, "not_found");
  if (outputOwner !== null && outputOwner !== scope) throw new ShopOwnedError(404, "not_found");
  if (scope !== null) assertScopeToken(scope);
  const sb = getServiceRoleClient();
  async function read<T>(factory: () => CatalogRead<T>, key: string) {
    if (!options.strict) return await factory();
    const rows: T[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await factory().order(key).range(from, from + 499);
      if (error) throw new Error(`builder catalog: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) return { data: rows, error: null };
    }
  }
  async function batchMap<T>(ids: string[], loader: (chunk: string[]) => Promise<ReadonlyMap<string, T>>) {
    if (!options.strict) return new Map(await loader(ids));
    const result = new Map<string, T>();
    for (let start = 0; start < ids.length; start += 100) {
      for (const [id, value] of await loader(ids.slice(start, start + 100))) result.set(id, value);
    }
    return result;
  }
  const skuQuery = () => {
    let query = sb.from("vendor_items")
      .select("id, name, location_id, vendor_id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .eq("active", true).eq("inventory_only", false);
    if (options.strict) query = scope === null ? query.is("location_id", null) : query.or(`location_id.is.null,location_id.eq.${scope}`);
    return query;
  };
  const itemQuery = () => {
    let query = sb.from("items").select("id, name, location_id").eq("active", true);
    if (options.strict) query = scope === null ? query.is("location_id", null) : query.or(`location_id.is.null,location_id.eq.${scope}`);
    return query;
  };
  const [skusRes, itemsRes, unitsRes, measuresRes, productsRes, vendorsRes] = await Promise.all([
    read(() => skuQuery()
      .order("name")
      .returns<Array<{
        id: string; name: string; location_id: string | null; vendor_id: string | null;
        pack_format: string | null;
        each_container_label: string | null;
        units_per_pack: number | string | null;
        each_size: number | string | null;
        each_measure: string | null;
        avg_oz_per_each: number | string | null;
      }>>(), "id"),
    read(() => itemQuery().order("name").returns<Array<{ id: string; name: string; location_id: string | null }>>(), "id"),
    read(() => sb.from("units").select("id, label").order("label").returns<Array<{ id: string; label: string }>>(), "id"),
    read(() => sb
      .from("measure_units")
      .select("label, dimension, to_base_factor, active")
      .returns<Array<{ label: string; dimension: string; to_base_factor: number | string; active: boolean | null }>>(), "label"),
    read(() => sb
      .from("products")
      .select("id, name, unit_oz")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string; unit_oz: number | string | null }>>(), "id"),
    read(() => sb.from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>(), "id"),
  ]);

  const visibleSkus = (skusRes.data ?? []).filter(s => ownerVisible(s.location_id, scope));
  const [resolution, packs, prices] = await Promise.all([
    batchMap((productsRes.data ?? []).map(p => p.id), async ids => (await loadProductIndex(ids, scope)).index.resolution),
    batchMap(visibleSkus.map(s => s.id), ids => loadSkuPackChains(ids, scope)),
    batchMap(visibleSkus.map(s => s.id), ids => loadCurrentSkuPrices(ids, scope)),
  ]);
  const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]));
  const skus: RecipeBuilderSku[] = visibleSkus.map((s) => ({
    id: s.id,
    packChain: packs.get(s.id),
    name: s.name,
    vendorName: s.vendor_id ? (vendorNameById.get(s.vendor_id) ?? null) : null,
    packFormat: s.pack_format ?? null,
    eachContainerLabel: s.each_container_label ?? null,
    unitsPerPack: s.units_per_pack != null ? Number(s.units_per_pack) : null,
    eachSize: s.each_size != null ? Number(s.each_size) : null,
    eachMeasure: s.each_measure ?? null,
    avgOzPerEach: s.avg_oz_per_each != null ? Number(s.avg_oz_per_each) : null,
  }));
  const items = (itemsRes.data ?? []).filter(i => ownerVisible(i.location_id, scope)).map((i) => ({ id: i.id, name: i.name }));
  const products: RecipeBuilderProduct[] = (productsRes.data ?? []).filter(p => resolution.get(p.id)?.skuId != null).map((p) => ({
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
  const outputItems = (itemsRes.data ?? []).filter(i => (i.location_id ?? null) === outputOwner).map(i => ({ id: i.id, name: i.name }));
  return { outputItems, prices, skus, items, products, unitOptions, measures, activeMeasureLabels };
}

/** Pages authorize before choosing a scope; explicit foreign queries never fall back silently. */
export async function loadRecipeBuilderScope(actor: AuthContext, requested: string | undefined, creation: boolean, owner?: string | null, options: { minimumLevel?: number; defaultToShop?: boolean } = {}) {
  const level = getRoleLevel(actor.user.role);
  if (actor.user.role === "social_media_mgr" || level < (options.minimumLevel ?? 6)) throw new ShopOwnedError(403, "forbidden");
  const data = await selectAllRows<{ id: string; name: string }>((from, to) => getServiceRoleClient().from("locations").select("id,name").eq("active", true).order("name").order("id").range(from, to).returns<Array<{id: string; name: string}>>());
  const shops = data.filter(s => catalogShopAllowed({ level, locations: actor.locations }, s.id));
  if (owner != null) {
    if (!shops.some(s => s.id === owner)) throw new ShopOwnedError(404, "not_found");
    return { scope: owner, shops: shops.filter(s => s.id === owner), allowGlobal: false };
  }
  if (creation && requested === undefined && options.defaultToShop) {
    const { resolveShopId } = await import("@/lib/shop-context");
    const scope = await resolveShopId(shops.map(s => s.id), undefined);
    if (scope === null) throw new ShopOwnedError(400, "location_required");
    return { scope, shops, allowGlobal: level >= 8 };
  }
  const allowGlobal = !creation || level >= 8;
  if (creation) {
    const gate = creationScope({ role: actor.user.role, level, locations: actor.locations }, requested === "global" ? null : requested);
    if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
    if (gate.scope !== null && !shops.some(s => s.id === gate.scope)) throw new ShopOwnedError(404, "not_found");
    return {scope: gate.scope, shops, allowGlobal};
  }
  if (requested === undefined) return {scope: null, shops, allowGlobal};
  if (requested === "global") {
    if (!allowGlobal) throw new ShopOwnedError(403, "global_requires_moo");
    return { scope: null, shops, allowGlobal };
  }
  if (requested !== undefined && !shops.some(s => s.id === requested)) throw new ShopOwnedError(404, "not_found");
  const { resolveShopId } = await import("@/lib/shop-context");
  const scope = await resolveShopId(shops.map(s => s.id), requested);
  if (scope === null && !allowGlobal) throw new ShopOwnedError(400, "location_required");
  return { scope, shops, allowGlobal };
}

export async function loadRecipePrepSections(actor: AuthContext) {
  const sb = getServiceRoleClient();
  const { data: sections, error: sectionError } = await sb.from("prep_sections").select("slug, label_en, label_es").eq("active", true).order("display_order").returns<Array<{ slug: string; label_en: string; label_es: string | null }>>();
  if (sectionError) throw new Error(`builder prep sections: ${sectionError.message}`);
  const prepSections = (sections ?? []).map(section => ({ slug: section.slug, label: actor.user.language === "es" ? section.label_es ?? section.label_en : section.label_en }));
  return prepSections;
}
