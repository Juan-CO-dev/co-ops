import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canManageBusinessVisibility, parseGmVisibilitySave } from "@/lib/business-access-shared";
import { businessReportEnabled } from "@/lib/business-report-shared";
import { BusinessVisibilityError, saveBusinessVisibility } from "@/lib/business-visibility";

export const runtime = "nodejs";

/**
 * Business report access (Juan 2026-11-19): set WHAT GMs CAN SEE in the business report (0349
 * save_business_report_gm_visibility). Order: same-origin, the session, the trusted role (owner / CGS / MoO), the
 * switch (dark behind BUSINESS_REPORT with the two fact switches: 503 before the password is asked for), Tier B
 * (always prompted: this changes who sees the labor money, in both directions), the exact body, then the RPC, which
 * re-checks the role on the locked users row and the head the person saw, and writes its own destructive
 * business_report_visibility.save audit row in the same transaction. Under /api/admin, so this route's own
 * requireSession KEEPS the Tier B unlock the preceding POST /api/auth/step-up set
 * (tests/business-visibility-route.test.ts). No email.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/reports/business-visibility");
  if (ctx instanceof Response) return ctx;
  if (!canManageBusinessVisibility(ctx.role)) return jsonError(403, "forbidden");
  if (!businessReportEnabled(process.env)) return jsonError(503, "unavailable");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseGmVisibilitySave(body);
  if (!input) return jsonError(400, "invalid");
  try {
    return jsonOk(await saveBusinessVisibility(getServiceRoleClient(), { userId: ctx.user.id, role: ctx.role }, input));
  } catch (error) {
    if (error instanceof BusinessVisibilityError) return jsonError(error.status, error.code);
    return jsonError(500, "generic");
  }
}
