// Toast catering scan — pure half (lib/toast/catering-orders-shared.ts). Shapes pinned from a
// LIVE ordersBulk probe 2026-09-04 (keys only): promisedDate/modifiedDate ISO, businessDate int
// yyyymmdd, checks[].customer{firstName,lastName,phone,email}, checks[].totalAmount in dollars,
// deliveryInfo address fields, source strings like "Catering Online Ordering".
import { describe, expect, it } from "vitest";
import { classifyToastOrder, extractToastOrders, toastLeadFields, toastOrderNotes } from "@/lib/toast/catering-orders-shared";

const CATERING_DO = "do-catering";
const EZ_DO = "do-ezcater";
const NAMES = new Map([[CATERING_DO, "App Catering Delivery"], [EZ_DO, "Ezcater"], ["do-dine", "Dine In"]]);
const CATERING_SET = ["App Catering Delivery", "Ezcater"];

function order(over: Record<string, unknown> = {}) {
  return {
    guid: "o-1", businessDate: 20260904, openedDate: "2026-09-04T15:02:11.000+0000", modifiedDate: "2026-09-04T15:05:00.000+0000",
    promisedDate: "2026-09-12T16:30:00.000+0000", voided: false, source: "Online", numberOfGuests: 1,
    diningOption: { guid: "do-dine" }, externalId: null, thirdPartyProviderInfo: null,
    deliveryInfo: { address1: "1600 Pennsylvania Ave NW", address2: null, city: "Washington", state: "DC", zipCode: "20500", notes: "side door" },
    checks: [{ guid: "c-1", voided: false, totalAmount: 312.5, tabName: null,
      customer: { firstName: "Ada", lastName: "Lovelace", phone: "2025550100", email: "ada@example.com" },
      selections: [
        { displayName: "48 pc platter", quantity: 1, price: 330, voided: false, item: { guid: "i-1" }, selectionType: "NONE" },
        { displayName: "All vegetarian", quantity: 1, price: 0, voided: false, item: null, selectionType: "SPECIAL_REQUEST" },
        { displayName: "Dozen Waters", quantity: 2, price: 24, voided: true, item: { guid: "i-2" }, selectionType: "NONE" },
      ] }],
    ...over,
  };
}

describe("extractToastOrders", () => {
  it("lifts the order-level fields the pipeline needs; dollars become cents; voided lines are kept but flagged", () => {
    const [o] = extractToastOrders([order()]);
    expect(o).toMatchObject({
      guid: "o-1", businessDate: "2026-09-04", promisedAt: "2026-09-12T16:30:00.000+0000", modifiedAt: "2026-09-04T15:05:00.000+0000",
      voided: false, source: "Online", diningOptionGuid: "do-dine", headcount: 1, totalCents: 31250, thirdParty: false,
      customer: { name: "Ada Lovelace", phone: "2025550100", email: "ada@example.com" },
      deliveryAddress: "1600 Pennsylvania Ave NW, Washington, DC 20500 — side door",
    });
    expect(o!.items).toEqual([
      { name: "48 pc platter", quantity: 1, priceCents: 33000, voided: false },
      { name: "Dozen Waters", quantity: 2, priceCents: 2400, voided: true },
    ]);
    expect(o!.specialRequests).toEqual(["All vegetarian"]);
  });
  it("tolerates missing optionals and a non-array payload poisons", () => {
    const [o] = extractToastOrders([order({ promisedDate: null, numberOfGuests: null, deliveryInfo: null, checks: [{ guid: "c", voided: false, totalAmount: 10, customer: null, selections: [] }] })]);
    expect(o).toMatchObject({ promisedAt: null, headcount: null, deliveryAddress: null, customer: null, totalCents: 1000, items: [] });
    expect(() => extractToastOrders({} as unknown)).toThrow();
  });
  it("skips an order with no guid rather than poisoning the whole page", () => {
    expect(extractToastOrders([order({ guid: null }), order({ guid: "o-2" })]).map((o) => o.guid)).toEqual(["o-2"]);
  });
});

describe("classifyToastOrder", () => {
  it("dining option in the catering set → catering; 'Ezcater' → ezcater ring; else not_catering", () => {
    const [dine] = extractToastOrders([order()]);
    const [cat] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    const [ez] = extractToastOrders([order({ diningOption: { guid: EZ_DO } })]);
    expect(classifyToastOrder(dine!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("not_catering");
    expect(classifyToastOrder(cat!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("catering");
    expect(classifyToastOrder(ez!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("ezcater");
  });
  it("Toast's own catering module is catering regardless of dining option; a third-party ezCater ring is ezcater", () => {
    const [mod] = extractToastOrders([order({ source: "Catering Online Ordering" })]);
    expect(classifyToastOrder(mod!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("catering");
    const [tp] = extractToastOrders([order({ source: "API", thirdPartyProviderInfo: { provider: "ezCater" } })]);
    expect(classifyToastOrder(tp!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("ezcater");
  });
  it("matches dining option names case- and whitespace-insensitively", () => {
    const [cat] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    expect(classifyToastOrder(cat!, { diningOptionNames: new Map([[CATERING_DO, "  app catering delivery "]]), cateringDiningOptions: ["App Catering Delivery"] })).toBe("catering");
  });
});

describe("toastLeadFields / toastOrderNotes", () => {
  it("maps to the lead shape: promised date in ET, HH:MM window, customer contact, address, cents", () => {
    const [o] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    const f = toastLeadFields(o!, { diningOptionName: "App Catering Delivery" });
    expect(f).toMatchObject({
      contact_name: "Ada Lovelace", contact_phone: "2025550100", event_date: "2026-09-12", time_window: "12:30",
      headcount: 1, estimated_revenue_cents: 31250, delivery_address: "1600 Pennsylvania Ave NW, Washington, DC 20500 — side door",
      is_delivery: true, lead_source: "toast_catering", stage: "confirmed", external_ref: "toast:o-1",
    });
    expect(f.notes).toContain("--- Toast order (auto) ---");
    expect(f.notes).toContain("48 pc platter");
    expect(f.notes).toContain("All vegetarian");
  });
  it("falls back to the business date and a generic name when the order has no promise or customer", () => {
    const [o] = extractToastOrders([order({ promisedDate: null, deliveryInfo: null, checks: [{ guid: "c", voided: false, totalAmount: 10, customer: null, selections: [] }] })]);
    const f = toastLeadFields(o!, { diningOptionName: null });
    expect(f.event_date).toBe("2026-09-04");
    expect(f.time_window).toBeNull();
    expect(f.contact_name).toBe("Toast order o-1");
    expect(f.is_delivery).toBe(false);
  });
  it("notes block lists items, voided lines marked, special requests, source and dining option", () => {
    const [o] = extractToastOrders([order({ source: "Catering Online Ordering" })]);
    const n = toastOrderNotes(o!, "App Catering Delivery");
    expect(n).toMatch(/Toast order o-1 .*Catering Online Ordering/);
    expect(n).toContain("• 1× 48 pc platter");
    expect(n).toContain("• 2× Dozen Waters (voided)");
    expect(n).toContain('Special request: "All vegetarian"');
  });
});
