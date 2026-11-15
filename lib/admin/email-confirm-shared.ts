/**
 * "Confirm your email" for managers — the PURE half (zero I/O, no import of a server module; client-safe).
 * Audit wave W07 / B053, owner decision W07-1 b.
 *
 * WHY. Manager sign-in (email + password) needs `users.email_verified`. A manager a GM CREATES is marked verified
 * on the spot (admin-vouched, 0279). A person PROMOTED into a manager role never was, and nothing sent them a link —
 * "Email not verified yet. Check your inbox" with no email ever coming. Juan chose a real confirmation message over
 * trusting the typed address: the person gets a link, sets their own password, and the address is confirmed.
 *
 * THIS IS A NEW OUTBOUND STAFF EMAIL, AND IT SHIPS CLOSED. Nothing is sent — and no link is even issued — unless
 * BOTH of the owner's switches are open (`staffConfirmDelivery`):
 *   1. the staff-email delivery switch that already governs digests and exports (`report_settings`
 *      `digest_delivery_mode`, Reports → recipients) is `live` — `off` (the shipped default) and `preview` send nothing;
 *   2. the env allowlist `STAFF_CONFIRM_EMAIL_ALLOWLIST` names the recipient. UNSET or empty = closed to everyone
 *      (unlike the portal magic-link allowlist, this one has no default recipient); `*` = every manager;
 *      `a@x.com,b@y.com` = exactly those addresses.
 * Until then the request is recorded (audit `user.email_confirm_request`, outcome `suppressed` + the reason) and
 * the screen says plainly that nothing was sent.
 */
import { allowlistMatches } from "@/lib/portal/magic-link-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

/** The env var holding the recipient allowlist (see the header for its semantics). */
export const STAFF_CONFIRM_EMAIL_ALLOWLIST_ENV = "STAFF_CONFIRM_EMAIL_ALLOWLIST";
/** How long a confirmation link lasts. The link sets a manager's password, so it is short; a GM can resend. */
export const EMAIL_CONFIRM_EXPIRES_HOURS = 24;
/** At most this many confirmation emails per person per window (the same budget as password-reset requests). */
export const EMAIL_CONFIRM_MAX_PER_WINDOW = 3;
export const EMAIL_CONFIRM_WINDOW_SECONDS = 15 * 60;

/** Deliberately loose: one "@", a dot in the domain, no whitespace. The confirmation link is the real proof. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}

/** Why nothing was sent. Each one is a switch the owner holds, named so the screen and the audit row can say which. */
export type EmailConfirmSuppression = "staff_email_off" | "allowlist_closed" | "not_allowlisted" | "app_url_missing";

export interface StaffConfirmDeliveryInput {
  /** `report_settings.digest_delivery_mode`: the existing staff-email switch. Anything but "live" sends nothing. */
  deliveryMode: string | null | undefined;
  /** The raw `STAFF_CONFIRM_EMAIL_ALLOWLIST` value (undefined = unset). */
  allowlist: string | undefined;
  /** `NEXT_PUBLIC_APP_URL` — without it there is no link to send. */
  appUrl: string | undefined;
  /** The recipient (already lowercased). */
  email: string;
}

/** THE delivery decision. Closed unless every switch is open; the first closed switch is the reason. */
export function staffConfirmDelivery(input: StaffConfirmDeliveryInput): { deliver: true } | { deliver: false; reason: EmailConfirmSuppression } {
  if (input.deliveryMode !== "live") return { deliver: false, reason: "staff_email_off" };
  const list = input.allowlist?.trim() ?? "";
  if (list === "") return { deliver: false, reason: "allowlist_closed" };
  // `allowlistMatches` given an explicit string never falls back to its own default recipient.
  if (!allowlistMatches(list, input.email)) return { deliver: false, reason: "not_allowlisted" };
  if (!input.appUrl || !input.appUrl.trim()) return { deliver: false, reason: "app_url_missing" };
  return { deliver: true };
}

export type EmailConfirmIneligible = "role_not_email_auth" | "inactive" | "no_email" | "already_confirmed";

/** Who a confirmation email is for: an ACTIVE manager-role person with an email nobody has confirmed. */
export function emailConfirmEligibility(target: { role: RoleCode; active: boolean; email: string | null; emailVerified: boolean }): "eligible" | EmailConfirmIneligible {
  if (!ROLES[target.role].hasEmailAuth) return "role_not_email_auth";
  if (!target.active) return "inactive";
  if (!target.email || !target.email.trim()) return "no_email";
  if (target.emailVerified) return "already_confirmed";
  return "eligible";
}

/** What the list shows beside a manager whose sign-in is not usable yet (null = nothing to show). */
export function emailSignInNotice(target: { role: RoleCode; active: boolean; email: string | null; emailVerified: boolean }): "no_email" | "unconfirmed" | null {
  const e = emailConfirmEligibility(target);
  return e === "no_email" ? "no_email" : e === "eligible" ? "unconfirmed" : null;
}

/** `auth_email_confirm_issue`'s arguments (0307) live with the other 0307 builders (no imports: the SQL harness loads that file). */
export { emailConfirmIssueCall } from "@/lib/auth-lockout-shared";

/** 0307's named refusals for the issuer (beside the gate's own, lib/admin/user-admin-rpc-shared.ts) → HTTP + screen code. */
export const EMAIL_CONFIRM_RPC_ERRORS: Readonly<Record<string, { status: number; code: string }>> = {
  email_confirm_not_available: { status: 409, code: "email_confirm_not_available" },
  email_already_confirmed: { status: 409, code: "email_already_confirmed" },
  email_required: { status: 400, code: "email_required" },
};

/** What happened to one request. `sent` is the ONLY outcome in which an email left the building. */
export type EmailConfirmOutcome = "sent" | "send_failed" | "suppressed" | "throttled" | "not_installed" | "not_needed";
export interface EmailConfirmResult { outcome: EmailConfirmOutcome; reason?: EmailConfirmSuppression | EmailConfirmIneligible }

export type EmailConfirmLanguage = "en" | "es";

/** The email's words, per language (the HTML twin is lib/email-templates/email-confirm.ts). Spanish is tú-form. */
export function emailConfirmCopy(args: { tenantName: string; language: EmailConfirmLanguage; expiresInHours: number }) {
  const hours = args.expiresInHours;
  if (args.language === "es") {
    return {
      subject: `Confirma tu correo — ${args.tenantName}`,
      preheader: "Confirma tu correo y crea tu contraseña.",
      heading: "Confirma tu correo",
      body: `Ahora tienes acceso de encargado en ${args.tenantName}. Confirma que este correo es tuyo y crea tu contraseña para entrar con correo y contraseña.`,
      cta: "CONFIRMAR CORREO",
      footer: `Este enlace funciona una sola vez y caduca en ${hours} ${hours === 1 ? "hora" : "horas"}. Reemplaza cualquier enlace anterior. Si no esperabas este correo, ignóralo: nada cambia.`,
    };
  }
  return {
    subject: `Confirm your email — ${args.tenantName}`,
    preheader: "Confirm your email and set your password.",
    heading: "Confirm your email",
    body: `You now have manager sign-in at ${args.tenantName}. Confirm this email address is yours and set your password to sign in with email and password.`,
    cta: "CONFIRM EMAIL",
    footer: `This link works once and expires in ${hours} hour${hours === 1 ? "" : "s"}. It replaces any earlier link. If you weren't expecting this, ignore it — nothing changes.`,
  };
}
