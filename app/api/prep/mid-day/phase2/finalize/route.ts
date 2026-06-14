/**
 * POST /api/prep/mid-day/phase2/finalize — close out a mid-day prep instance
 * (C.43): transition phase1_complete → phase2_complete. Shift staff; location-gated.
 *
 * Body: { instanceId: uuid }
 * Response (success): { instance: ChecklistInstance }
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { AM_PREP_BASE_LEVEL, finalizeMidDayPhase2 } from "@/lib/prep";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/prep/mid-day/phase2/finalize");
  if (ctx instanceof Response) return ctx;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const r = parsed as Record<string, unknown>;
  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return jsonError(400, "invalid_payload", { message: "Body must include instanceId (uuid).", field: "instanceId" });
  }
  const instanceId = r.instanceId;

  const service = getServiceRoleClient();
  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id")
    .eq("id", instanceId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (instErr) {
    console.error(`[/api/prep/mid-day/phase2/finalize] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", { message: "Instance not found", instance_id: instanceId });
  }
  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, instance.location_id)) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: instance.location_id,
    });
  }
  if (ctx.level < AM_PREP_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", {
      message: "Mid-day prep is for shift staff.",
      required_level: AM_PREP_BASE_LEVEL,
    });
  }

  try {
    const result = await finalizeMidDayPhase2(service, {
      instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        return jsonError(404, "instance_not_found", { message: "Mid-day instance not found." });
      }
      return jsonError(409, "not_in_phase2", { message: "This instance isn't in the Phase 2 window." });
    }
    return jsonOk({ instance: result.instance });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/mid-day/phase2/finalize] finalize failed:`, msg);
    return jsonError(500, "internal_error", { message: "finalize failed" });
  }
}
