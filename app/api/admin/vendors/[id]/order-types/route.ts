import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setVendorOrderTypes, AdminVendorError } from "@/lib/admin/vendors";

// PUT — replace the vendor's order-type set (GM+ ≥7, Tier A). Body {orderTypeIds:[]}.
// ≥1 required; all ids must exist + be active (enforced in the lib).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/order-types`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (!Array.isArray(b.orderTypeIds) || !b.orderTypeIds.every((x) => typeof x === "string")) {
    return jsonError(400, "invalid_payload", { field: "orderTypeIds" });
  }

  try {
    await setVendorOrderTypes(ctx, { vendorId: id, orderTypeIds: b.orderTypeIds as string[] });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
