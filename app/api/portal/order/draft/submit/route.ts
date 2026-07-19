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

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
    catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  }
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx;

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
