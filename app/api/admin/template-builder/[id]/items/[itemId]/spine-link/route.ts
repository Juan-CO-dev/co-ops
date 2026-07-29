// POST — SAME-DAY FILL: set the spine link (item_id OR vendor_item_id) on an
// unlinked non-prep template line (Template Builder, spec §1/§4 — the needs-link
// fill moved inside the builder). GM+ (>= 7), Tier A step-up. In-place additive,
// no version. Mirror rows reject with mirror_item_readonly.
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { fillItemSpineLink, TemplateBuilderError } from "@/lib/admin/template-builder";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/template-builder/${id}/items/${itemId}/spine-link`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const kind = b.targetKind === "item" ? "item" : b.targetKind === "sku" ? "sku" : null;
  if (!kind) return jsonError(400, "invalid_payload", { field: "targetKind" });
  if (typeof b.targetId !== "string" || !b.targetId) return jsonError(400, "invalid_payload", { field: "targetId" });

  try {
    await fillItemSpineLink(ctx, { templateId: id, itemId, target: { kind, id: b.targetId } });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof TemplateBuilderError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
