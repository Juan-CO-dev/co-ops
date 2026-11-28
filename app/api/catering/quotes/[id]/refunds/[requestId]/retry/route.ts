/**
 * "Check Stripe" from one refund request's row (Part B1 v2; lib/catering/refunds.ts `checkRefunds`). SHIPS DARK.
 *
 * Main's retry route, KEPT AT ITS PATH so a panel served before B1 v2 still reaches something safe: it NEVER SENDS.
 * It reads Stripe for every eligible payment of the order (GETs only: each read mirrors what Stripe shows and binds a
 * request whose refund it finds), then answers the results and a fresh summary — exactly what POST .../refunds/check
 * answers. There is no resend and no release here any more: an unconfirmed request is resolved by a read that binds
 * it, or by a person through .../release or .../attach (Tier B, the release roles). THIS FILE IMPORTS NO SENDER
 * (`createRefund` / `requestRefund`): pinned by tests/catering-refund-routes.test.ts.
 *
 * Order: same-origin, the session on the route's own path, the switch (503 `refunds_off`, as main), the ids, the body
 * (`{}` exactly; anything else is 400 `invalid_request`), the refund roles (403), the lib (its own gate: OBSERVE off =
 * 503 `refunds_unavailable`; the shop). No step-up: it moves no money. Not a step-up surface: it clears an unlock.
 * `requestId` names the row the person pressed from; the check covers the whole order the row belongs to.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringRefundError, canRequestRefund, checkRefunds, cateringRefundsOn, isUuid, loadRefundSummary, parseCheckBody } from "@/lib/catering/refunds";
import { RefundsUnavailableError } from "@/lib/catering/refund-observe";

/** The reads have 25 s (`REFUND_ACTION_READ_MS`); the summary and the response fit well inside this. */
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, requestId } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds/${requestId}/retry`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  if (!isUuid(id) || !isUuid(requestId)) return jsonError(400, "invalid_request");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (parseCheckBody(raw) !== true) return jsonError(400, "invalid_request");
  if (!canRequestRefund(ctx.user.role)) return jsonError(403, "forbidden");
  try {
    const checks = await checkRefunds(ctx, id);
    const summary = await loadRefundSummary(ctx, id).catch(() => null);
    return jsonOk({ checks, summary });
  } catch (e) {
    if (e instanceof RefundsUnavailableError) return jsonError(503, "refunds_unavailable");
    if (e instanceof CateringRefundError) {
      const summary = e.status === 409 ? { summary: await loadRefundSummary(ctx, id).catch(() => null) } : {};
      return jsonError(e.status, e.code, { ...(e.detail ?? {}), ...summary });
    }
    throw e;
  }
}
