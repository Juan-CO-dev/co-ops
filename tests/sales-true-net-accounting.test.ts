import { describe, expect, it } from "vitest";
import { normalizeToastOrder, captureBusinessDate, captureCents } from "@/lib/toast/capture-shared";
import { projectCheckSales, projectSalesRefunds } from "@/lib/toast/sales-accounting-shared";
import { summarizeSales, type DailyRaw } from "@/lib/sales-reports-shared";

const item = (extra: Record<string, unknown> = {}) => ({ guid: "item-selection", item: { guid: "item" }, quantity: 1,
  price: 10, preDiscountPrice: 12, appliedDiscounts: [{ name: "Staff", discountAmount: 2.2, nonTaxDiscountAmount: 2 }], ...extra });
const check = (extra: Record<string, unknown> = {}) => ({ guid: "check", amount: 13, taxAmount: 1.3,
  selections: [item()], appliedServiceCharges: [{ chargeAmount: 3, gratuity: false }, { chargeAmount: 2, gratuity: true }], ...extra });
const accounting = (c = check()) => projectCheckSales(c, captureCents);
const detail = (amount: number, tax = 0, tx = "tx") => ({ refundAmount: amount, taxRefundAmount: tax, refundTransaction: { guid: tx } });
const payment = (guid = "a", amount = 5.5, extra: Record<string, unknown> = {}) => ({ guid, paymentStatus: "CAPTURED",
  refund: { refundAmount: amount, tipRefundAmount: 1, refundBusinessDate: 20261009, refundTransaction: { guid: "tx" }, ...extra } });
const refunds = (c: Record<string, unknown>) => projectSalesRefunds(c, captureCents, captureBusinessDate);

