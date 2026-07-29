// PATCH — SAME-DAY FILL: Spanish translation fields on a non-prep template item
// (Template Builder, spec §1/§2). GM+ (>= 7), Tier A step-up. In-place, no
// version (data-completeness only). Mirror rows reject with mirror_item_readonly.
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  fillItemTranslations,
  TemplateBuilderError,
  type ItemTranslationFill,
} from "@/lib/admin/template-builder";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/template-builder/${id}/items/${itemId}/translations`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const fill: ItemTranslationFill = {};
  if (b.labelEs === null || typeof b.labelEs === "string") fill.labelEs = b.labelEs as string | null;
  if (b.descriptionEs === null || typeof b.descriptionEs === "string") fill.descriptionEs = b.descriptionEs as string | null;
  if (b.specialInstructionEs === null || typeof b.specialInstructionEs === "string") {
    fill.specialInstructionEs = b.specialInstructionEs as string | null;
  }
  if (Object.keys(fill).length === 0) return jsonError(400, "invalid_payload", { message: "no translation fields" });

  try {
    await fillItemTranslations(ctx, { templateId: id, itemId, fill });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof TemplateBuilderError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
