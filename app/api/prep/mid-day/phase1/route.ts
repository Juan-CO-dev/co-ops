/**
 * POST /api/prep/mid-day/phase1 — submit the Phase 1 count for a mid-day prep
 * instance (C.43). Single-submit: writes one completion per counted item +
 * transitions open → phase1_complete (via submit_mid_day_phase1_atomic).
 *
 * Body: { instanceId: string (uuid), entries: Array<{ templateItemId: uuid, inputs: PrepInputs }> }
 * Response (success): { instance: ChecklistInstance }
 *
 * Authorization: shift staff (level >= AM_PREP_BASE_LEVEL) + location access.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { AM_PREP_BASE_LEVEL, isPrepInputs, submitMidDayPhase1 } from "@/lib/prep";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { PrepInputs } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Phase1Body {
  instanceId: string;
  entries: Array<{ templateItemId: string; inputs: PrepInputs }>;
}

function validateBody(
  raw: unknown,
): { ok: true; body: Phase1Body } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;
  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return { ok: false, field: "instanceId" };
  }
  if (!Array.isArray(r.entries)) return { ok: false, field: "entries" };
  const entries: Phase1Body["entries"] = [];
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (typeof e !== "object" || e === null) return { ok: false, field: `entries[${i}]` };
    const er = e as Record<string, unknown>;
    if (typeof er.templateItemId !== "string" || !UUID_RE.test(er.templateItemId)) {
      return { ok: false, field: `entries[${i}].templateItemId` };
    }
    if (!isPrepInputs(er.inputs)) return { ok: false, field: `entries[${i}].inputs` };
    entries.push({ templateItemId: er.templateItemId, inputs: er.inputs });
  }
  return { ok: true, body: { instanceId: r.instanceId, entries } };
}

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/prep/mid-day/phase1");
  if (ctx instanceof Response) return ctx;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include instanceId (uuid) and entries (Array<{templateItemId: uuid, inputs: PrepInputs}>).",
      field: validation.field,
    });
  }
  const body = validation.body;

  const service = getServiceRoleClient();

  // Location access (defense-in-depth) — look up the instance's location.
  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id")
    .eq("id", body.instanceId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (instErr) {
    console.error(`[/api/prep/mid-day/phase1] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", { message: "Instance not found", instance_id: body.instanceId });
  }
  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, instance.location_id)) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: instance.location_id,
    });
  }
  if (ctx.level < AM_PREP_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", {
      message: "Mid-day prep counting is for shift staff.",
      required_level: AM_PREP_BASE_LEVEL,
    });
  }

  try {
    const result = await submitMidDayPhase1(service, {
      instanceId: body.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      entries: body.entries,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        return jsonError(404, "instance_not_found", { message: "Mid-day instance not found." });
      }
      if (result.reason === "not_open") {
        return jsonError(409, "instance_not_open", { message: "Phase 1 was already submitted for this instance." });
      }
      return jsonError(400, "bad_item", { message: "An entry references an item not in this template.", detail: result.detail });
    }
    return jsonOk({ instance: result.instance });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/mid-day/phase1] submit failed:`, msg);
    return jsonError(500, "internal_error", { message: "submit failed" });
  }
}
