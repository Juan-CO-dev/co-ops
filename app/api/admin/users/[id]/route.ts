import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getUserDetail, updateUserProfile, AdminUserError } from "@/lib/admin/users";

const ADMIN_MIN_LEVEL = 8;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/users/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const detail = await getUserDetail(id);
  if (!detail) return jsonError(404, "not_found");
  return jsonOk({ user: detail });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/users/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as { name?: unknown; phone?: unknown; email?: unknown };
  try {
    await updateUserProfile(ctx, id, {
      name: typeof b.name === "string" ? b.name : undefined,
      phone: b.phone === null ? null : typeof b.phone === "string" ? b.phone : undefined,
      email: b.email === null ? null : typeof b.email === "string" ? b.email : undefined,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
