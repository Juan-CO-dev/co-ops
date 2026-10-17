import { assertSameOrigin } from "@/lib/portal/csrf";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { MENU_PRICE_WRITE_MIN, MenuPriceError, updateMenuPrice } from "@/lib/admin/menu-prices";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/menu-items/${id}/price`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MENU_PRICE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonError(400, "invalid_payload");
  try {
    await updateMenuPrice(ctx, id, (parsed as Record<string, unknown>).menuPrice, (parsed as Record<string, unknown>).expectedMenuPrice);
    return jsonOk({ ok: true });
  } catch (error) {
    if (error instanceof MenuPriceError) return jsonError(error.status, error.code);
    console.warn("menu_price_update_failed");
    return jsonError(500, "internal_error");
  }
}
