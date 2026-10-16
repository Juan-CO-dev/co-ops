/** Tenant-owned destinations. Supplied in the approved 2026-10-16 plan.
 * Merchant branch/serving-option and branded-host equivalence are launch gates;
 * until verified, preserve the supplied Appfront URLs exactly.
 */
export interface LandingStoreConfig {
  key: "capitol-hill" | "dupont";
  locationCode: string;
  orderLabel: string;
  branchId: string;
  orderUrl: string;
  hours: { en: string; es: string } | null;
  coordinates: { latitude: number; longitude: number } | null;
}
export interface LandingTenantConfig {
  stores: readonly LandingStoreConfig[];
  cateringPortalLive: boolean;
  cateringUrl: string;
  inquiryUrl: string;
  footerLinks: readonly { key: string; url: string }[];
  attribution: { ads: readonly string[]; utm: Record<string, readonly string[]> };
}
export const landingTenantConfig: LandingTenantConfig = {
  stores: [
    { key: "capitol-hill", locationCode: "MEP", orderLabel: "Capitol Hill", branchId: "69bdd5a0daeb710cb2cbdb0d", orderUrl: "https://complimentsonlysubs.appfront.app/order/?branchId=69bdd5a0daeb710cb2cbdb0d&servingOptionType=a", hours: null, coordinates: null },
    { key: "dupont", locationCode: "EM", orderLabel: "Dupont", branchId: "69bdddee7150a60c8dc37f73", orderUrl: "https://complimentsonlysubs.appfront.app/order/?branchId=69bdddee7150a60c8dc37f73&servingOptionType=a", hours: null, coordinates: null },
  ],
  cateringPortalLive: false,
  cateringUrl: "https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast",
  inquiryUrl: "https://complimentsonlysubs.com/washington-capitol-hill-compliments-only-catering-inquiry",
  // Unverified destinations stay absent until D4's evidence/approval gate.
  footerLinks: [],
  attribution: { ads: ["subsim-photo"], utm: {} },
};
