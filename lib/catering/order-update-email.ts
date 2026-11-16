/**
 * "Your catering order was updated" — the SERVER half (audit W22/B120; the rules and the template are pure, in
 * ./order-update-email-shared.ts, whose header lists every switch). NEW CUSTOMER EMAIL, SHIPPED CLOSED: it sends
 * only when the outbound-email switch is `live` AND both allowlists name the customer. Never throws — the order
 * change it reports has already committed, so the outcome is a value the caller records in its own audit row.
 * The recipient's address is never returned or logged.
 */
import { sendEmail } from "@/lib/email";
import { redactEmailAddresses } from "@/lib/email-redact";
import { portalOrigin } from "@/lib/portal/origin-shared";
import { TENANT_NAME } from "@/lib/tenant";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import {
  ORDER_UPDATE_EMAIL_ALLOWLIST_ENV,
  orderUpdateDelivery,
  renderOrderUpdateEmail,
  type OrderChange,
  type OrderUpdateSuppression,
} from "./order-update-email-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;

/** What happened. `sent` is the ONLY outcome in which an email left the building. */
export type OrderUpdateEmailOutcome =
  | { outcome: "sent" }
  | { outcome: "suppressed"; reason: OrderUpdateSuppression }
  | { outcome: "no_customer" | "no_address" | "no_changes" }
  | { outcome: "send_failed"; error: string };

/** The existing outbound-email switch (Reports → recipients). Unreadable or malformed = "off": closed. */
async function deliveryMode(sb: Sb): Promise<string> {
  const { data, error } = await sb.from("report_settings").select("value").eq("key", "digest_delivery_mode").maybeSingle<{ value: unknown }>();
  if (error || !data || typeof data.value !== "string") return "off";
  return data.value;
}

/**
 * Tell the customer what changed on their order. `quoteId` is the live revision the link opens; `idempotencyKey`
 * makes a retry of the same change send at most one email.
 */
export async function emailOrderUpdate(sb: Sb, args: {
  customerId: string | null;
  quoteId: string | null;
  changes: readonly OrderChange[];
  idempotencyKey: string;
}): Promise<OrderUpdateEmailOutcome> {
  try {
    if (args.changes.length === 0) return { outcome: "no_changes" };
    if (!args.customerId) return { outcome: "no_customer" };
    const { data: cust, error } = await sb.from("catering_customers").select("name, email").eq("id", args.customerId)
      .maybeSingle<{ name: string | null; email: string | null }>();
    if (error) return { outcome: "send_failed", error: "customer_read_failed" };
    const email = cust?.email?.trim().toLowerCase();
    if (!email) return { outcome: "no_address" };
    const decision = orderUpdateDelivery({
      deliveryMode: await deliveryMode(sb),
      allowlist: process.env[ORDER_UPDATE_EMAIL_ALLOWLIST_ENV],
      portalAllowlist: process.env.PORTAL_MAGIC_LINK_ALLOWLIST,
      email,
    });
    if (!decision.deliver) return { outcome: "suppressed", reason: decision.reason };
    const origin = portalOrigin();
    const mail = renderOrderUpdateEmail({
      name: cust?.name ?? null,
      tenantName: TENANT_NAME,
      changes: args.changes,
      orderUrl: origin && args.quoteId ? `${origin}/order/quote/${args.quoteId}` : null,
    });
    const res = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: args.idempotencyKey });
    if ("id" in res) return { outcome: "sent" };
    return { outcome: "send_failed", error: redactEmailAddresses(res.error) };
  } catch (e) {
    return { outcome: "send_failed", error: redactEmailAddresses(e instanceof Error ? e.message : String(e)) };
  }
}
