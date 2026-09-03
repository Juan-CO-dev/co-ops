/**
 * Magic-link delivery allowlist — pure matcher (zero I/O; client-safe by construction,
 * though today's only consumer is server-side lib/portal/magic-link.ts).
 *
 * Semantics (each pinned in tests/portal-allowlist.test.ts):
 *   - unset (undefined)  → the historical default: Juan's project identity only. This is
 *     the pre-DNS-verification posture — Resend's sandbox sender can only deliver there.
 *   - "*"                → delivery OPEN to every requester (the go-live posture, flipped
 *     by env on Juan's word once the sending domain verifies). Trimmed before compare.
 *   - "a@x.com,b@y.com"  → exact-match list, case-insensitive, entries trimmed.
 *   - ""                 → delivery CLOSED to everyone (deliberate: `??` not `||`, so an
 *     explicitly empty env is a kill switch, distinct from unset).
 *
 * Gating DELIVERY only — requestMagicLink still mints + stores the token on every branch
 * (constant shape/timing; enumeration defense). Opening this list is safe against mail-
 * bombing because the per-victim and per-source rate caps in requestMagicLink are
 * allowlist-independent.
 */

/** Historical default (pre-existing behavior, moved verbatim from magic-link.ts). */
export const DEFAULT_MAGIC_LINK_ALLOWLIST = "juan@complimentsonlysubs.com";

export function allowlistMatches(raw: string | undefined, email: string): boolean {
  const list = raw ?? DEFAULT_MAGIC_LINK_ALLOWLIST;
  if (list.trim() === "*") return true;
  return list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Subject line for the magic-link email — DISTINCT per request on purpose.
 *
 * Gmail threads same-subject/same-sender mail into one conversation; on the 2026-09-03
 * first-live test the customer tapped the SIGN IN button of an OLDER message in that thread
 * twice, consuming stale tokens (one with no intake → empty account page; one carrying the
 * PREVIOUS form's store). Stamping the Eastern request time makes every subject unique, and
 * the wording tells the reader whether this link finishes an order or just signs them in.
 * Whitespace is normalized to ASCII spaces (ICU emits U+202F before AM/PM).
 */
export function magicLinkSubject(args: { tenantName: string; hasIntake: boolean; requestedAt: Date }): string {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(args.requestedAt)
    .replace(/\s+/g, " ");
  return args.hasIntake
    ? `Finish your ${args.tenantName} order — sign in (${time} ET)`
    : `Your ${args.tenantName} sign-in link (${time} ET)`;
}
