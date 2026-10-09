/**
 * Who may see what about a customer — PURE (client-safe). 0234.
 *
 * Juan 2026-10-07/08: raw email/phone visible to level 9+ ONLY (Pete, Juan); managers see profile
 * stats WITHOUT contact data; every raw-contact read and every export is audited.
 *
 *   level 7 (GM)  : profile stats for customers who ordered at their own shop(s), names included,
 *                   no identifier ever leaves the server; may confirm/dismiss a "likely same person".
 *   level 8 (MoO) : the same, every shop.
 *   level 9+      : + raw contact (one audited reveal per profile view), the consent import, the
 *                   marketing and Meta exports, delete-on-request, the retention sweep.
 */
export const CUSTOMER_STATS_MIN = 7;
export const CUSTOMER_ALL_SHOPS_MIN = 8;
export const CUSTOMER_CONTACT_MIN = 9;

export interface CustomerViewer { userId: string; level: number; locations: readonly string[] }

export function canSeeCustomerStats(v: CustomerViewer): boolean { return v.level >= CUSTOMER_STATS_MIN; }
export function canSeeRawContact(v: CustomerViewer): boolean { return v.level >= CUSTOMER_CONTACT_MIN; }
export function canManageConsent(v: CustomerViewer): boolean { return v.level >= CUSTOMER_CONTACT_MIN; }

/** The shops a viewer's stats are bound to: null = every shop (level 8+). */
export function customerShopScope(v: CustomerViewer): string[] | null {
  if (v.level >= CUSTOMER_ALL_SHOPS_MIN) return null;
  return [...v.locations];
}

/**
 * The profile DTO a non-contact viewer receives. Built by whitelisting, so a field added to the
 * loader's row can never leak by default. Contact fields are not in this type at all.
 */
export interface CustomerStatsDto {
  id: string;
  name: string | null;
  visits: number;
  spendCents: number | null;
  firstOrder: string | null;
  lastOrder: string | null;
  avgDaysBetween: number | null;
  channels: { channel: string; visits: number }[];
  favourites: { name: string; qty: number }[];
  maskedChannels: string[];
  emailMarketing: "opted_in" | "opted_out" | "unknown";
  cards: number;
}

export const STATS_DTO_KEYS = ["id", "name", "visits", "spendCents", "firstOrder", "lastOrder", "avgDaysBetween", "channels",
  "favourites", "maskedChannels", "emailMarketing", "cards"] as const satisfies readonly (keyof CustomerStatsDto)[];

export function toStatsDto(input: Record<string, unknown> & CustomerStatsDto): CustomerStatsDto {
  const out = {} as Record<string, unknown>;
  for (const k of STATS_DTO_KEYS) out[k] = input[k];
  return out as unknown as CustomerStatsDto;
}
