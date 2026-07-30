import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setPrepItemInputType, AdminTemplateError } from "@/lib/admin/templates";
import type { LineInputType } from "@/lib/types";

const LINE_INPUT_TYPES: readonly string[] = ["on_hand", "portioned", "line", "yes_no", "free_text"];

// EXPLICIT per-line input-type change (fulledit floor). Structural edit —
// MoO-adjacent stakes but line-scoped: ≥7 + Tier B, matching the section route.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/input-type`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.inputType !== "string" || !LINE_INPUT_TYPES.includes(b.inputType)) {
    return jsonError(400, "invalid_input_type");
  }
  const includeNote = typeof b.includeNote === "boolean" ? b.includeNote : undefined;

  try {
    const result = await setPrepItemInputType(ctx, {
      templateId: id,
      itemId,
      inputType: b.inputType as LineInputType,
      ...(includeNote !== undefined ? { includeNote } : {}),
    });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
