import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updatePrepItemContent, removePrepItem, AdminTemplateError, type PrepItemContentPatch } from "@/lib/admin/templates";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  // LINE CONTENT ONLY. Name (label/labelEs) + par (parValue/parUnit) are the
  // GLOBAL DEFINITION and move to .../[itemId]/definition (MoO+, Tier B).
  const b = parsed as Record<string, unknown>;
  const patch: PrepItemContentPatch = {};
  if (b.description === null || typeof b.description === "string") patch.description = b.description as string | null;
  if (b.descriptionEs === null || typeof b.descriptionEs === "string") patch.descriptionEs = b.descriptionEs as string | null;
  if (typeof b.displayOrder === "number") patch.displayOrder = b.displayOrder;
  if (typeof b.required === "boolean") patch.required = b.required;
  if (b.specialInstruction === null || typeof b.specialInstruction === "string") patch.specialInstruction = b.specialInstruction as string | null;
  if (b.specialInstructionEs === null || typeof b.specialInstructionEs === "string") patch.specialInstructionEs = b.specialInstructionEs as string | null;

  if (Object.keys(patch).length === 0) return jsonError(400, "invalid_payload", { message: "no editable fields" });
  try {
    await updatePrepItemContent(ctx, { templateId: id, itemId, patch });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  try {
    const result = await removePrepItem(ctx, { templateId: id, itemId });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
