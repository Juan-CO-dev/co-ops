/**
 * Shared email layout — Phase 2 Session 3.
 *
 * Both verification and password-reset emails render through this single
 * layout function. Visual consistency is the brand-book preference for any
 * direct user-facing communication.
 *
 * Brand decisions (locked Phase 2 Session 3, per docs/BRAND_REFERENCE.md):
 *   - Background: Mayo (#FFF9E4)
 *   - Card / inner: white, rounded
 *   - Primary text: Diet Coke (#141414)
 *   - Wordmark band: Mustard (#FFE560) with typographic wordmark
 *   - CTA button: Diet Coke fill, Red (#FF3A44) text, ALL CAPS, dominant size
 *     (Brand book: "Red used most sparingly — only as CTA text or where a
 *     more eye-catching accent is needed." Brand book also pairs Midnight Sans
 *     with ALL CAPS treatment for headlines/CTAs; we don't have web fonts in
 *     email so we approximate via text-transform:uppercase.)
 *
 * Wordmark approach (locked Phase 2 Session 3 after first-pass visual review):
 *   Typography-only header. The Mustard band carries "COMPLIMENTS ONLY" set in
 *   bold system-font ALL CAPS with tight letter-spacing (-0.02em) to evoke
 *   Midnight Sans's condensed feel. The image-based wordmark (co-wordmark.png)
 *   was dropped from email because Gmail blocks http://localhost image
 *   sources (anti-tracking) and image-proxying behavior varies across clients.
 *   Typography renders identically everywhere. The image variant returns to
 *   email as a refinement once the production domain is verified and HTTPS
 *   image serving is reliable across clients; the typographic header stays as
 *   the fallback either way.
 *
 * System-font stack used because email clients don't reliably render custom
 * web fonts. Brand book typography (Midnight Sans, GT America) is deferred
 * to web app UI in a later phase.
 */

export const COLORS = {
  mayo: "#FFF9E4",
  dietCoke: "#141414",
  mustard: "#FFE560",
  red: "#FF3A44",
} as const;

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

export interface EmailLayoutInput {
  /** Inbox-preview text. Hidden in the rendered body. */
  preheader: string;
  /** Top heading, e.g. "Welcome to CO-OPS". */
  heading: string;
  /** Pre-rendered HTML for the body paragraphs. Caller is responsible for escaping. */
  bodyHtml: string;
  /** CTA button label + destination URL. URL must be pre-validated/pre-encoded. */
  cta: { label: string; url: string };
  /** Small note below the CTA, e.g., "This link expires in 1 hour…". */
  footerNote: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const ctaUrl = input.cta.url;
  // CTA button sizing: min 48px tap target via padding+line-height; 18px font;
  // 36px horizontal padding; ALL CAPS via text-transform (defense even if
  // caller forgets to upper-case the label).
  const ctaStyle = [
    "display:inline-block",
    `background:${COLORS.dietCoke}`,
    `color:${COLORS.red}`,
    "text-decoration:none",
    "font-weight:700",
    "font-size:18px",
    "line-height:24px",
    "padding:16px 36px",
    "border-radius:8px",
    "letter-spacing:0.08em",
    "text-transform:uppercase",
  ].join(";");
  // Typographic wordmark: 28px / weight 700 / tight tracking, centered in
  // the Mustard band. Outlook degrades letter-spacing gracefully; Gmail / iOS
  // / Apple Mail render it cleanly.
  const wordmarkStyle = [
    "font-size:28px",
    "font-weight:700",
    `color:${COLORS.dietCoke}`,
    "letter-spacing:-0.02em",
    "line-height:1.1",
    "text-transform:uppercase",
  ].join(";");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.mayo};color:${COLORS.dietCoke};font-family:${FONT_STACK};">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;line-height:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${COLORS.mayo};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
        <tr>
          <td align="center" style="background:${COLORS.mustard};padding:32px 24px;">
            <div style="${wordmarkStyle}">Compliments Only</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px;">
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:${COLORS.dietCoke};">${escapeHtml(input.heading)}</h1>
            <div style="font-size:16px;line-height:1.55;color:${COLORS.dietCoke};">${input.bodyHtml}</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 32px 36px;">
            <a href="${ctaUrl}" style="${ctaStyle}">${escapeHtml(input.cta.label)}</a>
            <div style="margin-top:18px;font-size:12px;color:${COLORS.dietCoke};opacity:0.55;">Or paste this link:<br><span style="word-break:break-all;">${escapeHtml(ctaUrl)}</span></div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;border-top:1px solid #ECE3C2;">
            <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:${COLORS.dietCoke};opacity:0.65;">${escapeHtml(input.footerNote)}</p>
          </td>
        </tr>
      </table>
      <div style="margin-top:16px;font-size:12px;color:${COLORS.dietCoke};opacity:0.5;">&copy; Compliments Only</div>
    </td>
  </tr>
</table>
</body>
</html>`;
}
