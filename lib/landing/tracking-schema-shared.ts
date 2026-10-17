/** Bounded vocabulary only: never accept arbitrary customer data or destinations. */
export const LANDING_STORE_KEYS = ["capitol-hill", "dupont"] as const;
export const LANDING_AD_CODES = ["subsim-photo", "unattributed"] as const;
export const LANDING_PLACEMENTS = ["hero", "field-guide", "lineup", "shops", "catering", "footer"] as const;
export const LANDING_VENDORS = ["ubereats", "doordash"] as const;
export const LANDING_SERVER_EVENTS = ["Lead", "OrderClick", "CateringClick"] as const;
export type LandingStoreKey = (typeof LANDING_STORE_KEYS)[number];
export type LandingAdCode = (typeof LANDING_AD_CODES)[number];
export type LandingPlacement = (typeof LANDING_PLACEMENTS)[number];
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
/** The only shop-specific delivery destination is the verified Dupont Uber Eats link. */
export function validVendorPlacement(vendor: unknown, placement: unknown, store: unknown): boolean {
  return isAllowed(LANDING_VENDORS,vendor) && (placement === 'footer' || (vendor === 'ubereats' && placement === 'shops' && store === 'dupont'));
}
export function parseLandingEvent(value: unknown, origin: string, now: number): LandingEvent | null {
  if (!isRecord(value) || Object.keys(value).some(key => !["event_name", "event_id", "event_time", "consent", "source_url", "store", "ad", "placement", "fbc", "fbp", "vendor"].includes(key))) return null;
  if (!isAllowed(LANDING_SERVER_EVENTS, value.event_name) || value.consent !== "accepted" || !isAllowed(LANDING_AD_CODES, value.ad) || !isAllowed(LANDING_PLACEMENTS, value.placement)) return null;
  if (typeof value.event_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.event_id)) return null;
  if (typeof value.event_time !== "number" || !Number.isInteger(value.event_time) || value.event_time < Math.floor(now / 1000) - 7 * 86400 || value.event_time > Math.floor(now / 1000) + 60) return null;
  if (value.vendor !== undefined && (value.event_name !== "OrderClick" || !validVendorPlacement(value.vendor,value.placement,value.store))) return null;
  if (((value.event_name === "OrderClick" && value.vendor === undefined) || value.store !== undefined) && !isAllowed(LANDING_STORE_KEYS, value.store)) return null;
  // Only public landing documents are event sources; no arbitrary path, query or fragment.
  if (value.source_url !== `${origin}/` && value.source_url !== `${origin}/privacy`) return null;
  for (const key of ["fbc", "fbp"] as const) if (value[key] !== undefined && !validMetaCookie(value[key], key, now)) return null;
  return value as unknown as LandingEvent;
}
