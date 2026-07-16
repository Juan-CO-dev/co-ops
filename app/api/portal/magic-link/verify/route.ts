/**
 * POST /api/portal/magic-link/verify — consume a magic-link token, sign the customer in.
 *
 * PUBLIC. Called by the /order/verify landing page (client POSTs the token on mount, so an
 * email-scanner prefetch — which doesn't run JS — won't consume the token). On success, sets
 * the httpOnly co_ops_portal session cookie and returns the next path. Single-use + expiry are
 * enforced atomically in lib/portal/magic-link.ts consumeMagicLink.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/portal/magic-link";
import { applyPortalCookie } from "@/lib/portal/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.token !== "string" || body.token.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  const result = await consumeMagicLink({ token: body.token, ip, ua: req.headers.get("user-agent") });
  if (!result.ok || !result.session) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, next: "/order/build" });
  return applyPortalCookie(res, result.session);
}
