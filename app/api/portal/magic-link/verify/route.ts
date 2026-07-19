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
import { assertSameOrigin } from "@/lib/portal/csrf";
import { trustedClientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5 — closes login-CSRF (forced token consume)
  if (csrf) return csrf;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.token !== "string" || body.token.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ip = trustedClientIp(req); // A-M2 — platform-trusted, not the spoofable leftmost XFF
  // consumeMagicLink flips the token single-use BEFORE creating the account/session; a genuine
  // server error after the flip should still answer a clean constant-shape 400, not a 500.
  let result;
  try {
    result = await consumeMagicLink({ token: body.token, ip, ua: req.headers.get("user-agent") });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!result.ok || !result.session) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // A new-order link created a draft → land on the builder for THAT draft; a pure sign-in → account home.
  const next = result.quoteId ? `/order/build?draft=${result.quoteId}` : "/order/account";
  const res = NextResponse.json({ ok: true, next });
  return applyPortalCookie(res, result.session);
}
