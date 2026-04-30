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
 * Resend constraints (locked Phase 2 Session 3):
 *   - EMAIL_FROM = onboarding@resend.dev (Resend default sender). Domain
 *     verification of complimentsonlysubs.com is queued for Phase 5+ once
 *     Pete approves DNS configuration.
 *   - Default sender restricts deliverable recipients to the verified Resend
 *     account email only — i.e., juan@complimentsonlysubs.com. Until domain
 *     verification, any production email path that targets a non-Juan address
 *     will silently 422 from Resend's side.
 *   - text fallback is required by Resend best practices (deliverability +
 *     accessibility). Every caller must supply both html and text.
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

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmailResult = { id: string } | { error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const client = getClient();
    const { data, error } = await client.emails.send({
      from: getFrom(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) {
      console.error(`[email] send failed for to=${input.to}:`, error.message);
      return { error: error.message };
    }
    if (!data?.id) {
      console.error(`[email] send returned no id for to=${input.to}`);
      return { error: "send returned no id" };
    }
    return { id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[email] unexpected error for to=${input.to}:`, msg);
    return { error: msg };
  }
}
