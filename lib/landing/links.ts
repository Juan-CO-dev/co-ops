import { loadLandingConfig, type LandingConfig } from "./config";

export function getLandingLinks(config: LandingConfig = loadLandingConfig()) {
  if (config.cateringPortalLive && !config.staffOrigin) throw new Error("Landing catering requires an approved staff origin");
  return {
    orders: config.stores.map(({key, orderUrl}) => ({store: key, href: orderUrl})),
    catering: config.cateringPortalLive ? new URL("/order", config.staffOrigin!).href : config.cateringUrl,
    inquiry: config.inquiryUrl,
    footer: config.footerLinks,
  };
}
