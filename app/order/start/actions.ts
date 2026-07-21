"use server";

import { routeDelivery, type DeliveryRouteResult } from "@/lib/catering/fulfillment-routing";

/** Public server action: route a delivery from a customer's pin. No auth (intake is pre-auth). */
export async function routeDeliveryAction(input: {
  lat: number;
  lng: number;
  eventDate: string | null;
  headcount: number | null;
}): Promise<DeliveryRouteResult> {
  return routeDelivery({
    lat: Number(input.lat),
    lng: Number(input.lng),
    eventDate: input.eventDate ?? null,
    headcount: input.headcount ?? null,
  });
}
