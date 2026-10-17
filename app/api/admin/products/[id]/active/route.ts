import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { consumeStepUpGrant } from "@/lib/admin/step-up-grants";
import { isUuid } from "@/lib/admin/step-up-shared";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setProductActive, ProductError } from "@/lib/products";

// Product retirement (Juan's ruling A+, 2026-08-21).
//   POST { active: boolean } — retire the identity (false) or bring it back (true).
//
// GM+ (≥7, the PRODUCT_WRITE_MIN floor the lib re-checks). RETIRING is an always-prompt act
// (catalog Phase 1, Astra r1 P1-1): it consumes a ONE-SHOT grant minted for exactly this product
// by the password the client just asked for — no edit window and no earlier password stands in.
// Every pinned recipe line stops costing and depleting; that blast radius asks every time.
// RESTORING is an ordinary catalog edit inside the 15-minute window (Tier E).
//
// It never hard-blocks on pinned recipes. The pre-flight warning ("N recipes still pin this") is
// rendered by /admin/products from the count listProducts already carries, and the count is
// recorded in the audit row — the system surfaces the consequences; Juan's declaration wins.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}/active`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });

  if (b.active === false) {
    if (!isUuid(id)) return jsonError(400, "invalid_id");
    const grant = await consumeStepUpGrant(ctx, "product.retire", id);
    if (!grant.ok) return jsonError(403, grant.code);
  } else {
    const su = assertStepUp(ctx, "E");
    if (!su.ok) return jsonError(403, su.code);
  }

  try {
    const { pinnedRecipeCount } = await setProductActive(ctx, { productId: id, active: b.active });
    return jsonOk({ pinnedRecipeCount });
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
