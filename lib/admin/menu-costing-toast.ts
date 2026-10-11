/** Cache-only read: deliberately never imports Toast's API/fetch wrapper. */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { inStorePricesByGuid, hasInStoreMenu } from "@/lib/toast/in-store-prices-shared";

export async function loadCachedMenuPrices(): Promise<{
  prices: Map<string, number[]>; fetchedAt: string | null; unavailable: boolean;
  notices: Array<{ locationName: string; reason: "unavailable" | "menu_missing" }>;
}> {
  try {
    const sb = getServiceRoleClient();
    const [maps, caches, locations] = await Promise.all([
      sb.from("toast_menu_map").select("location_id, menu_item_id, toast_item_guid, is_modifier")
        .eq("active", true).eq("match_status", "confirmed").not("menu_item_id", "is", null)
        .returns<Array<{ location_id: string; menu_item_id: string; toast_item_guid: string; is_modifier: boolean }>>(),
      sb.from("toast_menu_cache").select("restaurant_guid, payload, fetched_at")
        .returns<Array<{ restaurant_guid: string; payload: unknown; fetched_at: string }>>(),
      sb.from("locations").select("id, name, toast_restaurant_guid").eq("active", true)
        .returns<Array<{ id: string; name: string; toast_restaurant_guid: string | null }>>(),
    ]);
    if (maps.error || caches.error || locations.error) throw new Error("cache_read_failed");
    const prices = new Map<string, number[]>();
    const byLocation = new Map((locations.data ?? []).map((l) => [l.id, l.toast_restaurant_guid]));
    const parsed = new Map<string, { item: Map<string, number[]>; modifier: Map<string, number[]> }>();
    const notices: Array<{ locationName: string; reason: "unavailable" | "menu_missing" }> = [];
    let oldest = Infinity;
    for (const location of locations.data ?? []) {
      const guid = location.toast_restaurant_guid;
      try {
        const cache = caches.data?.find((c) => c.restaurant_guid === guid);
        if (!guid || !cache || !Number.isFinite(Date.parse(cache.fetched_at))) throw new Error("cache_missing");
        const item = inStorePricesByGuid(cache.payload, "item");
        const modifier = inStorePricesByGuid(cache.payload, "modifier");
        parsed.set(guid, { item, modifier });
        oldest = Math.min(oldest, Date.parse(cache.fetched_at));
        if (!hasInStoreMenu(cache.payload)) notices.push({ locationName: location.name, reason: "menu_missing" });
      } catch {
        console.warn("menu_costing_toast_cache_unavailable");
        notices.push({ locationName: location.name, reason: "unavailable" });
      }
    }
    for (const row of maps.data ?? []) {
      const guid = byLocation.get(row.location_id);
      if (!guid) continue;
      const values = parsed.get(guid)?.[row.is_modifier ? "modifier" : "item"].get(row.toast_item_guid) ?? [];
      prices.set(row.menu_item_id, [...(prices.get(row.menu_item_id) ?? []), ...values]);
    }
    return { prices, fetchedAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null, unavailable: !parsed.size, notices };
  } catch {
    console.warn("menu_costing_toast_cache_unavailable");
    return { prices: new Map(), fetchedAt: null, unavailable: true, notices: [] };
  }
}
