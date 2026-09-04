/**
 * Toast catering orders — PURE half (client-safe): lift order-level fields from the raw
 * `ordersBulk` payload, classify catering vs ezCater ring vs not, map to a pipeline lead.
 * Shapes pinned from a live probe 2026-09-04 (see tests). Money: Toast amounts are dollars.
 */
import { wrapMachineNotes } from "@/lib/catering/machine-notes-shared";

export interface ToastOrderItem { name: string; quantity: number; priceCents: number | null; voided: boolean }
export interface ToastOrderSummary {
  guid: string;
  businessDate: string | null;    // YYYY-MM-DD; null when Toast's businessDate didn't parse
  openedAt: string | null;
  modifiedAt: string | null;
  promisedAt: string | null;      // ISO as Toast sends it
  voided: boolean;
  voidedAt: string | null;        // ISO from raw.voidDate, when Toast records one
  source: string | null;
  diningOptionGuid: string | null;
  headcount: number | null;
  totalCents: number;             // sum of non-voided checks' totalAmount
  unparsedAmounts: number;        // count of non-voided checks whose totalAmount did not parse
  thirdPartyProvider: string | null; // name from thirdPartyProviderInfo, "unknown" if unnamed, null if absent
  customer: { name: string; phone: string | null; email: string | null } | null;
  deliveryAddress: string | null;
  items: ToastOrderItem[];
  specialRequests: string[];
}

const dollarsToCents = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

function businessDateYmd(v: unknown): string | null {
  const s = typeof v === "number" || typeof v === "string" ? String(v).trim() : "";
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function thirdPartyProvider(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return str(o.provider) ?? str(o.providerName) ?? str(o.name) ?? "unknown";
}

function address(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const line = [str(o.address1), str(o.address2)].filter(Boolean).join(" ");
  const cityState = [str(o.city), str(o.state)].filter(Boolean).join(", ");
  const tail = [cityState, str(o.zipCode)].filter(Boolean).join(" ");
  const base = [line, tail].filter(Boolean).join(", ");
  const notes = str(o.notes);
  if (!base) return null;
  return notes ? `${base} — ${notes}` : base;
}

export function extractToastOrders(json: unknown): ToastOrderSummary[] {
  if (!Array.isArray(json)) throw new Error("toast orders payload: expected an array of orders");
  const out: ToastOrderSummary[] = [];
  for (const raw of json as Array<Record<string, unknown>>) {
    const guid = str(raw?.guid);
    if (!guid) continue; // an order without a guid cannot be ledgered; skip, never poison the page
    const checks = Array.isArray(raw.checks) ? (raw.checks as Array<Record<string, unknown>>) : [];
    let totalCents = 0;
    let unparsedAmounts = 0;
    let customer: ToastOrderSummary["customer"] = null;
    const items: ToastOrderItem[] = [];
    const specialRequests: string[] = [];
    for (const c of checks) {
      const checkVoided = c.voided === true;
      if (!checkVoided) {
        const cents = dollarsToCents(c.totalAmount);
        if (cents === null) unparsedAmounts += 1; else totalCents += cents;
      }
      const cust = c.customer as Record<string, unknown> | null | undefined;
      if (!customer && cust && typeof cust === "object") {
        const name = [str(cust.firstName), str(cust.lastName)].filter(Boolean).join(" ");
        if (name) customer = { name, phone: str(cust.phone), email: str(cust.email) };
      }
      for (const s of (Array.isArray(c.selections) ? c.selections : []) as Array<Record<string, unknown>>) {
        const name = str(s.displayName) ?? "(unnamed)";
        const hasItem = !!(s.item && typeof s.item === "object" && str((s.item as Record<string, unknown>).guid));
        if (!hasItem) { if (s.selectionType === "SPECIAL_REQUEST" && str(s.displayName)) specialRequests.push(name); continue; }
        const quantity = typeof s.quantity === "number" && Number.isFinite(s.quantity) ? s.quantity : 1;
        items.push({ name, quantity, priceCents: dollarsToCents(s.price), voided: checkVoided || s.voided === true || raw.voided === true });
      }
    }
    out.push({
      guid,
      businessDate: businessDateYmd(raw.businessDate),
      openedAt: str(raw.openedDate),
      modifiedAt: str(raw.modifiedDate),
      promisedAt: str(raw.promisedDate),
      voided: raw.voided === true,
      voidedAt: str(raw.voidDate),
      source: str(raw.source),
      diningOptionGuid: str((raw.diningOption as Record<string, unknown> | null | undefined)?.guid),
      // Toast defaults online orders to 1 guest; a bare default would misread as a one-person
      // catering order, so only a real (>1) count counts as a headcount.
      headcount: typeof raw.numberOfGuests === "number" && raw.numberOfGuests > 1 ? raw.numberOfGuests : null,
      totalCents,
      unparsedAmounts,
      thirdPartyProvider: thirdPartyProvider(raw.thirdPartyProviderInfo),
      customer,
      deliveryAddress: address(raw.deliveryInfo),
      items,
      specialRequests,
    });
  }
  return out;
}

export type ToastOrderClass = "catering" | "ezcater" | "third_party" | "not_catering";
const norm = (s: string) => s.trim().toLowerCase();
/** The normalized form of Toast's own catering-module source string. */
export const TOAST_CATERING_SOURCE_NORM = "catering online ordering";
const isEz = (s: string | null) => !!s && norm(s).includes("ezcater");

/** Signals, in order: an ezCater name (dining option or third-party provider) → ezcater; any other
 *  named third-party provider → third_party (a real order, not ours to run — never a lead); the
 *  dining option NAME in the location's catering set, or Toast's own catering module → catering. */
export function classifyToastOrder(o: ToastOrderSummary, ctx: { diningOptionNames: ReadonlyMap<string, string>; cateringDiningOptions: readonly string[] }): ToastOrderClass {
  const name = o.diningOptionGuid ? ctx.diningOptionNames.get(o.diningOptionGuid) ?? null : null;
  if (isEz(o.thirdPartyProvider) || isEz(name)) return "ezcater";
  if (o.thirdPartyProvider) return "third_party";
  if (name && ctx.cateringDiningOptions.some((c) => norm(c) === norm(name))) return "catering";
  if (o.source && norm(o.source) === TOAST_CATERING_SOURCE_NORM) return "catering";
  return "not_catering";
}

/** ISO → ET calendar date + HH:MM (24h), pure via Intl. */
function etParts(iso: string): { date: string; time: string } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(/\s+/g, "");
  return { date, time };
}

