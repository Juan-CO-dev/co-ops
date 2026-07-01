import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordDelivery, ReceivingError, type RecordDeliveryInput } from "@/lib/receiving";

// Log a delivery. KH+ (≥4), location-bound (checked in recordDelivery).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");

  const b = parsed as Partial<RecordDeliveryInput>;
  if (typeof b.vendorId !== "string" || typeof b.locationId !== "string" || typeof b.deliveryDate !== "string") {
    return jsonError(400, "invalid_payload");
  }
  if (!Array.isArray(b.lines)) return jsonError(400, "no_lines");

  try {
    const res = await recordDelivery(ctx, b as RecordDeliveryInput);
    return jsonOk({ deliveryId: res.deliveryId }, 201);
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
