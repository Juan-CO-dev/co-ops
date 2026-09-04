// Toast catering scan — pure half (lib/toast/catering-orders-shared.ts). Shapes pinned from a
// LIVE ordersBulk probe 2026-09-04 (keys only): promisedDate/modifiedDate ISO, businessDate int
// yyyymmdd, checks[].customer{firstName,lastName,phone,email}, checks[].totalAmount in dollars,
// deliveryInfo address fields, source strings like "Catering Online Ordering".
import { describe, expect, it } from "vitest";
import { classifyToastOrder, extractToastOrders, toastLeadFields, toastOrderChanged, toastOrderNotes } from "@/lib/toast/catering-orders-shared";
import { mergeMachineNotes } from "@/lib/catering/machine-notes-shared";

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
      voided: false, source: "Online", diningOptionGuid: "do-dine", headcount: null, totalCents: 31250, unparsedAmounts: 0, thirdPartyProvider: null,
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
  it("accepts numeric-string dollar amounts and counts what didn't parse", () => {
    const [ok] = extractToastOrders([order({ checks: [{ guid: "c", voided: false, totalAmount: "312.50", customer: null, selections: [] }] })]);
    expect(ok).toMatchObject({ totalCents: 31250, unparsedAmounts: 0 });
    const [bad] = extractToastOrders([order({ checks: [{ guid: "c", voided: false, totalAmount: "abc", customer: null, selections: [] }] })]);
    expect(bad).toMatchObject({ totalCents: 0, unparsedAmounts: 1 });
  });
  it("sums only non-voided checks' totals", () => {
    const [o] = extractToastOrders([order({ checks: [
      { guid: "c1", voided: false, totalAmount: 100, customer: null, selections: [] },
      { guid: "c2", voided: true, totalAmount: 500, customer: null, selections: [] },
    ] })]);
    expect(o).toMatchObject({ totalCents: 10000 });
  });
  it("parses businessDate as an 8-digit int or YYYY-MM-DD; else null", () => {
    expect(extractToastOrders([order({ businessDate: "2026-09-04" })])[0]).toMatchObject({ businessDate: "2026-09-04" });
    expect(extractToastOrders([order({ businessDate: "nope" })])[0]).toMatchObject({ businessDate: null });
  });
  it("only a real (>1) guest count reads as a headcount — Toast defaults online orders to 1", () => {
    expect(extractToastOrders([order({ numberOfGuests: 1 })])[0]).toMatchObject({ headcount: null });
    expect(extractToastOrders([order({ numberOfGuests: 24 })])[0]).toMatchObject({ headcount: 24 });
  });
  it("carries the void timestamp from raw.voidDate when Toast records one; null otherwise", () => {
    expect(extractToastOrders([order()])[0]).toMatchObject({ voidedAt: null });
    expect(extractToastOrders([order({ voided: true, voidDate: "2026-09-04T20:10:00.000+0000" })])[0]).toMatchObject({ voidedAt: "2026-09-04T20:10:00.000+0000" });
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
  it("a named third-party provider that isn't ezCater is its own class, never a lead", () => {
    const [dd] = extractToastOrders([order({ source: "API", thirdPartyProviderInfo: { provider: "DoorDash" } })]);
    expect(classifyToastOrder(dd!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("third_party");
  });
  it("an ezCater-named dining option is ezcater even by substring match", () => {
    const names = new Map([["do-x", "EZCater Delivery"]]);
    const [o] = extractToastOrders([order({ diningOption: { guid: "do-x" } })]);
    expect(classifyToastOrder(o!, { diningOptionNames: names, cateringDiningOptions: CATERING_SET })).toBe("ezcater");
  });
});

describe("toastLeadFields / toastOrderNotes", () => {
  it("maps to the lead shape: promised date in ET, HH:MM window, customer contact, address, cents", () => {
    const [o] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    const f = toastLeadFields(o!, { diningOptionName: "App Catering Delivery" });
    expect(f).toMatchObject({
      contact_name: "Ada Lovelace", contact_phone: "2025550100", event_date: "2026-09-12", time_window: "12:30",
      headcount: null, estimated_revenue_cents: 31250, delivery_address: "1600 Pennsylvania Ave NW, Washington, DC 20500 — side door",
      lead_source: "toast_catering", stage: "confirmed", external_ref: "toast:o-1",
    });
    expect(f.notes).toContain("--- Toast order (auto) ---");
    expect(f.notes).toContain("48 pc platter");
    expect(f.notes).toContain("All vegetarian");
    expect(f.notes).toContain("Promised: 2026-09-12 12:30 ET");
  });
  it("falls back to the business date and a generic name when the order has no promise or customer", () => {
    const [o] = extractToastOrders([order({ promisedDate: null, deliveryInfo: null, checks: [{ guid: "c", voided: false, totalAmount: 10, customer: null, selections: [] }] })]);
    const f = toastLeadFields(o!, { diningOptionName: null });
    expect(f.event_date).toBe("2026-09-04");
    expect(f.time_window).toBeNull();
    expect(f.contact_name).toBe("Toast order o-1");
  });
  it("event_date is null when both the promised time and the business date fail to parse", () => {
    const [o] = extractToastOrders([order({ promisedDate: null, businessDate: "nope" })]);
    const f = toastLeadFields(o!, { diningOptionName: null });
    expect(f.event_date).toBeNull();
  });
  it("notes block lists items, voided lines marked, special requests, source and dining option, promised time in ET", () => {
    const [o] = extractToastOrders([order({ source: "Catering Online Ordering" })]);
    const n = toastOrderNotes(o!, "App Catering Delivery");
    expect(n).toMatch(/Toast order o-1 .*Catering Online Ordering/);
    expect(n).toContain("• 1× 48 pc platter");
    expect(n).toContain("• 2× Dozen Waters (voided)");
    expect(n).toContain('Special request: "All vegetarian"');
    expect(n).toContain("Promised: 2026-09-12 12:30 ET");
  });
  it("ET crossing: a promise that lands after midnight UTC on the ET-previous day reports that day's date and the late time", () => {
    const [o] = extractToastOrders([order({ promisedDate: "2026-09-13T03:30:00.000+0000" })]);
    const f = toastLeadFields(o!, { diningOptionName: null });
    expect(f.event_date).toBe("2026-09-12");
    expect(f.time_window).toBe("23:30");
  });
});

describe("toastOrderChanged", () => {
  it("compares timestamps as instants, not strings", () => {
    expect(toastOrderChanged({ modifiedAt: "2026-09-04T15:05:00+00:00", voided: false }, { modifiedAt: "2026-09-04T15:05:00.000+0000", voided: false })).toBe(false);
  });
  it("a genuinely different instant is a change", () => {
    expect(toastOrderChanged({ modifiedAt: "2026-09-04T15:05:00.000+0000", voided: false }, { modifiedAt: "2026-09-04T15:06:00.000+0000", voided: false })).toBe(true);
  });
  it("null vs a real timestamp is a change; both null is not", () => {
    expect(toastOrderChanged({ modifiedAt: null, voided: false }, { modifiedAt: "2026-09-04T15:05:00.000+0000", voided: false })).toBe(true);
    expect(toastOrderChanged({ modifiedAt: null, voided: false }, { modifiedAt: null, voided: false })).toBe(false);
  });
  it("a voided flip is a change even with an unchanged timestamp", () => {
    expect(toastOrderChanged({ modifiedAt: "2026-09-04T15:05:00.000+0000", voided: false }, { modifiedAt: "2026-09-04T15:05:00.000+0000", voided: true })).toBe(true);
  });
});

describe("mergeMachineNotes", () => {
  it("a stray end marker in the human text BEFORE the block does not orphan the block", () => {
    const strayHuman = "Called about --- end Toast order --- pricing, will confirm tomorrow.";
    const existing = `${strayHuman}\n\n--- Toast order (auto) ---\noriginal block\n--- end Toast order ---`;
    const merged = mergeMachineNotes("Toast order", existing, "updated block");
    expect(merged).toContain(strayHuman);
    expect(merged).toContain("updated block");
    expect(merged).not.toContain("original block");
    expect(merged.split("--- Toast order (auto) ---").length - 1).toBe(1); // exactly one block, never duplicated
  });
});
