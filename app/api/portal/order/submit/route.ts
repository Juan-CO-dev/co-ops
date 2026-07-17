/**
 * POST /api/portal/order/submit — a signed-in customer submits a self-serve catering order.
 *
 * Customer-authenticated (requireCustomerSession → the customer principal). Origin check mirrors
 * the magic-link route (reject cross-site POSTs). The body carries item/package REFERENCES +
 * quantities only; submitOrder (lib/portal/orders.ts) resolves every price server-side (D20 —
 * strict server price authority) and never reads a client-supplied price. customerId comes from
 * the verified session, never from the body.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { submitOrder, PortalOrderError } from "@/lib/portal/orders";
import type { SubmitOrderInput, SubmitLineInput } from "@/lib/portal/orders";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  // Authorization boundary: the customer principal.
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx; // 401 (with cleared cookie)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body == null || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Shape validation (submitOrder re-validates + prices; this rejects obvious garbage early).
  if (typeof body.locationId !== "string" || body.locationId.length === 0) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!Array.isArray(body.lines)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (typeof body.contactName !== "string" || body.contactName.trim().length === 0) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const lines: SubmitLineInput[] = body.lines.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      packageId: typeof o.packageId === "string" ? o.packageId : null,
      quantity: Number(o.quantity),
      notes: typeof o.notes === "string" ? o.notes : null,
    };
  });

  const input: SubmitOrderInput = {
    locationId: body.locationId,
    eventDate: typeof body.eventDate === "string" ? body.eventDate : null,
    headcount: typeof body.headcount === "number" ? body.headcount : null,
    isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : false,
    deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : null,
    contactName: body.contactName,
    company: typeof body.company === "string" ? body.company : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    lines,
  };

  try {
    const result = await submitOrder(ctx.customerId, input);
    return NextResponse.json({
      ok: true,
      quoteId: result.quoteId,
      depositCents: result.depositCents,
      totalCents: result.totalCents,
    });
  } catch (e) {
    if (e instanceof PortalOrderError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
}
