/**
 * Vendor-ordering OUTBOUND email adapter — the two-tap auto tier (Vendor Ordering V2 §3,
 * V2-D1/D3; §6 rows 1-2). SERVER-ONLY, service-role via lib/purchase-orders.ts's shared
 * placement core. The SERVER is the sole author of the email: the panel renders a preview
 * from `orderEmailPreview` and taps Send, but `sendOrderEmail` RE-DERIVES everything
 * server-side and never trusts a client-supplied body/recipients (untrusted-content law).
 *
 * ── THE FLOW ────────────────────────────────────────────────────────────────────────
 *   Confirm freezes confirmed_snapshot (unchanged, lib/purchase-orders.ts). For an
 *   auto-tier location the panel calls orderEmailPreview → shows to/from/subject/lines →
 *   Send → sendOrderEmail:
 *     1. re-load the CONFIRMED PO (409 `po_not_confirmed` otherwise; location-bind 404 mask),
 *     2. gate: 409 `email_dormant` when the auto leg isn't awake (alias × EMAIL_FROM domain),
 *     3. gate: 409 `no_email_target` when zero plausible email recipients,
 *     4. sendEmail(from=alias, replyTo=alias, to=[recipients]) — on {error}, throw a
 *        502-shaped `send_failed` and leave the PO CONFIRMED (manual affordances remain —
 *        no pipe failure blocks ordering),
 *     5. on success: audit `po.email_sent`, then recordPlacement (the ONE confirmed→placed
 *        machinery, channel email, target = joined recipients, provider_message_id = Resend
 *        id). A racing second tap loses recordPlacement's guarded flip → 409.
 *
 * ── ESCAPING ────────────────────────────────────────────────────────────────────────
 * Everything interpolated into the HTML passes escapeHtml (SKU names, item numbers, notes,
 * location name/address, PO code, vendor name) — the outbound side honors the same DOM law
 * as inbound render. The plain-text body is built separately (line-per-SKU), no HTML.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { TENANT_NAME } from "@/lib/tenant";
import { sendEmail } from "@/lib/email";
import { renderEmailLayout, escapeHtml } from "@/lib/email-templates/_layout";
import {
  PurchaseOrderError,
  PO_MIN,
  recordPlacement,
} from "@/lib/purchase-orders";
import { emailOrderingAvailable, isPlausibleEmail, type OrderEmailPreview } from "@/lib/po-email-shared";

// Re-export the pure gate + preview type so tests + server callers have one import site;
// the client (PoPanel) imports OrderEmailPreview from the shared leaf directly.
export { emailOrderingAvailable } from "@/lib/po-email-shared";
export type { OrderEmailPreview } from "@/lib/po-email-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new PurchaseOrderError(403, "forbidden", "Insufficient role level for ordering email");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

/** The confirmed_snapshot line shape (mirrors confirmPO's SnapshotLine; jsonb is
 *  untyped on read so we validate/narrow defensively at use). */
interface SnapshotLine {
  skuId: string;
  name: string;
  itemNumber: string | null;
  qty: number;
  unitLabel: string | null;
  priceCents: number | null;
  guidePos: number | null;
}

interface PoEmailContext {
  poId: string;
  locationId: string;
  displayCode: string;
  vendorName: string;
  locationName: string;
  locationAddress: string | null;
  receiptEmail: string | null;
  lines: SnapshotLine[];
  recipients: string[];
}

/**
 * Load the CONFIRMED PO + everything the email needs (KH+ + location-bind 404 mask).
 * 409 `po_not_confirmed` when not confirmed (a mis-tapped Confirm never emails; and only
 * a frozen snapshot is authoritative for what goes out). Recipients = ACTIVE email-method
 * ordering-detail values, plausible-email filtered + de-duped case-insensitively (V2-D3).
 */
