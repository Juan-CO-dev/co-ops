/**
 * POST /api/admin/catalog/menu-item/[id]/shop/restore — save an old overlay row's values as a new one
 * (catalog Phase 3a). Body: { locationId: uuid, fromSettingId: uuid, expectedSettingId: uuid | null }.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { restoreMenuItemShopSetting, MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/shop/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.fromSettingId !== "string" || !UUID_RE.test(b.fromSettingId)) return jsonError(400, "invalid_payload", { field: "fromSettingId" });
  const expected = optUuid(b.expectedSettingId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedSettingId" });
  try {
    const r = await restoreMenuItemShopSetting(ctx, { menuItemId: id, locationId: b.locationId, fromSettingId: b.fromSettingId, expectedSettingId: expected });
    return jsonOk({ settingId: r.settingId, retiredSettingId: r.retiredSettingId }, 201);
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
