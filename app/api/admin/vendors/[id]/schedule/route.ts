import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setVendorSchedule, AdminVendorError } from "@/lib/admin/vendors";

// Set a vendor's weekly order/delivery days + calendar color. GM+ (≥7), Tier A.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/schedule`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (!Array.isArray(b.orderDays) || !Array.isArray(b.deliveryDays)) {
    return jsonError(400, "invalid_payload", { message: "orderDays/deliveryDays must be arrays" });
  }
  const color = b.color === null || typeof b.color === "string" ? (b.color as string | null) : null;
  try {
    await setVendorSchedule(ctx, {
      vendorId: id,
      orderDays: b.orderDays as number[],
      deliveryDays: b.deliveryDays as number[],
      color,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
