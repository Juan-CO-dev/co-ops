import { describe, expect, it } from "vitest";
import { captureBusinessDate, captureCents, normalizeToastOrder } from "@/lib/toast/capture-shared";

const fixture = () => ({
  guid: "order", businessDate: 20260723, openedDate: "2026-07-23T11:15:00-0400",
  modifiedDate: "2026-07-24T00:00:00Z", deleted: true, voided: true, excessFood: true,
  server: { guid: "order-server", firstName: "PRIVATE EMPLOYEE" },
  thirdPartyProviderInfo: { guid: "provider-guid", providerName: "Provider", thirdPartyOrderId: "provider-order", customerName: "PRIVATE CUSTOMER" },
  customer: { firstName: "PRIVATE CUSTOMER", email: "private@example.test", phone: "PRIVATE PHONE" },
  deliveryInfo: { address1: "PRIVATE ADDRESS" },
  checks: [{ guid: "check", amount: 12.34, taxAmount: 1.23, totalAmount: 13.57, voided: true,
    customer: { lastName: "PRIVATE CUSTOMER" },
    appliedDiscounts: [{ guid: "applied", discount: { guid: "discount" }, name: "Staff meal", discountAmount: 2.5, appliedDiscountReason: { discountReason: { guid: "reason" }, name: "Staff benefit", comment: "PRIVATE CUSTOMER" }, approver: { guid: "manager" } }],
    selections: [{ guid: "selection", displayName: "PRIVATE SPECIAL REQUEST", appliedDiscounts: [{ name: "Lunch deal", discountAmount: 1 }], modifiers: [{ guid: "modifier", appliedDiscounts: [{ name: "Modifier deal", discountAmount: 0.5 }] }] }],
    appliedServiceCharges: [{ serviceCharge: { guid: "service" }, name: "Delivery", chargeAmount: 3, gratuity: false, taxable: true }],
    payments: [{ guid: "payment", type: "CREDIT", amount: 13.57, tipAmount: 2, paidBusinessDate: 20260723, voidBusinessDate: 0, server: { guid: "payment-server" }, refund: { refundAmount: 4.25, tipRefundAmount: 0.25, refundBusinessDate: 20260725 }, cardNumber: "PRIVATE CARD" }],
  }],
});

describe("Toast accounting allowlist", () => {
  it("captures cents, UTC instants, source business date and both employee GUIDs", () => {
    const row = normalizeToastOrder(fixture(), "2026-07-23");
    expect(row.order).toMatchObject({ business_date: "2026-07-23", opened_at: "2026-07-23T15:15:00.000Z", server_guid: "order-server" });
    expect(row.checks[0]).toMatchObject({ amount_cents: 1234, tax_cents: 123, total_cents: 1357 });
    expect(row.payments[0]).toMatchObject({ amount_cents: 1357, tip_cents: 200, server_guid: "payment-server", void_business_date: null });
  });
  it("keeps all named discounts including modifier scope and reason/approver references", () => {
    const row = normalizeToastOrder(fixture(), "2026-07-23");
    expect(row.discounts.map(d => [d.name, d.amount_cents, d.selection_guid])).toEqual([["Staff meal", 250, null], ["Lunch deal", 100, "selection"], ["Modifier deal", 50, "modifier"]]);
    expect(row.discounts[0]).toMatchObject({ discount_guid: "discount", applied_discount_guid: "applied", reason_guid: "reason", reason_name: "Staff benefit", approver_guid: "manager" });
    expect(row.service_charges[0]).toMatchObject({ name: "Delivery", amount_cents: 300 });
  });
  it("preserves refunds on their own later business date and includes deleted/voided orders", () => {
    const row = normalizeToastOrder(fixture(), "2026-07-23");
    expect(row.order).toMatchObject({ deleted: true, voided: true, excess_food: true });
    expect(row.checks[0]?.voided).toBe(true);
    expect(row.payments[0]).toMatchObject({ refund_amount_cents: 425, refund_tip_cents: 25, refund_business_date: "2026-07-25" });
  });
  it("drops customer/address/card/raw payload fields at every level", () => {
    const row = normalizeToastOrder(fixture(), "2026-07-23");
    expect(JSON.stringify(row)).not.toMatch(/PRIVATE|private@example|customer|address|cardNumber|displayName/);
    expect(row.order.third_party_provider_guid).toBe("provider-guid");
  });
  it("is deterministic for repeat captures and preserves absent money as unknown", () => {
    expect(normalizeToastOrder(fixture(), "2026-07-23")).toEqual(normalizeToastOrder(fixture(), "2026-07-23"));
    expect(captureCents(null)).toBeNull();
    expect(captureCents("1.005")).toBe(101);
    expect(captureCents(0)).toBe(0);
    expect(() => captureCents("garbage")).toThrow("invalid_money");
  });
  it("refuses mismatched dates, invalid dates, missing GUIDs and ambiguous timestamps", () => {
    expect(() => normalizeToastOrder(fixture(), "2026-07-22")).toThrow("business_date_mismatch");
    expect(captureBusinessDate(20260230)).toBeNull();
    expect(() => normalizeToastOrder({ ...fixture(), guid: null }, "2026-07-23")).toThrow("missing_guid");
    expect(() => normalizeToastOrder({ ...fixture(), openedDate: "2026-07-23T11:00:00" }, "2026-07-23")).toThrow("invalid_timestamp");
  });
});


