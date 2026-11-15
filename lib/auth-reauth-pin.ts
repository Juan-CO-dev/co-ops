/**
 * The PIN re-check, counted per session — audit wave W07 / B159 (owner decision W07-4 a: the same five-strike rule
 * as the password step-up on counts, the cash deposit and the checklist confirm). See lib/auth-reauth.ts.
 *
 * `verifyActorPin` (lib/auth-flows.ts) stays the one PIN comparison; this wraps it in the reservation.
 */
import { verifyActorPin } from "./auth-flows";
import { clearReauth, reauthFailed, reserveReauth } from "./auth-reauth";

export type PinRecheckResult = "ok" | "wrong" | "signed_out";

/**
 * Verify the signed-in actor's own PIN on this session.
 *   "ok"          the PIN is right (the session's run of wrong re-checks is cleared)
 *   "wrong"       the PIN is wrong and the session has attempts left
 *   "signed_out"  the session ran out of re-check attempts and has been revoked — answer `reauthLockedResponse()`
 *
 * A value that is not four digits is "wrong" without spending an attempt: it is a malformed request, not a guess.
 */
export async function verifyActorPinForSession(sessionId: string, userId: string, pin: string): Promise<PinRecheckResult> {
  if (!/^\d{4}$/.test(pin)) return "wrong";
  const reservation = await reserveReauth(sessionId);
  if (!reservation.allowed) return "signed_out";
  if (await verifyActorPin(userId, pin)) {
    await clearReauth(sessionId, reservation);
    return "ok";
  }
  return (await reauthFailed(sessionId, reservation)) ? "signed_out" : "wrong";
}
