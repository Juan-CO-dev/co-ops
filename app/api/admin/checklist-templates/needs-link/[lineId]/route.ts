// POST — link an existing count-line to a master-list item, a SKU, or a piece of
// EQUIPMENT (The Master List, spec §2; the third target added by migration 0181).
// GM+ (>= 7), Tier A step-up. In-place additive; id + label kept.
//
// An "equipment" target before 0181 lands is refused by the lib with a named
// `equipment_link_unavailable` (503), never a 500 on an unknown column.
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { linkTemplateItem, AdminNeedsLinkError, NEEDS_LINK_WRITE_MIN } from "@/lib/admin/needs-link";

export async function POST(req: NextRequest, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/needs-link/${lineId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < NEEDS_LINK_WRITE_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const targetKind =
    b.targetKind === "item"
      ? "item"
      : b.targetKind === "sku"
        ? "sku"
        : b.targetKind === "equipment"
          ? "equipment"
          : null;
  if (!targetKind) return jsonError(400, "invalid_payload", { field: "targetKind" });
  if (typeof b.targetId !== "string" || !b.targetId) return jsonError(400, "invalid_payload", { field: "targetId" });

  try {
    await linkTemplateItem(ctx, { lineId, target: { kind: targetKind, id: b.targetId } });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminNeedsLinkError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
