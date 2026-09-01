/**
 * Resend email wrapper — Phase 2 Session 3.
 *
 * Single helper: sendEmail({ to, subject, html, text }).
 *
 * Failure semantics: NEVER throw. Resend or network errors are logged via
 * console.error and returned as { error: string }. Pattern matches
 * lib/audit.ts's console-error-and-continue: a missed email is bad, but
 * crashing the calling route because Resend hiccupped is worse — the route
 * can audit the send failure and respond cleanly.
 *
 * Sender scheme (Juan-ratified 2026-09-01; sending domain = complimentsonlyoperations.com,
 * added to Resend 2026-09-01, DNS verification pending at GoDaddy):
 *   - EMAIL_FROM             — the CUSTOMER-facing default (catering@...). Portal magic
 *     links, quote emails, order drafts: every send that lands in a customer inbox.
 *   - EMAIL_FROM_TEAM        — staff/internal sends (team@...): password resets today,
 *     internal digests later. Unset → falls back to EMAIL_FROM (see teamFrom()).
 *   - vendor/B2B (ops) sends do NOT use an env sender: the PO leg sends FROM each
 *     location's own `locations.receipt_email_address` alias so vendor replies
 *     self-sort per store (V2-D3). That leg stays dormant until an alias is set AND
 *     EMAIL_FROM's domain is real (lib/po-email-shared.ts emailOrderingAvailable).
 *
 * Until DNS verification completes, EMAIL_FROM remains onboarding@resend.dev, which
 * restricts deliverable recipients to the Resend account email (juan@) — any other
 * recipient silently 422s on Resend's side.
 *
 * text fallback is required by Resend best practices (deliverability +
 * accessibility). Every caller must supply both html and text.
 */

import { Resend } from "resend";

let cachedClient: Resend | null = null;

function getClient(): Resend {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  cachedClient = new Resend(key);
  return cachedClient;
}

function getFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  return from;
}

/** Sender for staff/internal mail (password resets, future digests). Returns the
 *  EMAIL_FROM_TEAM override, or undefined so sendEmail falls through to EMAIL_FROM —
 *  callers pass it straight as `from` and unset env = exactly today's behavior. */
export function teamFrom(): string | undefined {
  return process.env.EMAIL_FROM_TEAM?.trim() || undefined;
}

export interface SendEmailInput {
  /** One recipient (existing callers) OR many (vendor-ordering fan-out — Resend
   *  accepts a string[] natively). A single string is the historical shape and
   *  is preserved unchanged. */
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Override the sender for this message (defaults to EMAIL_FROM). Used by the
   *  vendor-ordering adapter to send FROM the ordering location's alias so vendor
   *  replies self-sort to the right store (V2-D3). Omitted = current behavior. */
  from?: string;
  /** Reply-to override (Resend `reply_to`). Omitted = no reply_to header, i.e.
   *  replies go to the from address — exactly today's behavior for every caller
   *  that doesn't set it. */
  replyTo?: string;
}

export type SendEmailResult = { id: string } | { error: string };

/** A stable log label for `to` whether it's one address or an array. */
function toLabel(to: string | string[]): string {
  return Array.isArray(to) ? to.join(", ") : to;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const label = toLabel(input.to);
  try {
    // `from` defaults to EMAIL_FROM (getFrom) — existing callers pass no `from`,
    // so their sender is unchanged. `replyTo` (Resend v6 public field, mapped to the
    // reply_to header internally) is only set when given — undefined = header absent =
    // today's behavior for every existing caller.
    const client = getClient();
    const { data, error } = await client.emails.send({
      from: input.from ?? getFrom(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    if (error) {
      console.error(`[email] send failed for to=${label}:`, error.message);
      return { error: error.message };
    }
    if (!data?.id) {
      console.error(`[email] send returned no id for to=${label}`);
      return { error: "send returned no id" };
    }
    return { id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[email] unexpected error for to=${label}:`, msg);
    return { error: msg };
  }
}
