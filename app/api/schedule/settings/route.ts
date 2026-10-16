import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { ScheduleError, scheduleErrorStatus } from "@/lib/scheduling/errors-shared";
import { SCHEDULE_SETTINGS_ACTIONS, exactShape } from "@/lib/scheduling/route-shapes-shared";
import { saveShopSettings, saveStructure } from "@/lib/scheduling/settings";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Scheduling Phase 2, Task 18 — the schedule structure (GM own shop / MoO+) and the shop switch + wage estimates
 * (MoO+ only). Both take the Tier E edit window (the catalog's 15-minute password window), asserted HERE before the lib;
 * the rules are the lib's, before any I/O, and the 0274 RPCs decide them again. `structure_invalid` names the key.
 * No email, no notification.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/schedule/settings");
  if (ctx instanceof Response) return ctx;
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "bad_request");
  const b = body as Record<string, unknown>;
  if (!exactShape(SCHEDULE_SETTINGS_ACTIONS, b) || typeof b.locationId !== "string") return jsonError(400, "bad_request");
  const stepUp = assertStepUp(ctx, "E");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const actor = peopleActorFromAuth(ctx);
  const deps = { service: getServiceRoleClient() };
  try {
    if (b.action === "structure") {
      if (b.expectedId !== null && typeof b.expectedId !== "string") return jsonError(400, "bad_request");
      return jsonOk({ result: await saveStructure(deps, { actor, locationId: b.locationId, expectedId: b.expectedId as string | null, structure: b.structure }) });
    }
    return jsonOk({ result: await saveShopSettings(deps, { actor, locationId: b.locationId, enabled: b.enabled, estimatedHourlyCents: b.estimatedHourlyCents,
      estimatedSalariedWeeklyCents: b.estimatedSalariedWeeklyCents, agmAccess: b.agmAccess }) });
  } catch (error) {
    if (error instanceof ScheduleError) return jsonError(scheduleErrorStatus(error.code), error.code, { ...(error.key ? { key: error.key } : {}), params: error.params });
    return jsonError(500, "internal_error");
  }
}
