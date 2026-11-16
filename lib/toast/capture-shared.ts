export interface CaptureSelection {
  check_guid: string;
  selection_guid: string;
  parent_selection_guid: string | null;
  item_guid: string;
  name: string;
  quantity: number;
  voided: boolean;
  deleted: boolean;
}

import { projectCheckSales, projectSalesRefunds, type CheckSalesAccounting } from "./sales-accounting-shared";
import { captureCents, lineCents } from "./money-shared";
import { checkLinePrices, lineFields, type CheckLinePrices, type LinePriceFields } from "./line-prices-shared";

export { captureCents };
/** A captured selection with TOAST_LINE_PRICES on: the eight original keys, then §3.1's fields. */
export type PricedCaptureSelection = CaptureSelection & Partial<LinePriceFields>;
/** Accounting with TOAST_LINE_PRICES on: the six original keys, then the per-check flags. */
export type CapturedCheckAccounting = CheckSalesAccounting & { line_prices?: CheckLinePrices };
/** Passed in by the server capture (`TOAST_LINE_PRICES=1`); a -shared module never reads env. */
export interface NormalizeOptions { linePrices?: boolean }

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
function date(x: unknown): string | null {
  if (x == null || x === 0 || x === "0") return null;
  const value = captureBusinessDate(x);
  if (!value) throw new Error("toast_capture_invalid_business_date");
  return value;
}
export interface ToastCapturedOrder {
  order: { order_guid: string; business_date: string; opened_at: string | null; closed_at: string | null; paid_at: string | null; modified_at: string | null; promised_at: string | null; source: string | null; revenue_center_guid: string | null; dining_option_guid: string | null; server_guid: string | null; deleted: boolean; voided: boolean; excess_food: boolean; third_party_provider_guid: string | null; third_party_provider_name: string | null; selection_units: PricedCaptureSelection[]; };
  checks: { check_guid: string; amount_cents: number | null; tax_cents: number | null; total_cents: number | null; voided: boolean; deleted: boolean; accounting: CapturedCheckAccounting }[];
  discounts: { check_guid: string; ordinal: number; selection_guid: string | null; applied_discount_guid: string | null; discount_guid: string | null; name: string | null; amount_cents: number | null; reason_guid: string | null; reason_name: string | null; approver_guid: string | null }[];
  service_charges: { check_guid: string; ordinal: number; service_charge_guid: string | null; name: string | null; amount_cents: number | null; gratuity: boolean; taxable: boolean }[];
  payments: { check_guid: string; payment_guid: string; payment_status: string | null; refund_status: string | null; type: string | null; amount_cents: number | null; tip_cents: number | null; paid_business_date: string | null; refund_amount_cents: number | null; refund_tip_cents: number | null; refund_business_date: string | null; void_business_date: string | null; server_guid: string | null; sales_refund_cents: number | null }[];
}
export function normalizeToastOrder(input: unknown, businessDate: string, options: NormalizeOptions = {}): ToastCapturedOrder {
  const linePrices = options.linePrices === true;
  const raw = obj(input);
  const business_date = date(raw.businessDate);
  if (!business_date || business_date !== businessDate) throw new Error("toast_capture_business_date_mismatch");
  const provider = obj(raw.thirdPartyProviderInfo);
  const result: ToastCapturedOrder = {
    order: { order_guid: required(raw.guid), business_date, opened_at: instant(raw.openedDate), closed_at: instant(raw.closedDate), paid_at: instant(raw.paidDate), modified_at: instant(raw.modifiedDate), promised_at: instant(raw.promisedDate), source: text(raw.source), revenue_center_guid: guid(raw.revenueCenter), dining_option_guid: guid(raw.diningOption), server_guid: guid(raw.server), deleted: raw.deleted === true, voided: raw.voided === true, excess_food: raw.excessFood === true, third_party_provider_guid: guid(provider), third_party_provider_name: text(provider.provider) ?? text(provider.providerName) ?? text(provider.name), selection_units: [] },
    checks: [], discounts: [], service_charges: [], payments: [],
  };
  for (const check of rows(raw.checks)) {
    const check_guid = required(check.guid);
    const accounting: CapturedCheckAccounting = linePrices ? projectCheckSales(check, captureCents, lineCents) : projectCheckSales(check, captureCents);
    if (linePrices) accounting.line_prices = checkLinePrices(check, accounting, captureCents);
    result.checks.push({ check_guid, amount_cents: captureCents(check.amount), tax_cents: captureCents(check.taxAmount), total_cents: captureCents(check.totalAmount), voided: check.voided === true, deleted: check.deleted === true, accounting });
    const salesRefunds = projectSalesRefunds(check, captureCents, captureBusinessDate);
    let ordinal = 0;
    const discounts = (owner: Row, selection_guid: string | null) => {
      for (const d of rows(owner.appliedDiscounts)) result.discounts.push({ check_guid, ordinal: ordinal++, selection_guid, applied_discount_guid: text(d.guid), discount_guid: guid(d.discount), name: text(d.name), amount_cents: captureCents(d.discountAmount ?? d.amount), reason_guid: guid(obj(d.appliedDiscountReason).discountReason) ?? guid(d.appliedDiscountReason) ?? guid(d.reason), reason_name: text(obj(d.appliedDiscountReason).name), approver_guid: guid(d.approver) });
    };
    discounts(check, null);
    const selections = (items: unknown, parent: string | null, ancestorVoided: boolean, ancestorDeleted: boolean) => {
      for (const s of rows(items)) {
        const selection_guid = required(s.guid);
        discounts(s, selection_guid);
        const item_guid = guid(s.item);
        const voided = ancestorVoided || s.voided === true;
        const deleted = ancestorDeleted || s.deleted === true;
        // Notes have no item identity: never retain their free-text displayName.
        if (item_guid) {
          if (typeof s.quantity !== "number" || !Number.isFinite(s.quantity)) throw new Error("toast_capture_invalid_quantity");
          result.order.selection_units.push({ check_guid, selection_guid, parent_selection_guid: parent,
            item_guid, name: text(s.displayName) ?? item_guid, quantity: s.quantity, voided, deleted, ...(linePrices ? lineFields(s) : {}) });
        }
        selections(s.modifiers, selection_guid, voided, deleted);
      }
    };
    selections(check.selections, null, result.order.voided || check.voided === true, result.order.deleted || check.deleted === true);
    for (const [index, s] of rows(check.appliedServiceCharges).entries()) result.service_charges.push({ check_guid, ordinal: index, service_charge_guid: guid(s.serviceCharge) ?? text(s.guid), name: text(s.name), amount_cents: captureCents(s.chargeAmount ?? s.amount), gratuity: s.gratuity === true, taxable: s.taxable === true });
    for (const p of rows(check.payments)) {
      const refund = obj(p.refund);
      result.payments.push({ check_guid, payment_guid: required(p.guid), payment_status: text(p.paymentStatus), refund_status: text(p.refundStatus), type: text(p.type), amount_cents: captureCents(p.amount), tip_cents: captureCents(p.tipAmount), paid_business_date: date(p.paidBusinessDate), refund_amount_cents: captureCents(refund.refundAmount ?? refund.amount), refund_tip_cents: captureCents(refund.tipRefundAmount), refund_business_date: date(refund.refundBusinessDate), void_business_date: date(obj(p.voidInfo).voidBusinessDate), server_guid: guid(p.server), sales_refund_cents: salesRefunds.get(required(p.guid)) ?? null });
    }
  }
  return result;
}

