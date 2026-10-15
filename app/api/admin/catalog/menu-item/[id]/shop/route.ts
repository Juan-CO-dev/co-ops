/**
 * POST /api/admin/catalog/menu-item/[id]/shop — save this shop's price / sold here / name here for a
 * menu item (catalog Phase 3a). Body: { locationId: uuid, expectedSettingId: uuid | null,
 *   price: number | null, soldHere: boolean, nameOverride: string | null, nameOverrideEs: string | null }.
 * The lib (lib/admin/menu-item-shop.ts) binds the shop; this route: session, level-7 floor, Tier E, fields.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveMenuItemShopSetting, MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN, parseMenuShopPatch } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/shop`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedSettingId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedSettingId" });
  const patch = parseMenuShopPatch({ price: b.price, soldHere: b.soldHere, nameOverride: b.nameOverride, nameOverrideEs: b.nameOverrideEs });
  if (!patch.ok) return jsonError(400, patch.code);
  try {
    const r = await saveMenuItemShopSetting(ctx, { menuItemId: id, locationId: b.locationId, expectedSettingId: expected, patch: patch.patch });
    return jsonOk({ settingId: r.settingId, retiredSettingId: r.retiredSettingId }, 201);
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
