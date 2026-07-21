import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadFulfillmentNodes,
  upsertFulfillmentNode,
  FulfillmentError,
  FULFILLMENT_MIN,
  type UpsertFulfillmentNodeInput,
} from "@/lib/admin/catering/fulfillment";

// GET — list nodes (configured + unconfigured stores). No step-up (read).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/fulfillment");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < FULFILLMENT_MIN) return jsonError(403, "forbidden");
  try {
    const nodes = await loadFulfillmentNodes(ctx);
    return jsonOk({ nodes });
  } catch (e) {
    if (e instanceof FulfillmentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// PATCH — upsert a node (>=7, Tier A). Body: { locationId, lat, lng, radiusMiles, offersDelivery, offersPickup }.
export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/fulfillment");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < FULFILLMENT_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.lat !== "number" || typeof b.lng !== "number" || typeof b.radiusMiles !== "number") {
    return jsonError(400, "invalid_payload", { message: "locationId, lat, lng, radiusMiles required" });
  }
  if (typeof b.offersDelivery !== "boolean" || typeof b.offersPickup !== "boolean") {
    return jsonError(400, "invalid_payload", { message: "offersDelivery, offersPickup required" });
  }
  const input: UpsertFulfillmentNodeInput = {
    locationId: b.locationId,
    lat: b.lat,
    lng: b.lng,
    radiusMiles: b.radiusMiles,
    offersDelivery: b.offersDelivery,
    offersPickup: b.offersPickup,
  };
  try {
    const { id } = await upsertFulfillmentNode(ctx, input);
    return jsonOk({ id });
  } catch (e) {
    if (e instanceof FulfillmentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