export function toastOrderNotes(o: ToastOrderSummary, diningOptionName: string | null): string {
  const lines = o.items.map((it) => `• ${it.quantity}× ${it.name}${it.voided ? " (voided)" : ""}`);
  const total = `$${(o.totalCents / 100).toFixed(2)}`;
  const head = `Toast order ${o.guid} — ${[o.source, diningOptionName].filter(Boolean).join(" · ") || "order"} — auto-created from the catering scan.`;
  const promisedParts = o.promisedAt ? etParts(o.promisedAt) : null;
  const promised = promisedParts ? `Promised: ${promisedParts.date} ${promisedParts.time} ET` : "Promised: n/a";
  const specials = o.specialRequests.map((s) => `Special request: "${s}"`);
  return [head, `${promised} · Total: ${total}`, ...lines, ...specials].join("\n");
}

export interface ToastLeadFields {
  contact_name: string; contact_phone: string | null; company: null;
  event_date: string | null; time_window: string | null; headcount: number | null;
  estimated_revenue_cents: number; delivery_address: string | null;
  stage: "confirmed"; lead_source: "toast_catering"; external_ref: string; notes: string;
}

export function toastLeadFields(o: ToastOrderSummary, ctx: { diningOptionName: string | null }): ToastLeadFields {
  const promised = o.promisedAt ? etParts(o.promisedAt) : null;
  return {
    contact_name: o.customer?.name ?? `Toast order ${o.guid}`,
    contact_phone: o.customer?.phone ?? null,
    company: null,
    event_date: promised?.date ?? o.businessDate ?? null,
    time_window: promised?.time ?? null,
    headcount: o.headcount,
    estimated_revenue_cents: o.totalCents,
    delivery_address: o.deliveryAddress,
    stage: "confirmed",
    lead_source: "toast_catering",
    external_ref: `toast:${o.guid}`,
    notes: wrapMachineNotes("Toast order", toastOrderNotes(o, ctx.diningOptionName)),
  };
}

/** Instant-aware change test for a seen order: timestamps compare as instants (Postgres returns
 *  `2026-09-04T15:05:00+00:00`, Toast sends `2026-09-04T15:05:00.000+0000` — never string-equal). */
export function toastOrderChanged(prev: { modifiedAt: string | null; voided: boolean }, next: { modifiedAt: string | null; voided: boolean }): boolean {
  if (prev.voided !== next.voided) return true;
  const a = prev.modifiedAt ? Date.parse(prev.modifiedAt) : NaN;
  const b = next.modifiedAt ? Date.parse(next.modifiedAt) : NaN;
  if (Number.isNaN(a) && Number.isNaN(b)) return false;
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return a !== b;
}
