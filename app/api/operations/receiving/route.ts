import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordDelivery, ReceivingError, type RecordDeliveryInput } from "@/lib/receiving";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** V2-D4: cap the redelivery-closure batch. A door delivery closing >50 credits at
 *  once is well past any real short list — reject rather than fan out unbounded work. */
const MAX_MAKE_UP_CREDITS = 50;

// Log a delivery. KH+ (≥4), location-bound (checked in recordDelivery).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");

  const b = parsed as Partial<RecordDeliveryInput>;
  if (typeof b.vendorId !== "string" || typeof b.locationId !== "string" || typeof b.deliveryDate !== "string") {
    return jsonError(400, "invalid_payload");
  }
  if (!Array.isArray(b.lines)) return jsonError(400, "no_lines");

  // V2-D4: makeUpCreditIds — optional array of ≤50 UUID strings (the open credits this
  // delivery makes up). Reject a malformed batch rather than silently dropping it, so a
  // bad client can't quietly skip closing a real short.
  if (b.makeUpCreditIds !== undefined) {
    if (
      !Array.isArray(b.makeUpCreditIds) ||
      b.makeUpCreditIds.length > MAX_MAKE_UP_CREDITS ||
      !b.makeUpCreditIds.every((id) => typeof id === "string" && UUID_RE.test(id))
    ) {
      return jsonError(400, "invalid_make_up_credits");
    }
  }

  try {
    const res = await recordDelivery(ctx, b as RecordDeliveryInput);
    return jsonOk(
      {
        deliveryId: res.deliveryId,
        resolvedCredits: res.resolvedCredits,
        skippedCredits: res.skippedCredits,
        creditClosureError: res.creditClosureError,
      },
      201,
    );
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
