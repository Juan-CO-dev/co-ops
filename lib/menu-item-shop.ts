/**
 * THE MENU OVERLAY LOADER (catalog Phase 3a, 0263). SERVER-ONLY, service role. One shop's LIVE
 * overlay rows, keyed by menu item; consumers hand them to resolveMenuItemForShop and never pick a
 * row themselves. PAGED. Fails loud: a dropped read would show the global price as this shop's.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { assertScopeToken } from "@/lib/sku-versions-shared";
import type { MenuItemShopSettingRow } from "@/lib/menu-item-shop-shared";

export const MENU_SHOP_SETTING_COLUMNS =
  "id, menu_item_id, location_id, based_on_setting_id, price, sold_here, name_override, name_override_es, valid_from, valid_to, active, note, created_by";

export async function loadLiveMenuItemShopSettings(shopId: string): Promise<Map<string, MenuItemShopSettingRow>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<MenuItemShopSettingRow>(async (from, to) => {
    const { data, error } = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS)
      .eq("location_id", assertScopeToken(shopId)).eq("active", true)
      .order("id", { ascending: true }).range(from, to).returns<MenuItemShopSettingRow[]>();
    if (error) throw new Error(`loadLiveMenuItemShopSettings: ${error.message}`);
    return { data };
  });
  return new Map(rows.map((r) => [r.menu_item_id, r]));
}
