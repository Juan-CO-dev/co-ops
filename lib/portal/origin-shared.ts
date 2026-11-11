import { portalIdentity, type LandingHostEnv } from '@/lib/landing/host-shared';

/** Invalid or incomplete identity stays dormant; preserve the legacy URL verbatim. */
export function portalOrigin(env: LandingHostEnv & { NEXT_PUBLIC_APP_URL?: string } = {
  PORTAL_ORIGIN: process.env.PORTAL_ORIGIN,
  PORTAL_HOSTS: process.env.PORTAL_HOSTS,
  STAFF_ORIGIN: process.env.STAFF_ORIGIN,
  LANDING_HOSTS: process.env.LANDING_HOSTS,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
}): string | undefined {
  const identity = portalIdentity(env);
  if (identity) return identity.origin;
  if (env.PORTAL_ORIGIN) console.error('[portal] invalid identity; customer links remain dormant');
  return env.NEXT_PUBLIC_APP_URL;
}
