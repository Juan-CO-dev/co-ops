import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { ITEMS_READ_MIN } from "@/lib/admin/items";
import { PRODUCT_READ_MIN } from "@/lib/products";
import { mapProductItemLinks, type LinkEntity, type LinkSku, type LinkInput, type LinkOutput } from "./product-item-links-shared";

/** Whole registries, fixed batch reads (paged past the PostgREST cap), no per-row
 * requests or unbounded ID lists. Read errors throw; an outage is not "no links".
 * Kept separate from listProducts so unrelated pickers do not load the graph.
 */
export async function loadProductItemLinks(actor: AuthContext) {
  if (getRoleLevel(actor.user.role) < Math.max(ITEMS_READ_MIN, PRODUCT_READ_MIN)) throw new Error("forbidden");
  const sb = getServiceRoleClient();
  const [recipes, inputs, outputs, products, skus, items, vendors] = await Promise.all([
    selectAllRows<{ id: string; active: boolean }>((from, to) => sb.from("recipes")
      .select("id, active").eq("active", true).order("id").range(from, to)),
    selectAllRows<LinkInput>((from, to) => sb.from("recipe_inputs")
      .select("recipe_id, component_product_id, component_sku_id, component_item_id").order("id").range(from, to)),
    selectAllRows<LinkOutput>((from, to) => sb.from("recipe_outputs")
      .select("recipe_id, output_item_id").not("output_item_id", "is", null).order("id").range(from, to)),
    selectAllRows<LinkEntity>((from, to) => sb.from("products")
      .select("id, name, name_es, active").eq("active", true).order("id").range(from, to)),
    selectAllRows<LinkSku>((from, to) => sb.from("vendor_items")
      .select("id, name, active, product_id, vendor_id").eq("active", true).order("id").range(from, to)),
    selectAllRows<LinkEntity & { location_id: string | null }>((from, to) => sb.from("items")
      .select("id, name, name_es, active, location_id").eq("active", true).is("location_id", null).order("id").range(from, to)),
    selectAllRows<{ id: string; name: string }>((from, to) => sb.from("vendors")
      .select("id, name").order("id").range(from, to)),
  ]);
  return mapProductItemLinks({ recipes, inputs, outputs, products, skus, items, vendors });
}
