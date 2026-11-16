import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { resendExpiredQuote, CateringQuoteError, QUOTE_RESEND_MIN } from "@/lib/catering/quotes";
import { quoteExpiryInstantForEtDate } from "@/lib/catering/quotes-shared";

/**
 * POST — resend an EXPIRED catering quote with a new expiry date (owner request, Juan
 * 2026-11-15: "expired quotes should be able to be resent, not remade"). The same quote id,
 * lines and payments; no revision. Body: `{ expiresOn: "YYYY-MM-DD" }` — the LAST operational
 * (ET) day the offer is good for; it expires at the end of that day.
 *
 * EXACTLY Send's posture (app/api/catering/quotes/[id]/send/route.ts), because it does what
 * Send does — puts a payable offer in front of a customer:
 *   - same-origin first, then the session;
 *   - the Send floor (`QUOTE_RESEND_MIN` IS `QUOTE_WRITE_MIN`); the shop bind is in the lib;
 *   - Tier B step-up: a FRESH password right before the offer goes out. This path is a
 *     step-up SURFACE (lib/session.ts `isCateringStepUpPath`), so the unlock set by the
 *     immediately-preceding POST /api/auth/step-up survives to this requireSession. On
 *     step_up_required / step_up_stale the client opens the password modal and retries.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/resend`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < QUOTE_RESEND_MIN) return jsonError(403, "forbidden");

  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);

  const expiresOn = (parsed as Record<string, unknown> | null)?.expiresOn;
  const expiresAt = quoteExpiryInstantForEtDate(expiresOn);
  if (!expiresAt) return jsonError(400, "invalid_expiry", { field: "expiresOn", message: "Must be a calendar date, YYYY-MM-DD" });

  try {
    const result = await resendExpiredQuote(ctx, id, { expiresAt });
    return jsonOk({
      ok: true,
      emailed: result.emailed,
      emailOutcome: result.emailOutcome,
      recipient: result.recipient,
      recipientHidden: result.recipientHidden,
      expiresAt: result.expiresAt,
      // How many payments on this quote settled after the OLD expiry: still flagged for review.
      latePayments: result.latePaymentIds.length,
    });
  } catch (e) {
    if (e instanceof CateringQuoteError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
