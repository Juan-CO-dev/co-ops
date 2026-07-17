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

export const runtime = "nodejs";

const STUB_MESSAGE =
  "Payment isn't wired yet — Stripe/Toast lands later. Your order is recorded.";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // CSRF: reject cross-site POSTs (a same-site fetch sends a matching Origin).
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.nextUrl.host) {
        return NextResponse.json({ error: "bad_origin" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "bad_origin" }, { status: 403 });
    }
  }

  const session = await requireCustomerSession(req);
  if (session instanceof NextResponse) return session; // 401 (with cleared cookie)

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
