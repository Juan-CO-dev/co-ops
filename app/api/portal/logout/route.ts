/**
 * POST /api/portal/logout — end the customer's portal session (W23/B210).
 *
 * The portal session lasts 30 days and nothing let the customer end it. This route revokes the
 * session row (only when the cookie verifies AND its hash matches the stored row — a forged
 * cookie revokes nothing), clears the cookie, then sends the browser to /order/start with a 303
 * (POST → GET). A missing or invalid cookie, an unknown session or one already revoked gets the
 * same answer, so the route never says whether a session existed. Same-origin first (A-H5): a
 * cross-site POST is refused before anything is read. No audit row: ending one's own session is a
 * customer preference.
 *
 * Review r1 (BC-032/BC-033): a DATABASE failure (the session lookup or the revoke) is not a
 * sign-out. Clearing the cookie then would leave the server-side session live for the rest of its
 * life with no way to retry, while telling the customer they were signed out. So the cookie is
 * KEPT — it is the retry's only handle on the session — and the browser goes back to
 * /order/account?signout=failed, which says the sign-out did not go through and offers it again.
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
    let sessionId: string | null = null;
    try {
      sessionId = (await verifyCustomerJwt(raw)).session_id;
    } catch {
      // An invalid or expired cookie names no live session: nothing to revoke, just clear it.
    }
    if (sessionId) {
      try {
        const { data: row, error } = await getServiceRoleClient().from("catering_portal_sessions")
          .select("id, token_hash").eq("id", sessionId).maybeSingle<{ id: string; token_hash: string }>();
        if (error) throw new Error(`session lookup: ${error.message}`);
        if (row && row.token_hash === await hashToken(raw)) await revokeCustomerSession(row.id);
      } catch (e) {
        console.error("portal_logout_revoke_failed", e instanceof Error ? e.message : String(e));
        return NextResponse.redirect(new URL("/order/account?signout=failed", req.nextUrl.origin), 303);
      }
    }
  }
  const res = NextResponse.redirect(new URL("/order/start", req.nextUrl.origin), 303);
  return clearPortalCookie(res);
}
