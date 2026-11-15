/**
 * "Confirm your email" — sent to a manager whose email nobody has confirmed yet (a person promoted into a manager
 * role; audit W07 / B053, owner decision W07-1 b). The link opens /verify, where they set their own password; the
 * address is then marked confirmed and they are signed in (POST /api/auth/verify → 0307's `auth_email_confirm_consume`, one transaction).
 *
 * The words live in lib/admin/email-confirm-shared.ts `emailConfirmCopy` (en + es); this is only the HTML shell.
 * Delivery is decided elsewhere (`staffConfirmDelivery`): rendering an email never sends one.
 */

import { emailConfirmCopy, type EmailConfirmLanguage } from "@/lib/admin/email-confirm-shared";
import { TENANT_NAME } from "@/lib/tenant";
import { escapeHtml, renderEmailLayout } from "./_layout";
import type { RenderedEmail } from "./verification";

export interface EmailConfirmEmailInput {
  /** Raw token (NOT the hash). Goes into the URL query string and nowhere else. */
  rawToken: string;
  /** The app origin, no trailing slash (the caller already proved it is set). */
  appUrl: string;
  expiresInHours: number;
  language: EmailConfirmLanguage;
}

export function renderEmailConfirmEmail(input: EmailConfirmEmailInput): RenderedEmail & { subject: string } {
  const copy = emailConfirmCopy({ tenantName: TENANT_NAME, language: input.language, expiresInHours: input.expiresInHours });
  const url = `${input.appUrl.replace(/\/$/, "")}/verify?token=${input.rawToken}`;
  const html = renderEmailLayout({
    preheader: copy.preheader,
    heading: copy.heading,
    bodyHtml: `
      <p style="margin:0;">${escapeHtml(copy.body)}</p>
    `,
    cta: { label: copy.cta, url },
    footerNote: copy.footer,
  });
  const text = [copy.heading, "", copy.body, url, "", copy.footer].join("\n");
  return { subject: copy.subject, html, text };
}
