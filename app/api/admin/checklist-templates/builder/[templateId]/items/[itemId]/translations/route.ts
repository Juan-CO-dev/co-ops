// POST — SAME-DAY FILL #1 (Template Builder spec §1): fill Spanish translation
// fields (label/description/specialInstruction) where currently EMPTY. Strict
// fill — an existing es value is never overwritten. GM+ (>= 7), Tier A step-up.
// Data-completeness only → does NOT version (fillItemTranslations enforces).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { fillItemTranslations, TemplateBuilderError } from "@/lib/admin/template-builder";
import type { ItemTranslationFill } from "@/lib/admin/template-builder";

/** GM+ writes the fills (mirrors the needs-link WRITE floor + PR-0 route floors). */
const BUILDER_FILL_MIN = 7;

/** Read an optional string|null field from the body (undefined = not provided). */
function optStr(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string; itemId: string }> },
) {
  const { templateId, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(
    req,
    `/api/admin/checklist-templates/builder/${templateId}/items/${itemId}/translations`,
  );
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < BUILDER_FILL_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const fill: ItemTranslationFill = {
    labelEs: optStr(b.labelEs),
    descriptionEs: optStr(b.descriptionEs),
    specialInstructionEs: optStr(b.specialInstructionEs),
  };

  try {
    await fillItemTranslations(ctx, { templateId, itemId, fill });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof TemplateBuilderError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
