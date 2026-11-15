/**
 * POST /api/auth/logout — best-effort, idempotent session termination.
 *
 * Public path (proxy.ts PUBLIC_PATHS). The route does its own cookie + JWT
 * read instead of going through requireSession, because logout must succeed
 * even when the session is invalid/revoked/idle — the user's intent is
 * "end my session", and we honor it unconditionally.
 *
 * REVOKE-ONLY: THIS ROUTE NEVER SETS A COOKIE (audit W06/B012 fix round 5).
 * A browser applies a Set-Cookie whenever the response ARRIVES, and the server
 * cannot know what the jar holds by then. Two tabs reaching the idle deadline
 * together each POST here; tab A's response lands, someone signs in, and tab
 * B's late response — which used to clear the cookie unconditionally — wiped
 * the NEW session's cookie. So the route ends the session its request carried
 * (revoked_at, idempotent) and leaves the cookie alone. A cookie for a revoked
 * session is already worthless: lib/session.ts dual verification denies it
 * (the next protected route answers 401 and clears it, a protected page
 * redirects to sign in), 0200 current_user_id() ignores it, and a new sign-in
 * overwrites it. No logout response can therefore clear a cookie minted after
 * its request was sent.
 *
 * The caller MAY name the session it means to end (`{ sessionId }`, JSON body;
 * the idle sign-out does). When the cookie's session is a different one — the
 * request went out after a new sign-in, e.g. from a background tab on its own
 * clock — nothing is revoked (outcome `session_superseded`). A missing or
 * unparseable body is "the session on the cookie" (the Log out buttons).
 *
 * NO CSRF ORIGIN GUARD, DELIBERATELY (P2-6 adjudication). Its siblings
 * /api/auth/pin and /api/auth/pin-confirm both took assertSameOrigin; this one
 * does not, and the asymmetry is the decision. Forced logout is a
 * nuisance-grade CSRF. A logout that can answer 403 is worse, because the
 * policy below is that the user's intent to kill their own cookie is honoured
 * UNCONDITIONALLY — a guard that misfires (a stripped Origin header, a
 * non-browser client) leaves an operator signed in on a shared 6 AM tablet,
 * which is a security problem of its own. tests/auth-pin-source-throttle.ts
 * pins this absence so it reads as a ruling, not an oversight. Revisit with a
 * decision, never by pattern-matching the siblings.
 *
 * Response policy (locked Phase 2 Session 3; revoke-only since W06 round 5):
 *   Always 200 { ok: true }, with NO Set-Cookie. The audit row captures the
 *   actual state (cookie missing, JWT invalid, session not found, a different
 *   session than the one named, already revoked, freshly revoked). Anomalies
 *   surface in audit metadata, not the HTTP response.
 *
 * Audit shapes:
 *   auth_logout                metadata.outcome = "revoked" (the happy path)
 *                                              | "already_revoked"
 *                                              | "session_not_found"
 *                                              | "session_superseded"
 *                                              | "jwt_invalid"
 *                                              | "no_cookie"
 */

import { type NextRequest } from "next/server";

import { verifyJwt } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SESSION_COOKIE_NAME, revokeSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonOk, extractIp } from "@/lib/api-helpers";
import type { RoleCode } from "@/lib/roles";

type LogoutOutcome =
  | "revoked"
  | "already_revoked"
  | "session_not_found"
  | "session_superseded"
  | "jwt_invalid"
  | "no_cookie";

export async function POST(req: NextRequest) {
  const ipAddress = extractIp(req);
  const userAgent = req.headers.get("user-agent");

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  let actorId: string | null = null;
  let actorRole: RoleCode | null = null;
  let sessionId: string | null = null;
  let outcome: LogoutOutcome = "no_cookie";

  if (rawJwt) {
    try {
      const claims = await verifyJwt(rawJwt);
      actorId = claims.user_id;
      actorRole = claims.app_role;
      sessionId = claims.session_id;
    } catch {
      outcome = "jwt_invalid";
    }
  }

  // The session the caller observed, when it names one (the idle sign-out). Anything else = the cookie's session.
  const named = await namedSessionId(req);

  if (sessionId && named !== null && named !== sessionId) {
    outcome = "session_superseded";
  } else if (sessionId) {
    const sb = getServiceRoleClient();
    const { data: row } = await sb
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle<{ id: string }>();
    if (!row) {
      outcome = "session_not_found";
    } else {
      const { rowsAffected } = await revokeSession(sessionId);
      outcome = rowsAffected > 0 ? "revoked" : "already_revoked";
    }
  }

  await audit({
    actorId,
    actorRole,
    action: "auth_logout",
    resourceTable: "sessions",
    resourceId: sessionId,
    metadata: { outcome },
    ipAddress,
    userAgent,
  });

  // Revoke-only: never a Set-Cookie (see the header). The revoked cookie is cleared by the next protected request.
  return jsonOk({ ok: true });
}

/** `{ sessionId: "<id>" }` from a JSON body, else null (no body, not JSON, or no string id). */
async function namedSessionId(req: NextRequest): Promise<string | null> {
  try {
    const body: unknown = JSON.parse(await req.text());
    if (body && typeof body === "object" && "sessionId" in body) {
      const id = (body as { sessionId: unknown }).sessionId;
      return typeof id === "string" && id.length > 0 ? id : null;
    }
  } catch {
    // Not JSON (or no body): the session on the cookie.
  }
  return null;
}
