/** Sharing engines. Previews are stale-state checks, never authority; every write
 * reauthorizes and SQL compares the same dependency snapshot under its locks. */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeInputsAcrossScopes, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { shareGate, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { RecipeVersionError, recipeVersionErrorFromRpc } from "@/lib/admin/recipe-versions";
import { previewToken } from "@/lib/catalog/change-preview-shared";
import { audit } from "@/lib/audit";

type Kind = "sku" | "recipe" | "menu_item";
type Named = { id: string; name: string };
type Owned = Named & { location_id: string | null; active: boolean; name_es?: string | null; menu_price?: number | string | null };
type Output = { id: string; recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null };
type Blocker = Named & { shopName: string | null; kind: "sku" | "item"; producers?: Array<Named & { ownerLocationId: string | null }> };
type Snapshot = Record<string, unknown>;
interface CommonPreview {
  name: string; ownerShopId: string; ownerShopName: string | null;
  token: string; snapshot: Snapshot;
}
export interface ShareSkuPreview extends CommonPreview {
  skuId: string; usedIn: Named[]; ownerKeepsOwnPack: boolean; ownerKeepsOwnPrice: boolean;
}
export interface ShareRecipePreview extends CommonPreview {
  recipeId: string; shopOnlyItems: Named[]; shopOnlySkus: Named[];
  makesSandwich: Named | null; blockedBy: Blocker[];
}
export interface ShareMenuItemPreview extends CommonPreview {
  menuItemId: string; nameEs: string | null; price: number | null; recipes: Named[];
  shopOnlyItems: Named[]; shopOnlySkus: Named[]; blockedBy: Blocker[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireShare(actor: AuthContext, ...ids: string[]): void {
  const gate = shareGate({ role: actor.user.role, level: actor.level });
  if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
  if (ids.some(id => typeof id !== "string" || !UUID.test(id))) throw new ShopOwnedError(400, "invalid_payload");
}
const tableFor = { sku: "vendor_items", recipe: "recipes", menu_item: "menu_items" } as const;
const named = (rows: Owned[]): Named[] => rows.map(({ id, name }) => ({ id, name }));
async function readRows<T>(table: string, columns: string): Promise<T[]> {
  const sb = getServiceRoleClient();
  return selectAllRows<T>((from, to) => sb.from(table).select(columns).order("id").range(from, to).returns<T[]>());
}
async function base(actor: AuthContext, kind: Kind, id: string) {
  requireShare(actor, id);
  const sb = getServiceRoleClient();
  // Capture before any projected values; the locked writer must match this exact state.
  const { data: snapshot, error: snapshotError } = await sb.rpc("catalog_share_snapshot", { p_kind: kind, p_id: id });
  if (snapshotError) recipeVersionErrorFromRpc(snapshotError.message, snapshotError.code);
  if (!snapshot || typeof snapshot !== "object") throw new Error("share snapshot missing");
  const columns = kind === "menu_item" ? "id,name,name_es,menu_price,location_id,active" : "id,name,location_id,active";
  const { data: target, error } = await sb.from(tableFor[kind]).select(columns).eq("id", id).maybeSingle<Owned>();
  if (error) throw new Error(`share target: ${error.message}`);
  if (!target || target.active === false) throw new ShopOwnedError(404, "not_found");
  if (target.location_id === null) throw new ShopOwnedError(409, "already_shared");
  const shops = await readRows<Named>("locations", "id,name");
  const names = new Map(shops.map(shop => [shop.id, shop.name]));
  return { target, names, common: {
    name: target.name, ownerShopId: target.location_id,
    ownerShopName: names.get(target.location_id) ?? null, snapshot: snapshot as Snapshot,
  } };
}

export async function previewShareSku(actor: AuthContext, skuId: string): Promise<ShareSkuPreview> {
  const { common } = await base(actor, "sku", skuId);
  const sb = getServiceRoleClient();
  const [lines, recipes, pack, price] = await Promise.all([
    loadRecipeInputsAcrossScopes(), readRows<Owned>("recipes", "id,name,location_id,active"),
    sb.from("sku_pack_versions").select("id").eq("sku_id", skuId).eq("location_id", common.ownerShopId).eq("active", true).limit(1),
    sb.from("sku_price_lanes").select("id").eq("sku_id", skuId).eq("location_id", common.ownerShopId).eq("active", true).limit(1),
  ]);
  if (pack.error || price.error) throw new Error(`share versions: ${pack.error?.message ?? price.error?.message}`);
  const used = new Set(lines.filter(line => line.component_sku_id === skuId).map(line => line.recipe_id));
  const body = { ...common, skuId, usedIn: named(recipes.filter(row => row.active !== false && used.has(row.id))),
    ownerKeepsOwnPack: (pack.data?.length ?? 0) > 0, ownerKeepsOwnPrice: (price.data?.length ?? 0) > 0 };
  return { ...body, token: previewToken(body) };
}

async function recipePreview(actor: AuthContext, kind: "recipe" | "menu_item", id: string) {
  const { target, names, common } = await base(actor, kind, id);
  const [outputs, recipes, inputs, skus, items, menus] = await Promise.all([
    readRows<Output>("recipe_outputs", "id,recipe_id,output_item_id,output_menu_item_id"),
    readRows<Owned>("recipes", "id,name,location_id,active"),
    // Owned recipes have no shop versions: the resolver uses their actual default live lines.
    loadResolvedRecipeInputs(common.ownerShopId),
    readRows<Owned>("vendor_items", "id,name,location_id,active"),
    readRows<Owned>("items", "id,name,location_id,active"),
    readRows<Owned>("menu_items", "id,name,location_id,active"),
  ]);
  // Inactive producers travel too, matching the SQL writer's reactivation safeguard.
  const recipeIds = new Set(kind === "recipe" ? [id] : outputs.filter(o => o.output_menu_item_id === id).map(o => o.recipe_id));
  const lines = inputs.filter(line => recipeIds.has(line.recipe_id));
  const skuIds = new Set(lines.map(line => line.component_sku_id));
  const itemIds = new Set(lines.map(line => line.component_item_id));
  const out = outputs.filter(row => recipeIds.has(row.recipe_id));
  const madeItems = new Set(out.map(row => row.output_item_id));
  const madeMenus = new Set(out.map(row => row.output_menu_item_id));
  const ownedSkus = skus.filter(row => skuIds.has(row.id) && row.location_id !== null);
  const blockedBy: Blocker[] = [
    ...ownedSkus.filter(row => row.location_id !== common.ownerShopId).map(row => ({ id: row.id, name: row.name, kind: "sku" as const, shopName: names.get(row.location_id!) ?? null })),
    ...items.filter(row => itemIds.has(row.id) && row.location_id !== null).map(row => ({
      id: row.id, name: row.name, kind: "item" as const, shopName: names.get(row.location_id!) ?? null,
      // These rows were already read for the MoO-only preview. Preserve the producer's
      // owner scope in the link; the output item's id is not a recipe id.
      producers: recipes.filter(recipe => recipe.active !== false && outputs.some(output => output.output_item_id === row.id && output.recipe_id === recipe.id))
        .map(recipe => ({ id: recipe.id, name: recipe.name, ownerLocationId: recipe.location_id })),
    })),
  ];
  return { target, common, recipes: named(recipes.filter(row => recipeIds.has(row.id))),
    shopOnlyItems: named(items.filter(row => madeItems.has(row.id) && row.location_id === common.ownerShopId)),
    shopOnlySkus: named(ownedSkus.filter(row => row.location_id === common.ownerShopId)),
    makesSandwich: named(menus.filter(row => madeMenus.has(row.id)))[0] ?? null, blockedBy };
}
export async function previewShareRecipe(actor: AuthContext, recipeId: string): Promise<ShareRecipePreview> {
  const p = await recipePreview(actor, "recipe", recipeId);
  const body = { ...p.common, recipeId, shopOnlyItems: p.shopOnlyItems, shopOnlySkus: p.shopOnlySkus, makesSandwich: p.makesSandwich, blockedBy: p.blockedBy };
  return { ...body, token: previewToken(body) };
}
export async function previewShareMenuItem(actor: AuthContext, menuItemId: string): Promise<ShareMenuItemPreview> {
  const p = await recipePreview(actor, "menu_item", menuItemId);
  const body = { ...p.common, menuItemId, nameEs: p.target.name_es ?? null, price: p.target.menu_price == null ? null : Number(p.target.menu_price),
    recipes: p.recipes, shopOnlyItems: p.shopOnlyItems, shopOnlySkus: p.shopOnlySkus, blockedBy: p.blockedBy };
  return { ...body, token: previewToken(body) };
}

interface ShareRequest { expectedOwner: string; previewToken: string }
const sameSet = (a: string[], b: Named[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify(b.map(row => row.id).sort());
async function apply(actor: AuthContext, kind: Kind, id: string, request: ShareRequest, preview: CommonPreview, items: string[], skus: string[]) {
  requireShare(actor, id, request.expectedOwner, ...items, ...skus);
  if (request.expectedOwner !== preview.ownerShopId) throw new ShopOwnedError(409, "ownership_changed");
  if (typeof request.previewToken !== "string" || request.previewToken !== preview.token) throw new RecipeVersionError(409, "preview_stale");
  const { data, error } = await getServiceRoleClient().rpc("share_catalog_entity", {
    p_kind: kind, p_id: id, p_expected_owner: request.expectedOwner, p_expected_snapshot: preview.snapshot,
    p_expected_items: items, p_expected_skus: skus, p_actor: actor.user.id,
  });
  if (error) recipeVersionErrorFromRpc(error.message, error.code);
  if (!data || typeof data !== "object") throw new Error("share writer returned no result");
  const result = data as { id: string; item_ids?: string[]; sku_ids?: string[]; recipe_ids?: string[] };
  await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: kind === "sku" ? "vendor_item.update" : kind === "recipe" ? "recipe.update" : "menu_item.update",
    resourceTable: tableFor[kind], resourceId: id,
    metadata: { operation: "share_to_global", from_location_id: request.expectedOwner, item_ids: result.item_ids ?? items,
      sku_ids: result.sku_ids ?? skus, recipe_ids: result.recipe_ids ?? (kind === "recipe" ? [id] : []) }, ipAddress: null, userAgent: null });
  return result;
}
export async function shareSkuWithAllShops(actor: AuthContext, input: ShareRequest & { skuId: string }): Promise<void> {
  requireShare(actor, input.skuId, input.expectedOwner);
  await apply(actor, "sku", input.skuId, input, await previewShareSku(actor, input.skuId), [], []);
}
function checkDependencies(p: ShareRecipePreview | ShareMenuItemPreview, items: string[], skus: string[]) {
  if ("makesSandwich" in p && p.makesSandwich) throw new ShopOwnedError(409, "share_the_sandwich");
  if (p.blockedBy.length) throw new ShopOwnedError(409, p.blockedBy.some(row => row.kind === "sku") ? "uses_other_shop_sku" : "uses_shop_only_item");
  if (!sameSet(items, p.shopOnlyItems)) throw new ShopOwnedError(409, "items_changed");
  if (!sameSet(skus, p.shopOnlySkus)) throw new ShopOwnedError(409, "skus_changed");
}
export async function shareRecipeWithAllShops(actor: AuthContext, input: ShareRequest & { recipeId: string; shareItemIds: string[]; shareSkuIds: string[] }) {
  requireShare(actor, input.recipeId, input.expectedOwner);
  if (!Array.isArray(input.shareItemIds) || !Array.isArray(input.shareSkuIds)) throw new ShopOwnedError(400, "invalid_payload");
  requireShare(actor, ...input.shareItemIds, ...input.shareSkuIds);
  const p = await previewShareRecipe(actor, input.recipeId);
  checkDependencies(p, input.shareItemIds, input.shareSkuIds);
  const r = await apply(actor, "recipe", input.recipeId, input, p, input.shareItemIds, input.shareSkuIds);
  return { itemIds: r.item_ids ?? [], skuIds: r.sku_ids ?? [] };
}
export async function shareMenuItemWithAllShops(actor: AuthContext, input: ShareRequest & { menuItemId: string; shareSkuIds: string[] }) {
  requireShare(actor, input.menuItemId, input.expectedOwner);
  if (!Array.isArray(input.shareSkuIds)) throw new ShopOwnedError(400, "invalid_payload");
  requireShare(actor, ...input.shareSkuIds);
  const p = await previewShareMenuItem(actor, input.menuItemId);
  const items = p.shopOnlyItems.map(row => row.id);
  checkDependencies(p, items, input.shareSkuIds);
  const r = await apply(actor, "menu_item", input.menuItemId, input, p, items, input.shareSkuIds);
  return { recipeIds: r.recipe_ids ?? [], skuIds: r.sku_ids ?? [], itemIds: items };
}
