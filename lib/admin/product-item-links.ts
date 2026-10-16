import "server-only";
import { ownerVisible } from "@/lib/catalog/shop-owned-shared";
import { catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeInputsAcrossScopes, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { ITEMS_READ_MIN } from "@/lib/admin/items";
import { PRODUCT_READ_MIN } from "@/lib/products";
import { mapProductItemLinks, type LinkEntity, type LinkSku, type LinkInput, type LinkOutput } from "./product-item-links-shared";

/** Whole registries, fixed batch reads (paged past the PostgREST cap), no per-row
 * requests or unbounded ID lists. Read errors throw; an outage is not "no links".
 * Kept separate from listProducts so unrelated pickers do not load the graph.
 */
export async function loadProductItemLinks(actor: AuthContext, scope: VersionScope = null) {
  if (getRoleLevel(actor.user.role) < Math.max(ITEMS_READ_MIN, PRODUCT_READ_MIN)) throw new Error("forbidden");
  if (scope !== null && !catalogShopAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, scope)) throw new Error("not_found");
  const sb = getServiceRoleClient();
  const [recipes, inputs, outputs, products, skus, items, vendors] = await Promise.all([
    selectAllRows<{ id: string; active: boolean; location_id: string | null }>((from, to) => sb.from("recipes")
      .select("id, active, location_id").eq("active", true).order("id").range(from, to)),
    // CATALOG PHASE 3a: a product feeds an item if ANY scope's recipe says so (the default or a shop's version).
    (scope === null ? loadRecipeInputsAcrossScopes() : loadResolvedRecipeInputs(scope)).then((rows) => rows.map((r): LinkInput => ({
      recipe_id: r.recipe_id, component_product_id: r.component_product_id,
      component_sku_id: r.component_sku_id, component_item_id: r.component_item_id,
    }))),
    selectAllRows<LinkOutput>((from, to) => sb.from("recipe_outputs")
      .select("recipe_id, output_item_id").not("output_item_id", "is", null).order("id").range(from, to)),
    selectAllRows<LinkEntity>((from, to) => sb.from("products")
      .select("id, name, name_es, active").eq("active", true).order("id").range(from, to)),
    selectAllRows<LinkSku & { location_id: string | null }>((from, to) => sb.from("vendor_items")
      .select("id, name, active, product_id, vendor_id, location_id").eq("active", true).order("id").range(from, to)),
    selectAllRows<LinkEntity & { location_id: string | null }>((from, to) => sb.from("items")
      .select("id, name, name_es, active, location_id").eq("active", true).order("id").range(from, to)),
    selectAllRows<{ id: string; name: string }>((from, to) => sb.from("vendors")
      .select("id, name").order("id").range(from, to)),
  ]);
  return mapProductItemLinks({ recipes: scope === null ? recipes : recipes.filter(r => ownerVisible(r.location_id, scope)), inputs, outputs, products, skus: scope === null ? skus : skus.filter(s => ownerVisible(s.location_id, scope)), items, vendors }, scope);
}
