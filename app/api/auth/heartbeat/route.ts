/**
 * POST /api/auth/heartbeat — Phase 2 Session 4.
 *
 * Extends the active session by touching last_activity_at, called from the
 * IdleTimeoutWarning's "Stay signed in" button. requireSession does the touch
 * as a side effect of validation — so this route is just a thin protected
 * endpoint that returns 200 on a healthy session, 401 otherwise.
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
  const auth = await requireSession(req, "/api/auth/heartbeat");
  if (auth instanceof Response) return auth;
  return jsonOk({ ok: true });
}
