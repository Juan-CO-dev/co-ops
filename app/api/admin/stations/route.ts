import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AssignmentError, saveStationSpanish, saveStationConfig } from "@/lib/assignments";
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
  if (b.operation === "staffed" || b.operation === "position_create" || b.operation === "position_update") {
    if (typeof b.locationId !== "string" || typeof b.stationId !== "string" ||
      (b.operation === "staffed" && typeof b.staffed !== "boolean") ||
      (b.operation !== "staffed" && (typeof b.name !== "string" || typeof b.sort !== "number" || typeof b.active !== "boolean")) ||
      (b.operation === "position_update" && typeof b.positionId !== "string") ||
      ["nameEs", "duty", "dutyEs"].some((key) => b[key] != null && typeof b[key] !== "string") ||
      Object.keys(b).some((key) => !["operation", "locationId", "stationId", "staffed", "positionId", "name", "nameEs", "duty", "dutyEs", "sort", "active"].includes(key)))
      return jsonError(400, "invalid_payload");
    try {
      return jsonOk(await saveStationConfig(getServiceRoleClient(), {
        actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations },
        locationId: b.locationId, stationId: b.stationId, operation: b.operation,
        staffed: b.staffed as boolean | undefined, positionId: b.positionId as string | undefined,
        name: b.name as string | undefined, nameEs: b.nameEs as string | null | undefined,
        duty: b.duty as string | null | undefined, dutyEs: b.dutyEs as string | null | undefined,
        sort: b.sort as number | undefined, active: b.active as boolean | undefined,
      }));
    } catch (error) {
      if (error instanceof AssignmentError) return jsonError(error.status, error.code);
      return jsonError(500, "internal_error");
    }
  }
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
