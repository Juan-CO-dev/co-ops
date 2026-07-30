import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { unlinkPrepItem, AdminTemplateError } from "@/lib/admin/templates";

// UNLINK a prep line from its registry item (fulledit floor). Structural,
// line-scoped: ≥7 + Tier B (matches section/input-type routes). The registry
// name freezes into the line label first (display continuity).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/unlink`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  try {
    const result = await unlinkPrepItem(ctx, { templateId: id, itemId });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
