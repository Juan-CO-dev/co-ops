// GET advisory drift report for one location (GM+ >= 7; read — no step-up.
// The one write it can make is the audited confirmed→stale flip, the
// read-time-classifier precedent from W4c-a).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { driftReport, AdminToastMapError, TOAST_MAP_MIN } from "@/lib/admin/toast-map";
import { ToastApiError } from "@/lib/toast/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/toast-map/drift");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_MAP_MIN) return jsonError(403, "forbidden");

  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  if (!UUID_RE.test(locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  try {
    const report = await driftReport(ctx, locationId);
    return jsonOk({ report });
  } catch (e) {
    if (e instanceof AdminToastMapError) return jsonError(e.status, e.code, { message: e.message });
    if (e instanceof ToastApiError) return jsonError(502, e.code, { message: e.message });
    throw e;
  }
}
