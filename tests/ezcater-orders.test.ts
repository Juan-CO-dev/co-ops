/**
 * Unit spine — lib/ezcater/orders-shared.ts normalizeEzcaterOrder, pinned to
 * the SAME fixture the client serves in fixture mode (shape source: the
 * orderByID example in ezCater's Public API User Guide May 2024 v5).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeEzcaterOrder, ezcaterEventDate } from "@/lib/ezcater/orders-shared";

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "ezcater", "orderByID.json"), "utf-8"),
) as unknown;

describe("normalizeEzcaterOrder", () => {
  const o = normalizeEzcaterOrder(fixture);

  it("extracts header, event, caterer, and money (subunits = cents)", () => {
    expect(o.orderNumber).toBe("ABC-123");
    expect(o.orderType).toBe("DELIVERY");
    expect(o.headcount).toBe(25);
    expect(o.handoffTime).toBe("2026-07-25T14:45:00Z");
    expect(o.catererUuid).toBe("cat-1111-2222-3333");
    expect(o.totalDueCents).toBe(41250);
    expect(o.subtotalCents).toBe(36500);
    expect(o.tipCents).toBe(0);
    expect(o.taxCents).toBe(2451);
    expect(o.eventDate).toBe("2026-07-25");
    expect(o.contact).toBeNull();
    expect(o.paymentStatus).toBeNull();
  });

  it("normalizes items with PLU/customizations and null-tolerant optionals", () => {
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({
      name: "Italian Sub Box Lunch", quantity: 12, posItemId: "CO-SUB-ITALIAN",
      specialInstructions: "3 no onions",
      totalCents: 18000, unitPriceCents: null,
    });
    expect(o.items[0]!.customizations[0]).toEqual({ name: "Add Hot Peppers", quantity: 3, typeName: "Add-ons" });
    expect(o.items[1]!.posItemId).toBeNull();
    expect(o.items[1]!.customizations).toEqual([]);
  });

  it("accepts both GraphQL envelope and bare order object", () => {
    const bare = (fixture as { data: { order: unknown } }).data.order;
    expect(normalizeEzcaterOrder(bare).orderNumber).toBe("ABC-123");
  });

  it("poisons on malformed payloads", () => {
    expect(() => normalizeEzcaterOrder(null)).toThrow();
    expect(() => normalizeEzcaterOrder({ data: { order: { event: {} } } })).toThrow(/orderNumber/);
    expect(() => normalizeEzcaterOrder({ data: { order: { orderNumber: "X", catererCart: { orderItems: [{ name: "A" }] } } } })).toThrow(/quantity/);
  });

  it("normalizes invalid or timezone-ambiguous timestamps to null", () => {
    const order = normalizeEzcaterOrder({ orderNumber: "X", event: { timestamp: "bad timestamp", catererHandoffFoodTime: "2026-10-08T20:01:00" } });
    expect(order.eventTimestamp).toBeNull();
    expect(order.eventDate).toBeNull();
    expect(order.handoffTime).toBeNull();
  });
  it("retains lifecycle and separates structured contact data from item facts", () => {
    const order = normalizeEzcaterOrder({ orderNumber: "X", lifecycle: { orderIsCurrently: "cancelled" },
      orderCustomer: { fullName: "Synthetic Customer" },
      event: { contact: { phoneNumber: "202-555-0100" }, address: { street: "123 Test St", city: "Washington", state: "DC", zip: "20001" } },
    });
    expect(order.status).toBe("cancelled");
    expect(order.contact).toEqual({ name: "Synthetic Customer", phone: "202-555-0100", email: null, address: "123 Test St, Washington, DC, 20001" });
    expect(order.items).toEqual([]);
  });
});

describe("ezCater event dates are Eastern business dates", () => {
  it.each([
    ["2026-10-08T23:59:00Z", "2026-10-08"], // 7:59 PM EDT
    ["2026-10-09T00:01:00Z", "2026-10-08"], // 8:01 PM EDT
    ["2026-01-09T00:59:00Z", "2026-01-08"], // 7:59 PM EST
    ["2026-01-09T01:01:00Z", "2026-01-08"], // 8:01 PM EST
    ["2026-03-08T04:59:00Z", "2026-03-07"], // before spring transition
    ["2026-03-08T07:01:00Z", "2026-03-08"], // after spring transition
    ["2026-11-01T05:30:00Z", "2026-11-01"], // repeated 1:30 AM EDT
    ["2026-11-01T06:30:00Z", "2026-11-01"], // repeated 1:30 AM EST
    ["2026-10-08T20:01:00-04:00", "2026-10-08"],
  ])("%s -> %s", (timestamp, expected) => expect(ezcaterEventDate(timestamp)).toBe(expected));
  it.each([null, undefined, "invalid", "2026-10-08", "2026-10-08T20:01:00"])("refuses an invalid/ambiguous instant %s", (timestamp) => {
    expect(ezcaterEventDate(timestamp)).toBeNull();
  });
});

describe("categorized ezCater fees and discounts", () => {
  const cost = (subunits: number) => ({ cost: { currency: "USD", subunits } });
  const normalize = (cart: Record<string, unknown>, totals = {}) => normalizeEzcaterOrder({ orderNumber: "X", catererCart: cart, totals });
  it("adds only delivery and miscellaneous fees, keeping signed discounts separate", () => {
    const order = normalize({ enrichmentDeliveryFees: [cost(125), cost(75)], enrichmentMiscFees: [cost(20)],
      enrichmentDiscounts: [cost(-50), cost(-10)], feesAndDiscounts: [cost(9999)], adjustments: [cost(8888)],
    });
    expect(order.feesCents).toBe(220);
    expect(order.discountsCents).toBe(-60);
  });
  it("prefers explicit provider totals over category aggregation", () => {
    const order = normalize({ enrichmentDeliveryFees: [cost(125)], enrichmentMiscFees: [], enrichmentDiscounts: [cost(-50)] },
      { fees: { subunits: 500 }, discounts: { subunits: 0 } });
    expect(order.feesCents).toBe(500);
    expect(order.discountsCents).toBe(0);
  });
  it("distinguishes an empty category from missing data", () => {
    expect(normalize({ enrichmentDeliveryFees: [], enrichmentMiscFees: [], enrichmentDiscounts: [] })).toMatchObject({ feesCents: 0, discountsCents: 0 });
    expect(normalize({ enrichmentDeliveryFees: [cost(100)] })).toMatchObject({ feesCents: null, discountsCents: null });
  });
  it.each([null, {}, { cost: null }, { cost: { currency: "USD" } }, { cost: { currency: "EUR", subunits: 20 } },
    { cost: { currency: "USD", subunits: Number.NaN } }, { cost: { currency: "USD", subunits: 0.5 } }])("never presents a partial sum for malformed entry %j", (invalid) => {
    const order = normalize({ enrichmentDeliveryFees: [cost(100), invalid], enrichmentMiscFees: [], enrichmentDiscounts: [cost(-50), invalid] });
    expect(order.feesCents).toBeNull();
    expect(order.discountsCents).toBeNull();
  });
});
