/**
 * GET — the lead's live quotes that hold money taken through the app, with what is still refundable (the pipeline's
 * "Refund" prompt on a lost order). Read only; the refund itself is made on the quote (../../quotes/[id]/refunds).
 * STORED STATE ONLY (Part B1): one stored-summary read per batch of the lead's quotes (lib/catering/refunds.ts
 * `loadLeadRefundables`, LEAD_REFUND_BATCH), ZERO provider calls; an unchecked or held amount is labelled.
 * SHIPS DARK behind CATERING_REFUNDS=1 (503 `refunds_off`).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { CateringRefundError, REFUND_READ_MIN, cateringRefundsOn, isUuid, loadLeadRefundables } from "@/lib/catering/refunds";
import { ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/pipeline/${id}/refunds`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  if (ROLES[ctx.user.role].level < REFUND_READ_MIN) return jsonError(403, "forbidden");
  if (!isUuid(id)) return jsonError(400, "invalid_request");
  try {
    return jsonOk({ quotes: await loadLeadRefundables(ctx, id) });
  } catch (e) {
    if (e instanceof CateringRefundError) return jsonError(e.status, e.code, e.detail ?? {});
    throw e;
  }
}
