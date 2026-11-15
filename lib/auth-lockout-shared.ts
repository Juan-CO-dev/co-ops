/**
 * Sign-in lockout — the PURE half (zero I/O; no runtime import, so scripts/sql-harness-0307.mjs imports it
 * with plain node). The limits here are the twins of the SQL literals in migration 0307
 * (`auth_reserve_attempt`), pinned equal by tests/auth-lockout-reset-migration.test.ts.
 *
 * Audit wave W07 (B049 / B050): the lock used to be decided AFTER the credential check, from a counter
 * that only ever went up. 0307's `auth_reserve_attempt` decides and counts in one row lock BEFORE the
 * check, and restarts the count when a lock has run out.
 */

/** Wrong answers before the account locks (locked Phase 2 Session 1). SQL twin: `v_count >= 5`. */
export const FAILURE_LIMIT = 5;
/** How long a lock lasts. SQL twin: `interval '15 minutes'`. */
export const LOCKOUT_MINUTES = 15;

/**
 * Wrong password / PIN RE-CHECKS in a row on one signed-in session before that session is signed out (audit W07
 * B159; owner decisions W07-3 a / W07-4 a). The account is never locked by a re-check. SQL twin: `reauth_failed_count < 5`.
 */
export const REAUTH_LIMIT = 5;

/** `session_reauth_reserve` / `session_reauth_clear` arguments (0307), by name. */
export const sessionReauthReserveCall = (sessionId: string) => ({ fn: "session_reauth_reserve", args: { p_session: sessionId } }) as const;
export const sessionReauthClearCall = (sessionId: string) => ({ fn: "session_reauth_clear", args: { p_session: sessionId } }) as const;

export interface ReauthReservation {
  /** false = this session is out of re-check attempts and has been revoked; the credential must NOT be checked. */
  allowed: boolean;
  /** This re-check's number in the current run (1..REAUTH_LIMIT). null when refused or degraded. */
  attempt: number | null;
  /** true = 0307's function was missing or failed: the re-check proceeds uncounted, as it did before 0307. */
  degraded: boolean;
}

/** `session_reauth_reserve`'s jsonb → the lib's shape, or null when it is not what 0307 returns. */
export function parseReauthReservation(data: unknown): ReauthReservation | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  if (r.allowed === false) return { allowed: false, attempt: null, degraded: false };
  if (r.allowed !== true || typeof r.attempt !== "number" || !Number.isInteger(r.attempt) || r.attempt < 1) return null;
  return { allowed: true, attempt: r.attempt, degraded: false };
}

/** A wrong answer on this reservation was the last one allowed: the caller signs the session out. */
export function reauthExhausted(r: ReauthReservation): boolean {
  return !r.degraded && r.allowed && r.attempt !== null && r.attempt >= REAUTH_LIMIT;
}

/** The exact argument object the lib sends (the harness calls the function with the same names). */
export const reserveAttemptCall = (userId: string) => ({ fn: "auth_reserve_attempt", args: { p_user: userId } }) as const;

/** The credential a sign-in just verified: the session is minted only while it is still the stored one (B051). */
export interface VerifiedCredential {
  kind: "pin" | "password";
  /** The exact stored hash the route read and verified against. Never a plaintext. */
  hash: string;
  /** Password sign-in only: the lowercased email the account was looked up by. */
  loginEmail?: string;
}

/** `auth_create_session`'s arguments (0307), by name. */
export const createSessionCall = (a: {
  sessionId: string; userId: string; authMethod: "pin" | "password"; credential: VerifiedCredential;
  tokenHash: string; expiresAt: string; ipAddress: string | null; userAgent: string | null;
}) => ({
  fn: "auth_create_session",
  args: {
    p_session_id: a.sessionId, p_user: a.userId, p_auth_method: a.authMethod, p_credential_kind: a.credential.kind,
    p_verified_hash: a.credential.hash, p_login_email: a.credential.loginEmail ?? null, p_token_hash: a.tokenHash,
    p_expires_at: a.expiresAt, p_ip: a.ipAddress, p_user_agent: a.userAgent,
  },
}) as const;

/** `auth_password_reset_consume`'s arguments (0307), by name: both are HASHES, never a token or a password. */
export const passwordResetConsumeCall = (a: { tokenHash: string; passwordHash: string }) =>
  ({ fn: "auth_password_reset_consume", args: { p_token_hash: a.tokenHash, p_password_hash: a.passwordHash } }) as const;

/** `auth_email_confirm_issue`'s arguments (0307, B053), by name. The token travels as its SHA-256 HASH only. */
export const emailConfirmIssueCall = (a: { actorId: string; userId: string; tokenHash: string; expiresAt: string }) =>
  ({ fn: "auth_email_confirm_issue", args: { p_actor: a.actorId, p_user: a.userId, p_token_hash: a.tokenHash, p_expires_at: a.expiresAt } }) as const;

/**
 * The function is not installed yet: PostgREST's schema-cache miss (PGRST202) or Postgres's undefined
 * function (42883). This — and only this — is what "0307 is not applied yet" looks like, and every 0307
 * caller falls back to its pre-0307 path on it.
 */
export function isMissingRpc(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

export interface AttemptReservation {
  /** false = the account is locked right now; the credential must NOT be checked. */
  allowed: boolean;
  /** This attempt's number in the current window (1..FAILURE_LIMIT). null when refused or degraded. */
  attempt: number | null;
  /** Set when THIS reservation reached the limit (the lock is already written), or the live lock when refused. */
  lockedUntil: string | null;
  /** Seconds until a live lock ends; 0 when not locked. */
  retryAfterSeconds: number;
  /** true = 0307's function was missing or failed and the answer came from the pre-0307 read. */
  degraded: boolean;
}

/** Seconds from `nowMs` until `lockedUntil` (at least 1 while the lock is live, 0 when it is not). */
export function lockRetryAfterSeconds(lockedUntil: string | null, nowMs: number): number {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - nowMs;
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.ceil(ms / 1000)) : 0;
}

/**
 * `auth_reserve_attempt`'s jsonb → the lib's shape, or null when it is not the shape 0307 returns
 * (the caller then degrades to the pre-0307 read rather than trusting a malformed answer).
 */
export function parseAttemptReservation(data: unknown, nowMs: number): AttemptReservation | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  if (typeof r.allowed !== "boolean") return null;
  const lockedUntil = typeof r.locked_until === "string" ? r.locked_until : null;
  if (!r.allowed) {
    const fromDb = typeof r.retry_after_seconds === "number" && r.retry_after_seconds > 0 ? Math.ceil(r.retry_after_seconds) : 0;
    return { allowed: false, attempt: null, lockedUntil, retryAfterSeconds: Math.max(1, fromDb || lockRetryAfterSeconds(lockedUntil, nowMs)), degraded: false };
  }
  if (typeof r.attempt !== "number" || !Number.isInteger(r.attempt) || r.attempt < 1) return null;
  return { allowed: true, attempt: r.attempt, lockedUntil, retryAfterSeconds: lockRetryAfterSeconds(lockedUntil, nowMs), degraded: false };
}
