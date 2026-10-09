/** 0234: Toast order → customer rows. Fixtures only (invented guests); no PAN, no notes, relay contacts dropped. */
import { describe, expect, it } from "vitest";
import { channelLookup, extractCustomerRows } from "@/lib/customers/extract-shared";

const channel = channelLookup(
  [{ guid: "do-online", name: "Online Ordering - Takeout" }, { guid: "do-dd", name: "DoorDash - Delivery" }, { guid: "do-new", name: "Brand new option" }],
  [{ dining_option_label: "Online Ordering - Takeout", channel: "online", reviewed_at: "2026-10-07T00:00:00Z" },
   { dining_option_label: "DoorDash - Delivery", channel: "third_party", reviewed_at: "2026-10-07T00:00:00Z" },
   { dining_option_label: "Brand new option", channel: "online", reviewed_at: null }],
);

const order = (over: Record<string, unknown>) => ({
  guid: "o1", businessDate: 20261001, openedDate: "2026-10-01T16:00:00.000+0000", diningOption: { guid: "do-online" },
  checks: [{
    guid: "c1", totalAmount: 12.5,
    customer: { firstName: "Ana", lastName: "Diaz", email: "Ana@Example.com", phone: "(202) 555-0101" },
    selections: [
      { guid: "s1", item: { guid: "i1" }, displayName: "Crunchy Boi", quantity: 1 },
      { guid: "s2", item: null, displayName: "please call me at 202-555-0199", selectionType: "SPECIAL_REQUEST", quantity: 1 },
      { guid: "s3", item: { guid: "i2" }, displayName: "Chips", quantity: 2, voided: true },
    ],
    payments: [{ guid: "p1", type: "CREDIT", cardType: "VISA", last4Digits: "4242", cardNumber: "4242424242424242" }],
  }],
  ...over,
});

describe("extractCustomerRows", () => {
  it("lifts normalised contact, items without notes, brand + last4 only", () => {
    const { rows } = extractCustomerRows([order({})], channel);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r).toMatchObject({ order_guid: "o1", business_date: "2026-10-01", email: "ana@example.com", phone: "+12025550101",
      full_name: "Ana Diaz", source: "toast_online", channel: "online", total_cents: 1250, contact_masked: false, masked_channel: null });
    expect(r.items).toEqual([{ name: "Crunchy Boi", qty: 1 }]);
    expect(r.cards).toEqual([{ brand: "VISA", last4: "4242" }]);
    const json = JSON.stringify(rows);
    expect(json).not.toContain("4242424242424242");
    expect(json).not.toContain("please call");
  });

  it("third-party orders drop the relay phone and a relay email, and flag the marketplace", () => {
    const { rows, maskedOnly } = extractCustomerRows([order({ diningOption: { guid: "do-dd" }, thirdPartyProviderInfo: { provider: "DoorDash" },
      checks: [{ guid: "c1", totalAmount: 9, customer: { firstName: "Bo", lastName: "Li", email: "x1@doordash.com", phone: "2025550123" }, selections: [], payments: [] }] })], channel);
    expect(rows).toHaveLength(0);
    expect(maskedOnly).toBe(1);
  });

  it("a third-party order with a real email keeps the email, never the phone, and is flagged", () => {
    const { rows } = extractCustomerRows([order({ thirdPartyProviderInfo: { provider: "Uber Eats" },
      checks: [{ guid: "c1", totalAmount: 9, customer: { firstName: "Bo", lastName: "Li", email: "bo@example.com", phone: "2025550123" }, selections: [], payments: [] }] })], channel);
    expect(rows[0]).toMatchObject({ email: "bo@example.com", phone: null, contact_masked: true, masked_channel: "ubereats", channel: "third_party", source: "toast_third_party" });
  });

  it("skips voided orders and orders without any contact", () => {
    const r = extractCustomerRows([order({ voided: true }), order({ guid: "o2", checks: [{ guid: "c", totalAmount: 1, customer: { firstName: "No", lastName: "Contact" } }] })], channel);
    expect(r.rows).toEqual([]);
    expect(r.voided).toBe(1);
    expect(r.noContact).toBe(1);
  });

  it("an unreviewed dining option is 'unknown', never guessed", () => {
    expect(extractCustomerRows([order({ diningOption: { guid: "do-new" } })], channel).rows[0]!.channel).toBe("unknown");
  });

  it("an unparsed check total makes spend unknown, not $0", () => {
    const o = order({});
    (o.checks[0] as Record<string, unknown>).totalAmount = "n/a";
    expect(extractCustomerRows([o], channel).rows[0]!.total_cents).toBeNull();
  });
});
