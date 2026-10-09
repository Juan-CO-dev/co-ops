/**
 * Toast orders → customer ingest rows — PURE (client-safe, zero I/O). 0234.
 *
 * Reads `check.customer` (Toast's guest fields, scope guest.pi:read; present mostly on online / app /
 * takeout orders) and `payment.cardType` + `payment.last4Digits`. Everything else on the raw payload
 * is ignored: no address, no notes, no free text, no PAN (Toast sends none; a longer number would be
 * refused, never truncated).
 *
 * Third-party orders (DoorDash, Uber Eats, Grubhub…) carry relay contacts: the phone is dropped (relay
 * numbers look real), the email is kept only if it is not a known relay, and the order is flagged
 * `contact_masked` with the marketplace named on the profile instead.
 */
import { cardBrand, cardLast4, classifyEmail, normalizePhoneE164, type CardRef } from "./identity-shared";

export const CUSTOMER_CHANNELS = ["dine_in", "takeout", "online", "app", "delivery", "third_party", "catering", "unknown"] as const;
export type CustomerChannel = (typeof CUSTOMER_CHANNELS)[number];
export type ToastCustomerSource = "toast_pos" | "toast_online" | "toast_app" | "toast_third_party";

export interface CustomerIngestRow {
  order_guid: string;
  business_date: string;
  seen_at: string | null;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  source: ToastCustomerSource;
  channel: CustomerChannel;
  total_cents: number | null;
  items: { name: string; qty: number }[];
  cards: CardRef[];
  contact_masked: boolean;
  masked_channel: string | null;
}

export interface ExtractSummary { rows: CustomerIngestRow[]; noContact: number; maskedOnly: number; voided: number }

type Row = Record<string, unknown>;
const obj = (x: unknown): Row => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Row) : {});
const arr = (x: unknown): Row[] => (Array.isArray(x) ? x.map(obj) : []);
const text = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

function ymd(x: unknown): string | null {
  const s = typeof x === "number" || typeof x === "string" ? String(x).trim() : "";
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function cents(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** "Uber Eats" → "ubereats". A marketplace slug, never free text. */
export function channelSlug(x: unknown): string | null {
  const s = typeof x === "string" ? x.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
  return s ? s.slice(0, 40) : null;
}

export function sourceForChannel(channel: CustomerChannel, thirdParty: boolean): ToastCustomerSource {
  if (thirdParty || channel === "third_party") return "toast_third_party";
  if (channel === "online") return "toast_online";
  if (channel === "app") return "toast_app";
  return "toast_pos";
}

/**
 * @param channelFor the reviewed channel of an order's dining option (sales_channel_map), or "unknown".
 */
export function extractCustomerRows(rawOrders: readonly unknown[], channelFor: (diningOptionGuid: string | null) => CustomerChannel): ExtractSummary {
  const out: ExtractSummary = { rows: [], noContact: 0, maskedOnly: 0, voided: 0 };
  for (const rawOrder of rawOrders) {
    const order = obj(rawOrder);
    const guid = text(order.guid);
    const businessDate = ymd(order.businessDate);
    if (!guid || !businessDate) continue;
    if (order.voided === true || order.deleted === true) { out.voided++; continue; }
    const checks = arr(order.checks).filter((c) => c.deleted !== true && c.voided !== true);
    const customer = checks.map((c) => obj(c.customer)).find((c) => Object.keys(c).length > 0) ?? {};
    const provider = obj(order.thirdPartyProviderInfo);
    const providerName = text(provider.provider) ?? text(provider.providerName) ?? text(provider.name);
    const thirdParty = Object.keys(provider).length > 0;
    const channel = channelFor(text(obj(order.diningOption).guid));
    const isThirdParty = thirdParty || channel === "third_party";

    const emailClass = classifyEmail(customer.email);
    let email = emailClass.kind === "ok" ? emailClass.email : null;
    let phone = normalizePhoneE164(customer.phone);
    let masked = emailClass.kind === "masked";
    if (isThirdParty && phone) { phone = null; masked = true; }
    if (isThirdParty && emailClass.kind === "masked") email = null;
    const first = text(customer.firstName);
    const last = text(customer.lastName);
    const full = [first, last].filter(Boolean).join(" ") || null;
    if (!email && !phone) {
      if (masked) out.maskedOnly++; else out.noContact++;
      continue;
    }

    let total: number | null = 0;
    const items = new Map<string, number>();
    const cards = new Map<string, CardRef>();
    for (const check of checks) {
      const t = cents(check.totalAmount);
      total = t === null || total === null ? null : total + t;
      for (const s of arr(check.selections)) {
        if (s.voided === true || s.deleted === true) continue;
        if (!text(obj(s.item).guid)) continue; // notes have no item identity and never leave this function
        const name = text(s.displayName);
        const qty = typeof s.quantity === "number" && Number.isFinite(s.quantity) ? s.quantity : 1;
        if (name) items.set(name.slice(0, 120), (items.get(name.slice(0, 120)) ?? 0) + qty);
      }
      for (const p of arr(check.payments)) {
        if (p.paymentStatus === "VOIDED" || p.refundStatus === "FULL") continue;
        const brand = cardBrand(p.cardType);
        const last4 = cardLast4(p.last4Digits);
        if (brand && last4) cards.set(`${brand}:${last4}`, { brand, last4 });
      }
    }
    const maskedChannel = masked ? channelSlug(providerName) ?? (emailClass.kind === "masked" ? channelSlug(String(customer.email).split("@")[1]?.split(".")[0]) : null) ?? "third_party" : null;
    out.rows.push({
      order_guid: guid,
      business_date: businessDate,
      seen_at: text(order.openedDate),
      email,
      phone,
      full_name: full ? full.slice(0, 200) : null,
      first_name: first ? first.slice(0, 100) : null,
      last_name: last ? last.slice(0, 100) : null,
      source: sourceForChannel(channel, thirdParty),
      channel: isThirdParty ? "third_party" : channel,
      total_cents: total,
      items: [...items].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 50).map(([name, qty]) => ({ name, qty })),
      cards: [...cards.values()],
      contact_masked: masked,
      masked_channel: maskedChannel,
    });
  }
  return out;
}

/** The reviewed channel map → a pure lookup. Unknown/unreviewed labels are "unknown", never guessed. */
export function channelLookup(
  dining: readonly { guid: string; name: string }[],
  channels: readonly { dining_option_label: string; channel: string; reviewed_at: string | null }[],
): (guid: string | null) => CustomerChannel {
  const byGuid = new Map(dining.map((d) => [d.guid, d.name]));
  const byLabel = new Map(channels.map((c) => [c.dining_option_label, c]));
  return (guid) => {
    const label = guid ? byGuid.get(guid) : undefined;
    const row = label ? byLabel.get(label) : undefined;
    if (!row?.reviewed_at) return "unknown";
    return (CUSTOMER_CHANNELS as readonly string[]).includes(row.channel) ? (row.channel as CustomerChannel) : "unknown";
  };
}
