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
import { checkAndRecord } from "@/lib/portal/rate-limit";
import { assertSameOrigin } from "@/lib/portal/csrf";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5
  if (csrf) return csrf;
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // A-H3: throttle preview recomputes per customer.
  if (!(await checkAndRecord(`draft_preview:${ctx.customerId}`, 60, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.quoteId !== "string") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const stack = await previewDraft(ctx.customerId, body.quoteId, {
      isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : undefined,
      deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : (body.deliveryZoneId === null ? null : undefined),
      tipBps: Number.isFinite(body.tipBps) ? (body.tipBps as number) : undefined,
      napkins: body.napkins === true,
    });
    return NextResponse.json({ ok: true, stack });
  } catch (e) {
    if (e instanceof PortalDraftError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
