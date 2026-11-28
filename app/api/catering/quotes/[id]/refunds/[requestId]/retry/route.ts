/**
 * Retry / Check Stripe / Release ONE refund request (migrations 0357 / 0359; lib/catering/refunds.ts
 * `retryRefundRequest`). SHIPS DARK behind CATERING_REFUNDS=1.
 *
 * Body, strictly one of:
 *   {}                                           Retry (a `pending` row inside its 24-hour window: fresh live admission,
 *                                                the sender claim, a complete Stripe discovery, then — only if nothing is
 *                                                found — the arm and the POST with the ORIGINAL key and frozen
 *                                                parameters) or Check Stripe (past the window, or a `submitted` row: GETs
 *                                                only, never a send). Anything else: 409 `not_retryable`.
 *   { "release": true }                          close a past-window row Stripe shows no refund for (`released_no_refund`)
 *   { "release": true, "staffVerified": true }   …with the person's confirmation that they looked at the owning charge
 *                                                in Stripe (the database requires it: 409 `staff_verification_required`).
 * `staffVerified` only with `release`, and only `true`; any other body is 400 `invalid_request`. Before the window a
 * release is 409 `not_releasable`. The lib re-reads the stored summary's family, the epoch and 0358's actor rule.
 *
 * NO STEP-UP, deliberately (Juan's approved password-free Release, plan B1.1): a retry can only re-send a request a
 * person already confirmed behind a fresh password (the POST on ../../ route); it cannot change the amount, the payment
 * or the reason, and it is idempotent at Stripe. The role and shop gate is the same as the confirm tap's. This path is
 * therefore NOT a step-up surface (lib/session.ts `isCateringStepUpPath`).
 *
 * After the action the stored summary is re-read (zero provider calls); a failed re-read is `summary: null`, never an
 * error the person would retry. The lib computes its own deadline from REFUND_ROUTE_BUDGET_MS (= maxDuration).
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringRefundError, canRequestRefund, cateringRefundsOn, isUuid, loadRefundSummary, retryRefundRequest } from "@/lib/catering/refunds";

/** Plan B1.6: the money mutation's route budget (REFUND_ROUTE_BUDGET_MS), 15 s of it kept back to finish. */
export const maxDuration = 120;

/** `{}` | `{ release: true }` | `{ release: true, staffVerified: true }`, else null. */
function parseRetryBody(raw: unknown): { mode: "retry" | "release"; staffVerified: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "release" && k !== "staffVerified")) return null;
  if ("release" in b && b.release !== true) return null;
  if ("staffVerified" in b && (b.staffVerified !== true || b.release !== true)) return null;
  return { mode: b.release === true ? "release" : "retry", staffVerified: b.staffVerified === true };
}

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
  const body = parseRetryBody(raw);
  if (!body) return jsonError(400, "invalid_request");
  if (!canRequestRefund(ctx.user.role)) return jsonError(403, "forbidden");
  try {
    const result = await retryRefundRequest(ctx, id, requestId, Date.now(), body.mode, body.staffVerified);
    // The action is done; a failed re-read must not turn that into an error the person would retry.
    const summary = await loadRefundSummary(ctx, id).catch(() => null);
    return jsonOk({ ok: true, result, summary });
  } catch (e) {
    if (e instanceof CateringRefundError) return jsonError(e.status, e.code, e.detail ?? {});
    throw e;
  }
}
