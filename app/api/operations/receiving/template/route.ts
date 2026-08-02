import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { loadLastDeliveryTemplate, ReceivingError, RECEIVE_MIN } from "@/lib/receiving";

// GET ?locationId=<uuid>&vendorId=<uuid> — prefill template from the vendor's last
// delivery at this location. Returns { template: LastDeliveryTemplate | null }.
// KH+ (≥4), location-bound (checked in loadLastDeliveryTemplate).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/receiving/template");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIVE_MIN) return jsonError(403, "forbidden");

  const locationId = req.nextUrl.searchParams.get("locationId");
  const vendorId = req.nextUrl.searchParams.get("vendorId");
  if (typeof locationId !== "string" || !locationId) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof vendorId !== "string" || !vendorId) return jsonError(400, "invalid_payload", { field: "vendorId" });

  try {
    const template = await loadLastDeliveryTemplate(ctx, locationId, vendorId);
    return jsonOk({ template });
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
