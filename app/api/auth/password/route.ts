/**
 * POST /api/auth/password — email + password sign-in (level 5+ only).
 *
 * Body: { email: string, password: string }
 *
 * Flow (locked Phase 2 Session 3):
 *   1. Validate body shape (400 invalid_payload / invalid_json on bad input).
 *   2. Service-role lookup by lowercased email. Unknown email →
 *      audit + 401 invalid_credentials (no email enumeration).
 *   3. Role must allow email auth (level 5+). Otherwise → 401 invalid_credentials.
 *   4. Inactive user → 403 account_inactive.
 *   5. Email not yet verified → 403 email_not_verified.
 *   6. Locked → 423 account_locked with retry_after_seconds.
 *   7. Verify password. Wrong → recordFailedAttempt; if it crossed threshold,
 *      return 423; otherwise 401 invalid_credentials.
 *   8. Success → recordSuccessfulAuth, return 200 with session cookie.
 *
 * Disclosure policy (Juan-confirmed Phase 2 Session 3):
 *   - account_locked is told (admin gave the user the email, so existence is
 *     not a secret to them; UX > residual enumeration).
 *   - account_inactive and email_not_verified are also told — both signal a
 *     state the admin needs to resolve.
 */

import { type NextRequest } from "next/server";

import { verifyPassword } from "@/lib/auth";
import { isLocked, recordFailedAttempt, recordSuccessfulAuth } from "@/lib/auth-flows";
import { applySessionCookie } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { ROLES, type RoleCode } from "@/lib/roles";

interface PasswordSignInBody {
  email: string;
  password: string;
}

function isPasswordSignInBody(raw: unknown): raw is PasswordSignInBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.email === "string" && typeof r.password === "string";
}

export async function POST(req: NextRequest) {
  // 1. Parse + validate
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isPasswordSignInBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include email and password",
    });
  }
  const { email, password } = parsed;
  if (!email.includes("@") || email.length < 3) {
    return jsonError(400, "invalid_payload", {
      field: "email",
      message: "email must be a valid email address",
    });
  }
  if (password.length === 0) {
    return jsonError(400, "invalid_payload", {
      field: "password",
      message: "password must not be empty",
    });
  }

  const ctx = {
    ipAddress: extractIp(req),
    userAgent: req.headers.get("user-agent"),
  };
  const normalizedEmail = email.trim().toLowerCase();

  // 2. User lookup
  const sb = getServiceRoleClient();
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, role, active, password_hash, email_verified")
    .eq("email", normalizedEmail)
    .maybeSingle<{
      id: string;
      role: RoleCode;
      active: boolean;
      password_hash: string | null;
      email_verified: boolean;
    }>();
  if (userErr) {
    return jsonError(500, "internal_error", { message: "user lookup failed" });
  }
  if (!user) {
    await recordFailedAttempt(null, "password", "email_not_found", ctx, {
      requested_email: normalizedEmail,
    });
    return jsonError(401, "invalid_credentials");
  }

  // 3. Role gating — only level-5+ roles use email auth
  if (!ROLES[user.role].hasEmailAuth) {
    await recordFailedAttempt(user.id, "password", "role_not_email_auth", ctx);
    return jsonError(401, "invalid_credentials");
  }

  // 4. Inactive
  if (!user.active) {
    await recordFailedAttempt(user.id, "password", "account_inactive", ctx);
    return jsonError(403, "account_inactive");
  }

  // 5. Email not verified
  if (!user.email_verified) {
    await recordFailedAttempt(user.id, "password", "email_not_verified", ctx);
    return jsonError(403, "email_not_verified");
  }

  // 6. Locked
  const lockState = await isLocked(user.id);
  if (lockState.locked) {
    await recordFailedAttempt(user.id, "password", "account_locked_attempt", ctx);
    return jsonError(423, "account_locked", {
      retry_after_seconds: lockState.retryAfterSeconds,
    });
  }

  // 7. Verify password
  if (!user.password_hash) {
    // Defensive: a verified, active, level-5+ user without a password_hash
    // means they completed verify-and-set-password incompletely.
    await recordFailedAttempt(user.id, "password", "missing_password_hash", ctx);
    return jsonError(401, "invalid_credentials");
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const result = await recordFailedAttempt(user.id, "password", "wrong_password", ctx);
    if (result.locked) {
      const fresh = await isLocked(user.id);
      return jsonError(423, "account_locked", {
        retry_after_seconds: fresh.retryAfterSeconds,
      });
    }
    return jsonError(401, "invalid_credentials");
  }

  // 8. Success
  const session = await recordSuccessfulAuth(user.id, "password", ctx);
  return applySessionCookie(jsonOk({ ok: true, user_id: user.id }), session);
}
