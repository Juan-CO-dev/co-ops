import { describe, expect, it } from "vitest";
import { receiptAutomationAllowed, receiptConflictKind, resolveReceiptAttribution } from "@/lib/receipt-attribution-shared";

const account = { vendor_id: "vendor-a", location_id: "shop-a", account_number: "001" };
describe("receipt attribution", () => {
  it("retains legacy pre-parse automation and enables parsed resolved new receipts", () => {
    expect(receiptAutomationAllowed({ inbound_message_id: null, parse_state: "unparsed", attribution_conflict: false, location_id: null })).toBe(true);
    expect(receiptAutomationAllowed({ inbound_message_id: "message", parse_state: "parsed", attribution_conflict: false, location_id: "shop" })).toBe(true);
  });
  it.each([
    ["shop-a", "001", "shop-a", "both", false],
    ["shop-a", undefined, "shop-a", "address", false],
    [null, "001", "shop-a", "account", false],
    ["shop-b", "001", "shop-b", "address", true],
    [null, undefined, null, null, false],
  ] as const)("address=%s account=%s", (addressLocationId, accountNumber, locationId, attributedBy, attributionConflict) => {
    expect(resolveReceiptAttribution({ addressLocationId, accountNumber, senderVendorId: null, accounts: [account] }))
      .toMatchObject({ locationId, attributedBy, attributionConflict });
  });
  // W20/B194 (owner decision W20-1 b): a known sender is never overruled by another vendor's
  // account number. The receipt is FLAGGED for a person, with the account kept as evidence.
  it("a unique account from another vendor never overrides a known sender: it is flagged", () => {
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "001", senderVendorId: "vendor-b", accounts: [account] }))
      .toEqual({ locationId: null, vendorId: "vendor-b", accountLocationId: "shop-a", accountVendorId: "vendor-a",
        attributedBy: null, attributionConflict: true });
    expect(resolveReceiptAttribution({ addressLocationId: "shop-a", accountNumber: "001", senderVendorId: "vendor-b", accounts: [account] }))
      .toEqual({ locationId: "shop-a", vendorId: "vendor-b", accountLocationId: "shop-a", accountVendorId: "vendor-a",
        attributedBy: "address", attributionConflict: true });
  });
  it("a flagged receipt is not eligible for automation", () => {
    const flagged = resolveReceiptAttribution({ addressLocationId: "shop-a", accountNumber: "001", senderVendorId: "vendor-b", accounts: [account] });
    expect(receiptAutomationAllowed({ inbound_message_id: "message", parse_state: "parsed",
      attribution_conflict: flagged.attributionConflict, location_id: flagged.locationId })).toBe(false);
  });
  it("a unique account from the sender's own vendor still attributes", () => {
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "001", senderVendorId: "vendor-a", accounts: [account] }))
      .toMatchObject({ locationId: "shop-a", vendorId: "vendor-a", attributedBy: "account", attributionConflict: false });
  });
  it("an unknown sender still takes a unique account", () => {
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "001", senderVendorId: null, accounts: [account] }))
      .toMatchObject({ locationId: "shop-a", vendorId: "vendor-a", attributedBy: "account", attributionConflict: false });
  });
  it("never guesses between vendors reusing an account", () => {
    const accounts = [account, { ...account, vendor_id: "vendor-b", location_id: "shop-b" }];
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "001", senderVendorId: null, accounts }).locationId).toBeNull();
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "001", senderVendorId: "vendor-b", accounts }).locationId).toBe("shop-b");
  });
  it("preserves significant account digits", () => {
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "1", senderVendorId: null, accounts: [account] }).locationId).toBeNull();
  });
});

it("keeps sender vendor on a conflict and records separate account evidence", () => {
  expect(resolveReceiptAttribution({ addressLocationId: "address-shop", senderVendorId: "sender", accountNumber: "001",
    accounts: [{ location_id: "account-shop", vendor_id: "account-vendor", account_number: "001" }] }))
    .toMatchObject({ vendorId: "sender", attributionConflict: true, accountLocationId: "account-shop", accountVendorId: "account-vendor" });
});
it("a shop conflict on the sender's own account is unchanged", () => {
  expect(resolveReceiptAttribution({ addressLocationId: "address-shop", senderVendorId: "sender", accountNumber: "001",
    accounts: [{ location_id: "account-shop", vendor_id: "sender", account_number: "001" }] }))
    .toEqual({ locationId: "address-shop", vendorId: "sender", accountLocationId: "account-shop", accountVendorId: "sender",
      attributedBy: "address", attributionConflict: true });
});
it("names which kind of flag a receipt carries", () => {
  expect(receiptConflictKind({ attribution_conflict: false, vendor_guess_id: "a", account_vendor_id: "b" })).toBeNull();
  expect(receiptConflictKind({ attribution_conflict: true, vendor_guess_id: "a", account_vendor_id: "b" })).toBe("vendor");
  expect(receiptConflictKind({ attribution_conflict: true, vendor_guess_id: "a", account_vendor_id: "a" })).toBe("shop");
  expect(receiptConflictKind({ attribution_conflict: true, vendor_guess_id: null, account_vendor_id: "a" })).toBe("shop");
  expect(receiptConflictKind({ attribution_conflict: true, vendor_guess_id: "a", account_vendor_id: null })).toBe("shop");
});
