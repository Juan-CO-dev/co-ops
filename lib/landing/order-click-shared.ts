import { isAllowed, isRecord, LANDING_STORE_KEYS, type LandingAdCode, type LandingStoreKey } from "./tracking-schema-shared";
import { boundedAd, type AdPolicy } from "./ad-codes-shared";
export interface OrderClick { store: LandingStoreKey; ad: LandingAdCode }
export function parseOrderClick(value: unknown, adPolicy: AdPolicy = boundedAd): OrderClick | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 || Object.keys(value).some(key => key !== "store" && key !== "ad")) return null;
  if (!isAllowed(LANDING_STORE_KEYS, value.store) || typeof value.ad !== "string" || value.ad.length > 64) return null;
  return { store: value.store, ad: adPolicy(value.ad) };
}
