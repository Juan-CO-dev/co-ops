import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setPrepItemMinRole, AdminTemplateError } from "@/lib/admin/templates";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/min-role`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const minRoleLevel = (parsed as { minRoleLevel?: unknown }).minRoleLevel;
  if (typeof minRoleLevel !== "number") return jsonError(400, "invalid_payload", { field: "minRoleLevel" });
  try {
    await setPrepItemMinRole(ctx, { templateId: id, itemId, minRoleLevel });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
