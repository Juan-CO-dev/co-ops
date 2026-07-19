import { loadPublicLocations } from "@/lib/portal/locations";
import { OrderStartClient } from "./start-client";

// Reads the DB (loadPublicLocations → service-role client) at render time. Force dynamic so this
// runs per-request, NOT at build-prerender — the CI build gate runs with no Supabase env, where
// getServiceRoleClient() throws (Phase 2 lesson: "build is a separate gate").
export const dynamic = "force-dynamic";

export default async function OrderStart() {
  const locations = await loadPublicLocations();
  return <OrderStartClient locations={locations} />;
}
