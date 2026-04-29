/**
 * Password reset email — Phase 2 Session 3.
 *
 * Sent in response to /api/auth/password-reset-request. The link recipient
 * sets a new password via /api/auth/password-reset.
 *
 * Reset DOES NOT auto-sign-in (different threat model from verify — implies
 * the user forgot their password and goes to the login screen with the new
 * one). Active sessions for the user are revoked at consumption time.
 */

import { renderEmailLayout, appUrl } from "./_layout";
import type { RenderedEmail } from "./verification";

export interface PasswordResetEmailInput {
  rawToken: string;
  expiresInHours: number;
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const url = `${appUrl()}/reset-password?token=${input.rawToken}`;
  const hr = `${input.expiresInHours} hour${input.expiresInHours === 1 ? "" : "s"}`;
  const html = renderEmailLayout({
    preheader: "Reset your password.",
    heading: "Reset your password",
    bodyHtml: `
      <p style="margin:0;">Click below to set a new password for Compliments Only Operations.</p>
    `,
    cta: { label: "RESET PASSWORD", url },
    footerNote: `This link expires in ${hr}. If you didn't request this, ignore this email — your password won't change.`,
  });
  const text = [
    "Reset your password",
    "",
    "Click below to set a new password for Compliments Only Operations:",
    url,
    "",
    `This link expires in ${hr}. If you didn't request this, ignore this email — your password won't change.`,
  ].join("\n");
  return { html, text };
}
