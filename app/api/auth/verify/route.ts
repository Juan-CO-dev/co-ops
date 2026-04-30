/**
 * POST /api/auth/verify — consume an email_verification token, set password,
 * verify email, and auto-sign-in.
 *
 * Body: { token: 64-hex string, password: ≥ 8 chars }
 *
 * Token validation (locked Phase 2 Session 3):
 *   External response is constant-shape on any token failure:
 *     400 { error: "Invalid or expired token.", code: "invalid_token" }
 *   Internal audit distinguishes for forensic value:
 *     auth_token_invalid           token_hash not found
 *     auth_token_expired           expires_at <= now()
 *     auth_token_consumed_replay   consumed_at != null
 *
 * On success:
 *   1. Atomic consumption: UPDATE … SET consumed_at = now() WHERE consumed_at IS NULL
 *      — wins-once. The race-loser audits as auth_token_consumed_replay.
 *   2. UPDATE users SET password_hash, email_verified=true, email_verified_at.
 *   3. Audit auth_email_verified.
 *   4. Auto-sign-in via recordSuccessfulAuth(userId, 'password', ctx) — that
 *      writes auth_signin_password_success and returns the cookie config.
 */

import { type NextRequest } from "next/server";

import { hashPassword, hashToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { recordSuccessfulAuth } from "@/lib/auth-flows";
import { applySessionCookie } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import type { RoleCode } from "@/lib/roles";

interface VerifyBody {
  token: string;
  password: string;
}

const HEX_TOKEN_RE = /^[0-9a-f]{64}$/i;
const MIN_PASSWORD_LENGTH = 8;

function isVerifyBody(raw: unknown): raw is VerifyBody {
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
  if (!isVerifyBody(parsed)) {
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

  // 2. Look up token row
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("email_verifications")
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
      resourceTable: "email_verifications",
      resourceId: null,
      metadata: { context: "verify" },
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
      resourceTable: "email_verifications",
      resourceId: row.id,
      metadata: { context: "verify", consumed_at: row.consumed_at },
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
      resourceTable: "email_verifications",
      resourceId: row.id,
      metadata: { context: "verify", expires_at: row.expires_at },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }

  // 3. Atomic consumption (lock-first ordering: only the request that wins
  // the .is(consumed_at, null) race proceeds to set the password)
  const nowIso = now.toISOString();
  const { data: consumed } = await sb
    .from("email_verifications")
    .update({ consumed_at: nowIso })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (!consumed || consumed.length === 0) {
    await audit({
      actorId: row.user_id,
      actorRole: null,
      action: "auth_token_consumed_replay",
      resourceTable: "email_verifications",
      resourceId: row.id,
      metadata: { context: "verify", note: "race_lost" },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }

  // 4. Set password + email_verified
  const passwordHash = await hashPassword(password);
  const { data: updatedUser, error: updateUserErr } = await sb
    .from("users")
    .update({
      password_hash: passwordHash,
      email_verified: true,
      email_verified_at: nowIso,
    })
    .eq("id", row.user_id)
    .select("id, role, active")
    .maybeSingle<{ id: string; role: RoleCode; active: boolean }>();
  if (updateUserErr || !updatedUser) {
    return jsonError(500, "internal_error", { message: "user update failed" });
  }
  if (!updatedUser.active) {
    // Defensive: don't auto-sign-in an inactive user even with a valid token.
    // Token was consumed; admin will need to re-invite if reactivated.
    await audit({
      actorId: updatedUser.id,
      actorRole: updatedUser.role,
      action: "auth_email_verified",
      resourceTable: "users",
      resourceId: updatedUser.id,
      metadata: { verification_id: row.id, sign_in_skipped_inactive: true },
      ipAddress,
      userAgent,
    });
    return jsonError(403, "account_inactive");
  }

  // 5. Audit + auto-sign-in
  await audit({
    actorId: updatedUser.id,
    actorRole: updatedUser.role,
    action: "auth_email_verified",
    resourceTable: "users",
    resourceId: updatedUser.id,
    metadata: { verification_id: row.id },
    ipAddress,
    userAgent,
  });
  const session = await recordSuccessfulAuth(updatedUser.id, "password", {
    ipAddress,
    userAgent,
  });
  return applySessionCookie(jsonOk({ ok: true, user_id: updatedUser.id }), session);
}
