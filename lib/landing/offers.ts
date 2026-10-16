export interface LandingOffer {
  ad: string;
  code: string;
  approved: boolean;
  redemptionConfigured: boolean;
  terms: string;
  expiresAt: string;
  stores: readonly string[];
}
/** No merchant offer has been approved/configured for launch. */
export const APPROVED_OFFERS: readonly LandingOffer[] = [];
export function resolveOffer(ad: string, store: string, offers: readonly LandingOffer[] = APPROVED_OFFERS, now = Date.now()): LandingOffer | undefined {
  return offers.find(offer => offer.ad === ad && offer.approved && offer.redemptionConfigured && /^[A-Z0-9_-]{1,32}$/.test(offer.code) && offer.terms.trim().length > 0 && Date.parse(offer.expiresAt) > now && offer.stores.includes(store));
}