describe("Toast item-sales components", () => {
  it("separates service charges and gratuity, uses non-tax discounts, never subtracts discounts twice", () => {
    expect(accounting()).toEqual({ version: 1, pre_refund_cents: 1000, gross_cents: 1200,
      discounts_comps_cents: 200, voids_cents: 0, service_charges_cents: 300 });
  });
  it("parent prices include quantity/modifiers; selection and check discounts are counted once", () => {
    const c = check({ amount: 24, appliedDiscounts: [{ nonTaxDiscountAmount: 1 }], selections: [item({ quantity: 2, price: 21,
      modifiers: [{ guid: "mod", price: 2, appliedDiscounts: [{ nonTaxDiscountAmount: 0.5 }] }] })] });
    expect(accounting(c)).toMatchObject({ gross_cents: 2450, discounts_comps_cents: 350, pre_refund_cents: 2100 });
  });
  it("subtracts deferred/house-account subtrees once and removes their allocated discounts", () => {
    const gift = item({ guid: "gift", deferred: true, price: 19, preDiscountPrice: 20, appliedDiscounts: [{ nonTaxDiscountAmount: 1 }],
      modifiers: [{ price: 2, preDiscountPrice: 2 }] });
    const house = item({ guid: "house", selectionType: "HOUSE_ACCOUNT_PAY_BALANCE", price: 50, preDiscountPrice: 50, appliedDiscounts: [] });
    expect(accounting(check({ amount: 82, selections: [item(), gift, house] }))).toMatchObject({
      gross_cents: 1200, discounts_comps_cents: 200, pre_refund_cents: 1000 });
  });
  it("a check discount allocated to a deferred item is removed by gross minus net for that subtree", () => {
    expect(accounting(check({ amount: 31, appliedDiscounts: [{ nonTaxDiscountAmount: 2 }], selections: [
      item({ price: 9, appliedDiscounts: [] }), item({ guid: "gift", deferred: true, price: 19, preDiscountPrice: 20, appliedDiscounts: [] }),
    ] }))).toMatchObject({ pre_refund_cents: 900, discounts_comps_cents: 100, gross_cents: 1000 });
  });
  it("voided item gross includes modifiers once, deleted selections and their discounts never enter", () => {
    expect(accounting(check({ selections: [item(), item({ voided: true, preDiscountPrice: 7,
      modifiers: [{ preDiscountPrice: 2, voided: true }] }), item({ deleted: true, preDiscountPrice: 80 })] })))
      .toMatchObject({ gross_cents: 1900, voids_cents: 700, discounts_comps_cents: 200, pre_refund_cents: 1000 });
  });
  it("prices a voided modifier within a live item without multiplying quantity", () => {
    expect(accounting(check({ selections: [item({ modifiers: [{ voided: true, quantity: 3, preDiscountPrice: 6 }] })] })))
      .toMatchObject({ voids_cents: 600, gross_cents: 1800 });
  });
  it("fundraising is removed just like other non-gratuity service charges", () => {
    expect(accounting(check({ amount: 10.5, appliedServiceCharges: [{ chargeAmount: 0.5, serviceChargeCategory: "FUNDRAISING_CAMPAIGN" }] })))
      .toMatchObject({ service_charges_cents: 50, pre_refund_cents: 1000 });
  });
  it("never guesses non-tax discounts or missing void prices", () => {
    expect(accounting(check({ selections: [item({ appliedDiscounts: [{ discountAmount: 2 }] })] })).gross_cents).toBeNull();
    expect(accounting(check({ selections: [item(), { voided: true }] })).voids_cents).toBeNull();
  });
  it("unreconciled check totals and absent selection evidence remain unknown", () => {
    expect(accounting(check({ amount: 14 })).pre_refund_cents).toBeNull();
    expect(accounting(check({ selections: undefined })).gross_cents).toBeNull();
    expect(accounting(check({ amount: 0, selections: [], appliedServiceCharges: [] })).gross_cents).toBe(0);
  });
  it("normalization retains exclusions, preserves named discounts and never captures private data", () => {
    const row = normalizeToastOrder({ guid: "order", businessDate: 20261008, voided: true, deleted: true,
      checks: [check({ voided: true, deleted: true, customer: { name: "PRIVATE" }, payments: [payment()] })] }, "2026-10-08");
    expect(row.order).toMatchObject({ voided: true, deleted: true });
    expect(row.checks[0]).toMatchObject({ voided: true, deleted: true, accounting: { gross_cents: 1200 } });
    expect(row.discounts[0]).toMatchObject({ name: "Staff", amount_cents: 220 });
    expect(JSON.stringify(row)).not.toContain("PRIVATE");
  });
});