/** The content_hash input, rebuilt over main's field set only (item 1 PR B, plan r3 §1): every
 * selection keeps exactly its eight original keys and every accounting its six, in their original
 * order. Line prices therefore never re-hash an unchanged order, so they never create a snapshot,
 * never detach an ezCater link and never move a report. The frozen golden pins it. */
export function legacyHashInput(order: ToastCapturedOrder): ToastCapturedOrder {
  return {
    ...order,
    order: { ...order.order, selection_units: order.order.selection_units.map((s) => ({
      check_guid: s.check_guid, selection_guid: s.selection_guid, parent_selection_guid: s.parent_selection_guid,
      item_guid: s.item_guid, name: s.name, quantity: s.quantity, voided: s.voided, deleted: s.deleted })) },
    checks: order.checks.map((c) => ({ ...c, accounting: {
      version: c.accounting.version, gross_cents: c.accounting.gross_cents, discounts_comps_cents: c.accounting.discounts_comps_cents,
      voids_cents: c.accounting.voids_cents, service_charges_cents: c.accounting.service_charges_cents,
      pre_refund_cents: c.accounting.pre_refund_cents } })),
  };
}

// ---- The canonical content_hash input (Toast churn fix, PR 1, plan r2 §1). ----
// Toast returns the same order with its arrays in different orders. The legacy input hashed them as
// returned, so one unchanged order produced many hashes, each a new toast_orders snapshot (~342k extra
// rows of 501k in prod) that detached the ezCater links joined on the latest one. The canonical input
// is legacyHashInput's exact field set, every object rebuilt with an EXPLICIT key list in the legacy
// key order, every collection sorted on a COPY by an ordinal-free comparator, duplicates kept, and the
// synthetic discount / service-charge ordinals reassigned 0..k-1 per check AFTER sorting. An order
// already in that order serializes byte-identically to legacyHashInput, so it keeps its legacy hash.
type Sel = CaptureSelection;
type Check = ToastCapturedOrder["checks"][number];
type Discount = ToastCapturedOrder["discounts"][number];
type Charge = ToastCapturedOrder["service_charges"][number];
type Payment = ToastCapturedOrder["payments"][number];
type Scalar = string | number | boolean | null;

/** Nulls first, then code-unit order (never locale), numbers numerically, false before true. */
function cmp(a: Scalar, b: Scalar): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const chain = (...xs: number[]) => xs.find((x) => x !== 0) ?? 0;
const sortedCopy = <T>(xs: readonly T[], by: (a: T, b: T) => number): T[] => xs.slice().sort(by);

