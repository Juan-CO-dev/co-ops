/**
 * POST — "Check Stripe now" for one order (Part B1 v2; lib/catering/refunds.ts `checkRefunds`). SHIPS DARK.
 *
 * A read of every eligible payment of the order: GETs only, it NEVER sends. Each read mirrors what Stripe shows and
 * binds a request whose refund it finds; the figures stay "checking with Stripe" until a read at least 5 minutes after
 * the last change. Answers `{ checks: { paymentId, result, reason, bound }[], summary }`.
 *
 * Order: same-origin, the session on the route's own path, the switch (503 `refunds_off`), the body (`{}` exactly),
 * the id, the refund roles (403), the lib (its own gate: OBSERVE off = 503 `refunds_unavailable`; the shop). No
 * step-up (it moves no money), and NOT a step-up surface: calling it clears a password unlock, so the panel never
 * calls it between the password and the confirm / release / attach it was typed for.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringRefundError, canRequestRefund, checkRefunds, cateringRefundsOn, isUuid, loadRefundSummary, parseCheckBody } from "@/lib/catering/refunds";
import { RefundsUnavailableError } from "@/lib/catering/refund-observe";

/** The reads have 25 s (`REFUND_ACTION_READ_MS`); the summary and the response fit well inside this. */
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds/check`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (parseCheckBody(raw) !== true) return jsonError(400, "invalid_request");
  if (!isUuid(id)) return jsonError(400, "invalid_request");
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
