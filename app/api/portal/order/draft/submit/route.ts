/**
 * POST /api/portal/order/draft/submit — the one completing click: draft → 'submitted'.
 *
 * Customer-authenticated. Freezes the authoritative charge stack (with the chosen tip / delivery /
 * napkins), creates the deposit-due payment intent, sends the confirmation email. customerId comes
 * from the session; submitDraft re-checks ownership + draft status.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { submitDraft, PortalDraftError } from "@/lib/portal/draft";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import { assertSameOrigin } from "@/lib/portal/csrf";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5
  if (csrf) return csrf;
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // A-H3: throttle order submissions per customer (submits are rare).
  if (!(await checkAndRecord(`draft_submit:${ctx.customerId}`, 300, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.quoteId !== "string") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const result = await submitDraft(ctx.customerId, body.quoteId, {
      isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : undefined,
      deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : (body.deliveryZoneId === null ? null : undefined),
      tipBps: Number.isFinite(body.tipBps) ? (body.tipBps as number) : undefined,
      napkins: body.napkins === true,
    });
    return NextResponse.json({ ok: true, quoteId: result.quoteId, depositCents: result.depositCents, totalCents: result.totalCents });
  } catch (e) {
    if (e instanceof PortalDraftError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
