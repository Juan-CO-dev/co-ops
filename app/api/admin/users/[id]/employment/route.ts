import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AdminUserError, ADMIN_MIN_LEVEL } from "@/lib/admin/users";
import { recordEmployment } from "@/lib/admin/employment";

/**
 * POST { act, fields, expectedId } — on leave · back from leave · separated · rehired · correction (0279; staff
 * separations, 2026-10-20). Tier B like every user-lifecycle write (it deactivates / reactivates and revokes sessions).
 * The lib binds the target (GM own shop, MoO+ any, strictly below), the head and the rehire authority; 0279's writer
 * checks all of it again under its lock.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/users/${id}/employment`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null) as { act?: unknown; fields?: unknown; expectedId?: unknown } | null;
  if (!b || Object.keys(b).some((k) => !["act", "fields", "expectedId"].includes(k))) return jsonError(400, "invalid_payload");
  try {
    const r = await recordEmployment(ctx, id, { act: b.act, fields: b.fields, expectedId: b.expectedId });
    return jsonOk({ id: r.id, statusAfter: r.statusAfter });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code);
    throw e;
  }
}
