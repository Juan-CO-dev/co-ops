/** Pure, explicit allowlist for the accounting capture. Never retain a raw object. */
type Row = Record<string, unknown>;
const obj = (x: unknown): Row => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
const text = (x: unknown): string | null => typeof x === "string" && x.trim() ? x : null;
const guid = (x: unknown): string | null => text(obj(x).guid);
const required = (x: unknown): string => { const s = text(x); if (!s) throw new Error("toast_capture_missing_guid"); return s; };
const rows = (x: unknown): Row[] => {
  if (x == null) return [];
  if (!Array.isArray(x)) throw new Error("toast_capture_invalid_array");
  return x.map(obj);
};
export function captureBusinessDate(x: unknown): string | null {
  const s = String(x ?? "").replace(/-/g, "");
  if (!/^\d{8}$/.test(s)) return null;
  const ymd = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  const date = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === ymd ? ymd : null;
}
function instant(x: unknown): string | null {
  if (x == null || x === "") return null;
  if (typeof x !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/.test(x)) throw new Error("toast_capture_invalid_timestamp");
  const d = new Date(x);
  if (!Number.isFinite(d.valueOf())) throw new Error("toast_capture_invalid_timestamp");
  return d.toISOString();
}
export function captureCents(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === "number" ? x : typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : NaN;
  const cents = Math.round((n + Math.sign(n) * Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("toast_capture_invalid_money");
  return cents;
}
function date(x: unknown): string | null {
  if (x == null || x === 0 || x === "0") return null;
  const value = captureBusinessDate(x);
  if (!value) throw new Error("toast_capture_invalid_business_date");
  return value;
}
export interface ToastCapturedOrder {
  order: { order_guid: string; business_date: string; opened_at: string | null; closed_at: string | null; paid_at: string | null; modified_at: string | null; promised_at: string | null; source: string | null; revenue_center_guid: string | null; dining_option_guid: string | null; server_guid: string | null; deleted: boolean; voided: boolean; excess_food: boolean; third_party_provider_guid: string | null; };
  checks: { check_guid: string; amount_cents: number | null; tax_cents: number | null; total_cents: number | null; voided: boolean }[];
  discounts: { check_guid: string; ordinal: number; selection_guid: string | null; applied_discount_guid: string | null; discount_guid: string | null; name: string | null; amount_cents: number | null; reason_guid: string | null; reason_name: string | null; approver_guid: string | null }[];
  service_charges: { check_guid: string; ordinal: number; service_charge_guid: string | null; name: string | null; amount_cents: number | null; gratuity: boolean; taxable: boolean }[];
  payments: { check_guid: string; payment_guid: string; type: string | null; amount_cents: number | null; tip_cents: number | null; paid_business_date: string | null; refund_amount_cents: number | null; refund_tip_cents: number | null; refund_business_date: string | null; void_business_date: string | null; server_guid: string | null }[];
}
export function normalizeToastOrder(input: unknown, businessDate: string): ToastCapturedOrder {
  const raw = obj(input);
  const business_date = date(raw.businessDate);
  if (!business_date || business_date !== businessDate) throw new Error("toast_capture_business_date_mismatch");
  const provider = obj(raw.thirdPartyProviderInfo);
  const result: ToastCapturedOrder = {
    order: { order_guid: required(raw.guid), business_date, opened_at: instant(raw.openedDate), closed_at: instant(raw.closedDate), paid_at: instant(raw.paidDate), modified_at: instant(raw.modifiedDate), promised_at: instant(raw.promisedDate), source: text(raw.source), revenue_center_guid: guid(raw.revenueCenter), dining_option_guid: guid(raw.diningOption), server_guid: guid(raw.server), deleted: raw.deleted === true, voided: raw.voided === true, excess_food: raw.excessFood === true, third_party_provider_guid: guid(provider) },
    checks: [], discounts: [], service_charges: [], payments: [],
  };
  for (const check of rows(raw.checks)) {
    const check_guid = required(check.guid);
    result.checks.push({ check_guid, amount_cents: captureCents(check.amount), tax_cents: captureCents(check.taxAmount), total_cents: captureCents(check.totalAmount), voided: check.voided === true });
    let ordinal = 0;
    const discounts = (owner: Row, selection_guid: string | null) => {
      for (const d of rows(owner.appliedDiscounts)) result.discounts.push({ check_guid, ordinal: ordinal++, selection_guid, applied_discount_guid: text(d.guid), discount_guid: guid(d.discount), name: text(d.name), amount_cents: captureCents(d.discountAmount ?? d.amount), reason_guid: guid(obj(d.appliedDiscountReason).discountReason) ?? guid(d.appliedDiscountReason) ?? guid(d.reason), reason_name: text(obj(d.appliedDiscountReason).name), approver_guid: guid(d.approver) });
    };
    discounts(check, null);
    const selections = (items: unknown) => { for (const s of rows(items)) { discounts(s, required(s.guid)); selections(s.modifiers); } };
    selections(check.selections);
    for (const [index, s] of rows(check.appliedServiceCharges).entries()) result.service_charges.push({ check_guid, ordinal: index, service_charge_guid: guid(s.serviceCharge) ?? text(s.guid), name: text(s.name), amount_cents: captureCents(s.chargeAmount ?? s.amount), gratuity: s.gratuity === true, taxable: s.taxable === true });
    for (const p of rows(check.payments)) {
      const refund = obj(p.refund);
      result.payments.push({ check_guid, payment_guid: required(p.guid), type: text(p.type), amount_cents: captureCents(p.amount), tip_cents: captureCents(p.tipAmount), paid_business_date: date(p.paidBusinessDate), refund_amount_cents: captureCents(refund.refundAmount ?? refund.amount), refund_tip_cents: captureCents(refund.tipRefundAmount), refund_business_date: date(refund.refundBusinessDate), void_business_date: date(p.voidBusinessDate), server_guid: guid(p.server) });
    }
  }
  return result;
}


