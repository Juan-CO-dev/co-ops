import { isAllowed, isRecord, LANDING_STORE_KEYS, type LandingAdCode, type LandingStoreKey } from "./tracking-schema-shared";
import { boundedAd, type AdPolicy } from "./ad-codes-shared";
export interface OrderClick { store?: LandingStoreKey; ad: LandingAdCode; intent: "legacy" | "pickup" | "delivery" | "visit" }
export function parseOrderClick(value: unknown, adPolicy: AdPolicy = boundedAd): OrderClick | null {
  if (!isRecord(value) || Object.keys(value).some(key => !["store", "ad", "intent"].includes(key))) return null;
  // Cached clients can still send the pre-0292 shape during deployment drain.
  const intent = value.intent === undefined ? "legacy" : value.intent;
  if (!isAllowed(["legacy", "pickup", "delivery", "visit"] as const, intent)) return null;
  if (intent === "delivery" ? value.store !== undefined : !isAllowed(LANDING_STORE_KEYS, value.store)) return null;
  if (typeof value.ad !== "string" || value.ad.length > 64) return null;
  return { ...(value.store === undefined ? {} : {store: value.store as LandingStoreKey}), ad: adPolicy(value.ad), intent };
}
