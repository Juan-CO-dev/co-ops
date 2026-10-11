/** Cache-only read: deliberately never imports Toast's API/fetch wrapper. */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { inStorePricesByGuid, hasInStoreMenu } from "@/lib/toast/in-store-prices-shared";

export async function loadCachedMenuPrices(): Promise<{
  zeroPriceModifierItems: Set<string>;
  prices: Map<string, number[]>; fetchedAt: string | null; unavailable: boolean;
  notices: Array<{ locationName: string; reason: "unavailable" | "menu_missing" | "menu_not_set" }>;
}> {
  try {
    const sb = getServiceRoleClient();
    const [maps, caches, locations] = await Promise.all([
      sb.from("toast_menu_map").select("location_id, menu_item_id, toast_item_guid, is_modifier")
        .eq("active", true).eq("match_status", "confirmed").not("menu_item_id", "is", null)
        .returns<Array<{ location_id: string; menu_item_id: string; toast_item_guid: string; is_modifier: boolean }>>(),
      sb.from("toast_menu_cache").select("restaurant_guid, payload, fetched_at")
        .returns<Array<{ restaurant_guid: string; payload: unknown; fetched_at: string }>>(),
      sb.from("locations").select("id, name, toast_restaurant_guid, toast_in_store_menu_name").eq("active", true)
        .returns<Array<{ id: string; name: string; toast_restaurant_guid: string | null; toast_in_store_menu_name: string | null }>>(),
    ]);
    if (maps.error || caches.error || locations.error) throw new Error("cache_read_failed");
    const prices = new Map<string, number[]>();
    const zeroPriceModifierItems = new Set<string>();
    const parsed = new Map<string, { item: Map<string, number[]>; modifier: Map<string, number[]>; zeroPriceModifierGuids: Set<string> }>();
    const notices: Array<{ locationName: string; reason: "unavailable" | "menu_missing" | "menu_not_set" }> = [];
    let oldest = Infinity;
    for (const location of locations.data ?? []) {
      const guid = location.toast_restaurant_guid;
      const menuName = location.toast_in_store_menu_name;
      if (!menuName?.trim()) notices.push({ locationName: location.name, reason: "menu_not_set" });
      try {
        const cache = caches.data?.find((c) => c.restaurant_guid === guid);
        if (!guid || !cache || !Number.isFinite(Date.parse(cache.fetched_at))) throw new Error("cache_missing");
        const item = inStorePricesByGuid(cache.payload, menuName, "item").prices;
        const modifier = inStorePricesByGuid(cache.payload, menuName, "modifier");
        parsed.set(location.id, { item, modifier: modifier.prices, zeroPriceModifierGuids: modifier.zeroPriceModifierGuids });
        oldest = Math.min(oldest, Date.parse(cache.fetched_at));
        if (menuName?.trim() && !hasInStoreMenu(cache.payload, menuName)) notices.push({ locationName: location.name, reason: "menu_missing" });
      } catch {
        console.warn("menu_costing_toast_cache_unavailable");
        notices.push({ locationName: location.name, reason: "unavailable" });
      }
    }
    for (const row of maps.data ?? []) {
      const shop = parsed.get(row.location_id);
      if (row.is_modifier && shop?.zeroPriceModifierGuids.has(row.toast_item_guid)) zeroPriceModifierItems.add(row.menu_item_id);
      const values = shop?.[row.is_modifier ? "modifier" : "item"].get(row.toast_item_guid) ?? [];
      prices.set(row.menu_item_id, [...(prices.get(row.menu_item_id) ?? []), ...values]);
    }
    return { prices, zeroPriceModifierItems, fetchedAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null, unavailable: !parsed.size, notices };
  } catch {
    console.warn("menu_costing_toast_cache_unavailable");
    return { prices: new Map(), zeroPriceModifierItems: new Set(), fetchedAt: null, unavailable: true, notices: [] };
  }
}
