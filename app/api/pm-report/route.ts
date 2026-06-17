import { type NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { requireSession } from "@/lib/session";
import { operationalNow } from "@/lib/midshift";
import {
  PM_REPORT_BASE_LEVEL,
  getOrCreatePmReport,
  saveEmployeeEval,
  setMvp,
  submitPmReport,
  type Attitude,
} from "@/lib/pm-report";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTITUDE_VALUES: Attitude[] = ["great", "good", "needs_work"];
const MAX_TEXT = 2000;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isAttitude(v: unknown): v is Attitude {
  return typeof v === "string" && (ATTITUDE_VALUES as string[]).includes(v);
}

function isNullableString(v: unknown, maxLen: number): v is string | null {
  if (v === null || v === undefined) return true;
  return typeof v === "string" && v.length <= maxLen;
}

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/pm-report");
  if (ctx instanceof Response) return ctx;

  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const b = raw as Record<string, unknown>;

  // --- common validation ---
  if (!isUuid(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.action !== "string") return jsonError(400, "invalid_payload", { field: "action" });

  const locationId = b.locationId;

  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, locationId)) {
    return jsonError(403, "location_access_denied", { location_id: locationId });
  }
  if (ctx.level < PM_REPORT_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", { required_level: PM_REPORT_BASE_LEVEL });
  }

  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level };
  // Compute date server-side — never trust client-supplied date as the report key.
  const date = operationalNow(new Date()).date;
  const service = getServiceRoleClient();

  // --- action dispatch ---
  if (b.action === "save_eval") {
    if (!isUuid(b.employeeId)) return jsonError(400, "invalid_payload", { field: "employeeId" });
    if (typeof b.onTime !== "boolean") return jsonError(400, "invalid_payload", { field: "onTime" });
    if (!isAttitude(b.attitude)) return jsonError(400, "invalid_payload", { field: "attitude" });
    if (!isNullableString(b.areaToImprove, MAX_TEXT)) return jsonError(400, "invalid_payload", { field: "areaToImprove" });
    if (!isNullableString(b.note, MAX_TEXT)) return jsonError(400, "invalid_payload", { field: "note" });

    try {
      const { id: pmReportId } = await getOrCreatePmReport(service, { locationId, date, actor });
      const { id } = await saveEmployeeEval(service, {
        pmReportId,
        locationId,
        employeeId: b.employeeId,
        onTime: b.onTime,
        attitude: b.attitude,
        areaToImprove: typeof b.areaToImprove === "string" ? b.areaToImprove : null,
        note: typeof b.note === "string" ? b.note : null,
        actor,
      });
      return jsonOk({ id });
    } catch (err) {
      console.error("[/api/pm-report] save_eval failed:", err instanceof Error ? err.message : err);
      return jsonError(500, "internal_error", { message: "save eval failed" });
    }
  }

  if (b.action === "set_mvp") {
    if (b.mvpUserId !== null && b.mvpUserId !== undefined && !isUuid(b.mvpUserId)) {
      return jsonError(400, "invalid_payload", { field: "mvpUserId" });
    }
    if (!isNullableString(b.mvpNote, MAX_TEXT)) return jsonError(400, "invalid_payload", { field: "mvpNote" });

    try {
      const { id: pmReportId } = await getOrCreatePmReport(service, { locationId, date, actor });
      await setMvp(service, {
        pmReportId,
        mvpUserId: isUuid(b.mvpUserId) ? b.mvpUserId : null,
        mvpNote: typeof b.mvpNote === "string" ? b.mvpNote : null,
      });
      return jsonOk({});
    } catch (err) {
      console.error("[/api/pm-report] set_mvp failed:", err instanceof Error ? err.message : err);
      return jsonError(500, "internal_error", { message: "set mvp failed" });
    }
  }

  if (b.action === "submit") {
    try {
      const { id: pmReportId } = await getOrCreatePmReport(service, { locationId, date, actor });
      const { notified } = await submitPmReport(service, { pmReportId, locationId, actor });
      return jsonOk({ notified });
    } catch (err) {
      console.error("[/api/pm-report] submit failed:", err instanceof Error ? err.message : err);
      return jsonError(500, "internal_error", { message: "submit failed" });
    }
  }

  return jsonError(400, "invalid_payload", { field: "action" });
}
