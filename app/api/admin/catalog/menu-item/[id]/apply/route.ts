/**
 * POST /api/admin/catalog/menu-item/[id]/apply — save EXACTLY the previewed menu act (catalog Phase 3b).
 * Body: { change: MenuChangeRequest, previewToken: string }. Tier E; the lib recomputes, binds and writes.
 * A promote refused AFTER its typed Spanish name was saved (the two-step promote, CC note 2 #3) answers with
 * `spanishNameSaved` and the message key `catalog.menu.promote.es_saved_not_promoted`: the shop's own label
 * changed (it is in History) but the promote did not happen — said plainly, never folded into a generic error.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyMenuChange } from "@/lib/catalog/menu-item-page";
import { parseMenuChange } from "@/lib/catalog/recipe-item-shared";
import { MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  const change = parseMenuChange(b.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  if (typeof b.previewToken !== "string" || b.previewToken.length === 0 || b.previewToken.length > 64) {
    return jsonError(400, "invalid_payload", { field: "previewToken" });
  }
  try {
    await applyMenuChange(ctx, id, change.change, b.previewToken);
    return jsonOk({ ok: true }, 201);
  } catch (e) {
    if (e instanceof MenuShopError) {
      return jsonError(e.status, e.code, {
        message: e.message,
        ...(e.spanishNameSaved ? { spanishNameSaved: e.spanishNameSaved, notice: "catalog.menu.promote.es_saved_not_promoted" } : {}),
      });
    }
    throw e;
  }
}
