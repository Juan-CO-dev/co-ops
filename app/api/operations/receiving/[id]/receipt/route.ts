import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { attachDeliveryReceipt, ReceivingError, RECEIVE_MIN } from "@/lib/receiving";

/**
 * PATCH { photoId } → attach the receipt photo to a delivery that has none.
 *
 * The "photo later" ceremony's missing half: `receipt_url IS NULL` is the "Photo
 * missing" badge state, and this is the only path that clears it after intake.
 * KH+ (≥4, RECEIVE_MIN — the same floor RECEIPT_MIN sets on the vendor-claim
 * surfaces). Location-bind, write-once (409) and the rowcount guard all live in
 * the lib, next to the read they depend on.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/operations/receiving/${id}/receipt`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIVE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  if (typeof b.photoId !== "string" || !b.photoId) {
    return jsonError(400, "invalid_payload", { field: "photoId" });
  }

  try {
    const result = await attachDeliveryReceipt(ctx, id, b.photoId);
    return jsonOk(result);
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
