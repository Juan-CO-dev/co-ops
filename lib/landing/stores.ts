import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadLandingConfig, type LandingConfig } from "./config";

/** Foundation §4.1 and lib/types.ts: coordinates are deferred, not columns.
 * Project public facts explicitly; never expose integration IDs or staff data. */
export const PUBLIC_LOCATION_COLUMNS = "code,name,address,phone";
export interface PublicLocation { code: string; name: string; address: string | null; phone: string | null }
export function projectLandingStores(rows: readonly PublicLocation[], config: LandingConfig = loadLandingConfig()) {
  return config.stores.flatMap((store) => {
    const row = rows.find((location) => location.code === store.locationCode);
    return row ? [{key:store.key, name:row.name, orderLabel:store.orderLabel, address:row.address, phone:row.phone, hours:store.hours, coordinates:store.coordinates, orderUrl:store.orderUrl}] : [];
  });
}
export type LandingStore = ReturnType<typeof projectLandingStores>[number];
/** Shop data is optional: a provider outage must not take down the landing page. */
export async function loadPublicLandingStores(config: LandingConfig = loadLandingConfig()) {
  try {
    const {data,error} = await getServiceRoleClient().from("locations").select(PUBLIC_LOCATION_COLUMNS).eq("active",true).in("code",config.stores.map((s)=>s.locationCode));
    if (error) throw new Error("Public shop information unavailable");
    return projectLandingStores((data ?? []) as PublicLocation[],config);
  } catch {
    // Fixed class/message only: provider errors can contain URLs, credentials or PII.
    console.error("LandingStoreLoadError: Public shop information unavailable");
    return [];
  }
}
