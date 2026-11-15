import { assertSameOrigin } from "@/lib/portal/csrf";
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
 * On success — ONE transaction (audit W07 B156 / B157; migration 0307's
 * `auth_password_reset_consume`), after the new password is hashed outside it:
 *   1. The link is re-checked under lock (consumed / expired / unknown).
 *   2. UPDATE users SET password_hash, failed_login_count=0, locked_until=NULL.
 *      Reset clears any active lockout — the user proved control of the email,
 *      so a stale lockout shouldn't block them.
 *   3. EVERY open reset link of this user is consumed — the one used and any
 *      other still outstanding (B157: a second link requested within the hour
 *      used to stay usable after this one).
 *   4. Revoke ALL active sessions for this user (defense: assume the password
 *      was compromised; kill any active access).
 *   Then audit auth_password_reset_success.
 *   A failure anywhere rolls the whole thing back: the link is NOT used up and
 *   the same email link works on the next try (B156: the link used to be
 *   consumed first and the password written by a separate request).
 *
 * Before migration 0307 is applied the function does not exist; the route then
 * runs the pre-0307 steps (consume, write, revoke as separate requests), so the
 * reset keeps working unchanged until the apply.
 *
 * Does NOT auto-sign-in. Implies "I forgot my password," user goes back to
 * the login screen with the new password.
 */

import { type NextRequest } from "next/server";

import { hashPassword, hashToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isMissingRpc, passwordResetConsumeCall } from "@/lib/auth-lockout-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { isRoleCode, type RoleCode } from "@/lib/roles";
import { revokeAllUserSessions } from "@/lib/session";

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
  const origin = assertSameOrigin(req);
  if (origin) return origin;
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

  // 3. Hash the new password BEFORE the transaction (bcrypt is slow), then run the whole reset as one
  // transaction: re-check the link under lock, write the hash, consume every open link, revoke sessions.
  const passwordHash = await hashPassword(password);
  const call = passwordResetConsumeCall({ tokenHash, passwordHash });
  const { data: done, error: consumeErr } = await sb.rpc(call.fn, call.args);

  if (consumeErr && isMissingRpc(consumeErr)) {
    // Migration 0307 is not applied yet: the pre-0307 steps, unchanged (and B156 / B157 stay open until the apply).
    console.warn("[auth/password-reset] auth_password_reset_consume is not installed (migration 0307 not applied): using the pre-0307 steps");
    return legacyReset(sb, row, passwordHash, now, ipAddress, userAgent);
  }

  if (consumeErr) {
    // The function's named refusals: the link changed between the pre-check above and the lock.
    if (consumeErr.message === "token_consumed") {
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
    if (consumeErr.message === "token_expired") {
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
    if (consumeErr.message === "token_invalid") {
      await audit({
        actorId: row.user_id,
        actorRole: null,
        action: "auth_token_invalid",
        resourceTable: "password_resets",
        resourceId: row.id,
        metadata: { context: "password_reset", note: "gone_under_lock" },
        ipAddress,
        userAgent,
      });
      return invalidTokenResponse();
    }
    // Anything else (a timeout, a failed write): the transaction rolled back, so the link is STILL USABLE and
    // the password is unchanged. The person retries with the same email link. Never log the token or the hash.
    console.error(`[auth/password-reset] reset failed and was rolled back (link still usable) for reset ${row.id}: ${consumeErr.code ?? "unknown"}`);
    return jsonError(500, "internal_error", { message: "password update failed" });
  }

  const result = (done ?? {}) as { role?: unknown; sessions_revoked?: unknown; other_links_retired?: unknown };
  await audit({
    actorId: row.user_id,
    actorRole: typeof result.role === "string" && isRoleCode(result.role) ? result.role : null,
    action: "auth_password_reset_success",
    resourceTable: "users",
    resourceId: row.user_id,
    metadata: {
      reset_id: row.id,
      sessions_revoked: typeof result.sessions_revoked === "number" ? result.sessions_revoked : 0,
      other_links_retired: typeof result.other_links_retired === "number" ? result.other_links_retired : 0,
    },
    ipAddress,
    userAgent,
  });

  return jsonOk({ ok: true });
}

/**
 * The pre-0307 reset: consume the link, then write the password, then revoke — three separate requests.
 * Runs ONLY while migration 0307's `auth_password_reset_consume` is not installed, so the route keeps working
 * before the apply. It is today's code, moved (the password is hashed by the caller now).
 */
async function legacyReset(
  sb: ReturnType<typeof getServiceRoleClient>,
  row: { id: string; user_id: string },
  passwordHash: string,
  now: Date,
  ipAddress: string | null,
  userAgent: string | null,
) {
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

  // 5. Revoke all active sessions for this user (defense: assume compromise).
  // LRA-216: the bare update here dropped its `error`, so a failed revocation was reported as 0 revoked
  // and the old sessions lived on. revokeAllUserSessions THROWS on a database error (→ 500, no false success).
  const { count: revokedCount } = await revokeAllUserSessions(row.user_id);

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
