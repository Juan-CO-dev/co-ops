/**
 * GET /api/portal/order/draft/[quoteId] — load the customer's OWNED draft (build + review data).
 *
 * Customer-authenticated. Returns loadDraft (the draft header + lines + stack + real menu + the
 * lead's intake fields + the napkins add-on), or 404 when the draft isn't owned / doesn't exist.
 * Next 16: `params` is a Promise.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { loadDraft } from "@/lib/portal/draft";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }): Promise<NextResponse> {
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const { quoteId } = await params;
  const draft = await loadDraft(ctx.customerId, quoteId);
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, draft });
}
