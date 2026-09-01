/**
 * POST /api/auth/pin — PIN sign-in (all roles).
 *
 * Body: { user_id: UUID, pin: 4-digit string }
 *
 * Flow (locked Phase 2 Session 3; steps 0 and 1b added by P2-6):
 *   0. assertSameOrigin — a cross-site POST is 403 bad_origin before anything.
 *   1. Validate body shape (400 invalid_payload / invalid_json on bad input).
 *   1b. Per-source throttle — 429 rate_limited with retry_after_seconds once a
 *      source IP exceeds its window budget. Ahead of the users lookup, so it
 *      is never an account-existence oracle.
 *   2. Service-role lookup of users row. Unknown user → audit + 401 invalid_credentials.
 *   3. Inactive user → audit + 403 account_inactive.
 *   4. Locked user → audit + 423 account_locked with retry_after_seconds.
 *   5. Verify PIN. Wrong → recordFailedAttempt; if it crossed threshold,
 *      return 423 with fresh retry_after; otherwise 401 invalid_credentials.
 *   6. Success → recordSuccessfulAuth (creates session, resets counters,
 *      sets last_login_at, audits). Return 200 with session cookie.
 *
 * Disclosure policy (Juan-confirmed Phase 2 Session 3):
 *   - account_locked is told (not merged into invalid_credentials). User_id
 *     is not secret (rendered client-side from a picker).
 *   - account_inactive is also told. If admin deactivates and the picker
 *     hasn't refreshed, this is a useful signal rather than a leak.
 *   - The two P2-6 refusals carry NO account information by construction:
 *     both are decided before the users row is read, so 403 bad_origin and
 *     429 rate_limited are identical for a real and an invented user_id.
 *
 * NON-BROWSER CALLERS. assertSameOrigin fails closed on a missing Origin, so
 * any script driving this route must send one — scripts/phase-2-audit-harness.ts
 * was updated in the same change.
 */

import { type NextRequest } from "next/server";

import { verifyPin } from "@/lib/auth";
import { isLocked, recordFailedAttempt, recordSuccessfulAuth } from "@/lib/auth-flows";
import { applySessionCookie } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import {
  PIN_SOURCE_MAX_ATTEMPTS,
  PIN_SOURCE_WINDOW_SECONDS,
  fixedWindowRetryAfterSeconds,
  pinSourceBucketKey,
} from "@/lib/auth-throttle";
import type { RoleCode } from "@/lib/roles";

interface PinSignInBody {
  user_id: string;
  pin: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE = /^\d{4}$/;

function isPinSignInBody(raw: unknown): raw is PinSignInBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.user_id === "string" && typeof r.pin === "string";
}

