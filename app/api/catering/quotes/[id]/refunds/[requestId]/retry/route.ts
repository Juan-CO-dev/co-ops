/**
 * Retry / refresh ONE refund request (migration 0357; lib/catering/refunds.ts `retryRefundRequest`). SHIPS DARK.
 *
 * A `pending` row (Stripe's answer was never confirmed): look for a Stripe refund carrying this row's id first, then
 * re-send with the SAME idempotency key and parameters — only inside Stripe's 24-hour retry window (past it: 409
 * `needs_reconcile`, a person checks Stripe). A `submitted` row: read its status from Stripe again. Anything else:
 * 409 `not_retryable`.
 *
 * NO STEP-UP, deliberately: a retry can only re-send a request a person already confirmed behind a fresh password
 * (the POST on ../../ route); it cannot change the amount, the payment or the reason, and it is idempotent at Stripe.
 * The role and shop gate is the same as the confirm tap's, and 0357's actor rule is asked again.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { CateringRefundError, canRequestRefund, cateringRefundsOn, isUuid, loadRefundSummary, retryRefundRequest } from "@/lib/catering/refunds";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, requestId } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds/${requestId}/retry`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  if (!isUuid(id) || !isUuid(requestId)) return jsonError(400, "invalid_request");
  if (!canRequestRefund(ctx.user.role)) return jsonError(403, "forbidden");
  try {
    const result = await retryRefundRequest(ctx, id, requestId);
    return jsonOk({ ok: true, result, summary: await loadRefundSummary(ctx, id) });
  } catch (e) {
    if (e instanceof CateringRefundError) return jsonError(e.status, e.code, e.detail ?? {});
    throw e;
  }
}
