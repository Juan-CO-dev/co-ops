/**
 * Re-check throttle — audit wave W07 / B159 (owner decisions W07-3 a and W07-4 a, 2026-11-15).
 *
 * A "re-check" is a credential typed by someone who is ALREADY signed in: the password step-up, and the PIN
 * re-entered on counts, the cash deposit and the checklist confirm. They used to take unlimited guesses (the
 * Phase 2 Session 3 ruling "no lockout on re-checks": locking the account would not raise the bar). That left a
 * signed-in device — an unattended tablet, a copied cookie — as an oracle for a manager's password or a 4-digit PIN.
 *
 * THE RULE NOW: five wrong re-checks IN A ROW on one session sign THAT SESSION out. The ACCOUNT is never locked —
 * the person signs in again, and sign-in is where the account lockout lives. A correct answer clears the run.
 *
 * HOW (migration 0307): `session_reauth_reserve` counts the attempt on the sessions row BEFORE the credential is
 * checked — so a burst of guesses cannot all slip past, the same reasoning as the sign-in reservation — and revokes
 * the session itself once it is out of attempts. `session_reauth_clear` zeroes the count on a correct answer.
 *
 * BEFORE 0307 IS APPLIED the functions are missing: `reserveReauth` answers `allowed, degraded` and the re-check
 * proceeds uncounted, exactly as it did before this change. Never weaker than before, never a broken screen.
 *
 * This module deliberately does NOT import lib/auth-flows (several route tests mock that module narrowly); the PIN
 * wrapper that needs both lives in lib/auth-reauth-pin.ts.
 */
import type { NextResponse } from "next/server";

import { jsonError } from "./api-helpers";
import {
  isMissingRpc, parseReauthReservation, reauthExhausted, sessionReauthClearCall, sessionReauthReserveCall,
  type ReauthReservation,
} from "./auth-lockout-shared";
import { clearSessionCookie, revokeSession } from "./session";
import { getServiceRoleClient } from "./supabase-server";

export { REAUTH_LIMIT, type ReauthReservation } from "./auth-lockout-shared";

/** The code every re-check surface answers with once the session has been signed out (401, cookie cleared). */
export const REAUTH_LOCKED_CODE = "reauth_locked";

/** Logged once per server instance: before 0307 is applied every re-check takes the uncounted path. */
let warnedMissing = false;

const UNCOUNTED: ReauthReservation = { allowed: true, attempt: null, degraded: true };

/**
 * Reserve one re-check on this session BEFORE checking the credential.
 * `allowed: false` = the session is out of attempts and has ALREADY been revoked by the database: do not check
 * the credential, answer `reauthLockedResponse()`.
 */
export async function reserveReauth(sessionId: string): Promise<ReauthReservation> {
  const call = sessionReauthReserveCall(sessionId);
  const { data, error } = await getServiceRoleClient().rpc(call.fn, call.args);
  if (!error) {
    const parsed = parseReauthReservation(data);
    if (parsed) return parsed;
    console.error(`[auth-reauth] session_reauth_reserve returned an unexpected shape for session ${sessionId}: re-check not counted`);
    return UNCOUNTED;
  }
  if (isMissingRpc(error)) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[auth-reauth] session_reauth_reserve is not installed (migration 0307 not applied): re-checks are not counted yet");
    }
  } else {
    // A limiter fault must not turn a correct password into an error (the posture of every limiter in this app).
    console.error(`[auth-reauth] session_reauth_reserve failed for session ${sessionId}: ${error.message} — re-check not counted`);
  }
  return UNCOUNTED;
}

/** A correct answer ends the run of wrong ones. Never throws: housekeeping must not fail a verified re-check. */
export async function clearReauth(sessionId: string, reservation?: ReauthReservation): Promise<void> {
  if (reservation?.degraded) return; // nothing was counted
  try {
    const call = sessionReauthClearCall(sessionId);
    const { error } = await getServiceRoleClient().rpc(call.fn, call.args);
    if (error && !isMissingRpc(error)) console.error(`[auth-reauth] session_reauth_clear failed for session ${sessionId}: ${error.message}`);
  } catch (e) {
    console.error(`[auth-reauth] session_reauth_clear threw for session ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Call after a WRONG answer on a reserved re-check. When that was the last attempt allowed, the session is signed
 * out NOW (not on the next request) and this returns true — the caller answers `reauthLockedResponse()`.
 * If the revoke itself fails, the database still refuses the next reservation and revokes then.
 */
export async function reauthFailed(sessionId: string, reservation: ReauthReservation): Promise<boolean> {
  if (!reauthExhausted(reservation)) return false;
  try {
    await revokeSession(sessionId);
  } catch (e) {
    console.error(`[auth-reauth] revoke after the last re-check failed for session ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/** 401 `reauth_locked` with the session cookie cleared: the device is signed out, the account is untouched. */
export function reauthLockedResponse(): NextResponse {
  return clearSessionCookie(jsonError(401, REAUTH_LOCKED_CODE, { message: "Too many wrong tries. You have been signed out — sign in again." }));
}
