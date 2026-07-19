/**
 * Order-confirmation email — Portal-3 (customer catering order submission).
 *
 * Sent (best-effort, allowlist-gated) after a customer submits a self-serve catering
 * order. The order is a REQUEST, not a confirmed booking: staff review + confirm within
 * ~24h, and a deposit reserves the date. No payment link is included yet — payment is
 * deferred behind the provider-agnostic seam. The required CTA points at the app root
 * (a neutral "view your order" affordance), NOT a pay/checkout URL.
 *
 * Mirrors lib/email-templates/magic-link.ts: returns the HTML string directly via
 * renderEmailLayout. Cents→USD formatting is inline (no shared money formatter in the
 * email layer).
 */

import { renderEmailLayout, appUrl, escapeHtml } from "./_layout";

function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface OrderConfirmationInput {
  name: string;
  eventDateLabel: string;
  totalCents: number;
  depositCents: number;
}

export function renderOrderConfirmationEmail(input: OrderConfirmationInput): string {
  const total = centsToUsd(input.totalCents);
  const deposit = centsToUsd(input.depositCents);
  return renderEmailLayout({
    preheader: "We received your catering order — pending our team's confirmation.",
    heading: "Order received — pending our team's confirmation",
    bodyHtml: `
      <p style="margin:0 0 16px;">Hi ${escapeHtml(input.name)}, thanks for your catering request for <strong>${escapeHtml(input.eventDateLabel)}</strong>. We've received it and our team will review the details.</p>
      <p style="margin:0 0 16px;">Estimated total: <strong>${total}</strong>. A <strong>${deposit}</strong> deposit reserves the date.</p>
      <p style="margin:0;">We'll confirm within about 24 hours. If we're not able to do your date, your deposit is refunded in full.</p>
    `,
    cta: { label: "VIEW YOUR ORDER", url: appUrl() },
    footerNote:
      "This is a request, not a confirmed booking — we'll be in touch shortly to confirm the details.",
  });
}
