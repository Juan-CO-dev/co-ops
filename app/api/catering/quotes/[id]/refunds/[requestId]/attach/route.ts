/**
 * POST — ATTACH a retrieved Stripe refund to an unconfirmed refund request (Part B1 v2 [Q4], migration 0359 F16;
 * lib/catering/refunds.ts `attachRefund`). SHIPS DARK. The staff exit when a refund DID land but nothing bound it
 * (e.g. its metadata was removed): a person (MoO at the shop, owner, CGS) picks ONE refund the panel listed as
 * attachable. Body `{ refundId, note? }`. The lib makes a fresh read of the request's payment and F16 decides under
 * the locks (the refund is this payment's, retrieved by exactly that read, unbound, the request's amount and
 * currency, the credential the arm recorded). Sends nothing to Stripe. Answers `{ result, summary }`.
 *
 * Order: same-origin, the session on the route's OWN path (a step-up surface, lib/session.ts
 * `isCateringStepUpPath`), the switch (503 `refunds_off`), the strict body, the ids, the release roles (403 before
 * the password: a GM is refused), Tier B, the lib (its own gate: OBSERVE off = 503 `refunds_unavailable`; the shop;
 * then F16's named refusals). A 409 carries a fresh `summary`.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  CateringRefundError,
  attachRefund,
  canReleaseRefund,
  cateringRefundsOn,
  isUuid,
  loadRefundSummary,
  parseAttachBody,
} from "@/lib/catering/refunds";
import { RefundsUnavailableError } from "@/lib/catering/refund-observe";

/** The read has 25 s (`REFUND_ACTION_READ_MS`); F16 and the summary fit well inside this. */
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, requestId } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds/${requestId}/attach`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const body = parseAttachBody(raw);
  if (typeof body === "string") return jsonError(400, body);
  if (!isUuid(id) || !isUuid(requestId)) return jsonError(400, "invalid_request");
  if (!canReleaseRefund(ctx.user.role)) return jsonError(403, "forbidden");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  try {
    const result = await attachRefund(ctx, id, requestId, body);
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