async function loadPoEmailContext(actor: AuthContext, poId: string): Promise<PoEmailContext> {
  requireLevel(actor, PO_MIN);
  const sb: ServiceClient = getServiceRoleClient();

  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, location_id, vendor_id, display_code, status, confirmed_snapshot")
    .eq("id", poId)
    .maybeSingle<{
      id: string; location_id: string; vendor_id: string; display_code: string;
      status: string; confirmed_snapshot: unknown | null;
    }>();
  if (poErr) throw new Error(`loadPoEmailContext load: ${poErr.message}`);
  if (!po) throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  if (!lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  }
  if (po.status !== "confirmed") {
    throw new PurchaseOrderError(409, "po_not_confirmed", "Only a confirmed order can be emailed");
  }

  // Location (alias + ship-to) and the vendor's active email ordering details, batched.
  const [
    { data: loc, error: locErr },
    { data: orderingRows, error: orErr },
    { data: vend, error: vErr },
  ] = await Promise.all([
    sb.from("locations").select("name, address, receipt_email_address").eq("id", po.location_id)
      .maybeSingle<{ name: string; address: string | null; receipt_email_address: string | null }>(),
    sb.from("vendor_ordering_details")
      .select("method, value, display_order")
      .eq("vendor_id", po.vendor_id).eq("active", true).eq("method", "email")
      .order("display_order", { ascending: true })
      .returns<Array<{ method: string; value: string; display_order: number }>>(),
    sb.from("vendors").select("name").eq("id", po.vendor_id)
      .maybeSingle<{ name: string }>(),
  ]);
  if (locErr) throw new Error(`loadPoEmailContext location: ${locErr.message}`);
  if (orErr) throw new Error(`loadPoEmailContext ordering: ${orErr.message}`);
  if (vErr) throw new Error(`loadPoEmailContext vendor: ${vErr.message}`);

  // Recipients: plausible-email filtered + de-duped (case-insensitive). Invalid rows
  // are skipped — never a Resend recipient (§3: validated as plausible emails).
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const o of orderingRows ?? []) {
    const v = o.value.trim();
    if (!isPlausibleEmail(v)) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(v);
  }

  // Prefer the frozen snapshot's lines (authoritative). Fall back to nothing if the
  // snapshot is malformed — the caller's no-lines path never fabricates order content.
  const snapshot = (po.confirmed_snapshot ?? null) as { lines?: unknown } | null;
  const snapshotLines = snapshot?.lines;
  const rawLines: unknown[] = Array.isArray(snapshotLines) ? snapshotLines : [];
  const lines: SnapshotLine[] = rawLines
    .map((l): SnapshotLine | null => {
      if (typeof l !== "object" || l === null) return null;
      const r = l as Record<string, unknown>;
      const qty = typeof r.qty === "number" && Number.isFinite(r.qty) ? r.qty : 0;
      return {
        skuId: typeof r.skuId === "string" ? r.skuId : "",
        name: typeof r.name === "string" ? r.name : "(sku)",
        itemNumber: typeof r.itemNumber === "string" ? r.itemNumber : null,
        qty,
        unitLabel: typeof r.unitLabel === "string" ? r.unitLabel : null,
        priceCents: typeof r.priceCents === "number" && Number.isFinite(r.priceCents) ? r.priceCents : null,
        guidePos: typeof r.guidePos === "number" ? r.guidePos : null,
      };
    })
    .filter((l): l is SnapshotLine => l !== null && l.qty > 0); // qty 0 = removed (transmission skips)

  return {
    poId: po.id,
    locationId: po.location_id,
    displayCode: po.display_code,
    vendorName: vend?.name ?? "(vendor)",
    locationName: loc?.name ?? "",
    locationAddress: loc?.address ?? null,
    receiptEmail: loc?.receipt_email_address ?? null,
    lines,
    recipients,
  };
}

/** One order line as plain text: "  3 case · Sub Roll (#12345)". Item number only when
 *  present. No HTML — this is the text/plain body. */
function textLine(l: SnapshotLine): string {
  const unit = l.unitLabel ?? "";
  const qtyUnit = unit ? `${l.qty} ${unit}` : `${l.qty}`;
  const item = l.itemNumber ? ` (#${l.itemNumber})` : "";
  return `  ${qtyUnit} · ${l.name}${item}`;
}

