import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { disableItemQuestion, AdminTemplateError } from "@/lib/admin/templates";

// Disable an item question — deactivates it + every propagated line (on every
// list where the item appears). MoO+ (≥8), Tier B.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/item-questions/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  try {
    const { deactivatedLineCount } = await disableItemQuestion(ctx, { questionId: id });
    return jsonOk({ deactivatedLineCount });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
