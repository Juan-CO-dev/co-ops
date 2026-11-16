/**
 * /order/start — which delivery routing result is still TRUE (audit W22/B203). Pure, client-safe.
 *
 * The delivery shop depends on the pin AND the date AND the guest count (capacity is per shop per
 * day). A result computed for one set of inputs says nothing about another, so the page keeps the
 * inputs a result was computed for and treats any other result as missing.
 */
import type { DeliveryRouteResult } from "@/lib/catering/fulfillment-shared";

export interface RouteInputs {
  date: string;
  guests: string;
  geo: { lat: number; lng: number } | null;
}

export interface KeyedRoute {
  result: DeliveryRouteResult;
  key: string;
}

/** The identity of one routing request. */
export function routeKey(inputs: RouteInputs): string {
  const guests = Number(inputs.guests) || 0;
  const geo = inputs.geo ? `${inputs.geo.lat},${inputs.geo.lng}` : "-";
  return `${inputs.date}|${guests}|${geo}`;
}

/** The result, when it was computed for exactly these inputs; else null (stale = missing). */
export function currentRoute(route: KeyedRoute | null, inputs: RouteInputs): DeliveryRouteResult | null {
  if (!route) return null;
  return route.key === routeKey(inputs) ? route.result : null;
}
