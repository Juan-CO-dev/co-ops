import { nearbyEnabled } from './nearby-shared';
import { landingTenantConfig } from "@/config/tenant/landing";

export type LandingEnvironment = Readonly<Record<string, string | undefined>>;
function httpsOrigin(value: string | undefined): string | null {
  if (!value || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.endsWith(".") || url.hostname.includes("xn--")) return null;
    return url.origin;
  } catch { return null; }
}

/** Host-safe: no database, I/O, or secret fields. Host permission still comes
 * exclusively from classifyLandingHost; config presence never authorizes it. */
export function loadLandingConfig(env: LandingEnvironment = process.env) {
  const landingHosts = (env.LANDING_HOSTS ?? "").split(",").map((v) => v.trim()).filter((v) => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(v) && !v.includes("xn--"));
  return {
    ...landingTenantConfig,
    nearbyEnabled: nearbyEnabled(landingTenantConfig.stores),
    LANDING_HOSTS: env.LANDING_HOSTS,
    STAFF_ORIGIN: env.STAFF_ORIGIN,
    SITE_ORIGIN: env.SITE_ORIGIN,
    landingHosts,
    siteOrigin: httpsOrigin(env.SITE_ORIGIN),
    staffOrigin: httpsOrigin(env.STAFF_ORIGIN),
    pixelId: /^\d{5,30}$/.test(env.NEXT_PUBLIC_META_PIXEL_ID ?? "") ? env.NEXT_PUBLIC_META_PIXEL_ID : undefined,
  };
}
export type LandingConfig = ReturnType<typeof loadLandingConfig>;
