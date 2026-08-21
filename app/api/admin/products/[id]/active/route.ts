import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setProductActive, ProductError } from "@/lib/products";

// Product retirement (Juan's ruling A+, 2026-08-21).
//   POST { active: boolean } — retire the identity (false) or bring it back (true).
//
// GM+ (≥7, the PRODUCT_WRITE_MIN floor the lib re-checks) and Tier B, NOT the Tier A
// its sibling sub-routes use: a membership edit or a primary swap moves which vendor
// a product means, while this decides whether the product means anything at all —
// every pinned recipe line stops costing and stops depleting. That is create-grade
// blast radius, so it takes create-grade freshness.
//
// It never hard-blocks on pinned recipes. The pre-flight warning ("N recipes still
// pin this") is rendered by /admin/products from the count listProducts already
// carries, and the count is recorded in the audit row — the system surfaces the
// consequences; Juan's declaration of reality wins.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}/active`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });

  try {
    const { pinnedRecipeCount } = await setProductActive(ctx, { productId: id, active: b.active });
    return jsonOk({ pinnedRecipeCount });
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
