import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { RecipeError } from "@/lib/recipes";
import { updateRecipeYieldFromNudge, YieldStatsError, YIELD_ACTION_MIN } from "@/lib/yield-stats";

/**
 * POST /api/admin/recipes/yield-nudge — "Update recipe yield" on a recipe-level yield-drift nudge
 * (batch vs bottle Phase B). GM 7 + the recipe-edit Tier-B step-up (the same gate as
 * PATCH /api/admin/recipes/[id]). It lives under /api/admin so the step-up unlock set by the
 * immediately preceding POST /api/auth/step-up survives this route's own requireSession
 * (lib/session.ts isAdminPath). The lib binds the shop and writes through the serialised output
 * writer; it refuses 409 no_active_nudge unless the server sees a live nudge right now.
 */
const PATH = "/api/admin/recipes/yield-nudge";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < YIELD_ACTION_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.itemId !== "string") return jsonError(400, "invalid_payload");
  try {
    const res = await updateRecipeYieldFromNudge(ctx, { locationId: b.locationId, itemId: b.itemId, yield: b.yield });
    return jsonOk(res);
  } catch (e) {
    if (e instanceof YieldStatsError || e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
