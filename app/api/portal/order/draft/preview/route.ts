/**
 * POST /api/portal/order/draft/preview — compute-only charge stack for the review page.
 *
 * Customer-authenticated. Returns the server-authoritative stack for the draft's CURRENT lines
 * under a chosen tip / delivery / napkins toggle — persists NOTHING (keeps the review breakdown
 * server-owned, no client illustrative rates). customerId comes from the session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { previewDraft, PortalDraftError } from "@/lib/portal/draft";

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
    const stack = await previewDraft(ctx.customerId, body.quoteId, {
      isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : undefined,
      deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : (body.deliveryZoneId === null ? null : undefined),
      tipBps: typeof body.tipBps === "number" ? body.tipBps : undefined,
      napkins: body.napkins === true,
    });
    return NextResponse.json({ ok: true, stack });
  } catch (e) {
    if (e instanceof PortalDraftError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
