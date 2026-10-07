import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AssignmentError, saveStationSpanish } from "@/lib/assignments";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/stations");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 7) return jsonError(403, "role_insufficient");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.id !== "string" || typeof b.nameEs !== "string" ||
      Object.keys(b).some((key) => !["locationId", "id", "nameEs"].includes(key))) return jsonError(400, "invalid_payload");
  try {
    return jsonOk(await saveStationSpanish(getServiceRoleClient(), {
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations },
      locationId: b.locationId, id: b.id, nameEs: b.nameEs,
    }));
  } catch (error) {
    if (error instanceof AssignmentError) return jsonError(error.status, error.code);
    return jsonError(500, "internal_error");
  }
}