describe("fully reconciled refund transactions", () => {
  it("partial refund excludes tax and tips and retains its late refund business date", () => {
    const row = normalizeToastOrder({ guid: "o", businessDate: 20261008,
      checks: [check({ selections: [item({ refundDetails: detail(5, 0.5) })], payments: [payment()] })] }, "2026-10-08");
    expect(row.payments[0]).toMatchObject({ sales_refund_cents: 500, refund_amount_cents: 550, refund_tip_cents: 100, refund_business_date: "2026-10-09" });
  });
  it.each([undefined, null, 0, "0"])("retains a $5 refund with missing business date %s as unallocatable", (refundBusinessDate) => {
    const row = normalizeToastOrder({ guid: "o", businessDate: 20261008,
      checks: [check({ selections: [item({ refundDetails: detail(5) })],
        payments: [payment("a", 5, { refundBusinessDate })] })] }, "2026-10-08");
    expect(row.payments[0]).toMatchObject({ sales_refund_cents: null,
      refund_amount_cents: 500, refund_business_date: null });
  });
  it("subtracts only item refunds when service charges and tax share the transaction", () => {
    expect(refunds({ selections: [item({ refundDetails: detail(5, 0.5) })],
      appliedServiceCharges: [{ refundDetails: detail(2, 0.2) }], payments: [payment("a", 7.7)] }).get("a")).toBe(500);
  });
  it("tip-only and no-refund payments contribute zero without invented sales refunds", () => {
    expect(refunds({ payments: [payment("a", 0), { guid: "b" }] })).toEqual(new Map([["a", 0], ["b", 0]]));
  });
  it("custom, missing-tax, missing-transaction and mismatched allocations are unknown", () => {
    expect(refunds({ payments: [payment()] }).get("a")).toBeNull();
    for (const refundDetails of [detail(4, 0.5), { ...detail(5), taxRefundAmount: undefined }, { ...detail(5, 0.5), refundTransaction: undefined }]) {
      expect(refunds({ selections: [item({ refundDetails })], payments: [payment()] }).get("a")).toBeNull();
    }
  });
  it("counts same-transaction modifier refund details only under the outermost refunded parent", () => {
    expect(refunds({ selections: [item({ refundDetails: detail(5, 0.5), modifiers: [{ refundDetails: detail(2, 0.2) }] })],
      payments: [payment()] }).get("a")).toBe(500);
  });
  it("captures modifier-only and different-transaction refunds, without suppressing siblings", () => {
    const selections = [item({ modifiers: [{ refundDetails: detail(5, 0.5) }, { refundDetails: detail(2, 0.2, "other") }] })];
    expect(refunds({ selections, payments: [payment(), payment("b", 2.2, { refundTransaction: { guid: "other" } })] }))
      .toEqual(new Map([["a", 500], ["b", 200]]));
  });
  it("deferred refunds reconcile but contribute no sales; mixed parent refunds remain unknown", () => {
    expect(refunds({ selections: [item({ deferred: true, refundDetails: detail(5, 0.5) })], payments: [payment()] }).get("a")).toBe(0);
    expect(refunds({ selections: [item({ refundDetails: detail(5, 0.5), modifiers: [{ deferred: true }] })], payments: [payment()] }).get("a")).toBeNull();
  });
  it("multi-payment transaction allocation is once-only and stable under response reordering", () => {
    const a = payment("a", 3), b = payment("b", 2.5), selections = [item({ refundDetails: detail(5, 0.5) })];
    expect(refunds({ selections, payments: [a, b] })).toEqual(new Map([["a", 500], ["b", 0]]));
    expect(refunds({ selections, payments: [b, a] }).get("a")).toBe(500);
    expect(refunds({ selections, payments: [b, a] }).get("b")).toBe(0);
    expect(refunds({ selections, payments: [a, payment("b", 2.5, { refundBusinessDate: 20261010 })] }).get("a")).toBeNull();
  });
  it("refuses malformed dates, negative refunds, unknown amounts and ineligible tenders", () => {
    for (const p of [payment("a", 5.5, { refundBusinessDate: 20260230 }), payment("a", -5.5),
      payment("a", 5.5, { refundAmount: null }), { ...payment(), paymentStatus: "VOIDED" }, { ...payment(), paymentStatus: "DENIED" }]) {
      expect(refunds({ selections: [item({ refundDetails: detail(5, 0.5) })], payments: [p] }).get("a")).toBeNull();
    }
  });
});

const day = "2026-10-08";
const raw = (): DailyRaw => ({ classes: [{ business_date: day, sale_class: "sale", checks: 1, amount_cents: 1300, tax_cents: 130, amount_missing: 0,
  gross_cents: 1900, discounts_comps_cents: 200, voids_cents: 700, service_charges_cents: 300, accounting_missing: 0 }],
  refunds: [{ business_date: day, count: 1, refund_cents: 550, refund_tip_cents: 100, sales_refund_cents: 500, sales_refund_missing: 0 }],
  discounts: [], tips: [], captured_days: [day], ezcater: [{ business_date: day, orders: 1, subtotal_cents: 10000, amount_missing: 0 }] });
