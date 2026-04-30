/**
 * Verification email — Phase 2 Session 3.
 *
 * Sent after admin (Phase 5+) creates a level-5+ user with email auth. The
 * link recipient sets their initial password and flips email_verified=true.
 */

import { renderEmailLayout, appUrl } from "./_layout";

export interface VerificationEmailInput {
  /** Raw token (NOT the hash). Goes into the URL query string. */
  rawToken: string;
  /** UI-friendly expiry hint shown in the footer note. */
  expiresInHours: number;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export function renderVerificationEmail(input: VerificationEmailInput): RenderedEmail {
  const url = `${appUrl()}/verify?token=${input.rawToken}`;
  const html = renderEmailLayout({
    preheader: "Set your password to activate your account.",
    heading: "Welcome to Compliments Only",
    bodyHtml: `
      <p style="margin:0;">Click below to set your password and finish setting up your account.</p>
    `,
    cta: { label: "SET PASSWORD", url },
    footerNote: `This link expires in ${input.expiresInHours} hours.`,
  });
  const text = [
    "Welcome to Compliments Only",
    "",
    "Click below to set your password and finish setting up your account:",
    url,
    "",
    `This link expires in ${input.expiresInHours} hours.`,
  ].join("\n");
  return { html, text };
}
