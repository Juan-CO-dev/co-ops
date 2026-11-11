import { configuredOrigin, parseAuthority, type LandingHostEnv } from './host-shared';

type LandingIndexingEnv = LandingHostEnv & { VERCEL_ENV?: string; LANDING_INDEXING?: string };

/** Deployment identity is independent of permission to index the landing. */
export function landingCanonical(kind: 'landing' | 'staff' | 'portal', headers: Pick<Headers, 'get'>, env: LandingIndexingEnv): boolean {
  if (env.VERCEL_ENV !== 'production' || kind !== 'landing') return false;
  const origin = configuredOrigin(env.SITE_ORIGIN);
  const host = parseAuthority(headers.get('host'));
  const canonical = origin && parseAuthority(origin.host);
  return !!host && !!canonical && host.hostname === canonical.hostname && host.port === canonical.port;
}

/** Indexing requires an explicit server opt-in; request hints cannot grant it. */
export function landingIndexable(kind: 'landing' | 'staff' | 'portal', headers: Pick<Headers, 'get'>, env: LandingIndexingEnv): boolean {
  return landingCanonical(kind, headers, env) && env.LANDING_INDEXING === 'on';
}
