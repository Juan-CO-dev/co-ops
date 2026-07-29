// POST — SAME-DAY FILL #2 (Template Builder spec §1, §4): set item_id OR
// vendor_item_id on a count-bearing line whose spine link is currently null.
// In-place additive; only ONE ref, only when BOTH are null. GM+ (>= 7), Tier A
// step-up. Data-completeness only → does NOT version (fillItemSpineLink enforces).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { fillItemSpineLink, TemplateBuilderError } from "@/lib/admin/template-builder";

/** GM+ writes the fills (mirrors the needs-link WRITE floor + PR-0 route floors). */
const BUILDER_FILL_MIN = 7;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string; itemId: string }> },
) {
  const { templateId, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(
    req,
    `/api/admin/checklist-templates/builder/${templateId}/items/${itemId}/spine-link`,
  );
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < BUILDER_FILL_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const targetKind = b.targetKind === "item" ? "item" : b.targetKind === "sku" ? "sku" : null;
  if (!targetKind) return jsonError(400, "invalid_payload", { field: "targetKind" });
  if (typeof b.targetId !== "string" || !b.targetId) return jsonError(400, "invalid_payload", { field: "targetId" });

  try {
    await fillItemSpineLink(ctx, { templateId, itemId, target: { kind: targetKind, id: b.targetId } });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof TemplateBuilderError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
