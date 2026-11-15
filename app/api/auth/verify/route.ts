import { assertSameOrigin } from "@/lib/portal/csrf";
/**
 * POST /api/auth/verify — use an email_verifications link ("confirm your email"): set the password, mark the
 * email confirmed, and auto-sign-in.
 *
 * Body: { token: 64-hex string, password: ≥ 8 chars }
 *
 * Token validation (locked Phase 2 Session 3):
 *   External response is constant-shape on any token failure:
 *     400 { error: "Invalid or expired token.", code: "invalid_token" }
 *   Internal audit distinguishes for forensic value:
 *     auth_token_invalid           token_hash not found — or, with metadata.reason, the PERSON is no longer
 *                                  eligible (role_not_email_auth, email_changed, account_inactive)
 *     auth_token_expired           expires_at <= now()
 *     auth_token_consumed_replay   consumed_at != null
 *
 * ORDER, and why (audit W07, review round 1 — completes B053):
 *   1. Parse, look the link up, the early refusals above (each audited).
 *   2. HASH THE PASSWORD FIRST. bcrypt is slow; nothing may be consumed or written before it finishes.
 *   3. ONE transaction — migration 0307's `auth_email_confirm_consume`, under the per-person lock and the users row
 *      lock: re-check the link; re-check the person on the LOCKED row (still a manager role, still at the address
 *      the link was mailed to, active); write the password + email_verified; consume the link; revoke sessions.
 *      A refusal or a failure there writes NOTHING and leaves the link usable.
 *   4. Audit auth_email_verified, then auto-sign-in via recordSuccessfulAuth — a compare-and-set on the hash this
 *      request wrote AND the address the function confirmed.
 *
 *   This route used to consume the link, then hash, then write in a separate request: an email change or a
 *   demotion that landed while it hashed was overwritten (the replacement address marked confirmed, the person
 *   signed in), and a failed write burned the link. Those steps survive only as `legacyVerify`, which runs ONLY
 *   while 0307's function is not installed (PGRST202 / 42883) — and no link issued by 0307 can exist then.
 */

import { type NextRequest } from "next/server";

