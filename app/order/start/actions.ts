"use server";

import { routeDelivery, type DeliveryRouteResult } from "@/lib/catering/fulfillment-routing";

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
