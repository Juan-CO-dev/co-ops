import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { LINK_ADMIN_MIN_LEVEL, LinkError, linkToastEmployee, unlinkToastEmployee, whosHereEnabled } from "@/lib/toast/employee-links";

/** 0233: link / unlink a Toast employee. GM+ own shop, level 8+ all shops (bound in the lib); step-up B. */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/toast-employees");
  if (ctx instanceof Response) return ctx;
  if (!whosHereEnabled()) return jsonError(404, "not_enabled");
  if (ctx.level < LINK_ADMIN_MIN_LEVEL) return jsonError(403, "role_insufficient");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations };
  const service = getServiceRoleClient();
  try {
    if (b.operation === "link") {
      if (typeof b.locationId !== "string" || typeof b.employeeGuid !== "string" || typeof b.userId !== "string"
        || Object.keys(b).some((k) => !["operation", "locationId", "employeeGuid", "userId"].includes(k))) return jsonError(400, "invalid_payload");
      return jsonOk(await linkToastEmployee(service, { actor, locationId: b.locationId, employeeGuid: b.employeeGuid, userId: b.userId }));
    }
    if (b.operation === "unlink") {
      if (typeof b.locationId !== "string" || typeof b.linkId !== "string"
        || Object.keys(b).some((k) => !["operation", "locationId", "linkId"].includes(k))) return jsonError(400, "invalid_payload");
      return jsonOk(await unlinkToastEmployee(service, { actor, locationId: b.locationId, linkId: b.linkId }));
    }
    return jsonError(400, "invalid_payload");
  } catch (error) {
    if (error instanceof LinkError) return jsonError(error.status, error.code);
    return jsonError(500, "internal_error");
  }
}
