import { assertSameOrigin } from "@/lib/portal/csrf";
/**
 * POST /api/auth/heartbeat — Phase 2 Session 4.
 *
 * Extends the active session by touching last_activity_at, called from the
 * IdleTimeoutWarning's "Stay signed in" button AND (audit W06/B013) as a
 * throttled keep-alive while the person is active with no other request. It
 * leaves an unlocked step-up flag as it stands (lib/session.ts isHeartbeatPath).
 * requireSession does the touch as a side effect of validation — so this route is just a thin protected
 * endpoint that returns 200 on a healthy session, 401 otherwise. A 200 means the touch LANDED: when the
 * last_activity_at UPDATE fails or matches no row it is a retryable 503 `session_unavailable` that keeps the
 * cookie (audit W06/B013 r3), so the client keeps the activity pending and retries.
 *
 * Protected (NOT in proxy PUBLIC_PATHS): the proxy validates JWT signature/exp
 * at the edge first; if that fails the user gets 307'd to / before the route
 * runs. The defensive requireSession() inside the handler does the full
 * dual-check (sessions row, token_hash, revoked, idle, deactivated user).
 *
 * Idempotent — clients may call it multiple times. Audit is intentionally
 * silent (no audit row per heartbeat) — every authenticated request already
 * touches last_activity_at; explicit heartbeats would be log noise.
 */

import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { jsonOk } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const auth = await requireSession(req, "/api/auth/heartbeat");
  if (auth instanceof Response) return auth;
  return jsonOk({ ok: true });
}
