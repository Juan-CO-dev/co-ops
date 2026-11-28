/**
 * POST — RELEASE an unconfirmed refund request (Part B1 v2, migration 0359 F12; lib/catering/refunds.ts
 * `releaseRefund`). SHIPS DARK. The staff exit when NOTHING was sent: a person (MoO at the shop, owner, CGS) read
 * Stripe's request log for the key `catering-refund:<requestId>` and states what it showed, in which account and mode:
 * body `{ finding: "no_request" | "request_failed", accountSlot: "location" | "default", livemode, note? }`. A
 * `request_succeeded` finding is refused `use_attach` (409: attach the refund instead); `unclear` is
 * `finding_not_releasable` (400: tell CC). The lib makes a fresh read of the request's payment and F12 decides under
 * the locks (24 h, the account, the mode, the credential the arm recorded, no candidate refund). Sends nothing to
 * Stripe. Answers `{ result, summary }`.
 *
 * Order: same-origin, the session on the route's OWN path (a step-up surface, lib/session.ts
 * `isCateringStepUpPath`, so it keeps the unlock the preceding POST /api/auth/step-up set), the switch (503
 * `refunds_off`), the strict body, the ids, the release roles (403 before the password: a GM is refused), Tier B, the
 * lib (its own gate: OBSERVE off = 503 `refunds_unavailable`; the shop; then F12's named refusals). A 409 carries a
 * fresh `summary`.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  CateringRefundError,
  canReleaseRefund,
  cateringRefundsOn,
  isUuid,
  loadRefundSummary,
  parseReleaseBody,
  refundRefusal,
  releaseRefund,
} from "@/lib/catering/refunds";
import { RefundsUnavailableError } from "@/lib/catering/refund-observe";

/** The read has 25 s (`REFUND_ACTION_READ_MS`); F12 and the summary fit well inside this. */
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, requestId } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds/${requestId}/release`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const body = parseReleaseBody(raw);
  if (typeof body === "string") return jsonError(refundRefusal("release", body)?.status ?? 400, body);
  if (!isUuid(id) || !isUuid(requestId)) return jsonError(400, "invalid_request");
  if (!canReleaseRefund(ctx.user.role)) return jsonError(403, "forbidden");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  try {
    const result = await releaseRefund(ctx, id, requestId, body);
    const summary = await loadRefundSummary(ctx, id).catch(() => null);
    return jsonOk({ result, summary });
  } catch (e) {
    if (e instanceof RefundsUnavailableError) return jsonError(503, "refunds_unavailable");
    if (e instanceof CateringRefundError) {
      const summary = e.status === 409 ? { summary: await loadRefundSummary(ctx, id).catch(() => null) } : {};
      return jsonError(e.status, e.code, { ...(e.detail ?? {}), ...summary });
    }
    throw e;
  }
}
