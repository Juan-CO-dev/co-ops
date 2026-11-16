"use server";

import { isDateBookable, routeDelivery, type DeliveryRouteResult } from "@/lib/catering/fulfillment-routing";

/**
 * Public server action: route a delivery from a customer's pin. No auth (intake is pre-auth).
 *
 * NOT RATE-LIMITED, AND THE OBSTACLE IS THE RETURN CONTRACT — NOT THE PLUMBING
 * (P2-7 batch, deliberately deferred rather than bodged).
 *
 * This is a public unauthenticated entry point onto `routeDelivery`, which does
 * service-role reads per call, so it wants the same per-IP throttle the auth
 * routes now carry. The mechanics are all present: `headers()` from next/headers
 * is readable inside a Server Action, and `trustedClientIp` already accepts that
 * store by design (see lib/client-ip.ts) — so the key is one line.
 *
 * What stops it is the ANSWER. `DeliveryRouteResult` is a closed three-variant
 * union shared with the client — routed | out_of_zone | no_capacity — and none
 * of them can honestly say "slow down". Returning `out_of_zone` to a throttled
 * caller would tell a real customer standing INSIDE the delivery radius that we
 * do not deliver to them, in the money funnel; `no_capacity` is the same lie
 * wearing a different hat. Throwing is no better: the caller (runRoute in
 * start-client.tsx) wraps this in try/FINALLY with no catch, so a throw is an
 * unhandled rejection, not a message.
 *
 * The right fix is a fourth `throttled` variant — which is a shared-type change
 * plus en+es copy (translate-from-day-one) plus a client state, i.e. a
 * customer-funnel UX decision in Juan's voice, not a web-hardening one. Filed.
 */
/**
 * Public server action: can the chosen PICKUP shop take this date and guest count? (audit W22/B123 — pickup
 * intake had no capacity check at all.) Advisory: the page WARNS and the order is flagged for the catering
 * manager; it never blocks (owner decision W22-2 as modified). Same rule as delivery routing (isDateBookable).
 * Not rate-limited, for the reason routeDeliveryAction's comment gives.
 */
export async function checkPickupDateAction(input: {
  locationId: string;
  eventDate: string | null;
  headcount: number | null;
}): Promise<{ bookable: boolean }> {
  const locationId = typeof input.locationId === "string" ? input.locationId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)) return { bookable: true };
  const headcount = Number(input.headcount);
  return {
    bookable: await isDateBookable({
      locationId,
      eventDate: typeof input.eventDate === "string" && input.eventDate ? input.eventDate : null,
      headcount: Number.isFinite(headcount) && headcount > 0 ? Math.floor(headcount) : null,
    }),
  };
}

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
