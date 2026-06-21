import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { resetPin, AdminUserError } from "@/lib/admin/users";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/users/${id}/reset-pin`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  const pin = (parsed as { pin?: unknown }).pin;
  if (typeof pin !== "string") return jsonError(400, "invalid_payload", { field: "pin" });
  try { await resetPin(ctx, id, pin); return jsonOk({ ok: true }); }
  catch (e) { if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message }); throw e; }
}
