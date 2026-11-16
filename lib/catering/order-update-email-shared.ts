/**
 * "Your catering order was updated" — the customer email that shows WHAT CHANGED, old vs new (audit W22/B120,
 * owner decision W22-1 a + note: a date change updates the quote page AND emails the customer; any order
 * update → a customer email showing old vs new). The PURE half: the delivery decision and the template.
 * Zero I/O, no server import (client-safe; the server half is ./order-update-email.ts).
 *
 * THIS IS A NEW OUTBOUND CUSTOMER EMAIL, AND IT SHIPS CLOSED. Nothing is sent unless EVERY switch is open
 * (`orderUpdateDelivery`); the first closed one is the recorded reason:
 *   1. the outbound-email switch that already governs digests, exports and staff confirmations
 *      (`report_settings.digest_delivery_mode`, Reports → recipients) is `live` — `off` (the shipped
 *      default) and `preview` send nothing (`email_off`);
 *   2. the env allowlist `CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST` names the recipient — UNSET or empty =
 *      closed to everyone (no default recipient), `*` = every customer, `a@x.com,b@y.com` = exactly those
 *      (`allowlist_closed` / `not_allowlisted`);
 *   3. the existing customer-email allowlist every portal email respects (`PORTAL_MAGIC_LINK_ALLOWLIST`,
 *      lib/portal/magic-link-shared.ts — its own default applies when unset) names the recipient
 *      (`portal_allowlist`).
 * Whatever the outcome, the caller records it in its own audit row; the address is never logged.
 */
import { allowlistMatches } from "@/lib/portal/magic-link-shared";
import { formatCents, formatDateLongWithWeekday } from "@/lib/i18n/format";

/** The env var holding this email's recipient allowlist (see the header). */
export const ORDER_UPDATE_EMAIL_ALLOWLIST_ENV = "CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST";

export type OrderUpdateSuppression = "email_off" | "allowlist_closed" | "not_allowlisted" | "portal_allowlist";

export interface OrderUpdateDeliveryInput {
  /** `report_settings.digest_delivery_mode`. Anything but "live" sends nothing. */
  deliveryMode: string | null | undefined;
  /** The raw CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST (undefined = unset). */
  allowlist: string | undefined;
  /** The raw PORTAL_MAGIC_LINK_ALLOWLIST (undefined = unset → that list's own default). */
  portalAllowlist: string | undefined;
  /** The recipient. */
  email: string;
}

/** THE delivery decision. Closed unless every switch is open; the first closed switch is the reason. */
export function orderUpdateDelivery(input: OrderUpdateDeliveryInput): { deliver: true } | { deliver: false; reason: OrderUpdateSuppression } {
  if (input.deliveryMode !== "live") return { deliver: false, reason: "email_off" };
  const list = input.allowlist?.trim() ?? "";
  if (list === "") return { deliver: false, reason: "allowlist_closed" };
  // Given an explicit string, allowlistMatches never falls back to its own default recipient.
  if (!allowlistMatches(list, input.email)) return { deliver: false, reason: "not_allowlisted" };
  if (!allowlistMatches(input.portalAllowlist, input.email)) return { deliver: false, reason: "portal_allowlist" };
  return { deliver: true };
}

/** One changed field, as the customer reads it. Labels and values are plain text (escaped on render). */
export interface OrderChange {
  label: string;
  from: string;
  to: string;
}

/** "Friday, November 20, 2026" — the customer emails' long date (the portal is English-only by design). */
export function orderDateLong(yyyymmdd: string | null): string {
  return yyyymmdd ? formatDateLongWithWeekday(yyyymmdd, "en") : "No date set";
}

/** "$1,234.50". */
export function orderMoney(cents: number): string {
  return formatCents(cents, "en");
}

/** What changed between two views of one order (only the fields that differ, in a fixed order). */
export function orderChanges(before: { eventDate: string | null; headcount?: number | null; totalCents?: number | null },
  after: { eventDate: string | null; headcount?: number | null; totalCents?: number | null }): OrderChange[] {
  const out: OrderChange[] = [];
  if (before.eventDate !== after.eventDate) out.push({ label: "Event date", from: orderDateLong(before.eventDate), to: orderDateLong(after.eventDate) });
  if (after.headcount !== undefined && before.headcount !== undefined && before.headcount !== after.headcount) {
    out.push({ label: "Guests", from: before.headcount == null ? "Not set" : String(before.headcount), to: after.headcount == null ? "Not set" : String(after.headcount) });
  }
  if (after.totalCents != null && before.totalCents != null && before.totalCents !== after.totalCents) {
    out.push({ label: "Estimated total", from: orderMoney(before.totalCents), to: orderMoney(after.totalCents) });
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export interface OrderUpdateEmailInput {
  /** The customer's name (customer-supplied → escaped). */
  name: string | null;
  tenantName: string;
  changes: readonly OrderChange[];
  /** The order page (sign-in required), or null when no portal origin is configured. */
  orderUrl: string | null;
}

/** The message. Plain sentences, the old → new table, the order link. HTML values are escaped. */
export function renderOrderUpdateEmail(input: OrderUpdateEmailInput): { subject: string; html: string; text: string } {
  const who = input.name?.trim() || "there";
  const subject = `Your catering order was updated — ${input.tenantName}`;
  const rowsText = input.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("\n");
  const rowsHtml = input.changes
    .map((c) => `<tr><td style="padding:4px 12px 4px 0;font-weight:700;">${esc(c.label)}</td><td style="padding:4px 12px 4px 0;text-decoration:line-through;">${esc(c.from)}</td><td style="padding:4px 0;font-weight:700;">${esc(c.to)}</td></tr>`)
    .join("");
  const linkText = input.orderUrl ? `\n\nView your order: ${input.orderUrl} (sign-in required).` : "";
  const linkHtml = input.orderUrl ? `<p>View your order: <a href="${esc(input.orderUrl)}">${esc(input.orderUrl)}</a> (sign-in required).</p>` : "";
  const text = `Hi ${who},\n\nWe updated your catering order. Here's what changed:\n\n${rowsText}\n\nEverything else on your order stays the same.${linkText}\n\nIf this doesn't look right, reply to this email and we'll sort it out.`;
  const html = `<p>Hi ${esc(who)},</p><p>We updated your catering order. Here's what changed:</p>`
    + `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;"><tr><th style="text-align:left;padding:4px 12px 4px 0;"></th><th style="text-align:left;padding:4px 12px 4px 0;">Was</th><th style="text-align:left;padding:4px 0;">Now</th></tr>${rowsHtml}</table>`
    + `<p>Everything else on your order stays the same.</p>${linkHtml}<p>If this doesn't look right, reply to this email and we'll sort it out.</p>`;
  return { subject, html, text };
}
