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

/**
 * Never bind by a model's vendor name. Reused account numbers require sender evidence.
 *
 * W20/B194 (owner decision W20-1 b, 2026-11-15): when the SENDER is known, only an account
 * that belongs to that sender may attribute. An account number on file for exactly one OTHER
 * vendor used to overrule the sender silently (the receipt then auto-linked to that other
 * vendor's delivery and order). It is now FLAGGED for a person: the sender stays the vendor,
 * the address (if any) stays the shop, the other vendor's account is kept as evidence
 * (accountLocationId / accountVendorId) and attributionConflict stops every automatic effect.
 * It never supplies the shop on its own. An unknown sender still takes a unique account.
 */
export function resolveReceiptAttribution(input: {
  addressLocationId: string | null;
  senderVendorId: string | null;
  accountNumber?: string;
  accounts: readonly ReceiptAccountMatch[];
}) {
  const matches = input.accountNumber
    ? input.accounts.filter((a) => a.account_number === input.accountNumber?.trim())
    : [];
  const own = input.senderVendorId != null ? matches.filter((a) => a.vendor_id === input.senderVendorId) : matches;
  const account = own.length === 1 ? own[0] : undefined;
  // The number is on file for one vendor, and it is not the one that emailed us.
  const foreign = input.senderVendorId != null && own.length === 0 && matches.length === 1 ? matches[0] : undefined;
  const address = input.addressLocationId;
  const conflict = foreign != null || (address != null && account != null && address !== account.location_id);
  const attributedBy: ReceiptAttributionSource | null = address
    ? account && !conflict ? "both" : "address"
    : account ? "account" : null;
  const evidence = account ?? foreign;
  return {
    locationId: address ?? account?.location_id ?? null,
    vendorId: conflict ? input.senderVendorId : account?.vendor_id ?? input.senderVendorId,
    accountLocationId: evidence?.location_id ?? null,
    accountVendorId: evidence?.vendor_id ?? null,
    attributedBy,
    attributionConflict: conflict,
  };
}

/** Why a receipt is flagged: the account names a different VENDOR than the one on the receipt
 *  (B194), or the address and the account name different SHOPS. Null when it is not flagged. */
export function receiptConflictKind(row: {
  attribution_conflict: boolean; vendor_guess_id: string | null; account_vendor_id: string | null;
}): "vendor" | "shop" | null {
  if (!row.attribution_conflict) return null;
  return row.vendor_guess_id != null && row.account_vendor_id != null && row.vendor_guess_id !== row.account_vendor_id
    ? "vendor" : "shop";
}