const summarize = (r = raw()) => summarizeSales([r], day, day, "day");
describe("daily exact item-sales summary", () => {
  it("one DTO folds gross minus discounts/comps minus voids minus sales refunds separately from legacy/ezCater", () => {
    const { totals, buckets } = summarize();
    expect(totals).toMatchObject({ toastNetCents: 500, totalCents: 11300, toastChecksCents: 1300, ezcaterCents: 10000, serviceChargesCents: 300 });
    expect(buckets[0]?.toastNetCents).toBe(totals.toastNetCents);
  });
  it("historical and pre-migration responses cannot produce exact net", () => {
    const r = raw(); r.classes = [{ business_date: day, sale_class: "sale", checks: 2, amount_cents: 1300, tax_cents: 130, amount_missing: 0 }];
    expect(summarize(r).totals).toMatchObject({ toastNetCents: null, grossCents: null, accountingMissing: 2 });
    r.classes = raw().classes; r.refunds = [{ business_date: day, count: 1, refund_cents: 500, refund_tip_cents: 0 }];
    expect(summarize(r).totals).toMatchObject({ toastNetCents: null, salesRefundsCents: null, salesRefundMissing: 1 });
  });
  it("unknown custom refund nulls the exact net, not the known gross or legacy totals", () => {
    const r = raw(); r.refunds[0]!.sales_refund_cents = null; r.refunds[0]!.sales_refund_missing = 1;
    expect(summarize(r).totals).toMatchObject({ grossCents: 1900, toastNetCents: null, totalCents: 11300 });
  });
  it("undated refund uncertainty rows suppress every possible day's net without inventing dated money", () => {
    const r = raw();
    r.refunds = [];
    r.captured_days.push("2026-10-09");
    // RPC emits uncertainty-only rows on each possible day, even when the original sale
    // predates this query window. It does NOT assign the refund dollars to those days.
    for (const business_date of r.captured_days) r.refunds.push({ business_date, count: 0,
      refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 });
    const s = summarizeSales([r], day, "2026-10-09", "day");
    expect(s.buckets.map(b => b.toastNetCents)).toEqual([null, null]);
    expect(s.buckets.map(b => b.salesRefundMissing)).toEqual([1, 1]);
    expect(s.totals).toMatchObject({ coverage: "complete", toastNetCents: null,
      salesRefundsCents: null, grossCents: 1900, refundCents: 0, refundCount: 0 });
    expect(summarizeSales([r], "2026-10-09", "2026-10-09", "day").totals.toastNetCents).toBeNull();
    r.refunds.push(raw().refunds[0]!);
    const mixed = summarizeSales([r], day, "2026-10-09", "week");
    expect(mixed.totals).toMatchObject({ toastNetCents: null, salesRefundsCents: null, refundCents: 550, refundCount: 1 });
    expect(mixed.buckets[0]?.toastNetCents).toBeNull();
  });
  it("whole void/gift card/excess-food/linked checks never enter exact components", () => {
    const r = raw(); for (const sale_class of ["void", "gift_card", "excess_food", "ezcater_linked"] as const) r.classes.push({ ...r.classes[0]!, sale_class, gross_cents: null, accounting_missing: 1 });
    expect(summarize(r).totals).toMatchObject({ toastNetCents: 500, accountingMissing: 0 });
  });
  it("refund-only dates reduce that day, never the original sale day; totals can be negative", () => {
    const r = raw(); r.refunds[0]!.business_date = "2026-10-09"; r.captured_days.push("2026-10-09");
    const s = summarizeSales([r], day, "2026-10-09", "day");
    expect(s.buckets.map(b => b.toastNetCents)).toEqual([1000, -500]);
    expect(s.totals.toastNetCents).toBe(500);
  });
  it("missing capture coverage is not exact, while a captured empty day really is zero", () => {
    expect(summarizeSales([raw()], day, "2026-10-09", "day").totals.toastNetCents).toBeNull();
    const r = raw(); r.classes = []; r.refunds = []; r.ezcater = [];
    expect(summarize(r).totals.toastNetCents).toBe(0);
  });
});
