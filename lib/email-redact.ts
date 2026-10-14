/**
 * Recipient-safe text for logs and audit/decision records — PURE, client-safe.
 *
 * Juan's standing rule: customer email/phone VALUES never go in logs or audit records. A mail
 * provider's error text can quote the address it refused ("Invalid `to` field: x@y.z"), so any
 * provider string is passed through `redactEmailAddresses` before it is logged or stored, and
 * a recipient is described only by `recipientTag` (a count, never the address or a hash of it
 * — an email hash is reversible by anyone holding a list of candidate addresses).
 */

// local@domain.tld, also when URL-encoded (%40). Deliberately broad: a false positive costs a
// word in a log line; a false negative leaks an address.
const EMAIL_SHAPED = /[A-Za-z0-9._%+\-]+(?:@|%40)[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/gi;

export const REDACTED_EMAIL = "[email]";

export function redactEmailAddresses(text: string): string {
  return text.replace(EMAIL_SHAPED, REDACTED_EMAIL);
}

/** "1 recipient" / "3 recipients" — the only thing a log may say about who mail was for. */
export function recipientTag(to: string | readonly string[]): string {
  const n = Array.isArray(to) ? to.length : 1;
  return n === 1 ? "1 recipient" : `${n} recipients`;
}
