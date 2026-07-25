// GET the derived sales-consumption projection for one location+date (AGM+ >= 6, read-only).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { salesConsumption, listExclusions, AdminToastSalesError, TOAST_SALES_READ_MIN } from "@/lib/catering/toast-sales";
import { listMappableEntities } from "@/lib/admin/toast-map";
import { ToastApiError } from "@/lib/toast/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/toast-sales/consumption");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_SALES_READ_MIN) return jsonError(403, "forbidden");
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!UUID_RE.test(locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  try {
    const [report, exclusions, entities] = await Promise.all([
      salesConsumption(ctx, locationId, date),
      listExclusions(ctx),
      listMappableEntities(ctx),
    ]);
    return jsonOk({ report, exclusions, entities });
  } catch (e) {
    if (e instanceof AdminToastSalesError) return jsonError(e.status, e.code, { message: e.message });
    if (e instanceof ToastApiError) return jsonError(502, e.code, { message: e.message });
    throw e;
  }
}
