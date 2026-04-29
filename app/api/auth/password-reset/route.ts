/**
 * POST /api/auth/password-reset — consume a password_resets token, set new
 * password.
 *
 * Body: { token: 64-hex string, password: ≥ 8 chars }
 *
 * Token validation: same constant-shape pattern as /api/auth/verify.
 *   External response on any token failure:
 *     400 { error: "Invalid or expired token.", code: "invalid_token" }
 *   Internal audit distinguishes:
 *     auth_token_invalid           token_hash not found
 *     auth_token_expired           expires_at <= now()
 *     auth_token_consumed_replay   consumed_at != null
 *
 * On success:
 *   1. Atomic consumption: UPDATE … SET consumed_at = now() WHERE consumed_at IS NULL.
 *   2. UPDATE users SET password_hash, failed_login_count=0, locked_until=NULL.
 *      Reset clears any active lockout — the user proved control of the email,
 *      so a stale lockout shouldn't block them.
 *   3. Revoke ALL active sessions for this user (defense: assume the password
 *      was compromised; kill any active access).
 *   4. Audit auth_password_reset_success.
 *
 * Does NOT auto-sign-in. Implies "I forgot my password," user goes back to
 * the login screen with the new password.
 */

import { type NextRequest } from "next/server";

import { hashPassword, hashToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import type { RoleCode } from "@/lib/roles";

interface PasswordResetBody {
  token: string;
  password: string;
}

const HEX_TOKEN_RE = /^[0-9a-f]{64}$/i;
const MIN_PASSWORD_LENGTH = 8;

function isPasswordResetBody(raw: unknown): raw is PasswordResetBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.token === "string" && typeof r.password === "string";
}

function invalidTokenResponse() {
  return jsonError(400, "invalid_token", { message: "Invalid or expired token." });
}

export async function POST(req: NextRequest) {
  // 1. Parse + validate
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isPasswordResetBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include token and password",
    });
  }
  const { token, password } = parsed;
  if (!HEX_TOKEN_RE.test(token)) return invalidTokenResponse();
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(400, "invalid_payload", {
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }

  const ipAddress = extractIp(req);
  const userAgent = req.headers.get("user-agent");
  const tokenHash = await hashToken(token);
  const sb = getServiceRoleClient();

  // 2. Look up token row
  const { data: row } = await sb
    .from("password_resets")
    .select("id, user_id, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<{
      id: string;
      user_id: string;
      expires_at: string;
      consumed_at: string | null;
    }>();

  if (!row) {
    await audit({
      actorId: null,
      actorRole: null,
      action: "auth_token_invalid",
      resourceTable: "password_resets",
      resourceId: null,
      metadata: { context: "password_reset" },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }
  if (row.consumed_at) {
    await audit({
      actorId: row.user_id,
      actorRole: null,
      action: "auth_token_consumed_replay",
      resourceTable: "password_resets",
      resourceId: row.id,
      metadata: { context: "password_reset", consumed_at: row.consumed_at },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }
  const now = new Date();
  if (new Date(row.expires_at) <= now) {
    await audit({
      actorId: row.user_id,
      actorRole: null,
      action: "auth_token_expired",
      resourceTable: "password_resets",
      resourceId: row.id,
      metadata: { context: "password_reset", expires_at: row.expires_at },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }

  const nowIso = now.toISOString();

  // 3. Atomic consumption — wins-once
  const { data: consumed } = await sb
    .from("password_resets")
    .update({ consumed_at: nowIso })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (!consumed || consumed.length === 0) {
    await audit({
      actorId: row.user_id,
      actorRole: null,
      action: "auth_token_consumed_replay",
      resourceTable: "password_resets",
      resourceId: row.id,
      metadata: { context: "password_reset", note: "race_lost" },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }

  // 4. Update password + clear lockout state
  const passwordHash = await hashPassword(password);
  const { data: updatedUser, error: updateErr } = await sb
    .from("users")
    .update({
      password_hash: passwordHash,
      failed_login_count: 0,
      locked_until: null,
    })
    .eq("id", row.user_id)
    .select("id, role")
    .maybeSingle<{ id: string; role: RoleCode }>();
  if (updateErr || !updatedUser) {
    return jsonError(500, "internal_error", { message: "password update failed" });
  }

  // 5. Revoke all active sessions for this user (defense: assume compromise)
  const { data: revoked } = await sb
    .from("sessions")
    .update({ revoked_at: nowIso })
    .eq("user_id", row.user_id)
    .is("revoked_at", null)
    .select("id");
  const revokedCount = revoked?.length ?? 0;

  // 6. Audit
  await audit({
    actorId: updatedUser.id,
    actorRole: updatedUser.role,
    action: "auth_password_reset_success",
    resourceTable: "users",
    resourceId: updatedUser.id,
    metadata: { reset_id: row.id, sessions_revoked: revokedCount },
    ipAddress,
    userAgent,
  });

  return jsonOk({ ok: true });
}
