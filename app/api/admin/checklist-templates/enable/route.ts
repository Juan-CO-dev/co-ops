import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { enableRegistryItemAtLocation, AdminTemplateError } from "@/lib/admin/templates";

// Enable an existing GLOBAL registry item onto one location's checklist (link a
// line). AGM+ (≥6), Tier A. IDOR (location must be the actor's) is enforced in
// the lib via lockLocationContext.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/checklist-templates/enable");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !b.locationId) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (b.subtype !== "am_prep" && b.subtype !== "mid_day_prep") return jsonError(400, "invalid_payload", { field: "subtype" });
  if (typeof b.itemId !== "string" || !b.itemId) return jsonError(400, "invalid_payload", { field: "itemId" });
  try {
    const result = await enableRegistryItemAtLocation(ctx, {
      locationId: b.locationId,
      subtype: b.subtype,
      itemId: b.itemId,
    });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