const selectionOf = (s: Sel): Sel => ({ check_guid: s.check_guid, selection_guid: s.selection_guid, parent_selection_guid: s.parent_selection_guid,
  item_guid: s.item_guid, name: s.name, quantity: s.quantity, voided: s.voided, deleted: s.deleted });
const checkOf = (c: Check): Check => ({ check_guid: c.check_guid, amount_cents: c.amount_cents, tax_cents: c.tax_cents, total_cents: c.total_cents,
  voided: c.voided, deleted: c.deleted, accounting: { version: c.accounting.version, gross_cents: c.accounting.gross_cents,
    discounts_comps_cents: c.accounting.discounts_comps_cents, voids_cents: c.accounting.voids_cents,
    service_charges_cents: c.accounting.service_charges_cents, pre_refund_cents: c.accounting.pre_refund_cents } });
const discountOf = (d: Discount, ordinal: number): Discount => ({ check_guid: d.check_guid, ordinal, selection_guid: d.selection_guid,
  applied_discount_guid: d.applied_discount_guid, discount_guid: d.discount_guid, name: d.name, amount_cents: d.amount_cents,
  reason_guid: d.reason_guid, reason_name: d.reason_name, approver_guid: d.approver_guid });
const chargeOf = (s: Charge, ordinal: number): Charge => ({ check_guid: s.check_guid, ordinal, service_charge_guid: s.service_charge_guid,
  name: s.name, amount_cents: s.amount_cents, gratuity: s.gratuity, taxable: s.taxable });
const paymentOf = (p: Payment): Payment => ({ check_guid: p.check_guid, payment_guid: p.payment_guid, payment_status: p.payment_status,
  refund_status: p.refund_status, type: p.type, amount_cents: p.amount_cents, tip_cents: p.tip_cents, paid_business_date: p.paid_business_date,
  refund_amount_cents: p.refund_amount_cents, refund_tip_cents: p.refund_tip_cents, refund_business_date: p.refund_business_date,
  void_business_date: p.void_business_date, server_guid: p.server_guid, sales_refund_cents: p.sales_refund_cents });

/** The full row text WITHOUT the synthetic ordinal: the last tie-break, so ordinals never order anything. */
const ordinalFree = (x: { ordinal: number }): string => JSON.stringify(x, (key, value) => (key === "ordinal" ? undefined : value));
/** 0..k-1 per check, in canonical order (the per-check reset of normalizeToastOrder). */
function renumber<T extends { check_guid: string }, U>(xs: T[], make: (x: T, ordinal: number) => U): U[] {
  const next = new Map<string, number>();
  return xs.map((x) => { const n = next.get(x.check_guid) ?? 0; next.set(x.check_guid, n + 1); return make(x, n); });
}

export function canonicalHashInput(order: ToastCapturedOrder): ToastCapturedOrder {
  const o = order.order;
  const units = sortedCopy(o.selection_units.map(selectionOf), (a, b) =>
    chain(cmp(a.check_guid, b.check_guid), cmp(a.selection_guid, b.selection_guid), cmp(JSON.stringify(a), JSON.stringify(b))));
  const checks = sortedCopy(order.checks.map(checkOf), (a, b) => chain(cmp(a.check_guid, b.check_guid), cmp(JSON.stringify(a), JSON.stringify(b))));
  const discounts = renumber(sortedCopy(order.discounts.map((d) => discountOf(d, 0)), (a, b) => chain(cmp(a.check_guid, b.check_guid),
    cmp(a.selection_guid, b.selection_guid), cmp(a.applied_discount_guid, b.applied_discount_guid), cmp(ordinalFree(a), ordinalFree(b)))), discountOf);
  const charges = renumber(sortedCopy(order.service_charges.map((s) => chargeOf(s, 0)), (a, b) => chain(cmp(a.check_guid, b.check_guid),
    cmp(a.service_charge_guid, b.service_charge_guid), cmp(a.name, b.name), cmp(a.amount_cents, b.amount_cents), cmp(a.gratuity, b.gratuity),
    cmp(a.taxable, b.taxable), cmp(ordinalFree(a), ordinalFree(b)))), chargeOf);
  const payments = sortedCopy(order.payments.map(paymentOf), (a, b) =>
    chain(cmp(a.check_guid, b.check_guid), cmp(a.payment_guid, b.payment_guid), cmp(JSON.stringify(a), JSON.stringify(b))));
  return {
    order: { order_guid: o.order_guid, business_date: o.business_date, opened_at: o.opened_at, closed_at: o.closed_at, paid_at: o.paid_at,
      modified_at: o.modified_at, promised_at: o.promised_at, source: o.source, revenue_center_guid: o.revenue_center_guid,
      dining_option_guid: o.dining_option_guid, server_guid: o.server_guid, deleted: o.deleted, voided: o.voided, excess_food: o.excess_food,
      third_party_provider_guid: o.third_party_provider_guid, third_party_provider_name: o.third_party_provider_name, selection_units: units },
    checks, discounts, service_charges: charges, payments,
  };
}

