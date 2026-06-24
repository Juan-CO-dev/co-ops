import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { changePrepItemSection, AdminTemplateError } from "@/lib/admin/templates";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/section`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const section = (parsed as { section?: unknown }).section;
  // Shape guard only; changePrepItemSection validates the slug against the
  // active prep_sections set and throws invalid_section (slug list is runtime).
  if (typeof section !== "string") return jsonError(400, "invalid_section", { field: "section" });
  try {
    const result = await changePrepItemSection(ctx, { templateId: id, itemId, section });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
