import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordDelivery, ReceivingError, type RecordDeliveryInput } from "@/lib/receiving";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** V2-D4: cap the redelivery-closure batch. A door delivery closing >50 credits at
 *  once is well past any real short list — reject rather than fan out unbounded work. */
const MAX_MAKE_UP_CREDITS = 50;
/** Same bounding rationale for the missing-item batch: a door delivery declaring >50
 *  ordered items entirely absent is past any real truck — reject rather than fan out. */
const MAX_MISSING_LINES = 50;

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

  // missingLines — optional array of ≤50 { skuId, expectedQty, unitPrice? } (ordered items
  // that never came off the truck). Shape-checked here; the SKU-active check, the
  // arrived-anyway filter, and the PO-linked requirement are enforced in recordDelivery.
  if (b.missingLines !== undefined) {
    // Re-widen to unknown before inspecting: the declared type is what a WELL-BEHAVED
    // client sends, not what arrived on the wire. Validate the real shape, not the label.
    const rows: unknown = b.missingLines;
    if (!Array.isArray(rows) || rows.length > MAX_MISSING_LINES) {
      return jsonError(400, "invalid_missing_lines");
    }
    for (const raw of rows as unknown[]) {
      if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_missing_lines");
      const m = raw as Record<string, unknown>;
      if (typeof m.skuId !== "string" || !UUID_RE.test(m.skuId)) return jsonError(400, "invalid_missing_lines");
      if (typeof m.expectedQty !== "number" || !Number.isFinite(m.expectedQty) || m.expectedQty <= 0) {
        return jsonError(400, "invalid_missing_lines");
      }
      if (
        m.unitPrice != null &&
        (typeof m.unitPrice !== "number" || !Number.isFinite(m.unitPrice) || m.unitPrice <= 0)
      ) {
        return jsonError(400, "invalid_missing_lines");
      }
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
