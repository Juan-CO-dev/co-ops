import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadPaymentsForQuote,
  markPaymentPaid,
  CateringPaymentError,
  PAYMENT_READ_MIN,
  PAYMENT_WRITE_MIN,
} from "@/lib/catering/payments";

/**
 * Catering payment intents for a quote — the staff seam for the built-but-unwired
 * markPaymentPaid (Ops guardrails NOW #3, piece 4).
 *
 * GET  — list the quote's payment intents (view >= 5, PAYMENT_READ_MIN).
 * POST — mark a specific `due` intent paid: body { paymentId } (write >= 6,
 *        PAYMENT_WRITE_MIN = catering_mgr+). NO step-up: the lib's contract is
 *        requireLevel + lockLocationContext (see lib/catering/payments.ts), matching
 *        the non-step-up catering write floor (PATCH quote status). Only the quote-SEND
 *        route widens the step-up surface (isCateringStepUpPath), a Juan-signed-off
 *        security decision scoped to /send ONLY — a new step-up surface is out of scope
 *        for wiring an existing lib fn and would require the same sign-off.
 *
 * Errors map from the lib's typed CateringPaymentError (403 forbidden / location denied,
 * 404 not-found — IDOR-safe, never confirms cross-location existence, 409 not_due).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/payments`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PAYMENT_READ_MIN) return jsonError(403, "forbidden");
  try {
    const payments = await loadPaymentsForQuote(ctx, id);
    return jsonOk({ payments });
  } catch (e) {
    if (e instanceof CateringPaymentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/payments`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PAYMENT_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const paymentId = typeof b.paymentId === "string" && b.paymentId.length > 0 ? b.paymentId : null;
  if (paymentId === null) {
    return jsonError(400, "invalid_payload", { field: "paymentId", message: "paymentId is required" });
  }

  try {
    await markPaymentPaid(ctx, paymentId, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof CateringPaymentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
