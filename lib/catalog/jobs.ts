/** Authorized, read-only job page loaders. No preview evidence crosses page props. */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { ownerVisible, ownerWriteCheck, shareGate, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { loadRecipeBuilderCatalog, loadRecipeBuilderScope } from "@/lib/admin/recipe-builder-data";
import { loadLiveSwapsForItem } from "@/lib/catalog/swap-vendor";
import type { JobScopeView, JobOwner, JobVendorOptions, NewItemJobView, NewSandwichJobView, ItemJobsStripView, SwapVendorJobView } from "@/lib/catalog/jobs-shared";

export { loadToastLinkChoices } from "@/lib/catalog/toast-link";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Option = { id: string; name: string };
type Sku = Option & { location_id: string | null; vendor_id: string | null; product_id: string | null; active: boolean; inventory_only: boolean };
const SKU_COLUMNS = "id,name,location_id,vendor_id,product_id,active,inventory_only";
function actorFacts(actor: AuthContext) { return { role: actor.user.role, level: getRoleLevel(actor.user.role), locations: actor.locations }; }
function requireRole(actor: AuthContext, minimum = 7) {
  if (actor.user.role === "social_media_mgr" || getRoleLevel(actor.user.role) < minimum) throw new ShopOwnedError(403, "forbidden");
}

async function shopsFor(actor: AuthContext): Promise<Option[]> {
  const facts = actorFacts(actor);
  return (await selectAllRows<Option>((from, to) => getServiceRoleClient().from("locations")
    .select("id,name").eq("active", true).order("name").order("id").range(from, to).returns<Option[]>()))
    .filter(shop => catalogShopAllowed(facts, shop.id));
}

/** Omission uses the remembered authorized shop. Explicit null means global. */
async function jobScope(actor: AuthContext, requested?: string | null): Promise<JobScopeView> {
  return loadRecipeBuilderScope(actor, requested === null ? "global" : requested, true, undefined,
    { minimumLevel: 7, defaultToShop: true });
}

/** Bounded request lines AND paginated responses; never one request per vendor. */
async function byIds<T>(table: string, columns: string, key: string, ids: readonly string[]): Promise<T[]> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    rows.push(...await selectAllRows<T>((from, to) => getServiceRoleClient().from(table).select(columns)
      .in(key, unique.slice(offset, offset + 100)).order("id").range(from, to).returns<T[]>()));
  }
  return rows;
}