import { hashPassword, hashToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { recordFailedAttempt, recordSuccessfulAuth } from "@/lib/auth-flows";
import { emailConfirmConsumeCall, emailConfirmConsumeRefusal, isMissingRpc } from "@/lib/auth-lockout-shared";
import { applySessionCookie, CredentialChangedError, revokeAllUserSessions, type CreateSessionResult } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { ROLES, isRoleCode, type RoleCode } from "@/lib/roles";

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
  const origin = assertSameOrigin(req);
  if (origin) return origin;
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

  // 2b. The link is for MANAGER sign-in (audit W07 B053: links are issued only to a level-6+ person, by 0307's
  // auth_email_confirm_issue). If the person was moved out of a manager role after the email went out, the link
  // must not set a password or sign anyone in. Same constant answer; the link is left unconsumed. This is the
  // EARLY, friendly refusal on a snapshot — the decision that counts is made again under the lock in step 4.
  const { data: holder } = await sb
    .from("users")
    .select("role")
    .eq("id", row.user_id)
    .maybeSingle<{ role: string }>();
  if (!holder || !isRoleCode(holder.role) || !ROLES[holder.role].hasEmailAuth) {
    await audit({
      actorId: row.user_id,
      actorRole: null,
      action: "auth_token_invalid",
      resourceTable: "email_verifications",
      resourceId: row.id,
      metadata: { context: "verify", reason: "role_not_email_auth" },
      ipAddress,
      userAgent,
    });
    return invalidTokenResponse();
  }

  // 3. Hash FIRST. Nothing has been consumed or written yet, so whatever an admin changes while bcrypt runs is
  // still there to be seen by the one transaction below.
  const passwordHash = await hashPassword(password);

  // 4. The whole confirmation as ONE transaction: re-check the link and the person under the lock, write the
  // credential + the verification, consume the link, revoke sessions. Hashes only — never the token or the password.
  const call = emailConfirmConsumeCall({ tokenHash, passwordHash });
  const { data: done, error: consumeErr } = await sb.rpc(call.fn, call.args);

  if (consumeErr && isMissingRpc(consumeErr)) {
    // Migration 0307 is not applied yet: the pre-0307 steps (no link issued by 0307 can exist in that state).
    console.warn("[auth/verify] auth_email_confirm_consume is not installed (migration 0307 not applied): using the pre-0307 steps");
    return legacyVerify(sb, row, passwordHash, now, ipAddress, userAgent);
  }

  if (consumeErr) {
    // The function's named refusals: the link or the person changed between the reads above and the lock.
    // Every one of them wrote nothing and left the link as it was.
    const refusal = emailConfirmConsumeRefusal(consumeErr.message);
    if (refusal === "token_consumed") {
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
    if (refusal === "token_expired") {
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
    if (refusal) {
      // token_invalid (gone under the lock), or the PERSON is no longer eligible: demoted out of a manager role,
      // moved to another address, or deactivated — each decided on the locked row.
      await audit({
        actorId: row.user_id,
        actorRole: null,
        action: "auth_token_invalid",
        resourceTable: "email_verifications",
        resourceId: row.id,
        metadata: { context: "verify", reason: refusal === "token_invalid" ? "gone_under_lock" : refusal, rechecked: "under_lock" },
        ipAddress,
        userAgent,
      });
      // An inactive account keeps its own answer (the page explains it). Nothing was written, unlike before 0307.
      if (refusal === "account_inactive") return jsonError(403, "account_inactive");
      return invalidTokenResponse();
    }
    // Anything else (a timeout, a failed write): the transaction rolled back, so the link is STILL USABLE and
    // nothing changed. The person retries with the same email link. Never log the token or the hash.
    console.error(`[auth/verify] confirmation failed and was rolled back (link still usable) for verification ${row.id}: ${consumeErr.code ?? "unknown"}`);
    return jsonError(500, "internal_error", { message: "user update failed" });
  }

  const result = (done ?? {}) as { user_id?: unknown; role?: unknown; email?: unknown; sessions_revoked?: unknown };
  if (result.user_id !== row.user_id || typeof result.role !== "string" || !isRoleCode(result.role)) {
    // Not the answer 0307 returns. The confirmation may have committed; do not sign anyone in on an answer we cannot read.
    console.error(`[auth/verify] auth_email_confirm_consume returned an unexpected answer for verification ${row.id}`);
    return jsonError(500, "internal_error", { message: "user update failed" });
  }
  return finishVerified({
    userId: row.user_id,
    role: result.role,
    verificationId: row.id,
    sessionsRevoked: typeof result.sessions_revoked === "number" ? result.sessions_revoked : 0,
    passwordHash,
    // The address the function confirmed, on the locked row: the mint is refused if the account has left it since.
    loginEmail: typeof result.email === "string" && result.email !== "" ? result.email : undefined,
    ipAddress,
    userAgent,
  });
}

/**
 * The pre-0307 confirmation: consume the link, then write the password + email_verified, then revoke — three
 * separate requests. Runs ONLY while migration 0307's `auth_email_confirm_consume` is not installed, so the route
 * keeps working before the apply. It is the old code, moved (the password is hashed by the caller now, which is
 * the one thing that could be fixed without the function).
 */
async function legacyVerify(
  sb: ReturnType<typeof getServiceRoleClient>,
  row: { id: string; user_id: string },
  passwordHash: string,
  now: Date,
  ipAddress: string | null,
  userAgent: string | null,
) {
  // Atomic consumption (lock-first ordering: only the request that wins
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

  // Set password + email_verified
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
  // A first password is a credential change too: retire pre-activation PIN sessions.
  const { count: revokedCount } = await revokeAllUserSessions(row.user_id);
  if (!updatedUser.active) {
    // Defensive: don't auto-sign-in an inactive user even with a valid token.
    // Token was consumed; admin will need to re-invite if reactivated.
    await audit({
      actorId: updatedUser.id,
      actorRole: updatedUser.role,
      action: "auth_email_verified",
      resourceTable: "users",
      resourceId: updatedUser.id,
      metadata: { verification_id: row.id, sessions_revoked: revokedCount, sign_in_skipped_inactive: true },
      ipAddress,
      userAgent,
    });
    return jsonError(403, "account_inactive");
  }

  return finishVerified({
    userId: updatedUser.id,
    role: updatedUser.role,
    verificationId: row.id,
    sessionsRevoked: revokedCount,
    passwordHash,
    loginEmail: undefined,
    ipAddress,
    userAgent,
  });
}

/** The shared tail of both paths: the success audit, then the auto-sign-in on the credential this request wrote. */
async function finishVerified(a: {
  userId: string;
  role: RoleCode;
  verificationId: string;
  sessionsRevoked: number;
  passwordHash: string;
  loginEmail: string | undefined;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  await audit({
    actorId: a.userId,
    actorRole: a.role,
    action: "auth_email_verified",
    resourceTable: "users",
    resourceId: a.userId,
    metadata: { verification_id: a.verificationId, sessions_revoked: a.sessionsRevoked },
    ipAddress: a.ipAddress,
    userAgent: a.userAgent,
  });
  // The credential is the hash this request just wrote (audit W07 B051) and — on the 0307 path — the address the
  // function confirmed: if anything replaced either before the mint, no session is created. The confirmation
  // itself stands (the password is set, the email confirmed); the person signs in the ordinary way.
  const ctx = { ipAddress: a.ipAddress, userAgent: a.userAgent };
  let session: CreateSessionResult;
  try {
    session = await recordSuccessfulAuth(a.userId, "password", ctx, {
      kind: "password",
      hash: a.passwordHash,
      ...(a.loginEmail ? { loginEmail: a.loginEmail } : {}),
    });
  } catch (e) {
    if (!(e instanceof CredentialChangedError)) throw e;
    await recordFailedAttempt(a.userId, "password", "credential_changed", ctx);
    return jsonError(401, "invalid_credentials");
  }
  return applySessionCookie(jsonOk({ ok: true, user_id: a.userId }), session);
}
