/**
 * POST /api/admin/catalog/menu-item/[id]/preview — "What this changes" for ONE menu act (catalog Phase
 * 3b). Body: { change: MenuChangeRequest } (a promote may carry the optional typed Spanish name, `nameEs`).
 * A read: no step-up. The lib (computeMenuPreview) gates who may save it — role rule, shop bind, MoO+ promote.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { computeMenuPreview } from "@/lib/catalog/menu-item-page";
import { parseMenuChange } from "@/lib/catalog/recipe-item-shared";
import { MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const change = parseMenuChange((parsed as Record<string, unknown> | null)?.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  try {
    return jsonOk({ preview: await computeMenuPreview(ctx, id, change.change) });
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