async function vendorOptions(scope: string | null): Promise<JobVendorOptions> {
  const sb = getServiceRoleClient();
  type Registry = { id: string; slug: string; label: string; label_es: string | null };
  const registry = (table: string) => selectAllRows<Registry>((from, to) => sb.from(table)
    .select("id,slug,label,label_es").eq("active", true).order("display_order").order("id").range(from, to).returns<Registry[]>());
  const [vendors, categories, orderTypes] = await Promise.all([
    selectAllRows<Option>((from, to) => sb.from("vendors").select("id,name").eq("active", true).eq("source_kind", "vendor")
      .order("name").order("id").range(from, to).returns<Option[]>()), registry("categories"), registry("order_types"),
  ]);
  type Guide = { id: string; vendor_id: string; name: string; updated_at: string };
  type Section = { id: string; guide_id: string; name: string; position: number };
  type Rhythm = { id: string; vendor_id: string; order_dow: number; lead_days: number };
  const [guides, rhythm] = await Promise.all([
    byIds<Guide>("vendor_order_guides", "id,vendor_id,name,updated_at", "vendor_id", vendors.map(v => v.id)),
    scope === null ? Promise.resolve([] as Rhythm[]) : selectAllRows<Rhythm>((from, to) => sb.from("vendor_delivery_rhythm")
      .select("id,vendor_id,order_dow,lead_days").eq("location_id", scope).eq("active", true).order("id").range(from, to).returns<Rhythm[]>()),
  ]);
  const sections = await byIds<Section>("order_guide_sections", "id,guide_id,name,position", "guide_id", guides.map(g => g.id));
  const vendorIds = new Set(vendors.map(v => v.id));
  const labels = (rows: Registry[]) => rows.map(r => ({ id: r.id, slug: r.slug, label: r.label, labelEs: r.label_es }));
  return { vendors, categories: labels(categories), orderTypes: labels(orderTypes),
    // Section choices only, never a filtered guide submitted as a whole-guide save.
    guides: guides.map(g => ({ id: g.id, vendorId: g.vendor_id, name: g.name, updatedAt: g.updated_at,
      sections: sections.filter(s => s.guide_id === g.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map(s => ({ id: s.id, name: s.name, position: s.position })) })),
    rhythm: rhythm.filter(r => vendorIds.has(r.vendor_id)).map(r => ({ id: r.id, vendorId: r.vendor_id, orderDow: r.order_dow, leadDays: r.lead_days })),
  };
}

/** Active global rows plus authorized shop rows, paginated and bounded by 100 shop IDs. */
async function activeJobRows<T>(table: string, columns: string, shopIds: string[]): Promise<T[]> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<T>((from, to) => sb.from(table).select(columns).eq("active", true)
    .is("location_id", null).order("id").range(from, to).returns<T[]>());
  for (let offset = 0; offset < shopIds.length; offset += 100) {
    rows.push(...await selectAllRows<T>((from, to) => sb.from(table).select(columns).eq("active", true)
      .in("location_id", shopIds.slice(offset, offset + 100)).order("id").range(from, to).returns<T[]>()));
  }
  return rows;
}
export async function loadNewItemJobView(actor: AuthContext, requested?: string | null): Promise<NewItemJobView> {
  const scope = await jobScope(actor, requested);
  const sb = getServiceRoleClient();
  type Measure = { label: string; dimension: "weight" | "volume" | "count" };
  type Recipe = { id: string; name: string; location_id: string | null };
  type Version = { id: string; recipe_id: string; location_id: string | null };
  type Rhythm = { id: string; vendor_id: string; location_id: string; order_dow: number; lead_days: number; active: boolean };
  const shopIds = scope.shops.map(shop => shop.id);
  const [options, measures, recipeRows, versions, rhythms] = await Promise.all([
    vendorOptions(scope.scope),
    selectAllRows<Measure>((from, to) => sb.from("measure_units").select("label,dimension").eq("active", true)
      .order("label").range(from, to).returns<Measure[]>()),
    activeJobRows<Recipe>("recipes", "id,name,location_id", shopIds),
    activeJobRows<Version>("recipe_versions", "id,recipe_id,location_id", shopIds),
    byIds<Rhythm>("vendor_delivery_rhythm", "id,vendor_id,location_id,order_dow,lead_days,active", "location_id", shopIds),
  ]);
  const heads = new Map(versions.map(v => [`${v.recipe_id}:${v.location_id ?? "global"}`, v.id]));
  // Mirror loadRecipeLiveSet/saveRecipeLines: owned recipes write their default;
  // a shared recipe's first shop override names a null shop head AND the global base.
  const recipesAt = (shopId: string | null) => recipeRows.filter(r => ownerVisible(r.location_id, shopId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(r => {
      const writeScope = r.location_id !== null ? null : shopId;
      const expected = heads.get(`${r.id}:${writeScope ?? "global"}`) ?? null;
      return { id: r.id, name: r.name, activeVersionId: expected,
        basedOnVersionId: writeScope !== null && expected === null ? heads.get(`${r.id}:global`) ?? null : null };
    });
  const vendorIds = new Set(options.vendors.map(v => v.id));
  return { ...scope, ...options, measures, recipes: recipesAt(scope.scope),
    setupShops: scope.shops.map(shop => ({ shopId: shop.id, recipes: recipesAt(shop.id),
      rhythm: rhythms.filter(r => r.active && r.location_id === shop.id && vendorIds.has(r.vendor_id))
        .map(r => ({ id: r.id, vendorId: r.vendor_id, orderDow: r.order_dow, leadDays: r.lead_days })) })) };
}

export async function loadNewSandwichJobView(actor: AuthContext, requested?: string | null): Promise<NewSandwichJobView> {
  const scope = await jobScope(actor, requested);
  const catalog = await loadRecipeBuilderCatalog(actor, scope.scope, scope.scope, { strict: true });
  return { ...scope, catalog: { ...catalog, prices: [...catalog.prices], measures: [...catalog.measures] } };
}

async function readSku(skuId: string, scope: string | null): Promise<Sku> {
  if (!UUID.test(skuId)) throw new ShopOwnedError(400, "invalid_payload");
  const { data, error } = await getServiceRoleClient().from("vendor_items").select(SKU_COLUMNS).eq("id", skuId).maybeSingle<Sku>();
  if (error) throw new Error(`job SKU: ${error.message}`);
  if (!data || !data.active || !ownerVisible(data.location_id, scope)) throw new ShopOwnedError(404, "sku_not_found");
  return data;
}

async function strip(actor: AuthContext, sku: Sku, scope: string | null, shops: Option[]): Promise<ItemJobsStripView> {
  const ownerShop = sku.location_id === null ? null : shops.find(shop => shop.id === sku.location_id);
  if (sku.location_id !== null && !ownerShop) throw new ShopOwnedError(404, "not_found");
  const facts = actorFacts(actor);
  const owner: JobOwner = { ownerLocationId: sku.location_id, ownerShopName: ownerShop?.name ?? null,
    writeScope: sku.location_id === null ? scope : null,
    canEdit: sku.location_id === null ? facts.level >= 7 && (scope !== null || facts.level >= 8) : ownerWriteCheck(facts, sku.location_id).ok,
    canShare: sku.location_id !== null && shareGate(facts).ok };
  return { skuId: sku.id, name: sku.name, scope, owner,
    canSwap: !sku.inventory_only && facts.level >= 7 && (scope !== null || facts.level >= 8),
    liveSwaps: scope === null ? [] : await loadLiveSwapsForItem(actor, sku.id, scope) };
}

export async function loadItemJobsStrip(actor: AuthContext, skuId: string, shopId: string | null): Promise<ItemJobsStripView> {
  requireRole(actor, 6);
  if (shopId !== null && (!UUID.test(shopId) || !catalogShopAllowed(actorFacts(actor), shopId))) throw new ShopOwnedError(404, "not_found");
  const shops = await shopsFor(actor);
  if (shopId !== null && !shops.some(shop => shop.id === shopId)) throw new ShopOwnedError(404, "not_found");
  return strip(actor, await readSku(skuId, shopId), shopId, shops);
}

export async function loadSwapVendorJobView(actor: AuthContext, skuId: string, requested?: string | null): Promise<SwapVendorJobView> {
  const scope = await jobScope(actor, requested);
  const sku = await readSku(skuId, scope.scope);
  if (sku.inventory_only) throw new ShopOwnedError(404, "sku_not_found");
  const sb = getServiceRoleClient();
  const [options, candidates, disabled, jobs] = await Promise.all([
    vendorOptions(scope.scope),
    selectAllRows<Sku>((from, to) => {
      const q = sb.from("vendor_items").select(SKU_COLUMNS).eq("active", true).eq("inventory_only", false);
      return (scope.scope === null ? q.is("location_id", null) : q.or(`location_id.is.null,location_id.eq.${scope.scope}`))
        .order("name").order("id").range(from, to).returns<Sku[]>();
    }),
    scope.scope === null ? Promise.resolve([]) : selectAllRows<{ sku_id: string }>((from, to) => sb.from("location_sku_settings")
      .select("sku_id").eq("location_id", scope.scope!).eq("active_override", false).order("sku_id").range(from, to).returns<Array<{ sku_id: string }>>()),
    strip(actor, sku, scope.scope, scope.shops),
  ]);
  const vendors = new Map(options.vendors.map(v => [v.id, v.name]));
  const disabledIds = new Set(disabled.map(d => d.sku_id));
  return { ...scope, ...options, jobs, replacements: candidates
    .filter(c => c.id !== sku.id && !disabledIds.has(c.id) && (c.vendor_id === null || vendors.has(c.vendor_id)) && (!sku.product_id || !c.product_id || sku.product_id === c.product_id))
    .map(c => ({ id: c.id, name: c.name, vendorId: c.vendor_id, vendorName: c.vendor_id === null ? null : vendors.get(c.vendor_id)!, ownerLocationId: c.location_id, productId: c.product_id })) };
}
