/**
 * POST /api/prep/mid-day — trigger a NEW mid-day prep instance (C.43 / C.21).
 *
 * Body: { locationId: string (uuid), date: string (YYYY-MM-DD) }
 * Response (success): { instanceId: string }
 * Response (error): lib/api-helpers.ts jsonError shape.
 *
 * Mid-day prep is multi-instance per day — each POST creates a NEW numbered
 * instance (disambiguated by triggered_at via createMidDayPrepInstance, which
 * sets allows_multiple_per_day=true to bypass the single-per-day partial unique
 * index from migration 0059). Unlike AM prep, this does NOT get-or-create by date.
 *
 * Authorization: any clocked-in shift staff at level >= AM_PREP_BASE_LEVEL — the
 * canonical "shift staff can prep" threshold, which is C.21's "level 3+". Location
 * access enforced via lockLocationContext (defense-in-depth; RLS also gates).
 */

import { type NextRequest } from "next/server";

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import {
  AM_PREP_BASE_LEVEL,
  createMidDayPrepInstance,
  resolveMidDayPrepTemplate,
} from "@/lib/prep";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface TriggerBody {
  locationId: string;
  date: string;
}

function validateBody(
  raw: unknown,
): { ok: true; body: TriggerBody } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;
  if (typeof r.locationId !== "string" || !UUID_RE.test(r.locationId)) {
    return { ok: false, field: "locationId" };
  }
  if (typeof r.date !== "string" || !DATE_RE.test(r.date)) {
    return { ok: false, field: "date" };
  }
  return { ok: true, body: { locationId: r.locationId, date: r.date } };
}

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/prep/mid-day");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include locationId (uuid) and date (YYYY-MM-DD).",
      field: validation.field,
    });
  }
  const body = validation.body;

  // 3. Location access (defense-in-depth; RLS also gates).
  if (
    !lockLocationContext(
      { role: ctx.role, locations: ctx.locations },
      body.locationId,
    )
  ) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: body.locationId,
    });
  }

  // 4. Shift-staff gate (C.21 — mid-day prep init open to level >= AM_PREP_BASE_LEVEL).
  if (ctx.level < AM_PREP_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", {
      message: "Mid-day prep can be started by shift staff only.",
      required_level: AM_PREP_BASE_LEVEL,
    });
  }

  const service = getServiceRoleClient();

  // 5. Resolve the location's active mid-day prep template.
  let template: { id: string; name: string } | null;
  try {
    template = await resolveMidDayPrepTemplate(service, body.locationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/mid-day] template resolve failed:`, msg);
    return jsonError(500, "internal_error", { message: "template resolve failed" });
  }
  if (!template) {
    return jsonError(404, "midday_template_not_found", {
      message: "No active mid-day prep template for this location.",
      location_id: body.locationId,
    });
  }

  // 6. Create the new instance.
  try {
    const instanceId = await createMidDayPrepInstance(service, {
      templateId: template.id,
      locationId: body.locationId,
      date: body.date,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
    });
    return jsonOk({ instanceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/mid-day] create failed:`, msg);
    return jsonError(500, "internal_error", { message: "instance create failed" });
  }
}
