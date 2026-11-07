/** Account identifiers are exact, trimmed strings: preserve case and leading zeros. */
export interface ReceiptAccountMatch {
  vendor_id: string;
  location_id: string;
  account_number: string;
}
export type ReceiptAttributionSource = "address" | "account" | "both" | "manual";

export interface ReceiptAutomationState {
  inbound_message_id: string | null;
  parse_state: string;
  attribution_conflict: boolean;
  location_id: string | null;
}
/** Legacy receipts retain their contract; routed mail must finish attribution first. */
export function receiptAutomationAllowed(row: ReceiptAutomationState): boolean {
  return !row.attribution_conflict && (!row.inbound_message_id || (row.parse_state === "parsed" && row.location_id != null));
}

/** Never bind by a model's vendor name. Reused account numbers require sender evidence. */
export function resolveReceiptAttribution(input: {
  addressLocationId: string | null;
  senderVendorId: string | null;
  accountNumber?: string;
  accounts: readonly ReceiptAccountMatch[];
}) {
  const matches = input.accountNumber
    ? input.accounts.filter((a) => a.account_number === input.accountNumber?.trim())
    : [];
  const narrowed = matches.length === 1 ? matches : matches.filter((a) => a.vendor_id === input.senderVendorId);
  const account = narrowed.length === 1 ? narrowed[0] : undefined;
  const address = input.addressLocationId;
  const conflict = address != null && account != null && address !== account.location_id;
  const attributedBy: ReceiptAttributionSource | null = address
    ? account && !conflict ? "both" : "address"
    : account ? "account" : null;
  return {
    locationId: address ?? account?.location_id ?? null,
    vendorId: account?.vendor_id ?? input.senderVendorId,
    attributedBy,
    attributionConflict: conflict,
  };
}
