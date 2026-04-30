/**
 * Auth flow helpers — Phase 2 Session 3.
 *
 * Single source of truth for credential failure / lockout / success audit
 * logic, shared by /api/auth/pin and /api/auth/password.
 *
 * Lockout policy (locked Phase 2 Session 1, not configurable):
 *   - 5 failed credential attempts → 15-minute lockout
 *   - Successful auth resets the failure counter and clears locked_until
 *   - Lock is time-bound: locked_until > now() means refuse, regardless of
 *     credential correctness — checked at the route layer before verifyPin /
 *     verifyPassword runs.
 *
 * Audit vocabulary (locked Phase 2 Session 3):
 *   - auth_signin_<method>_success     happy path (resourceTable=sessions)
 *   - auth_signin_<method>_failure     credential or precondition failure
 *                                      (with metadata.reason; resourceTable=users)
 *   - auth_account_locked              fired exactly once when this attempt
 *                                      crossed the threshold
 *
 * Service-role-only. RLS denies user-direct writes to users.failed_login_count
 * / locked_until / last_login_at; the failure-count update path bypasses RLS.
 */

import { audit } from "./audit";
import { createSession, type AuthMethod, type CreateSessionResult } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import type { RoleCode } from "./roles";

const FAILURE_LIMIT = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Reasons that count toward the failure threshold.
 *
 * `wrong_pin` / `wrong_password` are the obvious cases. `missing_pin_hash` /
 * `missing_password_hash` are the defensive-guard branches in /api/auth/{pin,
 * password} that fire when the user's hash field is null/empty (e.g., a seed
 * user bootstrapped before verify, an admin-cleared credential, mid-reset
 * state). From the attacker's perspective those return the same 401
 * invalid_credentials as a wrong credential, so they MUST rate-limit
 * identically — otherwise an attacker can spam an account in this unusual
 * no-hash state without ever tripping lockout.
 *
 * The audit row still distinguishes the reason for forensic purposes.
 *
 * Reasons NOT in this set (intentional): `user_not_found`, `email_not_found`,
 * `account_inactive`, `email_not_verified`, `account_locked_attempt`,
 * `role_not_email_auth`. Those either have no userId (no row to lock) or
 * represent state the admin needs to resolve, not credential brute-force.
 */
const COUNTABLE_FAILURE_REASONS = new Set<string>([
  "wrong_pin",
  "wrong_password",
  "missing_pin_hash",
  "missing_password_hash",
]);

export interface AuthAttemptContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LockoutState {
  locked: boolean;
  /** Seconds until the lock expires. 0 when not locked. */
  retryAfterSeconds: number;
}

/**
 * Read the user's lockout state. Pure read — does not modify anything.
 *
 * Returns {locked: false, retryAfterSeconds: 0} when the user is not locked
 * (or doesn't exist — caller decides how to handle missing user separately).
 */
export async function isLocked(userId: string): Promise<LockoutState> {
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("users")
    .select("locked_until")
    .eq("id", userId)
    .maybeSingle<{ locked_until: string | null }>();
  if (!data || !data.locked_until) return { locked: false, retryAfterSeconds: 0 };
  const lockedUntil = new Date(data.locked_until);
  const now = new Date();
  if (lockedUntil <= now) return { locked: false, retryAfterSeconds: 0 };
  return {
    locked: true,
    retryAfterSeconds: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000),
  };
}

/**
 * Record a failed auth attempt.
 *
 *   userId == null   Unknown user / email — audit only, return {locked:false}.
 *                    Caller MUST supply a forensic identifier in extraMetadata
 *                    (requested_user_id for PIN, requested_email for password)
 *                    so spray attacks remain traceable without a verified user.
 *   userId != null   Audit; if reason is countable (wrong_pin/wrong_password),
 *                    increment failed_login_count; if threshold crossed, set
 *                    locked_until and write a separate auth_account_locked row.
 *
 * Returns {locked: true} only when *this* attempt crossed the threshold (so
 * the route can return 423 immediately rather than 401).
 */
export async function recordFailedAttempt(
  userId: string | null,
  method: AuthMethod,
  reason: string,
  ctx: AuthAttemptContext,
  extraMetadata?: Record<string, unknown>,
): Promise<{ locked: boolean }> {
  let lockedThisAttempt = false;
  let lockedUntilIso: string | null = null;
  let userRole: RoleCode | null = null;
  let newCount = 0;

  if (userId) {
    const sb = getServiceRoleClient();

    if (COUNTABLE_FAILURE_REASONS.has(reason)) {
      const { data: cur } = await sb
        .from("users")
        .select("failed_login_count, role")
        .eq("id", userId)
        .maybeSingle<{ failed_login_count: number | null; role: RoleCode }>();
      const currentCount = cur?.failed_login_count ?? 0;
      userRole = cur?.role ?? null;
      newCount = currentCount + 1;

      const update: Record<string, unknown> = { failed_login_count: newCount };
      if (newCount >= FAILURE_LIMIT) {
        const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        lockedUntilIso = until.toISOString();
        update.locked_until = lockedUntilIso;
        lockedThisAttempt = true;
      }
      await sb.from("users").update(update).eq("id", userId);

      if (lockedThisAttempt) {
        await audit({
          actorId: userId,
          actorRole: userRole,
          action: "auth_account_locked",
          resourceTable: "users",
          resourceId: userId,
          metadata: {
            failed_count: newCount,
            lockout_minutes: LOCKOUT_MINUTES,
            locked_until: lockedUntilIso,
            method,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
      }
    } else {
      // Best-effort role read for the audit row even without counter increment.
      const { data: cur } = await sb
        .from("users")
        .select("role")
        .eq("id", userId)
        .maybeSingle<{ role: RoleCode }>();
      userRole = cur?.role ?? null;
    }
  }

  await audit({
    actorId: userId,
    actorRole: userRole,
    action: `auth_signin_${method}_failure`,
    resourceTable: "users",
    resourceId: userId,
    metadata: {
      reason,
      ...(COUNTABLE_FAILURE_REASONS.has(reason) && userId ? { attempt_number: newCount } : {}),
      ...(lockedThisAttempt ? { triggered_lockout: true } : {}),
      ...(extraMetadata ?? {}),
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { locked: lockedThisAttempt };
}

/**
 * Mark a successful auth.
 *
 *   1. Mint the session (createSession; signs JWT, inserts sessions row).
 *   2. Reset failed_login_count → 0, clear locked_until, set last_login_at.
 *   3. Write auth_signin_<method>_success audit row.
 *
 * Caller must have already verified user is active and not locked. The session
 * mint goes first so a downstream failure doesn't leave us with reset counters
 * but no session (which would silently let the user retry indefinitely).
 *
 * Used by /api/auth/pin, /api/auth/password, and /api/auth/verify
 * (auto-sign-in after email verification + password set).
 */
export async function recordSuccessfulAuth(
  userId: string,
  method: AuthMethod,
  ctx: AuthAttemptContext,
): Promise<CreateSessionResult> {
  const session = await createSession(userId, method, {
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  const sb = getServiceRoleClient();
  const { data: roleRow } = await sb
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: RoleCode }>();

  await sb
    .from("users")
    .update({
      failed_login_count: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq("id", userId);

  await audit({
    actorId: userId,
    actorRole: roleRow?.role ?? null,
    action: `auth_signin_${method}_success`,
    resourceTable: "sessions",
    resourceId: session.sessionId,
    metadata: { method },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return session;
}
