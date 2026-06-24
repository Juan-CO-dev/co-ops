import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { disableSectionQuestion, AdminTemplateError } from "@/lib/admin/templates";

// Disable a section question — deactivates it + every propagated line (on every
// list with that section). Global. MoO+ (≥8), Tier B.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/section-questions/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  try {
    const { deactivatedLineCount } = await disableSectionQuestion(ctx, { questionId: id });
    return jsonOk({ deactivatedLineCount });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
