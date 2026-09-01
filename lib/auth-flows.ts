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
import { verifyPin, hashPassword, isLegacyPasswordHash } from "./auth";
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
/**
 * Write `locked_until`, and PROVE it landed. Returns whether the lock is real.
 *
 * The lockout is a security control, not housekeeping. Before this was
 * rowcount-checked, the UPDATE's error was console.error'd and the flow carried
 * on to write an `auth_account_locked` audit row and return {locked:true} — so
 * the route answered 423 while `users.locked_until` stayed null, `isLocked()`
 * passed the very next attempt, and the audit trail asserted an enforcement
 * that never happened.
 *
 * Two guards, per AGENTS.md ("UPDATE denials are silent — check rowcount";
 * "never infer success from data"): check the error AND the rowcount, and retry
 * once, because a transient blip is exactly the failure mode here and rewriting
 * the same value is idempotent. Never throws — a lock that could not be written
 * must not also break the response the caller is composing; the caller records
 * the outcome in the audit metadata instead.
 */
async function persistLockout(
  sb: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  lockedUntilIso: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data, error } = await sb
      .from("users")
      .update({ locked_until: lockedUntilIso })
      .eq("id", userId)
      .select("id");
    if (!error && (data?.length ?? 0) > 0) return true;
    console.error(
      `[auth-flows] set locked_until failed for user ${userId} (try ${attempt}/2): ${
        error ? error.message : "0 rows updated"
      }`,
    );
  }
  return false;
}

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
  /** True when the counter RPC errored — the attempt was NOT counted (see below). */
  let counterError = false;
  /** The stored (un-advanced) counter read on the degraded path; null if unreadable. */
  let degradedStoredCount: number | null = null;
  /** `stored + 1` — the DECISION input on the degraded path. Never a written value. */
  let derivedCount: number | null = null;
  /** True only when locked_until is proven written (rowcount-checked). */
  let lockPersisted = false;

  if (userId) {
    const sb = getServiceRoleClient();

    if (COUNTABLE_FAILURE_REASONS.has(reason)) {
      // Read role for the audit row (best-effort; not part of the atomic path).
      const { data: cur } = await sb
        .from("users")
        .select("role")
        .eq("id", userId)
        .maybeSingle<{ role: RoleCode }>();
      userRole = cur?.role ?? null;

      // Atomic increment via RPC (BUG 1 fix). The prior read-modify-write was
      // non-atomic — concurrent failed attempts both read N and wrote N+1,
      // undercounting toward lockout. The RPC does a single UPDATE ... RETURNING
      // so the post-increment count is authoritative even under concurrency.
      // Audit-log-and-continue semantics (per lib/audit.ts philosophy): on RPC
      // error we log and proceed with the failure audit rather than throwing,
      // but we do NOT silently miss the error.
      const { data: rpcCount, error: rpcErr } = await sb.rpc("increment_failed_login", {
        p_user_id: userId,
      });
      if (rpcErr) {
        console.error(
          `[auth-flows] increment_failed_login failed for user ${userId}: ${rpcErr.message}`,
        );
        // ── DEGRADED LOCKOUT PATH (deferred finding 4, closed here) ──────────────
        //
        // The counter did NOT advance, and nothing in this branch pretends otherwise.
        // What changed: the LOCK DECISION is no longer abandoned along with the write.
        //
        // WHY A READ AND NOT A READ-MODIFY-WRITE. The RPC exists precisely because the
        // old caller-side `read N → write N+1` undercounted under concurrency, and the
        // audit's own caution is that a fallback "must stay atomic, so it belongs in the
        // RPC or beside it, not in a caller-side read-then-update branch". So this
        // fallback WRITES NOTHING to the counter. It reads the stored value and derives
        // `stored + 1` as the decision input only — a pure lower bound on how many
        // failures this account has actually seen, since a concurrent attempt can only
        // have pushed the true number higher. A lower bound can fail to lock; it can
        // never lock someone who should not be locked, which is the right direction for
        // an error to point on an auth surface.
        //
        // WHY NO NEW RPC WAS AUTHORED FOR THIS. An "atomic fallback for a broken atomic
        // RPC" is circular: if `sb.rpc(...)` is failing, a second RPC fails with it. The
        // durable fix for a persistently broken counter is repairing that function, not
        // minting a twin — and a migration that pretended otherwise would be ceremony.
        //
        // THE RESIDUAL, STATED. While the RPC is down the stored count is frozen, so a
        // fresh account can never climb to the limit and lockout is effectively off for
        // it. That is unchanged from before; what is new is that an account ALREADY at
        // or near the limit still locks, and that the condition is greppable in the trail
        // rather than console-only.
        counterError = true;
        const { data: stored } = await sb
          .from("users")
          .select("failed_login_count")
          .eq("id", userId)
          .maybeSingle<{ failed_login_count: number | null }>();
        const storedCount = typeof stored?.failed_login_count === "number" ? stored.failed_login_count : null;
        degradedStoredCount = storedCount;
        // `newCount` stays 0 so the audit row never CLAIMS a counted attempt number —
        // the derived value below is a separate, separately-labelled fact.
        newCount = 0;
        derivedCount = storedCount === null ? null : storedCount + 1;
      } else {
        newCount = typeof rpcCount === "number" ? rpcCount : 0;
      }

      // Derive the lock decision from the RPC's returned count — or, when the RPC
      // errored, from the read-only lower bound above. `derivedCount` is null only when
      // the counter could not be READ either, and then there is genuinely nothing to
      // decide from and the attempt stays non-threshold-crossing as before.
      const decisionCount = counterError ? (derivedCount ?? 0) : newCount;
      if (decisionCount >= FAILURE_LIMIT) {
        const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        lockedUntilIso = until.toISOString();
        lockedThisAttempt = true;
        lockPersisted = await persistLockout(sb, userId, lockedUntilIso);
      }

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
            // The row asserts the lock WAS enforced, so it must also carry
            // whether locked_until actually landed. Without this, a swallowed
            // write leaves an audit trail claiming a lockout that isLocked()
            // will not see on the attacker's very next attempt.
            lock_persisted: lockPersisted,
            ...(lockPersisted ? {} : { lock_persist_failed: true }),
            // A lock taken off the DEGRADED lower bound is still a real lock, but it was
            // decided from a counter that did not advance — so the row says which kind of
            // decision it was rather than leaving `failed_count: 0` to be read as a bug.
            ...(counterError
              ? {
                  outcome: "lockout_count_degraded",
                  stored_failed_login_count: degradedStoredCount,
                  decision_count: derivedCount,
                }
              : {}),
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
      ...(COUNTABLE_FAILURE_REASONS.has(reason) && userId
        ? counterError
          ? {
              // The attempt was NOT counted, and the row never claims a number that
              // would read as "first attempt" in the trail. It now also names the
              // OUTCOME, so a degraded night is one greppable query rather than an
              // inference from the absence of attempt_number — and it records the two
              // facts the lock decision was actually made from.
              counter_error: true,
              outcome: "lockout_count_degraded",
              stored_failed_login_count: degradedStoredCount,
              decision_count: derivedCount,
            }
          : { attempt_number: newCount }
        : {}),
      ...(lockedThisAttempt ? { triggered_lockout: true } : {}),
      ...(lockedThisAttempt && !lockPersisted ? { lock_persist_failed: true } : {}),
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

/**
 * Verifies a PIN against the given user's pin_hash. Used by /api/auth/pin-confirm
 * and the cash deposit signature gate. NO lockout — the actor is already
 * authenticated (mirrors the step-up modal philosophy, AGENTS.md).
 */
export async function verifyActorPin(userId: string, pin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false; // 4-digit PINs only
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users")
    .select("pin_hash")
    .eq("id", userId)
    .maybeSingle<{ pin_hash: string | null }>();
  if (error || !data?.pin_hash) return false;
  return verifyPin(pin, data.pin_hash);
}

// ─── Rehash-on-login (password scheme v2 migration, 2026-09-01) ─────────────────
//
// The pre-v2 password scheme let bcrypt's 72-byte cap truncate every password to its
// first 8 bytes (lib/auth.ts). The only moment a stored hash can be rewritten under
// the new scheme is a SUCCESSFUL verify, because that is the only time the plaintext
// exists. So: verify legacy once more → hash v2 → compare-and-set → audit. Lazy and
// per-account by nature — the migration finishes for an account the next time it
// logs in (or steps up), and the straggler accounts get an admin `setPassword`,
// which already hashes v2. Track progress with:
//   select count(*) from users where password_hash is not null
//     and password_hash not like 'hmac2$%';

/** The pure decision: upgrade ONLY a legacy hash, and ONLY after a successful verify.
 *  A failed login must never rewrite a credential; a v2 hash has nothing to migrate. */
export function shouldUpgradePasswordHash(
  storedHash: string | null | undefined,
  verified: boolean,
): boolean {
  return verified && isLegacyPasswordHash(storedHash);
}

export type PasswordHashUpgradeOutcome = "upgraded" | "not_legacy" | "raced" | "failed";

/**
 * Rewrite a just-verified LEGACY password hash under scheme v2.
 *
 *   - NEVER THROWS. A correct login must not become an error because housekeeping
 *     failed; a failed upgrade is logged + audited and simply retries next login.
 *   - COMPARE-AND-SET on the exact hash we verified (`.eq("password_hash", storedHash)`)
 *     + rowcount, per the silent-UPDATE law: a concurrent login that upgraded first, or
 *     an admin reset landing in between, makes this a 0-row `raced` no-op — never a
 *     clobber of a newer credential.
 *   - NO SESSION REVOKE. Same credential, same person; revoke is for credential CHANGES.
 *   - Audited as `auth_password_hash_upgraded` (non-destructive: a system act on a
 *     security-relevant field, not a human changing config) with the outcome, so the
 *     migration's progress is one greppable query.
 */
export async function upgradeLegacyPasswordHash(
  userId: string,
  plaintext: string,
  storedHash: string,
  actorRole: RoleCode | null,
  ctx: AuthAttemptContext,
  surface: "signin" | "step_up",
): Promise<{ outcome: PasswordHashUpgradeOutcome }> {
  if (!shouldUpgradePasswordHash(storedHash, true)) return { outcome: "not_legacy" };

  let outcome: PasswordHashUpgradeOutcome;
  let errMsg: string | null = null;
  try {
    const newHash = await hashPassword(plaintext);
    const sb = getServiceRoleClient();
    const { error, count } = await sb
      .from("users")
      .update({ password_hash: newHash }, { count: "exact" })
      .eq("id", userId)
      .eq("password_hash", storedHash);
    if (error) {
      outcome = "failed";
      errMsg = error.message;
    } else {
      outcome = (count ?? 0) > 0 ? "upgraded" : "raced";
    }
  } catch (e) {
    outcome = "failed";
    errMsg = e instanceof Error ? e.message : String(e);
  }
  if (outcome === "failed") {
    console.error(`[auth-flows] password hash upgrade failed for user ${userId} (${surface}): ${errMsg}`);
  }

  await audit({
    actorId: userId,
    actorRole,
    action: "auth_password_hash_upgraded",
    resourceTable: "users",
    resourceId: userId,
    metadata: { outcome, surface, scheme: "hmac2", ...(errMsg ? { error: errMsg } : {}) },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return { outcome };
}
