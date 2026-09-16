/**
 * POST /api/portal/quote/[id]/pay — a signed-in customer initiates payment on their own quote.
 *
 * Customer-authenticated (requireCustomerSession). Origin check mirrors the magic-link route.
 * Ownership is the authorization boundary (enforced inside initiatePayment / createQuoteCheckout
 * — a quote the caller doesn't own is a 404, twice over: each call re-checks it).
 *
 * ── TWO ANSWERS, ONE INTENT ──────────────────────────────────────────────────────────
 * The intent is recorded FIRST and unconditionally: a `catering_payments` row in
 * `status='due'`, audited as `catering.order.pay_intent`. Then, and only if this shop has
 * Stripe credentials, a hosted Checkout Session is minted and its URL returned. With no
 * keys set (`result.stub`), the response is byte-for-byte the historical one — the stub
 * message — which is what makes this whole feature dormant-safe.
 *
 * The client is told a URL and nothing else. It never learns which account took the money,
 * whether the shop has its own credentials, or what the session id is.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { checkAndRecord } from "@/lib/portal/rate-limit";

export const runtime = "nodejs";

const STUB_MESSAGE =
  "Payment isn't wired yet — Stripe/Toast lands later. Your order is recorded.";

/**
 * Absolute origin for Stripe's return links. `NEXT_PUBLIC_APP_URL` is the configured truth
 * (the same variable lib/portal/magic-link.ts requires before it will send a link), and the
 * request's own origin is the fallback so a preview deployment returns the customer to the
 * preview rather than to production. The fallback is safe here because assertSameOrigin has
 * already proved this request is same-host.
 */
function appOrigin(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin).replace(/\/$/, "");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5
  if (csrf) return csrf;

  const session = await requireCustomerSession(req);
  if (session instanceof NextResponse) return session; // 401 (with cleared cookie)

  // A-H3: throttle payment initiations per customer.
  if (!(await checkAndRecord(`pay:${session.customerId}`, 300, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { id } = await ctx.params; // Next 16 — params is a Promise.

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind;
  if (kind !== "deposit" && kind !== "full") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  try {
    const result = await initiatePayment(session.customerId, id, kind);
    if (result.stub) {
      // DORMANT: no provider for this shop. Exactly the historical response.
      return NextResponse.json({ ok: true, stub: true, message: STUB_MESSAGE });
    }
    const checkout = await createQuoteCheckout({
      customerId: session.customerId,
      customerEmail: session.email,
      quoteId: id,
      kind,
      paymentId: result.paymentId,
      amountCents: result.amountCents,
      appOrigin: appOrigin(req),
    });
    return NextResponse.json({ ok: true, stub: false, url: checkout.url });
  } catch (e) {
    if (e instanceof PortalQuoteError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
}
