/** Bounded vocabulary only: never accept arbitrary customer data or destinations. */
export const LANDING_STORE_KEYS = ["capitol-hill", "dupont"] as const;
import { boundedAd, validAdCandidate, type AdPolicy } from "./ad-codes-shared";
export const LANDING_PLACEMENTS = ["hero", "lineup", "shops", "catering", "footer", "sticky", "crave", "guide"] as const;
/** Which sub an order tap was for: the approved roster ids only (pinned equal to landing-products.json). */
export const LANDING_ITEMS = ["frex", "hot-pants", "teamster", "crunchy-boi", "sicky-wicky", "never-been-cheddar", "turkey-caesar", "farmers-market", "french-dip", "vesuvio"] as const;
export const LANDING_VENDORS = ["ubereats", "doordash"] as const;
export const LANDING_SERVER_EVENTS = ["Lead", "OrderClick", "CateringClick", "FindLocation"] as const;
export type LandingStoreKey = (typeof LANDING_STORE_KEYS)[number];
export type LandingAdCode = string;
export type LandingPlacement = (typeof LANDING_PLACEMENTS)[number];
export type LandingItem = (typeof LANDING_ITEMS)[number];
export type LandingServerEvent = (typeof LANDING_SERVER_EVENTS)[number];
export interface LandingEvent {
  event_name: LandingServerEvent;
  event_id: string;
  event_time: number;
  consent: "accepted";
  source_url: string;
  store?: LandingStoreKey;
  ad: LandingAdCode;
  placement: LandingPlacement;
  fbc?: string;
  fbp?: string;
  vendor?: (typeof LANDING_VENDORS)[number];
  item?: LandingItem;
  mode?: "pickup" | "delivery";
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isAllowed<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
export function validMetaCookie(value: unknown, kind: "fbc" | "fbp", now: number): value is string {
  if (typeof value !== "string" || value.length > 525) return false;
  const match = /^fb\.[12]\.([0-9]{13})\.([a-zA-Z0-9_-]{1,500})$/.exec(value);
  return !!match && Number(match[1]) <= now + 60_000 && (kind !== "fbp" || /^[0-9]+$/.test(match[2]!));
}
/** Placements whose order taps are for one named sub. */
export const LANDING_ITEM_PLACEMENTS = ["lineup", "crave", "guide"] as const;
/** Bounded sub context belongs only to direct pickup/delivery taps at item placements. */
export function validItemEvent(item: unknown, name: unknown, store: unknown, vendor: unknown, placement: unknown, mode?: unknown): boolean {
  return isAllowed(LANDING_ITEMS, item) && name === "OrderClick" && ((mode === "pickup" && isAllowed(LANDING_STORE_KEYS, store)) || (mode === "delivery" && store === undefined)) && vendor === undefined && isAllowed(LANDING_ITEM_PLACEMENTS, placement);
}
/** Direct item placements require a sub for pickup; delivery may retain the same bounded context. */
export function validActionDetails(name: unknown, details: {store?: unknown; vendor?: unknown; mode?: unknown; item?: unknown; placement?: unknown}): boolean {
  const {store, vendor, mode, item, placement} = details;
  if (store !== undefined && !isAllowed(LANDING_STORE_KEYS, store)) return false;
  if (name === "OrderClick") {
    if (vendor !== undefined) {
      if (mode !== undefined || !validVendorPlacement(vendor, placement, store)) return false;
    } else if (mode === "pickup") {
      if (!isAllowed(LANDING_STORE_KEYS, store)) return false;
      if (isAllowed(LANDING_ITEM_PLACEMENTS, placement) && item === undefined) return false;
    } else if (mode !== "delivery" || store !== undefined) return false;
  } else {
    if (mode !== undefined || vendor !== undefined) return false;
    if (name === "FindLocation" && !isAllowed(LANDING_STORE_KEYS, store)) return false;
  }
  return item === undefined || validItemEvent(item, name, store, vendor, placement, mode);
}
/** The only shop-specific delivery destination is the verified Dupont Uber Eats link. */
export function validVendorPlacement(vendor: unknown, placement: unknown, store: unknown): boolean {
  return isAllowed(LANDING_VENDORS,vendor) && ((placement === 'footer' && store === undefined) || (vendor === 'ubereats' && placement === 'shops' && store === 'dupont'));
}
export function parseLandingEvent(value: unknown, origin: string, now: number, adPolicy: AdPolicy = boundedAd): LandingEvent | null {
  if (!isRecord(value) || Object.keys(value).some(key => !["event_name", "event_id", "event_time", "consent", "source_url", "store", "ad", "placement", "fbc", "fbp", "vendor", "item", "mode"].includes(key))) return null;
  if (!isAllowed(LANDING_SERVER_EVENTS, value.event_name) || value.consent !== "accepted" || !validAdCandidate(value.ad) || !isAllowed(LANDING_PLACEMENTS, value.placement)) return null;
  if (typeof value.event_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.event_id)) return null;
  if (typeof value.event_time !== "number" || !Number.isInteger(value.event_time) || value.event_time < Math.floor(now / 1000) - 7 * 86400 || value.event_time > Math.floor(now / 1000) + 60) return null;
  if (!validActionDetails(value.event_name, value)) return null;
  // Only public landing documents are event sources; no arbitrary path, query or fragment.
  if (value.source_url !== `${origin}/` && value.source_url !== `${origin}/privacy`) return null;
  for (const key of ["fbc", "fbp"] as const) if (value[key] !== undefined && !validMetaCookie(value[key], key, now)) return null;
  return { ...value, ad: adPolicy(value.ad) } as unknown as LandingEvent;
}
