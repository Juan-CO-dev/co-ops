/**
 * POST /api/portal/logout — end the customer's portal session (W23/B210).
 *
 * The portal session lasts 30 days and nothing let the customer end it. This route revokes the
 * session row (only when the cookie verifies AND its hash matches the stored row — a forged
 * cookie revokes nothing) and always clears the cookie, then sends the browser to /order/start
 * with a 303 (POST → GET). A missing or invalid cookie gets the same answer, so the route never
 * says whether a session existed. Same-origin first (A-H5): a cross-site POST is refused before
 * anything is read. No audit row: ending one's own session is a customer preference.
 */

import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { clearPortalCookie, revokeCustomerSession } from "@/lib/portal/session";
import { hashToken, PORTAL_COOKIE_NAME, verifyCustomerJwt } from "@/lib/portal/auth";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const raw = req.cookies.get(PORTAL_COOKIE_NAME)?.value ?? null;
  if (raw) {
    try {
      const claims = await verifyCustomerJwt(raw);
      const { data: row } = await getServiceRoleClient().from("catering_portal_sessions")
        .select("id, token_hash").eq("id", claims.session_id).maybeSingle<{ id: string; token_hash: string }>();
      if (row && row.token_hash === await hashToken(raw)) await revokeCustomerSession(row.id);
    } catch {
      // An invalid cookie, or a failed revoke, still clears the cookie below; the answer is the same.
    }
  }
  const res = NextResponse.redirect(new URL("/order/start", req.nextUrl.origin), 303);
  return clearPortalCookie(res);
}
