/**
 * Magic-link request/consume — Portal-2 customer principal (the security core).
 *
 * Passwordless sign-in: request mints a single-use token (hash stored EMAIL-keyed in
 * catering_portal_tokens — the account may not exist yet), consume flips it atomically
 * and resolves-or-creates the catering_customers contact + a customer session.
 *
 * Two load-bearing properties — do NOT weaken either:
 *   1. Single-use atomicity: consume is ONE compare-and-set UPDATE
 *      (`consumed_at IS NULL AND expires_at > now`) with a read-back select. A replayed
 *      link matches 0 rows and fails. Never split into read-then-write (replay race).
 *   2. Constant shape: requestMagicLink resolves void on EVERY internal branch
 *      (invalid email / throttled / insert failure / not allowlisted). The route always
 *      answers {ok:true}; internal disposition lives ONLY in audit rows (enumeration
 *      defense — never leak whether an email exists).
 *
 * Delivery is allowlist-gated (PORTAL_MAGIC_LINK_ALLOWLIST — semantics in
 * lib/portal/magic-link-shared.ts; "*" = open, the go-live posture once the
 * complimentsonlyoperations.com sending domain verifies). Non-allowlisted requests still
 * mint + store the token (constant shape/timing) but skip the send.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { generateToken, hashToken } from "./auth";
import { createCustomerSession } from "./session";
import { checkAndRecord } from "./rate-limit";
import { createDraftFromIntake } from "./draft";
import type { DraftIntake } from "./draft";
import { extractDomain, normalizeEmail, resolveCompanyForEmail, escapeLike, reviveInactiveContact } from "@/lib/catering/companies";
import { sendEmail } from "@/lib/email";
import { allowlistMatches, magicLinkSubject } from "./magic-link-shared";
import { TENANT_NAME } from "@/lib/tenant";
import { renderMagicLinkEmail } from "@/lib/email-templates/magic-link";
import { audit } from "@/lib/audit";

const TOKEN_TTL_MIN = 30;

/** Strict single-line email shape (A-M7): exactly one `@`, a dotted domain, and NO whitespace or
 * control characters (blocks CRLF/header-injection-style values before they're stored/sent). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowlisted(email: string): boolean {
  return allowlistMatches(process.env.PORTAL_MAGIC_LINK_ALLOWLIST, email);
}

/** Constant-shape: always resolves; internal disposition is audited only (enumeration defense). */
export async function requestMagicLink(input: { email: string; name?: string | null; ip?: string | null; intake?: DraftIntake | null }): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email || !EMAIL_RE.test(email) || extractDomain(email) === null) return;
  // Per-VICTIM cap keyed on email alone is IP-independent — an attacker spoofing the client
  // x-forwarded-for cannot bomb a single victim past this. The per-SOURCE (ip+email) cap is a
  // best-effort secondary. audit_log.resource_id is uuid, so null it and carry email in metadata.
  const emailOk = await checkAndRecord(`magic_link_email:${email}`, 15 * 60, 5);
  const sourceOk = await checkAndRecord(`magic_link_src:${input.ip ?? "noip"}:${email}`, 15 * 60, 5);
  if (!emailOk || !sourceOk) { void audit({ actorId: null, actorRole: null, action: "portal.magic_link_throttled", resourceTable: "catering_portal_tokens", resourceId: null, metadata: { email, ip: input.ip }, ipAddress: input.ip ?? null, userAgent: null }); return; }
  const sb = getServiceRoleClient();
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MIN * 60 * 1000).toISOString();
  // LATEST LINK WINS: retire every still-live token for this email before minting the new one.
  // Root cause (2026-09-03 first-live): Gmail threads same-subject mail, and the customer tapped
  // an OLDER message's button — consuming a stale token that carried no intake (→ empty account
  // page) and then one carrying the PREVIOUS form's store. A superseded link now lands on the
  // honest "expired / replaced" page instead of silently doing the wrong thing. Best-effort: a
  // failure here must not block the new link (constant shape), so it is audited and ignored.
  const { error: supersedeError } = await sb.from("catering_portal_tokens")
    .update({ expires_at: now.toISOString() })
    .eq("email", email).is("consumed_at", null).gt("expires_at", now.toISOString());
  if (supersedeError) { void audit({ actorId: null, actorRole: null, action: "portal.magic_link_supersede_failed", resourceTable: "catering_portal_tokens", resourceId: null, metadata: { email, error: supersedeError.message }, ipAddress: input.ip ?? null, userAgent: null }); }
  const { error } = await sb.from("catering_portal_tokens").insert({ email, token_hash: tokenHash, name: input.name?.trim() || null, expires_at: expiresAt, ip_address: input.ip ?? null, intake: input.intake ?? null });
  if (error) { void audit({ actorId: null, actorRole: null, action: "portal.magic_link_insert_failed", resourceTable: "catering_portal_tokens", resourceId: null, metadata: { email, error: error.message }, ipAddress: input.ip ?? null, userAgent: null }); return; }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (allowlisted(email) && appUrl) {
    const link = `${appUrl}/order/verify?token=${rawToken}`;
    const hasIntake = Boolean(input.intake);
    await sendEmail({
      to: email,
      // Distinct per request (ET time stamp) so mail clients never thread two links together.
      subject: magicLinkSubject({ tenantName: TENANT_NAME, hasIntake, requestedAt: now }),
      html: renderMagicLinkEmail({ link, hasIntake }),
      text: `${hasIntake ? `Finish your ${TENANT_NAME} order` : `Sign in to ${TENANT_NAME}`}: ${link}

This link works once and expires in 30 minutes. It replaces any earlier sign-in link we sent you. If you didn't request this, you can safely ignore this email.`,
    });
  }
  void audit({ actorId: null, actorRole: null, action: "portal.magic_link_requested", resourceTable: "catering_portal_tokens", resourceId: null, metadata: { email, allowlisted: allowlisted(email) }, ipAddress: input.ip ?? null, userAgent: null });
}

