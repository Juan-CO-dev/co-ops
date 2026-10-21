import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES, isRoleCode } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { changeRole, AdminUserError, ADMIN_MIN_LEVEL } from "@/lib/admin/users";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/users/${id}/role`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  const role = (parsed as { role?: unknown }).role;
  if (typeof role !== "string" || !isRoleCode(role)) return jsonError(400, "invalid_payload", { field: "role" });
  try { await changeRole(ctx, id, role); return jsonOk({ ok: true }); }
  catch (e) { if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message }); throw e; }
}