/** Build the two bodies (text + html) from server-derived context. Everything that lands
 *  in HTML is escaped (escapeHtml) — SKU names/item numbers/location strings/PO code are
 *  vendor/config data but the outbound side escapes uniformly (DOM law). The plain-text
 *  body is a separate line-per-SKU render. The PO code is repeated in-body (V1 §5b.3 key). */
function renderBodies(ctx: PoEmailContext, subject: string): { textBody: string; htmlBody: string } {
  const shipToName = ctx.locationName || TENANT_NAME;
  const shipToLines = [shipToName, ctx.locationAddress ?? ""].filter((s) => s.trim().length > 0);

  // ── text/plain (required by Resend; the readable order) ──
  const textParts: string[] = [];
  textParts.push(`PO ${ctx.displayCode}`);
  textParts.push(`Order from ${TENANT_NAME} — ${shipToName}`);
  textParts.push("");
  textParts.push("Ship to:");
  for (const s of shipToLines) textParts.push(`  ${s}`);
  textParts.push("");
  textParts.push("Order:");
  for (const l of ctx.lines) textParts.push(textLine(l));
  textParts.push("");
  textParts.push(`Reply to this email (${ctx.receiptEmail ?? ""}) to confirm or ask about this order.`);
  const textBody = textParts.join("\n");

  // ── HTML (escaped throughout) ──
  const rowsHtml = ctx.lines
    .map((l) => {
      const unit = l.unitLabel ? escapeHtml(l.unitLabel) : "";
      const qtyUnit = unit ? `${escapeHtml(String(l.qty))} ${unit}` : escapeHtml(String(l.qty));
      const item = l.itemNumber
        ? `<span style="color:#666;"> · #${escapeHtml(l.itemNumber)}</span>`
        : "";
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ECE3C2;white-space:nowrap;font-weight:700;">${qtyUnit}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ECE3C2;">${escapeHtml(l.name)}${item}</td>
      </tr>`;
    })
    .join("");
  const shipToHtml = shipToLines.map((s) => `<div>${escapeHtml(s)}</div>`).join("");
  const bodyHtml = `
    <p style="margin:0 0 8px;"><strong>PO ${escapeHtml(ctx.displayCode)}</strong></p>
    <p style="margin:0 0 16px;">Order from ${escapeHtml(TENANT_NAME)} — ${escapeHtml(shipToName)}.</p>
    <div style="margin:0 0 16px;font-size:14px;color:#333;">
      <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.06em;font-size:12px;color:#666;">Ship to</div>
      ${shipToHtml}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px;">
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#666;">Reply to this email to confirm or ask about this order.</p>
  `;
  // renderEmailLayout requires a CTA; there's no destination for an order email, so we
  // reuse the PO code as a non-link label-in-body via the footer note and give the CTA a
  // benign mailto back to the store alias (a real, safe reply affordance). The layout
  // escapes the label + url itself.
  const replyUrl = ctx.receiptEmail ? `mailto:${ctx.receiptEmail}` : "mailto:";
  const htmlBody = renderEmailLayout({
    preheader: `Order ${ctx.displayCode} from ${TENANT_NAME} — ${shipToName}`,
    heading: subject,
    bodyHtml,
    cta: { label: "REPLY TO CONFIRM", url: replyUrl },
    footerNote: `PO ${ctx.displayCode}. Sent by ${TENANT_NAME} — ${shipToName}.`,
  });
  return { textBody, htmlBody };
}

/** The subject line: `Order {display_code} — {TENANT_NAME} {location.name}` (spec §3). */
function orderSubject(ctx: PoEmailContext): string {
  const shop = ctx.locationName ? ` ${ctx.locationName}` : "";
  return `Order ${ctx.displayCode} — ${TENANT_NAME}${shop}`;
}

/**
 * Build the exact email that WOULD be sent (KH+ + location-bind), for the panel's preview
 * card. Loads the confirmed PO (409 `po_not_confirmed` otherwise), derives to/from/replyTo
 * from the location alias + active email ordering details, and renders both bodies. Does
 * NOT gate on dormancy or empty recipients (the preview is informational — the send path
 * enforces those); `to` may be empty and from/replyTo may be "" when the alias is unset,
 * which the panel surfaces. NEVER mutates the PO.
 */
export async function orderEmailPreview(actor: AuthContext, poId: string): Promise<OrderEmailPreview> {
  const ctx = await loadPoEmailContext(actor, poId);
  const subject = orderSubject(ctx);
  const { textBody, htmlBody } = renderBodies(ctx, subject);
  const alias = ctx.receiptEmail?.trim() ?? "";
  return {
    to: ctx.recipients,
    from: alias,
    replyTo: alias,
    subject,
    textBody,
    htmlBody,
  };
}

/**
 * SEND the confirmed PO to its vendor by email, then place it (KH+ + location-bind). The
 * SERVER re-derives the whole email — the client's tap carries only poId. Gates (spec §3/§6):
 *   - 409 `po_not_confirmed` (via loadPoEmailContext) — a mis-tapped Confirm never emails.
 *   - 409 `email_dormant` when the auto leg isn't awake (alias × EMAIL_FROM domain).
 *   - 409 `no_email_target` when zero plausible recipients.
 *
 * FLIP-FIRST (V2-D1): the send runs INSIDE recordPlacement's transmit callback, AFTER the
 * guarded confirmed→placed flip. Two concurrent taps → one wins the flip and sends; the
 * loser 409s (`already_placed`/`not_confirmed`) having emailed NOTHING. On sendEmail
 * {error} the callback throws 502 `send_failed`; recordPlacement reverts the claim, so
 * the PO is back to confirmed with no transmission row (manual affordances remain — no
 * pipe failure blocks ordering). `po.email_sent` audits after success (fail-open).
 * Returns the Resend id.
 */
export async function sendOrderEmail(actor: AuthContext, poId: string): Promise<{ providerMessageId: string }> {
  const ctx = await loadPoEmailContext(actor, poId);

  // DORMANCY gate (server re-check; UI hides but the server is authoritative — §6 row 2).
  // Both gates run BEFORE the flip: a dormant/no-target send never touches PO status.
  if (!emailOrderingAvailable(ctx.receiptEmail, process.env.EMAIL_FROM ?? null)) {
    throw new PurchaseOrderError(409, "email_dormant", "Automatic email ordering is not enabled for this location");
  }
  // NO recipients → nothing to send (V2-D3).
  if (ctx.recipients.length === 0) {
    throw new PurchaseOrderError(409, "no_email_target", "This vendor has no email address on file for orders");
  }

  const alias = ctx.receiptEmail!.trim(); // non-empty (guaranteed by emailOrderingAvailable)
  const subject = orderSubject(ctx);
  const { textBody, htmlBody } = renderBodies(ctx, subject);
  const target = ctx.recipients.join(", ");
  let sentId = "";

  // The ONE confirmed→placed machinery (lib/purchase-orders.ts) — flip first, then the
  // callback transmits; claim reverted + error rethrown when the callback throws.
  await recordPlacement(
    actor, poId,
    { channel: "email", target, note: null },
    async () => {
      const result = await sendEmail({
        to: ctx.recipients,
        from: alias,
        replyTo: alias,
        subject,
        html: htmlBody,
        text: textBody,
      });
      if ("error" in result) {
        throw new PurchaseOrderError(502, "send_failed", `Vendor email failed to send: ${result.error}`);
      }
      sentId = result.id;
      return { providerMessageId: result.id };
    },
  );

  // Send + placement both durable — audit the email leg (fail-open, never blocks).
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "po.email_sent", resourceTable: "purchase_orders", resourceId: poId,
    metadata: {
      location_id: ctx.locationId,
      to: ctx.recipients,
      from: alias,
      provider_message_id: sentId,
      recipient_count: ctx.recipients.length,
    },
    ipAddress: null, userAgent: null,
  });

  return { providerMessageId: sentId };
}
