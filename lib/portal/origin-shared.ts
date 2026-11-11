import { configuredOrigin } from '@/lib/landing/host-shared';

/** One customer-link origin. Preserve the legacy fallback verbatim when dormant.
 * Invalid explicit configuration refuses rather than sending customers elsewhere. */
export function portalOrigin(env: { PORTAL_ORIGIN?: string; NEXT_PUBLIC_APP_URL?: string } = { PORTAL_ORIGIN: process.env.PORTAL_ORIGIN, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL }): string | undefined {
  if (env.PORTAL_ORIGIN === undefined || env.PORTAL_ORIGIN === '') return env.NEXT_PUBLIC_APP_URL;
  const origin = configuredOrigin(env.PORTAL_ORIGIN);
  if (!origin) throw new Error('PORTAL_ORIGIN must be an https origin');
  return origin.origin;
}
