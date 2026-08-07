/**
 * Vendor-ordering email — the ONE pure gate + validators (Vendor Ordering V2 §3/§6).
 *
 * Client-safe LEAF module: zero I/O, no server imports (no supabase-server, no
 * "server-only"). It's the single home for the auto-email dormancy check + email
 * plausibility test so purchase-orders.ts (loadPoDetail flag), po-email.ts (send
 * gate), and lib/admin/vendors.ts (admin tier availability) all agree byte-for-byte —
 * AND so no import cycle forms (purchase-orders ↔ po-email both import this leaf).
 */

/** The rendered, ready-to-send order email + its addressing (server-derived; the panel
 *  shows it, sendOrderEmail re-derives it — the client never composes the send). Lives in
 *  this client-safe leaf so PoPanel can type its preview state without importing the
 *  server-only adapter. */
export interface OrderEmailPreview {
  to: string[];
  from: string;
  replyTo: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

/** The Resend default sender domain. When EMAIL_FROM still points here, the domain
 *  is NOT verified for outbound-to-vendors — auto email is dormant (spec §6 row 1). */
export const RESEND_DEFAULT_DOMAIN = "resend.dev";

/** The domain of an EMAIL_FROM value ("a@b.com" → "b.com"), lowercased. Null when
 *  there's no `@` or nothing after it (malformed → treated as unusable). */
export function emailFromDomain(emailFrom: string | null | undefined): string | null {
  if (typeof emailFrom !== "string") return null;
  const at = emailFrom.lastIndexOf("@");
  if (at < 0) return null;
  const domain = emailFrom.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Is the auto-email leg AWAKE for an ordering location? (spec §6 row 1, V2-D3.)
 * TRUE iff BOTH:
 *   - the location has a PLAUSIBLE `receipt_email_address` alias (it becomes the
 *     FROM/reply-to — a malformed alias means the leg is misconfigured, not awake), AND
 *   - EMAIL_FROM's domain is not resend.dev (i.e. a verified sending domain is set).
 * PURE over its inputs — server derives it per location; the panel/admin get the
 * boolean, never the env. Replaces V1's static-disabled auto tier.
 */
export function emailOrderingAvailable(
  receiptEmailAddress: string | null | undefined,
  emailFrom: string | null | undefined,
): boolean {
  if (!isPlausibleEmail(receiptEmailAddress)) return false;
  const domain = emailFromDomain(emailFrom);
  if (!domain) return false;
  return domain !== RESEND_DEFAULT_DOMAIN;
}

/**
 * A plausible email address for outbound targeting. Deliberately conservative (one
 * `@`, non-empty local + domain, a dot in the domain, no whitespace) — this only
 * FILTERS the vendor's active email-method ordering details so a junk row never
 * becomes a Resend recipient; Resend does the authoritative validation. Never throws.
 */
export function isPlausibleEmail(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@")) return false; // exactly one @, non-empty local
  const domain = v.slice(at + 1);
  if (!domain || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}
