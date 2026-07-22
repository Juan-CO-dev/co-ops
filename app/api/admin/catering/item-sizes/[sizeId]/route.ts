// PATCH (edit) / DELETE (deactivate) a catering size (GM+ >= 7, Tier A step-up).
import { type NextRequest, type NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import type { AuthContext } from "@/lib/session";
import { AdminCateringMenuError, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { updateItemSize, deactivateItemSize } from "@/lib/admin/catering/item-sizes";

async function gate(req: NextRequest, sizeId: string): Promise<AuthContext | NextResponse> {
  const ctx = await requireSession(req, `/api/admin/catering/item-sizes/${sizeId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MENU_ADMIN_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  return ctx;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sizeId: string }> }) {
  const { sizeId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await gate(req, sizeId);
  if (ctx instanceof Response) return ctx;
  const b = parsed as Record<string, unknown>;
  const changes: { label?: unknown; priceCents?: unknown; serves?: unknown } = {};
  if ("label" in b) changes.label = b.label;
  if ("priceCents" in b) changes.priceCents = b.priceCents;
  if ("serves" in b) changes.serves = b.serves;
  try {
    const size = await updateItemSize(ctx, sizeId, changes);
    return jsonOk({ size });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sizeId: string }> }) {
  const { sizeId } = await params;
  const ctx = await gate(req, sizeId);
  if (ctx instanceof Response) return ctx;
  try {
    await deactivateItemSize(ctx, sizeId);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
