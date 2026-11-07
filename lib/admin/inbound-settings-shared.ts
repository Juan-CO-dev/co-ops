import type { RoleCode } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";

export function canManageInboundAliases(role: RoleCode): boolean {
  return role === "moo" || role === "owner" || role === "cgs";
}

/** Role and shop bind before I/O; this feature explicitly grants MoO every shop. */
export function canManageVendorAccount(actor: { role: RoleCode; locations: string[] }, locationId: string): boolean {
  return canManageInboundAliases(actor.role) ||
    (actor.role === "gm" && lockLocationContext(actor, locationId));
}

export function inboundAliasAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  return address.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(address) ? address : null;
}

export interface InboundShop { id: string; name: string; receipt_email_address: string | null }
export interface InboundAlias { id: string; address: string; lane: "vendor_receipt" | "catering"; location_id: string | null }
export interface VendorShopAccount { location_id: string; account_number: string }
