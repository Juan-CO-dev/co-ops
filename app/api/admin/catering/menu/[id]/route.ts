// PATCH catering flags on an item (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setCateringFlags, AdminCateringMenuError, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/menu/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MENU_ADMIN_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const kind = b.kind === "menu_item" ? "menu_item" : b.kind === "item" ? "item" : null;
  if (!kind) return jsonError(400, "invalid_payload", { field: "kind" });
  const changes: { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean } = {};
  if ("cateringAvailable" in b) {
    if (typeof b.cateringAvailable !== "boolean") return jsonError(400, "invalid_payload", { field: "cateringAvailable" });
    changes.cateringAvailable = b.cateringAvailable;
  }
  if ("cateringOnly" in b) {
    if (typeof b.cateringOnly !== "boolean") return jsonError(400, "invalid_payload", { field: "cateringOnly" });
    changes.cateringOnly = b.cateringOnly;
  }
  if ("cateringPortionable" in b) {
    if (typeof b.cateringPortionable !== "boolean") return jsonError(400, "invalid_payload", { field: "cateringPortionable" });
    changes.cateringPortionable = b.cateringPortionable;
  }
  if (Object.keys(changes).length === 0) return jsonError(400, "invalid_payload", { message: "No flags to set" });

  try {
    const result = await setCateringFlags(ctx, kind, id, changes);
    return jsonOk({ cateringAvailable: result.cateringAvailable, cateringOnly: result.cateringOnly, cateringPortionable: result.cateringPortionable });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
