import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { promotePrepLineItemToGlobal, AdminTemplateError } from "@/lib/admin/templates";

// Promote the line's linked registry item to a GLOBAL definition (location_id →
// NULL → applies company-wide). The route knows only the line id; the lib
// wrapper resolves line → item_id, then promotes. MoO+, Tier B. No body needed.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/promote`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  try {
    await promotePrepLineItemToGlobal(ctx, { templateId: id, lineItemId: itemId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
