/**
 * Where a signed-out person goes back to after signing in again — audit W06 (B012 / B154 / B155) and the owner's
 * binding decision W06-2 (HYBRID):
 *
 *   after a sign-out, the SAME person signing back in returns to the page they were on;
 *   a DIFFERENT person goes to the dashboard / hub.
 *
 * The return link therefore travels with WHO it belongs to: `/?next=<path>&for=<user id>`. The login page sends the
 * person to `next` only when the user who just signed in IS `for`; anyone else lands on the default (the dashboard).
 * `for` is not a credential and grants nothing — forging it can only take a return link AWAY; every page still checks
 * the signed-in user's own access. The user id is the same id the public tile login already lists.
 *
 * A `next` with NO `for` keeps its old meaning (the proxy's "you opened a link while signed out" redirect — nobody was
 * signed in on this tab, so the person signing in is the one who asked for the page).
 *
 * Zero I/O and no server imports: used by the login page, the idle timeout, the password modal, and
 * `requireSessionFromHeaders` alike. The `next` VALUE is still sanitized on the read side by `safeNextPath`.
 */
import { DEFAULT_NEXT_PATH, safeNextPath } from "./nav-redirect";

/** Build the sign-in URL. With no `forUser` the return link is DROPPED (a client that cannot say whose page it is
 *  must not hand it to whoever signs in next); server callers that know nobody pass `keepUnownedNext`. */
export function signInHref(args: {
  next?: string | null;
  forUser?: string | null;
  reason?: "idle" | null;
  keepUnownedNext?: boolean;
}): string {
  const params = new URLSearchParams();
  if (args.reason) params.set("reason", args.reason);
  const next = args.next && args.next.startsWith("/") && !args.next.startsWith("//") ? args.next : null;
  if (next && (args.forUser || args.keepUnownedNext)) {
    params.set("next", next);
    if (args.forUser) params.set("for", args.forUser);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** The login page's post-sign-in destination (already sanitized). */
export function returnPathAfterSignIn(args: {
  next: string | null | undefined;
  forUser: string | null | undefined;
  signedInUserId: string | null | undefined;
}): string {
  if (args.forUser && args.forUser !== args.signedInUserId) return DEFAULT_NEXT_PATH;
  return safeNextPath(args.next);
}

const SIGNED_IN_USER_KEY = "co_ops_signed_in_user";

/** Client only: remember (per tab) who is signed in, so a dead-session redirect can bind its return link. Storage
 *  blocked or absent (server, private mode) = a no-op. */
export function rememberSignedInUser(userId: string): void {
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(SIGNED_IN_USER_KEY, userId);
  } catch {
    /* storage blocked — the return link is simply dropped */
  }
}

/** Client only: who this tab last knew as signed in, or null. */
export function signedInUser(): string | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage.getItem(SIGNED_IN_USER_KEY) : null;
  } catch {
    return null;
  }
}
