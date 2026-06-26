import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addItemComponent, AdminItemComponentError } from "@/lib/admin/item-components";

// POST — add a BOM component (SKU XOR sub-item) to an item. GM+ (≥7), Tier B.
// Body: { componentSkuId?, componentItemId?, quantity, unit? } — exactly one fk.
// Route floors ≥6; the lib enforces ≥7.
export async function POST(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/items/${itemId}/components`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (b.componentSkuId !== undefined && b.componentSkuId !== null && typeof b.componentSkuId !== "string") {
    return jsonError(400, "invalid_payload", { field: "componentSkuId" });
  }
  if (b.componentItemId !== undefined && b.componentItemId !== null && typeof b.componentItemId !== "string") {
    return jsonError(400, "invalid_payload", { field: "componentItemId" });
  }
  if (typeof b.quantity !== "number") {
    return jsonError(400, "invalid_payload", { field: "quantity" });
  }
  if (b.unit !== undefined && b.unit !== null && typeof b.unit !== "string") {
    return jsonError(400, "invalid_payload", { field: "unit" });
  }

  try {
    const { id } = await addItemComponent(ctx, {
      itemId,
      componentSkuId: typeof b.componentSkuId === "string" ? b.componentSkuId : null,
      componentItemId: typeof b.componentItemId === "string" ? b.componentItemId : null,
      quantity: b.quantity,
      unit: typeof b.unit === "string" ? b.unit : null,
    });
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminItemComponentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
