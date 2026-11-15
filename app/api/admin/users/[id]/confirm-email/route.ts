import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { AdminUserError, ADMIN_MIN_LEVEL } from "@/lib/admin/users";
import { requestEmailConfirmation } from "@/lib/admin/email-confirm";

// POST — send a manager the "confirm your email" link (audit W07 / B053). Tier B like every other user-admin act.
// Answers 200 { outcome } — "sent" is the ONLY outcome in which an email left; "suppressed" names the closed switch.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/users/${id}/confirm-email`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  try {
    const result = await requestEmailConfirmation(ctx, id);
    return jsonOk({ ok: true, outcome: result.outcome, reason: result.reason ?? null });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
