import { loadPublicLocations } from "@/lib/portal/locations";
import { loadPublicFulfillmentNodes, loadPickupNodes } from "@/lib/catering/fulfillment-routing";
import { TranslationProvider } from "@/lib/i18n/provider";
import { OrderStartClient } from "./start-client";

// Reads the DB (loadPublicLocations → service-role client) at render time. Force dynamic so this
// runs per-request, NOT at build-prerender — the CI build gate runs with no Supabase env, where
// getServiceRoleClient() throws (Phase 2 lesson: "build is a separate gate").
export const dynamic = "force-dynamic";

export default async function OrderStart() {
  const [locations, nodes, pickupNodesFull] = await Promise.all([
    loadPublicLocations(),
    loadPublicFulfillmentNodes(),
    loadPickupNodes(),
  ]);

  const deliveryNodesExist = nodes.some((n) => n.offersDelivery);
  const pickupNodes = pickupNodesFull.map((n) => ({
    locationId: n.locationId,
    locationName: n.locationName,
  }));

  return (
    <TranslationProvider initialLanguage="en">
      <OrderStartClient
        locations={locations}
        deliveryNodesExist={deliveryNodesExist}
        pickupNodes={pickupNodes}
      />
    </TranslationProvider>
  );
}
