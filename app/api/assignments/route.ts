import type { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AssignmentError, assignTask, retractTask, writeStationEvent } from "@/lib/assignments";
import { isTaskType, validOverrideReason, type OverrideReason } from "@/lib/assignments-shared";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/assignments");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload");
  if (!validOverrideReason(b.reasonCode, b.reasonNote)) return jsonError(400, "invalid_payload");
  const reason: OverrideReason = { reasonCode: b.reasonCode as OverrideReason["reasonCode"], reasonNote: b.reasonNote as OverrideReason["reasonNote"] };
  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations };
  const service = getServiceRoleClient();
  try {
    switch (b.action) {
      case "station": {
        if (typeof b.userId !== "string" || (b.stationId !== null && typeof b.stationId !== "string") ||
          (b.positionId !== null && typeof b.positionId !== "string") ||
          (b.stationId === null) !== (b.positionId === null) ||
          (b.manage !== undefined && typeof b.manage !== "boolean")) return jsonError(400, "invalid_payload");
        return jsonOk(await writeStationEvent(service, { actor, locationId: b.locationId, userId: b.userId, stationId: b.stationId, positionId: b.positionId, manage: b.manage as boolean | undefined, ...reason }));
      }
      case "task_assign": {
        if (typeof b.userId !== "string" || !isTaskType(b.task) || (b.note != null && typeof b.note !== "string")) return jsonError(400, "invalid_payload");
        return jsonOk(await assignTask(service, { actor, locationId: b.locationId, userId: b.userId, task: b.task, note: b.note as string | null | undefined, ...reason }));
      }
      case "task_retract": {
        if (typeof b.assignmentId !== "string") return jsonError(400, "invalid_payload");
        return jsonOk(await retractTask(service, { actor, locationId: b.locationId, assignmentId: b.assignmentId, ...reason }));
      }
      default: return jsonError(400, "invalid_payload");
    }
  } catch (error) {
    if (error instanceof AssignmentError) return jsonError(error.status, error.code);
    return jsonError(500, "internal_error");
  }
}
