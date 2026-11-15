/**
 * POST /api/auth/logout — best-effort, idempotent session termination.
 *
 * Public path (proxy.ts PUBLIC_PATHS). The route does its own cookie + JWT
 * read instead of going through requireSession, because logout must succeed
 * even when the session is invalid/revoked/idle — the user's intent is
 * "end my session", and we honor it unconditionally.
 *
 * REVOKE-ONLY WHEN CONFIRMED (audit W06/B012 fix rounds 5 + 6).
 * A browser applies a Set-Cookie whenever the response ARRIVES, and the server
 * cannot know what the jar holds by then. Two tabs reaching the idle deadline
 * together each POST here; tab A's response lands, someone signs in, and tab
 * B's late response — which used to clear the cookie unconditionally — wiped
 * the NEW session's cookie. So a logout that CONFIRMS the session has ended
 * (revoked_at, idempotent) leaves the cookie alone. A cookie for a revoked
 * session is already worthless: lib/session.ts dual verification denies it
 * (the next protected route answers 401 and clears it, a protected page
 * redirects to sign in), 0200 current_user_id() ignores it, and a new sign-in
 * overwrites it.
 *
 * FAIL CLOSED WHEN UNCONFIRMED (round 6, CC ruling). If the server cannot
 * confirm the end — the sessions read errors, the revoke UPDATE errors, or the
 * UPDATE matches no row on a session the read said was live and a second read
 * cannot show it revoked — the session may still be live, and a revoke-only
 * 200 would leave both the cookie and the session usable on a shared tablet
 * once the database recovers. That answers 503 `logout_unconfirmed` WITH a
 * cookie-clearing Set-Cookie: clearing is the safe side there (the late-clear
 * race above is the lesser harm), and the orphaned session, which no browser
 * can present any more, ends at the server's idle limit. The callers retry a
 * non-2xx briefly and still go to the login page (lib/logout-client.ts).
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
 * Response policy (locked Phase 2 Session 3; W06 rounds 5 + 6):
 *   200 { ok: true }, with NO Set-Cookie, whenever the end is confirmed or
 *   there is nothing to end (cookie missing, JWT invalid, session not found,
 *   a different session than the one named, already revoked, freshly
 *   revoked). 503 { code: "logout_unconfirmed", sessionId } WITH a cleared
 *   cookie when it is not. The audit row captures the actual state.
 *
 * Audit shapes:
 *   auth_logout                metadata.outcome = "revoked" (the happy path)
 *                                              | "already_revoked"
 *                                              | "session_not_found"
 *                                              | "session_superseded"
 *                                              | "jwt_invalid"
 *                                              | "no_cookie"
 *                                              | "unconfirmed" (+ metadata.reason =
 *                                                "session_read_failed" | "revoke_failed"
 *                                                | "revoke_not_applied" | "confirm_read_failed")
 */

import { type NextRequest } from "next/server";

import { verifyJwt } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SESSION_COOKIE_NAME, clearSessionCookie, revokeSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, extractIp } from "@/lib/api-helpers";
import type { RoleCode } from "@/lib/roles";

type LogoutOutcome =
  | "revoked"
  | "already_revoked"
  | "session_not_found"
  | "session_superseded"
  | "jwt_invalid"
  | "no_cookie"
  | "unconfirmed";

/** Why the end of a session could not be confirmed (audit metadata.reason). */
type UnconfirmedReason = "session_read_failed" | "revoke_failed" | "revoke_not_applied" | "confirm_read_failed";

type EndResult =
  | { outcome: "revoked" | "already_revoked" | "session_not_found" }
  | { outcome: "unconfirmed"; reason: UnconfirmedReason };

export async function POST(req: NextRequest) {
  const ipAddress = extractIp(req);
  const userAgent = req.headers.get("user-agent");

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  let actorId: string | null = null;
  let actorRole: RoleCode | null = null;
  let sessionId: string | null = null;
  let outcome: LogoutOutcome = "no_cookie";
  let reason: UnconfirmedReason | null = null;

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
    const ended = await endSession(sessionId);
    outcome = ended.outcome;
    if (ended.outcome === "unconfirmed") reason = ended.reason;
  }

  await audit({
    actorId,
    actorRole,
    action: "auth_logout",
    resourceTable: "sessions",
    resourceId: sessionId,
    metadata: reason ? { outcome, reason } : { outcome },
    ipAddress,
    userAgent,
  });

  if (outcome === "unconfirmed") {
    // Fail closed (round 6): the session may still be live, so this browser must stop carrying it. The 503 tells the
    // caller to retry; it names the session so a retry cannot end a newer one.
    return clearSessionCookie(
      jsonError(503, "logout_unconfirmed", { message: "Sign-out could not be confirmed", sessionId }),
    );
  }
  // Confirmed: never a Set-Cookie (see the header). The revoked cookie is cleared by the next protected request.
  return jsonOk({ ok: true });
}

/** The session's state from a SUCCESSFUL read, or "error" when the read failed — a failure is never "not found". */
async function readSessionState(sessionId: string): Promise<"absent" | "revoked" | "live" | "error"> {
  try {
    const { data, error } = await getServiceRoleClient()
      .from("sessions")
      .select("id, revoked_at")
      .eq("id", sessionId)
      .maybeSingle<{ id: string; revoked_at: string | null }>();
    if (error) return "error";
    if (!data) return "absent";
    return data.revoked_at ? "revoked" : "live";
  } catch {
    return "error";
  }
}

/** End the session, or say why its end is unconfirmed. Only a successful read or write confirms anything. */
async function endSession(sessionId: string): Promise<EndResult> {
  const before = await readSessionState(sessionId);
  if (before === "error") return { outcome: "unconfirmed", reason: "session_read_failed" };
  if (before === "absent") return { outcome: "session_not_found" };
  if (before === "revoked") return { outcome: "already_revoked" };

  let rowsAffected: number;
  try {
    ({ rowsAffected } = await revokeSession(sessionId));
  } catch {
    return { outcome: "unconfirmed", reason: "revoke_failed" };
  }
  if (rowsAffected > 0) return { outcome: "revoked" };

  // The read said live but the UPDATE matched nothing: a concurrent logout may have ended it first. Only a second
  // successful read that shows it revoked (or gone) confirms that.
  const after = await readSessionState(sessionId);
  if (after === "error") return { outcome: "unconfirmed", reason: "confirm_read_failed" };
  if (after === "absent") return { outcome: "session_not_found" };
  if (after === "revoked") return { outcome: "already_revoked" };
  return { outcome: "unconfirmed", reason: "revoke_not_applied" };
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
