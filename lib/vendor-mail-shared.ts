import { getRoleLevel, isRoleCode, type RoleCode } from "./roles";

export const VENDOR_MAIL_CONTENT_STATES = ["pending", "fetched", "failed", "blocked_config", "skipped"] as const;
export type VendorMailContentState = typeof VENDOR_MAIL_CONTENT_STATES[number];
export const VENDOR_MAIL_STATUSES = ["received", "fetched", "parsed", "matched_po", "matched_delivery", "needs_person", "failed", "handled"] as const;
export type VendorMailStatus = typeof VENDOR_MAIL_STATUSES[number];
export const VENDOR_MAIL_FAILURE_CODES = ["no_content", "no_api_key", "api_error", "empty_response", "unparseable_json"] as const;
export type VendorMailFailureCode = typeof VENDOR_MAIL_FAILURE_CODES[number];
export interface VendorMailReader { role: RoleCode; active: boolean; locations: string[] }
export function vendorMailRoleAllowed(role: string): role is RoleCode {
  return isRoleCode(role) && (role === "gm" || getRoleLevel(role) >= 8);
}
export function canReadVendorMail(actor: VendorMailReader, locationId: string | null): boolean {
  return actor.active && vendorMailRoleAllowed(actor.role) && (getRoleLevel(actor.role) >= 8 || (locationId !== null && actor.locations.includes(locationId)));
}
/** Never expose provider diagnostics as a display/error vocabulary. */
export function vendorMailFailureCode(parsed: unknown): VendorMailFailureCode | null {
  if (!parsed || typeof parsed !== "object" || !("reason" in parsed) || typeof parsed.reason !== "string") return null;
  return VENDOR_MAIL_FAILURE_CODES.find(code => parsed.reason === code || (parsed.reason as string).startsWith(`${code}:`)) ?? null;
}
export function vendorMailStale(receivedAt: string, handledAt: string | null, linkedPoId: string | null, linkedDeliveryId: string | null, now = Date.now()): boolean {
  // Elapsed 24 hours, independent of ET calendar-day length across DST changes.
  return !handledAt && !linkedPoId && !linkedDeliveryId && now - Date.parse(receivedAt) > 86_400_000;
}
export interface VendorMailFilters {
  locationId?: string; vendorId?: string; status?: VendorMailStatus;
  receivedFrom?: string; receivedTo?: string; search?: string; stale?: boolean;
}
export function vendorMailOrder(a: { stale: boolean; received_at: string; id: string }, b: { stale: boolean; received_at: string; id: string }): number {
  return Number(b.stale) - Number(a.stale) || (a.stale ? a.received_at.localeCompare(b.received_at) : b.received_at.localeCompare(a.received_at)) || a.id.localeCompare(b.id);
}
/** A plain-text presentation only; never use this result as HTML. Preserve quoted mail. */
export function vendorMailHtmlToText(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<!--[^]*?(?:-->|$)/g, " ")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/tr|\/blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[a-zA-Z/!][^>]*(?:>|$)/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
      if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? whole;
      const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
    }).replace(/[ \t]+/g, " ").trim();
}
