import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canManageLaborBurden, parseBurdenSave } from "@/lib/facts/labor-burden-shared";
import { LaborBurdenError, saveLaborBurden } from "@/lib/facts/labor-burden";
import { scheduleLaborViewsEnabled, type ScheduleLaborViewsEnv } from "@/lib/scheduling/labor-projection-shared";

export const runtime = "nodejs";

/**
 * Board two labor views PR 2: set the BURDEN % (employer payroll taxes + benefits): the company default, a shop's
 * own rate, or "follow the company from <date>" (0346 save_labor_burden). Plan r4 order: same-origin, the session,
 * the trusted role (owner / CGS / MoO), the switch (dark behind SCHEDULE_LABOR_VIEWS with the two fact switches:
 * 503 before the password is asked for), Tier B (always prompted: a backdated row re-prices every week from its
 * date), then the RPC, which re-checks the role on the locked users row and writes its own destructive
 * labor_burden.save audit row in the same transaction. Under /api/admin, so this route's own requireSession KEEPS
 * the Tier B unlock the preceding POST /api/auth/step-up set (tests/labor-burden-route.test.ts). No email.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/labor/burden");
  if (ctx instanceof Response) return ctx;
  if (!canManageLaborBurden(ctx.role)) return jsonError(403, "forbidden");
  if (!scheduleLaborViewsEnabled(process.env as ScheduleLaborViewsEnv)) return jsonError(503, "unavailable");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseBurdenSave(body);
  if (!input) return jsonError(400, "invalid");
  try {
    return jsonOk(await saveLaborBurden(getServiceRoleClient(), { userId: ctx.user.id, role: ctx.role }, input));
  } catch (error) {
    if (error instanceof LaborBurdenError) return jsonError(error.status, error.code);
    return jsonError(500, "generic");
  }
}
