import { type NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { PM_REPORT_BASE_LEVEL, PmReportError } from "@/lib/pm-report";
import {
  addPosition, markDone, openMyCopy, reopenCopy, saveGrade, saveNote, setMvpV2, setWindow, submitDay,
} from "@/lib/pm-report-v2";
import { windowFromWallTimes } from "@/lib/pm-report-v2-shared";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * PM reports v2 — the copy writes (Scheduling Phase 1, Task 21). Outer gates as v1's /api/pm-report: a
 * session, the location bind, KH+, the pm_report task; the lib decides every rule again (role, lifecycle,
 * grade targets) before any write, and the 0271 RPCs decide them a third time. The business day is computed
 * server-side, never taken from the body. No step-up (J8). NOTHING here sends an email or a notification.
 */
const FIELDS: Record<string, readonly string[]> = {
  open: ["action", "locationId"],
  grade: ["action", "locationId", "copyId", "subjectId", "positionId", "criterionId", "grade"],
  note: ["action", "locationId", "copyId", "subjectId", "positionId", "note"],
  add_position: ["action", "locationId", "copyId", "subjectId", "positionId", "reason"],
  window: ["action", "locationId", "copyId", "from", "to"],
  done: ["action", "locationId", "copyId"],
  reopen: ["action", "locationId", "copyId"],
  set_mvp: ["action", "locationId", "mvpUserId"],
  submit: ["action", "locationId"],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

async function onLocationRoster(service: ReturnType<typeof getServiceRoleClient>, locationId: string, userId: string): Promise<boolean> {
  const { data: membership } = await service.from("user_locations").select("user_id").eq("location_id", locationId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (!membership) return false;
  const { data: user } = await service.from("users").select("id").eq("id", userId).eq("active", true).maybeSingle();
  return !!user;
}

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/pm-report/v2");
  if (ctx instanceof Response) return ctx;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  const allowed = typeof b.action === "string" ? FIELDS[b.action] : undefined;
  if (!allowed || Object.keys(b).some((k) => !allowed.includes(k))) return jsonError(400, "invalid_payload");
  if (typeof b.locationId !== "string" || !UUID.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  const locationId = b.locationId;
  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, locationId)) return jsonError(403, "location_access_denied");
  if (ctx.level < PM_REPORT_BASE_LEVEL) return jsonError(403, "role_insufficient");
  if (!(await canDoOperationalTask(ctx, locationId, "pm_report"))) return jsonError(403, "forbidden");

  const actor = peopleActorFromAuth(ctx);
  const date = operationalNow(new Date()).date;
  const service = getServiceRoleClient();
  const copy = { actor, locationId, copyId: b.copyId };
  const nullable = (v: unknown) => (v === undefined ? null : v);
  try {
    switch (b.action) {
      case "open": return jsonOk(await openMyCopy(service, { actor, locationId, date }));
      case "grade": return jsonOk(await saveGrade(service, { ...copy, subjectId: b.subjectId, positionId: nullable(b.positionId), criterionId: b.criterionId, grade: nullable(b.grade) }));
      case "note": return jsonOk(await saveNote(service, { ...copy, subjectId: b.subjectId, positionId: nullable(b.positionId), note: nullable(b.note) }));
      case "add_position": return jsonOk(await addPosition(service, { ...copy, subjectId: b.subjectId, positionId: b.positionId, reason: b.reason }));
      case "window": {
        if (typeof b.from !== "string" || !HHMM.test(b.from) || (b.to !== null && b.to !== undefined && (typeof b.to !== "string" || !HHMM.test(b.to)))) return jsonError(400, "invalid_window");
        const w = windowFromWallTimes(date, b.from, typeof b.to === "string" ? b.to : null);
        if (!w) return jsonError(400, "invalid_window");
        await setWindow(service, { ...copy, from: w.from, to: w.to });
        return jsonOk(w);
      }
      case "done": await markDone(service, copy); return jsonOk({});
      case "reopen": await reopenCopy(service, copy); return jsonOk({});
      case "set_mvp": {
        const mvp = nullable(b.mvpUserId);
        if (mvp !== null && (typeof mvp !== "string" || !UUID.test(mvp))) return jsonError(400, "invalid_payload", { field: "mvpUserId" });
        if (typeof mvp === "string" && !(await onLocationRoster(service, locationId, mvp))) return jsonError(400, "invalid_target", { field: "mvpUserId" });
        await setMvpV2(service, { actor, locationId, date, mvpUserId: mvp as string | null, mvpNote: null });
        return jsonOk({});
      }
      case "submit": return jsonOk(await submitDay(service, { actor, locationId, date }));
    }
    return jsonError(400, "invalid_payload");
  } catch (err) {
    if (err instanceof PmReportError) return jsonError(err.status, err.code);
    console.error("[/api/pm-report/v2] failed:", err instanceof Error ? err.message : "unknown");
    return jsonError(500, "internal_error");
  }
}
