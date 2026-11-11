import { loadLandingConfig, type LandingConfig } from "./config";
import { portalOrigin } from "@/lib/portal/origin-shared";

export function getLandingLinks(config: LandingConfig = loadLandingConfig()) {
  if (config.cateringPortalLive && !config.staffOrigin) throw new Error("Landing catering requires an approved staff origin");
  return {
    orders: config.stores.map(({key, pickupUrl}) => ({store: key, href: pickupUrl})),
    delivery: config.deliveryUrl,
    catering: config.cateringPortalLive ? new URL("/order", portalOrigin({ PORTAL_ORIGIN: config.PORTAL_ORIGIN, NEXT_PUBLIC_APP_URL: config.staffOrigin! })).href : config.cateringUrl,
    inquiry: config.inquiryUrl,
    footer: config.footerLinks,
  };
}
