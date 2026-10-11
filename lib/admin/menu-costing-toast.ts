/** Cache-only read: deliberately never imports Toast's API/fetch wrapper. */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { inStorePricesByGuid } from "@/lib/toast/in-store-prices-shared";

export async function loadCachedMenuPrices(): Promise<{
  prices: Map<string, number[]>; fetchedAt: string | null; unavailable: boolean;
}> {
  try {
    const sb = getServiceRoleClient();
    const [maps, caches, locations] = await Promise.all([
      sb.from("toast_menu_map").select("location_id, menu_item_id, toast_item_guid, is_modifier")
        .eq("active", true).not("menu_item_id", "is", null)
        .returns<Array<{ location_id: string; menu_item_id: string; toast_item_guid: string; is_modifier: boolean }>>(),
      sb.from("toast_menu_cache").select("restaurant_guid, payload, fetched_at")
        .returns<Array<{ restaurant_guid: string; payload: unknown; fetched_at: string }>>(),
      sb.from("locations").select("id, toast_restaurant_guid").eq("active", true)
        .returns<Array<{ id: string; toast_restaurant_guid: string | null }>>(),
    ]);
    if (maps.error || caches.error || locations.error) throw new Error("cache_read_failed");
    const prices = new Map<string, number[]>();
    const byLocation = new Map((locations.data ?? []).map((l) => [l.id, l.toast_restaurant_guid]));
    const parsed = new Map<string, { item: Map<string, number[]>; modifier: Map<string, number[]> }>();
    let oldest = Infinity;
    for (const guid of new Set([...byLocation.values()].filter((v): v is string => !!v))) {
      const cache = caches.data?.find((c) => c.restaurant_guid === guid);
      if (!cache || !Number.isFinite(Date.parse(cache.fetched_at))) throw new Error("cache_missing");
      parsed.set(guid, { item: inStorePricesByGuid(cache.payload, "item"), modifier: inStorePricesByGuid(cache.payload, "modifier") });
      oldest = Math.min(oldest, Date.parse(cache.fetched_at));
    }
    if (!parsed.size) throw new Error("cache_missing");
    for (const row of maps.data ?? []) {
      const guid = byLocation.get(row.location_id);
      if (!guid) continue;
      const values = parsed.get(guid)?.[row.is_modifier ? "modifier" : "item"].get(row.toast_item_guid) ?? [];
      prices.set(row.menu_item_id, [...(prices.get(row.menu_item_id) ?? []), ...values]);
    }
    return { prices, fetchedAt: new Date(oldest).toISOString(), unavailable: false };
  } catch {
    console.warn("menu_costing_toast_cache_unavailable");
    return { prices: new Map(), fetchedAt: null, unavailable: true };
  }
}
