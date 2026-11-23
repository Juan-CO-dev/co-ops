/**
 * Catering delivery (D2) — what every delivery route shares. Server-only. Nothing here calls out.
 *
 * EVERY WRITE ROUTE, IN THIS ORDER (pinned per route in tests/delivery-routes.test.ts):
 *   1. `assertSameOrigin(req)` — the first statement, its refusal returned by the second;
 *   2. `requireSession` on the route's OWN path;
 *   3. the switch (`deliveryOffResponse`): `DELIVERY_TRACKING` unset = 503 `delivery_off`, before the body is read;
 *   4. the strict parse (lib/delivery/parse-shared.ts): 400 `invalid_request`;
 *   5. the lib (lib/delivery/jobs.ts / settings.ts), which binds its gate before any I/O;
 * and every refusal the lib raises is passed through BY NAME (`deliveryRefusal`), a 503 with `Retry-After`.
 * Anything that is not a DeliveryError is a 500 `generic`: a failure is never reported as a success.
 */
import "server-only";
import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { deliveryTrackingOn } from "./config";
import { DeliveryError } from "./errors";

function refuse(status: number, code: string): NextResponse {
  const response = jsonError(status, code);
  if (status === 503) response.headers.set("Retry-After", "60");
  return response;
}

/** A thrown error → the named response. */
export function deliveryRefusal(error: unknown): NextResponse {
  return error instanceof DeliveryError ? refuse(error.status, error.code) : refuse(500, "generic");
}

/** The switch for a write: null while delivery tracking is on, else the 503 `delivery_off` to return. */
export function deliveryOffResponse(): NextResponse | null {
  return deliveryTrackingOn() ? null : refuse(503, "delivery_off");
}
