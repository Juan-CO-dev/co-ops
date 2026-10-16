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
    return row ? [{key:store.key, name:row.name, address:row.address, phone:row.phone, hours:store.hours, coordinates:store.coordinates, orderUrl:store.orderUrl}] : [];
  });
}
/** Used by D2's full shop cards. Chunk A skeleton does not query live data. */
export async function loadPublicLandingStores(config: LandingConfig = loadLandingConfig()) {
  const {data,error} = await getServiceRoleClient().from("locations").select(PUBLIC_LOCATION_COLUMNS).eq("active",true).in("code",config.stores.map((s)=>s.locationCode));
  if (error) throw new Error("Public shop information unavailable");
  return projectLandingStores((data ?? []) as PublicLocation[],config);
}
