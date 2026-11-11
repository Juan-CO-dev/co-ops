/**
 * Magic-link sign-in email — portal customer auth.
 *
 * Sent when a customer requests a sign-in link to the catering portal, and (build 2) as the
 * ONE "finish your order" continuation after a Meta lead form. The link is one-time-use; the
 * lifetime is the caller's (30 minutes for a portal request, 72 hours for a Meta continuation).
 * Caller passes a fully-formed URL (no URL construction here).
 *
 * Returns the HTML string directly (not a RenderedEmail struct) because
 * the portal auth flow only needs the HTML surface.
 */

import { renderEmailLayout } from "./_layout";
import { TENANT_NAME } from "@/lib/tenant";
import { magicLinkTtlLabel, type MagicLinkLanguage } from "@/lib/portal/magic-link-shared";

export function renderMagicLinkEmail(args: { link: string; hasIntake?: boolean; ttlMinutes?: number; language?: MagicLinkLanguage }): string {
  const ttl = magicLinkTtlLabel(args.ttlMinutes ?? 30, args.language);
  if (args.language === "es") {
    return renderEmailLayout({
      preheader: `Tu enlace para entrar a ${TENANT_NAME} — válido por ${ttl}.`,
      heading: args.hasIntake ? "Termina tu pedido de catering" : "Entra a tu pedido de catering",
      bodyHtml: `
      <p style="margin:0;">Toca el botón para entrar a ${TENANT_NAME} y seguir justo donde lo dejaste. Este enlace funciona una sola vez y caduca en ${ttl}.</p>
      <p style="margin:12px 0 0;">¿Pediste más de un enlace? Solo funciona este, el más reciente — los anteriores quedaron retirados.</p>
    `,
      cta: { label: "ENTRAR", url: args.link },
      footerNote: "Si no lo pediste, puedes ignorar este correo.",
    });
  }
  return renderEmailLayout({
    preheader: `Your sign-in link for ${TENANT_NAME} — valid for ${ttl}.`,
    heading: args.hasIntake ? "Finish your catering order" : "Sign in to your catering order",
    bodyHtml: `
      <p style="margin:0;">Tap the button below to sign in to ${TENANT_NAME} and pick up right where you left off. This link works once and expires in ${ttl}.</p>
      <p style="margin:12px 0 0;">Requested a link more than once? Only this newest one works — earlier links have been retired.</p>
    `,
    cta: { label: "SIGN IN", url: args.link },
    footerNote:
      "If you didn't request this, you can safely ignore this email.",
  });
}
