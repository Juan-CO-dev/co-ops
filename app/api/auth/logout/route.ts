/**
 * POST /api/auth/logout — best-effort, idempotent session termination.
 *
 * Public path (proxy.ts PUBLIC_PATHS). The route does its own cookie + JWT
 * read instead of going through requireSession, because logout must succeed
 * even when the session is invalid/revoked/idle — the user's intent is
 * "kill my cookie", and we honor it unconditionally.
 *
 * Response policy (locked Phase 2 Session 3):
 *   Always 200 { ok: true } with the session cookie cleared. The audit row
 *   captures the actual state (cookie missing, JWT invalid, session not found,
 *   already revoked, freshly revoked). Anomalies surface in audit metadata,
 *   not the HTTP response.
 *
 * Audit shapes:
 *   auth_logout                metadata.outcome = "revoked" (the happy path)
 *                                              | "already_revoked"
 *                                              | "session_not_found"
 *                                              | "jwt_invalid"
 *                                              | "no_cookie"
 */

import { type NextRequest } from "next/server";

import { verifyJwt } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  revokeSession,
} from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonOk, extractIp } from "@/lib/api-helpers";
import type { RoleCode } from "@/lib/roles";

type LogoutOutcome =
  | "revoked"
  | "already_revoked"
  | "session_not_found"
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

  if (sessionId) {
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

  return clearSessionCookie(jsonOk({ ok: true }));
}
