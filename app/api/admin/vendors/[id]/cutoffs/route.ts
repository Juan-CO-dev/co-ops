import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addVendorCutoff, AdminVendorError } from "@/lib/admin/vendors";

// POST — append an order cutoff to a vendor (VO-7). AGM+ (≥6), Tier A — mirrors
// the contacts POST (append = AGM+). Body: { orderDay: 0..6, cutoffTime: "HH:MM",
// locationId?: string|null }. Append-only: deactivate is the DELETE below.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/cutoffs`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.orderDay !== "number") return jsonError(400, "invalid_payload", { field: "orderDay" });
  if (typeof b.cutoffTime !== "string" || !b.cutoffTime.trim()) {
    return jsonError(400, "invalid_payload", { field: "cutoffTime" });
  }
  const locationId =
    b.locationId === null || b.locationId === undefined
      ? null
      : typeof b.locationId === "string"
        ? b.locationId
        : null;

  try {
    const { id: cutoffId } = await addVendorCutoff(ctx, {
      vendorId: id,
      locationId,
      orderDay: b.orderDay,
      cutoffTime: b.cutoffTime,
    });
    return jsonOk({ id: cutoffId }, 201);
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
