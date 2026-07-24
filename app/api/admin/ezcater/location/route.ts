// POST set/clear a location's ezCater caterer UUID (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setLocationEzcaterUuid, AdminEzcaterError, EZCATER_ADMIN_MIN } from "@/lib/admin/ezcater-map";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/ezcater/location");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < EZCATER_ADMIN_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  const uuid = b.ezcaterCatererUuid;
  if (uuid !== null && typeof uuid !== "string") return jsonError(400, "invalid_payload", { field: "ezcaterCatererUuid" });
  try {
    await setLocationEzcaterUuid(ctx, b.locationId, uuid as string | null);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminEzcaterError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
