import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordYieldRetrain, YieldStatsError, YIELD_ACTION_MIN } from "@/lib/yield-stats";

/**
 * POST /api/operations/production/yield/retrain — "Retrain" on a yield-drift nudge (recipe scope)
 * or on a maker's retrain item (maker scope). GM 7+ for BOTH scopes (Juan 2026-10-07: "Retrain
 * should be a GM option"); shift leads are view-only. Optional `assignedTo`: a KH+ at the shop whose
 * level is <= the GM's (re-checked in the lib); default the GM. Records a note and snoozes that scope for its
 * next 10 batches; changes no recipe, so no step-up. The lib binds the shop before any I/O and
 * refuses 409 no_active_nudge unless the server sees a live nudge in that scope right now.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/operations/production/yield/retrain");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < YIELD_ACTION_MIN) return jsonError(403, "forbidden");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.itemId !== "string" || (b.scope !== "recipe" && b.scope !== "maker")) {
    return jsonError(400, "invalid_payload");
  }
  try {
    const res = await recordYieldRetrain(ctx, {
      locationId: b.locationId,
      itemId: b.itemId,
      scope: b.scope,
      makerId: typeof b.makerId === "string" ? b.makerId : null,
      note: b.note,
      assignedTo: typeof b.assignedTo === "string" && b.assignedTo ? b.assignedTo : null,
    });
    return jsonOk(res, 201);
  } catch (e) {
    if (e instanceof YieldStatsError) return jsonError(e.status, e.code);
    throw e;
  }
}
