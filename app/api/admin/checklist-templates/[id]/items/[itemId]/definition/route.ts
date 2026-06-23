import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updatePrepItemContent, AdminTemplateError, type PrepItemContentPatch } from "@/lib/admin/templates";

// GLOBAL DEFINITION (edit-once-everywhere): the item's name + recommended par.
// Writes the linked registry `items` row via updatePrepItemContent. MoO+, Tier B.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/definition`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const patch: PrepItemContentPatch = {};
  if (typeof b.label === "string") patch.label = b.label;
  if (b.labelEs === null || typeof b.labelEs === "string") patch.labelEs = b.labelEs as string | null;
  if (b.parValue === null || typeof b.parValue === "number") patch.parValue = b.parValue as number | null;
  if (b.parUnit === null || typeof b.parUnit === "string") patch.parUnit = b.parUnit as string | null;

  if (Object.keys(patch).length === 0) return jsonError(400, "invalid_payload", { message: "no editable fields" });
  try {
    await updatePrepItemContent(ctx, { templateId: id, itemId, patch });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
