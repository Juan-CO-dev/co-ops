import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadLandingConfig, type LandingConfig } from "./config";

/** Verified coordinates and structured facts belong to tenant config, not DB columns.
 * Project public fields explicitly; never expose integration IDs or staff data. */
export const PUBLIC_LOCATION_COLUMNS = "code,name,address,phone,active";
export interface PublicLocation { code: string; name: string; address: string | null; phone: string | null; active?: boolean }
export function projectLandingStores(rows: readonly PublicLocation[], config: LandingConfig = loadLandingConfig()) {
  return config.stores.flatMap((store) => {
    if (!store.active) return [];
    const row = rows.find((location) => location.code === store.locationCode && location.active !== false);
    return row ? [{key:store.key, name:store.name, orderLabel:store.orderLabel, address:store.address, street:store.street, phone:store.phone, phoneDisplay:store.phoneDisplay, uberEatsUrl:store.key === 'dupont' ? config.footerLinks.find(link=>link.key === 'uber-eats')?.url : undefined, structuredAddress:store.structuredAddress, openingHours:store.openingHours, directionsUrl:`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(store.address)}`, hours:store.hours, coordinates:store.coordinates, orderUrl:store.orderUrl}] : [];
  });
}
export type LandingStore = ReturnType<typeof projectLandingStores>[number];
/** Shop data is optional: a provider outage must not take down the landing page. */
export async function loadPublicLandingStores(config: LandingConfig = loadLandingConfig()) {
  try {
    const {data,error} = await getServiceRoleClient().from("locations").select(PUBLIC_LOCATION_COLUMNS).eq("active",true).in("code",config.stores.filter(s=>s.active).map((s)=>s.locationCode));
    if (error) throw new Error("Public shop information unavailable");
    return projectLandingStores((data ?? []) as PublicLocation[],config);
  } catch {
    // Fixed class/message only: provider errors can contain URLs, credentials or PII.
    console.error("LandingStoreLoadError: Public shop information unavailable");
    // Config is the public-facts authority; live DB membership can only narrow it.
    return projectLandingStores(config.stores.filter(store=>store.active).map(store => ({code:store.locationCode,name:store.name,address:store.address,phone:store.phone,active:true})), config);
  }
}
