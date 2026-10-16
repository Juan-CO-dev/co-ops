/** Atomic sandwich creation and a read-only draft preview. Toast is a separate confirmed action. */
import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { creationScope, ownerVisible, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";
import { parseNewSandwichRequest, type NewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
import { assertInputLineIsValidAgainst, RecipeError } from "@/lib/recipes";
import { recipeVersionErrorFromRpc } from "@/lib/admin/recipe-versions";
import { lineToRow } from "@/lib/recipe-line-shared";
import { loadProductIndex } from "@/lib/products";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost, type MenuCostRollup } from "@/lib/menu-costing-shared";
import { selectAllRows } from "@/lib/supabase-paginate";

type Prepared = NewSandwichRequest & { locationId: string | null };
/** Both preview and save validate the identical normalized payload and scope. SQL rechecks ownership under locks. */
async function prepare(actor: AuthContext, raw: unknown): Promise<Prepared> {
  const parsed = parseNewSandwichRequest(raw);
  if (!parsed.ok) throw new RecipeError(400, parsed.code);
  const scope = creationScope({ role: actor.user.role, level: getRoleLevel(actor.user.role), locations: actor.locations }, parsed.request.locationId);
  if (!scope.ok) throw new ShopOwnedError(scope.status, scope.code);
  const sb = getServiceRoleClient();
  if (scope.scope !== null) {
    const { data, error } = await sb.from("locations").select("id").eq("id", scope.scope).eq("active", true).maybeSingle();
    if (error) throw new Error(`new sandwich shop: ${error.message}`);
    if (!data) throw new ShopOwnedError(404, "location_not_found");
  }
  type Component = { id: string; location_id: string | null; active: boolean; inventory_only?: boolean };
  const readComponents = async (table: "vendor_items" | "items" | "products", ids: string[]): Promise<Component[]> => {
    const rows: Component[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      rows.push(...await selectAllRows<Component>((from, to) => sb.from(table)
        .select(table === "products" ? "id,active" : table === "vendor_items" ? "id,location_id,active,inventory_only" : "id,location_id,active")
        .in("id", ids.slice(i, i + 100)).order("id").range(from, to).returns<Component[]>()));
    }
    return rows;
  };
  const ids = (key: "componentSkuId" | "componentItemId" | "componentProductId") => [...new Set(parsed.request.inputs.flatMap(line => line[key] === null ? [] : [line[key]]))];
  const productIds = ids("componentProductId");
  const [skus, items, products, measures] = await Promise.all([
    readComponents("vendor_items", ids("componentSkuId")), readComponents("items", ids("componentItemId")), readComponents("products", productIds),
    selectAllRows<{ label: string }>((from, to) => sb.from("measure_units").select("label").eq("active", true).order("label").range(from, to)),
  ]);
  const productFacts = { productActive: new Map(products.map(row => [row.id, row.active])), activeMeasureLabels: new Set(measures.map(row => row.label)) };
  const skuMap = new Map(skus.map(row => [row.id, row]));
  const itemMap = new Map(items.map(row => [row.id, row]));
  const productIndex = productIds.length ? await loadProductIndex(productIds, scope.scope) : null;
  for (const [index, line] of parsed.request.inputs.entries()) {
    assertInputLineIsValidAgainst(line, productFacts);
    const component = line.componentSkuId ? skuMap.get(line.componentSkuId) : line.componentItemId ? itemMap.get(line.componentItemId) : null;
    if (line.componentProductId === null) {
      if (!component || !component.active || component.inventory_only === true) throw new RecipeError(400, "invalid_component");
      if (!ownerVisible(component.location_id, scope.scope)) throw new ShopOwnedError(400, "line_other_shop", undefined, { position: index + 1, reason: "line_other_shop" });
    } else if (!productIndex?.index.resolution.get(line.componentProductId)?.skuId) throw new RecipeError(400, "invalid_component_product");
  }
  return { ...parsed.request, locationId: scope.scope };
}

export async function previewNewSandwich(actor: AuthContext, raw: unknown): Promise<{ request: Prepared; cost: MenuCostRollup }> {
  const request = await prepare(actor, raw);
  const menuId = randomUUID();
  const graph = await loadRecipeGraph({ locationId: request.locationId, draftRecipes: [{
    recipeId: randomUUID(), batchYield: 1, inputs: request.inputs,
    outputs: [{ outputItemId: null, outputMenuItemId: menuId, yield: 1, ozPerParUnit: null }],
  }] });
  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()], request.locationId);
  return { request, cost: rollupMenuItemCost(graph, menuId, costPerOzFromGraph(graph, prices)) };
}

export async function createNewSandwich(actor: AuthContext, raw: unknown): Promise<{ recipeId: string; menuItemId: string }> {
  const request = await prepare(actor, raw);
  const { data, error } = await getServiceRoleClient().rpc("create_shop_sandwich", {
    p_menu: { name: request.name, name_es: request.nameEs, menu_price: request.menuPrice, section: request.section, catering_available: false },
    p_header: { name: request.name, name_es: request.nameEs, directions: request.directions, directions_es: request.directionsEs },
    p_inputs: request.inputs.map((line, display_order) => ({ ...lineToRow(line), display_order })),
    p_actor: actor.user.id, p_location_id: request.locationId,
  });
  if (error) {
    if (error.message.startsWith("shop_owned:")) shopOwnedErrorFromRpc(error.message);
    recipeVersionErrorFromRpc(error.message, error.code);
  }
  const result = data as { id?: string; menu_item_id?: string } | null;
  if (!result?.id || !result.menu_item_id) throw new Error("create_shop_sandwich returned no identities");
  const metadata = { location_id: request.locationId, name: request.name, atomic: true, recipe_id: result.id, menu_item_id: result.menu_item_id };
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.create", resourceTable: "recipes", resourceId: result.id, metadata, ipAddress: null, userAgent: null });
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "menu_item.create", resourceTable: "menu_items", resourceId: result.menu_item_id, metadata, ipAddress: null, userAgent: null });
  return { recipeId: result.id, menuItemId: result.menu_item_id };
}
