/**
 * "Confirm your email" for managers — the server half (audit W07 / B053, owner decision W07-1 b).
 * Rules, switches and copy: lib/admin/email-confirm-shared.ts. The link is issued by 0307's
 * `auth_email_confirm_issue` (behind the user-admin gate) and opened by the existing POST /api/auth/verify.
 *
 * ORDER, and why:
 *   1. the friendly refusals (who may act on whom; is there anything to confirm);
 *   2. THE DELIVERY SWITCHES — before anything is issued. Closed (the shipped state) = no link exists, no provider
 *      call, an audit row saying `suppressed` and which switch;
 *   3. the per-person throttle;
 *   4. the issuer RPC (re-checks everything on the locked rows; retires older links);
 *   5. the switches AGAIN on the address the database returned (it is the one the mail goes to);
 *   6. the send; 7. the audit row.
 * The raw token exists only in this function's memory and in the email. It is never logged, audited or returned.
 */
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/auth";
import { isMissingRpc } from "@/lib/auth-lockout-shared";
import { sendEmail, teamFrom } from "@/lib/email";
import { renderEmailConfirmEmail } from "@/lib/email-templates/email-confirm";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  EMAIL_CONFIRM_EXPIRES_HOURS, EMAIL_CONFIRM_MAX_PER_WINDOW, EMAIL_CONFIRM_RPC_ERRORS, EMAIL_CONFIRM_WINDOW_SECONDS,
  STAFF_CONFIRM_EMAIL_ALLOWLIST_ENV, emailConfirmEligibility, emailConfirmIssueCall, staffConfirmDelivery,
  type EmailConfirmResult,
} from "./email-confirm-shared";
import { USER_ADMIN_BUSY_SQLSTATES, USER_ADMIN_RPC_ERRORS } from "./user-admin-rpc-shared";
import { AdminUserError, loadActionableTarget } from "./users";

type Sb = ReturnType<typeof getServiceRoleClient>;

/** The existing staff-email switch (Reports → recipients). Unreadable or malformed = "off": closed, never open. */
async function staffDeliveryMode(sb: Sb): Promise<string> {
  const { data, error } = await sb.from("report_settings").select("value").eq("key", "digest_delivery_mode").maybeSingle<{ value: unknown }>();
  if (error || !data || typeof data.value !== "string") return "off";
  return data.value;
}

export async function requestEmailConfirmation(actor: AuthContext, userId: string): Promise<EmailConfirmResult> {
  const target = await loadActionableTarget(actor, userId);
  const eligibility = emailConfirmEligibility(target);
  if (eligibility === "no_email") throw new AdminUserError(400, "email_required", "Add an email first");
  if (eligibility === "already_confirmed") throw new AdminUserError(409, "email_already_confirmed");
  if (eligibility !== "eligible") throw new AdminUserError(409, "email_confirm_not_available");

  const sb = getServiceRoleClient();
  const record = (result: EmailConfirmResult, extra: Record<string, unknown> = {}) => audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "user.email_confirm_request",
    resourceTable: "users", resourceId: userId,
    metadata: { outcome: result.outcome, ...(result.reason ? { reason: result.reason } : {}), ...extra },
    ipAddress: null, userAgent: null,
  });
  const switches = async (email: string) => staffConfirmDelivery({
    deliveryMode: await staffDeliveryMode(sb), allowlist: process.env[STAFF_CONFIRM_EMAIL_ALLOWLIST_ENV],
    appUrl: process.env.NEXT_PUBLIC_APP_URL, email,
  });

  // 2. The owner's switches, BEFORE a link exists.
  const first = await switches((target.email as string).trim().toLowerCase());
  if (!first.deliver) {
    const result: EmailConfirmResult = { outcome: "suppressed", reason: first.reason };
    await record(result);
    return result;
  }

  // 3. Throttle per person (mail-bombing a manager's inbox from the admin screen).
  if (!(await checkAndRecord(`email_confirm:${userId}`, EMAIL_CONFIRM_WINDOW_SECONDS, EMAIL_CONFIRM_MAX_PER_WINDOW))) {
    const result: EmailConfirmResult = { outcome: "throttled" };
    await record(result);
    return result;
  }

  // 4. Issue the link (the HASH goes to the database).
  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_CONFIRM_EXPIRES_HOURS * 3600 * 1000).toISOString();
  const call = emailConfirmIssueCall({ actorId: actor.user.id, userId, tokenHash: await hashToken(rawToken), expiresAt });
  const { data, error } = await sb.rpc(call.fn, call.args);
  if (error) {
    if (isMissingRpc(error)) return { outcome: "not_installed" }; // migration 0307 not applied: nothing issued, nothing sent
    if (error.code && USER_ADMIN_BUSY_SQLSTATES.includes(error.code)) throw new AdminUserError(409, "user_admin_busy");
    const known = EMAIL_CONFIRM_RPC_ERRORS[error.message] ?? USER_ADMIN_RPC_ERRORS[error.message];
    if (known) throw new AdminUserError(known.status, known.code);
    throw new Error(`${call.fn} failed: ${error.code ?? "unknown"}`);
  }
  const issued = (data ?? {}) as { id?: unknown; email?: unknown; links_retired?: unknown };
  const email = typeof issued.email === "string" ? issued.email : "";
  const linkId = typeof issued.id === "string" ? issued.id : null;

  // 5. The switches again, on the address the locked row actually holds (an email edit may have landed in between).
  const second = email ? await switches(email) : ({ deliver: false, reason: "not_allowlisted" } as const);
  if (!second.deliver) {
    const result: EmailConfirmResult = { outcome: "suppressed", reason: second.reason };
    await record(result, { verification_id: linkId });
    return result;
  }

  // 6. Send (staff sender; the provider key dedupes a double tap on the same link).
  const language = await sb.from("users").select("language").eq("id", userId).maybeSingle<{ language: string | null }>()
    .then((r) => (r.data?.language === "es" ? "es" as const : "en" as const), () => "en" as const);
  const mail = renderEmailConfirmEmail({ rawToken, appUrl: process.env.NEXT_PUBLIC_APP_URL as string, expiresInHours: EMAIL_CONFIRM_EXPIRES_HOURS, language });
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text, from: teamFrom(),
    ...(linkId ? { idempotencyKey: `email-confirm/${linkId}` } : {}) });

  // 7. Record. Never the token, never the address.
  const result: EmailConfirmResult = { outcome: "id" in sent ? "sent" : "send_failed" };
  await record(result, { verification_id: linkId, expires_at: expiresAt,
    links_retired: typeof issued.links_retired === "number" ? issued.links_retired : 0,
    ...("id" in sent ? { resend_id: sent.id } : { send_error: sent.error }) });
  return result;
}
