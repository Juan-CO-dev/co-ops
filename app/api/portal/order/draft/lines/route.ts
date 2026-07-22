/**
 * POST /api/portal/order/draft/lines — persist the customer's cart onto their draft (server-priced).
 *
 * Customer-authenticated (requireCustomerSession). Body carries the draft quoteId + item/menu_item
 * REFERENCES + quantities + portion ONLY; setDraftLines resolves every price server-side (D20).
 * customerId comes from the verified session, never the body.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { setDraftLines, PortalDraftError, MAX_CART_LINES } from "@/lib/portal/draft";
import type { DraftLineInput } from "@/lib/portal/draft";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import { assertSameOrigin } from "@/lib/portal/csrf";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5
  if (csrf) return csrf;
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // A-H3: throttle cart writes per customer (well above legit debounced-edit volume).
  if (!(await checkAndRecord(`draft_lines:${ctx.customerId}`, 60, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.quoteId !== "string" || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  // Reject an oversized cart BEFORE mapping it (A-H4 — unbounded-input DoS).
  if (body.lines.length > MAX_CART_LINES) {
    return NextResponse.json({ error: "too_many_lines" }, { status: 400 });
  }
  const lines: DraftLineInput[] = body.lines.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      menuItemId: typeof o.menuItemId === "string" ? o.menuItemId : null,
      packageId: typeof o.packageId === "string" ? o.packageId : null,
      sizeId: typeof o.sizeId === "string" ? o.sizeId : null,
      // Shape-only; resolveLines re-validates each pick against the package's real slot options (D20).
      packageOptions: Array.isArray(o.packageOptions)
        ? o.packageOptions.flatMap((raw) => {
            const p = (raw ?? {}) as Record<string, unknown>;
            if (typeof p.packageItemId !== "string") return [];
            return [{
              packageItemId: p.packageItemId,
              itemId: typeof p.itemId === "string" ? p.itemId : null,
              menuItemId: typeof p.menuItemId === "string" ? p.menuItemId : null,
              quantity: Number(p.quantity),
            }];
          })
        : undefined,
      portion: o.portion === "quarter" || o.portion === "half" || o.portion === "whole" ? o.portion : null,
      quantity: Number(o.quantity),
    };
  });

  try {
    const view = await setDraftLines(ctx.customerId, body.quoteId, lines, {
      isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : undefined,
      deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : (body.deliveryZoneId === null ? null : undefined),
      tipBps: Number.isFinite(body.tipBps) ? (body.tipBps as number) : undefined,
    });
    return NextResponse.json({ ok: true, stack: view.stack, isDelivery: view.isDelivery, deliveryZoneId: view.deliveryZoneId });
  } catch (e) {
    if (e instanceof PortalDraftError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