export async function POST(req: NextRequest) {
  // 0. CSRF (P2-6). Staff sign-in had no origin check, so any page on the
  // internet could POST a PIN guess from a visitor's browser — the staff twin
  // of the portal A-H5 gap this same guard was written to close. It fails
  // CLOSED on a missing Origin; browsers always send one on a POST. Cheapest
  // guard in the route and it touches no I/O, so it runs first: a cross-site
  // request must not be able to spend the shop's rate-limit budget.
  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;

  // 1. Parse + validate
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isPinSignInBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include user_id and pin",
    });
  }
  const { user_id, pin } = parsed;
  if (!UUID_RE.test(user_id)) {
    return jsonError(400, "invalid_payload", {
      field: "user_id",
      message: "user_id must be a UUID",
    });
  }
  if (!PIN_RE.test(pin)) {
    return jsonError(400, "invalid_payload", {
      field: "pin",
      message: "pin must be 4 digits",
    });
  }

  const ipAddress = extractIp(req);

  // 1b. Per-SOURCE throttle (P2-6). The per-account lockout below is per-TARGET,
  // and targets are free: /api/users/login-options is unauthenticated and hands
  // out real user ids. An attacker therefore rotates accounts and never trips a
  // lockout — ~7,680 guesses/day against a 10,000-PIN space from one machine.
  // This is the missing dimension, and it runs BEFORE the users lookup so a
  // throttled response cannot become an account-existence oracle.
  //
  // The budget is deliberately generous: a shop shares one egress IP, so this
  // is a per-LOCATION cap in practice (the objection recorded in
  // password-reset-request). checkAndRecord is fail-open, and a request with no
  // trusted source IP is not throttled at all rather than pooled into a shared
  // bucket — see lib/auth-throttle.ts for both rulings.
  const sourceBucket = pinSourceBucketKey(ipAddress);
  if (
    sourceBucket !== null &&
    !(await checkAndRecord(sourceBucket, PIN_SOURCE_WINDOW_SECONDS, PIN_SOURCE_MAX_ATTEMPTS))
  ) {
    // No audit row: the action vocabulary is closed (lib/audit-actions.ts) and
    // there is no name for this yet. Reusing auth_signin_pin_failure would
    // corrupt failed-sign-in forensics with events that never reached a
    // credential check. `auth_rate_limited` is filed as a follow-up.
    console.error("[auth/pin] source throttled", { bucket: sourceBucket });
    return jsonError(429, "rate_limited", {
      retry_after_seconds: fixedWindowRetryAfterSeconds(
        Date.now(),
        PIN_SOURCE_WINDOW_SECONDS,
      ),
    });
  }

  const ctx = {
    ipAddress,
    userAgent: req.headers.get("user-agent"),
  };

  // 2. User lookup
  const sb = getServiceRoleClient();
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, role, active, pin_hash")
    .eq("id", user_id)
    .maybeSingle<{
      id: string;
      role: RoleCode;
      active: boolean;
      pin_hash: string | null;
    }>();
  if (userErr) {
    return jsonError(500, "internal_error", { message: "user lookup failed" });
  }
  if (!user) {
    await recordFailedAttempt(null, "pin", "user_not_found", ctx, {
      requested_user_id: user_id,
    });
    return jsonError(401, "invalid_credentials");
  }

  // 3. Inactive
  if (!user.active) {
    await recordFailedAttempt(user.id, "pin", "account_inactive", ctx);
    return jsonError(403, "account_inactive");
  }

  // 4. Locked
  const lockState = await isLocked(user.id);
  if (lockState.locked) {
    await recordFailedAttempt(user.id, "pin", "account_locked_attempt", ctx);
    return jsonError(423, "account_locked", {
      retry_after_seconds: lockState.retryAfterSeconds,
    });
  }

  // 5. Verify PIN (defensive: pin_hash should always be set for active users).
  // Counts toward lockout (see lib/auth-flows.ts COUNTABLE_FAILURE_REASONS) —
  // if this attempt crossed the threshold, return 423 immediately so the user
  // doesn't see a misleading 401 on the threshold-crossing attempt.
  if (!user.pin_hash) {
    const result = await recordFailedAttempt(user.id, "pin", "missing_pin_hash", ctx);
    if (result.locked) {
      const fresh = await isLocked(user.id);
      return jsonError(423, "account_locked", {
        retry_after_seconds: fresh.retryAfterSeconds,
      });
    }
    return jsonError(401, "invalid_credentials");
  }
  const ok = await verifyPin(pin, user.pin_hash);
  if (!ok) {
    const result = await recordFailedAttempt(user.id, "pin", "wrong_pin", ctx);
    if (result.locked) {
      const fresh = await isLocked(user.id);
      return jsonError(423, "account_locked", {
        retry_after_seconds: fresh.retryAfterSeconds,
      });
    }
    return jsonError(401, "invalid_credentials");
  }

  // 6. Success
  const session = await recordSuccessfulAuth(user.id, "pin", ctx);
  return applySessionCookie(jsonOk({ ok: true, user_id: user.id }), session);
}
