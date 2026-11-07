import { describe, expect, it } from "vitest";
import { receiptAutomationAllowed, resolveReceiptAttribution } from "@/lib/receipt-attribution-shared";

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
  it("a unique account wins over sender guess", () => {
    expect(resolveReceiptAttribution({ addressLocationId: null, accountNumber: "001", senderVendorId: "vendor-b", accounts: [account] }).vendorId).toBe("vendor-a");
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
