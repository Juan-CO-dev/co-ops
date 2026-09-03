/**
 * Magic-link sign-in email — portal customer auth.
 *
 * Sent when a customer requests a sign-in link to the catering portal.
 * The link is one-time-use and expires in 30 minutes. Caller passes
 * a fully-formed URL (no URL construction here).
 *
 * Returns the HTML string directly (not a RenderedEmail struct) because
 * the portal auth flow only needs the HTML surface.
 */

import { renderEmailLayout } from "./_layout";
import { TENANT_NAME } from "@/lib/tenant";

export function renderMagicLinkEmail(args: { link: string; hasIntake?: boolean }): string {
  return renderEmailLayout({
    preheader: `Your sign-in link for ${TENANT_NAME} — valid for 30 minutes.`,
    heading: args.hasIntake ? "Finish your catering order" : "Sign in to your catering order",
    bodyHtml: `
      <p style="margin:0;">Tap the button below to sign in to ${TENANT_NAME} and pick up right where you left off. This link works once and expires in 30 minutes.</p>
      <p style="margin:12px 0 0;">Requested a link more than once? Only this newest one works — earlier links have been retired.</p>
    `,
    cta: { label: "SIGN IN", url: args.link },
    footerNote:
      "If you didn't request this, you can safely ignore this email.",
  });
}