export interface ConsumeResult { ok: boolean; session?: Awaited<ReturnType<typeof createCustomerSession>>; quoteId?: string }

export async function consumeMagicLink(input: { token: string; ip?: string | null; ua?: string | null }): Promise<ConsumeResult> {
  const sb = getServiceRoleClient();
  const tokenHash = await hashToken(input.token);
  // Atomic single-use: flip consumed_at ONLY if still null AND unexpired. 0 rows => used/expired.
  const { data: rows, error } = await sb.from("catering_portal_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token_hash", tokenHash).is("consumed_at", null).gt("expires_at", new Date().toISOString())
    .select("id, email, name, intake");
  if (error || !rows || rows.length === 0) return { ok: false };
  const tok = rows[0]! as { id: string; email: string; name: string | null; intake: DraftIntake | null };
  const customerId = await resolveOrCreatePortalCustomer(tok.email, tok.name);
  await sb.from("catering_customers").update({ email_verified_at: new Date().toISOString() }).eq("id", customerId).is("email_verified_at", null);
  const session = await createCustomerSession(customerId, tok.email, { ip: input.ip, ua: input.ua });

  // Create the order artifact NOW (post-verify) if this link carried an intake — never before
  // verification (no unverified/competitor rows). A malformed intake must NOT block sign-in.
  let quoteId: string | undefined;
  const intake = tok.intake;
  if (intake && typeof intake === "object" && typeof intake.locationId === "string") {
    try {
      const draft = await createDraftFromIntake(customerId, { ...intake, email: tok.email });
      quoteId = draft.quoteId;
    } catch (err) {
      console.error("[magic-link] createDraftFromIntake failed:", err instanceof Error ? err.message : String(err));
    }
  }

  void audit({ actorId: null, actorRole: null, action: "portal.magic_link_consumed", resourceTable: "catering_customers", resourceId: customerId, metadata: { created_draft: quoteId ?? null }, ipAddress: input.ip ?? null, userAgent: input.ua ?? null });
  return { ok: true, session, quoteId };
}

/**
 * Un-gated resolve-or-create keyed on lower(email); auto-attributes corporate domains.
 *
 * Order matters: active row → DEACTIVATED row (revived, same id) → new row. Skipping the
 * middle rung is how one person becomes two customer_ids and loses sight of their own
 * quotes and payments in the portal, because `catering_customers_one_active_email` is a
 * PARTIAL index that lets a second active row exist beside a deactivated one. The full
 * account is on reviveInactiveContact.
 */
export async function resolveOrCreatePortalCustomer(emailRaw: string, name?: string | null): Promise<string> {
  const email = normalizeEmail(emailRaw);
  const sb = getServiceRoleClient();
  const { data: existing } = await sb.from("catering_customers").select("id").eq("active", true).ilike("email", escapeLike(email)).maybeSingle<{ id: string }>();
  if (existing) return existing.id;
  // No actor: the customer's own magic link drives this, so the audit row carries the
  // system's null actor and names the path, the same way the nightly writers do.
  const revived = await reviveInactiveContact(email, { actorId: null, actorRole: null, via: "portal_magic_link" });
  if (revived) return revived.id;
  const companyId = await resolveCompanyForEmail(email);
  const { data: inserted, error } = await sb.from("catering_customers").insert({ name: name?.trim() || email, email, company_id: companyId, active: true, created_by: null }).select("id").single<{ id: string }>();
  if (error) {
    if (error.code === "23505") { const { data: raced } = await sb.from("catering_customers").select("id").eq("active", true).ilike("email", escapeLike(email)).maybeSingle<{ id: string }>(); if (raced) return raced.id; }
    throw new Error(`resolveOrCreatePortalCustomer: ${error.message}`);
  }
  void audit({ actorId: null, actorRole: null, action: "catering.customer.create", resourceTable: "catering_customers", resourceId: inserted.id, metadata: { via: "portal_magic_link", email, auto_company_id: companyId }, ipAddress: null, userAgent: null });
  return inserted.id;
}
