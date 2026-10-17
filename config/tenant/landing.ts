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
  name: string;
  address: string;
  structuredAddress: { streetAddress: string; addressLocality: string; addressRegion: string; postalCode: string; addressCountry: string };
  phone: string;
  openingHours: { days: readonly string[]; opens: string; closes: string };
  hours: { en: string; es: string } | null;
  coordinates: { latitude: number; longitude: number } | null;
}
export type LandingFooterKey = "careers" | "gift-cards" | "app" | "app-ios" | "app-android" | "instagram" | "facebook" | "uber-eats" | "doordash";
export interface LandingTenantConfig {
  stores: readonly LandingStoreConfig[];
  cateringPortalLive: boolean;
  cateringUrl: string;
  inquiryUrl: string;
  footerLinks: readonly { key: LandingFooterKey; url: string }[];
  attribution: { ads: readonly string[]; utm: Record<string, readonly string[]> };
}
export const landingTenantConfig: LandingTenantConfig = {
  stores: [
    { key: "capitol-hill", locationCode: "MEP", orderLabel: "Capitol Hill", branchId: "69bdd5a0daeb710cb2cbdb0d", orderUrl: "https://complimentsonlysubs.appfront.app/order/?branchId=69bdd5a0daeb710cb2cbdb0d&servingOptionType=a",
      name: "Capitol Hill",
      address: "526 8th St SE Ste A, Washington, DC 20003",
      structuredAddress: {"streetAddress": "526 8th St SE Ste A", "addressLocality": "Washington", "addressRegion": "DC", "postalCode": "20003", "addressCountry": "US"},
      phone: "+12026218645",
      openingHours: {"days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], "opens": "10:30", "closes": "18:00"},
      hours: {"en": "Daily 10:30am–6pm", "es": "Todos los días de 10:30 a. m. a 6:00 p. m."},
      coordinates: {"latitude": 38.8817492, "longitude": -76.9947597} },
    { key: "dupont", locationCode: "EM", orderLabel: "Dupont", branchId: "69bdddee7150a60c8dc37f73", orderUrl: "https://complimentsonlysubs.appfront.app/order/?branchId=69bdddee7150a60c8dc37f73&servingOptionType=a",
      name: "Dupont",
      address: "2029 P St NW Front 1, Washington, DC 20036",
      structuredAddress: {"streetAddress": "2029 P St NW Front 1", "addressLocality": "Washington", "addressRegion": "DC", "postalCode": "20036", "addressCountry": "US"},
      phone: "+12027944638",
      openingHours: {"days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], "opens": "10:30", "closes": "20:00"},
      hours: {"en": "Daily 10:30am–8pm", "es": "Todos los días de 10:30 a. m. a 8:00 p. m."},
      coordinates: {"latitude": 38.9098292, "longitude": -77.0462506} },
  ],
  cateringPortalLive: false,
  cateringUrl: "https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast",
  inquiryUrl: "https://complimentsonlysubs.com/washington-capitol-hill-compliments-only-catering-inquiry",
  // Official public destinations verified in docs/landing-v2-facts.md (2026-10-16).
  footerLinks: [
    {key:"app",url:"https://order.complimentsonlysubs.com/"},
    {key:"instagram",url:"https://www.instagram.com/complimentsonlysubs/"},
    {key:"careers",url:"https://tmt.spotapps.co/job-listings?spot_id=401740"},
    {key:"doordash",url:"https://order.online/business/compliments-only-11187127"},
    {key:"uber-eats",url:"https://www.ubereats.com/store/compliments-only-dupont-circle/gEXGz9LhW5K7vNG69G9aDQ"},
  ],
  attribution: { ads: ["subsim-photo"], utm: {} },
};
