/**
 * POST /api/portal/order/draft/lines — persist the customer's cart onto their draft (server-priced).
 *
 * Customer-authenticated (requireCustomerSession). Body carries the draft quoteId + item/menu_item
 * REFERENCES + quantities + portion ONLY; setDraftLines resolves every price server-side (D20).
 * customerId comes from the verified session, never the body.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { setDraftLines, PortalDraftError } from "@/lib/portal/draft";
import type { DraftLineInput } from "@/lib/portal/draft";

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
  if (!body || typeof body.quoteId !== "string" || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const lines: DraftLineInput[] = body.lines.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      menuItemId: typeof o.menuItemId === "string" ? o.menuItemId : null,
      portion: o.portion === "quarter" || o.portion === "half" || o.portion === "whole" ? o.portion : null,
      quantity: Number(o.quantity),
    };
  });

  try {
    const view = await setDraftLines(ctx.customerId, body.quoteId, lines, {
      isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : undefined,
      deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : (body.deliveryZoneId === null ? null : undefined),
      tipBps: typeof body.tipBps === "number" ? body.tipBps : undefined,
    });
    return NextResponse.json({ ok: true, stack: view.stack, isDelivery: view.isDelivery, deliveryZoneId: view.deliveryZoneId });
  } catch (e) {
    if (e instanceof PortalDraftError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
