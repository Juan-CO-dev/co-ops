// PATCH an item's taxonomy type (The Master List, 0157). GM+ (>= 7), Tier A step-up.
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setItemType, AdminCatalogError, ITEM_TYPE_WRITE_MIN, isItemType } from "@/lib/admin/catalog";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/item-type/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ITEM_TYPE_WRITE_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (!isItemType(b.itemType)) return jsonError(400, "invalid_payload", { field: "itemType" });

  try {
    await setItemType(ctx, { itemId: id, itemType: b.itemType });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCatalogError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
