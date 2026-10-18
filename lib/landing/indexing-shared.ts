import { classifyLandingHost, configuredOrigin, parseAuthority, type LandingHostEnv } from './host-shared';

/** Deployment identity is server configuration; request hints cannot grant indexing. */
export function landingIndexable(headers: Pick<Headers, 'get'>, env: LandingHostEnv & { VERCEL_ENV?: string }): boolean {
  if (env.VERCEL_ENV !== 'production' || classifyLandingHost(headers, env) !== 'landing') return false;
  const origin = configuredOrigin(env.SITE_ORIGIN);
  const host = parseAuthority(headers.get('host'));
  const canonical = origin && parseAuthority(origin.host);
  return !!host && !!canonical && host.hostname === canonical.hostname && host.port === canonical.port;
}
