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

export type MagicLinkLanguage = "en" | "es";

/**
 * Subject line for the magic-link email — DISTINCT per request on purpose.
 *
 * Gmail threads same-subject/same-sender mail into one conversation; on the 2026-09-03
 * first-live test the customer tapped the SIGN IN button of an OLDER message in that thread
 * twice, consuming stale tokens (one with no intake → empty account page; one carrying the
 * PREVIOUS form's store). Stamping the Eastern request time makes every subject unique, and
 * the wording tells the reader whether this link finishes an order or just signs them in.
 * Whitespace is normalized to ASCII spaces (ICU emits U+202F before AM/PM).
 *
 * `language` (build 2, A2): a Meta continuation link for a Spanish form reads in Spanish;
 * omitted = English = every existing caller unchanged.
 */
export function magicLinkSubject(args: { tenantName: string; hasIntake: boolean; requestedAt: Date; language?: MagicLinkLanguage }): string {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(args.requestedAt)
    .replace(/\s+/g, " ");
  if (args.language === "es") {
    return args.hasIntake
      ? `Termina tu pedido de ${args.tenantName} — inicia sesión (${time} ET)`
      : `Tu enlace para entrar a ${args.tenantName} (${time} ET)`;
  }
  return args.hasIntake
    ? `Finish your ${args.tenantName} order — sign in (${time} ET)`
    : `Your ${args.tenantName} sign-in link (${time} ET)`;
}

/** "30 minutes" / "72 hours" (en) · "30 minutos" / "72 horas" (es) — the link's lifetime in words. */
export function magicLinkTtlLabel(ttlMinutes: number, language: MagicLinkLanguage = "en"): string {
  const hours = ttlMinutes >= 60 && ttlMinutes % 60 === 0 ? ttlMinutes / 60 : null;
  if (language === "es") return hours !== null ? `${hours} ${hours === 1 ? "hora" : "horas"}` : `${ttlMinutes} minutos`;
  return hours !== null ? `${hours} ${hours === 1 ? "hour" : "hours"}` : `${ttlMinutes} minutes`;
}

/** The plain-text body of the magic-link email (the HTML twin is lib/email-templates/magic-link.ts). */
export function magicLinkText(args: { tenantName: string; hasIntake: boolean; link: string; ttlMinutes: number; language?: MagicLinkLanguage }): string {
  const ttl = magicLinkTtlLabel(args.ttlMinutes, args.language);
  if (args.language === "es") {
    return `${args.hasIntake ? `Termina tu pedido de ${args.tenantName}` : `Entra a ${args.tenantName}`}: ${args.link}

Este enlace funciona una sola vez y caduca en ${ttl}. Reemplaza cualquier enlace anterior que te hayamos enviado. Si no lo pediste, puedes ignorar este correo.`;
  }
  return `${args.hasIntake ? `Finish your ${args.tenantName} order` : `Sign in to ${args.tenantName}`}: ${args.link}

This link works once and expires in ${ttl}. It replaces any earlier sign-in link we sent you. If you didn't request this, you can safely ignore this email.`;
}
