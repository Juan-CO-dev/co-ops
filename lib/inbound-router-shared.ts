/** Exact mailbox matching. Plus tags are preserved: stripping them could cross shops. */
export function normalizeInboundAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  const address = (value.match(/<([^<>]+)>\s*$/)?.[1] ?? value).trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) ? address : null;
}

export function inboundAddresses(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map(normalizeInboundAddress).filter((v): v is string => v !== null))];
}

export interface InboundAddressRule {
  address: string;
  lane: "vendor_receipt" | "catering";
  location_id: string | null;
  primary?: boolean;
}
export interface InboundRoute {
  lane: "vendor_receipt" | "catering" | "noise";
  location_id: string | null;
  route_reason: "shop_address" | "shop_alias" | "catering_address" | "ambiguous" | "unknown_address";
}

export function resolveInboundRoute(recipients: string[], rules: InboundAddressRule[]): InboundRoute {
  const addresses = new Set(recipients.map(normalizeInboundAddress));
  addresses.delete(null);
  const matched = rules.filter(r => addresses.has(normalizeInboundAddress(r.address)));
  const shops = new Set(matched.filter(r => r.lane === "vendor_receipt" && r.location_id).map(r => r.location_id!));
  const catering = matched.some(r => r.lane === "catering");
  if (shops.size > 1 || (shops.size > 0 && catering)) {
    return { lane: "vendor_receipt", location_id: null, route_reason: "ambiguous" };
  }
  if (shops.size === 1) return { lane: "vendor_receipt", location_id: [...shops][0]!,
    route_reason: matched.some(r => r.primary) ? "shop_address" : "shop_alias" };
  if (catering) return { lane: "catering", location_id: null, route_reason: "catering_address" };
  return { lane: "noise", location_id: null, route_reason: "unknown_address" };
}

export const INBOUND_MAX_ATTEMPTS = 5;
export function inboundRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempt - 1));
}
