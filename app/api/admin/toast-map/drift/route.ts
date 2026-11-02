// POST advisory drift check for one location (GM+ >= 7; no step-up).
// Its audited confirmed→stale classifier write requires an explicit action.
import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { driftReport, AdminToastMapError, TOAST_MAP_MIN } from "@/lib/admin/toast-map";
import { ToastApiError } from "@/lib/toast/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/toast-map/drift");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_MAP_MIN) return jsonError(403, "forbidden");

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const locationId = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).locationId : undefined;
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  try {
    const report = await driftReport(ctx, locationId);
    return jsonOk({ report });
  } catch (e) {
    if (e instanceof AdminToastMapError) return jsonError(e.status, e.code, { message: e.message });
    if (e instanceof ToastApiError) return jsonError(502, e.code, { message: e.message });
    throw e;
  }
}
