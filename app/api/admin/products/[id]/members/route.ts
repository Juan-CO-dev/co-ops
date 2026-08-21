import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { attachMember, detachMember, ProductError } from "@/lib/products";

// Membership edits (GM+ ≥7, Tier A — a membership change is a SKU-grade edit).
//   POST   { skuId } — attach the SKU to this product.
//   DELETE { skuId } — detach it (product_id → NULL = implicit singleton again).
// Both refuse with a NAMED 409 when a product_primaries row names the SKU: the
// composite FK would reject the write anyway, and a named code beats a 500.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}/members`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.skuId !== "string") return jsonError(400, "invalid_payload", { field: "skuId" });

  try {
    await attachMember(ctx, { productId: id, skuId: b.skuId });
    return jsonOk({});
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}/members`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.skuId !== "string") return jsonError(400, "invalid_payload", { field: "skuId" });

  try {
    await detachMember(ctx, { skuId: b.skuId });
    return jsonOk({});
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
