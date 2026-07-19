/**
 * POST /api/portal/quote/[id]/pay — a signed-in customer initiates payment on their own quote.
 *
 * Customer-authenticated (requireCustomerSession). Origin check mirrors the magic-link route.
 * Ownership is the authorization boundary (enforced inside initiatePayment — a quote the caller
 * doesn't own is a 404). PAYMENT PROVIDER IS DEFERRED: this records a `due` payment intent and
 * returns a stub message; no Stripe/Toast is wired.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { checkAndRecord } from "@/lib/portal/rate-limit";

export const runtime = "nodejs";

const STUB_MESSAGE =
  "Payment isn't wired yet — Stripe/Toast lands later. Your order is recorded.";

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
    return NextResponse.json({ ...result, message: STUB_MESSAGE });
  } catch (e) {
    if (e instanceof PortalQuoteError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
}
