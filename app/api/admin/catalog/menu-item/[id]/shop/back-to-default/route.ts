/**
 * POST /api/admin/catalog/menu-item/[id]/shop/back-to-default — this shop goes back to the global menu
 * item (catalog Phase 3a). Body: { locationId: uuid, settingId: uuid }. The row is retired, never deleted.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireMenuItemShopSetting, MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/shop/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.settingId !== "string" || !UUID_RE.test(b.settingId)) return jsonError(400, "invalid_payload", { field: "settingId" });
  try {
    await retireMenuItemShopSetting(ctx, { menuItemId: id, locationId: b.locationId, settingId: b.settingId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
